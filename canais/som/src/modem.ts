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

export class ModemSom {
  private constructor(
    private readonly m: ModuloGgwave,
    private readonly instancia: number,
    readonly taxaAmostragem: number,
  ) {}

  static async criar(taxaAmostragem: number): Promise<ModemSom> {
    const m = await carregarGgwave();
    const p = m.getDefaultParameters();
    p.sampleRateInp = taxaAmostragem;
    p.sampleRateOut = taxaAmostragem;
    p.sampleFormatInp = m.SampleFormat.GGWAVE_SAMPLE_FORMAT_F32;
    p.sampleFormatOut = m.SampleFormat.GGWAVE_SAMPLE_FORMAT_F32;
    return new ModemSom(m, m.init(p), taxaAmostragem);
  }

  /** Gera a forma de onda (Float32, mono) que transmite os bytes. */
  modular(dados: Uint8Array, protocolo: ProtocoloSom, velocidade: VelocidadeSom, volume = 25): Float32Array {
    if (dados.length > MTU_SOM) throw new Error(`som leva no máximo ${MTU_SOM} bytes por vez`);
    const onda = this.m.encode(this.instancia, dados, idProtocolo(this.m, protocolo, velocidade), volume);
    return new Float32Array(new Int8Array(onda).buffer);
  }

  /** Alimenta amostras captadas; devolve os bytes quando uma transmissão termina. */
  demodular(amostras: Float32Array): Uint8Array | undefined {
    const copia = new Float32Array(amostras);
    const r = this.m.decode(this.instancia, new Int8Array(copia.buffer));
    if (!r || r.length === 0) return undefined;
    return Uint8Array.from(r, (v) => v & 0xff);
  }

  liberar(): void {
    this.m.free(this.instancia);
  }
}
