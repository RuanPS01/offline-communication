/**
 * IMA ADPCM (4 bits por amostra). É o codec de reserva: roda em qualquer
 * lugar, sem WASM nem WebCodecs. A 8 kHz dá 32 kbps, bom para Wi-Fi e rede
 * local. Cada quadro leva o estado do preditor no cabeçalho, então pode ser
 * decodificado sozinho mesmo se o anterior se perdeu.
 */

const TABELA_PASSO = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97,
  107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
  876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871,
  5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623,
  27086, 29794, 32767,
];

const TABELA_INDICE = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];

const TAM_CABECALHO = 3;

function limitar(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function paraInt16(amostra: number): number {
  return limitar(Math.round(amostra * 32767), -32768, 32767);
}

export function codificarAdpcm(pcm: Float32Array): Uint8Array {
  const saida = new Uint8Array(TAM_CABECALHO + Math.ceil(pcm.length / 2));
  let preditor = pcm.length ? paraInt16(pcm[0]!) : 0;
  let indice = 0;
  saida[0] = (preditor >> 8) & 0xff;
  saida[1] = preditor & 0xff;
  saida[2] = indice;
  for (let i = 0; i < pcm.length; i++) {
    const amostra = paraInt16(pcm[i]!);
    const passo = TABELA_PASSO[indice]!;
    let diferenca = amostra - preditor;
    let nibble = 0;
    if (diferenca < 0) {
      nibble = 8;
      diferenca = -diferenca;
    }
    let delta = passo >> 3;
    if (diferenca >= passo) {
      nibble |= 4;
      diferenca -= passo;
      delta += passo;
    }
    if (diferenca >= passo >> 1) {
      nibble |= 2;
      diferenca -= passo >> 1;
      delta += passo >> 1;
    }
    if (diferenca >= passo >> 2) {
      nibble |= 1;
      delta += passo >> 2;
    }
    preditor = limitar(nibble & 8 ? preditor - delta : preditor + delta, -32768, 32767);
    indice = limitar(indice + TABELA_INDICE[nibble]!, 0, 88);
    const pos = TAM_CABECALHO + (i >> 1);
    if (i & 1) saida[pos]! |= nibble << 4;
    else saida[pos] = nibble;
  }
  return saida;
}

export function decodificarAdpcm(dados: Uint8Array, amostras?: number): Float32Array {
  if (dados.length < TAM_CABECALHO) return new Float32Array(0);
  let preditor = ((dados[0]! << 8) | dados[1]!) << 16 >> 16;
  let indice = limitar(dados[2]!, 0, 88);
  const total = amostras ?? (dados.length - TAM_CABECALHO) * 2;
  const saida = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const byte = dados[TAM_CABECALHO + (i >> 1)] ?? 0;
    const nibble = i & 1 ? byte >> 4 : byte & 0x0f;
    const passo = TABELA_PASSO[indice]!;
    let delta = passo >> 3;
    if (nibble & 4) delta += passo;
    if (nibble & 2) delta += passo >> 1;
    if (nibble & 1) delta += passo >> 2;
    preditor = limitar(nibble & 8 ? preditor - delta : preditor + delta, -32768, 32767);
    indice = limitar(indice + TABELA_INDICE[nibble]!, 0, 88);
    saida[i] = preditor / 32768;
  }
  return saida;
}
