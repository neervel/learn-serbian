#!/usr/bin/env bash
# First-time setup of a fresh Ubuntu server. Run as root; safe to run again.
#   - Node.js 24, a 1 GB swap file (small droplets run out of memory in npm)
#   - user "serbian", the repo in /opt/learn-serbian
#   - systemd service and a daily database backup
# Afterwards put .env into /opt/learn-serbian and run deploy/update.sh.
set -euo pipefail

REPO=https://github.com/neervel/learn-serbian.git
DIR=/opt/learn-serbian

if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs >/dev/null
fi

id serbian >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin serbian
if [ ! -d "$DIR/.git" ]; then
  git clone "$REPO" "$DIR"
fi
mkdir -p "$DIR/data/backups"
chown -R serbian:serbian "$DIR"

install -m 644 "$DIR/deploy/learn-serbian.service" /etc/systemd/system/learn-serbian.service
cat > /etc/cron.d/learn-serbian-backup <<CRON
# Daily copy of the bot database, 03:30 UTC
30 3 * * * serbian cd $DIR && /usr/bin/node --disable-warning=ExperimentalWarning scripts/backup-db.ts >> data/backups/backup.log 2>&1
CRON
systemctl daemon-reload
systemctl enable learn-serbian >/dev/null 2>&1

echo "setup done: node $(node --version), repo in $DIR"
