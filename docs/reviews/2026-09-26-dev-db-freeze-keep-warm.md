# Dev DB froze for ~5 h — inverter-poll 522s were a symptom; keep-warm cron removed

**Date:** 2026-09-26 · **Module:** infra (surfaced via O&M plant monitoring) · **Env:** dev (`actqtzoxjilqnldnacqz`, which the live ERP uses)
**Reported as:** WhatsApp alert "n8n workflow failed — 60 — Inverter poll cron … POST inverter-poll Edge Function · The service was not able to process your request · 09:31 IST" — "issues continue" after the 09-25 fix.

---

## 1. What actually happened

Not an inverter-poll bug. The 09-25 fix (`reviews/2026-09-25-inverter-poll-522-alert-flood.md`) held: every poll
from 05:00 to 08:40 IST returned 200 in 1–47 s with the 45 s budget working.

At **03:11:09 UTC (08:41 IST) the whole dev database stopped responding**:

- `postgres_logs` stop mid-cron-job with no error, no FATAL, no shutdown line.
- All REST traffic after that is 522 / 504 (every poll ran ~91 s, then Cloudflare 522).
- `execute_sql` via MCP timed out with "connection timeout".
- The project still reported **`ACTIVE_HEALTHY`**. It did not recover by itself; Vivek restarted it from the
  Dashboard at ~08:00 UTC (13:30 IST). Outage: **~4 h 50 min**, ERP included.

## 2. The last seconds before the freeze

| Signal | Value |
|---|---|
| Morning ERP burst 03:00–03:02 UTC | ~310 req/min, avg origin time 2.0–2.4 s, max 14 s |
| Keep-warm pings (`item_units`) 03:06–03:09 | normal: 165–390 ms, 24/min |
| `inverter_readings` single-row INSERT 03:10:09 / 03:10:32 | **13.0 s / 12.2 s** (normally ~300 ms) |
| Last 8 keep-warm pings at 03:11 | 530–600 s, never answered |
| Postgres errors in the 40 min before | **none** (no OOM, no connection-limit, no statement timeout) |

Multi-second single-row inserts with no Postgres error point to **storage/IO starvation at the instance level**.
The instance is the smallest tier (`max_connections=60`, `shared_buffers≈280 MB`, DB 298 MB). Instance
memory/IO graphs are not reachable via MCP; they are in Dashboard → Reports → Database for 03:00–03:15 UTC.

## 3. Why the keep-warm cron (mig 222) was removed

It was not the direct trigger: its latency stayed normal until the stall began. But it is steady background load
on that small instance (34,560 extra REST calls + 4,320 cron runs/day), and PostgREST's
`Thread killed by timeout manager` count jumped ~9× the day it shipped:

| Day | Timeout-manager errors |
|---|---|
| 09-03 | 297 |
| 09-05 | 240 |
| **09-07: mig 222 applied** | |
| 09-08 | 2,593 |
| 09-18 | 2,312 |
| 09-25 | 1,253 |

A "guarded" keep-warm (skip while pings are pending) would send the same traffic in normal operation, so it
was removed rather than tuned.

**Actions:**
1. 08:03 UTC: job paused (`cron.alter_job(8, active := false)`).
2. **Mig 223** applied to dev: unschedules `postgrest-keep-warm`, drops `public.postgrest_keep_warm(int)`.
   Keeps `purge-cron-run-details` and the Vault secrets.

**Trade-off accepted:** cold-pool latency returns (first request after >30 s idle ≈ 0.9 s; 10-query tab burst
1.2–3.6 s instead of 0.45–0.76 s). The durable fix for both speed and headroom is a larger compute tier
(`reviews/2026-07-19-erp-speed-full-report.md` §6 option (a), "DB Small"), not synthetic traffic.

## 4. State at hand-off (08:06 UTC)

- Postgres up (restart 08:00:33 UTC), 13–16 connections, mig 223 applied, keep-warm gone.
- **REST layer was still returning 503 / 521 at 08:02–08:05 UTC** after the restart, so the 08:05 poll failed
  with `521: Web server is down`. Not yet confirmed recovered: check that polls return 200 and the ERP loads.
  If REST stays down, restart again (Dashboard → Project Settings → General → Restart project) or open a Supabase
  support ticket citing the ACTIVE_HEALTHY-while-frozen state and Cloudflare Ray `a40f1a10687fda6e`.

## 5. Open follow-ups

- Read Dashboard → Reports → Database (memory, CPU, disk IO budget) for 03:00–03:15 UTC to confirm IO starvation.
- Decide on a compute upgrade (Micro → Small), which covers both this outage risk and the cold-pool latency.
- Consider an external uptime check on `/rest/v1/` so a frozen-but-"healthy" DB alerts directly, not only via
  the inverter-poll workflow.
