/**
 * Canal Wi-Fi P2P, para voz e dados em volume.
 *
 * - Android: Nearby Connections (estratégia P2P_CLUSTER), que descobre por
 *   BLE e sobe a conexão para Wi-Fi Direct ou hotspot automaticamente.
 * - iOS: Multipeer Connectivity (entre iPhones). Wi-Fi Aware do iOS 26 fica
 *   como evolução, detectado em tempo de execução.
 *
 * Android e iPhone não se enxergam por aqui: a ponte entre eles é o BLE.
 */

import { registerPlugin } from '@capacitor/core';
import { CanalNativo, type PluginCanalNativo } from '@plataforma/canal-nativo';
import type { Capacidades } from '@plataforma/nucleo';

export const ID_SERVICO_NEARBY = 'sobrevivencia.malha';
export const TIPO_SERVICO_MULTIPEER = 'sobrev-mp';

export const CAPACIDADES_WIFI: Capacidades = {
  bytesPorSegundo: 250_000,
  aoVivo: true,
  bidirecional: true,
  alcanceMetros: 60,
  mtu: 30_000,
  custo: 3,
};

const PluginWifi = registerPlugin<PluginCanalNativo>('CanalWifi');

export class CanalWifi extends CanalNativo {
  constructor(opcoesIniciar?: () => Record<string, unknown>) {
    super('wifi', 'Wi-Fi direto (P2P)', CAPACIDADES_WIFI, PluginWifi, 'CanalWifi', opcoesIniciar);
  }
}
