import { describe, expect, it } from 'vitest';
import {
  codificarBase45,
  decodificarBase45,
  gerarQr,
  lerQrDeImagem,
  pacoteParaTextoQr,
  textoQrParaPacote,
} from '../src/index.ts';

describe('base45', () => {
  it('segue os exemplos da RFC 9285', () => {
    expect(codificarBase45(new TextEncoder().encode('AB'))).toBe('BB8');
    expect(codificarBase45(new TextEncoder().encode('Hello!!'))).toBe('%69 VD92EX0');
    expect(new TextDecoder().decode(decodificarBase45('QED8WEX0'))).toBe('ietf!');
  });

  it('ida e volta com bytes arbitrários', () => {
    for (const n of [0, 1, 2, 3, 50, 301]) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 97 + 13) & 0xff);
      expect(decodificarBase45(codificarBase45(b))).toEqual(b);
    }
  });

  it('recusa lixo', () => {
    expect(() => decodificarBase45('abc')).toThrow();
    expect(textoQrParaPacote('https://exemplo.com')).toBeUndefined();
  });
});

describe('QR', () => {
  it('um pacote de 300 bytes vira QR e é lido de volta', () => {
    const pacote = Uint8Array.from({ length: 300 }, (_, i) => (i * 31) & 0xff);
    const texto = pacoteParaTextoQr(pacote);
    const m = gerarQr(texto);
    const escala = 4;
    const lado = (m.tamanho + 8) * escala;
    const rgba = new Uint8ClampedArray(lado * lado * 4).fill(255);
    for (let l = 0; l < m.tamanho; l++) {
      for (let c = 0; c < m.tamanho; c++) {
        if (!m.escuro(l, c)) continue;
        for (let y = 0; y < escala; y++) {
          for (let x = 0; x < escala; x++) {
            const i = (((l + 4) * escala + y) * lado + (c + 4) * escala + x) * 4;
            rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
          }
        }
      }
    }
    const lido = lerQrDeImagem(rgba, lado, lado);
    expect(lido).toBe(texto);
    expect(textoQrParaPacote(lido!)).toEqual(pacote);
  });
});
