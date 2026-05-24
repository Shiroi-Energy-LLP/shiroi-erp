# WhatsApp message template catalog

Every outbound-initiated WhatsApp message (scheduled notifications, customer nudges, digests) needs a Meta-approved template. This file is the submission-ready catalog — copy each body verbatim into Meta Business Manager → WhatsApp Manager → Message Templates → Create Template.

## Submission guide

1. **Category matters.** Meta separates templates into three categories with different pricing and review stringency:
   - **Authentication** — OTPs, 2FA. Not used by Shiroi.
   - **Utility** — transactional confirmations tied to a real action (order confirm, payment receipt, appointment reminder, handoff). Low friction to approve.
   - **Marketing** — promotional offers, renewals, re-engagement. Stricter review, opt-out required, higher conversation cost.
2. **Parameters** — use `{{1}}`, `{{2}}`, `{{3}}` etc. for dynamic fields. Meta reviews the *template*, not the final message. Keep samples realistic.
3. **Language** — submit in English (`en`) first. Hindi/Tamil variants can follow once English is approved.
4. **Review time** — 1–24 hours typical. Rejected templates can be appealed with edits.
5. **Header/footer/buttons** — optional but helpful. Buttons must be URL or quick-reply — no inline actions.

## Naming convention

`shiroi_<audience>_<purpose>` lowercase snake_case. Meta enforces lowercase + underscores only.

Audiences: `emp` (employee), `cust` (customer), `vendor`, `digest`.

---

## Internal / employee-facing (UTILITY)

### `shiroi_emp_lead_assigned`

**Category:** Utility
**Purpose:** New lead routed to a salesperson. Fires from Tier 1 #2.

**Header (text):** New lead — {{1}}

**Body:**
```
Hi {{1}}, a new lead has been assigned to you.

Customer: {{2}}
Phone: {{3}}
Source: {{4}}
Size estimate: {{5}} kWp

Please call within 30 minutes — conversion drops ~40% after the first hour of silence.
```

**Footer:** Shiroi Energy · CRM handoff

**Buttons:**
- URL: `Open lead` → `https://erp.shiroienergy.com/leads/{{1}}`

**Example variables:**
1. Ravi Kumar (salesperson)
2. Anita Iyer (lead)
3. 98765 43210
4. Website form
5. 8

---

### `shiroi_emp_lead_stale`

**Category:** Utility
**Purpose:** Reminder when a lead hasn't moved in 24h. Tier 1 #3 / Tier 2 #20.

**Body:**
```
Lead needs attention.

{{1}} — no status change for {{2}} hours.
Last status: {{3}}

Take action today or move to on_hold / disqualified if no longer active.
```

**Buttons:**
- URL: `Open lead` → `https://erp.shiroienergy.com/leads/{{1}}`

---

### `shiroi_emp_proposal_approved_pm`

**Category:** Utility
**Purpose:** Proposal approved by customer → PM handoff. Tier 1 #6.

**Body:**
```
Proposal approved — {{1}}.

Size: {{2}} kWp
Value: {{3}}

Next steps for you (PM):
1. Share payment schedule within 24h
2. Schedule kickoff call this week
3. Confirm site readiness date

Finance has been notified to raise the advance invoice.
```

**Buttons:**
- URL: `Open project` → `https://erp.shiroienergy.com/projects/{{1}}`

---

### `shiroi_emp_proposal_approved_finance`

**Category:** Utility
**Purpose:** Proposal approved → Finance raises advance invoice. Tier 1 #6.

**Body:**
```
Invoice kickoff — {{1}}.

Size: {{2}} kWp
Contract value: {{3}}
PM: {{4}}

Please raise Milestone 1 (advance) invoice within 48h and send to the customer.
```

**Buttons:**
- URL: `Raise invoice` → `https://erp.shiroienergy.com/projects/{{1}}/invoices/new`

---

### `shiroi_emp_po_created`

**Category:** Utility
**Purpose:** New PO fired to purchase head + finance. Tier 1 #7.

**Body:**
```
New PO created.

PO: {{1}}
Vendor: {{2}}
Amount: {{3}}
Project: {{4}}
Raised by: {{5}}

Please verify and process payment terms.
```

**Buttons:**
- URL: `Open PO` → `https://erp.shiroienergy.com/purchase-orders/{{1}}`

---

### `shiroi_emp_grn_recorded`

**Category:** Utility
**Purpose:** GRN logged → finance posts the bill. Tier 1 #9.

**Body:**
```
GRN recorded.

GRN: {{1}}
PO: {{2}}
Vendor: {{3}}
Value: {{4}}
Received by: {{5}}

Bill posting + payment scheduling is yours.
```

---

### `shiroi_emp_install_scheduled`

**Category:** Utility
**Purpose:** Install crew roll-call. Tier 1 #10.

**Body:**
```
Installation scheduled — {{1}}.

Date: {{2}}
Site: {{3}}
Size: {{4}} kWp
Site supervisor: {{5}}

Materials check: confirm BOQ readiness by end of day before install.
```

**Buttons:**
- URL: `Open project` → `https://erp.shiroienergy.com/projects/{{1}}`

---

### `shiroi_emp_expense_pending`

**Category:** Utility
**Purpose:** Expense claim awaiting manager approval. Tier 1 #16.

**Body:**
```
Expense claim awaiting approval.

From: {{1}}
Amount: {{2}}
Category: {{3}}
Project: {{4}}
Purpose: {{5}}

Reimbursement cutoff: 1st & 15th of month.
```

**Buttons:**
- URL: `Review + approve` → `https://erp.shiroienergy.com/expenses/{{1}}`

---

### `shiroi_emp_leave_pending`

**Category:** Utility
**Purpose:** Leave request awaiting manager approval. Tier 1 #17.

**Body:**
```
Leave request awaiting approval.

From: {{1}}
Type: {{2}}
Dates: {{3}} → {{4}}
Reason: {{5}}

Approve before {{6}} or leave will auto-escalate.
```

**Buttons:**
- URL: `Review` → `https://erp.shiroienergy.com/hr/leave/{{1}}`

---

### `shiroi_emp_proposal_requested`

**Category:** Utility
**Purpose:** Sales requests a proposal → design team notified. Tier 1 #4.

**Body:**
```
New proposal request — {{1}}.

Customer: {{2}}
Size estimate: {{3}} kWp
City: {{4}}
Requested by: {{5}}

Design target: first draft within 24h.
```

**Buttons:**
- URL: `Open in design` → `https://erp.shiroienergy.com/design/{{1}}`

---

### `shiroi_emp_proposal_submitted`

**Category:** Utility
**Purpose:** Design submits proposal → sales notified. Tier 1 #5.

**Body:**
```
Proposal ready for review — {{1}}.

Customer: {{2}}
Size: {{3}} kWp
Quote: {{4}}
Prepared by: {{5}}

Send to customer today.
```

**Buttons:**
- URL: `Open proposal` → `https://erp.shiroienergy.com/proposals/{{1}}`

---

### `shiroi_emp_po_approved`

**Category:** Utility
**Purpose:** PO cleared founder approval → PE / finance can dispatch + pay. Tier 1 #7.
Distinct from `shiroi_emp_po_created` above — that fires on PO draft creation; this one fires post-approval.

**Body:**
```
PO approved ✅

PO: {{1}}
Vendor: {{2}}{{3}}
Amount: {{4}}
Project: {{5}}

Dispatch: place the order with the vendor.
Finance: schedule payment per terms.
```

**Example variable 3:** ` 🔔MSME` (interpolated inline when `vendor_is_msme` is true; empty string otherwise)

**Buttons:**
- URL: `Open PO` → `https://erp.shiroienergy.com/procurement/{{1}}`

---

### `shiroi_emp_vendor_payment_due`

**Category:** Utility
**Purpose:** Vendor PO with payment due in ≤7 days. Tier 1 #8 (cron).

**Body:**
```
Vendor payment due — {{1}}.

PO: {{2}}
Outstanding: {{3}}
Due: {{4}} (in {{5}} days){{6}}{{7}}

Please schedule or flag if disputed.
```

**Example variable 6:** `\n🔔 MSME — 45-day statutory window applies.` (empty when not MSME)
**Example variable 7:** `\n🚨 High value (>₹5L) — Vivek cc'd.` (empty when ≤₹5L)

**Buttons:**
- URL: `Open PO` → `https://erp.shiroienergy.com/procurement/{{1}}`

---

### `shiroi_emp_install_complete`

**Category:** Utility
**Purpose:** Internal notification — install work finished, liaison can start CEIG. Tier 1 #11.
Distinct from the customer-facing `shiroi_cust_install_complete`.

**Body:**
```
Installation finished — {{1}}.

Size: {{2}} kWp
Site supervisor: {{3}}
QC status: {{4}}

Next: liaison team to file CEIG application within 48h.
```

**Buttons:**
- URL: `Open project` → `https://erp.shiroienergy.com/projects/{{1}}`

---

### `shiroi_emp_ceig_approval`

**Category:** Utility
**Purpose:** CEIG approval received → PM schedules commissioning. Tier 1 #12.

**Body:**
```
CEIG approval received ✅

Project: {{1}}
Customer: {{2}}
Approval no: {{3}}
Dated: {{4}}

Schedule commissioning + meter installation this week.
```

**Buttons:**
- URL: `Open project` → `https://erp.shiroienergy.com/projects/{{1}}`

---

### `shiroi_emp_customer_payment`

**Category:** Utility
**Purpose:** Customer payment landed → finance (receipt), PM (visibility), salesperson (commission when closure). Tier 1 #14.
One template, three audiences — the calling workflow sets `{{1}}` to the recipient's role phrasing.

**Body:**
```
Payment received — {{1}}.

Customer: {{2}}
Amount: {{3}}{{4}}
Receipt: {{5}}
Project: {{6}}

{{7}}
```

**Example variable 4:** ` (advance)` when `is_advance=true`, else empty
**Example variable 7:** Finance → "GST invoice copy queued to customer." / PM → "Keep delivery timeline intact." / Salesperson → "Commission released on final milestone."

**Buttons:**
- URL: `Open payment` → `https://erp.shiroienergy.com/payments/{{1}}`

---

### `shiroi_emp_om_ticket_assigned`

**Category:** Utility
**Purpose:** New service ticket → O&M assignee. Tier 1 #15.

**Body:**
```
New service ticket — {{1}}.

Ticket: {{2}}
Severity: {{3}}
Customer: {{4}}
Plant: {{5}} kWp
SLA: {{6}}

Acknowledge within 1h.
```

**Buttons:**
- URL: `Open ticket` → `https://erp.shiroienergy.com/om/tickets/{{1}}`

---

### `shiroi_emp_employee_onboarded`

**Category:** Utility
**Purpose:** New-hire fan-out to HR + IT. Tier 1 #18.
Unified template — `{{1}}` framing ("Welcome aboard" / "Setup requested") sets the audience.

**Body:**
```
{{1}} — {{2}}.

Employee code: {{3}}
Department: {{4}}
Designation: {{5}}
Reporting to: {{6}}
Start date: {{7}}

{{8}}
```

**Example variable 1:** `Welcome aboard` (HR) / `IT setup requested` (IT)
**Example variable 8:** HR → "Prepare onboarding kit + payroll setup." / IT → "Create Gmail + Supabase account + laptop allocation by start date."

**Buttons:**
- URL: `Open employee` → `https://erp.shiroienergy.com/hr/{{1}}`

---

### `shiroi_infra_alert`

**Category:** Utility
**Purpose:** Infrastructure alerts (droplet health ≥85%, Sentry P0/P1). Tier 6 #56 + #58.
Kept unified because Meta template quota is finite and the shape is identical across source.

**Body:**
```
🚨 {{1}} — {{2}}

{{3}}

Time: {{4}}
{{5}}
```

**Example variable 1:** `Droplet health` / `Sentry FATAL` / `Sentry ERROR`
**Example variable 2:** `n8n.shiroienergy.com` / Sentry project slug
**Example variable 3:** Free-form body — CPU/mem/disk percentages, or Sentry title + culprit
**Example variable 5:** Action link — SSH command or Sentry issue URL

---

### `shiroi_digest_morning`

**Category:** Utility
**Purpose:** Generic morning digest template. Tier 2 #19–#28.
Each role uses the same template with a different variable payload — keeps template count low.

**Body:**
```
Good morning {{1}},

Your {{2}} digest for {{3}}:

{{4}}

Check the ERP for the full breakdown: https://erp.shiroienergy.com
```

**Example variables:**
1. Vivek
2. Founder
3. 19 Apr 2026
4. (rendered summary text — newlines supported as `\n` in API payload)

**Note:** Body text with embedded newlines in `{{4}}` passes review because the variable is opaque to Meta at template time. Keep the framing message stable.

---

## Customer-facing (UTILITY)

### `shiroi_cust_proposal_welcome`

**Category:** Utility
**Purpose:** Welcome sent right after proposal approval. Tier 4 #38.

**Header (text):** Welcome to Shiroi Energy ☀️

**Body:**
```
Hi {{1}},

Thank you for choosing Shiroi Energy for your {{2}} kWp solar installation.

Your project manager is {{3}} — reachable at {{4}}. They'll contact you within 24 hours to walk through the timeline and next steps.

You can track progress anytime at {{5}}.
```

**Footer:** Shiroi Energy LLP · Chennai

---

### `shiroi_cust_install_scheduled`

**Category:** Utility
**Purpose:** Confirms install date to customer. Tier 4 #41/#42.

**Body:**
```
Hi {{1}},

Your solar installation is scheduled for {{2}}.

Our team lead {{3}} ({{4}}) will arrive with the crew and materials by 8 AM.

Please ensure:
• Rooftop is accessible
• Electrician available for 1h on connection day
• Someone 18+ onsite to sign handover

Contact: {{5}}
```

---

### `shiroi_cust_install_complete`

**Category:** Utility
**Purpose:** Installation done, CEIG ETA. Tier 4 #43.

**Body:**
```
Hi {{1}},

Your {{2}} kWp system is installed ✅

Next: CEIG (electrical inspector) approval — typically {{3}} working days. We file the paperwork, you don't need to do anything.

Once approved, we'll commission the plant and you'll start seeing generation on your portal.
```

---

### `shiroi_cust_commissioning_done`

**Category:** Utility
**Purpose:** Plant live. Tier 4 #44. Referenced in workflow 13-project-commissioned.

**Header (text):** Your solar plant is live 🎉

**Body:**
```
Hi {{1}}, your {{2}} kWp rooftop plant was commissioned on {{3}}.

Starting today:
• Clean energy + savings begin
• Track generation 24×7 at {{4}}
• Our O&M team monitors your inverter remotely
• AMC cover starts now — 1 year standard

Final invoice of {{5}} will arrive within 24 hours.

Thank you for choosing Shiroi Energy.
```

**Footer:** Shiroi Energy LLP

**Buttons:**
- URL: `Open portal` → `{{1}}`

---

### `shiroi_cust_payment_receipt`

**Category:** Utility
**Purpose:** Payment confirmation. Tier 4 #48.

**Body:**
```
Hi {{1}},

Payment of {{2}} received on {{3}} — thank you.

Receipt no: {{4}}
Towards: {{5}} (project {{6}})

A GST invoice copy will be emailed to {{7}} within 24 hours.
```

---

### `shiroi_cust_invoice_reminder`

**Category:** Utility
**Purpose:** Gentle nudge on overdue invoice. Tier 3 #31.
Use sparingly — repeat sends to unresponsive customers trigger Meta spam heuristics.

**Body:**
```
Hi {{1}},

Friendly reminder — invoice {{2}} ({{3}}) was due on {{4}} and is {{5}} days overdue.

If payment is in transit, please ignore this message. Otherwise, please settle at your earliest.

For questions: {{6}}
```

---

## Customer-facing (MARKETING)

Marketing templates face stricter review — expect 24–48h and a higher rejection rate. Opt-out language is required.

### `shiroi_cust_amc_renewal`

**Category:** Marketing
**Purpose:** AMC renewal offer. Tier 4 #46.

**Body:**
```
Hi {{1}},

Your Shiroi Energy AMC for the {{2}} kWp plant at {{3}} renews on {{4}}.

Renewing now (30+ days early) unlocks:
• {{5}}% early-bird discount
• 2 extra preventive maintenance visits
• Priority response SLA (24h → 8h)

Reply YES to renew, or STOP to opt out of Shiroi marketing messages.
```

**Footer:** Reply STOP to opt out

---

### `shiroi_cust_review_request`

**Category:** Marketing
**Purpose:** Google review nudge, 30d post-commissioning. Tier 4 #47.

**Body:**
```
Hi {{1}},

It's been a month since your solar plant was commissioned. Hope you're enjoying the savings ☀️

If you have 30 seconds, a Google review helps other homeowners find Shiroi Energy: {{2}}

Reply STOP to opt out of Shiroi messages.
```

**Footer:** Reply STOP to opt out

---

### `shiroi_cust_birthday`

**Category:** Marketing
**Purpose:** Customer birthday wishes from Vivek. Tier 4 #49.

**Body:**
```
Hi {{1}}, wishing you a wonderful birthday from everyone at Shiroi Energy!

May the year ahead bring you as much energy as your rooftop plant generates ☀️

— Vivek & the Shiroi team

Reply STOP to opt out of Shiroi messages.
```

**Footer:** Reply STOP to opt out

---

## Submission workflow

1. Open [Meta Business Manager](https://business.facebook.com/) → WhatsApp Manager → your WABA → Message Templates.
2. For each template above: **Create template** → paste category, name, body, footer, buttons exactly as written.
3. Submit all UTILITY templates first — they approve fastest and unblock Tier 1 rollout.
4. Submit MARKETING templates last, in batches of 3–5, to avoid triggering Meta's "mass spam attempt" heuristics on a new WABA.
5. Track approval status in this file by flipping a row header (e.g., append `— APPROVED 2026-04-22` next to the name).

## Variables pass-through in n8n

When sending via the WhatsApp Business API (Meta Cloud), the request body looks like:

```json
{
  "messaging_product": "whatsapp",
  "to": "91{{phone_without_plus}}",
  "type": "template",
  "template": {
    "name": "shiroi_emp_lead_assigned",
    "language": { "code": "en" },
    "components": [
      { "type": "header", "parameters": [{ "type": "text", "text": "Anita Iyer" }] },
      { "type": "body", "parameters": [
        { "type": "text", "text": "Ravi Kumar" },
        { "type": "text", "text": "Anita Iyer" },
        { "type": "text", "text": "98765 43210" },
        { "type": "text", "text": "Website form" },
        { "type": "text", "text": "8" }
      ]},
      { "type": "button", "sub_type": "url", "index": "0", "parameters": [{ "type": "text", "text": "abc-uuid" }] }
    ]
  }
}
```

The position of `{{1}}`, `{{2}}`… in the template body corresponds to the order of `parameters` in the `body` component.

---

## Customer-facing (UTILITY) — Phase F1

> All 8 templates below are **PENDING Meta approval**. Submit to Meta Business Manager → WhatsApp Manager → Message Templates after F2 (Meta Business Verification) is complete.

### `shiroi_cust_proposal_ready`

**Category:** Utility
**Purpose:** Proposal sent to customer. Fired by n8n workflow 40 on `proposal.sent_to_customer` event.
**Status:** PENDING APPROVAL

**Body:**
```
Hi {{1}}, your solar proposal for {{2}} kWp is ready to view.

Proposal link: {{3}}

Questions? Reply here and we'll get back to you right away.
```

**Footer:** Shiroi Energy · Chennai

**Example variables:**
1. Anita Iyer
2. 8
3. https://erp.shiroienergy.com/p/abc123token

---

### `shiroi_cust_order_received`

**Category:** Utility
**Purpose:** Order confirmed / lead won. Welcome message with PM details. Fired by workflow 41 on `lead.won`.
**Status:** PENDING APPROVAL

**Body:**
```
Welcome to the Shiroi family, {{1}}!

Your solar installation begins on {{2}}. Your dedicated Project Manager is {{3}} ({{4}}).

Feel free to reach out to them directly for any on-site queries.
```

**Footer:** Shiroi Energy · Solar EPC

**Example variables:**
1. Anita Iyer
2. 15 Jun 2026
3. Ravi Kumar
4. 98765 43210

---

### `shiroi_cust_net_metering_applied`

**Category:** Utility
**Purpose:** Net metering application submitted to TNEB/DISCOM. Fired by workflow 42 on `net_metering.application_submitted`.
**Status:** PENDING APPROVAL

**Body:**
```
Hi {{1}}, your net metering application has been submitted to the utility.

Typical approval time: 30 days. We'll update you at each milestone — application received, inspection scheduled, meter installation.

No action needed from your side right now.
```

**Footer:** Shiroi Energy

**Example variables:**
1. Anita Iyer

---

### `shiroi_cust_install_milestone`

**Category:** Utility
**Purpose:** Progress update at each installation milestone (panels mounted, inverter installed, commissioning done). Fired by workflow 43 on `project.milestone_complete`.
**Status:** PENDING APPROVAL

**Body:**
```
Hi {{1}}, great progress on your solar project!

Milestone completed: {{2}}

Next step: {{3}}

We'll keep you updated as work progresses.
```

**Footer:** Shiroi Energy

**Example variables:**
1. Anita Iyer
2. Panels mounted
3. Inverter installation

---

### `shiroi_cust_payment_reminder`

**Category:** Utility
**Purpose:** Friendly payment due reminder. Daily cron (workflow 44) queries payment_schedule for rows due today.
**Status:** PENDING APPROVAL

**Body:**
```
Hi {{1}}, a friendly reminder that ₹{{2}} is due by {{3}} for your solar project ({{4}}).

Pay securely here: {{5}}

If you've already paid, please ignore this message.
```

**Footer:** Shiroi Energy · Finance

**Example variables:**
1. Anita Iyer
2. 1,50,000
3. 30 Jun 2026
4. SHIROI/PRJ/2026/001
5. https://pay.shiroienergy.com/abc123

---

### `shiroi_cust_om_ticket_created`

**Category:** Utility
**Purpose:** Service request acknowledgement. Fired by workflow 45 on `om_ticket.created`.
**Status:** PENDING APPROVAL

**Body:**
```
Hi {{1}}, we've received your service request (Ticket {{2}}).

Our technician {{3}} will visit on {{4}}. They'll call before arriving.

Reply here if you need to reschedule.
```

**Footer:** Shiroi Energy · O&M

**Example variables:**
1. Anita Iyer
2. SVC-042
3. Murugan
4. 25 Jun 2026

---

### `shiroi_cust_annual_checkup`

**Category:** Utility
**Purpose:** Annual solar health check reminder. Monthly cron (workflow 46) finds projects 350–375 days post-commissioning.
**Status:** PENDING APPROVAL

**Body:**
```
Hi {{1}}, it's been a year since your solar system was commissioned — congratulations!

Time for your free annual health check. Book a slot here: {{2}}

This ensures your system is running at peak efficiency and any warranty claims are logged on time.
```

**Footer:** Shiroi Energy · O&M

**Example variables:**
1. Anita Iyer
2. https://erp.shiroienergy.com/om/book

---

### `shiroi_cust_commissioning_complete`

**Category:** Utility
**Purpose:** System commissioned and live. Fired by workflow 47 on `project.commissioned`.
**Status:** PENDING APPROVAL

**Body:**
```
Congratulations, {{1}}! Your {{2}} kWp solar system is now live as of {{3}}.

Track your generation in real time: {{4}}

Thank you for choosing Shiroi Energy. Welcome to clean energy!
```

**Footer:** Shiroi Energy · Chennai

**Buttons:**
- URL: `View monitoring` → `https://erp.shiroienergy.com/monitoring/{{1}}`

**Example variables:**
1. Anita Iyer
2. 8
3. 15 Jun 2026
4. https://erp.shiroienergy.com/monitoring/abc-project-id

---

## Customer-facing (UTILITY) — Phase A4 (Wave 2)

> Template below is **PENDING Meta approval**. Submit after Wave 1 templates are approved.

### `monthly_performance` (utility)

**Category:** Utility
**Purpose:** Monthly solar generation report to commissioned customers. Fired by n8n workflow 65 on the 1st of each month at 10:00 IST.
**Status:** PENDING Meta approval

**Body:**
```
Hi {{1}}! Your {{2}} kWp solar at {{3}} generated {{4}} kWh in {{5}}, saving ~₹{{6}}. {{7}} Full report: {{8}}
```

**Variables:**
1. Customer first name
2. System size in kWp (e.g. `8`)
3. Site city (e.g. `Chennai`)
4. Actual kWh generated (e.g. `1847`)
5. Month name (e.g. `May 2026`)
6. Estimated savings in INR — Indian format, no ₹ symbol (e.g. `14,776`)
7. AI narrative sentence (e.g. `8% better than April. Top day: 15-May.`)
8. Customer portal / dashboard link (e.g. `https://erp.shiroienergy.com/monitoring/abc-project-id`)

**Example:**
```
Hi Anita! Your 8 kWp solar at Chennai generated 1847 kWh in May 2026, saving ~₹14,776. 8% better than April. Top day: 15-May. Full report: https://erp.shiroienergy.com/monitoring/abc-project-id
```

**Footer:** Shiroi Energy · Solar O&M

**Note:** Variable `{{7}}` (AI narrative) is generated by Claude Haiku per customer — it is opaque to Meta at template-review time and passes as a single dynamic slot. Keep the surrounding template text stable to avoid re-review triggers.
