/**
 * Captura do microfone em quadros de tamanho fixo, já na taxa do codec.
 * Usa ScriptProcessorNode porque funciona até em páginas sem HTTPS (o
 * AudioWorklet exige contexto seguro).
 */

import { Quadrador, reamostrar } from './reamostragem.ts';

export interface OpcoesCaptura {
  taxaAmostragem: number;
  amostrasPorQuadro: number;
  aoQuadro: (pcm: Float32Array) => void;
  /** Recebe o nível (0 a 1) para o medidor da interface. */
  aoNivel?: (nivel: number) => void;
}

export class CapturaMicrofone {
  private contexto?: AudioContext;
  private fluxo?: MediaStream;
  private processador?: ScriptProcessorNode;
  private fonte?: MediaStreamAudioSourceNode;
  private quadrador?: Quadrador;

  static disponivel(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== 'undefined';
  }

  async iniciar(o: OpcoesCaptura): Promise<void> {
    this.fluxo = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.contexto = new AudioContext();
    await this.contexto.resume();
    const taxaEntrada = this.contexto.sampleRate;
    this.quadrador = new Quadrador(o.amostrasPorQuadro, o.aoQuadro);
    this.fonte = this.contexto.createMediaStreamSource(this.fluxo);
    this.processador = this.contexto.createScriptProcessor(2048, 1, 1);
    this.processador.onaudioprocess = (ev) => {
      const entrada = ev.inputBuffer.getChannelData(0);
      if (o.aoNivel) {
        let pico = 0;
        for (const v of entrada) pico = Math.max(pico, Math.abs(v));
        o.aoNivel(pico);
      }
      this.quadrador!.empurrar(reamostrar(new Float32Array(entrada), taxaEntrada, o.taxaAmostragem));
    };
    const mudo = this.contexto.createGain();
    mudo.gain.value = 0;
    this.fonte.connect(this.processador);
    this.processador.connect(mudo);
    mudo.connect(this.contexto.destination);
  }

  async parar(): Promise<void> {
    this.quadrador?.esvaziar();
    if (this.processador) this.processador.onaudioprocess = null;
    this.fonte?.disconnect();
    this.processador?.disconnect();
    for (const t of this.fluxo?.getTracks() ?? []) t.stop();
    await this.contexto?.close().catch(() => undefined);
    this.contexto = undefined;
    this.fluxo = undefined;
  }
}
