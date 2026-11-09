/**
 * Canal NFC.
 *
 * - App Android: aperto de mão no toque. Um celular emula um cartão (HCE,
 *   AID F0 53 4F 42 52 45 56) e o outro, em modo leitor, troca pacotes por
 *   APDUs. Ao encostar, os dois trocam presença e o que estiver na fila.
 * - App iOS: só leitor (Core NFC ISO 7816), conversando com o Android.
 * - Web (Chrome no Android): Web NFC lê e grava adesivos NFC. Vira uma
 *   caixa de recados física: grava o pacote num adesivo, o próximo que
 *   encostar lê.
 */

import { registerPlugin } from '@capacitor/core';
import { CanalNativo, type PluginCanalNativo } from '@plataforma/canal-nativo';
import type { AoMudarVizinho, AoReceberPacote, Canal, Capacidades } from '@plataforma/nucleo';

export const AID_PLATAFORMA = 'F0534F42524556';
export const TIPO_MIME_PACOTE = 'application/vnd.comunicacao-offline.pacote';

export const CAPACIDADES_NFC: Capacidades = {
  bytesPorSegundo: 2000,
  aoVivo: false,
  bidirecional: true,
  alcanceMetros: 0.05,
  mtu: 240,
  custo: 5,
  exigeAcao: true,
};

interface PluginNfcNativo extends PluginCanalNativo {
  /** Vira leitor por alguns segundos e troca pacotes com o celular encostado. */
  ler(o: { segundos?: number }): Promise<{ trocou: boolean; recebidos?: number }>;
}

const PluginNfc = registerPlugin<PluginNfcNativo>('CanalNfc');

export class CanalNfcNativo extends CanalNativo {
  constructor(opcoesIniciar?: () => Record<string, unknown>) {
    super('nfc', 'NFC (toque)', CAPACIDADES_NFC, PluginNfc, 'CanalNfc', opcoesIniciar);
  }

  /**
   * Por padrão o aparelho fica como "cartão" (o outro lê). Chamando `ler`, ele
   * vira leitor: encostando os dois, a troca acontece nos dois sentidos.
   */
  ler(segundos = 20): Promise<{ trocou: boolean; recebidos?: number }> {
    return (this.plugin as PluginNfcNativo).ler({ segundos });
  }
}

interface LeitorNdef {
  scan(o?: { signal?: AbortSignal }): Promise<void>;
  write(m: { records: { recordType: string; mediaType?: string; data: BufferSource }[] }, o?: { signal?: AbortSignal }): Promise<void>;
  onreading: ((ev: { serialNumber: string; message: { records: { recordType: string; mediaType?: string; data?: DataView }[] } }) => void) | null;
  onreadingerror: (() => void) | null;
}

declare global {
  interface Window {
    NDEFReader?: new () => LeitorNdef;
  }
}

/** Web NFC: adesivos como caixa de recados. */
export class CanalNfcWeb implements Canal {
  readonly id = 'nfc';
  readonly nome = 'NFC (adesivos)';
  readonly capacidades = CAPACIDADES_NFC;
  private leitor?: LeitorNdef;
  private controle?: AbortController;
  private pendente?: Uint8Array;
  private presenca?: Uint8Array;

  async disponivel(): Promise<boolean> {
    return typeof window !== 'undefined' && !!window.NDEFReader;
  }

  async iniciar(onPacote: AoReceberPacote, onVizinho: AoMudarVizinho): Promise<void> {
    this.leitor = new window.NDEFReader!();
    this.controle = new AbortController();
    this.leitor.onreading = (ev) => {
      onVizinho({ idLocal: `adesivo:${ev.serialNumber}`, presente: true });
      for (const r of ev.message.records) {
        if (r.recordType === 'mime' && r.mediaType === TIPO_MIME_PACOTE && r.data) {
          onPacote(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength).slice(), `adesivo:${ev.serialNumber}`);
        }
      }
    };
    await this.leitor.scan({ signal: this.controle.signal });
  }

  async anunciar(presenca: Uint8Array): Promise<void> {
    this.presenca = presenca;
  }

  /** Guarda o pacote para gravar no próximo adesivo (ver `gravarNoAdesivo`). */
  async enviar(pacote: Uint8Array): Promise<void> {
    this.pendente = pacote;
  }

  get temPendente(): boolean {
    return !!this.pendente;
  }

  /** Espera um adesivo encostar e grava nele o último pacote (e a presença). */
  async gravarNoAdesivo(): Promise<void> {
    if (!this.leitor) throw new Error('NFC parado');
    const registros = [this.presenca, this.pendente]
      .filter((x): x is Uint8Array => !!x)
      .map((dados) => ({ recordType: 'mime', mediaType: TIPO_MIME_PACOTE, data: dados as BufferSource }));
    if (!registros.length) throw new Error('nada para gravar');
    await this.leitor.write({ records: registros });
    this.pendente = undefined;
  }

  async parar(): Promise<void> {
    this.controle?.abort();
    this.leitor = undefined;
  }
}
