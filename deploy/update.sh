#!/usr/bin/env bash
# Deploys the latest main: pull, install, reload the dictionary, restart.
# Run as root on the server:  /opt/learn-serbian/deploy/update.sh
set -euo pipefail

DIR=/opt/learn-serbian
cd "$DIR"
as_bot() { sudo -u serbian -H "$@"; }

[ -f .env ] || { echo "$DIR/.env is missing (BOT_TOKEN, ALLOWED_USER_IDS)"; exit 1; }
chown serbian:serbian .env && chmod 600 .env

as_bot git pull --ff-only
as_bot npm ci --omit=dev --no-audit --no-fund
as_bot node --disable-warning=ExperimentalWarning scripts/import-words.ts
install -m 644 deploy/learn-serbian.service /etc/systemd/system/learn-serbian.service
systemctl daemon-reload
systemctl restart learn-serbian
sleep 4
systemctl --no-pager --lines=8 status learn-serbian | sed -n '1,4p;/running\|words in the dictionary\|rror/p'
