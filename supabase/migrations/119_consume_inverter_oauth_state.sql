BEGIN;

CREATE OR REPLACE FUNCTION consume_inverter_oauth_state(p_state_token TEXT, p_brand TEXT)
RETURNS TABLE (credentials_id UUID, created_by UUID)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  UPDATE inverter_oauth_states
  SET consumed_at = NOW()
  WHERE state_token = p_state_token
    AND brand = p_brand
    AND consumed_at IS NULL
    AND created_at > NOW() - INTERVAL '15 minutes'
  RETURNING inverter_oauth_states.credentials_id, inverter_oauth_states.created_by;
END;
$$;

REVOKE ALL ON FUNCTION consume_inverter_oauth_state(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_inverter_oauth_state(TEXT, TEXT) TO service_role;

COMMIT;
