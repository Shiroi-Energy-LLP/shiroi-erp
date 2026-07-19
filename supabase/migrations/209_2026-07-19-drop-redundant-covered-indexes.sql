-- 209: Drop provably-redundant indexes (2026-07-19 perf work,
-- docs/reviews/2026-07-19-erp-speed-full-report.md).
-- Class 1 (36): every index here is fully covered by a broader keeper on the
-- same table -- identical leading key columns and an equal-or-wider predicate --
-- so every query it served can use the keeper. Detected via pg_index prefix
-- analysis, not scan counts, so this is correctness-safe on prod too.
-- Class 2 (7): indexes on the three *_unpartitioned_backup tables (kept-data
-- backups from the partitioning migrations; never queried).
-- Rationale: the June audit measured 57-68 ms cold planning on over-indexed hot
-- tables (projects 14 idx, leads 22); fewer indexes = less planner work + faster
-- writes. Keepers noted inline. Applied to dev 2026-07-19.

-- Class 1 -- covered by a broader index
DROP INDEX IF EXISTS idx_bcp_pending;                          -- keeper: idx_bcp_project
DROP INDEX IF EXISTS idx_customer_payments_project_id;         -- keeper: idx_customer_payments_project_date
DROP INDEX IF EXISTS idx_delivery_log_pending;                 -- keeper: idx_delivery_log_employee
DROP INDEX IF EXISTS idx_certifications_blocking;              -- keeper: idx_certifications_employee
DROP INDEX IF EXISTS idx_compensation_current;                 -- keeper: idx_compensation_employee
DROP INDEX IF EXISTS idx_question_progress_mastered;           -- keeper: idx_question_progress_unique
DROP INDEX IF EXISTS idx_employees_active;                     -- keeper: idx_employees_is_active
DROP INDEX IF EXISTS idx_ec_contact;                           -- keeper: entity_contacts_contact_id_entity_type_entity_id_key
DROP INDEX IF EXISTS idx_invoices_status;                      -- keeper: idx_invoices_status_due_date
DROP INDEX IF EXISTS idx_lead_assignments_active;              -- keeper: idx_lead_assignments_lead
DROP INDEX IF EXISTS idx_leads_hubspot;                        -- keeper: leads_hubspot_deal_id_key
DROP INDEX IF EXISTS idx_objections_open;                      -- keeper: idx_objections_project
DROP INDEX IF EXISTS idx_notifications_unread;                 -- keeper: idx_notifications_recipient
DROP INDEX IF EXISTS idx_tickets_open;                         -- keeper: idx_tickets_project
DROP INDEX IF EXISTS idx_track_assignments_incomplete;         -- keeper: idx_track_assignments_unique
DROP INDEX IF EXISTS idx_plant_local_setup_project;            -- keeper: plant_local_setup_project_id_key
DROP INDEX IF EXISTS plant_monitoring_credentials_project_idx; -- keeper: plant_monitoring_credentials_unique_active
DROP INDEX IF EXISTS idx_pba_exceeds;                          -- keeper: idx_pba_price_book
DROP INDEX IF EXISTS idx_proj_assignments_active;              -- keeper: idx_proj_assignments_project
DROP INDEX IF EXISTS idx_boq_items_procurement_status;         -- keeper: idx_project_boq_items_status
DROP INDEX IF EXISTS idx_project_boq_items_project;            -- keeper: idx_project_boq_items_category
DROP INDEX IF EXISTS idx_project_issues_open;                  -- keeper: idx_project_issues_project
DROP INDEX IF EXISTS idx_projects_active;                      -- keeper: idx_projects_status
DROP INDEX IF EXISTS idx_simulations_primary;                  -- keeper: idx_simulations_proposal
DROP INDEX IF EXISTS idx_po_payment;                           -- keeper: idx_po_msme (same partial predicate, wider key)
DROP INDEX IF EXISTS idx_qc_gates_project;                     -- keeper: idx_qc_gates_number
DROP INDEX IF EXISTS idx_ncr_open;                             -- keeper: idx_ncr_project
DROP INDEX IF EXISTS idx_rfq_invitations_rfq;                  -- keeper: rfq_invitations_rfq_id_vendor_id_key
DROP INDEX IF EXISTS idx_rfq_items_rfq;                        -- keeper: rfq_items_rfq_id_boq_item_id_key
DROP INDEX IF EXISTS idx_rfq_quotes_invitation;                -- keeper: rfq_quotes_rfq_invitation_id_rfq_item_id_key
DROP INDEX IF EXISTS idx_site_photos_gate;                     -- keeper: idx_site_photos_project
DROP INDEX IF EXISTS idx_stock_pieces_serial;                  -- keeper: stock_pieces_serial_number_key
DROP INDEX IF EXISTS idx_stock_pieces_warehouse;               -- keeper: idx_stock_pieces_location
DROP INDEX IF EXISTS idx_tasks_assigned_open;                  -- keeper: idx_project_tasks_assigned
DROP INDEX IF EXISTS idx_assessment_results_passed;            -- keeper: idx_assessment_results_employee
DROP INDEX IF EXISTS idx_vendor_bills_zoho_id;                 -- keeper: vendor_bills_zoho_bill_id_key

-- Class 2 -- backup-table indexes (tables are cold storage; never queried)
DROP INDEX IF EXISTS idx_customer_msg_log_backup_status;
DROP INDEX IF EXISTS idx_customer_msg_log_backup_meta_wamid;
DROP INDEX IF EXISTS idx_msg_log_entity_unpartitioned_backup;
DROP INDEX IF EXISTS idx_msg_log_date_unpartitioned_backup;
DROP INDEX IF EXISTS idx_msg_log_unforwarded_unpartitioned_backup;
DROP INDEX IF EXISTS idx_audit_log_table_unpartitioned_backup;
DROP INDEX IF EXISTS idx_audit_log_date_unpartitioned_backup;
