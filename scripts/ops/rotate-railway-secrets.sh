#!/usr/bin/env bash
# Creates (or rotates) the production secrets and sets them on Railway.
#
#   bash scripts/ops/rotate-railway-secrets.sh [dashboard-user]
#
# Generates a new collector key (SYNC_SECRET), session secret
# (SESSION_SECRET) and a dashboard account with a random password
# (DASHBOARD_USERS, scrypt-hashed), sets them on the ksk-scraper service, and
# writes the plain values to ~/ksk-scraper-credentials.txt — outside the repo,
# readable only by you. Nothing is printed to the terminal.
#
# Effects: everyone is signed out, and the plant collector must be given the
# new key (it asks for it on its next start). Railway redeploys once, at the end.
#
# Needs: the Railway CLI, logged in and linked to this project (`railway link`).
set -euo pipefail

cd "$(dirname "$0")/../.."
USER_NAME="${1:-hsan}"
SERVICE="ksk-scraper"
CRED_FILE="$HOME/ksk-scraper-credentials.txt"

if ! [[ "$USER_NAME" =~ ^[a-z0-9._-]{3,64}$ ]]; then
  echo "User names are 3-64 characters of a-z 0-9 . _ -" >&2
  exit 1
fi
command -v railway > /dev/null || { echo "Install the Railway CLI first: npm i -g @railway/cli" >&2; exit 1; }
[ -f dist/auth/password.js ] || npm run build > /dev/null

sync_key=$(openssl rand -hex 32)
session_secret=$(openssl rand -hex 32)
password=$(openssl rand -base64 18 | tr '+/' '-_')
hash=$(P="$password" node -e \
  "require('./dist/auth/password.js').hashPassword(process.env.P).then(console.log)")

umask 077
cat > "$CRED_FILE" << EOF
KSK Scraper — production credentials ($(date '+%Y-%m-%d %H:%M'))
Private. Never commit this file or paste it in a chat.

Dashboard: https://ksk-scraper-ashy.vercel.app
  user:     $USER_NAME
  password: $password

Collector key — paste it once when the new live-sync.bat asks for it:
  $sync_key

More people: npm run auth:hash-password, then append ";name:hash" to
DASHBOARD_USERS on Railway.
EOF

# Values go through stdin, never the command line (process list, history).
set_var() {
  printf '%s' "$2" | railway variables --service "$SERVICE" ${3:-} --set-from-stdin "$1" > /dev/null
}
set_var SYNC_SECRET "$sync_key" --skip-deploys
set_var SESSION_SECRET "$session_secret" --skip-deploys
set_var DASHBOARD_USERS "$USER_NAME:$hash"   # this one triggers the redeploy

echo "Done. Railway is redeploying (about 2 minutes)."
echo "Credentials: $CRED_FILE"
