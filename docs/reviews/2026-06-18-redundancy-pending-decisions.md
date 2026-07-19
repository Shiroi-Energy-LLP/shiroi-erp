# Redundancy Sweep — Pending Decisions (for Vivek)

> Date: 2026-06-18 · Companion to `2026-06-18-erp-redundancy-sweep.md` + `2026-06-18-ui-theming-audit.md`.
> Everything here is **reported, not changed** — it needs your call. Schema (migs 188/189), the safe code dedup, formatINR whole-rupees, PDF whole-rupees, the label centralization, and the colour-shift are already done + pushed.

---

## C. `ProjectLite` — keep or merge?

A minimal "project for a dropdown/list row" type. **Three definitions:**

| File | Shape | Used by |
|---|---|---|
| `inverters-queries.ts:36` | `{ id, customer_name, project_number, project_name? }` | `getAllProjectsForInverters` → `/om/inverters` project picker |
| `plant-monitoring-queries.ts:11` | **identical** to above | `getProjectsWithCredentials`, `getAllActiveProjects` → `/om/plant-monitoring` |
| `amc-actions.ts:22` | **+`commissioned_date`** (a near-twin) | `getCommissionedProjects`, `getAllProjectsForAmc`, `getProjectsWithAmc` → AMC pickers |

**Assessment:** Only the inverters + plant-monitoring pair is a true duplicate (byte-identical 1-line type). The AMC one legitimately differs (extra field). 

**Recommendation:** **Leave it.** It's a one-line local type; a shared module + import for one line is net-negative indirection. If you'd rather unify the inverters/plant-monitoring pair, I can put it in `packages/types` as `ProjectLite` and `import type` in both — say the word.

---

## D. The 5 "employee dropdown" helpers — they are the SAME selection

**Your question — are they choosing employees for different reasons (tasks vs project-assigned vs …)?** **No.** All five run the **identical** query — `from('employees').select('id, full_name').eq('is_active', true).order('full_name')`. None filter by task, project, or role. The names are misleading (`getSalesEngineers` does **not** filter to sales engineers; `getActiveEmployeesForProject` does **not** filter by project). They all return *every active employee*.

| Function | File | Error behaviour | Callers |
|---|---|---|---|
| `getActiveEmployees` | tasks-actions.ts | returns `[]` | /tasks, /om/amc, /om/tickets |
| `getActiveEmployeesForProject` | project-milestone-actions.ts | returns `[]` | project Execution tab |
| `getActiveEmployeesLite` | project-detail-actions.ts | returns `[]` | /projects/[id] |
| `listEmployeesForSelect` | sales-territories-queries.ts | returns `[]` | /sales/territories |
| `getSalesEngineers` | leads-queries.ts | **throws** | /leads, /sales, /leads/[id]/tasks |

**So yes, they CAN become one.** The only wrinkle: `getSalesEngineers` **throws** on error while the other four return `[]`.

**Recommended plan:** one shared `getActiveEmployeesForSelect()` in a new `lib/employees-queries.ts` (returns `[]` on error). Repoint the 4 `return []` callers to it. For `getSalesEngineers`: either (a) leave it as-is, or (b) also repoint it (its 3 callers — /leads, /sales, /leads/[id]/tasks — would then get `[]` instead of a thrown error on the rare query failure; functionally they'd render an empty dropdown rather than an error page). **Your call: unify all 5, or the safe 4 and leave `getSalesEngineers`?**

---

## F. The ~40 cold-in-dev indexes — none are duplicates; keep

**Key point you raised:** these aren't duplicates. The duplicate/shadowed indexes were already removed (migs 187/188/189); every index below is **unique** — it's just never been *scanned on dev data*. `idx_scan = 0` in dev means "this feature path hasn't run here," not "useless." **Purchase/finance/zoho/import flows are barely exercised on dev**, so their supporting indexes read as cold.

**Recommendation: keep all of them.** Revisit only after the team (esp. Purchase) has used the ERP on prod for a while, then re-check `idx_scan` against *prod* stats.

**Feature-supporting partials (clearly keep) — fire once the feature runs:**
`idx_invoices_overdue`, `idx_po_msme`, `idx_po_payment`, `idx_po_dispatch_stage`, `idx_invoices_e_invoice_status`, `idx_invoices_legal`, `idx_invoices_erp_created`, `idx_zoho_sync_queue_pending/unclaimed/failed`, `idx_vendor_bills_ai_pending`, `idx_vendor_payments_msme`, `idx_documents_extraction_status`, `idx_documents_external_id`, `idx_site_photos_gate/sync`, `idx_dsr_sync`, `idx_inverter_daily_performance`, `idx_price_book_update`, `idx_cash_positions_alert`, `idx_milestones_gate`, `idx_leads_converted`, all `idx_pending_imports_*` (import-review), all `idx_project_recon_*` + `idx_recon_sheet_*` (reconciliation), `idx_audit_entity/actor` (procurement audit), `idx_poi_rfq_quote`, `idx_proposal_bom_lines_price_book_id`, `idx_project_boq_items_price_book_id`, `idx_zoho_invoice_line_items_zoho_invoice_id`, `idx_processing_jobs_entity/status`, `idx_zoho_account_codes_type`.

**Plain (non-partial) — also keep, but the first place to look if you ever trim:**
`idx_expenses_expense_date`, `idx_activities_occurred_at`, `idx_activities_owner`, `idx_whatsapp_queue_project/profile`, `idx_vendor_payments_date`, `idx_invoices_status_due_date`, `idx_leads_estimated_size_kwp` (the kWp-range filter), `idx_milestones_status`, `idx_project_boq_items_status`, `idx_recon_sheet_name_norm`, `idx_vendors_active/type/preferred`, and the `idx_*_zoho_customer_id/name` set (Zoho import attribution — possibly one-time; safest to keep until the Zoho sync cadence is settled).

No action taken. If you ever want to trim, I'd only touch the second group, and only after prod usage data.

---

## Still NOT done (larger / needs decisions) — from the audit §5 + UI audit

- **§5 structural component dedup (the big one):** shared `<InvoiceForm>`/`<PaymentForm>` + single actions (the invoice/payment dialogs duplicate down to the DB-write action), 8 hand-rolled tables → shared `data-table`, signature pads → one, vendor add/edit → shared form, + `<Banner>`/`<TabNav>`/`<ConfirmDeleteButton>` primitives and ~40 empty-state migrations. These change behaviour/markup → want your review per item. **Highest functional value: the invoice + payment dialog/action pairs.**
- **Status-colour maps:** `data-table.tsx STATUS_COLORS`, `lead-status-badge STATUS_PALETTE`, `liaison-status-badge`, BOQ status colours (`step-boq STATUS_COLORS` / `boq-variance STATUS_DOT_COLORS`), `projects-summary-header` — still duplicated. **Blocker:** two of them disagree (the lead `won` status renders two different greens). Needs you to pick the canonical status palette, then I centralize + an ESLint guard against raw `text-[#…]`.
- **~206 hardcoded hexes remain** — all status/accent colours (greens/ambers/reds/blues/purples) + a few one-offs (chart fills, SVG logo, brand-ish `#E5A825`/`#FACB01`). These flow from the status-palette decision above.
- **PDF unit-price columns** now round to whole rupees (with the rest). If a customer PDF needs 2-decimal unit rates, flag it.
