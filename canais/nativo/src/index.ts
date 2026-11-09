/**
 * Ponte entre o contrato de canal e os plugins nativos. Todo plugin nativo
 * de canal (BLE, Wi-Fi, NFC...) expõe os mesmos métodos que o contrato:
 * disponivel, iniciar, anunciar, enviar e parar, e emite os eventos
 * "pacote" e "vizinho". Os bytes atravessam a ponte em base64.
 *
 * Assim o núcleo continua sem saber qual rádio está embaixo: do lado
 * TypeScript, um canal nativo é só mais uma classe que cumpre o contrato.
 */

import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import {
  type AoMudarVizinho,
  type AoReceberPacote,
  type Canal,
  type Capacidades,
  deBase64,
  type IdCanal,
  paraBase64,
} from '@plataforma/nucleo';

export interface EventoPacoteNativo {
  dados: string;
  de?: string;
  rssi?: number;
}

export interface EventoVizinhoNativo {
  idLocal: string;
  presente: boolean;
  idNo?: string;
  rssi?: number;
  distanciaMetros?: number;
}

export interface PluginCanalNativo {
  disponivel(): Promise<{ disponivel: boolean; motivo?: string }>;
  iniciar(opcoes: Record<string, unknown>): Promise<void>;
  anunciar(opcoes: { dados: string }): Promise<void>;
  enviar(opcoes: { dados: string; destino?: string }): Promise<void>;
  parar(): Promise<void>;
  addListener(evento: 'pacote', fn: (e: EventoPacoteNativo) => void): Promise<PluginListenerHandle>;
  addListener(evento: 'vizinho', fn: (e: EventoVizinhoNativo) => void): Promise<PluginListenerHandle>;
}

export function ehAppNativo(): boolean {
  return Capacitor.isNativePlatform();
}

export function plataforma(): 'android' | 'ios' | 'web' {
  return Capacitor.getPlatform() as 'android' | 'ios' | 'web';
}

export class CanalNativo implements Canal {
  motivoIndisponivel?: string;
  private escutas: PluginListenerHandle[] = [];

  constructor(
    readonly id: IdCanal,
    readonly nome: string,
    readonly capacidades: Capacidades,
    protected readonly plugin: PluginCanalNativo,
    protected readonly nomePlugin: string,
    /** Opções extras passadas ao iniciar (ex.: id do nó e apelido). */
    protected readonly opcoesIniciar: () => Record<string, unknown> = () => ({}),
  ) {}

  async disponivel(): Promise<boolean> {
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable(this.nomePlugin)) {
      this.motivoIndisponivel = 'só no app nativo';
      return false;
    }
    try {
      const r = await this.plugin.disponivel();
      this.motivoIndisponivel = r.disponivel ? undefined : r.motivo;
      return r.disponivel;
    } catch (e) {
      this.motivoIndisponivel = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  async iniciar(onPacote: AoReceberPacote, onVizinho: AoMudarVizinho): Promise<void> {
    await this.removerEscutas();
    this.escutas.push(
      await this.plugin.addListener('pacote', (e) => onPacote(deBase64(e.dados), e.de)),
      await this.plugin.addListener('vizinho', (e) =>
        onVizinho({
          idLocal: e.idLocal,
          presente: e.presente,
          idNo: e.idNo,
          rssi: e.rssi,
          distanciaMetros: e.distanciaMetros,
        }),
      ),
    );
    await this.plugin.iniciar(this.opcoesIniciar());
  }

  async anunciar(presenca: Uint8Array): Promise<void> {
    await this.plugin.anunciar({ dados: paraBase64(presenca) });
  }

  async enviar(pacote: Uint8Array, destino?: string): Promise<void> {
    await this.plugin.enviar({ dados: paraBase64(pacote), destino });
  }

  async parar(): Promise<void> {
    await this.removerEscutas();
    await this.plugin.parar();
  }

  private async removerEscutas(): Promise<void> {
    for (const e of this.escutas.splice(0)) await e.remove();
  }
}
