/**
 * Modo teste de campo: um aparelho manda mensagens numeradas de tempos em
 * tempos; os outros registram o que chegou, por qual canal, a quantos saltos
 * e com que atraso. Dá para medir alcance real, perda e latência em campo
 * aberto e em prédio, e exportar em CSV.
 */

import type { MensagemRecebida, Nucleo } from '@plataforma/nucleo';

export const PREFIXO_TESTE = '[teste]';

export interface RegistroTeste {
  origem: string;
  apelido?: string;
  numero: number;
  enviadoEm: number;
  recebidoEm: number;
  canal: string;
  saltos: number;
  posicao?: string;
}

export class TesteDeCampo {
  registros: RegistroTeste[] = [];
  enviados = 0;
  private temporizador?: ReturnType<typeof setInterval>;
  private ouvintes = new Set<() => void>();

  get ativo(): boolean {
    return !!this.temporizador;
  }

  observar(fn: () => void): () => void {
    this.ouvintes.add(fn);
    return () => this.ouvintes.delete(fn);
  }

  private avisar(): void {
    for (const fn of this.ouvintes) fn();
  }

  iniciar(nucleo: Nucleo, intervaloS: number): void {
    this.parar();
    this.enviados = 0;
    const enviar = () => {
      this.enviados++;
      // O carimbo vai no texto em milissegundos, para medir o atraso.
      void nucleo.enviarTexto(`${PREFIXO_TESTE} #${this.enviados} ${Date.now()}`);
      this.avisar();
    };
    enviar();
    this.temporizador = setInterval(enviar, intervaloS * 1000);
  }

  parar(): void {
    if (this.temporizador) clearInterval(this.temporizador);
    this.temporizador = undefined;
    this.avisar();
  }

  /** Devolve verdadeiro se a mensagem era de teste (e não vai para a conversa). */
  registrar(m: MensagemRecebida, posicao?: { lat: number; lon: number }): boolean {
    if (!m.texto.startsWith(PREFIXO_TESTE)) return false;
    const r = /#(\d+)\s+(\d+)/.exec(m.texto);
    if (!r) return true;
    this.registros.push({
      origem: m.de,
      apelido: m.apelido,
      numero: Number(r[1]),
      enviadoEm: Number(r[2]),
      recebidoEm: Date.now(),
      canal: m.viaCanal,
      saltos: m.saltos,
      posicao: posicao ? `${posicao.lat.toFixed(6)} ${posicao.lon.toFixed(6)}` : undefined,
    });
    this.avisar();
    return true;
  }

  resumo(): { recebidas: number; perdidas: number; latenciaMedianaMs?: number } {
    const porOrigem = new Map<string, number[]>();
    for (const r of this.registros) porOrigem.set(r.origem, [...(porOrigem.get(r.origem) ?? []), r.numero]);
    let perdidas = 0;
    for (const nums of porOrigem.values()) {
      const max = Math.max(...nums);
      const min = Math.min(...nums);
      perdidas += max - min + 1 - new Set(nums).size;
    }
    const lat = this.registros.map((r) => r.recebidoEm - r.enviadoEm).sort((a, b) => a - b);
    return {
      recebidas: this.registros.length,
      perdidas,
      latenciaMedianaMs: lat.length ? lat[Math.floor(lat.length / 2)] : undefined,
    };
  }

  csv(): string {
    const linhas = ['origem;apelido;numero;enviado_em;recebido_em;latencia_ms;canal;saltos;posicao'];
    for (const r of this.registros) {
      linhas.push(
        [r.origem, r.apelido ?? '', r.numero, r.enviadoEm, r.recebidoEm, r.recebidoEm - r.enviadoEm, r.canal, r.saltos, r.posicao ?? ''].join(';'),
      );
    }
    return linhas.join('\n');
  }

  limpar(): void {
    this.registros = [];
    this.avisar();
  }
}
