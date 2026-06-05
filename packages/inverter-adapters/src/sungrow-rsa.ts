/**
 * RSA-OAEP encryption for Sungrow OpenAPI v2 login payloads.
 *
 * Sungrow's iSolarCloud requires the login secret_key to be RSA-encrypted
 * using the public key issued with the developer app. The public key is
 * in SubjectPublicKeyInfo (SPKI) format, Base64-encoded.
 *
 * Implementation: Web Crypto API (crypto.subtle) — supported in Node 18+ AND
 * Deno (Supabase Edge Functions). No native deps.
 *
 * Note: Sungrow issues URL-safe Base64 keys (using `-` and `_` instead of
 * `+` and `/`). Standard `atob` only handles standard Base64, so we normalize
 * before decoding.
 */

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const standard = b64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(standard);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte !== undefined) s += String.fromCharCode(byte);
  }
  return btoa(s);
}

/**
 * Encrypts plaintext with the SPKI-encoded RSA public key.
 * Returns Base64 ciphertext suitable for Sungrow's secret_key field.
 */
export async function sungrowRsaEncrypt(
  plaintext: string,
  publicKeyBase64: string,
): Promise<string> {
  const op = '[sungrowRsaEncrypt]';
  try {
    const keyBuf = base64ToArrayBuffer(publicKeyBase64);
    const publicKey = await crypto.subtle.importKey(
      'spki',
      keyBuf,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt'],
    );
    const enc = new TextEncoder();
    const cipher = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      publicKey,
      enc.encode(plaintext),
    );
    return arrayBufferToBase64(cipher);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`${op} encryption failed`, { error: message, timestamp: new Date().toISOString() });
    throw new Error(`Sungrow RSA encryption failed: ${message}`);
  }
}
