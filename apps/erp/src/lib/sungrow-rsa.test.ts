import { describe, it, expect } from 'vitest';
import { sungrowRsaEncrypt } from './sungrow-rsa';

// Real Sungrow developer app public key (URL-safe Base64, issued 2026-05-23).
// 1024-bit RSA key in SPKI format.
const TEST_PUBLIC_KEY =
  'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCGc_aKE5Bqs3uUZE1vHhP4wdeLothZbNvvp4INtykpgAcK0jTk3CrRAVlTWlgWJWSnS4iwGAHsPnLk10-42UqLIOHf6s8Di1kJn7ibcWNXhNunilL02_BFRqM5NgftirvCwOOTmK8Pz1GOSK4proG8YIuGHxIjEDrpWIAXYR6hrQIDAQAB';

describe('sungrowRsaEncrypt', () => {
  it('produces non-empty Base64 ciphertext for a known plaintext', async () => {
    const cipher = await sungrowRsaEncrypt('hello', TEST_PUBLIC_KEY);
    // Standard Base64 alphabet only (not URL-safe, since we use btoa)
    expect(cipher).toMatch(/^[A-Za-z0-9+/=]+$/);
    // 1024-bit RSA → 128 bytes → 172 Base64 chars (with padding)
    expect(cipher.length).toBeGreaterThan(100);
  });

  it('produces different ciphertext on repeat calls (OAEP random padding)', async () => {
    const a = await sungrowRsaEncrypt('hello', TEST_PUBLIC_KEY);
    const b = await sungrowRsaEncrypt('hello', TEST_PUBLIC_KEY);
    expect(a).not.toBe(b);
  });

  it('throws when public key is invalid (not a valid SPKI key)', async () => {
    await expect(sungrowRsaEncrypt('hello', 'not-a-key')).rejects.toThrow(
      /Sungrow RSA encryption failed/i,
    );
  });

  it('throws when public key is empty string', async () => {
    await expect(sungrowRsaEncrypt('hello', '')).rejects.toThrow(
      /Sungrow RSA encryption failed/i,
    );
  });

  it('handles URL-safe Base64 characters (- and _) in the public key', async () => {
    // The key contains - and _ which must be normalized before atob.
    // If normalization is missing this test would throw on import.
    const cipher = await sungrowRsaEncrypt('test-secret', TEST_PUBLIC_KEY);
    expect(typeof cipher).toBe('string');
    expect(cipher.length).toBeGreaterThan(0);
  });
});
