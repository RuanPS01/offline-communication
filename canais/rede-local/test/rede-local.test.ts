import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { iniciarServidor } from '../servidor/servidor.mjs';
import { desemoldurar, emoldurar, urlWebSocket } from '../src/moldura.js';

type Servidor = Awaited<ReturnType<typeof iniciarServidor>>;
let servidor: Servidor | undefined;
afterEach(async () => {
  await servidor?.fechar();
  servidor = undefined;
});

function cliente(porta: number): Promise<{ ws: WebSocket; id: string; quadros: { id: string; pacote: Uint8Array }[]; vizinhos: string[] }> {
  return new Promise((resolver) => {
    const ws = new WebSocket(`ws://127.0.0.1:${porta}/ws`);
    const c = { ws, id: '', quadros: [] as { id: string; pacote: Uint8Array }[], vizinhos: [] as string[] };
    ws.on('message', (dados, binario) => {
      if (binario) {
        c.quadros.push(desemoldurar(new Uint8Array(dados as Buffer)));
        return;
      }
      const m = JSON.parse(String(dados));
      if (m.tipo === 'boas-vindas') {
        c.id = m.id;
        resolver(c);
      }
      if (m.tipo === 'vizinho' && m.presente) c.vizinhos.push(m.id);
    });
  });
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('rede local', () => {
  it('moldura ida e volta', () => {
    const q = emoldurar('c12', Uint8Array.from([1, 2, 3]));
    expect(desemoldurar(q)).toEqual({ id: 'c12', pacote: Uint8Array.from([1, 2, 3]) });
    expect(urlWebSocket('http://192.168.43.1:8080/app/', {})).toBe('ws://192.168.43.1:8080/ws');
    expect(urlWebSocket('https://x.y/', { wsPorta: 8081, wsCaminho: '/' })).toBe('wss://x.y:8081/');
  });

  it('o servidor responde a /api/info e repassa pacotes entre clientes', async () => {
    servidor = await iniciarServidor({ porta: 0, anunciarMdns: false, nome: 'Teste' });
    const info = await (await fetch(`http://127.0.0.1:${servidor.porta}/api/info`)).json();
    expect(info).toMatchObject({ servico: 'sobrevivencia', nome: 'Teste', wsCaminho: '/ws' });

    const a = await cliente(servidor.porta);
    const b = await cliente(servidor.porta);
    const c = await cliente(servidor.porta);
    await esperar(50);
    expect(a.vizinhos.sort()).toEqual([b.id, c.id].sort());

    a.ws.send(emoldurar('', Uint8Array.from([9, 9])));
    b.ws.send(emoldurar(c.id, Uint8Array.from([7])));
    await esperar(100);
    expect(b.quadros).toEqual([{ id: a.id, pacote: Uint8Array.from([9, 9]) }]);
    expect(c.quadros).toContainEqual({ id: b.id, pacote: Uint8Array.from([7]) });
    expect(c.quadros).toHaveLength(2);
    expect(a.quadros).toHaveLength(0);
    for (const x of [a, b, c]) x.ws.close();
  });
});
