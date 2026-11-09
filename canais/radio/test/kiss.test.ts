import { describe, expect, it } from 'vitest';
import { codificarKiss, DecodificadorKiss, FEND, FESC } from '../src/kiss.ts';

describe('KISS', () => {
  it('escapa os bytes especiais e remonta pacotes de um fluxo picado', () => {
    const a = Uint8Array.from([1, FEND, 2, FESC, 3]);
    const b = Uint8Array.from([FESC, FEND, 0, 255]);
    const fluxo = Uint8Array.from([0x55, ...codificarKiss(a), ...codificarKiss(b)]);
    expect(codificarKiss(a)).toEqual(Uint8Array.from([FEND, 0, 1, FESC, 0xdc, 2, FESC, 0xdd, 3, FEND]));
    const recebidos: Uint8Array[] = [];
    const d = new DecodificadorKiss((p) => recebidos.push(p));
    for (let i = 0; i < fluxo.length; i += 3) d.alimentar(fluxo.subarray(i, i + 3));
    expect(recebidos).toEqual([a, b]);
  });
});
