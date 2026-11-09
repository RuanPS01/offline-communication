/**
 * Codecs de voz. Opus a ~12 kbps quando o aparelho tem WebCodecs (Chrome,
 * WebView do Android, Safari recente); IMA ADPCM em qualquer outro lugar.
 * Codec2 (0,7 a 3,2 kbps) fica reservado no protocolo (CODEC_CODEC2) para
 * quando houver o build WASM.
 */

import { CODEC_ADPCM, CODEC_OPUS } from '@plataforma/nucleo';
import { codificarAdpcm, decodificarAdpcm } from './adpcm.ts';

export const DURACAO_QUADRO_MS = 60;

export interface CodificadorVoz {
  readonly codec: number;
  readonly taxaAmostragem: number;
  readonly amostrasPorQuadro: number;
  /** Recebe exatamente `amostrasPorQuadro` amostras. */
  empurrar(pcm: Float32Array): void;
  /** Espera o que ainda está no codificador sair. */
  esvaziar(): Promise<void>;
  fechar(): void;
}

export interface DecodificadorVoz {
  readonly codec: number;
  readonly taxaAmostragem: number;
  decodificar(dados: Uint8Array): Promise<Float32Array>;
  fechar(): void;
}

export class CodificadorAdpcm implements CodificadorVoz {
  readonly codec = CODEC_ADPCM;
  readonly taxaAmostragem = 8000;
  readonly amostrasPorQuadro = (8000 * DURACAO_QUADRO_MS) / 1000;

  constructor(private readonly aoQuadro: (dados: Uint8Array) => void) {}

  empurrar(pcm: Float32Array): void {
    this.aoQuadro(codificarAdpcm(pcm));
  }

  async esvaziar(): Promise<void> {}

  fechar(): void {}
}

export class DecodificadorAdpcm implements DecodificadorVoz {
  readonly codec = CODEC_ADPCM;
  readonly taxaAmostragem = 8000;

  async decodificar(dados: Uint8Array): Promise<Float32Array> {
    return decodificarAdpcm(dados);
  }

  fechar(): void {}
}

const CONFIG_OPUS = {
  codec: 'opus',
  sampleRate: 48000,
  numberOfChannels: 1,
  bitrate: 12000,
  opus: { frameDuration: DURACAO_QUADRO_MS * 1000, format: 'opus' },
} as AudioEncoderConfig;

let opusDisponivel: Promise<boolean> | undefined;

/** O aparelho codifica e decodifica Opus pelo WebCodecs? */
export function suportaOpus(): Promise<boolean> {
  opusDisponivel ??= (async () => {
    try {
      if (typeof AudioEncoder === 'undefined' || typeof AudioDecoder === 'undefined') return false;
      const [c, d] = await Promise.all([
        AudioEncoder.isConfigSupported(CONFIG_OPUS),
        AudioDecoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1 }),
      ]);
      return !!c.supported && !!d.supported;
    } catch {
      return false;
    }
  })();
  return opusDisponivel;
}

export class CodificadorOpus implements CodificadorVoz {
  readonly codec = CODEC_OPUS;
  readonly taxaAmostragem = 48000;
  readonly amostrasPorQuadro = (48000 * DURACAO_QUADRO_MS) / 1000;
  private readonly codificador: AudioEncoder;
  private carimbo = 0;

  constructor(aoQuadro: (dados: Uint8Array) => void, aoErro: (e: Error) => void = console.error) {
    this.codificador = new AudioEncoder({
      output: (pedaco) => {
        const dados = new Uint8Array(pedaco.byteLength);
        pedaco.copyTo(dados);
        aoQuadro(dados);
      },
      error: (e) => aoErro(e instanceof Error ? e : new Error(String(e))),
    });
    this.codificador.configure(CONFIG_OPUS);
  }

  empurrar(pcm: Float32Array): void {
    const dados = new AudioData({
      format: 'f32',
      sampleRate: this.taxaAmostragem,
      numberOfFrames: pcm.length,
      numberOfChannels: 1,
      timestamp: this.carimbo,
      data: new Float32Array(pcm),
    });
    this.carimbo += (pcm.length / this.taxaAmostragem) * 1_000_000;
    this.codificador.encode(dados);
    dados.close();
  }

  async esvaziar(): Promise<void> {
    await this.codificador.flush();
  }

  fechar(): void {
    if (this.codificador.state !== 'closed') this.codificador.close();
  }
}

export class DecodificadorOpus implements DecodificadorVoz {
  readonly codec = CODEC_OPUS;
  readonly taxaAmostragem = 48000;
  private readonly decodificador: AudioDecoder;
  private pendentes: { resolver: (v: Float32Array) => void; rejeitar: (e: Error) => void }[] = [];
  private carimbo = 0;

  constructor() {
    this.decodificador = new AudioDecoder({
      output: (audio) => {
        const pcm = new Float32Array(audio.numberOfFrames);
        audio.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' });
        audio.close();
        this.pendentes.shift()?.resolver(pcm);
      },
      error: (e) => {
        const erro = e instanceof Error ? e : new Error(String(e));
        for (const p of this.pendentes.splice(0)) p.rejeitar(erro);
      },
    });
    this.decodificador.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1 });
  }

  decodificar(dados: Uint8Array): Promise<Float32Array> {
    return new Promise((resolver, rejeitar) => {
      this.pendentes.push({ resolver, rejeitar });
      this.decodificador.decode(
        new EncodedAudioChunk({ type: 'key', timestamp: this.carimbo, data: dados }),
      );
      this.carimbo += DURACAO_QUADRO_MS * 1000;
    });
  }

  fechar(): void {
    if (this.decodificador.state !== 'closed') this.decodificador.close();
  }
}

export function criarDecodificador(codec: number): DecodificadorVoz {
  if (codec === CODEC_OPUS) return new DecodificadorOpus();
  if (codec === CODEC_ADPCM) return new DecodificadorAdpcm();
  throw new Error(`codec ${codec} não suportado neste aparelho`);
}

export function criarCodificador(codec: number, aoQuadro: (dados: Uint8Array) => void): CodificadorVoz {
  if (codec === CODEC_OPUS) return new CodificadorOpus(aoQuadro);
  return new CodificadorAdpcm(aoQuadro);
}
