# Distribuição e pipelines

Três workflows alimentam uma página só, que é o ponto de entrada de tudo.

| Workflow | Quando roda | O que faz |
| --- | --- | --- |
| `ci` | push na main e pull requests | tipos, testes, build, ponta a ponta no Chromium, APK de depuração e compilação iOS no simulador |
| `build-android` | tag `v*` | APK assinado com a keystore dos secrets, publicado na release |
| `build-ios` | tag `v*` e cada UDID cadastrado | IPA ad hoc publicado na release (sem secrets, só compila) |
| `pages` | push na main e fim dos builds | monta a página central com a PWA e os instaladores da última release |

## 1. GitHub Pages

Em Settings, Pages, escolha "GitHub Actions" como fonte. A página fica em
`https://<dono>.github.io/<repositorio>/` e a PWA em `/app/`.

## 2. Android

Gere a keystore uma única vez e guarde-a com cuidado: sem ela, as
atualizações não instalam por cima.

```bash
keytool -genkeypair -v -keystore comunicacao-offline.jks -alias offline -keyalg RSA -keysize 4096 -validity 36500
```

```bash
base64 -w0 comunicacao-offline.jks
```

Secrets do repositório: `ANDROID_KEYSTORE_BASE64` (saída do comando acima),
`ANDROID_KEYSTORE_SENHA`, `ANDROID_CHAVE_APELIDO` (`offline`) e
`ANDROID_CHAVE_SENHA`.

## 3. iOS ad hoc

Precisa de uma conta do Apple Developer Program.

1. Crie um certificado **Apple Distribution**, exporte como `.p12` e salve em
   `IOS_CERTIFICADO_P12_BASE64` (base64) e `IOS_CERTIFICADO_SENHA`.
2. Em App Store Connect, Usuários e Acesso, Integrações, crie uma chave da
   API com papel de Administrador ou Desenvolvedor. Salve o conteúdo do
   `.p8` em `ASC_CHAVE_P8`, o id da chave em `ASC_ID_CHAVE` e o emissor em
   `ASC_ID_EMISSOR`.
3. Salve o id da equipe em `IOS_EQUIPE_ID`.
4. Registre o identificador `io.github.ruanps01.comunicacaooffline` com a
   capacidade de leitura de NFC (o Xcode faz isso sozinho na primeira
   assinatura automática, com a chave da API).

O build usa assinatura automática (`-allowProvisioningUpdates`), que gera o
perfil ad hoc com todos os aparelhos cadastrados. O limite da Apple é de 100
iPhones por ano; quem não estiver cadastrado usa a PWA.

## 4. Cadastro de iPhones (Cloudflare Worker)

O Pages só serve páginas fixas; o cadastro do UDID precisa de um endpoint.

```bash
cd servidor-udid
npx wrangler@4 deploy
```

```bash
npx wrangler@4 secret put ASC_ID_CHAVE
```

Repita para `ASC_ID_EMISSOR`, `ASC_CHAVE_P8`, `GITHUB_TOKEN` (token com
permissão de escrever em Actions no repositório, para disparar o build) e,
opcionalmente, `CODIGO_CONVITE` (exige `?codigo=...` no link de cadastro e
protege o limite de 100 aparelhos). Depois salve o endereço do Worker na
variável do repositório `URL_CADASTRO_UDID` (Settings, Variables). Se usar o
código de convite, distribua o link `https://<worker>/perfil?codigo=<código>`
diretamente, em vez do botão da página.

Fluxo: o iPhone abre `/perfil`, instala o perfil (que só informa o UDID), o
Worker cadastra o aparelho na Apple, dispara o `build-ios` e devolve a pessoa
à página com `?cadastro=ok`. Quando o build termina, o `pages` publica o IPA
novo e o botão "Instalar o app" passa a funcionar para ela.

## 5. Publicar uma versão

```bash
git tag v0.2.0
```

```bash
git push origin v0.2.0
```

O `build-android` e o `build-ios` publicam na release `v0.2.0`; o `pages`
roda ao fim de cada um.

## Ambiente local

- Testes: `npm test`; tipos: `npm run typecheck`; ponta a ponta:
  `npm run build` e `npm run e2e` (precisa do Playwright com Chromium).
- APK: `npm run android:sync` e `./gradlew assembleDebug` em
  `cliente-android/` (Android SDK 36 e JDK 21).
- iOS: `npm run ios:sync` e abra `cliente-ios/App/App.xcodeproj` no Xcode 16
  ou mais novo.
- Use npm 11 (Node 24 já traz): o npm 10 tem um erro com as dependências
  opcionais do Vitest.
