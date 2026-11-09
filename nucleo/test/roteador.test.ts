import { describe, expect, it } from 'vitest';
import { type Capacidades, escolherCanais, type EstadoCanalRoteamento, proximoCanalEscalonamento } from '../src/index.ts';

function canal(id: string, cap: Partial<Capacidades>, vizinhos: string[] = [], semId = 0): EstadoCanalRoteamento {
  return {
    id,
    ativo: true,
    capacidades: { bytesPorSegundo: 10_000, aoVivo: false, bidirecional: true, alcanceMetros: 30, mtu: 512, ...cap },
    vizinhosComId: new Set(vizinhos),
    vizinhosSemId: semId,
  };
}

describe('roteador', () => {
  const ble = canal('ble', { custo: 2, aoVivo: true, bytesPorSegundo: 20_000 }, ['ana', 'bia']);
  const wifi = canal('wifi', { custo: 3, aoVivo: true, bytesPorSegundo: 500_000 }, ['ana', 'caio']);
  const som = canal('som', { custo: 6, bytesPorSegundo: 16, mtu: 140 }, ['davi']);
  const qr = canal('qr', { custo: 7, exigeAcao: true });

  it('texto vai pelo mais barato que cobre cada vizinho', () => {
    expect(escolherCanais([ble, wifi, som, qr], { modo: 'difusao' })).toEqual(['ble', 'wifi', 'som']);
    expect(escolherCanais([ble, canal('wifi', { custo: 3 }, ['ana'])], { modo: 'difusao' })).toEqual(['ble']);
  });

  it('privado para vizinho direto usa um canal só', () => {
    expect(escolherCanais([ble, wifi, som], { modo: 'privado', destino: 'caio' })).toEqual(['wifi']);
    expect(escolherCanais([ble, wifi, som], { modo: 'privado', destino: 'ana' })).toEqual(['ble']);
  });

  it('voz ao vivo só por canal aoVivo, preferindo vazão', () => {
    expect(escolherCanais([ble, wifi, som], { modo: 'aoVivo' })).toEqual(['wifi', 'ble']);
    expect(escolherCanais([som, qr], { modo: 'aoVivo' })).toEqual([]);
  });

  it('importante sai por todos os automáticos ao mesmo tempo', () => {
    expect(escolherCanais([ble, wifi, som, qr], { modo: 'importante' })).toEqual(['ble', 'wifi', 'som']);
  });

  it('sem vizinho nenhum, usa o automático mais barato', () => {
    const vazio = [canal('ble', { custo: 2 }), canal('som', { custo: 6 }), canal('qr', { custo: 7, exigeAcao: true })];
    expect(escolherCanais(vazio, { modo: 'difusao' })).toEqual(['ble']);
  });

  it('ignora canais lentos quando pedido e exclui meio único', () => {
    expect(escolherCanais([ble, som], { modo: 'difusao', ignorarLentos: true })).toEqual(['ble']);
    expect(escolherCanais([ble, wifi], { modo: 'difusao', excluir: ['ble'] })).toEqual(['wifi']);
  });

  it('escalonamento: próximo canal automático, depois os manuais', () => {
    const usados = new Set(['ble']);
    expect(proximoCanalEscalonamento([ble, wifi, som, qr], usados)).toBe('wifi');
    usados.add('wifi');
    expect(proximoCanalEscalonamento([ble, wifi, som, qr], usados)).toBe('som');
    usados.add('som');
    expect(proximoCanalEscalonamento([ble, wifi, som, qr], usados)).toBe('qr');
  });
});
