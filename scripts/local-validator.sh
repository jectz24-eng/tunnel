#!/usr/bin/env bash
# Local Solana validator for TUNNEL development (run inside WSL / Linux):
#   bash scripts/local-validator.sh [--reset]
#
# TUNNEL has no on-chain program: the validator only hosts the $TUNNEL SPL
# mint, the reward wallet and payout transfers. RPC on :8899 (reachable from
# Windows via localhost).
set -euo pipefail
LEDGER="$HOME/tunnel-ledger-v3"
ARGS=(--ledger "$LEDGER" --bind-address 0.0.0.0 --rpc-port 8899 --quiet)
if [ "${1:-}" = "--reset" ] || [ ! -d "$LEDGER" ]; then ARGS+=(--reset); fi
echo "starting validator, ledger $LEDGER"
exec solana-test-validator "${ARGS[@]}"
