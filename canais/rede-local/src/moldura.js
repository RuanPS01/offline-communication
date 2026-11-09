// Protocolo da rede local, compartilhado pelo cliente web (TypeScript), pelo
// servidor Node e documentado para os servidores nativos (Kotlin e Swift).
//
// HTTP  GET /api/info  devolve InfoServidor em JSON.
// WS    /ws            quadros binários levam pacotes do núcleo:
//   cliente para servidor: [n: u8][destino: n bytes ASCII, vazio = todos][pacote]
//   servidor para cliente: [n: u8][origem: n bytes ASCII][pacote]
// Quadros de texto são JSON de controle:
//   {"tipo":"boas-vindas","id":"c3","nome":"..."}
//   {"tipo":"vizinho","id":"c5","presente":true}

export const SERVICO_MDNS = '_sobrevivencia._tcp';
export const NOME_SERVICO = 'sobrevivencia';
export const CAMINHO_INFO = '/api/info';
export const CAMINHO_WS = '/ws';
export const PORTA_PADRAO = 8080;
export const VERSAO_REDE_LOCAL = 1;

/**
 * @param {string} id
 * @param {Uint8Array} pacote
 * @returns {Uint8Array}
 */
export function emoldurar(id, pacote) {
  const idBytes = new TextEncoder().encode(id.slice(0, 255));
  const saida = new Uint8Array(1 + idBytes.length + pacote.length);
  saida[0] = idBytes.length;
  saida.set(idBytes, 1);
  saida.set(pacote, 1 + idBytes.length);
  return saida;
}

/**
 * @param {Uint8Array} quadro
 * @returns {{ id: string, pacote: Uint8Array }}
 */
export function desemoldurar(quadro) {
  if (quadro.length < 1) throw new Error('quadro vazio');
  const n = quadro[0];
  if (quadro.length < 1 + n) throw new Error('quadro truncado');
  return {
    id: new TextDecoder().decode(quadro.subarray(1, 1 + n)),
    pacote: quadro.subarray(1 + n),
  };
}

/**
 * Monta a URL do WebSocket a partir da página e da informação do servidor.
 * @param {string} base URL da página (ex.: http://192.168.43.1:8080/)
 * @param {{ wsCaminho?: string, wsPorta?: number }} info
 */
export function urlWebSocket(base, info) {
  const u = new URL(base);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  if (info.wsPorta) u.port = String(info.wsPorta);
  u.pathname = info.wsCaminho ?? CAMINHO_WS;
  u.search = '';
  u.hash = '';
  return u.toString();
}
