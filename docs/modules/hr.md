# HR Module

> Employees, leave, training, certifications, payroll. Founder + hr_manager only; salary data is RLS-gated to employee / direct manager / hr_manager / founder at the DB level.
> Related modules: [finance](./finance.md) (payroll export, consultant payouts), [projects](./projects.md) (certifications block site deployment), master reference §11–§12.

## Overview

HR owns the employee lifecycle from auth-user creation through onboarding, leave, skill/cert tracking, monthly payroll export to Zoho, and exit checklists. Identity is a three-table fan-out: `auth.users` (Supabase Auth) ↔ `profiles` (role + contact, 1:1 by `id`) ↔ `employees` (HR master, `profile_id` FK). Most app queries resolve the current user as `employees.id` via `profile_id = auth.uid()`. Compensation is the single most sensitive dataset in the ERP — `employee_compensation` and `salary_increment_history` are restricted by RLS so that only the employee themselves, their `reporting_to_id` manager, `hr_manager`, and `founder` can read a row. App-level checks in `hr-queries.ts` mirror the DB policy (defence in depth) but the DB is the source of truth. Never bypass with the service role except for the payroll export path, which is itself role-gated.

## Screens / Routes

- `/hr` — founder/hr_manager dashboard. KPI cards (active employees, blocking-cert warnings, total). Employee table with cert-expiry badge. Link-out to Payroll Export.
- `/hr/employees` — employee list with `New Employee` button + `DeactivateEmployeeButton` per row (soft deactivate via `is_active = false` + ban auth user).
- `/hr/employees/new` — auth user + profile + employee triple-insert flow (founder / hr_manager only). Generates 12-char temp password; shown once to the creator.
- `/hr/[id]` — single employee detail page (certifications + leave history; compensation gated by `getEmployeeCompensation` role check).
- `/hr/leave` — leave requests list (100 most recent). Status badges: pending / approved / rejected / cancelled.
- `/hr/training` — training assessment results (module, score, pass/fail, certificate issued).
- `/hr/certifications` — all employee certifications with colour-coded expiry (<0d red, ≤90d amber, else green) and `is_expired` flag.
- `/hr/payroll` — `PayrollExportForm` to generate Zoho CSV for a given year/month. Standard schedule: 25th of every month.

## User Flows

**New employee onboarding.** `/hr/employees/new` → `createEmployeeAccount` in `employee-actions.ts`:
1. `adminClient.auth.admin.createUser` (email + temp password, `email_confirm: true`).
2. The `on_auth_user_created` trigger inserts the `profiles` row automatically; the action then `UPDATE`s it with `role`, `full_name`, `phone`, `email`.
3. `employees` insert with `profile_id = authData.user.id`, `employee_code`, `designation`, `department`, `date_of_joining`, `is_active = true`.
4. Temp password returned to the caller (founder/hr_manager) exactly once. They share it out of band; employee changes it on first login.

**Deactivation.** `deactivateEmployee`: sets `employees.is_active = false` + `last_working_day = today`, flips `profiles.is_active = false`, and bans the auth user for ~100 years (`ban_duration: '876600h'`). Keeps all FK history intact (Tier 3 immutability on compensation / lifecycle / ledger).

**Leave.** Employee files a `leave_requests` row (status `pending`); manager or HR approves → `leave_ledger` debit entry (Tier 3 double-entry model — corrections via reversal entries only) → `leave_balances` refreshed (`balance_days`). Offline-capable via `sync_status` column.

**Training + certifications.** Daily WhatsApp microlearning (3-5 questions at 9am via n8n) drives `employee_question_progress` with spaced repetition (wrong→tomorrow, 1 correct→+3d, 2→+7d, 3+→+30d/mastered). Formal `training_assessment_results` per module at ≥70% pass threshold. `employee_certifications` with `blocks_deployment = true` + expired ⇒ employee cannot be assigned to a site project (enforced via `employee_certifications.is_expired` nightly cron).

**Monthly payroll.** HR runs `/hr/payroll` on the 25th → `getPayrollData(year, month)` joins active `employees` with current `employee_compensation` (`is_current = true`) → `generatePayrollCSV` in `payroll-export.ts` emits 18-column Zoho-compatible CSV: `employee_id, full_name, uan_number, esic_number, paid_days, lop_days, basic_salary, hra, special_allowance, travel_allowance, other_allowances, variable_pay, one_time_additions, one_time_deductions, pf_employee, esic_employee, professional_tax, remarks`. No salary amounts are ever logged in this path. ERP is the master; CSV is uploaded into Zoho Payroll.

## Key Tables

- `profiles` — `id` = `auth.users.id`, `role app_role`, `full_name`, `email`, `phone`, `is_active`. Auto-created by `handle_new_user` trigger.
- `employees` — `profile_id` FK (unique, 1:1), `employee_code`, `designation`, `department` (CHECK: sales/projects/operations/finance/hr/management/om), `employment_type`, `date_of_joining`, `reporting_to_id` (self-FK for manager chain), `is_active`, `last_working_day`, `exit_reason`, plus sensitive: `aadhar_number`, `pan_number`, `bank_account_number`, `bank_ifsc`, `uan_number`, `esic_number`, `pf_applicable`, `esic_applicable`.
- `employee_compensation` — **RLS-restricted.** One `is_current = true` row per employee. `ctc_annual / ctc_monthly / basic_salary / hra / special_allowance / travel_allowance / other_allowances / variable_pay / pf_employee / pf_employer / esic_employee / esic_employer / professional_tax / gross_monthly / net_take_home`. Immutable once superseded (Tier 3).
- `salary_increment_history` — **RLS-restricted.** `old_compensation_id`, `new_compensation_id`, `increment_type` (annual_review / promotion / market_correction / probation_confirmation / performance / other), `old_ctc_annual`, `new_ctc_annual`, `increment_amount`, `increment_pct`. Immutable.
- `leave_requests` — `leave_type` (casual/sick/earned/maternity/paternity/compensatory/loss_of_pay/other), `from_date`, `to_date`, `days_requested`, `status`, `is_half_day`, `backup_assigned_to`, `sync_status` (offline-sync aware).
- `leave_ledger` — Tier 3 double-entry. `entry_type` (opening_balance / accrual / debit / reversal / adjustment / lapse / encashment), `balance_after` stored explicitly (never recomputed on read).
- `leave_balances` — per-employee-per-type summary, refreshed from ledger.
- `employee_skills` — 13 skill types × 4 proficiency levels. Used for deployment + training-gap analysis.
- `employee_certifications` — 8 cert types, `blocks_deployment` flag, `is_expired` (nightly cron), `expiry_date`, `certificate_storage_path`. Alerts 30 days before expiry.
- `employee_documents` — offer letter, ID proof, experience letter, increment letter, F&F settlement etc. Immutable after upload.
- `employee_lifecycle_events` — joined / probation_confirmed / promoted / transferred / resigned / terminated / contract_renewed / retired / reinstated. Tier 3.
- `employee_exit_checklists` — 8 gates (projects_handed_over, assets_returned, access_revoked, knowledge_documented, leave_balance_cleared, final_payroll_processed, experience_letter_issued, relieving_letter_issued) that must all clear before `ff_paid = true`.
- `monthly_attendance_summary` — `paid_days`, `lop_days`, `is_locked` (locked when payroll export fires). Corrections via `attendance_corrections`.
- `payroll_monthly_inputs` — **RLS-restricted (salary-level).** Variable pay actual, one-time additions/deductions, computed gross/net for the month. Locked when `payroll_export_files` row is created.
- `payroll_export_files` — Tier 3. One row per `month_year`, `csv_storage_path`, `uploaded_to_zoho` flag.
- `employee_insurance` — group health / PA / term life. Alert when `addition_pending_days > 25`.
- `training_modules` / `training_questions` / `employee_question_progress` / `onboarding_tracks` / `onboarding_track_assignments` / `daily_question_delivery_log` / `training_assessment_results` / `language_training_scenarios` — microlearning + onboarding stack (see master reference §11.4).

## Key Files

```
apps/erp/src/app/(erp)/hr/
  page.tsx                       ← KPI + employee list (founder/hr_manager)
  [id]/page.tsx                  ← single employee detail
  employees/page.tsx             ← full employee list + deactivate
  employees/new/page.tsx         ← create auth + profile + employee (founder/hr_manager)
  leave/page.tsx
  training/page.tsx
  certifications/page.tsx
  payroll/page.tsx               ← PayrollExportForm wrapper

apps/erp/src/lib/
  hr-queries.ts                  ← getEmployees, getEmployee, getEmployeeCertifications,
                                   getLeaveRequests, getEmployeeCompensation (role-gated),
                                   getPayrollData (role-gated)
  employee-actions.ts            ← createEmployeeAccount (12-char temp password),
                                   deactivateEmployee (soft + auth ban)
  hr-helpers.ts                  ← daysUntilPayrollExport, isCertificationExpiringSoon,
                                   certificationExpiryStatus, generatePayrollFilename,
                                   maskSensitiveField
  payroll-export.ts              ← generatePayrollCSV (18-col Zoho format, no salary logs)
  payroll-export.test.ts
  hr-dashboard-queries.ts

apps/erp/src/components/hr/
  create-employee-form.tsx, deactivate-employee-button.tsx, payroll-export-form.tsx
```

## Known Gotchas

1. **Salary RLS is sacrosanct.** `employee_compensation` + `salary_increment_history` + `payroll_monthly_inputs` are readable **only** by the employee themselves, their `reporting_to_id` manager, `hr_manager`, and `founder`. No peer visibility. Policies in `005a_hr_master.sql` and `005b_leave_payroll.sql`. Do not widen without Vivek's sign-off.
2. **Never log sensitive fields.** `bank_account_number`, `aadhar_number`, `pan_number`, `gross_monthly`, `basic_salary`, `ctc_monthly`, `ctc_annual`, `net_take_home`, `commission_amount`, `pf_employee`. Error logs include only `{ code, message }` — never the row. `generatePayrollCSV` explicitly documents this and avoids it; preserve the invariant on any edit.
3. **Three-table identity fan-out.** `auth.users.id` = `profiles.id`; `employees.profile_id` = `profiles.id`. To resolve the current employee: `SELECT id FROM employees WHERE profile_id = auth.uid()`. Do **not** stuff `auth.uid()` directly into a column that FKs to `employees.id` — that was the bug class fixed in migrations 031 (`log_project_status_change`) and 055 (`log_lead_status_change`, and the `create_payment_followup_tasks` / `enqueue_payment_escalations` functions from 052 that referenced a non-existent `employees.deleted_at`).
4. **`is_active`, not `deleted_at`.** The employees table uses a boolean `is_active` flag, not a timestamp soft-delete. Migration 055 rewrote two trigger functions that assumed the latter. Never filter with `e.deleted_at IS NULL` against this table.
5. **Role enum (10 values).** `founder`, `hr_manager`, `sales_engineer`, `project_manager`, `site_supervisor`, `om_technician`, `finance`, `customer` (migration 001) + `designer`, `purchase_officer` (migration 009) + `marketing_manager` (migration 051). Adding a new role = new migration + RLS fan-out. Cannot add + reference a new enum in the same transaction (see migration 051→052 split).
6. **Leave ledger is immutable.** Corrections via a `reversal` entry referencing `reversal_of_id`. Never UPDATE or DELETE a `leave_ledger` row.
7. **Certifications block deployment.** `employee_certifications.blocks_deployment = true` + `is_expired = true` ⇒ employee must not be assigned to a site project. Enforce on assignment paths, not post-hoc.
8. **Temp password is shown once.** `createEmployeeAccount` returns `tempPassword` in the action result. The UI renders it, then it's gone. No retrieval path — HR can trigger a password reset if the founder loses it.
9. **Payroll export path is role-gated in app code AND SQL.** `getPayrollData` checks `profile.role ∈ {founder, hr_manager}` before querying; `payroll_monthly_inputs` RLS enforces the same. Both layers are load-bearing.

## Past Decisions & Migrations

- `001_foundation.sql` — profiles + employees + role enum (8 initial roles).
- `005a_hr_master.sql` — compensation (RLS), increment history (RLS), skills, certifications, documents, lifecycle events, exit checklists, system logs.
- `005b_leave_payroll.sql` — leave requests / ledger / balances, attendance, payroll monthly inputs (RLS), payroll export files, insurance.
- `005c_training.sql` — modules, questions, progress (spaced repetition), onboarding tracks, delivery log, assessments, bilingual language scenarios.
- `009_new_roles.sql` — `designer` + `purchase_officer` added.
- `031_project_status_overhaul.sql` — `log_project_status_change` fixed to resolve `employees.id` via `profile_id = auth.uid()`.
- `051_marketing_design_enums.sql` — `marketing_manager` role added (for Prem). Split from 052 because Postgres disallows newly-added enum values in the same transaction that adds them.
- `055_lead_status_fkey_and_won_cascade.sql` — `log_lead_status_change` employee lookup fix, plus two latent bugs in migration 052's trigger functions rewriting `e.deleted_at IS NULL` to use `e.is_active = TRUE`.

## Role Access Summary

| Role | HR access |
|---|---|
| `founder` | Full CRUD everywhere, including salary + increment history. |
| `hr_manager` | Full CRUD on all HR tables. Salary readable. Owns payroll export. |
| `project_manager` / `site_supervisor` (as manager) | Can read own employees' compensation + leave via `reporting_to_id` match. Otherwise standard. |
| Any employee (self) | Read own `employees` row, own `employee_compensation`, own leave/certs/skills/assessments. |
| `customer` | No access to any HR table. |

## Cross-Module Touchpoints

- **Projects** → certifications gate site deployment; `reporting_to_id` feeds manager visibility on `project_manager` / `site_supervisor` dashboards.
- **Finance** → `customer_payments` cascades into `consultant_commission_payouts` (not HR's direct concern, but the `marketing_manager` role lives here); payroll export is an HR-initiated, finance-adjacent artefact.
- **Master reference** §4.8 (sensitive fields), §11 (HR domain), §12 (payroll + Zoho integration format).
