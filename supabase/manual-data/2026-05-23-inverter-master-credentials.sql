-- Manual data load — 4 Shiroi master inverter monitoring credential rows.
-- Applied to dev (actqtzoxjilqnldnacqz) on 2026-05-23.
--
-- Not part of supabase/migrations/ because the values reference env var
-- NAMES that differ across environments + a profile UUID that's only valid
-- in dev. Re-apply to prod when promoting, substituting:
--   - The created_by UUID with the prod founder profile id
--   - The activation_status / notes fields as appropriate at promote time
--
-- No raw secrets are stored here — vault_secret_ref holds the env var name;
-- the Edge Function dereferences it at runtime.

INSERT INTO inverter_monitoring_credentials (brand, label, vault_secret_ref, config, created_by)
VALUES
  (
    'growatt',
    'Shiroi EEVUWE installer (Manivel) + OpenAPI token',
    'GROWATT_API_TOKEN',
    jsonb_build_object(
      'installer_code', 'EEVUWE',
      'username', 'EEVUWE001',
      'api_base', 'https://openapi.growatt.com',
      'legacy_api_base', 'https://server.growatt.com',
      'notes', 'Installer code is EEVUWE; user login is EEVUWE001. OpenAPI token in env var GROWATT_API_TOKEN. As of 2026-05-23 the OpenAPI account has 0 plants visible — pending linkage from EEVUWE installer or email to service@growatt.com.'
    ),
    (SELECT id FROM profiles WHERE email = 'vivek@shiroienergy.com' AND role = 'founder' LIMIT 1)
  ),
  (
    'sungrow',
    'Shiroi manivel@ iSolarCloud + developer app',
    'SUNGROW_APPKEY',
    jsonb_build_object(
      'master_account_email', 'manivel@shiroienergy.com',
      'application_id', '2571',
      'cloud_id', '2',
      'api_base', 'https://gateway.isolarcloud.com.hk',
      'authorize_url', 'https://web3.isolarcloud.com.hk/#/authorized-app?cloudId=2&applicationId=2571&redirectUrl=https://erp.shiroienergy.com/api/integrations/sungrow/callback',
      'redirect_uri', 'https://erp.shiroienergy.com/api/integrations/sungrow/callback',
      'oauth_status', 'not_authorized',
      'notes', 'First developer app (applicationId=2571) under Vivek email. Second app pending approval under Manivel email. Either way: OAuth2 flow exchanges code at /api/integrations/sungrow/callback for access_token + refresh_token written into this config.'
    ),
    (SELECT id FROM profiles WHERE email = 'vivek@shiroienergy.com' AND role = 'founder' LIMIT 1)
  ),
  (
    'solarman',
    'Shiroi manivel@ SolarMan Smart (paid plan pending)',
    'SOLARMAN_APP_SECRET',
    jsonb_build_object(
      'master_account_email', 'manivel@shiroienergy.com',
      'api_base', 'https://globalapi.solarmanpv.com',
      'app_id', NULL,
      'app_secret', NULL,
      'org_id', NULL,
      'activation_status', 'paid_basic_plan_email_sent_2026-05-23',
      'notes', 'Awaiting reply from customerservice@solarmanpv.com with App ID + Secret + Org ID for manivel@ Smart account, Basic paid plan ($169 / 2-year / 5M calls).'
    ),
    (SELECT id FROM profiles WHERE email = 'vivek@shiroienergy.com' AND role = 'founder' LIMIT 1)
  ),
  (
    'goodwe',
    'Shiroi Goodwe SEMS Portal (access pending)',
    'GOODWE_PASSWORD',
    jsonb_build_object(
      'api_base', NULL,
      'activation_status', 'email_to_goodwe_india_pending',
      'notes', 'No self-serve developer portal. Awaiting reply from Goodwe India sales contact.'
    ),
    (SELECT id FROM profiles WHERE email = 'vivek@shiroienergy.com' AND role = 'founder' LIMIT 1)
  );
