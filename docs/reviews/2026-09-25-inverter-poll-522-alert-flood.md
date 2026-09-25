# Inverter-poll WhatsApp alert flood — Cloudflare 522 from an undeployed timeout guard

**Date:** 2026-09-25 · **Module:** O&M (plant monitoring) · **Env:** dev only (`actqtzoxjilqnldnacqz`)
**Reported as:** "check the whatsapp messages. polling seems to have an error constantly."

---

## 1. Symptom, measured

Workflow **60 — Inverter poll cron** (`s8fR9YlNxvtouRfr`) has `errorWorkflow: 8v9P5gxXqPfYNWOp`
= **55 — Global Error Handler**, which sends the WhatsApp alert. One alert per failed cycle:

| Day | Alerts fired (wf 55 executions) | Poll cycles: err / ok | Fail rate |
|-----|--------------------------------|-----------------------|-----------|
| 2026-09-12 → 09-15 | 1–2/day (baseline, unrelated) | 0–1 / 180 | 0–1% |
| 2026-09-16 | 20 | 19 / 161 | 11% |
| 2026-09-19 | 51 | 48 / 132 | 27% |
| 2026-09-22 | 79 | 78 / 102 | 43% |
| 2026-09-25 | **76** | 75 / 105 | **42%** |

Not a new alerting bug — the alerts were correct. Polling really was failing ~42% of cycles.

**Data actually lost** (`inverter_readings`, 37-inverter fleet):

| Day | Readings | vs healthy |
|-----|---------|-----------|
| 2026-09-12 … 09-14 | 3,137–3,145 | baseline |
| 2026-09-25 | **1,705** | **−46%** |

All 37 inverters still returned *something* every day, so this was reading **density** loss
(gaps inside the day), not blind inverters — which is why it never showed up as an offline alert.

## 2. Root cause

Two error signatures, both the same underlying cause:

| Signature | Count (last 25 failures) | What it is |
|-----------|--------------------------|------------|
| `500` + Cloudflare HTML `Error 522 Connection timed out`, exec **90.9–91.8 s** | 9 | Cloudflare (in front of `*.supabase.co`) aborts the origin connection at ~91 s. Function is still running; n8n records HTTP 500. |
| `ECONNABORTED` at exactly **120.0 s** | 15 | The function outlived n8n's own HTTP-node timeout (`timeout: 120000`). |
| `500` `Could not query the database for the schema cache. Retrying.` | 1 | Unrelated transient PostgREST blip. Left alone. |

The deployed `inverter-poll` was **version 12, deployed 2026-06-09**. Commit **4017a73
(2026-06-10)** — *"fix(om): inverter-poll per-fetch timeout + wall-clock budget (salvage PR #5)"* —
added the two guards that prevent exactly this failure, and **was never deployed**. Diff of
deployed v12 vs repo was *only* those guards:

- `FETCH_TIMEOUT_MS = 10_000` — `AbortController` cap on every vendor call. Deno's `fetch` never
  times out on its own, so a vendor endpoint that accepts the connection and never answers blocked
  the whole sequential batch indefinitely → the 120 s `ECONNABORTED` signature.
- `POLL_BUDGET_MS` — stop *starting* new inverters once the wall-clock budget is spent; deferred
  inverters keep their old `last_poll_at`, sort first next cycle (`.order('last_poll_at')`), and
  get picked up 5 min later. Without it, every cycle tried all 37 due inverters in one invocation
  (~80–91 s of vendor round-trips) → the 522 signature.

**Why it started 2026-09-16 and not in June.** Cycle duration was *not* creeping up — success p50
held at 54–60 s every day from 09-11 to 09-25. The fleet did not grow either (37 since 2026-06-05).
What matters is that ~80–91 s of work sat directly on a ~91 s ceiling: **dusk cycles finish in
~55 s and pass, daytime cycles need >91 s and 522**. So failures arrive in long contiguous daylight
blocks rather than scattered — on 09-25 every work-cycle from **09:31 to 15:21 IST** died at
90.9–91.8 s, then everything from 15:26 onward passed at 53–62 s. Vendor-side latency drift through
mid-September was enough to push the daylight window over the line.

## 3. Fix

1. **Deployed the repo version** → `inverter-poll` **v13**, `verify_jwt` still `false`
   (the function does its own `Authorization: Bearer <SERVICE_ROLE_KEY>` check; `true` would 401 the cron).
2. **`POLL_BUDGET_MS` 30_000 → 45_000.** The original constant was chosen against n8n's 120 s node
   timeout, but that is *not* the binding ceiling — Cloudflare's ~91 s is, and it sits *below* it.
   45 s budget + worst-case tail (≤3 capped fetches ≈ 30 s, plus a few DB calls) ≈ 75 s, leaving
   ~16 s of headroom under 522.

Deployed via **Supabase CLI + the `shiroi-erp-mgmt` PAT** —
`supabase functions deploy inverter-poll --project-ref <ref> --no-verify-jwt` with
`SUPABASE_ACCESS_TOKEN` exported from `.env.local`. This works; the old "CLI is 403-locked, deploy
via MCP" note in `docs/modules/om.md` was about the stale `supabase login` token and is now corrected.

## 4. Verification

Two manual invocations, same request shape as the cron (20:51 and 20:53 IST):

```
POST /functions/v1/inverter-poll → 200 in 48.3s  {due:37, processed:11, succeeded:11, failed:0, deferred:26, duration_ms:45472}
POST /functions/v1/inverter-poll → 200 in 32.3s  {due:26, processed:26, succeeded:26, failed:0, deferred:0,  duration_ms:31712}
```

- Budget honoured (45.5 s then stop), both well under the 91 s ceiling, **zero failures**.
- Deferral rotates correctly: slice 1 = 11 inverters (it pays the per-cycle fixed costs — Growatt
  legacy logins, Sungrow login, FIMER auth), slice 2 = the remaining 26 at ~1.2 s each.
- **All 37** `inverters.last_poll_at` refreshed across the two cycles → full fleet swept in 2 cycles
  = 10 min, matching the healthy pre-09-16 cadence.
- Four CI gates green (`check-types`, `lint`, `check-forbidden-patterns.sh`, `build`).

**Not yet proven:** the cron window is 05:00–19:55 IST and the fix landed at ~20:40, so the first
real daylight run is 2026-09-26 05:00. Daytime per-inverter cost is higher than the dusk numbers
above, so expect ~2–3 slices per sweep instead of 2 — each still bounded by the budget. Confirm on
09-26 that wf 55 alert count is back to ~0 and `inverter_readings` is back near 3,100/day.

## 5. Open follow-ups (not touched)

- ~~**Due-filter ignores `polling_interval_minutes`.**~~ **FIXED same day — see §6.**
- **~11 s per sweep is pure sleeping**: the 600 ms politeness gap after each Growatt installer-token
  call (19 plants) guards against error `10012 error_frequently_access`. Left as-is; the honest lever
  if 5-min cadence is ever needed is bounded concurrency per vendor, not removing the gap.
- **n8n node timeout (120 s) is above the platform ceiling (~91 s)**, so it can never fire usefully.
  Harmless now that runs return in ~30–50 s; drop it to ~90 s if the signature ever returns.
- **Sungrow returned `no data` for all 17 devices** in the dusk runs (expected after sunset — worth
  one daytime confirmation that real telemetry flows, since these count as `succeeded`).
- Plant `10467798` datalogger clock still frozen at `2026-02-03` (clamped by `clampRecordedAt`;
  already flagged for a site check in `docs/modules/om.md`).

---

## 6. Follow-up shipped — due-filter now honours `polling_interval_minutes` (2026-09-25, later same evening)

**What was wrong.** The due-query was hand-rolled in PostgREST:

```ts
.or('last_poll_at.is.null,last_poll_at.lt.' + new Date(Date.now() - 5 * 60 * 1000).toISOString())
```

PostgREST cannot compare two columns in a filter, so the per-inverter rule the file header
advertised (`last_poll_at + polling_interval_minutes < NOW`) was impossible to express there and had
been flattened to a hardcoded 5 minutes. Two consequences:

1. `inverters.polling_interval_minutes` was **dead configuration** — editing it changed nothing.
2. The cron interval (5 min) *equalled* the threshold, so any cycle following a full sweep found
   nothing due and returned `processed: 0` in ~1.6 s. Real fleet cadence was 10 min, not 5.

An RPC meant to encapsulate exactly this (`get_inverters_due_for_poll`, migration 050) already
existed and already had the correct SQL predicate — it was bypassed only because it did not return
`project_id` or `rated_capacity_kw`, both of which the poller needs to write `inverter_readings`.

**Fix.** Migration **223** drops and recreates the RPC with `project_id`, `rated_capacity_kw` and
`last_poll_at` added to `RETURNS TABLE` (DROP + CREATE because the signature changes; re-applies
migration 141's `SET search_path = public, pg_temp`). The Edge Function now calls it:

```ts
const { data: due, error: dueError } = await supabase
  .rpc('get_inverters_due_for_poll', { batch_limit: 100 })
  .order('last_poll_at', { ascending: true, nullsFirst: true });
```

The explicit `.order()` is retained deliberately — it re-asserts the RPC's own `ORDER BY` at the
PostgREST level so it cannot be lost if Postgres inlines the set-returning function. It is
load-bearing: inverters deferred by `POLL_BUDGET_MS` keep their old `last_poll_at` and must sort
first on the next cycle. `last_poll_at` was added to the RPC's result purely so this outer sort has
a column to sort on. `POLL_BUDGET_MS` (45 s) and `FETCH_TIMEOUT_MS` (10 s) are **unchanged**.

Deployed as **v14**, `verify_jwt` still `false`.

**Verification.** Two-sided, on the same inverter (`095efc32…`, Growatt), `last_poll_at` pinned 10
minutes in the past throughout:

| `polling_interval_minutes` | Expected | Observed |
|---|---|---|
| 15 | not due (10 < 15) — *the old 5-min filter would have returned it* | `{due: 0, processed: 0}` |
| 5 | due (10 > 5) | `{due: 1, processed: 1, succeeded: 1}` |

Full-fleet sweeps stayed inside the budget and far under the ~91 s ceiling
(`{due: 37, processed: 33, deferred: 4, duration_ms: 45600}` then `{due: 37, processed: 37,
duration_ms: 39305}`), and a sweep followed immediately by another correctly returned
`{due: 0}` instead of re-polling.

**Fleet left at `polling_interval_minutes = 15`** (Vivek's call). All 37 rows still carry the table
default, so the now-live config means the real cadence becomes **15 min**, down from the ~10 min the
hardcoded filter produced — expect `inverter_readings` to settle near **~2,100/day rather than
~3,100/day**. That is a deliberate trade, not a regression; drop the column to 5 on any inverter that
needs tighter resolution and it now takes effect. This supersedes the 09-26 expectation in §4 that
readings return to ~3,100/day.

**Testing artifact worth knowing:** running five sweeps inside four minutes tripped Growatt's
`error_code=10012 error_frequently_access` on the installer-token call, producing 2–10 `failed`
inverters per run. Sungrow and FIMER never failed. The 600 ms politeness gap in the Growatt path
assumes one sweep per cron tick — back-to-back manual invocations defeat it. Not a code defect;
don't read those failure counts as a regression.
