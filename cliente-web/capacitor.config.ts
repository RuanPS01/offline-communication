import type { CapacitorConfig } from '@capacitor/cli';

// A mesma PWA vira a interface dos apps nativos. Os canais com rádio (BLE,
// Wi-Fi P2P, NFC, servidor local, lanterna) entram como plugins nativos.
const config: CapacitorConfig = {
  appId: 'io.github.ruanps01.comunicacaooffline',
  appName: 'Comunicação Offline',
  webDir: 'dist',
  android: {
    path: '../cliente-android',
    // Permite falar com servidores de rede local em ws:// a partir do app.
    allowMixedContent: true,
  },
  ios: {
    path: '../cliente-ios',
  },
};

export default config;
