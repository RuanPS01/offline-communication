/**
 * Canal de som: texto e presença por áudio, inclusive na web (sem instalar
 * nada). Lento (dezenas de bytes por segundo) e com alcance de poucos
 * metros, mas funciona entre qualquer par de celulares com microfone e
 * alto-falante, de sistemas diferentes.
 */

import type { AoMudarVizinho, AoReceberPacote, Canal, Capacidades } from '@plataforma/nucleo';
import { ModemSom, MTU_SOM, type ProtocoloSom, TAXA_GGWAVE, type VelocidadeSom } from './modem.ts';

export * from './modem.ts';

export interface OpcoesSom {
  protocolo: ProtocoloSom;
  velocidade: VelocidadeSom;
  /** 1 a 100. */
  volume: number;
  /** Anunciar a presença por som de tempos em tempos (faz barulho). */
  anunciarPresenca: boolean;
  intervaloPresencaMs: number;
}

export const OPCOES_SOM_PADRAO: OpcoesSom = {
  protocolo: 'audivel',
  velocidade: 'rapido',
  volume: 30,
  anunciarPresenca: false,
  intervaloPresencaMs: 120_000,
};

/** Navegadores só liberam o áudio depois de um gesto do usuário. */
async function retomarAudio(ctx: AudioContext): Promise<void> {
  await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 1500))]);
  if (ctx.state !== 'running') {
    await ctx.close().catch(() => undefined);
    throw new Error('o navegador bloqueou o áudio: toque em "Ligar" para liberar');
  }
}

export class CanalSom implements Canal {
  readonly id = 'som';
  readonly nome = 'Som (dados por áudio)';
  readonly capacidades: Capacidades = {
    bytesPorSegundo: 20,
    aoVivo: false,
    bidirecional: true,
    alcanceMetros: 4,
    mtu: MTU_SOM,
    custo: 6,
  };
  opcoes: OpcoesSom;
  private contexto?: AudioContext;
  private fluxo?: MediaStream;
  private processador?: ScriptProcessorNode;
  private modem?: ModemSom;
  private fila: Uint8Array[] = [];
  private _transmitindo = false;
  private ultimaPresenca = 0;
  private aoMudarEstado = new Set<(transmitindo: boolean, naFila: number) => void>();

  constructor(opcoes: Partial<OpcoesSom> = {}) {
    this.opcoes = { ...OPCOES_SOM_PADRAO, ...opcoes };
  }

  async disponivel(): Promise<boolean> {
    return (
      typeof AudioContext !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia
    );
  }

  get transmitindo(): boolean {
    return this._transmitindo;
  }

  observarEstado(fn: (transmitindo: boolean, naFila: number) => void): () => void {
    this.aoMudarEstado.add(fn);
    return () => this.aoMudarEstado.delete(fn);
  }

  private avisar(): void {
    for (const fn of this.aoMudarEstado) fn(this._transmitindo, this.fila.length);
  }

  async iniciar(onPacote: AoReceberPacote, _onVizinho: AoMudarVizinho): Promise<void> {
    this.contexto = new AudioContext();
    await retomarAudio(this.contexto);
    this.modem = await ModemSom.criar(this.contexto.sampleRate);
    // Sem cancelamento de eco nem supressão de ruído: eles destroem o sinal FSK.
    this.fluxo = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const fonte = this.contexto.createMediaStreamSource(this.fluxo);
    this.processador = this.contexto.createScriptProcessor(1024, 1, 1);
    this.processador.onaudioprocess = (ev) => {
      if (this._transmitindo || !this.modem) return;
      const dados = this.modem.demodular(ev.inputBuffer.getChannelData(0));
      if (dados) onPacote(dados);
    };
    const mudo = this.contexto.createGain();
    mudo.gain.value = 0;
    fonte.connect(this.processador);
    this.processador.connect(mudo);
    mudo.connect(this.contexto.destination);
  }

  async anunciar(presenca: Uint8Array): Promise<void> {
    if (!this.opcoes.anunciarPresenca) return;
    const agora = Date.now();
    if (agora - this.ultimaPresenca < this.opcoes.intervaloPresencaMs) return;
    this.ultimaPresenca = agora;
    await this.enviar(presenca);
  }

  /** Anuncia a presença agora, ignorando o intervalo (botão "anunciar por som"). */
  async anunciarAgora(presenca: Uint8Array): Promise<void> {
    this.ultimaPresenca = Date.now();
    await this.enviar(presenca);
  }

  async enviar(pacote: Uint8Array): Promise<void> {
    if (!this.contexto || !this.modem) throw new Error('canal de som parado');
    if (this.fila.length > 20) this.fila.shift();
    this.fila.push(pacote);
    this.avisar();
    if (!this._transmitindo) void this.drenar();
  }

  private async drenar(): Promise<void> {
    this._transmitindo = true;
    try {
      while (this.fila.length && this.contexto && this.modem) {
        const pacote = this.fila.shift()!;
        this.avisar();
        const onda = this.modem.modular(pacote, this.opcoes.protocolo, this.opcoes.velocidade, this.opcoes.volume);
        await this.tocar(onda);
        // Pausa curta para o eco do ambiente morrer antes de voltar a ouvir.
        await new Promise((r) => setTimeout(r, 250));
      }
    } finally {
      this._transmitindo = false;
      this.avisar();
    }
  }

  private tocar(onda: Float32Array): Promise<void> {
    const ctx = this.contexto!;
    // A onda vem a 48 kHz; o AudioContext converte para a taxa do alto-falante.
    const buffer = ctx.createBuffer(1, onda.length, TAXA_GGWAVE);
    buffer.copyToChannel(new Float32Array(onda), 0);
    const fonte = ctx.createBufferSource();
    fonte.buffer = buffer;
    fonte.connect(ctx.destination);
    return new Promise((resolver) => {
      fonte.onended = () => resolver();
      fonte.start();
    });
  }

  async parar(): Promise<void> {
    this.fila = [];
    if (this.processador) this.processador.onaudioprocess = null;
    this.processador?.disconnect();
    for (const t of this.fluxo?.getTracks() ?? []) t.stop();
    await this.contexto?.close().catch(() => undefined);
    this.modem?.liberar();
    this.contexto = undefined;
    this.modem = undefined;
    this.fluxo = undefined;
  }
}
