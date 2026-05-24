# PVLib Microservice — Deployment Guide

FastAPI microservice that wraps pvlib + PVGIS TMY data to provide solar yield simulation as a fallback when PVWatts is unavailable.

## Live deployment (as of 2026-05-24)

- **URL:** `https://pvlib.shiroienergy.com` (auto-HTTPS via Caddy + Let's Encrypt)
- **Host:** DO droplet `shiroi-erp` (`68.183.91.111`)
- **Stack location:** `/opt/shiroi-automation/pvlib/` (alongside n8n + Caddy in the same docker-compose)
- **Container name:** `shiroi-pvlib`
- **Internal port:** 5001 (not exposed to host — Caddy proxies via Docker network DNS `pvlib:5001`)
- **Resources:** 512 MB RAM, 0.5 CPU
- **API contract matches** `apps/erp/src/lib/pvwatts.ts` exactly — fields `system_capacity`/`lat`/`lon`/`tilt`/`azimuth`/`module_type`/`losses`, response `{monthly_kwh: number[12], annual_kwh: number}`

## Architecture

- Runs as a Docker container in the same `shiroi-automation_shiroi` network as n8n + Caddy
- Caddy reverse-proxies `pvlib.shiroienergy.com` → `pvlib:5001` via container DNS
- The ERP sets `PVLIB_MICROSERVICE_URL=https://pvlib.shiroienergy.com` in Vercel env vars
- The ERP falls back to pvlib only when PVWatts returns an error or times out (8s)

## Re-deployment (after editing `main.py` or dependencies)

```bash
# From your local machine:
scp infrastructure/pvlib/main.py root@68.183.91.111:/opt/shiroi-automation/pvlib/main.py
# (or scp -r for everything)
ssh root@68.183.91.111 'cd /opt/shiroi-automation && docker compose up -d --build pvlib'

# Verify:
curl https://pvlib.shiroienergy.com/health
# Expected: {"status":"ok","pvlib_version":"0.11.0"}
```

## Initial deployment steps (already done on 2026-05-24)

1. `scp -r infrastructure/pvlib root@68.183.91.111:/opt/shiroi-automation/`
2. Added `pvlib:` service block to `/opt/shiroi-automation/docker-compose.yml` (joins the existing `shiroi` network)
3. Added `pvlib.shiroienergy.com { reverse_proxy pvlib:5001 }` block to `/opt/shiroi-automation/Caddyfile`
4. `docker compose up -d --build pvlib`
5. `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`
6. Caddy auto-provisioned the Let's Encrypt cert on first request

## Manual step still pending

Add to **Vercel** env vars for `erp.shiroienergy.com`:
- `PVLIB_MICROSERVICE_URL` = `https://pvlib.shiroienergy.com`

Until this is set, the ERP's `fetchPVLib()` in `pvwatts.ts` will throw "Missing PVLIB_MICROSERVICE_URL" when PVWatts fails. No fallback active until then.

## Auth

No auth on the endpoint. The service is read-only simulation (no secrets, no DB writes). If you want to add basicauth later, the Caddyfile block accepts:
```
pvlib.shiroienergy.com {
    reverse_proxy pvlib:5001
    basicauth * {
        shiroi <bcrypt-hash>
    }
}
```

## Monitoring

Container logs:
```bash
cd /opt/shiroi/pvlib
docker compose logs -f pvlib
```

Health check:
```bash
curl https://pvlib.shiroienergy.com/health
```

## Updating

```bash
cd /opt/shiroi/pvlib
git pull  # if the droplet has the repo
docker compose down && docker compose up -d --build
```

## API Reference

The microservice exposes the same interface as PVWatts for the ERP's pvwatts.ts module.

### `GET /health`
Returns `{"status":"ok","pvlib_version":"..."}`.

### `POST /simulate`
Body:
```json
{
  "system_capacity_kw": 10.0,
  "latitude": 13.0827,
  "longitude": 80.2707,
  "tilt": 11,
  "azimuth": 180,
  "losses_pct": 14.0
}
```
Returns annual and monthly AC production in kWh.

## Notes

- This microservice does not need any API keys (pvlib uses open NSRDB/ERA5 data)
- It is stateless — no database, no auth required beyond the Caddy basicauth
- Memory: ~200MB idle, ~300MB during a simulation
- Simulation time: ~2-5 seconds per request (pvlib uses full hourly TMY data)
