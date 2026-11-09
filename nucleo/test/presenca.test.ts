import { describe, expect, it } from 'vitest';
import {
  codificarPresenca,
  decodificarPresenca,
  distanciaEntre,
  novaIdentidade,
  TabelaPresenca,
} from '../src/index.ts';

describe('presença', () => {
  const id = novaIdentidade();
  const dados = {
    chavePublica: id.chavePublica,
    apelido: 'Joana',
    canalConversa: 'geral',
    canaisAcessiveis: ['ble', 'som', 'qr'],
    posicao: { lat: -23.5505199, lon: -46.6333094, precisaoMetros: 12 },
    bateria: 76,
    suportaOpus: true,
    falando: false,
  };

  it('codifica e decodifica, cabendo num anúncio de som', () => {
    const b = codificarPresenca(dados);
    expect(b.length).toBeLessThan(100);
    const volta = decodificarPresenca(b);
    expect(volta.apelido).toBe('Joana');
    expect(volta.canaisAcessiveis).toEqual(['ble', 'som', 'qr']);
    expect(volta.posicao!.lat).toBeCloseTo(dados.posicao.lat, 6);
    expect(volta.posicao!.lon).toBeCloseTo(dados.posicao.lon, 6);
    expect(volta.bateria).toBe(76);
    expect(volta.suportaOpus).toBe(true);
  });

  it('funde avistamentos de canais diferentes numa pessoa só', () => {
    let t = 1000;
    const tabela = new TabelaPresenca(() => t, 60_000);
    expect(tabela.atualizar(id.idNo, dados, { canal: 'ble', saltos: 0, rssi: -58 })).toBe(true);
    tabela.marcarVisto(id.idNo, { canal: 'som', saltos: 0 });
    tabela.marcarVisto(id.idNo, { canal: 'wifi', saltos: 2 });
    const [p] = tabela.lista();
    expect(p!.vistoPor.map((v) => v.canal).sort()).toEqual(['ble', 'som', 'wifi']);
    expect(p!.saltos).toBe(0);
    expect(p!.distancia.classe).toBe('perto');
    t += 61_000;
    expect(tabela.limparExpirados()).toBe(true);
    expect(tabela.lista()).toHaveLength(0);
  });

  it('usa o GPS quando os dois lados têm posição', () => {
    const tabela = new TabelaPresenca();
    tabela.atualizar(id.idNo, dados, { canal: 'ble', saltos: 0 });
    const minha = { lat: -23.5515, lon: -46.6333 };
    const [p] = tabela.lista(minha);
    expect(p!.distancia.metros).toBeCloseTo(distanciaEntre(minha, dados.posicao), 3);
    expect(p!.distancia.classe).toBe('medio');
    expect(p!.rumo).toBeDefined();
  });

  it('recusa presença cuja chave não bate com o id', () => {
    const tabela = new TabelaPresenca();
    expect(tabela.atualizar('000000000000', dados, { canal: 'ble', saltos: 0 })).toBe(false);
  });
});
