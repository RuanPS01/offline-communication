import { DecodificadorMorse } from './codigo.ts';
import { DetectorDeNivel } from './sinal.ts';

/**
 * Junta detector de nível e decodificador: recebe medidas ao longo do tempo
 * e entrega o texto quando a transmissão termina (silêncio longo).
 */
export class ProcessadorMorse {
  readonly decodificador: DecodificadorMorse;
  private readonly detector: DetectorDeNivel;
  private ultimoTempo = 0;

  constructor(
    unidadeInicialMs: number,
    private readonly aoTexto: (texto: string) => void,
    aoParcial?: (parcial: string) => void,
    contrasteMinimo?: number,
  ) {
    this.decodificador = new DecodificadorMorse(unidadeInicialMs, aoParcial);
    this.detector = new DetectorDeNivel((ligado, ms) => {
      if (ligado) {
        this.decodificador.ligado(ms);
        aoParcial?.(this.decodificador.parcial);
      } else {
        this.decodificador.desligado(ms);
      }
    }, contrasteMinimo, 0.35, unidadeInicialMs * 0.3);
  }

  alimentar(t: number, valor: number): void {
    this.ultimoTempo = t;
    this.detector.alimentar(t, valor);
    this.tique(t);
  }

  /** Fecha a mensagem depois de um silêncio de 10 unidades. */
  tique(t = this.ultimoTempo): void {
    if (this.detector.ligado || !this.decodificador.pendente) return;
    if (this.detector.tempoNoEstado(t) > this.decodificador.unidadeMs * 10) {
      const texto = this.decodificador.finalizar();
      if (texto) this.aoTexto(texto);
    }
  }

  get nivelLigado(): boolean {
    return this.detector.ligado;
  }
}

/** Executa os segmentos no tempo certo, sem acumular atraso. */
export async function executarSegmentos(
  segmentos: { ligado: boolean; unidades: number }[],
  unidadeMs: number,
  aplicar: (ligado: boolean) => Promise<void> | void,
  cancelado: () => boolean = () => false,
  aoProgresso?: (fracao: number) => void,
): Promise<void> {
  const total = segmentos.reduce((t, s) => t + s.unidades, 0);
  let feito = 0;
  const inicio = performance.now();
  try {
    for (const s of segmentos) {
      if (cancelado()) break;
      await aplicar(s.ligado);
      feito += s.unidades;
      aoProgresso?.(feito / total);
      const alvo = inicio + feito * unidadeMs;
      await new Promise((r) => setTimeout(r, Math.max(0, alvo - performance.now())));
    }
  } finally {
    await aplicar(false);
  }
}
