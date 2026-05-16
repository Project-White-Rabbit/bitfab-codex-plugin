---
name: assistant
description: "Fix and experiment on code, or ask for guidance"
---

# Bitfab Assistant

Use the local plugin MCP tools (`mcp__Bitfab__list_trace_functions`, `mcp__Bitfab__search_traces`, `mcp__Bitfab__read_traces`, `mcp__Bitfab__update_agent_labels`, `mcp__Bitfab__list_datasets`, `mcp__Bitfab__create_dataset`, `mcp__Bitfab__add_traces_to_dataset`, `mcp__Bitfab__remove_traces_from_dataset`) to find what's failing in a traced function, build a dataset of labeled traces, and iterate on the code/prompts using replay until pass rates improve.

**MCP tools:** This skill uses `list_trace_functions`, `search_traces`, `read_traces`, `update_agent_labels`, `list_datasets`, `create_dataset`, `add_traces_to_dataset`, and `remove_traces_from_dataset` from the **local plugin MCP server** (bundled with this plugin), exposed under the `mcp__Bitfab__*` prefix.

**When the flow branches, always present the options clearly and wait for the user's answer before proceeding.** Number or letter the options so the user can pick by reference. Rules:

- Recommend an option first, explain why in one line
- Present 2-5 concrete options
- One decision per question — never batch

This skill has three invocation modes. `all` walks every phase. The two sub-modes do one focused thing each, building a labeled dataset, or running experiments against an existing one, and require the trace function key as the argument because they skip the function picker (Phase 1) and instrumentation/replay verification (Phase 2).

| Invocation | Action |
|---|---|
| `$bitfab:assistant` or `$bitfab:assistant all` | Full flow: pick function → verify instrumentation → pick or create dataset → label → diagnose → iterate → wrap up |
| `$bitfab:assistant dataset <key>` | Build or extend a labeled dataset for one function, then stop. No experiments run. Picks an existing dataset or creates a new one |
| `$bitfab:assistant experiment <key> [<dataset-id>]` | Run experiments to fix failing traces against a labeled dataset, then wrap up. If `<dataset-id>` is omitted, you'll be asked to pick one. If the function has no datasets yet, run `$bitfab:assistant dataset <key>` first |

In sub-modes, grep the codebase for `<key>` early so labeling and experiments are grounded in the actual instrumented function (the full flow does this in Phase 2; sub-modes skip Phase 2 entirely).

**Studio** is the companion browser surface for the entire assistant flow. It opens automatically at the start and stays open throughout all phases. Individual phases navigate the Studio to the relevant page (dataset review, experiment viewer, etc.).


🚨 **Blocking-process rule (applies to any plugin command described as "blocks until the user does X"):** When you launch a plugin CLI that blocks on a browser handoff (`login.js`, etc.), you MUST keep the exec session alive and keep polling it until the process exits on its own.

- Printing the URL is NOT completion. The process is still running, racing a loopback callback and a server-polled ticket — it will exit only after the user's browser action delivers a result (or after the timeout).
- After sending the URL to the user, keep polling the live shell/exec session at least every few seconds with your normal "read more output" tool (`write_stdin`, `read`, or whatever your runtime's equivalent is for the long-running shell). Do not idle waiting for a user message.
- Do not send a final "waiting for you to click Confirm" text and then stop polling — the user's confirmation does NOT come back to you as a chat message; it comes back as the plugin process exiting with output on stdout.
- Stop polling only when one of: (a) the process exits 0 and prints its completion summary, (b) the process exits non-zero, or (c) the user explicitly cancels.
- When the process exits, immediately continue with the next step in the flow — don't wait for another user message.

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

1. Start the Studio as a long-running background process. The command accepts an optional initial path argument so Studio opens directly at the relevant page:

   - **`all` mode:** no path argument (opens at `/studio` root)
   - **`dataset <key>` mode:** pass `/studio/trace-functions/<key>/datasets`
   - **`experiment <key>` mode:** pass `/studio/trace-functions/<key>/experiments`

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/openStudio.js" [initialPath]
   ```

   Run it via your runtime's "long-running exec session" mechanism.

   The script outputs JSON lines on stdout:

   - `{"event":"started","sessionId":"..."}` on startup: capture the `sessionId` and hold it in working context for the rest of the flow. Every `navigateStudio.js` call in later phases uses it.
   - `{"event":"auth-required","sessionId":"..."}` if the user is not signed in to Bitfab in their browser: tell the user to sign in to Bitfab in the Studio window that just opened, then wait for the `authenticated` event before continuing.
   - `{"event":"authenticated","sessionId":"..."}` the user has signed in. Continue the flow.
   - `{"event":"session-ended","sessionId":"..."}` if the user closes the Studio: the process exits. See the lifecycle note above.

   Status messages (e.g. "Opening Studio: ...") go to stderr, not stdout. Filter to JSON lines only.

## Phase 1: Identify the Trace Function

**Run only when mode is `all`.**

If a `traceFunctionKey` was provided as an argument, skip the listing and the user prompt — but still cross-check the provided key against the local codebase before moving on. Otherwise, work through all four steps below:

1. **Skip this step if a `traceFunctionKey` argument was provided** — use the argument directly and continue to cross-check. Otherwise, call `mcp__Bitfab__list_trace_functions` to list all available trace functions. Use **only** the keys and metadata returned (trace counts, last activity) — do NOT invent or infer descriptions of what each function does from its key name. Key names are often ambiguous or misleading, and guessing produces hallucinated descriptions that confuse the user.
2. **Cross-check each key against the local codebase** before presenting. For each returned key, `grep` the repo for string-literal uses of that exact key (across `*.ts`, `*.tsx`, `*.py`, `*.rb`, `*.go`, `*.baml`). Mark each function in the presented list as:

   - **✅ instrumented here** — found in this repo, with the file path
   - **⚠️ not found in this repo** — traces exist on Bitfab but the key isn't in this codebase (likely another repo or a renamed key)
3. **Skip this step if a `traceFunctionKey` argument was provided** — there's no list to present. Otherwise, present the full list in the question text showing ONLY: `<key>` · `<trace count>` · `<last activity>` · `<instrumented-here marker + path, or not-found marker>`. No invented summaries.
4. **Skip this step if a `traceFunctionKey` argument was provided** — the function is already chosen. Otherwise, ask the user with 2 options: the recommended function (prefer one that is ✅ instrumented here AND has recent activity) and a free-text "Type a function key" option. If nothing is instrumented here, say so explicitly in the question — don't hide it.

## Phase 2: Verify Instrumentation & Replay

**Run only when mode is `all`.**

Check that this trace function has both instrumentation and a replay script.

1. Search the codebase for the trace function key to confirm SDK usage:

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

## Phase 3: Pick a Dataset and Label Traces

**Run only when mode is `all` or `dataset`.**

A **dataset** is the named bucket of labeled traces an experiment replays against. This phase picks (or creates) one for the trace function, labels candidate traces, attaches them to the dataset, then hands off to the per-dataset review page where the user approves labels and can ask the agent to add or remove traces.

In `dataset` mode this phase is the entry point — Phase 1 (function picker) and Phase 2 (instrumentation/replay verification) are skipped, so the trace function key comes from the argument. Before calling any MCP tools, grep the codebase for the key (e.g. `grep -r "<traceFunctionKey>" --include="*.ts" --include="*.tsx" --include="*.py" --include="*.rb" --include="*.go" --include="*.baml"`) and note the file path — every later step ("Label them yourself", and Phase 4 "Read the code" in `all` mode) needs it.

1. **Pick or create a dataset** — Call `mcp__Bitfab__list_datasets` with the trace function key. Then branch on whether any exist. Hold the chosen `datasetId` in working context — every step from here on uses it.

   - **no datasets exist for this function (list_datasets returned empty)** — **don't ask** — silently call `mcp__Bitfab__create_dataset` with `traceFunctionKey: <key>` and `name: <key>` (just the trace function key as the name; the user can rename it later in the UI if they want). Hold the returned `datasetId` and continue. The first-time user shouldn't have to answer a name prompt before they've even seen the dataset.
   - **one or more datasets already exist** — present them to the user as a numbered choice, with one option per existing dataset (name · id · current trace count) plus a "Create new" option. Recommend the most recently used dataset that has traces. If the user picks an existing dataset, hold its id and continue. If the user picks "Create new", silently call `mcp__Bitfab__create_dataset` with `name: "<key> #N"` where N is one more than the number of existing datasets (e.g. `eval-assistant #2`) — don't ask for a name. Hold the new id and continue.
2. **Ask how to source candidate traces.** Before searching, decide *where* the candidate traces come from. Three real options:

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
3. **Seed dataset from existing validated labels.** Reachable only when the user picked Option B in `ask-search-mode`. Pull traces that already have a validated label (human-authored, or agent-authored and human-approved) for this function, attach them to the picked dataset, and route on whether the user also wants to add more.

   1. Call `mcp__Bitfab__search_traces` with `traceFunctionKey: <key>`, `validated: true`, and a generous `limit` (50 is the cap). Both `labelResult: true` and `labelResult: false` matter — failures are the hill-climbing signal, but passes anchor the regression boundary. If 50 isn't enough to cover the function's labeled history, run a second call with `labelResult: false` only to bias toward fails first, then a third with `labelResult: true`. De-dupe trace IDs across calls.
   2. Call `mcp__Bitfab__read_traces` with `scope: "summary"` on the resulting trace IDs so the labels + annotations are in working context. Don't re-label them — these are already validated.
   3. Call `mcp__Bitfab__add_traces_to_dataset` once with `datasetId` (the one picked in `list-datasets`) and the full deduped trace ID array. The call is idempotent, so re-attaching IDs already in the dataset is a safe no-op.
   4. Briefly summarize for the user: "Seeded the dataset with N reused labels (M fails, K passes). Want me to find more candidates to label, or is this set enough to move on?"

   > A) **Find more candidates to label** — go through the regular intent + search + label flow on top of the reused set
   > B) **Move on with just the reused set** — skip further labeling; go straight to dataset review *(recommended)*
4. **Ask what kinds of traces to find** — The user picked "Define new criteria" (or arrived here from the reuse path wanting more). Find out what they're actually trying to surface. The trace function may have thousands of traces; "what should I label?" is the question that makes the rest of this phase useful.

   When asking, ask the user with these options (and a free-text fallback so the user can describe something specific):

   - **A — Failures of a certain kind** *(recommended when the user already has a hypothesis)* — they tell you the pattern (empty outputs, hallucinated tool args, regressions on a specific input shape, etc.) and you search for matching traces
   - **B — Recent customer complaints / reports** — they paste or describe specific incidents and you find the matching traces by user, session, or time window
   - **C — Open-ended, you decide** — no hypothesis yet; you sample broadly across recent traces, look for diversity, and surface anything that looks like a candidate failure or interesting edge case

   Hold the user's answer (the chosen option **and** any free-text detail) in working context — the next step uses it to shape the `mcp__Bitfab__search_traces` filters and which traces to prioritise reading. If they pick C, default to recent + diverse + non-empty outputs.
5. **Find unlabeled traces** — Search without label filters to find unlabeled traces for the trace function. **Shape the search by the intent captured in the previous step** (or by the prior dataset's existing labels, if any): Option A = filter to traces matching the user's described failure pattern; Option B = filter by the user, session, or time window of the reported incidents; Option C = default sweep (recent, diverse inputs, non-empty outputs). Use `mcp__Bitfab__search_traces` with the relevant filters, then `mcp__Bitfab__read_traces` with `scope: "summary"` to read candidates and identify which are worth labeling — look for diverse inputs, traces that produced output (not empty), and traces that cover different scenarios under the chosen intent. Filter out near-duplicates and uninteresting traces. If every trace is already labeled and attached to this dataset, you can move straight on with no new candidates.
6. **Ask how the user wants to label** — Before any verdicts go on these candidate traces, ask the user how the user wants to label them. There are exactly two modes, and the answer determines whether you call `mcp__Bitfab__update_agent_labels` at all:

   > A) **Agent labels first, I approve / edit** — agent makes a first pass; you approve or edit each verdict in the labeling page *(recommended)*
   > B) **I'll label them manually** — no agent verdicts; you label every trace from scratch in the labeling page

   Recommend Option A — an agent first pass turns the labeling page into a quick approve/edit review. But respect the user's choice: if they pick B, do **not** call `mcp__Bitfab__update_agent_labels` for any of these candidates. They want to label from scratch in the labeling page, with no agent verdicts pre-filled. If no new candidate traces were found in the previous step, skip this question and continue.
7. **Agent first pass: label them yourself before opening the labeling page** — Reachable only when the user picked Option A in the previous step. **You** label the approved candidate traces so the labeling page becomes an approve/edit review instead of a blank labeling session. Call `mcp__Bitfab__read_traces` with `scope: "full"` on the approved trace IDs (batch them — up to 10 per call), read each trace's inputs / output / spans yourself, and decide for each one whether it looks like a PASS or a FAIL. **Ground your judgment in the codebase, not just the trace text.** Before you start labeling, read the instrumented function in the user's source (located in Phase 2 in `all` mode, or via the grep step in this phase's intro in `dataset` mode) and any nearby code that explains intent — comments, docstrings, README sections, related tests, BAML files — so you know what the function is *supposed* to do and what "good" looks like for it. Apply the same context to every trace: does this output achieve the function's goal as expressed in the code? Does it match the patterns in the already-validated traces? Then call `mcp__Bitfab__update_agent_labels` once with an array of `{ traceId, label, annotation }` objects — **both `label` (true for pass, false for fail) and `annotation` (a one-or-two-sentence explanation written for the human reviewer, ideally referencing what the code is trying to do) are required for every trace**. Commit to a verdict — if you genuinely cannot decide, you didn't read the trace or the code carefully enough. The labels you save here start unapproved; they only become part of the validated dataset once a human approves them in the labeling page.

   > 🚨 **HARD RULE — DO NOT SKIP (agent-first mode only):** When the user picked Option A, you MUST call `mcp__Bitfab__update_agent_labels` with verdicts for every approved trace BEFORE navigating Studio to the labeling page. Sending the user into an agent-first review with no pre-labeled verdicts is a process violation. (In manual mode this step is unreachable, and the rule does not apply.)

   > **Made a mistake?** If you realize a verdict was wrong (e.g., you mislabeled a trace or want to re-evaluate), call `mcp__Bitfab__update_agent_labels` again with `{ traceId, archive: true }` for those traces. The previous label is hidden (kept for audit), and you can re-label the trace from scratch with another `update_agent_labels` call.
8. **Attach candidate traces to the dataset** — Call `mcp__Bitfab__add_traces_to_dataset` with the `datasetId` chosen earlier and the array of approved candidate trace IDs (in agent-first mode, the ones you just labeled; in manual mode, the candidates the user approved in find-unlabeled). The call is idempotent — re-adding traces already in the dataset is a no-op, so it's safe to include the full set. If no new candidate traces were approved (the dataset was already populated), skip this step.

   > 🚨 **HARD RULE — DO NOT SKIP:** All approved candidate trace IDs MUST be attached to the dataset before opening the page. The page reviews the dataset's contents, not the trace function's label table. An empty dataset means an empty review.
9. Open the dataset review page for the user. Use `navigateStudio.js` to route the already-open Studio to the dataset review page using the `sessionId` captured in the `studio/open` step:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/node_modules/bitfab-plugin-lib/dist/commands/navigateStudio.js" <sessionId> "/studio/trace-functions/<functionKey>/datasets/<datasetId>"
   ```

   The command sends a navigate event and exits immediately. The path must stay within the `/studio/` route tree so the Studio shell (header, session management) stays mounted. The `?session=` param is appended automatically by the shell's navigate handler.

   If the Studio was closed early (`session-ended` event from the background process), skip this step and continue directly to `build-dataset`.

   After opening, tell the user you've opened the dataset page and are waiting for them to finish reviewing. Then proceed to `await-event`.
10. **Wait for user to finish dataset review.** Use the **Monitor tool** to watch for the next JSON event from the Studio background process (`openStudio.js`, started in `studio/open`). The output file path was returned when you started the background process. Set up a monitor that tails only NEW lines (skip lines already read) and filters for JSON event lines:

   ```bash
   tail -f -n +<NEXT_LINE> <output-file> | grep -E --line-buffered '"event"'
   ```

   Where `<NEXT_LINE>` is the line number after the last line you already processed (e.g. if you read line 1 with the `started` event, use `-n +2`). Track which line you last processed so you don't re-fire on old events.

   The monitor will notify you when a new event arrives. Do NOT just read the output file once and wait, that will cause the flow to stall. The Studio process emits these events relevant to dataset review:

   - `{"event":"edit-with-agent","sessionId":"...","datasetId":"..."}` — the user clicked **Edit with agent**. Go to the modify loop, then come back here.
   - `{"event":"return-to-agent","sessionId":"..."}` — the user clicked **Done**, which triggered `returnToStudio()` and navigated back to `/studio`. Dataset review is complete.
   - `{"event":"session-ended","sessionId":"..."}` — the user closed Studio entirely.

   Filter to JSON lines only (skip status text). Route on the `event` field:

   - **`event: edit-with-agent`** — user clicked Edit with agent on the dataset page. Go to the modify loop, then come back here to read the next event
   - **`event: return-to-agent`** — user clicked Done on the dataset page. Dataset review is complete, move on to build + confirm the dataset
   - **`event: session-ended`** — user closed Studio. Stop the flow
11. **Modify loop: add or remove traces in chat** — The dataset page is still open in Studio and the user wants you to add or remove traces. Ask in plain chat:

   > What would you like to add or remove? You can describe by criteria (e.g. "drop empty-output traces", "add 5 more from last week with errors") or paste explicit trace IDs.

   Then wait for the user's next message. It will contain their answer. Do NOT ask the user here (the answer is free-form and options would just add an extra step before the user can type).

   Then act on it:

   - **Adding traces:** find candidates with `mcp__Bitfab__search_traces` / `mcp__Bitfab__read_traces`, then respect the labeling mode the user chose earlier in this phase (the ask-labeling-mode step). In **agent-first mode (Option A)**, label them yourself with `mcp__Bitfab__update_agent_labels` (same rigor as label-self: every trace gets a verdict + annotation, grounded in the code) before attaching. In **manual mode (Option B)**, do NOT call `mcp__Bitfab__update_agent_labels`. **If no labeling mode was selected** (the user took the Reuse → Move-on path that bypasses ask-labeling-mode, or find-unlabeled returned no candidates so ask-labeling-mode self-skipped), default to **agent-first mode (Option A)** — match the recommended default and label new candidates yourself before attaching. Either way, call `mcp__Bitfab__add_traces_to_dataset` to attach.
   - **Removing traces:** call `mcp__Bitfab__remove_traces_from_dataset` with the trace IDs to remove. The traces themselves aren't deleted, only their membership in the dataset.

   The dataset page reflects each add/remove live (SSE), so the user sees changes flow in as you make them. When you're done, summarize what changed in chat and **return to the await-event step to read the next event**. The user can click Edit with agent again for another modify round, or Done to finalize.
12. **Build the dataset** — You already know the trace IDs in this dataset (you attached them in earlier steps and tracked any add/remove from modify rounds). Call `mcp__Bitfab__read_traces` with all of them and `scope: "full"` to load the labels + annotations into context. This is the working set for confirm + every Phase 5 experiment.
13. **Confirm the dataset** — Present the dataset as a numbered choice: each entry showing (trace ID, label, annotation summary). The dataset must contain at least one **validated failing label** — i.e. at least one trace where a human either authored or approved a `false` label. To check, call `mcp__Bitfab__search_traces` restricted to the dataset trace IDs with `validated: true` and `labelResult: false`. Two outcomes:

   - **gate fails (no validated failing label — search returns nothing)** — tell the user and loop back to find or label more unlabeled traces
   - **gate passes (at least one validated failing label)** — get explicit approval, then continue

   Unapproved agent labels do **not** satisfy this gate by design — `validated: true` excludes them.
14. **Hold in-context** — This approved dataset is the benchmark for all experiments in Phase 5. Keep both the `datasetId` and the trace IDs in your working context throughout. In `dataset` mode, stop here: kill the Studio background process (send SIGINT or abort the background task). Surface the dataset summary (including the id) and exit so they can pick up later with `$bitfab:assistant experiment <key> <datasetId>`.

## Phase 4: Diagnose & Plan

**Run only when mode is `all`.**

1. **Understand failures.** Using the failed traces you read in Phase 3 (or read them now if you haven't):

   - Call `mcp__Bitfab__read_traces` on 3–5 failed traces with `scope: "full"`

   Synthesize the failure patterns — what's going wrong, what the common threads are.
2. **Read the code.**

   - Find the instrumented function in the codebase (in `all` mode you found it in Phase 2; this step is unreachable in `dataset` / `experiment` modes)
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
3. **Run only when mode is `all` or `experiment`.**

   **Make the change.**

   - Explain to the user what you're changing and why, and confirm before editing
   - Edit the iteration target (prompt, code, tools, parameters)
4. **Run only when mode is `all` or `experiment`.**

   **Replay against the dataset.** Collect the trace IDs from the labeled dataset (built in Phase 3 in `all` mode, or rehydrated at the start of this phase in `experiment` mode). Run the replay script with those specific traces.

   ```bash
   # The exact command depends on the replay script — adapt to what exists
   # Example for TypeScript:
   cd <project-dir> && npx tsx scripts/replay.ts <pipeline-name> --trace-ids <id1>,<id2>,<id3>,...
   ```

   **Before running: verify the replay script prints the full original and new output values to stdout for every item** (not just lengths, counts, hashes, or truncated previews). If it doesn't, fix the script first — the Replay Output Contract and example script live in the SDK reference at `https://docs.bitfab.ai/<language>-sdk#replay`. Subagents can't evaluate an improvement from `5 → 7 (+2)`.

   **Capture the `testRunId` from the replay output** — the SDK prints it (alongside `testRunUrl`) when the run completes. Track every `testRunId` produced across all iterations of this phase: you'll feed them to `open-experiments` so the user can review every experiment side-by-side in one viewer.

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

   **After the run, classify items before evaluating.** A failed item means one of two things: the new code produced a bad output (real signal), or the wrapped fn threw on infra (missing DB row, stale FK, rejected write, missing env). Infra failures are not regressions.

   From the JSON compute:

   - `completed` — `item.error` unset
   - `infraErrored` — `item.error` set
   - `total` — `result.items.length`; `0` or non-zero exit code = whole-replay crash

   If `completed === 0`, do not score pass/fail on an empty set — branch to `check-replay-health`.
5. **Run only when mode is `all` or `experiment`.**

   **Route on the counts and exit code.** Goal: keep infra noise out of evaluation. Read a sample of `item.error` strings (and stderr on crash) first to identify the DB-shaped pattern (missing record, FK / unique constraint, write rejected, connection refused, missing env).

   **🚨 Do not silently work around DB issues.** Do not drop affected trace IDs, stub the read in the script, gate writes behind a script-only flag, wrap the function in a rollback transaction, or edit the instrumented function to skip DB calls. Those all hide infra problems as fake passing or fake failing results and corrupt the experiment.

   **Instead: tell the user what's wrong and offer exactly two workarounds.** Use ask the user to surface a clear summary first — the failing trace ID(s), the error pattern, the function and span where it happens — then present the two options below. Pick a representative failing trace and call `mcp__Bitfab__read_traces` with `scope: "summary"` to read its `environment` field (production / staging / development), so option B can name the source environment concretely.

   - **Workaround A: `mockOnReplay`** *(recommended for spans whose side effects shouldn't run during experimentation)* — apply the `mockOnReplay` recipe from step `replay-against-dataset` above (find the failing span, add `mockOnReplay: true` to its `SpanOptions`, re-run with `{ mock: "marked" }`). Edit only the span options, never the function body. Use this when the span is a DB read/write the experiment isn't testing and the captured output can stand in for it.
   - **Workaround B: Point replay at the trace's source database** — the trace's `environment` field names where it was captured (e.g. `production`). Tell the user that's the only environment whose DB has the rows the trace references, then offer to (i) update the replay env to point at that environment's DB (env vars, connection string) or (ii) ask which environment they want to use if multiple are valid. Apply the change to env / config, not to the function under test.

   After whichever workaround the user picks, re-run `replay-against-dataset` and re-check health. If the user can't or won't do either, stop and report — don't fabricate a workaround on your own.

   - **whole replay crashed (non-zero exit, total is 0, or unparseable stdout)** — show stderr / exit code, diagnose, confirm a script fix with the user, apply, loop back to `replay-against-dataset`
   - **every item errored (completed is 0 but total is non-zero)** — systemic infra failure (usually env mismatch). Diagnose, confirm a script fix with the user, loop back
   - **high infra error rate (over half of items errored)** — signal is noisy. Flag the rate and ask the user whether to fix the env and retry, or proceed with the partial signal
   - **healthy or mixed run (at least one completed item, infra errors at most half of total)** — proceed. Carry `infraErrored` forward — surface as its own bucket in share-results, never folded into pass/fail
6. **Run only when mode is `all` or `experiment`.**

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
7. **Run only when mode is `all` or `experiment`.**

   **Verify replay labels persisted.** Route on the `status` field of the JSON the script printed in `evaluate-results`. The script is the deterministic gate — if it didn't return `ok`, the agent's verdicts are NOT yet on the replay traces and the experiment delta will be wrong on the next iteration.

   - **`status: "ok"` (every replay trace has a verdict or explicit skip persisted)** — labels are persisted on the replay traces and the verdicts file is gone. Continue to open-experiments
   - **`status: "missing-coverage"` (script returned a non-empty `missingTraceIds` array)** — you under-verdicted. Read the missing replay trace IDs (use `mcp__Bitfab__read_traces` with `scope: "summary"` or `"full"` if you didn't already), decide each one (PASS / FAIL with annotation, or `skip: true` if genuinely ambiguous), write a NEW verdicts file at the same path covering ALL the originally expected IDs (the script needs the full `expectedTraceIds` list each call, not just the gaps), and re-run the script. Loop back here with the new result
   - **`status: "invalid-input"` (malformed verdicts JSON or missing fields)** — the verdicts file you wrote doesn't match the schema. Read the script's `message` field, fix the JSON (most common: missing annotation on a non-skip entry, missing traceId, expectedTraceIds empty), and re-run the script. Loop back here
   - **`status: "mcp-error"` (MCP call to update_agent_labels failed mid-batch)** — network or auth error. The script's `partialTraceIds` lists which IDs were already persisted. Tell the user, recommend re-running the script (it's idempotent — already-persisted labels just upsert), and loop back here. If it keeps failing, stop and surface the error
8. **Run only when mode is `all` or `experiment`.**

   **Open experiment viewer.** If no `testRunId`s were captured (e.g. the replay script didn't print them), skip this step and continue, but flag it to the user in `share-results` so the script can be fixed before the next iteration.

   Navigate the already-open Studio to the experiments page using the `sessionId` captured in the `studio/open` step. Build the path with **every** `testRunId` you've collected across iterations of this phase (comma-separated):

   ```bash
   node "${BITFAB_PLUGIN_DIR}/node_modules/bitfab-plugin-lib/dist/commands/navigateStudio.js" <sessionId> "/studio/experiments?testRunIds=<testRunId1>,<testRunId2>,<testRunId3>"
   ```

   The command sends a navigate event and exits immediately. If the Studio was closed early (the background process exited with a `session-ended` event), skip this step entirely.

   The user reviews the viewer alongside your `share-results` summary before deciding whether to iterate.
9. **Run only when mode is `all` or `experiment`.**

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

   Ensure your question includes your recommended next step.

   > A) **Keep iterating** — run another experiment from the plan *(recommended)*
   > B) **Stop and wrap up** — move to the final summary

## Phase 6: Validate & Wrap Up

**Run only when mode is `all` or `experiment`.**

1. **Summary.** Present the final results similar to this. You may expand where appropriate based on context from the user:

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
