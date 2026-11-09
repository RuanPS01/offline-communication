/**
 * Formatos das cargas de voz. O núcleo não decodifica áudio: só transporta
 * quadros já codificados (Opus, ADPCM...) e aplica as regras da malha.
 */

import { Escritor, Leitor, utf8 } from './bytes.ts';
import { TAM_ID } from './pacote.ts';
import { deHex, paraHex } from './bytes.ts';

export const CODEC_ADPCM = 1;
export const CODEC_OPUS = 2;
export const CODEC_CODEC2 = 3;

export interface InicioFala {
  sessao: number;
  codec: number;
}

export function codificarInicioFala(v: InicioFala): Uint8Array {
  return new Escritor().u16(v.sessao).u8(v.codec).resultado();
}

export function decodificarInicioFala(c: Uint8Array): InicioFala {
  const l = new Leitor(c);
  return { sessao: l.u16(), codec: l.u8() };
}

export interface FimFala {
  sessao: number;
  totalQuadros: number;
}

export function codificarFimFala(v: FimFala): Uint8Array {
  return new Escritor().u16(v.sessao).u16(v.totalQuadros).resultado();
}

export function decodificarFimFala(c: Uint8Array): FimFala {
  const l = new Leitor(c);
  return { sessao: l.u16(), totalQuadros: l.u16() };
}

export interface QuadroVoz {
  sessao: number;
  seq: number;
  codec: number;
  /** Áudio codificado (cifrado se o pacote tiver a flag CIFRADO). */
  dados: Uint8Array;
}

export function codificarQuadroVoz(v: QuadroVoz): Uint8Array {
  return new Escritor().u16(v.sessao).u16(v.seq).u8(v.codec).bytes(v.dados).resultado();
}

export function decodificarQuadroVoz(c: Uint8Array): QuadroVoz {
  const l = new Leitor(c);
  return { sessao: l.u16(), seq: l.u16(), codec: l.u8(), dados: l.resto() };
}

/** Mensagem de voz gravada: a fala inteira num pacote só, para store-and-forward. */
export interface MensagemVoz {
  /** Quem falou (pode ser diferente da origem do pacote, quando um repetidor converteu a fala ao vivo). */
  falante: string;
  sessao: number;
  codec: number;
  duracaoQuadroMs: number;
  quadros: { seq: number; dados: Uint8Array }[];
}

export function codificarMensagemVoz(v: MensagemVoz): Uint8Array {
  const e = new Escritor()
    .bytes(deHex(v.falante))
    .u16(v.sessao)
    .u8(v.codec)
    .u8(v.duracaoQuadroMs)
    .u16(v.quadros.length);
  for (const q of v.quadros) e.u16(q.seq).u16(q.dados.length).bytes(q.dados);
  return e.resultado();
}

export function decodificarMensagemVoz(c: Uint8Array): MensagemVoz {
  const l = new Leitor(c);
  const falante = paraHex(l.bytes(TAM_ID));
  const sessao = l.u16();
  const codec = l.u8();
  const duracaoQuadroMs = l.u8();
  const n = l.u16();
  const quadros: MensagemVoz['quadros'] = [];
  for (let i = 0; i < n; i++) {
    const seq = l.u16();
    quadros.push({ seq, dados: l.bytes(l.u16()) });
  }
  return { falante, sessao, codec, duracaoQuadroMs, quadros };
}

/** Dados autenticados de cada quadro cifrado: valem tanto ao vivo quanto na mensagem gravada. */
export function aadQuadroVoz(falante: string, sessao: number, seq: number): Uint8Array {
  return utf8(`voz|${falante}|${sessao}|${seq}`);
}
