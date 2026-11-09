import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { ehAppNativo } from '@plataforma/canal-nativo';

const app = mount(App, { target: document.getElementById('app')! });

// Service worker só na web e com HTTPS: dentro do app nativo os arquivos já
// vêm no pacote, e na página servida por outro celular (HTTP) não é permitido.
if (!ehAppNativo() && globalThis.isSecureContext && 'serviceWorker' in navigator) {
  import('virtual:pwa-register')
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch(() => undefined);
}

export default app;
