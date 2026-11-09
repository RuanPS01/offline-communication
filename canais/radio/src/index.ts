/**
 * Canal de rádio LoRa. O celular não tem rádio LoRa, então usa um módulo
 * externo barato (ESP32 com SX1276/SX1262, firmware em `firmware/`) ligado
 * por Bluetooth com o serviço UART da Nordic (NUS). Os pacotes do núcleo
 * viajam em quadros KISS. LoRa leva poucos bytes por segundo, mas chega a
 * quilômetros: bom para texto e presença de longe, não para voz.
 *
 * Transportes: Web Bluetooth (Chrome no Android e no computador) e o
 * plugin nativo "CanalRadio" (Android e iOS), que só move bytes.
 */

import { Capacitor, type PluginListenerHandle, registerPlugin } from '@capacitor/core';
import {
  type AoMudarVizinho,
  type AoReceberPacote,
  type Canal,
  type Capacidades,
  deBase64,
  paraBase64,
} from '@plataforma/nucleo';
import { codificarKiss, DecodificadorKiss } from './kiss.ts';

export * from './kiss.ts';

export const UUID_NUS = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
/** Escrita do celular para o módulo. */
export const UUID_NUS_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
/** Notificação do módulo para o celular. */
export const UUID_NUS_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

export const CAPACIDADES_RADIO: Capacidades = {
  bytesPorSegundo: 100,
  aoVivo: false,
  bidirecional: true,
  alcanceMetros: 3000,
  mtu: 200,
  custo: 4,
};

export interface TransporteSerial {
  readonly nome: string;
  disponivel(): Promise<boolean>;
  abrir(aoReceber: (dados: Uint8Array) => void): Promise<string>;
  escrever(dados: Uint8Array): Promise<void>;
  fechar(): Promise<void>;
}

interface CaracteristicaBle {
  writeValueWithoutResponse(d: BufferSource): Promise<void>;
  startNotifications(): Promise<CaracteristicaBle>;
  addEventListener(e: 'characteristicvaluechanged', fn: (ev: Event) => void): void;
  value?: DataView;
}

interface DispositivoBle {
  name?: string;
  gatt?: {
    connect(): Promise<{
      getPrimaryService(u: string): Promise<{ getCharacteristic(u: string): Promise<CaracteristicaBle> }>;
    }>;
    disconnect(): void;
  };
}

/** Web Bluetooth (exige gesto do usuário para escolher o módulo). */
export class TransporteWebBluetooth implements TransporteSerial {
  readonly nome = 'Bluetooth do navegador';
  private dispositivo?: DispositivoBle;
  private rx?: CaracteristicaBle;

  async disponivel(): Promise<boolean> {
    const bt = (navigator as Navigator & { bluetooth?: { getAvailability(): Promise<boolean> } }).bluetooth;
    return !!bt && (await bt.getAvailability().catch(() => false));
  }

  async abrir(aoReceber: (dados: Uint8Array) => void): Promise<string> {
    const bt = (navigator as unknown as {
      bluetooth: { requestDevice(o: object): Promise<DispositivoBle> };
    }).bluetooth;
    this.dispositivo = await bt.requestDevice({ filters: [{ services: [UUID_NUS] }] });
    const servidor = await this.dispositivo.gatt!.connect();
    const servico = await servidor.getPrimaryService(UUID_NUS);
    this.rx = await servico.getCharacteristic(UUID_NUS_RX);
    const tx = await servico.getCharacteristic(UUID_NUS_TX);
    tx.addEventListener('characteristicvaluechanged', (ev) => {
      const v = (ev.target as unknown as CaracteristicaBle).value!;
      aoReceber(new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice());
    });
    await tx.startNotifications();
    return this.dispositivo.name ?? 'módulo LoRa';
  }

  async escrever(dados: Uint8Array): Promise<void> {
    // Pedaços de 20 bytes cabem na MTU mínima do BLE.
    for (let i = 0; i < dados.length; i += 20) {
      await this.rx!.writeValueWithoutResponse(dados.slice(i, i + 20));
    }
  }

  async fechar(): Promise<void> {
    this.dispositivo?.gatt?.disconnect();
  }
}

interface PluginRadio {
  disponivel(): Promise<{ disponivel: boolean; motivo?: string }>;
  conectar(): Promise<{ nome: string }>;
  escrever(o: { dados: string }): Promise<void>;
  desconectar(): Promise<void>;
  addListener(e: 'dados', fn: (ev: { dados: string }) => void): Promise<PluginListenerHandle>;
}

const PluginRadioNativo = registerPlugin<PluginRadio>('CanalRadio');

/** Transporte nativo: o plugin procura o módulo NUS, conecta e move bytes. */
export class TransporteNativo implements TransporteSerial {
  readonly nome = 'Bluetooth do app';
  private escuta?: PluginListenerHandle;

  async disponivel(): Promise<boolean> {
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('CanalRadio')) return false;
    return (await PluginRadioNativo.disponivel()).disponivel;
  }

  async abrir(aoReceber: (dados: Uint8Array) => void): Promise<string> {
    this.escuta = await PluginRadioNativo.addListener('dados', (ev) => aoReceber(deBase64(ev.dados)));
    return (await PluginRadioNativo.conectar()).nome;
  }

  escrever(dados: Uint8Array): Promise<void> {
    return PluginRadioNativo.escrever({ dados: paraBase64(dados) });
  }

  async fechar(): Promise<void> {
    await this.escuta?.remove();
    await PluginRadioNativo.desconectar();
  }
}

export class CanalRadio implements Canal {
  readonly id = 'radio';
  readonly nome = 'Rádio LoRa (módulo externo)';
  readonly capacidades = CAPACIDADES_RADIO;
  modulo?: string;
  private transporte?: TransporteSerial;

  constructor(private readonly transportes: TransporteSerial[] = [new TransporteNativo(), new TransporteWebBluetooth()]) {}

  async disponivel(): Promise<boolean> {
    for (const t of this.transportes) {
      if (await t.disponivel().catch(() => false)) {
        this.transporte = t;
        return true;
      }
    }
    return false;
  }

  async iniciar(onPacote: AoReceberPacote, onVizinho: AoMudarVizinho): Promise<void> {
    if (!this.transporte) throw new Error('nenhum transporte para o módulo de rádio');
    const kiss = new DecodificadorKiss((dados) => onPacote(dados, 'lora'));
    this.modulo = await this.transporte.abrir((pedaco) => kiss.alimentar(pedaco));
    // O módulo é um vizinho "sem identidade": o roteador sabe que há por onde mandar.
    onVizinho({ idLocal: 'lora', presente: true });
  }

  async anunciar(presenca: Uint8Array): Promise<void> {
    // Presença por LoRa só de vez em quando: o tempo no ar é precioso.
    const agora = Date.now();
    if (agora - this.ultimaPresenca < 60_000) return;
    this.ultimaPresenca = agora;
    await this.enviar(presenca);
  }

  private ultimaPresenca = 0;

  async enviar(pacote: Uint8Array): Promise<void> {
    if (!this.transporte) throw new Error('rádio desconectado');
    await this.transporte.escrever(codificarKiss(pacote));
  }

  async parar(): Promise<void> {
    await this.transporte?.fechar();
  }
}
