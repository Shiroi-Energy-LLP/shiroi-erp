-- ============================================================
-- Migration 167 — search_contacts PII masking (S10)
-- Date: 2026-06-06
-- Why:
--   Security review 2026-05-30 #10 — search_contacts (mig 152) was
--   returning phone + email for every authenticated caller. Sales
--   engineers + designers don't need these PII fields; they were
--   relying on RLS-via-role-list, which is brittle.
--
--   This migration adds role-conditional masking: phone + email are
--   returned as NULL unless caller role is founder / finance /
--   marketing_manager (the three roles that legitimately need
--   contact info for outreach + reconciliation).
--
--   Signature unchanged — TypeScript caller types stay valid
--   (phone/email were already nullable). No app-side refactor needed.
-- ============================================================

CREATE OR REPLACE FUNCTION public.search_contacts(
  p_query           text     DEFAULT NULL::text,
  p_lifecycle_stage text     DEFAULT NULL::text,
  p_sort            text     DEFAULT 'created_at'::text,
  p_dir             text     DEFAULT 'desc'::text,
  p_limit           integer  DEFAULT 50,
  p_offset          integer  DEFAULT 0
)
RETURNS TABLE(
  id                      uuid,
  name                    text,
  first_name              text,
  last_name               text,
  phone                   text,
  email                   text,
  designation             text,
  lifecycle_stage         text,
  created_at              timestamp with time zone,
  contact_company_roles   jsonb,
  total_count             bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sort_col      TEXT := COALESCE(NULLIF(p_sort, ''), 'created_at');
  v_dir           TEXT := CASE WHEN lower(COALESCE(p_dir, 'desc')) = 'asc' THEN 'ASC' ELSE 'DESC' END;
  v_pii_allowed   BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  v_pii_allowed := get_my_role() = ANY (ARRAY[
    'founder'::app_role,
    'finance'::app_role,
    'marketing_manager'::app_role
  ]);

  IF v_sort_col NOT IN ('created_at','name','first_name','last_name','phone','email','lifecycle_stage') THEN
    v_sort_col := 'created_at';
  END IF;

  RETURN QUERY EXECUTE format($f$
    WITH base AS (
      SELECT
        c.id, c.name, c.first_name, c.last_name,
        CASE WHEN $5 THEN c.phone ELSE NULL END AS phone,
        CASE WHEN $5 THEN c.email ELSE NULL END AS email,
        c.designation, c.lifecycle_stage, c.created_at,
        COALESCE(
          (
            SELECT jsonb_agg(jsonb_build_object(
              'company_id',   ccr.company_id,
              'role_title',   ccr.role_title,
              'is_primary',   ccr.is_primary,
              'ended_at',     ccr.ended_at,
              'companies',    CASE
                                WHEN co.id IS NULL THEN NULL
                                ELSE jsonb_build_object('name', co.name)
                              END
            ))
            FROM contact_company_roles ccr
            LEFT JOIN companies co ON co.id = ccr.company_id
            WHERE ccr.contact_id = c.id
          ),
          '[]'::jsonb
        ) AS contact_company_roles
      FROM contacts c
      WHERE
        ($1::text IS NULL OR $1 = '' OR (
          c.name  ILIKE '%%' || $1 || '%%'
          OR c.phone ILIKE '%%' || $1 || '%%'
          OR c.email ILIKE '%%' || $1 || '%%'
        ))
        AND ($2::text IS NULL OR $2 = '' OR c.lifecycle_stage = $2)
    )
    SELECT
      base.*,
      COUNT(*) OVER () AS total_count
    FROM base
    ORDER BY %I %s NULLS LAST
    LIMIT $3 OFFSET $4
  $f$, v_sort_col, v_dir)
  USING p_query, p_lifecycle_stage, p_limit, p_offset, v_pii_allowed;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.search_contacts(text, text, text, text, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.search_contacts IS
  'Search contacts with role-conditional PII masking. Phone + email returned NULL for non-founder/finance/marketing_manager roles. Search-by-phone still matches at WHERE time but the output is masked. S10 security review 2026-05-30.';
