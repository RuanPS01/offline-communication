import { describe, expect, it } from 'vitest';
import { BufferDeTremulacao, codificarAdpcm, ControlePtt, decodificarAdpcm, Quadrador, reamostrar } from '../src/index.ts';

function seno(n: number, freq: number, taxa: number, amp = 0.5): Float32Array {
  return Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / taxa));
}

describe('ADPCM', () => {
  it('comprime 4:1 e reconstrói a voz com boa relação sinal-ruído', () => {
    const pcm = seno(480, 440, 8000);
    const cod = codificarAdpcm(pcm);
    expect(cod.length).toBe(3 + 240);
    const volta = decodificarAdpcm(cod, 480);
    let sinal = 0;
    let ruido = 0;
    for (let i = 0; i < pcm.length; i++) {
      sinal += pcm[i]! ** 2;
      ruido += (pcm[i]! - volta[i]!) ** 2;
    }
    const snr = 10 * Math.log10(sinal / ruido);
    expect(snr).toBeGreaterThan(15);
  });
});

describe('reamostragem e quadros', () => {
  it('converte 48 kHz para 8 kHz e corta em quadros de 60 ms', () => {
    const quadros: Float32Array[] = [];
    const q = new Quadrador(480, (x) => quadros.push(x));
    q.empurrar(reamostrar(seno(4800, 300, 48000), 48000, 8000));
    q.empurrar(reamostrar(seno(4800, 300, 48000), 48000, 8000));
    expect(quadros).toHaveLength(3);
    q.esvaziar();
    expect(quadros).toHaveLength(4);
  });
});

describe('buffer de tremulação', () => {
  it('segura o atraso inicial, reordena e marca perdas', () => {
    let t = 0;
    const b = new BufferDeTremulacao<string>(60, 180, () => t);
    b.inserir(10, 'a');
    expect(b.retirar()).toBeUndefined();
    b.inserir(12, 'c');
    b.inserir(11, 'b');
    expect(b.retirar()).toBe('a');
    expect(b.retirar()).toBe('b');
    expect(b.retirar()).toBe('c');
    expect(b.retirar()).toBeUndefined();
    b.inserir(15, 'f');
    expect(b.retirar()).toBeNull(); // 13 perdido
    expect(b.retirar()).toBeNull(); // 14 perdido
    expect(b.retirar()).toBe('f');
    b.inserir(9, 'velho');
    expect(b.retirar()).toBeUndefined();
  });

  it('começa por tempo mesmo com poucos quadros', () => {
    let t = 0;
    const b = new BufferDeTremulacao<string>(60, 200, () => t);
    b.inserir(0, 'x');
    expect(b.retirar()).toBeUndefined();
    t = 250;
    expect(b.retirar()).toBe('x');
  });

  it('atravessa a volta do número de sequência', () => {
    const b = new BufferDeTremulacao<number>(60, 0, () => 0);
    b.inserir(65535, 1);
    b.inserir(0, 2);
    expect(b.retirar()).toBe(1);
    expect(b.retirar()).toBe(2);
  });
});

describe('apertar para falar', () => {
  it('trava o botão enquanto outro fala e libera no fim', () => {
    const p = new ControlePtt('bbb');
    expect(p.podeFalar()).toBe(true);
    p.outroComecou('ccc', 1, 'Caio');
    expect(p.podeFalar()).toBe(false);
    expect(p.estado).toMatchObject({ tipo: 'outro', apelido: 'Caio' });
    p.outroTerminou('ccc', 1);
    expect(p.podeFalar()).toBe(true);
  });

  it('na disputa fica quem tem o menor id', () => {
    const p = new ControlePtt('bbb');
    p.euComecei(7);
    expect(p.outroComecou('ccc', 1)).toBe('ignorado');
    expect(p.estado.tipo).toBe('eu');
    expect(p.outroComecou('aaa', 2)).toBe('ceder');
    expect(p.estado).toMatchObject({ tipo: 'outro', quem: 'aaa' });
  });

  it('libera sozinho se o FIM_FALA se perdeu', () => {
    let t = 0;
    const p = new ControlePtt('bbb', () => t);
    p.outroComecou('ccc', 1);
    t = 5000;
    expect(p.podeFalar()).toBe(true);
  });
});
