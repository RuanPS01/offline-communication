import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ModemSom, ReamostradorContinuo } from '../src/modem.ts';

function demodularEmBlocos(modem: ModemSom, onda: Float32Array): Uint8Array | undefined {
  const bloco = 1024;
  const comSilencio = new Float32Array(onda.length + bloco * 40);
  comSilencio.set(onda, bloco * 4);
  for (let i = 0; i + bloco <= comSilencio.length; i += bloco) {
    const r = modem.demodular(comSilencio.subarray(i, i + bloco));
    if (r) return r;
  }
  return undefined;
}

// O ggwave aceita poucas instâncias ao mesmo tempo: os testes reaproveitam um par.
let tx: ModemSom;
let rx: ModemSom;

describe('modem de som (ggwave)', () => {
  beforeAll(async () => {
    tx = await ModemSom.criar(48000);
    rx = await ModemSom.criar(48000);
  });
  afterAll(() => {
    tx.liberar();
    rx.liberar();
  });

  it('transmite um pacote binário de 140 bytes e recebe igual', async () => {
    const dados = Uint8Array.from({ length: 140 }, (_, i) => (i * 73 + 5) & 0xff);
    const onda = tx.modular(dados, 'audivel', 'maisRapido');
    expect(demodularEmBlocos(rx, onda)).toEqual(dados);
  });

  it('aguenta ruído de fundo', async () => {
    const dados = new TextEncoder().encode('estou na praça central');
    const onda = tx.modular(dados, 'audivel', 'rapido', 40);
    let semente = 1;
    const ruido = () => ((semente = (semente * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 0.05;
    const comRuido = onda.map((v) => v + ruido());
    expect(demodularEmBlocos(rx, comRuido)).toEqual(dados);
  });

  it('também funciona na faixa de ultrassom', async () => {
    const dados = Uint8Array.from([0, 1, 2, 255, 254, 128]);
    expect(demodularEmBlocos(rx, tx.modular(dados, 'ultrassom', 'rapido'))).toEqual(dados);
  });

  it('recusa o que não cabe numa transmissão', async () => {
    expect(() => tx.modular(new Uint8Array(141), 'audivel', 'rapido')).toThrow();
  });
});

describe('microfone em outra taxa', () => {
  it.each([44100, 16000, 22050, 96000])('decodifica capturando a %i Hz em blocos irregulares', async (taxa) => {
    const tx = await ModemSom.criar(48000);
    const rx = await ModemSom.criar(taxa);
    const dados = Uint8Array.from({ length: 90 }, (_, i) => (i * 11) & 0xff);
    // Simula o caminho do ar: onda a 48 kHz, captada pelo microfone na taxa dele.
    const noAr = new ReamostradorContinuo(48000, taxa).processar(tx.modular(dados, 'audivel', 'rapido'));
    const comSilencio = new Float32Array(noAr.length + taxa * 2);
    comSilencio.set(noAr, Math.round(taxa * 0.3));
    let r: Uint8Array | undefined;
    for (let i = 0, n = 0; i < comSilencio.length && !r; i += n) {
      n = 300 + ((i / 7) % 900) | 0;
      r = rx.demodular(comSilencio.subarray(i, i + n));
    }
    tx.liberar();
    rx.liberar();
    expect(r).toEqual(dados);
  });
});
