/**
 * Buffer de tremulação (jitter buffer). Segura de 150 a 250 ms de áudio no
 * receptor para absorver a variação de chegada dos quadros, reordena pelo
 * número de sequência e troca quadros perdidos por silêncio.
 */

function diferencaSeq(a: number, b: number): number {
  // Diferença com volta em 65536.
  return ((a - b + 0x8000) & 0xffff) - 0x8000;
}

export class BufferDeTremulacao<T> {
  private quadros = new Map<number, T>();
  private proximo: number | undefined;
  private iniciado = false;
  private primeiraChegada = 0;

  constructor(
    private readonly duracaoQuadroMs = 60,
    private readonly atrasoMs = 200,
    private readonly agora: () => number = () => performance.now(),
    private readonly maxQuadros = 64,
  ) {}

  inserir(seq: number, quadro: T): void {
    if (this.proximo === undefined) {
      this.proximo = seq;
      this.primeiraChegada = this.agora();
    }
    // Atrasado demais: já passou da vez.
    if (diferencaSeq(seq, this.proximo) < 0) return;
    this.quadros.set(seq, quadro);
    if (this.quadros.size > this.maxQuadros) {
      // Acumulou demais (receptor travou): pula para o mais antigo disponível.
      this.proximo = this.maisAntigo();
    }
  }

  private maisAntigo(): number | undefined {
    let menor: number | undefined;
    for (const s of this.quadros.keys()) {
      if (menor === undefined || diferencaSeq(s, menor) < 0) menor = s;
    }
    return menor;
  }

  /**
   * Próximo quadro a tocar. `null` = quadro perdido (tocar silêncio);
   * `undefined` = ainda não é hora ou não chegou nada.
   */
  retirar(): T | null | undefined {
    if (this.proximo === undefined) return undefined;
    if (!this.iniciado) {
      const acumulado = this.quadros.size * this.duracaoQuadroMs;
      if (acumulado < this.atrasoMs && this.agora() - this.primeiraChegada < this.atrasoMs) return undefined;
      this.iniciado = true;
    }
    const q = this.quadros.get(this.proximo);
    if (q !== undefined) {
      this.quadros.delete(this.proximo);
      this.proximo = (this.proximo + 1) & 0xffff;
      return q;
    }
    const temPosterior = [...this.quadros.keys()].some((s) => diferencaSeq(s, this.proximo!) > 0);
    if (temPosterior) {
      this.proximo = (this.proximo + 1) & 0xffff;
      return null;
    }
    return undefined;
  }

  get vazio(): boolean {
    return this.quadros.size === 0;
  }
}
