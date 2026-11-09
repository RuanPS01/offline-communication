/**
 * O núcleo: a única peça que decide o que fazer com uma mensagem. Os canais
 * só carregam bytes e avisam quem apareceu por perto; os clientes só falam
 * com o núcleo.
 */

import type { Armazenamento } from './armazenamento.ts';
import { bytesAleatorios, deHex, deUtf8, paraHex, utf8 } from './bytes.ts';
import { type Canal, type Capacidades, type IdCanal, type Vizinho } from './canal.ts';
import {
  assinarPacote,
  canalPrivado,
  canalPublico,
  type CanalConversa,
  chaveEntrePares,
  cifrar,
  dadosAssociados,
  decifrar,
  type Identidade,
  impressaoDigital,
  NOME_CANAL_GERAL,
  novaIdentidade,
  verificarPacote,
} from './cripto.ts';
import { Emissor } from './eventos.ts';
import { Fila } from './fila.ts';
import {
  CacheVistos,
  fragmentar,
  indiceDoFragmento,
  LIMITE_SALTOS_VOZ_AO_VIVO,
  podeRetransmitir,
  proximoSalto,
  Remontador,
  TTL_PADRAO,
} from './malha.ts';
import {
  chaveDedup,
  codificarPacote,
  decodificarPacote,
  FLAG,
  type Pacote,
  TAM_ID,
  TipoPacote,
  VERSAO_PROTOCOLO,
} from './pacote.ts';
import {
  codificarPresenca,
  decodificarPresenca,
  type Pessoa,
  type Posicao,
  TabelaPresenca,
} from './presenca.ts';
import {
  escolherCanais,
  type EstadoCanalRoteamento,
  type PedidoRota,
  proximoCanalEscalonamento,
  VAZAO_MINIMA_RAPIDO,
} from './roteador.ts';
import {
  aadQuadroVoz,
  codificarFimFala,
  codificarInicioFala,
  codificarMensagemVoz,
  codificarQuadroVoz,
  decodificarFimFala,
  decodificarInicioFala,
  decodificarMensagemVoz,
  decodificarQuadroVoz,
} from './voz.ts';

export interface OpcoesNucleo {
  apelido: string;
  identidade?: Identidade;
  armazenamento?: Armazenamento;
  /** TTL das mensagens (3 a 5 no plano). */
  ttlPadrao?: number;
  intervaloPresencaMs?: number;
  /** Quanto esperar por eco ou confirmação antes de tentar outro canal. */
  esperaEscalonamentoMs?: number;
  /** Atraso aleatório antes de retransmitir, para reduzir colisões. */
  atrasoRepasseMs?: [number, number];
  assinarMensagens?: boolean;
  /** Este aparelho decodifica Opus? Vai na presença para os outros escolherem o codec. */
  suportaOpus?: boolean;
  agora?: () => number;
}

export type Conversa =
  | { tipo: 'canal'; id: string; nome: string; privado: boolean }
  | { tipo: 'privada'; com: string };

export interface MensagemRecebida {
  id: string;
  chave: string;
  de: string;
  apelido?: string;
  texto: string;
  conversa: Conversa;
  saltos: number;
  viaCanal: IdCanal;
  /** Verdadeiro se a assinatura conferiu; indefinido se não havia como conferir. */
  verificada?: boolean;
  cifrada: boolean;
  /** Milissegundos desde 1970 (carimbo do remetente). */
  carimbo: number;
  /** Texto chegou por um canal só de texto (Morse), sem identidade. */
  anonima?: boolean;
}

export type EstadoEnvio = 'pendente' | 'enviada' | 'ouvida' | 'entregue';

export interface EstadoMensagemPropria {
  id: string;
  chave: string;
  estado: EstadoEnvio;
  canais: IdCanal[];
}

export interface EstadoCanal {
  id: IdCanal;
  nome: string;
  capacidades: Capacidades;
  ativo: boolean;
  disponivel?: boolean;
  vizinhos: number;
  erro?: string;
}

export interface EventoInicioFala {
  de: string;
  apelido?: string;
  sessao: number;
  codec: number;
  saltos: number;
  conversa: Conversa;
}

export interface EventoQuadroVoz {
  de: string;
  sessao: number;
  seq: number;
  codec: number;
  dados: Uint8Array;
  saltos: number;
}

export interface EventoMensagemVoz {
  chave: string;
  de: string;
  apelido?: string;
  sessao: number;
  codec: number;
  duracaoQuadroMs: number;
  quadros: { seq: number; dados: Uint8Array }[];
  saltos: number;
  viaCanal: IdCanal;
  conversa: Conversa;
}

export interface EventosNucleo {
  mensagem: MensagemRecebida;
  estadoMensagem: EstadoMensagemPropria;
  pessoas: Pessoa[];
  canais: EstadoCanal[];
  inicioFala: EventoInicioFala;
  fimFala: { de: string; sessao: number };
  quadroVoz: EventoQuadroVoz;
  mensagemVoz: EventoMensagemVoz;
  erro: { canal?: IdCanal; mensagem: string };
  trafego: { direcao: 'entrada' | 'saida'; canal: IdCanal; tipo: TipoPacote; bytes: number; saltos: number };
}

interface RegistroCanal {
  canal: Canal;
  ativo: boolean;
  disponivel?: boolean;
  erro?: string;
  vizinhos: Map<string, { idNo?: string; rssi?: number; distanciaMetros?: number; ultimaVez: number; viaRadio: boolean }>;
}

interface Propria {
  chave: string;
  pacote: Pacote;
  estado: EstadoEnvio;
  canaisUsados: Set<IdCanal>;
  temporizador?: ReturnType<typeof setTimeout>;
}

interface GravacaoRepasse {
  falante: string;
  sessao: number;
  codec: number;
  ttl: number;
  saltos: number;
  alvo?: string;
  flags: number;
  quadros: Map<number, Uint8Array>;
  inicio: number;
}

const VALIDADE_PROPRIA_PRIVADA = 24 * 3600_000;
const VALIDADE_PROPRIA_CANAL = 2 * 3600_000;
const VALIDADE_CARREGADA = 30 * 60_000;
const VALIDADE_VIZINHO_SEM_RADIO = 150_000;
const DURACAO_QUADRO_PADRAO_MS = 60;
const TEMPO_MAXIMO_FALA_MS = 60_000;
const TAM_MAX_TEXTO = 1000;

function mensagemDeErro(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class Nucleo {
  readonly identidade: Identidade;
  readonly fila: Fila;
  readonly estatisticas = {
    enviados: 0,
    recebidos: 0,
    retransmitidos: 0,
    duplicados: 0,
    invalidos: 0,
    assinaturaInvalida: 0,
    bytesEnviados: 0,
    bytesRecebidos: 0,
  };

  private readonly agora: () => number;
  private readonly ttlPadrao: number;
  private readonly intervaloPresencaMs: number;
  private readonly esperaEscalonamentoMs: number;
  private readonly atrasoRepasseMs: [number, number];
  private readonly assinarMensagens: boolean;
  private readonly emissor = new Emissor<EventosNucleo>();
  private readonly canais = new Map<IdCanal, RegistroCanal>();
  private readonly vistos: CacheVistos;
  private readonly vistosVoz: CacheVistos;
  private readonly remontador: Remontador;
  private readonly presenca: TabelaPresenca;
  private readonly proprias = new Map<string, Propria>();
  private readonly conversas = new Map<string, CanalConversa>();
  private readonly gravacoesRepasse = new Map<string, GravacaoRepasse>();
  private readonly aguardandoChave: { pacote: Pacote; canal: IdCanal; origemLocal?: string }[] = [];
  private readonly temporizadores = new Set<ReturnType<typeof setTimeout>>();
  private temporizadorPresenca?: ReturnType<typeof setInterval>;
  private conversaAtualId: string;
  private _apelido: string;
  private posicao?: Posicao;
  private bateria?: number;
  private falando = false;
  /** Posição só vai na presença se o usuário quiser compartilhar. */
  private compartilharPosicao = true;
  private suportaOpus: boolean;
  private proximaSessao: number;
  private iniciado = false;

  constructor(opcoes: OpcoesNucleo) {
    this.identidade = opcoes.identidade ?? novaIdentidade();
    this.agora = opcoes.agora ?? Date.now;
    this.ttlPadrao = Math.max(1, Math.min(15, opcoes.ttlPadrao ?? TTL_PADRAO));
    this.intervaloPresencaMs = opcoes.intervaloPresencaMs ?? 10_000;
    this.esperaEscalonamentoMs = opcoes.esperaEscalonamentoMs ?? 8_000;
    this.atrasoRepasseMs = opcoes.atrasoRepasseMs ?? [20, 250];
    this.assinarMensagens = opcoes.assinarMensagens ?? true;
    this.suportaOpus = opcoes.suportaOpus ?? false;
    this._apelido = opcoes.apelido;
    this.vistos = new CacheVistos(8192, 15 * 60_000, this.agora);
    this.vistosVoz = new CacheVistos(512, 30 * 60_000, this.agora);
    this.remontador = new Remontador(120_000, this.agora);
    this.presenca = new TabelaPresenca(this.agora);
    this.fila = new Fila(opcoes.armazenamento, 300, this.agora);
    const geral = canalPublico(NOME_CANAL_GERAL);
    this.conversas.set(geral.id, geral);
    this.conversaAtualId = geral.id;
    this.proximaSessao = (bytesAleatorios(2)[0]! << 8) | bytesAleatorios(1)[0]!;
  }

  // ------------------------------------------------------------------
  // API pública
  // ------------------------------------------------------------------

  get idNo(): string {
    return this.identidade.idNo;
  }

  get apelido(): string {
    return this._apelido;
  }

  get impressaoDigital(): string {
    return impressaoDigital(this.identidade.chavePublica);
  }

  on<K extends keyof EventosNucleo>(evento: K, fn: (v: EventosNucleo[K]) => void): () => void {
    return this.emissor.on(evento, fn);
  }

  registrarCanal(canal: Canal): void {
    if (this.canais.has(canal.id)) throw new Error(`canal "${canal.id}" já registrado`);
    this.canais.set(canal.id, { canal, ativo: false, vizinhos: new Map() });
    this.emitirCanais();
  }

  canal<T extends Canal = Canal>(id: IdCanal): T | undefined {
    return this.canais.get(id)?.canal as T | undefined;
  }

  /** Liga o núcleo e os canais pedidos (todos os registrados, se nada for informado). */
  async iniciar(canaisIniciais?: IdCanal[]): Promise<void> {
    if (this.iniciado) return;
    this.iniciado = true;
    await this.fila.carregar();
    this.temporizadorPresenca = setInterval(() => this.cicloPresenca(), this.intervaloPresencaMs);
    const ids = canaisIniciais ?? [...this.canais.keys()];
    // Cada canal anuncia a presença assim que liga.
    await Promise.all(ids.map((id) => this.ativarCanal(id)));
  }

  async parar(): Promise<void> {
    this.iniciado = false;
    if (this.temporizadorPresenca) clearInterval(this.temporizadorPresenca);
    for (const t of this.temporizadores) clearTimeout(t);
    this.temporizadores.clear();
    for (const p of this.proprias.values()) if (p.temporizador) clearTimeout(p.temporizador);
    await Promise.all([...this.canais.keys()].map((id) => this.desativarCanal(id)));
    this.fila.descartarGravacaoPendente();
    await this.fila.gravarAgora();
  }

  async ativarCanal(id: IdCanal): Promise<boolean> {
    const reg = this.canais.get(id);
    if (!reg) return false;
    if (reg.ativo) return true;
    try {
      reg.disponivel = await reg.canal.disponivel();
      if (!reg.disponivel) {
        reg.erro = 'indisponível neste aparelho';
        this.emitirCanais();
        return false;
      }
      reg.ativo = true;
      await reg.canal.iniciar(
        (dados, origemLocal) => this.aoReceber(id, dados, origemLocal),
        (v) => this.aoMudarVizinho(id, v),
      );
      reg.erro = undefined;
    } catch (e) {
      reg.ativo = false;
      reg.erro = mensagemDeErro(e);
      this.emissor.emitir('erro', { canal: id, mensagem: reg.erro });
    }
    this.emitirCanais();
    if (reg.ativo && this.iniciado) this.anunciarEm(reg, this.montarPresenca());
    return reg.ativo;
  }

  async desativarCanal(id: IdCanal): Promise<void> {
    const reg = this.canais.get(id);
    if (!reg || !reg.ativo) return;
    reg.ativo = false;
    reg.vizinhos.clear();
    try {
      await reg.canal.parar();
    } catch (e) {
      this.emissor.emitir('erro', { canal: id, mensagem: mensagemDeErro(e) });
    }
    this.emitirCanais();
  }

  estadoCanais(): EstadoCanal[] {
    return [...this.canais.values()].map((r) => ({
      id: r.canal.id,
      nome: r.canal.nome,
      capacidades: r.canal.capacidades,
      ativo: r.ativo,
      disponivel: r.disponivel,
      vizinhos: r.vizinhos.size,
      erro: r.erro,
    }));
  }

  pessoas(): Pessoa[] {
    return this.presenca.lista(this.posicao, (c) => this.canais.get(c)?.canal.capacidades.alcanceMetros ?? 100);
  }

  pessoa(idNo: string): Pessoa | undefined {
    return this.presenca.obter(idNo, this.posicao, (c) => this.canais.get(c)?.canal.capacidades.alcanceMetros ?? 100);
  }

  definirApelido(apelido: string): void {
    this._apelido = apelido.trim() || this._apelido;
    this.anunciarPresenca();
  }

  definirPosicao(posicao: Posicao | undefined): void {
    this.posicao = posicao;
    this.emissor.emitir('pessoas', this.pessoas());
  }

  definirCompartilharPosicao(sim: boolean): void {
    this.compartilharPosicao = sim;
    this.anunciarPresenca();
  }

  definirBateria(nivel: number | undefined): void {
    this.bateria = nivel;
  }

  definirSuporteOpus(sim: boolean): void {
    this.suportaOpus = sim;
  }

  get minhaPosicao(): Posicao | undefined {
    return this.posicao;
  }

  /** Entra num canal de conversa (público, ou privado com senha) e passa a usá-lo. */
  entrarConversa(nome: string, senha?: string): CanalConversa {
    const c = senha ? canalPrivado(nome, senha) : canalPublico(nome);
    this.conversas.set(c.id, c);
    this.conversaAtualId = c.id;
    this.anunciarPresenca();
    return c;
  }

  selecionarConversa(id: string): void {
    if (this.conversas.has(id)) {
      this.conversaAtualId = id;
      this.anunciarPresenca();
    }
  }

  sairConversa(id: string): void {
    const c = this.conversas.get(id);
    if (!c || (c.nome === NOME_CANAL_GERAL && !c.privado)) return;
    this.conversas.delete(id);
    if (this.conversaAtualId === id) this.conversaAtualId = canalPublico(NOME_CANAL_GERAL).id;
    this.anunciarPresenca();
  }

  conversasAtivas(): CanalConversa[] {
    return [...this.conversas.values()];
  }

  get conversaAtual(): CanalConversa {
    return this.conversas.get(this.conversaAtualId)!;
  }

  /**
   * Envia um texto para a conversa atual (ou a informada), ou em particular
   * para uma pessoa. Devolve a chave da mensagem para acompanhar o estado.
   */
  async enviarTexto(
    texto: string,
    opcoes: { para?: string; conversa?: string; importante?: boolean } = {},
  ): Promise<EstadoMensagemPropria> {
    let carga = utf8(texto.slice(0, TAM_MAX_TEXTO));
    let flags = 0;
    let alvo: string | undefined;
    const base = this.novoPacoteBase(TipoPacote.Texto);
    if (opcoes.para) {
      const chavePub = this.presenca.chavePublica(opcoes.para);
      if (!chavePub) throw new Error('pessoa desconhecida: não há chave para cifrar a conversa privada');
      alvo = opcoes.para;
      flags |= FLAG.ALVO_NO | FLAG.CIFRADO | FLAG.PEDE_CONFIRMACAO;
      const chave = chaveEntrePares(this.identidade, chavePub);
      carga = cifrar(chave, carga, dadosAssociados({ ...base, alvo }));
    } else {
      const conversa = this.conversas.get(opcoes.conversa ?? this.conversaAtualId) ?? this.conversaAtual;
      alvo = this.alvoDaConversa(conversa);
      if (conversa.privado) {
        flags |= FLAG.CIFRADO;
        carga = cifrar(conversa.chave!, carga, dadosAssociados({ ...base, alvo }));
      }
    }
    let pacote: Pacote = { ...base, flags, alvo, carga };
    if (this.assinarMensagens) pacote = assinarPacote(pacote, this.identidade);
    return this.enviarProprio(pacote, {
      modo: opcoes.para ? 'privado' : opcoes.importante ? 'importante' : 'difusao',
      destino: opcoes.para,
      validadeMs: opcoes.para ? VALIDADE_PROPRIA_PRIVADA : VALIDADE_PROPRIA_CANAL,
    });
  }

  /** Para canais só de texto (Morse por luz ou som): manda o texto puro, sem pacote. */
  async enviarTextoPuro(idCanal: IdCanal, texto: string): Promise<void> {
    const reg = this.canais.get(idCanal);
    if (!reg?.ativo) throw new Error(`canal "${idCanal}" não está ativo`);
    await reg.canal.enviar(utf8(texto));
  }

  /** Começa uma fala ao vivo. Devolve o número da sessão. */
  iniciarFala(codec: number): number {
    const sessao = this.proximaSessao++ & 0xffff;
    this.falando = true;
    const conversa = this.conversaAtual;
    let p: Pacote = {
      ...this.novoPacoteBase(TipoPacote.InicioFala),
      alvo: this.alvoDaConversa(conversa),
      carga: codificarInicioFala({ sessao, codec }),
    };
    p = assinarPacote(p, this.identidade);
    this.vistosVoz.marcar(`voz:${this.idNo}:${sessao}`);
    this.enviarSemAcompanhar(p, { modo: 'aoVivo' });
    this.anunciarPresenca();
    return sessao;
  }

  enviarQuadroVoz(sessao: number, seq: number, codec: number, audio: Uint8Array): void {
    const conversa = this.conversaAtual;
    let dados = audio;
    let flags = 0;
    if (conversa.privado) {
      dados = cifrar(conversa.chave!, audio, aadQuadroVoz(this.idNo, sessao, seq));
      flags |= FLAG.CIFRADO;
    }
    const p: Pacote = {
      ...this.novoPacoteBase(TipoPacote.VozQuadro),
      flags,
      alvo: this.alvoDaConversa(conversa),
      carga: codificarQuadroVoz({ sessao, seq, codec, dados }),
    };
    this.enviarSemAcompanhar(p, { modo: 'aoVivo' });
  }

  terminarFala(sessao: number, totalQuadros: number): void {
    this.falando = false;
    let p: Pacote = {
      ...this.novoPacoteBase(TipoPacote.FimFala),
      alvo: this.alvoDaConversa(this.conversaAtual),
      carga: codificarFimFala({ sessao, totalQuadros }),
    };
    p = assinarPacote(p, this.identidade);
    this.enviarSemAcompanhar(p, { modo: 'aoVivo' });
    this.anunciarPresenca();
  }

  /** Mensagem de voz gravada, entregue pela malha com store-and-forward. */
  async enviarMensagemVoz(
    codec: number,
    duracaoQuadroMs: number,
    quadros: Uint8Array[],
  ): Promise<EstadoMensagemPropria> {
    const sessao = this.proximaSessao++ & 0xffff;
    const conversa = this.conversaAtual;
    let flags = 0;
    const lista = quadros.map((dados, seq) => {
      if (!conversa.privado) return { seq, dados };
      flags |= FLAG.CIFRADO;
      return { seq, dados: cifrar(conversa.chave!, dados, aadQuadroVoz(this.idNo, sessao, seq)) };
    });
    this.vistosVoz.marcar(`voz:${this.idNo}:${sessao}`);
    let p: Pacote = {
      ...this.novoPacoteBase(TipoPacote.VozMensagem),
      flags,
      alvo: this.alvoDaConversa(conversa),
      carga: codificarMensagemVoz({ falante: this.idNo, sessao, codec, duracaoQuadroMs, quadros: lista }),
    };
    if (this.assinarMensagens) p = assinarPacote(p, this.identidade);
    return this.enviarProprio(p, { modo: 'difusao', ignorarLentos: true, validadeMs: VALIDADE_PROPRIA_CANAL });
  }

  /** Pacote de presença pronto, para canais que anunciam sob demanda (som, QR, NFC). */
  pacotePresenca(): Uint8Array {
    return this.montarPresenca();
  }

  /** Força uma nova divulgação de presença em todos os canais. */
  anunciarPresenca(): void {
    if (!this.iniciado) return;
    const bytes = this.montarPresenca();
    for (const reg of this.canais.values()) if (reg.ativo) this.anunciarEm(reg, bytes);
  }

  // ------------------------------------------------------------------
  // Envio
  // ------------------------------------------------------------------

  private novoPacoteBase(tipo: TipoPacote): Pacote {
    return {
      versao: VERSAO_PROTOCOLO,
      tipo,
      flags: 0,
      ttl: this.ttlPadrao,
      saltos: 0,
      id: paraHex(bytesAleatorios(TAM_ID)),
      origem: this.idNo,
      carimbo: Math.floor(this.agora() / 1000),
      carga: new Uint8Array(0),
    };
  }

  /** O canal "geral" não leva alvo, para economizar 6 bytes nos canais lentos. */
  private alvoDaConversa(c: CanalConversa): string | undefined {
    return !c.privado && c.nome === NOME_CANAL_GERAL ? undefined : c.id;
  }

  private estadosRoteamento(): EstadoCanalRoteamento[] {
    return [...this.canais.values()].map((r) => {
      const comId = new Set<string>();
      let semId = 0;
      for (const v of r.vizinhos.values()) {
        if (v.idNo) comId.add(v.idNo);
        else semId++;
      }
      return { id: r.canal.id, capacidades: r.canal.capacidades, ativo: r.ativo, vizinhosComId: comId, vizinhosSemId: semId };
    });
  }

  private async enviarProprio(
    pacote: Pacote,
    rota: PedidoRota & { validadeMs: number },
  ): Promise<EstadoMensagemPropria> {
    const chave = chaveDedup(pacote);
    this.vistos.marcar(chave);
    const bytes = codificarPacote(pacote);
    this.fila.adicionar({
      chave,
      bytes,
      destino: rota.destino,
      propria: true,
      expiraEm: this.agora() + rota.validadeMs,
    });
    const canais = escolherCanais(this.estadosRoteamento(), rota);
    const propria: Propria = {
      chave,
      pacote,
      estado: canais.length ? 'enviada' : 'pendente',
      canaisUsados: new Set(canais),
    };
    this.proprias.set(chave, propria);
    await this.enviarPor(canais, pacote, bytes);
    this.marcarEntreguesNaFila(chave, canais);
    // Num meio único confiável (servidor de rede local), ninguém repete no
    // mesmo canal, então não há eco: entregar com gente conectada já conta
    // como ouvida.
    const meioUnicoComGente = canais.some((id) => {
      const reg = this.canais.get(id);
      return reg?.ativo && reg.canal.capacidades.meioUnico && reg.vizinhos.size > 0;
    });
    if (meioUnicoComGente && !(pacote.flags & FLAG.ALVO_NO)) propria.estado = 'ouvida';
    this.emitirEstado(propria);
    this.agendarEscalonamento(propria);
    return this.estadoDe(propria);
  }

  /** Pacotes que não precisam de acompanhamento (voz ao vivo, presença, confirmações). */
  private enviarSemAcompanhar(pacote: Pacote, rota: PedidoRota): void {
    this.vistos.marcar(chaveDedup(pacote));
    const canais = escolherCanais(this.estadosRoteamento(), rota);
    void this.enviarPor(canais, pacote);
  }

  /** Para não reenviar pela fila a quem acabou de receber o pacote por difusão. */
  private marcarEntreguesNaFila(chave: string, canais: IdCanal[]): void {
    for (const id of canais) {
      const reg = this.canais.get(id);
      if (!reg) continue;
      for (const idLocal of reg.vizinhos.keys()) this.fila.marcarEntregue(chave, `${id}:${idLocal}`);
    }
  }

  private async enviarPor(canais: IdCanal[], pacote: Pacote, bytes = codificarPacote(pacote), destino?: string): Promise<void> {
    await Promise.all(
      canais.map(async (id) => {
        const reg = this.canais.get(id);
        if (!reg?.ativo) return;
        try {
          const partes = fragmentar(pacote, bytes, reg.canal.capacidades.mtu);
          for (const parte of partes) {
            await reg.canal.enviar(parte, destino);
            this.estatisticas.enviados++;
            this.estatisticas.bytesEnviados += parte.length;
          }
          this.emissor.emitir('trafego', {
            direcao: 'saida',
            canal: id,
            tipo: pacote.tipo,
            bytes: bytes.length,
            saltos: pacote.saltos,
          });
        } catch (e) {
          this.emissor.emitir('erro', { canal: id, mensagem: mensagemDeErro(e) });
        }
      }),
    );
  }

  /** Degrada com graça: sem eco nem confirmação, tenta o próximo canal. */
  private agendarEscalonamento(p: Propria): void {
    if (this.esperaEscalonamentoMs <= 0) return;
    if (p.temporizador) clearTimeout(p.temporizador);
    p.temporizador = setTimeout(() => {
      p.temporizador = undefined;
      if (!this.iniciado || p.estado === 'ouvida' || p.estado === 'entregue') return;
      const proximo = proximoCanalEscalonamento(this.estadosRoteamento(), p.canaisUsados);
      if (!proximo) return;
      p.canaisUsados.add(proximo);
      p.estado = 'enviada';
      void this.enviarPor([proximo], p.pacote).then(() => this.emitirEstado(p));
      this.agendarEscalonamento(p);
    }, this.esperaEscalonamentoMs);
  }

  private estadoDe(p: Propria): EstadoMensagemPropria {
    return { id: p.pacote.id, chave: p.chave, estado: p.estado, canais: [...p.canaisUsados] };
  }

  private emitirEstado(p: Propria): void {
    this.emissor.emitir('estadoMensagem', this.estadoDe(p));
  }

  private montarPresenca(): Uint8Array {
    const conversa = this.conversaAtual;
    const p: Pacote = {
      ...this.novoPacoteBase(TipoPacote.Presenca),
      ttl: Math.min(3, this.ttlPadrao),
      carga: codificarPresenca({
        chavePublica: this.identidade.chavePublica,
        apelido: this._apelido,
        // Canal privado não é anunciado pelo nome.
        canalConversa: conversa.privado ? '' : conversa.nome,
        canaisAcessiveis: [...this.canais.values()].filter((r) => r.ativo).map((r) => r.canal.id),
        posicao: this.compartilharPosicao ? this.posicao : undefined,
        bateria: this.bateria,
        suportaOpus: this.suportaOpus,
        falando: this.falando,
      }),
    };
    this.vistos.marcar(chaveDedup(p));
    return codificarPacote(p);
  }

  private anunciarEm(reg: RegistroCanal, bytes: Uint8Array): void {
    reg.canal.anunciar(bytes).catch((e) => {
      this.emissor.emitir('erro', { canal: reg.canal.id, mensagem: mensagemDeErro(e) });
    });
  }

  private cicloPresenca(): void {
    const t = this.agora();
    let mudouCanais = false;
    for (const reg of this.canais.values()) {
      for (const [idLocal, v] of reg.vizinhos) {
        if (!v.viaRadio && t - v.ultimaVez > VALIDADE_VIZINHO_SEM_RADIO) {
          reg.vizinhos.delete(idLocal);
          mudouCanais = true;
        }
      }
    }
    if (mudouCanais) this.emitirCanais();
    if (this.presenca.limparExpirados()) this.emissor.emitir('pessoas', this.pessoas());
    this.remontador.limpar();
    this.fila.limparExpirados();
    for (const [k, g] of this.gravacoesRepasse) {
      if (t - g.inicio > TEMPO_MAXIMO_FALA_MS) this.finalizarRepasseVoz(k);
    }
    this.anunciarPresenca();
  }

  // ------------------------------------------------------------------
  // Recepção
  // ------------------------------------------------------------------

  private aoMudarVizinho(idCanal: IdCanal, v: Vizinho): void {
    const reg = this.canais.get(idCanal);
    if (!reg?.ativo) return;
    if (!v.presente) {
      reg.vizinhos.delete(v.idLocal);
      this.emitirCanais();
      return;
    }
    const anterior = reg.vizinhos.get(v.idLocal);
    reg.vizinhos.set(v.idLocal, {
      idNo: v.idNo ?? anterior?.idNo,
      rssi: v.rssi ?? anterior?.rssi,
      distanciaMetros: v.distanciaMetros ?? anterior?.distanciaMetros,
      ultimaVez: this.agora(),
      viaRadio: true,
    });
    const idNo = v.idNo ?? anterior?.idNo;
    if (idNo && (v.rssi !== undefined || v.distanciaMetros !== undefined)) {
      this.presenca.atualizarSinal(idNo, idCanal, v.rssi, v.distanciaMetros);
    }
    if (!anterior) {
      this.emitirCanais();
      // Alguém novo chegou: anuncia quem sou e entrega o que estava guardado.
      this.anunciarEm(reg, this.montarPresenca());
      this.entregarFila(idCanal, v.idLocal);
    }
  }

  private registrarVizinhoDireto(idCanal: IdCanal, idLocal: string, idNo: string): void {
    const reg = this.canais.get(idCanal)!;
    const anterior = reg.vizinhos.get(idLocal);
    reg.vizinhos.set(idLocal, {
      ...anterior,
      idNo,
      ultimaVez: this.agora(),
      viaRadio: anterior?.viaRadio ?? false,
    });
    if (!anterior || !anterior.idNo) {
      this.emitirCanais();
      this.entregarFila(idCanal, idLocal);
    }
  }

  private entregarFila(idCanal: IdCanal, idLocal: string): void {
    const reg = this.canais.get(idCanal);
    if (!reg?.ativo) return;
    const c = reg.canal.capacidades;
    // Canais lentos ou manuais não despejam a fila inteira.
    if (c.bytesPorSegundo < VAZAO_MINIMA_RAPIDO || c.exigeAcao || c.somenteTexto) return;
    const chaveVizinho = `${idCanal}:${idLocal}`;
    const destino = idLocal.startsWith('no:') ? undefined : idLocal;
    const itens = this.fila.paraEntregar(chaveVizinho);
    if (!itens.length) return;
    void (async () => {
      for (const item of itens) {
        try {
          const p = decodificarPacote(item.bytes);
          await this.enviarPor([idCanal], p, item.bytes, destino);
          this.fila.marcarEntregue(item.chave, chaveVizinho);
          const propria = this.proprias.get(item.chave);
          if (propria) {
            propria.canaisUsados.add(idCanal);
            if (propria.estado === 'pendente') propria.estado = 'enviada';
            this.emitirEstado(propria);
          }
        } catch (e) {
          this.emissor.emitir('erro', { canal: idCanal, mensagem: mensagemDeErro(e) });
        }
      }
    })();
  }

  private aoReceber(idCanal: IdCanal, dados: Uint8Array, origemLocal?: string): void {
    const reg = this.canais.get(idCanal);
    if (!reg?.ativo) return;
    this.estatisticas.bytesRecebidos += dados.length;

    if (reg.canal.capacidades.somenteTexto) {
      this.receberTextoPuro(idCanal, dados);
      return;
    }

    let p: Pacote;
    try {
      p = decodificarPacote(dados);
    } catch {
      this.estatisticas.invalidos++;
      return;
    }
    this.estatisticas.recebidos++;

    if (p.tipo === TipoPacote.Fragmento) {
      let indice: number;
      try {
        indice = indiceDoFragmento(p);
      } catch {
        this.estatisticas.invalidos++;
        return;
      }
      const chaveFrag = `frag:${chaveDedup(p)}:${indice}`;
      if (this.vistos.ja(chaveDedup(p)) || this.vistos.ja(chaveFrag)) {
        this.estatisticas.duplicados++;
        if (p.origem === this.idNo) this.marcarEco(chaveDedup(p));
        return;
      }
      this.vistos.marcar(chaveFrag);
      const inteiro = this.remontador.receber(p);
      if (!inteiro) return;
      try {
        p = decodificarPacote(inteiro);
      } catch {
        this.estatisticas.invalidos++;
        return;
      }
    }

    this.emissor.emitir('trafego', {
      direcao: 'entrada',
      canal: idCanal,
      tipo: p.tipo,
      bytes: dados.length,
      saltos: p.saltos,
    });

    if (p.origem !== this.idNo) {
      if (p.saltos === 0) this.registrarVizinhoDireto(idCanal, origemLocal ?? `no:${p.origem}`, p.origem);
      this.presenca.marcarVisto(p.origem, { canal: idCanal, saltos: p.saltos });
    }

    const chave = chaveDedup(p);
    if (this.vistos.ja(chave)) {
      this.estatisticas.duplicados++;
      if (p.origem === this.idNo) this.marcarEco(chave);
      return;
    }
    this.vistos.marcar(chave);
    if (p.origem === this.idNo) return;

    this.processar(p, idCanal, origemLocal);
  }

  private processar(p: Pacote, idCanal: IdCanal, origemLocal?: string): void {
    // Assinatura: confere quando há chave. Assinatura falsa é descartada.
    let verificada: boolean | undefined;
    if (p.flags & FLAG.ASSINADO) {
      const chavePub = this.presenca.chavePublica(p.origem);
      if (chavePub) {
        verificada = verificarPacote(p, chavePub);
        if (!verificada) {
          this.estatisticas.assinaturaInvalida++;
          return;
        }
      }
    }

    switch (p.tipo) {
      case TipoPacote.Presenca:
        this.receberPresenca(p, idCanal, origemLocal);
        break;
      case TipoPacote.Texto:
        this.receberTexto(p, idCanal, verificada, origemLocal);
        break;
      case TipoPacote.Confirmacao:
        this.receberConfirmacao(p, idCanal, origemLocal);
        break;
      case TipoPacote.InicioFala:
      case TipoPacote.VozQuadro:
      case TipoPacote.FimFala:
        this.receberVozAoVivo(p, idCanal);
        return; // a voz tem regra de repasse própria
      case TipoPacote.VozMensagem:
        if (!this.receberMensagemVoz(p, idCanal)) return;
        break;
      default:
        return;
    }
    this.repassar(p, idCanal);
  }

  private receberTextoPuro(idCanal: IdCanal, dados: Uint8Array): void {
    const texto = deUtf8(dados).trim();
    if (!texto) return;
    const geral = canalPublico(NOME_CANAL_GERAL);
    const id = paraHex(bytesAleatorios(TAM_ID));
    this.emissor.emitir('mensagem', {
      id,
      chave: `anonimo:${id}`,
      de: `anonimo-${idCanal}`,
      texto,
      conversa: { tipo: 'canal', id: geral.id, nome: geral.nome, privado: false },
      saltos: 0,
      viaCanal: idCanal,
      cifrada: false,
      carimbo: this.agora(),
      anonima: true,
    });
  }

  private receberPresenca(p: Pacote, idCanal: IdCanal, origemLocal?: string): void {
    let dados;
    try {
      dados = decodificarPresenca(p.carga);
    } catch {
      this.estatisticas.invalidos++;
      return;
    }
    if (!this.presenca.atualizar(p.origem, dados, { canal: idCanal, saltos: p.saltos })) {
      this.estatisticas.invalidos++;
      return;
    }
    if (p.saltos === 0 && origemLocal) {
      const v = this.canais.get(idCanal)?.vizinhos.get(origemLocal);
      if (v && (v.rssi !== undefined || v.distanciaMetros !== undefined)) {
        this.presenca.atualizarSinal(p.origem, idCanal, v.rssi, v.distanciaMetros);
      }
    }
    this.emissor.emitir('pessoas', this.pessoas());
    this.processarAguardandoChave(p.origem);
  }

  private processarAguardandoChave(idNo: string): void {
    for (let i = this.aguardandoChave.length - 1; i >= 0; i--) {
      const a = this.aguardandoChave[i]!;
      if (a.pacote.origem !== idNo) continue;
      this.aguardandoChave.splice(i, 1);
      this.processar(a.pacote, a.canal, a.origemLocal);
    }
  }

  private receberTexto(p: Pacote, idCanal: IdCanal, verificada: boolean | undefined, origemLocal?: string): void {
    const apelido = this.presenca.apelido(p.origem);
    const paraMim = !!(p.flags & FLAG.ALVO_NO) && p.alvo === this.idNo;
    if (p.flags & FLAG.ALVO_NO) {
      if (!paraMim) {
        this.carregar(p, idCanal, origemLocal);
        return;
      }
      const chavePub = this.presenca.chavePublica(p.origem);
      if (!chavePub) {
        // Ainda não conheço quem mandou: espera a presença chegar.
        if (this.aguardandoChave.length < 50) this.aguardandoChave.push({ pacote: p, canal: idCanal, origemLocal });
        return;
      }
      const claro = decifrar(chaveEntrePares(this.identidade, chavePub), p.carga, dadosAssociados(p));
      if (!claro) {
        this.estatisticas.invalidos++;
        return;
      }
      this.emissor.emitir('mensagem', {
        id: p.id,
        chave: chaveDedup(p),
        de: p.origem,
        apelido,
        texto: deUtf8(claro),
        conversa: { tipo: 'privada', com: p.origem },
        saltos: p.saltos,
        viaCanal: idCanal,
        verificada,
        cifrada: true,
        carimbo: p.carimbo * 1000,
      });
      if (p.flags & FLAG.PEDE_CONFIRMACAO) this.confirmar(p);
      return;
    }

    this.carregar(p, idCanal, origemLocal);
    const conversa = this.conversaDoAlvo(p.alvo);
    if (!conversa) return; // canal em que não estou: só retransmite
    let texto: string;
    if (p.flags & FLAG.CIFRADO) {
      if (!conversa.chave) return;
      const claro = decifrar(conversa.chave, p.carga, dadosAssociados(p));
      if (!claro) return;
      texto = deUtf8(claro);
    } else {
      texto = deUtf8(p.carga);
    }
    this.emissor.emitir('mensagem', {
      id: p.id,
      chave: chaveDedup(p),
      de: p.origem,
      apelido,
      texto,
      conversa: { tipo: 'canal', id: conversa.id, nome: conversa.nome, privado: conversa.privado },
      saltos: p.saltos,
      viaCanal: idCanal,
      verificada,
      cifrada: !!(p.flags & FLAG.CIFRADO),
      carimbo: p.carimbo * 1000,
    });
  }

  private conversaDoAlvo(alvo: string | undefined): CanalConversa | undefined {
    if (!alvo) return this.conversas.get(canalPublico(NOME_CANAL_GERAL).id);
    return this.conversas.get(alvo);
  }

  /** Guarda para entregar a quem aparecer depois (carregar a mensagem pela malha). */
  private carregar(p: Pacote, idCanal: IdCanal, origemLocal?: string): void {
    if (!podeRetransmitir(p)) return;
    const seguinte = proximoSalto(p);
    this.fila.adicionar({
      chave: chaveDedup(p),
      bytes: codificarPacote(seguinte),
      destino: p.flags & FLAG.ALVO_NO ? p.alvo : undefined,
      propria: false,
      expiraEm: this.agora() + VALIDADE_CARREGADA,
      entreguesA: [`${idCanal}:${origemLocal ?? `no:${p.origem}`}`],
    });
  }

  private confirmar(original: Pacote): void {
    let p: Pacote = {
      ...this.novoPacoteBase(TipoPacote.Confirmacao),
      flags: FLAG.ALVO_NO,
      alvo: original.origem,
      carga: deHex(original.id),
    };
    p = assinarPacote(p, this.identidade);
    this.vistos.marcar(chaveDedup(p));
    const bytes = codificarPacote(p);
    this.fila.adicionar({
      chave: chaveDedup(p),
      bytes,
      destino: original.origem,
      propria: true,
      expiraEm: this.agora() + VALIDADE_CARREGADA,
    });
    const canais = escolherCanais(this.estadosRoteamento(), { modo: 'privado', destino: original.origem });
    void this.enviarPor(canais, p, bytes);
    this.marcarEntreguesNaFila(chaveDedup(p), canais);
  }

  private receberConfirmacao(p: Pacote, idCanal: IdCanal, origemLocal?: string): void {
    if (p.carga.length !== TAM_ID || !p.alvo) return;
    const idConfirmado = paraHex(p.carga);
    const chaveOriginal = `${p.alvo}:${idConfirmado}`;
    // Quem carregava a mensagem para entregar já pode descartar.
    this.fila.remover(chaveOriginal);
    if (p.alvo === this.idNo) {
      const propria = this.proprias.get(chaveOriginal);
      if (propria) {
        propria.estado = 'entregue';
        if (propria.temporizador) clearTimeout(propria.temporizador);
        this.emitirEstado(propria);
      }
    } else {
      this.carregar(p, idCanal, origemLocal);
    }
  }

  private marcarEco(chave: string): void {
    const p = this.proprias.get(chave);
    if (!p || p.estado === 'entregue' || p.estado === 'ouvida') return;
    // Ouvir a própria mensagem retransmitida prova que alguém recebeu. Em
    // conversa privada só a confirmação conta como entrega; o eco vale como
    // "ouvida". A mensagem continua na fila para quem chegar depois.
    p.estado = 'ouvida';
    this.emitirEstado(p);
  }

  // ------------------------------------------------------------------
  // Voz
  // ------------------------------------------------------------------

  private receberVozAoVivo(p: Pacote, idCanal: IdCanal): void {
    const conversa = this.conversaDoAlvo(p.alvo);
    let sessao: number;
    try {
      if (p.tipo === TipoPacote.InicioFala) {
        const v = decodificarInicioFala(p.carga);
        sessao = v.sessao;
        this.vistosVoz.marcar(`voz:${p.origem}:${sessao}`);
        if (conversa) {
          this.emissor.emitir('inicioFala', {
            de: p.origem,
            apelido: this.presenca.apelido(p.origem),
            sessao,
            codec: v.codec,
            saltos: p.saltos,
            conversa: { tipo: 'canal', id: conversa.id, nome: conversa.nome, privado: conversa.privado },
          });
        }
      } else if (p.tipo === TipoPacote.VozQuadro) {
        const q = decodificarQuadroVoz(p.carga);
        sessao = q.sessao;
        this.vistosVoz.marcar(`voz:${p.origem}:${sessao}`);
        if (conversa) {
          let dados: Uint8Array | undefined = q.dados;
          if (p.flags & FLAG.CIFRADO) {
            dados = conversa.chave ? decifrar(conversa.chave, q.dados, aadQuadroVoz(p.origem, q.sessao, q.seq)) : undefined;
          }
          if (dados) {
            this.emissor.emitir('quadroVoz', {
              de: p.origem,
              sessao: q.sessao,
              seq: q.seq,
              codec: q.codec,
              dados,
              saltos: p.saltos,
            });
          }
        }
      } else {
        sessao = decodificarFimFala(p.carga).sessao;
        if (conversa) this.emissor.emitir('fimFala', { de: p.origem, sessao });
      }
    } catch {
      this.estatisticas.invalidos++;
      return;
    }

    if (!podeRetransmitir(p)) return;
    if (p.saltos + 1 < LIMITE_SALTOS_VOZ_AO_VIVO) {
      this.agendarRepasse(p, idCanal, { modo: 'aoVivo' });
    } else {
      // Além de 2 saltos a fala vira mensagem gravada, para não congestionar a rede.
      this.acumularRepasseVoz(p, sessao);
    }
  }

  private acumularRepasseVoz(p: Pacote, sessao: number): void {
    const k = `${p.origem}:${sessao}`;
    let g = this.gravacoesRepasse.get(k);
    if (!g) {
      g = {
        falante: p.origem,
        sessao,
        codec: 0,
        ttl: p.ttl - 1,
        saltos: p.saltos + 1,
        alvo: p.alvo,
        flags: 0,
        quadros: new Map(),
        inicio: this.agora(),
      };
      this.gravacoesRepasse.set(k, g);
    }
    if (p.tipo === TipoPacote.InicioFala) {
      g.codec = decodificarInicioFala(p.carga).codec;
    } else if (p.tipo === TipoPacote.VozQuadro) {
      const q = decodificarQuadroVoz(p.carga);
      g.codec = q.codec;
      if (p.flags & FLAG.CIFRADO) g.flags |= FLAG.CIFRADO;
      if (g.quadros.size < 2000) g.quadros.set(q.seq, q.dados);
    } else if (p.tipo === TipoPacote.FimFala) {
      this.finalizarRepasseVoz(k);
    }
  }

  private finalizarRepasseVoz(k: string): void {
    const g = this.gravacoesRepasse.get(k);
    this.gravacoesRepasse.delete(k);
    if (!g || !g.quadros.size || g.ttl <= 0) return;
    const quadros = [...g.quadros.entries()].sort((a, b) => a[0] - b[0]).map(([seq, dados]) => ({ seq, dados }));
    const p: Pacote = {
      ...this.novoPacoteBase(TipoPacote.VozMensagem),
      ttl: g.ttl,
      saltos: g.saltos,
      flags: g.flags,
      alvo: g.alvo,
      carga: codificarMensagemVoz({
        falante: g.falante,
        sessao: g.sessao,
        codec: g.codec,
        duracaoQuadroMs: DURACAO_QUADRO_PADRAO_MS,
        quadros,
      }),
    };
    const chave = chaveDedup(p);
    this.vistos.marcar(chave);
    const bytes = codificarPacote(p);
    this.fila.adicionar({ chave, bytes, propria: false, expiraEm: this.agora() + VALIDADE_CARREGADA });
    const canais = escolherCanais(this.estadosRoteamento(), { modo: 'difusao', ignorarLentos: true });
    void this.enviarPor(canais, p, bytes);
    this.marcarEntreguesNaFila(chave, canais);
  }

  /** Devolve falso quando a mensagem já foi ouvida (não precisa retransmitir). */
  private receberMensagemVoz(p: Pacote, idCanal: IdCanal): boolean {
    let v;
    try {
      v = decodificarMensagemVoz(p.carga);
    } catch {
      this.estatisticas.invalidos++;
      return false;
    }
    const k = `voz:${v.falante}:${v.sessao}`;
    if (this.vistosVoz.ja(k)) return false;
    this.vistosVoz.marcar(k);
    this.carregar(p, idCanal);
    const conversa = this.conversaDoAlvo(p.alvo);
    if (!conversa) return true;
    let quadros = v.quadros;
    if (p.flags & FLAG.CIFRADO) {
      if (!conversa.chave) return true;
      quadros = [];
      for (const q of v.quadros) {
        const claro = decifrar(conversa.chave, q.dados, aadQuadroVoz(v.falante, v.sessao, q.seq));
        if (claro) quadros.push({ seq: q.seq, dados: claro });
      }
    }
    this.emissor.emitir('mensagemVoz', {
      chave: chaveDedup(p),
      de: v.falante,
      apelido: this.presenca.apelido(v.falante),
      sessao: v.sessao,
      codec: v.codec,
      duracaoQuadroMs: v.duracaoQuadroMs,
      quadros,
      saltos: p.saltos,
      viaCanal: idCanal,
      conversa: { tipo: 'canal', id: conversa.id, nome: conversa.nome, privado: conversa.privado },
    });
    return true;
  }

  // ------------------------------------------------------------------
  // Repasse
  // ------------------------------------------------------------------

  private repassar(p: Pacote, idCanal: IdCanal): void {
    if (!podeRetransmitir(p)) return;
    if (p.flags & FLAG.ALVO_NO && p.alvo === this.idNo) return;
    const modo: PedidoRota['modo'] = p.flags & FLAG.ALVO_NO ? 'privado' : 'difusao';
    this.agendarRepasse(p, idCanal, {
      modo,
      destino: modo === 'privado' ? p.alvo : undefined,
      ignorarLentos: p.tipo === TipoPacote.Presenca || p.tipo === TipoPacote.VozMensagem,
    });
  }

  private agendarRepasse(p: Pacote, idCanal: IdCanal, rota: PedidoRota): void {
    const reg = this.canais.get(idCanal);
    const excluir = reg?.canal.capacidades.meioUnico ? [idCanal] : [];
    const seguinte = proximoSalto(p);
    const [min, max] = this.atrasoRepasseMs;
    const atraso = p.tipo === TipoPacote.VozQuadro ? 0 : min + Math.random() * (max - min);
    const t = setTimeout(() => {
      this.temporizadores.delete(t);
      if (!this.iniciado) return;
      const canais = escolherCanais(this.estadosRoteamento(), { ...rota, excluir });
      if (!canais.length) return;
      this.estatisticas.retransmitidos++;
      void this.enviarPor(canais, seguinte);
      this.marcarEntreguesNaFila(chaveDedup(p), canais);
    }, atraso);
    this.temporizadores.add(t);
  }

  private emitirCanais(): void {
    this.emissor.emitir('canais', this.estadoCanais());
  }
}
