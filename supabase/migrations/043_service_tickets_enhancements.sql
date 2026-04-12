-- Migration 043: Service Tickets Enhancements
-- Adds service_amount for tracking service charges, closed_at for resolution timing

-- 1. Add service_amount column for paid service charges
ALTER TABLE om_service_tickets ADD COLUMN IF NOT EXISTS service_amount NUMERIC(14,2) DEFAULT 0;

-- 2. Add closed_at for tracking when ticket was closed (separate from resolved_at)
ALTER TABLE om_service_tickets ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- 3. Add index for efficient filtering by severity
CREATE INDEX IF NOT EXISTS idx_tickets_severity ON om_service_tickets(severity);

-- 4. Add index for efficient filtering by issue_type
CREATE INDEX IF NOT EXISTS idx_tickets_issue_type ON om_service_tickets(issue_type);
