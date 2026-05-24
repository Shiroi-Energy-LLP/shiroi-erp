/**
 * GET /api/integrations/sungrow/callback
 *
 * Step 2 of the Sungrow OAuth2 flow (iSolarCloud → our server).
 *
 * iSolarCloud redirects here with ?code=<auth_code>&state=<our_state>.
 *
 * Flow:
 *   1. Validate state token (exists, not consumed, < 15 min old).
 *   2. Load Sungrow credential row (contains authorize_url + oauth_status).
 *   3. Exchange code for access/refresh tokens via exchangeCodeForToken().
 *   4. Persist tokens into inverter_monitoring_credentials.config JSONB.
 *   5. Mark state consumed.
 *   6. Redirect to /om/plant-monitoring?sungrow=connected.
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

  // ── Validate state token ─────────────────────────────────────────────
  const { data: stateRow, error: stateError } = await supabase
    .from('inverter_oauth_states')
    .select('state_token, credentials_id, consumed_at, created_at')
    .eq('state_token', state)
    .eq('brand', 'sungrow')
    .single();

  if (stateError || !stateRow) {
    console.warn(`${op} Unknown or missing state token`, {
      state,
      error: stateError?.message,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.redirect(
      new URL(`${PLANT_MONITORING_URL}?sungrow=error&reason=invalid_state`, request.url),
    );
  }

  if (stateRow.consumed_at) {
    console.warn(`${op} State token already consumed (replay attack?)`, {
      state,
      consumed_at: stateRow.consumed_at,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.redirect(
      new URL(`${PLANT_MONITORING_URL}?sungrow=error&reason=state_consumed`, request.url),
    );
  }

  const ageMs = Date.now() - new Date(stateRow.created_at).getTime();
  const maxAgeMs = 15 * 60 * 1000; // 15 minutes
  if (ageMs > maxAgeMs) {
    console.warn(`${op} State token expired`, {
      state,
      ageMs,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.redirect(
      new URL(`${PLANT_MONITORING_URL}?sungrow=error&reason=state_expired`, request.url),
    );
  }

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
      credentialsId: stateRow.credentials_id,
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
    .eq('id', stateRow.credentials_id)
    .single();

  if (credReadError || !existingCred) {
    console.error(`${op} Failed to read credential row for token persist`, {
      credentialsId: stateRow.credentials_id,
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
    .eq('id', stateRow.credentials_id);

  if (updateError) {
    console.error(`${op} Failed to update credential config with tokens`, {
      credentialsId: stateRow.credentials_id,
      error: updateError.message,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.redirect(
      new URL(`${PLANT_MONITORING_URL}?sungrow=error&reason=credential_update_failed`, request.url),
    );
  }

  // ── Mark state token consumed ────────────────────────────────────────
  const { error: consumeError } = await supabase
    .from('inverter_oauth_states')
    .update({ consumed_at: new Date().toISOString() })
    .eq('state_token', state);

  if (consumeError) {
    // Non-fatal: token exchange succeeded. Log and continue.
    console.warn(`${op} Failed to mark state as consumed (non-fatal)`, {
      state,
      error: consumeError.message,
      timestamp: new Date().toISOString(),
    });
  }

  console.log(`${op} Sungrow authorization completed successfully`, {
    credentialsId: stateRow.credentials_id,
    expiresAt: tokenResult.expires_at,
    timestamp: new Date().toISOString(),
  });

  return NextResponse.redirect(
    new URL(`${PLANT_MONITORING_URL}?sungrow=connected`, request.url),
  );
}
