# Overnight build — Manivel sheet reconciliation + Command Center (2026-06-16)

Handoff for Vivek / Manivel. Everything below is on `main` and **dev-only** — nothing
touched prod, and no core `projects` rows were modified.

## What shipped (commits on main)
1. `88b8bd9` — Manivel's workbook + read-only parsers into the repo.
2. `a72b3ca` — dashboard-parity spec + Phase-1 sheet↔ERP audit (report + CSVs).
3. `9ff206f` — mig 180: `recon_sheet_projects` + `project_reconciliation` + `get_project_profitability()`; sheet imported, 465 proposals seeded.
4. `f6c4c70` — `/reconciliation` workspace (founder + PM).
5. `43e46c4` — mig 181: `get_dashboard_year_summary()` + `/command-center` year-wise dashboard.

## The headline numbers (dev)
- Sheet = 264 distinct projects (2022→now); ERP = 465 active projects.
- Matches: **153 auto · 31 likely · 35 ambiguous · 246 erp-only**; **114** older rows bucketed **≤2021**.
- Portfolio (ERP): ₹30.64 Cr contracted · **₹6.57 Cr** ERP-computed cost · 48.7% avg margin.
- Sheet (Manivel): ₹15.47 Cr value · **₹11.70 Cr** actual cost · 24.7% margin.
- **The gap is the story:** ERP cost is *under-attributed* (₹6.57 Cr vs ₹11.70 Cr) — ₹45 Cr of POs but 811 are *cancelled*, and lots of spend/payments aren't tagged to a project. That's exactly what reconciliation must resolve.

## What Manivel can do tomorrow (`/reconciliation`)
Founder + PM only. Tabs: Needs-review / Auto / ERP-only (≤2021) / Confirmed / All. Per project he can:
- confirm or reject the proposed sheet match,
- edit the resolved **year** (older jobs default to ≤2021),
- toggle whether to **trust** the ERP-computed number or the sheet's figure.
KPI strip shows needs-review / confirmed / year-mismatch (158) / value-mismatch counts.
Edits write to `project_reconciliation` only.

## `/command-center` (founder + PM)
Year-wise portfolio overview: KPI cards + a per-year ledger (count, completed, contracted value,
ERP cost, avg margin) + a banner linking unreviewed matches to `/reconciliation`.

## NOT done / needs you
- **Write-back to `projects`** — confirmed reconciliation values (year/status/value) are NOT yet applied
  to the core `projects` table. That's a deliberate, human-triggered step to build next (an "Apply
  confirmed" action/migration) once Manivel has reviewed.
- **`cost_erp` definition** — currently committed POs (excl cancelled/draft) + approved expenses. This
  under-counts (see gap above). Decide whether to include vendor_payments / BOQ; the reconciliation UI
  shows ERP vs sheet side-by-side so Manivel can validate.
- **Dashboard is a functional v1** — not yet a UI/UX pass to "beat" the sheet. Happy to iterate on the
  visual design (mockups) on your signal.
- **Matching is heuristic** — 35 ambiguous + sibling-name collisions need Manivel's eye (that's the queue).
- **Prod** — untouched by design. Migrations 180/181 are dev-only until you green-light a prod window.

## Guardrails honored
Dev only; no prod; no destructive data ops (reconciliation is proposal-only, projects untouched);
every commit passed check-types + lint + forbidden-patterns + build.
