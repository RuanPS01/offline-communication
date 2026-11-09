#!/usr/bin/env node
// Servidor de rede local de referência (Node). Serve a PWA, faz o papel de
// "hub" WebSocket entre os clientes e se anuncia por mDNS. Útil para um
// notebook virar o ponto de encontro da rede, e para os testes.
//
//   node canais/rede-local/servidor/servidor.mjs --pasta cliente-web/dist --porta 8080

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  CAMINHO_INFO,
  CAMINHO_WS,
  desemoldurar,
  emoldurar,
  NOME_SERVICO,
  PORTA_PADRAO,
  VERSAO_REDE_LOCAL,
} from '../src/moldura.js';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * @param {{ pasta?: string, porta?: number, nome?: string, anunciarMdns?: boolean, host?: string }} opcoes
 */
export async function iniciarServidor(opcoes = {}) {
  const pasta = opcoes.pasta ? resolve(opcoes.pasta) : undefined;
  const nome = opcoes.nome ?? 'Ponto de encontro';
  const clientes = new Map();
  let proximoId = 1;

  const http = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    if (url.pathname === CAMINHO_INFO) {
      res.setHeader('Content-Type', TIPOS['.json']);
      res.end(
        JSON.stringify({
          servico: NOME_SERVICO,
          versao: VERSAO_REDE_LOCAL,
          nome,
          wsCaminho: CAMINHO_WS,
          clientes: clientes.size,
        }),
      );
      return;
    }
    if (!pasta) {
      res.statusCode = 404;
      res.end('sem pasta de arquivos');
      return;
    }
    let caminho = normalize(join(pasta, decodeURIComponent(url.pathname)));
    if (!caminho.startsWith(pasta)) {
      res.statusCode = 403;
      res.end();
      return;
    }
    if (!existsSync(caminho) || statSync(caminho).isDirectory()) {
      const indice = join(caminho, 'index.html');
      caminho = existsSync(indice) ? indice : join(pasta, 'index.html');
    }
    if (!existsSync(caminho)) {
      res.statusCode = 404;
      res.end('não encontrado');
      return;
    }
    res.setHeader('Content-Type', TIPOS[extname(caminho)] ?? 'application/octet-stream');
    createReadStream(caminho).pipe(res);
  });

  const wss = new WebSocketServer({ server: http, path: CAMINHO_WS });
  wss.on('connection', (ws) => {
    const id = `c${proximoId++}`;
    clientes.set(id, ws);
    ws.send(JSON.stringify({ tipo: 'boas-vindas', id, nome }));
    for (const [outroId, outro] of clientes) {
      if (outroId === id) continue;
      outro.send(JSON.stringify({ tipo: 'vizinho', id, presente: true }));
      ws.send(JSON.stringify({ tipo: 'vizinho', id: outroId, presente: true }));
    }
    ws.on('message', (dados, binario) => {
      if (!binario) return;
      let quadro;
      try {
        quadro = desemoldurar(new Uint8Array(dados));
      } catch {
        return;
      }
      const saida = emoldurar(id, quadro.pacote);
      if (quadro.id) {
        clientes.get(quadro.id)?.send(saida);
        return;
      }
      for (const [outroId, outro] of clientes) if (outroId !== id) outro.send(saida);
    });
    ws.on('close', () => {
      clientes.delete(id);
      for (const outro of clientes.values()) outro.send(JSON.stringify({ tipo: 'vizinho', id, presente: false }));
    });
  });

  await new Promise((r) => http.listen(opcoes.porta ?? PORTA_PADRAO, opcoes.host ?? '0.0.0.0', r));
  const porta = /** @type {import('node:net').AddressInfo} */ (http.address()).port;

  let mdns;
  if (opcoes.anunciarMdns !== false) {
    try {
      const { Bonjour } = await import('bonjour-service');
      mdns = new Bonjour();
      mdns.publish({ name: nome, type: NOME_SERVICO, port: porta });
    } catch {
      // bonjour-service é opcional.
    }
  }

  return {
    porta,
    enderecos: enderecosLocais().map((ip) => `http://${ip}:${porta}/`),
    clientes,
    fechar: async () => {
      mdns?.unpublishAll?.();
      mdns?.destroy?.();
      for (const ws of clientes.values()) ws.terminate();
      wss.close();
      await new Promise((r) => http.close(r));
    },
  };
}

export function enderecosLocais() {
  const ips = [];
  for (const lista of Object.values(networkInterfaces())) {
    for (const i of lista ?? []) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  }
  return ips;
}

function argumentos(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pasta') o.pasta = argv[++i];
    else if (a === '--porta') o.porta = Number(argv[++i]);
    else if (a === '--nome') o.nome = argv[++i];
    else if (a === '--sem-mdns') o.anunciarMdns = false;
  }
  return o;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = await iniciarServidor(argumentos(process.argv.slice(2)));
  console.log(`Servidor de rede local no ar (porta ${s.porta}). Peça para os outros abrirem:`);
  for (const e of s.enderecos) console.log(`  ${e}`);
}
