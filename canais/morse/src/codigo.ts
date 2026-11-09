/**
 * Código Morse internacional (ITU) e sua temporização. Acentos e cedilha
 * viram a letra base, para que qualquer pessoa consiga ler e piscar.
 */

export const TABELA_MORSE: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
  K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
  U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-', '5': '.....', '6': '-....',
  '7': '--...', '8': '---..', '9': '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--', '/': '-..-.', '(': '-.--.',
  ')': '-.--.-', '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-',
  '_': '..--.-', '"': '.-..-.', '$': '...-..-', '@': '.--.-.',
};

const REVERSA = new Map(Object.entries(TABELA_MORSE).map(([k, v]) => [v, k]));

/** Maiúsculas, sem acentos, só com o que o Morse sabe representar. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .split('')
    .filter((c) => c === ' ' || c in TABELA_MORSE)
    .join('')
    .trim();
}

/** "SOS" vira "... --- ...", com " / " entre palavras. */
export function paraMorse(texto: string): string {
  return normalizar(texto)
    .split(' ')
    .map((palavra) => [...palavra].map((c) => TABELA_MORSE[c]).join(' '))
    .join(' / ');
}

export function deMorse(codigo: string): string {
  return codigo
    .trim()
    .split(/\s*\/\s*/)
    .map((palavra) =>
      palavra
        .split(/\s+/)
        .map((s) => REVERSA.get(s) ?? (s ? '?' : ''))
        .join(''),
    )
    .join(' ');
}

export interface Segmento {
  ligado: boolean;
  /** Em unidades de tempo (1 = ponto). */
  unidades: number;
}

/**
 * Temporização padrão: ponto = 1, traço = 3, intervalo entre sinais = 1,
 * entre letras = 3, entre palavras = 7.
 */
export function paraSegmentos(texto: string): Segmento[] {
  const s: Segmento[] = [];
  const palavras = normalizar(texto).split(' ').filter(Boolean);
  palavras.forEach((palavra, ip) => {
    if (ip > 0) s.push({ ligado: false, unidades: 7 });
    [...palavra].forEach((letra, il) => {
      if (il > 0) s.push({ ligado: false, unidades: 3 });
      [...TABELA_MORSE[letra]!].forEach((simbolo, is) => {
        if (is > 0) s.push({ ligado: false, unidades: 1 });
        s.push({ ligado: true, unidades: simbolo === '.' ? 1 : 3 });
      });
    });
  });
  return s;
}

/** Duração total em unidades. */
export function duracaoEmUnidades(segmentos: Segmento[]): number {
  return segmentos.reduce((t, s) => t + s.unidades, 0);
}

/**
 * Decodificador por tempo, adaptativo: estima a duração do ponto a partir do
 * que vai recebendo, porque gente piscando lanterna à mão não tem ritmo
 * exato. Recebe a duração de cada trecho ligado ou desligado.
 */
export class DecodificadorMorse {
  private unidade: number;
  private simbolos = '';
  private texto = '';
  private pistaInicial = true;

  constructor(
    unidadeInicialMs: number,
    private readonly aoMudar?: (textoParcial: string) => void,
  ) {
    this.unidade = unidadeInicialMs;
  }

  get unidadeMs(): number {
    return this.unidade;
  }

  get parcial(): string {
    return (this.texto + (this.simbolos ? (deMorse(this.simbolos) || '') : '')).trimStart();
  }

  /** Trecho com a luz/tom ligado. */
  ligado(ms: number): void {
    if (this.pistaInicial) {
      // O primeiro sinal pode ser ponto ou traço: só ajusta se for muito diferente do esperado.
      if (ms < this.unidade * 0.5 || ms > this.unidade * 4.5) this.unidade = ms;
      this.pistaInicial = false;
    }
    const ponto = ms < this.unidade * 2;
    this.simbolos += ponto ? '.' : '-';
    const estimativa = ponto ? ms : ms / 3;
    this.unidade = this.unidade * 0.75 + estimativa * 0.25;
    if (this.simbolos.length > 8) this.simbolos = this.simbolos.slice(-8);
  }

  /** Trecho com a luz/tom desligado. */
  desligado(ms: number): void {
    if (ms < this.unidade * 2) return;
    this.fecharLetra();
    if (ms >= this.unidade * 5 && this.texto && !this.texto.endsWith(' ')) this.texto += ' ';
    this.aoMudar?.(this.parcial);
  }

  private fecharLetra(): void {
    if (!this.simbolos) return;
    this.texto += deMorse(this.simbolos) || '?';
    this.simbolos = '';
  }

  /** Silêncio longo: fecha o que estiver pendente e devolve o texto completo. */
  finalizar(): string {
    this.fecharLetra();
    const t = this.texto.trim();
    this.texto = '';
    this.pistaInicial = true;
    this.aoMudar?.('');
    return t;
  }

  get pendente(): boolean {
    return !!this.simbolos || !!this.texto.trim();
  }
}
