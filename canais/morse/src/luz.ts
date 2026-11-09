/**
 * Canal de luz: Morse com a lanterna. Transmissão pisca a lanterna no ritmo
 * do código. Recepção abre a câmera e amostra o brilho quadro a quadro: o
 * usuário marca a área da imagem onde está a lanterna do outro, ou o app
 * pega a área de maior variação de brilho. Funciona com os dois celulares
 * parados e mirados, inclusive com gente piscando uma lanterna comum à mão.
 */

import { type AoMudarVizinho, type AoReceberPacote, type Canal, type Capacidades, deUtf8, utf8 } from '@plataforma/nucleo';
import { paraSegmentos } from './codigo.ts';
import type { Lanterna } from './lanterna.ts';
import { executarSegmentos, ProcessadorMorse } from './processador.ts';

const COLUNAS = 8;
const LINHAS = 6;
const JANELA_VARIANCIA_MS = 2500;

export interface EstadoLuz {
  transmitindo: boolean;
  progresso: number;
  recebendo: boolean;
  parcial: string;
  nivel: number;
  /** Célula analisada (coluna, linha) e se foi escolhida à mão. */
  area?: { coluna: number; linha: number; manual: boolean };
  aceso: boolean;
}

/** Recepção pela câmera: brilho de uma célula da imagem ao longo do tempo. */
export class ReceptorLuz {
  private fluxo?: MediaStream;
  private ativo = false;
  private historico: { t: number; valores: Float32Array }[] = [];
  private areaManual?: number;
  private areaAuto = 0;
  private readonly processador: ProcessadorMorse;
  nivel = 0;

  constructor(
    unidadeMs: number,
    aoTexto: (texto: string) => void,
    private readonly aoQuadro?: (r: ReceptorLuz) => void,
    aoParcial?: (parcial: string) => void,
  ) {
    this.processador = new ProcessadorMorse(unidadeMs, aoTexto, aoParcial, 0.15);
  }

  get area(): { coluna: number; linha: number; manual: boolean } {
    const i = this.areaManual ?? this.areaAuto;
    return { coluna: i % COLUNAS, linha: Math.floor(i / COLUNAS), manual: this.areaManual !== undefined };
  }

  get aceso(): boolean {
    return this.processador.nivelLigado;
  }

  get parcial(): string {
    return this.processador.decodificador.parcial;
  }

  /** x e y de 0 a 1 sobre o vídeo; sem argumentos volta ao modo automático. */
  selecionarArea(x?: number, y?: number): void {
    if (x === undefined || y === undefined) {
      this.areaManual = undefined;
      return;
    }
    const c = Math.min(COLUNAS - 1, Math.max(0, Math.floor(x * COLUNAS)));
    const l = Math.min(LINHAS - 1, Math.max(0, Math.floor(y * LINHAS)));
    this.areaManual = l * COLUNAS + c;
  }

  async iniciar(video: HTMLVideoElement, camera: 'environment' | 'user' = 'environment'): Promise<void> {
    await this.parar();
    this.fluxo = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: camera, frameRate: { ideal: 30 }, width: { ideal: 640 } },
      audio: false,
    });
    video.srcObject = this.fluxo;
    video.setAttribute('playsinline', 'true');
    video.muted = true;
    await video.play();
    const tela = document.createElement('canvas');
    tela.width = COLUNAS * 4;
    tela.height = LINHAS * 4;
    const ctx = tela.getContext('2d', { willReadFrequently: true })!;
    this.ativo = true;
    const comQuadro = (video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    }).requestVideoFrameCallback?.bind(video);
    const proximo = () => {
      if (!this.ativo) return;
      if (comQuadro) comQuadro(passo);
      else requestAnimationFrame(passo);
    };
    const passo = () => {
      if (!this.ativo) return;
      if (video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, tela.width, tela.height);
        this.analisar(performance.now(), ctx.getImageData(0, 0, tela.width, tela.height).data);
      }
      proximo();
    };
    proximo();
  }

  /** Brilho médio de cada célula da grade (exposto para testes). */
  static brilhoPorCelula(rgba: Uint8ClampedArray): Float32Array {
    const largura = COLUNAS * 4;
    const v = new Float32Array(COLUNAS * LINHAS);
    for (let y = 0; y < LINHAS * 4; y++) {
      for (let x = 0; x < largura; x++) {
        const i = (y * largura + x) * 4;
        const lum = (0.2126 * rgba[i]! + 0.7152 * rgba[i + 1]! + 0.0722 * rgba[i + 2]!) / 255;
        v[Math.floor(y / 4) * COLUNAS + Math.floor(x / 4)]! += lum / 16;
      }
    }
    return v;
  }

  analisar(t: number, rgba: Uint8ClampedArray): void {
    const valores = ReceptorLuz.brilhoPorCelula(rgba);
    this.historico.push({ t, valores });
    while (this.historico.length && t - this.historico[0]!.t > JANELA_VARIANCIA_MS) this.historico.shift();
    if (this.areaManual === undefined && this.historico.length > 10) this.areaAuto = this.maiorVariacao();
    const i = this.areaManual ?? this.areaAuto;
    this.nivel = valores[i]!;
    this.processador.alimentar(t, this.nivel);
    this.aoQuadro?.(this);
  }

  /** A célula que mais pisca é, quase sempre, a lanterna do outro. */
  private maiorVariacao(): number {
    let melhor = this.areaAuto;
    let maior = -1;
    for (let c = 0; c < COLUNAS * LINHAS; c++) {
      let min = Infinity;
      let max = -Infinity;
      for (const h of this.historico) {
        const v = h.valores[c]!;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (max - min > maior * 1.15) {
        maior = max - min;
        melhor = c;
      }
    }
    return melhor;
  }

  tique(): void {
    this.processador.tique(performance.now());
  }

  async parar(): Promise<void> {
    this.ativo = false;
    for (const t of this.fluxo?.getTracks() ?? []) t.stop();
    this.fluxo = undefined;
  }
}

export class CanalLuz implements Canal {
  readonly id = 'luz';
  readonly nome = 'Luz (Morse)';
  readonly capacidades: Capacidades = {
    bytesPorSegundo: 1,
    aoVivo: false,
    bidirecional: true,
    alcanceMetros: 300,
    mtu: 120,
    custo: 9,
    exigeAcao: true,
    somenteTexto: true,
  };
  lanterna?: Lanterna;
  private onPacote?: AoReceberPacote;
  private receptor?: ReceptorLuz;
  private fila: string[] = [];
  private cancelar = false;
  private estado: EstadoLuz = { transmitindo: false, progresso: 0, recebendo: false, parcial: '', nivel: 0, aceso: false };
  private observadores = new Set<(e: EstadoLuz) => void>();
  private relogio?: ReturnType<typeof setInterval>;

  constructor(public unidadeMs = 200) {}

  async disponivel(): Promise<boolean> {
    return true;
  }

  observar(fn: (e: EstadoLuz) => void): () => void {
    this.observadores.add(fn);
    fn(this.estado);
    return () => this.observadores.delete(fn);
  }

  private mudar(parcial: Partial<EstadoLuz>): void {
    this.estado = { ...this.estado, ...parcial };
    for (const fn of this.observadores) fn(this.estado);
  }

  async iniciar(onPacote: AoReceberPacote, _onVizinho: AoMudarVizinho): Promise<void> {
    this.onPacote = onPacote;
  }

  async anunciar(): Promise<void> {
    // Presença não vai por Morse: seria lento demais.
  }

  async enviar(dados: Uint8Array): Promise<void> {
    if (!this.lanterna) throw new Error('nenhuma lanterna escolhida');
    this.fila.push(deUtf8(dados));
    if (!this.estado.transmitindo) void this.drenar();
  }

  private async drenar(): Promise<void> {
    this.cancelar = false;
    this.mudar({ transmitindo: true, progresso: 0 });
    try {
      while (this.fila.length && !this.cancelar) {
        const texto = this.fila.shift()!;
        // Silêncio inicial para o receptor calibrar o limiar.
        const segmentos = [{ ligado: false, unidades: 7 }, ...paraSegmentos(texto), { ligado: false, unidades: 14 }];
        await executarSegmentos(
          segmentos,
          this.unidadeMs,
          async (ligado) => {
            this.mudar({ aceso: ligado });
            await (ligado ? this.lanterna!.ligar() : this.lanterna!.desligar());
          },
          () => this.cancelar,
          (p) => this.mudar({ progresso: p }),
        );
      }
    } finally {
      this.mudar({ transmitindo: false, progresso: 0, aceso: false });
    }
  }

  cancelarTransmissao(): void {
    this.cancelar = true;
    this.fila = [];
  }

  async iniciarRecepcao(video: HTMLVideoElement, camera: 'environment' | 'user' = 'environment'): Promise<void> {
    this.receptor = new ReceptorLuz(
      this.unidadeMs,
      (texto) => this.onPacote?.(utf8(texto), 'camera'),
      (r) => this.mudar({ nivel: r.nivel, area: r.area, aceso: r.aceso }),
      (parcial) => this.mudar({ parcial }),
    );
    await this.receptor.iniciar(video, camera);
    this.relogio = setInterval(() => this.receptor?.tique(), 200);
    this.mudar({ recebendo: true });
  }

  selecionarArea(x?: number, y?: number): void {
    this.receptor?.selecionarArea(x, y);
  }

  async pararRecepcao(): Promise<void> {
    if (this.relogio) clearInterval(this.relogio);
    await this.receptor?.parar();
    this.receptor = undefined;
    this.mudar({ recebendo: false, parcial: '' });
  }

  async parar(): Promise<void> {
    this.cancelarTransmissao();
    await this.pararRecepcao();
    await this.lanterna?.fechar();
    this.onPacote = undefined;
  }
}
