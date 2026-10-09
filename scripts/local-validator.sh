#!/usr/bin/env bash
# Local Solana validator for TUNNEL (run inside WSL / Linux):
#   bash scripts/local-validator.sh <UPGRADE_AUTHORITY_PUBKEY> [--reset]
#
# - preloads target/deploy/tunnel.so at the program id, upgradeable, with the
#   given upgrade authority (initialize requires the upgrade authority)
# - clones the real ORAO VRF program from devnet
# - RPC on :8899, websocket on :8900, reachable from Windows via localhost
set -euo pipefail
AUTH="${1:?usage: local-validator.sh <upgrade-authority-pubkey> [--reset]}"
RESET="${2:-}"
cd "$(dirname "$0")/.."
PROGRAM_ID=$(solana address -k target/deploy/tunnel-keypair.json)
LEDGER="$HOME/tunnel-ledger"

ARGS=(--ledger "$LEDGER" --bind-address 0.0.0.0 --rpc-port 8899 --quiet)
if [ "$RESET" = "--reset" ] || [ ! -d "$LEDGER" ]; then
  ARGS+=(--reset
    --url https://api.devnet.solana.com
    --clone-upgradeable-program VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y
    --upgradeable-program "$PROGRAM_ID" target/deploy/tunnel.so "$AUTH")
fi
echo "starting validator: program $PROGRAM_ID, upgrade authority $AUTH, ledger $LEDGER"
exec solana-test-validator "${ARGS[@]}"
