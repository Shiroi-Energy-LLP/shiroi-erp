# n8n workflow audit — May 20, 2026

**Status:** All 31 workflows on the droplet are **paused** as of 2026-05-20 11:30 IST. Re-activation pending per-workflow approval after volume estimates below.

**Context:** Meta WhatsApp Cloud API entered silent anti-spam throttle around May 17 because daily digest workflows were sending the *same* digest text 27–760 times in a burst each morning (executeOnce was false on every Send WhatsApp node). API kept returning `accepted` with valid wamids while Meta dropped the actual delivery — invisible from outside. See `CHANGELOG.md` entry for 2026-05-20.

**Fix shipped (paused, not yet active):** `executeOnce: true` added to all 17 Send WhatsApp nodes in workflows #19–#28. After fix, each digest sends exactly one message per intended recipient instead of N (where N = number of source rows). Workflows #03 and #08 were already correctly per-recipient / pre-aggregated and were not touched.

---

## Pre-fix vs post-fix volumes (today morning, 2026-05-20 08:00 IST)

| WF | Pre-fix wamids sent today | Post-fix expected |
|----|---------------------------|-------------------|
| 20 Sales head | **760** (1 per stale lead × Sales head's phone) | 1 |
| 24 Finance head | **54** (27 invoices × 2 sends, then crashed) | 2 |
| 25 O&M head | 4 (2 tickets × 2 sends) | 2 |
| 21 Design head | 4 (4 items × 1 send) | 1 |
| 23 Purchase head | 1 | 1 |
| 22, 26, 27 | 0 (no items today) | 1–2 each |

The 760 + 54 burst is exactly the pattern that triggers Meta's silent throttle.

---

## Full audit — all 33 workflows + daily message volume estimate

Volume = average messages per day **post-fix**, on a typical business day.
"Risk" = burst risk to Meta delivery throttle.

| ID | Workflow | Trigger | Recipients | Msgs/day | Risk | Re-enable? |
|----|----------|---------|------------|----------|------|------------|
| **Routers / handlers** | | | | | | |
| 00 | Event Bus Router | webhook | — (router) | 0 | none | — |
| 55 | Global Error Handler | error trigger | Vivek, Vinodh | 0–5 | low | — |
| **Event-driven (Tier 1 webhooks)** | | | | | | |
| 01 | Bug report | webhook (Settings form) | Vivek | 0–2 | low | — |
| 02 | Lead created | ERP event | Sales head | 5–15 | low | — |
| 04 | Proposal requested | ERP event | Design head | 2–5 | low | — |
| 05 | Proposal submitted | ERP event | Sales head | 2–3 | low | — |
| 06 | Proposal approved | ERP event | Projects head | 2–3 | low | — |
| 07 | Purchase order approved | ERP event | Purchase head, Finance head | 3–10 | low | — |
| 09 | GRN recorded | ERP event | Purchase head, Projects head | 3–6 | low | — |
| 10 | Installation scheduled | ERP event | Projects head, O&M head | 2–4 | low | — |
| 11 | Installation complete | ERP event | O&M head, Finance head | 2–4 | low | — |
| 12 | CEIG approval received | ERP event | Liaison head, Projects head | 0–2 | low | — |
| 13 | Project commissioned | ERP event | Vivek, Finance head | 0–1 | low | — |
| 14 | Customer payment received | ERP event | Finance head | 3–6 | low | — |
| 15 | O&M ticket created | ERP event | O&M head | 3–6 | low | — |
| 16 | Expense submitted | ERP event | Finance head | 5–15 | low | — |
| 17 | Leave request submitted | ERP event | HR head | 1–3 | low | — |
| 18 | Employee created | ERP event | HR head, Vivek | 0–1/week | none | — |
| **Cron-driven (Tier 2 digests)** | | | | | | |
| 03 | Lead stale >24h | daily 09:00 IST | per-assignee fan-out | 0–5 | low | — |
| 08 | Vendor payment due (7d) | daily 09:00 IST | Finance, Vinodh, Sridhar (3 parallel) | 3 | low | — |
| 19 | Vivek daily 7AM digest | daily 07:00 IST | Vivek, Vinodh, Sridhar (3 parallel) | 3 | low | **CANARY** ★ |
| 20 | Sales head daily 8AM | daily 08:00 IST | Sales head | 1 | low | — |
| 21 | Design head daily 8AM | daily 08:00 IST | Design head | 1 | low | — |
| 22 | Projects head daily 8AM | daily 08:00 IST | Projects head | 1 | low | — |
| 23 | Purchase head daily 8AM | daily 08:00 IST | Purchase head | 1 | low | — |
| 24 | Finance head daily 8AM | daily 08:00 IST | Finance head (= Vivek), Vinodh | 2 | low | — |
| 25 | O&M head daily 8AM | daily 08:00 IST | O&M head (= Vivek), Vinodh | 2 | low | — |
| 26 | Liaison head daily 8AM | daily 08:00 IST | Liaison head | 1 | low | — |
| 27 | HR head daily 8AM | daily 08:00 IST | HR head (= Vivek), Vinodh | 2 | low | — |
| 28 | Vivek weekly Monday 8AM | weekly Mon 08:00 IST | Vivek, Vinodh, Sridhar | 3/week | none | — |
| **Heartbeat / system** | | | | | | |
| 56 | Droplet heartbeat | daily 09:00 IST | Vivek | 1 | low | **CANARY** ★ |
| **Inactive (already)** | | | | | | |
| 29 | Drive folder create (scaffold) | webhook | — | — | none | (was already inactive) |
| 58 | Sentry P0/P1 forwarder | webhook | — | — | none | (was already inactive) |

---

## Totals

**All workflows active, post-fix:** ~50–80 messages/day across ~10 unique recipient phone numbers.

Compare to:
- Meta unverified tier limit: 250 **unique recipients** per rolling 24h (we send to ~10).
- Meta burst rate limit: 80 msgs/sec sustained (we'd average ~1/minute — 100× under).
- Pre-fix today: 800+ messages in 30 seconds at 08:00 IST → silent throttle activated.

---

## Recommended re-activation sequence

**Phase 1 — Canary (24h):** Activate only:
- **#56 Droplet heartbeat** → 1 msg to Vivek @ 09:00 IST tomorrow. Cleanest possible signal.
- **#19 Vivek daily 7AM digest** → 3 msgs (Vivek + Vinodh + Sridhar) @ 07:00 IST tomorrow.

If both arrive on phones tomorrow → Meta throttle has lifted AND the executeOnce fix works.
Total Phase 1 volume: **4 messages/day**.

**Phase 2 — Department digests (after Phase 1 confirmed working, +24h):** Activate #20–#27.
Additional volume: ~12 messages/day at 08:00 IST.
Total Phase 1+2: ~16 messages/day.

**Phase 3 — Cron jobs (after Phase 2 confirmed, +24h):** Activate #03, #08, #28, #55.
Additional volume: ~5–10 messages/day spread across the day.

**Phase 4 — Event-driven (after Phase 3 confirmed, +24h):** Activate #00, #01, #02, #04–#07, #09–#18.
Additional volume: ~30–50 messages/day depending on ERP activity.

Total Phase 1+2+3+4 = full restoration = ~50–80 messages/day.

---

## Audit trail

- 2026-05-20 11:30 IST — All 31 active workflows paused via n8n REST API (this doc).
- 2026-05-20 12:00 IST — Fixed 17 Send WhatsApp nodes (executeOnce:true) in workflows #19–#28 via `scripts/fix-n8n-whatsapp-execute-once.ts`.
- 2026-05-20 12:05 IST — Pushed fixed workflows to droplet via `scripts/push-n8n-workflows.ts` (workflows remain paused).
- _Awaiting user approval to start Phase 1 canary activation._
