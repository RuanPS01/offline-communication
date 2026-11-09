/**
 * Malha: retransmissão com TTL e deduplicação por id, mais a fragmentação de
 * pacotes grandes para canais de MTU pequena (som, BLE, QR).
 *
 * Regra da malha: quem já viu descarta; quem não viu entrega (se for para
 * ele) e retransmite com ttl - 1 e saltos + 1 enquanto o ttl permitir.
 */

import { Escritor, Leitor } from './bytes.ts';
import {
  codificarPacote,
  ErroPacote,
  type Pacote,
  TAM_CABECALHO,
  TipoPacote,
  VERSAO_PROTOCOLO,
} from './pacote.ts';

export const TTL_PADRAO = 4;
/** Voz ao vivo só até 2 saltos; além disso vira mensagem de voz guardada. */
export const LIMITE_SALTOS_VOZ_AO_VIVO = 2;

/** Lembra o que já passou por aqui, com limite de tamanho e validade. */
export class CacheVistos {
  private mapa = new Map<string, number>();

  constructor(
    private readonly capacidade = 8192,
    private readonly validadeMs = 15 * 60_000,
    private readonly agora: () => number = Date.now,
  ) {}

  ja(chave: string): boolean {
    const t = this.mapa.get(chave);
    if (t === undefined) return false;
    if (this.agora() - t > this.validadeMs) {
      this.mapa.delete(chave);
      return false;
    }
    return true;
  }

  marcar(chave: string): void {
    this.mapa.delete(chave);
    this.mapa.set(chave, this.agora());
    while (this.mapa.size > this.capacidade) {
      const maisAntiga = this.mapa.keys().next().value as string;
      this.mapa.delete(maisAntiga);
    }
  }

  get tamanho(): number {
    return this.mapa.size;
  }
}

/** O pacote ainda pode andar mais um salto? */
export function podeRetransmitir(p: Pacote): boolean {
  return p.ttl - 1 > 0;
}

export function proximoSalto(p: Pacote): Pacote {
  return { ...p, ttl: p.ttl - 1, saltos: Math.min(15, p.saltos + 1) };
}

/** Cabeçalho do fragmento: índice e total (2 bytes cada). */
const TAM_CABECALHO_FRAGMENTO = 4;

/**
 * Quebra um pacote já codificado em fragmentos que cabem na MTU. Cada
 * fragmento é um pacote do tipo Fragmento com o mesmo id e origem do
 * original; a carga leva índice, total e um pedaço dos bytes.
 */
export function fragmentar(original: Pacote, bytes: Uint8Array, mtu: number): Uint8Array[] {
  if (bytes.length <= mtu) return [bytes];
  const pedaco = mtu - TAM_CABECALHO - TAM_CABECALHO_FRAGMENTO;
  if (pedaco <= 0) throw new ErroPacote(`MTU ${mtu} pequena demais para fragmentar`);
  const total = Math.ceil(bytes.length / pedaco);
  if (total > 0xffff) throw new ErroPacote('pacote grande demais');
  const saida: Uint8Array[] = [];
  for (let i = 0; i < total; i++) {
    const carga = new Escritor()
      .u16(i)
      .u16(total)
      .bytes(bytes.subarray(i * pedaco, (i + 1) * pedaco))
      .resultado();
    saida.push(
      codificarPacote({
        versao: VERSAO_PROTOCOLO,
        tipo: TipoPacote.Fragmento,
        flags: 0,
        ttl: original.ttl,
        saltos: original.saltos,
        id: original.id,
        origem: original.origem,
        carimbo: original.carimbo,
        carga,
      }),
    );
  }
  return saida;
}

export function indiceDoFragmento(p: Pacote): number {
  return new Leitor(p.carga).u16();
}

interface Remontagem {
  partes: (Uint8Array | undefined)[];
  recebidas: number;
  criadaEm: number;
}

/** Junta fragmentos até remontar o pacote original. */
export class Remontador {
  private emAndamento = new Map<string, Remontagem>();

  constructor(
    private readonly validadeMs = 120_000,
    private readonly agora: () => number = Date.now,
    private readonly maxSimultaneas = 64,
  ) {}

  /** Devolve os bytes do pacote original quando o último fragmento chega. */
  receber(frag: Pacote): Uint8Array | undefined {
    if (frag.tipo !== TipoPacote.Fragmento) return undefined;
    const l = new Leitor(frag.carga);
    const indice = l.u16();
    const total = l.u16();
    const dados = l.resto();
    if (total === 0 || indice >= total) return undefined;
    const chave = `${frag.origem}:${frag.id}`;
    let r = this.emAndamento.get(chave);
    if (!r || r.partes.length !== total) {
      r = { partes: new Array(total), recebidas: 0, criadaEm: this.agora() };
      this.emAndamento.set(chave, r);
      this.limpar();
    }
    if (!r.partes[indice]) {
      r.partes[indice] = dados;
      r.recebidas++;
    }
    if (r.recebidas < total) return undefined;
    this.emAndamento.delete(chave);
    let tam = 0;
    for (const p of r.partes) tam += p!.length;
    const saida = new Uint8Array(tam);
    let pos = 0;
    for (const p of r.partes) {
      saida.set(p!, pos);
      pos += p!.length;
    }
    return saida;
  }

  /** Progresso de uma remontagem (para mostrar "recebendo 3 de 8"). */
  progresso(origem: string, id: string): { recebidas: number; total: number } | undefined {
    const r = this.emAndamento.get(`${origem}:${id}`);
    return r ? { recebidas: r.recebidas, total: r.partes.length } : undefined;
  }

  limpar(): void {
    const t = this.agora();
    for (const [k, r] of this.emAndamento) {
      if (t - r.criadaEm > this.validadeMs) this.emAndamento.delete(k);
    }
    while (this.emAndamento.size > this.maxSimultaneas) {
      this.emAndamento.delete(this.emAndamento.keys().next().value as string);
    }
  }
}
