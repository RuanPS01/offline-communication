/**
 * Roteador: para cada pacote, escolhe por quais canais mandar olhando as
 * capacidades e quem está ao alcance de cada um.
 *
 * - Voz ao vivo vai só pelos canais `aoVivo`, preferindo os de maior vazão.
 * - Mensagem privada para alguém ao alcance direto vai pelo canal mais barato
 *   que chega nele.
 * - O resto usa cobertura gulosa por custo: pega o canal mais barato que
 *   alcança alguém ainda não coberto, até cobrir todos os vizinhos conhecidos.
 *   Quem aparece em dois canais recebe só pelo mais barato.
 * - Mensagem importante sai por todos os canais de uma vez.
 * - Sem vizinho nenhum, usa o canal automático mais barato que estiver de pé.
 */

import { type Capacidades, custoDoCanal, type IdCanal } from './canal.ts';

export interface EstadoCanalRoteamento {
  id: IdCanal;
  capacidades: Capacidades;
  ativo: boolean;
  /** Vizinhos diretos identificados (id do nó). */
  vizinhosComId: Set<string>;
  /** Vizinhos percebidos pelo rádio, mas ainda sem identidade. */
  vizinhosSemId: number;
}

export type ModoEnvio = 'difusao' | 'aoVivo' | 'privado' | 'importante';

export interface PedidoRota {
  modo: ModoEnvio;
  /** Nó de destino (modo privado). */
  destino?: string;
  /** Canais a evitar (ex.: o meio único por onde o pacote chegou). */
  excluir?: IdCanal[];
  /** Ignora canais lentos (presença e voz não devem ocupar o som). */
  ignorarLentos?: boolean;
  /** Inclui canais que exigem gesto do usuário (QR, NFC). */
  incluirManuais?: boolean;
}

export const VAZAO_MINIMA_RAPIDO = 200;

function porCusto(a: EstadoCanalRoteamento, b: EstadoCanalRoteamento): number {
  return custoDoCanal(a.capacidades) - custoDoCanal(b.capacidades);
}

function porVazao(a: EstadoCanalRoteamento, b: EstadoCanalRoteamento): number {
  return b.capacidades.bytesPorSegundo - a.capacidades.bytesPorSegundo;
}

function temVizinhos(c: EstadoCanalRoteamento): boolean {
  return c.vizinhosComId.size > 0 || c.vizinhosSemId > 0;
}

export function escolherCanais(canais: EstadoCanalRoteamento[], pedido: PedidoRota): IdCanal[] {
  let candidatos = canais.filter(
    (c) =>
      c.ativo &&
      !c.capacidades.somenteTexto &&
      !(pedido.excluir ?? []).includes(c.id) &&
      (pedido.incluirManuais || !c.capacidades.exigeAcao),
  );
  if (pedido.ignorarLentos) {
    candidatos = candidatos.filter((c) => c.capacidades.bytesPorSegundo >= VAZAO_MINIMA_RAPIDO);
  }

  if (pedido.modo === 'aoVivo') {
    // Sem vizinho num canal ao vivo, não adianta transmitir voz.
    return cobertura(
      candidatos.filter((c) => c.capacidades.aoVivo && temVizinhos(c)),
      porVazao,
    );
  }

  if (pedido.modo === 'importante') {
    return candidatos.sort(porCusto).map((c) => c.id);
  }

  if (pedido.modo === 'privado' && pedido.destino) {
    const diretos = candidatos.filter((c) => c.vizinhosComId.has(pedido.destino!)).sort(porCusto);
    if (diretos.length) return [diretos[0]!.id];
  }

  const escolhidos = cobertura(candidatos, porCusto);
  if (escolhidos.length) return escolhidos;

  // Ninguém por perto em lugar nenhum: tenta o automático mais barato.
  const automatico = candidatos.filter((c) => !c.capacidades.exigeAcao).sort(porCusto)[0];
  return automatico ? [automatico.id] : [];
}

/** Cobertura gulosa: na ordem dada, escolhe cada canal que alcança alguém novo. */
function cobertura(
  canais: EstadoCanalRoteamento[],
  ordem: (a: EstadoCanalRoteamento, b: EstadoCanalRoteamento) => number,
): IdCanal[] {
  const cobertos = new Set<string>();
  const escolhidos: IdCanal[] = [];
  for (const c of [...canais].sort(ordem)) {
    const alcanca = [...c.vizinhosComId];
    if (c.vizinhosSemId > 0) alcanca.push(`?:${c.id}`);
    if (alcanca.some((v) => !cobertos.has(v))) {
      escolhidos.push(c.id);
      for (const v of alcanca) cobertos.add(v);
    }
  }
  return escolhidos;
}

/** Próximo canal para tentar quando ninguém respondeu (degradação com graça). */
export function proximoCanalEscalonamento(
  canais: EstadoCanalRoteamento[],
  jaUsados: Set<IdCanal>,
): IdCanal | undefined {
  const restantes = canais
    .filter((c) => c.ativo && !c.capacidades.somenteTexto && !jaUsados.has(c.id))
    .sort((a, b) => Number(!!a.capacidades.exigeAcao) - Number(!!b.capacidades.exigeAcao) || porCusto(a, b));
  return restantes[0]?.id;
}
