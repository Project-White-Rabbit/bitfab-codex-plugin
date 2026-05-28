---
name: assistant
description: "Iterate on a traced function to improve pass rates using failed traces, labeling, and replay. TRIGGER when: user wants to fix failing AI outputs, improve pass rates, debug LLM behavior, iterate on prompts, label traces, run experiments, or says anything like 'fix my AI', 'improve pass rate', 'why is this failing', 'iterate on traces', 'debug my agent', 'review traces'. SKIP when: user wants to instrument new code or set up tracing (use bitfab:setup instead)."
---

# Bitfab Assistant

Use the local plugin MCP tools (`mcp__Bitfab__list_trace_functions`, `mcp__Bitfab__search_traces`, `mcp__Bitfab__read_traces`, `mcp__Bitfab__update_agent_labels`, `mcp__Bitfab__list_datasets`, `mcp__Bitfab__create_dataset`, `mcp__Bitfab__add_traces_to_dataset`, `mcp__Bitfab__remove_traces_from_dataset`, `mcp__Bitfab__list_experiments`, `mcp__Bitfab__get_experiment_traces`) to find what's failing in a traced function, build a dataset of labeled traces, and iterate on the code/prompts using replay until pass rates improve.

**MCP tools:** This skill uses `list_trace_functions`, `search_traces`, `read_traces`, `update_agent_labels`, `list_datasets`, `create_dataset`, `add_traces_to_dataset`, `remove_traces_from_dataset`, `get_trace_plan`, `list_experiments`, and `get_experiment_traces` from the **local plugin MCP server** (bundled with this plugin), exposed under the `mcp__Bitfab__*` prefix.

**When the flow branches, always present the options clearly and wait for the user's answer before proceeding.** Number or letter the options so the user can pick by reference. Rules:

- Recommend an option first, explain why in one line
- Present 2-5 concrete options
- One decision per question — never batch

This skill has four invocation modes, each a different entry point into the same pipeline. All modes converge: once they reach the shared phases (dataset → diagnose → experiments → wrap up), they follow the same path to the end. The user can stop early at any decision point, but the default is to continue. Most sub-modes require the trace function key as the argument because they skip the function picker (Phase 1) and instrumentation/replay verification (Phase 2).

| Mode | Invocation | Action |
|---|---|---|
| `all` | `$bitfab:assistant`, `$bitfab:assistant all [<key>]`, or `$bitfab:assistant <key>` | Full flow: pick function → verify instrumentation → pick or create dataset → label → diagnose → iterate → wrap up |
| `investigate` | `$bitfab:assistant investigate [<key>]` | Free-form investigation of an issue the user is describing. Read traces and code as needed to characterize the problem, then offer to stop with a summary, write a written analysis report, or roll into dataset building and continue through experiments. `<key>` is optional, the agent picks the function from what the user says when it isn't given |
| `dataset` | `$bitfab:assistant dataset <key>` | Build or extend a labeled dataset for one function, then diagnose failures and iterate with experiments. Picks an existing dataset or creates a new one |
| `experiment` | `$bitfab:assistant experiment <key> [<dataset-id>]` | Run experiments to fix failing traces against a labeled dataset, then wrap up. If `<dataset-id>` is omitted, you'll be asked to pick one. If the function has no datasets yet, run `$bitfab:assistant dataset <key>` first |

**Argument routing.** If the argument is free-form text (not a mode name or bare function key), infer the best mode and extract the trace function key if mentioned. Confirm your pick in one line before entering the flow (e.g. "Starting investigate for `generate-email`."). If you can't pick a single mode, ask as a numbered choice.

In sub-modes that take a function key, grep the codebase for `<key>` early so labeling and experiments are grounded in the actual instrumented function (the full flow does this in Phase 2; sub-modes skip Phase 2 entirely). `investigate` mode does its own function lookup and code grep in Phase Investigate.

**Studio** is the companion browser surface for the entire assistant flow. It opens automatically at the start and stays open throughout all phases. Individual phases navigate the Studio to the relevant page (dataset review, experiment viewer, etc.).

**Opening a trace plan, when asked.** Opening trace plans is part of this skill, not a separate primitive — but only do it when the user asks (or the context clearly implies it, e.g. they said "show me what's captured"). Never auto-open. When triggered, run two sequential calls (step 2 needs the planId from step 1, so they can't be batched): (1) `mcp__Bitfab__get_trace_plan` with `{ traceFunctionKey: "<key>" }` returns the plan id, then (2) `navigateStudio.js <sessionId> "/studio/trace-plan/<planId>"` (substituting the id from step 1) routes the already-open Studio tab there in-place. The Studio chrome (header, session indicator, agent activity) stays mounted around the trace plan content — no new tab pops up. No questions, no preamble, no summary up-front. If no plan exists for the key, say so in one line and offer `$bitfab:setup modify <key>` to build one.


🚨 **Blocking-process rule (applies to any plugin command described as "blocks until the user does X"):** When you launch a plugin CLI that blocks on a Studio interaction (`login.js`, etc.), you MUST keep the exec session alive and keep polling it until the process exits on its own.

- The process opens Studio (or navigates an existing Studio session) and polls for the user's action via agent session events. It exits only after the user completes the action in Studio (or after the timeout).
- After launching the command, keep polling the live shell/exec session at least every few seconds with your normal "read more output" tool (`write_stdin`, `read`, or whatever your runtime's equivalent is for the long-running shell). Do not idle waiting for a user message.
- Do not send a final "waiting for you to click Confirm" text and then stop polling; the user's confirmation does NOT come back to you as a chat message; it comes back as the plugin process exiting with output on stdout.
- Stop polling only when one of: (a) the process exits 0 and prints its completion summary, (b) the process exits non-zero, or (c) the user explicitly cancels.
- When the process exits, immediately continue with the next step in the flow, do not wait for another user message.

## Phase 0: Status + Update Check

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
1. Then run the status command:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/status.js"
   ```

   Watch the output and route on it:

   - **not authenticated** — stop the flow immediately. Tell the user to run `$bitfab:setup login` first
   - **authenticated (with or without a `v<X> available` upgrade notice)** — continue to the Studio gateway. If an upgrade notice appeared, pass it through to the user verbatim, but don't block on it; surface the notice once and move on

## Studio Lifecycle

The Studio is the companion browser surface for the entire assistant flow. It opens once at the start and stays open throughout all phases. Individual phases navigate the Studio to the relevant page (dataset review, experiment viewer, etc.) using `navigateStudio.js`. If the Studio background process outputs `{"event":"session-ended",...}` at any point, the user has closed the Studio early. This is not an error: continue the flow normally, but skip any `navigateStudio.js` calls for the rest of the session (the session is gone). Do **not** attempt to reopen the Studio.

If any `navigateStudio.js` call outputs `{"event":"not-responding",...}`, the Studio browser tab may still be open but the event pipeline is broken (e.g. the `openStudio.js` background process died). **First try reconnecting** to the existing session by running `openStudio.js --existing <sessionId> [agentSessionId]` as a background process. This restarts the event poll loop without opening a new browser window. If the reconnected session receives events normally, continue with the same `sessionId`. If reconnecting also fails (e.g. the browser tab was truly closed), then open a fresh Studio with a new session and update your `sessionId`.

1. **If you already have a `sessionId` in context** from a previous `studio/open` step in this conversation, skip opening a new Studio. Instead, navigate the existing session to the desired page:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/node_modules/bitfab-plugin-lib/dist/commands/navigateStudio.js" <sessionId> <initialPath>
   ```

   This outputs JSON on stdout:
   - `{"event":"navigated","sessionId":"...","path":"..."}`: Studio is alive and responded. Continue the flow with the existing sessionId.
   - `{"event":"not-responding","sessionId":"..."}`: Studio did not respond within 12 seconds. The browser tab may still be open. **Reconnect first**: run `openStudio.js --existing <sessionId> [agentSessionId]` as a background process to restart the event poll loop without opening a new window. Then retry the `navigateStudio.js` call. If it still fails, open a fresh Studio (below).

   **If you do NOT have a sessionId** (first run, or after reconnect also failed), start the Studio as a long-running background process. The command accepts an optional initial path argument so Studio opens directly at the relevant page, and an optional agent session ID (from the `agent_session_id` in your SessionStart context) so the studio session can be recovered after compaction.

   **The `initialPath` MUST start with `/studio`.** Never pass `/`, a bare URL, or any path outside the `/studio/` route tree. Omit the argument entirely to default to `/studio`.

   - **`all` mode:** pass `/studio`
   - **`dataset <key>` mode:** pass `/studio/trace-functions/<key>/datasets/labeled`
   - **`experiment <key>` mode:** pass `/studio`
   - **`investigate [<key>]` mode:** pass `/studio`

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/openStudio.js" <initialPath> [agentSessionId]
   ```

   `initialPath` is required. Always pass it explicitly, even when using the default `/studio`.

   Run it via your runtime's "long-running exec session" mechanism.

   The script outputs JSON lines on stdout:

   - `{"event":"started","sessionId":"..."}` on startup: capture the `sessionId` and hold it in working context for the rest of the flow. Every `navigateStudio.js` call in later phases uses it.
   - `{"event":"auth-required","sessionId":"..."}` if the user is not signed in to Bitfab in their browser: tell the user to sign in to Bitfab in the Studio window that just opened, then wait for the `authenticated` event before continuing.
   - `{"event":"authenticated","sessionId":"..."}` the user has signed in. Continue the flow.
   - `{"event":"session-ended","sessionId":"..."}` if the user closes the Studio: the process exits. See the lifecycle note above.

   Status messages (e.g. "Opening Studio: ...") go to stderr, not stdout. Filter to JSON lines only.

   **Recovering after compaction:** If the Studio is already open from a prior context window but you've lost the `sessionId`, recover it:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/node_modules/bitfab-plugin-lib/dist/commands/recoverStudio.js" <agentSessionId>
   ```

   It prints `{"studioSessionId":"...","agentSessionId":"..."}`. Use `studioSessionId` for all subsequent `navigateStudio.js` and `pushActivity.js` calls. If it returns `{"error":"no-active-studio"}`, the Studio was never opened or has been closed; open a new one.

## Phase 1: Identify the Trace Function

**Run only when mode is `all`.**

If a `traceFunctionKey` was provided as an argument, skip the listing and the user prompt — but still cross-check the provided key against the local codebase before moving on. Otherwise, work through all four steps below:

1. **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" <sessionId> started "Identifying trace function"`.

   **Skip this step if a `traceFunctionKey` argument was provided** — use the argument directly and continue to cross-check. Otherwise, call `mcp__Bitfab__list_trace_functions` to list all available trace functions. Use **only** the keys and metadata returned (trace counts, last activity) — do NOT invent or infer descriptions of what each function does from its key name. Key names are often ambiguous or misleading, and guessing produces hallucinated descriptions that confuse the user.
2. **Cross-check each key against the local codebase** before presenting. For each returned key, `grep` the repo for string-literal uses of that exact key (across `*.ts`, `*.tsx`, `*.py`, `*.rb`, `*.go`, `*.baml`). Mark each function in the presented list as:

   - **✅ instrumented here** — found in this repo, with the file path
   - **⚠️ not found in this repo** — traces exist on Bitfab but the key isn't in this codebase (likely another repo or a renamed key)
3. **Skip this step if a `traceFunctionKey` argument was provided** — there's no list to present. Otherwise, present the full list in the question text showing ONLY: `<key>` · `<trace count>` · `<last activity>` · `<instrumented-here marker + path, or not-found marker>`. No invented summaries.
4. **Skip this step if a `traceFunctionKey` argument was provided** — the function is already chosen. Otherwise, ask the user with 2 options: the recommended function (prefer one that is ✅ instrumented here AND has recent activity) and a free-text "Type a function key" option. If nothing is instrumented here, say so explicitly in the question — don't hide it.

## Phase 2: Verify Instrumentation & Replay

**Run only when mode is `all`.**

Check that this trace function has both instrumentation and a replay script.

1. **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" <sessionId> started "Verifying instrumentation"`.

   Search the codebase for the trace function key to confirm SDK usage:

   - TypeScript: `grep -r "<traceFunctionKey>" --include="*.ts" --include="*.tsx"`
   - Python: `grep -r "<traceFunctionKey>" --include="*.py"`
   - Ruby: `grep -r "<traceFunctionKey>" --include="*.rb"`
   - Go: `grep -r "<traceFunctionKey>" --include="*.go"`

   If the key is found, note the file location — this is the code you'll iterate on in later phases.

   If the key is NOT found in the codebase, the function is instrumented elsewhere (the traces exist on Bitfab). Ask:

   > "I can't find `<traceFunctionKey>` in this codebase — it may be instrumented in another repo or under a different key."
   >
   > A) **Instrument now** — set up tracing in this codebase *(recommended)*
   > B) **Continue anyway** — work with the traces even without local code
   > C) **Pick a different function**
   > D) **Stop**

   If the user chooses **"Instrument now"**, invoke `$bitfab:setup instrument`, then verify whether a replay script exists for this function. If **"Continue anyway"**, skip the replay-script check and start building the dataset — there's no local code to iterate on yet.
2. Search for a replay script that covers this trace function:

   - Look for files matching `scripts/replay.*`, `scripts/*replay*`, or any file that imports `bitfab.replay` / `client.replay`
   - Read the script and check that it maps the target trace function key

   If a replay script exists but targets a different function key, do NOT modify the existing script or suggest changing the code's function key. Instead, treat it as "no replay script for this function" and offer to create a new one.

   If no replay script exists or it doesn't cover this function, ask the user:

   > "No replay script found for `<traceFunctionKey>`."
   >
   > A) **Create replay now** — create the replay script inline *(recommended)*
   > B) **Pick a different function**
   > C) **Stop**

   If the user chooses **"Create replay now"**, invoke `$bitfab:setup replay`, then start building the dataset.

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

   > A) **Stop here** — the in-chat summary is enough; no further artifact
   > B) **Write an analysis report** — save the findings to a markdown file I can share or revisit later
   > C) **Build a labeled dataset** — use these traces as seed candidates and label them so we can iterate against them later *(recommended)*

   If the user picks option A, kill the Studio background process (send SIGINT or abort the background task) before stopping, so it doesn't linger as an orphan. Option B kills Studio on exit (the report step). Option C continues through dataset building, diagnosis, and experiments, with Studio staying open throughout; Phase 6 kills it at wrap-up.
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

   After writing, tell the user the file path so they can open or share it. Then stop, kill the Studio background process (send SIGINT or abort the background task), and exit. Do NOT roll into dataset building automatically; that is option C, not option B.

## Phase 3: Pick a Dataset and Label Traces

**Run only when mode is `all`, `dataset` or `investigate`.**

A **dataset** is the named bucket of labeled traces an experiment replays against. This phase picks (or creates) one for the trace function, labels candidate traces, attaches them to the dataset, then hands off to the per-dataset review page where the user approves labels and can ask the agent to add or remove traces.

In `dataset` mode this phase is the entry point — Phase 1 (function picker) and Phase 2 (instrumentation/replay verification) are skipped, so the trace function key comes from the argument. Before calling any MCP tools, grep the codebase for the key (e.g. `grep -r "<traceFunctionKey>" --include="*.ts" --include="*.tsx" --include="*.py" --include="*.rb" --include="*.go" --include="*.baml"`) and note the file path — every later step ("Label them yourself", and Phase 4 "Read the code" in `all` mode) needs it.

1. **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" <sessionId> started "Building dataset"`.

   **Pick or create a dataset** — Call `mcp__Bitfab__list_datasets` with the trace function key. Then branch on whether any exist. Hold the chosen `datasetId` in working context — every step from here on uses it.

   - **no datasets exist for this function (list_datasets returned empty)** — **don't ask** — silently call `mcp__Bitfab__create_dataset` with `traceFunctionKey: <key>` and `name: <key>` (just the trace function key as the name; the user can rename it later in the UI if they want). Hold the returned `datasetId` and continue. The first-time user shouldn't have to answer a name prompt before they've even seen the dataset.
   - **one or more datasets already exist** — present them to the user as a numbered choice, with one option per existing dataset (name · id · current trace count) plus a "Create new" option. Recommend the most recently used dataset that has traces. If the user picks an existing dataset, hold its id and continue. If the user picks "Create new", silently call `mcp__Bitfab__create_dataset` with `name: "<key> #N"` where N is one more than the number of existing datasets (e.g. `eval-assistant #2`) — don't ask for a name. Hold the new id and continue.
2. **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" <sessionId> started "Reviewing dataset"`.

   Open the dataset review page for the user **immediately** after picking or creating the dataset. Use `navigateStudio.js` to route the already-open Studio to the dataset review page using the `sessionId` captured in the `studio/open` step:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/node_modules/bitfab-plugin-lib/dist/commands/navigateStudio.js" <sessionId> "/studio/trace-functions/<functionKey>/datasets/<datasetId>"
   ```

   The command sends a navigate event and exits immediately. The path must stay within the `/studio/` route tree so the Studio shell (header, session management) stays mounted. The `?session=` param is appended automatically by the shell's navigate handler.

   If the Studio was closed early (`session-ended` event from the background process), skip the navigation call but still check the dataset.

   **After opening, check whether the dataset already has traces.** Call `mcp__Bitfab__search_traces` with `traceFunctionKey: <key>`, `datasetId: <datasetId>`, `limit: 1` to see if the dataset is populated.

   - **the dataset already has traces (search returned results)** — The dataset is not empty. Tell the user the dataset page is open with the existing traces, and they can review, approve, or edit labels there. Then go straight to waiting for their review. Do NOT ask how to source new candidates or offer to find more traces. The user should review what's already in the dataset first; they can request more traces via the "Edit with agent" button if needed.
   - **the dataset is empty (search returned no results)** — The dataset has no traces yet. Tell the user the dataset page is open in a "waiting for traces" state, and that traces will appear there live as you search and add them. Then proceed to find candidate traces.
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

   > A) **Define new criteria** — tell me what to find (failure pattern, customer reports, etc.) and I search unlabeled traces
   > B) **Reuse existing labels for this function** — seed the dataset with traces that already have validated labels, then optionally add more *(recommended)*
   > C) **Open — you decide** — broad sample with no hypothesis; ignore prior labels for the search shape
4. **Seed dataset from existing validated labels.** Reachable only when the user picked Option B in `ask-search-mode`. Pull traces that already have a validated label (human-authored, or agent-authored and human-approved) for this function, attach them to the picked dataset, and route on whether the user also wants to add more.

   1. Call `mcp__Bitfab__search_traces` with `traceFunctionKey: <key>`, `validated: true`, and a generous `limit` (50 is the cap). Both `labelResult: true` and `labelResult: false` matter — failures are the hill-climbing signal, but passes anchor the regression boundary. If 50 isn't enough to cover the function's labeled history, run a second call with `labelResult: false` only to bias toward fails first, then a third with `labelResult: true`. De-dupe trace IDs across calls.
   2. Call `mcp__Bitfab__read_traces` with `scope: "summary"` on the resulting trace IDs so the labels + annotations are in working context. Don't re-label them — these are already validated.
   3. Call `mcp__Bitfab__add_traces_to_dataset` once with `datasetId` (the one picked in `list-datasets`) and the full deduped trace ID array. The call is idempotent, so re-attaching IDs already in the dataset is a safe no-op.
   4. Briefly summarize for the user: "Seeded the dataset with N reused labels (M fails, K passes). Want me to find more candidates to label, or is this set enough to move on?"

   > A) **Find more candidates to label** — go through the regular intent + search + label flow on top of the reused set
   > B) **Move on with just the reused set** — skip further labeling; the dataset page is already open with the reused traces streamed in *(recommended)*
5. **Ask what kinds of traces to find** — The user picked "Define new criteria" (or arrived here from the reuse path wanting more). Find out what they're actually trying to surface. The trace function may have thousands of traces; "what should I label?" is the question that makes the rest of this phase useful.

   When asking, ask the user with these options (and a free-text fallback so the user can describe something specific):

   - **A — Failures of a certain kind** *(recommended when the user already has a hypothesis)* — they tell you the pattern (empty outputs, hallucinated tool args, regressions on a specific input shape, etc.) and you search for matching traces
   - **B — Recent customer complaints / reports** — they paste or describe specific incidents and you find the matching traces by user, session, or time window
   - **C — Open-ended, you decide** — no hypothesis yet; you sample broadly across recent traces, look for diversity, and surface anything that looks like a candidate failure or interesting edge case

   Hold the user's answer (the chosen option **and** any free-text detail) in working context — the next step uses it to shape the `mcp__Bitfab__search_traces` filters and which traces to prioritise reading. If they pick C, default to recent + diverse + non-empty outputs.
6. **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" <sessionId> started "Searching traces"`.

   **Find unlabeled traces** — Search without label filters to find unlabeled traces for the trace function. **Shape the search by the intent captured in the previous step** (or by the prior dataset's existing labels, if any): Option A = filter to traces matching the user's described failure pattern; Option B = filter by the user, session, or time window of the reported incidents; Option C = default sweep (recent, diverse inputs, non-empty outputs). Use `mcp__Bitfab__search_traces` with the relevant filters, then `mcp__Bitfab__read_traces` with `scope: "summary"` to read candidates and identify which are worth labeling — look for diverse inputs, traces that produced output (not empty), and traces that cover different scenarios under the chosen intent. Filter out near-duplicates and uninteresting traces. If every trace is already labeled and attached to this dataset, you can move straight on with no new candidates.
7. **Ask how the user wants to label** — Before any verdicts go on these candidate traces, ask the user how the user wants to label them. There are exactly two modes, and the answer determines whether you call `mcp__Bitfab__update_agent_labels` at all:

   > A) **Agent labels first, I approve / edit** — agent makes a first pass; you approve or edit each verdict in the labeling page *(recommended)*
   > B) **I'll label them manually** — no agent verdicts; you label every trace from scratch in the labeling page

   Recommend Option A — an agent first pass turns the labeling page into a quick approve/edit review. But respect the user's choice: if they pick B, do **not** call `mcp__Bitfab__update_agent_labels` for any of these candidates. They want to label from scratch in the labeling page, with no agent verdicts pre-filled. If no new candidate traces were found in the previous step, skip this question and continue.
8. **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" <sessionId> started "Labeling traces"`.

   **Agent first pass: label them yourself before opening the labeling page** — Reachable only when the user picked Option A in the previous step. **You** label the approved candidate traces so the labeling page becomes an approve/edit review instead of a blank labeling session. Call `mcp__Bitfab__read_traces` with `scope: "full"` on the approved trace IDs (batch them — up to 10 per call), read each trace's inputs / output / spans yourself, and decide for each one whether it looks like a PASS or a FAIL. **Ground your judgment in the codebase, not just the trace text.** Before you start labeling, read the instrumented function in the user's source (located in Phase 2 in `all` mode, or via the grep step in this phase's intro in `dataset` mode) and any nearby code that explains intent — comments, docstrings, README sections, related tests, BAML files — so you know what the function is *supposed* to do and what "good" looks like for it. Apply the same context to every trace: does this output achieve the function's goal as expressed in the code? Does it match the patterns in the already-validated traces? Then call `mcp__Bitfab__update_agent_labels` once with an array of `{ traceId, label, annotation }` objects — **both `label` (true for pass, false for fail) and `annotation` (a one-or-two-sentence explanation written for the human reviewer, ideally referencing what the code is trying to do) are required for every trace**. Commit to a verdict — if you genuinely cannot decide, you didn't read the trace or the code carefully enough. The labels you save here start unapproved; they only become part of the validated dataset once a human approves them in the labeling page.

   > 🚨 **HARD RULE — DO NOT SKIP (agent-first mode only):** When the user picked Option A, you MUST call `mcp__Bitfab__update_agent_labels` with verdicts for every approved trace BEFORE navigating Studio to the labeling page. Sending the user into an agent-first review with no pre-labeled verdicts is a process violation. (In manual mode this step is unreachable, and the rule does not apply.)

   > **Made a mistake?** If you realize a verdict was wrong (e.g., you mislabeled a trace or want to re-evaluate), call `mcp__Bitfab__update_agent_labels` again with `{ traceId, archive: true }` for those traces. The previous label is hidden (kept for audit), and you can re-label the trace from scratch with another `update_agent_labels` call.
9. **Attach candidate traces to the dataset** — Call `mcp__Bitfab__add_traces_to_dataset` with the `datasetId` chosen earlier and the array of approved candidate trace IDs (in agent-first mode, the ones you just labeled; in manual mode, the candidates the user approved in find-unlabeled). The call is idempotent — re-adding traces already in the dataset is a no-op, so it's safe to include the full set. If no new candidate traces were approved (the dataset was already populated), skip this step.

   The dataset review page is already open in Studio (opened earlier in `open-page`). Each trace you attach streams in live via real-time events, so the user sees them appear instantly. After attaching, tell the user the dataset is populated and ready for their review, then proceed to `await-event`.
10. **Wait for user to finish dataset review.** Use the **Monitor tool** to watch for the next JSON event from the Studio background process (`openStudio.js`, started in `studio/open`). The output file path was returned when you started the background process. Set up a monitor that tails only NEW lines (skip lines already read) and filters for JSON event lines:

   ```bash
   tail -f -n +<NEXT_LINE> <output-file> | grep -E --line-buffered '"event"'
   ```

   Where `<NEXT_LINE>` is the line number after the last line you already processed (e.g. if you read line 1 with the `started` event, use `-n +2`). Track which line you last processed so you don't re-fire on old events.

   The monitor will notify you when a new event arrives. Do NOT just read the output file once and wait, that will cause the flow to stall. The Studio process emits these events relevant to dataset review:

   - `{"event":"edit-with-agent","sessionId":"...","datasetId":"..."}` — the user clicked **Edit with agent**. Go to the modify loop, then come back here.
   - `{"event":"return-to-agent","sessionId":"..."}` — the user clicked **Done**, which triggered `returnToStudio()` and navigated back to `/studio`. Dataset review is complete.
   - `{"event":"session-ended","sessionId":"..."}` — the user closed Studio entirely.

   Filter to JSON lines only (skip status text). **Stay silent while waiting.** Do NOT print a narration line for each monitor notification (e.g. "The user selected trace X", "The user navigated back"). The user can already see the monitor stream. Only speak when you reach a branch point below or hit an error. Route on the `event` field:

   **Template editing during labeling.** The user may also ask to edit a template in chat while the Monitor is waiting (e.g. "change the LLM view", "edit the function template", "make the output less verbose"). This is NOT a Studio event; it arrives as a regular user message. If the user asks to edit a template, go to the edit-template-loop step. **Do NOT invoke `$bitfab:setup templates`** — that navigates Studio away from the dataset page and breaks the labeling flow. Template editing is handled inline here.

   - **`event: edit-with-agent`** — user clicked Edit with agent on the dataset page. Go to the modify loop, then come back here to read the next event
   - **`event: return-to-agent`** — user clicked Done on the dataset page. Dataset review is complete, move on to build + confirm the dataset
   - **`event: session-ended`** — user closed Studio. Stop the flow
   - **user asks to edit a template in chat** — user wants to change how traces render (e.g. 'edit the llm template', 'change the function view'). Go to the edit-template-loop, then come back here
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

   - **gate fails (no validated failing label — search returns nothing)** — tell the user and loop back to find or label more unlabeled traces
   - **gate passes (at least one validated failing label)** — get explicit approval, then continue

   Unapproved agent labels do **not** satisfy this gate by design — `validated: true` excludes them.
15. **Hold in-context** — This approved dataset is the benchmark for all experiments in Phase 5. Keep both the `datasetId` and the trace IDs in your working context throughout.

## Phase 4: Diagnose & Plan

**Run only when mode is `all`, `dataset` or `investigate`.**

1. **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" <sessionId> started "Diagnosing failures"`.

   **Understand failures.** Using the failed traces you read in Phase 3 (or read them now if you haven't):

   - Call `mcp__Bitfab__read_traces` on 3–5 failed traces with `scope: "full"`

   Synthesize the failure patterns — what's going wrong, what the common threads are.
2. **Read the code.**

   - Find the instrumented function in the codebase (in `all` mode you found it in Phase 2; in `dataset` mode you grepped for the key in Phase 3's intro; in `investigate` mode you found it in Phase Investigate's gather-context step)
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

Run an iterative improvement loop. Each iteration:

The Studio is already open (launched in the `studio/open` step at the start of the flow). Use the `sessionId` captured there for all `navigateStudio.js` calls. If the Studio was closed early (`session-ended` event), skip navigation calls but continue the improve loop normally.

1. **Run only when mode is `experiment`.**

   **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" <sessionId> started "Running experiments"`.

   The trace function key comes from the argument and no prior phase has run. Pick the dataset to iterate against, then locate the code:

   1. **Grep the codebase** for the trace function key (e.g. `grep -r "<traceFunctionKey>" --include="*.ts" --include="*.tsx" --include="*.py" --include="*.rb" --include="*.go" --include="*.baml"`) and note the file path. This is the code you'll iterate on.
   2. **Pick the dataset.** If a `<dataset-id>` argument was provided, use it directly. Otherwise call `mcp__Bitfab__list_datasets` with the trace function key, present the result to the user as a numbered choice, and use their choice. Hold the chosen `datasetId` in working context.
   3. **Load it.** Call `mcp__Bitfab__read_traces` with the dataset's trace IDs and `scope: "full"` so labels + annotations are in context.
   4. **Branch on the result:**

   - **no datasets exist for this function (`list_datasets` returned empty), or the picked dataset has no validated failing labels** — tell the user the function has no usable dataset yet and recommend running `$bitfab:assistant dataset <key>` first; kill the Studio background process; then stop the flow
   - **dataset loaded (≥1 validated failing label)** — summarize the dataset for the user (counts of pass/fail) and the failure annotations. Pick a first experiment from the failure patterns and continue
2. **Run only when mode is `experiment`.**

   **Decide once: parallel worktree subagents, or serial in this main agent.** The check is whether subagent worktree sessions would inherit bypass permissions.

   This editor doesn't support worktree-isolated subagents. Skip the bash check and take the serial branch.

   Hold the chosen mode in working context. Every iteration below (`make-change`, `replay-against-dataset`, `evaluate-results`) honors it.

   - **(unreachable on this editor)** — **Parallel mode.** For each independent experiment, fork to a subagent using the Agent tool with `isolation: "worktree"` and `subagent_type: "general-purpose"`. The subagent edits its worktree, runs replay, returns its scored items + `testRunId` to this main agent
   - **always** — **Serial mode.** Iterate experiments one at a time in this main agent. Subagent worktrees wouldn't inherit bypass permissions, so their Edit tool would be denied
3. **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" <sessionId> started "Making changes"`.

   **Make the change.**

   - Explain to the user what you're changing and why, and confirm before editing
   - For every file you intend to edit in this experiment: **read the file with the Read tool first** and keep its full contents in working memory as the **before** snapshot. Then edit. Then **read the file again** to capture the **after** snapshot. Both snapshots are required by the next step (`replay-against-dataset`) so the experiment dashboard can render the literal edit alongside the results — this is per-experiment, not cumulative
   - Hold a one-line **change description** in working memory too (e.g. "fix off-by-one in retry logic", "tighten extraction prompt"). It will be the experiment's title in the viewer
   - If a file is newly created, the before snapshot is the empty string `""`. If a file is deleted, the after snapshot is `""`. The path is always the repo-relative file path — no `repo`, `commit`, or other context fields
4. **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" <sessionId> started "Running replay"`.

   **Replay against the dataset.** Collect the trace IDs from the labeled dataset (built in Phase 3 in `all` and `dataset` modes, or rehydrated at the start of this phase in `experiment` mode).

   **Generate an experiment group ID.** At the start of each iteration, generate a fresh UUID to use as the `experimentGroupId` for this batch. This groups all test runs from this iteration together so the experiments page can stream them in live.

   **Write the code-change payload first.** Before running the script, write a tmp JSON file (e.g. `/tmp/bitfab-code-change-<experimentN>.json`) using the snapshots captured in `make-change`:

   ```json
   {
     "description": "<the one-line change description from make-change>",
     "files": [
       { "path": "<repo-relative path>", "before": "<full file contents before edit>", "after": "<full file contents after edit>" }
     ]
   }
   ```

   The schema is flat — every file object is exactly `{ path, before, after }`. Do **not** add `repo`, `commit`, or any other context fields; `path` is the sole identifier. Use `""` for newly created or deleted files. One JSON file per experiment — never reuse last iteration's payload.

   **Before writing the JSON, check whether the replay script supports `--code-change`.** Grep the script for `code-change` or `code_change`. If neither appears, the script predates this feature and will silently ignore the flag (most arg parsers drop unknown flags without erroring). In that case, warn the user:

   > "Your replay script doesn't support `--code-change` yet, so this experiment's code edit won't appear in the dashboard. Run `$bitfab:setup replay` after this session to regenerate the script with the flag."

   Then **continue the experiment without the flag** — omit `--code-change` from the invocation and skip writing the JSON file. The replay itself is unaffected; only the code-change metadata is missing from the experiment viewer.

   **Check `--experiment-group-id` support.** Grep the replay script for `experiment-group-id` or `experiment_group_id`. If the script supports it, pass `--experiment-group-id <experimentGroupId>` so the test run is tagged with the group. The script forwards it into `client.replay()` as `experimentGroupId`. If the script doesn't support it, skip the flag (the experiments page will still work via `testRunIds` fallback in `open-experiments`).

   **Open the experiments page before running replay (if group ID is supported).** If the replay script supports `--experiment-group-id` AND the Studio is still open (the background process hasn't emitted `session-ended`), navigate it to the experiments page using the group ID:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/node_modules/bitfab-plugin-lib/dist/commands/navigateStudio.js" <sessionId> "/studio/experiments?experimentGroupId=<experimentGroupId>"
   ```

   This lets the user watch experiment results stream in live as the replay runs. If the script doesn't support the flag, skip this navigation (the `open-experiments` fallback will navigate with `testRunIds` after the replay completes). If the Studio was closed early, also skip this navigation.

   If the script does support the flag, run the replay with the trace IDs, `--code-change`, and `--experiment-group-id`:

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

   **After the run, classify items before evaluating.** A failed item means one of two things: the new code produced a bad output (real signal), or the wrapped fn threw on infra (missing DB row, stale FK, rejected write, missing env). Infra failures are not regressions.

   From the JSON compute:

   - `completed` — `item.error` unset
   - `infraErrored` — `item.error` set
   - `total` — `result.items.length`; `0` or non-zero exit code = whole-replay crash

   If `completed === 0`, do not score pass/fail on an empty set — branch to `check-replay-health`.
5. **Route on the counts and exit code.** Goal: keep infra noise out of evaluation. Read a sample of `item.error` strings (and stderr on crash) first to identify the DB-shaped pattern (missing record, FK / unique constraint, write rejected, connection refused, missing env).

   **🚨 Do not silently work around DB issues.** Do not drop affected trace IDs, stub the read in the script, gate writes behind a script-only flag, wrap the function in a rollback transaction, or edit the instrumented function to skip DB calls. Those all hide infra problems as fake passing or fake failing results and corrupt the experiment.

   **Instead: tell the user what's wrong and offer exactly two workarounds.** Use ask the user to surface a clear summary first — the failing trace ID(s), the error pattern, the function and span where it happens — then present the two options below. Pick a representative failing trace and call `mcp__Bitfab__read_traces` with `scope: "summary"` to read its `environment` field (production / staging / development), so option B can name the source environment concretely.

   - **Workaround A: `mockOnReplay`** *(recommended for spans whose side effects shouldn't run during experimentation)* — apply the `mockOnReplay` recipe from step `replay-against-dataset` above (find the failing span, add `mockOnReplay: true` to its `SpanOptions`, re-run with `{ mock: "marked" }`). Edit only the span options, never the function body. Use this when the span is a DB read/write the experiment isn't testing and the captured output can stand in for it.
   - **Workaround B: Point replay at the trace's source database** — the trace's `environment` field names where it was captured (e.g. `production`). Tell the user that's the only environment whose DB has the rows the trace references, then offer to (i) update the replay env to point at that environment's DB (env vars, connection string) or (ii) ask which environment they want to use if multiple are valid. Apply the change to env / config, not to the function under test.

   After whichever workaround the user picks, re-run `replay-against-dataset` and re-check health. If the user can't or won't do either, stop and report — don't fabricate a workaround on your own.

   - **whole replay crashed (non-zero exit, total is 0, or unparseable stdout)** — show stderr / exit code, diagnose, confirm a script fix with the user, apply, loop back to `replay-against-dataset`
   - **every item errored (completed is 0 but total is non-zero)** — systemic infra failure (usually env mismatch). Diagnose, confirm a script fix with the user, loop back
   - **high infra error rate (over half of items errored)** — signal is noisy. Flag the rate and ask the user whether to fix the env and retry, or proceed with the partial signal
   - **healthy or mixed run (at least one completed item, infra errors at most half of total)** — proceed. Carry `infraErrored` forward — surface as its own bucket in share-results, never folded into pass/fail
6. **Route on whether replay trace IDs are available.** Check the `hasTraceIds` flag from `replay-against-dataset`. This determines whether verdicts can be persisted to the server and whether the experiments page in Studio will show meaningful results.

   - **replay trace IDs are populated (`hasTraceIds` is true)** — the SDK and server support trace ID mapping. Open the experiments page in Studio first (so the user can watch verdicts populate in real time), then evaluate and persist labels
   - **replay trace IDs are null (`hasTraceIds` is false)** — tell the user: "Your Bitfab SDK or replay script needs to be updated to support replay trace IDs. Update to @bitfab/sdk 0.13.5+ and ensure your server's completeReplay endpoint returns the traceIds mapping. Without this, experiment results can't be persisted to Studio." Then proceed to text-only evaluation so the user still sees comparison results in-agent
7. **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" <sessionId> started "Evaluating results"`.

   **Evaluate results in-agent without persisting.** This path runs when replay trace IDs are unavailable (old SDK or server). The agent still compares original vs new outputs and derives pass/fail verdicts, but cannot persist them via `persistReplayLabels.js` or show them in Studio.

   For each completed (non-errored) replay item, derive a verdict by comparing the replay's new output against the original trace's label and annotation:

   - **fail**-labeled original: does the replay's new output address the annotation? If yes, mark as PASS. If no, mark as FAIL.
   - **pass**-labeled original: preserved means PASS, regressed means FAIL.
   - Unreplayable items (`item.error` set) go in their own bucket.

   Hold the verdicts in working context for `share-results`. Since trace IDs are unavailable, do NOT attempt to run `persistReplayLabels.js` or open the experiments page.
8. **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" <sessionId> started "Evaluating results"`.

   **Evaluate against labels & annotations.** Score only items where `item.error` is unset. Items with `item.error` set are unreplayable (already classified) and go in their own bucket — never pass, fail, or regression.

   For each completed (non-errored) replay item, derive a verdict by comparing the replay's new output against the original trace's label and annotation (from Phase 3, or rehydrated in `experiment` mode):

   - **fail**-labeled original: does the replay's new output address the annotation? If yes → `label: true` (PASS). If no → `label: false` (FAIL). Use the annotation as the acceptance criterion.
   - **pass**-labeled original: preserved → `label: true` (PASS). regressed → `label: false` (FAIL).
   - Cannot judge from the output alone (genuinely ambiguous, not laziness): `skip: true` instead of guessing. Skips are recorded explicitly so the verify step knows you intentionally did not verdict.
   - Unreplayable items (`item.error` set) are NOT verdicted here — keep their list (trace ID + error string) for `share-results`.

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
9. **Verify replay labels persisted.** Route on the `status` field of the JSON the script printed in `evaluate-results`. The script is the deterministic gate — if it didn't return `ok`, the agent's verdicts are NOT yet on the replay traces and the experiment delta will be wrong on the next iteration.

   - **`status: "ok"` (every replay trace has a verdict or explicit skip persisted)** — labels are persisted on the replay traces and the verdicts file is gone. Continue to share-results (experiments page was already opened before evaluation)
   - **`status: "missing-coverage"` (script returned a non-empty `missingTraceIds` array)** — you under-verdicted. Read the missing replay trace IDs (use `mcp__Bitfab__read_traces` with `scope: "summary"` or `"full"` if you didn't already), decide each one (PASS / FAIL with annotation, or `skip: true` if genuinely ambiguous), write a NEW verdicts file at the same path covering ALL the originally expected IDs (the script needs the full `expectedTraceIds` list each call, not just the gaps), and re-run the script. Loop back here with the new result
   - **`status: "invalid-input"` (malformed verdicts JSON or missing fields)** — the verdicts file you wrote doesn't match the schema. Read the script's `message` field, fix the JSON (most common: missing annotation on a non-skip entry, missing traceId, expectedTraceIds empty), and re-run the script. Loop back here
   - **`status: "mcp-error"` (MCP call to update_agent_labels failed mid-batch)** — network or auth error. The script's `partialTraceIds` lists which IDs were already persisted. Tell the user, recommend re-running the script (it's idempotent — already-persisted labels just upsert), and loop back here. If it keeps failing, stop and surface the error
10. **Open experiment viewer (fallback).** This step only runs when replay trace IDs are available (routed here from `check-trace-id-support`). If no `testRunId`s were captured, skip this step and continue to evaluate.

   If the experiments page was already opened via `experimentGroupId` in `replay-against-dataset` (the replay script supported `--experiment-group-id`), skip this step entirely, the page is already showing live results.

   If the replay script did NOT support `--experiment-group-id`, navigate the already-open Studio to the experiments page using the `sessionId` captured in the `studio/open` step. Build the path with **every** `testRunId` you've collected across iterations of this phase (comma-separated):

   ```bash
   node "${BITFAB_PLUGIN_DIR}/node_modules/bitfab-plugin-lib/dist/commands/navigateStudio.js" <sessionId> "/studio/experiments?testRunIds=<testRunId1>,<testRunId2>,<testRunId3>"
   ```

   The command sends a navigate event and exits immediately. If the Studio was closed early (the background process exited with a `session-ended` event), skip this step entirely.
11. **Share results to the user.**

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

   **If running in text-only mode** (trace IDs were unavailable): append a note that cross-iteration comparison isn't available without trace IDs. Each iteration's results are visible only in-agent for the current run. Upgrading to `@bitfab/sdk` 0.13.5+ and updating the server unlocks persistent experiment tracking across iterations, side-by-side comparison in Studio, and the full experiments page.

   Ensure your question includes your recommended next step.

   > A) **Keep iterating** — run another experiment from the plan *(recommended)*
   > B) **Stop and wrap up** — move to the final summary

## Phase 6: Validate & Wrap Up

1. **Studio activity:** If `studioMode` is true, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/pushActivity.js" <sessionId> completed "Done"`.

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

   Kill the Studio background process (send SIGINT or abort the background task).

   If `Z > 0`, add one line naming the infra cause (e.g. "Z traces unreplayable — missing DB rows; refresh the dataset or scope to a snapshot next pass") so the user has a next step beyond the code.
