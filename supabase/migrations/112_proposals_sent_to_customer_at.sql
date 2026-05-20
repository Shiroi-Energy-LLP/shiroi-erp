-- ============================================================================
-- Migration 112 — proposals.sent_to_customer_at audit column
-- Date: 2026-05-20
--
-- Adds an audit timestamp marking when a proposal was emailed to the customer
-- via the new "Send Proposal" button (server action: sendProposalToCustomer).
-- NULL = never sent. Distinct from proposal.sent_at which is internal-only.
--
-- The action also sets status='sent' on the proposal at the same moment
-- (when the prior status was 'draft'), so the UI shows "Sent" state.
-- ============================================================================

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS sent_to_customer_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN proposals.sent_to_customer_at IS
  'Set by sendProposalToCustomer server action when the proposal is emailed '
  || 'to the customer. NULL means never sent. Used as audit + to switch '
  || 'status from draft -> sent. Distinct from sent_at (which is internal-only).';
