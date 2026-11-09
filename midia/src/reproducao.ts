/** Toca quadros PCM em sequência, sem buracos entre eles. */
export class Reprodutor {
  private contexto?: AudioContext;
  private proximoInicio = 0;

  private garantirContexto(): AudioContext {
    if (!this.contexto || this.contexto.state === 'closed') {
      this.contexto = new AudioContext();
      this.proximoInicio = 0;
    }
    if (this.contexto.state === 'suspended') void this.contexto.resume();
    return this.contexto;
  }

  /** Destrava o áudio (navegadores exigem um gesto do usuário). */
  async destravar(): Promise<void> {
    await this.garantirContexto().resume();
  }

  agendar(pcm: Float32Array, taxaAmostragem: number): void {
    if (!pcm.length) return;
    const ctx = this.garantirContexto();
    const buffer = ctx.createBuffer(1, pcm.length, taxaAmostragem);
    buffer.copyToChannel(new Float32Array(pcm), 0);
    const fonte = ctx.createBufferSource();
    fonte.buffer = buffer;
    fonte.connect(ctx.destination);
    const inicio = Math.max(ctx.currentTime + 0.02, this.proximoInicio);
    fonte.start(inicio);
    this.proximoInicio = inicio + buffer.duration;
  }

  silencio(ms: number, taxaAmostragem = 8000): void {
    this.agendar(new Float32Array(Math.round((taxaAmostragem * ms) / 1000)), taxaAmostragem);
  }

  /** Segundos de áudio já agendados à frente. */
  get folga(): number {
    if (!this.contexto) return 0;
    return Math.max(0, this.proximoInicio - this.contexto.currentTime);
  }

  async fechar(): Promise<void> {
    await this.contexto?.close().catch(() => undefined);
    this.contexto = undefined;
  }
}
