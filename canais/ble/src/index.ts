/**
 * Canal BLE: o transporte principal da malha nos apps nativos. Cada aparelho
 * é periférico (anuncia o serviço e aceita escritas) e central (procura o
 * serviço, conecta e escreve) ao mesmo tempo. O mesmo GATT no Android e no
 * iOS é o que faz a ponte entre os dois sistemas.
 *
 * Serviço   6f63616d-0001-4c68-8a1e-6f66666c696e
 * Pacotes   6f63616d-0002-4c68-8a1e-6f66666c696e  (escrita sem resposta + notificação)
 *
 * Cada escrita ou notificação leva [cabeçalho][pedaço]. Cabeçalho: bit 7 =
 * primeiro pedaço, bit 6 = último pedaço, bits 0 a 5 = número do pacote
 * (para não misturar dois pacotes). O nativo remonta e entrega o pacote
 * inteiro ao núcleo.
 */

import { registerPlugin } from '@capacitor/core';
import { CanalNativo, type PluginCanalNativo } from '@plataforma/canal-nativo';
import type { Capacidades } from '@plataforma/nucleo';

export const UUID_SERVICO_BLE = '6f63616d-0001-4c68-8a1e-6f66666c696e';
export const UUID_PACOTES_BLE = '6f63616d-0002-4c68-8a1e-6f66666c696e';

export const CAPACIDADES_BLE: Capacidades = {
  bytesPorSegundo: 8_000,
  aoVivo: true,
  bidirecional: true,
  alcanceMetros: 30,
  mtu: 4096,
  custo: 2,
};

const PluginBle = registerPlugin<PluginCanalNativo>('CanalBle');

export class CanalBle extends CanalNativo {
  constructor(opcoesIniciar?: () => Record<string, unknown>) {
    super('ble', 'Bluetooth (malha BLE)', CAPACIDADES_BLE, PluginBle, 'CanalBle', opcoesIniciar);
  }
}
