/**
 * Cadastro de iPhones para a distribuição ad hoc.
 *
 * O GitHub Pages só serve páginas fixas, então este Worker faz a parte
 * dinâmica:
 *   GET  /perfil   devolve um perfil de configuração que pede ao iPhone o UDID
 *   POST /udid     o iPhone manda os dados assinados; o Worker cadastra o
 *                  aparelho na App Store Connect API e dispara o build-ios
 *   GET  /         página curta explicando o fluxo
 */

export interface Ambiente {
  ASC_ID_CHAVE: string;
  ASC_ID_EMISSOR: string;
  ASC_CHAVE_P8: string;
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
  URL_SITE: string;
  IDENTIFICADOR_PERFIL: string;
  CODIGO_CONVITE?: string;
}

export interface DadosAparelho {
  udid: string;
  produto?: string;
  versao?: string;
  nome?: string;
}

const XML_INICIO = '<?xml';
const XML_FIM = '</plist>';

/**
 * O iPhone manda um plist assinado (PKCS#7). O conteúdo XML vai em claro
 * dentro da assinatura; basta recortá-lo.
 */
export function extrairPlist(corpo: Uint8Array): string | undefined {
  const texto = new TextDecoder('latin1').decode(corpo);
  const inicio = texto.indexOf(XML_INICIO);
  const fim = texto.indexOf(XML_FIM);
  if (inicio < 0 || fim < 0) return undefined;
  return texto.slice(inicio, fim + XML_FIM.length);
}

export function lerAparelho(plist: string): DadosAparelho | undefined {
  const valor = (chave: string) => {
    const r = new RegExp(`<key>${chave}</key>\\s*<string>([^<]*)</string>`).exec(plist);
    return r?.[1]?.trim();
  };
  const udid = valor('UDID');
  if (!udid || !/^[0-9A-Fa-f-]{24,40}$/.test(udid)) return undefined;
  return { udid, produto: valor('PRODUCT'), versao: valor('VERSION'), nome: valor('DEVICE_NAME') };
}

function escaparXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Perfil "Profile Service": o iOS pede confirmação e envia os atributos ao URL. */
export function montarPerfil(urlRetorno: string, identificador: string, uuid: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <dict>
    <key>URL</key>
    <string>${escaparXml(urlRetorno)}</string>
    <key>DeviceAttributes</key>
    <array>
      <string>UDID</string>
      <string>PRODUCT</string>
      <string>VERSION</string>
      <string>DEVICE_NAME</string>
    </array>
  </dict>
  <key>PayloadOrganization</key>
  <string>Comunicação Offline</string>
  <key>PayloadDisplayName</key>
  <string>Cadastro do iPhone</string>
  <key>PayloadDescription</key>
  <string>Informa só o identificador do aparelho, para liberar a instalação do app de teste. Nada é instalado.</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
  <key>PayloadUUID</key>
  <string>${uuid}</string>
  <key>PayloadIdentifier</key>
  <string>${escaparXml(identificador)}</string>
  <key>PayloadType</key>
  <string>Profile Service</string>
</dict>
</plist>
`;
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function deBase64(texto: string): Uint8Array<ArrayBuffer> {
  const bin = atob(texto);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** JWT ES256 para a App Store Connect API (validade de 15 minutos). */
export async function tokenAppStoreConnect(idChave: string, idEmissor: string, p8: string, agora = Date.now()): Promise<string> {
  const der = deBase64(p8.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
  const chave = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const cabecalho = { alg: 'ES256', kid: idChave, typ: 'JWT' };
  const s = Math.floor(agora / 1000);
  const corpo = { iss: idEmissor, iat: s, exp: s + 15 * 60, aud: 'appstoreconnect-v1' };
  const codificar = (o: object) => base64url(new TextEncoder().encode(JSON.stringify(o)));
  const assinavel = `${codificar(cabecalho)}.${codificar(corpo)}`;
  // O WebCrypto já devolve a assinatura no formato r||s que o JWS espera.
  const assinatura = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, chave, new TextEncoder().encode(assinavel)),
  );
  return `${assinavel}.${base64url(assinatura)}`;
}

export async function cadastrarAparelho(env: Ambiente, a: DadosAparelho, buscar: typeof fetch = fetch): Promise<'novo' | 'existente'> {
  const token = await tokenAppStoreConnect(env.ASC_ID_CHAVE, env.ASC_ID_EMISSOR, env.ASC_CHAVE_P8);
  const r = await buscar('https://api.appstoreconnect.apple.com/v1/devices', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: {
        type: 'devices',
        attributes: { name: (a.nome || a.produto || 'iPhone').slice(0, 50), udid: a.udid, platform: 'IOS' },
      },
    }),
  });
  if (r.status === 201) return 'novo';
  if (r.status === 409) return 'existente';
  throw new Error(`App Store Connect respondeu ${r.status}: ${(await r.text()).slice(0, 300)}`);
}

export async function dispararBuild(env: Ambiente, a: DadosAparelho, buscar: typeof fetch = fetch): Promise<void> {
  const r = await buscar(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'comunicacao-offline-udid',
    },
    body: JSON.stringify({ event_type: 'udid-cadastrado', client_payload: { produto: a.produto ?? '' } }),
  });
  if (r.status !== 204) throw new Error(`GitHub respondeu ${r.status}`);
}

function pagina(titulo: string, texto: string, status = 200): Response {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title><style>body{font-family:system-ui,sans-serif;max-width:560px;margin:2rem auto;padding:0 16px;line-height:1.5}</style></head>
<body><h1>${titulo}</h1><p>${texto}</p></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function atender(req: Request, env: Ambiente, buscar: typeof fetch = fetch): Promise<Response> {
  const url = new URL(req.url);
  const codigo = url.searchParams.get('codigo') ?? '';
  const convidado = !env.CODIGO_CONVITE || codigo === env.CODIGO_CONVITE;

  if (req.method === 'GET' && url.pathname === '/perfil') {
    if (!convidado) return pagina('Cadastro fechado', 'Peça o link de cadastro com código a quem mantém o app.', 403);
    const retorno = new URL('/udid', url.origin);
    if (codigo) retorno.searchParams.set('codigo', codigo);
    return new Response(montarPerfil(retorno.toString(), env.IDENTIFICADOR_PERFIL, crypto.randomUUID().toUpperCase()), {
      headers: {
        'Content-Type': 'application/x-apple-aspen-config',
        'Content-Disposition': 'attachment; filename="cadastro.mobileconfig"',
      },
    });
  }

  if (req.method === 'POST' && url.pathname === '/udid') {
    if (!convidado) return new Response('código inválido', { status: 403 });
    const plist = extrairPlist(new Uint8Array(await req.arrayBuffer()));
    const aparelho = plist ? lerAparelho(plist) : undefined;
    if (!aparelho) return new Response('dados do aparelho inválidos', { status: 400 });
    try {
      await cadastrarAparelho(env, aparelho, buscar);
      await dispararBuild(env, aparelho, buscar);
    } catch (e) {
      console.error(e);
      return Response.redirect(new URL('?cadastro=erro#opcao-ios', env.URL_SITE).toString(), 301);
    }
    // O iOS segue este redirecionamento no Safari depois de enviar o perfil.
    return Response.redirect(new URL('?cadastro=ok#opcao-ios', env.URL_SITE).toString(), 301);
  }

  if (req.method === 'GET' && url.pathname === '/') {
    return pagina(
      'Cadastro de iPhone',
      'Abra <a href="/perfil">/perfil</a> no Safari do iPhone, permita o download e instale o perfil em Ajustes. ' +
        'O aparelho é cadastrado e um novo build do app é gerado; depois volte à página do app para instalar.',
    );
  }
  return new Response('não encontrado', { status: 404 });
}

export default {
  fetch: (req: Request, env: Ambiente) => atender(req, env),
};
