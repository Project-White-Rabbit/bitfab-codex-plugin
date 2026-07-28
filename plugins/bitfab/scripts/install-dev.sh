#!/usr/bin/env bash
#
# Build, vendor, and install the dev version of the Bitfab Codex plugin.
#
# Mirrors the vendor + install steps CI runs, then idempotently registers
# the local marketplace in ~/.codex/config.toml. Safe to re-run.
#
# This does NOT toggle the enabled state between dev and prod - use
# toggle.sh for that.

set -euo pipefail

IF_STALE=0
if [ "${1:-}" = "--if-stale" ]; then
  IF_STALE=1
  shift
fi
if [ "$#" -gt 0 ]; then
  echo "Usage: install-dev.sh [--if-stale]" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PLUGIN_DIR/.." && pwd)"

VENDOR_DIR="$PLUGIN_DIR/tmp"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
# Stable internal marketplace. Worktree-specific code stays in the worktree and
# is selected through the session runtime map; Codex only discovers this shim.
MKT_NAME="bitfab-internal"
STABLE_VENDOR_DIR="$CODEX_HOME/bitfab/internal-marketplace"
CACHE_DIR="$CODEX_HOME/plugins/cache/$MKT_NAME/bitfab/local"
DEV_CACHE_DIR="$CODEX_HOME/plugins/cache/$MKT_NAME/bitfab-dev/local"
ACCOUNTS_CACHE_DIR="$CODEX_HOME/plugins/cache/$MKT_NAME/bitfab-accounts/local"
CONFIG_TOML="$CODEX_HOME/config.toml"
SOURCE_HASH_STAMP="$STABLE_VENDOR_DIR/.source-hash"
FRESHNESS_SCRIPT="$SCRIPT_DIR/dev-install-freshness.mjs"
INSTALL_LOCK="$CODEX_HOME/bitfab/install-dev.lock"
PROCESS_LOCK_SCRIPT="$REPO_ROOT/scripts/process-lock.sh"

cd "$REPO_ROOT"

if [ ! -f "$PROCESS_LOCK_SCRIPT" ]; then
  echo "Missing process lock helper: $PROCESS_LOCK_SCRIPT" >&2
  exit 1
fi
# shellcheck disable=SC1090,SC1091
source "$PROCESS_LOCK_SCRIPT"
if ! process_lock_acquire "$INSTALL_LOCK" 1200 0.25; then
  echo "Timed out waiting for another Codex plugin install to finish" >&2
  exit 1
fi
cleanup_install_lock() {
  process_lock_release "$INSTALL_LOCK"
}
trap cleanup_install_lock EXIT

SOURCE_HASH="$(node "$FRESHNESS_SCRIPT" "$REPO_ROOT")"

outputs_ready() {
  [ -f "$STABLE_VENDOR_DIR/.agents/plugins/marketplace.json" ] \
    && [ -f "$STABLE_VENDOR_DIR/plugins/bitfab/.codex-plugin/plugin.json" ] \
    && [ -f "$CACHE_DIR/.codex-plugin/plugin.json" ] \
    && [ -f "$CACHE_DIR/dist/commands/status.js" ] \
    && { [ ! -d "$REPO_ROOT/bitfab-dev-codex-plugin/skills" ] \
      || [ -f "$DEV_CACHE_DIR/.codex-plugin/plugin.json" ]; } \
    && { [ ! -d "$REPO_ROOT/bitfab-accounts-codex-plugin/skills" ] \
      || { [ -f "$ACCOUNTS_CACHE_DIR/.codex-plugin/plugin.json" ] \
        && [ -f "$ACCOUNTS_CACHE_DIR/mcp.json" ]; }; }
}

OUTPUTS_READY=0
if outputs_ready; then
  OUTPUTS_READY=1
fi

# This is intentionally outside the rebuild gate: if hooks.json is deleted or
# edited, the lightweight reconciliation must still self-heal it.
node "$SCRIPT_DIR/install-session-hook.mjs" "$CODEX_HOME/hooks.json"

if [ "$IF_STALE" = "1" ] \
   && [ "$OUTPUTS_READY" = "1" ] \
   && [ -f "$SOURCE_HASH_STAMP" ] \
   && [ "$(tr -d '[:space:]' < "$SOURCE_HASH_STAMP")" = "$SOURCE_HASH" ]; then
  echo "==> Codex plugin build inputs unchanged, skipping rebuild"
  exit 0
fi

# The stamp represents a fully verified install. Clear it before any rebuild so
# an interrupted forced install cannot make a partial output look current.
rm -f "$SOURCE_HASH_STAMP"

if [ -x "$REPO_ROOT/scripts/ensure-workspace-deps.sh" ]; then
  "$REPO_ROOT/scripts/ensure-workspace-deps.sh" "$REPO_ROOT"
fi

echo "==> Building bitfab-flow"
(cd bitfab-flow && pnpm build)

echo "==> Building bitfab-plugin-lib"
(cd bitfab-plugin-lib && pnpm build)

echo "==> Building bitfab-codex-plugin"
(cd bitfab-codex-plugin && pnpm build && node ../bitfab-plugin-lib/scripts/write-build-info.mjs)

echo "==> Vendoring into $VENDOR_DIR"
rm -rf "$VENDOR_DIR"
mkdir -p "$VENDOR_DIR"
scripts/vendor-bitfab-plugin.sh \
  bitfab-codex-plugin .codex-plugin "$VENDOR_DIR" plugins/bitfab "$MKT_NAME"

echo "==> Replacing bitfab skills with session-routed shims"
node "$SCRIPT_DIR/build-skill-shims.mjs" \
  "$REPO_ROOT/bitfab-codex-plugin/skills" \
  "$VENDOR_DIR/plugins/bitfab/skills" \
  bitfabRuntime

# Hoisted node_modules - Codex's copy routine drops symlinks, which would
# strip zod and @modelcontextprotocol/sdk from an isolated pnpm layout.
(cd "$VENDOR_DIR/plugins/bitfab" \
  && pnpm install --prod --ignore-workspace --config.node-linker=hoisted)

echo "==> Installing into $CACHE_DIR"
mkdir -p "$CACHE_DIR"
rsync -a --delete "$VENDOR_DIR/plugins/bitfab/" "$CACHE_DIR/"

# bitfab-dev: the internal dev-workflow plugin (sync/ready/merge/close/...).
# Skills-only and script-driven (its skills shell out to repo-relative
# bitfab-internal/bitfab-dev/scripts/*), so there is no node_modules to vendor
# and no MCP server. It rides in the same stable shim marketplace as the bitfab
# plugin; the installed skill files route to the current session's worktree.
echo "==> Vendoring bitfab-dev into $VENDOR_DIR/plugins/bitfab-dev"
DEV_PLUGIN_SRC="$REPO_ROOT/bitfab-dev-codex-plugin"
if [ -d "$DEV_PLUGIN_SRC/skills" ] && [ -f "$DEV_PLUGIN_SRC/.codex-plugin/plugin.json" ]; then
  rm -rf "$VENDOR_DIR/plugins/bitfab-dev"
  mkdir -p "$VENDOR_DIR/plugins/bitfab-dev"
  rsync -a --exclude node_modules "$DEV_PLUGIN_SRC/" "$VENDOR_DIR/plugins/bitfab-dev/"
  echo "==> Replacing bitfab-dev skills with session-routed shims"
  node "$SCRIPT_DIR/build-skill-shims.mjs" \
    "$DEV_PLUGIN_SRC/skills" \
    "$VENDOR_DIR/plugins/bitfab-dev/skills" \
    bitfabDevRuntime

  echo "==> Adding bitfab-dev to $VENDOR_DIR/.agents/plugins/marketplace.json"
  node -e "
    const fs = require('fs');
    const p = '$VENDOR_DIR/.agents/plugins/marketplace.json';
    const mkt = JSON.parse(fs.readFileSync(p, 'utf8'));
    mkt.plugins = (mkt.plugins || []).filter((x) => x.name !== 'bitfab-dev');
    mkt.plugins.push({
      name: 'bitfab-dev',
      source: { source: 'local', path: './plugins/bitfab-dev' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
      category: 'developer-tools',
    });
    fs.writeFileSync(p, JSON.stringify(mkt, null, 2) + '\n');
  "

  echo "==> Installing bitfab-dev into $DEV_CACHE_DIR"
  mkdir -p "$DEV_CACHE_DIR"
  rsync -a --delete "$VENDOR_DIR/plugins/bitfab-dev/" "$DEV_CACHE_DIR/"
else
  echo "==> Skipping bitfab-dev (bitfab-dev-codex-plugin not built; run bitfab-plugin-lib build first)" >&2
fi

# bitfab-accounts: the internal sales-account plugin. Skills-only
# and driven entirely by the Notion MCP, with no worktree-relative scripts, so
# unlike bitfab-dev it needs no session-routed shims: the vendored skill content
# is identical across worktrees. Rides in the same stable shim marketplace.
echo "==> Vendoring bitfab-accounts into $VENDOR_DIR/plugins/bitfab-accounts"
ACCOUNTS_PLUGIN_SRC="$REPO_ROOT/bitfab-accounts-codex-plugin"
if [ -d "$ACCOUNTS_PLUGIN_SRC/skills" ] && [ -f "$ACCOUNTS_PLUGIN_SRC/.codex-plugin/plugin.json" ]; then
  rm -rf "$VENDOR_DIR/plugins/bitfab-accounts"
  mkdir -p "$VENDOR_DIR/plugins/bitfab-accounts"
  rsync -a --exclude node_modules "$ACCOUNTS_PLUGIN_SRC/" "$VENDOR_DIR/plugins/bitfab-accounts/"

  echo "==> Adding bitfab-accounts to $VENDOR_DIR/.agents/plugins/marketplace.json"
  node -e "
    const fs = require('fs');
    const p = '$VENDOR_DIR/.agents/plugins/marketplace.json';
    const mkt = JSON.parse(fs.readFileSync(p, 'utf8'));
    mkt.plugins = (mkt.plugins || []).filter((x) => x.name !== 'bitfab-accounts');
    mkt.plugins.push({
      name: 'bitfab-accounts',
      source: { source: 'local', path: './plugins/bitfab-accounts' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
      category: 'sales',
    });
    fs.writeFileSync(p, JSON.stringify(mkt, null, 2) + '\n');
  "

  echo "==> Installing bitfab-accounts into $ACCOUNTS_CACHE_DIR"
  mkdir -p "$ACCOUNTS_CACHE_DIR"
  rsync -a --delete "$VENDOR_DIR/plugins/bitfab-accounts/" "$ACCOUNTS_CACHE_DIR/"
else
  echo "==> Skipping bitfab-accounts (bitfab-accounts-codex-plugin not built; run bitfab-accounts-lib build first)" >&2
fi

echo "==> Publishing stable marketplace source to $STABLE_VENDOR_DIR"
mkdir -p "$STABLE_VENDOR_DIR"
rsync -a --delete "$VENDOR_DIR/" "$STABLE_VENDOR_DIR/"

echo "==> Registering marketplaces.$MKT_NAME with global production defaults"
node "$SCRIPT_DIR/codex-config.mjs" ensure-install "$CONFIG_TOML" "$STABLE_VENDOR_DIR" "$MKT_NAME"

echo "==> Verifying install"
node "$CACHE_DIR/dist/commands/status.js"

SOURCE_HASH_TMP="$SOURCE_HASH_STAMP.tmp.$$"
printf '%s\n' "$SOURCE_HASH" > "$SOURCE_HASH_TMP"
mv "$SOURCE_HASH_TMP" "$SOURCE_HASH_STAMP"

echo
echo "✅ Bitfab Codex dev build installed."
echo "   bitfab-dev and bitfab-accounts stay enabled in every checkout."
echo "   To activate the dev core: $PLUGIN_DIR/scripts/toggle.sh dev, then restart Codex."
