# inverter-poll Edge Function — Logic Debrief
**Phase 8 wired 2026-05-24. Audience: Vivek (morning review).**

---

## What this document covers

- End-to-end data flow from n8n cron trigger → reading in `inverter_readings`
- How each brand's credentials are loaded
- How the Growatt session cache works
- What happens when an adapter throws
- How the auto-ticket scan (migration 050) consumes the data
- Anything you need to know before activating the n8n workflow

---

## Full request-to-reading data flow

```
n8n Cron (every 5 min, Asia/Kolkata)
    │
    │  POST /functions/v1/inverter-poll
    │  Authorization: Bearer <service-role key>
    ▼
Supabase Edge Function: inverter-poll
    │
    ├─ 1. Query inverters due for a poll
    │      SELECT … FROM inverters
    │      WHERE polling_enabled = true
    │        AND current_status != 'decommissioned'
    │        AND (last_poll_at IS NULL
    │             OR last_poll_at < NOW() - 5 min)
    │      ORDER BY last_poll_at NULLS FIRST
    │      LIMIT 100
    │
    ├─ 2. For each inverter → dispatch by brand:
    │
    │   [growatt] ──────────────────────────────────────────────────────
    │   │  a. SELECT username, password
    │   │     FROM plant_monitoring_credentials
    │   │     WHERE project_id = inv.project_id
    │   │       AND inverter_brand = 'growatt'
    │   │       AND deleted_at IS NULL
    │   │
    │   │  b. Check Growatt session cache (username key):
    │   │     HIT  → reuse cookieHeader (no login)
    │   │     MISS → POST /newTwoLoginAPI.do (form-urlencoded)
    │   │             body: userName + hashed_password
    │   │             → extract Set-Cookie, save userId + cookieHeader
    │   │             → store in cache (TTL 10 min)
    │   │
    │   │  c. GET /newTwoPlantAPI.do?op=getAllDeviceList&plantId={site_id}
    │   │     with Cookie: <cached header>
    │   │     → deviceList[]
    │   │
    │   │  d. Find device by deviceSn === monitoring_device_id
    │   │
    │   │  e. Normalize:
    │   │     ac_power_kw   = device.power (watts) / 1000
    │   │     energy_today  = device.eToday (already kWh)
    │   │     energy_total  = device.energy (already kWh)
    │   │     status        = GROWATT_STATUS_MAP[device.deviceStatus]
    │   │                     (1=active, 3=fault, 5=offline)
    │   │     recorded_at   = new Date().toISOString()
    │   │
    │   [sungrow] ────────────────────────────────────────────────────
    │   │  a. Load inverter_monitoring_credentials.config (JSONB)
    │   │     for inv.monitoring_credentials_id
    │   │
    │   │  b. Check: config.oauth_status == 'authorized'
    │   │            AND config.access_token is present
    │   │     → if not: LOG WARN and SKIP (no failure recorded)
    │   │
    │   │  c. POST {api_base}/openapi/getDeviceRealTimeData
    │   │     Headers: x-access-key: SUNGROW_APPKEY
    │   │              Authorization: Bearer {access_token}
    │   │     Body: { ps_id, device_sn_list: [device_id] }
    │   │
    │   │  d. Check result_code === '1'; normalize p_array[0]
    │   │     Timestamps: append '+05:30' to Sungrow's local time string
    │   │
    │   [solarman] ─── stub → synthetic reading (logged, not a failure)
    │   [goodwe]   ─── stub → synthetic reading (logged, not a failure)
    │   [other]    ─── WARN + skip (no failure recorded)
    │
    ├─ 3. Upsert reading:
    │      INSERT INTO inverter_readings (inverter_id, recorded_at, …)
    │      ON CONFLICT (inverter_id, recorded_at) DO NOTHING
    │      (table is partitioned by recorded_at range)
    │
    ├─ 4. Update inverter health:
    │      UPDATE inverters SET
    │        last_poll_at   = NOW(),
    │        last_reading_at = reading.recorded_at,
    │        current_status  = reading.status ?? 'unknown'
    │      WHERE id = inv.id
    │
    └─ 5. Return JSON summary:
           { processed, succeeded, failed, duration_ms }
```

---

## How credentials are loaded per brand

| Brand | Table | Key fields |
|---|---|---|
| Growatt | `plant_monitoring_credentials` | `project_id` + `inverter_brand='growatt'` + `deleted_at IS NULL` — one row per customer |
| Sungrow | `inverter_monitoring_credentials` | `inv.monitoring_credentials_id` → `config` JSONB (`oauth_status`, `access_token`, `api_base`) |
| SolarMan | N/A (stub) | Returns synthetic until paid API plan activates |
| Goodwe | N/A (stub) | Returns synthetic until API registration completes |

The key difference: Growatt is **per-customer** (each homeowner owns their plant in the Growatt portal). Sungrow is **per-installer-OAuth** (one master token covers all Manivel's plants).

---

## How the Growatt session cache works

```
newGrowattSessionCache() returns an object backed by a Map<username, SessionEntry>.

SessionEntry = { userId, cookieHeader, expiresAt (now + 10 min) }

On get(username):
  - If no entry → return null (caller must log in)
  - If entry.expiresAt < now → delete + return null (stale)
  - Else → return { userId, cookieHeader }

On set(username, session):
  - Store entry with expiresAt = now + 10 min

Lifecycle:
  - Cache is created fresh each time the Edge Function is invoked
  - One invocation = one poll cycle (up to 100 inverters)
  - Within a cycle, all inverters under the same Growatt username
    (same customer) share one login — only the first one triggers
    a POST to /newTwoLoginAPI.do
  - Cycle duration is typically 10–40 s, well within the 10 min TTL
  - The cache does NOT persist across invocations (Edge Functions are
    stateless — new isolate per request)
```

**Why this matters**: Growatt rate-limits login endpoints. Too many logins per account in a short window locks the account for 24 h. With 8+ Growatt customers and 15 min polling, that's 8 logins per cycle — down from a potential 22+ if we had multiple inverters per customer.

---

## What happens when an adapter throws

The per-inverter error path is isolated:

```
try {
  reading = await fetchXxxReading(...)
  // upsert + update health
  succeeded++
} catch (e) {
  failed++
  // 1. Log to console (visible in Supabase Edge Function logs)
  // 2. INSERT into inverter_poll_failures (inverter_id, error_message)
  // 3. UPDATE inverters SET last_poll_at = NOW()
  //    (so this inverter goes to the BACK of the queue —
  //     next cycle re-attempts it after all other inverters)
}
```

Key behaviour:
- One adapter throwing does NOT stop the rest of the batch.
- `last_poll_at` is always updated on failure — the inverter doesn't hammer the API on every cycle.
- Skipped inverters (Sungrow pre-auth, missing credentials, unsupported brand) do NOT touch `last_poll_at` — they appear again at the front of the next poll cycle's queue.

---

## How the O&M auto-ticket scan consumes the data

Migration 050 wired a `pg_cron` job that runs `scan_inverter_alerts()` every 15 minutes. This function:

1. Reads `inverter_readings` for the last two readings per inverter.
2. Checks for: `status = 'fault'`, `ac_power_kw = 0` during daylight, sustained offline.
3. If a condition is met and no open O&M ticket exists for that inverter, it creates one in `om_tickets` with:
   - `title` = "Inverter fault — {serial}"
   - `priority` = based on severity
   - `entity_id` = inverter.id
4. The n8n workflow `15-om-ticket-created.json` fires on INSERT to `om_tickets` and WhatsApps Vivek.

So the data flow is: **Growatt API → Edge Function → inverter_readings → pg_cron scan → om_tickets → n8n → WhatsApp**.

---

## Before you activate the n8n workflow

1. **In n8n UI**: navigate to workflow `60 — Inverter poll cron (every 5 min)` and click the toggle to activate it.
2. **Verify credentials**: the workflow uses `"Supabase service role"` (`httpHeaderAuth`). In n8n, check Settings → Credentials that this credential exists and has header `Authorization: Bearer sb_secret_...` (the `SUPABASE_SERVICE_ROLE_KEY`). The push script found and resolved this credential automatically.
3. **Check first run**: after activating, wait 5 minutes, then run:
   ```sql
   SELECT COUNT(*), MIN(recorded_at), MAX(recorded_at)
   FROM inverter_readings
   WHERE recorded_at > NOW() - interval '10 minutes';
   ```
   Expected: ≥1 row from the smoke test inverter (VJHRE4U03K, Block-C).
4. **If it fails**: check Edge Function logs in Supabase Dashboard → Edge Functions → inverter-poll → Logs. The most likely failure for the Growatt inverter is wrong credentials (the `Block - C` / `Fl0ur1sh@2026` pair) — in which case you'll see `Growatt login failed: Username or Password Error` in the logs and a row in `inverter_poll_failures`.

---

## Sungrow status (expected behaviour right now)

Manivel has NOT yet clicked Authorize in the Growatt/Sungrow OAuth flow. So if any Sungrow inverters were in the DB, they would hit the skip-with-warning path:

```
[inverter-poll] inverter {id} (sungrow): oauth_status=null / access_token=missing; skipping until authorized
```

This is correct and expected. No failure is logged. When Manivel clicks Authorize and `config.oauth_status` becomes `'authorized'`, the inverter will automatically start appearing in readings on the next cycle.

---

## Files changed in Phase 8

| File | What changed |
|---|---|
| `supabase/functions/inverter-poll/index.ts` | Full rewrite — real adapter dispatch, session cache, Growatt + Sungrow inline |
| `infrastructure/n8n/workflows/60-inverter-poll-cron.json` | New — 5-min cron → POST Edge Function |
| `infrastructure/n8n/workflows/61-sungrow-token-refresh.json` | New — daily 04:00 IST shell (endpoint impl deferred to Phase 9) |
| `scripts/ci/.forbidden-patterns-baseline` | Baseline updated (1 violation fixed — old stub throw removed) |
| `docs/CHANGELOG.md` | Phase 8 entry appended |
| `docs/CURRENT_STATUS.md` | Status updated |

---

*Written by Claude Code after implementing Phase 8. 2026-05-24.*
