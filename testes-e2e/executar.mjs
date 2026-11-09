// Teste de ponta a ponta no navegador: um servidor de rede local serve a
// PWA, três "celulares" (contextos do Chromium) abrem a página dele,
// se enxergam no radar e trocam mensagens públicas e particulares.
//
//   npm run build -w cliente-web && node testes-e2e/executar.mjs [--capturas pasta]

import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iniciarServidor } from '../canais/rede-local/servidor/servidor.mjs';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('@playwright/test');
}
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const i = process.argv.indexOf('--capturas');
const pastaCapturas = i > 0 ? process.argv[i + 1] : undefined;
if (pastaCapturas) mkdirSync(pastaCapturas, { recursive: true });

function aba(pagina, nome) {
  return pagina.getByRole('navigation').getByRole('button', { name: new RegExp(`^${nome}`) });
}

function afirmar(condicao, mensagem) {
  if (!condicao) throw new Error(`Falhou: ${mensagem}`);
  console.log(`  ok: ${mensagem}`);
}

const servidor = await iniciarServidor({ pasta: join(raiz, 'cliente-web', 'dist'), porta: 0, anunciarMdns: false });
const url = `http://127.0.0.1:${servidor.porta}/`;
const navegador = await playwright.chromium.launch();
const erros = [];

async function abrir(apelido) {
  const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const pagina = await contexto.newPage();
  pagina.on('pageerror', (e) => erros.push(`${apelido}: ${e.message}`));
  await pagina.goto(url);
  await pagina.getByLabel('Como quer ser chamado?').fill(apelido);
  await pagina.getByRole('button', { name: 'Entrar' }).click();
  await pagina.getByRole('navigation').waitFor();
  return pagina;
}

try {
  console.log(`Servidor em ${url}`);
  const ana = await abrir('Ana');
  const beto = await abrir('Beto');
  const caio = await abrir('Caio');

  await ana.getByText('2 por perto').waitFor({ timeout: 15000 });
  afirmar(true, 'Ana vê Beto e Caio no radar pela rede local');
  if (pastaCapturas) await ana.screenshot({ path: join(pastaCapturas, 'radar.png') });

  await aba(ana, 'Conversa').click();
  await ana.getByPlaceholder('Mensagem para #geral').fill('Alguém me ouve? Estou na praça.');
  await ana.getByRole('button', { name: 'Enviar' }).click();

  for (const [nome, pagina] of [['Beto', beto], ['Caio', caio]]) {
    await aba(pagina, 'Conversa').click();
    await pagina.getByText('Alguém me ouve? Estou na praça.').waitFor({ timeout: 10000 });
    afirmar(true, `${nome} recebeu a mensagem pública`);
  }
  await ana.getByText('ouvida por perto').waitFor({ timeout: 10000 });
  afirmar(true, 'Ana vê a mensagem como ouvida');

  // Conversa particular: Beto toca na Ana no radar.
  await aba(beto, 'Radar').click();
  await beto.getByRole('button', { name: /Conversar com Ana/ }).click();
  await beto.getByPlaceholder('Mensagem particular').fill('Só para você: tenho água.');
  await beto.getByRole('button', { name: 'Enviar' }).click();
  await beto.getByText('entregue').waitFor({ timeout: 10000 });
  afirmar(true, 'Beto recebe a confirmação de entrega da mensagem particular');

  await aba(ana, 'Conversa').click();
  const opcao = await ana.locator('select option', { hasText: 'Particular com Beto' }).getAttribute('value');
  await ana.getByLabel('Conversa').selectOption(opcao);
  await ana.getByText('Só para você: tenho água.').waitFor({ timeout: 10000 });
  afirmar(true, 'Ana lê a mensagem particular');
  const caioViu = await caio.getByText('Só para você: tenho água.').count();
  afirmar(caioViu === 0, 'Caio não vê a mensagem particular');
  if (pastaCapturas) await ana.screenshot({ path: join(pastaCapturas, 'conversa.png') });

  await aba(caio, 'Canais').click();
  await caio.getByText('QR (tela e câmera)', { exact: true }).waitFor();
  await caio.getByRole('button', { name: 'Ler QR do outro' }).waitFor();
  afirmar(true, 'o painel do QR abre nos canais');
  if (pastaCapturas) await caio.screenshot({ path: join(pastaCapturas, 'canais.png'), fullPage: true });
  afirmar(erros.length === 0, `nenhum erro de JavaScript nas páginas${erros.length ? `: ${erros.join(' | ')}` : ''}`);
  console.log('Tudo certo.');
} catch (e) {
  console.error(e);
  console.error(erros.join('\n'));
  process.exitCode = 1;
} finally {
  await navegador.close();
  await servidor.fechar();
}
