/**
 * Estado da interface. Liga o núcleo, a voz e os canais aos componentes.
 * Os componentes nunca falam com um canal direto: falam com o núcleo.
 */

import { type EstadoPtt, type MensagemVozGuardada, Voz } from '@plataforma/midia';
import { servidaPorRedeLocal } from '@plataforma/canal-rede-local';
import {
  type CanalConversa,
  type EstadoCanal,
  type EstadoEnvio,
  type EstadoMensagemPropria,
  type IdCanal,
  type MensagemRecebida,
  Nucleo,
  type Pessoa,
  type Posicao,
} from '@plataforma/nucleo';
import { ArmazenamentoLocal, gravarPreferencia, lerPreferencia } from './armazenamento.ts';
import { type CanaisDoCliente, criarCanais } from './canais.ts';
import { type Ambiente, ambienteInicial } from './plataforma.ts';
import { modoRadio, observarBateria, observarPosicao, reaplicarTravaAoVoltar } from './sistema.ts';
import { TesteDeCampo } from './teste-campo.ts';

export type Tela = 'radar' | 'mapa' | 'conversa' | 'canais' | 'perfil';

export interface ItemConversa {
  chave: string;
  /** "canal:<id>" ou "privada:<idNo>". */
  conversa: string;
  de: string;
  apelido?: string;
  texto?: string;
  voz?: MensagemVozGuardada;
  propria: boolean;
  estado?: EstadoEnvio;
  canais?: IdCanal[];
  viaCanal?: IdCanal;
  saltos: number;
  carimbo: number;
  verificada?: boolean;
  cifrada?: boolean;
  anonima?: boolean;
}

export interface Aviso {
  id: number;
  texto: string;
  tipo: 'erro' | 'info';
}

const MAX_ITENS = 400;
const CHAVE_HISTORICO = 'historico.v1';

export function chaveConversaCanal(id: string): string {
  return `canal:${id}`;
}

export function chaveConversaPrivada(idNo: string): string {
  return `privada:${idNo}`;
}

class EstadoApp {
  ambiente = $state<Ambiente>(ambienteInicial());
  pronto = $state(false);
  iniciando = $state(false);
  apelido = $state(lerPreferencia('apelido', ''));
  tela = $state<Tela>('radar');
  nucleo = $state.raw<Nucleo | undefined>();
  voz = $state.raw<Voz | undefined>();
  canaisCliente = $state.raw<CanaisDoCliente | undefined>();
  pessoas = $state.raw<Pessoa[]>([]);
  canais = $state.raw<EstadoCanal[]>([]);
  conversas = $state.raw<CanalConversa[]>([]);
  itens = $state<ItemConversa[]>([]);
  conversaAberta = $state('');
  naoLidas = $state<Record<string, number>>({});
  ptt = $state.raw<EstadoPtt>({ tipo: 'livre' });
  nivelMicrofone = $state(0);
  compartilharPosicao = $state(lerPreferencia('compartilharPosicao', true));
  posicao = $state.raw<Posicao | undefined>();
  radioLigado = $state(false);
  avisos = $state<Aviso[]>([]);
  errosCanal = $state<Record<string, string>>({});
  trafego = $state({ entrada: 0, saida: 0 });
  readonly teste = new TesteDeCampo();

  private estadosAntecipados = new Map<string, EstadoMensagemPropria>();
  private proximoAviso = 1;
  private pararPosicao?: () => void;

  get conversaAtual(): CanalConversa | undefined {
    return this.conversas.find((c) => chaveConversaCanal(c.id) === this.conversaAberta) ?? this.conversas[0];
  }

  get pessoaDaConversa(): Pessoa | undefined {
    if (!this.conversaAberta.startsWith('privada:')) return undefined;
    const id = this.conversaAberta.slice('privada:'.length);
    return this.pessoas.find((p) => p.idNo === id);
  }

  get conversasPrivadas(): { idNo: string; apelido: string }[] {
    const vistas = new Map<string, string>();
    for (const i of this.itens) {
      if (!i.conversa.startsWith('privada:')) continue;
      const id = i.conversa.slice('privada:'.length);
      const p = this.pessoas.find((x) => x.idNo === id);
      vistas.set(id, p?.apelido ?? (i.propria ? vistas.get(id) : i.apelido) ?? id.slice(0, 6));
    }
    return [...vistas].map(([idNo, apelido]) => ({ idNo, apelido }));
  }

  avisar(texto: string, tipo: Aviso['tipo'] = 'info'): void {
    const id = this.proximoAviso++;
    this.avisos.push({ id, texto, tipo });
    setTimeout(() => {
      this.avisos = this.avisos.filter((a) => a.id !== id);
    }, 5000);
  }

  irPara(tela: Tela): void {
    this.tela = tela;
    if (location.hash !== `#/${tela}`) history.replaceState(null, '', `#/${tela}`);
    if (tela === 'conversa') this.naoLidas[this.conversaAberta] = 0;
  }

  abrirConversa(chave: string): void {
    this.conversaAberta = chave;
    this.naoLidas[chave] = 0;
    if (chave.startsWith('canal:')) this.nucleo?.selecionarConversa(chave.slice('canal:'.length));
    this.irPara('conversa');
  }

  async iniciar(apelido: string): Promise<void> {
    if (this.iniciando || this.pronto) return;
    this.iniciando = true;
    this.apelido = apelido.trim().slice(0, 24) || 'Sem nome';
    gravarPreferencia('apelido', this.apelido);
    try {
      this.ambiente.servidaPorRedeLocal = !!(await servidaPorRedeLocal());
      const nucleo = new Nucleo({ apelido: this.apelido, armazenamento: new ArmazenamentoLocal() });
      const canais = criarCanais(this.ambiente, () => ({ idNo: nucleo.idNo, apelido: this.apelido }));
      for (const c of canais.todos) nucleo.registrarCanal(c);
      const voz = new Voz(nucleo);
      this.ligarEventos(nucleo, voz);
      await voz.preparar();
      this.nucleo = nucleo;
      this.voz = voz;
      this.canaisCliente = canais;
      this.conversas = nucleo.conversasAtivas();
      this.conversaAberta = chaveConversaCanal(nucleo.conversaAtual.id);
      await this.carregarHistorico();
      const ligados = lerPreferencia<IdCanal[] | undefined>('canaisLigados', undefined) ?? canais.automaticos;
      // Som e Morse precisam de um toque para liberar o áudio: ficam para o usuário ligar.
      const iniciais = ligados.filter((id) => !['som', 'som-morse', 'radio'].includes(id) || this.ambiente.cliente !== 'web');
      await nucleo.iniciar(iniciais.filter((id) => canais.todos.some((c) => c.id === id)));
      this.canais = nucleo.estadoCanais();
      if (this.compartilharPosicao) this.ligarPosicao();
      void observarBateria((n) => nucleo.definirBateria(n));
      reaplicarTravaAoVoltar(() => this.radioLigado);
      this.pronto = true;
    } catch (e) {
      this.avisar(`Falha ao iniciar: ${e instanceof Error ? e.message : e}`, 'erro');
    } finally {
      this.iniciando = false;
    }
  }

  private ligarEventos(nucleo: Nucleo, voz: Voz): void {
    nucleo.on('mensagem', (m) => this.receber(m));
    nucleo.on('estadoMensagem', (e) => this.atualizarEstado(e));
    nucleo.on('pessoas', (p) => (this.pessoas = p));
    nucleo.on('canais', (c) => (this.canais = c));
    nucleo.on('erro', (e) => {
      if (e.canal) this.errosCanal[e.canal] = e.mensagem;
    });
    nucleo.on('trafego', (t) => {
      if (t.direcao === 'entrada') this.trafego.entrada++;
      else this.trafego.saida++;
    });
    voz.aoMudarPtt((e) => (this.ptt = e));
    voz.on('nivel', (n) => (this.nivelMicrofone = n));
    voz.on('erro', (e) => this.avisar(e, 'erro'));
    voz.on('mensagens', (lista) => {
      for (const m of lista) {
        if (this.itens.some((i) => i.chave === m.chave)) continue;
        const conversa = chaveConversaCanal(m.conversa.tipo === 'canal' ? m.conversa.id : '');
        this.adicionar({
          chave: m.chave,
          conversa,
          de: m.de,
          apelido: m.apelido,
          voz: m,
          propria: !!m.propria,
          saltos: m.saltos,
          carimbo: m.recebidaEm,
          estado: m.propria ? 'enviada' : undefined,
        });
      }
    });
  }

  private receber(m: MensagemRecebida): void {
    if (this.teste.registrar(m)) return;
    const conversa =
      m.conversa.tipo === 'privada' ? chaveConversaPrivada(m.conversa.com) : chaveConversaCanal(m.conversa.id);
    this.adicionar({
      chave: m.chave,
      conversa,
      de: m.de,
      apelido: m.anonima ? `Desconhecido (${m.viaCanal})` : m.apelido,
      texto: m.texto,
      propria: false,
      viaCanal: m.viaCanal,
      saltos: m.saltos,
      carimbo: m.carimbo,
      verificada: m.verificada,
      cifrada: m.cifrada,
      anonima: m.anonima,
    });
  }

  private adicionar(item: ItemConversa): void {
    const antecipado = this.estadosAntecipados.get(item.chave);
    if (antecipado) {
      item.estado = antecipado.estado;
      item.canais = antecipado.canais;
      this.estadosAntecipados.delete(item.chave);
    }
    this.itens.push(item);
    if (this.itens.length > MAX_ITENS) this.itens.splice(0, this.itens.length - MAX_ITENS);
    if (!item.propria && (this.tela !== 'conversa' || this.conversaAberta !== item.conversa)) {
      this.naoLidas[item.conversa] = (this.naoLidas[item.conversa] ?? 0) + 1;
    }
    this.salvarHistorico();
  }

  private atualizarEstado(e: EstadoMensagemPropria): void {
    const item = this.itens.find((i) => i.chave === e.chave);
    if (!item) {
      this.estadosAntecipados.set(e.chave, e);
      return;
    }
    item.estado = e.estado;
    item.canais = e.canais;
    this.salvarHistorico();
  }

  async enviarTexto(texto: string, importante = false): Promise<void> {
    const nucleo = this.nucleo;
    const limpo = texto.trim();
    if (!nucleo || !limpo) return;
    try {
      const privada = this.conversaAberta.startsWith('privada:') ? this.conversaAberta.slice(8) : undefined;
      const conversa = privada ? undefined : this.conversaAberta.slice('canal:'.length);
      const estado = await nucleo.enviarTexto(limpo, { para: privada, conversa, importante });
      this.adicionar({
        chave: estado.chave,
        conversa: this.conversaAberta,
        de: nucleo.idNo,
        apelido: this.apelido,
        texto: limpo,
        propria: true,
        estado: estado.estado,
        canais: estado.canais,
        saltos: 0,
        carimbo: Date.now(),
      });
    } catch (e) {
      this.avisar(e instanceof Error ? e.message : String(e), 'erro');
    }
  }

  /** Texto puro por um canal Morse (luz ou som). */
  async enviarMorse(canal: 'luz' | 'som-morse', texto: string): Promise<void> {
    const nucleo = this.nucleo;
    if (!nucleo || !texto.trim()) return;
    try {
      await nucleo.enviarTextoPuro(canal, texto);
      this.adicionar({
        chave: `morse:${Date.now()}`,
        conversa: chaveConversaCanal(nucleo.conversasAtivas()[0]!.id),
        de: nucleo.idNo,
        apelido: this.apelido,
        texto: texto.trim(),
        propria: true,
        estado: 'enviada',
        canais: [canal],
        saltos: 0,
        carimbo: Date.now(),
      });
    } catch (e) {
      this.avisar(e instanceof Error ? e.message : String(e), 'erro');
    }
  }

  async alternarCanal(id: IdCanal, ligar: boolean): Promise<void> {
    const nucleo = this.nucleo;
    if (!nucleo) return;
    delete this.errosCanal[id];
    if (ligar) {
      const ok = await nucleo.ativarCanal(id);
      if (!ok) {
        const erro = nucleo.estadoCanais().find((c) => c.id === id)?.erro;
        this.avisar(`Não deu para ligar: ${erro ?? 'canal indisponível'}`, 'erro');
      }
    } else {
      await nucleo.desativarCanal(id);
    }
    gravarPreferencia(
      'canaisLigados',
      nucleo.estadoCanais().filter((c) => c.ativo).map((c) => c.id),
    );
  }

  entrarConversa(nome: string, senha?: string): void {
    const nucleo = this.nucleo;
    if (!nucleo || !nome.trim()) return;
    const c = nucleo.entrarConversa(nome, senha || undefined);
    this.conversas = nucleo.conversasAtivas();
    this.abrirConversa(chaveConversaCanal(c.id));
  }

  sairConversa(id: string): void {
    const nucleo = this.nucleo;
    if (!nucleo) return;
    nucleo.sairConversa(id);
    this.conversas = nucleo.conversasAtivas();
    if (this.conversaAberta === chaveConversaCanal(id)) this.conversaAberta = chaveConversaCanal(this.conversas[0]!.id);
  }

  definirApelido(apelido: string): void {
    const limpo = apelido.trim().slice(0, 24);
    if (!limpo) return;
    this.apelido = limpo;
    gravarPreferencia('apelido', limpo);
    this.nucleo?.definirApelido(limpo);
  }

  definirCompartilharPosicao(sim: boolean): void {
    this.compartilharPosicao = sim;
    gravarPreferencia('compartilharPosicao', sim);
    this.nucleo?.definirCompartilharPosicao(sim);
    if (sim) this.ligarPosicao();
    else {
      this.pararPosicao?.();
      this.pararPosicao = undefined;
    }
  }

  private ligarPosicao(): void {
    if (this.pararPosicao) return;
    this.pararPosicao = observarPosicao((p) => {
      this.posicao = p;
      this.nucleo?.definirPosicao(p);
    });
  }

  async alternarModoRadio(): Promise<void> {
    const ligar = !this.radioLigado;
    try {
      await modoRadio(ligar);
      this.radioLigado = ligar;
    } catch (e) {
      this.avisar(`Modo rádio: ${e instanceof Error ? e.message : e}`, 'erro');
    }
  }

  private salvarAgendado?: ReturnType<typeof setTimeout>;

  private salvarHistorico(): void {
    if (this.salvarAgendado) return;
    this.salvarAgendado = setTimeout(() => {
      this.salvarAgendado = undefined;
      // Voz não vai para o histórico (ocuparia espaço demais).
      const textos = $state.snapshot(this.itens).filter((i) => i.texto !== undefined).map((i) => ({ ...i, voz: undefined }));
      void new ArmazenamentoLocal().gravar(CHAVE_HISTORICO, JSON.stringify(textos.slice(-200)));
    }, 800);
  }

  private async carregarHistorico(): Promise<void> {
    const texto = await new ArmazenamentoLocal().ler(CHAVE_HISTORICO);
    if (!texto) return;
    try {
      const lista = JSON.parse(texto) as ItemConversa[];
      // Mensagens de sessões passadas: a identidade era outra.
      this.itens = lista.map((i) => ({ ...i, estado: i.propria && i.estado === 'pendente' ? 'pendente' : i.estado }));
    } catch {
      // Histórico corrompido: começa limpo.
    }
  }

  limparHistorico(): void {
    this.itens = [];
    void new ArmazenamentoLocal().apagar(CHAVE_HISTORICO);
  }
}

export const app = new EstadoApp();
