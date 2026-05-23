# Growatt API — Confirmed Working Architecture

> Discovered 2026-05-23 after extensive systematic debugging. This document captures the working auth + data flow so future work doesn't re-derive it.

## TL;DR

- **Server:** `https://server-api.growatt.com/` (NOT `openapi.growatt.com`, NOT `server.growatt.com`, NOT `oss.growatt.com`)
- **Library:** Python `growattServer` v2.1.0 (PyPi). Port its logic into a Node adapter.
- **Auth model:** per-customer login. Each Shiroi customer has their own Growatt account that owns their plants. We log in AS each customer using credentials stored in `plant_monitoring_credentials`.
- **NO Shiroi-master "installer token" architecture works for Growatt.** The installer-level OpenAPI returns 0 plants because plants live in customer accounts, not the installer's account.

## What does NOT work — for the record

| Approach | Status | Reason |
|---|---|---|
| `openapi.growatt.com` V1 OpenAPI with SHIROIENERGYLLP token | ❌ | Account is read-only; `/v1/plant/list` returns `count: 0`; `/v1/plant/add` blocked by hidden permission gate returning misleading "Plant name is empty (10003)" |
| `server.growatt.com/newTwoLoginAPI.do` with any user | ❌ | Returns 403 from Python library, "User Does Not Exist" via curl. Server is a deprecated alias. |
| `oss.growatt.com` direct login | ❌ | Captcha-gated SPA; curl can't authenticate |
| `server-api.growatt.com` with installer logins (`SHIROIENERGYLLP`, `shiroienergy`, `EEVUWE001`) | Partial | Login works for SHIROIENERGYLLP and shiroienergy but `plant_list(user_id)` returns 0 plants because they don't own plants directly; installer-level web dashboard endpoints `/panel/*` redirect to login (different session system) |
| `EEVUWE` / `EEVUWE001` as a login | ❌ | Not a username — it's an installer code (a tag attached to accounts). |

## What DOES work

### Step 1 — Login as customer

```python
import growattServer
api = growattServer.GrowattApi()
api.server_url = 'https://server-api.growatt.com/'
response = api.login('Block - C', 'Fl0ur1sh@2026')
# response = { 'success': True, 'user': { 'id': 3563822, 'accountName': 'Block - C', ... } }
user_id = response['user']['id']
```

Behind the scenes: `POST /newTwoLoginAPI.do` with `userName` + MD5(`password`). Returns JSON with user object. Session cookies persist via `requests.Session`.

### Step 2 — List that customer's plants

```python
plants = api.plant_list(user_id)
# returns { 'data': [ { id: 10467582, plantName: 'Block - C', ... }, ... ] }
```

Behind the scenes: `GET /PlantListAPI.do?userId={user_id}`.

### Step 3 — Get device list per plant

```python
devices = api.device_list(plant_id)
# returns [{ deviceSn, datalogSn, deviceStatus, eToday, energy (total), power, ... }]
```

Each device has the SN that matches the oss.growatt.com installer dashboard export.

### Step 4 — Get realtime + chart data per plant

```python
dash = api.dashboard_data(plant_id)
# returns { echargeToat, photovoltaic, eCharge, chartData, ... }
```

### Step 5 — Get historical per inverter

```python
data = api.inverter_data(inverter_id, date='2026-05-23')
# OR
data = api.tlx_data(tlx_id, date='2026-05-23')
```

## Production architecture for our adapter

1. **`plant_monitoring_credentials` table** is the source of truth for Growatt customer logins. Each row has `(project_id, brand='growatt', username, password)`.
2. **Group inverters by `monitoring_credentials_id`.** Each customer's login gets one session.
3. **Per polling cycle (every 15 min):**
   - For each unique customer credential, log in once, capture user_id + session.
   - Call `plant_list(user_id)` → enumerate that customer's plants.
   - For each plant: `device_list(plant_id)` and `dashboard_data(plant_id)`.
   - Normalize into `inverter_readings` schema.
4. **Rate limiting**: Growatt locks accounts for 24h on too-many-logins. So:
   - One login per customer per session.
   - Reuse session across all data calls within the polling window.
   - Sleep 200ms between calls to be safe.

## Why this is cleaner than the original Phase 4 plan

Originally Phase 4 assumed a single Shiroi master credential (Growatt installer token) calls all data endpoints. That doesn't work because plants are owned by customers, not the installer.

The actual architecture is:
- **NO Shiroi master row in `inverter_monitoring_credentials` for Growatt.**
- The Growatt-specific adapter reads credentials FROM `plant_monitoring_credentials` directly (per-customer).
- This is a different code path from Sungrow (master OAuth token) and SolarMan (master org token). Worth a comment in the adapter.

## Credentials coverage (as of 2026-05-23)

We have working logins for 8 customer accounts covering 22 known plants. Missing logins for 6 customer accounts:

- `arhsolar` (ARHSOLAR — 100 kW commercial, biggest)
- `Krishna Office` (22 kW)
- `Chsvsolar` (Chsvsolar 80.5 kW C&I + Chsv junior school 8 kW = 2 plants)
- `Amraja` (Am Raja)
- `swaminathaan` (swaminathan)
- `RukashJeyaBhava` (Saravanasolar)

Vivek to provide these from his credential records.

## References

- Python library: `pip install growattServer` (version 2.1.0)
- PyPi page: <https://pypi.org/project/growattServer/>
- Source: <https://github.com/indykoning/PyPi_GrowattServer>
- The library's login + plant_list + device_list + dashboard_data are the surfaces we need to port to TypeScript.
- Rate limit warning from Home Assistant community: too many logins lock accounts for 24h.

## What to port to TypeScript

```
packages/inverter-adapters/src/growatt.ts:
  - growattLogin(username, password)
    -> POST https://server-api.growatt.com/newTwoLoginAPI.do
    -> form-urlencoded: userName=<username>&password=<md5_hex>
    -> returns { success, user: { id, accountName, ... } }
    -> persist session cookies for reuse
  - growattPlantList(session, user_id)
    -> GET /PlantListAPI.do?userId={user_id}
    -> returns { data: [{ id, plantName, nominalPower, ... }] }
  - growattDeviceList(session, plant_id)
    -> follows the library's device_list call
  - growattDashboardData(session, plant_id)
    -> follows library's dashboard_data call

Adapter contract per InverterAdapter interface:
  fetchReadings({ credentials, monitoring_site_id (=plant_id), monitoring_device_id (=SN) })
    1. Look up customer's username/password from credentials
    2. growattLogin → session + user_id
    3. growattDeviceList(session, plant_id)
    4. Find the device matching monitoring_device_id (SN)
    5. Normalize to NormalizedReading
```
