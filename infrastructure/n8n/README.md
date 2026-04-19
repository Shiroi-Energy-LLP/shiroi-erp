# n8n + Caddy infrastructure

Self-hosted n8n running on a DigitalOcean Bangalore droplet, fronted by Caddy (auto-HTTPS via Let's Encrypt). Replaces the original "spare laptop" plan from `docs/SHIROI_MASTER_REFERENCE.md` §3.2 — same software, different host. ~₹1,000/mo vs ₹0 for physical, traded for zero uptime management and a public IP for Supabase webhooks.

## Where it runs

| Thing | Value |
|-------|-------|
| Provider | DigitalOcean |
| Droplet | `shiroi-erp` (Basic Regular, 1 vCPU, 2 GB RAM, 50 GB SSD) |
| Region | Bangalore (BLR1) |
| Public IPv4 | `68.183.91.111` |
| n8n UI | `https://n8n.shiroienergy.com` |
| PVLib (future) | `https://pvlib.shiroienergy.com` |
| Working dir on droplet | `/opt/shiroi-automation/` |
| Cost | $12/mo (~₹1,000) |

## What's in this directory

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Two services: `caddy` (reverse proxy + HTTPS) + `n8n` |
| `Caddyfile` | Caddy routes: `n8n.shiroienergy.com` → `n8n:5678` |
| `.env.example` | Template for `.env` — real `.env` lives on the droplet only, never committed |

## Why these files live in the repo

The droplet itself isn't version-controlled. If it ever dies, these three files + the `.env` value (saved in the password manager) + n8n workflow exports are enough to rebuild the whole stack in ~10 minutes.

## Operations

### SSH in

```powershell
ssh root@68.183.91.111
cd /opt/shiroi-automation
```

### Update to latest n8n image

```bash
cd /opt/shiroi-automation
docker compose pull
docker compose up -d
```

### View logs

```bash
docker compose logs -f --tail=100 n8n
docker compose logs -f --tail=100 caddy
```

### Back up n8n data

n8n's SQLite DB + stored credentials live in the `n8n_data` Docker volume. Back up via:

```bash
docker run --rm -v shiroi-automation_n8n_data:/data -v $(pwd):/backup alpine \
  tar czf /backup/n8n-backup-$(date +%Y-%m-%d).tar.gz -C /data .
```

Copy the resulting `.tar.gz` off the droplet (scp) and store somewhere durable.

### Sync changes from this repo to the droplet

After editing `docker-compose.yml` or `Caddyfile` here and pushing, apply on the droplet:

```bash
cd /opt/shiroi-automation
# Manually copy the new contents from the repo (droplet doesn't clone the repo)
nano docker-compose.yml   # paste new contents
nano Caddyfile            # paste new contents
docker compose up -d      # reapply
```

Long-term: consider a `git pull` from a private deploy key on the droplet, or a GitHub Actions deploy step. Not worth it yet.

## Environment variables on the droplet

`/opt/shiroi-automation/.env` (permissions 600, root-only). Contains:

- `N8N_ENCRYPTION_KEY` — 64 hex chars. Used to encrypt all credentials stored inside n8n workflows. **Losing this = all credentials become unreadable.** Saved in password manager.

## Adding PVLib (future)

When the PVLib microservice is ready, add a third service to `docker-compose.yml` and a block to `Caddyfile`:

```
# Caddyfile
pvlib.shiroienergy.com {
    reverse_proxy pvlib:5001
}
```

```yaml
# docker-compose.yml
  pvlib:
    build: ./pvlib              # or a pre-built image
    restart: unless-stopped
    networks:
      - shiroi
```

## Security notes

- **UFW firewall** on the droplet allows only 22/80/443. Everything else is denied.
- **n8n auth** is the built-in user management (first visit creates owner). No basic-auth on Caddy — n8n guards its own UI.
- **Let's Encrypt certificates** are auto-renewed by Caddy.
- **SSH** is key-only (no password login).
- **`N8N_SECURE_COOKIE=true`** forces the n8n cookie over HTTPS only.
- **Supabase → n8n webhooks** authenticate via `x-webhook-secret` header. The secret is set in both `.env.local` (ERP side) and in each n8n workflow's webhook node.

## First workflow: bug-report intake

`apps/erp/src/lib/settings-actions.ts:notifyBugReport` POSTs to `N8N_BUG_REPORT_WEBHOOK_URL` on every bug report submission. Payload:

```json
{
  "id": "uuid",
  "user_id": "uuid",
  "user_email": "vivek@shiroienergy.com",
  "category": "bug | feature | question",
  "severity": "low | medium | high | critical",
  "description": "text",
  "page_url": "https://erp.shiroienergy.com/projects/abc",
  "created_at": "2026-04-19T..."
}
```

Auth: `x-webhook-secret: <N8N_WEBHOOK_SECRET>` header.

## Rebuild from scratch (if the droplet dies)

1. Create new Ubuntu 24.04 droplet in Bangalore with the cloud-init script from `docs/CHANGELOG.md` 2026-04-19 n8n entry
2. Update GoDaddy DNS A records for `n8n.shiroienergy.com` (and `pvlib` later) to the new IP
3. `ssh root@<new IP>`
4. `mkdir -p /opt/shiroi-automation && cd /opt/shiroi-automation`
5. Copy `docker-compose.yml` + `Caddyfile` contents from this directory
6. Restore `.env` from the password manager (or generate a fresh `N8N_ENCRYPTION_KEY` if starting clean)
7. Restore `n8n_data` backup if you have one, otherwise start fresh
8. `docker compose up -d`
9. Visit `https://n8n.shiroienergy.com` — either existing workflows appear (if restored) or create a fresh owner account
