#!/usr/bin/env bash
# Installs the Solana/Anchor toolchain inside WSL2 (Ubuntu) for building,
# testing and deploying the TUNNEL program. Run from the repo root in WSL:
#
#   bash scripts/setup-wsl.sh
#
# Pinned to the versions the program is written against.
set -euo pipefail

SOLANA_VERSION="2.3.0"
ANCHOR_VERSION="0.32.1"
NODE_MAJOR="22"

echo "==> apt packages"
sudo apt-get update -y
sudo apt-get install -y build-essential pkg-config libssl-dev libudev-dev curl git ca-certificates

if ! command -v rustup >/dev/null; then
  echo "==> rustup"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
fi
# shellcheck disable=SC1091
source "$HOME/.cargo/env"
rustup toolchain install stable --profile minimal

if ! command -v solana >/dev/null || ! solana --version | grep -q "$SOLANA_VERSION"; then
  echo "==> Solana CLI (Agave) $SOLANA_VERSION"
  sh -c "$(curl -sSfL "https://release.anza.xyz/v${SOLANA_VERSION}/install")"
fi
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

if ! command -v avm >/dev/null; then
  echo "==> Anchor version manager"
  cargo install --git https://github.com/coral-xyz/anchor avm --tag "v${ANCHOR_VERSION}" --locked
fi
avm install "$ANCHOR_VERSION"
avm use "$ANCHOR_VERSION"

if ! command -v node >/dev/null || ! node --version | grep -q "^v${NODE_MAJOR}"; then
  echo "==> Node.js ${NODE_MAJOR}"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
fi

if [ ! -f "$HOME/.config/solana/id.json" ]; then
  echo "==> creating a devnet operator keypair at ~/.config/solana/id.json (back it up; never commit it)"
  solana-keygen new --no-bip39-passphrase -o "$HOME/.config/solana/id.json"
fi
solana config set --url devnet

cat <<EOF

Toolchain ready:
  $(solana --version)
  $(anchor --version)
  $(node --version)

Next steps (docs/DEPLOYMENT.md):
  npm ci
  anchor build && npm run idl:sync
  anchor test                 # localnet suite, clones ORAO VRF from devnet
EOF
