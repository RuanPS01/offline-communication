/**
 * Criptografia do núcleo.
 *
 * - Identidade efêmera por sessão: um par de chaves Ed25519 novo a cada abertura.
 * - Assinatura Ed25519 para provar a origem das mensagens.
 * - Canais privados com chave derivada da senha (PBKDF2-SHA256) e AES-GCM.
 * - Conversa privada entre duas pessoas com chave combinada (X25519 + HKDF).
 *
 * Usa as bibliotecas @noble (JavaScript puro, auditadas), porque o WebCrypto
 * não existe em páginas servidas sem HTTPS, como a página aberta pelo
 * servidor de rede local de outro celular.
 */

import { gcm } from '@noble/ciphers/aes.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesAleatorios, concatenar, paraHex, utf8 } from './bytes.ts';
import { bytesAssinaveis, type Pacote, TAM_ID } from './pacote.ts';

export interface Identidade {
  chavePrivada: Uint8Array;
  chavePublica: Uint8Array;
  /** 12 caracteres hex: início do SHA-256 da chave pública. */
  idNo: string;
}

export function idDaChavePublica(chavePublica: Uint8Array): string {
  return paraHex(sha256(chavePublica).subarray(0, TAM_ID));
}

export function novaIdentidade(): Identidade {
  const { secretKey, publicKey } = ed25519.keygen();
  return { chavePrivada: secretKey, chavePublica: publicKey, idNo: idDaChavePublica(publicKey) };
}

export function identidadeDaSemente(semente: Uint8Array): Identidade {
  const chavePublica = ed25519.getPublicKey(semente);
  return { chavePrivada: semente, chavePublica, idNo: idDaChavePublica(chavePublica) };
}

/** Impressão digital curta para conferir identidades olhando a tela. */
export function impressaoDigital(chavePublica: Uint8Array): string {
  const h = paraHex(sha256(chavePublica).subarray(0, 8)).toUpperCase();
  return h.match(/.{4}/g)!.join(' ');
}

export function assinarPacote(p: Pacote, identidade: Identidade): Pacote {
  const assinatura = ed25519.sign(bytesAssinaveis(p), identidade.chavePrivada);
  return { ...p, assinatura };
}

export function verificarPacote(p: Pacote, chavePublica: Uint8Array): boolean {
  if (!p.assinatura) return false;
  try {
    return ed25519.verify(p.assinatura, bytesAssinaveis(p), chavePublica);
  } catch {
    return false;
  }
}

/** Canal de conversa: público (só nome) ou privado (nome + senha). */
export interface CanalConversa {
  /** 12 caracteres hex, vai no campo alvo dos pacotes. */
  id: string;
  nome: string;
  privado: boolean;
  /** Chave AES-256 do canal privado. */
  chave?: Uint8Array;
}

export const NOME_CANAL_GERAL = 'geral';

export function canalPublico(nome: string): CanalConversa {
  const normal = nome.trim().toLowerCase();
  return {
    id: paraHex(sha256(utf8(`canal-publico:${normal}`)).subarray(0, TAM_ID)),
    nome: normal,
    privado: false,
  };
}

export const ITERACOES_PBKDF2 = 60_000;

/**
 * Quem não tem a senha não consegue nem saber o nome do canal pelo id: o id
 * vem de um HMAC com a própria chave derivada.
 */
export function canalPrivado(nome: string, senha: string, iteracoes = ITERACOES_PBKDF2): CanalConversa {
  const normal = nome.trim().toLowerCase();
  const chave = pbkdf2(sha256, utf8(senha), utf8(`canal-privado:${normal}`), {
    c: iteracoes,
    dkLen: 32,
  });
  const id = paraHex(hmac(sha256, chave, utf8('id-do-canal')).subarray(0, TAM_ID));
  return { id, nome: normal, privado: true, chave };
}

/** Chave simétrica para a conversa privada entre dois nós (igual dos dois lados). */
export function chaveEntrePares(minha: Identidade, chavePublicaDoOutro: Uint8Array): Uint8Array {
  const segredo = x25519.getSharedSecret(
    ed25519.utils.toMontgomerySecret(minha.chavePrivada),
    ed25519.utils.toMontgomery(chavePublicaDoOutro),
  );
  const ids = [minha.idNo, idDaChavePublica(chavePublicaDoOutro)].sort();
  return hkdf(sha256, segredo, utf8(ids.join(':')), utf8('conversa-privada'), 32);
}

/** Dados autenticados junto com o texto cifrado: amarram a carga ao cabeçalho. */
export function dadosAssociados(p: Pick<Pacote, 'tipo' | 'id' | 'origem' | 'alvo' | 'carimbo'>): Uint8Array {
  return utf8(`${p.tipo}|${p.id}|${p.origem}|${p.alvo ?? ''}|${p.carimbo}`);
}

const TAM_NONCE = 12;

export function cifrar(chave: Uint8Array, texto: Uint8Array, aad: Uint8Array): Uint8Array {
  const nonce = bytesAleatorios(TAM_NONCE);
  return concatenar(nonce, gcm(chave, nonce, aad).encrypt(texto));
}

/** Devolve `undefined` se a chave estiver errada ou o conteúdo tiver sido adulterado. */
export function decifrar(chave: Uint8Array, cifrado: Uint8Array, aad: Uint8Array): Uint8Array | undefined {
  if (cifrado.length < TAM_NONCE + 16) return undefined;
  try {
    return gcm(chave, cifrado.subarray(0, TAM_NONCE), aad).decrypt(cifrado.subarray(TAM_NONCE));
  } catch {
    return undefined;
  }
}
