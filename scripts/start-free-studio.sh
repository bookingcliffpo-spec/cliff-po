#!/usr/bin/env bash
# Free local studio: the model runs on this computer (WanGP), and any phone or
# computer on the same Wi-Fi can use the page.
#
#   WANGP_ROOT=/path/to/Wan2GP ./scripts/start-free-studio.sh
#
# Optional: WANGP_PYTHON (WanGP's python, default: python3), PORT (3000),
# WANGP_ARGS (e.g. "--attention sdpa --profile 4"), APP_PASSWORD.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${WANGP_ROOT:?Set WANGP_ROOT to your WanGP folder (the one with wgp.py)}"
[ -f "$WANGP_ROOT/wgp.py" ] || { echo "No wgp.py in $WANGP_ROOT"; exit 1; }
PY="${WANGP_PYTHON:-python3}"
PORT="${PORT:-3000}"

# One secret between the page and the bridge, kept on this machine only.
if [ ! -f .free-studio.env ]; then
  echo "WANGP_TOKEN=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')" > .free-studio.env
fi
# shellcheck disable=SC1091
. ./.free-studio.env

[ -d node_modules ] || pnpm install --frozen-lockfile
[ -d .next ] || pnpm build

"$PY" bridge/wangp_bridge.py --wangp-root "$WANGP_ROOT" --token "$WANGP_TOKEN" --wangp-args "${WANGP_ARGS:-}" &
BRIDGE=$!
trap 'kill $BRIDGE 2>/dev/null || true' EXIT

echo
echo "  Free studio is starting. Open it on:"
echo "    this computer:  http://localhost:$PORT"
for ip in $(hostname -I 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || true); do
  case "$ip" in *:*) ;; *) echo "    phone (Wi-Fi):  http://$ip:$PORT" ;; esac
done
echo

WANGP_URL="http://127.0.0.1:7870" WANGP_TOKEN="$WANGP_TOKEN" pnpm start -H 0.0.0.0 -p "$PORT"
