#!/usr/bin/env bash
#
# Switch the active Bitfab Codex plugin variant between dev and prod.
#
# Usage:
#   toggle.sh dev - build + install dev, flip enabled flags in config.toml
#   toggle.sh prod - flip enabled flags back to prod marketplace
#
# Prod assumes the bitfab marketplace is already registered
# (`codex plugin marketplace add Project-White-Rabbit/bitfab-codex-plugin`).

set -euo pipefail

variant="${1:-}"
case "$variant" in
  dev|prod) ;;
  *)
    echo "Usage: $(basename "$0") <dev|prod>" >&2
    exit 2
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
CONFIG_TOML="$CODEX_HOME/config.toml"
# Stable internal marketplace name, matching install-dev.sh.
MKT_NAME="bitfab-internal"

if [ "$variant" = "dev" ]; then
  "$SCRIPT_DIR/install-dev.sh"
fi

node "$SCRIPT_DIR/codex-config.mjs" toggle "$CONFIG_TOML" "$variant" "$MKT_NAME"

echo
echo "✅ Switched Bitfab Codex plugin to $variant. Restart Codex to pick it up."
