/**
 * Canal de rede local. Um celular (ou computador) sobe um servidor HTTP com
 * WebSocket e se anuncia por mDNS (_sobrevivencia._tcp); os outros, no mesmo
 * Wi-Fi ou no hotspot dele, abrem a página servida por ele. Todo mundo
 * conectado ao servidor está num meio único: cada envio alcança todos.
 */

import { type PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { CanalNativo, type PluginCanalNativo } from '@plataforma/canal-nativo';
import type { AoMudarVizinho, AoReceberPacote, Canal, Capacidades } from '@plataforma/nucleo';
import { CAMINHO_INFO, desemoldurar, emoldurar, type InfoServidor, urlWebSocket } from './moldura.js';

export * from './moldura.js';

export const CAPACIDADES_REDE_LOCAL: Capacidades = {
  bytesPorSegundo: 200_000,
  aoVivo: true,
  bidirecional: true,
  alcanceMetros: 50,
  mtu: 16_000,
  custo: 1,
  meioUnico: true,
};

/** Endereços em que os hotspots costumam colocar o celular que serve. */
export const ENDERECOS_HOTSPOT = ['192.168.43.1', '172.20.10.1', '192.168.49.1', '10.0.0.1'];

/** Pergunta a um endereço se há um servidor da plataforma ali. */
export async function consultarServidor(base: string, limiteMs = 2500): Promise<InfoServidor | undefined> {
  const controle = new AbortController();
  const t = setTimeout(() => controle.abort(), limiteMs);
  try {
    const r = await fetch(new URL(CAMINHO_INFO, base), { signal: controle.signal, cache: 'no-store' });
    if (!r.ok) return undefined;
    const info = (await r.json()) as InfoServidor;
    return info.servico === 'sobrevivencia' ? info : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(t);
  }
}

/** A página atual foi servida por um servidor de rede local? */
export async function servidaPorRedeLocal(): Promise<InfoServidor | undefined> {
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return undefined;
  return consultarServidor(location.origin, 1500);
}

export interface OpcoesRedeLocal {
  /** URL base do servidor; sem ela, usa a origem da página. */
  base?: string;
}

/** Cliente web: conecta por WebSocket ao servidor que serviu a página. */
export class CanalRedeLocal implements Canal {
  readonly id = 'rede-local';
  readonly nome = 'Rede local (Wi-Fi)';
  readonly capacidades = CAPACIDADES_REDE_LOCAL;
  info?: InfoServidor;
  meuId?: string;
  private ws?: WebSocket;
  private ligado = false;
  private espera = 1000;
  private religar?: ReturnType<typeof setTimeout>;
  private conhecidos = new Set<string>();
  private aoMudarConexao = new Set<(conectado: boolean) => void>();

  constructor(private readonly opcoes: OpcoesRedeLocal = {}) {}

  private get base(): string | undefined {
    return this.opcoes.base ?? (typeof location !== 'undefined' ? location.origin : undefined);
  }

  get conectado(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  observarConexao(fn: (conectado: boolean) => void): () => void {
    this.aoMudarConexao.add(fn);
    return () => this.aoMudarConexao.delete(fn);
  }

  async disponivel(): Promise<boolean> {
    if (typeof WebSocket === 'undefined' || !this.base) return false;
    // Página HTTPS não pode abrir ws:// (conteúdo misto): só serve se o servidor for o próprio site.
    this.info = await consultarServidor(this.base);
    return !!this.info;
  }

  async iniciar(onPacote: AoReceberPacote, onVizinho: AoMudarVizinho): Promise<void> {
    this.ligado = true;
    this.info ??= await consultarServidor(this.base!);
    if (!this.info) throw new Error('nenhum servidor de rede local encontrado');
    this.conectar(onPacote, onVizinho);
  }

  private conectar(onPacote: AoReceberPacote, onVizinho: AoMudarVizinho): void {
    if (!this.ligado || !this.info) return;
    const ws = new WebSocket(urlWebSocket(this.base!, this.info));
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.espera = 1000;
      for (const fn of this.aoMudarConexao) fn(true);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        try {
          const msg = JSON.parse(ev.data) as { tipo: string; id: string; presente?: boolean };
          if (msg.tipo === 'boas-vindas') this.meuId = msg.id;
          if (msg.tipo === 'vizinho' && msg.id !== this.meuId) {
            if (msg.presente) this.conhecidos.add(msg.id);
            else this.conhecidos.delete(msg.id);
            onVizinho({ idLocal: msg.id, presente: !!msg.presente });
          }
        } catch {
          // Mensagem de controle desconhecida: ignora.
        }
        return;
      }
      try {
        const { id, pacote } = desemoldurar(new Uint8Array(ev.data as ArrayBuffer));
        onPacote(pacote, id);
      } catch {
        // Quadro malformado.
      }
    };
    ws.onclose = () => {
      for (const fn of this.aoMudarConexao) fn(false);
      for (const id of this.conhecidos) onVizinho({ idLocal: id, presente: false });
      this.conhecidos.clear();
      if (!this.ligado) return;
      this.religar = setTimeout(() => this.conectar(onPacote, onVizinho), this.espera);
      this.espera = Math.min(this.espera * 2, 10_000);
    };
  }

  async anunciar(presenca: Uint8Array): Promise<void> {
    if (this.conectado) await this.enviar(presenca);
  }

  async enviar(pacote: Uint8Array, destino?: string): Promise<void> {
    if (!this.conectado) throw new Error('sem conexão com o servidor local');
    this.ws!.send(emoldurar(destino ?? '', pacote));
  }

  async parar(): Promise<void> {
    this.ligado = false;
    if (this.religar) clearTimeout(this.religar);
    this.ws?.close();
    this.ws = undefined;
  }
}

/* ------------------------------------------------------------------ */
/* App nativo: o próprio celular vira servidor, ou entra numa rede.    */
/* ------------------------------------------------------------------ */

export interface ServidorEncontrado {
  nome: string;
  host: string;
  porta: number;
}

export interface PluginRedeLocal extends PluginCanalNativo {
  iniciarServidor(o: { porta?: number; nome: string }): Promise<{ enderecos: string[]; porta: number }>;
  pararServidor(): Promise<void>;
  descobrir(): Promise<void>;
  pararDescoberta(): Promise<void>;
  conectar(o: { url: string }): Promise<void>;
  desconectar(): Promise<void>;
  /** Android: cria um hotspot local (sem internet) e devolve nome e senha. */
  criarHotspot(): Promise<{ ssid: string; senha: string }>;
  pararHotspot(): Promise<void>;
}

export const PluginRedeLocalNativo = registerPlugin<PluginRedeLocal>('RedeLocal');

export class CanalRedeLocalNativo extends CanalNativo {
  constructor(opcoesIniciar: () => Record<string, unknown> = () => ({})) {
    super('rede-local', 'Rede local (Wi-Fi)', CAPACIDADES_REDE_LOCAL, PluginRedeLocalNativo, 'RedeLocal', opcoesIniciar);
  }

  get rede(): PluginRedeLocal {
    return this.plugin as unknown as PluginRedeLocal;
  }

  /** Servidores anunciados por mDNS na rede (depois de `rede.descobrir()`). */
  aoEncontrarServidor(fn: (s: ServidorEncontrado) => void): Promise<PluginListenerHandle> {
    const p = this.plugin as unknown as {
      addListener(e: 'servidor', fn: (s: ServidorEncontrado) => void): Promise<PluginListenerHandle>;
    };
    return p.addListener('servidor', fn);
  }
}
