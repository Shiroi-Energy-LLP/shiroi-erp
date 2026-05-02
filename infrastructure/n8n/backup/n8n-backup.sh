#!/bin/bash
# n8n nightly backup — runs as a host-side cron job on the droplet.
#
# Replaces the original n8n workflow #57 which depended on
# n8n-nodes-base.executeCommand (removed in n8n 1.x for security).
#
# Strategy:
#   1. Tar the n8n Docker volume directly from the host filesystem.
#   2. Compute sha256 + size for verification.
#   3. Upload tar.gz to Supabase Storage bucket `n8n-backups/`.
#   4. Optional: log line to /var/log/n8n-backup.log.
#   5. Clean up local artifact.
#
# Restore procedure (in case the droplet dies):
#   1. Spin up new droplet, run cloud-init / docker compose stack.
#   2. Pull latest backup:
#        curl -sS -o n8n-backup-YYYY-MM-DD.tar.gz \
#          -H "Authorization: Bearer ${SUPABASE_SECRET_KEY}" \
#          "https://${SUPABASE_PROJECT_ID}.supabase.co/storage/v1/object/n8n-backups/n8n-backup-YYYY-MM-DD.tar.gz"
#   3. Verify checksum against /var/log/n8n-backup.log entry.
#   4. Stop n8n: docker compose -f /opt/shiroi-automation/docker-compose.yml stop n8n
#   5. Wipe + restore volume:
#        rm -rf /var/lib/docker/volumes/shiroi-automation_n8n_data/_data/*
#        tar xzf n8n-backup-YYYY-MM-DD.tar.gz \
#          -C /var/lib/docker/volumes/shiroi-automation_n8n_data/_data/
#   6. Start n8n: docker compose -f /opt/shiroi-automation/docker-compose.yml start n8n
#
# Required env vars from /opt/shiroi-automation/.env:
#   SUPABASE_PROJECT_ID   — e.g. kfkydkwycgijvexqiysc (prod)
#   SUPABASE_SECRET_KEY   — sb_secret_*
#
# Required precondition: private bucket `n8n-backups` must exist in
# Supabase Storage (created manually 2026-05-02 via Supabase dashboard).

set -euo pipefail

# Config
ENV_FILE="/opt/shiroi-automation/.env"
VOLUME_PATH="/var/lib/docker/volumes/shiroi-automation_n8n_data/_data"
BUCKET="n8n-backups"
LOG_FILE="/var/log/n8n-backup.log"

# Load env vars (SUPABASE_PROJECT_ID, SUPABASE_SECRET_KEY)
if [ ! -f "$ENV_FILE" ]; then
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ERROR: env file $ENV_FILE not found" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [ -z "${SUPABASE_PROJECT_ID:-}" ] || [ -z "${SUPABASE_SECRET_KEY:-}" ]; then
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ERROR: SUPABASE_PROJECT_ID or SUPABASE_SECRET_KEY missing in $ENV_FILE" >&2
  exit 1
fi

if [ ! -d "$VOLUME_PATH" ]; then
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ERROR: n8n volume path $VOLUME_PATH not found" >&2
  exit 1
fi

# Build artifact
TS=$(date -u +%Y-%m-%d)
TMP_FILE="/tmp/n8n-backup-${TS}.tar.gz"
REMOTE_FILENAME="n8n-backup-${TS}.tar.gz"

# Tar the volume directly (n8n's SQLite is single-file + can be tar'd while running;
# the brief moment of inconsistency is acceptable for daily snapshots).
tar czf "$TMP_FILE" -C "$VOLUME_PATH" .

# Compute checksum + size for the log
SHA=$(sha256sum "$TMP_FILE" | awk '{print $1}')
SZ=$(stat -c%s "$TMP_FILE")

# Upload — x-upsert: true so re-running the same day overwrites cleanly
HTTP_CODE=$(curl -sS -o /tmp/n8n-backup-upload-resp.json -w "%{http_code}" \
  -X POST \
  -H "Authorization: Bearer ${SUPABASE_SECRET_KEY}" \
  -H "Content-Type: application/gzip" \
  -H "x-upsert: true" \
  --data-binary "@${TMP_FILE}" \
  "https://${SUPABASE_PROJECT_ID}.supabase.co/storage/v1/object/${BUCKET}/${REMOTE_FILENAME}")

# Append log line (touch on first run)
[ -f "$LOG_FILE" ] || touch "$LOG_FILE"
LOG_LINE="$(date -u '+%Y-%m-%dT%H:%M:%SZ') ts=${TS} size=${SZ}b sha256=${SHA} http=${HTTP_CODE}"
echo "$LOG_LINE" >> "$LOG_FILE"

# Cleanup local artifact
rm -f "$TMP_FILE" /tmp/n8n-backup-upload-resp.json

# Exit non-zero on upload failure so cron's MAILTO surfaces it
case "$HTTP_CODE" in
  200|201)
    exit 0
    ;;
  *)
    echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ERROR: upload returned HTTP $HTTP_CODE" >&2
    exit 1
    ;;
esac
