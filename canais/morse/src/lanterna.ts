/** Formas de piscar: lanterna do celular (nativa ou web) ou a própria tela. */

import { registerPlugin } from '@capacitor/core';
import { Capacitor } from '@capacitor/core';

export interface Lanterna {
  readonly nome: string;
  disponivel(): Promise<boolean>;
  ligar(): Promise<void>;
  desligar(): Promise<void>;
  fechar(): Promise<void>;
}

interface PluginLanterna {
  disponivel(): Promise<{ disponivel: boolean }>;
  ligar(): Promise<void>;
  desligar(): Promise<void>;
}

const PluginLanternaNativo = registerPlugin<PluginLanterna>('Lanterna');

/** Lanterna pelo código nativo (Android CameraManager, iOS AVCaptureDevice). */
export class LanternaNativa implements Lanterna {
  readonly nome = 'Lanterna do aparelho';

  async disponivel(): Promise<boolean> {
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('Lanterna')) return false;
    return (await PluginLanternaNativo.disponivel()).disponivel;
  }

  ligar(): Promise<void> {
    return PluginLanternaNativo.ligar();
  }

  desligar(): Promise<void> {
    return PluginLanternaNativo.desligar();
  }

  async fechar(): Promise<void> {
    await this.desligar().catch(() => undefined);
  }
}

/**
 * Lanterna pela web: só funciona no Chrome do Android (restrição "torch" da
 * câmera). No iPhone a PWA não controla a lanterna; lá a emissão fica com o
 * app nativo ou com a tela.
 */
export class LanternaWeb implements Lanterna {
  readonly nome = 'Lanterna (navegador)';
  private trilha?: MediaStreamTrack;

  async disponivel(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false;
    try {
      await this.abrir();
      const cap = this.trilha!.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
      return !!cap?.torch;
    } catch {
      return false;
    }
  }

  private async abrir(): Promise<void> {
    if (this.trilha?.readyState === 'live') return;
    const fluxo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    this.trilha = fluxo.getVideoTracks()[0];
  }

  private async aplicar(ligado: boolean): Promise<void> {
    await this.abrir();
    await this.trilha!.applyConstraints({ advanced: [{ torch: ligado } as MediaTrackConstraintSet] });
  }

  ligar(): Promise<void> {
    return this.aplicar(true);
  }

  desligar(): Promise<void> {
    return this.aplicar(false);
  }

  async fechar(): Promise<void> {
    await this.desligar().catch(() => undefined);
    this.trilha?.stop();
    this.trilha = undefined;
  }
}

/** Pisca a tela inteira (branco e preto). Funciona em qualquer celular, a curta distância. */
export class LanternaTela implements Lanterna {
  readonly nome = 'Tela piscando';

  constructor(private readonly aplicar: (aceso: boolean) => void) {}

  async disponivel(): Promise<boolean> {
    return true;
  }

  async ligar(): Promise<void> {
    this.aplicar(true);
  }

  async desligar(): Promise<void> {
    this.aplicar(false);
  }

  async fechar(): Promise<void> {
    this.aplicar(false);
  }
}

/** A melhor lanterna disponível: nativa, depois web. */
export async function melhorLanterna(): Promise<Lanterna | undefined> {
  for (const l of [new LanternaNativa(), new LanternaWeb()]) {
    if (await l.disponivel().catch(() => false)) return l;
  }
  return undefined;
}
