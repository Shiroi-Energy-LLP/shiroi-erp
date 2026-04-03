-- Migration 011: Add 'design_confirmed' to lead_status enum
-- Date: April 3, 2026
-- Purpose: Capture HubSpot "Design Confirmation" stage as its own status
-- Flow: ... → proposal_sent → design_confirmed → negotiation → won/lost/...
--
-- This stage represents: customer has confirmed the design (AutoCAD/SketchUp),
-- before final pricing/negotiation begins.

-- Add the new enum value after 'proposal_sent'
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'design_confirmed' AFTER 'proposal_sent';

-- Verify
DO $$
BEGIN
  RAISE NOTICE 'Migration 011 complete: design_confirmed added to lead_status enum';
END $$;
