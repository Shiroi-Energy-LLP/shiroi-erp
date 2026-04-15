-- ============================================================================
-- Migration 051 - Marketing + Design Revamp (Enum Additions Only)
-- ============================================================================
-- This file MUST be applied BEFORE migration 052 because Postgres does not
-- allow a newly-added enum value to be referenced inside the same transaction
-- that adds it. The rest of the revamp (schema, triggers, RLS) lives in 052.
--
-- Enum changes:
--   * app_role: add marketing_manager (Prem's role)
--   * lead_status: add quick_quote_sent, design_in_progress,
--     detailed_proposal_sent, closure_soon
-- ============================================================================

-- app_role: add marketing_manager
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'marketing_manager';

-- lead_status: add Path A + Path B + closure stages
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'quick_quote_sent' AFTER 'contacted';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'design_in_progress' AFTER 'site_survey_done';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'detailed_proposal_sent' AFTER 'design_confirmed';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'closure_soon' AFTER 'negotiation';
