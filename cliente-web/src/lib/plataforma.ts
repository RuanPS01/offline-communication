import { ehAppNativo, plataforma } from '@plataforma/canal-nativo';

export type TipoCliente = 'android' | 'ios' | 'web';

export interface Ambiente {
  cliente: TipoCliente;
  /** Sistema do aparelho, mesmo na web. */
  sistema: 'android' | 'ios' | 'outro';
  /** HTTPS ou localhost: câmera, microfone e service worker liberados. */
  seguro: boolean;
  /** A página foi aberta a partir do servidor de rede local de outro aparelho. */
  servidaPorRedeLocal: boolean;
  instalada: boolean;
}

export function detectarSistema(): Ambiente['sistema'] {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  return 'outro';
}

export function ambienteInicial(): Ambiente {
  const nativo = ehAppNativo();
  return {
    cliente: nativo ? (plataforma() as TipoCliente) : 'web',
    sistema: detectarSistema(),
    seguro: globalThis.isSecureContext ?? false,
    servidaPorRedeLocal: false,
    instalada:
      matchMedia?.('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
  };
}
