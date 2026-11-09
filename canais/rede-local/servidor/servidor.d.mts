import type { WebSocket } from 'ws';

export interface ServidorRedeLocal {
  porta: number;
  enderecos: string[];
  clientes: Map<string, WebSocket>;
  fechar(): Promise<void>;
}

export declare function iniciarServidor(opcoes?: {
  pasta?: string;
  porta?: number;
  nome?: string;
  anunciarMdns?: boolean;
  host?: string;
}): Promise<ServidorRedeLocal>;

export declare function enderecosLocais(): string[];
