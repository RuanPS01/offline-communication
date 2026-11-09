// Critério da fase 2 no navegador: a página recebe texto e presença por SOM
// e por QR, sem app instalado. O "outro celular" é simulado: este script gera
// os pacotes com o mesmo núcleo, modula em áudio (ggwave) e em QR, e entrega
// ao Chromium como microfone e câmera falsos.
//
//   npm run build -w cliente-web
//   node --experimental-transform-types testes-e2e/som-e-qr.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gerarQr, pacoteParaTextoQr } from '../canais/qr/src/qr.ts';
import { iniciarServidor } from '../canais/rede-local/servidor/servidor.mjs';
import { ModemSom, ReamostradorContinuo } from '../canais/som/src/modem.ts';
import {
  assinarPacote,
  bytesAleatorios,
  codificarPacote,
  codificarPresenca,
  novaIdentidade,
  paraHex,
  TipoPacote,
  utf8,
  VERSAO_PROTOCOLO,
} from '../nucleo/src/index.ts';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const pasta = join(raiz, 'testes-e2e', 'resultados');
mkdirSync(pasta, { recursive: true });

// --- O outro celular: identidade, presença e duas mensagens -------------------
const ze = novaIdentidade();
function pacote(tipo: TipoPacote, carga: Uint8Array, ttl = 3) {
  return {
    versao: VERSAO_PROTOCOLO,
    tipo,
    flags: 0,
    ttl,
    saltos: 0,
    id: paraHex(bytesAleatorios(6)),
    origem: ze.idNo,
    carimbo: Math.floor(Date.now() / 1000),
    carga,
  };
}
const presenca = codificarPacote(
  pacote(
    TipoPacote.Presenca,
    codificarPresenca({
      chavePublica: ze.chavePublica,
      apelido: 'Zé',
      canalConversa: 'geral',
      canaisAcessiveis: ['som', 'qr'],
      suportaOpus: false,
      falando: false,
    }),
  ),
);
const textoSom = codificarPacote(assinarPacote(pacote(TipoPacote.Texto, utf8('Oi, chegou pelo som')), ze));
const textoQr = codificarPacote(assinarPacote(pacote(TipoPacote.Texto, utf8('E este veio pelo QR')), ze));
console.log(`Pacotes: presença ${presenca.length} B, texto ${textoSom.length} B`);

// --- Áudio: duas transmissões ggwave num WAV ----------------------------------
// O microfone falso do Chromium roda a 44,1 kHz e não reamostra o arquivo.
const taxa = 44100;
const modem = await ModemSom.criar(taxa);
const silencio = (s: number) => new Float32Array(Math.round(taxa * s));
const paraArquivo = (onda: Float32Array) => new ReamostradorContinuo(48000, taxa).processar(onda);
const partes = [
  silencio(1),
  paraArquivo(modem.modular(presenca, 'audivel', 'rapido', 50)),
  silencio(1.5),
  paraArquivo(modem.modular(textoSom, 'audivel', 'rapido', 50)),
  silencio(2),
];
const total = partes.reduce((t, p) => t + p.length, 0);
const wav = Buffer.alloc(44 + total * 2);
wav.write('RIFF', 0);
wav.writeUInt32LE(36 + total * 2, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(taxa, 24);
wav.writeUInt32LE(taxa * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(total * 2, 40);
let pos = 44;
for (const p of partes) for (const v of p) (wav.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), pos), (pos += 2));
const arquivoWav = join(pasta, 'microfone.wav');
writeFileSync(arquivoWav, wav);
console.log(`WAV com ${(total / taxa).toFixed(1)} s gerado`);

// --- Vídeo: QR da presença e QR do texto, alternando (Y4M) ---------------------
const L = 480;
const A = 480;
function quadroQr(texto: string): Buffer {
  const m = gerarQr(texto);
  const escala = Math.floor((L - 40) / (m.tamanho + 8));
  const desloc = Math.floor((L - (m.tamanho + 8) * escala) / 2);
  const y = Buffer.alloc(L * A, 235);
  for (let l = 0; l < m.tamanho; l++) {
    for (let c = 0; c < m.tamanho; c++) {
      if (!m.escuro(l, c)) continue;
      for (let dy = 0; dy < escala; dy++) {
        const linha = desloc + (l + 4) * escala + dy;
        y.fill(16, linha * L + desloc + (c + 4) * escala, linha * L + desloc + (c + 5) * escala);
      }
    }
  }
  return Buffer.concat([Buffer.from('FRAME\n'), y, Buffer.alloc((L * A) / 2, 128)]);
}
const fps = 5;
const quadros = [
  ...Array.from({ length: fps * 2 }, () => quadroQr(pacoteParaTextoQr(presenca))),
  ...Array.from({ length: fps * 2 }, () => quadroQr(pacoteParaTextoQr(textoQr))),
];
const arquivoY4m = join(pasta, 'camera.y4m');
writeFileSync(arquivoY4m, Buffer.concat([Buffer.from(`YUV4MPEG2 W${L} H${A} F${fps}:1 Ip A1:1 C420jpeg\n`), ...quadros]));

// --- A página -------------------------------------------------------------------
const servidor = await iniciarServidor({ pasta: join(raiz, 'cliente-web', 'dist'), porta: 0, anunciarMdns: false });
const navegador = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${arquivoWav}`,
    `--use-file-for-fake-video-capture=${arquivoY4m}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const erros: string[] = [];
try {
  const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  await contexto.grantPermissions(['microphone', 'camera']);
  const pagina = await contexto.newPage();
  pagina.on('pageerror', (e: Error) => erros.push(e.message));
  await pagina.goto(`http://127.0.0.1:${servidor.porta}/`);
  await pagina.getByLabel('Como quer ser chamado?').fill('Bia');
  await pagina.getByRole('button', { name: 'Entrar' }).click();
  const aba = (nome: string) => pagina.getByRole('navigation').getByRole('button', { name: new RegExp(`^${nome}`) });

  // SOM
  await aba('Canais').click();
  await pagina.getByLabel('Ligar Som (dados por áudio)').check();
  await aba('Radar').click();
  await pagina.getByText('1 por perto').waitFor({ timeout: 40_000 });
  const viaSom = await pagina.locator('.pessoa').filter({ hasText: 'Zé' }).filter({ hasText: 'SOM' }).count();
  if (!viaSom) throw new Error('Zé não apareceu pelo som');
  console.log('  ok: presença do Zé recebida pelo som (radar)');
  await aba('Conversa').click();
  await pagina.getByText('Oi, chegou pelo som').waitFor({ timeout: 40_000 });
  console.log('  ok: texto recebido pelo som');

  // QR
  await aba('Canais').click();
  await pagina.getByLabel('Ligar Som (dados por áudio)').uncheck();
  await pagina.getByRole('button', { name: 'Ler QR do outro' }).click();
  // A câmera fica ligada enquanto o painel do QR está aberto.
  await pagina.locator('.canal').filter({ hasText: 'QR (tela e câmera)' }).getByText('1 por perto').waitFor({ timeout: 30_000 });
  await pagina.waitForTimeout(5000);
  await aba('Conversa').click();
  await pagina.getByText('E este veio pelo QR').waitFor({ timeout: 30_000 });
  console.log('  ok: texto recebido pelo QR');
  await pagina.screenshot({ path: join(pasta, 'som-e-qr.png') });
  if (erros.length) throw new Error(`erros na página: ${erros.join(' | ')}`);
  console.log('Critério da fase 2 atendido no navegador: texto por som e por QR, só pela página.');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await navegador.close();
  await servidor.fechar();
  modem.liberar();
}
