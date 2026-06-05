-- Migration 156: Switch Sungrow credentials from OAuth (app 2571) to
-- direct-login (app 2883).
--
-- Why:
--   The first developer app (2571) was registered under Vivek's email and
--   never got past 0 plants because Manivel's iSolarCloud account owns
--   all 14 Shiroi-commissioned plants. App 2883 was approved 2026-06-05
--   under Manivel's email, so the master account can now log in directly
--   via /openapi/login (username + RSA-encrypted password) and the OAuth
--   redirect dance becomes unnecessary for Shiroi-owned plants.
--
-- What this migration does:
--   - Updates the existing inverter_monitoring_credentials row for
--     brand=sungrow with the new app id, label, and a config flag that
--     tells the poller which auth mode to use.
--   - Removes the stale OAuth state fields (access_token, refresh_token,
--     oauth_status, etc.) — direct-login mode fetches a fresh token on
--     every poll cycle and doesn't persist it.
--
-- Secrets are NOT stored in the database. The poller reads them from the
-- Edge Function environment (SUNGROW_APPKEY, SUNGROW_SECRET,
-- SUNGROW_USERNAME, SUNGROW_PASSWORD, SUNGROW_RSA_PUBLIC_KEY).

BEGIN;

UPDATE inverter_monitoring_credentials
SET
  label = 'Shiroi Sungrow iSolarCloud (app 2883, direct-login)',
  config = jsonb_build_object(
    'api_base', 'https://gateway.isolarcloud.com.hk',
    'cloud_id', '2',
    'application_id', '2883',
    'master_account_email', 'manivel@shiroienergy.com',
    'auth_mode', 'direct_login',
    'authorize_url', 'https://web3.isolarcloud.com.hk/#/authorized-app?cloudId=2&applicationId=2883&redirectUrl=https://erp.shiroienergy.com/api/integrations/sungrow/callback',
    'redirect_uri', 'https://erp.shiroienergy.com/api/integrations/sungrow/callback',
    'notes', 'Direct login: poller fetches token from /openapi/login each cycle. App 2571 (OAuth) was retired 2026-06-05 in favour of 2883.'
  )
WHERE brand = 'sungrow';

COMMIT;
