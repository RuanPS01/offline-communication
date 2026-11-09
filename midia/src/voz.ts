/**
 * Voz meio-duplex sobre o núcleo: captura, codifica e manda quadros ao vivo
 * enquanto o botão está apertado; do outro lado, decodifica, passa pelo
 * buffer de tremulação e toca. Também grava mensagens de voz para entrega
 * pela malha (store-and-forward).
 */

import {
  CODEC_ADPCM,
  CODEC_OPUS,
  type Conversa,
  Emissor,
  type EventoMensagemVoz,
  type Nucleo,
} from '@plataforma/nucleo';
import { BufferDeTremulacao } from './buffer.ts';
import { CapturaMicrofone, type OpcoesCaptura } from './captura.ts';
import {
  type CodificadorVoz,
  criarCodificador,
  criarDecodificador,
  type DecodificadorVoz,
  DURACAO_QUADRO_MS,
  suportaOpus,
} from './codec.ts';
import { ControlePtt, type EstadoPtt } from './ptt.ts';
import { Reprodutor } from './reproducao.ts';

export interface FonteAudio {
  iniciar(o: OpcoesCaptura): Promise<void>;
  parar(): Promise<void>;
}

export interface SaidaAudio {
  agendar(pcm: Float32Array, taxaAmostragem: number): void;
  readonly folga: number;
  destravar?(): Promise<void>;
  fechar?(): Promise<void>;
}

export interface MensagemVozGuardada {
  chave: string;
  de: string;
  apelido?: string;
  codec: number;
  duracaoQuadroMs: number;
  quadros: { seq: number; dados: Uint8Array }[];
  saltos: number;
  recebidaEm: number;
  conversa: Conversa;
  propria?: boolean;
}

export interface OpcoesVoz {
  criarFonte?: () => FonteAudio;
  saida?: SaidaAudio;
  agora?: () => number;
  /** Duração máxima de uma mensagem gravada. */
  maxGravacaoMs?: number;
}

interface Recepcao {
  decodificador: DecodificadorVoz;
  buffer: BufferDeTremulacao<Float32Array>;
  terminou: boolean;
  ultimaAtividade: number;
}

interface Transmissao {
  sessao: number;
  codec: number;
  seq: number;
  codificador: CodificadorVoz;
  fonte: FonteAudio;
}

interface Gravacao {
  codec: number;
  quadros: Uint8Array[];
  codificador: CodificadorVoz;
  fonte: FonteAudio;
  inicio: number;
}

type EventosVoz = {
  nivel: number;
  mensagens: MensagemVozGuardada[];
  erro: string;
};

export class Voz {
  readonly ptt: ControlePtt;
  readonly mensagens: MensagemVozGuardada[] = [];
  private opusLocal = false;
  private transmissao?: Transmissao;
  private gravacao?: Gravacao;
  private recepcoes = new Map<string, Recepcao>();
  private relogio?: ReturnType<typeof setInterval>;
  private desinscrever: (() => void)[] = [];
  private readonly emissor = new Emissor<EventosVoz>();
  private readonly saida: SaidaAudio;
  private readonly agora: () => number;

  constructor(
    private readonly nucleo: Nucleo,
    private readonly opcoes: OpcoesVoz = {},
  ) {
    this.agora = opcoes.agora ?? Date.now;
    this.ptt = new ControlePtt(nucleo.idNo, this.agora);
    this.saida = opcoes.saida ?? new Reprodutor();
  }

  on<K extends keyof EventosVoz>(evento: K, fn: (v: EventosVoz[K]) => void): () => void {
    return this.emissor.on(evento, fn);
  }

  private emitir<K extends keyof EventosVoz>(evento: K, v: EventosVoz[K]): void {
    this.emissor.emitir(evento, v);
  }

  aoMudarPtt(fn: (e: EstadoPtt) => void): () => void {
    return this.ptt.aoMudar(fn);
  }

  async preparar(): Promise<void> {
    this.opusLocal = await suportaOpus();
    this.nucleo.definirSuporteOpus(this.opusLocal);
    this.desinscrever.push(
      this.nucleo.on('inicioFala', (f) => {
        if (this.ptt.outroComecou(f.de, f.sessao, f.apelido) === 'ceder') void this.soltar();
        this.abrirRecepcao(f.de, f.sessao, f.codec);
      }),
      this.nucleo.on('quadroVoz', (q) => {
        this.ptt.atividade(q.de, q.sessao);
        const r = this.abrirRecepcao(q.de, q.sessao, q.codec);
        r.ultimaAtividade = this.agora();
        r.decodificador
          .decodificar(q.dados)
          .then((pcm) => r.buffer.inserir(q.seq, pcm))
          .catch((e) => this.emitir('erro', `falha ao decodificar voz: ${e}`));
      }),
      this.nucleo.on('fimFala', (f) => {
        this.ptt.outroTerminou(f.de, f.sessao);
        const r = this.recepcoes.get(`${f.de}:${f.sessao}`);
        if (r) r.terminou = true;
      }),
      this.nucleo.on('mensagemVoz', (m) => this.guardarMensagem(m)),
    );
    this.relogio = setInterval(() => this.tique(), 30);
  }

  /** Há canal à altura de voz ao vivo? Só então o botão de falar aparece. */
  vozAoVivoDisponivel(): boolean {
    return this.nucleo.estadoCanais().some((c) => c.ativo && c.capacidades.aoVivo);
  }

  /** Opus só se todos os vizinhos próximos conseguem decodificar. */
  escolherCodec(): number {
    if (!this.opusLocal) return CODEC_ADPCM;
    const proximos = this.nucleo.pessoas().filter((p) => p.saltos <= 1);
    return proximos.every((p) => p.suportaOpus) ? CODEC_OPUS : CODEC_ADPCM;
  }

  get transmitindo(): boolean {
    return !!this.transmissao;
  }

  get gravando(): boolean {
    return !!this.gravacao;
  }

  /** Apertou o botão. Devolve falso se o canal está ocupado. */
  async apertar(): Promise<boolean> {
    if (this.transmissao || this.gravacao || !this.ptt.podeFalar()) return false;
    await this.saida.destravar?.();
    const codec = this.escolherCodec();
    const fonte = (this.opcoes.criarFonte ?? (() => new CapturaMicrofone()))();
    const t: Partial<Transmissao> = { codec, seq: 0, fonte };
    const codificador = criarCodificador(codec, (dados) => {
      if (!this.transmissao) return;
      this.nucleo.enviarQuadroVoz(this.transmissao.sessao, this.transmissao.seq++ & 0xffff, codec, dados);
    });
    t.codificador = codificador;
    t.sessao = this.nucleo.iniciarFala(codec);
    this.transmissao = t as Transmissao;
    this.ptt.euComecei(t.sessao);
    try {
      await fonte.iniciar({
        taxaAmostragem: codificador.taxaAmostragem,
        amostrasPorQuadro: codificador.amostrasPorQuadro,
        aoQuadro: (pcm) => codificador.empurrar(pcm),
        aoNivel: (n) => this.emitir('nivel', n),
      });
    } catch (e) {
      this.emitir('erro', `microfone indisponível: ${e instanceof Error ? e.message : e}`);
      await this.soltar();
      return false;
    }
    return true;
  }

  /** Soltou o botão. */
  async soltar(): Promise<void> {
    const t = this.transmissao;
    if (!t) return;
    await t.fonte.parar().catch(() => undefined);
    await t.codificador.esvaziar().catch(() => undefined);
    t.codificador.fechar();
    this.transmissao = undefined;
    this.nucleo.terminarFala(t.sessao, t.seq);
    this.ptt.euTerminei();
    this.emitir('nivel', 0);
  }

  /** Começa a gravar uma mensagem de voz (não precisa de canal ao vivo). */
  async iniciarGravacao(): Promise<boolean> {
    if (this.transmissao || this.gravacao) return false;
    // Mensagem gravada atravessa muitos saltos: só Opus se o aparelho tiver.
    const codec = this.opusLocal ? CODEC_OPUS : CODEC_ADPCM;
    const quadros: Uint8Array[] = [];
    const codificador = criarCodificador(codec, (d) => quadros.push(d));
    const fonte = (this.opcoes.criarFonte ?? (() => new CapturaMicrofone()))();
    this.gravacao = { codec, quadros, codificador, fonte, inicio: this.agora() };
    const max = this.opcoes.maxGravacaoMs ?? 30_000;
    try {
      await fonte.iniciar({
        taxaAmostragem: codificador.taxaAmostragem,
        amostrasPorQuadro: codificador.amostrasPorQuadro,
        aoQuadro: (pcm) => {
          if (this.gravacao && this.agora() - this.gravacao.inicio < max) codificador.empurrar(pcm);
        },
        aoNivel: (n) => this.emitir('nivel', n),
      });
    } catch (e) {
      this.gravacao = undefined;
      this.emitir('erro', `microfone indisponível: ${e instanceof Error ? e.message : e}`);
      return false;
    }
    return true;
  }

  async terminarGravacao(enviar = true): Promise<void> {
    const g = this.gravacao;
    if (!g) return;
    this.gravacao = undefined;
    await g.fonte.parar().catch(() => undefined);
    await g.codificador.esvaziar().catch(() => undefined);
    g.codificador.fechar();
    this.emitir('nivel', 0);
    if (!enviar || !g.quadros.length) return;
    const estado = await this.nucleo.enviarMensagemVoz(g.codec, DURACAO_QUADRO_MS, g.quadros);
    const c = this.nucleo.conversaAtual;
    this.mensagens.push({
      chave: estado.chave,
      de: this.nucleo.idNo,
      apelido: this.nucleo.apelido,
      codec: g.codec,
      duracaoQuadroMs: DURACAO_QUADRO_MS,
      quadros: g.quadros.map((dados, seq) => ({ seq, dados })),
      saltos: 0,
      recebidaEm: this.agora(),
      conversa: { tipo: 'canal', id: c.id, nome: c.nome, privado: c.privado },
      propria: true,
    });
    this.emitir('mensagens', [...this.mensagens]);
  }

  /** Toca uma mensagem de voz guardada. */
  async tocar(m: MensagemVozGuardada): Promise<void> {
    await this.saida.destravar?.();
    const dec = criarDecodificador(m.codec);
    try {
      for (const q of [...m.quadros].sort((a, b) => a.seq - b.seq)) {
        this.saida.agendar(await dec.decodificar(q.dados), dec.taxaAmostragem);
      }
    } finally {
      dec.fechar();
    }
  }

  async destruir(): Promise<void> {
    await this.soltar();
    await this.terminarGravacao(false);
    if (this.relogio) clearInterval(this.relogio);
    for (const d of this.desinscrever) d();
    for (const r of this.recepcoes.values()) r.decodificador.fechar();
    this.recepcoes.clear();
    await this.saida.fechar?.();
  }

  private guardarMensagem(m: EventoMensagemVoz): void {
    this.mensagens.push({
      chave: m.chave,
      de: m.de,
      apelido: m.apelido,
      codec: m.codec,
      duracaoQuadroMs: m.duracaoQuadroMs,
      quadros: m.quadros,
      saltos: m.saltos,
      recebidaEm: this.agora(),
      conversa: m.conversa,
    });
    while (this.mensagens.length > 50) this.mensagens.shift();
    this.emitir('mensagens', [...this.mensagens]);
  }

  private abrirRecepcao(de: string, sessao: number, codec: number): Recepcao {
    const k = `${de}:${sessao}`;
    let r = this.recepcoes.get(k);
    if (!r) {
      r = {
        decodificador: criarDecodificador(codec),
        buffer: new BufferDeTremulacao<Float32Array>(DURACAO_QUADRO_MS, 200),
        terminou: false,
        ultimaAtividade: this.agora(),
      };
      this.recepcoes.set(k, r);
    }
    return r;
  }

  private tique(): void {
    this.ptt.verificarSilencio();
    const t = this.agora();
    for (const [k, r] of this.recepcoes) {
      while (this.saida.folga < 0.15) {
        const q = r.buffer.retirar();
        if (q === undefined) break;
        if (q === null) {
          // Quadro perdido: um pouco de silêncio no lugar.
          this.saida.agendar(new Float32Array((r.decodificador.taxaAmostragem * DURACAO_QUADRO_MS) / 1000), r.decodificador.taxaAmostragem);
        } else {
          this.saida.agendar(q, r.decodificador.taxaAmostragem);
        }
      }
      if ((r.terminou && r.buffer.vazio) || t - r.ultimaAtividade > 10_000) {
        r.decodificador.fechar();
        this.recepcoes.delete(k);
      }
    }
  }
}
