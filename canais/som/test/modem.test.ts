import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ModemSom } from '../src/modem.ts';

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
