/**
 * Mapa sem internet. Os recursos do mapa (estilo, fontes, pedaços) passam
 * por um protocolo "cache://" que guarda tudo no Cache Storage: o que foi
 * visto ou baixado antes continua disponível offline, na web e nos apps.
 */

export const ESTILO_MAPA = 'https://tiles.openfreemap.org/styles/liberty';
const NOME_CACHE = 'mapa-offline-v1';

export function paraCache(url: string): string {
  return url.startsWith('https://') ? `cache://${url.slice('https://'.length)}` : url;
}

export function deCache(url: string): string {
  return url.startsWith('cache://') ? `https://${url.slice('cache://'.length)}` : url;
}

export async function buscarComCache(url: string, sinal?: AbortSignal): Promise<Response> {
  const cache = typeof caches !== 'undefined' ? await caches.open(NOME_CACHE).catch(() => undefined) : undefined;
  const guardado = await cache?.match(url);
  if (guardado) return guardado;
  const resposta = await fetch(url, { signal: sinal });
  if (resposta.ok && cache) await cache.put(url, resposta.clone()).catch(() => undefined);
  return resposta;
}

/** Pedaços (x, y) que cobrem os limites num nível de zoom. */
export function pedacosNaArea(
  oeste: number,
  sul: number,
  leste: number,
  norte: number,
  z: number,
): { x: number; y: number; z: number }[] {
  const n = 2 ** z;
  const x = (lon: number) => Math.floor(((lon + 180) / 360) * n);
  const y = (lat: number) => {
    const r = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  };
  const lista: { x: number; y: number; z: number }[] = [];
  for (let i = x(oeste); i <= x(leste); i++) {
    for (let j = y(norte); j <= y(sul); j++) lista.push({ x: i, y: j, z });
  }
  return lista;
}

/** Baixa os pedaços da área para uso offline. Devolve quantos foram guardados. */
export async function baixarArea(
  modelos: string[],
  limites: [number, number, number, number],
  zoomInicial: number,
  zoomFinal: number,
  aoProgresso: (feitos: number, total: number) => void,
  maximo = 1500,
): Promise<number> {
  const pedacos = [];
  for (let z = zoomInicial; z <= zoomFinal; z++) pedacos.push(...pedacosNaArea(...limites, z));
  const lista = pedacos.slice(0, maximo);
  let feitos = 0;
  let guardados = 0;
  const fila = [...lista];
  const trabalhador = async () => {
    for (let p = fila.shift(); p; p = fila.shift()) {
      const modelo = modelos[(p.x + p.y) % modelos.length]!;
      const url = modelo.replace('{z}', String(p.z)).replace('{x}', String(p.x)).replace('{y}', String(p.y));
      try {
        if ((await buscarComCache(deCache(url))).ok) guardados++;
      } catch {
        // Sem rede para este pedaço: segue.
      }
      aoProgresso(++feitos, lista.length);
    }
  };
  await Promise.all([1, 2, 3, 4].map(trabalhador));
  return guardados;
}
