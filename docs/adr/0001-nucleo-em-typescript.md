# ADR 0001: núcleo em TypeScript, compartilhado pelos três clientes

Data: 09/11/2026. Situação: aceita.

## Contexto

O plano pede um núcleo escrito uma vez (protocolo, malha, presença, cripto e
fila) e exposto à web, ao Android e ao iOS, e deixa para a fase 0 a escolha
entre Kotlin Multiplatform e Rust, "testando qual compila melhor para WASM e
iOS no seu contexto". A regra que não pode ser quebrada é não reimplementar
protocolo, malha e cripto em cada lugar.

Três candidatos foram avaliados:

| Opção | Web | Android | iOS | Custo |
| --- | --- | --- | --- | --- |
| Kotlin Multiplatform | Kotlin/JS ou Kotlin/Wasm, saída grande | nativo | Kotlin/Native, compila só em macOS | interface duplicada (Compose e Svelte), cripto Ed25519 sem biblioteca comum madura |
| Rust | WASM com wasm-bindgen | JNI com uniffi e NDK | xcframework | três pontes de FFI, build pesado nos três pipelines |
| TypeScript + Capacitor | direto | o mesmo código no WebView, canais em Kotlin | o mesmo código no WKWebView, canais em Swift | uma ponte genérica para os canais nativos |

## Decisão

O núcleo é TypeScript (pacote `nucleo/`) e roda igual nos três clientes. Os
apps nativos são cascas Capacitor que carregam a mesma PWA; cada canal com
rádio (BLE, Wi-Fi P2P, servidor local, NFC, lanterna, LoRa) é um plugin
nativo em Kotlin e Swift que cumpre, do lado nativo, o mesmo contrato de
canal. A ponte é uma classe só (`canais/nativo`), que troca bytes em base64.

Consequências diretas:

- Protocolo, malha, presença, cripto, fila e roteamento existem em um único
  lugar e são testados uma vez (Vitest, em Node).
- A interface também é uma só (Svelte), o que vai além do plano, que previa
  Compose ou Flutter nos apps e Svelte ou React na web.
- A cripto usa as bibliotecas @noble (JavaScript puro, auditadas) em vez do
  WebCrypto, porque a página servida por outro celular na rede local chega
  por HTTP, onde o WebCrypto não existe.

## Consequências e riscos

- Com o app minimizado, o núcleo depende do WebView seguir rodando. No
  Android, o "modo rádio ligado" sobe um serviço em primeiro plano que mantém
  o processo vivo; no iOS, a mitigação é a mesma do plano: tela ativa e
  Multipeer entre iPhones. Se o teste de campo mostrar perda relevante em
  segundo plano, o caminho é rodar o mesmo pacote `nucleo` num motor
  JavaScript sem interface (JavaScriptCore no iOS, QuickJS ou J2V8 no
  Android) dentro do serviço nativo; o código do núcleo não muda.
- Voz: Opus via WebCodecs onde existe (Chrome, WebView do Android, Safari
  recente) e IMA ADPCM como reserva. Codec2 fica reservado no protocolo
  (`CODEC_CODEC2`) até haver o build WASM.
- O plano cita "KMP (ou Rust)" nos clientes nativos do monorepo; aqui
  `cliente-android/` e `cliente-ios/` são projetos Capacitor. A troca para
  KMP ou Rust continua possível no futuro, porque o protocolo está
  especificado em `docs/protocolo.md` e coberto por testes.
