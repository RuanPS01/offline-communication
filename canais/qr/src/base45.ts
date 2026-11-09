/**
 * Base45 (RFC 9285). Usa só o alfabeto do modo alfanumérico do QR, que é
 * quase tão compacto quanto o modo binário e sobrevive intacto aos leitores
 * (BarcodeDetector e jsQR devolvem texto, o que estraga bytes arbitrários).
 */

const ALFABETO = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const VALOR = new Map([...ALFABETO].map((c, i) => [c, i]));

export function codificarBase45(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    let n = bytes[i]! * 256 + bytes[i + 1]!;
    const c = n % 45;
    n = (n - c) / 45;
    const d = n % 45;
    const e = (n - d) / 45;
    s += ALFABETO[c]! + ALFABETO[d]! + ALFABETO[e]!;
  }
  if (bytes.length % 2) {
    const n = bytes[bytes.length - 1]!;
    s += ALFABETO[n % 45]! + ALFABETO[Math.floor(n / 45)]!;
  }
  return s;
}

export function decodificarBase45(texto: string): Uint8Array {
  const saida: number[] = [];
  const valor = (ch: string) => {
    const v = VALOR.get(ch);
    if (v === undefined) throw new Error(`caractere inválido em base45: "${ch}"`);
    return v;
  };
  for (let i = 0; i < texto.length; i += 3) {
    const resto = texto.length - i;
    if (resto >= 3) {
      const n = valor(texto[i]!) + valor(texto[i + 1]!) * 45 + valor(texto[i + 2]!) * 2025;
      if (n > 0xffff) throw new Error('base45 fora do intervalo');
      saida.push(n >> 8, n & 0xff);
    } else if (resto === 2) {
      const n = valor(texto[i]!) + valor(texto[i + 1]!) * 45;
      if (n > 0xff) throw new Error('base45 fora do intervalo');
      saida.push(n);
    } else {
      throw new Error('base45 com tamanho inválido');
    }
  }
  return Uint8Array.from(saida);
}
