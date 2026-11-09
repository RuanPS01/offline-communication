# Canais

Cada forma de comunicar é um plugin que implementa o contrato de
`nucleo/src/canal.ts`. O núcleo não sabe qual rádio está embaixo.

```ts
interface Canal {
  id: string;                 // "ble", "som", "qr", "rede-local"...
  nome: string;
  capacidades: Capacidades;
  disponivel(): Promise<boolean>;
  iniciar(onPacote, onVizinho): Promise<void>;
  anunciar(presenca: Uint8Array): Promise<void>;
  enviar(pacote: Uint8Array, destino?: string): Promise<void>;
  parar(): Promise<void>;
}

interface Capacidades {
  bytesPorSegundo: number;
  aoVivo: boolean;        // serve para voz em tempo real?
  bidirecional: boolean;
  alcanceMetros: number;
  mtu: number;            // acima disso o núcleo fragmenta
  custo?: number;         // menor = mais barato (energia, ruído, incômodo)
  exigeAcao?: boolean;    // mirar a câmera, encostar os celulares
  meioUnico?: boolean;    // um envio alcança todos (não repetir no mesmo canal)
  somenteTexto?: boolean; // Morse: o núcleo entrega texto puro, sem pacote
}
```

Em relação ao pseudocódigo do plano, `disponivel()` virou assíncrono (a
checagem no nativo passa pela ponte) e as capacidades ganharam `mtu`,
`custo`, `exigeAcao`, `meioUnico` e `somenteTexto`, que o roteador usa.

## Canais implementados

| Canal | Pacote | Web | Android | iOS | Vazão | Alcance | Ao vivo | Custo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Rede local | `canais/rede-local` | cliente WebSocket | servidor NanoHTTPD + NSD + hotspot, cliente OkHttp | servidor Network.framework + Bonjour, cliente URLSession | 200 kB/s | 50 m | sim | 1 |
| BLE / malha | `canais/ble` | não | GATT próprio | Core Bluetooth (mesmo GATT) | 8 kB/s | 30 m | sim | 2 |
| Wi-Fi P2P | `canais/wifi` | não | Nearby Connections | Multipeer | 250 kB/s | 60 m | sim | 3 |
| Rádio LoRa | `canais/radio` | Web Bluetooth (Chrome) | UART BLE | UART BLE | 100 B/s | 3 km | não | 4 |
| NFC | `canais/nfc` | Web NFC (adesivos) | HCE + leitor | leitor | 2 kB/s | 5 cm | não | 5 |
| Som (ggwave) | `canais/som` | Web Audio | WebView | WebView | 20 B/s | 4 m | não | 6 |
| QR | `canais/qr` | câmera + BarcodeDetector ou jsQR | WebView | WebView | 250 B/s | 1 m | não | 7 |
| Som Morse | `canais/morse` | Web Audio + Goertzel | WebView | WebView | 2 B/s | 30 m | não | 8 |
| Luz (Morse) | `canais/morse` | recebe pela câmera; pisca a tela ou a lanterna (Android) | lanterna nativa | lanterna nativa | 1 B/s | 300 m | não | 9 |
| Simulado | `canais/memoria` | testes | | | | | | |

## Como adicionar um canal

1. Crie `canais/<nome>/` com `package.json` (`@plataforma/canal-<nome>`) e
   `src/index.ts` exportando uma classe que implementa `Canal`.
2. Se precisar de código nativo, adicione `"capacitor": {"android": {"src":
   "android"}, "ios": {"src": "ios"}}` ao `package.json`, um módulo Gradle
   em `android/` (veja `canais/ble/android/build.gradle`) e um pacote Swift
   (`Package.swift` na raiz do canal e fontes em `ios/Sources/`). O plugin
   nativo expõe `disponivel`, `iniciar`, `anunciar`, `enviar` e `parar` e
   emite `pacote` e `vizinho`; do lado TypeScript basta estender
   `CanalNativo` de `@plataforma/canal-nativo`.
3. Registre o canal em `cliente-web/src/lib/canais.ts`.
4. Escreva testes em `canais/<nome>/test/`. Para testar a malha com o canal,
   use `MeioSimulado` de `@plataforma/canal-memoria` como modelo.

Nada no núcleo ou nas telas precisa mudar.

## Detalhes de cada canal

- **Som:** o ggwave só decodifica bem recebendo quadros inteiros de 1024
  amostras a 48 kHz; o modem reamostra o microfone de forma contínua para
  isso (microfones a 44,1 kHz são comuns no Android). Cancelamento de eco e
  supressão de ruído ficam desligados, porque destroem o sinal.
- **QR:** a tela mostra em rodízio a presença e os últimos pacotes enviados.
  Base45 no lugar de bytes crus porque os leitores devolvem texto.
- **Luz:** a câmera é reduzida a uma grade de 8 por 6 células; o receptor usa
  a célula escolhida pelo toque ou a que mais variou nos últimos 2,5 s. Um
  detector de nível com limiar adaptativo, histerese e filtro contra
  cintilação separa ligado e desligado, e o decodificador estima o tamanho do
  ponto continuamente, aceitando o ritmo irregular de quem pisca à mão.
- **Rede local:** um aparelho serve a PWA e faz o papel de hub. Página
  servida por HTTP não tem câmera, microfone nem service worker no navegador;
  texto, presença e voz gravada pelo app funcionam normalmente.
- **BLE:** cada aparelho é periférico e central ao mesmo tempo; até 7
  conexões. A ponte Android e iPhone é este canal.
- **NFC:** no Android, por padrão o aparelho fica como cartão (HCE); quem toca
  em "Ler" vira leitor e a troca acontece nos dois sentidos. O iPhone só lê.
- **Rádio:** o módulo externo (ESP32 com SX1276) usa o firmware em
  `canais/radio/firmware/`.
