/**
 * Fila store-and-forward. Mensagem para quem não está por perto agora fica
 * guardada e é reenviada quando o destino, ou um vizinho em direção a ele,
 * aparece. É o que faz a malha funcionar com gente em movimento.
 *
 * Cada item lembra para quais vizinhos já foi entregue, para não repetir.
 */

import type { Armazenamento } from './armazenamento.ts';
import { deBase64, paraBase64 } from './bytes.ts';

export interface ItemFila {
  /** Chave de deduplicação do pacote (origem:id). */
  chave: string;
  bytes: Uint8Array;
  /** Nó de destino, para mensagens privadas. */
  destino?: string;
  /** Mensagem criada por este aparelho (vale mais que as carregadas para outros). */
  propria: boolean;
  criadoEm: number;
  expiraEm: number;
  /** Vizinhos (canal:idLocal) que já receberam este item. */
  entreguesA: string[];
}

const CHAVE_ARMAZENAMENTO = 'nucleo.fila.v1';

export class Fila {
  private itens = new Map<string, ItemFila>();
  private gravacaoPendente: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly armazenamento?: Armazenamento,
    private readonly capacidade = 300,
    private readonly agora: () => number = Date.now,
  ) {}

  async carregar(): Promise<void> {
    if (!this.armazenamento) return;
    const texto = await this.armazenamento.ler(CHAVE_ARMAZENAMENTO);
    if (!texto) return;
    try {
      const lista = JSON.parse(texto) as (Omit<ItemFila, 'bytes'> & { bytes: string })[];
      for (const i of lista) this.itens.set(i.chave, { ...i, bytes: deBase64(i.bytes) });
      this.limparExpirados();
    } catch {
      // Arquivo corrompido: começa vazio.
    }
  }

  adicionar(item: Omit<ItemFila, 'entreguesA' | 'criadoEm'> & { entreguesA?: string[] }): void {
    if (this.itens.has(item.chave)) return;
    this.itens.set(item.chave, { ...item, criadoEm: this.agora(), entreguesA: item.entreguesA ?? [] });
    this.aplicarCapacidade();
    this.agendarGravacao();
  }

  remover(chave: string): boolean {
    const removeu = this.itens.delete(chave);
    if (removeu) this.agendarGravacao();
    return removeu;
  }

  /** Remove o item cujo id (sem a origem) é o informado. Usado nas confirmações. */
  removerPorId(id: string): boolean {
    for (const chave of this.itens.keys()) {
      if (chave.endsWith(`:${id}`)) return this.remover(chave);
    }
    return false;
  }

  tem(chave: string): boolean {
    return this.itens.has(chave);
  }

  lista(): ItemFila[] {
    return [...this.itens.values()];
  }

  get tamanho(): number {
    return this.itens.size;
  }

  /** Itens ainda não entregues a este vizinho, mais novos primeiro, até `limite`. */
  paraEntregar(vizinho: string, limite = 30): ItemFila[] {
    this.limparExpirados();
    return [...this.itens.values()]
      .filter((i) => !i.entreguesA.includes(vizinho))
      .sort((a, b) => Number(b.propria) - Number(a.propria) || b.criadoEm - a.criadoEm)
      .slice(0, limite);
  }

  marcarEntregue(chave: string, vizinho: string): void {
    const i = this.itens.get(chave);
    if (!i || i.entreguesA.includes(vizinho)) return;
    i.entreguesA.push(vizinho);
    if (i.entreguesA.length > 64) i.entreguesA.shift();
    this.agendarGravacao();
  }

  limparExpirados(): void {
    const t = this.agora();
    let mudou = false;
    for (const [k, i] of this.itens) {
      if (i.expiraEm <= t) {
        this.itens.delete(k);
        mudou = true;
      }
    }
    if (mudou) this.agendarGravacao();
  }

  private aplicarCapacidade(): void {
    if (this.itens.size <= this.capacidade) return;
    // Descarta primeiro o que é de outros e mais antigo.
    const ordem = [...this.itens.values()].sort(
      (a, b) => Number(a.propria) - Number(b.propria) || a.criadoEm - b.criadoEm,
    );
    while (this.itens.size > this.capacidade) this.itens.delete(ordem.shift()!.chave);
  }

  private agendarGravacao(): void {
    if (!this.armazenamento || this.gravacaoPendente) return;
    this.gravacaoPendente = setTimeout(() => {
      this.gravacaoPendente = undefined;
      void this.gravarAgora();
    }, 500);
  }

  async gravarAgora(): Promise<void> {
    if (!this.armazenamento) return;
    const lista = [...this.itens.values()].map((i) => ({ ...i, bytes: paraBase64(i.bytes) }));
    await this.armazenamento.gravar(CHAVE_ARMAZENAMENTO, JSON.stringify(lista));
  }

  descartarGravacaoPendente(): void {
    if (this.gravacaoPendente) clearTimeout(this.gravacaoPendente);
    this.gravacaoPendente = undefined;
  }
}
