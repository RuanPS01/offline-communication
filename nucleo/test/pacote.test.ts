import { describe, expect, it } from 'vitest';
import {
  assinarPacote,
  codificarPacote,
  decodificarPacote,
  FLAG,
  novaIdentidade,
  type Pacote,
  TAM_CABECALHO,
  TipoPacote,
  utf8,
  verificarPacote,
  VERSAO_PROTOCOLO,
} from '../src/index.ts';

function exemplo(parcial: Partial<Pacote> = {}): Pacote {
  return {
    versao: VERSAO_PROTOCOLO,
    tipo: TipoPacote.Texto,
    flags: 0,
    ttl: 4,
    saltos: 0,
    id: 'a1b2c3d4e5f6',
    origem: '0102030405ff',
    carimbo: 1_790_000_000,
    carga: utf8('olá, tudo bem?'),
    ...parcial,
  };
}

describe('pacote', () => {
  it('codifica e decodifica sem perder nada', () => {
    const p = exemplo({ alvo: 'ffeeddccbbaa', flags: FLAG.ALVO_NO });
    const volta = decodificarPacote(codificarPacote(p));
    expect(volta).toMatchObject({ ...p, flags: FLAG.ALVO_NO | FLAG.TEM_ALVO });
    expect(volta.carga).toEqual(p.carga);
  });

  it('tem cabeçalho compacto de 19 bytes', () => {
    const p = exemplo({ carga: new Uint8Array(0) });
    expect(codificarPacote(p).length).toBe(TAM_CABECALHO);
    expect(TAM_CABECALHO).toBe(19);
  });

  it('um texto curto assinado cabe numa transmissão de som (140 bytes)', () => {
    const id = novaIdentidade();
    const p = assinarPacote(exemplo({ origem: id.idNo, carga: utf8('Estou no abrigo da escola, tudo bem') }), id);
    expect(codificarPacote(p).length).toBeLessThanOrEqual(140);
  });

  it('a assinatura continua válida depois de mudar ttl e saltos', () => {
    const id = novaIdentidade();
    const p = assinarPacote(exemplo({ origem: id.idNo }), id);
    const retransmitido = decodificarPacote(codificarPacote({ ...p, ttl: 1, saltos: 3 }));
    expect(verificarPacote(retransmitido, id.chavePublica)).toBe(true);
  });

  it('a assinatura falha se a carga for adulterada', () => {
    const id = novaIdentidade();
    const p = assinarPacote(exemplo({ origem: id.idNo }), id);
    expect(verificarPacote({ ...p, carga: utf8('outra coisa') }, id.chavePublica)).toBe(false);
    expect(verificarPacote(p, novaIdentidade().chavePublica)).toBe(false);
  });

  it('rejeita lixo e versões desconhecidas', () => {
    expect(() => decodificarPacote(new Uint8Array(5))).toThrow();
    const b = codificarPacote(exemplo());
    b[0] = (9 << 4) | 1;
    expect(() => decodificarPacote(b)).toThrow(/versão/);
  });
});
