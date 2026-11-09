/** Processamento de sinal: detector de nível com limiar adaptativo e filtro de Goertzel. */

/**
 * Transforma uma sequência de medidas (brilho de um pedaço da imagem, ou
 * energia de um tom) em trechos ligado/desligado com duração. O limiar
 * acompanha o mínimo e o máximo recentes, com histerese contra tremulação.
 */
export class DetectorDeNivel {
  private alto = -Infinity;
  private baixo = Infinity;
  private estado = false;
  private ultimaTransicao: number | undefined;
  /** Mudança vista mas ainda não confirmada (filtro contra cintilação). */
  private candidata: number | undefined;

  constructor(
    private readonly aoTrecho: (ligado: boolean, duracaoMs: number) => void,
    /** Diferença mínima entre alto e baixo para considerar que há sinal. */
    private readonly contrasteMinimo = 0.08,
    /** Quanto o envelope esquece por segundo (0 a 1). */
    private readonly esquecimentoPorSegundo = 0.35,
    /** Uma mudança só vale se durar pelo menos isto. */
    private readonly duracaoMinimaMs = 0,
  ) {}

  private ultimoTempo?: number;

  alimentar(t: number, valor: number): void {
    const dt = this.ultimoTempo === undefined ? 0 : Math.max(0, (t - this.ultimoTempo) / 1000);
    this.ultimoTempo = t;
    const k = Math.min(1, this.esquecimentoPorSegundo * dt);
    if (!Number.isFinite(this.alto)) {
      this.alto = this.baixo = valor;
    }
    // Os envelopes andam só uma parte do caminho a cada medida: um pico ou
    // uma queda isolada de ruído não abre o limiar de uma vez.
    const ataque = 0.3;
    this.alto = valor > this.alto ? this.alto + (valor - this.alto) * ataque : this.alto - (this.alto - valor) * k;
    this.baixo = valor < this.baixo ? this.baixo + (valor - this.baixo) * ataque : this.baixo + (valor - this.baixo) * k;
    const amplitude = this.alto - this.baixo;
    if (amplitude < this.contrasteMinimo) return;
    const meio = (this.alto + this.baixo) / 2;
    const histerese = amplitude * 0.15;
    const novo = this.estado ? valor > meio - histerese : valor > meio + histerese;
    if (novo === this.estado) {
      this.candidata = undefined;
      return;
    }
    this.candidata ??= t;
    if (t - this.candidata < this.duracaoMinimaMs) return;
    const momento = this.candidata;
    this.candidata = undefined;
    if (this.ultimaTransicao !== undefined) this.aoTrecho(this.estado, momento - this.ultimaTransicao);
    this.estado = novo;
    this.ultimaTransicao = momento;
  }

  /** Há quanto tempo está no estado atual. */
  tempoNoEstado(t: number): number {
    return this.ultimaTransicao === undefined ? 0 : t - this.ultimaTransicao;
  }

  get ligado(): boolean {
    return this.estado;
  }
}

/** Energia de uma frequência num bloco de amostras (filtro de Goertzel). */
export function goertzel(amostras: Float32Array, frequencia: number, taxa: number): number {
  const k = Math.round((amostras.length * frequencia) / taxa);
  const w = (2 * Math.PI * k) / amostras.length;
  const coef = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (const x of amostras) {
    const s0 = x + coef * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const potencia = s1 * s1 + s2 * s2 - coef * s1 * s2;
  return Math.sqrt(Math.max(0, potencia)) / (amostras.length / 2);
}

/**
 * Mede a energia do tom em janelas de dois blocos com 50% de sobreposição:
 * menos variação no ruído de fundo, sem perder resolução no tempo.
 */
export class MedidorDeTom {
  private anterior?: Float32Array;

  constructor(
    private readonly frequencia: number,
    private readonly taxa: number,
  ) {}

  medir(bloco: Float32Array): number {
    const janela = new Float32Array((this.anterior?.length ?? 0) + bloco.length);
    if (this.anterior) janela.set(this.anterior);
    janela.set(bloco, this.anterior?.length ?? 0);
    this.anterior = new Float32Array(bloco);
    return goertzel(janela, this.frequencia, this.taxa);
  }
}
