---
name: assistant
description: "Iterate on a traced Bitfab function to improve its pass rate. Use when the user wants to review failing traces, label examples, and replay an LLM function until it passes. Invoke with $bitfab:assistant [all|dataset|experiment] [<trace-function-key>] [<dataset-id>]."
---

# Bitfab Assistant

Use the local plugin MCP tools (`mcp__Bitfab__list_trace_functions`, `mcp__Bitfab__search_traces`, `mcp__Bitfab__read_traces`, `mcp__Bitfab__update_agent_labels`, `mcp__Bitfab__list_datasets`, `mcp__Bitfab__create_dataset`, `mcp__Bitfab__add_traces_to_dataset`, `mcp__Bitfab__remove_traces_from_dataset`) to find what's failing in a traced function, build a dataset of labeled traces, and iterate on the code/prompts using replay until pass rates improve.

**MCP tools:** This skill uses `list_trace_functions`, `search_traces`, `read_traces`, `update_agent_labels`, `list_datasets`, `create_dataset`, `add_traces_to_dataset`, and `remove_traces_from_dataset` from the **local plugin MCP server** (bundled with this plugin), exposed under the `mcp__Bitfab__*` prefix.

**When the flow branches, always present the options clearly and wait for the user's answer before proceeding.** Number or letter the options so the user can pick by reference. Rules:

- Recommend an option first, explain why in one line
- Present 2-5 concrete options
- One decision per question — never batch

This skill has three invocation modes. `all` walks every phase. The two sub-modes do one focused thing each — building a labeled dataset, or running experiments against an existing one — and require the trace function key as the argument because they skip the function picker (Phase 1) and instrumentation/replay verification (Phase 2).

| Invocation | Action |
|---|---|
| `$bitfab:assistant` or `$bitfab:assistant all` | Full flow: pick function → verify instrumentation → pick or create dataset → label → diagnose → iterate → wrap up |
| `$bitfab:assistant dataset <key>` | Build or extend a labeled dataset for one function, then stop. No experiments run. Picks an existing dataset or creates a new one |
| `$bitfab:assistant experiment <key> [<dataset-id>]` | Run experiments to fix failing traces against a labeled dataset, then wrap up. If `<dataset-id>` is omitted, you'll be asked to pick one. If the function has no datasets yet, run `$bitfab:assistant dataset <key>` first |

In sub-modes, grep the codebase for `<key>` early so labeling and experiments are grounded in the actual instrumented function (the full flow does this in Phase 2; sub-modes skip Phase 2 entirely).


🚨 **Blocking-process rule (applies to any plugin command described as "blocks until the user does X"):** When you launch a plugin CLI that blocks on a browser handoff (`startDataset.js`, `login.js`, etc.), you MUST keep the exec session alive and keep polling it until the process exits on its own.

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
   - **authenticated (with or without a `v<X> available` upgrade notice)** — continue to the entry phase for this mode (Phase 1 in `all`, Phase 3 in `dataset`, Phase 5 in `experiment`). If an upgrade notice appeared, pass it through to the user verbatim — but don't block on it; surface the notice once and move on

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
2. **Ask what kinds of traces to find** — Before searching, find out what the user is actually trying to surface. The trace function may have thousands of traces; "what should I label?" is the question that makes the rest of this phase useful.

   **Skip this question** if the chosen dataset already has labeled traces — those labels + annotations are the prior context, and you should mirror that intent when finding more candidates. Only ask when there is no prior context: the dataset was just created (either silently, because none existed, or because the user picked "Create new"), or the picked dataset is empty.

   When asking, ask the user with these options (and a free-text fallback so the user can describe something specific):

   - **A — Failures of a certain kind** *(recommended when the user already has a hypothesis)* — they tell you the pattern (empty outputs, hallucinated tool args, regressions on a specific input shape, etc.) and you search for matching traces
   - **B — Recent customer complaints / reports** — they paste or describe specific incidents and you find the matching traces by user, session, or time window
   - **C — Open-ended, you decide** — no hypothesis yet; you sample broadly across recent traces, look for diversity, and surface anything that looks like a candidate failure or interesting edge case

   Hold the user's answer (the chosen option **and** any free-text detail) in working context — the next step uses it to shape the `mcp__Bitfab__search_traces` filters and which traces to prioritise reading. If they pick C, default to recent + diverse + non-empty outputs.
3. **Find unlabeled traces** — Search without label filters to find unlabeled traces for the trace function. **Shape the search by the intent captured in the previous step** (or by the prior dataset's existing labels, if any): Option A = filter to traces matching the user's described failure pattern; Option B = filter by the user, session, or time window of the reported incidents; Option C = default sweep (recent, diverse inputs, non-empty outputs). Use `mcp__Bitfab__search_traces` with the relevant filters, then `mcp__Bitfab__read_traces` with `scope: "summary"` to read candidates and identify which are worth labeling — look for diverse inputs, traces that produced output (not empty), and traces that cover different scenarios under the chosen intent. Filter out near-duplicates and uninteresting traces. If every trace is already labeled and attached to this dataset, you can move straight on with no new candidates.
4. **Ask how the user wants to label** — Before any verdicts go on these candidate traces, ask the user how the user wants to label them. There are exactly two modes, and the answer determines whether you call `mcp__Bitfab__update_agent_labels` at all:

   > A) **Agent labels first, I approve / edit** — agent makes a first pass; you approve or edit each verdict in the labeling page *(recommended)*
   > B) **I'll label them manually** — no agent verdicts; you label every trace from scratch in the labeling page

   Recommend Option A — an agent first pass turns the labeling page into a quick approve/edit review. But respect the user's choice: if they pick B, do **not** call `mcp__Bitfab__update_agent_labels` for any of these candidates. They want to label from scratch in the labeling page, with no agent verdicts pre-filled. If no new candidate traces were found in the previous step, skip this question and continue.
5. **Agent first pass: label them yourself before opening the labeling page** — Reachable only when the user picked Option A in the previous step. **You** label the approved candidate traces so the labeling page becomes an approve/edit review instead of a blank labeling session. Call `mcp__Bitfab__read_traces` with `scope: "full"` on the approved trace IDs (batch them — up to 10 per call), read each trace's inputs / output / spans yourself, and decide for each one whether it looks like a PASS or a FAIL. **Ground your judgment in the codebase, not just the trace text.** Before you start labeling, read the instrumented function in the user's source (located in Phase 2 in `all` mode, or via the grep step in this phase's intro in `dataset` mode) and any nearby code that explains intent — comments, docstrings, README sections, related tests, BAML files — so you know what the function is *supposed* to do and what "good" looks like for it. Apply the same context to every trace: does this output achieve the function's goal as expressed in the code? Does it match the patterns in the already-validated traces? Then call `mcp__Bitfab__update_agent_labels` once with an array of `{ traceId, label, annotation }` objects — **both `label` (true for pass, false for fail) and `annotation` (a one-or-two-sentence explanation written for the human reviewer, ideally referencing what the code is trying to do) are required for every trace**. Commit to a verdict — if you genuinely cannot decide, you didn't read the trace or the code carefully enough. The labels you save here start unapproved; they only become part of the validated dataset once a human approves them in the labeling page.

   > 🚨 **HARD RULE — DO NOT SKIP (agent-first mode only):** When the user picked Option A, you MUST call `mcp__Bitfab__update_agent_labels` with verdicts for every approved trace BEFORE running `startDataset.js` to open the labeling page. Sending the user into an agent-first review with no pre-labeled verdicts is a process violation. (In manual mode this step is unreachable, and the rule does not apply.)

   > **Made a mistake?** If you realize a verdict was wrong (e.g., you mislabeled a trace or want to re-evaluate), call `mcp__Bitfab__update_agent_labels` again with `{ traceId, archive: true }` for those traces. The previous label is hidden (kept for audit), and you can re-label the trace from scratch with another `update_agent_labels` call.
6. **Attach candidate traces to the dataset** — Call `mcp__Bitfab__add_traces_to_dataset` with the `datasetId` chosen earlier and the array of approved candidate trace IDs (in agent-first mode, the ones you just labeled; in manual mode, the candidates the user approved in find-unlabeled). The call is idempotent — re-adding traces already in the dataset is a no-op, so it's safe to include the full set. If no new candidate traces were approved (the dataset was already populated), skip this step.

   > 🚨 **HARD RULE — DO NOT SKIP:** All approved candidate trace IDs MUST be attached to the dataset before opening the page. The page reviews the dataset's contents, not the trace function's label table. An empty dataset means an empty review.
7. **Open the dataset page (background process)** — Start the dataset script as a long-running background process. It will live until the user clicks Done (or cancels) and emit one JSON line on stdout per event:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/startDataset.js" <functionKey> <datasetId>
   ```

   Run it via your runtime's "long-running exec session" mechanism — the process is alive across multiple events, not one-shot. See the Blocking-process rule at the top of this skill for the polling pattern.

   The script first prints "Opening your browser..." plus the URL on stderr (surface the URL to the user verbatim if the auto-launch didn't open one), then begins emitting JSON event lines on stdout as the user interacts with the page:

   - `{"event":"modify","datasetId":"...","ts":"..."}` — non-terminal: the user clicked **Edit with agent**
   - `{"event":"saved","status":"saved",...}` — terminal: the user clicked **Done**
   - `{"event":"cancelled","status":"cancelled"}` — terminal: the user cancelled

   The script exits 0 only after a terminal event. Modify events keep the process alive.

   🚨 **Stream is mixed (stdout + stderr).** Most agent runtimes capture stdout and stderr together when reading a long-running process, so the lines you read in the next step are a mix of: (a) JSON event lines (what you act on), (b) browser-handoff status text like `Opening your browser...` and `(If the browser didn't open, ...)`, and (c) periodic heartbeats like `[bitfab] waiting for browser handoff... 30s elapsed`. **You MUST filter to lines that parse as JSON before routing.** Skip anything that doesn't parse — never error out on non-JSON lines.
8. **Read the next event from the background script.** Poll the live exec session for new lines per the Blocking-process rule — keep polling every few seconds until a new line appears or the process exits.

   The captured output is a mix of JSON event lines and free-form status text (see the warning at the end of the previous step). For each new line:

   1. Try to parse it as JSON. **If parse fails, skip it** — it's a status line, not an event. Do not route on it; do not error.
   2. If parse succeeds and the object has an `event` field, route on `event`:

   - **`event: modify`** — user clicked Edit with agent — go to the modify loop, then come back here to read the next event
   - **`event: saved`** — user clicked Done — dataset is finalised, move on to confirm + summarise
   - **`event: cancelled` or process exits non-zero** — stop the flow
9. **Modify loop: add or remove traces in chat** — The page is still open and the background script is still alive; the user wants you to add or remove traces. Ask in plain chat:

   > What would you like to add or remove? You can describe by criteria (e.g. "drop empty-output traces", "add 5 more from last week with errors") or paste explicit trace IDs.

   Then wait for the user's next message. It will contain their answer. Do NOT ask the user here (the answer is free-form and options would just add an extra step before the user can type).

   Then act on it:

   - **Adding traces:** find candidates with `mcp__Bitfab__search_traces` / `mcp__Bitfab__read_traces`, then respect the labeling mode the user chose earlier in this phase (the ask-labeling-mode step). In **agent-first mode (Option A)**, label them yourself with `mcp__Bitfab__update_agent_labels` (same rigor as label-self — every trace gets a verdict + annotation, grounded in the code) before attaching. In **manual mode (Option B)**, do NOT call `mcp__Bitfab__update_agent_labels` — the user wants no agent verdicts pre-filled, and the labeling page lets them label the new candidates from scratch alongside the existing ones. Either way, call `mcp__Bitfab__add_traces_to_dataset` to attach.
   - **Removing traces:** call `mcp__Bitfab__remove_traces_from_dataset` with the trace IDs to remove. The traces themselves aren't deleted — only their membership in the dataset.

   The page reflects each add/remove live (SSE), so the user sees changes flow in as you make them. When you're done, summarise what changed in chat and **return to the await-event step to read the next event** — do NOT re-run the dataset script; it's still alive in the background. The user can click Edit with agent again for another modify round, or Done to finalise.
10. **Build the dataset** — You already know the trace IDs in this dataset (you attached them in earlier steps and tracked any add/remove from modify rounds). Call `mcp__Bitfab__read_traces` with all of them and `scope: "full"` to load the labels + annotations into context. This is the working set for confirm + every Phase 5 experiment.
11. **Confirm the dataset** — Present the dataset as a numbered choice: each entry showing (trace ID, label, annotation summary). The dataset must contain at least one **validated failing label** — i.e. at least one trace where a human either authored or approved a `false` label. To check, call `mcp__Bitfab__search_traces` restricted to the dataset trace IDs with `validated: true` and `labelResult: false`. Two outcomes:

   - **gate fails (no validated failing label — search returns nothing)** — tell the user and loop back to find or label more unlabeled traces
   - **gate passes (at least one validated failing label)** — get explicit approval, then continue

   Unapproved agent labels do **not** satisfy this gate by design — `validated: true` excludes them.
12. **Hold in-context** — This approved dataset is the benchmark for all experiments in Phase 5. Keep both the `datasetId` and the trace IDs in your working context throughout. In `dataset` mode the skill stops here — surface the dataset summary (including the id) and exit so they can pick up later with `$bitfab:assistant experiment <key> <datasetId>`.

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

1. **Run only when mode is `experiment`.**

   The trace function key comes from the argument and no prior phase has run. Pick the dataset to iterate against, then locate the code:

   1. **Grep the codebase** for the trace function key (e.g. `grep -r "<traceFunctionKey>" --include="*.ts" --include="*.tsx" --include="*.py" --include="*.rb" --include="*.go" --include="*.baml"`) and note the file path. This is the code you'll iterate on.
   2. **Pick the dataset.** If a `<dataset-id>` argument was provided, use it directly. Otherwise call `mcp__Bitfab__list_datasets` with the trace function key, present the result to the user as a numbered choice, and use their choice. Hold the chosen `datasetId` in working context.
   3. **Load it.** Call `mcp__Bitfab__read_traces` with the dataset's trace IDs and `scope: "full"` so labels + annotations are in context.
   4. **Branch on the result:**

   - **no datasets exist for this function (`list_datasets` returned empty), or the picked dataset has no validated failing labels** — tell the user the function has no usable dataset yet and recommend running `$bitfab:assistant dataset <key>` first; stop the flow
   - **dataset loaded (≥1 validated failing label)** — summarize the dataset for the user (counts of pass/fail) and the failure annotations. Pick a first experiment from the failure patterns and continue
2. **Run only when mode is `all` or `experiment`.**

   **Make the change.**

   - Explain to the user what you're changing and why, and confirm before editing
   - Edit the iteration target (prompt, code, tools, parameters)
3. **Run only when mode is `all` or `experiment`.**

   **Replay against the dataset.** Collect the trace IDs from the labeled dataset (built in Phase 3 in `all` mode, or rehydrated at the start of this phase in `experiment` mode). Run the replay script with those specific traces.

   ```bash
   # The exact command depends on the replay script — adapt to what exists
   # Example for TypeScript:
   cd <project-dir> && npx tsx scripts/replay.ts <pipeline-name> --trace-ids <id1>,<id2>,<id3>,...
   ```

   **Before running: verify the replay script prints the full original and new output values to stdout for every item** (not just lengths, counts, hashes, or truncated previews). If it doesn't, fix the script first — the Replay Output Contract and example script live in the SDK reference at `https://docs.bitfab.ai/<language>-sdk#replay`. Subagents can't evaluate an improvement from `5 → 7 (+2)`.

   **Capture the `testRunId` from the replay output** — the SDK prints it (alongside `testRunUrl`) when the run completes. Track every `testRunId` produced across all iterations of this phase: you'll feed them to `open-experiments` so the user can review every experiment side-by-side in one viewer.
4. **Run only when mode is `all` or `experiment`.**

   **Evaluate against labels & annotations.** Read the replay output. For each trace in the dataset, use the label (pass/fail) and annotation (from Phase 3, or rehydrated at the start of this phase in `experiment` mode) to judge whether the new output is an improvement:

   - For traces labeled **fail**: Does the new output address the issue described in the annotation? The annotation explains what went wrong — use it as the acceptance criteria.
   - For traces labeled **pass**: Did the replay preserve the correct behavior, or did it regress?
   - Record the results into a tmp file if the dataset/context is too big so you can recall it later easily.
   - Return the results of the sub agent if you are in one to the main agent.
5. **Run only when mode is `all` or `experiment`.**

   **Open the experiment viewer.** Run the open-experiments command with **every** `testRunId` you've collected across iterations of this phase (comma-separated). The viewer renders each experiment as a card so the user can compare pass/fail counts and drill into individual traces side-by-side.

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/openExperiments.js" <testRunId1>,<testRunId2>,<testRunId3>
   ```

   The command opens a browser window and exits immediately — do **not** wait for it, and do **not** poll. Continue straight to `share-results`. The viewer is a parallel review surface for the human; your textual summary in the next step is still required.

   If no `testRunId`s were captured (e.g. the replay script didn't print them), skip this step and continue — but flag it to the user in `share-results` so the script can be fixed before the next iteration.
6. **Run only when mode is `all` or `experiment`.**

   **Share results to the user.**

   > "After N experiments these are the results: X/Y traces now pass.
   >
   > - ✅ Trace `abc123`: Now passes — [how the annotation's issue was resolved]
   > - ❌ Trace `def456`: Still failing — annotation said [X], output still [Y]
   > - ❌⚠️ Trace `ghi789`: Was passing, now failing (regression)"

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
   > - Full replay pass rate: A/B
   > - Changes made:
   >   - [File]: [Description of change]
   >   - [File]: [Description of change]
   >
   > The changes are in your working tree (not committed). Review the diffs and commit when ready."
