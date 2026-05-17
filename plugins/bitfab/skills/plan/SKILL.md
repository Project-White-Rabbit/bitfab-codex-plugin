---
name: plan
description: "Open the most recent Bitfab trace plan in the browser"
---

# Bitfab Plan

Open the user's most recent trace plan in the browser. This is the fast path: no codebase scan, no LLM calls, no instrumentation work — just look up the latest plan for the current Bitfab organization and open it in the studio.

Use this when the user wants to revisit, share, or re-confirm a plan they already created with `$bitfab:setup`. If they have not created any trace plans yet, the page will show a small empty state pointing them at `$bitfab:setup`.

A fresh agent session is created so the resulting `tracePlan:latestOpened` event lands in the Studio live activity stream for whoever is watching the home page.

## 0. Resolve `BITFAB_PLUGIN_DIR`

Codex does not inject a plugin-root env var. Resolve it first (same block used by `$bitfab:setup` and `$bitfab:update`):

```bash
if [ -z "$BITFAB_PLUGIN_DIR" ]; then
  BITFAB_PLUGIN_DIR=$(
    hit=$(find "${CODEX_HOME:-$HOME/.codex}/plugins/cache" -maxdepth 6 -type f -name status.js \
      \( -path '*/bitfab-internal/bitfab/local/dist/commands/*' \
      -o -path '*/bitfab/bitfab/*/dist/commands/*' \) 2>/dev/null | head -1)
    echo "${hit%/dist/commands/status.js}"
  )
  export BITFAB_PLUGIN_DIR
fi
test -n "$BITFAB_PLUGIN_DIR" || { echo "ERROR: Bitfab plugin not installed"; exit 1; }
```

## 1. Open the latest trace plan

Run the plugin's view-last-plan helper. It opens `/trace-plans/latest` in the browser, which the bitfab-web server resolves to the most recent trace plan for the user's organization and redirects to it. If no plans exist, the page shows an empty state.

```bash
node "${BITFAB_PLUGIN_DIR}/dist/commands/viewLastTracePlan.js"
```

The command exits as soon as the browser tab is launched — it does not wait for the user to confirm or cancel. After the command exits, simply acknowledge: "Opened your most recent trace plan." Do not poll or run any other commands.
