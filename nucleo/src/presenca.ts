/**
 * Presença: cada aparelho divulga de tempos em tempos quem é (apelido, canal
 * de conversa, posição e por quais canais está acessível). A tabela de
 * presença funde o que chega por canais diferentes numa pessoa só, pela
 * identidade, e guarda o melhor dado disponível de cada uma.
 */

import { BITS_DE_CANAL, type IdCanal } from './canal.ts';
import { Escritor, Leitor } from './bytes.ts';
import { idDaChavePublica } from './cripto.ts';

export interface Posicao {
  lat: number;
  lon: number;
  precisaoMetros?: number;
}

export interface DadosPresenca {
  chavePublica: Uint8Array;
  apelido: string;
  /** Nome do canal de conversa público em que a pessoa está. */
  canalConversa: string;
  canaisAcessiveis: IdCanal[];
  posicao?: Posicao;
  /** 0 a 100. */
  bateria?: number;
  /** Consegue decodificar voz em Opus. */
  suportaOpus: boolean;
  falando: boolean;
}

const P_TEM_POSICAO = 0x01;
const P_OPUS = 0x02;
const P_FALANDO = 0x04;
const P_TEM_BATERIA = 0x08;

export const TAM_MAX_APELIDO = 24;
export const TAM_MAX_NOME_CANAL = 16;

export function codificarPresenca(d: DadosPresenca): Uint8Array {
  let flags = 0;
  if (d.posicao) flags |= P_TEM_POSICAO;
  if (d.suportaOpus) flags |= P_OPUS;
  if (d.falando) flags |= P_FALANDO;
  if (d.bateria !== undefined) flags |= P_TEM_BATERIA;
  let mascara = 0;
  for (const c of d.canaisAcessiveis) {
    const i = BITS_DE_CANAL.indexOf(c);
    if (i >= 0) mascara |= 1 << i;
  }
  const e = new Escritor().bytes(d.chavePublica).u8(flags).u16(mascara);
  if (d.bateria !== undefined) e.u8(Math.max(0, Math.min(100, Math.round(d.bateria))));
  e.textoCurto(d.apelido, TAM_MAX_APELIDO).textoCurto(d.canalConversa, TAM_MAX_NOME_CANAL);
  if (d.posicao) {
    e.i32(Math.round(d.posicao.lat * 1e7));
    e.i32(Math.round(d.posicao.lon * 1e7));
    e.u16(Math.min(65535, Math.round(d.posicao.precisaoMetros ?? 0)));
  }
  return e.resultado();
}

export function decodificarPresenca(carga: Uint8Array): DadosPresenca {
  const l = new Leitor(carga);
  const chavePublica = l.bytes(32);
  const flags = l.u8();
  const mascara = l.u16();
  const bateria = flags & P_TEM_BATERIA ? l.u8() : undefined;
  const apelido = l.textoCurto();
  const canalConversa = l.textoCurto();
  let posicao: Posicao | undefined;
  if (flags & P_TEM_POSICAO) {
    const lat = l.i32() / 1e7;
    const lon = l.i32() / 1e7;
    const precisao = l.u16();
    posicao = { lat, lon, precisaoMetros: precisao || undefined };
  }
  const canaisAcessiveis = BITS_DE_CANAL.filter((_, i) => mascara & (1 << i));
  return {
    chavePublica,
    apelido,
    canalConversa,
    canaisAcessiveis,
    posicao,
    bateria,
    suportaOpus: !!(flags & P_OPUS),
    falando: !!(flags & P_FALANDO),
  };
}

export type ClasseDistancia = 'perto' | 'medio' | 'longe' | 'desconhecida';

export interface Avistamento {
  canal: IdCanal;
  saltos: number;
  rssi?: number;
  distanciaMetros?: number;
  ultimaVez: number;
}

export interface Pessoa {
  idNo: string;
  apelido: string;
  chavePublica?: Uint8Array;
  canalConversa?: string;
  canaisAcessiveis: IdCanal[];
  posicao?: Posicao;
  bateria?: number;
  suportaOpus: boolean;
  falando: boolean;
  /** Por quais canais a pessoa foi ouvida, e a quantos saltos. */
  vistoPor: Avistamento[];
  /** Menor número de saltos entre os canais. */
  saltos: number;
  ultimaVez: number;
  distancia: { classe: ClasseDistancia; metros?: number };
  /** Direção em graus (0 = norte), quando há posição dos dois lados. */
  rumo?: number;
}

interface Entrada {
  dados?: DadosPresenca;
  vistoPor: Map<IdCanal, Avistamento>;
  ultimaVez: number;
}

const RAIO_TERRA = 6_371_000;

export function distanciaEntre(a: Posicao, b: Posicao): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * RAIO_TERRA * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function rumoEntre(a: Posicao, b: Posicao): number {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * rad) * Math.cos(b.lat * rad);
  const x =
    Math.cos(a.lat * rad) * Math.sin(b.lat * rad) -
    Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lon - a.lon) * rad);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}

export function classePorMetros(m: number): ClasseDistancia {
  if (m < 30) return 'perto';
  if (m < 200) return 'medio';
  return 'longe';
}

/** RSSI dá só uma ideia: perto, médio ou longe. */
export function classePorRssi(rssi: number): ClasseDistancia {
  if (rssi >= -65) return 'perto';
  if (rssi >= -82) return 'medio';
  return 'longe';
}

export class TabelaPresenca {
  private entradas = new Map<string, Entrada>();

  constructor(
    private readonly agora: () => number = Date.now,
    /** Quanto tempo sem notícia até a pessoa sair do radar. */
    private readonly validadeMs = 120_000,
  ) {}

  /** Registra um pacote de presença. Devolve falso se a chave não bate com o id. */
  atualizar(idNo: string, dados: DadosPresenca, visto: Omit<Avistamento, 'ultimaVez'>): boolean {
    if (idDaChavePublica(dados.chavePublica) !== idNo) return false;
    const e: Entrada = this.entradas.get(idNo) ?? { vistoPor: new Map(), ultimaVez: 0 };
    e.dados = dados;
    this.entradas.set(idNo, e);
    this.marcarVisto(idNo, visto);
    return true;
  }

  /** Qualquer pacote ouvido de alguém atualiza por onde e a quantos saltos ele está. */
  marcarVisto(idNo: string, visto: Omit<Avistamento, 'ultimaVez'>): void {
    const e = this.entradas.get(idNo);
    if (!e) return;
    const t = this.agora();
    const anterior = e.vistoPor.get(visto.canal);
    const recente = anterior && t - anterior.ultimaVez < 15_000;
    e.vistoPor.set(visto.canal, {
      canal: visto.canal,
      // Dentro de uma janela curta, guarda o menor número de saltos visto.
      saltos: recente ? Math.min(anterior.saltos, visto.saltos) : visto.saltos,
      rssi: visto.rssi ?? (recente ? anterior.rssi : undefined),
      distanciaMetros: visto.distanciaMetros ?? (recente ? anterior.distanciaMetros : undefined),
      ultimaVez: t,
    });
    e.ultimaVez = t;
  }

  /** Atualiza sinal (RSSI/distância) informado pelo rádio para um vizinho já identificado. */
  atualizarSinal(idNo: string, canal: IdCanal, rssi?: number, distanciaMetros?: number): void {
    const e = this.entradas.get(idNo);
    const a = e?.vistoPor.get(canal);
    if (!a) return;
    if (rssi !== undefined) a.rssi = rssi;
    if (distanciaMetros !== undefined) a.distanciaMetros = distanciaMetros;
  }

  chavePublica(idNo: string): Uint8Array | undefined {
    return this.entradas.get(idNo)?.dados?.chavePublica;
  }

  apelido(idNo: string): string | undefined {
    return this.entradas.get(idNo)?.dados?.apelido;
  }

  conhece(idNo: string): boolean {
    return this.entradas.has(idNo);
  }

  /** Remove quem sumiu. Devolve verdadeiro se algo mudou. */
  limparExpirados(): boolean {
    const t = this.agora();
    let mudou = false;
    for (const [id, e] of this.entradas) {
      for (const [canal, a] of e.vistoPor) {
        if (t - a.ultimaVez > this.validadeMs) {
          e.vistoPor.delete(canal);
          mudou = true;
        }
      }
      if (e.vistoPor.size === 0 || t - e.ultimaVez > this.validadeMs) {
        this.entradas.delete(id);
        mudou = true;
      }
    }
    return mudou;
  }

  obter(idNo: string, minhaPosicao?: Posicao, alcance?: (c: IdCanal) => number): Pessoa | undefined {
    const e = this.entradas.get(idNo);
    if (!e?.dados) return undefined;
    return this.montarPessoa(idNo, e, minhaPosicao, alcance);
  }

  lista(minhaPosicao?: Posicao, alcance?: (c: IdCanal) => number): Pessoa[] {
    const pessoas: Pessoa[] = [];
    for (const [id, e] of this.entradas) {
      if (e.dados) pessoas.push(this.montarPessoa(id, e, minhaPosicao, alcance));
    }
    return pessoas.sort((a, b) => a.saltos - b.saltos || a.apelido.localeCompare(b.apelido));
  }

  private montarPessoa(
    idNo: string,
    e: Entrada,
    minhaPosicao?: Posicao,
    alcance?: (c: IdCanal) => number,
  ): Pessoa {
    const d = e.dados!;
    const vistoPor = [...e.vistoPor.values()].sort((a, b) => a.saltos - b.saltos);
    const saltos = vistoPor.length ? vistoPor[0]!.saltos : 15;
    let distancia: Pessoa['distancia'] = { classe: 'desconhecida' };
    let rumo: number | undefined;
    if (minhaPosicao && d.posicao) {
      const metros = distanciaEntre(minhaPosicao, d.posicao);
      distancia = { classe: classePorMetros(metros), metros };
      rumo = rumoEntre(minhaPosicao, d.posicao);
    } else {
      const diretos = vistoPor.filter((v) => v.saltos === 0);
      const medido = diretos.find((v) => v.distanciaMetros !== undefined);
      const comRssi = diretos.filter((v) => v.rssi !== undefined).sort((a, b) => b.rssi! - a.rssi!);
      if (medido) {
        distancia = { classe: classePorMetros(medido.distanciaMetros!), metros: medido.distanciaMetros };
      } else if (comRssi.length) {
        distancia = { classe: classePorRssi(comRssi[0]!.rssi!) };
      } else if (diretos.length && alcance) {
        const menor = Math.min(...diretos.map((v) => alcance(v.canal)));
        distancia = { classe: classePorMetros(menor), metros: menor <= 10 ? menor : undefined };
      } else if (saltos > 0) {
        distancia = { classe: 'longe' };
      }
    }
    return {
      idNo,
      apelido: d.apelido,
      chavePublica: d.chavePublica,
      canalConversa: d.canalConversa,
      canaisAcessiveis: d.canaisAcessiveis,
      posicao: d.posicao,
      bateria: d.bateria,
      suportaOpus: d.suportaOpus,
      falando: d.falando,
      vistoPor,
      saltos,
      ultimaVez: e.ultimaVez,
      distancia,
      rumo,
    };
  }
}
