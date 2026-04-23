---
name: improve
description: "Iterate on a traced Bitfab function to improve its pass rate. Use when the user wants to review failing traces, label examples, and replay an LLM function until it passes. Invoke with $bitfab:improve <trace-function-key>."
---

# Bitfab Improve

Use the **local plugin MCP tools** (`mcp__Bitfab__*`) to find what's failing in a traced function, gather labeled failed traces, then iterate on the code/prompts using replay until pass rates improve.

**MCP tools:** This skill uses `list_trace_functions`, `search_traces`, `read_traces`, and `update_agent_labels` from the **local plugin MCP server** (bundled with this plugin), exposed under the `mcp__Bitfab__*` prefix.

**When the flow branches, always present the options clearly and wait for the user's answer before proceeding.** Number or letter the options so the user can pick by reference. Rules:

- Recommend an option first, explain why in one line
- Present 2-5 concrete options
- One decision per question — never batch

**🚨 Blocking-process rule (applies to any plugin command described as "blocks until the user does X"):** When you launch a plugin CLI that blocks on a browser handoff (`startDataset.js`, `login.js`, etc.), you MUST keep the exec session alive and keep polling it until the process exits on its own.

- Printing the URL is NOT completion. The process is still running, racing a loopback callback and a server-polled ticket — it will exit only after the user's browser action delivers a result (or after the timeout).
- After sending the URL to the user, keep polling the live shell/exec session at least every few seconds with your normal "read more output" tool (`write_stdin`, `read`, or whatever your runtime's equivalent is for the long-running shell). Do not idle waiting for a user message.
- Do not send a final "waiting for you to click Confirm" text and then stop polling — the user's confirmation does NOT come back to you as a chat message; it comes back as the plugin process exiting with output on stdout.
- Stop polling only when one of: (a) the process exits 0 and prints its completion summary, (b) the process exits non-zero, or (c) the user explicitly cancels.
- When the process exits, immediately continue with the next step in the flow — don't wait for another user message.

## Phase 0: Status + Update Check

First, resolve `BITFAB_PLUGIN_DIR` if it isn't already exported in this shell. Run this block verbatim — it auto-detects dev / prod / custom-`CODEX_HOME` installs:

```bash
if [ -z "$BITFAB_PLUGIN_DIR" ]; then
  BITFAB_PLUGIN_DIR=$(
    hit=$(find "${CODEX_HOME:-$HOME/.codex}/plugins/cache" -maxdepth 6 -type f -name status.js \
      \( -path '*/bitfab-dev/bitfab/local/dist/commands/*' \
      -o -path '*/bitfab/bitfab/*/dist/commands/*' \) 2>/dev/null | head -1)
    echo "${hit%/dist/commands/status.js}"
  )
  export BITFAB_PLUGIN_DIR
fi
test -n "$BITFAB_PLUGIN_DIR" || { echo "ERROR: Bitfab plugin not installed"; exit 1; }
```

Then run the status command:

```bash
node "${BITFAB_PLUGIN_DIR}/dist/commands/status.js"
```

If the output includes `v<X> available — run ... to update`, pass the upgrade line through to the user verbatim before continuing. Don't block on it — just surface the notice once and move on. If status reports `not authenticated`, stop the flow and tell the user to run `$bitfab:setup login` first.

## Phase 1: Identify the Trace Function

If a `traceFunctionKey` was provided as an argument, use it. Otherwise:

1. Call `mcp__Bitfab__list_trace_functions` to list all available trace functions. Use **only** the keys and metadata returned (trace counts, last activity) — do NOT invent or infer descriptions of what each function does from its key name. Key names are often ambiguous or misleading, and guessing produces hallucinated descriptions that confuse the user.
2. **Cross-check each key against the local codebase** before presenting. For each returned key, `grep` the repo for string-literal uses of that exact key (across `*.ts`, `*.tsx`, `*.py`, `*.rb`, `*.go`, `*.baml`). Mark each function in the presented list as:
   - **✅ instrumented here** — found in this repo, with the file path
   - **⚠️ not found in this repo** — traces exist on Bitfab but the key isn't in this codebase (likely another repo or a renamed key)
3. Present the full list in the question text showing ONLY: `<key>` · `<trace count>` · `<last activity>` · `<instrumented-here marker + path, or not-found marker>`. No invented summaries.
4. Ask the user with 2 options: the recommended function (prefer one that is ✅ instrumented here AND has recent activity) and a free-text "Type a function key" option. If nothing is instrumented here, say so explicitly in the question — don't hide it.

## Phase 2: Verify Instrumentation & Replay

Check that this trace function has both instrumentation and a replay script.

### Check Instrumentation

Search the codebase for the trace function key to confirm SDK usage:

- TypeScript: `grep -r "<traceFunctionKey>" --include="*.ts" --include="*.tsx"`
- Python: `grep -r "<traceFunctionKey>" --include="*.py"`
- Ruby: `grep -r "<traceFunctionKey>" --include="*.rb"`
- Go: `grep -r "<traceFunctionKey>" --include="*.go"`

If the key is found, note the file location — this is the code you'll iterate on in later phases.

If the key is NOT found in the codebase, the function is instrumented elsewhere (the traces exist on Bitfab). ask:

> "I can't find `<traceFunctionKey>` in this codebase — it may be instrumented in another repo or under a different key."
>
> Options: "Instrument now (Recommended)" — set up tracing in this codebase / "Continue anyway" — work with the traces even without local code / "Pick a different function" / "Stop"

If the user chooses **"Instrument now"**, invoke `$bitfab:setup instrument`, then continue with Phase 2 Check Replay Script. If **"Continue anyway"**, skip to Phase 3 (dataset building) since there's no local code to iterate on yet.

### Check Replay Script

Search for a replay script that covers this trace function:

- Look for files matching `scripts/replay.*`, `scripts/*replay*`, or any file that imports `bitfab.replay` / `client.replay`
- Read the script and check that it maps the target trace function key

If a replay script exists but targets a different function key, do NOT modify the existing script or suggest changing the code's function key. Instead, treat it as "no replay script for this function" and offer to create a new one.

If no replay script exists or it doesn't cover this function, ask the user:

> "No replay script found for `<traceFunctionKey>`."
>
> Options: "Create replay now (Recommended)" — create the replay script inline / "Pick a different function" / "Stop"

If the user chooses **"Create replay now"**, invoke `$bitfab:setup replay`, then continue with Phase 3.

## Phase 3: Build Dataset via Labeling

Build a dataset of labeled traces. If there are already enough validated traces, use them directly. Otherwise, the agent labels candidate traces and opens the labeling page for the user to approve or correct them.

1. **Check existing validated traces** — Use `mcp__Bitfab__search_traces` with `validated: true` to find traces with validated labels (human-authored, or agent-authored and approved by a human). Count them, and check whether at least one is a failing label. Present the summary to the user as a numbered choice (e.g., "Found 8 validated traces (3 pass, 5 fail). Do you want to label more, or proceed with this dataset?"). If the user is satisfied, **skip to step 7**. If they want more labels, continue to step 2. Note: `search_traces` excludes replayed traces (traces from test runs) by default — leave `includeReplays` off when labeling, since replays have new inputs (not the original production inputs) and shouldn't be mixed in with the traces you're labeling.

2. **Find unlabeled traces** — If more labels are needed, search again without label filters to find unlabeled traces. Use `mcp__Bitfab__read_traces` with `scope: "summary"` to read them and identify which are worth labeling — look for diverse inputs, traces that produced output (not empty), and traces that cover different scenarios. Filter out near-duplicates and uninteresting traces.

3. **Present candidates** — Show the user which unlabeled traces you recommend labeling and why. Include the already-labeled trace count for context (e.g., "4 traces already labeled, recommending 5 more for labeling"). Let the user approve, adjust, or skip.

4. **Label them yourself FIRST (mandatory before step 5)** — Once the user approves the candidate traces, **you** label them. Call `mcp__Bitfab__read_traces` with `scope: "full"` on the approved trace IDs (batch them — up to 10 per call), read each trace's inputs / output / spans yourself, and decide for each one whether it looks like a PASS or a FAIL. **Ground your judgment in the codebase, not just the trace text.** Before you start labeling, read the instrumented function in the user's source (you found it in Phase 2) and any nearby code that explains intent — comments, docstrings, README sections, related tests, BAML files — so you know what the function is *supposed* to do and what "good" looks like for it. Apply the same context to every trace: does this output achieve the function's goal as expressed in the code? Does it match the patterns in the already-validated traces? Then call `mcp__Bitfab__update_agent_labels` once with an array of `{ traceId, label, annotation }` objects — **both `label` (true for pass, false for fail) and `annotation` (a one-or-two-sentence explanation written for the human reviewer, ideally referencing what the code is trying to do) are required for every trace**. Commit to a verdict — if you genuinely cannot decide, you didn't read the trace or the code carefully enough. The labels you save here start unapproved; they only become part of the validated dataset once a human approves them in step 5.

   > 🚨 **HARD RULE — DO NOT SKIP:** You MUST call `mcp__Bitfab__update_agent_labels` with verdicts for every approved trace BEFORE running `startDataset.js` to open the labeling page. Sending the user into the labeling page without pre-labeled verdicts is a process violation. This is non-negotiable.

   > **Made a mistake?** If you realize a verdict was wrong (e.g., you mislabeled a trace or want to re-evaluate), call `mcp__Bitfab__update_agent_labels` again with `{ traceId, archive: true }` for those traces. The previous label is hidden (kept for audit), and you can re-label the trace from scratch with another `update_agent_labels` call.

5. **Open the labeling page** — Run the label script to open the labeling page in the browser:
   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/startDataset.js" <functionKey>
   ```
   (`BITFAB_PLUGIN_DIR` was resolved in Phase 0. `<functionKey>` is the trace function key.) This opens the labeling page showing agent-labeled traces awaiting approval and already-labeled traces. The user approves agent labels, relabels traces, or skips. The script **blocks until the user clicks "Confirm dataset"** (up to 30 minutes).

   The script prints a handoff URL (with `callbackPort=` and `ticket=` query params). Surface that URL to the user verbatim so they can paste it into a browser if the auto-launch didn't open one.

   **Polling (mandatory — see the Blocking-process rule at the top of this skill):** after surfacing the URL, keep polling the live exec session until the process exits. Do NOT stop after printing the URL. Do NOT wait for a chat message from the user — their confirmation arrives as stdout on the already-running process, not as a new prompt. Poll every few seconds until one of: (a) the process exits 0 and prints a `Labeling complete: ...` line, (b) the process exits non-zero, or (c) the user explicitly cancels.

6. **Wait for labeling to complete** — The label script prints a summary on exit, e.g. `Labeling complete: 8/10 traces labeled (last: pass) [via ticket]`. This step is complete only when you have observed that final line on the polled exec session. As soon as you see it, move directly to step 7 without waiting for another user message.

7. **Build the dataset** — Call `mcp__Bitfab__search_traces` with `validated: true` to get the final set of validated traces. Call `mcp__Bitfab__read_traces` with all validated trace IDs and `scope: "full"` to get the full dataset with labels and annotations.

8. **Confirm the dataset** — Present the dataset as a numbered choice: each entry showing (trace ID, label, annotation summary). The dataset must contain at least one **validated failing label** — i.e. at least one trace where a human either authored or approved a `false` label. To check, call `mcp__Bitfab__search_traces` restricted to the dataset trace IDs with `validated: true` and `labelResult: false`; if it returns nothing, the gate fails — tell the user and go back to step 2 to find or label more traces. Unapproved agent labels do **not** satisfy this gate by design — `validated: true` excludes them. Get explicit approval before moving on.

9. **Hold in-context** — This approved dataset is the benchmark for all experiments in Phase 5. Keep it in your working context throughout.

## Phase 4: Diagnose & Plan

### Step 1: Understand Failures

Using the failed traces you read in Phase 3 (or read them now if you haven't):

1. Call `mcp__Bitfab__read_traces` on 3–5 failed traces with `scope: "full"`

Synthesize the failure patterns — what's going wrong, what the common threads are.

### Step 2: Read the Code

1. Find the instrumented function in the codebase (you found it in Phase 2)
2. Read the full implementation — follow the call chain to understand the logic
3. Identify **iteration targets**: prompts, system messages, parameters, preprocessing, postprocessing
4. If BAML files are involved, read the relevant `.baml` files

### Step 3: Categorize fixes based on failure annotations

Based on the failure patterns, the code, and the labeled dataset from Phase 3, categorize proposed changes into three buckets:

**Bucket 1 — Code fixes**: Deterministic bugs (off-by-one, type mismatch, missing null check, wrong variable). These won't recur once fixed. Bundle all code fixes into a single experiment unless they are large feature changes. These are applied first as a foundation that all subsequent experiments build on.

**Bucket 2 — Judgment-based fixes**: Prompt changes, context truncation, search tuning, output formatting, etc. These require the user's judgment to evaluate correctness. Each gets its own experiment.

**Bucket 3 — Infrastructure proposals**: Larger changes that require new infrastructure, architectural changes, or significant feature work. These are separated out because experiments become harder to compare when some include large infra changes and others don't — apples-to-apples comparison requires a consistent baseline. Do not run experiments for these. Instead, if the user has integrations (Linear, Notion, Jira), propose creating a task with a clear writeup for future work.

Present the categorized plan as a numbered choice:

> "Based on the N traces in the dataset, here's what I see: \*\***Code fixes** (experiment #1 — bundled):
>
> - \[Fix\]: \[What and why, which traces it addresses\] \*\***Judgment-based experiments** (#2, #3, ...):
>
> - \[Experiment\]: \[What change, which traces it targets, hypothesis\] \*\***Future infrastructure** (not experiments):
>
> - \[Proposal\]: \[What it would require, which traces it would help\]
>
> I'll replay each experiment against the labeled dataset and evaluate using the annotations as acceptance criteria."

Get the user's confirmation before proceeding.

## Phase 5: Iterate with Replay

Run an iterative improvement loop. Fork as many experiments that do not rely on sequential results to subagents using the **Agent tool** with isolation: "worktree". Each iteration:

### Step 1: Make the Change

1. Ask the user to explain what you're changing and why, and confirm before editing

2. Edit the iteration target (prompt, code, tools, parameters)

### Step 2: Replay Against Dataset

Collect the trace IDs from the labeled dataset (Phase 3). Run the replay script with those specific traces.

```bash
# The exact command depends on the replay script — adapt to what exists
# Example for TypeScript:
cd <project-dir> && npx tsx scripts/replay.ts <pipeline-name> --trace-ids <id1>,<id2>,<id3>,...
```

**Before running: verify the replay script prints the full original and new output values to stdout for every item** (not just lengths, counts, hashes, or truncated previews). If it doesn't, fix the script first — the Replay Output Contract and example script live in the SDK reference at `https://docs.bitfab.ai/<language>-sdk#replay`. Subagents can't evaluate an improvement from `5 → 7 (+2)`.

### Step 3: Evaluate Against Labels & Annotations

Read the replay output. For each trace in the dataset, use the label (pass/fail) and annotation from Phase 3 to judge whether the new output is an improvement:

- For traces labeled **fail**: Does the new output address the issue described in the annotation? The annotation explains what went wrong — use it as the acceptance criteria.
- For traces labeled **pass**: Did the replay preserve the correct behavior, or did it regress?
- Record the results into a tmp file if the dataset/context is too big so you can recall it later easily.
- Return the results of the sub agent if you are in one to the main agent.

### **Step 4: Share Results to the user**

> "After N experiments these are the results: X/Y traces now pass.
>
> - ✅ Trace `abc123`: Now passes — \[how the annotation's issue was resolved\]
> - ❌ Trace `def456`: Still failing — annotation said \[X\], output still \[Y\]
> - ❌⚠️ Trace `ghi789`: Was passing, now failing (regression)"
>
> Show this across the full data set, and highlight the best outcome concisely. Explain why it worked best with references to code, docs, and/or research if needed. For the best outcome:
>
> - **If pass rate improved and no regressions**: ask the user: if they want to keep iterating or stop
> - **If pass rate improved but regressions exist or no improvement**: Ask the user to tell the user and propose to create a plan for new experiments and continue iterating.
>
> Ensure the choice you present includes your recommended next step.

## Phase 6: Validate & Wrap Up

### Step 1: Summary

Ask the user to present the final results similar to this. You may expand where appropriate based on context from the user:

> "**Improvement summary for** `<traceFunctionKey>`:
>
> - Failed traces fixed: X/Y (from N% → M% pass rate on labeled failures)
> - Full replay pass rate: A/B
> - Changes made:
>   - \[File\]: \[Description of change\]
>   - \[File\]: \[Description of change\]
>
> The changes are in your working tree (not committed). Review the diffs and commit when ready."
