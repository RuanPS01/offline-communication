import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import pacote from './package.json' with { type: 'json' };

export default defineConfig({
  // Caminhos relativos: a mesma build roda em /app/ no GitHub Pages, na raiz
  // do servidor de rede local de um celular e dentro dos apps nativos.
  base: './',
  define: {
    __VERSAO__: JSON.stringify(process.env.VERSAO_APP ?? pacote.version),
  },
  plugins: [
    svelte(),
    VitePWA({
      injectRegister: null,
      registerType: 'autoUpdate',
      includeAssets: ['icones/*.svg', 'icones/*.png'],
      manifest: {
        name: 'Comunicação Offline',
        short_name: 'Offline',
        description: 'Comunicação próxima sem internet: som, QR, rede local e mais.',
        lang: 'pt-BR',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0e1a1b',
        theme_color: '#0e1a1b',
        icons: [
          { src: 'icones/icone-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icones/icone-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icones/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,wasm,webmanifest}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  server: {
    host: true,
  },
});
