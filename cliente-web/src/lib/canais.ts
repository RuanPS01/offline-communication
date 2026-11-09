/**
 * Monta os canais conforme o cliente. O núcleo é o mesmo nos três; muda só
 * quais canais cada cliente consegue ligar.
 */

import { CanalBle } from '@plataforma/canal-ble';
import { CanalLuz, CanalSomMorse } from '@plataforma/canal-morse';
import { CanalNfcNativo, CanalNfcWeb } from '@plataforma/canal-nfc';
import { CanalQr } from '@plataforma/canal-qr';
import { CanalRadio, TransporteNativo, TransporteWebBluetooth } from '@plataforma/canal-radio';
import { CanalRedeLocal, CanalRedeLocalNativo } from '@plataforma/canal-rede-local';
import { CanalSom } from '@plataforma/canal-som';
import { CanalWifi } from '@plataforma/canal-wifi';
import type { Canal, IdCanal } from '@plataforma/nucleo';
import type { Ambiente } from './plataforma.ts';

export interface CanaisDoCliente {
  todos: Canal[];
  qr: CanalQr;
  som: CanalSom;
  luz: CanalLuz;
  somMorse: CanalSomMorse;
  radio: CanalRadio;
  redeLocal?: CanalRedeLocal;
  redeLocalNativo?: CanalRedeLocalNativo;
  nfcWeb?: CanalNfcWeb;
  nfcNativo?: CanalNfcNativo;
  ble?: CanalBle;
  wifi?: CanalWifi;
  /** Canais ligados sozinhos na primeira abertura. */
  automaticos: IdCanal[];
}

export function criarCanais(amb: Ambiente, opcoesNativas: () => Record<string, unknown>): CanaisDoCliente {
  const qr = new CanalQr();
  const som = new CanalSom();
  const luz = new CanalLuz();
  const somMorse = new CanalSomMorse();
  if (amb.cliente !== 'web') {
    const ble = new CanalBle(opcoesNativas);
    const wifi = new CanalWifi(opcoesNativas);
    const redeLocalNativo = new CanalRedeLocalNativo(opcoesNativas);
    const nfcNativo = new CanalNfcNativo(opcoesNativas);
    const radio = new CanalRadio([new TransporteNativo()]);
    return {
      todos: [ble, wifi, redeLocalNativo, som, qr, luz, somMorse, nfcNativo, radio],
      qr,
      som,
      luz,
      somMorse,
      radio,
      ble,
      wifi,
      redeLocalNativo,
      nfcNativo,
      automaticos: ['ble', 'wifi', 'rede-local', 'qr', 'nfc'],
    };
  }
  const redeLocal = new CanalRedeLocal();
  const nfcWeb = new CanalNfcWeb();
  const radio = new CanalRadio([new TransporteWebBluetooth()]);
  return {
    todos: [redeLocal, som, qr, luz, somMorse, nfcWeb, radio],
    qr,
    som,
    luz,
    somMorse,
    radio,
    redeLocal,
    nfcWeb,
    automaticos: amb.servidaPorRedeLocal ? ['rede-local', 'qr'] : ['qr'],
  };
}

export const ROTULO_CURTO: Record<string, string> = {
  ble: 'BLE',
  wifi: 'WI-FI',
  'rede-local': 'REDE',
  som: 'SOM',
  qr: 'QR',
  luz: 'LUZ',
  'som-morse': 'MORSE',
  nfc: 'NFC',
  radio: 'LORA',
  memoria: 'SIM',
};

export const DESCRICAO_CANAL: Record<string, string> = {
  ble: 'Malha Bluetooth entre apps. Transporte principal, também faz a ponte entre Android e iPhone.',
  wifi: 'Wi-Fi direto entre aparelhos do mesmo sistema. Voz e dados em volume.',
  'rede-local': 'Um aparelho serve e os outros abrem a página dele no mesmo Wi-Fi ou hotspot.',
  som: 'Dados por áudio entre quaisquer celulares, a poucos metros. Lento, mas funciona até na web.',
  qr: 'Mostre a tela e aponte a câmera. Com as câmeras frontais, os dois trocam ao mesmo tempo.',
  luz: 'Morse com lanterna ou tela; recebe pela câmera. Linha de visão, longe, à noite.',
  'som-morse': 'Morse por tom de 800 Hz. Funciona com apito, rádio comum ou outro celular.',
  nfc: 'Encoste os aparelhos para trocar (app) ou use adesivos NFC como caixa de recados (web).',
  radio: 'Módulo LoRa externo por Bluetooth. Quilômetros de alcance, poucos bytes por vez.',
};
