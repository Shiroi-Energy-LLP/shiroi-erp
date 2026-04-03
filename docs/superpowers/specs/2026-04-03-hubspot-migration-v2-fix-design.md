# HubSpot Migration V2 Fix — Design Spec

**Date:** April 3, 2026
**Status:** Approved
**Scope:** Fix all issues from HubSpot migration V1, ensure 100% data capture

---

## Problem Statement

HubSpot migration V1 completed with these issues:
1. **24 unmatched payments** — name matching too strict, PV numbers not used for matching
2. **329 PV numbers ignored** — dash format (`PV041-22`) not parsed, only slash format (`PV049/24`)
3. **237 deduped records not audited** — some may be false matches from aggressive substring matching
4. **2 stage mappings wrong** — `Appointment Scheduled` → `new` (should be `site_survey_scheduled`), `Design Confirmation` → `proposal_sent` (should be new `design_confirmed`)
5. **Payment stages not captured** — HubSpot payment milestone types not stored
6. **2 missing records** — Maharajan (PV071/25-26, 4kWp, ₹2,18,677) and Rakshas 20kW (₹1,83,000 commissioning) have no DB records at all

## Solution

### 1. Migration 011: Add `design_confirmed` to `lead_status` enum

```sql
ALTER TYPE lead_status ADD VALUE 'design_confirmed' AFTER 'proposal_sent';
```

Updated lead flow:
```
new → contacted → site_survey_scheduled → site_survey_done → proposal_sent → design_confirmed → negotiation → won / lost / on_hold / disqualified
```

### 2. Fix Stage Mapping

| HubSpot Stage | V1 Mapping | V2 Mapping |
|---|---|---|
| `To check` | `new` | `new` (unchanged) |
| `Appointment Scheduled` | `new` | **`site_survey_scheduled`** |
| `Site visit Completed` | `site_survey_done` | `site_survey_done` (unchanged) |
| `Proposal Sent` | `proposal_sent` | `proposal_sent` (unchanged) |
| `Design Confirmation` | `proposal_sent` | **`design_confirmed`** |
| `Negotiation` | `negotiation` | `negotiation` (unchanged) |
| `Final Negotiation` | `negotiation` | `negotiation` (unchanged) |
| `Closed Won` | `won` | `won` (unchanged) |
| `Closed Lost to Competition` | `lost` | `lost` (unchanged) |
| `Closed Didnt do` | `lost` | `lost` (unchanged) |
| `Closed Later` | `lost` | `lost` (unchanged) |

**Execution:** UPDATE existing leads in DB where status was wrongly set:
- 2 leads with `Appointment Scheduled` → update from `new` to `site_survey_scheduled`
- 14 leads with `Design Confirmation` → update from `proposal_sent` to `design_confirmed`

### 3. Fix PV Number Parser

Add dash format support to `parsePVNumber()`:
- Current regex: `/PV\s*(\d+)\s*\/\s*(\d{2}(?:-\d{2})?)/i`
- New regex: `/PV\s*(\d+)\s*[\/\-]\s*(\d{2}(?:-\d{2})?)/i`
- This makes `-` an alternative to `/` as separator
- `PV041-22` → PV number 41, FY 22-23
- Unlocks 329 more PV numbers for matching

### 4. Fix Payment Matching (24 → 0 unmatched)

**New matching cascade:**

1. **PV number match** — Parse PV from payment's Quote ID, find project whose `pv_number` metadata or `proposal_number` contains the same PV number
2. **Improved fuzzy name match:**
   - Split on ` - ` delimiter (common in HubSpot: "Developer - Building")
   - Match any part independently
   - Case-insensitive, strip honorifics
   - Levenshtein threshold increased for longer names
3. **Manual mapping table** — Hardcoded for known problematic matches:
   ```
   "Srestha Padmalaya" → "SPDPL Padmalaya"
   "Jains - Aadheeswar" → "Jians Aadheeswar"
   "Prestige Ooty Hill Crest" → "Prestige Hill Crest"
   "Khurinji The Orchid" → "Khurinji's Orchid"
   "RCC e-Construct" → "RCC e constrcution"
   "Newry properties Astor" → "Newry Astor"
   ```
   (Full list determined at runtime by checking DB)

### 5. Payment Stages → `customer_payments`

| HubSpot Stage | `is_advance` | `notes` |
|---|---|---|
| `Advance` | `true` | "Advance payment (HubSpot)" |
| `Supply payment` | `false` | "Supply payment (HubSpot)" |
| `Installation payment` | `false` | "Installation payment (HubSpot)" |
| `Commissioning payment` | `false` | "Commissioning payment (HubSpot)" |
| `Retention` | `false` | "Retention payment (HubSpot)" |

### 6. Create Missing Records

**Maharajan:**
- Lead: customer_name="Maharajan", status=won, source=referral
- Proposal: PV071/25-26, 4 kWp, total ₹2,18,677, status=accepted
- Project: 4 kWp, status=advance_received (has advance payment)
- Payment: ₹1,00,000 advance

**Rakshas 20 kW:**
- Lead: customer_name="Rakshas", status=won, source=referral
- Proposal: 20 kWp, status=accepted
- Project: 20 kWp, status=commissioned (commissioning payment stage)
- Payment: ₹1,83,000 commissioning payment

### 7. Dedup Audit Report

Generate `scripts/data/dedup-audit-report.csv` with columns:
- hubspot_record_id, hubspot_deal_name, hubspot_pv_number
- matched_to (lead ID or project ID)
- matched_name (what it matched against)
- match_type (hubspot_id | name+size | name_only | substring)
- confidence (high | medium | low)
- flag (empty or "REVIEW" for suspicious matches)

Flag criteria for "REVIEW":
- substring-only match with no size confirmation
- name length < 6 characters
- Levenshtein match (not exact)

### 8. Update leads-helpers.ts

Add `design_confirmed` to the valid status transitions:
- `proposal_sent` → can transition to `design_confirmed`
- `design_confirmed` → can transition to `negotiation`, `won`, `lost`, `on_hold`

### 9. Update lead-status-badge.tsx

Add badge color for `design_confirmed` status (use `info` variant — blue).

---

## Files Changed

| File | Change |
|---|---|
| `supabase/migrations/011_design_confirmed_status.sql` | New — enum addition |
| `scripts/fix-hubspot-v2.ts` | New — all fixes in one idempotent script |
| `scripts/data/dedup-audit-report.csv` | New — generated output |
| `apps/erp/src/lib/leads-helpers.ts` | Update — add design_confirmed transitions |
| `apps/erp/src/components/leads/lead-status-badge.tsx` | Update — add design_confirmed badge |
| `packages/types/database.ts` | Regenerate after migration |

## Execution Order

1. Apply migration 011 (SQL Editor on dev)
2. Run `npx tsx scripts/fix-hubspot-v2.ts --dry-run` (preview)
3. Run `npx tsx scripts/fix-hubspot-v2.ts` (live)
4. Review dedup-audit-report.csv
5. Regenerate types
6. Update UI files
7. Update CLAUDE.md + master reference

---

*Approved by Vivek on April 3, 2026*
