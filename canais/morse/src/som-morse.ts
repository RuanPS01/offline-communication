/**
 * Canal de som Morse: o fallback mais simples. Um tom de 800 Hz liga e
 * desliga no ritmo do código; do outro lado, um filtro de Goertzel mede a
 * energia nessa frequência e o mesmo decodificador da luz remonta o texto.
 * Também decodifica Morse vindo de qualquer apito ou rádio comum.
 */

import { type AoMudarVizinho, type AoReceberPacote, type Canal, type Capacidades, deUtf8, utf8 } from '@plataforma/nucleo';
import { paraSegmentos, type Segmento } from './codigo.ts';
import { ProcessadorMorse } from './processador.ts';
import { MedidorDeTom } from './sinal.ts';

export interface EstadoSomMorse {
  transmitindo: boolean;
  parcial: string;
  nivel: number;
}

/** Energia em escala de 0 a 1 (de -80 dB a 0 dB). */
export function energiaNormalizada(amplitude: number): number {
  return Math.max(0, Math.min(1, (20 * Math.log10(amplitude + 1e-6) + 80) / 80));
}

/** Navegadores só liberam o áudio depois de um gesto do usuário. */
async function retomarAudio(ctx: AudioContext): Promise<void> {
  await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 1500))]);
  if (ctx.state !== 'running') {
    await ctx.close().catch(() => undefined);
    throw new Error('o navegador bloqueou o áudio: toque em "Ligar" para liberar');
  }
}

export class CanalSomMorse implements Canal {
  readonly id = 'som-morse';
  readonly nome = 'Som Morse (tom)';
  readonly capacidades: Capacidades = {
    bytesPorSegundo: 2,
    aoVivo: false,
    bidirecional: true,
    alcanceMetros: 30,
    mtu: 120,
    custo: 8,
    somenteTexto: true,
  };
  private contexto?: AudioContext;
  private fluxo?: MediaStream;
  private processadorAudio?: ScriptProcessorNode;
  private processador?: ProcessadorMorse;
  private relogio?: ReturnType<typeof setInterval>;
  private fila: string[] = [];
  private transmitindo = false;
  private estado: EstadoSomMorse = { transmitindo: false, parcial: '', nivel: 0 };
  private observadores = new Set<(e: EstadoSomMorse) => void>();

  constructor(
    public unidadeMs = 70,
    public frequencia = 800,
  ) {}

  async disponivel(): Promise<boolean> {
    return typeof AudioContext !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  observar(fn: (e: EstadoSomMorse) => void): () => void {
    this.observadores.add(fn);
    fn(this.estado);
    return () => this.observadores.delete(fn);
  }

  private mudar(p: Partial<EstadoSomMorse>): void {
    this.estado = { ...this.estado, ...p };
    for (const fn of this.observadores) fn(this.estado);
  }

  async iniciar(onPacote: AoReceberPacote, _onVizinho: AoMudarVizinho): Promise<void> {
    this.contexto = new AudioContext();
    await retomarAudio(this.contexto);
    this.processador = new ProcessadorMorse(
      this.unidadeMs,
      (texto) => onPacote(utf8(texto), 'microfone'),
      (parcial) => this.mudar({ parcial }),
      0.25,
    );
    this.fluxo = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const fonte = this.contexto.createMediaStreamSource(this.fluxo);
    this.processadorAudio = this.contexto.createScriptProcessor(512, 1, 1);
    const medidor = new MedidorDeTom(this.frequencia, this.contexto.sampleRate);
    this.processadorAudio.onaudioprocess = (ev) => {
      if (this.transmitindo) return;
      const nivel = energiaNormalizada(medidor.medir(ev.inputBuffer.getChannelData(0)));
      this.processador!.alimentar(ev.playbackTime * 1000, nivel);
      this.estado.nivel = nivel;
    };
    const mudo = this.contexto.createGain();
    mudo.gain.value = 0;
    fonte.connect(this.processadorAudio);
    this.processadorAudio.connect(mudo);
    mudo.connect(this.contexto.destination);
    this.relogio = setInterval(() => {
      if (this.contexto) this.processador?.tique(this.contexto.currentTime * 1000);
      this.mudar({});
    }, 250);
  }

  async anunciar(): Promise<void> {}

  async enviar(dados: Uint8Array): Promise<void> {
    if (!this.contexto) throw new Error('canal parado');
    this.fila.push(deUtf8(dados));
    if (!this.transmitindo) void this.drenar();
  }

  private async drenar(): Promise<void> {
    this.transmitindo = true;
    this.mudar({ transmitindo: true });
    try {
      while (this.fila.length && this.contexto) {
        await this.tocar(paraSegmentos(this.fila.shift()!));
      }
    } finally {
      this.transmitindo = false;
      this.mudar({ transmitindo: false });
    }
  }

  /** Agenda o tom com envelope suave (5 ms) para não estalar. */
  private tocar(segmentos: Segmento[]): Promise<void> {
    const ctx = this.contexto!;
    const osc = ctx.createOscillator();
    const ganho = ctx.createGain();
    osc.frequency.value = this.frequencia;
    ganho.gain.value = 0;
    osc.connect(ganho);
    ganho.connect(ctx.destination);
    const u = this.unidadeMs / 1000;
    let t = ctx.currentTime + 0.1;
    for (const s of segmentos) {
      const fim = t + s.unidades * u;
      if (s.ligado) {
        ganho.gain.setValueAtTime(0, t);
        ganho.gain.linearRampToValueAtTime(0.6, t + 0.005);
        ganho.gain.setValueAtTime(0.6, fim - 0.005);
        ganho.gain.linearRampToValueAtTime(0, fim);
      }
      t = fim;
    }
    osc.start();
    osc.stop(t + 0.05);
    return new Promise((r) => {
      osc.onended = () => {
        osc.disconnect();
        ganho.disconnect();
        // Espera o eco do ambiente antes de voltar a ouvir.
        setTimeout(r, 300);
      };
    });
  }

  async parar(): Promise<void> {
    this.fila = [];
    if (this.relogio) clearInterval(this.relogio);
    if (this.processadorAudio) this.processadorAudio.onaudioprocess = null;
    for (const t of this.fluxo?.getTracks() ?? []) t.stop();
    await this.contexto?.close().catch(() => undefined);
    this.contexto = undefined;
  }
}
