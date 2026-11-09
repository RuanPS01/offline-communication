// Monta o site do GitHub Pages em site/dist:
//   /                  página central (detecção do aparelho, downloads, rede local)
//   /app/              a PWA (build do cliente-web)
//   /downloads/        APK, IPA e manifest.plist, quando existirem
//
// Variáveis de ambiente:
//   URL_SITE              endereço público (para o QR e o manifest do iOS)
//   PASTA_DOWNLOADS       pasta com comunicacao-offline.apk / .ipa (artefatos dos builds)
//   URL_CADASTRO_UDID     endereço do endpoint de cadastro de iPhones (Cloudflare Worker)
//   VERSAO_APP            versão publicada

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { qrSvg } from '../canais/qr/src/qr.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '..');
const saida = join(aqui, 'dist');
const urlSite = (process.env.URL_SITE ?? 'https://ruanps01.github.io/offline-communication/').replace(/\/?$/, '/');
const versao = process.env.VERSAO_APP ?? JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8')).version;
const pastaDownloads = process.env.PASTA_DOWNLOADS;
const app = join(raiz, 'cliente-web', 'dist');

if (!existsSync(join(app, 'index.html'))) {
  console.error('Faça antes o build da PWA: npm run build -w cliente-web');
  process.exit(1);
}

rmSync(saida, { recursive: true, force: true });
mkdirSync(join(saida, 'downloads'), { recursive: true });
cpSync(join(aqui, 'publico'), saida, { recursive: true });
cpSync(app, join(saida, 'app'), { recursive: true });

const temApk = !!pastaDownloads && existsSync(join(pastaDownloads, 'comunicacao-offline.apk'));
const temIpa = !!pastaDownloads && existsSync(join(pastaDownloads, 'comunicacao-offline.ipa'));
if (temApk) cpSync(join(pastaDownloads!, 'comunicacao-offline.apk'), join(saida, 'downloads', 'comunicacao-offline.apk'));
if (temIpa) {
  cpSync(join(pastaDownloads!, 'comunicacao-offline.ipa'), join(saida, 'downloads', 'comunicacao-offline.ipa'));
  // Manifesto da instalação ad hoc (itms-services).
  writeFileSync(
    join(saida, 'downloads', 'manifest.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key><string>software-package</string>
          <key>url</key><string>${urlSite}downloads/comunicacao-offline.ipa</string>
        </dict>
        <dict>
          <key>kind</key><string>display-image</string>
          <key>url</key><string>${urlSite}app/icones/icone-192.png</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key><string>io.github.ruanps01.comunicacaooffline</string>
        <key>bundle-version</key><string>${versao}</string>
        <key>kind</key><string>software</string>
        <key>title</key><string>Comunicação Offline</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>
`,
  );
}

const config = {
  versao,
  data: new Date().toLocaleDateString('pt-BR'),
  apk: temApk,
  ipa: temIpa,
  urlCadastroUdid: process.env.URL_CADASTRO_UDID || '',
};
writeFileSync(join(saida, 'config.js'), `window.CONFIG = ${JSON.stringify(config, null, 2)};\n`);

const indice = join(saida, 'index.html');
writeFileSync(indice, readFileSync(indice, 'utf8').replace('<!--QR_PAGINA-->', qrSvg(urlSite)));
// O GitHub Pages não deve processar o site com Jekyll.
writeFileSync(join(saida, '.nojekyll'), '');

console.log(`Site montado em ${saida} (APK: ${temApk ? 'sim' : 'não'}, IPA: ${temIpa ? 'sim' : 'não'})`);
