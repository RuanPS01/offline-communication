import { describe, expect, it } from 'vitest';
import { type Ambiente, atender, extrairPlist, lerAparelho, montarPerfil, tokenAppStoreConnect } from '../src/index.ts';

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>PRODUCT</key><string>iPhone15,2</string>
<key>UDID</key><string>00008110-001A2B3C4D5E6F70</string>
<key>VERSION</key><string>22A3354</string>
<key>DEVICE_NAME</key><string>iPhone da Ana</string>
</dict></plist>`;

async function chaveP8(): Promise<{ p8: string; publica: CryptoKey }> {
  const par = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', par.privateKey));
  const b64 = Buffer.from(der).toString('base64');
  return { p8: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----`, publica: par.publicKey };
}

describe('cadastro de UDID', () => {
  it('recorta o plist de dentro da assinatura PKCS#7 e lê o aparelho', () => {
    const lixo = Uint8Array.from([0x30, 0x82, 0x0f, 0x00, 0x06, 0x09]);
    const corpo = new Uint8Array([...lixo, ...new TextEncoder().encode(PLIST), ...lixo]);
    const a = lerAparelho(extrairPlist(corpo)!);
    expect(a).toEqual({ udid: '00008110-001A2B3C4D5E6F70', produto: 'iPhone15,2', versao: '22A3354', nome: 'iPhone da Ana' });
    expect(lerAparelho(PLIST.replace('00008110-001A2B3C4D5E6F70', 'x<script>'))).toBeUndefined();
  });

  it('gera o perfil de cadastro apontando para o retorno', () => {
    const p = montarPerfil('https://udid.exemplo/udid?codigo=a&b', 'io.exemplo.cadastro', 'ABC');
    expect(p).toContain('<string>Profile Service</string>');
    expect(p).toContain('https://udid.exemplo/udid?codigo=a&amp;b');
  });

  it('assina um JWT ES256 válido para a App Store Connect API', async () => {
    const { p8, publica } = await chaveP8();
    const token = await tokenAppStoreConnect('CHAVE123', 'emissor-uuid', p8, 1_800_000_000_000);
    const [c, b, s] = token.split('.');
    const decodificar = (x: string) => JSON.parse(Buffer.from(x, 'base64url').toString());
    expect(decodificar(c!)).toEqual({ alg: 'ES256', kid: 'CHAVE123', typ: 'JWT' });
    expect(decodificar(b!)).toMatchObject({ iss: 'emissor-uuid', aud: 'appstoreconnect-v1', exp: 1_800_000_900 });
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publica,
      Buffer.from(s!, 'base64url'),
      new TextEncoder().encode(`${c}.${b}`),
    );
    expect(ok).toBe(true);
  });

  it('fluxo completo: cadastra na Apple, dispara o build e volta para a página', async () => {
    const { p8 } = await chaveP8();
    const env: Ambiente = {
      ASC_ID_CHAVE: 'K',
      ASC_ID_EMISSOR: 'E',
      ASC_CHAVE_P8: p8,
      GITHUB_TOKEN: 'gh',
      GITHUB_REPO: 'dono/repo',
      URL_SITE: 'https://dono.github.io/repo/',
      IDENTIFICADOR_PERFIL: 'io.exemplo',
      CODIGO_CONVITE: 'segredo',
    };
    const chamadas: string[] = [];
    const buscar = (async (url: string) => {
      chamadas.push(url);
      return new Response(null, { status: url.includes('appstoreconnect') ? 201 : 204 });
    }) as unknown as typeof fetch;

    const negado = await atender(new Request('https://udid.exemplo/perfil'), env, buscar);
    expect(negado.status).toBe(403);

    const perfil = await atender(new Request('https://udid.exemplo/perfil?codigo=segredo'), env, buscar);
    expect(perfil.headers.get('Content-Type')).toBe('application/x-apple-aspen-config');
    expect(await perfil.text()).toContain('https://udid.exemplo/udid?codigo=segredo');

    const r = await atender(new Request('https://udid.exemplo/udid?codigo=segredo', { method: 'POST', body: PLIST }), env, buscar);
    expect(r.status).toBe(301);
    expect(r.headers.get('Location')).toBe('https://dono.github.io/repo/?cadastro=ok#opcao-ios');
    expect(chamadas).toEqual(['https://api.appstoreconnect.apple.com/v1/devices', 'https://api.github.com/repos/dono/repo/dispatches']);
  });
});
