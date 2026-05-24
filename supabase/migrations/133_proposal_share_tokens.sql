-- Migration 133: Customer proposal portal — magic-link share tokens
-- proposal_share_tokens enables public (no-auth) proposal viewing via a unique token.

CREATE TABLE IF NOT EXISTS proposal_share_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  viewed_count INT NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ,
  last_viewed_ip TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_share_tokens_token ON proposal_share_tokens(token);
CREATE INDEX idx_share_tokens_proposal ON proposal_share_tokens(proposal_id);

-- No RLS needed: public page uses admin client for token lookup (read-only, no user data exposed).
-- Employees who can create tokens: marketing_manager, designer, founder, sales_engineer.
-- This is enforced in the server action, not via RLS, since the table must remain
-- readable by the public API route without any auth context.
