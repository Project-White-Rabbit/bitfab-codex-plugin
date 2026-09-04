---
name: setup
description: "Set up and maintain Bitfab tracing for AI features. TRIGGER when: user wants to set up Bitfab, instrument code, add tracing/observability for LLM or agent calls, observe AI calls, add evaluation, trace LLM functions, trace a new workflow, change what an existing trace captures, re-instrument an existing traced function (move a database read or other side effect in or out of a span, change what a span records as its input/output), inspect or debug their tracing setup (what's instrumented, why traces aren't showing up), or understand what Bitfab is; or says anything like 'instrument', 'add tracing', 'trace my code', 'set up observability', 'hook up Bitfab', 'start tracking my AI workflow', 'trace a new workflow', 'create a trace plan', 'bitfab create a plan', 'give me the trace plan', 'give me the trace plan for <function>', 'show me the trace plan', 'update my tracing setup', 're-instrument', 're-instrument <function>', 'move the database read out of the span', 'make this trace replayable without a database', 'change what this span records as input', 'why aren't my traces showing up', 'what is Bitfab', 'set up database snapshots', 'replay against my database state at trace time', 'analyze the repo for what to instrument', 'analyze-repo', 'scan the codebase and upload trace plans', 'find the top places to trace and draft plans for them', 'give me the updated plan to instrument the second one', 'instrument the second/next/other one', 'instrument another function', or 'draft the plan to trace <X>'. This trigger applies even mid-conversation and after setup already ran: every additional function to instrument or trace plan to draft must re-enter this skill. Use this skill whenever producing a trace plan; never hand-write one outside its trace-plan flow. SKIP when: user is (a) improving the QUALITY of a traced function's outputs, fixing failures, pass rates, labeling, running experiments (use bitfab:assistant); or (b) upgrading the plugin/SDK to a newer *version* (use bitfab:update). Invoke with $bitfab:setup [wizard|explain|login|session-logs|instrument|modify|inspect|switch-org|view|replay|db-snapshot|templates|analyze-repo] [<what to do>]."
---

# Bitfab Setup

**When the flow branches, always present the options clearly and wait for the user's answer before proceeding.** Number or letter the options so the user can pick by reference. Rules:
- Recommend an option first, explain why in one line
- Present 2-5 concrete options
- One decision per question, never batch

**Execution style (applies to every phase).** Default to terse, action-first turns:
- During mechanical phases (detecting language, searching code, reading files), run the tools and report only what you found. Do not narrate each command or pre-announce what you are about to do.
- Batch read-only probing: combine related shell checks into one command (separate them with `;`, not `&&` (a no-match `grep` exits non-zero and would abort an `&&` chain, skipping later probes)), and read multiple files in a single batch rather than one file per turn. Adaptive follow-up greps that depend on a prior result are expected and fine; the goal is to collapse only the fixed, independent probes.
- Keep prose between tool calls to one line or none. Save fuller explanation for decision points and the workflow summaries the user acts on.
- Surfacing a risk, ambiguity, or unexpected finding is never the narration to suppress: raise it immediately, even mid-probe (e.g. unserializable inputs, a shim with lazy init, an ambiguous project root).

**Studio recovery (applies to every Studio-opening command).** Any command that opens or navigates Studio (`openTracePlan.js`, `startTemplatePreview.js`, etc.) emits `{"event":"not-responding","sessionId":"..."}` and exits non-zero when a Studio session is recorded but its window can't be reached (a crash, sleep, or a close no process witnessed). It will NOT open a duplicate window. **Do not retry this blindly.** Recommend the user refresh or reopen the Studio tab, then ask the user with two options: **Try again** (re-run the same command, the record is still on disk, so a window that came back gets reused) or **Open a new Studio** (run `node "${BITFAB_PLUGIN_DIR}/dist/commands/clearStudioSession.js"`, then re-run the command, which now opens a fresh window). Only run `node "${BITFAB_PLUGIN_DIR}/dist/commands/clearStudioSession.js"` after the user approves. Some commands (e.g. `login`) also expose a `--force` flag for a user at a terminal to recover the same way; never run `--force` yourself, surface the recovery to the user instead.

**Describe this to the user in terms of their browser window, never the plumbing.** The words in the paragraph above (session, pointer, record, stale, `not-responding`, sessionId) are for you, not for them: a user has a Studio tab open, they do not have a session pointer, and naming one tells them nothing they can act on. Say what they can see and what you want them to do, and offer a cause they can check rather than a diagnosis you can't make: the browser may have backgrounded the window (behind another window, minimized, or on another desktop or space), so send them looking for it before you offer a new one. E.g. "The Studio tab I opened earlier isn't responding. Your browser may have backgrounded it. Try switching to it and refreshing it, and if you can't find it I'll open a new one." Same rule for every other internal term you might be tempted to echo (agent session, monitor event file, exec session, daemon): describe the effect, not the mechanism.

**Studio URL surfacing (applies to every fresh Studio open).** If any Studio-opening command emits `{"event":"window-open-requested","url":"..."}`, immediately surface that URL to the user in a normal chat message (for example, `Opening Studio: <url>. Click it if a window doesn't appear`) so it is copyable from the transcript. This event means the open was *requested* (the browser launch was called), not that a window is confirmed on screen: on a remote/SSH session or with no supported default browser, nothing may surface, so the link is the reliable fallback. Surface it every time the event appears; do not leave the URL only in shell/tool output. If instead the command emits `{"event":"open-failed","reason":"...","url":"..."}`, the browser process did not even launch (e.g. `rate-limited`, `spawn-failed`): tell the user Studio couldn't open a browser (give the `reason`) and to click the link to open it (`<url>`); the session is live and the command keeps polling, so a manual click connects.

**Studio reuse: never close-then-reopen to switch pages (applies to every Studio-opening command).** Every Studio-opening command (`openTracePlan.js`, `startDataset.js`, `startTemplatePreview.js`, `login.js`, etc.) resolves the active session and **navigates the live tab in place** (emitting `{"event":"navigated",...}`); it opens a fresh window only when no session is active. So to change what Studio is showing, open a different dataset, a different trace plan, or a different page, just run the relevant open command again with the new target. **Never call `node "${BITFAB_PLUGIN_DIR}/dist/commands/closeStudio.js"` just to switch:** closing and reopening churns the tab, can orphan windows, and is never the way to change pages. Reserve `node "${BITFAB_PLUGIN_DIR}/dist/commands/closeStudio.js"` for genuine end-of-flow cleanup (the cleanup step already handles that) or when the user explicitly asks for the Studio tab to be closed.

**🚨 Blocking-process rule (applies to any plugin command described as "blocks until the user does X"):** When you launch a plugin CLI that blocks on a Studio interaction (`login.js`, `startDataset.js`, `openTracePlan.js`, etc.), you MUST keep the exec session alive and keep polling it until the process exits on its own.

- The process opens Studio (or navigates an existing Studio session) and polls for the user's action via agent session events. It exits only after the user completes the action in Studio (or after the timeout).
- After launching the command, keep polling the live shell/exec session every few seconds with your normal "read more output" tool. Do not idle waiting for a user message.
- The user's confirmation does NOT come back as a chat message; it comes back as the plugin process exiting with output on stdout.
- Stop polling only when: (a) the process exits 0 with its completion summary, (b) the process exits non-zero, or (c) the user explicitly cancels.
- When the process exits, immediately continue with the next step, do not wait for another user message.
- **Exception, `openTracePlan.js` only.** Its trace-plan steps (build-trace-plan, present-diff) run it in the background AND ask the user "Continue instrumenting?" in the same turn, because reviewing the plan in Studio is optional there. Keep polling the exec session as above, but a terminal-side answer is a second, equally valid way for that step to finish. Everything else in this rule still holds: never idle on a chat message alone, and when the process exits, act on its stdout, which outranks a stale answer.

This skill has twelve phases: **explain**, **login**, **session-logs**, **instrument**, **modify**, **inspect**, **switch-org**, **view**, **replay**, **db-snapshot**, **templates**, and **analyze-repo**. Run individually or through setup (`wizard` runs login → instrument; `explain` is a standalone read-only overview that requires no login; `session-logs` is standalone and does not require login; `modify` is only invoked explicitly or as a branch from Instrument's existing-SDK-usage menu; `inspect` is a standalone diagnostic (with optional one-shot fixes) invoked explicitly; `switch-org` is a standalone account action (requires auth) invoked explicitly; `view` is only invoked explicitly; `db-snapshot` is only invoked explicitly; `templates` is only invoked explicitly; `analyze-repo` is a standalone, **non-interactive** batch action (requires auth) invoked explicitly: it scans, picks the top few candidates, and uploads a draft trace plan for each, asking nothing and editing no code).

**Natural-language aliases (these reuse an existing mode, not a separate one):** "explain Bitfab" / "what is Bitfab" → `explain`; "trace a new workflow" / "instrument a new flow" / "create a trace plan" / "give me the trace plan" / "give me the trace plan for <function>" / "show me the trace plan" / "bitfab create a plan" / "instrument the second/next/other one" / "instrument another function" → `instrument` (a bare `$bitfab:setup` with one of these phrasings routes to Instrument, NOT the full `wizard`); "update-setup" / "update my tracing setup" / "adjust what's captured" → `modify` (NOT a plugin/SDK *version* bump, that's `$bitfab:update`); "debug-setup" / "debug my tracing setup" / "inspect my tracing" / "why aren't my traces showing up" / "what's instrumented" → `inspect` (for output-*quality* debugging use `$bitfab:assistant` instead); "switch org" / "change org" / "switch to the <name> org" / "I'm in the wrong org" → `switch-org`; "set up db snapshots" / "set up db branching" / "replay against my database" / "replay against the database at trace time" / "database snapshots for replay" → `db-snapshot`; "analyze the repo" / "analyze-repo" / "scan the codebase and draft trace plans" / "find the top things to instrument and upload plans for them" → `analyze-repo` (non-interactive: never prompts, never edits code, just uploads draft plans).

When instrumenting a workflow, **its instrumentation and replay pipeline are written together in the same cycle** once the trace plan is confirmed (see Instrument's write-instrumentation step). The standalone `replay` mode remains available for coverage-verification and backfill.

**Before running plugin commands below**, resolve `BITFAB_PLUGIN_DIR` in the shell. Codex does not inject a plugin-root env var, so you must determine it. Copy and run this block verbatim, it auto-detects whichever install is active:

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

If the block prints `ERROR: Bitfab plugin not installed`, the user hasn't installed the plugin yet, stop and tell them to install it. Otherwise proceed. The commands live at `$BITFAB_PLUGIN_DIR/dist/commands/*.js`.

**SDK reference:** https://docs.bitfab.ai is the source of truth for SDK install, initialization, API surface, and replay. Every docs path below ends in `.md`: that suffix returns the page as plain markdown (no HTML chrome), so fetch the URLs exactly as written. Fetch in this order before writing any code, do not improvise from memory:
- **Canonical API surface (preferred for agents):** the dense reference pages at `/reference/typescript.md`, `/reference/python.md`, `/reference/ruby.md`, `/reference/go.md`. These list every public export, signature, type, default, and error semantic, no tutorials, no prose. Read these first.
- **The client exposes three instrumentation primitives, not one.** Spans are the oldest, not the only one: TypeScript has `withSpan`/`span`, `withTrace`/`trace`, and `withNode`/`node`; Python has `@client.span`, `@client.trace`, and `@client.node`; Ruby and Go have spans only. `trace` records a root plus every first-party call beneath it without decorating them (TypeScript needs a `bitfab-transform` adapter, Python needs 3.12+), and `node` applies naming, typing, capture, and `mockOnReplay`/`mock_on_replay` policy to one call discovered inside that subtree. Name all three when you fetch a reference page. The fetch answers the question you asked, so asking only about `withSpan`/`@span` returns a page that reads as though spans are the whole API.
- **Cross-SDK shared semantics:** `/reference/overview.md` (invariants), `/reference/span-types.md` (the `SpanType` enum), `/reference/http.md` (wire protocol).
- **Framework integrations (fetch when a framework is detected in step 1 of Instrument):** `/frameworks/langgraph.md`, `/frameworks/openai-agents.md`, `/frameworks/claude-agent-sdk.md`, `/frameworks/baml.md`, `/frameworks/vercel-ai-sdk.md`. Each page documents the SDK's native handler/processor/wrapper for that framework, which is usually preferable to hand-wrapping every node/agent call with `withSpan`/`@span`.
- **Tutorials / walkthroughs / replay registry module template:** the language-specific guide pages (`/typescript-sdk.md`, `/python-sdk.md`, `/ruby-sdk.md`, `/go-sdk.md`). Use these for the copy-pasteable replay registry module and the replay output contract. During Instrument, fetch the Replay section before Instrument's write-instrumentation step so the replay registry module can be written alongside the instrumentation in the same cycle without re-fetching.

**MCP tools:** This skill uses `get_bitfab_api_key`, `save_trace_plan`, `get_trace_plan`, `list_trace_plans`, and `cancel_trace_plan` (login / instrument / modify / view / `analyze-repo`), `list_trace_functions` and `search_traces` (`inspect`, `templates`, and the exact-trace smoke test in `db-snapshot`), `list_organizations` (`switch-org`), `get_database_connection_status` (`db-snapshot` only), and, for the `templates` mode only, `get_template_reference`, `get_template`, and `save_template`. All come from the **local plugin MCP server** (bundled with this plugin), exposed under the `mcp__Bitfab__*` prefix.


**CLI commands** available via Bash (all paths relative to `${BITFAB_PLUGIN_DIR}/dist/commands/`):

| Command | Description |
|---------|-------------|
| `status.js` | Check plugin authentication and connection status |
| `login.js` | Authenticate for setup/instrumentation; standalone browser OAuth (blocks). Studio, dataset, and experiment flows log in inline and need no pre-login. |
| `switchOrg.js [<clerkOrganizationId>]` | List the user's Bitfab orgs (no args), or switch the plugin's active org and replace the local API key (with a <clerkOrganizationId> arg) |
| `openTracePlan.js <planId>` | Open the trace plan review UI in Studio (stays alive until the user closes or updates the plan) |
| `openStudioTo.js <path>` | Navigate the active Studio session to a path (opens a window when none is active) |
| `startTemplatePreview.js <functionKey>` | Open the template editor preview in Studio (blocks until user clicks Done) |
| `closeStudio.js [message]` | Close the active Studio session (tab + background event process); no-op when nothing is open |
| `clearStudioSession.js` | Start a fresh Studio window on the next open |
| `update.js <mode>` | Check plugin + SDK versions and install the latest (used by inspect to detect and fix staleness) |
| `sessionLogConsent.js [get|set true|set false]` | Read (`get` prints `true`/`false`/`null`) or persist (`set true|false`) the global session-log consent flag |

## Modes

Read `$ARGUMENTS` first. If its first token is exactly one of the mode names below, run that mode. Otherwise, when this skill documents how to route the remaining arguments (see its intro), follow that; if it doesn't, run `wizard` and treat `$ARGUMENTS` as its input. Run only that mode's section below and skip the others.

| Mode | Trigger | What it does |
|------|---------|--------------|
| `wizard` | `wizard` (default) | Run login, then instrument workflows until the user is done. |
| `explain` | `explain` | Explain what Bitfab is and what each mode does (read-only, no login). |
| `login` | `login` | Authenticate for setup/instrumentation (Studio/assistant flows log in inline, no pre-login). |
| `session-logs` | `session-logs` | Opt in or out of session log collection (no login required). |
| `instrument` | `instrument` | Instrument AI workflows with Bitfab tracing. |
| `modify` | `modify` | Modify an existing trace setup (add context, change depth, or move the root). |
| `inspect` | `inspect` | Diagnose (and offer to fix) your tracing setup: auth, what's instrumented, plugin/SDK freshness, replay coverage, trace arrival. |
| `switch-org` | `switch-org` | Switch which Bitfab org the plugin reads and writes (replaces the local API key). |
| `view` | `view` | Open the trace planner UI for an existing trace function (read-only). |
| `replay` | `replay` | Create or update replay registry modules for instrumented workflows. |
| `db-snapshot` | `db-snapshot` | Set up per-trace database snapshots so replay runs against the DB state at trace time (TypeScript, Python, Ruby). |
| `templates` | `templates` | Iterate on the span-rendering templates for one trace function. |
| `analyze-repo` | `analyze-repo` | Non-interactively scan the repo, pick the top workflows to trace (default 5, or `limit=<n>`; optional free-text `guidance:` steers what to focus on), and upload a draft trace plan for each (no prompts, no code changes). |

## Login

**Run only when mode is `wizard`, `login` or `instrument`.**

Authenticate with Bitfab and retrieve the API key.

1. Run the status check:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/status.js"
   ```

   If the output includes `v<X> available, run ... to update`, surface that line verbatim to the user once before proceeding; do not block on it.

   If **already authenticated**, skip to step 3.
2. If **"not authenticated"**, run the login script yourself, do NOT ask the user to run it manually:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/login.js"
   ```
   Run with 600000ms (10 minute) timeout. This opens Studio to the sign-in page and polls the server until the user completes authentication in the browser. The process exits when authentication succeeds or the 10-minute timeout fires.

   **If the browser fails to open**, `login.js` prints the Studio sign-in URL. Surface it to the user verbatim so they can open it manually; do not rely on shell/tool output being visible. The polling loop stays active for the full 10-minute timeout regardless of whether auto-launch worked.


   **Per the Blocking-process rule at the top:** after `login.js` opens Studio, keep polling the live exec session until it exits. Do not send a "waiting for you to sign in" message and then idle; the user's sign-in will NOT arrive as a chat message; it arrives as `login.js` exiting with `Logged in as <email>` on stdout.

   If `login.js` exits non-zero or the 10-minute timeout elapsed, report the error to the user and stop.
3. Call `mcp__Bitfab__get_bitfab_api_key` to retrieve the API key, **NEVER print or log the full key**. Stored at `~/.config/bitfab/credentials.json`, used for the `BITFAB_API_KEY` environment variable.

   **If `mcp__Bitfab__get_bitfab_api_key` is not available in this session**, the MCP server is switched off, not broken: it ships inside this plugin, so an absent tool is a setting rather than a failed install. Say so and hand the user the fix below; do not diagnose further, and do not fall back to drafting anything by hand.

   Tell them to re-enable the Bitfab MCP server in their editor's MCP settings, then re-run this skill.

   Then **stop**, the same way a failed login stops. Do not fall through to the remaining steps: every phase after this one needs these tools, so continuing only moves the failure further from its cause.
4. Check whether session log consent has already been recorded:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/sessionLogConsent.js" get
   ```

   If the output is already `true` or `false`, skip the prompt and continue. If the output is `null`, ask the user:
   - **Question:** "Allow Bitfab to collect session logs?"
   - **Description:** Used to diagnose issues and improve the product.
   - **Options:** "Allow" / "Don't allow"

   Save the answer (replace `CONSENT` with `true` or `false`):

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/sessionLogConsent.js" set CONSENT
   ```

## Explain

**Run only when mode is `wizard` or `explain`.**

Teach the two primitives the user has to instrument with. Read-only, no code changes, no Studio. Runs inside `wizard` (right after Login, before the approach question) and standalone via `$bitfab:setup explain` (or natural-language asks like "what is Bitfab" / "explain Bitfab"), which needs no authentication.

1. Render the block below **verbatim** as a single message, as formatted markdown (do **not** wrap it in a code fence, do **not** reword it, and do **not** add a summary or an ASCII diagram). This is the education the rest of setup depends on: a user who does not understand `withSpan` and `replay` cannot make the per-method decisions instrumentation asks of them. Do **not** authenticate, scan the codebase, ask any questions, or edit anything here, in either mode.

   ```markdown
   **Purpose**

   Bitfab's SDK captures each instrumented method's inputs, outputs, and surrounding context as a trace at runtime. During development, developers and coding agents can inject captured trace data and modify code execution at the per-method level to test AI features end-to-end.

   **How to instrument**

   Bitfab provides you a way to capture traces and replay them safely during development. The core primitives from the Bitfab SDK are:

   - `withSpan(...)`
   - `replay(...)`

   `withSpan` captures traces and sends them to Bitfab by default. It serializes the inputs, outputs, and metadata of the method it wraps (or decorates) and sends them over the OTEL transport layer.

   `replay` calls into your code and modifies the behavior of `withSpan` for each method it wraps (or decorates) in one of five ways:

   1. Execute as normal
   2. Pass in inputs from the recorded trace
   3. Pass in modified inputs from the recorded trace
   4. Skip execution and return outputs from the recorded trace
   5. Skip execution and return modified outputs from the recorded trace
   ```

   If the user asks about a framework (or once one is detected later in setup), follow up by explaining how that framework maps onto the five cases above. The principles do not change; only the way it gets instrumented does.

   **Unless the mode is `explain`:**

   Stop there and continue to the *Approach* section. Do not render the mode menu below: mid-setup, a menu of other modes is noise.

   **Only when the mode is `explain`:**

   Follow the block above with this one, as a code block, exactly as laid out:

   ```
   What you can run
     $bitfab:setup            Login, then instrument workflows until done
     $bitfab:setup explain    This overview (read-only)
     $bitfab:setup login      Authenticate with Bitfab
     $bitfab:setup instrument Wrap a new AI workflow with tracing
     $bitfab:setup modify     Adjust what an existing trace captures
     $bitfab:setup inspect    Diagnose + fix setup: auth, what's instrumented, SDK/plugin current, replay coverage, traces arriving
     $bitfab:setup switch-org Switch which org the plugin reads and writes
     $bitfab:setup view       Open one trace function's plan in the browser (read-only)
     $bitfab:setup replay     Create or update replay registry modules
     $bitfab:setup templates  Change how a trace function's spans render
     $bitfab:setup session-logs  Opt in/out of session log collection
   ```

   then close with one line: to start tracing, run `$bitfab:setup`; to debug an existing setup, run `$bitfab:setup inspect`. Then stop.

## Approach

**Run only when mode is `wizard`.**

Settle who does the instrumenting before any code is read or written. Runs once, in `wizard` mode only, after Login.

1. The user is authenticated now. Ask the user to settle who does the instrumenting:
   - **Question:** "Want me to walk you through instrumenting, or would you rather do it yourself?"

   > A) **Walk me through it**: I drive the instrumentation end to end, checking with you at each decision *(recommended)* → step 2
   > B) **I'll instrument myself**: hand over the docs and stop, no scanning, no code changes → step 3

   Recommend **A** and say why in one line: it is the whole flow (SDK install, trace plan, spans, replay registry module) with a confirmation before anything is written. Ask this once; do not re-ask it later in the session.
2. The user asked to be walked through it. **Before anything else** (before dispatching to the *Instrument* section, before a single probe or file read), render the content of the block below **verbatim** as formatted markdown: no code fence, no rewording, no additions.

   ```markdown
   **What's about to happen next**

   - This wizard will guide Codex on how to use the Bitfab plugin to analyze your repository. Codex will then instrument your AI features and write a `replay` script using the Bitfab SDK.
   - Whenever Codex needs your input, it will prompt you
   - Setup takes about 10 - 17 minutes depending on how many features you want to instrument and how complex your AI features are.
   ```

   This is the user's only warning about what the skill is about to do to their repository and how long it takes. It has to reach them between saying "walk me through it" and the next question they get asked, so nothing, not the language detection, not the existing-usage report, may come first.

   Then go to the *Instrument* section and start at its first step. The guided path ends here: do **not** continue into the self-serve handoff that follows, which belongs to option B and tells you to stop.
3. The user is instrumenting on their own. Give them the pointers below in one short message, then **stop**: do not scan the codebase, read files, or edit anything.

   - **Docs:** https://docs.bitfab.ai, start with the SDK guide for their language (`/typescript-sdk`, `/python-sdk`, `/ruby-sdk`, `/go-sdk`); each one covers install, initialization, wrapping a workflow, and (outside Go) the replay registry module. Name the language's page directly if the project's language is already obvious from the conversation; do not go read the repo to find out.
   - **API key:** their app needs `BITFAB_API_KEY` set in the environment it runs in before any trace will arrive. Tell them to get the key from the Bitfab MCP's `get_bitfab_api_key` tool. Do **not** call it yourself, and never print a key.
   - **Coming back:** `$bitfab:setup` picks this flow back up, and `$bitfab:setup inspect` diagnoses an instrumentation they wrote themselves (auth, what's instrumented, whether traces are arriving).

   Then go to the *Cleanup* section and end the run there. Option B is a full stop: do **not** read on into the sections that follow, the *Instrument* section included, and do not scan or edit anything on the way out.

## Session Logs

**Run only when mode is `session-logs`.**

Opt in or out of session log collection. Does not require authentication.

1. Check whether session log consent has already been recorded:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/sessionLogConsent.js" get
   ```

   If the output is `true`, tell the user session logs are currently **enabled**. If `false`, tell the user session logs are currently **disabled**. If `null`, tell the user no preference is recorded yet. Then ask the user:
   - **Question:** "Allow Bitfab to collect session logs?"
   - **Description:** Session logs help us diagnose issues and improve the product. They include prompts, responses, and tool calls from sessions where Bitfab tools are used.
   - **Options:** "Allow" / "Don't allow"

   Save the answer (replace `CONSENT` with `true` or `false`):

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/sessionLogConsent.js" set CONSENT
   ```

   Confirm the change to the user.

## Instrument

**Run only when mode is `wizard` or `instrument`.**

Instrument the codebase with Bitfab tracing. Requires authentication (run Login first if needed).

Bitfab captures every AI function call, inputs, outputs, and errors, so you can see exactly what your AI is doing and discover what's going wrong. The goal is to have enough context in each trace to tell whether a call succeeded or failed, and why.

**Detection and search below are mechanical: run the probes and report what you found, without narrating each command. Combine related read-only checks into one command (separate them with `;`, not `&&`, since a no-match `grep` exits non-zero and would abort an `&&` chain) and read multiple files in a single batch; adaptive follow-up greps that depend on a prior result are expected. A risk, ambiguity, or unexpected finding (unserializable inputs, a shim with lazy init, an ambiguous root) is never the narration to suppress: raise it immediately, even mid-probe.**

1. **Detect the project language** (TypeScript, Python, Ruby, or Go). In a monorepo, identify which directories are **applications** (services, APIs, agents) vs **libraries** (SDKs, shared packages). Focus on application directories. **The only output of this step is that language-and-framework verdict; finding the AI workflows to instrument comes later, at step 7, so a grep hit here is a framework signal, not a workflow to read and characterize.** Also scan imports and package manifests for supported framework signals, and note which framework each application directory uses, step 5 fetches the matching framework page alongside the language reference:
   - **LangGraph / LangChain**: TS: `@langchain/langgraph`, `@langchain/core`; Python: `langgraph`, `langchain`, `langchain_core`
   - **OpenAI Agents SDK**: TS: `@openai/agents`, `setTraceProcessors`; Python: `agents` (`from agents import ...`)
   - **Claude Agent SDK**: TS: `@anthropic-ai/claude-agent-sdk`, `query(`; Python: `claude_agent_sdk`, `ClaudeSDKClient`, `query(`
   - **BAML**: TS: `@boundaryml/baml`, `baml_client` import; Python: `baml-py`, `from baml_client import b`
   - **Vercel AI SDK**: TS: `ai`, `wrapLanguageModel`, `streamText`, `generateText` (TypeScript only)
2. **Search for existing SDK usage** (`withSpan`, `@span`, `bitfab_span`, `client.Span`, `getFunction`, `get_function`, etc.). In a monorepo, search **each application directory separately**: a root-level search can miss subdirectories.
   - If found: ask the user, **listing the existing trace function keys inside the question's own text** (`<key>` · its root function, or its handler registration site for handler-only keys), so the user picks against the actual list instead of a message scrolled above the prompt:

   > A) **Search for more workflows**: find workflows that aren't traced yet *(recommended)* → step 3
   > B) **I'll name the workflow to instrument**: type the file, function, or directory and I read only that, no codebase scan → step 3
   > C) **Change what an existing trace captures**: adjust what one of the keys above records; type its key to go straight to it → step 1 of the Modify phase

     **B and C are both free-text options, and this is the earliest point either answer can land.** Say so in the question: they can type a workflow to instrument, or the key of an existing trace to change, instead of picking anything.
     - **B (a target to instrument)**: carry that target through the SDK install and doc steps and treat the discovery question at step 7 as already answered by it, then read just that location at step 10. Without this option a user who already knows their target has to answer "search" here, sit through the install, and then answer the same question again four steps later, which is asking them to repeat themselves.
     - **C (an existing key to change)**: the keys are right there in the question, so a named key routes to the Modify phase with the target already settled, and Modify is told to skip both the search you just ran and its own which-function question when it arrives holding a key. Only a bare C leaves Modify to ask.

     **There is deliberately no "done, finish setup" option here.** The user invoked setup and nothing has been instrumented this session, so an exit offered as a peer of the two real options invites them to undo the thing they just asked for. A user who genuinely wants out says so in free text, which is the last of the runtime routes below; do not manufacture a menu item for it.

     Routes that are conditions rather than options:

   - **no existing SDK usage found**: continue → step 3
   - **the user says in free text that they are done and want no changes**: continue → step 1 of the Cleanup phase
   - **If usage routes through a project-local shim** (a wrapper file that re-exports `withSpan` / `@span` / `bitfab_span` / `getCurrentTrace` / `getCurrentSpan` with custom init, often named `lib/bitfab.*` or after a predecessor SDK such as `lib/simforge.*`), audit the shim before instrumenting anything new. The shim must (a) construct the SDK client (`new Bitfab(...)`, `bitfab_init()`, `Bitfab::Client.new`, etc.) at module load, **synchronously**, never lazily inside the wrapped function; and (b) hand off to the SDK call synchronously, with no `await` between the user's entry to the shim and `client.withSpan(...)` / `@bitfab.span(...)`. Lazy or async client init (e.g. `await getOrCreateTraceFunction(key)` inside the wrapped body) breaks the SDK's nesting context (TypeScript `AsyncLocalStorage`, Python `contextvars`) under any parallel fan-out (`Promise.all`, `Promise.allSettled`, `asyncio.gather`, parallel workers): every span becomes its own top-level trace instead of nesting inside its caller. Fix the shim before instrumenting anything new. (Direct callers of the SDK with no shim already satisfy this rule, skip the audit.)
   - If not found: **proceed to step 3**: no SDK usage does NOT mean nothing to instrument, it means the SDK hasn't been installed yet. NEVER conclude "nothing to instrument" before completing step 6.
3. Use the API key from the Login phase (or retrieve it now if already authenticated)
4. **Say one line before you install anything.** This is the deliberate exception to the "do not pre-announce" execution-style rule, and the only one in this phase: the next few steps install a package, write to the project's env files, and fetch docs, which is the wizard touching the user's repo before it has asked them a single thing about what they want traced. Name what happens now, and end the line with whatever comes next **on the route the user is actually on**, since step 7 only asks when nothing has settled it yet. Promising a question the flow then skips is worse than saying nothing:
   - **They named a target** at step 2: name it back ("Installing the SDK and setting your API key, then reading the SDK docs, then I'll instrument `<target>`"). This confirms you heard them and keeps the target in view across the install and the doc fetches, the stretch where a held answer is easiest to lose.
   - **They chose to search** there: say the scan is next ("...then I'll find the workflows worth tracing").
   - **Nothing settled yet** (this step was reached without that menu, because no existing SDK usage was found): promise the question ("...then I'll ask what you want to instrument").

   One line, nothing around it, then get on with it.

   **Install the SDK now.** Detect the project's package manager from its manifest (`pyproject.toml` → `uv`/`poetry`; `package.json` → `pnpm`/`npm`/`yarn`/`bun`; `Gemfile` → `bundle`; `go.mod` → `go get`; `requirements.txt` → edit file + `pip install -r`) and run its canonical add command, do NOT stop to ask about version pinning or dep groups. Prefer `uv add`/`poetry add` over bare `pip install` (bare `pip install` doesn't persist to pyproject.toml). In monorepos, scope to the correct workspace (e.g. `pnpm add --filter <pkg>`, or cd into the app directory first), running from the repo root will install into the wrong package. Default to a runtime dep for applications; a dev dep for libraries/SDKs where a runtime dep would propagate to downstream users. Then set the `BITFAB_API_KEY` environment variable.

   **Tell the user what you did.** Pick the env-handling approach that fits the project's existing convention. Whatever you do, surface it explicitly: name the file (with absolute path) or mechanism you used, so the user knows where the key now lives. Do not print the key value itself. If the key landed in a `.env`-style file, additionally tell the user that any already-running dev server, REPL, or test runner may need a restart to pick it up, since most file watchers reload code on save but not env files.
5. **Read the SDK reference.** Fetch the dense canonical reference page first (`/reference/typescript.md`, `/reference/python.md`, `/reference/ruby.md`, or `/reference/go.md`) for every signature, type, default, and error semantic you need (initialization, `withSpan` / `@span` / `bitfab_span` / `client.Span`, the subtree primitives `withTrace` / `trace` and `withNode` / `node` in TypeScript and Python, `getFunction` / `get_function` / `GetFunction` / `bitfab_function`, `SpanType`, `getCurrentSpan`/`getCurrentTrace`, `wrapBAML`/`wrap_baml`). **Ask the page for all three primitives by name, not just spans**: the fetch returns an answer to your prompt rather than the page, so a prompt about `withSpan`/`@span` alone comes back documenting spans alone, and you will instrument without ever learning that `trace` (a root that captures every first-party call beneath it, no decorators) and `node` (naming, typing, capture, and replay-mock policy for one call inside that subtree) exist. If step 1 detected a framework in this application directory, also fetch the matching framework page; it documents the handler/processor/wrapper the SDK exposes for that framework, which is usually preferable to hand-wrapping every node/agent call with `withSpan`/`@span`: LangGraph / LangChain → `/frameworks/langgraph.md` (`getLangGraphCallbackHandler` / `get_langgraph_callback_handler`; in a LangChain-only project, prefer the identical aliases `getLangChainCallbackHandler` / `get_langchain_callback_handler` so the code reads naturally; Experimental (alpha) tool replay: `getLangGraphIntegration` / `get_langgraph_integration` with `createInvoker` / `create_invoker` / `create_async_invoker`); OpenAI Agents SDK → `/frameworks/openai-agents.md` (`getOpenAiTracingProcessor` / `get_openai_tracing_processor`, plus the replayable run wrapper `getOpenAiAgentHandler` / `get_openai_agent_handler` (drop-in for the run call)); Claude Agent SDK → `/frameworks/claude-agent-sdk.md` (`getClaudeAgentHandler` / `get_claude_agent_handler`); BAML → `/frameworks/baml.md` (`wrapBAML` / `wrap_baml`); Vercel AI SDK → `/frameworks/vercel-ai-sdk.md` (`getVercelAiMiddleware`). Then fetch the language guide (`/typescript-sdk.md`, `/python-sdk.md`, `/ruby-sdk.md`, `/go-sdk.md`), including the Replay section for non-Go projects, for the install command, the multi-file project layout example, the BAML auto-instrumentation walkthrough, and the replay registry module template. Read the replay section upfront (not later) because step 14 reuses it to write the replay pipeline in the same cycle, and it should not re-fetch these pages. Fetch those pages (via web-fetch capability, in one batch since they are independent URLs, or ask the user to share them). **Do not improvise instrumentation from memory**: the API has moved and guessing will produce broken code.
6. **Instrumentation must produce a replayable trace. There are exactly two ways to get one: (1) the root span has serializable inputs, or (2) the workflow runs on a supported framework integration that records a replayable root (LangGraph / LangChain, OpenAI Agents SDK, Claude Agent SDK, or Vercel AI SDK), which captures the framework's own serializable input as the root. Establish one of these before writing any instrumentation. Trace-processor integrations (OpenAI Agents SDK) are a special case: the processor auto-captures the agent run, but on its own records a root span with an empty input (verified against a live run: the OpenAI Agents agent span is the root and carries no recorded input), so the processor ALONE is NOT replayable. Pair it with its run wrapper (`getOpenAiAgentHandler` / `get_openai_agent_handler`), a drop-in for the run call that opens a keyed root carrying the run input as a serializable argument, with the processor's spans nesting underneath, which turns it into case (1). A hand-written `withSpan`/`@span` root that takes the run input works too.**

   **The root exists so the replay harness can re-invoke it as a plain lambda with serialized inputs**: that's what makes traces searchable (a coherent unit of behavior) and replayable (runnable against current code). The root must own its state setup, not consume a pre-built stateful object the replay registry module can't reconstruct. Frameworks are the sharpest case (LangGraph compiled graphs, Claude Agent SDK clients, LangChain chains all require constructors + special setup), but the rule generalizes to anything stateful, configured SDK clients, prepared models, cached routers, DB sessions. For manually wrapped workflows, the root is therefore the outer workflow function that **builds** the framework / stateful object + invokes it + processes the output (API handler, message processor, job runner, pipeline coordinator), almost never the SDK's `run()` / `invoke()` itself. For callback-handler integrations that already record a replayable root (LangGraph / LangChain, Claude Agent SDK, or Vercel AI SDK), do not turn this into a mandatory manual outer span: the handler-created framework invocation root is enough when the production workflow is just the graph/chain/agent invocation. The replay callable is where you rebuild the framework/stateful object around the recorded root input. Add a same-key `withSpan`/`@span` outer root only when there is meaningful production work around the framework call (input prep, non-framework retrieval, post-processing, persistence, downstream service calls) that should be visible in the trace.

   **Wrap the code path that runs the real workload (serves traffic, processes the actual jobs), not an entrypoint that exists only to test or explore locally.** The test is role, not form: a cron-driven batch script or an ETL job is production and worth wrapping; a dev CLI or notebook that exists only to poke at the workflow is not. Instrument the real path even when you'll run it in dev to generate traces.

   **Hard constraint: every wrapped function's inputs and outputs must be serializable by the SDK's tracing layer so traces can be replayed.** Every span input and output gets serialized into the trace using the SDK's language-native serialization (TypeScript/JSON, Python/JSON via Pydantic, Ruby/`to_json`, Go/`json.Marshal`). If a wrapped function takes live runtime objects that don't round-trip through that serialization, the trace can't be replayed, and badly-failing inputs can drop the entire span on the floor (not just garble the input field). Examples of unserializable inputs:
   - browser objects (`MediaStream`, `RTCPeerConnection`, `WebSocket`, DOM refs)
   - HTTP `Request` / `Response`, stream writers, open sockets
   - framework request contexts whose content is genuinely opaque (not reconstructible from headers + user id)
   - **live SDK client instances passed as arguments** (LLM clients like `OpenAI` / `Anthropic` / Bedrock, configured agents, DB connection objects, HTTP agents): class instances whose internals carry circular references, function members, or platform handles all sink superjson and `JSON.stringify`. Watch especially for an options/config bag (e.g. `options.llmProvider`, `ctx.db`) that smuggles a live client into an otherwise-serializable signature.

   **Unserializable OUTPUTS (live streams) are a separate case from unserializable inputs, and in the TypeScript SDK they do NOT require a refactor.** A function whose inputs are serializable but which returns a live stream the caller consumes directly (a Vercel AI SDK `streamText` result, a `ReadableStream`, an SSE / streaming `Response`) is the common shape for chat and agent endpoints. Serializing that object as-is captures nothing replayable, and awaiting it to completion before returning would break streaming and first-byte latency. Record a drained, serializable view of the stream as the span output instead:
   - **TypeScript: use the `withSpan` `finalize` option** (`withSpan(key, { type, finalize }, fn)`). The wrapped function returns the live stream to the caller unchanged; the span records `await finalize(result)` (e.g. `{ text, usage, toolCalls }`). Pass the prebuilt `finalizers.aiSdk` for the Vercel AI SDK, or `finalizers.readableStream` for a raw `ReadableStream` (reading the AI SDK result's promises does not disturb the caller's stream, since it tees internally). This is **purely-additive instrumentation, NOT a refactor**: do it in the write-instrumentation step with no second confirmation. The trace stays replayable as long as the function's *inputs* are serializable. Never push the user into a structural rewrite of a streaming endpoint when `finalize` covers it.
   - **Python: also use the `finalize` option** (`@client.span(key, type=..., finalize=...)`). The idiomatic, non-destructive shape is an **async generator** that `yield`s its chunks (the caller still receives every chunk); `finalize` then receives the collected chunks and returns a serializable summary. Pass `finalizers.openai_chunks` for OpenAI streaming or `finalizers.anthropic_events` for Anthropic. Same rule: **purely-additive, NOT a refactor**, no second confirmation. (Python streams are single-consumer, so prefer the async-generator form over draining a returned stream object.)
   - **Ruby / Go (no `finalize` yet): introduce a serializable completion.** Trace a core that runs the turn to completion and returns `{ text, usage, ... }`, with the streaming wired around it (the structural refactor below).

   Module-level dependencies (DB clients, env vars, config loaders, LLM clients) do **not** count *when accessed via module scope or closure*: replay resolves them from the app's runtime wiring instead of serializing them as span inputs. The same client passed *as a function argument* IS captured as input and WILL fail. The fix when an SDK client is the only unserializable piece is usually trivial: hoist it to module scope (or capture via closure) and drop it from the argument list, leaving the wrapped function's serializable args (issue, request, options-without-the-client) intact. When the natural outer boundary still has unserializable inputs after that, do **one** of the following **before writing code**:
   - **Instrument via the framework handler or processor** (preferred whenever the workflow runs on a supported framework: LangGraph / LangChain via `getLangGraphCallbackHandler` / `get_langgraph_callback_handler`, OpenAI Agents SDK via `getOpenAiTracingProcessor` / `get_openai_tracing_processor`, Claude Agent SDK via `getClaudeAgentHandler` / `get_claude_agent_handler`, Vercel AI SDK via `getVercelAiMiddleware`). These split into two replayability cases, do not conflate them:
     - **Integrations that record a replayable root (LangGraph / LangChain, OpenAI Agents SDK, Claude Agent SDK, or Vercel AI SDK) are replayable as-is**, via one of two mechanisms. **Callback handlers** (LangGraph / LangChain, Claude Agent SDK, or Vercel AI SDK) record the framework invocation itself as the root span, with the framework's own serializable input (LangGraph initial state, agent prompt) as the recorded root input. **Trace processors** (OpenAI Agents SDK) don't record the input themselves, so their run wrapper (`getOpenAiAgentHandler` / `get_openai_agent_handler`) does it: a drop-in for the run call that records a keyed root carrying the run input, with the processor's auto-captured spans nesting underneath. Either way, the unserializable arguments above it (live dependency objects, billing callbacks, request contexts) never enter the trace, and no decorated root function needs to exist in the app code: the replay registry module passes the key to `replay()` with a plain callable that re-invokes the same framework entrypoint production calls with the recorded root input plus reconstructed runtime wiring (framework config and dependencies); the SDK wraps the callable internally. Unsafe calls made by that wiring still need replay-mockable marked spans; use no-op values only for replay-only callback slots with no recorded call to mock. On SDKs that predate explicit-key replay, wrap the callable under the same key yourself (Python `@bitfab.span("<key>")`, TS `getFunction(key).withSpan(...)`). The pattern is documented in the SDK docs' Replay section (handler subsection) and wired up in step 14 11b. Never report one of these workflows as "not replayable" because no `@span`-decorated function exists in production code.
     - **A bare trace processor (OpenAI Agents SDK) with neither its run wrapper nor a manual root is NOT replayable.** The processor captures the run, but its root span records an empty input (verified against a live run: the OpenAI Agents agent span is the root and carries no recorded input). Pair it with the run wrapper (`getOpenAiAgentHandler` / `get_openai_agent_handler`), the drop-in for the run call above, or a hand-written `withSpan`/`@span` root that takes the run input: the processor's auto-captured spans nest under that root, and replay runs against the root's serializable input. Do not treat a bare processor-only trace as replayable.
   - **Move the trace boundary inward** to the first function whose inputs are serializable (e.g. trace `processTurn(transcript, context)` instead of `handleSession(stream, peerConnection)`). This is not a refactor.
   - **Refactor** so a function with serializable inputs exists. Two flavors, chosen per case in the refactor plan:
     - **Visibility refactor (common)**: the logic that takes serializable inputs already exists inline but isn't importable (embedded in a route handler, not exported). Extract it into a named, exported function at module scope. No semantic change.
     - **Structural refactor (rare overall, mostly realtime/browser apps)**: no function with serializable inputs exists yet. Introduce one: a pure core whose parameters are serializable, with callers constructing them. A real rewrite. (This flavor is for missing serializable-*input* cores. A streaming *output* in the TypeScript and Python SDKs is handled by the `finalize` option above, not a structural refactor; only fall back here for streaming on Ruby/Go.)

   Raise this with the user in step 11 (not later); never instrument a root with unserializable inputs and try to fix it in the Replay phase.
7. **First, check for reusable draft plans.** Call `mcp__Bitfab__list_trace_plans` with `{ source: "analyze_repo", status: "awaiting" }` (it returns only this org's unconfirmed, non-expired `$bitfab:setup analyze-repo` drafts, newest first). This is a silent probe, do not narrate the call itself.

   **If drafts came back, print them for the user before asking, so they can choose which to wire up.** List every draft as a numbered item (this is the menu they will pick from in step 8), each showing enough to decide on, straight from the `mcp__Bitfab__list_trace_plans` output:
   - **root name** and its **trace function key**
   - the root **file**
   - **frameworks** detected in the plan (when any)
   - **recommended capture**: N of M nodes
   - how long ago it was drafted

   **Evaluate these two routes before you ask anything.** Step 2 may already have settled this question, and re-asking several steps and an SDK install later is asking the user to repeat themselves:

   - **the existing-SDK-usage menu already chose to search for more workflows, and the draft probe returned nothing**: skip the question and scan → step 9
   - **the existing-SDK-usage menu already named a target to instrument, and the draft probe returned nothing**: skip the question and read the named target → step 10

   **Awaiting drafts override both**, because they are new information the user has not seen: when the probe returns any, ask instead, and say in one line what their earlier answer was so the re-ask reads as an update rather than a memory lapse.

   When neither route fires, ask the user what to instrument:

   > A) **Reuse an analyze-repo draft plan**: only shown when drafts exist: pick from the printed drafts and wire them up one at a time *(recommended)* → step 8
   > B) **Find workflows for me**: scan the codebase for every AI call, agent, and LLM-driven decision → step 9
   > C) **I'll name the target**: type the file, function, or directory and I read only that, no codebase scan → step 10

   **Option C is a free-text option, not a promise of a second question.** Say in the question's own text that they can type the file, function, or directory instead of picking anything, so a user who already knows their target answers in the same breath and never sees a follow-up prompt. The scan (**B**) is the only option that spends real time, which is why it is worth a fork at all. **An answer that names a file, function, or directory IS option C**, whether it arrives as typed free text, as a note on a selection, or as the label plus a name: route it to C and take the name, never re-ask because no option came back selected.

   **Option A (reuse the drafts) is only present when `mcp__Bitfab__list_trace_plans` returned at least one draft.** When drafts exist, offer A first and recommend it, wiring up an existing draft is the whole point of having run `analyze-repo` first. **When there are no drafts, omit A entirely and present only the scan and point-to-target options** (the plain two-way choice, with no mention of trace plans); in that case recommend the scan option instead.

   If they pick **A**, go to step 8 to wire up the picked drafts (a draft is a starting point, not a commitment: it is still presented for review and can be adjusted or cancelled before any code is written). If they pick **B**, do the full codebase scan in step 9.

   **If they pick C, they have just told you they know what they want; the only thing you are missing is its name, and it usually arrives with the answer.** If they named it anywhere (the free text they typed on this question, their original invocation, or earlier in the session), take that and go straight to step 10. Only when C comes back bare, with no target named, do you **ask in plain chat and wait for their next message**, one line, e.g. "Which file, function, or directory should I instrument?". Do NOT turn it into an options question (the answer is free-form, and options would only stand between the user and typing it), and **do NOT read, grep, or list the codebase to assemble candidate targets to offer them**. Scanning for candidates is option B, the option they just declined, and a menu of the three roots you happened to find is worse than an empty prompt: the target they have in mind may not be on it, and offering it reads as ignoring their answer. Once they name it, go to step 10 to read just that location, skipping the broad scan.
8. You reached this step by choosing to reuse a saved trace plan: either option A at step 7 (the first pass) or the saved-plan option at step 16 (a later loop, after instrumenting something). Both arrive here to wire up drafts one at a time.

   **If you do not currently hold an unprocessed batch queue** (a fresh arrival from either step), **ask the user which of the awaiting drafts you just listed to instrument** (they may pick one or several) and hold the selected plan ids as an ordered **batch queue**. **If you already hold a queue with unprocessed drafts left** (you looped back here from a skip below), do not ask again, just take the next unprocessed draft. Process them **one at a time**, exactly like the discovery loop instruments one workflow per cycle, never several at once. **Only once a queue you were actively processing is fully consumed (every selected draft processed or skipped) do you leave to step 16** to pick the next move, never bounce back there without a fresh selection.

   **For the current draft, reconcile it against the CURRENT code, a draft is a snapshot from analyze-repo time and the code may have moved on** (a prior draft in this same batch, a manual wrap, or an earlier session may already have instrumented this workflow; the root may also have been renamed, moved, or deleted). Reconcile now, before you present or open the plan, so you never surface a plan the user can't act on: presenting a plan you're about to abandon (already instrumented, or stale) just wastes their time on a moot review.
   - Read the draft's tree with `mcp__Bitfab__get_trace_plan` `{ planId }` (this reads the draft without confirming it).
   - Read the plan's root file at its recorded `file`/`line`, and grep the root and captured-node locations for existing SDK instrumentation, the plan's own trace function key (`getFunction("<key>")` / `get_function` / `bitfab_function` / `WithFunctionName`) and span wrappers (`withSpan` / `@span` / `bitfab_span` / `client.Span`).
   - Cross-check the key against `mcp__Bitfab__list_trace_functions`: a key that already appears there is live and sending traces.
   - **While you are in these files, also Read every captured node's signature** (the plan carries `file`, `line`, `signature` on each node) and note the plan's replay dependencies (captured `external_read` / `side_effect` nodes), so that if this draft proceeds you carry into step 14 the same context a discovery cycle would have held (its mock / DB-snapshot follow-ups included), and steps 13 and 14 do not have to re-read the code.

   Then take the branch that matches what you found, **do not blindly wrap**: wrapping a root that is already instrumented would duplicate the trace, you would create a second root span over the same call and the workflow would report twice.

   > A) **Wire up this draft**: the normal case: present the draft, confirm it, then instrument *(recommended)* → step 13
   > B) **Already instrumented, retire the draft**: re-wrapping would duplicate the root span; cancel the draft, offer `setup modify`, move to the next draft → step 8
   > C) **Refresh this draft in place**: rebuild the tree from current code, save it onto the same plan id, then present it → step 13
   > D) **Workflow gone, retire the draft**: nothing left to instrument; cancel the draft and move to the next one → step 8

   **A** is the normal reuse case: it carries the existing draft plan id into step 13, which presents the already-built draft (no re-build) and opens/confirms it exactly like a freshly built plan.

   **C** repairs the draft instead of throwing it away. The workflow still exists, the draft just describes where it used to be, so rebuild its tree from the current code (the same reconcile rules `$bitfab:setup modify` uses: keep a node's id, samples, and analysis where its implementation identity is clear, mint new ids for genuinely new nodes, and backfill `sampleInput` / `sampleOutput` / `analysis` on anything you added or changed), then save it back onto the SAME draft with `mcp__Bitfab__save_trace_plan` `{ planId, tree, capturedNodeIds }`. A structural update may replace `tree.rootId`, so a moved or renamed boundary is a refresh, not a reason for a second plan. Carry that same plan id and your refreshed tree into step 13. Say in one line what moved. Never leave a stale draft in the reuse list for a later session to pick up, and never create a competing plan for a key that already has one.

   **B** and **D** retire this draft with `mcp__Bitfab__cancel_trace_plan` and loop back here for the next queued draft, so a moot draft never reaches the user and never resurfaces in a later probe. Cancelling is final, which is right here precisely because there is nothing left to wire up. For **B**, say the workflow is already set up and that you retired the draft, then offer `$bitfab:setup modify <key>` to change what it captures (or `$bitfab:assistant` to iterate on its quality); Modify rebuilds the plan from the live code, so retiring the draft costs the user nothing. For **D**, say the workflow the draft described no longer exists and that you retired the draft.
9. Read the codebase to identify ALL AI workflows, every place the app makes LLM calls, runs agents, or makes AI-driven decisions. For each, find the **outer workflow boundary** (per the rule in step 6), and also note any meaningful work **above** the agent/LLM call (auth, validation, input prep, retry/orchestration loops, multi-agent coordination), **alongside** it (custom LLM calls outside the SDK, tools that aren't registered with the SDK, downstream services), and **below** it (post-processing, parsing, persistence). These are the manual spans that will sit around any auto-captured SDK content.
10. The user named a specific file, function, or directory to instrument. Read just that location and its immediate surroundings, do NOT scan the rest of the codebase. Find the **outer workflow boundary** there (per the rule in step 6), and note the meaningful work **above** the agent/LLM call (auth, validation, input prep, retry/orchestration loops, multi-agent coordination), **alongside** it (custom LLM calls outside the SDK, tools that aren't registered with the SDK, downstream services), and **below** it (post-processing, parsing, persistence). These are the manual spans that will sit around any auto-captured SDK content. If the location holds more than one distinct AI workflow, note each.
11. Present a numbered list of workflows found, ordered by value (most complex or LLM-heavy first). For each, give:
   - **Trace boundary**: the outer workflow function that will be the trace function root (per step 6, NOT the SDK/agent call itself)
   - **Inputs**: the shape of the function's inputs, and an explicit note that they're serializable by the SDK's tracing layer. If the natural outer boundary's inputs are unserializable (live browser/runtime objects, HTTP req/res, stream writers, sockets, opaque request contexts, live dependency/billing objects), state that here and present the three resolutions from step 6 as part of this workflow's entry: **(a) instrument via the framework handler/processor** (recommended when the workflow runs on LangGraph / LangChain, OpenAI Agents SDK, Claude Agent SDK, or Vercel AI SDK; for callback handlers, the handler-recorded root stays replayable by passing the key to `replay()` with a callable that invokes the same production framework entrypoint, using a same-key wrapper only on SDKs that predate explicit-key replay; for trace processors, OpenAI Agents SDK, use the run wrapper (`getOpenAiAgentHandler` / `get_openai_agent_handler`) in place of the run call so it records a replayable keyed root that takes the run input; a bare processor over plain `run()` records an empty-input root and is not replayable on its own), **(b) move the boundary inward to `<specific inner function with serializable inputs>`** (recommended when no framework handler applies and an obvious candidate exists; not a refactor), or **(c) refactor**. Do not proceed to step 12 until the user picks one, never instrument an unserializable root. **If the user picks (c), present a refactor plan, labeled as *visibility* (extract + export, logic unchanged) or *structural* (new pure-core fn), and get an explicit second confirmation before modifying code. See the "Refactor confirmation" rule below.**
   - **Output**: if the boundary returns a live stream (Vercel AI SDK `streamText` result, a `ReadableStream`, an SSE / streaming `Response`), note it here. In the **TypeScript and Python SDKs this is NOT a refactor**: instrument with the `finalize` option (TS `withSpan(key, { finalize }, fn)` with `finalizers.aiSdk` / `finalizers.readableStream`; Python `@client.span(key, finalize=...)` over an async generator with `finalizers.openai_chunks` / `finalizers.anthropic_events`), which records a serializable view while the live stream still reaches the caller (per step 6). Present it as the plan, do not offer a structural rewrite for a streaming output when `finalize` covers it. On Ruby/Go, fall back to a serializable run-to-completion core.
   - **Replay dependencies**: the external state and side-effecting dependencies the function touches that replay will have to deal with, walk what the boundary and its captured children call into: database reads, third-party APIs, queues, blob/file storage, clocks/RNG, stream writers, request/session/billing objects. Two follow-ups come out of this list, both wired up in step 14:
     - **Replay safety**: every unsafe external action (database write, outbound mutation, queue publish, email, payment, or similar) must be a mockable descendant selected for recorded-output mocking, whether or not the dependency exists at replay time. Verify it executes in the replay root's context: Python worker-thread dispatch requires `Bitfab(trace_across_threads=True)`; Ruby child threads, pre-created consumers, and other processes do not inherit replay interception, so move the unsafe boundary into the replay context. For TypeScript, note any synchronous unsafe span because lazy `mock: "marked"` cannot substitute it; the replay registry module must use `mock: "all"` only when freezing every matched child is acceptable, otherwise the existing boundary must already return a Promise or the workflow is not safely replayable without a behavior-changing refactor. Separately, list runtime values the replay callable must synthesize because no value exists to pass (stream writers, request/session objects, sockets, or replay-only callback slots); these are wiring, not the replay safety boundary.
     - **Database snapshotting**: if the function **reads stored state from the database** (anything where the answer depends on the rows as they were at trace time, a decision over an order/account/document, a retrieval step), plain replay runs against *today's* data and is misleading. Flag it here and recommend `$bitfab:setup db-snapshot` (TypeScript, Python, Ruby) so replay runs against the per-trace DB branch instead. If the function only writes, or never touches the DB, say so and skip it.
   - **What's covered end-to-end**: the work above, alongside, and below any agent/LLM/SDK call that this trace will capture (be specific: list the orchestration, custom LLM calls, tools, downstream services that will become spans)
   - **Why tracing it is valuable**

   The description must commit to the actual scope. If the plan will only auto-capture an SDK's internals, say so explicitly, do NOT use language like "complete tracing of X workflow" when the trace will only cover an SDK call's internals.

   Recommend one to start with. **Ask the user to pick exactly ONE workflow to instrument first.** Never accept "multiple" or "all", instrumenting one workflow produces exactly one trace function with one trace plan and one set of code changes. If the user wants to instrument several, they will be done sequentially via the loop in step 16, one at a time.
12. **Read function signatures you'll reference in the trace plan**: root function first, then any whose parameter names or return fields aren't already obvious from the discovery read (the step 9 scan, or the targeted step 10 read on the point-to-it path). Skipped leaf functions only need their names; don't Read them unless their shape appears in the plan. Never guess names. See "Trace Plan Format" and "Trace Plan Accuracy" in the Reference section below.
13. **🚨 A trace plan is always delivered the same way: build the tree in memory, post it with `mcp__Bitfab__save_trace_plan`, render it inline as ASCII (using the "Trace Plan Format" reference section below), then ask the user whether the user wants to review it in the browser (Studio) or just continue.** When the user says "create a trace plan", "give me the trace plan", "show me the trace plan", or "bitfab create a plan", that is a request to run this save-plan → render-ASCII → ask path, never a request to skip past the plan or to hand-type a plan you made up outside this flow. The inline ASCII IS the plan the user reviews in chat; Studio is an optional richer surface for reviewing and adjusting the captured set, offered every time but never forced. Build the tree in memory first, then call `mcp__Bitfab__save_trace_plan`, then render.

   **Reuse entry (analyze-repo draft):** if you reached this step from step 8, the plan already exists, you hold its plan id, and you hold its tree: the stored one you read there with `mcp__Bitfab__get_trace_plan` (branch **A**), or the refreshed one you rebuilt and already saved onto that same plan id (branch **C**). Either way, **do NOT create a plan here**, and skip the replayability requirement and every tree-construction bullet below: analyze-repo already built and classified the draft, and reconcile already checked it against the current code. Go straight to the "**Render the trace plan inline as ASCII**" bullet using that plan id and tree, then present and confirm it (Continue → `mcp__Bitfab__confirm_trace_plan` the plan id; View in browser → node "${BITFAB_PLUGIN_DIR}/dist/commands/openTracePlan.js" the plan id) exactly as for a freshly built plan. Everything from that bullet on is shared, including the revise path: a change the user asks for here is another `mcp__Bitfab__save_trace_plan` with the same `planId`, never a second plan.

   **🚨 Replayability requirement: verify the root is replayable BEFORE you construct the tree (non-Go projects).** The root you pick becomes the trace function that replay re-invokes with its serialized recorded input, so a plan rooted on an unserializable boundary is a plan the user accepts and then has to unwind into a refactor. That is the failure this requirement exists to prevent: never create such a plan in the first place. Do not build the `TracePlanTree` (and do not call `mcp__Bitfab__save_trace_plan`) until the root you'll actually instrument clears one of these two cases:
   - **(1) Serializable input.** The root's own parameters round-trip through the SDK's tracing serializer (TypeScript/JSON, Python/JSON via Pydantic, Ruby/`to_json`, Go/`json.Marshal`). Re-check every argument against the unserializable list in step 6 (live SDK client instances, HTTP `Request`/`Response`, stream writers, sockets, opaque framework request contexts, an options/config bag smuggling a live client). A single live-client argument does NOT satisfy it: hoist it to module scope or capture it via closure and drop it from the signature first, then re-check the remaining args.
   - **(2) Replayable-root handler/processor.** The workflow runs on a callback handler that records a replayable framework-invocation root (LangGraph / LangChain, Claude Agent SDK, or Vercel AI SDK), OR a trace processor paired with its run wrapper (`getOpenAiAgentHandler` / `get_openai_agent_handler`) that records a keyed root carrying the serializable run input. A bare processor over plain `run()` records an empty-input root and does NOT satisfy it.

   If the chosen root clears neither, **STOP, do not build or post the plan.** Return to step 11 and resolve it there first: **(a)** instrument via the framework handler/processor, **(b)** move the boundary inward to the first function whose inputs are serializable (not a refactor), or **(c)** refactor, after presenting the plan and getting an explicit yes (see the "Refactor confirmation" rules below). Only build and post the tree once the root is replayable under (1) or (2). The sole exception is a root the user has EXPLICITLY accepted as observe-only / non-replayable for this workflow; absent that explicit acceptance, an unserializable root is never a plan you create. (Go-only projects don't support replay, so this requirement doesn't apply, skip it.)

   **Build the trace plan under a hard constraint: the resulting instrumentation must be purely additive.** If a candidate tree requires *any* behavior change to make spans nest correctly (awaiting a stream that wasn't awaited, delaying a call, reordering operations, blocking a callback, restructuring control flow), the tree is invalid, restructure the *tree* instead (make spans siblings, split into separate trace functions across separate cycles, or accept a flatter shape). Never present a behavior-changing approach as an option, not even as a non-recommended alternative.

   **For callback-handler SDKs (LangGraph / LangChain, Claude Agent SDK, or Vercel AI SDK), do not add a manual outer root by default.** The handler records a replayable framework invocation root and auto-captures the framework subtree. If the workflow is only the graph/chain/agent invocation, build a handler-only plan: root = the framework invocation `(agent)`, children = `[auto]` framework spans. If there is meaningful production work around the framework call (input prep, non-framework retrieval, post-processing, persistence, downstream service calls), use a hybrid plan with a same-key `withSpan`/`@span` outer root and show the handler-captured subtree beneath it. Never wrap individual framework-managed nodes/tools/retrievers/model calls just to make them visible; the callback handler already captures them.

   **For trace processor SDKs (OpenAI Agents SDK, etc.), extend beyond the processor.** The processor only auto-captures what runs *inside* the SDK's instrumented call (LLM calls, tool calls, handoffs). Everything above it (orchestration, retries, input prep), alongside it (non-SDK LLM calls, unregistered tools, downstream services), and below it (post-processing, persistence) is invisible unless you add manual spans. Default to a **hybrid plan**: trace function root wraps the workflow with manual `●` spans, the SDK call appears as one `(agent)` child whose grandchildren are `[auto]` lines, and other manual spans capture the work around it. A bare auto-only plan (root = the SDK call, no surrounding manual spans) is only valid when the workflow truly is just the SDK call with no surrounding work, confirm there's nothing meaningful above/alongside/below before defaulting to it. **Even then, route the bare call through the run wrapper (`getOpenAiAgentHandler` / `get_openai_agent_handler`) instead of plain `run()`: it records a replayable keyed root carrying the run input with the processor's spans nested underneath. A bare auto-only plan over plain `run()` records an empty-input root and is NOT replayable, which conflicts with the serializable-inputs requirement in step 6: fall back to it only when the user has explicitly accepted an observable-only trace. Whenever there is surrounding work, use the hybrid plan with a `withSpan`/`@span` root that takes the run input.**

   **One flow = one trace function key.** When an outer `@bitfab.span` / `withSpan` / `bitfab_span` and a framework handler wrap the same work (LangGraph / LangChain `get_langgraph_callback_handler`, OpenAI Agents SDK `get_openai_agent_handler`, Claude Agent SDK `get_claude_agent_handler`, Vercel AI SDK `getVercelAiMiddleware`), pass the **same key** to both, a second key splits one flow into two overlapping trace functions. Separate trace functions describe separate flows with their own standalone roots, never a sub-range of an outer flow.

   Then post the plan via `mcp__Bitfab__save_trace_plan`, render it inline as ASCII, and offer Studio as an optional review surface (the render-and-ask sequence is spelled out at the bottom of this step).

   - Build a `TracePlanTree` (`{ rootId, nodes: { [id]: TraceNode } }`) from the same span tree you'd otherwise render. Each `TraceNode` carries `id` (stable, e.g. hash of `file:line:name`), `name`, `kind` ("manual" | "auto" | "pure"), `file`, `line`, `signature`, `parentId`, `childIds`, plus `framework` (for `[auto]` lines).
   - **Every captured node MUST include `sampleInput` and `sampleOutput`.** Without samples the confirmation page can't show the user what gets captured, which is the whole point. Construct realistic example values from the function's parameter and return types (Read the file and its return-type imports if needed); for SDK calls (`openai.chat.completions.create`, `generateText`, `cohere.rerank`, etc.) use the documented response shape. Do NOT call `save_trace_plan` with a captured node missing either field.
   - **Every node in the `TracePlanTree` carries an `analysis` describing what that node DOES**, including uncaptured surrounding context nodes. `analysis` is `{ classification, innerCall?, sideEffectKind?, readKind?, inputSerializable?, outputSerializable? }` with `classification` one of `pure` | `model_call` | `external_read` | `side_effect`. **Never leave a tree node unclassified**; the user may toggle any context node into the captured set in the UI, and it must already have a replay decision. You classify; the server derives `mockOnReplay` and the summary from it, so do NOT send them. The idea: mockable `external_read` and `side_effect` nodes serve their recorded output by default so replay isolates the external world; `model_call` and `pure` nodes re-run live by default, because improving LLM behavior is the point. The server suppresses that default mock for a broad external parent when mocking it would skip live descendants, so prefer the smallest span that actually crosses the DB/HTTP/write boundary.
     - **Classify each node by its OWN body** (Read the body, don't guess from the name, a `processOrder` that charges a card reads "pure" from its name and is anything but), **excluding work already represented by child nodes in the tree.** A wrapper or orchestrator whose model call / read / write lives in a child is itself `pure`, that behavior belongs to the child, so never bubble it up to the parent or root. (An external call sitting **inline** with no child node of its own belongs to the enclosing node.) Prefer small leaf-like external boundaries: if a read/write wrapper contains parsing, ranking, prompt construction, model calls, or other code that should re-run, put the `external_read` / `side_effect` on the lower DB/HTTP/write call, not the wrapper.
     - **Decision procedure per node (first match wins):**
       1. **IS the model call**, the LLM invocation itself: an auto leaf (`openai.chat.completions.create`, a `ChatOpenAI` span) or a model call inline in this body → `model_call`. A chain `.invoke`, a graph node, or an orchestrator whose model call is represented by a child node is `pure`, not `model_call` (a `kind: "auto"` / `framework` tag alone does not make a span a model call; don't bubble a child's `model_call` up).
       2. **Own body mutates external state** (DB write, outbound `POST/PUT/PATCH/DELETE`, queue, email, payment charge, file or vector write) → `side_effect` + `sideEffectKind` (`db_write` | `http_outbound` | `queue` | `email` | `filesystem` | `vector_write`). Defaults to recorded-output mocking when the span is mockable; **wins over `model_call`** when one span does both.
       3. **Own body reads external mutable state** (DB `SELECT`, outbound `GET`, vector search, cache read) → `external_read` + `readKind` (`db_read` | `http_read` | `vector_search` | `cache_read` | `filesystem_read`).
       4. **Otherwise** → `pure` (local compute: parsing, formatting, prompt construction, in-memory mutation, orchestration).
     - **Invariant: a `model_call` is the leaf that issues the request, never a wrapper around one.** No `model_call` may have a `model_call` ancestor or descendant in the captured tree. The real model call is the single auto leaf that hits the API (`openai.chat.completions.create`, `messages.create`, a `ChatOpenAI` / `ChatAnthropic` span); every span above it (the chain `.invoke`, the LangGraph or agent node, your `outline()` / `summary()` wrapper) is `pure`, even when the framework labels it an LLM, chat, or chain span. After classifying, scan each parent-to-child line: if two `model_call`s sit on it, the upper one is wrong, demote it to `pure`. Nested `model_call`s are always a bug.
     - **Worked example (LangChain LCEL, the shape agents most often get wrong).** App code: `outline_chain = prompt | model | parser` and `def write_brief(topic): pts = outline_chain.invoke({...}); summary = summary_chain.invoke({...}); return ...`. The callback handler auto-captures each chain's run tree, so a `ChatOpenAI` leaf span exists under each `chain.invoke`. **Capture that `ChatOpenAI` leaf** so `model_call` has a home. **Correct plan:** `write_brief` → `pure` (its own body only orchestrates chains; the model call lives in captured descendants), each `outline_chain.invoke` / `summary_chain.invoke` (RunnableSequence) → `pure` (wrapper), each `ChatOpenAI` leaf → `model_call` + `mockable: false` (`kind: "auto"`). **WRONG (the exact mistakes to avoid):** tagging `write_brief` or a `chain.invoke` as `model_call` (that is the nested-`model_call` bug), or leaving the `ChatOpenAI` leaf `mockable` (it is auto/observed).
     - **Then set `mockable` from the wrapper kind and execution context:**
       - `kind: "manual"` (a `withSpan` / `@span` you will hand-write) → mockable only when the call remains a descendant in the same replay context. Python thread pools / `threading.Thread` require `Bitfab(trace_across_threads=True)`; Ruby child threads, pre-created consumers, and other processes do not inherit replay interception. Move the boundary into the replay context or set `mockable: false` with the dispatch reason. **Python async-generator exception:** an async-generator `@span` cannot be mocked or overridden and must be marked `mockable: false`; move every unsafe operation inside it to a mockable sync or coroutine descendant before replay. **TypeScript synchronous-span exception:** a selected synchronous span cannot consume the lazy output used by `mock: "marked"`; record that the replay pipeline requires `mock: "all"` when freezing every matched child is acceptable, otherwise set `mockable: false` unless the existing boundary already returns a Promise. Never make a production function async just for replay.
       - `kind: "auto"` (captured by a framework handler / processor / stream / collector) → **`mockable: false`** + `unmockableReason` (`"<framework> spans are observed by instrumentation, not wrapped; replay re-runs them and cannot return the recorded output"`). **Exceptions:** Vercel AI SDK model spans run through `withSpan`; LangGraph `ToolNode` tool spans configured through the Experimental (alpha) `getLangGraphIntegration` / `get_langgraph_integration` integration run through an integration-managed replay boundary. Both are mockable, so omit `mockable`. Callback-only LangGraph tool spans remain unmockable.
       - the **root** → omit (never mockable; it starts the replay).
       Why (one line, you don't re-derive it per node): mocking returns a span's recorded output *instead of* running the call, which only works when the call goes through a `withSpan` wrapper; `auto` framework spans are observed, not wrapped. Authoritative per-framework lookup:
   - **LangGraph / LangChain**: model-call and tool / retriever / read / side-effect spans are observed via its callback handler, so they are NOT mockable; ToolNode tool spans configured through its Experimental (alpha) `getLangGraphIntegration` / `get_langgraph_integration` integration ARE mockable; callback-only tool spans remain NOT mockable.
   - **OpenAI Agents SDK**: model-call and tool / retriever / read / side-effect spans are observed via its tracing processor, so they are NOT mockable.
   - **Claude Agent SDK**: model-call and tool / retriever / read / side-effect spans are observed via its handler, so they are NOT mockable.
   - **BAML**: model-call spans are observed via its wrapper, so they are NOT mockable.
   - **Vercel AI SDK**: model-call spans run through `withSpan` via its middleware, so they ARE mockable (though re-run live by default).
     - **Serializability, two facts separate from `mockable`.** Set `outputSerializable: false` when the recorded OUTPUT doesn't round-trip through serialization, and `inputSerializable: false` when the recorded INPUT doesn't (an argument is a DB client, an open stream, a callback, or a class instance with no JSON form); omit either when it serializes. Two rules the server enforces from these: it forces any `outputSerializable: false` node **unmockable** (replay has no recorded value to return), so **don't mock a node whose output isn't serializable**; and it flags the plan **not replayable** when the root's input isn't serializable, so **don't choose a root whose input isn't serializable**, promote the root to a caller that takes the serializable request / prompt / messages instead. Hazard the mechanical `mockable` rule above prevents: an `auto` `external_read` / `side_effect` (a framework tool hitting a DB / HTTP) left mockable promises a mock replay can't deliver; its real fix is a manual `withSpan` around that call (move the boundary) or a db-snapshot.
     - Set `innerCall: { name }` on a `model_call` / `external_read` / `side_effect`. **Don't compute `mockOnReplay`**: the server defaults it to `true` for mockable `external_read` and `side_effect` nodes, except broad external parents with live descendants, and to `false` for `model_call` and `pure` nodes. Read the per-node mock decisions back from `mcp__Bitfab__get_trace_plan` after the user confirms.
   - **Include surrounding code as `pure` context nodes** so the captured set is legible inside its codebase context and the user can toggle additional nodes into the capture directly in the UI without leaving the page. The test for inclusion is **"would the user plausibly want this as its own span?"**: anything they might wrap as a deeper child of what is already captured, or add as a peer at the same depth. Walk in two directions:
     - **~10 callees below each leaf**: candidates for **wrapping deeper spans**. For every captured leaf, walk downward (callees of that leaf, callees of those, etc.) and attach each as a `pure` descendant. Include any callee the user might plausibly want as its own span, LLM / tool / agent calls, prompt construction, response parsing, retry loops, fan-outs, post-processing that drives another model. Stop at pure plumbing (pass-through returns, trivial formatting or arithmetic, no further interesting activity) or ~10 nodes per leaf. **Don't stop just because you crossed an SDK / framework / stdlib boundary**: the test is "is this plausibly its own span?", not "is this in our code?".
     - **~5 siblings per captured node BELOW the root**: candidates for **peer spans at the same depth**. For each captured node whose parent is the root or a descendant of it, include that parent's other callees (other functions invoked from the same wrapper) as `pure` siblings. These are the nodes the user might wrap alongside the existing capture to widen the trace sideways. **Don't generate siblings for the root**: a sibling of the root is by definition a child of the root's parent, which sits above the root and can never render. This removes nothing from under the root, the root's other callees still arrive as siblings of its captured children.
     - **Every context node MUST be a descendant of the root.** The plan tree renders downward from `rootId`, so a node above the root, or on a side branch hanging off one of those ancestors, is stored and counted but never drawn. Do not attach callers of the root, and do not attach the root's own siblings.
     All surrounding nodes get `kind: "pure"` and are **not** included in `capturedNodeIds`, but they still carry `analysis` under the same decision procedure as captured nodes. They serve two ends: **legibility** (the captured set sits inside its surrounding code so the user sees what is and isn't traced) and **modification** (they are the levers in the UI for expanding capture deeper).
   - **First check whether this key already has a plan.** Probe `mcp__Bitfab__list_trace_plans` with `{ traceFunctionKey: "<the key you are about to use>", status: "awaiting" }` (silent, don't narrate it). A key can already hold an unconfirmed plan the user never wired up (an `$bitfab:setup analyze-repo` draft they didn't pick, or an earlier cycle they abandoned), and `get_trace_plan` by key would not show it because it answers only for confirmed plans. **If one comes back, save onto it** with `{ planId, tree, capturedNodeIds }` instead of creating, and say in one line that you refreshed the existing plan. **If several come back, save onto the newest and retire the older ones with `mcp__Bitfab__cancel_trace_plan`**, so the key is left holding exactly one plan rather than the pile a pre-rule run left behind. Only create when the probe is empty. (A *confirmed* plan for the key is different: leave it alone, it records what the code captures today, and changing an instrumented function's capture is `$bitfab:setup modify`, not Instrument.)
   - **Only when that probe came back empty**, create the plan: call `mcp__Bitfab__save_trace_plan` with `{ language, tree, capturedNodeIds, traceFunctionKey }` (and `stats` if you have a sample run). **These two bullets are one decision, not two steps: a run that saved onto an existing plan above has already posted this plan and must NOT also create one**, or the key ends up with the rival this probe exists to prevent. Everything below about the tree applies either way. `capturedNodeIds` is your initial recommendation, must form a connected sub-tree (selecting any descendant implies its ancestors). `traceFunctionKey` is the key you'll pass to `getFunction` / `get_function` / `bitfab_function` / `WithFunctionName` in step 14; persisting it lets future Modify cycles recover stable node ids, samples, and confirmed capture intent via `get_trace_plan({ traceFunctionKey })` before reconciling that snapshot with current code. The server derives the plan's validation card (status pill + aggregate counts) from the per-node `analysis`, so you don't send a summary. The tool returns a plan id (and a `https://bitfab.ai/studio/trace-plan/<id>` URL).
   - **Render the trace plan inline as ASCII** using the "Trace Plan Format" reference section below (legend → grammar → template precedence → canonical example; default view unless the user asked to expand). This is the plan the user reviews in chat. Include the `Files changed:` footer as usual.

   - **Then ask the user** what they want to do next:
     - **Open trace plan** (recommended), open the plan in Studio, the richer surface where they can toggle the captured set.
     - **Continue instrumenting**, accept the plan as rendered inline and go straight to writing instrumentation, no Studio round-trip.
     (If the user instead asks to "expand" (add `○` skipped lines), "adjust", or otherwise change the plan, rebuild the tree and **revise the plan you already saved**: call `mcp__Bitfab__save_trace_plan` again with `{ planId, tree, capturedNodeIds }`, the same id it returned above. Then re-render the ASCII and ask again. **Never call `mcp__Bitfab__save_trace_plan` without `planId` for a plan you are revising**, that leaves a competing plan for the same key behind, and the one the user reviews may not be the one a later `$bitfab:setup view` or `$bitfab:setup modify` finds.)

   - **If they pick Continue instrumenting:** call `mcp__Bitfab__confirm_trace_plan` with the plan id from the `mcp__Bitfab__save_trace_plan` bullet above and your recommended `capturedNodeIds`. This persists the plan as *confirmed* (Studio's Close/Update button does this on the browser path; the continue path MUST do it here, otherwise the plan stays unconfirmed and a later `$bitfab:setup view` or `$bitfab:setup modify` for this key returns "no prior confirmed trace plan" even though setup succeeded). It returns the authoritative `capturedNodeIds` and per-node mock decisions, just like `mcp__Bitfab__get_trace_plan`, read those and proceed to step 14 using that captured set as-is. Every node should already be classified; if a captured node somehow lacks `analysis`, classify it now with the decision procedure above before instrumenting, never wrap a captured span without a mock decision.

   - **If they pick Open trace plan:** open the plan by running:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/openTracePlan.js" <planId>
   ```

   (`${BITFAB_PLUGIN_DIR}` resolves to the plugin directory; `<planId>` is the id returned by `mcp__Bitfab__save_trace_plan`.) The script navigates Studio to the trace plan page and stays alive until the user leaves that page (up to 30 minutes). Studio offers one button there: **Close** (leave the plan exactly as you drafted it) or **Save** (leave, saving the capture and mock toggles they made). **Nothing on that page is an abort:** Close, Update, and closing the window all mean "keep going", and none of them is a request for another round of plan edits.

   **Never wait on this command in the foreground.** Launch it as a background / long-running process, tell the user in one line that the plan is open and that **Close** or **Save** in Studio carries straight on into instrumentation, then ask the user: a single yes/no question, **"Continue instrumenting?"**, with **Continue** (recommended) and **Not yet**. **Say in the question's own text that Close or Update in Studio finishes it too, and that this question stays on screen the whole time they are over there, so coming back and picking either option is safe: what they saved in Studio is what gets instrumented.** Nothing can take the question down from outside the terminal, so an unexplained leftover prompt is the confusing part to pre-empt. It is a confirm, not a fork, the second option exists only because the ask tool requires at least two; free text is always available to the user on top of them, and anything they type there (e.g. "use a different root") is a change request, so treat it as one. Waiting is never an option, it is what the question sitting on screen already does.

   **🚨 When the question returns, read the background process's stdout BEFORE acting on the answer.** A terminal line that already landed means the user acted in Studio, and it always wins: they clicked Close or Update and then cleared the leftover question on their way back to the terminal. Acting on the answer first would send your own recommended `capturedNodeIds` to `mcp__Bitfab__confirm_trace_plan`, which the server rejects once the plan is confirmed ("Trace plan is confirmed, not awaiting"), and would leave you instrumenting that set while the stored plan holds the one they saved with **Save**: the code and the plan disagree, and the next Modify cycle bootstraps from the plan. Route on what you find:

   **Polling (mandatory, see the Blocking-process rule at the top of this skill):** keep polling the live exec session for its terminal line; the user's Close/Update arrives as stdout on the already-running process, not as a chat message.

     - **A terminal line already arrived** (`confirmed` or `cancelled`): ignore the answer entirely and route on the event, per the lines below. A user who clicked Close or Update and then cleared the leftover question has already decided.
     - **Nothing yet, and they picked Continue:** close the trace plan for them by running `node "${BITFAB_PLUGIN_DIR}/dist/commands/openStudioTo.js" "/studio"` (this navigates Studio off the plan page in place; never use `node "${BITFAB_PLUGIN_DIR}/dist/commands/closeStudio.js"` for this, the Studio tab stays open), stop the background `openTracePlan` process, then call `mcp__Bitfab__confirm_trace_plan` with the plan id and your recommended `capturedNodeIds` and go to step 14 with the set it returns. **If that call reports the plan is no longer awaiting, they saved in Studio in the moment between your read and your write:** call `mcp__Bitfab__get_trace_plan` and instrument the set it returns instead, never your own. A capture the user saved always outranks your recommendation, whichever order the two arrived in.
     - **Nothing yet, and they picked Not yet:** say nothing further and keep reading the background process until it exits, then route on its terminal line. Do not re-ask. If the user types "continue" (or anything equivalent) before the process exits, take the Continue route above: **the user must always be able to finish without touching Studio.**
     - **Nothing yet, and they typed a change instead:** **leave Studio open and leave the background process running.** Rebuild the tree and revise the plan in place: call `mcp__Bitfab__save_trace_plan` with `{ planId, tree, capturedNodeIds }`, the same id you opened. The plan page re-renders on its own when the update lands, so the user watches their open plan change instead of losing the window, and the reader keeps waiting on the same plan. Re-render the ASCII inline and ask again. **Never create a second plan here**: an update keeps one plan per trace function key, where a fresh `mcp__Bitfab__save_trace_plan` without `planId` would leave the abandoned one to expire and could confirm the wrong one.
     - The script emits JSONL to stdout. If it emits `{"event":"window-open-requested","url":"..."}`, immediately surface the URL in a normal chat message, e.g. `Opening Studio: <url>. Click it if a window doesn't appear`, before continuing to read. (This event means the open was *requested*, not that a window is confirmed on screen; the link is the reliable fallback when nothing surfaces.) `{"event":"session-ready","sessionId":"<uuid>"}` appears once the Studio session is established (on a logged-out run, an `{"event":"auth-required",...}` then `{"event":"authenticated",...}` line precede it while the user signs in, keep waiting for `session-ready`). On exit, parse the final JSON line:
       - `{"event":"confirmed","planId":"<uuid>"}`, the user clicked **Close** or **Save**. Continue instrumenting, this is not a request to revise the plan. The `planId` is normally the one you opened, because a revision updates that plan in place; it differs only when something created a new plan mid-session, and the script then auto-tracks the latest via `tracePlan:created` events. Either way, call `mcp__Bitfab__get_trace_plan` with the `planId` the event carries to read the authoritative `capturedNodeIds` for step 14. If it differs from your initial recommendation (they clicked **Save**), prune `[auto]` lines whose ancestor manual span was uncaptured, and drop manual `●` wraps that aren't in the set. Every node should already be classified; if a confirmed captured node somehow lacks `analysis`, classify it now with the same decision procedure before instrumenting, never wrap a captured span without a mock decision (the UI renders an unclassified captured node as plain "runs live", which would silently let a side effect fire).
       - `{"event":"cancelled","planId":"<uuid>"}`, the user left the plan page some other way (closed the Studio window, or released a plan that had expired). **Treat this as continue, not as an abort:** call `mcp__Bitfab__confirm_trace_plan` with the plan id and your recommended `capturedNodeIds`, then proceed to step 14 with the set it returns. If that call reports the plan is no longer awaiting, read it with `mcp__Bitfab__get_trace_plan` first: a **confirmed** plan means their **Save** landed as the window closed, so instrument the set it returns. Only when the stored plan is expired or cancelled (nothing of theirs to honor) do you instrument from the plan you rendered inline, and then say in one line that it wasn't persisted, so a later `$bitfab:setup view` / `$bitfab:setup modify` won't find a stored plan for this key. **Exception:** a `"reason":"never-connected"` field on the line means the Studio window never actually opened. Say that instead, and offer to re-run the command: the stale session is auto-cleared, so the re-run opens a fresh window.
       - non-zero exit (including `{"event":"timeout",...}`), surface the error and **STOP**, do not write instrumentation. A timeout or crash means Studio never resolved, that is NOT the user leaving the plan page, so do not auto-proceed. ask the user whether to retry node "${BITFAB_PLUGIN_DIR}/dist/commands/openTracePlan.js" or to continue instrumenting (which then confirms the plan via `mcp__Bitfab__confirm_trace_plan` and proceeds to step 14). Act only on their choice. The timeout kills the reader, not the page: a user who acts in Studio after it fires still saves their plan, so if that confirm reports the plan is no longer awaiting, instrument the set `mcp__Bitfab__get_trace_plan` returns.

   **If `mcp__Bitfab__save_trace_plan` itself errors** (offline or MCP unreachable, so there is no plan id and no browser option): render the ASCII plan from your in-memory tree using the "Trace Plan Format" reference section, derive the per-node mock decisions yourself with the procedure above, and **STOP**: ask the user to confirm before writing code. **One error is not that, and it is the one exception to revising in place:** if a revision reports the plan is **cancelled** (the user released it by closing the Studio window), that plan is dead and cannot be revived. Call `mcp__Bitfab__save_trace_plan` again *without* `planId` to create a fresh plan, carry on with the new id, and re-render. An expired plan needs no such handling: saving it revives it.
14. **Write instrumentation AND the replay registry module for this trace function in the same cycle.** Skip the registry for Go-only projects.

   - **11a. Instrumentation edits**: follow the SDK reference exactly, purely additive. Never change behavior, arguments, return values, error handling, variable names, types, control flow, or code structure. **Wrapping means wrapping, not silently rewriting.** Default to attaching the span to the existing call. Rewriting, re-implementing, inlining, or hand-reconstructing a framework/SDK call to seat a root is sometimes genuinely necessary, but it is a refactor, not additive instrumentation: never do it silently as part of the write step. Any such rewrite must preserve behavior exactly (labeled *visibility* or *structural* in the refactor plan); a rewrite that would change behavior is never allowed, fall back to an additive root or move the boundary inward instead. Try the additive root first, when the natural root is opaque or stream-returning, reach for the framework handler/middleware or the `finalize` option wrapped around the *unchanged* call. If none of those fit and a rewrite really is required, STOP, present the refactor plan to the user in plain terms and get an explicit yes before touching the code (the "Refactor confirmation" rules below say what the plan must contain), then proceed once they approve. **Likewise, if the additive wrap doesn't typecheck, STOP and surface it rather than dropping or loosening an argument, weakening validation, or otherwise quietly changing runtime behavior to make it compile** (the same "no type-checker escape hatches, don't paper over it" rule the replay step enforces): a compile error on a purely-additive wrap means the wrap isn't additive, so either find the additive form or present it to the user as a refactor and get approval first. Batch repetitive edits in parallel (one message, many Edit calls); for large mechanical fan-outs (>10 files of the same wrapper pattern), validate the pattern on one file, then do the remaining files. **For each span the trace plan marked `mockOnReplay: true`, pass that SpanOption when you wrap it** (TypeScript `withSpan(key, { type, mockOnReplay: true }, fn)`, Python `@client.span(key, type=..., mock_on_replay=True)`, Ruby equivalent), so replay's `mock: "marked"` strategy serves its recorded output. Spans the plan left not-mocked get the normal wrapper with no `mockOnReplay`.

   - **11b. Replay registry edits**: write or update the registry module alongside instrumentation, using the registry-only contract above:
     - **Language + SDK replay reference URL**: use `https://docs.bitfab.ai/<language>-sdk.md` and re-check the Replay Registry section.
     - **Trace function key**: as confirmed in the trace plan.
     - **Trace function root**: record the exact production symbol, signature, file, and import the registry entry will reference.
     - **Replay root parity (hard rule)**: register the exact same exported top-level traced wrapper that production/runtime calls to create the root span. You must do this unless it is genuinely impossible in the host app; inconvenience, extra refactoring, an inline wrapper, or needing to move code is not impossible. If production creates it inline, extract it into the nearest appropriate service/module, export it, and update both production and replay to import and call that same symbol. Do not replay a convenient inner helper unless that exact helper is also the production root traced wrapper. Avoid duplicate semantic wrappers split across production and replay with names like `runX`, `processX`, or `generateX`. Handler roots register a plain callable that re-invokes the same framework entrypoint production calls with an explicit trace function key.
     - **Handler-instrumented workflows (no decorated root)**: when this cycle's instrumentation is a framework handler (LangGraph / LangChain callback handler, OpenAI Agents SDK run wrapper, Claude Agent SDK handler, Vercel AI SDK middleware) rather than a decorated root function, replace the "Trace function root" item with key-based replay: the replay pipeline passes the handler's key plus a plain callable to `replay()` (Python: `client.replay("<key>", fn, ...)`; TypeScript: `bitfab.replay("<key>", fn, opts)`), and the callable re-invokes the same framework entrypoint production calls with the recorded root input. The SDK wraps the callable internally; on SDKs that predate explicit-key replay, wrap it under the same key yourself (Python `@bitfab.span("<key>")`, TS `getFunction(key).withSpan(...)`). Work out: the production framework entrypoint + import path (e.g. the compiled graph's `invoke`/`ainvoke`, the agent run call), the recorded root-input shape (a dict root input like a LangGraph state arrives as a single positional argument on the explicit-key path; on the older same-key-wrapper path it splats into kwargs, so legacy Python wrappers take `(**state)`), and the runtime wiring the wrapper must construct (framework config, dependency objects). Every unsafe call made by that wiring must sit behind a replay-mockable marked span; use a no-op value only for a replay-only callback slot with no recorded call to mock. The handler-recorded production traces and the replay callable share the key and production entrypoint; never report a handler-instrumented key as not replayable.
     - **Registry target**: add the entry to the existing registry module or create one using the language convention: TypeScript default export from `defineReplayRegistry`, Python variable `registry`, Ruby constant `REGISTRY`.
     - **Non-negotiables**: the module contains app bootstrap/imports, exact production roots, and per-function defaults only. It never parses CLI arguments, calls `replay()`, invokes a runner, installs lifecycle callbacks, prints output, or handles `BITFAB_REPLAY_RESULT_PATH`. Put the safety-audited mock strategy and input adapter on the registry entry. The SDK-installed `bitfab-replay --registry <path> <pipeline> [options]` command owns all common behavior.
     - **Replay-safety validation**: re-check every unsafe action against the safety-audited mock strategy before running the command. A synchronous TypeScript unsafe span cannot consume lazy `mock: "marked"` output; use `all` only when freezing every matched child is acceptable. Python worker-thread dispatch requires `trace_across_threads=True`. A Ruby child-thread, pre-created consumer, or process does not inherit replay interception. Do not hand-mock DB clients or other unsafe dependencies; keep the real call behind a selected replay-mockable marked span so its recorded output is served.
     - **Lifecycle and output contract**: do not implement either in project code; the installed executable owns progress callbacks, stderr summaries, stdout JSON, and result-file transport.
     - **Match the registry template exactly**: do not add speculative wrappers, arity branches, type-checker escape hatches, or untyped passthroughs. Use the per-entry input adapter for genuine historical signature drift.
     - **Per-item error tolerance**: do not catch errors inside the registered function or replace them with placeholders; the SDK executable preserves replay and trace errors while continuing the batch.
     - **Side-effect check**: if importing the instrumented function triggers module-level side effects (booting listeners/ports or making external calls), stop and surface the blocker. Import-time work runs before replay interception exists; defer every unsafe action behind a replay-mockable marked span instead of choosing a different deployment environment.

   The trace plan's `Files changed:` list must include the replay registry module path for this cycle alongside the instrumented files.
15. Give the user a clear completion message that explains how to run the instrumented workflow and, once traces exist, the SDK-installed replay command with this registry. If the repository reveals an exact command or user action that drives the real instrumented path, provide it. If it does not, name the application path or workflow that must be exercised without inventing a command. Always give the exact `bitfab-replay --registry ...` command when a registry was created. Do NOT run either command yourself. (Omit the replay command for Go-only projects.) **If step 11 flagged this function as reading stored DB state (or, on the analyze-repo reuse path where that step was skipped, reconcile at step 8 noted a captured node that reads stored database state, an `external_read` with `readKind: db_read` specifically, not an `http_read` / `vector_search` / `cache_read` / `filesystem_read`)** (TypeScript, Python, Ruby), add one line: replay currently reads today's data, run `$bitfab:setup db-snapshot` to make it replay against the database state at trace time.

   **Generate the trace by driving the instrumented path, not by instrumenting a new one.** If the convenient local entrypoint (a dev CLI, script, or REPL) bypasses the wrapped root and calls the inner function directly, common when prod runs behind an orchestrator (Temporal, a job/queue worker), its trace won't match production. Say so, then steer to driving the real path or rerouting the harness through the wrapped entrypoint, never add a span to a dev/test-only entrypoint just to make its trace look right.

   End with this required verification section:

   ```md
   Replay root parity:
   - Production root symbol:
   - Production import/path:
   - Replay symbol:
   - Replay import/path:
   - Same symbol? yes/no
   - If no, why is this impossible?
   ```
16. After the run instructions from step 15, decide what to instrument next.

   **First, silently re-probe `mcp__Bitfab__list_trace_plans` with `{ source: "analyze_repo", status: "awaiting" }` on EVERY pass through this step** (always, even if you already probed at step 7 earlier this session: the remaining-draft set shrinks as you wire them up, so a draft the user hasn't instrumented yet must still surface here). Do not narrate the probe itself. **The probe self-cleans, so take what it returns at face value**: a draft you instrumented this session is `confirmed` by then, and a draft you retired at step 8 was cancelled with `mcp__Bitfab__cancel_trace_plan`, so neither comes back as awaiting. What does come back is work the user has not dealt with yet. The one case to exclude by hand is a draft the user selected and then abandoned mid-cycle this session: it is still awaiting and legitimately reusable, but re-recommending it in the same breath they dropped it just loops them on it. If nothing remains to offer, treat it as no drafts left (omit option A). Then ask the user what to do next:

   > A) **Instrument a saved trace plan**: reuse one of the remaining analyze-repo drafts (only shown when drafts remain) *(recommended)* → step 8
   > B) **Find another workflow for me**: scan for the next uninstrumented AI call, agent, or decision and rank → step 9
   > C) **I'll name the target**: type a different file, function, or directory and I read only that, no scan → step 10
   > D) **Done instrumenting**: finish setup → step 1 of the Cleanup phase

   **Option A (reuse a saved plan) is only present when `mcp__Bitfab__list_trace_plans` returned at least one awaiting draft.** When drafts remain, offer A first and recommend it (say how many remain), wiring up a plan the user already generated with `$bitfab:setup analyze-repo` beats a fresh scan; picking it returns to step 8 to reconcile and wire up the next draft (re-ask which of the remaining drafts to take). **When no awaiting drafts remain, omit A entirely.** B starts another cycle with a fresh full discovery scan (keeps the list complete when the previous cycle came from a targeted read that surfaced only one location). C is the free-text option for naming a different file, function, or directory: same rule as option C at step 7, say in the question text that they can just type the target, and if C still comes back bare, ask for it in plain chat and wait, never as an options question and never after scanning the codebase to build them a menu of candidates. D exits the Instrument loop.

## Modify

**Run only when mode is `wizard`, `instrument` or `modify`.**

Adjust an **existing** trace setup. Requires existing SDK usage in the codebase, if none exists, run Instrument first. Triggered explicitly by `$bitfab:setup modify`, or selected from the choice prompt at Instrument's existing-SDK-usage menu when existing SDK usage is found.

Every Modify cycle targets **exactly one** trace function. Never batch multiple trace functions in one cycle, if the user wants more, loop via the step 7 menu.

1. **Skip the search when you already hold the keys**: arriving from Instrument's existing-SDK-usage menu means you ran exactly this search one step ago, and re-running it makes the user watch the same greps twice for the same answer. Otherwise **gather existing trace functions** by searching for SDK patterns (`getFunction("key")`, `get_function("key")`, `bitfab_function "key"`, `WithFunctionName("key")`, plus keyed framework handlers: `getLangGraphCallbackHandler("key")` / `get_langgraph_callback_handler("key")` (or the LangChain-named aliases) and `getOpenAiAgentHandler("key")` / `get_openai_agent_handler("key")` and `getClaudeAgentHandler("key")` / `get_claude_agent_handler("key")` and `getVercelAiMiddleware("key")`; plus trace-processor registrations (unkeyed in code, the key is derived server-side from the workflow name): `getOpenAiTracingProcessor()` / `get_openai_tracing_processor()`). List each key alongside its root function (or, for keys registered only via a framework handler, the handler registration site, handler keys have no decorated root and that is expected). If none are found, tell the user Modify needs existing instrumentation and suggest `$bitfab:setup instrument`.

   - **the key is already settled (passed as `$bitfab:setup modify <key>`, or named at Instrument's existing-SDK-usage menu)**: skip the which-function question, the user already answered it → step 3
   - **no instrumented trace functions exist (nothing to modify)**: continue → step 1 of the Cleanup phase
   - **one or more trace functions exist**: continue → step 2
2. **Pick exactly ONE trace function to modify.** (You only reach this step when the key is not already settled; a key named at Instrument's existing-SDK-usage menu or passed as `$bitfab:setup modify <key>` routes past it.) Ask the user with the list of existing keys. Recommend the one the user most recently instrumented (or the one most recently referenced in the current session) and explain why in one line.
3. **Reconcile the most recent confirmed trace plan with the CURRENT code before treating either as the `before` `TracePlanTree`.** A stored plan preserves historical user intent, sample inputs/outputs, stable node ids, and surrounding context; it is never proof of what the code captures now. Code can add, remove, rename, move, or unwrap spans after confirmation, so every Modify cycle MUST reread and reconcile current instrumentation even when a prior plan exists.

   1. Call `mcp__Bitfab__get_trace_plan` with `{ traceFunctionKey: "<chosen key>" }` (no `planId`). Two outcomes:
      - **Prior plan found**: parse the JSON block and hold its `tree` and `capturedNodeIds` as the stored snapshot. **Also record the plan's `id`** (the `Trace plan: <uuid>` line at the top of the response): step 5 updates THAT plan in place rather than uploading a competing plan. Do not skip the current-code read below.
      - **"No prior confirmed trace plan found"**: that answer only rules out a *confirmed* plan, which is not the same as no plan. **Before concluding there is none, probe `mcp__Bitfab__list_trace_plans` with `{ traceFunctionKey: "<chosen key>", status: "awaiting" }`** (a silent probe, don't narrate it). An unconfirmed plan for this key is common: an `$bitfab:setup analyze-repo` draft nobody wired up, or a plan whose confirmation never landed because Studio was closed the wrong way.
        - **An awaiting plan came back**: take the newest, read it with `mcp__Bitfab__get_trace_plan` `{ planId }`, and treat it exactly like the prior-plan case above (hold its tree and captured set as the stored snapshot, record its id for step 5 to update). Say in one line that you are revising the existing unconfirmed plan for this key. **If the probe returned several, retire the ones you did not take with `mcp__Bitfab__cancel_trace_plan`**: a key that already accumulated duplicates should leave this cycle holding one plan, not the newest plus a tail of reusable strays.
        - **Nothing came back**: there is genuinely no stored snapshot for this key (key created outside the skill, or an older cycle that predates the stored plan). You have no prior plan id, so step 5 creates a plan after the current-code read.
   2. **Inventory the current instrumentation from code (mandatory in both outcomes).** Search for the exact chosen key's root registration plus every span bound to that trace function/client and every keyed framework handler, run wrapper, middleware, or processor that contributes auto-captured spans. Read every matched implementation and every still-existing file referenced by the stored snapshot. Map what the code captures now into a code-derived `TracePlanTree` (`{ rootId, nodes: { [id]: TraceNode } }`, same shape used in Instrument's build-trace-plan step). Each `TraceNode` carries `id`, `name`, `kind` ("manual" | "auto" | "pure"), `file`, `line`, `signature`, `parentId`, `childIds`, plus `framework` for `[auto]` lines. Do not limit the search to filenames in the stored plan: newly added spans often live in files the old plan never mentioned.
   3. **Reconcile the stored snapshot with the code-derived tree.** The reconciled `before` tree and capture set must describe the code that would execute today:
      - **Present in code, absent from the stored plan**: add the node. Current manual and auto-captured spans belong in `capturedNodeIds`; new uninstrumented surrounding context stays `pure` and uncaptured.
      - **Present in the stored plan, no longer instrumented in code**: remove it from `capturedNodeIds`. Keep it as `pure` context only when the function still exists and is useful context; otherwise remove it and repair parent/child links.
      - **Moved or renamed**: preserve the existing node id only when the implementation identity is clear, then refresh its name, file, line, signature, relationships, and changed analysis. Otherwise treat it as one removed node plus one added node.
      - **Root changed**: when the current trace boundary is a different function, replace the tree's rootId with that current root's node id and rebuild the tree beneath it. A structural save_trace_plan update supports changing the root while keeping the same plan id, so never retain an obsolete root or create a competing plan merely to preserve the old rootId.
      - **Unchanged**: preserve the stored node id, samples, analysis, and user-confirmed mock/capture intent.

   Before holding the reconciled tree, enforce the same sample completeness as a newly built plan: **every captured node, including each manual or auto span discovered only from current code, MUST include `sampleInput` and `sampleOutput`.** Preserve stored samples for unchanged nodes. For a drift-discovered captured node, or an older captured node whose stored samples are missing, construct realistic values from its current parameter and return types now. Do this during reconciliation even when the user requested no explicit modifications, because step 4 may copy the `before` tree unchanged.

   Enforce analysis completeness at the same boundary: **every node in the reconciled tree MUST carry `analysis` before it becomes the `before` tree.** Preserve stored analysis only for an unchanged node whose body is unchanged. Read and classify every drift-discovered node, changed node, or older node whose analysis is missing using the decision procedure in step 4. Do this during reconciliation even when the user requested no explicit modifications, so copying `before` unchanged can never persist an unclassified captured span or context node.

   If this comparison finds drift, tell the user in one line what was stale (added, removed, moved, renamed, or unwrapped nodes) before presenting the refreshed plan. Never silently carry an obsolete captured node forward, and never omit a current manual/auto span just because it was absent from the stored snapshot.

   Hold the reconciled `before` tree in memory. It seeds the `after` tree you build in step 4 and becomes the left-hand side of the inline-fallback diff in step 5. Do not present it yet.
4. **Build the modified trace plan as a `TracePlanTree` under the same PURELY ADDITIVE constraint as Instrument's build-trace-plan step.** Start from the `before` tree built in step 3 and produce an `after` tree of the same shape (`{ rootId, nodes: { [id]: TraceNode } }`) that applies the user's requested modifications. Reuse node ids unchanged for nodes that survive, that lets the trace plan UI show only what actually changes, and mint new ids for added nodes.

   **If the user didn't request anything specific** (no modifications were named in the skill invocation or earlier in the conversation), produce an `after` tree identical to the `before` tree. Don't invent changes. The user will edit the capture set directly in the UI in step 5.

   The modified tree must be implementable without behavior changes. If a requested modification requires awaiting a stream that wasn't awaited, delaying a call, reordering operations, blocking a callback, or restructuring control flow, tell the user which part doesn't fit and why, and ask them to refine the request (or suggest splitting into multiple cycles). Never present a behavior-changing approach as an option.

   **Every captured node MUST include `sampleInput` and `sampleOutput`**: same hard rule as Instrument's build-trace-plan step. Carry samples forward unchanged for surviving nodes; for newly added nodes (intermediate spans, deeper leaves, a new upstream/downstream root), construct realistic example values from the function's parameter and return types (Read the file and its return-type imports if needed). Do not advance to step 5 with a captured node missing either field.

   **Every node in the modified `TracePlanTree` MUST carry an `analysis`**, same hard rule and same procedure as Instrument's build-trace-plan step, so any context node the user toggles into capture already has a replay decision. `analysis` is `{ classification, mockable?, unmockableReason?, inputSerializable?, outputSerializable?, innerCall?, sideEffectKind?, readKind? }` (`pure` | `model_call` | `external_read` | `side_effect`); the server derives `mockOnReplay` and the summary from it, so you don't send them. Mockable `external_read` and `side_effect` nodes default to mocked replay, except broad external parents with live descendants; `model_call` and `pure` nodes default to live replay. Carry existing `analysis` forward unchanged for surviving nodes only when it is already present and the node body did not change. For surviving nodes from older prior plans that lack `analysis`, or nodes whose body changed, read the node body now and backfill `analysis` before presenting the plan. Classify each missing, changed, or **newly added** node from its body, not its name, using that step's decision procedure (first match wins): (1) is itself the model call (an auto-captured model leaf, or a span that invokes the model inline in its own body with no separately-represented model-call child) → `model_call` (re-runs live; never mock); a framework wrapper or orchestrator (a LangChain `chain.invoke`, a LangGraph node, the root that just calls model-call children) whose model call is a child node is `pure`, not `model_call`, don't bubble the child's classification up; (2) own body mutates external state (DB write, outbound `POST/PUT/DELETE`, queue/email/charge/file/vector write) → `side_effect` with `sideEffectKind`, this wins over model_call when one span does both; (3) own body reads external mutable state (DB `SELECT`, `GET`, vector search, cache read) → `external_read` with `readKind`; (4) otherwise → `pure` (local compute, in-memory). Classify a span by its OWN body, excluding work already represented by child nodes (don't double-count). Prefer the smallest external boundary: if a read/write wrapper contains parsing, ranking, prompt construction, model calls, or other live code, put `external_read` / `side_effect` on the lower DB/HTTP/write call and classify the wrapper by its remaining own body. **Nested `model_call`s are always a bug:** no `model_call` may have a `model_call` ancestor or descendant, the leaf that hits the API is the only model call and the chain, graph node, or wrapper above it is `pure` even when the framework labels it an LLM or chat span; if two `model_call`s land on one parent-to-child line, demote the upper to `pure`. **Then set mockable from wrapper kind and execution context, using the build-trace-plan rules:** a manual withSpan / @span is mockable only when it remains a descendant in the same replay context. Python thread dispatch requires Bitfab(trace_across_threads=True); Ruby child threads, pre-created consumers, and other processes are unmockable until the boundary moves into replay context. Python async generators are unmockable. A TypeScript synchronous selected span requires mock: "all" when freezing every matched child is acceptable; otherwise it is unmockable unless the existing boundary already returns a Promise. Set mockable: false plus the concrete reason for every exception. Auto framework spans are also mockable: false plus unmockableReason, except Vercel AI SDK model spans whose wrapLanguageModel middleware routes through withSpan and LangGraph `ToolNode` tool spans configured through the Experimental (alpha) `getLangGraphIntegration` / `get_langgraph_integration` replay boundary. Callback-only LangGraph tool spans remain unmockable. The root omits mockable because roots are never mocked. Mocking returns a span's recorded output instead of running the call, which only works through a replay wrapper; ordinary auto framework spans are observed, not wrapped. Authoritative per-framework lookup:
   **Python async-generator exception:** a manual async-generator @span is unmockable even though other manual spans are mockable. Set mockable: false with that reason, and move every unsafe operation inside it to a mockable sync or coroutine descendant before replay.
   - **LangGraph / LangChain**: model-call and tool / retriever / read / side-effect spans are observed via its callback handler, so they are NOT mockable; ToolNode tool spans configured through its Experimental (alpha) `getLangGraphIntegration` / `get_langgraph_integration` integration ARE mockable; callback-only tool spans remain NOT mockable.
   - **OpenAI Agents SDK**: model-call and tool / retriever / read / side-effect spans are observed via its tracing processor, so they are NOT mockable.
   - **Claude Agent SDK**: model-call and tool / retriever / read / side-effect spans are observed via its handler, so they are NOT mockable.
   - **BAML**: model-call spans are observed via its wrapper, so they are NOT mockable.
   - **Vercel AI SDK**: model-call spans run through `withSpan` via its middleware, so they ARE mockable (though re-run live by default).
   **Serializability, two facts separate from `mockable`:** set `outputSerializable: false` when the recorded OUTPUT doesn't serialize and `inputSerializable: false` when the recorded INPUT doesn't (an argument is a DB client, open stream, callback, or class instance with no JSON form); omit either when it serializes. The server forces any `outputSerializable: false` node unmockable, so **don't mock a node whose output isn't serializable**, and it flags the plan not replayable when the root's input isn't serializable, so **don't choose a root whose input isn't serializable** (promote the root to a caller taking the serializable request / prompt / messages). The hazard the mechanical `mockable` rule prevents: an `auto` `external_read` / `side_effect` (a framework tool hitting a DB / HTTP) left mockable promises a mock replay can't deliver; its real fix is a manual `withSpan` around that call or a db-snapshot, never a mock.

   **Include surrounding code as `pure` context nodes** so the modified capture is legible inside its codebase context and the user can toggle additional nodes into the capture directly in the UI without leaving the page. The test for inclusion is **"would the user plausibly want this as its own span?"**: anything they might wrap as a deeper child of what is already captured, or add as a peer at the same depth. Walk in two directions:
   - **~10 callees below each leaf**: candidates for **wrapping deeper spans**. For every existing leaf in the captured sub-tree, walk downward (callees of that leaf, callees of those, etc.) and attach each as a `pure` descendant. Include any callee the user might plausibly want as its own span, LLM / tool / agent calls, prompt construction, response parsing, retry loops, fan-outs, post-processing that drives another model. Stop at pure plumbing (pass-through returns, trivial formatting or arithmetic, no further interesting activity) or ~10 nodes per leaf. **Don't stop just because you crossed an SDK / framework / stdlib boundary**: the test is "is this plausibly its own span?", not "is this in our code?".
   - **~5 siblings per captured node BELOW the root**: candidates for **peer spans at the same depth**. For each captured node whose parent is the root or a descendant of it, include that parent's other callees (other functions invoked from the same wrapper) as `pure` siblings. These are the nodes the user might wrap alongside the existing capture to widen the trace sideways. **Don't generate siblings for the root**: a sibling of the root is by definition a child of the root's parent, which sits above the root and can never render. This removes nothing from under the root, the root's other callees still arrive as siblings of its captured children.
   - **Every context node MUST be a descendant of the root.** The plan tree renders downward from `rootId`, so a node above the root, or on a side branch hanging off one of those ancestors, is stored and counted but never drawn. Do not attach callers of the root, and do not attach the root's own siblings.

   Mark every surrounding node with `kind: "pure"` (uncaptured), **do not** add their ids to `capturedNodeIds`, and still attach `analysis` to each one. They serve two ends: **legibility** (the captured set sits inside its surrounding code so the user sees what is and isn't traced) and **modification** (they are the levers in the UI for expanding capture deeper).

   When applying a requested modification, read the relevant signatures so the plan stays accurate: for added context, name the exact keys/values and the span they attach to; for new instrumented spans, read each callee's signature and pick a type annotation (`function`, `llm`, `tool`, `agent`, `handoff`); for span removals, list each by name and confirm the underlying call is left untouched; for a new upstream/downstream root, read the new function's signature and confirm it still covers the interesting LLM/tool activity (upstream) or remains a common ancestor of every LLM/tool span (downstream).
5. **Post the modified plan, render it inline as ASCII, then ask the user whether to review it in the browser or just continue**, same delivery pattern as Instrument's build-trace-plan step. The inline ASCII is what the user reviews in chat; Studio is the optional richer surface where they can adjust the captured set (selecting/deselecting any of the surrounding `pure` context nodes added in step 4). Continuing in chat, and every way of leaving the plan page in Studio (**Close**, **Save**, closing the window), applies the diff. None of them is an abort or a request for another round of plan edits.

   1. **Post the modified plan.** Do NOT open Studio here, rendering (step 2) and the browser-or-continue ask (step 3) come next. Which tool you call depends on whether step 3 found a prior plan:

      - **Prior plan id in hand (the normal path): call `mcp__Bitfab__save_trace_plan`** with `{ planId, tree, capturedNodeIds }` (and `traceFunctionKey` only if the key is being renamed, `stats` if you have a sample run). This revises the EXISTING plan in place. **Always include `planId` here:** omitting it creates a second plan for the same key, which competes with the first. Sending `tree` + `capturedNodeIds` is a **structural** update, which reopens a confirmed plan to `awaiting`; that is expected and is why step 3 still has to confirm it.
        - **Always send the structural form here, even when only the capture set changed.** The targeted form (`capture` / `uncapture` / `mockOnReplayByNodeId`) deliberately leaves a confirmed plan `confirmed`, which breaks the rest of this step: `mcp__Bitfab__confirm_trace_plan` then fails as "not awaiting", and Studio renders a confirmed plan read-only so the capture toggles this step offers are disabled. Reopening to `awaiting` is what makes the review and confirm below work. Use the targeted form only outside this flow, for a one-off adjustment with no review step.
      - **No prior plan (neither probe in step 3 found one, confirmed or awaiting): call `mcp__Bitfab__save_trace_plan`** with `{ language, tree, capturedNodeIds, traceFunctionKey }` (and `stats` if you have one), exactly as Instrument does. Persisting the key lets the next Modify cycle bootstrap from this plan.

      In either save mode, `tree` is the modified `after` `TracePlanTree` from step 4, with the ~10 surrounding callees and ~5 sibling callees included as `pure` context nodes. Every node remains a descendant of `rootId`; never include callers above the root. Every node carries the `analysis` you set/carried-forward in that step, including uncaptured context nodes. `capturedNodeIds` is your initial recommendation and must form a connected sub-tree with exactly one entry point (selecting any descendant implies its ancestors); surrounding `pure` context nodes are not included. The server derives the validation card (status pill + aggregate counts) from the per-node `analysis`, so you don't send a summary. The tool returns the plan id (and a `https://bitfab.ai/studio/trace-plan/<id>` URL); for the update path that is the same id you already held.

   2. **Render the modified plan inline as ASCII** using the Default view template from the **Trace Plan Format** reference section (before/after framing: show the current capture and the modified capture, as fits the change). List the `Files changed:` footer (paths only, no annotations). This is what the user reviews in chat.

   3. **Then ask the user** what they want to do next. The primary choice is **Open trace plan** (open Studio, the richer surface for reviewing and toggling the captured set) or **Continue** (apply the diff using the plan as rendered). The full option set and routing:

   > A) **Continue**: apply the diff using the plan shown above (or the set you confirmed in the browser) *(recommended)* → step 6
   > B) **Open trace plan**: open the plan in Studio to review and toggle the captured set; leaving that page (Close or Update) applies the diff → step 6
   > C) **Modifications**: change something about this plan → step 4
   > D) **Abort entirely**: discard this plan without writing any edits → step 1 of the Cleanup phase
   > E) **Expand details**: re-render the inline ASCII diff in the expanded view → step 5

      - **Open trace plan**: run `node "${BITFAB_PLUGIN_DIR}/dist/commands/openTracePlan.js" <planId>` (`${BITFAB_PLUGIN_DIR}` resolves to the plugin directory; `<planId>` is the id from step 1) as a background / long-running process, never in the foreground. The script navigates Studio to the trace plan page and stays alive until the user leaves it, by clicking **Close** (keep the plan as drafted) or **Save** (save their toggles), or by closing the window (up to 30 minutes). If it emits `{"event":"window-open-requested","url":"..."}`, immediately surface the URL in a normal chat message, e.g. `Opening Studio: <url>. Click it if a window doesn't appear`, before continuing to read. Keep polling the live exec session until it exits (see the Blocking-process rule at the top of this skill); the user's decision arrives as stdout, not as a chat message. Tell the user in one line that the plan is open and that **Close** / **Save** there applies the diff, then ask the user: a single yes/no question, **"Apply this now?"**, with **Continue** (branch **A**, recommended) and **Not yet** (keep reading the process, do not re-ask). Say in the question's own text that Close or Update in Studio applies it too and that the question stays up while they are over there, so returning and picking either option is safe. It is a confirm, not a fork; a change the user types as free text instead routes to branch **C**. Waiting is never an option, it is what the question on screen already does. **Read the background process's stdout before acting on their answer:** a terminal line that already landed means they acted in Studio and it wins (route on the event, never re-confirm over the toggles they saved with **Save**). Only when nothing has landed do you act on the answer, and the three answers act differently. **Continue** (branch **A**) closes the plan for them with `node "${BITFAB_PLUGIN_DIR}/dist/commands/openStudioTo.js" "/studio"` (navigates Studio off the plan page in place, never `node "${BITFAB_PLUGIN_DIR}/dist/commands/closeStudio.js"`) and stops the background process first, because that branch finishes. **A typed change** (branch **C**) does neither: step 1 re-saves onto the same `planId`, and the open plan page re-renders itself when that update lands, so the user watches their plan change instead of losing the window, and the reader keeps waiting on the same plan. **Not yet** also does neither: leave Studio and the process alone and keep reading until it exits. A later "continue" typed in chat then takes branch **A**, teardown included: **the user must always be able to finish without touching Studio.** On branch **A**, if `mcp__Bitfab__confirm_trace_plan` reports the plan is no longer awaiting, they saved in Studio between your read and your write: apply the set `mcp__Bitfab__get_trace_plan` returns instead of your own. Otherwise parse the final JSONL line on exit: `{"event":"confirmed",...}` (Close or Update) and `{"event":"cancelled",...}` (window closed, or an expired plan released) both route to branch **A**, apply the diff; the one exception is a `"reason":"never-connected"` field, which means the window never opened, say so and offer to re-run. A non-zero exit (including the 30-minute timeout, which kills the reader but leaves the page usable) surfaces the error, then re-ask below. On `confirmed`, call `mcp__Bitfab__get_trace_plan` with the returned `planId` (normally the one you opened, since a revision updates that plan in place; it differs only when something created a new plan mid-session, which `openTracePlan.js` auto-tracks via `tracePlan:created` events) to read the authoritative `capturedNodeIds` (the user may have toggled `pure` context nodes into the set or removed captured ones) and reconcile your edit plan with it (drop `●` wraps no longer captured, add wraps for newly captured nodes).
      - **Continue** (branch **A**): call `mcp__Bitfab__confirm_trace_plan` with the plan id from step 1 and your recommended `capturedNodeIds` to persist the modified plan as *confirmed* (Studio's Close/Update does this on the browser path; every other path MUST do it here, or a later `$bitfab:setup view`/`$bitfab:setup modify` for this key won't find it), then apply the diff using the authoritative `capturedNodeIds` and per-node mock decisions it returns. If that call reports the plan is expired or no longer awaiting, apply the diff from the plan you rendered inline anyway and say in one line that it wasn't persisted. Every node should already be classified; if a captured node somehow lacks `analysis`, classify it now with the decision procedure from step 4 before instrumenting, never wrap a captured span without a mock decision.

   **If the save in step 1 itself errors** (e.g. offline or MCP unreachable, so there is no browser option): render the inline before/after ASCII from your in-memory tree, derive the mock decisions yourself, and **STOP**: ask the user using the options above before writing edits. One error is not fatal in the same way: if `mcp__Bitfab__save_trace_plan` reports the plan is **cancelled**, that plan is dead and cannot be revived, call `mcp__Bitfab__save_trace_plan` again without `planId` to create a fresh plan and carry on.
6. **Apply the changes, purely additive to behavior.** Same rules as Instrument's write-instrumentation step: never change arguments, return values, error handling, variable names, types, control flow, or code structure. Removing a `withSpan`/`@span` wrapper is the only structural edit allowed, and only when it leaves the wrapped call, its arguments, and its return value untouched. The trace function key from step 2 stays the same, do not rename keys. Batch repetitive edits in parallel (one message, many Edit calls).
7. Tell the user how to run the app to generate a trace with the modified setup, exact command(s). Do NOT run it yourself. Then **MANDATORY STOP**: ask the user:
   > We recommend **A**: generate a trace with the modified setup so the diff is observable end-to-end.

   > A) **Generate a trace for the modified setup**: present the script to run; allow the user to let you run it *(recommended)* → step 1 of the Cleanup phase
   > B) **Modify another trace function**: pick another traced function to adjust → step 2
   > C) **Done**: stop here → step 1 of the Cleanup phase

   B returns to step 2. A and C exit the Modify loop to cleanup (Modify does not auto-continue to Replay, the user can invoke `$bitfab:setup replay` separately).

   **Re-entry rule (applies after you leave this loop).** If, later in the conversation, the user asks to re-instrument or change another function's capture in plain language (`re-instrument <fn>`, `change what this span records`, `give me the updated trace plan for <fn>`), that is a fresh Modify (or Instrument) cycle: re-invoke `$bitfab:setup modify` (name the mode, so it goes straight to Modify rather than falling back to the full `wizard`) so it runs through the trace-plan flow. **Never satisfy such a request by hand-writing a trace plan or before/after diff you made up as a chat message, that skips the `mcp__Bitfab__save_trace_plan` + inline ASCII render (and optional Studio review) this flow runs.**

## Inspect

**Run only when mode is `inspect`.**

Diagnose, and optionally fix, an existing Bitfab tracing setup. Triggered explicitly by `$bitfab:setup inspect` (or natural-language asks like "why aren't my traces showing up" / "what's instrumented" / "debug my tracing setup" / "inspect my tracing"). Reports auth/connection status, what's instrumented in this repo, whether the plugin and SDK are up to date, whether replay registry modules cover every trace function key, and whether traces are actually arriving, then offers to apply the fixes, each confirmed individually before any change. Does **not** open Studio.

This is about trace *delivery and setup health* (is the SDK wired up and current, is the key set, are traces landing, are replay registry modules in place). For improving the *quality* of a traced function's outputs (pass rates, failing cases), use `$bitfab:assistant` instead.

1. Run the status check and report the result to the user:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/status.js"
   ```

   Report whether they're authenticated and which org/account the plugin is connected to. If **not authenticated**, note that trace arrival can't be confirmed without login and suggest `$bitfab:setup login`, but continue with the read-only code inspection below regardless (it does not require auth).
2. Search the codebase for SDK usage and trace function keys (`getFunction("key")`, `get_function("key")`, `bitfab_function "key"`, `WithFunctionName("key")`, plus keyed framework handlers: `getLangGraphCallbackHandler("key")` / `get_langgraph_callback_handler("key")` (or the LangChain-named aliases) and `getOpenAiAgentHandler("key")` / `get_openai_agent_handler("key")` and `getClaudeAgentHandler("key")` / `get_claude_agent_handler("key")` and `getVercelAiMiddleware("key")`; plus trace-processor registrations (unkeyed in code, the key is derived server-side from the workflow name): `getOpenAiTracingProcessor()` / `get_openai_tracing_processor()`). In a monorepo, search **each application directory separately**: a root-level search can miss subdirectories. Report:
   - Whether the SDK is installed (check the package manifest) and whether `BITFAB_API_KEY` is set (in `.env`-style files or the environment), do **not** print the key value.
   - Each trace function key found, alongside its root function and file path.
   - **Trace-processor registrations (OpenAI Agents SDK) too**, even though they are unkeyed in code: the registration site (`setTraceProcessors` / `set_trace_processors` with the Bitfab processor) is itself an instrumented workflow whose key is derived server-side from the workflow name. Note whether each run is routed through the run wrapper (`getOpenAiAgentHandler` / `get_openai_agent_handler`) or wrapped in a manual `withSpan`/`@span` root, the replayability check in step 4 needs this (a bare processor over plain `run()` with neither is not replayable).
   - Whether instrumentation routes through a project-local shim (e.g. `lib/bitfab.*`).

   If no SDK usage is found, say so and suggest `$bitfab:setup instrument` to wire up the first workflow. Continue through the remaining steps anyway, with no trace function keys, the trace-arrival check (step 3) has nothing to look up and is a no-op, but the freshness check (step 4) still matters: plugin and SDK staleness, including the legacy `bitfab` → `@bitfab/sdk` migration, apply regardless of whether this repo has any trace functions yet.
3. For each trace function key found in step 2, check whether traces are actually landing in Bitfab:
   - Call `mcp__Bitfab__list_trace_functions` to see which keys the org has received traces for. Cross-reference against the keys instrumented in this repo: a key present in code but absent here usually means traces have never reached Bitfab (app not run with the key set, or the key is bound to a different org).
   - For keys that do exist, call `mcp__Bitfab__search_traces` with `{ traceFunctionKey: "<key>", limit: 1 }` to confirm a recent trace and capture its timestamp.

   Mark each key as ✅ traces arriving (with most recent timestamp), ⚠️ instrumented here but no traces yet, or ❓ traces exist in the org but the key isn't found in this repo. If not authenticated (from step 1), skip the tool calls and note that arrival can't be checked until login.
4. Check whether the plugin, SDK, and replay registry modules are current, so the report can offer to fix what's stale:

   1. **Plugin**: reuse the `status` output already captured in the status-check step (step 1). If that status line included `v<X> available, run ... to update`, the plugin is behind.
   2. **SDK**: run the version check (the same mechanism `$bitfab:update` uses):

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/update.js" sdk
   ```

      Parse the `<bitfab-sdk-status>` block it prints, one JSON object per (workspace, language) with `packageName`, `current`, `latest`, `latestSource` ("remote" | "baked"), `updateAvailable`, and `renameFrom`. Treat `updateAvailable: true` as needing a fix, that flag is set both when `latest > current` **and** when `renameFrom` is non-null. A non-null `renameFrom` (e.g. `"bitfab"`) means the TypeScript workspace is on the **legacy `bitfab` npm package and must switch to `@bitfab/sdk`**; this counts as needing a fix even when the installed version already equals `latest` (the rename itself is the fix). If `remoteCheckFailed` is true for an entry, note the latest version couldn't be confirmed (offline / sandbox) rather than asserting it's current.
   3. **Replay registries**: the same coverage check `$bitfab:assistant` runs in its Phase 2: Glob for `scripts/replayRegistry.*`, `scripts/replay_registry.*`, or another module defining `ReplayRegistry` / `defineReplayRegistry`, then grep it for each trace function key found in step 2. Mark replay as ✅ covers all keys, ⚠️ exists but missing keys, or ❌ no replay registry module.
   4. **Replayability of each root**: registry coverage is only half of replay, an entry that points at a non-replayable root still won't run. Determine each key's replayability statically from source (this step does not fetch recorded trace inputs, so reason from signatures, not trace data):
      - **Keyed root-handler keys** (registered through a callback handler or a trace-processor run wrapper, LangGraph / LangChain, OpenAI Agents SDK, Claude Agent SDK, or Vercel AI SDK, with no `@span`/`withSpan`-decorated root in the app) are replayable by design: the handler (or run wrapper, `getOpenAiAgentHandler` / `get_openai_agent_handler`) records the framework's own serializable input as the root. Never flag these ⚠️, and never treat the absence of a decorated root function as non-replayable (this mirrors Instrument's rule).
      - **Bare trace-processor keys** (OpenAI Agents SDK over plain `run()`): the processor captures the run but its root span records an empty input, so a processor-only key (neither the run wrapper `getOpenAiAgentHandler` / `get_openai_agent_handler` nor a manual `withSpan`/`@span` root) is NOT replayable, flag it ⚠️ root not replayable and recommend routing the run through the run wrapper (or adding a manual root that takes the run input). If the key DOES go through the run wrapper or a manual root, check that root's signature like any decorated key (next bullet).
      - **Decorated/wrapped keys**: read the root function signature and confirm it's replayable per Instrument's trace-boundary serializability requirement (serializable inputs). Flag any key whose root takes unserializable inputs (live SDK/DB clients, HTTP `Request`/`Response`, stream writers, sockets, opaque request contexts) as ⚠️ root not replayable, reasoning from the signature, not the function name. This is independent of the replay-registry coverage in sub-step 3 above: a non-replayable root is ⚠️ whether or not a registry exists for it (a key can be ❌ no replay registry module AND ⚠️ root not replayable at once), so never roll a non-replayable root up into ✅ just because it has no registry entry.

   Hold these results for the report. (If nothing is instrumented, no trace function keys AND no trace-processor registrations, skip both the **replay** and the **replayability** checks, they are per-workflow, so there's nothing to evaluate; report both as `n/a (nothing instrumented)`, never ✅. Still run the **plugin** and **SDK** checks: the SDK may be installed and stale, or on the legacy `bitfab` package needing the `@bitfab/sdk` rename, independent of whether any trace functions exist in this repo yet.)
5. Summarize the setup health in one compact report:
   - **Auth**: authenticated as <account/org>, or not authenticated.
   - **Plugin**: up to date, or `v<X> available` (from step 4).
   - **SDK**: installed / not installed; `BITFAB_API_KEY` set / not set; per workspace, `current → latest` when out of date, **and** call out any workspace on the legacy `bitfab` package that should switch to `@bitfab/sdk` (TypeScript, from `renameFrom`).
   - **Instrumented here**: the list of keys with ✅ / ⚠️ / ❓ markers from step 3.
   - **Replay**: ✅ covers all keys / ⚠️ missing keys / ❌ none (from the replay-scripts check in step 4).
   - **Replayable**: ✅ all roots replayable / ⚠️ `<key>` root not replayable / `n/a (nothing instrumented)` (from the per-root replayability check in step 4; flagged whether or not a replay registry module exists for the key; never ✅ when nothing is instrumented).

   Then, for anything not healthy, name the most likely cause and the fix:
   - **Plugin or SDK out of date, or on the legacy `bitfab` package**: apply via the fix prompt below (upgrades the version and/or switches `bitfab` → `@bitfab/sdk`; same effect as `$bitfab:update`).
   - **Replay missing or incomplete**: refresh via `$bitfab:setup replay` (non-interactive; creates/extends scripts to cover every key).
   - **Root not replayable**, two failure modes, with the fix matched to each: **(a) the root takes unserializable inputs** (live SDK/DB clients, HTTP req/res, streams, opaque contexts), with or without a replay registry module: move the trace boundary inward to a serializable-input function or refactor to introduce one; **(b) a bare trace-processor-only key** (OpenAI Agents SDK) whose root is the processor's empty-input span: route the run through the run wrapper (`getOpenAiAgentHandler` / `get_openai_agent_handler`), or add a manual `withSpan`/`@span` root that wraps the run and takes its input. Either way, re-instrument via `$bitfab:setup modify` (or `$bitfab:setup instrument` for a fresh boundary). This is a code change, recommended here, not applied blanket.
   - **Instrumented but no traces**: the app hasn't run with tracing enabled, or `BITFAB_API_KEY` isn't set in the run environment. Run the app (or the replay registry module) with the key loaded.
   - **Key set but traces aren't visible in the browser**: the API key is bound to a different Clerk org/tenant than the browser session. A key resolves `API key → organization_id → clerk_organization_id → Clerk tenant` at creation time; browser visibility requires both to be the same tenant.
   - **Nothing instrumented**: run `$bitfab:setup instrument`.
   - **Want to change what's captured**: run `$bitfab:setup modify`; to see a plan visually, `$bitfab:setup view`.

   Then continue to the fix prompt. Inspect does not open Studio.
6. If the report surfaced anything stale or missing (plugin behind, SDK out of date or on the legacy `bitfab` package, or replay registry modules missing/incomplete), ask the user whether to apply them, each fix is then confirmed individually in the next step (nothing is changed blanket). If everything is healthy, skip the question and go straight to cleanup.

   > A) **Review and apply fixes**: go through each fix one at a time, confirming before any change *(recommended)* → step 7
   > B) **Just report**: make no changes → step 1 of the Cleanup phase
7. **Apply fixes individually, confirm each before changing anything; never bundle them into one blanket change.** Go through only the items step 4 flagged as stale or missing, and for each, ask the user (one decision per question) and apply only if the user approves. Skip any they decline and continue to the next.

   - **Plugin behind**: ask the user to update; if yes, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/update.js" plugin` and remind the user to restart Codex so the new plugin loads.
   - **SDK out of date** (`updateAvailable: true`, `renameFrom` null), name the workspace and the `current → latest` jump, then ask the user to upgrade; if yes, run the package manager's upgrade from that workspace directory (the same commands `$bitfab:update` uses): npm / pnpm / yarn / bun `add @bitfab/sdk@latest`; uv / poetry / pip `bitfab-py@latest`; `bundle update bitfab`; `go get github.com/Project-White-Rabbit/bitfab-go@latest && go mod tidy`. Read the manifest afterward to confirm the new version. Each workspace is its own decision.
   - **On the legacy `bitfab` package** (`renameFrom` non-null), this rewrites import sites, so **preview before touching code**: list every `from "bitfab"` / `require("bitfab")` site you would change, then ask the user to proceed. If yes, remove the old package and add the new one in one step (e.g. `pnpm remove bitfab && pnpm add @bitfab/sdk@latest`, or the npm / yarn / bun equivalent) and rewrite those imports to `@bitfab/sdk`. Do this even when `current` already equals `latest`, the rename is the fix. (TypeScript-only; Python / Ruby / Go package names don't change.)
   - **Replay missing or incomplete**: ask the user to refresh; if yes, run `$bitfab:setup replay` to create or extend the scripts so every trace function key is covered (it is non-interactive).

   For unusual monorepos or private registries, defer to `$bitfab:update`. Report what was applied and what the user declined. Do not open Studio.

## Switch Org

**Run only when mode is `switch-org`.**

Switch which Bitfab organization the plugin reads and writes. Triggered explicitly by `$bitfab:setup switch-org` (or natural-language asks like "switch org" / "change org" / "switch to the <name> org" / "I'm in the wrong org"). The plugin's org is set by the API key in `~/.config/bitfab/credentials.json`; this lists the user's orgs, switches to the chosen one, and replaces that local key. Requires authentication. Does **not** open Studio.

**The live browser does not follow on its own.** Switching persists the new active org server-side (so future sign-ins default to it) and replaces the plugin's key, but a browser tab that's already signed in keeps showing the old org until its session is re-minted. The org actually flips in the browser on the **next** Studio open (a fresh session whose org check runs Clerk's client-side `setActive`) or when the user picks the org from the in-app org switcher.

**The plugin key and the app's runtime key are separate.** Switching replaces only the plugin's credential in `~/.config/bitfab/credentials.json`. The `BITFAB_API_KEY` your application reads at runtime (from a `.env`-style file) is untouched, so traces your code sends keep landing in the **old** org until that key is updated too. The last step offers to do that.

1. Switching orgs requires an authenticated plugin. Run the status check:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/status.js"
   ```

   If **already authenticated**, continue to step 2. If **not authenticated**, tell the user to sign in first with `$bitfab:setup login`, then stop; do NOT run the login flow as part of switching.
2. Call `mcp__Bitfab__list_organizations` to list the organizations the signed-in user belongs to. Each entry has a name, the user's role, an `id:` (the `clerkOrganizationId`), and the org the plugin uses now is marked `[current]`.

   Choose the target org:
   - **If the user already named an org** (in their request), match it case-insensitively by name against the list and use that org's `id`. If the name matches none, or matches more than one, fall through to asking.
   - **If the only org is the current one**, there's nothing to switch to, so tell the user and stop (route to cleanup).
   - **Otherwise** ask the user which org to switch to. List each org by name and role, and mark the current one. Use the chosen org's `id`.

   Only ever use an `id` value returned by `mcp__Bitfab__list_organizations`; never invent one. Carry the chosen id into the next step.
3. Switch to the chosen org by passing its `clerkOrganizationId`:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/switchOrg.js" <clerkOrganizationId>
   ```

   The command prints one JSON line; act on it:
   - `{"event":"switched","status":"switched"|"already-aligned","clerkOrganizationId":"...","organizationName":"...","apiKey":"..."}`: success. The plugin now reads and writes that org and its API key has been replaced locally. Tell the user in one line: the plugin is now connected to **<organizationName>**. Then add that their **already-open browser tabs won't switch on their own**; to see the new org in Studio they re-open it from a plugin action (an experiments or dataset flow) or use the in-app org switcher. Hold on to the `apiKey` value from this JSON; the next step uses it to sync the app's local key, and you must never echo that value to the user.
   - `{"event":"not-member","clerkOrganizationId":"..."}`: the user isn't a member of that org. Report it; do not retry.
   - `{"event":"error","reason":"..."}`: report the reason.

   Do not print or ask for the API key, and do not surface the `apiKey` value to the user; the command replaces the plugin's copy for you and hands you that value solely for the next step.

   - **the command printed `{"event":"switched"}` (or `"already-aligned"`)**: sync the app's local API key next → step 4
   - **the command printed `{"event":"not-member"}` or `{"event":"error"}`**: the plugin key was not replaced, so there is nothing local to sync → step 1 of the Cleanup phase
4. This step is reached only when the switch reported `{"event":"switched"}` (or `"already-aligned"`); a `not-member` or `error` result already routed to cleanup with nothing to sync.

   The switch replaced the **plugin's** key (in `~/.config/bitfab/credentials.json`). It did **not** touch the `BITFAB_API_KEY` your own application reads at runtime, so traces your code sends still land in the **old** org until that key is updated too.

   Check whether this project sets `BITFAB_API_KEY` locally: grep for `BITFAB_API_KEY` across `.env`-style files (`.env`, `.env.local`, `.env.development`, and similar) the app loads. Collect **every** file that assigns it, not just the first.
   - **If none is found**, there's nothing local to update, say so in one line and stop (route to cleanup).
   - **If found**, ask the user whether to update it to the new org's key, naming **all** the files (absolute paths) that hold it. If the user declines, leave them and stop.

   If the user agrees, use the `apiKey` value from the switch step's JSON output as the new key (use it directly, do **not** call any `get_*_api_key` tool here: that resolves a `BITFAB_API_KEY` process-env override ahead of the just-switched credential and can hand back the stale pre-switch key). Rewrite that value in place in **every** file you found, replacing the old value, so no loaded env file keeps a stale key. Do **not** print the key value. Then name each file (absolute path) you updated and note that an already-running dev server, REPL, or test runner may need a restart to pick up the new env value, since most file watchers reload code on save but not env files.

## View

**Run only when mode is `view`.**

Open the trace planner UI for an **existing** trace function, read-only. Triggered explicitly by `$bitfab:setup view`. Useful for inspecting what's currently captured (tree shape, captured node ids, sample inputs/outputs) without making any code edits.

Every View invocation targets **exactly one** trace function. The browser UI's Close control just dismisses the page here, the user is only looking at the plan.

1. **Gather existing trace functions** by searching for SDK patterns (`getFunction("key")`, `get_function("key")`, `bitfab_function "key"`, `WithFunctionName("key")`, plus keyed framework handlers: `getLangGraphCallbackHandler("key")` / `get_langgraph_callback_handler("key")` (or the LangChain-named aliases) and `getOpenAiAgentHandler("key")` / `get_openai_agent_handler("key")` and `getClaudeAgentHandler("key")` / `get_claude_agent_handler("key")` and `getVercelAiMiddleware("key")`; plus trace-processor registrations (unkeyed in code, the key is derived server-side from the workflow name): `getOpenAiTracingProcessor()` / `get_openai_tracing_processor()`). List each key alongside its root function (or, for keys registered only via a framework handler, the handler registration site, handler keys have no decorated root and that is expected). If none are found, tell the user View needs existing instrumentation and suggest `$bitfab:setup instrument`.
2. **Pick exactly ONE trace function to view.** Ask the user with the list of existing keys. Recommend the one the user most recently instrumented (or the one most recently referenced in the current session) and explain why in one line.
3. Call `mcp__Bitfab__get_trace_plan` with `{ traceFunctionKey: "<chosen key>" }` (no `planId`). Two outcomes:

   - **Prior plan found**: parse the response for the `Plan id:` line and hold that id for the next step. Take branch **A** (Open).
   - **"No prior confirmed trace plan found"**: that rules out a *confirmed* plan, not every plan. **Probe `mcp__Bitfab__list_trace_plans` with `{ traceFunctionKey: "<chosen key>", status: "awaiting" }`** before telling the user there is nothing here (a silent probe, don't narrate it):
     - **An awaiting plan came back**: view the newest one. Read it with `mcp__Bitfab__get_trace_plan` `{ planId }`, hold that id **and the fact that it is unconfirmed**, and take branch **A** (Open), saying in one line that this plan is still unconfirmed (an `$bitfab:setup analyze-repo` draft, or a plan whose confirmation never landed) and that `$bitfab:setup instrument` or `$bitfab:setup modify` is what turns it into instrumentation. **An unconfirmed plan is rendered inline only, never opened in Studio** (step 4 says why: its Save button would confirm it, and View must not write).
     - **Nothing came back**: there is genuinely no plan to view (key created outside the skill, or never planned here). Tell the user that and suggest `$bitfab:setup modify` to build and confirm a plan for this key. Take branch **B** (Stop).
4. **Render the trace plan inline as ASCII** from the plan fetched in step 3, using the "Trace Plan Format" reference section (default view: the captured spans, their types, and the tree as recorded). This is read-only, do not edit anything.

   **🚨 If the plan came from the unconfirmed fallback in step 3 (its status is `awaiting`), the inline ASCII is the whole of View: do NOT offer the browser and do NOT run node "${BITFAB_PLUGIN_DIR}/dist/commands/openTracePlan.js".** Studio renders a *confirmed* plan read-only, but an awaiting one still shows its **Save** and **Close** buttons, and both persist a confirmation. Opening one "just to look" would let a read-only mode promote a draft into the key's confirmed plan with no code written to match it, which is the opposite of what View promises. Say that the plan is unconfirmed, that reviewing it for real belongs to `$bitfab:setup instrument` (to wire it up) or `$bitfab:setup modify` (to change it), and stop.

   For a **confirmed** plan, ask the user whether to open it in the browser or finish:

   - **Done**: the inline ASCII was the view; report that the plan was viewed and stop.
   - **View in browser**: open the plan in Studio for a richer read-only look, by running:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/openTracePlan.js" <planId>
   ```

   (`${BITFAB_PLUGIN_DIR}` resolves to the plugin directory; `<planId>` is the id parsed from step 3.) The script emits JSONL to stdout. If it emits `{"event":"window-open-requested","url":"..."}`, immediately surface the URL in a normal chat message, e.g. `Opening Studio: <url>. Click it if a window doesn't appear`, before continuing to poll. (This event means the open was *requested*, not that a window is confirmed on screen; the link is the reliable fallback when nothing surfaces.) `{"event":"session-ready","sessionId":"<uuid>"}` appears once the Studio session is established (on a logged-out run, an `{"event":"auth-required",...}` then `{"event":"authenticated",...}` line precede it, keep waiting for `session-ready`). The script navigates Studio to the trace plan page and stays alive until the user leaves it, by clicking **Close** or by closing the window (up to 30 minutes). View is read-only; however the user leaves (the final JSONL line will be `{"event":"confirmed",...}` or `{"event":"cancelled",...}`), do **not** apply edits or call `mcp__Bitfab__get_trace_plan` again. When the process exits, report that the plan was viewed and stop.

   **Polling (mandatory, see the Blocking-process rule at the top of this skill):** keep polling the live exec session until the process exits. Do NOT wait for a chat message from the user; their dismissal arrives as stdout on the already-running process, not as a new prompt.

## Replay

**Run only when mode is `replay`.**

Create or update replay registry modules for instrumented trace functions. Requires instrumentation in the codebase; does **not** require existing traces, replay registry modules are created from trace function keys in the code, not captured trace data.

The SDK-installed `bitfab-replay` command lets the team regression-test any registered trace function against production data with one command: it fetches historical traces, re-runs them through the current code, and reports old vs. new outputs side-by-side. The project owns only the registry module. Note: **Go does not support replay**: skip this phase if the project is Go-only.

**Relationship to Instrument.** Instrument's write-instrumentation step writes each replay pipeline alongside the instrumentation edits. Run this mode standalone (`$bitfab:setup replay`) to catch pre-existing trace function keys that predate that step or were added outside the skill.

**Source of truth:** two pages, read both before creating or modifying a replay registry module. Do not improvise from memory.
- **Canonical `replay` API signature, options, and return shape:** `/reference/typescript.md`, `/reference/python.md`, `/reference/ruby.md` (Go has no replay). Use this for the exact field names (`result` / `originalOutput` vs `original_output`), default `limit`, `maxConcurrency`/`max_concurrency`, error behavior.
- **Copy-pasteable registry template + installed-command contract + input serialization caveat:** `/typescript-sdk.md`, `/python-sdk.md`, `/ruby-sdk.md`. Use this for the language-specific registry shape and the standard `bitfab-replay --registry <path> <pipeline>` invocation.

1. **Gather all trace function keys** by searching for SDK patterns (`getFunction("key")`, `get_function("key")`, `bitfab_function "key"`, `WithFunctionName("key")`, plus keyed framework handlers: `getLangGraphCallbackHandler("key")` / `get_langgraph_callback_handler("key")` (or the LangChain-named aliases) and `getOpenAiAgentHandler("key")` / `get_openai_agent_handler("key")` and `getClaudeAgentHandler("key")` / `get_claude_agent_handler("key")` and `getVercelAiMiddleware("key")`; plus trace-processor registrations (unkeyed in code, the key is derived server-side from the workflow name): `getOpenAiTracingProcessor()` / `get_openai_tracing_processor()`). This is the source of truth for what replay must cover.
2. **Search for existing replay registry modules**: files matching `scripts/replayRegistry.*`, `scripts/replay_registry.*`, or files defining an SDK `ReplayRegistry` / `defineReplayRegistry` (fall back to direct replay API calls for legacy scripts).
3. **Compare coverage.** Replay is non-interactive once entered, do not ask the user whether to create or add registry modules. Determine which case applies:
   - **All keys already have replay registry entries:** verify one project registry module exports or defines the SDK `ReplayRegistry` / `defineReplayRegistry` and every entry references the exact production root. The SDK-installed `bitfab-replay` executable owns the Replay Output Contract and all common flags; the project module must not invoke a runner or reimplement flags. Legacy expanded scripts should be migrated to a registry-only module. Once every key is registered, proceed to the replayable-root review.
   - **Some keys are missing entries, or no replay registry exists yet:** add the missing entries or create the registry module next.
4. **Create the replay registry module** following the example in the SDK reference's Replay section (`https://docs.bitfab.ai/<language>-sdk.md`), adapted to this codebase. The project file must contain only normal app bootstrap/imports, registry entries, and per-function defaults. It must not invoke a replay runner. The SDK-installed `bitfab-replay` executable loads the module passed through `--registry` and owns argument parsing, progress callbacks, code-change loading, summaries, and result serialization. The non-negotiables are:
   - **Ground the registry in the docs, not memory.** Before writing it, fetch `https://docs.bitfab.ai/reference/<language>.md` for the canonical registry shape, then `https://docs.bitfab.ai/<language>-sdk.md` for the module template and executable command. Quote the exact registry export convention and command in your plan.
   - **For keys with a decorated function in the app: register the decorated function itself, not an undecorated wrapper.** The trace function key is read from the decorator/attribute on the function stored in the registry. A plain closure around the decorated function (for example `(x) => fn(x)`) carries no key and would create a duplicate nested root, so register the decorated function directly. For Python class methods, register `Class.method` or a bound `instance.method`. For Ruby, register the production `receiver` and `method_name`.
   - **Handler-instrumented keys (no decorated function in the app) register an explicit key.** When a key is recorded only via a framework handler (`get_langgraph_callback_handler("key")`, `get_openai_agent_handler("key")`, `get_claude_agent_handler("key")`, `getVercelAiMiddleware("key")`, or the TS equivalents), register the plain callable that re-invokes the same production framework entrypoint, plus the key explicitly (TypeScript `traceFunctionKey`; Python/Ruby `trace_function_key`). The callable receives the recorded root input and reconstructs only the runtime wiring the production entrypoint needs. Every unsafe production action reached through that wiring must remain behind a replay-mockable marked span. Use a no-op only for a genuinely replay-only callback slot with no production action and no recorded call to mock.
   - **Replay root parity (hard rule):** for keys with a decorated or manually wrapped root function, the function stored in the registry must be the exact same exported top-level traced wrapper that production/runtime calls to create the root span. You must do this unless it is genuinely impossible in the host app; inconvenience, extra refactoring, an inline wrapper, or needing to move code is not impossible. If production creates that wrapper inline inside a route, job, handler, callback, or local file scope, extract it into the nearest appropriate service/module, export it, and update both production and replay to import and call that same symbol. Do not replay a convenient inner helper unless that exact helper is also the production root traced wrapper. Avoid duplicate semantic wrappers split across production and replay with names like `runX`, `processX`, or `generateX`. For handler-instrumented keys with explicit-key replay, verify parity against the production keyed handler/run-wrapper entrypoint that re-invokes the same framework entrypoint production calls. If exported-symbol parity is impossible, stop and document the concrete blocker.
   - **Replay root parity verification:** when reporting replay setup completion, include the required final verification section: `Replay root parity:`, `Production root symbol:`, `Production import/path:`, `Replay symbol:`, `Replay import/path:`, `Same symbol? yes/no`, and `If no, why is this impossible?`.
   - **Use the same `Bitfab` client across instrumentation and replay.** Import it from the instrumented module or a shared singleton; never construct a second client inside the registry module.
   - Register every pipeline name with the same client and exact production function/method. Decorated roots supply their trace function key automatically; plain handler roots declare it on the registry entry.
   - The SDK-installed `bitfab-replay` executable supplies `--limit`, `--trace-ids`, `--name`, `--concurrency`, `--code-change`, `--experiment-group-id`, `--dataset-ids` (and its `--dataset-id` spelling), `--grader-ids`, and `--mock`. Never parse or forward these in the registry module.
   - Put only function-specific defaults such as `adaptInputs` / `adapt_inputs`, mock overrides, or database snapshots on the registry entry.
   - **Each registry entry MUST reference the actual instrumented function** (for handler-instrumented keys: a callable that re-invokes the actual framework entrypoint), never a stub or identity function. If historical inputs need reshaping, use the registry entry's input adapter.
   - **Load the app normally.** The registry module imports app code as a library, and the executable loads that module. Use the project's normal env loader around `bitfab-replay` when needed and keep module-scoped clients, config, and models wired as the app expects. This is for dependency resolution and fidelity, not safety.
   - **Handler wiring safety:** synthesize only genuinely replay-only slots with no production action and no recorded call to mock. Every production billing, notification, write, or other unsafe callback must retain its real wiring behind a selected replay-mockable marked span. For factory-created instrumented functions (taking session or stream writers via closure), the wrapper may pass:
     - Stream/socket writers: no-op (`{ write: () => {}, merge: () => {} }`), no client on the other end
     - Session/request identifiers: minimal stub with the fields the function reads
   - **Caveat: watch for module-level import side effects.** Loading the registry transitively runs the app's module initialization before replay interception exists. If that opens listeners, binds ports, or performs unsafe external actions, stop and move those actions behind a replay-mockable boundary.
   - The SDK executable owns the Replay Output Contract, including plugin progress, stderr summary, stdout JSON, and `BITFAB_REPLAY_RESULT_PATH`; do not duplicate any of it.
   - Live in a `scripts/` directory (or the project's existing scripts location)
5. **Legacy instrumentation with a non-replayable root.** First decide whether any instrumented trace function can't be replayed from the replay registry module. Two failure modes: **(1) not invocable**, the function isn't exported or is defined inline in a route handler; **(2) not replayable**, its root takes unserializable inputs (live SDK/DB clients, HTTP `Request`/`Response`, stream writers, sockets, opaque request contexts), so even an invocable call replays with empty or stubbed args. Such functions were introduced before Instrument's trace-boundary serializability requirement, or via another path. Reason from each function's signature and visibility, and where a captured trace exists for the key, compare the signature against the trace data: an empty or `<unserializable: ...>`-stubbed recorded root input confirms the root isn't replayable. Do not execute the script to detect this.

   **Keyed root-handler keys are not affected.** A key registered only via a callback handler or a trace-processor run wrapper (LangGraph / LangChain, OpenAI Agents SDK, Claude Agent SDK, or Vercel AI SDK) has no decorated function by design and records the framework's serializable input as the root; create its pipeline with the key-based replay pattern from step 4 instead of offering these resolutions. **Bare trace-processor-only keys (OpenAI Agents SDK over plain `run()`) ARE affected, not exempt:** the processor records an empty-input root, so a processor-only key with neither the run wrapper (`getOpenAiAgentHandler` / `get_openai_agent_handler`) nor a manual `withSpan`/`@span` root is not replayable. Offer the resolutions below, with "route the run through the run wrapper, or add a manual root that takes the run input" as the fix.

   - **every instrumented function is invocable from the replay registry module and its root is replayable (nothing left to resolve)**: nothing to resolve → step 1 of the Cleanup phase

   If one or more functions can't be invoked or aren't replayable, ask the user offering Instrument's trace-boundary resolutions:

   > A) **Move the trace to an inner function** → step 1 of the Cleanup phase
   > B) **Refactor** *(recommended)* → step 1 of the Cleanup phase
   > C) **Leave as-is**: add a header comment explaining why this one can't be replayed later (it can't be called directly, or it records no inputs to replay from over plain run() with an empty-input root) and flag that the script will rot → step 1 of the Cleanup phase

   **If the user picks "Refactor" (or a boundary move that requires rewriting callers), present a refactor plan labeled as *visibility* or *structural* and get a second confirmation before modifying code (the "Refactor confirmation" rules below say what the plan must contain).**

## DB Snapshot

**Run only when mode is `db-snapshot`.**

Set up **per-trace database snapshots for replay** so the team can re-run a historical trace against the database state that existed *when the trace was captured*, not today's data. This is what makes replay trustworthy for any code that reads stored state (a refund decision over a since-cancelled order, a retrieval step over last week's rows). Triggered explicitly by `$bitfab:setup db-snapshot`, never reached from `wizard`.

**Available for TypeScript, Python, and Ruby** (the SDKs with replay). Go has no replay, so DB-snapshot replay does not apply, if the project is Go, say so and stop.

**Capture is automatic in current SDKs, there is nothing to turn on.** Eligible root traces captured by an SDK version with always-on snapshot references pin the wall-clock instant they ran (no client config required), so those traces can later be replayed against their historical DB state, subject to replication lag. Older traces without a snapshot reference use the normal database path. Setup is therefore just two pieces:
1. **Connect the database once** in the Bitfab dashboard. The source database can be **any Postgres**: Bitfab provisions a branchable managed copy from it. A one-time, dashboard-side step.
2. **Wire replay** to read the per-trace branch URL: pass `dbBranch` to the replay call and, inside the replayed function, connect using the resolved branch's URL instead of your live `DATABASE_URL`.

**Source of truth:** read https://docs.bitfab.ai/db-branching.md (the end-to-end, per-language setup) and your SDK's reference (`/reference/typescript.md`, `/reference/python.md`, `/reference/ruby.md`) for the exact `replay` / branch-accessor signatures before editing any code. The replay option and the accessor names differ per SDK, do not improvise from memory.

1. **Confirm the SDK language.** DB-snapshot replay is available for **TypeScript, Python, and Ruby**. If the project is **Go**, tell the user Go has no replay so this doesn't apply, and route to cleanup.

   **Check authentication.** Run:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/status.js"
   ```

   If it reports not authenticated, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/login.js"` (blocks until the browser login completes), then continue.

   **Locate the replay registry module(s)** you'll edit later: search for files importing/calling the SDK's `replay` (commonly under `scripts/`). If there are **no** replay registry modules yet, tell the user to run `$bitfab:setup replay` first to create them, then come back (route to cleanup), DB-snapshot augments an existing replay registry module, it does not create one from scratch. No client-config edit is needed: snapshot capture is always on, so there is nothing to add to `new Bitfab({ ... })`.
2. Call `mcp__Bitfab__get_database_connection_status` once to read the current state:
   - **`connected`**: the database is already connected and provisioned. Tell the user, and continue to the next step.
   - **`none`**: no database is connected yet. The tool's response includes the exact **Integrations** URL. Relay it to the user and ask them to open it, go to the **Database** section, and paste their Postgres connection string. Provisioning the branchable copy takes a few minutes.
   - **`checking`**: a connection is already provisioning; continue to the wait step.
   - **`failed`**: a previous attempt failed. Point the user back to the Integrations page (Database section) to re-check the connection string, then continue.

   Do **not** ask the user to set any `BITFAB_NEON_*` or `NEON_API_KEY` environment variables, those are Bitfab-side server config, not customer config. The customer only pastes their source Postgres URL in the dashboard.
3. Poll `mcp__Bitfab__get_database_connection_status` until the database is `connected`. Provisioning (source discovery + engine setup) takes a few minutes, so this loops:

   - **status is connected**: the branchable copy is provisioned, continue to wiring replay → step 4
   - **status is checking**: still provisioning, wait ~15s, then re-check → step 3
   - **status is none or failed**: not connected yet, re-surface the Integrations URL, then re-check → step 3

   When the status is `checking`, wait ~15 seconds before calling the tool again, do not hammer it. When it is `none` or `failed`, the user hasn't finished connecting (or it errored); re-surface the Integrations URL, give them a moment, then re-check. Only proceed once it reports `connected`.
4. Update the replay registry module(s) from step 1 so the replayed function connects to the per-trace branch. Ground every edit in https://docs.bitfab.ai/db-branching.md and your SDK's `replay` / branch-accessor reference, fetch the page for the project's language first; the replay option and the accessor names differ per SDK.

   1. **Turn branching on** by passing `dbBranch: true` to the replay call. That branches with the mirror's own sizing; pass an object instead only to tune the branch's compute or warm-up SQL. Use the form for the project's language:

   **TypeScript**: `dbBranch` on the replay options:

   ```ts
   const result = await client.replay("my-function", myInstrumentedFn, {
     limit: 10,
     dbBranch: true,
   })
   ```

   **Python**: `db_branch=`:

   ```python
   result = client.replay(my_instrumented_fn, limit=10, db_branch=True)
   ```

   **Ruby**: `db_branch:`:

   ```ruby
   result = client.replay(
     receiver, :my_method,
     trace_function_key: "my-function",
     limit: 10,
     db_branch: true,
   )
   ```

   2. **Inside the replayed function, connect through the branch URL** instead of your live `DATABASE_URL`. The accessor returns the branch resolved for the item currently running, or null when there is none:
   - **TypeScript:** `const branch = getCurrentReplayBranch()`, then `const url = branch?.databaseUrl ?? process.env.DATABASE_URL`
   - **Python:** `branch = get_current_replay_branch()`, then `url = branch.database_url if branch else os.environ["DATABASE_URL"]`
   - **Ruby:** `branch = Bitfab.current_replay_branch`, then `url = branch ? branch.database_url : ENV["DATABASE_URL"]`

   Always keep the fallback: the accessor is **null** on the normal live request path, and for traces captured before the SDK version that added always-on snapshot capture.

   3. **Resolve the connection per call, not at module/import time.** A pool created once at import (a module-level `Pool` / engine / connection bound to `DATABASE_URL`) will never see the branch URL. If the app pins its DB client at import, refactor so the replayed function can build (or be handed) a client from the branch URL for the duration of the item. Flag this when you spot an import-time pool, it's the most common reason a wired replay still hits production data.

   Leave the live request path untouched: only the replayed function reads the branch. (Optional, TypeScript only: you can pass `dbSnapshot: { provider: "neon" }` to `new Bitfab({ ... })` to pin the provider at capture time. It is **not required**: capture works without it; the provider is otherwise resolved at replay time.)
5. Verify the wiring end-to-end with one **freshly captured, exactly identified** trace. Capture is automatic in current SDKs, but older traces may have no snapshot reference and would use the normal database path, so `--limit 1` is never an acceptable selector here:

   1. Resolve the exact fresh trace ID. Before triggering the instrumented function, call `mcp__Bitfab__search_traces` with `{ traceFunctionKey: "<key>", limit: 10 }` and retain the returned IDs. Record the current timestamp, then run the instrumented function once (or have the user trigger it). Poll the same search once or twice and compare the returned IDs with the before set. Select the ID only when exactly one new root trace has a timestamp after the recorded time. If there are zero new IDs, stop and report that no fresh trace arrived; if concurrent traffic produces more than one candidate, stop and ask the user for the intended trace ID. `search_traces` does not return trace inputs, so never guess based on an assumed input match. Confirm the exact ID is eligible by calling `mcp__Bitfab__search_traces` with `{ traceFunctionKey: "<key>", traceIds: ["<fresh-trace-id>"], hasDbSnapshot: true, limit: 1 }`. If it is absent, do not replay it: report that the fresh trace did not capture a snapshot and diagnose SDK freshness/database connection first.
   2. **Mandatory replay-safety check, before any replay command.** Read the replay registry module, the real production root it imports, and every reachable external-action span. Inventory database writes, outbound mutations, queue publishes, email, payments, filesystem writes, and similar unsafe actions. Confirm each one is behind a manual replay-mockable descendant selected by the script's actual strategy and has a serializable recorded output; `mock: "marked"` requires `mockOnReplay` on that boundary. Confirm the boundary runs in the same replay context: Python worker threads require `trace_across_threads=True`; Python async-generator spans cannot be mocked; Ruby child threads, pre-created consumers, and processes do not inherit replay interception; TypeScript synchronous selected spans cannot use lazy `marked` output and may use `all` only when freezing every matched child is acceptable. Also reject unsafe import-time/module initialization, because it runs before replay interception. Confirm the replay call requests `dbBranch` / `db_branch`. If any unsafe action is unselected, unmockable, outside context, or uncertain, **do not run the smoke test**; report the exact blocker and required boundary change. Mocking, not the app environment, is the safety boundary.
   3. Run the SDK-installed replay command against only the verified ID using `--trace-ids <fresh-trace-id>` (for example, `pnpm with-env bitfab-replay --registry scripts/replayRegistry.ts <pipeline> --trace-ids <fresh-trace-id>`, `poetry run bitfab-replay --registry scripts/replay_registry.py <pipeline> --trace-ids <fresh-trace-id>`, or `bundle exec bitfab-replay --registry scripts/replay_registry.rb <pipeline> --trace-ids <fresh-trace-id>`, with the app's normal environment loader). Never substitute `--limit 1`.
   4. Confirm the branch was injected: inside the replayed function, `getCurrentReplayBranch()` (TypeScript), `get_current_replay_branch()` (Python), or `Bitfab.current_replay_branch` (Ruby) must be non-null. Compare its `databaseUrl` / `database_url` host and database with the app's normal `DATABASE_URL`; they should differ. Print the test run URL from the replay output so the user can open the experiment.

   If the branch accessor is null for a freshly captured trace, check that the source database is connected, that the trace actually carries a snapshot reference, and that the SDK supports always-on capture (upgrade with `$bitfab:update` when needed). Re-check the dashboard Database section in step 2; there is no separate replay-environment active flag.

   Caveats to surface to the user: each branch lease is short-lived (a few minutes) and is created fresh per replay item; the branch reflects the source database's state at the snapshot instant, bounded by replication lag (typically sub-second to a few seconds).

## Templates

**Run only when mode is `templates`.**

Iterate on the **span-rendering templates** for one trace function. Each round: the user describes what should look different, you call `mcp__Bitfab__get_template` → edit → `mcp__Bitfab__save_template` **with `traceFunctionKey` set to the picked key**, and the change renders live against a real trace. That live surface is either the trace view the user already has open (inline mode: every trace view subscribes to `template:updated`, so it re-renders on save without any refresh) or a dedicated chromeless preview page you open for them: step 5 picks between them so the user is never yanked off a trace they're already viewing. Loop until the user is satisfied. Triggered explicitly by `$bitfab:setup templates [<key>]`, never reached from `wizard`.

Templates control how a span's input / output renders in the Bitfab UI. They are scoped per **span type** (`llm`, `agent`, `function`, `guardrail`, `handoff`, `custom`). This phase **always passes `traceFunctionKey`** so edits become **per-function overrides**: they apply only to spans on traces of the picked function, not to other functions in the org. Resolution at render time is per-key row → org-global → file default, so the seed you see in `mcp__Bitfab__get_template` reflects whatever is currently rendering for this function. Surface this scope when the user asks for a change so they know nothing else in the org is affected.

1. If the user passed a key as the argument, use it directly and continue.

   Otherwise, follow the same picker pattern as `$bitfab:assistant`:

   1. Call `mcp__Bitfab__list_trace_functions` to enumerate the org's traced functions. The tool returns flat `FUNCTION: <key>` lines; work from those keys directly. Use **only** the keys returned: do NOT invent or infer descriptions of what each function does from its name. Key names are often ambiguous, and guessing produces hallucinated summaries that confuse the user.
   2. Grep this repo for each key in parallel (across `*.ts`, `*.tsx`, `*.py`, `*.rb`, `*.go`, `*.baml`) so you know which keys are instrumented here. Mark each as ✅ instrumented here (with file path) or ⚠️ not found in this repo.
   3. Present a compact list in the question text showing only: `<key>` · `<repo marker + path>`. No invented summaries.
   4. Ask the user with 2 options: the recommended function (prefer ✅ instrumented here, and matching session context when one is clearly relevant) and a free-text "Type a function key" option. If nothing is instrumented in this repo, say so explicitly in the question, don't hide it.

   - **argument supplied**: use it as the trace function key and continue → step 2
   - **no argument**: list trace functions, ask the user, then continue with the chosen key → step 2
2. Call `mcp__Bitfab__get_template_reference` **once** before any edit. It returns a stable agent-facing schema for Bitfab span templates: the rendering engine (Nunjucks, Jinja2-compatible), the render-context shape (top-level keys, `SpanData` / `ParsedSpanData`), the registered custom filters and tests, common patterns from the live default templates, and error-fallback behavior. Without this you cannot write a correct edit; references to undeclared variables silently render empty in production.

   Hold the reference in your working context for the rest of the loop. Do NOT call it again on subsequent edits.
3. Before opening the preview, grep the codebase for the trace function key (`<key>`) so you can see what the function actually does. The user's "change" requests are usually about surfacing something domain-specific (an input field, a tool name, a context label), and knowing the function helps you map the request to the right span type and the right field path. If grep returns nothing (the function has been renamed or the user is operating on traces from a different repo), continue without it.
4. The preview page renders the most recent trace for the function. Without at least one trace it has nothing to render, so check before opening it.

   Call `mcp__Bitfab__search_traces` with `{ traceFunctionKey: "<key>", limit: 1 }`. If the response contains a trace ID, continue. If the response indicates no traces exist (e.g. `No traces found matching the filter criteria.`), exit and tell the user in one short line: `No traces yet for <key>. Run your app (or the replay registry module) to generate one, then re-run \`$bitfab:setup templates <key>\` to preview.` Do NOT block waiting; the user re-invokes when they have a trace.

   - **trace exists**: continue and choose the preview mode → step 5
   - **no traces yet for this function**: exit and tell the user to generate a trace and re-run → step 1 of the Cleanup phase
5. The edit itself is just `mcp__Bitfab__get_template` → `mcp__Bitfab__save_template`; the only open question is where the user watches the result. **The normal Studio trace view already re-renders on every save** (it subscribes to the same `template:updated` event the preview page does), so if the user is already looking at a trace of `<key>`, you do NOT need to open anything: editing in place keeps their current view and avoids yanking them onto a different page.

   Ask the user with two options. **Recommend inline whenever the context shows the user is already viewing a trace of this function** (e.g. they asked to change templates *while looking at a trace*): that is exactly the case this branch exists to protect.

   1. **Edit against the trace I already have open** (inline): skip the preview entirely. The user's open trace view updates live on each save. You give up the click / focus anchors (you'll ask which span type to edit) and the in-page Close button (the loop ends when the user says they're done).
   2. **Open the live preview page**: launch the chromeless template-preview page, which redirects to the most recent trace for `<key>` and streams click / focus anchors back to you. Prefer this when the user has no trace of this function on screen, or explicitly wants the dedicated preview.

   - **edit inline against the trace already on screen**: skip the preview; edit in place while the user's current view updates live → step 7
   - **open the live preview page**: launch the chromeless preview, then enter the edit loop → step 6
6. Launch the preview command **in the background** so the agent can keep iterating while the page stays open:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/startTemplatePreview.js" <functionKey>
   ```

   Run this in a long-lived exec session (`exec_command` with `is_background: true`); capture the session id so you can `read` it between edit rounds to check whether it has exited.

   If stdout emits `{"event":"window-open-requested","url":"..."}`, immediately surface the URL in a normal chat message, e.g. `Opening Studio: <url>. Click it if a window doesn't appear`, before continuing to poll. (This event means the open was *requested*, not that a window is confirmed on screen; the link is the reliable fallback when nothing surfaces.)

   The command **blocks until the user clicks Done in Studio**, then exits 0 with a single line like `Template preview closed [via studio]`. If the user instead just closes the browser tab without clicking Close, the process keeps running until the 30-minute timeout. The page auto-redirects to the most recent trace for the function and renders it with the org's current templates; it subscribes to SSE `template:updated` events and re-renders the affected span automatically, so the user does NOT need to refresh after each edit.

   🚨 **Stdout is a mixed JSONL + free-form stream.** Two event shapes flow over the same channel as the user interacts with the live preview:

   ```json
   {"event":"click","ts":"...","traceId":"...","spanId":"...","spanType":"...","sectionPath":"metadata","fieldPath":"metadata.tokens","rawText":"1234","selector":"..."}
   {"event":"focus","ts":"...","traceId":"...","spanId":"...","viewMode":"span","expandedSections":["metadata"]}
   ```

   `click` events fire when the user clicks a decorated element. `focus` events fire on initial load, on every span/trace selection change, and on shadow-root `<details>` open / close, so you always know the starting viewport even before any click.

   Free-form text (browser-handoff status lines, errors) goes through the same stdout. **You MUST filter to lines that parse as JSON before routing.** Skip anything that doesn't parse, never error out on non-JSON lines. The click event payload follows the template-anchor catalog returned by `mcp__Bitfab__get_template_reference`; `fieldPath` matches a row there, `sectionPath` matches a section id. Unknown anchor values are omitted (the click handler drops them); `rawText` and `selector` are always present so you can disambiguate. Focus event fields are always present; `spanId` is null when the user is on the trace overview, `viewMode` is `"trace"` or `"span"`, and `expandedSections` lists the `data-section` ids whose `<details>` is currently open.
7. Each round of the loop. **Every `mcp__Bitfab__get_template` and `mcp__Bitfab__save_template` call must include `traceFunctionKey: <key>`** (the key picked in step 1); without it you'd edit the org-global instead of this function's override.

   **Two modes, set by step 5.** In **preview mode** a background process from step 6 is streaming the live page, and you tail it for anchors. In **inline mode** there is no such process: **skip every stdout / background-process instruction below** (step 1 and the process-exit check), drive the loop purely by asking, and rely on the user's already-open trace view re-rendering live on each save.

   1. **(preview mode only) Tail the background process's stdout** for any `{"event":"click",...}` or `{"event":"focus",...}` JSON lines that arrived since the previous round. Parse each line; skip non-JSON status lines.
      - **Most recent click** (if any) is ground truth for "what the user is referring to": its `spanType` is the template to edit, `sectionPath` + `fieldPath` (against the anchor catalog from `mcp__Bitfab__get_template_reference`) tell you which region to change. If `fieldPath` is absent, fall back to `sectionPath` + `rawText`.
      - **Most recent focus** tells you what the user is currently looking at, even without a click. Use it to anchor a question when the user's instruction is ambiguous (e.g. "make this less verbose" while their focus is on a specific span) and to pick the span type when no click is available. Focus is also helpful to confirm in your acknowledgement that you're editing the same span the user is viewing.
      - If neither signal is present since the last round, fall through to step 2 and ask normally.
   2. Ask : **"Tell me how you want your trace data to look and I'll make the changes in Bitfab. You'll see the changes update live in the Bitfab Studio trace view."** (In **preview mode** that live view is the tab opened from here; in **inline mode** it is the trace the user already had open, which re-renders on save. Phrase the sentence to match the active mode rather than always saying "opened from here".) **If there was a click in the previous round, anchor the question to it** by prepending a one-line acknowledgement (e.g. "You clicked the tokens value in metadata."). Keep the framing open-ended, do NOT list the six span types up front; let the user describe what they want and pick the span type from their answer. If the user names one of the six span types (`llm`, `agent`, `function`, `guardrail`, `handoff`, `custom`), use that. If their answer is unambiguous about the rendered region but doesn't name a span type AND there was no click, fall back to which of the six span templates they want to edit. Don't guess the span type from a description like "make this less verbose," since the same description fits multiple templates.
   3. Call `mcp__Bitfab__get_template` with `spanType` and `traceFunctionKey: <key>` to read the **live** content. The response labels its source: `scoped to traceFunctionKey "<key>"` (a per-key row already exists), `org-global override` (no per-key row yet, this is your seed for the first save), or `source: file <name>` (no DB rows at all). **Always** read before write: the prior round may have edited the same template, and overwriting blindly drops that work.
   4. Edit the returned source in-context, **one focused change per round**. Resist the urge to bundle multiple unrelated tweaks into a single save: small steps let the user see each effect land on the preview and redirect mid-loop if the change isn't quite right. Stay inside the documented Nunjucks variables and filters (per the reference). Don't introduce `{% extends %}`; the assembler injects into `base.njk`'s content block, so extends will break composition. When adding new visible regions, **decorate them with the catalog anchors** (`data-section`, `data-field-path`, `data-iter-index`) so future clicks resolve cleanly.
   5. Call `mcp__Bitfab__save_template` with `spanType`, `traceFunctionKey: <key>`, and the full edited body. The tool upserts the per-function row in place (no version bump, no row juggling). On the first save for a span type the row is created; subsequent edits update it. The browser shows a brief "Editing..." status banner while the call is in flight, then a "Saved" flash when it returns, no extra signaling needed from your side.
   6. Acknowledge the save in one short line (e.g. "Saved."). The live view (the preview page in preview mode, or the trace the user already has open in inline mode) subscribes to SSE `template:updated` events and re-renders automatically, so do NOT tell the user to refresh. Do not paste the template body back into chat. After a non-trivial change you may briefly ask  whether the result looks right before starting the next round; for obvious tweaks (a label rename, a colour swap), skip the check and proceed.

   **(preview mode only)** Before asking the user about another change, **check whether the background process from step 6 has exited**. The terminal signal is a line containing `Template preview closed` on stdout (the process exits 0 right after). In **inline mode** there is no background process and no Close button, so this check does not apply: the loop ends only when the user says they're done.

   **Detecting Close is a preview-mode step only; inline mode has no background process, so skip this whole paragraph.** Use `read` against the captured exec session; the `Template preview closed` line on stdout means the user clicked Close and the session has exited. **Use the same read to harvest any new `{"event":"click",...}` and `{"event":"focus",...}` JSON lines for step 1 of the next round.**

   Two ways the loop ends:

   - **preview mode: background process exited (user clicked Close)**: exit the loop and acknowledge that template editing is done → step 1 of the Cleanup phase
   - **user explicitly says they're done (the only exit in inline mode)**: exit the loop and acknowledge → step 1 of the Cleanup phase
   - **user wants another change**: loop back and apply the next edit → step 7

## Analyze Repo

**Run only when mode is `analyze-repo`.**

**This whole phase is non-interactive.** Never ask the user a question, never open Studio, never edit code, and never write a replay registry module. This host shares one tool set across every setup mode, so there is no per-mode permission split here: honoring non-interactivity is on you, run to completion autonomously and never wait for a human. Run it start to finish on your own and end with a printed report. The deliverable is a set of **draft trace plans** uploaded to Bitfab (unconfirmed) that the user can review and confirm later in Studio via `$bitfab:setup view`. If anything blocks you (no auth, no valid candidates), stop and say so plainly rather than prompting.

1. **First, confirm authentication non-interactively.** Call `mcp__Bitfab__get_bitfab_api_key` to retrieve the API key for the plugin's active org. If it returns a key, hold it and continue. If it errors or returns no key, **STOP the whole phase immediately**: this mode cannot run the interactive login (that needs a browser/Studio round-trip). Tell the user to run `$bitfab:setup login` first, then re-run `$bitfab:setup analyze-repo`. Do not prompt, do not retry, do not fall through to scanning.

   **Then detect the project language** (TypeScript, Python, Ruby, or Go). In a monorepo, identify which directories are **applications** (services, APIs, agents) vs **libraries** (SDKs, shared packages) and focus on the application directories. Scan imports and package manifests for supported framework signals, and note which framework each application directory uses:
   - **LangGraph / LangChain**: TS: `@langchain/langgraph`, `@langchain/core`; Python: `langgraph`, `langchain`, `langchain_core`
   - **OpenAI Agents SDK**: TS: `@openai/agents`, `setTraceProcessors`; Python: `agents` (`from agents import ...`)
   - **Claude Agent SDK**: TS: `@anthropic-ai/claude-agent-sdk`, `query(`; Python: `claude_agent_sdk`, `ClaudeSDKClient`, `query(`
   - **BAML**: TS: `@boundaryml/baml`, `baml_client` import; Python: `baml-py`, `from baml_client import b`
   - **Vercel AI SDK**: TS: `ai`, `wrapLanguageModel`, `streamText`, `generateText` (TypeScript only)
2. **First, check the skill invocation arguments for free-text guidance.** Anything after a `guidance:` marker (e.g. `analyze-repo guidance: focus on the billing and checkout flows`) is the user's steer on what to prioritize. When present, let it shape this scan: bias toward the areas, directories, or workflow types the guidance names, and still record other candidates you find so selection can fall back to them. When absent, scan the whole codebase evenhandedly as below. Never treat the guidance as a reason to prompt the user or to skip the non-interactive contract.

   Read the codebase to identify **every** AI workflow, each place the app makes LLM calls, runs agents, or makes AI-driven decisions. In a monorepo, search each application directory separately (a root-level search misses subdirectories). For each workflow, find the **outer workflow boundary** (the function that builds any framework/stateful object, invokes it, and processes the output, e.g. an API handler, message processor, job runner, or pipeline coordinator, almost never the SDK's own `run()`/`invoke()` call), and note the meaningful work **above** it (auth, validation, input prep, retry/orchestration loops, multi-agent coordination), **alongside** it (custom LLM calls outside the SDK, unregistered tools, downstream services), and **below** it (post-processing, parsing, persistence). These become the manual spans around any auto-captured SDK content.

   **Record each candidate's replayability up front, because it drives selection in the next step.** A trace is replayable only if either (1) the boundary's inputs are serializable by the SDK's tracing layer, or (2) the workflow runs on a supported framework integration that records a replayable root (LangGraph / LangChain, OpenAI Agents SDK, Claude Agent SDK, or Vercel AI SDK). Flag boundaries whose natural inputs are **unserializable**: live SDK client instances passed as arguments (`OpenAI`/`Anthropic`/Bedrock clients, configured agents, DB connections, often smuggled inside an options/config bag), HTTP `Request`/`Response`, stream writers, open sockets, browser objects, or genuinely opaque request contexts. Module-scope or closure-captured dependencies do NOT count as unserializable inputs because runtime wiring resolves them without storing them as span arguments; only values passed **as arguments** do. Note, per candidate: the trace function boundary, its input shape and whether it is serializable, and the external state/side effects it touches (DB reads/writes, third-party APIs, queues, blob storage).

   **Also record each candidate's existing instrumentation, so the uploaded plan records (for data tracking, not any UI change) the delta between what's already traced and what's recommended.** Grep each workflow for existing Bitfab SDK usage (`withSpan`, `@span`, `bitfab_span`, `client.Span`, `getFunction`, `get_function`, `bitfab_function`, `WithFunctionName`) the same way Instrument does. For each candidate note whether it is **already instrumented** and, if so: its `traceFunctionKey` (the string passed to `getFunction` / `get_function` / `bitfab_function` / `WithFunctionName`), **which specific functions/calls already sit inside a span** (a hand-written `withSpan`/`@span`, or a framework auto-capture), and **which of those spans are already tagged to serve their recorded output on replay** (the SDK's mock-on-replay marker). This per-node "what's traced now" map feeds the `alreadyTraced` / `alreadyMocked` fields in step 4. A candidate being already instrumented does NOT disqualify it: the plan you upload for it is a diff, not a duplicate.
3. Rank the workflows found in step 2 by tracing value, most valuable first: prefer complex or LLM-heavy workflows, multi-step agents, and high-traffic production paths; deprioritize thin single-call wrappers and anything that only exists to test or explore locally (dev CLIs, notebooks).

   **If the invocation carried free-text `guidance:` (see step 2), let it drive this ranking**: candidates matching the user's steer come first, and only fill the remaining slots with the general value ranking above. Treat the guidance as a strong preference, not a hard filter: if it matches fewer than N candidates, top up from the rest rather than uploading fewer plans.

   **Pick the top N**, where N is the plan cap for this run. Read N from the skill invocation arguments: if they include a `limit=<number>` token (e.g. `analyze-repo limit=3`), use that number; otherwise default to **5**. Pick fewer than N only if fewer valid candidates exist; pick more than N only if several are clearly tied for value and cheap to plan (never exceed N when it was explicitly passed).

   **Resolve serializability without prompting or editing code**, since this mode never refactors:
   - If the natural boundary's inputs are serializable, keep it as-is.
   - If they are unserializable but an obvious **inner** function with serializable inputs exists, move the boundary inward to that function (not a refactor, just a different, already-importable boundary).
   - If the workflow runs on a framework integration that records a replayable root (LangGraph / LangChain, OpenAI Agents SDK, Claude Agent SDK, or Vercel AI SDK), keep it and plan the handler/processor root.
   - If the only cleanly *replayable* boundary would require a **refactor** (extracting/exporting a new function, restructuring call sites), do NOT drop the candidate: plan a **coarser, purely-additive** boundary at the nearest existing function (a root-only span, or a framework handler root) even if its inputs aren't fully serializable, and note in the final report that it needs an interactive `$bitfab:setup instrument` pass to become cleanly replayable. Only **drop** a candidate when there is **no** additive boundary at all - nothing importable or wrappable without editing code. Aim to upload every one of the N selected; dropping should be rare.

   If **zero** valid candidates remain, skip to step 5 and say so.
4. For **each** candidate selected in step 3, build a `TracePlanTree` and upload it with `mcp__Bitfab__save_trace_plan`. This is the same plan construction as an interactive run, **minus the browser confirmation**: do NOT run `openTracePlan.js`, do NOT open Studio, and do NOT ask the user to confirm the plan (skipping the presentation described in the Reference section). Consult the **Trace Plan Format** and **Trace Plan Accuracy** rules in the Reference section below for span-type vocabulary and the tree grammar. Read each candidate's root signature (and any function whose parameter names or return fields the plan references) before building its tree; never guess names.

   Build each plan under the same hard constraint as Instrument: **the tree must describe purely-additive instrumentation.** If a shape would require a behavior change to nest correctly (awaiting a stream that wasn't awaited, reordering calls, blocking a callback), pick a flatter tree (siblings, or fewer captured nodes) instead. For callback-handler SDKs (LangGraph / LangChain, Claude Agent SDK, or Vercel AI SDK) use a handler-only or hybrid plan; for trace-processor SDKs default to a hybrid plan with a keyed root that carries the run input.

   **For each candidate, probe `mcp__Bitfab__list_trace_plans` with `{ traceFunctionKey: "<that candidate's key>", status: "awaiting" }`** and hold what comes back: the plan's id **and its source**. An earlier `$bitfab:setup analyze-repo` run on this repo already drafted plans, and a second draft for the same key does not replace the first, it competes with it: both then show up in the reuse menu, and the user picks between two plans for one workflow. **Probe per key, never once for the whole org:** an unfiltered listing is capped (20 by default, 50 at most) and unpaginated, so on an org with many drafts the older ones fall off the end, and a candidate whose draft was silently missing would get a duplicate created for it, which is the exact failure this probe exists to prevent. Do not narrate the probes.

   Then for every candidate, take the FIRST of these three moves that matches. **They are ordered, not a menu:** the probe returns every awaiting plan for the key whatever its source, so a key can hand you an `interactive` plan and `analyze_repo` drafts at once, and reading the bullets as independent would let the refresh below cancel the very plan the first bullet protects.

   1. **Any awaiting `interactive` plan for the key: skip the candidate entirely.** Touch nothing, not the interactive plan and not the drafts sitting beside it. That plan belongs to a live `$bitfab:setup instrument` or `$bitfab:setup modify` cycle and the user may have it open in Studio right now, so this batch neither overwrites it (their in-flight review would change under them) nor drafts beside it (that is the competing plan this probe exists to prevent). Record it for the report's **Skipped** section as already being worked on interactively.
   2. **Otherwise, one or more awaiting `analyze_repo` drafts: refresh the newest.** Call `mcp__Bitfab__save_trace_plan` with `{ planId, tree, capturedNodeIds }` (the id from the probe). This replaces that draft's tree with the one you just built from current code, root included. Do not pass `language` or `source` on an update. **When the probe returned several, retire the older `analyze_repo` siblings with `mcp__Bitfab__cancel_trace_plan`** and say in one line how many. Keys can already carry duplicates from runs that predate this rule, and refreshing one while leaving the rest reusable means the menu still offers the user two plans for one workflow, which is the whole failure being fixed. **Retire only `analyze_repo` drafts**; this branch is only reached when no interactive plan exists for the key, and it must never widen beyond that.
   3. **Otherwise (no awaiting plan at all): create the draft.** Call `mcp__Bitfab__save_trace_plan` with `{ language, tree, capturedNodeIds, traceFunctionKey, source: "analyze_repo" }`. **Always pass `source: "analyze_repo"`** on these creates so auto-drafted, unconfirmed plans are marked distinctly from interactively-confirmed ones (an interactive run omits `source`, which defaults to `interactive`).

   A key whose only existing plan is **confirmed** counts as no awaiting plan: leave the confirmed one alone (it records what the code captures today) and create a fresh draft beside it. In every case the tree obeys the same rules:
   - Each `TraceNode` carries `id`, `name`, `kind` ("manual" | "auto" | "pure"), `file`, `line`, `signature`, `parentId`, `childIds`, plus `framework` for `[auto]` lines.
   - **Every captured node MUST include `sampleInput` and `sampleOutput`** (realistic values built from the function's parameter and return types, or the SDK's documented response shape); the plan is useless without them.
   - **Every captured node MUST include an `analysis`** (`{ classification, innerCall?, sideEffectKind?, readKind? }`), classified by the node's OWN body (Read it, don't guess from the name), excluding work already in captured children. First match wins: (1) it **is** the model call (an auto model leaf, or a model call inline in this body) → `model_call`; (2) its body mutates external state (DB write, outbound `POST/PUT/PATCH/DELETE`, queue, email, charge, file/vector write) → `side_effect` + `sideEffectKind`, wins over model_call; (3) its body reads external mutable state (DB `SELECT`, outbound `GET`, vector search, cache read) → `external_read` + `readKind`; (4) otherwise → `pure`. **Nested `model_call`s are always a bug**: the leaf that hits the API is the only model call; every wrapper above it (chain `.invoke`, graph node, your orchestrator) is `pure`. **The same no-bubbling rule applies to `side_effect` and `external_read`**: when a node's only write or read lives in a **captured child** (an orchestrator whose body just calls a captured `store.create` / `db.query` / model function), that node excluding the child is `pure` - do NOT bubble the child's `side_effect`/`external_read` up to it. A root or orchestrator is `side_effect` or `external_read` ONLY if its OWN body writes or reads external state outside every captured child; a root whose write/read is captured as a child span is `pure`. Prefer the smallest external boundary: a broad external parent containing parsing, ranking, prompt construction, model calls, or other live code may be forced live by the server so its descendants still run. Do NOT send `mockOnReplay`/summary; the server derives them. Mockable `external_read` and `side_effect` nodes default to mocked replay, except broad external parents with live descendants; `model_call` and `pure` nodes default to live replay.
   - Include surrounding code as `pure` context nodes (callees below each leaf, siblings of each captured node below the root, always descendants of the root, never callers above it or the root's own siblings) so the plan is legible and expandable in the UI. These are NOT in `capturedNodeIds`.
   - `capturedNodeIds` is your recommended capture set and must form a connected sub-tree (selecting a descendant implies its ancestors). `traceFunctionKey` is the key a future Instrument/Modify cycle would wire up.
   - **For an already-instrumented candidate (per step 2), the plan is a DIFF against what's traced now, expressed per node.** Set `alreadyTraced` on **every** node of the tree so the plan is unambiguously a diff: `true` where the code **already** wraps that node in a span today (a hand-written `withSpan`/`@span`, or a framework auto-capture), `false` everywhere else (proposed new spans and untraced context nodes alike). Also set `alreadyMocked: true` on the `alreadyTraced` nodes whose existing span already serves its recorded output on replay. These describe the **current code**, not your recommendation, so keep them independent of `kind` and `capturedNodeIds`. The three interesting cells then fall out: a captured node with `alreadyTraced: false` is a **new span the plan proposes**; an `alreadyTraced: true` node **left out of** `capturedNodeIds` is **existing instrumentation the plan would drop**; a captured `alreadyTraced: true` node is unchanged. Reuse the candidate's **existing `traceFunctionKey`** (do not mint a new one) so the diff lands on the right function. **Omit both fields entirely on greenfield (not-yet-instrumented) candidates** - a plan where no node carries `alreadyTraced` renders as a plain new-instrumentation plan, exactly as today.

   `mcp__Bitfab__save_trace_plan` returns a plan id and a `https://bitfab.ai/studio/trace-plan/<id>` URL (on a refresh, the same id you sent). **Collect the id, trace function key, workflow description, frameworks used, boundary `file:line`, refactor complexity to instrument, suggested methods to capture, methods to mock on replay, and real-data improvement for each candidate, but do not print plan URLs in the final report.** Process candidates independently: if one fails to build or upload, record the failure and continue with the rest, do not abort the batch. You may optionally read a plan back with `mcp__Bitfab__get_trace_plan` to confirm it persisted.
5. Print one plain-markdown summary (no `AskUserQuestion`). Lead with a one-line count that separates the two kinds of write, because a re-scan of a repo that was analyzed before is mostly the second: "Uploaded N draft trace plans" when they are all new, otherwise "Uploaded N draft trace plans and refreshed M existing ones" (say only the half that happened). Then a table or list with one row per plan:
   - **trace function key**;
   - **description of workflow**: one short phrase naming what the workflow does;
   - **frameworks used**: AI framework(s) and important backing systems visible in the workflow (for example LangGraph, OpenAI Agents SDK, Vercel AI SDK, BAML, Postgres, Redis, S3);
   - **refactor complexity to instrument**: exactly one of `None`, `Low`, `Med`, or `High` (implementation effort, not a capture setting);
   - **suggested methods to capture**: comma-separated function/method names from the proposed plan, not prose;
   - **methods to mock on replay**: count plus concise method/span names that should be mocked during replay because they read/write external mutable state or call third-party services;
   - **how this feature would improve by running real data through it**: one sentence focused on the product/debugging value of real traces.

   For already-instrumented candidates, include the diff delta when applicable: how many new spans the plan recommends and how many already-traced spans it would drop.

   **Do not print plan URLs. Do not add a `Notes` section.** After the list, add one compact footer line: "Draft only: no code changed. Review with `$bitfab:setup view`, then run `$bitfab:setup instrument`." If any plan used a coarser boundary because the cleanly-replayable one would need a refactor, add one short line naming the affected trace key and saying it needs an interactive instrument pass. If any candidates were **dropped** (no additive boundary at all, nothing wrappable without editing code), **failed to upload**, or were **left to a live interactive cycle** (an awaiting non-`analyze_repo` plan already exists for that key, per step 4), include a **Skipped** section with one bullet per candidate and a one-line reason, so the user can follow up interactively.

   If preflight found no auth, or selection found zero valid candidates, this report is just that single explanatory message.

## Cleanup

1. Close Studio. Run this unconditionally: it resolves the active session from disk, closes the Studio tab (the daemon ends the session and stops appending to the event file), and exits quietly (`{"event":"no-active-studio"}`) when nothing was opened:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/closeStudio.js"
   ```

   No sessionId argument is needed; do not track or look up one. This is silent housekeeping: never narrate it, reason about whether a session was opened, or report the outcome to the user (no "closing Studio", no "nothing to close").

## Refactor confirmation (applies to Instrument's workflow-selection step, Replay's non-replayable-root step, and any write-instrumentation step that turns out non-additive)

Whenever the user picks "refactor to extract a pure core" (or any option that modifies existing functions/call sites, not just adds new wrappers), you must:

1. **Build a refactor plan** listing:
   - **Flavor**: **visibility** (extract + export, logic unchanged) or **structural** (new pure-core fn with serializable inputs, may require callers to construct them). Most cases are visibility.
   - **Source**: the function(s) that will be modified, with file path and current signature
   - **Extraction**: the new function name, its signature, and (for visibility refactors) an explicit note that the logic moves unchanged
   - **Trace wrap**: which function will carry the `getFunction(...)` / SDK trace wrap after the refactor
   - **Call sites**: every caller that will be rewritten, with file path and line range

2. **Present the plan verbatim** to the user, in the same format above.

3. **Ask the user** with exactly two options:
   - **"Apply refactor"**: proceed to write the changes
   - **"Cancel"**: return to the previous choice prompt (Instrument's workflow-selection (a)/(b)/(c), or Replay's non-replayable-root three-option prompt) so the user can pick a different resolution

Never modify existing code on a refactor path without completing this three-step confirmation. Adding new instrumentation wrappers to unchanged functions is not a refactor and does not need this confirmation (purely-additive instrumentation). But if the write-instrumentation step itself turns out to require modifying, re-implementing, or hand-reconstructing an existing call to seat a root (the wrap is not actually additive), that IS a refactor: stop and run this three-step confirmation before touching the code.

## Reference

These sections are consulted during the Instrument phase, not executed sequentially.

### Trace Plan Format

The trace plan is a strict format. Do not improvise, follow the legend, grammar, and template selection rule below. When in doubt, copy the matching canonical example verbatim and substitute names.

#### Legend

| Symbol | Meaning | Where it appears |
|---|---|---|
| `●` | Instrumented span | Default + Expanded + Processor views |
| `○` | Skipped function (not instrumented) | Only when the expand modifier is applied (on top of any base template) |
| `[root]` | Literal label for the trace function entry point | Always, on its own line above the tree |
| `[loop]` | Control-flow group: children execute in a loop | Inside the tree, in place of a span |
| `[branch]` | Control-flow group: children are conditional branches | Inside the tree, in place of a span |
| `[parallel]` | Control-flow group: children execute concurrently | Inside the tree, in place of a span |
| `[auto]` | Auto-captured by a trace processor, no manual instrumentation | Trace-processor view only |
| `(function)` `(llm)` `(tool)` `(agent)` `(handoff)` | Span type annotation | Immediately after every `●` span name |

Brackets `[…]` are structural labels (not spans). Parens `(…)` are span type annotations (only on `●` lines).

#### Grammar rules

1. **Header line**: exactly: `Trace function: "<trace-function-key>"` followed by one blank line.
2. **Root**: the next line is the literal `[root]`, with no symbol prefix.
3. **Tree body**: uses box-drawing characters only:
   - `├─` for every child except the last
   - `└─` for the last child
   - Children of a `├─` node indent with `│  ` (pipe + two spaces)
   - Children of a `└─` node indent with `   ` (three spaces, no pipe)
4. **Span lines**: `<prefix>● <name> (<type>)`. Type annotation is **required** on every `●` line.
5. **Skipped lines**: `<prefix>○ <name>`. No type annotation, no description.
6. **Control-flow lines**: `<prefix>[loop]` / `[branch]` / `[parallel]`. They take children but have no symbol and no type.
7. **Footer**: one blank line, then one or both of:
   - `Files changed:` followed by a numbered list, every file the cycle will touch. This always includes the replay registry module path for non-Go projects (`scripts/replayRegistry.ts`, `scripts/replay_registry.py`, or `scripts/replay_registry.rb`, new or edited per step 11b) alongside any instrumented source files. Go-only projects list only the instrumented source files.
   - `Setup: <one-line setup description>` (any plan that registers a trace processor)
   Hybrid plans (manual spans + processor) include both, with `Setup:` first then `Files changed:`. A pure-processor plan still lists `Files changed:` because the processor-registration file is edited and the replay registry module (non-Go) is written. Go-only pure-processor plans with a single registration file and no manual spans may include only `Setup:` plus that one file under `Files changed:`.
8. **No descriptions, no counts, no parameter details, no blank lines between siblings, no trailing whitespace.**
9. **One trace function per plan.** A trace plan describes exactly one trace function, exactly one `Trace function: "..."` header, exactly one `[root]`, exactly one tree, exactly one `Files changed:` section. If the cycle would require instrumenting two trace functions, that's two cycles, not one plan with two trees.

#### Which template to use (precedence, check top to bottom, stop at first match)

Pick the **base template** from SDK capability and surrounding work:

1. **Trace processor (hybrid) template**: if the SDK guide says to register a processor (e.g. OpenAI Agents SDK `addTraceProcessor`) AND there is meaningful work above, alongside, or below the SDK call. The trace function root wraps the broader workflow with manual `●` spans; the SDK call appears as one `(agent)` child whose grandchildren are the `[auto]` lines; other manual spans capture work outside the SDK. This is the default for any trace processor SDK whenever there's surrounding workflow logic, which is almost always. **The root must take the workflow's serializable input as its argument (the prompt / messages / request), because replay re-runs that root against its recorded input. A bare processor call (plain `run()`) with neither a root wrapper nor a manual root records a root span with no input (the agent span carries no recorded input) and is not replayable; the manual `withSpan`/`@span` root is what makes the broader trace replayable.**
2. **Trace processor (bare) template**: when the workflow truly is *just* the SDK call with no surrounding work. Use the run wrapper (`getOpenAiAgentHandler` / `get_openai_agent_handler`) in place of the plain run call: it records a keyed root carrying the run input, and the processor's auto-captured children nest underneath as `[auto]` lines, so the bare workflow is **replayable with no hand-written root**. **A plain `run()` under the processor alone records an empty-input root (the agent span carries no recorded input): observable but NOT replayable: only acceptable when the user has explicitly accepted an observable-only trace for this workflow.** Confirm before using this, if the workflow has any input prep, orchestration, retries, post-processing, or non-SDK LLM/tool calls, use the hybrid template instead.
3. **Default view**: every other case (no processor in play). This is the recommended default for SDKs without a processor.

Then apply the **expand modifier**, orthogonally:

- If the user explicitly asks for more detail ("show details", "expand", "include skipped") or selects "Expand details" from the choice prompt preview, add `○` skipped lines to whichever base template was picked. Never drop `[auto]` lines when expanding a processor template, skipped lines and auto-captured lines coexist in the tree. Without an explicit ask, do not add skipped lines.

Never mix base templates beyond the hybrid pattern. Never invent a fifth variant.

#### Canonical examples (copy-edit-substitute, do not restructure)

**Default view**: instrumented spans only:

```
Trace function: "<trace-function-key>"

[root]
● outerFunction (function)
├─ ● llmCall (llm)
└─ [loop]
   ├─ ● anotherLlmCall (llm)
   └─ ● refinementCall (llm)

Files changed:
  1. client.ts
  2. pipeline.ts
```

**Default + expand modifier**: adds skipped (○) functions in true execution order. The same modifier applies to processor templates (hybrid or bare) when the user asks for expansion, `○` lines coexist with `[auto]` lines in that case:

```
Trace function: "<trace-function-key>"
● instrumented   ○ skipped

[root]
● outerFunction (function)
├─ ○ helperFormat
├─ ● llmCall (llm)
└─ [loop]
   ├─ ○ evaluateBatch
   ├─ ○ calculateScore
   ├─ ● anotherLlmCall (llm)
   ├─ ● refinementCall (llm)
   └─ ○ evaluateBatch

Files changed:
  1. client.ts
  2. pipeline.ts
```

The legend line `● instrumented   ○ skipped` appears **only** in the expanded view, immediately under the header.

**Trace-processor (hybrid) view**: workflow with manual spans wrapping auto-captured agent internals (default for processor SDKs):

```
Trace function: "handle-user-request"

[root]
● handleUserRequest (function)
├─ ● validateAndPrepareInput (function)
├─ ● runAgent (agent)
│  ├─ LLM calls    [auto]
│  ├─ tool calls   [auto]
│  └─ handoffs     [auto]
├─ ● scoreAgentOutput (llm)
└─ ● persistResult (function)

Setup: addTraceProcessor(processor) registered at startup
Files changed:
  1. handler.ts
  2. tracing/setup.ts
```

The `[auto]` lines are auto-captured spans, the processor emits them inside the SDK call without manual instrumentation. They use `├─`/`└─` like normal children but carry no `●`/`○` symbol because you're not writing the span yourself. Manual `●` spans wrap the broader workflow above, alongside, and below the SDK call.

**Trace-processor (bare) view**: only when the workflow IS just the SDK call:

```
Trace function: "my-agent"

[root]
● runAgent (function)
├─ LLM calls    [auto]
├─ tool calls   [auto]
└─ handoffs     [auto]

Setup: addTraceProcessor(processor) registered at startup
```

Use this **only** when there is genuinely no work above, alongside, or below the SDK call. If there's any input prep, orchestration, retry, post-processing, or non-SDK LLM/tool call, use the hybrid view instead.

#### Anti-examples (do NOT do these)

- ❌ `* outerFunction (function)`, use `●`, never `*` or `-` or `•`
- ❌ `● outerFunction`, type annotation is mandatory on every instrumented span
- ❌ `● outerFunction (function), calls the LLM with retries`, no descriptions, no em dashes
- ❌ `● outerFunction (llm-call)`, only the listed types are valid; do not invent new ones
- ❌ `[Root]` or `[ROOT]`, literal label is lowercase `[root]`
- ❌ Mixed indentation widths (2 spaces in one branch, 4 in another)
- ❌ Blank lines between siblings inside the tree
- ❌ Omitting `Files changed:` from any plan that has manual `●` spans (hybrid trace-processor plans MUST include both `Setup:` and `Files changed:`)
- ❌ Defaulting to the bare trace-processor view when the workflow has work above, alongside, or below the SDK call, use the hybrid view and add manual spans
- ❌ Putting the SDK's agent call (e.g. `runAgent`, `Runner.run`) at `[root]` when the actual workflow has a clear outer function, the workflow function is the root, the SDK call is a child
- ❌ Inventing extra sections like `Notes:` or `Estimated coverage:`
- ❌ Two `Trace function: "..."` headers in one plan, split into two cycles
- ❌ `● someFn (llm)   ← description here`, no inline descriptions, arrows, or trailing commentary on span lines
- ❌ `● <kind>DocumentCreate (llm)`, no placeholder/template span names; expand to concrete spans (e.g., three siblings, or under a `[branch]`)
- ❌ `Files changed` without the trailing colon
- ❌ `1. lib/bitfab.ts (new), Bitfab client + exported pipelines`, file entries are paths only, no annotations or descriptions
- ❌ Recommending an approach that requires "a tiny behavior change", disqualified at trace plan construction; restructure the tree instead

#### Presentation step

After building the plan and posting it with `mcp__Bitfab__save_trace_plan`, render it inline as ASCII (rules above), then ask the user:
- **View in browser** (recommended), open the plan in Studio to review and adjust the captured set
- **Continue**, accept the plan as rendered inline and proceed (no Studio round-trip)
- **Expand details**: re-render the ASCII using the expanded view template
- **Adjust**: user wants changes; ask what, then rebuild the tree and save it back onto the SAME plan with `mcp__Bitfab__save_trace_plan` `{ planId, ... }`. Adjusting revises the plan the user is looking at; it never posts a second plan for the key.

### Trace Plan Accuracy

Read function signatures when the trace plan will reference their parameter names or return fields. Skipped leaf functions can be named from grep results if their shape isn't exposed in the plan. Never guess names that appear in the plan.
