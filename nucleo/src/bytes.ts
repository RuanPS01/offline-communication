/**
 * Utilitários de bytes usados por todo o núcleo. Nada aqui depende de
 * navegador ou de Node: roda igual na PWA, no WebView dos apps e nos testes.
 */

const codificador = new TextEncoder();
const decodificador = new TextDecoder();

export function utf8(texto: string): Uint8Array {
  return codificador.encode(texto);
}

export function deUtf8(bytes: Uint8Array): string {
  return decodificador.decode(bytes);
}

export function paraHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function deHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new Error(`hex inválido: ${hex}`);
  }
  const saida = new Uint8Array(hex.length / 2);
  for (let i = 0; i < saida.length; i++) {
    saida[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return saida;
}

export function concatenar(...partes: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of partes) total += p.length;
  const saida = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    saida.set(p, pos);
    pos += p.length;
  }
  return saida;
}

export function iguais(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const ALFABETO_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const TABELA_B64 = new Map<string, number>([...ALFABETO_B64].map((c, i) => [c, i]));

/** Base64 sem depender de btoa/Buffer, para a ponte com o código nativo. */
export function paraBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const n = (a << 16) | (b << 8) | c;
    s += ALFABETO_B64[(n >> 18) & 63]! + ALFABETO_B64[(n >> 12) & 63]!;
    s += i + 1 < bytes.length ? ALFABETO_B64[(n >> 6) & 63]! : '=';
    s += i + 2 < bytes.length ? ALFABETO_B64[n & 63]! : '=';
  }
  return s;
}

export function deBase64(texto: string): Uint8Array {
  const limpo = texto.replace(/[\s=]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const saida = new Uint8Array(Math.floor((limpo.length * 3) / 4));
  let bits = 0;
  let acumulado = 0;
  let pos = 0;
  for (const ch of limpo) {
    const v = TABELA_B64.get(ch);
    if (v === undefined) throw new Error('base64 inválido');
    acumulado = (acumulado << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      saida[pos++] = (acumulado >> bits) & 0xff;
    }
  }
  return saida.subarray(0, pos);
}

/** Fonte de aleatoriedade criptográfica (disponível até em páginas sem HTTPS). */
export function bytesAleatorios(n: number): Uint8Array {
  const saida = new Uint8Array(n);
  globalThis.crypto.getRandomValues(saida);
  return saida;
}

/** Escrita sequencial de campos binários (big-endian). */
export class Escritor {
  private partes: number[] = [];

  u8(v: number): this {
    this.partes.push(v & 0xff);
    return this;
  }

  u16(v: number): this {
    return this.u8(v >>> 8).u8(v);
  }

  u32(v: number): this {
    return this.u8(v >>> 24).u8(v >>> 16).u8(v >>> 8).u8(v);
  }

  i32(v: number): this {
    return this.u32(v >>> 0);
  }

  bytes(b: Uint8Array): this {
    for (const x of b) this.partes.push(x);
    return this;
  }

  /** Texto curto: 1 byte de tamanho + UTF-8, cortado em `max` bytes sem quebrar caractere. */
  textoCurto(texto: string, max = 255): this {
    let b = utf8(texto);
    if (b.length > max) {
      let corte = max;
      // Não deixa um caractere UTF-8 pela metade.
      while (corte > 0 && (b[corte]! & 0xc0) === 0x80) corte--;
      b = b.subarray(0, corte);
    }
    return this.u8(b.length).bytes(b);
  }

  resultado(): Uint8Array {
    return Uint8Array.from(this.partes);
  }
}

export class ErroLeitura extends Error {}

/** Leitura sequencial de campos binários (big-endian), com checagem de limites. */
export class Leitor {
  private pos = 0;

  constructor(private readonly dados: Uint8Array) {}

  get restante(): number {
    return this.dados.length - this.pos;
  }

  private exigir(n: number): void {
    if (this.pos + n > this.dados.length) {
      throw new ErroLeitura(`faltam bytes: precisa de ${n}, restam ${this.restante}`);
    }
  }

  u8(): number {
    this.exigir(1);
    return this.dados[this.pos++]!;
  }

  u16(): number {
    return (this.u8() << 8) | this.u8();
  }

  u32(): number {
    return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0;
  }

  i32(): number {
    return this.u32() | 0;
  }

  bytes(n: number): Uint8Array {
    this.exigir(n);
    const b = this.dados.slice(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }

  textoCurto(): string {
    const n = this.u8();
    return deUtf8(this.bytes(n));
  }

  resto(): Uint8Array {
    return this.bytes(this.restante);
  }
}
