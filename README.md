# Comunicação Offline

Plataforma única para conversar com quem está por perto sem internet nem
sinal de celular. Um núcleo comum cuida de mensagem, malha, presença, cripto
e voz; cada forma de comunicar (Bluetooth, Wi-Fi direto, rede local, som, QR,
luz, NFC, rádio LoRa) é um plugin que cumpre o mesmo contrato de canal.

- **Um contrato, muitos canais.** Canal novo é uma classe nova registrada no
  núcleo. Nada mais muda.
- **Degrada com graça.** Se ninguém responde por um canal, a mesma mensagem
  sai sozinha pelo próximo (BLE, depois som, depois QR).
- **O máximo roda na web.** Som, QR e rede local funcionam em qualquer
  celular só abrindo a página; os apps habilitam os rádios.

## Estrutura

```
nucleo/            protocolo, malha, presença, cripto, fila e roteador (TypeScript, compartilhado)
midia/             voz: Opus (WebCodecs) e ADPCM, apertar para falar, buffer de tremulação
canais/
  memoria/         canal simulado, para testes da malha
  som/             dados por áudio com ggwave (web e apps)
  qr/              QR em Base45 entre tela e câmera
  rede-local/      servidor HTTP + WebSocket + mDNS (Node, Kotlin e Swift) e clientes
  morse/           Morse por luz (lanterna, tela e câmera) e por som (tom e Goertzel)
  ble/             malha BLE com GATT próprio (Kotlin e Swift)
  wifi/            Nearby Connections (Android) e Multipeer (iOS)
  nfc/             HCE e leitor (Android), leitor (iOS), adesivos (Web NFC)
  radio/           LoRa por módulo externo (KISS sobre UART BLE) e firmware do ESP32
  nativo/          ponte entre o contrato de canal e os plugins nativos
cliente-web/       PWA em Svelte; também é a interface dos apps (Capacitor)
cliente-android/   app Android (Capacitor), com os plugins Kotlin dos canais
cliente-ios/       app iOS (Capacitor, Swift Package Manager), com os plugins Swift
site/              página central do GitHub Pages (detecção do aparelho e downloads)
servidor-udid/     Cloudflare Worker de cadastro de iPhones para o ad hoc
testes-e2e/        ponta a ponta no Chromium (rede local, som e QR)
docs/              decisão de arquitetura, protocolo, canais, distribuição e testes de campo
.github/workflows/ ci, build-android, build-ios e pages
```

O núcleo é TypeScript e roda igual na web e dentro dos apps; só os plugins de
canal têm parte nativa. A escolha (fase 0 do plano, entre Kotlin
Multiplatform e Rust) está em [docs/adr/0001-nucleo-em-typescript.md](docs/adr/0001-nucleo-em-typescript.md).

## Situação por fase do roadmap

| Fase | Situação | Critério de saída |
| --- | --- | --- |
| 1. Fundação | pronta | testado: mensagem com TTL atravessa três nós simulados |
| 2. Hub web | pronta | testado no Chromium com microfone e câmera falsos: presença e texto por som e por QR, só pela página; falta a prova em campo com um iPhone |
| 3. Malha Android | código pronto, APK compila | falta o teste em campo (5 Androids, 1 hora, voz e radar) |
| 4. Rede local e mapa | pronta | testado no Chromium: um servidor e três clientes conversando, inclusive em particular |
| 5. iPhone e ponte | código pronto (sintaxe Swift verificada, compila no CI em macOS) | falta assinar e instalar ad hoc, e testar BLE entre Android e iPhone |
| 6. Canais exóticos | Morse por luz e som, NFC, LoRa e canais privados prontos | Wi-Fi Aware, Codec2 (WASM) e ciclos de varredura adaptativos ficam para depois |

## Começando

Requer Node 22 ou mais novo e **npm 11** (o Node 24 já traz; com o Node 22,
use `npx npm@11 install`).

```bash
npm install
```

```bash
npm test
```

```bash
npm run dev
```

Outros comandos:

| Comando | O que faz |
| --- | --- |
| `npm run typecheck` | TypeScript e Svelte |
| `npm run build` | PWA (`cliente-web/dist`) e página central (`site/dist`) |
| `npm run e2e` | ponta a ponta no Chromium (precisa do Playwright) |
| `npm run servidor-local` | serve a PWA na rede local, com hub WebSocket e mDNS |
| `npm run android:sync` | build da PWA e cópia para o projeto Android |
| `npm run ios:sync` | idem para o iOS |

Para gerar o APK: `npm run android:sync` e, em `cliente-android/`,
`./gradlew assembleDebug` (Android SDK 36 e JDK 21). Para o iOS:
`npm run ios:sync` e abra `cliente-ios/App/App.xcodeproj` no Xcode.

## Como usar

1. Abra a página (GitHub Pages) e escolha: usar no navegador, instalar a PWA,
   baixar o APK ou, num iPhone cadastrado, instalar o app ad hoc.
2. Escolha um apelido. A identidade é nova a cada abertura.
3. Em Canais, ligue os meios disponíveis. Sem app: som, QR e rede local. Com
   app: Bluetooth e Wi-Fi direto já ligam sozinhos.
4. O radar mostra quem está por perto, por qual canal e a quantos saltos.
   Toque numa pessoa para conversar em particular (cifrado de ponta a ponta).
5. Segure o botão para falar com o canal (com Wi-Fi, Bluetooth ou rede
   local), ou grave uma mensagem de voz que segue pela malha.
6. Para um grupo sem internet: um celular vira servidor (Canais, Rede local)
   e os outros abrem o endereço dele.

## Documentação

- [Protocolo](docs/protocolo.md): formato do pacote, malha, roteamento, cripto, voz e enquadramento de cada canal.
- [Canais](docs/canais.md): contrato, capacidades, como adicionar um canal.
- [Distribuição](docs/distribuicao.md): Pages, secrets do Android e do iOS, cadastro de UDID e releases.
- [Testes de campo](docs/testes-de-campo.md): roteiro, planilha e riscos.
- [Firmware LoRa](canais/radio/firmware/LEIAME.md).

## Limites conhecidos

- Página aberta pelo servidor de rede local de outro celular chega por HTTP:
  o navegador bloqueia câmera, microfone e service worker nela. Texto e
  presença funcionam; para som, QR e voz use a página do GitHub Pages ou o app.
- Navegadores exigem um toque para liberar o áudio: o canal de som é ligado
  à mão em Canais.
- A lanterna só é controlável pela web no Chrome do Android; no iPhone, a PWA
  pisca a tela e recebe pela câmera.
- No iPhone, a malha BLE se mantém com o app aberto (modo rádio com tela
  ativa); o iOS limita o Bluetooth em segundo plano.
