/**
 * GET /api/integrations/sungrow/authorize
 *
 * Step 1 of the Sungrow OAuth2 flow.
 *
 * - Role-gated: founder and om_technician only.
 * - Generates a CSRF state token (crypto.randomUUID).
 * - Stores it in inverter_oauth_states (brand=sungrow, credentials_id of the
 *   Shiroi Sungrow master row).
 * - Redirects to SUNGROW_AUTHORIZATION_URL with state appended.
 *
 * After this redirect Manivel logs in to iSolarCloud and clicks Allow,
 * then iSolarCloud bounces back to /api/integrations/sungrow/callback.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@repo/supabase/server';
import { getUserProfile } from '@/lib/auth';

export async function GET(_request: NextRequest) {
  const op = '[GET /api/integrations/sungrow/authorize]';

  // ── Auth + role check ────────────────────────────────────────────────
  const profile = await getUserProfile();
  if (!profile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const allowedRoles: string[] = ['founder', 'om_technician'];
  if (!allowedRoles.includes(profile.role)) {
    console.warn(`${op} Access denied`, {
      userId: profile.id,
      role: profile.role,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── Load Sungrow master credential row ───────────────────────────────
  const supabase = await createClient();
  const { data: cred, error: credError } = await supabase
    .from('inverter_monitoring_credentials')
    .select('id, config')
    .eq('brand', 'sungrow')
    .limit(1)
    .maybeSingle();

  if (credError || !cred) {
    console.error(`${op} Sungrow credential row not found`, {
      error: credError?.message,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json(
      { error: 'Sungrow credential record not found — contact administrator' },
      { status: 500 },
    );
  }

  // ── Generate CSRF state token ────────────────────────────────────────
  const stateToken = crypto.randomUUID();

  const { error: insertError } = await supabase.from('inverter_oauth_states').insert({
    state_token: stateToken,
    brand: 'sungrow',
    credentials_id: cred.id,
    created_by: profile.id,
  });

  if (insertError) {
    console.error(`${op} Failed to insert OAuth state`, {
      error: insertError.message,
      userId: profile.id,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({ error: 'Failed to initiate authorization' }, { status: 500 });
  }

  // ── Build authorization URL ──────────────────────────────────────────
  // Read from the credential row's config JSONB, not from env vars.
  // This lets per-credential URLs work (e.g. when a second Sungrow app is
  // registered — only the credential row needs updating, not a redeploy).
  const authUrl = (cred.config as { authorize_url?: string })?.authorize_url;
  if (!authUrl) {
    console.error(`${op} authorize_url missing from Sungrow credential config`, {
      credentialsId: cred.id,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json(
      { error: 'Sungrow authorization URL not configured in credential record — contact administrator' },
      { status: 500 },
    );
  }

  // The authorization URL already contains the redirectUrl and other params.
  // We append our state as an additional query parameter.
  const separator = authUrl.includes('?') ? '&' : '?';
  const finalUrl = `${authUrl}${separator}state=${encodeURIComponent(stateToken)}`;

  console.log(`${op} Redirecting to Sungrow authorization`, {
    userId: profile.id,
    credentialsId: cred.id,
    timestamp: new Date().toISOString(),
  });

  return NextResponse.redirect(finalUrl);
}
