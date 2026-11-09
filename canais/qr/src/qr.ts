/** Geração e leitura de QR, independentes do canal. */

import jsQR from 'jsqr';
import qrcode from 'qrcode-generator';
import { codificarBase45, decodificarBase45 } from './base45.ts';

/** Prefixo dos QRs da plataforma (alfanumérico, para caber no modo compacto). */
export const PREFIXO_QR = 'OC1:';

export function pacoteParaTextoQr(bytes: Uint8Array): string {
  return PREFIXO_QR + codificarBase45(bytes);
}

export function textoQrParaPacote(texto: string): Uint8Array | undefined {
  if (!texto.startsWith(PREFIXO_QR)) return undefined;
  try {
    return decodificarBase45(texto.slice(PREFIXO_QR.length));
  } catch {
    return undefined;
  }
}

export interface MatrizQr {
  tamanho: number;
  escuro(linha: number, coluna: number): boolean;
}

/** Monta a matriz do QR. Usa o modo alfanumérico quando o texto permite. */
export function gerarQr(texto: string, correcao: 'L' | 'M' | 'Q' | 'H' = 'M'): MatrizQr {
  const qr = qrcode(0, correcao);
  const alfanumerico = /^[0-9A-Z $%*+\-./:]*$/.test(texto);
  qr.addData(texto, alfanumerico ? 'Alphanumeric' : 'Byte');
  qr.make();
  return { tamanho: qr.getModuleCount(), escuro: (l, c) => qr.isDark(l, c) };
}

/** SVG do QR, com margem de 4 módulos. */
export function qrSvg(texto: string, corEscura = '#000', corClara = '#fff'): string {
  const m = gerarQr(texto);
  const total = m.tamanho + 8;
  let caminho = '';
  for (let l = 0; l < m.tamanho; l++) {
    for (let c = 0; c < m.tamanho; c++) if (m.escuro(l, c)) caminho += `M${c + 4} ${l + 4}h1v1h-1z`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${corClara}"/><path d="${caminho}" fill="${corEscura}"/></svg>`
  );
}

export function desenharQr(canvas: HTMLCanvasElement, texto: string, lado: number): void {
  const m = gerarQr(texto);
  const total = m.tamanho + 8;
  const escala = Math.max(1, Math.floor(lado / total));
  canvas.width = canvas.height = total * escala;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let l = 0; l < m.tamanho; l++) {
    for (let c = 0; c < m.tamanho; c++) if (m.escuro(l, c)) ctx.fillRect((c + 4) * escala, (l + 4) * escala, escala, escala);
  }
}

/** Lê QRs de uma imagem crua (RGBA). */
export function lerQrDeImagem(rgba: Uint8ClampedArray, largura: number, altura: number): string | undefined {
  const r = jsQR(rgba, largura, altura, { inversionAttempts: 'dontInvert' });
  return r?.data || undefined;
}

interface DetectorDeCodigos {
  detect(fonte: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

/**
 * Leitor contínuo: abre a câmera num <video> e chama `aoLer` para cada QR.
 * Usa o BarcodeDetector nativo quando existe (Android) e o jsQR no resto
 * (iPhone).
 */
export class LeitorQr {
  private fluxo?: MediaStream;
  private ativo = false;
  private detector?: DetectorDeCodigos;
  private readonly tela = typeof document !== 'undefined' ? document.createElement('canvas') : undefined;

  static disponivel(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  async iniciar(video: HTMLVideoElement, camera: 'user' | 'environment', aoLer: (texto: string) => void): Promise<void> {
    await this.parar();
    this.fluxo = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: camera, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = this.fluxo;
    video.setAttribute('playsinline', 'true');
    video.muted = true;
    await video.play();
    const Detector = (globalThis as unknown as { BarcodeDetector?: new (o: object) => DetectorDeCodigos }).BarcodeDetector;
    if (Detector) {
      try {
        this.detector = new Detector({ formats: ['qr_code'] });
      } catch {
        this.detector = undefined;
      }
    }
    this.ativo = true;
    const ciclo = async () => {
      if (!this.ativo) return;
      try {
        const texto = await this.lerQuadro(video);
        if (texto) aoLer(texto);
      } catch {
        // Quadro ruim: tenta o próximo.
      }
      setTimeout(ciclo, 120);
    };
    void ciclo();
  }

  private async lerQuadro(video: HTMLVideoElement): Promise<string | undefined> {
    if (video.readyState < 2) return undefined;
    if (this.detector) {
      const r = await this.detector.detect(video);
      return r[0]?.rawValue;
    }
    const tela = this.tela!;
    const escala = Math.min(1, 640 / video.videoWidth);
    tela.width = Math.round(video.videoWidth * escala);
    tela.height = Math.round(video.videoHeight * escala);
    const ctx = tela.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(video, 0, 0, tela.width, tela.height);
    const img = ctx.getImageData(0, 0, tela.width, tela.height);
    return lerQrDeImagem(img.data, img.width, img.height);
  }

  async parar(): Promise<void> {
    this.ativo = false;
    for (const t of this.fluxo?.getTracks() ?? []) t.stop();
    this.fluxo = undefined;
  }
}
