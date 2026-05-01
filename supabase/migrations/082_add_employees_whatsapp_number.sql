-- Migration 082: add employees.whatsapp_number for n8n notification routing
--
-- The n8n workflow catalog (docs/superpowers/specs/2026-04-19-n8n-workflow-catalog.md)
-- routes Tier 1 handoff notifications to specific employees via WhatsApp. The router
-- needs a phone number per employee. personal_phone works for most, but kept as a
-- separate column so employees can opt out (NULL) or specify a different number
-- without touching HR's phone of record.
--
-- Format: expected E.164 (+91XXXXXXXXXX for India). Loose for now — normalization
-- enforced at write-time by the HR edit UI once that form field lands. Existing
-- personal_phone values may or may not be E.164; the backfill copies verbatim.
--
-- Apply to dev first, verify, then prod. Regen packages/types/database.ts after
-- dev apply.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS whatsapp_number TEXT;

COMMENT ON COLUMN employees.whatsapp_number IS
  'WhatsApp-capable phone number for n8n automation notifications. Typically mirrors personal_phone but kept separate so employees can opt out (NULL) or use an alternate number. Expected format: E.164 (+91XXXXXXXXXX). Loose at DB layer; tightened at UI write path.';

-- Backfill from personal_phone. New rows inherit via the HR form.
UPDATE employees
SET whatsapp_number = personal_phone
WHERE whatsapp_number IS NULL
  AND personal_phone IS NOT NULL
  AND personal_phone <> '';
