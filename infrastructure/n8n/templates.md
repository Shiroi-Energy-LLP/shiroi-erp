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
