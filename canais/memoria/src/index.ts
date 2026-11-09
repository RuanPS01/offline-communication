/**
 * Canal de teste. Simula um meio de rádio em memória: cada nó só ouve quem
 * está ligado a ele no `MeioSimulado`. Serve para provar a malha (uma
 * mensagem com TTL atravessando vários nós) sem nenhum hardware.
 */

import type { AoMudarVizinho, AoReceberPacote, Canal, Capacidades } from '@plataforma/nucleo';

export interface OpcoesMeio {
  /** Probabilidade de perder cada transmissão (0 a 1). */
  perda?: number;
  /** Atraso de entrega em ms. */
  atrasoMs?: number;
  /** Função aleatória (para testes determinísticos). */
  aleatorio?: () => number;
}

export class MeioSimulado {
  private nos = new Map<string, CanalMemoria>();
  private ligacoes = new Map<string, Set<string>>();
  readonly transmissoes: { de: string; para: string; bytes: number }[] = [];

  constructor(private readonly opcoes: OpcoesMeio = {}) {}

  /**
   * `avisarVizinhos: false` imita canais que só descobrem alguém quando o
   * ouvem (som, luz), sem varredura de rádio.
   */
  criarCanal(
    nome: string,
    capacidades?: Partial<Capacidades>,
    id = 'memoria',
    opcoes: { avisarVizinhos?: boolean } = {},
  ): CanalMemoria {
    const c = new CanalMemoria(this, nome, capacidades, id, opcoes.avisarVizinhos ?? true);
    this.nos.set(nome, c);
    if (!this.ligacoes.has(nome)) this.ligacoes.set(nome, new Set());
    return c;
  }

  /** Liga dois nós (ficam ao alcance um do outro). */
  ligar(a: string, b: string): void {
    this.ligacoes.get(a)?.add(b);
    this.ligacoes.get(b)?.add(a);
    this.nos.get(a)?.avisarVizinho(b, true);
    this.nos.get(b)?.avisarVizinho(a, true);
  }

  desligar(a: string, b: string): void {
    this.ligacoes.get(a)?.delete(b);
    this.ligacoes.get(b)?.delete(a);
    this.nos.get(a)?.avisarVizinho(b, false);
    this.nos.get(b)?.avisarVizinho(a, false);
  }

  /** Liga os nós em fila: a - b - c - d... */
  emLinha(...nomes: string[]): void {
    for (let i = 0; i + 1 < nomes.length; i++) this.ligar(nomes[i]!, nomes[i + 1]!);
  }

  vizinhosDe(nome: string): string[] {
    return [...(this.ligacoes.get(nome) ?? [])];
  }

  transmitir(de: string, dados: Uint8Array, para?: string): void {
    const alvos = para ? [para] : this.vizinhosDe(de);
    const aleatorio = this.opcoes.aleatorio ?? Math.random;
    for (const alvo of alvos) {
      if (!this.ligacoes.get(de)?.has(alvo)) continue;
      if ((this.opcoes.perda ?? 0) > 0 && aleatorio() < this.opcoes.perda!) continue;
      const destino = this.nos.get(alvo);
      if (!destino) continue;
      this.transmissoes.push({ de, para: alvo, bytes: dados.length });
      const copia = dados.slice();
      setTimeout(() => destino.entregar(copia, de), this.opcoes.atrasoMs ?? 0);
    }
  }
}

export class CanalMemoria implements Canal {
  readonly nome: string;
  readonly capacidades: Capacidades;
  private onPacote?: AoReceberPacote;
  private onVizinho?: AoMudarVizinho;
  private ligado = false;

  constructor(
    private readonly meio: MeioSimulado,
    readonly no: string,
    capacidades: Partial<Capacidades> = {},
    readonly id = 'memoria',
    private readonly avisaVizinhos = true,
  ) {
    this.nome = `Simulado (${no})`;
    this.capacidades = {
      bytesPorSegundo: 100_000,
      aoVivo: true,
      bidirecional: true,
      alcanceMetros: 30,
      mtu: 512,
      custo: 2,
      ...capacidades,
    };
  }

  async disponivel(): Promise<boolean> {
    return true;
  }

  async iniciar(onPacote: AoReceberPacote, onVizinho: AoMudarVizinho): Promise<void> {
    this.onPacote = onPacote;
    this.onVizinho = onVizinho;
    this.ligado = true;
    if (!this.avisaVizinhos) return;
    for (const v of this.meio.vizinhosDe(this.no)) onVizinho({ idLocal: v, presente: true, rssi: -60 });
  }

  async anunciar(presenca: Uint8Array): Promise<void> {
    if (this.ligado) this.meio.transmitir(this.no, presenca);
  }

  async enviar(pacote: Uint8Array, destino?: string): Promise<void> {
    if (!this.ligado) throw new Error('canal parado');
    if (pacote.length > this.capacidades.mtu) throw new Error(`pacote de ${pacote.length} bytes excede a MTU`);
    this.meio.transmitir(this.no, pacote, destino);
  }

  async parar(): Promise<void> {
    this.ligado = false;
  }

  /** Chamado pelo meio. */
  entregar(dados: Uint8Array, de: string): void {
    if (this.ligado) this.onPacote?.(dados, de);
  }

  avisarVizinho(outro: string, presente: boolean): void {
    if (this.ligado && this.avisaVizinhos) this.onVizinho?.({ idLocal: outro, presente, rssi: presente ? -60 : undefined });
  }
}
