/**
 * Apertar para falar, meio-duplex como rádio de verdade. Ao apertar, envia
 * INÍCIO_FALA; os vizinhos veem "Fulano falando" e têm o botão travado até o
 * FIM_FALA. Se dois apertam juntos, fica quem tem o menor id; o outro cede.
 */

export type EstadoPtt =
  | { tipo: 'livre' }
  | { tipo: 'eu'; sessao: number; desde: number }
  | { tipo: 'outro'; quem: string; apelido?: string; sessao: number; ultimaAtividade: number };

/** Sem FIM_FALA nem quadros por este tempo, o canal é liberado. */
export const SILENCIO_LIBERA_MS = 3000;

export class ControlePtt {
  private _estado: EstadoPtt = { tipo: 'livre' };
  private ouvintes = new Set<(e: EstadoPtt) => void>();

  constructor(
    private readonly meuId: string,
    private readonly agora: () => number = Date.now,
  ) {}

  get estado(): EstadoPtt {
    return this._estado;
  }

  aoMudar(fn: (e: EstadoPtt) => void): () => void {
    this.ouvintes.add(fn);
    return () => this.ouvintes.delete(fn);
  }

  private mudar(e: EstadoPtt): void {
    this._estado = e;
    for (const fn of this.ouvintes) fn(e);
  }

  podeFalar(): boolean {
    this.verificarSilencio();
    return this._estado.tipo === 'livre';
  }

  euComecei(sessao: number): void {
    this.mudar({ tipo: 'eu', sessao, desde: this.agora() });
  }

  euTerminei(): void {
    if (this._estado.tipo === 'eu') this.mudar({ tipo: 'livre' });
  }

  /**
   * Alguém começou a falar. Devolve 'ceder' quando eu estava falando e perdi
   * a disputa (o outro tem id menor): quem chamou deve parar de transmitir.
   */
  outroComecou(quem: string, sessao: number, apelido?: string): 'ok' | 'ceder' | 'ignorado' {
    const e = this._estado;
    if (e.tipo === 'eu') {
      if (quem < this.meuId) {
        this.mudar({ tipo: 'outro', quem, apelido, sessao, ultimaAtividade: this.agora() });
        return 'ceder';
      }
      return 'ignorado';
    }
    if (e.tipo === 'outro' && e.quem !== quem && e.quem < quem) return 'ignorado';
    this.mudar({ tipo: 'outro', quem, apelido, sessao, ultimaAtividade: this.agora() });
    return 'ok';
  }

  atividade(quem: string, sessao: number): void {
    const e = this._estado;
    if (e.tipo === 'outro' && e.quem === quem && e.sessao === sessao) e.ultimaAtividade = this.agora();
    else if (e.tipo === 'livre') this.outroComecou(quem, sessao);
  }

  outroTerminou(quem: string, sessao: number): void {
    const e = this._estado;
    if (e.tipo === 'outro' && e.quem === quem && e.sessao === sessao) this.mudar({ tipo: 'livre' });
  }

  /** Libera o canal se o FIM_FALA se perdeu. */
  verificarSilencio(): void {
    const e = this._estado;
    if (e.tipo === 'outro' && this.agora() - e.ultimaAtividade > SILENCIO_LIBERA_MS) this.mudar({ tipo: 'livre' });
  }
}
