/// <reference path="./ggwave.d.ts" />
/**
 * Modem de dados por som em cima do ggwave (FSK robusta com Reed-Solomon).
 * Isolado do Web Audio para poder ser testado em Node.
 */

import fabricaGgwave, { type ModuloGgwave } from 'ggwave';

export type ProtocoloSom = 'audivel' | 'ultrassom';
export type VelocidadeSom = 'normal' | 'rapido' | 'maisRapido';

/** Limite de carga de uma transmissão do ggwave. */
export const MTU_SOM = 140;

let moduloCarregado: Promise<ModuloGgwave> | undefined;

export function carregarGgwave(): Promise<ModuloGgwave> {
  moduloCarregado ??= fabricaGgwave({ print: () => undefined, printErr: () => undefined }).then((m) => {
    m.disableLog();
    return m;
  });
  return moduloCarregado;
}

function idProtocolo(m: ModuloGgwave, protocolo: ProtocoloSom, velocidade: VelocidadeSom): unknown {
  const base = protocolo === 'ultrassom' ? 'ULTRASOUND' : 'AUDIBLE';
  const vel = velocidade === 'normal' ? 'NORMAL' : velocidade === 'rapido' ? 'FAST' : 'FASTEST';
  return m.ProtocolId[`GGWAVE_PROTOCOL_${base}_${vel}`];
}

/** Taxa em que o ggwave opera. Entrada e saída são convertidas para ela. */
export const TAXA_GGWAVE = 48000;
const AMOSTRAS_POR_QUADRO = 1024;

/**
 * Reamostragem linear contínua: guarda o estado entre blocos, para que o
 * fluxo convertido não tenha emendas (o ggwave é sensível a isso).
 */
export class ReamostradorContinuo {
  private t = 0;
  private anterior = 0;

  constructor(
    private readonly de: number,
    private readonly para: number,
  ) {}

  processar(entrada: Float32Array): Float32Array {
    if (this.de === this.para) return entrada;
    const passo = this.de / this.para;
    const saida: number[] = [];
    // Índice -1 é a última amostra do bloco anterior.
    while (Math.floor(this.t) + 1 <= entrada.length - 1) {
      const i0 = Math.floor(this.t);
      const f = this.t - i0;
      const a = i0 < 0 ? this.anterior : entrada[i0]!;
      const b = entrada[i0 + 1]!;
      saida.push(a + (b - a) * f);
      this.t += passo;
    }
    this.t -= entrada.length;
    if (entrada.length) this.anterior = entrada[entrada.length - 1]!;
    return Float32Array.from(saida);
  }
}

export class ModemSom {
  private acumulado = new Float32Array(0);
  private readonly reamostrador: ReamostradorContinuo;

  private constructor(
    private readonly m: ModuloGgwave,
    private readonly instancia: number,
    /** Taxa do microfone (a do AudioContext). */
    readonly taxaAmostragem: number,
  ) {
    this.reamostrador = new ReamostradorContinuo(taxaAmostragem, TAXA_GGWAVE);
  }

  static async criar(taxaAmostragem: number): Promise<ModemSom> {
    const m = await carregarGgwave();
    const p = m.getDefaultParameters();
    // O ggwave só decodifica bem recebendo quadros inteiros de 1024 amostras na
    // própria taxa. Por isso ele roda sempre a 48 kHz e a conversão é feita aqui.
    p.sampleRateInp = TAXA_GGWAVE;
    p.sampleRateOut = TAXA_GGWAVE;
    p.sampleFormatInp = m.SampleFormat.GGWAVE_SAMPLE_FORMAT_F32;
    p.sampleFormatOut = m.SampleFormat.GGWAVE_SAMPLE_FORMAT_F32;
    return new ModemSom(m, m.init(p), taxaAmostragem);
  }

  /** Gera a forma de onda (Float32, mono, a 48 kHz) que transmite os bytes. */
  modular(dados: Uint8Array, protocolo: ProtocoloSom, velocidade: VelocidadeSom, volume = 25): Float32Array {
    if (dados.length > MTU_SOM) throw new Error(`som leva no máximo ${MTU_SOM} bytes por vez`);
    const onda = this.m.encode(this.instancia, dados, idProtocolo(this.m, protocolo, velocidade), volume);
    return new Float32Array(new Int8Array(onda).buffer);
  }

  /** Alimenta amostras captadas (na taxa do microfone); devolve os bytes quando uma transmissão termina. */
  demodular(amostras: Float32Array): Uint8Array | undefined {
    const novas = this.reamostrador.processar(amostras);
    const junto = new Float32Array(this.acumulado.length + novas.length);
    junto.set(this.acumulado);
    junto.set(novas, this.acumulado.length);
    let pos = 0;
    let resultado: Uint8Array | undefined;
    while (junto.length - pos >= AMOSTRAS_POR_QUADRO) {
      const quadro = junto.slice(pos, pos + AMOSTRAS_POR_QUADRO);
      pos += AMOSTRAS_POR_QUADRO;
      const r = this.m.decode(this.instancia, new Int8Array(quadro.buffer));
      if (r && r.length > 0 && !resultado) resultado = Uint8Array.from(r, (v) => v & 0xff);
    }
    this.acumulado = junto.slice(pos);
    return resultado;
  }

  liberar(): void {
    this.m.free(this.instancia);
  }
}
