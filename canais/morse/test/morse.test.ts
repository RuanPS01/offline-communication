import { describe, expect, it } from 'vitest';
import {
  DecodificadorMorse,
  deMorse,
  energiaNormalizada,
  goertzel,
  MedidorDeTom,
  normalizar,
  paraMorse,
  paraSegmentos,
  ProcessadorMorse,
} from '../src/index.ts';

function aleatorio(semente: number): () => number {
  let s = semente;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

describe('código Morse', () => {
  it('converte texto, inclusive com acentos', () => {
    expect(paraMorse('SOS')).toBe('... --- ...');
    expect(normalizar('Ação já, 190!')).toBe('ACAO JA, 190!');
    expect(deMorse(paraMorse('preciso de agua 3 pessoas'))).toBe('PRECISO DE AGUA 3 PESSOAS');
  });

  it('decodifica com o ritmo irregular de uma mão humana', () => {
    const r = aleatorio(7);
    const d = new DecodificadorMorse(150);
    const unidade = 230;
    for (const s of paraSegmentos('SOS ABRIGO NA ESCOLA')) {
      const ms = s.unidades * unidade * (0.75 + r() * 0.5);
      if (s.ligado) d.ligado(ms);
      else d.desligado(ms);
    }
    expect(d.finalizar()).toBe('SOS ABRIGO NA ESCOLA');
  });
});

describe('recepção por luz (brilho da câmera a 30 quadros por segundo)', () => {
  it.each([3, 5, 9, 21])('remonta o texto a partir do brilho com ruído (semente %i)', (semente) => {
    const r = aleatorio(semente);
    const recebidos: string[] = [];
    const p = new ProcessadorMorse(200, (t) => recebidos.push(t), undefined, 0.15);
    const unidade = 200;
    const segmentos = [{ ligado: false, unidades: 10 }, ...paraSegmentos('AGUA 2L'), { ligado: false, unidades: 20 }];
    let t = 0;
    for (const s of segmentos) {
      const fim = t + s.unidades * unidade;
      for (; t < fim; t += 1000 / 30) {
        const base = s.ligado ? 0.85 : 0.25;
        p.alimentar(t, base + (r() - 0.5) * 0.08);
      }
    }
    expect(recebidos).toEqual(['AGUA 2L']);
  });
});

describe('recepção por som (Goertzel em 800 Hz)', () => {
  it('detecta o tom e ignora outras frequências', () => {
    const taxa = 48000;
    const bloco = (f: number) => Float32Array.from({ length: 512 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * f * i) / taxa));
    expect(goertzel(bloco(800), 800, taxa)).toBeGreaterThan(0.3);
    expect(goertzel(bloco(1500), 800, taxa)).toBeLessThan(0.05);
  });

  it.each([11, 13, 17, 23])('decodifica uma transmissão de tom com ruído (semente %i)', (semente) => {
    const taxa = 48000;
    const unidade = 70;
    const r = aleatorio(semente);
    const recebidos: string[] = [];
    const p = new ProcessadorMorse(unidade, (t) => recebidos.push(t), undefined, 0.25);
    const segmentos = [{ ligado: false, unidades: 10 }, ...paraSegmentos('OK 5'), { ligado: false, unidades: 20 }];
    const amostras: number[] = [];
    for (const s of segmentos) {
      const n = Math.round((s.unidades * unidade * taxa) / 1000);
      for (let i = 0; i < n; i++) {
        const tom = s.ligado ? 0.4 * Math.sin((2 * Math.PI * 800 * amostras.length) / taxa) : 0;
        amostras.push(tom + (r() - 0.5) * 0.1);
      }
    }
    const tudo = Float32Array.from(amostras);
    const medidor = new MedidorDeTom(800, taxa);
    for (let i = 0; i + 512 <= tudo.length; i += 512) {
      p.alimentar((i / taxa) * 1000, energiaNormalizada(medidor.medir(tudo.subarray(i, i + 512))));
    }
    expect(recebidos).toEqual(['OK 5']);
  });
});
