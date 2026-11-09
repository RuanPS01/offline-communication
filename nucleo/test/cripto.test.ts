import { describe, expect, it } from 'vitest';
import {
  canalPrivado,
  canalPublico,
  chaveEntrePares,
  cifrar,
  decifrar,
  deUtf8,
  idDaChavePublica,
  impressaoDigital,
  novaIdentidade,
  utf8,
} from '../src/index.ts';

describe('cripto', () => {
  it('cada sessão gera uma identidade nova', () => {
    const a = novaIdentidade();
    const b = novaIdentidade();
    expect(a.idNo).not.toBe(b.idNo);
    expect(a.idNo).toHaveLength(12);
    expect(idDaChavePublica(a.chavePublica)).toBe(a.idNo);
    expect(impressaoDigital(a.chavePublica)).toMatch(/^[0-9A-F]{4}( [0-9A-F]{4}){3}$/);
  });

  it('canal privado: mesma senha, mesma chave e mesmo id', () => {
    const a = canalPrivado('Família', 'segredo', 1000);
    const b = canalPrivado('família ', 'segredo', 1000);
    const c = canalPrivado('família', 'outra', 1000);
    expect(a.id).toBe(b.id);
    expect(a.chave).toEqual(b.chave);
    expect(c.id).not.toBe(a.id);
    expect(a.id).not.toBe(canalPublico('família').id);
  });

  it('quem não tem a senha não lê', () => {
    const a = canalPrivado('família', 'segredo', 1000);
    const c = canalPrivado('família', 'errada', 1000);
    const aad = utf8('cabecalho');
    const cifrado = cifrar(a.chave!, utf8('ponto de encontro: praça'), aad);
    expect(deUtf8(decifrar(a.chave!, cifrado, aad)!)).toBe('ponto de encontro: praça');
    expect(decifrar(c.chave!, cifrado, aad)).toBeUndefined();
    expect(decifrar(a.chave!, cifrado, utf8('outro cabecalho'))).toBeUndefined();
  });

  it('conversa privada: as duas pontas chegam à mesma chave', () => {
    const a = novaIdentidade();
    const b = novaIdentidade();
    expect(chaveEntrePares(a, b.chavePublica)).toEqual(chaveEntrePares(b, a.chavePublica));
    expect(chaveEntrePares(a, b.chavePublica)).not.toEqual(chaveEntrePares(a, novaIdentidade().chavePublica));
  });
});
