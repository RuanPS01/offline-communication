export interface InfoServidor {
  servico: 'sobrevivencia';
  versao: number;
  nome: string;
  wsCaminho?: string;
  wsPorta?: number;
  clientes?: number;
}
export declare const SERVICO_MDNS: string;
export declare const NOME_SERVICO: string;
export declare const CAMINHO_INFO: string;
export declare const CAMINHO_WS: string;
export declare const PORTA_PADRAO: number;
export declare const VERSAO_REDE_LOCAL: number;
export declare function emoldurar(id: string, pacote: Uint8Array): Uint8Array;
export declare function desemoldurar(quadro: Uint8Array): { id: string; pacote: Uint8Array };
export declare function urlWebSocket(base: string, info: { wsCaminho?: string; wsPorta?: number }): string;
