# Expenses list-page rework — 2026-07-30

Request: 9-point change to `/expenses` (column order, submit-on-behalf, project
auto-search, Category + Engineer filters, filter-aware KPI, wrapped cells,
clickable project name, everything else unchanged).

Migration **217** (dev only — no prod window open). Types regenerated.

---

## 1. What shipped

| # | Ask | Outcome |
|---|-----|---------|
| 1 | Header order `Project Name \| Submitter \| Category \| Description \| Amount \| Voucher No. \| Status` | Done. The old standalone **Docs** column folded into the voucher cell as a 📎 count so the 7-column spec holds without losing the attachment indicator. |
| 2 | Managers + Founders submit on behalf of Engineers | Done — **Submitter** picker in the Add dialog, defaulting to "Myself". Roles: founder, project_manager, hr_manager, marketing_manager, finance (Vivek's ruling). New `expenses.entered_by` records who keyed it; `submitted_by` stays the claimant so the voucher prefix and reimbursement follow the engineer. |
| 3 | Auto-search on Project Name | Done — `ProjectCombobox` added to the **filter bar** (the Add dialog already had one). |
| 4 | Category filter | Already existed (shipped 958c813); relabelled under a "Category" caption. |
| 5 | Engineer (Submitter) filter | Existed but was broken for the PM — see §2. Now functional, relabelled "Engineer / submitter". |
| 6 | Filter-aware KPI card | Done — leading gold card, exact count + `SUM(amount)` for the active filter set via `get_expense_filtered_totals`. Aggregation in SQL (NEVER-DO #12). |
| 7 | Wrap all columns, no horizontal scroll | Done — `table-fixed` + `<colgroup>` widths + `break-words`. Wrapping classes alone don't work: an auto-layout table widens to its longest cell regardless. |
| 8 | Clickable Project Name → project | Done. General expenses render as non-linked italic "General". |
| 9 | Everything else unchanged | Workflow, badges, timeline, documents, approve/verify/reject/revert untouched. |

## 2. The bug this uncovered (the substantive finding)

`expenses_select_own` (mig 066) lets **founder / project_manager / finance** read
every voucher. `employees_read` only lets **founder / hr_manager** read every
employee — everyone else sees their own row plus direct reports.

Measured on dev as the project_manager profile:

| | |
|---|---|
| Vouchers visible | 6,283 |
| Employee rows readable | **1** (their own) |
| Vouchers whose `submitted_by` was unreadable | **5,114** |

So the PostgREST embed `submitter:employees!…(full_name)` returned NULL and the
Submitter column already read "—" on 81% of rows for the PM, while the Submitter
filter offered exactly one name. Item #5 could not work without fixing this.

**Fix:** `list_expense_employees()` — a `SECURITY DEFINER` projection of
`id, full_name, is_active` **only** (no salary / PAN / Aadhaar / bank columns;
those stay behind `employees_read`). Full list for the roles that act on other
people's vouchers, self + direct reports for everyone else. The query layer
resolves all five name fields (submitter, keyer, verifier, approver, rejecter)
from this directory instead of the embeds, behind a request-scoped `cache()`.

Same root cause on the write side: `generate_voucher_number` read
`employees.voucher_prefix` as SECURITY INVOKER, so a PM/Finance user filing for
a non-report failed with a misleading `employee % has no voucher_prefix`. Now
SECURITY DEFINER with a pinned `search_path`; its `MAX()` sequence scan also now
sees every prior voucher rather than the RLS-visible subset, which is what the
`voucher_number` UNIQUE constraint wants.

## 3. Verification

Four CI gates green (`check-types`, `lint`, forbidden-patterns, `build`).

RLS probes run against dev inside `BEGIN … ROLLBACK` (confirmed zero leftover
rows):

| Probe | Result |
|-------|--------|
| Founder files on behalf of another employee | allowed → `MIG-001` (target's prefix, correct) |
| PM `list_expense_employees()` | 7 rows (vs 1 readable directly) |
| PM files on behalf of a non-report | allowed → `KES-001` |
| Designer (non-delegated role) files on behalf | **blocked by RLS** |
| Designer files for self | allowed → `SHR-001` |
| `get_expense_filtered_totals` | all/general/project/status/search combinations return sane counts + totals |

**Not verified:** the rendered page in a browser. `/expenses` is behind employee
auth and entering credentials isn't something I do — needs a click-through by
Vivek.

## 4. Open items

- **n8n notification on delegated entry.** `emitExpenseSubmitted` still enriches
  through an `employees` embed, so if a *marketing_manager or finance* user files
  for a non-report, `employee_name` and the manager's WhatsApp number come back
  NULL and no approval message routes. Best-effort/non-blocking already; harmless
  for founder / hr_manager / PM-for-own-report (the realistic cases). Fix would
  widen the directory RPC to include `reporting_to_id` + `whatsapp_number`.
- **Project options are now unbounded.** `listExpenseProjectOptions` dropped its
  `.limit(500)` — `projects` already held 507 rows, so the cap was silently making
  7 projects unfilterable (NEVER-DO #25). Revisit with a server-side searched
  combobox past a few thousand projects.
- **Delegated entry is list-page only.** The Add dialog on the project Actuals tab
  doesn't pass `canSubmitOnBehalf`, so it stays self-submit. Say the word if it
  should appear there too.
- **Migration numbering.** Took 217: 215 was committed by the om/tickets session
  and an uncommitted `215_…-amc-visit-events.sql` from a concurrent AMC session
  needs 216.
