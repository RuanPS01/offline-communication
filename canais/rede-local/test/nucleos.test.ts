import { type MensagemRecebida, Nucleo } from '@plataforma/nucleo';
import { afterEach, describe, expect, it } from 'vitest';
import { iniciarServidor } from '../servidor/servidor.mjs';
import { CanalRedeLocal } from '../src/index.ts';

const limpar: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const f of limpar.splice(0).reverse()) await f();
});

async function ate(cond: () => boolean, limite = 3000): Promise<void> {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > limite) throw new Error('tempo esgotado');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('núcleos conversando pela rede local', () => {
  it('critério da fase 4: um serve, três clientes conversam', async () => {
    const servidor = await iniciarServidor({ porta: 0, anunciarMdns: false });
    limpar.push(() => servidor.fechar());
    const base = `http://127.0.0.1:${servidor.porta}/`;
    const nos = await Promise.all(
      ['Ana', 'Bia', 'Caio'].map(async (apelido) => {
        const n = new Nucleo({ apelido, atrasoRepasseMs: [0, 0], esperaEscalonamentoMs: 0 });
        n.registrarCanal(new CanalRedeLocal({ base }));
        const recebidas: MensagemRecebida[] = [];
        n.on('mensagem', (m) => recebidas.push(m));
        await n.iniciar();
        limpar.push(() => n.parar());
        return { n, recebidas };
      }),
    );
    const [ana, bia, caio] = nos as [(typeof nos)[0], (typeof nos)[0], (typeof nos)[0]];
    await ate(() => nos.every(({ n }) => n.pessoas().length === 2));

    await ana.n.enviarTexto('todos aqui?');
    await ate(() => bia.recebidas.length === 1 && caio.recebidas.length === 1);
    expect(bia.recebidas[0]!.saltos).toBe(0);
    expect(bia.recebidas[0]!.viaCanal).toBe('rede-local');

    await caio.n.enviarTexto('só para a Bia', { para: bia.n.idNo });
    await ate(() => bia.recebidas.length === 2);
    expect(bia.recebidas[1]!.conversa).toEqual({ tipo: 'privada', com: caio.n.idNo });
    expect(ana.recebidas).toHaveLength(0);
  });
});
