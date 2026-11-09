import { describe, expect, it } from 'vitest';
import {
  CacheVistos,
  codificarPacote,
  decodificarPacote,
  fragmentar,
  type Pacote,
  Remontador,
  TipoPacote,
  VERSAO_PROTOCOLO,
} from '../src/index.ts';

const grande: Pacote = {
  versao: VERSAO_PROTOCOLO,
  tipo: TipoPacote.VozMensagem,
  flags: 0,
  ttl: 4,
  saltos: 1,
  id: '00112233aabb',
  origem: 'ccddeeff0011',
  carimbo: 1_800_000_000,
  carga: Uint8Array.from({ length: 1500 }, (_, i) => i % 251),
};

describe('malha', () => {
  it('fragmenta para caber na MTU e remonta em qualquer ordem', () => {
    const bytes = codificarPacote(grande);
    const partes = fragmentar(grande, bytes, 140);
    expect(partes.length).toBeGreaterThan(10);
    for (const parte of partes) expect(parte.length).toBeLessThanOrEqual(140);
    const r = new Remontador();
    const embaralhadas = [...partes].reverse();
    let resultado: Uint8Array | undefined;
    for (const parte of embaralhadas) {
      const p = decodificarPacote(parte);
      expect(p.tipo).toBe(TipoPacote.Fragmento);
      resultado = r.receber(p) ?? resultado;
    }
    expect(resultado).toEqual(bytes);
    expect(decodificarPacote(resultado!).carga).toEqual(grande.carga);
  });

  it('não fragmenta o que já cabe', () => {
    const bytes = codificarPacote({ ...grande, carga: new Uint8Array(10) });
    expect(fragmentar(grande, bytes, 512)).toEqual([bytes]);
  });

  it('cache de vistos respeita capacidade e validade', () => {
    let t = 0;
    const c = new CacheVistos(3, 1000, () => t);
    c.marcar('a');
    c.marcar('b');
    c.marcar('c');
    c.marcar('d');
    expect(c.ja('a')).toBe(false);
    expect(c.ja('d')).toBe(true);
    t = 2000;
    expect(c.ja('d')).toBe(false);
  });
});
