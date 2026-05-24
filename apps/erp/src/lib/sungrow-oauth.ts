/**
 * Sungrow iSolarCloud OAuth2 token exchange and refresh utilities.
 *
 * Used by:
 *   - /api/integrations/sungrow/callback (code → token exchange)
 *   - n8n refresh cron (refresh_token → new access_token, Phase 8)
 *
 * All secrets are passed in — no env reads here — so these functions
 * are testable without process.env mocking.
 */

import { sungrowRsaEncrypt } from './sungrow-rsa';

const op = '[sungrow-oauth]';

// ═══════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════

interface SungrowTokenApiResponse {
  result_code: string | number;
  result_msg?: string;
  result_data?: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
}

export interface ExchangeInput {
  /** Authorization code received from iSolarCloud redirect. */
  code: string;
  /** Sungrow app key (SUNGROW_APPKEY). */
  appkey: string;
  /** Sungrow app secret, plaintext — will be RSA-encrypted before sending. */
  secret: string;
  /** Sungrow RSA public key (SUNGROW_RSA_PUBLIC_KEY). */
  publicKey: string;
  /** Sungrow API base URL (SUNGROW_BASE_URL). */
  apiBase: string;
  /** Must match the redirect_uri registered with Sungrow (SUNGROW_REDIRECT_URI). */
  redirectUri: string;
}

export interface ExchangeResult {
  access_token: string;
  refresh_token: string;
  /** Token lifetime in seconds as returned by Sungrow. */
  expires_in: number;
  /** Computed ISO timestamp for when the access token expires. */
  expires_at: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Token exchange — authorization_code → access_token
// ═══════════════════════════════════════════════════════════════════════

/**
 * Exchanges an OAuth2 authorization code for Sungrow access/refresh tokens.
 *
 * Sungrow's token endpoint requires the app secret to be RSA-encrypted
 * before transmission. This function handles encryption internally.
 *
 * @throws Error if the HTTP call fails or Sungrow returns a non-1 result_code.
 */
export async function exchangeCodeForToken(input: ExchangeInput): Promise<ExchangeResult> {
  const encryptedSecret = await sungrowRsaEncrypt(input.secret, input.publicKey);
  const url = `${input.apiBase.replace(/\/$/, '')}/openapi/apiManage/token`;

  const body = {
    appkey: input.appkey,
    secret_key: encryptedSecret,
    code: input.code,
    grant_type: 'authorization_code',
    redirect_uri: input.redirectUri,
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-access-key': input.appkey,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`${op} [exchangeCodeForToken] network error`, {
      error: message,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`${op} Network error calling Sungrow token endpoint: ${message}`);
  }

  if (!res.ok) {
    console.error(`${op} [exchangeCodeForToken] HTTP error`, {
      status: res.status,
      url,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`${op} HTTP ${res.status} from Sungrow token endpoint`);
  }

  const json = (await res.json()) as SungrowTokenApiResponse;

  if (String(json.result_code) !== '1') {
    console.error(`${op} [exchangeCodeForToken] Sungrow error`, {
      result_code: json.result_code,
      result_msg: json.result_msg,
      timestamp: new Date().toISOString(),
    });
    throw new Error(
      `${op} Sungrow token exchange failed: ${json.result_msg ?? `result_code=${json.result_code}`}`,
    );
  }

  const data = json.result_data;
  if (!data) {
    throw new Error(`${op} Sungrow token exchange returned no result_data`);
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Token refresh — refresh_token → new access_token
// ═══════════════════════════════════════════════════════════════════════

export interface RefreshInput {
  refresh_token: string;
  appkey: string;
  secret: string;
  publicKey: string;
  apiBase: string;
}

/**
 * Uses a refresh token to obtain a new Sungrow access token.
 * Called by the n8n token-refresh cron (Phase 8).
 *
 * @throws Error if the HTTP call fails or Sungrow returns a non-1 result_code.
 */
export async function refreshAccessToken(input: RefreshInput): Promise<ExchangeResult> {
  const encryptedSecret = await sungrowRsaEncrypt(input.secret, input.publicKey);
  const url = `${input.apiBase.replace(/\/$/, '')}/openapi/apiManage/refreshToken`;

  const body = {
    appkey: input.appkey,
    secret_key: encryptedSecret,
    refresh_token: input.refresh_token,
    grant_type: 'refresh_token',
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-access-key': input.appkey,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`${op} [refreshAccessToken] network error`, {
      error: message,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`${op} Network error calling Sungrow refresh endpoint: ${message}`);
  }

  if (!res.ok) {
    throw new Error(`${op} [refreshAccessToken] HTTP ${res.status}`);
  }

  const json = (await res.json()) as SungrowTokenApiResponse;

  if (String(json.result_code) !== '1') {
    console.error(`${op} [refreshAccessToken] Sungrow error`, {
      result_code: json.result_code,
      result_msg: json.result_msg,
      timestamp: new Date().toISOString(),
    });
    throw new Error(
      `${op} Sungrow token refresh failed: ${json.result_msg ?? `result_code=${json.result_code}`}`,
    );
  }

  const data = json.result_data;
  if (!data) {
    throw new Error(`${op} [refreshAccessToken] Sungrow refresh returned no result_data`);
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}
