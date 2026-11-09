// Gera os PNGs do ícone a partir do SVG, usando o Chromium do Playwright.
//   node cliente-web/scripts/gerar-icones.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icones');
const svg = readFileSync(join(pasta, 'icone.svg'), 'utf8');
const saidas = [
  ['icone-192.png', 192, false],
  ['icone-512.png', 512, false],
  ['apple-touch-icon.png', 180, true],
];

const navegador = await chromium.launch();
const pagina = await navegador.newPage();
for (const [nome, lado, cheio] of saidas) {
  // O ícone da Apple não aceita transparência: preenche o fundo inteiro.
  const conteudo = cheio ? svg.replace('rx="112"', 'rx="0"') : svg;
  await pagina.setViewportSize({ width: lado, height: lado });
  await pagina.setContent(
    `<html><body style="margin:0;background:transparent">${conteudo.replace('<svg ', `<svg width="${lado}" height="${lado}" `)}</body></html>`,
  );
  writeFileSync(join(pasta, nome), await pagina.screenshot({ omitBackground: !cheio }));
}
await navegador.close();
console.log('ícones gerados em', pasta);
