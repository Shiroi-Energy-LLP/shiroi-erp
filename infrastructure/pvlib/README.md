# PVLib Microservice — Deployment Guide

This FastAPI microservice wraps pvlib to provide solar yield simulation as a fallback when PVWatts is unavailable or offline.

## Architecture

- Runs on the DO droplet as a Docker container
- Listens on `localhost:5001` only (Caddy proxies `pvlib.shiroienergy.com` → `localhost:5001`)
- The ERP sets `PVLIB_MICROSERVICE_URL=https://pvlib.shiroienergy.com` in Vercel env vars
- The ERP falls back to pvlib when PVWatts returns an error

## Deployment Steps (run as Vivek on the DO droplet)

### 1. SSH into the droplet

```bash
ssh root@<droplet-ip>
```

### 2. Install Docker (if not already installed)

```bash
curl -fsSL https://get.docker.com | sh
```

### 3. Clone/copy the pvlib source files

```bash
mkdir -p /opt/shiroi/pvlib
# Copy the files from this directory to the droplet
scp -r infrastructure/pvlib/* root@<droplet-ip>:/opt/shiroi/pvlib/
```

Make sure `/opt/shiroi/pvlib/main.py` exists (the FastAPI app — implement if not present).

### 4. Build and start the container

```bash
cd /opt/shiroi/pvlib
docker compose up -d --build
```

Verify it's running:
```bash
docker compose ps
curl http://localhost:5001/health
# Expected: {"status":"ok","pvlib_version":"0.11.0"}
```

### 5. Configure Caddy reverse proxy

Add this snippet to `/etc/caddy/Caddyfile`:

```
pvlib.shiroienergy.com {
    reverse_proxy localhost:5001

    # Basic auth for the external endpoint (pvlib is internal-only normally)
    # Remove if ERP calls from Vercel with IP allowlist instead
    basicauth * {
        shiroi $2a$14$<bcrypt-hash-of-api-password>
    }

    log {
        output file /var/log/caddy/pvlib.log
    }
}
```

Reload Caddy:
```bash
systemctl reload caddy
```

### 6. Set Vercel environment variable

In the Vercel dashboard for `erp.shiroienergy.com`:
- Go to Settings → Environment Variables
- Add: `PVLIB_MICROSERVICE_URL` = `https://pvlib.shiroienergy.com`

### 7. Set up systemd restart on reboot (if not using Docker's restart policy)

The `docker-compose.yml` already has `restart: unless-stopped`, so Docker will restart the container on reboot automatically.

Verify:
```bash
reboot
# wait 30 seconds
curl http://localhost:5001/health
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
