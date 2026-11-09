/** Reamostragem linear simples, suficiente para voz. */
export function reamostrar(entrada: Float32Array, de: number, para: number): Float32Array {
  if (de === para) return entrada;
  const razao = de / para;
  const n = Math.floor(entrada.length / razao);
  const saida = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i * razao;
    const a = Math.floor(pos);
    const b = Math.min(a + 1, entrada.length - 1);
    const f = pos - a;
    saida[i] = entrada[a]! * (1 - f) + entrada[b]! * f;
  }
  return saida;
}

/** Acumula amostras e entrega quadros de tamanho fixo. */
export class Quadrador {
  private resto = new Float32Array(0);

  constructor(
    private readonly tamanho: number,
    private readonly aoQuadro: (q: Float32Array) => void,
  ) {}

  empurrar(amostras: Float32Array): void {
    const junto = new Float32Array(this.resto.length + amostras.length);
    junto.set(this.resto);
    junto.set(amostras, this.resto.length);
    let pos = 0;
    while (junto.length - pos >= this.tamanho) {
      this.aoQuadro(junto.slice(pos, pos + this.tamanho));
      pos += this.tamanho;
    }
    this.resto = junto.slice(pos);
  }

  /** Completa o último quadro com silêncio. */
  esvaziar(): void {
    if (!this.resto.length) return;
    const q = new Float32Array(this.tamanho);
    q.set(this.resto);
    this.resto = new Float32Array(0);
    this.aoQuadro(q);
  }
}
