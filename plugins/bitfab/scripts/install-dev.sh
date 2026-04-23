#!/usr/bin/env bash
#
# Build, vendor, and install the dev version of the Bitfab Codex plugin.
#
# Mirrors the vendor + install steps CI runs, then idempotently registers
# the local marketplace in ~/.codex/config.toml. Safe to re-run.
#
# This does NOT toggle the enabled state between dev and prod — use
# toggle.sh for that.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PLUGIN_DIR/.." && pwd)"

VENDOR_DIR="$PLUGIN_DIR/tmp"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
CACHE_DIR="$CODEX_HOME/plugins/cache/bitfab-dev/bitfab/local"
CONFIG_TOML="$CODEX_HOME/config.toml"

cd "$REPO_ROOT"

echo "==> Building bitfab-plugin-lib"
(cd bitfab-plugin-lib && pnpm build)

echo "==> Building bitfab-codex-plugin"
(cd bitfab-codex-plugin && pnpm build && node ../bitfab-plugin-lib/scripts/write-build-info.mjs)

echo "==> Vendoring into $VENDOR_DIR"
rm -rf "$VENDOR_DIR"
mkdir -p "$VENDOR_DIR"
scripts/vendor-bitfab-plugin.sh \
  bitfab-codex-plugin .codex-plugin "$VENDOR_DIR" plugins/bitfab bitfab-dev

# Hoisted node_modules — Codex's copy routine drops symlinks, which would
# strip zod and @modelcontextprotocol/sdk from an isolated pnpm layout.
(cd "$VENDOR_DIR/plugins/bitfab" \
  && pnpm install --prod --ignore-workspace --config.node-linker=hoisted)

echo "==> Installing into $CACHE_DIR"
rm -rf "$CACHE_DIR"
mkdir -p "$(dirname "$CACHE_DIR")"
cp -R "$VENDOR_DIR/plugins/bitfab" "$CACHE_DIR"

echo "==> Ensuring marketplaces.bitfab-dev block in $CONFIG_TOML"
node "$SCRIPT_DIR/codex-config.mjs" ensure-dev "$CONFIG_TOML" "$VENDOR_DIR"

echo "==> Verifying install"
node "$CACHE_DIR/dist/commands/status.js"

echo
echo "✅ Bitfab Codex dev build installed."
echo "   To activate: $PLUGIN_DIR/scripts/toggle.sh dev"
echo "   Then restart Codex."
