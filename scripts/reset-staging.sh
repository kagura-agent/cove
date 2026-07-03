#!/usr/bin/env bash
# Reset Cove staging data on VM1
# Usage: bash scripts/reset-staging.sh
# What it does:
#   1. Stops cove-staging service
#   2. Backs up current DB
#   3. Deletes the DB (server auto-creates fresh on start)
#   4. Restarts cove-staging service

set -euo pipefail

VM="azureuser@74.226.216.75"
DB_PATH="/home/azureuser/cove-staging/cove-staging.db"
SERVICE="cove-staging"

echo "🔄 Resetting Cove staging data on VM1..."

# Stop service
echo "  ⏹  Stopping $SERVICE..."
ssh "$VM" "sudo systemctl stop $SERVICE"

# Backup + delete DB
BACKUP="${DB_PATH}.bak.$(date +%Y%m%d-%H%M%S)"
echo "  💾 Backing up DB to $BACKUP"
ssh "$VM" "cp '$DB_PATH' '$BACKUP' 2>/dev/null || true; rm -f '$DB_PATH' '${DB_PATH}-shm' '${DB_PATH}-wal'"

# Restart service (server auto-creates fresh DB on boot)
echo "  ▶️  Starting $SERVICE..."
ssh "$VM" "sudo systemctl start $SERVICE"

# Verify
echo "  🔍 Verifying..."
sleep 2
ssh "$VM" "sudo systemctl is-active $SERVICE && ls -la '$DB_PATH'"

echo "✅ Staging reset complete! Fresh DB created."
echo "   URL: https://staging.cove.kagura-agent.com"
