/**
 * GET /api/integrations/sungrow/callback
 *
 * Step 2 of the Sungrow OAuth2 flow (iSolarCloud → our server).
 *
 * iSolarCloud redirects here with ?code=<auth_code>&state=<our_state>.
 *
 * Flow:
 *   1. Atomically consume state token via consume_inverter_oauth_state RPC.
 *      A single UPDATE-RETURNING replaces the previous SELECT-then-UPDATE
 *      pattern which was vulnerable to TOCTOU races on concurrent callbacks.
 *   2. Load Sungrow credential row (contains authorize_url + oauth_status).
 *   3. Exchange code for access/refresh tokens via exchangeCodeForToken().
 *   4. Persist tokens into inverter_monitoring_credentials.config JSONB.
 *   5. Redirect to /om/plant-monitoring?sungrow=connected.
 *
 * No auth cookie required here — iSolarCloud redirects an anonymous
 * browser request. We validate against the state token stored server-side.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@repo/supabase/admin';
import { exchangeCodeForToken } from '@/lib/sungrow-oauth';

const PLANT_MONITORING_URL = '/om/plant-monitoring';

export async function GET(request: NextRequest) {
  const op = '[GET /api/integrations/sungrow/callback]';
  const { searchParams } = request.nextUrl;

  const code = searchParams.get('code');
  const state = searchParams.get('state');

  // ── Basic parameter validation ───────────────────────────────────────
  if (!code || !state) {
    console.warn(`${op} Missing code or state`, {
      hasCode: Boolean(code),
      hasState: Boolean(state),
      timestamp: new Date().toISOString(),
    });
    return NextResponse.redirect(
      new URL(`${PLANT_MONITORING_URL}?sungrow=error&reason=missing_params`, request.url),
    );
  }

  // Use admin client — the callback arrives without an authenticated session
  // (the browser was redirected from iSolarCloud, not from our app).
  const supabase = createAdminClient();

  // ── Atomically consume state token ──────────────────────────────────
  // A single UPDATE-RETURNING ensures only one concurrent callback can
  // succeed: the UPDATE sets consumed_at and returns the row only if
  // consumed_at IS NULL and the token was created within the last 15 min.
  // Any second concurrent call sees consumed_at already set and gets 0 rows.
  const { data: consumed, error: consumeErr } = await supabase
    .rpc('consume_inverter_oauth_state', { p_state_token: state, p_brand: 'sungrow' });

  if (consumeErr) {
    console.error(`${op} consume_inverter_oauth_state RPC failed`, {
      error: consumeErr.message,
      state_prefix: state.slice(0, 8),
      timestamp: new Date().toISOString(),
    });
    return NextResponse.redirect(
      new URL(`${PLANT_MONITORING_URL}?sungrow=error&reason=state_lookup_failed`, request.url),
    );
  }

  if (!consumed || consumed.length === 0) {
    // State was unknown, already consumed, or expired — all map to the same
    // client-visible reason to avoid leaking which case applies.
    console.warn(`${op} state invalid/consumed/expired`, {
      state_prefix: state.slice(0, 8),
      timestamp: new Date().toISOString(),
    });
    return NextResponse.redirect(
      new URL(`${PLANT_MONITORING_URL}?sungrow=error&reason=invalid_state`, request.url),
    );
  }

  const firstRow = (consumed as { created_by: string; credentials_id: string }[])[0];
  if (!firstRow) {
    return NextResponse.redirect(
      new URL(`${PLANT_MONITORING_URL}?sungrow=error&reason=invalid_state`, request.url),
    );
  }
  const credentialsId = firstRow.credentials_id;

  // ── Load env vars ────────────────────────────────────────────────────
  const appkey = process.env.SUNGROW_APPKEY;
  const secret = process.env.SUNGROW_SECRET;
  const publicKey = process.env.SUNGROW_RSA_PUBLIC_KEY;
  const apiBase = process.env.SUNGROW_BASE_URL;
  const redirectUri = process.env.SUNGROW_REDIRECT_URI;

  if (!appkey || !secret || !publicKey || !apiBase || !redirectUri) {
    console.error(`${op} Missing required Sungrow env vars`, {
      hasAppkey: Boolean(appkey),
      hasSecret: Boolean(secret),
      hasPublicKey: Boolean(publicKey),
      hasApiBase: Boolean(apiBase),
      hasRedirectUri: Boolean(redirectUri),
      timestamp: new Date().toISOString(),
    });
    return NextResponse.redirect(
      new URL(`${PLANT_MONITORING_URL}?sungrow=error&reason=config_missing`, request.url),
    );
  }

  // ── Exchange code for tokens ─────────────────────────────────────────
  let tokenResult: Awaited<ReturnType<typeof exchangeCodeForToken>>;
  try {
    tokenResult = await exchangeCodeForToken({
      code,
      appkey,
      secret,
      publicKey,
      apiBase,
      redirectUri,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`${op} Token exchange failed`, {
      error: message,
      credentialsId,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.redirect(
      new URL(`${PLANT_MONITORING_URL}?sungrow=error&reason=token_exchange_failed`, request.url),
    );
  }

  // ── Persist tokens into credential config JSONB ──────────────────────
  // We merge with any existing config keys (e.g., authorize_url, cloud_id).
  const { data: existingCred, error: credReadError } = await supabase
    .from('inverter_monitoring_credentials')
    .select('id, config')
    .eq('id', credentialsId)
    .single();

  if (credReadError || !existingCred) {
    console.error(`${op} Failed to read credential row for token persist`, {
      credentialsId,
      error: credReadError?.message,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.redirect(
      new URL(`${PLANT_MONITORING_URL}?sungrow=error&reason=credential_read_failed`, request.url),
    );
  }

  // Merge: keep existing config fields, update OAuth-specific ones.
  const existingConfig = (existingCred.config ?? {}) as Record<string, unknown>;
  const updatedConfig = {
    ...existingConfig,
    oauth_status: 'authorized',
    access_token: tokenResult.access_token,
    refresh_token: tokenResult.refresh_token,
    expires_in: tokenResult.expires_in,
    access_token_expires_at: tokenResult.expires_at,
    authorized_at: new Date().toISOString(),
  };

  const { error: updateError } = await supabase
    .from('inverter_monitoring_credentials')
    .update({ config: updatedConfig })
    .eq('id', credentialsId);

  if (updateError) {
    console.error(`${op} Failed to update credential config with tokens`, {
      credentialsId,
      error: updateError.message,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.redirect(
      new URL(`${PLANT_MONITORING_URL}?sungrow=error&reason=credential_update_failed`, request.url),
    );
  }

  console.log(`${op} Sungrow authorization completed successfully`, {
    credentialsId,
    expiresAt: tokenResult.expires_at,
    timestamp: new Date().toISOString(),
  });

  return NextResponse.redirect(
    new URL(`${PLANT_MONITORING_URL}?sungrow=connected`, request.url),
  );
}
