-- Migration 142 — 2026-05-30
-- Widen notifications.notification_type and notifications.entity_type CHECK
-- constraints to include all values the code actually inserts.
--
-- WHY: Mig 014 created notifications with a tight CHECK on notification_type
-- (alert/reminder/report/approval_required/info) and entity_type
-- (proposal/project/lead/purchase_order/daily_report/employee/override_report).
-- Since then, 7 server actions across procurement (PO approval flow, RFQ quote
-- intake) and sales (amber-band closure approval) started inserting values
-- outside that whitelist. Every such insert silently 23514s, so the founder
-- never sees PO approval requests, RFQ quote submissions, or closure approval
-- requests in the bell.
--
-- AUDIT (apps/erp/src/lib/, all .insert() into notifications):
--   closure-actions.ts:193             notification_type 'closure_approval'        entity_type 'lead'
--   material-requisition-actions.ts:112 notification_type 'approval_required'      entity_type omitted (worked around)
--   material-requisition-actions.ts:224 notification_type 'info'                    entity_type omitted (worked around)
--   material-requisition-actions.ts:394 notification_type 'approval_required'      entity_type 'purchase_order'
--   procurement-actions.ts:491          notification_type 'procurement'             entity_type 'project'
--   po-actions.ts:210                   notification_type 'po_pending_approval'    entity_type 'purchase_order'
--   po-actions.ts:298                   notification_type 'po_approved'             entity_type 'purchase_order'
--   po-actions.ts:438                   notification_type 'po_rejected'             entity_type 'purchase_order'
--   project-step-actions.ts:2303        notification_type 'procurement'             entity_type 'project'
--   rfq-actions.ts:349                  notification_type 'rfq_quote_submitted'     entity_type 'rfq'
--   rfq-actions.ts:515                  notification_type 'rfq_quote_submitted'     entity_type 'rfq'
--   rfq-actions.ts:1058                 notification_type 'po_pending_approval'    entity_type 'purchase_order'
--   vendor-portal-actions.ts:232        notification_type 'procurement'             entity_type 'rfq'
--
-- VALUES ADDED:
--   notification_type: closure_approval, procurement, po_pending_approval,
--                      po_approved, po_rejected, rfq_quote_submitted
--   entity_type:       rfq, material_requisition
--     ('material_requisition' is added defensively — the requisition flow
--     currently strips entity_type with a TODO comment pointing to this
--     constraint as the blocker; widening here lets those inserts carry the
--     id so the bell can deep-link.)

BEGIN;

-- notification_type: drop old constraint, add new with full union.
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_notification_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_notification_type_check
  CHECK (notification_type IN (
    -- mig 014 originals
    'alert',
    'reminder',
    'report',
    'approval_required',
    'info',
    -- mig 142 additions (code-used values that previously silently 23514'd)
    'closure_approval',
    'procurement',
    'po_pending_approval',
    'po_approved',
    'po_rejected',
    'rfq_quote_submitted'
  ));

-- entity_type: drop old constraint, add new with full union.
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_entity_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_entity_type_check
  CHECK (entity_type IN (
    -- mig 014 originals
    'proposal',
    'project',
    'lead',
    'purchase_order',
    'daily_report',
    'employee',
    'override_report',
    -- mig 142 additions
    'rfq',
    'material_requisition'
  ));

COMMIT;
