---
name: templates
description: "Iterate on Bitfab span-rendering templates. Use when the user wants to change how a traced function's spans are rendered in the Bitfab UI. The agent edits the org's global templates via MCP while the user previews against a real trace in the browser. Invoke with $bitfab:templates [<trace-function-key>]."
---

# Bitfab Templates

Open the chromeless **template-preview** page for one trace function and iterate on the org's global span-rendering templates with the user. Each round: the user describes what should look different, you call `mcp__Bitfab__get_template` → edit → `mcp__Bitfab__update_template`, and the user refreshes the preview to see the change rendered against a real trace. Loop until the user is satisfied.

**MCP tools:** This skill uses `list_trace_functions`, `get_template_reference`, `get_template`, and `update_template` from the **local plugin MCP server** (bundled with this plugin), exposed under the `mcp__Bitfab__*` prefix.

Templates control how a span's input / output renders in the Bitfab UI. They are scoped per **span type** (`llm`, `agent`, `function`, `guardrail`, `handoff`, `custom`) and apply across the org. Editing one template affects every trace that contains a span of that type, so surface this when the user asks for a change that's narrower than "change all llm spans look like X."

| Invocation | Action |
|---|---|
| `$bitfab:templates <key>` | Open the preview for the given trace function key, then iterate |
| `$bitfab:templates` | List trace functions, ask which one to preview, then iterate |

## 0. Resolve `BITFAB_PLUGIN_DIR`

Codex does not inject a plugin-root env var. Resolve it first (same block used by `setup` and `assistant`):

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

## 1. Resolve the trace function key

If the user passed a key as the argument, use it directly and continue.

Otherwise, follow the same picker pattern as `$bitfab:assistant`:

1. Call `mcp__Bitfab__list_trace_functions` to enumerate the org's traced functions. The tool returns flat `FUNCTION: <key>` lines; work from those keys directly. Use **only** the keys returned: do NOT invent or infer descriptions of what each function does from its name. Key names are often ambiguous, and guessing produces hallucinated summaries that confuse the user.
2. Grep this repo for each key in parallel (across `*.ts`, `*.tsx`, `*.py`, `*.rb`, `*.go`, `*.baml`) so you know which keys are instrumented here. Mark each as ✅ instrumented here (with file path) or ⚠️ not found in this repo.
3. Present a compact list in the question text showing only: `<key>` · `<repo marker + path>`. No invented summaries.
4. Ask the user with 2 options: the recommended function (prefer ✅ instrumented here, and matching session context when one is clearly relevant) and a free-text "Type a function key" option. If nothing is instrumented in this repo, say so explicitly in the question, don't hide it.

- **argument supplied** — use it as the trace function key and continue
- **no argument** — list trace functions, ask the user, then continue with the chosen key

## 2. Load the template reference

Call `mcp__Bitfab__get_template_reference` **once** before any edit. It returns a stable agent-facing schema for Bitfab span templates: the rendering engine (Nunjucks, Jinja2-compatible), the render-context shape (top-level keys, `SpanData` / `ParsedSpanData`), the registered custom filters and tests, common patterns from the live default templates, and error-fallback behavior. Without this you cannot write a correct edit; references to undeclared variables silently render empty in production.

Hold the reference in your working context for the rest of the loop. Do NOT call it again on subsequent edits.

## 3. Ground edits in the user's code

Before opening the preview, grep the codebase for the trace function key (`<key>`) so you can see what the function actually does. The user's "change" requests are usually about surfacing something domain-specific (an input field, a tool name, a context label), and knowing the function helps you map the request to the right span type and the right field path. If grep returns nothing (the function has been renamed or the user is operating on traces from a different repo), continue without it.

## 4. Open the chromeless template-preview page (background)

Launch the preview command **in the background** so the agent can keep iterating while the page stays open:

```bash
node "${BITFAB_PLUGIN_DIR}/dist/commands/startTemplatePreview.js" <functionKey>
```

Run this in a long-lived exec session (`exec_command` with `is_background: true`); capture the session id so you can `read` it between edit rounds to check whether it has exited.

The command **blocks until the user clicks the Close button on the page**, then exits 0 with a single line like `Template preview closed [via loopback]`. If the user instead just closes the browser tab without clicking Close, the process keeps running until the 30-minute timeout. The page auto-redirects to the most recent trace for the function and renders it with the org's current templates; the user refreshes after each edit to see the new render.

## 5. Edit loop: change → render → confirm (poll for Close)

Each round of the loop:

1. Ask what they want changed about the rendering. If the user names one of the six span types in their answer (`llm`, `agent`, `function`, `guardrail`, `handoff`, `custom`), use that. If they don't, ask which of the six span templates they want to edit before making any changes. Don't guess the span type from a description like "make this less verbose," since the same description fits multiple templates.
2. Call `mcp__Bitfab__get_template` for that span type to read the **live** content (database override if present, otherwise the system default file). **Always** read before write: the prior round may have edited the same template, and overwriting blindly drops that work.
3. Edit the returned source in-context. Stay inside the documented Nunjucks variables and filters (per the reference). Don't introduce `{% extends %}`; the assembler injects into `base.njk`'s content block, so extends will break composition.
4. Call `mcp__Bitfab__update_template` with the full edited body. The tool upserts the org's global override in place (no version bump, no row juggling).
5. Tell the user "Refresh the preview to see the change," in one short line. Do not paste the template body back into chat.

Before asking the user about another change, **check whether the background process from step 4 has exited**. The terminal signal is a line containing `Template preview closed` on stdout (the process exits 0 right after).

Use `read` against the captured exec session; the `Template preview closed` line on stdout means the user clicked Close and the session has exited.

Two ways the loop ends:

- **background process exited (user clicked Close)** — exit the loop and acknowledge that template editing is done
- **user explicitly says they're done** — exit the loop and acknowledge
- **user wants another change** — loop back and apply the next edit
