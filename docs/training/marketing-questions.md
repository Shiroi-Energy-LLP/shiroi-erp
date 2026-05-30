# Marketing & Sales Workflow — Quiz & FAQ Reference

> Printable handout for new hires on the marketing team (Prem, sales engineers).
> Mirrors the 20-question quiz in `scripts/seed-marketing-training.ts` and the 50
> FAQ pairs in `scripts/seed-marketing-faq.ts`. Source of truth for both is the
> live ERP code under `apps/erp/src/app/(erp)/sales`, `/referrals`, `/payments`
> plus `docs/modules/sales.md`.

---

## How to use this document

- The **Quiz** section is the 20-question micro-learning test scored to pass at
  60%. It is delivered through the in-ERP learning module
  (`learning_modules` row titled "Marketing & Sales Workflow — Shiroi ERP").
- The **FAQ** section feeds the in-ERP AI assistant at `/ask`. If you type any
  question close to one of these, the retriever will surface the matching
  answer with a citation back to this document.
- Both sections are organised by topic. The Quiz answers include the right
  option highlighted; the FAQ answers are short (1–3 sentences) and reference
  the actual menu paths and button labels.

---

# Part 1 — Quiz (20 questions)

Pass mark: 60% (12 of 20). Each question has one correct answer.

## Topic A — Lead Creation

### 1. Required fields on `/sales/new`
**Q.** Which combination of fields is REQUIRED before the form can be submitted?

- a) Customer Name + Phone + Email + Pincode
- **b) Customer Name + Phone + City + Segment + Source ✓**
- c) Customer Name + System Type + Estimated kWp
- d) Customer Name + Phone + Map Link

> Email, kWp, map link and address lines are all optional.

### 2. What kWp drives
**Q.** What does the Estimated Size (kWp) field on the new-lead form drive
downstream?

- a) Nothing — it is purely informational
- **b) The Quick Quote generator picks the inverter capacity (0.8x–1.5x of kWp) and computes panel wattage ✓**
- c) It changes the customer's GST rate
- d) It locks the channel-partner commission

> `budgetary-quote.ts` uses `preferInverterCapacity(sizeKwp)` to pick an inverter
> within 0.8x–1.5x of the system size; per-Wp priced panels are multiplied by
> kWp x 1000 for total watts.

### 3. Why the map link matters
**Q.** Why is the Google Maps link field on a lead important?

- a) It auto-fills the GSTIN
- **b) Design + project teams need it to plan the site survey; the link is also inherited onto the project when the lead wins ✓**
- c) It triggers the WhatsApp drip campaign
- d) It is required for the proposal PDF

> `map_link` is propagated by `create_project_from_accepted_proposal` onto the
> new project (mig 094). The Details tab surfaces it as "View on map ↗".

---

## Topic B — Status & Follow-up

### 4. Path A stage sequence
**Q.** A residential customer asks for a fast budgetary number. Which stage path
is correct?

- **a) new → contacted → quick_quote_sent → won (Path A) ✓**
- b) new → site_survey_done → design_in_progress → won
- c) new → negotiation → closure_soon → won
- d) new → detailed_proposal_sent → on_hold → won

### 5. Status change side-effects
**Q.** You change a lead from "Contacted" to "Survey Scheduled". What happens
automatically?

- a) Nothing — you must add a task by hand
- **b) A follow-up task is created (or updated if one already exists) and assigned to Prem (marketing_manager) ✓**
- c) A WhatsApp message is sent immediately to the customer
- d) The proposal PDF is generated

> `upsertLeadFollowupTask` runs after every status change and every inline
> next-followup edit; it UPDATEs the open `lead_followup` task if one exists,
> else INSERTs.

---

## Topic C — Closure Band

### 6. Amber band meaning
**Q.** What does an AMBER closure band mean on a Closure Soon lead?

- a) Margin is below 8% — Won is blocked
- **b) Margin is between 8% and 10% — clicking Attempt Won creates a pending lead_closure_approvals row and notifies the founder ✓**
- c) Margin is above 10% — Prem can flip to Won alone
- d) No BOM data is captured

### 7. no_bom_cost case
**Q.** A lead has base price > 0 but the BOM cost is 0 (common for AI-imported
historical proposals). What does the closure-band system do?

- a) Blocks Won with a red band
- **b) Returns green band with `dataQuality='no_bom_cost'` and shows a ⓘ note "BOM cost not captured — margin not computed" ✓**
- c) Sends an email to the founder asking for the BOM
- d) Auto-deletes the lead

---

## Topic D — Quoting

### 8. Quick vs Detailed
**Q.** When should you generate a Quick Quote vs a Detailed Proposal?

- a) Always Detailed — Quick Quote is deprecated
- **b) Quick Quote is the budgetary 8-page PDF used to give a fast indicative number before a site survey. Detailed Proposal is the full 7-page Class A document used after design_confirmed. ✓**
- c) Quick Quote is for residential only, Detailed for commercial only
- d) They are the same thing under different names

### 9. Quick Quote ₹0 historical bug
**Q.** Why did Quick Quotes briefly produce ₹0 for every lead before the
May 20, 2026 fix?

- a) The price_book table was empty
- **b) `budgetary-quote.ts` used logical category names like "panel"/"inverter"/"structure" but price_book stores rows under different names (solar_panels, mms, etc.). A PRICE_BOOK_CATEGORY map now bridges the two. ✓**
- c) GST rates were missing
- d) The Anthropic API key expired

---

## Topic E — Won-gate

### 10. Lead has no proposal, Won blocked
**Q.** You imported a historical won deal but there is no proposal on the lead,
so marking it Won is blocked. What do you do?

- a) Delete the lead and re-create it
- **b) Toggle proposal_gate_bypassed ON for that lead (visible on the no-proposal banner to founder + marketing_manager), or flip the org-wide /settings → System proposal_gate to OFF ✓**
- c) Manually edit the database
- d) Generate a Quick Quote first and accept it

### 11. Mark Won (skip margin)
**Q.** "Mark Won (skip margin)" appears next to the Attempt Won button. Who
sees it and what does it do?

- a) Anyone can see it — it auto-approves the closure
- **b) Founder + marketing_manager only. It bypasses the gross-margin closure-band check entirely; the proposal-gate rule still applies. Audited via leads.margin_skipped_at and margin_skipped_by. ✓**
- c) It deletes the lead
- d) It sends a refund to the customer

---

## Topic F — Referrer Attribution

### 12. Internal referrer for VIP lead
**Q.** A lead came from a walk-in to the office but Vivek wants it tracked under
his name for VIP follow-up. Which referrer do you pick?

- a) Leave referrer blank
- **b) Pick "Vivek Sridhar (Founder)" or "Management Referral" — both are seeded internal referrers (channel_partners.is_internal = true); they don't generate a referral payout ✓**
- c) Create a new channel partner called "Vivek"
- d) Pick the first partner on the list

### 13. External payout calculation
**Q.** An external channel partner has default_commission_pct = 1.0. The lead
converts at a base price of ₹10,00,000. What payout row is created when the
lead flips to Won?

- a) ₹50,000 paid out immediately
- **b) A pending referral_payouts row of ₹10,000 (1% of base price), created by the fn_auto_create_referral_payout trigger; visible on /referrals → Pending tab ✓**
- c) Nothing happens until the customer pays
- d) ₹1,000 paid immediately

---

## Topic G — Patterns & Territories

### 14. /sales/patterns Top Loss Reasons
**Q.** On /sales/patterns, what does the "Top Loss Reasons" section show?

- a) A list of lost customer phone numbers
- **b) AI-derived reason buckets with a count chip per reason (extracted by the Sunday 23:00 IST cron from last week's lost leads) ✓**
- c) The price the competitor quoted
- d) Vivek's personal notes

### 15. Territory page access
**Q.** Who can access /sales/territories and what does it do?

- a) Anyone — it is the public lead form
- **b) Founder + marketing_manager only. It defines city → default_assignee mappings (e.g. "Chennai South" → Prem) which drive AI lead routing for new leads. ✓**
- c) Sales engineers only — to assign themselves
- d) Read-only for everyone

---

## Topic H — Payments

### 16. Payment tracker filters
**Q.** On /payments/tracker, which built-in filter tabs are available above the
table?

- a) Only "All"
- **b) Outstanding, All, Awaiting Invoice, Sent Unpaid, ≥30 Days, ≥60 Days — plus an "Expected This Week" badge link ✓**
- c) Won, Lost, Pending
- d) Tamil Nadu, Kerala, Karnataka

---

## Topic I — Proposal Send

### 17. Send proposal from/CC addresses
**Q.** You click "Send Proposal" on a proposal detail. Which inbox does the
email come from and who is CC'd?

- a) From svivek.88@gmail.com, BCC prem@shiroienergy.com
- **b) From prem@shiroienergy.com, CC svivek.88@gmail.com — a 30-day signed PDF link is attached ✓**
- c) From accounts@shiroienergy.com, no CC
- d) It opens the user's default mail client

> Note: `svivek.88@gmail.com` is on **CC**, not BCC.

---

## Topic J — Pipeline KPIs

### 18. Closing This Week numbers
**Q.** The "Closing This Week" KPI card on /sales shows three numbers stacked.
What are they?

- a) Calls made, emails sent, meetings booked
- **b) Lead count + total kWp + total ₹ value of all leads whose expected_close_date falls in the current ISO week; clicking the card filters /sales to that range ✓**
- c) Won, Lost, On Hold counts
- d) Pipeline percentile rank

### 19. Closing This Month exclusions
**Q.** "Closing This Month" excludes which lead statuses from its count?

- a) None — every lead is counted
- **b) Won, Lost, Disqualified — only active leads with an expected_close_date in the current calendar month are counted ✓**
- c) Only New leads
- d) Only leads created this year

### 20. Bulk actions on /sales
**Q.** On /sales you select 5 leads with the row checkboxes. What appears at
the bottom of the screen?

- a) Nothing — bulk actions are not supported
- **b) A BulkActionBar with Bulk Assign, Change Status, Delete (and Merge when exactly 2 are selected). Bulk Change Status reports a partial-update count via toast if RLS blocks any row. ✓**
- c) Just a delete button
- d) A "Send WhatsApp" button

---

# Part 2 — FAQ (50 Q&A pairs)

> These power the in-ERP AI assistant at `/ask`. Phrase your question naturally
> ("Where do I see Prem's open follow-ups?") and the retriever will surface
> the matching answer.

## Lead Creation

### How do I add a new lead?
Go to `/sales` and click "Create Lead" (or open `/sales/new` directly). Required
fields are Customer Name, Phone, City, Segment (residential / commercial /
industrial) and Source. Click **Create Lead** — the form normalises the phone
to 10 digits and routes you to the lead detail page.

### Where do I paste the Google Maps link?
On `/sales/new` there is an optional "Google Maps Link" field below the
address. Paste a `https://maps.google.com` or `https://maps.app.goo.gl` URL.
The link is also inherited onto the project when the lead is marked Won.

### What does the Estimated Size (kWp) field do?
It drives the Quick Quote generator — the inverter is picked within 0.8x to
1.5x of the system size, and per-Wp priced panels are multiplied by kWp x 1000
for total watts. The number is also used by the pipeline KPI cards (Closing
This Week / Month show total kWp).

### I get "A lead with this phone number already exists" — what now?
The phone column has a partial unique index that excludes only lost and
disqualified leads. Search `/sales` for the phone first; if the existing lead
is still active, update it instead of creating a new one. If it was lost or
disqualified you can re-engage by creating the new lead.

---

## Status & Follow-up

### What happens when I change a lead status?
Three things: (1) the change is logged in `lead_status_history`, (2) a
follow-up task for Prem is upserted via `upsertLeadFollowupTask`, and (3) for
`status=won` the proposal-gate trigger runs and, if it passes, the won cascade
fires (`mark_proposal_accepted` → `create_project_from_accepted_proposal`).

### How do I see Prem's open follow-ups?
Open `/my-tasks` for the assigned-to-you list, or `/sales/[id]/tasks` scoped to
a single lead. `getMyTasks` filters `is_completed=false` and orders by due_date
ascending (oldest first), capped at 100 rows.

### How do I see which leads are in negotiation?
On `/sales`, click the "Negotiation" pill in the stage-nav. You can also
filter by URL: `/sales?status=negotiation`, or combine
`/sales?status=negotiation,closure_soon`.

### How do I set the next follow-up date?
Click into the "Next Follow-up" field on the lead detail page (or inline on
`/sales`). The save is auto-handled; it also updates or creates the open
`lead_followup` task for that date.

### Where do I log a call or meeting with the customer?
On the lead detail page, open the **Activities** tab and click "Add Activity".
Pick the type (call, email, meeting, note, whatsapp), add notes, and save. The
entry shows up in the activity_associations timeline and is fed into RAG
nightly.

---

## Closure Band

### What does the amber closure-date warning mean?
Amber band means the gross margin is between 8% and 10%. Clicking **Attempt
Won** creates a row in `lead_closure_approvals` and notifies the founder; the
lead flips to Won only after he approves it from the dashboard
ClosureApprovalsPanel.

### Why does the closure badge show a ⓘ next to the green band?
That ⓘ means `dataQuality=no_bom_cost` — the lead has a base price > 0 but no
BOM cost is captured (common for AI-extracted historical proposals). The band
is forced to green so Won is not blocked, but margin was not actually computed.

### My lead shows a red band and Won is blocked — what do I do?
Red band = margin <8%. Either negotiate the customer price up (edit
`base_quote_price` on the Quote tab), reduce BOM cost, or mark the lead Lost.
Founder + marketing_manager can also use "Mark Won (skip margin)" if BOM data
is not tracked.

---

## Quoting

### What's a Quick Quote vs Detailed Quote?
Quick Quote is the 8-page budgetary PDF auto-generated from `price_book`
defaults — fast indicative pricing for early conversations, marked
"Budgetary Estimate — subject to site survey". Detailed Proposal is the 7-page
Class A document with line-by-line BOM, generated after `design_confirmed` and
required for the won cascade on new business.

### How do I generate a Quick Quote?
On the lead detail page open the **Quote** tab (or click the "Quick Quote"
button). Confirm system type and kWp, then Generate. The PDF lands under
`/sales/[id]/files` and the lead status flips to `quick_quote_sent`.

### How do I generate a Detailed Proposal?
On the lead Quote tab, click "Create Detailed Proposal". Add BOM lines via
BomPicker (these must have `price_book_id`; legacy free-text lines are flagged
amber), set payment milestones, then click "Finalize" —
`finalizeDetailedProposal` validates every line has a `price_book_id` and
produces the PDF.

### How do I edit the BOM on a proposal?
Open the lead Quote tab. Use BomPicker to add a price_book item, the inline
quantity editor on each row, and the trash icon to remove a line.
`updateBomLineQuantity` and `removeBomLine` are server actions — changes take
effect immediately.

### Can I convert a Quick Quote into a Detailed Proposal?
Yes — `escalateQuickToDetailed` (in `quote-actions.ts`) creates a new detailed
proposal seeded from the Quick Quote pricing. The button is on the Quote tab
when a Quick Quote already exists.

### Where do Quick Quote prices come from?
From the `price_book` table. `budgetary-quote.ts` reasons in logical categories
(panel, inverter, structure, dc_cable, ac_cable, earthing, installation_labour,
net_meter, civil_work) and looks them up via a `PRICE_BOOK_CATEGORY` map that
bridges to the DB categories (solar_panels, mms, dc_accessories, etc.). Rows
with `base_price <= 0` are always skipped.

---

## Won-gate

### How do I bypass the margin gate on a won lead?
On the lead detail page in the `closure_soon` stage, founder +
marketing_manager see a secondary "Mark Won (skip margin)" button next to
"Attempt Won". It skips the BOM-margin check entirely. The proposal-gate rule
still applies. The bypass is audited via `leads.margin_skipped_at` +
`margin_skipped_by`.

### How do I enable proposal_gate_bypassed on a specific lead?
On the lead detail page, when the lead has no proposal you see a "Proposal Gate
Bypassed" toggle (visible to founder + marketing_manager only). Flip it ON to
allow Won without a proposal.

### How do I turn off the proposal-gate org-wide?
Go to **/settings → System** and toggle "Proposal Gate" OFF. While OFF, a
site-wide amber banner appears on the dashboard + /sales + lead detail pages.
This is the historical-cleanup mode — remember to switch it back ON for normal
business.

---

## Referrer Attribution

### How do I add a new channel partner?
Go to `/partners` and click "Add Partner". Fill in name, type (consultant /
architect / MEP / referral), contact details, and `default_commission_pct`
(defaults to 1%). Bank account fields are sensitive and masked in the UI.

### Where do I see referral payouts?
On `/referrals`. The page has a KPI strip (pending count, this-month
commission, lifetime paid) and a 3-tab table: Pending / Approved / Paid. Each
row has Approve, Reject, and Mark Paid actions.

### How do I see all leads attributed to one partner?
Open `/referrals/partners/[id]` (or click the partner name on `/partners`).
The page shows YTD totals, lifetime referrals, full payout history, and the
bank account (masked behind a click-to-reveal SensitiveField).

### What's the difference between an internal and external referrer?
Internal referrers (`channel_partners.is_internal = true` — seeded with
"Vivek Sridhar (Founder)" and "Management Referral") do NOT generate a
`referral_payouts` row when the lead wins. External partners do — the
`fn_auto_create_referral_payout` trigger writes a pending row at the default
commission percentage.

### How is the referral payout amount calculated?
`partner.default_commission_pct × proposal base price` (defaults to 1%). The
trigger fires when the lead status flips to "won" and `channel_partner_id` is
set. After payment, `increment_partner_commission` RPC atomically bumps
`lifetime_commission` and `lifetime_referrals` on the partner row.

### How do I change the referrer on an existing lead?
On the lead detail page → Details tab, click the Referrer row to open the
InlineReferrerPicker. Pick a different partner (or clear to no referrer). The
change is saved on selection; consultant commission is recomputed and locked
by the BEFORE UPDATE trigger.

---

## Patterns & Territories

### How do I view win/loss patterns?
Open `/sales/patterns`. Founder + marketing_manager only. The page shows the
latest AI narrative, top loss reasons, pricing insight, and similar past won
deals retrieved from RAG. Reports are generated every Sunday at 23:00 IST by
the win-loss analyser cron.

### Can I trigger a win/loss analysis right now?
Only the founder sees the "Run analysis now" button on `/sales/patterns`. It
calls the same `win-loss-analyser` used by the Sunday cron and stores the new
row in `lead_win_loss_patterns`.

### How do I view or edit sales territories?
Open `/sales/territories`. Founder + marketing_manager only. Each territory
has a name, a list of cities (lowercase), an optional segment filter, and a
default_assignee. New leads are auto-routed to the matching territory's rep
by the F5 lead-router.

### How do I add a new city to a territory?
On `/sales/territories`, edit the territory row and add the city to its
cities array (use lowercase, e.g. "tiruvallur"). Save. The router uses exact
lowercase match against the lead's `city` field on the next routing run.

### What are the "Similar Past Won Deals" cards on /sales/patterns?
They are pulled from the RAG knowledge base using semantic similarity against
the current period's won leads. Each card shows the source path, a content
excerpt, and the similarity percent. Useful for sales-pitch reference.

---

## Payments

### Why is the payment tracker showing overdue?
A milestone with status `sent_unpaid` (invoice sent but no receipt) that has
passed its due date is overdue. Open `/payments/tracker?filter=order_30d` or
`order_60d` for aging buckets. Click into the project to see the milestone and
trigger a follow-up.

### What filters are on /payments/tracker?
Tab filters: **Outstanding** (default), **All**, **Awaiting Invoice**, **Sent
Unpaid**, **≥30 Days**, **≥60 Days**. There is also an "Expected This Week"
badge link that filters to projects with a milestone due in the current week.

### Where do I see all my payment follow-up tasks?
Open `/my-tasks` and look for tasks of type `payment_followup` or
`payment_escalation`. These are auto-created by the
`create_payment_followup_tasks` and `enqueue_payment_escalations` triggers on
`proposal_payment_schedule` rows (assigned to Prem).

### How do I close out a payment follow-up?
On `/payments/tracker`, click the follow-up indicator next to the milestone and
use **Mark Complete** in the FollowUpDialog. Or open the task on `/my-tasks`
and tick it off there.

### What does "Expected This Week" on the payment tracker count?
Projects with at least one milestone whose due date is in the current ISO week
and status is `awaiting_invoice` or `sent_unpaid`. Sourced from
`getPaymentsExpectedThisWeek`; the count is the number of distinct projects.

---

## Proposal Send

### How do I send a proposal to the customer?
Open the proposal detail page (`/proposals/[id]` or `/sales/[id]/proposal`)
and click **Send Proposal**. Confirm the dialog — the email goes out from
`prem@shiroienergy.com` to the customer email on file, with
`svivek.88@gmail.com` on **CC**. The latest PDF is attached as a 30-day signed
download link.

### Why is the Send Proposal button greyed out?
There is no email address on the lead. Go to the lead Details tab and add an
Email, then come back. Hovering the disabled button shows the tooltip
"No email on file for this lead".

### Which Gmail account does the proposal send from?
`prem@shiroienergy.com`. `svivek.88@gmail.com` is CC'd on every send for
audit. There is currently no way to override these addresses from the UI.

### How do I send the customer a shareable proposal link?
On the proposal detail page use "Create Share Link" (F7 portal). It generates
a `/p/<token>` magic link valid for the days you choose; the customer-facing
page shows the proposal summary and a PDF download. The customer can also
click Accept which fires `proposal.accepted_by_customer`.

### Where do I see the customer's WhatsApp number?
On the lead detail page → Contact Info card, the Phone row is the same number
used for WhatsApp. WhatsApp drips are sent to the normalized 10-digit phone via
the `customer_outreach_queue`. There is no separate WhatsApp field.

---

## Pipeline & KPIs

### How is the Pipeline Value calculated?
"Weighted Pipeline" on `/sales` = sum of `(lead.base_quote_price OR fallback
estimate) × close_probability` for every non-terminal lead. Numbers come from
the `get_pipeline_summary()` RPC, cached for 300s. Never aggregated in JS.

### What does the Closing This Week card count?
Active leads (not won/lost/disqualified) whose `expected_close_date` falls in
the current ISO week. The card stacks three numbers: lead count + total kWp +
total ₹ value. Click the card to filter `/sales` to those leads.

### What does the Expected Orders card on the dashboard show?
Leads in any of `quick_quote_sent`, `detailed_proposal_sent`,
`design_confirmed`, `negotiation`, `closure_soon` whose `expected_close_date`
is inside the window. Sourced from the `get_expected_orders(window_days)`
RPC. mig 109 widened the status filter.

### Can I bulk-update lead statuses?
Yes. On `/sales`, tick the checkboxes on the rows you want, then use
BulkActionBar → **Change Status**. `bulkChangeLeadStatus` reports the actual
updated count via toast — if RLS blocked some rows you will see a
partial-update count.

### How do I filter /sales by multiple statuses at once?
Click the "All Statuses (N)" pill to open FilterMultiSelect and tick the
statuses you want — the URL becomes `/sales?status=new,contacted,negotiation`.
`getLeads` accepts a `LeadStatus[]` so the filter is server-side.

### How do I filter /sales by kWp range?
Use the FilterRange pill labelled "Size (kWp)". Set Min and Max — the URL
becomes `/sales?kwpMin=5&kwpMax=15`. Backed by the
`idx_leads_estimated_size_kwp` index.

### How do I filter /sales by close-date range?
Use the FilterRange pill labelled "Closing". Pick a From and To date — the URL
becomes `/sales?closeFrom=2026-05-20&closeTo=2026-06-30`.

### How do I filter /sales by referrer?
Use the FilterMultiSelect pill labelled "Referrer". Pick a specific partner
(`/sales?referrer=<channel_partner_id>`) or pick "All internal" to get every
lead attributed to Vivek or Management Referral
(`/sales?referrer=internal_all`).

---

## Where to dig deeper

- `docs/modules/sales.md` — module reference with every business rule and table
- `/ask` — in-ERP AI assistant (this document is one of its sources)
- `/sales/patterns` — sales intelligence and AI insight
- `apps/erp/src/lib/leads-helpers.ts` — single source of truth for stage labels
  and default probabilities

---

*Last regenerated alongside `scripts/seed-marketing-training.ts` and
`scripts/seed-marketing-faq.ts`. Update all three together when content drifts.*
