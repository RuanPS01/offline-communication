declare module 'ggwave' {
  interface ParametrosGgwave {
    payloadLength: number;
    sampleRateInp: number;
    sampleRateOut: number;
    sampleRate: number;
    samplesPerFrame: number;
    soundMarkerThreshold: number;
    sampleFormatInp: unknown;
    sampleFormatOut: unknown;
    operatingMode: number;
  }
  export interface ModuloGgwave {
    getDefaultParameters(): ParametrosGgwave;
    init(p: ParametrosGgwave): number;
    free(instancia: number): void;
    encode(instancia: number, dados: Uint8Array, protocolo: unknown, volume: number): Int8Array;
    decode(instancia: number, dados: Int8Array): Int8Array | null;
    disableLog(): void;
    SampleFormat: Record<string, unknown>;
    ProtocolId: Record<string, unknown>;
  }
  const fabrica: (opcoes?: Record<string, unknown>) => Promise<ModuloGgwave>;
  export default fabrica;
}
