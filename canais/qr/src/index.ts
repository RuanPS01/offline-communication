/**
 * Canal QR: troca mirando um celular no outro. A tela mostra, em
 * carrossel, a presença e os últimos pacotes enviados; a câmera lê os QRs
 * do outro. Com as câmeras frontais, os dois podem mostrar e ler ao mesmo
 * tempo, frente a frente.
 */

import type { AoMudarVizinho, AoReceberPacote, Canal, Capacidades } from '@plataforma/nucleo';
import { LeitorQr, pacoteParaTextoQr, textoQrParaPacote } from './qr.ts';

export * from './base45.ts';
export * from './qr.ts';

export interface QuadroQr {
  texto: string;
  indice: number;
  total: number;
}

const MAX_CARROSSEL = 6;
const VALIDADE_MS = 10 * 60_000;

export class CanalQr implements Canal {
  readonly id = 'qr';
  readonly nome = 'QR (tela e câmera)';
  readonly capacidades: Capacidades = {
    bytesPorSegundo: 250,
    aoVivo: false,
    bidirecional: true,
    alcanceMetros: 1,
    mtu: 400,
    custo: 7,
    exigeAcao: true,
  };
  private presenca?: Uint8Array;
  private carrossel: { bytes: Uint8Array; em: number }[] = [];
  private posicao = 0;
  private temporizador?: ReturnType<typeof setInterval>;
  private onPacote?: AoReceberPacote;
  private onVizinho?: AoMudarVizinho;
  private observadores = new Set<(q: QuadroQr | undefined) => void>();
  private leitor = new LeitorQr();
  private ultimaLeitura = '';

  constructor(private readonly intervaloMs = 1200) {}

  async disponivel(): Promise<boolean> {
    return true;
  }

  async iniciar(onPacote: AoReceberPacote, onVizinho: AoMudarVizinho): Promise<void> {
    this.onPacote = onPacote;
    this.onVizinho = onVizinho;
    this.temporizador = setInterval(() => this.avancar(), this.intervaloMs);
  }

  async anunciar(presenca: Uint8Array): Promise<void> {
    this.presenca = presenca;
    if (this.quadros().length === 1) this.notificar();
  }

  async enviar(pacote: Uint8Array): Promise<void> {
    this.carrossel.unshift({ bytes: pacote, em: Date.now() });
    this.carrossel = this.carrossel.slice(0, MAX_CARROSSEL);
    this.posicao = 0;
    this.notificar();
  }

  async parar(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.leitor.parar();
    this.onPacote = undefined;
  }

  private quadros(): Uint8Array[] {
    const agora = Date.now();
    this.carrossel = this.carrossel.filter((c) => agora - c.em < VALIDADE_MS);
    return [...(this.presenca ? [this.presenca] : []), ...this.carrossel.map((c) => c.bytes)];
  }

  private avancar(): void {
    const n = this.quadros().length;
    if (n > 1) {
      this.posicao = (this.posicao + 1) % n;
      this.notificar();
    }
  }

  quadroAtual(): QuadroQr | undefined {
    const q = this.quadros();
    if (!q.length) return undefined;
    const i = this.posicao % q.length;
    return { texto: pacoteParaTextoQr(q[i]!), indice: i, total: q.length };
  }

  /** A interface assina para redesenhar o QR quando o carrossel avança. */
  observar(fn: (q: QuadroQr | undefined) => void): () => void {
    this.observadores.add(fn);
    fn(this.quadroAtual());
    return () => this.observadores.delete(fn);
  }

  private notificar(): void {
    const q = this.quadroAtual();
    for (const fn of this.observadores) fn(q);
  }

  /** Liga a câmera e entrega ao núcleo cada pacote lido. */
  async iniciarLeitura(video: HTMLVideoElement, camera: 'user' | 'environment' = 'environment'): Promise<void> {
    await this.leitor.iniciar(video, camera, (texto) => this.receberTexto(texto));
  }

  async pararLeitura(): Promise<void> {
    await this.leitor.parar();
  }

  /** Também serve para colar o conteúdo de um QR lido por outro aplicativo. */
  receberTexto(texto: string): boolean {
    if (texto === this.ultimaLeitura) return false;
    const bytes = textoQrParaPacote(texto.trim());
    if (!bytes) return false;
    this.ultimaLeitura = texto;
    this.onVizinho?.({ idLocal: 'camera', presente: true });
    this.onPacote?.(bytes, 'camera');
    return true;
  }
}
