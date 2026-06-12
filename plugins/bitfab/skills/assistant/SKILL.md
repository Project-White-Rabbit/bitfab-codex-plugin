---
name: assistant
description: "Iterate on a traced function to improve pass rates using failed traces, labeling, and replay; also replays a single trace to check whether a fix worked. TRIGGER when: user wants to fix failing AI outputs, improve pass rates, debug LLM behavior, iterate on prompts, label traces, run experiments, benchmark or score a dataset against the current code, run a regression test, add a trace to a dataset, OR replay/re-run one specific trace to verify a change; says anything like 'fix my AI', 'improve pass rate', 'why is this failing', 'iterate on traces', 'debug my agent', 'review traces', 'benchmark my dataset', 'run my dataset as a benchmark', 'how does my code score on this dataset', 'evaluate the dataset without changing anything', 'add a trace to a dataset', 'attach traces to a dataset', 'replay this trace', 'rerun trace <id>', 'did my fix work', 'does this trace pass now', 'check if my change fixed <id>', 'show experiments for a dataset', 'list experiments that ran on this dataset', 'what experiments used dataset <id>', 'open the experiments for <dataset>'. SKIP when: user wants to instrument new code or set up tracing (use bitfab:setup instead)."
---

# Bitfab Assistant

Use the local plugin MCP tools (`mcp__Bitfab__list_trace_functions`, `mcp__Bitfab__search_traces`, `mcp__Bitfab__read_traces`, `mcp__Bitfab__update_agent_labels`, `mcp__Bitfab__list_datasets`, `mcp__Bitfab__create_dataset`, `mcp__Bitfab__add_traces_to_dataset`, `mcp__Bitfab__remove_traces_from_dataset`, `mcp__Bitfab__list_experiments`, `mcp__Bitfab__get_experiment_traces`) to find what's failing in a traced function, build a dataset of labeled traces, and iterate on the code/prompts using replay until pass rates improve.

**MCP tools:** This skill uses `list_trace_functions`, `search_traces`, `read_traces`, `update_agent_labels`, `list_datasets`, `create_dataset`, `add_traces_to_dataset`, `remove_traces_from_dataset`, `get_trace_plan`, `list_experiments`, and `get_experiment_traces` from the **local plugin MCP server** (bundled with this plugin), exposed under the `mcp__Bitfab__*` prefix.

**When the flow branches, always present the options clearly and wait for the user's answer before proceeding.** Number or letter the options so the user can pick by reference. Rules:

- Recommend an option first, explain why in one line
- Present 2-5 concrete options
- One decision per question — never batch

This skill has seven invocation modes, each a different entry point into the same pipeline. Four of them (`wizard`, `dataset`, `investigate`, `experiment`) converge: once they reach the shared phases (dataset → diagnose → experiments → wrap up), they follow the same path to the end. `benchmark`, `add-trace`, and `replay` are the exceptions — `benchmark` enters at the replay step, runs no diagnosis/experiments/wrap-up, and exits at a terminal scorecard; `add-trace` enters at its own phase, attaches the trace(s) to a dataset, and stops; `replay` enters its own self-contained phase for lightweight single-trace replay, runs entirely in-chat, and stops. The user can stop early at any decision point, but the default is to continue. Most sub-modes require the trace function key as the argument because they skip the function picker (Phase 1) and instrumentation/replay verification (Phase 2).

| Mode | Invocation | Action |
|---|---|---|
| `wizard` | `$bitfab:assistant`, `$bitfab:assistant wizard [<key>]`, or `$bitfab:assistant <key>` (`<key>` is a function key — a lone trace UUID is NOT a key and routes to `replay` instead) | Full flow: pick function → verify instrumentation → pick or create dataset → label → diagnose → iterate → wrap up |
| `investigate` | `$bitfab:assistant investigate [<key>]` | Free-form investigation of an issue the user is describing. Read traces and code as needed to characterize the problem, then offer to stop with a summary, write a written analysis report, or roll into dataset building and continue through experiments. `<key>` is optional, the agent picks the function from what the user says when it isn't given |
| `dataset` | `$bitfab:assistant dataset <key>` | Build or extend a labeled dataset for one function, then diagnose failures and iterate with experiments. Picks an existing dataset or creates a new one |
| `experiment` | `$bitfab:assistant experiment <key> [<dataset-id>]` | **Edits code** to fix failing traces, replays against a labeled dataset, and iterates. Use when the user wants to *change the code and see if it improves*. If `<dataset-id>` is omitted, you'll be asked to pick one. If the function has no datasets yet, run `$bitfab:assistant dataset <key>` first |
| `benchmark` | `$bitfab:assistant benchmark <key> [<dataset-id>] [studio]` | **No edits to the function under test.** Replay a labeled dataset against the current code as-is, evaluate each trace against its labels, and report a pass/fail scorecard, then stop. Use when the user wants to *measure the current code* (regression test, baseline, score after unrelated changes), not improve it. Infra fixes that unblock the replay (SDK / replay-script upgrade, `mockOnReplay` on a failing span) are allowed (they don't change the behavior being measured); what benchmark never does is make experiment-style edits to the traced function. If `<dataset-id>` is omitted, you'll be asked to pick one. **Terminal-only by default (no Studio).** Append the `studio` keyword to open Studio's experiments page and stream verdicts live as the replay runs |
| `add-trace` | `$bitfab:assistant add-trace [<key>] <trace-id...> [<dataset-id>]` | Lightweight: attach one or more existing traces to a dataset (pick or create one), then stop. No labeling, diagnosis, experiments, or Studio. `<key>` is **optional** — it's inferred from the traces when omitted, so `add-trace <trace-uuid>` (trace IDs only) is valid. The request can also be phrased in natural language (e.g. "add trace abc123 to a dataset") |
| `replay` | `$bitfab:assistant replay <key> <trace-id>` | Minimal single-trace replay, entirely in-chat: find the replay script, run it against one trace, report pass/fail in one line. No Studio/browser, no dataset, no labeling, no diagnosis, no server-side verdict persistence. For when you already made a fix and just want to know if it worked |

**Argument routing.** If the argument is free-form text (not a mode name or bare function key), infer the best mode and extract the trace function key if mentioned. A lone UUID with no mode keyword is a **trace ID, never a function key** — route it to `replay` (single trace, verify-a-fix), not `wizard`. Confirm your pick in one line before entering the flow (e.g. "Starting investigate for `generate-email`."). If you can't pick a single mode, ask as a numbered choice. Natural-language requests to attach a specific trace to a dataset (e.g. "add this trace to a dataset", "put trace abc123 in my dataset") route to `add-trace`; extract the trace IDs and any function key or dataset ID mentioned. In `benchmark` mode, a trailing `studio` token (e.g. `benchmark generate-email studio`) or a natural-language "with studio" / "open studio" sets the **Studio opt-in** for that run: strip it from the positional args before resolving the function key and dataset ID, and hold it as a working-context flag. It applies only to `benchmark` (every other mode always opens Studio). **When the opt-in is set, treat `studioMode` as true for the rest of the run** (Studio is open), so the **Studio activity** (`node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js"`) steps fire just as in the always-Studio modes; a terminal-only benchmark leaves `studioMode` false and those steps no-op.

**Disambiguating `benchmark` from `experiment`** (both replay a dataset, so free-form text is easy to misroute):

- Pick **`benchmark`** when the user wants to *measure the current code as-is*: "benchmark", "score", "baseline", "regression test", "how does it do right now", "evaluate the dataset without changing anything", "just run the dataset and tell me the pass rate". Benchmark makes **no edits to the traced function under test** and stops after the scorecard (it may still upgrade the SDK / replay script or add `mockOnReplay` to unblock the replay — those are infra, not the behavior being measured).
- Pick **`experiment`** when the user wants to *change the code and see if it improves*: "fix", "improve", "iterate", "try a prompt change", "make these traces pass". Experiment edits code and loops.

When in genuine doubt between the two, default to **`benchmark`** (it's non-destructive — no edits — and the user can roll into `experiment` afterward), but say which you picked and why in one line so they can redirect.

**Disambiguating `replay` from `experiment`** (both re-run one or more traces against the code, so free-form text is easy to misroute):

- Pick **`replay`** when the user wants to *re-run one specific trace and hear whether it's fixed/passing now*, with nothing persisted: a UUID (trace ID) appears in the message (alone or with a function key); verify-a-fix phrasing like "did my fix work", "does this trace pass now", "rerun/replay this trace", "check if my change fixed it", "is `<id>` good now"; or the message is scoped to a single trace and a change the user already made, with no mention of datasets, labeling, pass rates across many traces, or "experiments." `replay` is in-chat only and makes no edits of its own.
- Pick **`experiment`** when the user wants to *change the code and see if it improves a whole labeled dataset*: "fix", "improve", "iterate", "try a prompt change", "make these traces pass", "improve the pass rate", "run experiments on the failures." `experiment` edits code, replays a dataset, and loops.

When in genuine doubt between the two, default to **`replay`** if a single trace ID is present (it's the lighter, in-chat path and the user can roll into `experiment` afterward); otherwise default to **`experiment`**. Either way, say which you picked and why in one line so the user can redirect.

For `replay`, resolve its two arguments:

- **Function key:** use it if the user named it. If only a trace ID was given, you don't have to ask — Phase Replay's `setup` step reads the trace (`read_traces`), which returns the function key; derive it there.
- **Trace ID:** the UUID from the message.

In sub-modes that take a function key, grep the codebase for `<key>` early so labeling and experiments are grounded in the actual instrumented function (the full flow does this in Phase 2; sub-modes skip Phase 2 entirely). `investigate` mode does its own function lookup and code grep in Phase Investigate. `replay` mode does its own grep in Phase Replay's setup step. `add-trace` mode skips code grounding entirely — it never greps the codebase; it only resolves the trace's function key (via `read_traces` when not supplied) to scope the dataset.

**Studio** is the companion browser surface for the assistant flow. In every mode **except `benchmark`, `add-trace`, and `replay`** it opens automatically at the start and stays open throughout all phases, and individual phases navigate it to the relevant page (dataset review, experiment viewer, etc.). `add-trace` and `replay` are terminal-only and never open Studio. `benchmark` is terminal-only **by default** too, but opting in with the `studio` keyword opens Studio and navigates to the experiments page for this test run so verdicts stream in live as the replay runs.

**Opening a trace plan, when asked.** Opening trace plans is part of this skill, not a separate primitive — but only do it when the user asks (or the context clearly implies it, e.g. they said "show me what's captured"). Never auto-open. When triggered, run two sequential calls (step 2 needs the planId from step 1, so they can't be batched): (1) `mcp__Bitfab__get_trace_plan` with `{ traceFunctionKey: "<key>" }` returns the plan id, then (2) `openStudioTo.js "/studio/trace-plan/<planId>"` (substituting the id from step 1) routes Studio there in-place. The command finds an active session or opens a new one automatically. The Studio chrome (header, session indicator, agent activity) stays mounted around the trace plan content. No questions, no preamble, no summary up-front. If no plan exists for the key, say so in one line and offer `$bitfab:setup modify <key>` to build one.

**Opening a dataset's experiments, when asked.** Listing the experiments that have run against a dataset is part of this skill, not a separate primitive — but only do it when the user asks (e.g. "show experiments for dataset `<id>`", "what experiments ran on this dataset", "list experiments for `<name>`"). Never auto-open. **Establish the dataset first** (never open before the dataset is resolved): if the user gave a dataset UUID, use it; if they named a dataset or gave only a function key, call `mcp__Bitfab__list_datasets` to resolve it, and ask the user so the user can pick when more than one matches. Then run `node "${BITFAB_PLUGIN_DIR}/dist/commands/openStudioTo.js" "/studio/experiments?datasetId=<datasetId>"` (substituting the resolved id) to route Studio there in-place. When the ask is about token usage or cost (the user frames it around cutting tokens/cost or a token budget), append `&tokens=1` to that URL (`...?datasetId=<datasetId>&tokens=1`) so the token-cost lens shows the original → replay total-token trend per experiment; omit it otherwise (opt-in, not the default). The page lists every experiment (test run) that replayed a trace belonging to the dataset (derived server-side from the shared traces, so it covers past runs too). The command finds an active session or opens a new one automatically. No preamble or summary up-front; confirm in one line, identifying the dataset by name when known and id otherwise. If the dataset has no experiments yet, the page says so — offer `$bitfab:assistant experiment <key> <datasetId>` or `$bitfab:assistant benchmark <key> <datasetId>` to run one.


🚨 **Blocking-process rule (applies to any plugin command described as "blocks until the user does X"):** When you launch a plugin CLI that blocks on a Studio interaction (`login.js`, etc.), you MUST keep the exec session alive and keep polling it until the process exits on its own.

- The process opens Studio (or navigates an existing Studio session) and polls for the user's action via agent session events. It exits only after the user completes the action in Studio (or after the timeout).
- After launching the command, keep polling the live shell/exec session at least every few seconds with your normal "read more output" tool (`write_stdin`, `read`, or whatever your runtime's equivalent is for the long-running shell). Do not idle waiting for a user message.
- Do not send a final "waiting for you to click Confirm" text and then stop polling; the user's confirmation does NOT come back to you as a chat message; it comes back as the plugin process exiting with output on stdout.
- Stop polling only when one of: (a) the process exits 0 and prints its completion summary, (b) the process exits non-zero, or (c) the user explicitly cancels.
- When the process exits, immediately continue with the next step in the flow, do not wait for another user message.

**CLI commands** available via Bash (all paths relative to `${BITFAB_PLUGIN_DIR}/dist/commands/`):

| Command | Description |
|---------|-------------|
| `status.js` | Check plugin authentication and connection status |
| `openStudioTo.js <path>` | Navigate an existing Studio session or open a new one at the given path |
| `pushActivity.js {action} "{displayName}"` | Emit activity events to the Studio sidebar |
| `persistReplayLabels.js <verdicts-file>` | Persist replay verdicts from a JSON file to Bitfab via MCP |
| `closeStudio.js [message]` | Close the active Studio session (tab + background event process); no-op when nothing is open |
| `clearStudioSession.js` | Clear the stale active-Studio pointer so the next open starts fresh |

## Phase 0: Setup

**Run only when mode is `wizard`, `dataset`, `experiment`, `investigate`, `benchmark` or `replay`.**

0. First, resolve `BITFAB_PLUGIN_DIR` if it isn't already exported in this shell. Run this block verbatim — it auto-detects dev / prod / custom-`CODEX_HOME` installs:

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
1. Run the status command to check for plugin updates:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/status.js"
   ```

   If a `v<X> available` upgrade notice appeared, pass it through to the user verbatim, but don't block on it; surface the notice once and move on. Ignore the authentication status (Studio handles login inline).

## Studio Lifecycle

**Run only when mode is `wizard`, `dataset`, `experiment`, `investigate` or `benchmark`.**

The Studio is the companion browser surface for the assistant flow. In every mode that uses it, it opens once at the start and stays open throughout all phases, with individual phases navigating it to the relevant page (dataset review, experiment viewer, etc.) using `openStudioTo.js`. **`benchmark` is the exception:** it opens Studio only when the run passed the `studio` opt-in. A terminal-only `benchmark` run (no `studio` keyword) opens no Studio at all, and the `open` step below self-skips for it.

**`openStudioTo.js` handles session resolution automatically.** It takes a single `<path>` argument and reads auth from your local config. The active Studio session is the single source of truth on disk:
1. If an active session is recorded, it navigates that window to the path and reuses it.
2. If none is recorded, it opens a **new** Studio window at the path.

It never opens a second window while a session is recorded: it either reuses it or gates. A clean tab close or a deliberate end clears the record, so the next open is simply a fresh window.

Output events:
- `{"event":"navigated","sessionId":"...","path":"..."}` — reused an existing session.
- `{"event":"started","sessionId":"..."}` — opened a new Studio window.
- `{"event":"not-responding","sessionId":"..."}` — a recorded session exists but the window did not respond (the navigation retries via ping-pong before reporting this, so the tab was pinged twice and never answered). **Every** Studio-opening command emits this on a stale session (`openStudioTo.js` and the dataset/experiment/trace-plan commands alike), and none of them opens a duplicate window. **This is a gate.** Recommend the user refresh or reopen the Studio tab in their browser, then ask the user with two options: **Try again** (re-run the command that gated — the record is still on disk, so a window that came back gets reused) or **Open a new Studio** (run `node "${BITFAB_PLUGIN_DIR}/dist/commands/clearStudioSession.js"` to drop the stale record, then re-run the command, which now opens a fresh window). Only clear the record after the user approves.
- `{"event":"open-failed","sessionId":"...","reason":"..."}` — failed to open a new Studio. Surface the error.

The gate fires only when a recorded window went unreachable with **no close signal** — a crash, sleep, or a tab close no process witnessed. A cleanly closed or deliberately ended session leaves no record, so the next open just opens fresh (no handshake, no prompt).

**Never use Playwright, `open`, `chrome-testing`, or any other browser automation to open Studio pages.** Always use `openStudioTo.js` which handles auth and session management.

1. **In `benchmark` mode, first check the Studio opt-in flag** (set during argument routing when the `studio` keyword was passed). If benchmark did NOT opt in, skip this entire step without running any command and continue to `phase-5/pick-dataset`. In all other modes, and in `benchmark` with the `studio` flag, proceed.

   Open Studio at the initial path for this mode. `openStudioTo.js` is the single entry point for all Studio operations: it navigates an existing session or opens a new one automatically.

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/openStudioTo.js" <path> --monitor
   ```

   The command resolves this agent's active session on its own and reads auth from local config — no session id or credentials to pass.

   **The `--monitor` flag is load-bearing and belongs ONLY on this step.** This is the one step that establishes the durable event loop for the whole run. `--monitor` makes it the single monitor whether it opens a fresh window OR reuses one left over from a prior run — without it, reusing an existing window would navigate-and-exit and the run would have NO monitor, silently missing Done / Edit-with-agent / session-ended. Every later `node "${BITFAB_PLUGIN_DIR}/dist/commands/openStudioTo.js"` call (dataset page, experiments page, trace plans) is a plain navigation: omit `--monitor` so it fires-and-exits instead of spawning a duplicate poller.

   **The path MUST start with `/studio`.** Never pass `/`, a bare URL, or any path outside the `/studio/` route tree.

   - **`wizard` mode:** pass `/studio`
   - **`dataset <key>` mode:** pass `/studio` (Phase 3's "Open the dataset review page" step navigates to the chosen dataset's own page once the datasetId is held; there is no function-level dataset page)
   - **`experiment <key>` mode:** pass `/studio`
   - **`investigate [<key>]` mode:** pass `/studio`
   - **`benchmark <key>` mode:** only when the run opted in with the `studio` keyword (the working-context flag from argument routing): pass `/studio`. Without the flag, benchmark is terminal-only: do NOT run `openStudioTo.js` at all, skip straight to `phase-5/pick-dataset` (the step's `next` already routes there)

   `replay` mode never reaches this step (it runs entirely in-chat with no Studio session) — see Phase Replay.

   With `--monitor` this command enters an event loop and stays running for the whole session — whether it opened a fresh window or reused an existing one. Run it via your runtime's "long-running exec session" mechanism. It is the single backgrounded process for the run; the later navigation steps (without `--monitor`) exit immediately.

   The script outputs JSON lines on stdout (see the Studio Lifecycle intro for the full event reference):

   - `{"event":"started","sessionId":"..."}` — new Studio opened. The session is written to disk; all subsequent `openStudioTo.js` and `pushActivity.js` calls resolve it automatically. You do not need to track the sessionId.
   - `{"event":"navigated","sessionId":"...","path":"..."}` — navigated an existing session.
   - `{"event":"auth-required","sessionId":"..."}` — user needs to sign in. Wait for `authenticated`.
   - `{"event":"authenticated","sessionId":"..."}` — user signed in. Continue.
   - `{"event":"session-ended","sessionId":"..."}` — user closed Studio. Process exits.

   Status messages go to stderr. Filter to JSON lines only.

   **Recovering after compaction:** Automatic. `openStudioTo.js` and `pushActivity.js` read the active-session file on disk.

## Phase 1: Identify the Trace Function

**Run only when mode is `wizard`.**

If a `traceFunctionKey` was provided as an argument, skip the listing and the user prompt — but still cross-check the provided key against the local codebase before moving on. Otherwise, work through all four steps below:

1. **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" started "Identifying trace function"`.

   **Skip this step if a `traceFunctionKey` argument was provided** — use the argument directly and continue to cross-check. Otherwise, call `mcp__Bitfab__list_trace_functions` to list all available trace functions. Use **only** the keys and metadata returned (trace counts, last activity) — do NOT invent or infer descriptions of what each function does from its key name. Key names are often ambiguous or misleading, and guessing produces hallucinated descriptions that confuse the user.
2. **Cross-check each key against the local codebase** before presenting. For each returned key, `grep` the repo for string-literal uses of that exact key (across `*.ts`, `*.tsx`, `*.py`, `*.rb`, `*.go`, `*.baml`). Mark each function in the presented list as:

   - **✅ instrumented here** — found in this repo, with the file path
   - **⚠️ not found in this repo** — traces exist on Bitfab but the key isn't in this codebase (likely another repo or a renamed key)
3. **Skip this step if a `traceFunctionKey` argument was provided** — there's no list to present. Otherwise, present the full list in the question text showing ONLY: `<key>` · `<trace count>` · `<last activity>` · `<instrumented-here marker + path, or not-found marker>`. No invented summaries.
4. **Skip this step if a `traceFunctionKey` argument was provided** — the function is already chosen. Otherwise, ask the user with 2 options: the recommended function (prefer one that is ✅ instrumented here AND has recent activity) and a free-text "Type a function key" option. If nothing is instrumented here, say so explicitly in the question — don't hide it.

## Phase 2: Verify Instrumentation & Replay

**Run only when mode is `wizard`.**

Check that this trace function has both instrumentation and a replay script.

1. **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" started "Verifying instrumentation"`.

   Search the codebase for the trace function key to confirm SDK usage:

   - TypeScript: `grep -r "<traceFunctionKey>" --include="*.ts" --include="*.tsx"`
   - Python: `grep -r "<traceFunctionKey>" --include="*.py"`
   - Ruby: `grep -r "<traceFunctionKey>" --include="*.rb"`
   - Go: `grep -r "<traceFunctionKey>" --include="*.go"`

   If the key is found, note the file location — this is the code you'll iterate on in later phases.

   If the key is NOT found in the codebase, the function is instrumented elsewhere (the traces exist on Bitfab). Ask:

   > "I can't find `<traceFunctionKey>` in this codebase — it may be instrumented in another repo or under a different key."
   >
   > A) **Instrument now** — set up tracing in this codebase *(recommended)* → step 1 of the Cleanup phase
   > B) **Continue anyway** — work with the traces even without local code → step 1 of the Phase 3: Pick a Dataset and Label Traces phase
   > C) **Pick a different function** → step 1 of the Phase 1: Identify the Trace Function phase
   > D) **Stop** → step 1 of the Cleanup phase

   If the user chooses **"Instrument now"**, tell the user to run `$bitfab:setup instrument` first, then come back with `$bitfab:assistant wizard <key>`. Do NOT invoke the setup skill from within this flow; it will break the assistant flow's continuity. If **"Continue anyway"**, skip the replay-script check and start building the dataset — there's no local code to iterate on yet.
2. Search for a replay script that covers this trace function:

   - Look for files matching `scripts/replay.*`, `scripts/*replay*`, or any file that imports `bitfab.replay` / `client.replay`
   - Read the script and check that it maps the target trace function key

   If a replay script exists but targets a different function key, do NOT modify the existing script or suggest changing the code's function key. Instead, treat it as "no replay script for this function" and offer to create a new one.

   If no replay script exists or it doesn't cover this function, ask the user:

   > "No replay script found for `<traceFunctionKey>`."
   >
   > A) **Create replay now** — create the replay script inline *(recommended)* → step 3
   > B) **Pick a different function** → step 1 of the Phase 1: Identify the Trace Function phase
   > C) **Stop** → step 1 of the Cleanup phase

   If the user chooses **"Create replay now"**, create the replay script inline: fetch the SDK replay reference (`https://docs.bitfab.ai/reference/typescript#replay` or the equivalent for the project language) and the script template (`https://docs.bitfab.ai/typescript-sdk#replay`), then write a new replay script following the template. The script must accept `--limit N`, `--trace-ids`, `--code-change <path>`, and `--experiment-group-id <uuid>` flags, and emit the full `ReplayResult` as JSON to stdout per the Replay Output Contract. Do NOT invoke `$bitfab:setup replay` as a separate skill. After creating the script, check its capabilities.

   **Handler-instrumented keys (no decorated root function) are replayable too.** If the key is registered via a framework handler (`get_langgraph_callback_handler("key")`, `get_claude_agent_handler("key")`, or the TS equivalents) rather than `@span`/`withSpan`, follow the docs' "Replaying handler-instrumented functions" section: pass the handler's key plus a plain callable to `replay()` (the SDK wraps it internally), re-invoking the framework entrypoint with a freshly constructed environment (safe no-op substitutes for billing callbacks and other side-effectful wiring). On SDKs that predate explicit-key replay, wrap the callable under the same key yourself. Never report a handler-instrumented function as not replayable.
3. **Detect replay script capabilities.** Check what the replay script supports. These flags determine how experiment results are tracked and displayed in Phase 5. **If you already ran this step for the same trace function earlier in this session, skip it and continue. Re-run if the user switched functions via "Pick a different function".**

   **1. Use the replay script located in the previous step** (or grep for `scripts/replay.*` / files importing `bitfab.replay` / `client.replay`).

   **2. Grep the replay script for these capabilities:**

   | Grep for | Flag | What it enables |
   |----------|------|-----------------|
   | `code-change` or `code_change` | `supportsCodeChanges` | Code diffs attached to each experiment in the dashboard |
   | `experiment-group-id` or `experiment_group_id` | `supportsExperimentGroups` | Live streaming of results in Studio as replay runs |
   | `traceId` or `trace_id` in the output/print section | `supportsReplayTraceIds` (verified against the SDK `.d.ts` in step 3, re-confirmed post-replay) | Verdict persistence, cross-iteration comparison, Studio experiments page |

   `supportsInputAdapters` is **not** a script-grep flag (the script gains an `adaptInputs` / `adapt_inputs` argument only after a signature actually drifts, in `adapt-replay-inputs`). It is determined SOLELY by the installed SDK in step 3 below.

   **3. Verify the installed SDK actually supports the detected flags.** The replay script may accept flags that the installed SDK silently ignores. Check the actual SDK dist (not the script) for each capability:
   - For `supportsExperimentGroups`: grep the installed SDK's replay JS file (e.g. `node_modules/.pnpm/@bitfab+sdk@*/node_modules/@bitfab/sdk/dist/replay-*.js`) for `experimentGroupId`. If absent, the SDK drops the option silently.
   - For `supportsCodeChanges`: grep the same file for `codeChangeDescription` or `code_change_description`.
   - For `supportsReplayTraceIds`: grep the installed SDK's **type declaration** for a `traceId` field on the `ReplayItem` interface — `grep -A3 "interface ReplayItem" node_modules/.pnpm/@bitfab+sdk@*/node_modules/@bitfab/sdk/dist/index.d.ts` (or `node_modules/@bitfab/sdk/dist/index.d.ts`). If `ReplayItem.traceId` is **absent**, the installed SDK does not surface replay trace IDs (the per-item mapping was added in a later release, e.g. 0.13.4 lacks it, 0.13.6 has it) — mark `supportsReplayTraceIds` **false**. This is a definitive **pre-replay** signal; the later `check-trace-id-support` step still re-confirms from the actual replay output.
   - For `supportsInputAdapters`: grep the installed SDK for the `replay()` option: `grep "adaptInputs" node_modules/.pnpm/@bitfab+sdk@*/node_modules/@bitfab/sdk/dist/index.d.ts` (TS), or `adapt_inputs` in the installed `bitfab/replay.py` (Python) / the installed gem's `replay.rb` (Ruby). If absent, the SDK predates the input-adapter hook; mark `supportsInputAdapters` **false**. The replay script needs no pre-wiring for this: an adapter (its own file + an import) is added only when a signature actually drifts, in the `adapt-replay-inputs` step (Phase 5).

   If the replay script has a flag but the installed SDK does not support it, mark that flag as **false**. Prioritize upgrading the SDK over using fallbacks — without replay trace IDs, verdict labels can't be persisted (benchmark/experiment results stay in-agent only).

   **4. Route on the result.**

   If all flags are true, skip the question and continue silently.

   If one or more flags are false, tell the user which capabilities are missing and what they affect, then ask the user. List the missing capabilities in the question text:

   > "Your replay script is missing support for:
   >
   > [if !supportsCodeChanges] **Code changes**: edits won't appear in the experiment dashboard
   > [if !supportsExperimentGroups] **Experiment groups**: no live streaming; results appear in Studio after each run
   > [if !supportsReplayTraceIds] **Replay trace IDs**: experiment results can't be persisted or compared across iterations (your SDK needs an upgrade)
   >
   > [if !supportsInputAdapters] **Input adapters**: replay can't recover traces when the function's signature drifts after capture (fixed by upgrading the SDK)"

   > A) **Upgrade the replay script** — regenerate the script with full support, then continue *(recommended)* → step 4
   > B) **Continue without** — run experiments with the current script; missing features are skipped → step 6 of the Phase 5: Iterate with Replay phase (mode `experiment`); step 7 of the Phase 5: Iterate with Replay phase (mode `benchmark`); stop (mode `add-trace`); step 1 of the Cleanup phase (mode `replay`); otherwise step 1 of the Phase 3: Pick a Dataset and Label Traces phase
4. **Upgrade the SDK and replay script.** The replay script references SDK APIs (`experimentGroupId`, `codeChangeDescription`, per-item `traceId`, `adaptInputs` / `adapt_inputs`) that require a recent SDK. Upgrade the SDK first, then regenerate the script.

   **1. Upgrade the SDK.** Read the resolved version from the lockfile (`pnpm-lock.yaml`, `poetry.lock`, `uv.lock`, `Gemfile.lock`) and compare against the latest. If outdated, run the package manager's update command:
   - TypeScript: `pnpm update @bitfab/sdk` (in monorepos, scope with `--filter <pkg>`). **If `package.json` pins an exact version (e.g. `"@bitfab/sdk": "0.13.4"` with no `^`/`~`), `pnpm update` will NOT move past the pin — bump the spec in `package.json` to the target version first (e.g. `"@bitfab/sdk": "0.13.6"`), then `pnpm install`.**
   - Python: `uv lock --upgrade-package bitfab-py && uv sync` or `poetry update bitfab-py`
   - Ruby: `bundle update bitfab --conservative`

   If the SDK is on a legacy package name (e.g. `bitfab` instead of `@bitfab/sdk`), remove the old package and install the new one. Skip this step if the SDK is already at the latest version.

   **2. Regenerate the replay script.** Locate the replay script for this trace function (found in `detect-replay-capabilities`). Fetch the SDK replay reference (`https://docs.bitfab.ai/reference/typescript#replay` or the equivalent for the project language) and the script template (`https://docs.bitfab.ai/typescript-sdk#replay`). Then edit the script to add the missing flags:
   - **`--code-change <path>`**: parse the JSON file, pass `codeChangeDescription` and `codeChangeFiles` to `replay()`
   - **`--experiment-group-id <uuid>`**: pass `experimentGroupId` to `replay()`
   - **Replay Output Contract**: emit the full `ReplayResult` as one `JSON.stringify(result, null, 2)` block to stdout (including every item's `traceId`, `durationMs`, `tokens`, `model`). Human-readable summary goes to stderr.
   Do NOT invoke `$bitfab:setup replay` as a separate skill; edit the script inline here.

   **3. Re-check capabilities.** After editing, re-check against the **installed SDK dist** (not just the script): grep the replay JS for `experimentGroupId` / `codeChangeDescription`, grep the SDK `.d.ts` for `ReplayItem.traceId` (the authoritative replay-trace-ID signal), and grep the SDK for `adaptInputs` / `adapt_inputs` (the input-adapter hook). Update the flags in working context. If any are still missing after both upgrades, note it but continue.

## Phase Investigate: Free-form Investigation

**Run only when mode is `investigate`.**

Reached only from `investigate` mode. The user is describing an issue they want to understand (a customer complaint, a suspected failure pattern, a regression, or an open-ended "is something off with this function" question). Read traces and code as needed to characterize the problem, then hand the user a choice: stop with the in-chat summary, write a markdown analysis report, or roll into building a labeled dataset (Phase 3).

1. Read what the user typed when they invoked `$bitfab:assistant investigate`. Two cases:

   - **They passed a function key as the argument:** use it. Call `mcp__Bitfab__list_trace_functions` once to confirm the key exists and capture trace count + last activity for the explore step. Then grep the codebase for the key (`grep -r "<key>" --include="*.ts" --include="*.tsx" --include="*.py" --include="*.rb" --include="*.go" --include="*.baml"`) and note the file path. Hold both in working context.
   - **They didn't pass a key:** read their description (failure pattern, customer complaint, "something seems off with X", etc.). Call `mcp__Bitfab__list_trace_functions` to see what exists. If exactly one function obviously matches the description by key + recent activity, use it (and grep for it). If several plausibly match, ask the user to pick one (recommend the best fit; list 2-4 alternatives by key, trace count, last activity). If nothing matches, ask the user to clarify or pass a key explicitly.

   Do NOT invent or infer descriptions of what each function does from its key name. Use only what `mcp__Bitfab__list_trace_functions` returns plus what's in the codebase.
2. Free-form investigation: use whatever combination of MCP and local tools fits the user's described concern. There is no fixed sequence. Typical moves:

   - **Trace evidence:** call `mcp__Bitfab__search_traces` with filters that match the user's description (failure shape, recency, label state, user / session if mentioned), then `mcp__Bitfab__read_traces` with `scope: "summary"` or `scope: "full"` on the most informative ones.
   - **Code context:** read the instrumented function and its call chain. If BAML files, related prompts, or upstream / downstream functions matter to the question, read those too.
   - **Quantify if useful:** if the user asked something like "how often does X happen", run targeted `mcp__Bitfab__search_traces` calls with different filters to count.

   Stop exploring once you can give the user a clear, evidence-backed account: what's going wrong (or "nothing obvious is going wrong"), when, how often, what the failure shape is, what code path is implicated, and one or two leading hypotheses. Hold the findings in working context for the next step. Cite specific trace IDs and code locations rather than vague summaries.
3. Share the findings inline with the user first, in chat, structured roughly as:

   > **What I looked at:** `<traceFunctionKey>` · `<N traces examined>` · `<filter criteria used>`
   >
   > **What I found:**
   >
   > - [Finding with cited trace IDs / code locations]
   > - [Finding with cited trace IDs / code locations]
   >
   > **Leading hypotheses:**
   >
   > - [Hypothesis, what would confirm it]

   Then ask the user for the next step. Recommend based on what the investigation surfaced: option C (dataset) if the findings include reproducible failures worth labeling and iterating on, option B (report) if the user will need to share or revisit the findings later, option A (stop) if the question was a one-off and the chat summary already answers it.

   > A) **Stop here** — the in-chat summary is enough; no further artifact → step 1 of the Cleanup phase
   > B) **Write an analysis report** — save the findings to a markdown file I can share or revisit later → step 4
   > C) **Build a labeled dataset** — use these traces as seed candidates and label them so we can iterate against them later *(recommended)* → step 1 of the Phase 3: Pick a Dataset and Label Traces phase

   Options A and B end at the cleanup step, which closes Studio and stops its background process. Option C continues through dataset building, diagnosis, and experiments, with Studio staying open throughout until cleanup at wrap-up.
4. Write a markdown report capturing the investigation. Path: `.bitfab/analysis/<traceFunctionKey>-<YYYY-MM-DD-HHmm>.md` (create the `.bitfab/analysis/` directory if missing; fall back to a path under the repo root or `os.tmpdir()` if the project root isn't writable). Use the `Write` tool with this structure:

   ```markdown
   # Investigation: <traceFunctionKey>

   **Date:** <YYYY-MM-DD>
   **Question / concern:** <one-paragraph recap of what the user asked>

   ## What I looked at

   <filters used, trace counts, time window>

   ## Findings

   <bulleted findings, each citing trace IDs and code locations>

   ## Leading hypotheses

   <bulleted, each paired with what would confirm or refute it>

   ## Recommended next steps

   <concrete actions: build a dataset around hypothesis X, instrument span Y, ship a code fix for Z, etc.>
   ```

   After writing, tell the user the file path so they can open or share it, then stop (the cleanup step closes Studio). Do NOT roll into dataset building automatically; that is option C, not option B.

## Phase Add: Attach a Trace to a Dataset

**Run only when mode is `add-trace`.**

Reached only from `add-trace` mode. This is the lightweight path: attach one or more existing traces to a dataset (picking or creating one), then stop. No labeling, no diagnosis, no experiments, and **no Studio** — this mode never opens the Studio browser surface and runs no plugin CLI commands. The traces attach **raw**; the user labels and approves them later wherever they review datasets.

1. **Resolve what to attach and where.** The user invoked `$bitfab:assistant add-trace`, either with the signature `add-trace [<key>] <trace-id...> [<dataset-id>]` (the leading `<key>` is optional) or in natural language (e.g. "add trace abc123 to a dataset"). **Tokens are typed, not positional:** a UUID is always a trace ID (or, only when the user explicitly calls it the dataset, the `<dataset-id>`); a non-UUID slug is the function key. So `add-trace <trace-uuid>` is a trace-only invocation — never treat a bare UUID as a function key, and never conclude "no trace IDs were given" just because no slug preceded them. Parse out three things:

   - **Trace IDs** — one or more. Trace IDs are UUIDs. If you can't identify at least one, ask the user for the trace ID(s) and wait — do not guess.
   - **Trace function key** — the non-UUID slug, if the user gave one. Datasets are scoped per function, so the key is required and **all trace IDs in the batch must belong to the same function** (`mcp__Bitfab__add_traces_to_dataset` silently skips IDs whose function key doesn't match the dataset, so a mixed batch would partially fail with no obvious error). Resolve and verify the key up front:
     - Call `mcp__Bitfab__read_traces` with `scope: "summary"` on **every** trace ID in the batch, not just the first (batch in groups of 10 — the tool's per-call cap — for larger sets), and read each trace's `traceFunctionKey`.
     - **If all traces share one key:** use it. (If the user also supplied a `<key>` and it disagrees with what the traces report, trust the traces' key and note the discrepancy in one line.)
     - **If the traces span more than one function key:** stop and ask the user — list the distinct keys and which trace IDs map to each, and ask the user which single function's traces to attach (the others are dropped this run, since one `add-trace` invocation targets one function's dataset). Do not attach a mixed batch.
   - **Dataset ID** — optional. If the user named a specific dataset (a UUID they identify as the dataset, not a trace), hold it for the next step.

   Hold the (single, verified) function key, the trace IDs that belong to it, and any dataset ID in working context. Do **not** grep the codebase — this mode never touches local code.
2. **Pick or create the dataset to attach to.** If no dataset ID was supplied, call `mcp__Bitfab__list_datasets` with the function key first. Hold the chosen `datasetId` in working context.

   - **a dataset ID was supplied in the invocation** — use it directly, but first confirm it's scoped to the verified function key — call `mcp__Bitfab__list_datasets` with the key and check the supplied id is in the result. If it is, continue to attach. If it isn't (the dataset belongs to a different function, so `mcp__Bitfab__add_traces_to_dataset` would skip every trace), stop and ask the user — name the mismatch and offer to pick a correctly-scoped dataset instead → step 3
   - **no datasets exist for this function (`list_datasets` returned empty)** — **don't ask** — silently call `mcp__Bitfab__create_dataset` with `traceFunctionKey: <key>` and `name: <key>`. Hold the returned `datasetId` and continue → step 3
   - **one or more datasets already exist** — present them as a numbered choice, one option per existing dataset (name · id · current trace count) plus a "Create new" option. Recommend the most recently used dataset that has traces. On an existing pick, hold its id. On "Create new", silently call `mcp__Bitfab__create_dataset` with `name: "<key> #N"` (N one more than the existing count) — don't ask for a name. Hold the id and continue → step 3
3. **Attach raw, then stop.** Call `mcp__Bitfab__add_traces_to_dataset` once with the `datasetId` from the previous step and the full array of trace IDs. The call is idempotent, so re-attaching IDs already in the dataset is a safe no-op. Do **not** call `mcp__Bitfab__update_agent_labels` — this mode attaches traces without labels.

   **Report the tool's actual result, not the input count.** `mcp__Bitfab__add_traces_to_dataset` returns how many traces were added vs skipped (IDs not in the org, or not on the dataset's function, are silently skipped). Read those counts from the response and report the **added** count, not `N = trace-IDs-you-passed`. If any were skipped, say so in the same line (e.g. "2 added, 1 skipped — not on this function").

   Then tell the user in one line, identifying the dataset by its `datasetId` (always known) and including its name only when you have one: "Added `<added>` trace(s) to dataset `<datasetId>``<skipped-note>`." (When a name is available — from `list_datasets`, or the `<key>`/`<key> #N` you just created it with — use "Added `<added>` trace(s) to dataset `<name>` (`<datasetId>`)." On the supplied-dataset-ID path you called `list_datasets` to validate scope, so its name is available too.) This is the end of the lightweight `add-trace` flow: no labeling, no diagnosis, no experiments, and **no Studio**. Do not open a browser or run any `openStudioTo.js` / `closeStudio.js` (or other plugin CLI) command.

## Phase 3: Pick a Dataset and Label Traces

**Run only when mode is `wizard`, `dataset` or `investigate`.**

A **dataset** is the named bucket of labeled traces an experiment replays against. This phase picks (or creates) one for the trace function, labels candidate traces, attaches them to the dataset, then hands off to the per-dataset review page where the user approves labels and can ask the agent to add or remove traces.

In `dataset` mode this phase is the entry point — Phase 1 (function picker) and Phase 2 (instrumentation/replay verification) are skipped, so the trace function key comes from the argument. Before calling any MCP tools, grep the codebase for the key (e.g. `grep -r "<traceFunctionKey>" --include="*.ts" --include="*.tsx" --include="*.py" --include="*.rb" --include="*.go" --include="*.baml"`) and note the file path — every later step ("Label them yourself", and Phase 4 "Read the code" in `wizard` mode) needs it.

1. **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" started "Building dataset"`.

   **Pick or create a dataset** — Call `mcp__Bitfab__list_datasets` with the trace function key. Then branch on whether any exist. Hold the chosen `datasetId` in working context — every step from here on uses it.

   - **no datasets exist for this function (list_datasets returned empty)** — **don't ask** — silently call `mcp__Bitfab__create_dataset` with `traceFunctionKey: <key>` and `name: <key>` (just the trace function key as the name; the user can rename it later in the UI if they want). Hold the returned `datasetId` and continue. The first-time user shouldn't have to answer a name prompt before they've even seen the dataset. → step 2
   - **one or more datasets already exist** — present them to the user as a numbered choice, with one option per existing dataset (name · id · current trace count) plus a "Create new" option. Recommend the most recently used dataset that has traces. If the user picks an existing dataset, hold its id and continue. If the user picks "Create new", silently call `mcp__Bitfab__create_dataset` with `name: "<key> #N"` where N is one more than the number of existing datasets (e.g. `eval-assistant #2`) — don't ask for a name. Hold the new id and continue. → step 2
2. **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" started "Reviewing dataset"`.

   Open the dataset review page for the user **immediately** after picking or creating the dataset.

   **First, derive the function's current input shape** so the page can flag traces that won't replay against today's code (the dataset rows and trace detail show a "Can't replay" badge when a trace's recorded inputs no longer fit the current signature). Find the function registered under `<functionKey>` in the codebase (the value passed to `getFunction(...)` / the traced function), read its parameters, and build a compact JSON shape:

   ```json
   {"fields":[{"name":"query","type":"string"},{"name":"limit","type":"number","required":false}]}
   ```

   - `name`: each top-level input field — for a single object argument, its keys; for positional params, the parameter names.
   - `type` (optional): one of `string` / `number` / `boolean` / `object` / `array` / `null` / `unknown`. Omit if unsure.
   - `required` (optional): defaults to true; set `false` for optional params.

   This is best-effort. If you can't confidently determine the shape (no clear signature, dynamic args), **skip it** and open the bare path — the page falls back to flagging only traces that captured no inputs. Never block or ask the user about this.

   Then base64-encode the shape and pass it as a `?shape=` query param (no shape -> open the bare path):

   ```bash
   SHAPE=$(printf %s '{"fields":[{"name":"query","type":"string"}]}' | base64 | tr -d '\n')
   node "${BITFAB_PLUGIN_DIR}/dist/commands/openStudioTo.js" "/studio/trace-functions/<functionKey>/datasets/<datasetId>?shape=$SHAPE"
   ```

   The command navigates an existing session or opens a new one automatically.

   **This navigation is mandatory even though Studio is already open.** The initial mode open lands on `/studio` (the home), not this dataset's page. Labels and traces stream live only into the per-dataset page above, so a Studio session sitting anywhere else does NOT satisfy this step. Always navigate with the `<datasetId>` path once you hold the id.

   **After opening, check whether the dataset already has traces.** Call `mcp__Bitfab__search_traces` with `traceFunctionKey: <key>`, `datasetId: <datasetId>`, `limit: 1` to see if the dataset is populated.

   - **the dataset already has traces (search returned results)** — The dataset is not empty. Tell the user the dataset page is open with the existing traces, and they can review, approve, or edit labels there. Then go straight to waiting for their review. Do NOT ask how to source new candidates or offer to find more traces. The user should review what's already in the dataset first; they can request more traces via the "Edit with agent" button if needed. → step 10
   - **the dataset is empty (search returned no results)** — The dataset has no traces yet. Tell the user the dataset page is open in a "waiting for traces" state, and that traces will appear there live as you search and add them. Then proceed to find candidate traces. → step 3
3. **Ask how to source candidate traces.** Before searching, decide *where* the candidate traces come from. Three real options:

   1. **Define new criteria** — agent searches unlabeled traces shaped by what the user wants to surface. Best when the user has a hypothesis or a specific failure pattern in mind.
   2. **Reuse existing labels for this function** — pull traces that already have a validated human or approved-agent label (from any prior dataset on this function) and seed the new dataset with them. Best when the user wants to hill-climb off prior labeling work — same labels, different cut, add more later.
   3. **Open / you decide** — agent samples broadly with no hypothesis, ignoring prior labels for the search shape. Best for discovery passes.

   **Probe for prior label volume first** so the recommendation is grounded. Call `mcp__Bitfab__search_traces` with `traceFunctionKey: <key>`, `validated: true`, `limit: 50` to see roughly how many validated labels already exist for this function. Note the count — you'll need it for the recommendation and for option 2.

   Then ask the user with the three options below. Recommend:
   - Option **2 (Reuse)** if the function has 5+ validated labels AND the picked dataset is freshly created or empty (the user is starting a new cut and prior work is the right baseline)
   - Option **1 (Define)** if the user has a hypothesis or the function has < 5 validated labels (not enough prior signal to reuse)
   - Option **3 (Open)** if the user explicitly says they don't have a hypothesis yet and there's not much prior labeling

   Hold the chosen mode in working context — the next steps branch on it.

   > A) **Define new criteria** — tell me what to find (failure pattern, customer reports, etc.) and I search unlabeled traces → step 5
   > B) **Reuse existing labels for this function** — seed the dataset with traces that already have validated labels, then optionally add more *(recommended)* → step 4
   > C) **Open — you decide** — broad sample with no hypothesis; ignore prior labels for the search shape → step 6
4. **Seed dataset from existing validated labels.** Reachable only when the user picked Option B in `ask-search-mode`. Pull traces that already have a validated label (human-authored, or agent-authored and human-approved) for this function, attach them to the picked dataset, and route on whether the user also wants to add more.

   1. Call `mcp__Bitfab__search_traces` with `traceFunctionKey: <key>`, `validated: true`, and a generous `limit` (50 is the cap). Both `labelResult: true` and `labelResult: false` matter — failures are the hill-climbing signal, but passes anchor the regression boundary. If 50 isn't enough to cover the function's labeled history, run a second call with `labelResult: false` only to bias toward fails first, then a third with `labelResult: true`. De-dupe trace IDs across calls.
   2. Call `mcp__Bitfab__read_traces` with `scope: "summary"` on the resulting trace IDs so the labels + annotations are in working context. Don't re-label them — these are already validated.
   3. Call `mcp__Bitfab__add_traces_to_dataset` once with `datasetId` (the one picked in `list-datasets`) and the full deduped trace ID array. The call is idempotent, so re-attaching IDs already in the dataset is a safe no-op.
   4. Briefly summarize for the user: "Seeded the dataset with N reused labels (M fails, K passes). Want me to find more candidates to label, or is this set enough to move on?"

   > A) **Find more candidates to label** — go through the regular intent + search + label flow on top of the reused set → step 5
   > B) **Move on with just the reused set** — skip further labeling; the dataset page is already open with the reused traces streamed in *(recommended)* → step 10
5. **Ask what kinds of traces to find** — The user picked "Define new criteria" (or arrived here from the reuse path wanting more). Find out what they're actually trying to surface. The trace function may have thousands of traces; "what should I label?" is the question that makes the rest of this phase useful.

   When asking, ask the user with these options (and a free-text fallback so the user can describe something specific):

   - **A — Failures of a certain kind** *(recommended when the user already has a hypothesis)* — they tell you the pattern (empty outputs, hallucinated tool args, regressions on a specific input shape, etc.) and you search for matching traces
   - **B — Recent customer complaints / reports** — they paste or describe specific incidents and you find the matching traces by user, session, or time window
   - **C — Open-ended, you decide** — no hypothesis yet; you sample broadly across recent traces, look for diversity, and surface anything that looks like a candidate failure or interesting edge case

   Hold the user's answer (the chosen option **and** any free-text detail) in working context — the next step uses it to shape the `mcp__Bitfab__search_traces` filters and which traces to prioritise reading. If they pick C, default to recent + diverse + non-empty outputs.
6. **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" started "Searching traces"`.

   **Find unlabeled traces** — Search without label filters to find unlabeled traces for the trace function. **Shape the search by the intent captured in the previous step** (or by the prior dataset's existing labels, if any): Option A = filter to traces matching the user's described failure pattern; Option B = filter by the user, session, or time window of the reported incidents; Option C = default sweep (recent, diverse inputs, non-empty outputs). Use `mcp__Bitfab__search_traces` with the relevant filters, then `mcp__Bitfab__read_traces` with `scope: "summary"` to read candidates and identify which are worth labeling — look for diverse inputs, traces that produced output (not empty), and traces that cover different scenarios under the chosen intent. Filter out near-duplicates and uninteresting traces. If every trace is already labeled and attached to this dataset, you can move straight on with no new candidates.
7. **Ask how the user wants to label** — Before any verdicts go on these candidate traces, ask the user how the user wants to label them. There are exactly two modes, and the answer determines whether you call `mcp__Bitfab__update_agent_labels` at all:

   > A) **Agent labels first, I approve / edit** — agent makes a first pass; you approve or edit each verdict in the labeling page *(recommended)* → step 8
   > B) **I'll label them manually** — no agent verdicts; you label every trace from scratch in the labeling page → step 9

   Recommend Option A — an agent first pass turns the labeling page into a quick approve/edit review. But respect the user's choice: if they pick B, do **not** call `mcp__Bitfab__update_agent_labels` for any of these candidates. They want to label from scratch in the labeling page, with no agent verdicts pre-filled. If no new candidate traces were found in the previous step, skip this question and continue.
8. **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" started "Labeling traces"`.

   **Agent first pass: label them yourself before opening the labeling page** — Reachable only when the user picked Option A in the previous step. **You** label the approved candidate traces so the labeling page becomes an approve/edit review instead of a blank labeling session. Call `mcp__Bitfab__read_traces` with `scope: "full"` on the approved trace IDs (batch them — up to 10 per call), read each trace's inputs / output / spans yourself, and decide for each one whether it looks like a PASS or a FAIL. **Ground your judgment in the codebase, not just the trace text.** Before you start labeling, read the instrumented function in the user's source (located in Phase 2 in `wizard` mode, or via the grep step in this phase's intro in `dataset` mode) and any nearby code that explains intent — comments, docstrings, README sections, related tests, BAML files — so you know what the function is *supposed* to do and what "good" looks like for it. Apply the same context to every trace: does this output achieve the function's goal as expressed in the code? Does it match the patterns in the already-validated traces? Then call `mcp__Bitfab__update_agent_labels` once with an array of `{ traceId, label, annotation }` objects — **both `label` (true for pass, false for fail) and `annotation` (a one-or-two-sentence explanation written for the human reviewer, ideally referencing what the code is trying to do) are required for every trace**. Commit to a verdict — if you genuinely cannot decide, you didn't read the trace or the code carefully enough. The labels you save here start unapproved; they only become part of the validated dataset once a human approves them in the labeling page.

   > 🚨 **HARD RULE — DO NOT SKIP (agent-first mode only):** When the user picked Option A, you MUST call `mcp__Bitfab__update_agent_labels` with verdicts for every approved trace BEFORE navigating Studio to the labeling page. Sending the user into an agent-first review with no pre-labeled verdicts is a process violation. (In manual mode this step is unreachable, and the rule does not apply.)

   > **Made a mistake?** If you realize a verdict was wrong (e.g., you mislabeled a trace or want to re-evaluate), call `mcp__Bitfab__update_agent_labels` again with `{ traceId, archive: true }` for those traces. The previous label is hidden (kept for audit), and you can re-label the trace from scratch with another `update_agent_labels` call.
9. **Attach candidate traces to the dataset** — Call `mcp__Bitfab__add_traces_to_dataset` with the `datasetId` chosen earlier and the array of approved candidate trace IDs (in agent-first mode, the ones you just labeled; in manual mode, the candidates the user approved in find-unlabeled). The call is idempotent — re-adding traces already in the dataset is a no-op, so it's safe to include the full set. If no new candidate traces were approved (the dataset was already populated), skip this step.

   The dataset review page is already open in Studio (opened earlier in `open-page`). Each trace you attach streams in live via real-time events, so the user sees them appear instantly. After attaching, tell the user the dataset is populated and ready for their review, then proceed to `await-event`.
10. 🚨 **MANDATORY: Set up a Monitor IMMEDIATELY.** Do not skip this step or defer it. The user is reviewing traces in Studio right now and will click Done or Edit with agent. If you don't monitor, you will miss the event.

   Use the **Monitor tool** to tail the Studio background process output for new JSON events:

   ```bash
   tail -f -n +<NEXT_LINE> <output-file> | grep -E --line-buffered '"event"'
   ```

   `<output-file>` is the path returned when you started the `openStudioTo.js` background process. `<NEXT_LINE>` is one past the last line you read (e.g. if you read 5 lines, use `-n +6`).

   The Monitor streams ALL events from Studio. Route on the `event` field in each JSON line:

   - `{"event":"return-to-agent",...}` — user clicked **Done**. Dataset review is complete.
   - `{"event":"edit-with-agent",...,"datasetId":"..."}` — user clicked **Edit with agent**. Go to the modify loop, then come back here.
   - `{"event":"session-ended",...}` — user closed Studio entirely.
   - `{"event":"navigated",...}` — Studio navigated to a new page (informational).
   - `{"event":"click",...}` / `{"event":"focus",...}` — user interaction events (used during template editing).

   **Stay silent while monitoring.** Do not narrate each event. Only speak when you reach a branch point or hit an error.

   **Template editing during labeling.** The user may ask to edit a template in chat while the Monitor is running (e.g. "change the LLM view"). This arrives as a user message, not a Studio event. If so, go to the edit-template-loop step. **Do NOT invoke `$bitfab:setup templates`** — that navigates Studio away from the dataset page.

   - **`event: edit-with-agent`** — user clicked Edit with agent on the dataset page. Go to the modify loop, then come back here to read the next event → step 11
   - **`event: return-to-agent`** — user clicked Done on the dataset page. Dataset review is complete, move on to build + confirm the dataset → step 13
   - **`event: session-ended`** — user closed Studio. Stop the flow → step 1 of the Cleanup phase
   - **user asks to edit a template in chat** — user wants to change how traces render (e.g. 'edit the llm template', 'change the function view'). Go to the edit-template-loop, then come back here → step 12
11. **Modify loop: add or remove traces in chat** — The dataset page is still open in Studio and the user wants you to add or remove traces. Ask in plain chat:

   > What would you like to add or remove? You can describe by criteria (e.g. "drop empty-output traces", "add 5 more from last week with errors") or paste explicit trace IDs.

   Then wait for the user's next message. It will contain their answer. Do NOT ask the user here (the answer is free-form and options would just add an extra step before the user can type).

   Then act on it:

   - **Adding traces:** find candidates with `mcp__Bitfab__search_traces` / `mcp__Bitfab__read_traces`, then respect the labeling mode the user chose earlier in this phase (the ask-labeling-mode step). In **agent-first mode (Option A)**, label them yourself with `mcp__Bitfab__update_agent_labels` (same rigor as label-self: every trace gets a verdict + annotation, grounded in the code) before attaching. In **manual mode (Option B)**, do NOT call `mcp__Bitfab__update_agent_labels`. **If no labeling mode was selected** (the user took the Reuse → Move-on path that bypasses ask-labeling-mode, or find-unlabeled returned no candidates so ask-labeling-mode self-skipped), default to **agent-first mode (Option A)** — match the recommended default and label new candidates yourself before attaching. Either way, call `mcp__Bitfab__add_traces_to_dataset` to attach.
   - **Removing traces:** call `mcp__Bitfab__remove_traces_from_dataset` with the trace IDs to remove. The traces themselves aren't deleted, only their membership in the dataset.

   The dataset page reflects each add/remove live (SSE), so the user sees changes flow in as you make them. When you're done, summarize what changed in chat and **return to the await-event step to read the next event**. The user can click Edit with agent again for another modify round, or Done to finalize.
12. **Edit a trace view template inline.** The user wants to change how a span type renders. Handle this with MCP tools; do NOT invoke `$bitfab:setup templates`.

   1. Call `mcp__Bitfab__get_template_reference` if you haven't already this conversation. It documents the Nunjucks engine, variables, and filters.
   2. Identify the span type (`llm`, `agent`, `function`, `guardrail`, `handoff`, `custom`). If ambiguous, ask.
   3. Call `mcp__Bitfab__get_template` with `spanType` and `traceFunctionKey` (from Phase 1) to read the current template.
   4. Edit the template. Stay inside the documented variables and filters. Do not use `{%raw%}{% extends %}{%endraw%}`.
   5. Call `mcp__Bitfab__update_template` with the full edited body. The dataset page re-renders automatically via SSE.
   6. Acknowledge in one line. Do not paste the template body back.

   Then return to the await-event step. If the user wants more edits, they'll ask again and you'll re-enter this step.
13. **Build the dataset** — You already know the trace IDs in this dataset (you attached them in earlier steps and tracked any add/remove from modify rounds). Call `mcp__Bitfab__read_traces` with all of them and `scope: "full"` to load the labels + annotations into context. This is the working set for confirm + every Phase 5 experiment.
14. **Confirm the dataset** — Present the dataset as a numbered choice: each entry showing (trace ID, label, annotation summary). The dataset must contain at least one **validated failing label** — i.e. at least one trace where a human either authored or approved a `false` label. To check, call `mcp__Bitfab__search_traces` restricted to the dataset trace IDs with `validated: true` and `labelResult: false`. Two outcomes:

   - **gate fails (no validated failing label — search returns nothing)** — tell the user and loop back to find or label more unlabeled traces → step 6
   - **gate passes (at least one validated failing label)** — get explicit approval, then continue → step 15

   Unapproved agent labels do **not** satisfy this gate by design — `validated: true` excludes them.
15. **Hold in-context** — This approved dataset is the benchmark for all experiments in Phase 5. Keep both the `datasetId` and the trace IDs in your working context throughout.

## Phase 4: Diagnose & Plan

**Run only when mode is `wizard`, `dataset` or `investigate`.**

1. **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" started "Diagnosing failures"`.

   **Understand failures.** Using the failed traces you read in Phase 3 (or read them now if you haven't):

   - Call `mcp__Bitfab__read_traces` on 3–5 failed traces with `scope: "full"`

   Synthesize the failure patterns — what's going wrong, what the common threads are.
2. **Read the code.**

   - Find the instrumented function in the codebase (in `wizard` mode you found it in Phase 2; in `dataset` mode you grepped for the key in Phase 3's intro; in `investigate` mode you found it in Phase Investigate's gather-context step)
   - Read the full implementation — follow the call chain to understand the logic
   - Identify **iteration targets**: prompts, system messages, parameters, preprocessing, postprocessing
   - If BAML files are involved, read the relevant `.baml` files
3. **Categorize fixes based on failure annotations.** Based on the failure patterns, the code, and the labeled dataset from Phase 3, categorize proposed changes into three buckets:

   **Bucket 1 — Code fixes**: Deterministic bugs (off-by-one, type mismatch, missing null check, wrong variable). These won't recur once fixed. Bundle all code fixes into a single experiment unless they are large feature changes. These are applied first as a foundation that all subsequent experiments build on.

   **Bucket 2 — Judgment-based fixes**: Prompt changes, context truncation, search tuning, output formatting, etc. These require the user's judgment to evaluate correctness. Each gets its own experiment.

   **Bucket 3 — Infrastructure proposals**: Larger changes that require new infrastructure, architectural changes, or significant feature work. These are separated out because experiments become harder to compare when some include large infra changes and others don't — apples-to-apples comparison requires a consistent baseline. Do not run experiments for these. Instead, if the user has integrations (Linear, Notion, Jira), propose creating a task with a clear writeup for future work.

   Present the categorized plan as a numbered choice:

   > "Based on the N traces in the dataset, here's what I see:
   >
   > **Code fixes** (experiment #1 — bundled):
   >
   > - [Fix]: [What and why, which traces it addresses]
   >
   > **Judgment-based experiments** (#2, #3, ...):
   >
   > - [Experiment]: [What change, which traces it targets, hypothesis]
   >
   > **Future infrastructure** (not experiments):
   >
   > - [Proposal]: [What it would require, which traces it would help]
   >
   > I'll replay each experiment against the labeled dataset and evaluate using the annotations as acceptance criteria."

   Get the user's confirmation before proceeding.

## Phase 5: Iterate with Replay

In `experiment` mode this is an iterative improvement loop (each iteration makes a change and replays). In `benchmark` mode it is a single replay of the current code followed by a terminal scorecard — no changes, no iteration.

`openStudioTo.js` resolves the active session automatically. `benchmark` mode opens Studio only when the run opted in with the `studio` keyword; without it, benchmark opens no Studio and runs terminal-only.

1. **Run only when mode is `experiment` or `benchmark`.**

   **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" started "Running experiments"`.

   The trace function key comes from the argument and no prior phase has run. Pick the dataset to run against (`experiment` mode iterates against it; `benchmark` mode replays it once to measure the current code), then locate the code:

   1. **Grep the codebase** for the trace function key (e.g. `grep -r "<traceFunctionKey>" --include="*.ts" --include="*.tsx" --include="*.py" --include="*.rb" --include="*.go" --include="*.baml"`) and note the file path. This is the code under test (the code you'll iterate on in `experiment` mode, or measure as-is in `benchmark` mode).
   2. **Pick the dataset.** If a `<dataset-id>` argument was provided, use it directly. Otherwise call `mcp__Bitfab__list_datasets` with the trace function key, present the result to the user as a numbered choice, and use their choice. Hold the chosen `datasetId` in working context.
   3. **Load it.** Call `mcp__Bitfab__read_traces` with the dataset's trace IDs and `scope: "full"` so labels + annotations are in context.
   4. **Branch on the result. The usability gate depends on the mode:**
      - In `experiment` mode, the dataset must have **≥1 validated failing label** (there has to be something to fix).
      - In `benchmark` mode, the dataset just needs **≥1 trace** — benchmark replays the entire dataset against the current code regardless of label mix (an all-passing dataset is a valid regression baseline).

   - **no datasets exist for this function (`list_datasets` returned empty), or the picked dataset fails the mode's usability gate (experiment: no validated failing labels; benchmark: no traces at all)** — tell the user the function has no usable dataset yet and recommend running `$bitfab:assistant dataset <key>` first; then stop the flow (the cleanup step closes Studio if one was opened) → step 1 of the Cleanup phase
   - **dataset loaded (experiment: ≥1 validated failing label; benchmark: ≥1 trace)** — summarize the dataset for the user (counts of pass/fail) and the failure annotations. In `experiment` mode, pick a first experiment from the failure patterns. In `benchmark` mode, confirm the dataset and proceed to replay the full set → step 3 (mode `benchmark`); stop (mode `add-trace` or `replay`); otherwise step 2
2. **Run only when mode is `experiment`.**

   **Decide once: parallel worktree subagents, or serial in this main agent.** The check is whether subagent worktree sessions would inherit bypass permissions.

   This editor doesn't support worktree-isolated subagents. Skip the bash check and take the serial branch.

   Hold the chosen mode in working context. Every iteration below (`make-change`, `replay-against-dataset`, `evaluate-results`) honors it.

   - **(unreachable on this editor)** — **Parallel mode.** For each independent experiment, fork to a subagent using the Agent tool with `isolation: "worktree"` and `subagent_type: "general-purpose"`. The subagent edits its worktree, runs replay, returns its scored items + `testRunId` to this main agent → step 3
   - **always** — **Serial mode.** Iterate experiments one at a time in this main agent. Subagent worktrees wouldn't inherit bypass permissions, so their Edit tool would be denied → step 3
3. **Run only when mode is `wizard`, `dataset`, `experiment`, `investigate` or `benchmark`.**

   **Detect replay script capabilities.** Check what the replay script supports. These flags determine how experiment results are tracked and displayed. **If you already ran this step in Phase 2 earlier in this session, skip it and continue to `make-change` (or `replay-against-dataset` in benchmark mode).**

   **1. Locate the replay script** (you found it in Phase 2 in `wizard` mode, or grep for `scripts/replay.*` / files importing `bitfab.replay` / `client.replay` now).

   **2. Grep the replay script for these capabilities:**

   | Grep for | Flag | What it enables |
   |----------|------|-----------------|
   | `code-change` or `code_change` | `supportsCodeChanges` | Code diffs attached to each experiment in the dashboard |
   | `experiment-group-id` or `experiment_group_id` | `supportsExperimentGroups` | Live streaming of results in Studio as replay runs |
   | `traceId` or `trace_id` in the output/print section | `supportsReplayTraceIds` (verified against the SDK `.d.ts` in step 3, re-confirmed post-replay) | Verdict persistence, cross-iteration comparison, Studio experiments page |

   `supportsInputAdapters` is **not** a script-grep flag (the script gains an `adaptInputs` / `adapt_inputs` argument only after a signature actually drifts, in `adapt-replay-inputs`). It is determined SOLELY by the installed SDK in step 3 below.

   **3. Verify the installed SDK actually supports the detected flags.** The replay script may accept flags that the installed SDK silently ignores. Check the actual SDK dist (not the script) for each capability:
   - For `supportsExperimentGroups`: grep the installed SDK's replay JS file (e.g. `node_modules/.pnpm/@bitfab+sdk@*/node_modules/@bitfab/sdk/dist/replay-*.js`) for `experimentGroupId`. If absent, the SDK drops the option silently.
   - For `supportsCodeChanges`: grep the same file for `codeChangeDescription` or `code_change_description`.
   - For `supportsReplayTraceIds`: grep the installed SDK's **type declaration** for a `traceId` field on the `ReplayItem` interface — `grep -A3 "interface ReplayItem" node_modules/.pnpm/@bitfab+sdk@*/node_modules/@bitfab/sdk/dist/index.d.ts` (or `node_modules/@bitfab/sdk/dist/index.d.ts`). If `ReplayItem.traceId` is **absent**, the installed SDK does not surface replay trace IDs (the per-item mapping was added in a later release, e.g. 0.13.4 lacks it, 0.13.6 has it) — mark `supportsReplayTraceIds` **false**. This is a definitive **pre-replay** signal; the later `check-trace-id-support` step still re-confirms from the actual replay output.
   - For `supportsInputAdapters`: grep the installed SDK for the `replay()` option: `grep "adaptInputs" node_modules/.pnpm/@bitfab+sdk@*/node_modules/@bitfab/sdk/dist/index.d.ts` (TS), or `adapt_inputs` in the installed `bitfab/replay.py` (Python) / the installed gem's `replay.rb` (Ruby). If absent, the SDK predates the input-adapter hook; mark `supportsInputAdapters` **false**. The replay script needs no pre-wiring for this: an adapter (its own file + an import) is added only when a signature actually drifts, in the `adapt-replay-inputs` step (Phase 5).

   If the replay script has a flag but the installed SDK does not support it, mark that flag as **false**. Prioritize upgrading the SDK over using fallbacks — without replay trace IDs, verdict labels can't be persisted (benchmark/experiment results stay in-agent only).

   **4. Route on the result.**

   If all flags are true, skip the question and continue silently.

   If one or more flags are false, tell the user which capabilities are missing and what they affect, then ask the user. List the missing capabilities in the question text:

   > "Your replay script is missing support for:
   >
   > [if !supportsCodeChanges] **Code changes**: edits won't appear in the experiment dashboard
   > [if !supportsExperimentGroups] **Experiment groups**: no live streaming; results appear in Studio after each run
   > [if !supportsReplayTraceIds] **Replay trace IDs**: experiment results can't be persisted or compared across iterations (your SDK needs an upgrade)
   >
   > [if !supportsInputAdapters] **Input adapters**: replay can't recover traces when the function's signature drifts after capture (fixed by upgrading the SDK)"

   > A) **Upgrade the replay script** — regenerate the script with full support, then continue *(recommended)* → step 4
   > B) **Continue without** — run experiments with the current script; missing features are skipped → step 5
4. **Run only when mode is `wizard`, `dataset`, `experiment`, `investigate` or `benchmark`.**

   **Upgrade the SDK and replay script.** The replay script references SDK APIs (`experimentGroupId`, `codeChangeDescription`, per-item `traceId`, `adaptInputs` / `adapt_inputs`) that require a recent SDK. Upgrade the SDK first, then regenerate the script.

   **1. Upgrade the SDK.** Read the resolved version from the lockfile (`pnpm-lock.yaml`, `poetry.lock`, `uv.lock`, `Gemfile.lock`) and compare against the latest. If outdated, run the package manager's update command:
   - TypeScript: `pnpm update @bitfab/sdk` (in monorepos, scope with `--filter <pkg>`). **If `package.json` pins an exact version (e.g. `"@bitfab/sdk": "0.13.4"` with no `^`/`~`), `pnpm update` will NOT move past the pin — bump the spec in `package.json` to the target version first (e.g. `"@bitfab/sdk": "0.13.6"`), then `pnpm install`.**
   - Python: `uv lock --upgrade-package bitfab-py && uv sync` or `poetry update bitfab-py`
   - Ruby: `bundle update bitfab --conservative`

   If the SDK is on a legacy package name (e.g. `bitfab` instead of `@bitfab/sdk`), remove the old package and install the new one. Skip this step if the SDK is already at the latest version.

   **2. Regenerate the replay script.** Locate the replay script for this trace function (found in `detect-replay-capabilities`). Fetch the SDK replay reference (`https://docs.bitfab.ai/reference/typescript#replay` or the equivalent for the project language) and the script template (`https://docs.bitfab.ai/typescript-sdk#replay`). Then edit the script to add the missing flags:
   - **`--code-change <path>`**: parse the JSON file, pass `codeChangeDescription` and `codeChangeFiles` to `replay()`
   - **`--experiment-group-id <uuid>`**: pass `experimentGroupId` to `replay()`
   - **Replay Output Contract**: emit the full `ReplayResult` as one `JSON.stringify(result, null, 2)` block to stdout (including every item's `traceId`, `durationMs`, `tokens`, `model`). Human-readable summary goes to stderr.
   Do NOT invoke `$bitfab:setup replay` as a separate skill; edit the script inline here.

   **3. Re-check capabilities.** After editing, re-check against the **installed SDK dist** (not just the script): grep the replay JS for `experimentGroupId` / `codeChangeDescription`, grep the SDK `.d.ts` for `ReplayItem.traceId` (the authoritative replay-trace-ID signal), and grep the SDK for `adaptInputs` / `adapt_inputs` (the input-adapter hook). Update the flags in working context. If any are still missing after both upgrades, note it but continue.
5. **Run only when mode is `wizard`, `dataset`, `experiment`, `investigate` or `benchmark`.**

   **Generate the experiment group ID and open the experiments page before making changes or running replay.** This lets the user watch results stream in live from the moment replay starts.

   **Generate an experiment group ID.** Generate a fresh UUID to use as the `experimentGroupId` for this iteration. This groups all test runs from this iteration together so the experiments page can stream results live as the replay runs.

   **Open the experiments page.** Pick exactly one case (they are mutually exclusive):

   - **`benchmark` mode WITHOUT the `studio` opt-in:** do NOT run any `openStudio` navigation (no Studio is open). Just generate the experiment group ID above for tagging the test run on the server, then continue to `replay-against-dataset`.
   - **`benchmark` mode WITH the `studio` flag** (and `supportsExperimentGroups` is true): navigate Studio to the experiments page using the group ID **and** `&mode=benchmark`, so the page relabels its copy as "Benchmark" (the underlying run is still an experiment; only the displayed noun changes):

     ```bash
     node "${BITFAB_PLUGIN_DIR}/dist/commands/openStudioTo.js" "/studio/experiments?experimentGroupId=<experimentGroupId>&mode=benchmark"
     ```
   - **All other modes** (and `supportsExperimentGroups` is true): navigate Studio to the experiments page using the group ID (no `mode` parameter):

     ```bash
     node "${BITFAB_PLUGIN_DIR}/dist/commands/openStudioTo.js" "/studio/experiments?experimentGroupId=<experimentGroupId>"
     ```

   **Token-cost lens (`&tokens=1`).** When this iteration is about token usage or cost (the user wants to cut tokens/cost, the change is a prompt trim, or the dataset/labels are framed around a token budget), append `&tokens=1` to whichever experiments URL you open above (e.g. `...?experimentGroupId=<experimentGroupId>&tokens=1`). That turns on the token-cost lens: each trace and the experiment header show the original → replay total-token trend, streaming in next to pass/fail. Omit it when the run isn't about cost; it's an opt-in view, not the default.

   This is a navigation call, not a long-running process. The existing Studio session handles it. If `supportsExperimentGroups` is false, skip this navigation (the `open-experiments` fallback will navigate with `testRunIds` after the replay completes).
6. **Run only when mode is `wizard`, `dataset`, `experiment` or `investigate`.**

   **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" started "Making changes"`.

   **Make the change.**

   - Explain to the user what you're changing and why, and confirm before editing
   - For every file you intend to edit in this experiment: **read the file with the Read tool first** and keep its full contents in working memory as the **before** snapshot. Then edit. Then **read the file again** to capture the **after** snapshot. Both snapshots are required by the next step (`replay-against-dataset`) so the experiment dashboard can render the literal edit alongside the results — this is per-experiment, not cumulative
   - Hold a one-line **change description** in working memory too (e.g. "fix off-by-one in retry logic", "tighten extraction prompt"). It will be the experiment's title in the viewer
   - If a file is newly created, the before snapshot is the empty string `""`. If a file is deleted, the after snapshot is `""`. The path is always the repo-relative file path — no `repo`, `commit`, or other context fields
7. **Run only when mode is `wizard`, `dataset`, `experiment`, `investigate` or `benchmark`.**

   **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" started "Running replay"`.

   **Replay against the dataset.** Collect the trace IDs from the labeled dataset (built in Phase 3 in `wizard` and `dataset` modes, or rehydrated at the start of this phase in `experiment` and `benchmark` modes). The experiment group ID was already generated in the `open-experiments-before-replay` step (which also opened the experiments page in Studio in non-benchmark modes, and in `benchmark` mode only when the `studio` flag was passed).

   **In `benchmark` mode, skip the code-change payload entirely.** Benchmark makes no experiment-style edits to the traced function, so there is no code diff to capture. Omit `--code-change` from the invocation. The replay evaluates the current code as-is against the labeled dataset. Use `"Benchmark: current code baseline"` as the change description for display purposes. (Infra fixes are still allowed when a gap blocks the run — upgrading the SDK / replay script in `detect-replay-capabilities`, or adding `mockOnReplay` to a failing child span below — since none of those change the function's measured behavior. What you must not do is edit the traced function to alter its output.)

   **Write the code-change payload first (skip this entire block in `benchmark` mode — `make-change` never ran, there are no snapshots, and `--code-change` is omitted per the benchmark note above).** Before running the script, write a tmp JSON file (e.g. `/tmp/bitfab-code-change-<experimentN>.json`) using the snapshots captured in `make-change`:

   ```json
   {
     "description": "<the one-line change description from make-change>",
     "files": [
       { "path": "<repo-relative path>", "before": "<full file contents before edit>", "after": "<full file contents after edit>" }
     ]
   }
   ```

   The schema is flat — every file object is exactly `{ path, before, after }`. Do **not** add `repo`, `commit`, or any other context fields; `path` is the sole identifier. Use `""` for newly created or deleted files. One JSON file per experiment — never reuse last iteration's payload.

   **Check the `supportsCodeChanges` flag** (from `detect-replay-capabilities`). If false, skip writing the code-change JSON file and omit `--code-change` from the invocation. The replay itself is unaffected; only the code-change metadata is missing from the experiment viewer.

   **Check the `supportsExperimentGroups` flag** (from `detect-replay-capabilities`). If true, pass `--experiment-group-id <experimentGroupId>` (from `open-experiments-before-replay`) so the test run is tagged with the group. If false, skip the flag.

   Run the replay with the trace IDs and whichever flags are supported (omit unsupported flags):

   ```bash
   # The exact command depends on the replay script — adapt to what exists
   # Example for TypeScript (with all flags):
   cd <project-dir> && npx tsx scripts/replay.ts <pipeline-name> --trace-ids <id1>,<id2>,<id3>,... --code-change /tmp/bitfab-code-change-<experimentN>.json --experiment-group-id <experimentGroupId>
   # Without experiment-group-id support (older scripts):
   cd <project-dir> && npx tsx scripts/replay.ts <pipeline-name> --trace-ids <id1>,<id2>,<id3>,... --code-change /tmp/bitfab-code-change-<experimentN>.json
   ```

   **Before running: verify the replay script prints the full original and new output values AND the replay trace ID (`item.traceId`) to stdout for every item** (not just lengths, counts, hashes, or truncated previews). If it doesn't, fix the script first — the Replay Output Contract and example script live in the SDK reference at `https://docs.bitfab.ai/<language>-sdk#replay`. Subagents can't evaluate an improvement from `5 → 7 (+2)`, and missing trace IDs block verdict persistence.

   **Capture the `testRunId` from the replay output** — the SDK prints it (alongside `testRunUrl`) when the run completes. Track every `testRunId` produced across all iterations of this phase for the `open-experiments` fallback.

   **If a child span fails during replay, tag it with `mockOnReplay` instead of debugging it.** When a non-root span throws (missing API key for a paid call, flaky external service, deleted/moved dependency, env not reproducible), it usually blocks the whole trace from completing, even though the failure is environmental, not a bug in the function you're iterating on. The short-term fix is to mark that span as replayable from its recorded output:

   1. Find the failing span's call site in the codebase (`withSpan("<spanName>", ...)` in TS, `@bitfab.span` / `bitfab.span` equivalents in other SDKs).
   2. Add the flag to its span declaration (TypeScript and Python today; Ruby and Go as they land):
      ```ts
      // TypeScript: SpanOptions.mockOnReplay
      bitfab.withSpan("expensive-llm-call", { mockOnReplay: true }, async () => { ... })
      ```
      ```python
      # Python: mock_on_replay kwarg on @client.span(...)
      @client.span("expensive-llm-call", mock_on_replay=True)
      def expensive_llm_call(...):
          ...
      ```
   3. Re-run the replay script passing `mock: "marked"` to `client.replay(...)` (or `mock="marked"` in Python). That child will return its historical output; the root function still runs real code.
   4. Flag the tag to the user: it's a replay-only escape hatch, has no effect on prod execution, and is worth removing once the underlying issue is fixed.

   Use this when the goal is to unblock iteration on the root function, not when the child itself is what you're trying to improve.

   **After the run, check whether replay trace IDs are populated.** Check whether `item.traceId` is a non-null string for every completed item. Hold the result as a boolean flag (`hasTraceIds`) for the `check-trace-id-support` step. If any are `null`, the user's SDK version or server does not support the replay trace ID mapping yet. Do NOT stop here, just flag it.

   **After the run, classify items before evaluating.** A failed item means one of three things: the new code produced a bad output (real signal), the wrapped fn threw on infra (missing DB row, stale FK, rejected write, missing env), or the recorded inputs no longer fit the function's current signature (the code's SHAPE drifted since the trace was captured: params renamed, reordered, collapsed into an options object, a new required arg added). Infra failures are not regressions; shape mismatches are not regressions either, they mean replay couldn't even call the function with the captured inputs.

   From the JSON compute:

   - `completed` — `item.error` unset
   - `shapeErrored`: `item.error` set AND the message reads like a signature/shape mismatch rather than infra. Tell-tale shapes: a `TypeError` about reading a property of `undefined` / `X is not a function` off the input, wrong argument count, Python `TypeError: ... missing N required positional argument(s)` / `unexpected keyword argument` / `takes N positional arguments but M were given`, or a Pydantic/zod validation error on the input itself. These usually fire on (almost) every item identically, because the cause is the signature, not the row.
   - `infraErrored`: `item.error` set for any other (DB/env/external-service-shaped) reason
   - `total` — `result.items.length`; `0` or non-zero exit code = whole-replay crash

   If `completed === 0`, do not score pass/fail on an empty set, branch to `check-replay-health`. Carry `shapeErrored` forward so `check-replay-health` routes shape mismatches to input adaptation instead of burying them as infra noise.
8. **Run only when mode is `wizard`, `dataset`, `experiment`, `investigate` or `benchmark`.**

   **Route on the counts and exit code.** Goal: keep infra noise out of evaluation. Read a sample of `item.error` strings (and stderr on crash) first to identify the DB-shaped pattern (missing record, FK / unique constraint, write rejected, connection refused, missing env).

   **If the errors are signature/shape mismatches (`shapeErrored`), that is NOT an infra problem**: it has its own route below (`adapt-replay-inputs`), which maps the recorded inputs onto the function's current signature. The DB/infra guidance in the rest of this step applies only to environment-shaped failures.

   **🚨 Do not silently work around DB issues.** Do not drop affected trace IDs, stub the read in the script, gate writes behind a script-only flag, wrap the function in a rollback transaction, or edit the instrumented function to skip DB calls. Those all hide infra problems as fake passing or fake failing results and corrupt the experiment.

   **Instead: tell the user what's wrong and offer exactly two workarounds.** Use ask the user to surface a clear summary first — the failing trace ID(s), the error pattern, the function and span where it happens — then present the two options below. Pick a representative failing trace and call `mcp__Bitfab__read_traces` with `scope: "summary"` to read its `environment` field (production / staging / development), so option B can name the source environment concretely.

   - **Workaround A: `mockOnReplay`** *(recommended for spans whose side effects shouldn't run during experimentation)* — apply the `mockOnReplay` recipe from step `replay-against-dataset` above (find the failing span, add `mockOnReplay: true` to its `SpanOptions`, re-run with `{ mock: "marked" }`). Edit only the span options, never the function body. Use this when the span is a DB read/write the experiment isn't testing and the captured output can stand in for it.
   - **Workaround B: Point replay at the trace's source database** — the trace's `environment` field names where it was captured (e.g. `production`). Tell the user that's the only environment whose DB has the rows the trace references, then offer to (i) update the replay env to point at that environment's DB (env vars, connection string) or (ii) ask which environment they want to use if multiple are valid. Apply the change to env / config, not to the function under test.

   After whichever workaround the user picks, re-run `replay-against-dataset` and re-check health. If the user can't or won't do either, stop and report — don't fabricate a workaround on your own.

   - **errors are shape mismatches, not infra (`shapeErrored` dominates the errored items: the recorded inputs don't fit the function's current signature)** — the function's shape drifted since these traces were captured, so replay can't call it with the recorded inputs. This is recoverable: route to `adapt-replay-inputs` to map the recorded inputs onto the current signature, then re-run → step 9
   - **whole replay crashed (non-zero exit, total is 0, or unparseable stdout)** — show stderr / exit code, diagnose, confirm a script fix with the user, apply, loop back to `replay-against-dataset` → step 7
   - **every item errored with INFRA errors (completed is 0, total non-zero, and the errors are NOT predominantly `shapeErrored` — those take the shape-mismatch branch above)** — systemic infra failure (usually env mismatch). Diagnose, confirm a script fix with the user, loop back → step 7
   - **high INFRA error rate (over half of items errored, and `shapeErrored` is not the dominant cause — shape mismatches take the branch above)** — signal is noisy. Flag the rate and ask the user whether to fix the env and retry, or proceed with the partial signal → step 10
   - **healthy or mixed run (at least one completed item, infra errors at most half of total)** — proceed. Carry `infraErrored` forward — surface as its own bucket in the final report (the share-results step, or the benchmark scorecard's Unreplayable row in `benchmark` mode), never folded into pass/fail → step 10
9. **Run only when mode is `wizard`, `dataset`, `experiment`, `investigate` or `benchmark`.**

   **The recorded inputs don't fit the function's current signature.** Replay pulls each trace's inputs exactly as they were captured against the signature AT TRACE TIME, then spreads them into the live function. When the shape drifted since capture, that spread throws (the `shapeErrored` items from `replay-against-dataset`). The fix is an **input adapter**: a per-trace transform, applied inside the SDK between fetch and call, that reshapes the recorded inputs onto the current signature so replay can run. It is the SDK's `adaptInputs` hook (TypeScript `replay({ adaptInputs })`) / `adapt_inputs` argument (Python `replay(adapt_inputs=...)`). You author the transform; the SDK applies it.

   **Step 0: confirm the capability.** Check the `supportsInputAdapters` flag from `detect-replay-capabilities` (the installed SDK accepts the `adaptInputs` / `adapt_inputs` option on `replay()`). If true, go to Step 1. If false, the installed SDK predates the input-adapter hook: tell the user to upgrade the SDK and re-run the assistant, and for this run take the **decline** branch below (these traces can't be validated without the hook). Do not hand-roll the reshape inside the function under test.

   **Step 1: reuse a committed adapter if one already covers this shape (re-ask only on drift).** Adapters live in their own file next to the replay script, imported by it (recommended: TS `scripts/replay-adapters/<name>.ts`, Python `scripts/replay_adapters/<name>.py`, Ruby `scripts/replay_adapters/<name>.rb`; plus an optional sibling `<name>.inputs.json` for judgement cases). If such an adapter already exists AND maps the current recorded shapes onto the current signature (sanity-check it against a sampled input below), do not re-prompt: just confirm the replay script imports it (Step 5) and re-run. Only when the signature has drifted past what it handles do you propose a new/updated mapping and re-confirm.

   **Step 2: learn the actual captured shape(s).** Pick a few `shapeErrored` trace IDs and call `mcp__Bitfab__read_traces` with `scope: "full"` (or `io`) to read their recorded inputs. Sample MORE than one: the trace set can span several historical signatures (the function may have drifted more than once), so the adapter must tolerate each shape it actually sees, not just the newest old one. Then read the function's CURRENT signature from the code.

   **Step 3: decide mechanical vs judgement.**
   - **Mechanical** (rename, reorder, positional-to-options-object, drop a removed param, supply a literal/default): expressible as a pure function. Prefer this.
   - **Judgement** (the new shape can't be derived by rearrangement, e.g. one freeform field must be split into two based on its content): do NOT call a model from inside the adapter at replay time (that makes replay slow and non-deterministic). Instead, materialize up-front: YOU compute the adapted inputs for each affected trace now, once, and write them to the sibling `<key>.inputs.json` table keyed by the original Bitfab trace ID. The adapter then just looks the trace up.

   **Step 4: confirm, then write the adapter co-located with the replay script.** Use ask the user to show the concrete mapping (old shape -> new shape) and get a yes before writing. On yes, write:
   - The adapter function. It receives the recorded inputs and a per-trace context (`{ traceId, sourceSpanId }` in TS; `{"trace_id", "source_span_id"}` in Python) and returns the args actually passed to the function. Make it **shape-dispatching**: branch on the input it actually receives so it normalizes each historical shape in the sample, not only one. For judgement cases, look up `<key>.inputs.json` by `traceId` first, then fall back to the mechanical branch.
   - **Faithfulness is non-negotiable.** If the current signature has a genuinely new REQUIRED input with no analog in the recorded trace, do NOT invent a value. Leave those traces unmapped; they go in the decline bucket below with a stated reason. Adapting must never silently fabricate test inputs.
   - These files are committed (they sit next to the replay script, in source control), so they persist across runs and are reviewable in the PR.

   **Step 5: wire it in and re-run.** Write the adapter to its own file next to the replay script (TS `scripts/replay-adapters/<name>.ts` exporting `adaptInputs`; Python `scripts/replay_adapters/<name>.py` defining `adapt_inputs(args, kwargs, ctx)`; Ruby `scripts/replay_adapters/<name>.rb` defining an adapter lambda). Then edit the replay script to import it and pass it to this pipeline's `replay()` call as `adaptInputs` / `adapt_inputs` (see the `#replay` reference for the exact import shape). Editing the replay script here is expected. Loop back to `replay-against-dataset`, re-run, and confirm the `shapeErrored` items cleared.

   - **an adapter is in place (user approved a new mapping, or a persisted adapter already covers the current shape) and the replay script loads it** — re-run with the adapter applied. Loop back to `replay-against-dataset` → step 7
   - **the SDK lacks the hook (`supportsInputAdapters` false), the user declines adapting, or some inputs can't be faithfully mapped (new required input with no analog)** — do not fabricate inputs. Carry the unmappable `shapeErrored` trace IDs as their own **shape-incompatible** bucket (each with a one-line reason), distinct from infra errors and never scored pass/fail/regression, and surface it in the final report (share-results, or the benchmark scorecard's Unreplayable row). If any items DID complete (partial adaptation), proceed to evaluate them; otherwise this is a terminal report path → step 10
10. **Run only when mode is `wizard`, `dataset`, `experiment`, `investigate` or `benchmark`.**

   **Route on whether replay trace IDs are available.** Check the `hasTraceIds` flag from `replay-against-dataset` (this confirms the tentative `supportsReplayTraceIds` flag from `detect-replay-capabilities`). This determines whether verdicts can be persisted to the server and whether the experiments page in Studio will show meaningful results.

   - **replay trace IDs are populated (`hasTraceIds` is true)** — the SDK and server support trace ID mapping. In non-benchmark modes, open the experiments page in Studio first (so the user can watch verdicts populate in real time), then evaluate and persist labels. In `benchmark` mode without the `studio` flag no Studio is open, so `open-experiments` self-skips: go straight to evaluating and persisting labels. In `benchmark` mode with the `studio` flag, `open-experiments` behaves like other modes → step 14
   - **replay trace IDs are null (`hasTraceIds` is false)** — tell the user: "Your SDK doesn't support replay trace IDs, so experiment results can't be persisted to Studio or compared across iterations. Upgrade your SDK and run `$bitfab:setup replay` to regenerate the script. Evaluating in-agent for now." Then proceed to text-only evaluation so the user still sees comparison results in-agent, without the Studio experiments page → step 11
11. **Run only when mode is `wizard`, `dataset`, `experiment`, `investigate` or `benchmark`.**

   **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" started "Evaluating results"`.

   **Run only when replay trace IDs are unavailable** (`hasTraceIds` is false — you were routed here from `check-trace-id-support`; if trace IDs are available, use `evaluate-results` instead). **Evaluate results in-agent without persisting.** The agent still compares original vs new outputs and derives pass/fail verdicts, but cannot persist them via `persistReplayLabels.js` or show them in Studio. This is a terminal path: it does NOT continue to `evaluate-results` or `verify-replay-labels`; its `next` goes straight to the report (share-results, or the benchmark scorecard).

   For each completed (non-errored) replay item, derive a verdict by comparing the replay's new output against the original trace's label and annotation:

   - **fail**-labeled original: does the replay's new output address the annotation? If yes, mark as PASS. If no, mark as FAIL.
   - **pass**-labeled original: preserved means PASS, regressed means FAIL.
   - Unreplayable items (`item.error` set) go in their own bucket.

   Hold the verdicts in working context for the final report — the `share-results` step in `wizard`/`dataset`/`experiment`/`investigate` modes, or the **benchmark scorecard** in `benchmark` mode. This step's `next` routes there directly: it does NOT run the `evaluate-results` (persist) or `verify-replay-labels` steps. Since trace IDs are unavailable, do NOT attempt to run `persistReplayLabels.js` or open the experiments page; the report is the terminal step from here.
12. **Run only when mode is `wizard`, `dataset`, `experiment`, `investigate` or `benchmark`.**

   **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" started "Evaluating results"`.

   **Evaluate against labels & annotations.** Score only items where `item.error` is unset. Items with `item.error` set are unreplayable (already classified) and go in their own bucket — never pass, fail, or regression.

   For each completed (non-errored) replay item, derive a verdict by comparing the replay's new output against the original trace's label and annotation (from Phase 3 in `wizard`/`dataset` modes, or loaded by `pick-dataset` at the start of this phase in `experiment` and `benchmark` modes):

   - **fail**-labeled original: does the replay's new output address the annotation? If yes → `label: true` (PASS). If no → `label: false` (FAIL). Use the annotation as the acceptance criterion.
   - **pass**-labeled original: preserved → `label: true` (PASS). regressed → `label: false` (FAIL).
   - **Unlabeled original** (no validated or agent label — possible in `benchmark` mode, where the dataset only needs ≥1 trace regardless of label mix): there is no acceptance criterion to score against, so do NOT pass/fail it. Mark it `skip: true` and note "unlabeled, no expected result" — it counts toward `S` (skipped) and is excluded from `scorable`, never pass or fail.
   - Cannot judge from the output alone (genuinely ambiguous, not laziness): `skip: true` instead of guessing. Skips are recorded explicitly so the verify step knows you intentionally did not verdict.
   - Unreplayable items (`item.error` set) are NOT verdicted here — keep their list (trace ID + error string) for the final report (the `share-results` step in `wizard`/`dataset`/`experiment`/`investigate` modes, or the benchmark scorecard's Unreplayable row in `benchmark` mode). Carry the skipped list forward the same way.

   **The verdict you produce here is persisted onto the REPLAY trace IDs (not the originals).** That's what makes "did this fix actually pass on replay?" queryable across iterations.

   **Persist via `persistReplayLabels.js`.** Write the verdicts to a tmp JSON file then run the script — one Bash call, one batched MCP call server-side, file is auto-deleted on success:

   1. Pick a tmp path. Recommended: `.bitfab/tmp/verdicts-<testRunId>.json` (create the dir if missing). Falls back to `os.tmpdir()` if the project root isn't writable.
   2. Use the `Write` tool to write JSON of this exact shape:

   ```json
   {
     "expectedTraceIds": ["<replayTraceId1>", "<replayTraceId2>", "..."],
     "verdicts": [
       { "traceId": "<replayTraceId1>", "label": true, "annotation": "Now returns the missing field; original annotation said it was empty.", "confidence": "High" },
       { "traceId": "<replayTraceId2>", "label": false, "annotation": "Output still hallucinates a tool argument.", "confidence": "VeryHigh" },
       { "traceId": "<replayTraceId3>", "skip": true }
     ]
   }
   ```

   `expectedTraceIds` MUST be the full set of REPLAY trace IDs you committed to verdict (every completed item from the run). `verdicts` MUST have one entry per ID — either a `{label, annotation, confidence?}` verdict or a `{skip: true}` explicit skip. `confidence` is optional but recommended (`VeryLow|Low|Medium|High|VeryHigh`); it surfaces in the labeling UI so reviewers can prioritize low-confidence verdicts. If verdict counts don't match `expectedTraceIds`, the script returns `status: "missing-coverage"` and the verify step routes you back to fill the gaps.

   3. Run the script:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/persistReplayLabels.js" .bitfab/tmp/verdicts-<testRunId>.json
   ```

   4. Read its single JSON line on stdout. Hold the parsed result for the next step.

   **Spill working notes to a separate tmp file if context gets big.** Don't conflate working notes with the verdicts file — the script deletes the verdicts file on success.
13. **Run only when mode is `wizard`, `dataset`, `experiment`, `investigate` or `benchmark`.**

   **Verify replay labels persisted.** Route on the `status` field of the JSON the script printed in `evaluate-results`. The script is the deterministic gate — if it didn't return `ok`, the agent's verdicts are NOT yet on the replay traces and the experiment delta will be wrong on the next iteration.

   - **`status: "ok"` (every replay trace has a verdict or explicit skip persisted)** — labels are persisted on the replay traces and the verdicts file is gone. In `benchmark` mode continue to the benchmark scorecard (a terminal report, no iteration); in all other modes continue to share-results (experiments page was already opened before evaluation) → step 1 of the Phase Benchmark: Scorecard phase (mode `benchmark`); stop (mode `add-trace` or `replay`); otherwise step 15
   - **`status: "missing-coverage"` (script returned a non-empty `missingTraceIds` array)** — you under-verdicted. Read the missing replay trace IDs (use `mcp__Bitfab__read_traces` with `scope: "summary"` or `"full"` if you didn't already), decide each one (PASS / FAIL with annotation, or `skip: true` if genuinely ambiguous), write a NEW verdicts file at the same path covering ALL the originally expected IDs (the script needs the full `expectedTraceIds` list each call, not just the gaps), and re-run the script. Loop back here with the new result → step 13
   - **`status: "invalid-input"` (malformed verdicts JSON or missing fields)** — the verdicts file you wrote doesn't match the schema. Read the script's `message` field, fix the JSON (most common: missing annotation on a non-skip entry, missing traceId, expectedTraceIds empty), and re-run the script. Loop back here → step 13
   - **`status: "mcp-error"` (MCP call to update_agent_labels failed mid-batch)** — network or auth error. The script's `partialTraceIds` lists which IDs were already persisted. Tell the user, recommend re-running the script (it's idempotent — already-persisted labels just upsert), and loop back here. If it keeps failing, stop and surface the error → step 13
14. **Run only when mode is `wizard`, `dataset`, `experiment`, `investigate` or `benchmark`.**

   **Open experiment viewer (fallback).** This step only runs when replay trace IDs are available (routed here from `check-trace-id-support`). If no `testRunId`s were captured, skip this step and continue to evaluate.

   **In `benchmark` mode without the `studio` flag, skip this step entirely** (no Studio is open). With the `studio` flag, benchmark behaves like the other modes below: skip if the experiments page was already opened via `experimentGroupId` in `open-experiments-before-replay`, otherwise navigate with the collected `testRunId`s. Either way this step's `next` goes to `evaluate-results`, which in benchmark mode scores the items, persists verdicts, and then routes to the terminal benchmark scorecard. (The numbered position of this step in the rendered list does not reflect run order: follow the `next` routing, not the list sequence.)

   If the experiments page was already opened via `experimentGroupId` in `open-experiments-before-replay` (`supportsExperimentGroups` is true), skip this step entirely, the page is already showing live results.

   If `supportsExperimentGroups` is false, navigate Studio to the experiments page. Build the path with **every** `testRunId` you've collected across iterations of this phase (comma-separated):

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/openStudioTo.js" "/studio/experiments?testRunIds=<testRunId1>,<testRunId2>,<testRunId3>"
   ```

   In `benchmark` mode (with the `studio` flag), append `&mode=benchmark` here too so the page shows benchmark terminology. Likewise, if this is a token-cost run (see the token-cost lens note in `open-experiments-before-replay`), append `&tokens=1` so the token-cost columns show. The command navigates an existing session or opens a new one automatically.
15. **Run only when mode is `wizard`, `dataset`, `experiment` or `investigate`.**

   **Share results to the user.**

   > "After N experiments these are the results: X/Y traces now pass (Z unreplayable, excluded from pass/fail).
   >
   > - ✅ Trace `abc123`: Now passes — [how the annotation's issue was resolved]
   > - ❌ Trace `def456`: Still failing — annotation said [X], output still [Y]
   > - ❌⚠️ Trace `ghi789`: Was passing, now failing (regression)
   > - ⚠️ Trace `jkl012`: Unreplayable — [DB record not found / FK violation / write rejected]"

   Keep `unreplayable` out of the pass-rate denominator. If `unreplayable > 0`, name the cause (missing record, write blocked, env mismatch) and note that fixing the env or trimming those trace IDs will clean up the next iteration. If `check-replay-health` fired in the previous iteration too, flag that infra has now blocked two runs and recommend fixing it before another experiment.

   Show this across the full data set, and highlight the best outcome concisely. Explain why it worked best with references to code, docs, and/or research if needed. For the best outcome:

   - **If pass rate improved and no regressions**: ask the user to confirm whether they want to keep iterating or stop
   - **If pass rate improved but regressions exist or no improvement**: tell the user and propose to create a plan for new experiments and continue iterating.

   **If running in text-only mode** (trace IDs were unavailable): append a note that cross-iteration comparison isn't available without trace IDs. Each iteration's results are visible only in-agent for the current run. Upgrading to `@bitfab/sdk` 0.13.6+ and updating the server unlocks persistent experiment tracking across iterations, side-by-side comparison in Studio, and the full experiments page.

   Ensure your question includes your recommended next step.

   > A) **Keep iterating** — run another experiment from the plan *(recommended)* → step 5
   > B) **Stop and wrap up** — move to the final summary → step 1 of the Phase 6: Validate & Wrap Up phase

## Phase Replay: Single-Trace Quick Replay

**Run only when mode is `replay`.**

Reached only from `replay` mode. The user already has a trace ID and (usually) already made a fix; they just want to replay that one trace and hear whether it worked. This is the **minimal, atomic** path: no Studio/browser, no dataset, no labeling, no experiment groups, no server-side verdict persistence. Locate the replay script, read the trace, run replay against the single trace ID, compare the new output to the original, and report a one-line verdict in chat. The only server interaction is the replay itself (the SDK creates a test run intrinsically); nothing else is persisted.

1. **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" started "Setting up replay"`.

   **Both sub-steps run without user interaction. No questions, just execute.**

   **1. Read the trace (and resolve the function key).** Call `mcp__Bitfab__read_traces` with the trace ID argument and `scope: "full"`. Hold the trace's label, annotation, inputs, and output in context — these are the acceptance criteria for the verdict. **If the user gave only a trace ID and no function key** (common with free-form requests like "did my fix work on `<id>`"), take the trace function key from the trace itself — don't ask the user for it.

   **2. Find the replay script.** Search for files matching `scripts/replay.*`, `scripts/*replay*`, or any file importing `bitfab.replay` / `client.replay`, and confirm it covers that trace function key. (You don't need to grep for capability flags here — this minimal path doesn't use code-change payloads, experiment groups, or verdict persistence.)

   - **replay script found and trace readable** — continue to run the replay → step 2
   - **no replay script found for this function** — tell the user: "No replay script found for `<key>`. Run `$bitfab:setup replay <key>` to create one, then re-run this command." Stop the flow → step 1 of the Cleanup phase
   - **trace not found or unreadable** — tell the user the trace ID wasn't found or is inaccessible, stop → step 1 of the Cleanup phase
2. **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" started "Running replay"`.

   **Run the replay against the one trace ID. No user interaction, no extra flags.**

   ```bash
   cd <project-dir> && npx tsx <replay-script> <function-key> --trace-ids <trace-id>
   ```

   Do **not** pass `--code-change` or `--experiment-group-id` — this minimal path skips code-change payloads and experiment groups. Capture the JSON output and exit code.

   **Quick health check.** If the replay crashed (non-zero exit, no items) or the single item has `item.error` set, hold the error for the verdict step. Otherwise hold the completed item's new output alongside the original output you read in `setup`.
3. **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" started "Evaluating result"`.

   **Compare the single replay result to the original and report in one line.** Nothing is persisted; this is an in-chat verdict.

   **If the replay errored** (crashed or `item.error` set): report the error clearly. This is an infra issue (missing DB row, env mismatch, etc.), not a code failure. Offer to retry after fixing the env, or to stop.

   **If the replay completed**, compare the new output against the original trace's label and annotation, then report one line:

   - Original was **fail** with an annotation: does the new output address it? → "**Pass**: the fix addresses the original failure ('<annotation summary>')." vs "**Still failing**: <what's still wrong>."
   - Original was **pass**: preserved → "**Pass**: output unchanged in quality." regressed → "**Regressed**: was passing, now <what broke>."
   - No label on the original: show a short before/after diff and summarize whether it looks better.

   > A) **Iterate** — make another change and re-replay the same trace → step 4
   > B) **Done** *(recommended)* → step 1 of the Cleanup phase
4. **Make another change before re-replaying.** Ask what to change, or let the user describe the fix. Edit the code, then loop back to run the replay again. If the user says they'll make the change themselves, wait for their message, then proceed.

## Phase 6: Validate & Wrap Up

**Run only when mode is `wizard`, `dataset`, `experiment` or `investigate`.**

1. **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" completed "Done"`.

   **Summary.** Present the final results similar to this. You may expand where appropriate based on context from the user:

   > "**Improvement summary for** `<traceFunctionKey>`:
   >
   > - Failed traces fixed: X/Y (from N% → M% pass rate on labeled failures)
   > - Full replay pass rate: A/B (Z unreplayable, excluded)
   > - Changes made:
   >   - [File]: [Description of change]
   >   - [File]: [Description of change]
   >
   > The changes are in your working tree (not committed). Review the diffs and commit when ready."

   If `Z > 0`, add one line naming the infra cause (e.g. "Z traces unreplayable — missing DB rows; refresh the dataset or scope to a snapshot next pass") so the user has a next step beyond the code.

## Phase Benchmark: Scorecard

**Run only when mode is `benchmark`.**

1. **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" completed "Done"`.

   **Benchmark scorecard.** Present the results of replaying the dataset against the current code (no changes were made). Print the scorecard as Markdown directly in chat. Use two tables.

   **Table 1 — Summary** (one row per metric):

   ```markdown
   **Benchmark results for** `<traceFunctionKey>` · dataset `<datasetName>`

   | Metric | Count |
   |---|---|
   | Pass rate | X/scorable (Z%) |
   | Still passing | K |
   | Still failing | M |
   | Regressions | N |
   | Fixed | F |
   | Unreplayable | U (excluded) |
   | Skipped | S (excluded) |
   ```

   **Table 2 — Per-trace breakdown** (one row per dataset trace). Sort rows by verdict in this order: regressions first, then still-failing, then fixed, then still-passing, then unreplayable, then skipped last:

   ```markdown
   | Trace | Label | Verdict | Detail |
   |---|---|---|---|
   | `ghi789` | pass | ❌ regression | was passing, replay now fails: [why] |
   | `jkl012` | fail | ❌ still failing | annotation said [X], output still [Y] |
   | `def456` | fail | ✅ fixed | replay now addresses: [annotation] |
   | `abc123` | pass | ✅ still passing | output preserved |
   | `mno345` | — | ⚠️ unreplayable | [error reason] |
   | `pqr678` | fail | ⏭️ skipped | output genuinely ambiguous; not verdicted |
   ```

   Use ✅ for pass-verdict rows (fixed, still-passing), ❌ for fail-verdict rows (regression, still-failing), ⚠️ for unreplayable, and ⏭️ for skipped (an item you explicitly marked `skip: true` in `evaluate-results` because the output was genuinely ambiguous). Keep `Detail` to one short line per row (truncate long annotations/outputs). Keep **both `unreplayable` and `skipped` out of the pass-rate denominator.** Define the counts explicitly: `T` = total traces in the dataset; `U` = unreplayable; `S` = skipped; `scorable` = `T − U − S` (the items that got a real pass/fail verdict); `X` = the count that passed (✅ fixed + ✅ still-passing). `Pass rate` = `X / scorable` (so the summary table's "X/scorable" uses these exact numbers). **If `scorable` is 0** (every trace was unreplayable or skipped, so nothing got a real verdict), report `Pass rate` as `N/A (0 scorable)` instead of `0/0`, and add a line that no trace could be scored this run. If `U > 0`, add one line under the tables naming the cause (missing DB rows, FK violation, env mismatch). Omit the `Skipped` summary row and any skipped table rows entirely when `S` is 0.

   **If running in text-only mode** (trace IDs were unavailable): append a one-line note under the tables that persistent results require upgrading to `@bitfab/sdk` 0.13.6+.

   This is a terminal step. Report the scorecard and stop. Do not offer to iterate or make changes (the user can run `$bitfab:assistant experiment <key>` separately if they want to fix failures).

## Cleanup

**Run only when mode is `wizard`, `dataset`, `experiment`, `investigate`, `benchmark` or `replay`.**

1. Close Studio. Run this unconditionally: it resolves the active session from disk, closes the Studio tab, stops the background `openStudioTo.js` event process, and exits quietly (`{"event":"no-active-studio"}`) when nothing was opened:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/closeStudio.js"
   ```

   No sessionId argument is needed; do not track or look up one. This is silent housekeeping: never narrate it, reason about whether a session was opened, or report the outcome to the user (no "closing Studio", no "nothing to close").
