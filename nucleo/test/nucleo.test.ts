import { MeioSimulado } from '@plataforma/canal-memoria';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CODEC_ADPCM,
  type EstadoMensagemPropria,
  type EventoMensagemVoz,
  type EventoQuadroVoz,
  type MensagemRecebida,
  Nucleo,
} from '../src/index.ts';
import { ate, criarRede, esperar, type Rede } from './auxiliares.ts';

let rede: Rede | undefined;

afterEach(async () => {
  await rede?.parar();
  rede = undefined;
});

function coletar(n: Nucleo): MensagemRecebida[] {
  const lista: MensagemRecebida[] = [];
  n.on('mensagem', (m) => lista.push(m));
  return lista;
}

function estados(n: Nucleo): EstadoMensagemPropria[] {
  const lista: EstadoMensagemPropria[] = [];
  n.on('estadoMensagem', (e) => lista.push(e));
  return lista;
}

async function iniciarTodos(r: Rede): Promise<void> {
  await Promise.all(Object.values(r.nos).map((n) => n.iniciar()));
}

describe('núcleo sobre o canal simulado', () => {
  it('critério da fase 1: uma mensagem com TTL atravessa três nós simulados', async () => {
    rede = criarRede(['A', 'B', 'C']);
    rede.meio.emLinha('A', 'B', 'C');
    await iniciarTodos(rede);
    const emC = coletar(rede.nos.C!);
    const emB = coletar(rede.nos.B!);

    await rede.nos.A!.enviarTexto('alguém me ouve?');
    await ate(() => emC.length === 1);

    expect(emC[0]!.texto).toBe('alguém me ouve?');
    expect(emC[0]!.saltos).toBe(1); // A para B (0), B para C (1)
    expect(emC[0]!.de).toBe(rede.nos.A!.idNo);
    expect(emC[0]!.apelido).toBe('A');
    expect(emC[0]!.verificada).toBe(true);
    expect(emB).toHaveLength(1);
  });

  it('o TTL limita o alcance', async () => {
    const nomes = ['N0', 'N1', 'N2', 'N3', 'N4', 'N5'];
    rede = criarRede(nomes, { ttlPadrao: 3 });
    rede.meio.emLinha(...nomes);
    await iniciarTodos(rede);
    const recebidas = Object.fromEntries(nomes.map((n) => [n, coletar(rede!.nos[n]!)]));

    await rede.nos.N0!.enviarTexto('teste de alcance');
    await esperar(100);

    // ttl 3: N1 recebe e repassa (ttl 2), N2 recebe e repassa (ttl 1), N3 recebe e para.
    expect(recebidas.N1).toHaveLength(1);
    expect(recebidas.N2).toHaveLength(1);
    expect(recebidas.N3).toHaveLength(1);
    expect(recebidas.N4).toHaveLength(0);
    expect(recebidas.N5).toHaveLength(0);
  });

  it('deduplica: numa malha com ciclos cada um recebe uma vez só', async () => {
    rede = criarRede(['A', 'B', 'C', 'D']);
    const { meio } = rede;
    meio.ligar('A', 'B');
    meio.ligar('A', 'C');
    meio.ligar('B', 'C');
    meio.ligar('B', 'D');
    meio.ligar('C', 'D');
    await iniciarTodos(rede);
    const emD = coletar(rede.nos.D!);
    const emB = coletar(rede.nos.B!);

    await rede.nos.A!.enviarTexto('uma vez só');
    await esperar(100);

    expect(emD).toHaveLength(1);
    expect(emB).toHaveLength(1);
    expect(rede.nos.D!.estatisticas.duplicados).toBeGreaterThan(0);
  });

  it('o eco de um vizinho marca a mensagem como ouvida', async () => {
    rede = criarRede(['A', 'B']);
    rede.meio.ligar('A', 'B');
    await iniciarTodos(rede);
    const e = estados(rede.nos.A!);

    await rede.nos.A!.enviarTexto('oi');
    await ate(() => e.some((x) => x.estado === 'ouvida'));
    expect(e[0]!.estado).toBe('enviada');
  });

  it('conversa privada: o intermediário retransmite sem ler e a entrega é confirmada', async () => {
    rede = criarRede(['A', 'B', 'C']);
    rede.meio.emLinha('A', 'B', 'C');
    await iniciarTodos(rede);
    await ate(() => rede!.nos.A!.pessoas().some((p) => p.idNo === rede!.nos.C!.idNo));
    const emB = coletar(rede.nos.B!);
    const emC = coletar(rede.nos.C!);
    const e = estados(rede.nos.A!);

    await rede.nos.A!.enviarTexto('só para você', { para: rede.nos.C!.idNo });
    await ate(() => emC.length === 1);
    expect(emC[0]!.texto).toBe('só para você');
    expect(emC[0]!.conversa).toEqual({ tipo: 'privada', com: rede.nos.A!.idNo });
    expect(emC[0]!.cifrada).toBe(true);
    expect(emB).toHaveLength(0);

    await ate(() => e.some((x) => x.estado === 'entregue'));
    expect(rede.nos.A!.fila.lista().some((i) => i.propria && i.destino === rede!.nos.C!.idNo)).toBe(false);
  });

  it('canal privado: só quem tem a senha lê, mas todos retransmitem', async () => {
    rede = criarRede(['A', 'B', 'C']);
    rede.meio.emLinha('A', 'B', 'C');
    for (const n of ['A', 'C']) rede.nos[n]!.entrarConversa('família', 'segredo');
    await iniciarTodos(rede);
    const emB = coletar(rede.nos.B!);
    const emC = coletar(rede.nos.C!);

    await rede.nos.A!.enviarTexto('vamos para a casa da avó');
    await ate(() => emC.length === 1);
    expect(emC[0]!.texto).toBe('vamos para a casa da avó');
    expect(emC[0]!.conversa).toMatchObject({ tipo: 'canal', nome: 'família', privado: true });
    expect(emB).toHaveLength(0);
  });

  it('store-and-forward: a mensagem espera o destino voltar ao alcance', async () => {
    rede = criarRede(['A', 'B', 'C']);
    rede.meio.emLinha('A', 'B', 'C');
    await iniciarTodos(rede);
    await ate(() => rede!.nos.A!.pessoas().some((p) => p.idNo === rede!.nos.C!.idNo));

    // C se afasta.
    rede.meio.desligar('B', 'C');
    const emC = coletar(rede.nos.C!);
    const e = estados(rede.nos.A!);
    await rede.nos.A!.enviarTexto('quando voltar, me procure', { para: rede.nos.C!.idNo });
    await esperar(50);
    expect(emC).toHaveLength(0);
    // B carregou a mensagem.
    expect(rede.nos.B!.fila.tamanho).toBeGreaterThan(0);

    // C volta: B entrega o que estava guardado.
    rede.meio.ligar('B', 'C');
    await ate(() => emC.length === 1);
    expect(emC[0]!.texto).toBe('quando voltar, me procure');
    await ate(() => e.some((x) => x.estado === 'entregue'));
  });

  it('fragmenta mensagens maiores que a MTU do canal', async () => {
    rede = criarRede(['A', 'B', 'C'], {}, { mtu: 64 });
    rede.meio.emLinha('A', 'B', 'C');
    await iniciarTodos(rede);
    const emC = coletar(rede.nos.C!);
    const longo = 'Mensagem longa que não cabe num pacote só. '.repeat(8);

    await rede.nos.A!.enviarTexto(longo);
    await ate(() => emC.length === 1);
    expect(emC[0]!.texto).toBe(longo);
  });

  it('voz ao vivo até 2 saltos; depois vira mensagem de voz guardada', async () => {
    rede = criarRede(['A', 'B', 'C', 'D']);
    rede.meio.emLinha('A', 'B', 'C', 'D');
    await iniciarTodos(rede);
    await ate(() => rede!.nos.D!.pessoas().some((p) => p.apelido === 'A'));
    const quadros: Record<string, EventoQuadroVoz[]> = { B: [], C: [], D: [] };
    const gravadas: Record<string, EventoMensagemVoz[]> = { B: [], C: [], D: [] };
    for (const n of ['B', 'C', 'D']) {
      rede.nos[n]!.on('quadroVoz', (q) => quadros[n]!.push(q));
      rede.nos[n]!.on('mensagemVoz', (m) => gravadas[n]!.push(m));
    }
    let falando = '';
    rede.nos.D!.on('inicioFala', (f) => (falando = f.apelido ?? ''));

    const a = rede.nos.A!;
    const sessao = a.iniciarFala(CODEC_ADPCM);
    for (let seq = 0; seq < 5; seq++) a.enviarQuadroVoz(sessao, seq, CODEC_ADPCM, new Uint8Array([seq, 1, 2, 3]));
    a.terminarFala(sessao, 5);

    await ate(() => gravadas.D!.length === 1);
    expect(quadros.B).toHaveLength(5);
    expect(quadros.C).toHaveLength(5);
    expect(quadros.D).toHaveLength(0);
    expect(falando).toBe('');
    const m = gravadas.D![0]!;
    expect(m.de).toBe(a.idNo);
    expect(m.apelido).toBe('A');
    expect(m.quadros.map((q) => q.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(gravadas.B).toHaveLength(0);
    expect(gravadas.C).toHaveLength(0);
  });

  it('degrada com graça: sem resposta, a mensagem sai por outro canal', async () => {
    const meioRapido = new MeioSimulado();
    const meioSom = new MeioSimulado();
    const criar = (nome: string) => {
      const n = new Nucleo({ apelido: nome, atrasoRepasseMs: [0, 0], intervaloPresencaMs: 60_000, esperaEscalonamentoMs: 80 });
      n.registrarCanal(meioRapido.criarCanal(nome, { custo: 2 }, 'ble'));
      n.registrarCanal(
        meioSom.criarCanal(nome, { custo: 6, bytesPorSegundo: 16, mtu: 140, aoVivo: false }, 'som', {
          avisarVizinhos: false,
        }),
      );
      return n;
    };
    const a = criar('A');
    const b = criar('B');
    rede = { meio: meioRapido, nos: { A: a, B: b }, parar: async () => void (await Promise.all([a.parar(), b.parar()])) };
    await a.iniciar();
    await b.iniciar();
    // Só o som alcança B, mas A ainda não ouviu ninguém: tenta primeiro o BLE, mais barato.
    meioSom.ligar('A', 'B');
    const emB = coletar(b);
    const e = estados(a);

    await a.enviarTexto('socorro');
    expect(e[0]!.canais).toEqual(['ble']);
    await ate(() => emB.length === 1, 2000);
    expect(emB[0]!.viaCanal).toBe('som');
    await ate(() => e.some((x) => x.canais.includes('som')));
  });
});
