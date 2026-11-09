/**
 * Formato binário do pacote, igual em todos os canais. Pensado para caber
 * num anúncio BLE, numa transmissão de som (ggwave, até 140 bytes) ou num QR.
 *
 *   byte 0      versão (4 bits altos) | tipo (4 bits baixos)
 *   byte 1      flags
 *   byte 2      ttl (4 bits altos) | saltos (4 bits baixos)
 *   bytes 3-8   id da mensagem (6 bytes aleatórios)
 *   bytes 9-14  origem (6 bytes: início do SHA-256 da chave pública)
 *   bytes 15-18 carimbo de tempo (segundos desde 1970, uint32)
 *   [6 bytes]   alvo (canal de conversa ou nó), se a flag TEM_ALVO estiver ligada
 *   [...]       carga útil
 *   [64 bytes]  assinatura Ed25519, se a flag ASSINADO estiver ligada
 *
 * A assinatura cobre o pacote inteiro com ttl e saltos zerados, porque esses
 * dois campos mudam a cada retransmissão.
 */

import { deHex, Escritor, Leitor, paraHex } from './bytes.ts';

export const VERSAO_PROTOCOLO = 1;
export const TAM_ID = 6;
export const TAM_ASSINATURA = 64;
export const TAM_CABECALHO = 3 + TAM_ID + TAM_ID + 4;
export const TTL_MAXIMO = 15;

export enum TipoPacote {
  Presenca = 0,
  Texto = 1,
  InicioFala = 2,
  FimFala = 3,
  VozQuadro = 4,
  VozMensagem = 5,
  Confirmacao = 6,
  Fragmento = 7,
}

export const FLAG = {
  ASSINADO: 0x01,
  CIFRADO: 0x02,
  TEM_ALVO: 0x04,
  /** O alvo é um nó (conversa privada). Sem esta flag, o alvo é um canal de conversa. */
  ALVO_NO: 0x08,
  /** O remetente quer confirmação de entrega. */
  PEDE_CONFIRMACAO: 0x10,
} as const;

export interface Pacote {
  versao: number;
  tipo: TipoPacote;
  flags: number;
  ttl: number;
  saltos: number;
  /** 12 caracteres hex. */
  id: string;
  /** 12 caracteres hex: id do nó de origem. */
  origem: string;
  /** Segundos desde 1970. */
  carimbo: number;
  /** 12 caracteres hex, presente se `flags & TEM_ALVO`. */
  alvo?: string;
  carga: Uint8Array;
  assinatura?: Uint8Array;
}

export class ErroPacote extends Error {}

function validarIdHex(nome: string, valor: string | undefined): void {
  if (!valor || valor.length !== TAM_ID * 2) {
    throw new ErroPacote(`${nome} deve ter ${TAM_ID * 2} caracteres hex`);
  }
}

function escreverCabecalho(e: Escritor, p: Pacote, ttl: number, saltos: number, flags: number): void {
  validarIdHex('id', p.id);
  validarIdHex('origem', p.origem);
  e.u8(((p.versao & 0x0f) << 4) | (p.tipo & 0x0f));
  e.u8(flags);
  e.u8(((Math.min(ttl, TTL_MAXIMO) & 0x0f) << 4) | (Math.min(saltos, 15) & 0x0f));
  e.bytes(deHex(p.id));
  e.bytes(deHex(p.origem));
  e.u32(p.carimbo >>> 0);
  if (flags & FLAG.TEM_ALVO) {
    validarIdHex('alvo', p.alvo);
    e.bytes(deHex(p.alvo!));
  }
}

function flagsNormalizadas(p: Pacote): number {
  let flags = p.flags;
  if (p.alvo) flags |= FLAG.TEM_ALVO;
  else flags &= ~(FLAG.TEM_ALVO | FLAG.ALVO_NO);
  if (p.assinatura) flags |= FLAG.ASSINADO;
  return flags;
}

export function codificarPacote(p: Pacote): Uint8Array {
  const flags = flagsNormalizadas(p);
  const e = new Escritor();
  escreverCabecalho(e, p, p.ttl, p.saltos, flags);
  e.bytes(p.carga);
  if (flags & FLAG.ASSINADO) {
    if (!p.assinatura || p.assinatura.length !== TAM_ASSINATURA) {
      throw new ErroPacote('assinatura ausente ou com tamanho errado');
    }
    e.bytes(p.assinatura);
  }
  return e.resultado();
}

/** Bytes cobertos pela assinatura: o pacote com ttl e saltos zerados, sem a assinatura. */
export function bytesAssinaveis(p: Pacote): Uint8Array {
  const flags = flagsNormalizadas(p) | FLAG.ASSINADO;
  const e = new Escritor();
  escreverCabecalho(e, p, 0, 0, flags);
  e.bytes(p.carga);
  return e.resultado();
}

export function decodificarPacote(dados: Uint8Array): Pacote {
  if (dados.length < TAM_CABECALHO) throw new ErroPacote('pacote curto demais');
  const l = new Leitor(dados);
  const b0 = l.u8();
  const versao = b0 >> 4;
  const tipo = b0 & 0x0f;
  if (versao !== VERSAO_PROTOCOLO) throw new ErroPacote(`versão ${versao} não suportada`);
  if (!(tipo in TipoPacote)) throw new ErroPacote(`tipo ${tipo} desconhecido`);
  const flags = l.u8();
  const b2 = l.u8();
  const id = paraHex(l.bytes(TAM_ID));
  const origem = paraHex(l.bytes(TAM_ID));
  const carimbo = l.u32();
  let alvo: string | undefined;
  if (flags & FLAG.TEM_ALVO) alvo = paraHex(l.bytes(TAM_ID));
  const tamAssinatura = flags & FLAG.ASSINADO ? TAM_ASSINATURA : 0;
  if (l.restante < tamAssinatura) throw new ErroPacote('assinatura truncada');
  const carga = l.bytes(l.restante - tamAssinatura);
  const assinatura = tamAssinatura ? l.bytes(TAM_ASSINATURA) : undefined;
  return {
    versao,
    tipo: tipo as TipoPacote,
    flags,
    ttl: b2 >> 4,
    saltos: b2 & 0x0f,
    id,
    origem,
    carimbo,
    alvo,
    carga,
    assinatura,
  };
}

/** Chave usada na deduplicação: quem já viu descarta. */
export function chaveDedup(p: Pick<Pacote, 'origem' | 'id'>): string {
  return `${p.origem}:${p.id}`;
}

export function tamanhoCodificado(p: Pacote): number {
  return (
    TAM_CABECALHO +
    (p.alvo ? TAM_ID : 0) +
    p.carga.length +
    (p.assinatura || p.flags & FLAG.ASSINADO ? TAM_ASSINATURA : 0)
  );
}

export function nomeDoTipo(t: TipoPacote): string {
  return TipoPacote[t] ?? `tipo-${t}`;
}
