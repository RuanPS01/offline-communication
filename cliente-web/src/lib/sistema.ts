/**
 * Recursos do aparelho: tela sempre ligada, bateria, posição e o modo
 * "rádio ligado" (no Android, um serviço em primeiro plano que mantém os
 * rádios vivos com o app minimizado).
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Posicao } from '@plataforma/nucleo';

interface PluginSistema {
  ligarModoRadio(o: { titulo: string; texto: string }): Promise<void>;
  desligarModoRadio(): Promise<void>;
}

const Sistema = registerPlugin<PluginSistema>('Sistema');

let travaTela: WakeLockSentinel | undefined;

export async function manterTelaLigada(sim: boolean): Promise<boolean> {
  try {
    if (sim) {
      travaTela = await navigator.wakeLock?.request('screen');
      return !!travaTela;
    }
    await travaTela?.release();
    travaTela = undefined;
  } catch {
    return false;
  }
  return true;
}

export async function modoRadio(sim: boolean): Promise<void> {
  await manterTelaLigada(sim);
  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Sistema')) {
    if (sim) {
      await Sistema.ligarModoRadio({
        titulo: 'Rádio ligado',
        texto: 'Escutando e repassando mensagens por perto.',
      });
    } else {
      await Sistema.desligarModoRadio();
    }
  }
}

/** Reaplica a trava de tela quando a página volta a ficar visível. */
export function reaplicarTravaAoVoltar(ativo: () => boolean): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ativo()) void manterTelaLigada(true);
  });
}

export async function observarBateria(aoMudar: (nivel: number) => void): Promise<void> {
  try {
    const b = await (navigator as Navigator & {
      getBattery?: () => Promise<{ level: number; addEventListener(e: string, fn: () => void): void }>;
    }).getBattery?.();
    if (!b) return;
    aoMudar(Math.round(b.level * 100));
    b.addEventListener('levelchange', () => aoMudar(Math.round(b.level * 100)));
  } catch {
    // Sem API de bateria (iPhone): fica sem.
  }
}

export function observarPosicao(aoMudar: (p: Posicao | undefined) => void): () => void {
  if (!navigator.geolocation) return () => undefined;
  const id = navigator.geolocation.watchPosition(
    (p) => aoMudar({ lat: p.coords.latitude, lon: p.coords.longitude, precisaoMetros: p.coords.accuracy }),
    () => aoMudar(undefined),
    { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}
