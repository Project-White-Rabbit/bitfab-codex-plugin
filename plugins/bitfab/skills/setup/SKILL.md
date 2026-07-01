---
name: setup
description: "Set up and maintain Bitfab tracing for AI features. TRIGGER when: user wants to set up Bitfab, instrument code, add tracing/observability for LLM or agent calls, observe AI calls, add evaluation, trace LLM functions, trace a new workflow, change what an existing trace captures, re-instrument an existing traced function (move a database read or other side effect in or out of a span, change what a span records as its input/output), inspect or debug their tracing setup (what's instrumented, why traces aren't showing up), or understand what Bitfab is; or says anything like 'instrument', 'add tracing', 'trace my code', 'set up observability', 'hook up Bitfab', 'start tracking', 'trace a new workflow', 'update my tracing setup', 're-instrument', 're-instrument <function>', 'move the database read out of the span', 'make this trace replayable without a database', 'change what this span records as input', 'why aren't my traces showing up', 'what is Bitfab', 'set up database snapshots', 'replay against my database state at trace time'. SKIP when: user is (a) improving the QUALITY of a traced function's outputs, fixing failures, pass rates, labeling, running experiments (use bitfab:assistant); or (b) upgrading the plugin/SDK to a newer *version* (use bitfab:update).. Invoke with $bitfab:setup [wizard|explain|login|instrument|modify|inspect|switch-org|view|replay|db-snapshot|session-logs|templates] [<what to do>]."
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

**Studio gate recovery (applies to every Studio-opening command).** Any command that opens or navigates Studio (`openTracePlan.js`, `startTemplatePreview.js`, etc.) emits `{"event":"not-responding","sessionId":"..."}` and exits non-zero when a Studio session is recorded but its window can't be reached (a crash, sleep, or a close no process witnessed). It will NOT open a duplicate window. **This is a gate, not a failure to retry blindly.** Recommend the user refresh or reopen the Studio tab, then ask the user with two options: **Try again** (re-run the same command, the record is still on disk, so a window that came back gets reused) or **Open a new Studio** (run `node "${BITFAB_PLUGIN_DIR}/dist/commands/clearStudioSession.js"` to drop the stale pointer, then re-run the command, which now opens a fresh window). Only clear the pointer after the user approves.

**Studio URL surfacing (applies to every fresh Studio open).** If any Studio-opening command emits `{"event":"window-opened","url":"..."}`, immediately surface that URL to the user in a normal chat message (for example, `Studio opened: <url>`) so it is copyable from the transcript. Do this every time the event appears, even if the browser opened successfully; do not leave the URL only in shell/tool output.

**🚨 Blocking-process rule (applies to any plugin command described as "blocks until the user does X"):** When you launch a plugin CLI that blocks on a Studio interaction (`login.js`, `startDataset.js`, `openTracePlan.js`, etc.), you MUST keep the exec session alive and keep polling it until the process exits on its own.

- The process opens Studio (or navigates an existing Studio session) and polls for the user's action via agent session events. It exits only after the user completes the action in Studio (or after the timeout).
- After launching the command, keep polling the live shell/exec session every few seconds with your normal "read more output" tool. Do not idle waiting for a user message.
- The user's confirmation does NOT come back as a chat message; it comes back as the plugin process exiting with output on stdout.
- Stop polling only when: (a) the process exits 0 with its completion summary, (b) the process exits non-zero, or (c) the user explicitly cancels.
- When the process exits, immediately continue with the next step, do not wait for another user message.

This skill has eleven phases: **explain**, **login**, **session-logs**, **instrument**, **modify**, **inspect**, **switch-org**, **view**, **replay**, **db-snapshot**, and **templates**. Run individually or all at once (`wizard` runs login → instrument → replay; `explain` is a standalone read-only overview that requires no login; `session-logs` is standalone and does not require login; `modify` is only invoked explicitly or as a branch from Instrument's existing-SDK-usage menu; `inspect` is a standalone diagnostic (with optional one-shot fixes) invoked explicitly; `switch-org` is a standalone account action (requires auth) invoked explicitly; `view` is only invoked explicitly; `db-snapshot` is only invoked explicitly; `templates` is only invoked explicitly).

**Natural-language aliases (these reuse an existing mode, not a separate one):** "explain Bitfab" / "what is Bitfab" → `explain`; "trace a new workflow" / "instrument a new flow" → `instrument`; "update-setup" / "update my tracing setup" / "adjust what's captured" → `modify` (NOT a plugin/SDK *version* bump, that's `$bitfab:update`); "debug-setup" / "debug my tracing setup" / "inspect my tracing" / "why aren't my traces showing up" / "what's instrumented" → `inspect` (for output-*quality* debugging use `$bitfab:assistant` instead); "switch org" / "change org" / "switch to the <name> org" / "I'm in the wrong org" → `switch-org`; "set up db snapshots" / "set up db branching" / "replay against my database" / "replay against the database at trace time" / "database snapshots for replay" → `db-snapshot`.

Within an Instrument cycle, **instrumentation and the replay pipeline for the cycle's trace function are written together in the same cycle** once the trace plan is confirmed (see Instrument's write-instrumentation step). The Replay phase in `wizard` mode is therefore a coverage-verification/backfill sweep, it typically finds every key already wired up.

**Before running plugin commands below**, resolve `BITFAB_PLUGIN_DIR` in the shell. Codex does not inject a plugin-root env var, so you must determine it. Copy and run this block verbatim, it auto-detects whichever install is active (dev, prod, or a custom `CODEX_HOME`):

```bash
BITFAB_PLUGIN_DIR=$(
  hit=$(find "${CODEX_HOME:-$HOME/.codex}/plugins/cache" -maxdepth 6 -type f -name status.js \
    \( -path '*/bitfab-internal/bitfab/local/dist/commands/*' \
    -o -path '*/bitfab/bitfab/*/dist/commands/*' \) 2>/dev/null | head -1)
  echo "${hit%/dist/commands/status.js}"
)
export BITFAB_PLUGIN_DIR
test -n "$BITFAB_PLUGIN_DIR" && echo "Found: $BITFAB_PLUGIN_DIR" || echo "ERROR: Bitfab plugin not installed"
```

If the block prints `ERROR: Bitfab plugin not installed`, the user hasn't installed the plugin yet, stop and tell them to add the marketplace. Otherwise proceed. The cache path includes a trailing `local` for dev installs and `<version>` for prod installs; the commands live at `$BITFAB_PLUGIN_DIR/dist/commands/*.js`.

**SDK reference:** https://docs.bitfab.ai is the source of truth for SDK install, initialization, API surface, and replay. Every docs path below ends in `.md`: that suffix returns the page as plain markdown (no HTML chrome), so fetch the URLs exactly as written. Fetch in this order before writing any code, do not improvise from memory:
- **Canonical API surface (preferred for agents):** the dense reference pages at `/reference/typescript.md`, `/reference/python.md`, `/reference/ruby.md`, `/reference/go.md`. These list every public export, signature, type, default, and error semantic, no tutorials, no prose. Read these first.
- **Cross-SDK shared semantics:** `/reference/overview.md` (invariants), `/reference/span-types.md` (the `SpanType` enum), `/reference/http.md` (wire protocol).
- **Framework integrations (fetch when a framework is detected in step 1 of Instrument):** `/frameworks/langgraph.md`, `/frameworks/openai-agents.md`, `/frameworks/claude-agent-sdk.md`, `/frameworks/baml.md`, `/frameworks/vercel-ai-sdk.md`. Each page documents the SDK's native handler/processor/wrapper for that framework, which is usually preferable to hand-wrapping every node/agent call with `withSpan`/`@span`.
- **Tutorials / walkthroughs / replay script template:** the language-specific guide pages (`/typescript-sdk.md`, `/python-sdk.md`, `/ruby-sdk.md`, `/go-sdk.md`). Use these for the copy-pasteable replay script and the replay output contract. During Instrument, fetch the Replay section before Instrument's write-instrumentation step so the replay script can be written alongside the instrumentation in the same cycle without re-fetching.

**MCP tools:** This skill uses `get_bitfab_api_key`, `create_trace_plan`, and `get_trace_plan` (login / instrument / modify / view), `list_trace_functions` and `search_traces` (`inspect` and `templates`), `list_organizations` (`switch-org`), `get_database_connection_status` (`db-snapshot` only), and, for the `templates` mode only, `get_template_reference`, `get_template`, and `update_template`. All come from the **local plugin MCP server** (bundled with this plugin), exposed under the `mcp__Bitfab__*` prefix.

| Invocation | Action |
|---|---|
| `$bitfab:setup` or `$bitfab:setup wizard` | Run login, then instrument + replay (together per workflow) |
| `$bitfab:setup explain` | Explain what Bitfab is and what each mode does (read-only, no login) |
| `$bitfab:setup login` | Authenticate for setup/instrumentation (Studio/assistant flows log in inline, no pre-login) |
| `$bitfab:setup instrument` | Instrument AI workflows with Bitfab tracing |
| `$bitfab:setup modify` | Modify an existing trace setup (add context, change depth, or move the root) |
| `$bitfab:setup inspect` | Diagnose (and offer to fix) your tracing setup: auth, what's instrumented, plugin/SDK freshness, replay coverage, trace arrival |
| `$bitfab:setup switch-org` | Switch which Bitfab org the plugin reads and writes (replaces the local API key) |
| `$bitfab:setup view` | Open the trace planner UI for an existing trace function (read-only) |
| `$bitfab:setup replay` | Create or update replay scripts for instrumented workflows |
| `$bitfab:setup db-snapshot` | Set up per-trace database snapshots so replay runs against the DB state at trace time (TypeScript, Python, Ruby) |
| `$bitfab:setup session-logs` | Opt in or out of session log collection (no login required) |
| `$bitfab:setup templates [<key>]` | Iterate on the span-rendering templates for one trace function |

**CLI commands** available via Bash (all paths relative to `${BITFAB_PLUGIN_DIR}/dist/commands/`):

| Command | Description |
|---------|-------------|
| `status.js` | Check plugin authentication and connection status |
| `login.js` | Authenticate for setup/instrumentation; standalone browser OAuth (blocks). Studio, dataset, and experiment flows log in inline and need no pre-login. |
| `switchOrg.js [<clerkOrganizationId>]` | List the user's Bitfab orgs (no args), or switch the plugin's active org and replace the local API key (with a <clerkOrganizationId> arg) |
| `openTracePlan.js <planId>` | Open the trace plan confirmation UI in Studio (blocks until user confirms or cancels) |
| `waitForTrace.js <trace-function-key>` | Poll for the first trace to arrive (blocks up to ~10 min) |
| `startTemplatePreview.js <functionKey>` | Open the template editor preview in Studio (blocks until user clicks Done) |
| `closeStudio.js [message]` | Close the active Studio session (tab + background event process); no-op when nothing is open |
| `clearStudioSession.js` | Clear the stale active-Studio pointer so the next open starts fresh |
| `update.js <mode>` | Check plugin + SDK versions and install the latest (used by inspect to detect and fix staleness) |
| `sessionLogConsent.js [get|set true|set false]` | Read (`get` prints `true`/`false`/`null`) or persist (`set true|false`) the global session-log consent flag |

## Preamble

**Run only when mode is `wizard`.**

1. Render the block below **verbatim** as a single message, then continue straight to Login. Do **not** ask for confirmation, do **not** ask any extra questions, do **not** summarize in your own words.

   ```
   Bitfab captures what your AI code does, turns runs into reusable datasets, and verifies fixes by replaying them against real data.

   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
   │   CODE   │───▶│  TRACES  │───▶│ DATASETS │───▶│ IMPROVE  │
   │          │    │ (what it │    │(reusable │    │ (edit +  │
   │          │    │   did)   │    │test set) │    │ verify)  │
   └──────────┘    └──────────┘    └──────────┘    └──────────┘

   Primitives
     • Trace  , a recording of one workflow run (inputs, outputs, every step inside).
                 Ground truth for what your code actually did.
     • Dataset, a curated collection of traces (failures, a specific workflow, custom).
                 The reusable test set your changes get measured against.
     • Replay , a tool that re-runs a dataset through your current code.
                 Turns production data into a ready-made regression test.

   Setup runs in two phases:
     1. LOGIN                , authenticate (15s, browser)
     2. INSTRUMENT + REPLAY  , written together per workflow:
        • INSTRUMENT         , wrap your workflows with tracing (purely additive)
        • REPLAY             , generate a replay script for your trace functions
   ```

   Then proceed to Login.

## Explain

**Run only when mode is `explain`.**

Explain what Bitfab is and how this skill is organized. Read-only, no authentication, no code changes, no Studio. Triggered explicitly by `$bitfab:setup explain` (or natural-language asks like "what is Bitfab" / "explain Bitfab").

1. Render the overview below **verbatim** as a single message, then stop. Do **not** authenticate, scan the codebase, ask any questions, or take any further action, `explain` is purely informational.

   ```
   Bitfab captures what your AI code does, turns runs into reusable datasets, and verifies fixes by replaying them against real data.

   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
   │   CODE   │───▶│  TRACES  │───▶│ DATASETS │───▶│ IMPROVE  │
   │          │    │ (what it │    │(reusable │    │ (edit +  │
   │          │    │   did)   │    │test set) │    │ verify)  │
   └──────────┘    └──────────┘    └──────────┘    └──────────┘

   Primitives
     • Trace  , a recording of one workflow run (inputs, outputs, every step inside).
                 Ground truth for what your code actually did.
     • Dataset, a curated collection of traces (failures, a specific workflow, custom).
                 The reusable test set your changes get measured against.
     • Replay , a tool that re-runs a dataset through your current code.
                 Turns production data into a ready-made regression test.

   What you can run
     $bitfab:setup            Login, then instrument + replay (the full setup)
     $bitfab:setup explain    This overview (read-only)
     $bitfab:setup login      Authenticate with Bitfab
     $bitfab:setup instrument Wrap a new AI workflow with tracing
     $bitfab:setup modify     Adjust what an existing trace captures
     $bitfab:setup inspect    Diagnose + fix setup: auth, what's instrumented, SDK/plugin current, replay coverage, traces arriving
     $bitfab:setup switch-org Switch which org the plugin reads and writes
     $bitfab:setup view       Open one trace function's plan in the browser (read-only)
     $bitfab:setup replay     Create or update replay scripts
     $bitfab:setup templates  Change how a trace function's spans render
     $bitfab:setup session-logs  Opt in/out of session log collection
   ```

   Then close with one line: to start tracing, run `$bitfab:setup`; to debug an existing setup, run `$bitfab:setup inspect`.

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

1. **Detect the project language** (TypeScript, Python, Ruby, or Go). In a monorepo, identify which directories are **applications** (services, APIs, agents) vs **libraries** (SDKs, shared packages). Focus on application directories. Also scan imports and package manifests for supported framework signals, and note which framework each application directory uses, step 5 fetches the matching framework page alongside the language reference:
   - **LangGraph / LangChain**: TS: `@langchain/langgraph`, `@langchain/core`; Python: `langgraph`, `langchain`, `langchain_core`
   - **OpenAI Agents SDK**: TS: `@openai/agents`, `setTraceProcessors`; Python: `agents` (`from agents import ...`)
   - **Claude Agent SDK**: TS: `@anthropic-ai/claude-agent-sdk`, `query(`; Python: `claude_agent_sdk`, `ClaudeSDKClient`, `query(`
   - **BAML**: TS: `@boundaryml/baml`, `baml_client` import; Python: `baml-py`, `from baml_client import b`
   - **Vercel AI SDK**: TS: `ai`, `wrapLanguageModel`, `streamText`, `generateText` (TypeScript only)
2. **Search for existing SDK usage** (`withSpan`, `@span`, `bitfab_span`, `client.Span`, `getFunction`, `get_function`, etc.). In a monorepo, search **each application directory separately**: a root-level search can miss subdirectories.
   - If found: list the trace function keys, then ask the user:

   > A) **Search for more workflows**: find uninstrumented gaps *(recommended)* → step 3
   > B) **Modify an existing trace setup**: jump to the Modify phase → step 1 of the Modify phase
   > C) **Continue**: done instrumenting → step 1 of the Replay phase (mode `wizard`); otherwise step 1 of the Cleanup phase

     If "Modify", jump to the Modify phase. If "Continue", follow the option's destination: Replay in `wizard` mode, Cleanup otherwise.
   - **If usage routes through a project-local shim** (a wrapper file that re-exports `withSpan` / `@span` / `bitfab_span` / `getCurrentTrace` / `getCurrentSpan` with custom init, often named `lib/bitfab.*` or after a predecessor SDK such as `lib/simforge.*`), audit the shim before instrumenting anything new. The shim must (a) construct the SDK client (`new Bitfab(...)`, `bitfab_init()`, `Bitfab::Client.new`, etc.) at module load, **synchronously**, never lazily inside the wrapped function; and (b) hand off to the SDK call synchronously, with no `await` between the user's entry to the shim and `client.withSpan(...)` / `@bitfab.span(...)`. Lazy or async client init (e.g. `await getOrCreateTraceFunction(key)` inside the wrapped body) breaks the SDK's nesting context (TypeScript `AsyncLocalStorage`, Python `contextvars`) under any parallel fan-out (`Promise.all`, `Promise.allSettled`, `asyncio.gather`, parallel workers): every span becomes its own top-level trace instead of nesting inside its caller. Fix the shim before instrumenting anything new. (Direct callers of the SDK with no shim already satisfy this rule, skip the audit.)
   - If not found: **proceed to step 3**: no SDK usage does NOT mean nothing to instrument, it means the SDK hasn't been installed yet. NEVER conclude "nothing to instrument" before completing step 6.
3. Use the API key from the Login phase (or retrieve it now if already authenticated)
4. **Install the SDK now.** Detect the project's package manager from its manifest (`pyproject.toml` → `uv`/`poetry`; `package.json` → `pnpm`/`npm`/`yarn`/`bun`; `Gemfile` → `bundle`; `go.mod` → `go get`; `requirements.txt` → edit file + `pip install -r`) and run its canonical add command, do NOT stop to ask about version pinning or dep groups. Prefer `uv add`/`poetry add` over bare `pip install` (bare `pip install` doesn't persist to pyproject.toml). In monorepos, scope to the correct workspace (e.g. `pnpm add --filter <pkg>`, or cd into the app directory first), running from the repo root will install into the wrong package. Default to a runtime dep for applications; a dev dep for libraries/SDKs where a runtime dep would propagate to downstream users. Then set the `BITFAB_API_KEY` environment variable.

   **Tell the user what you did.** Pick the env-handling approach that fits the project's existing convention. Whatever you do, surface it explicitly: name the file (with absolute path) or mechanism you used, so the user knows where the key now lives. Do not print the key value itself. If the key landed in a `.env`-style file, additionally tell the user that any already-running dev server, REPL, or test runner may need a restart to pick it up, since most file watchers reload code on save but not env files.
5. **Read the SDK reference.** Fetch the dense canonical reference page first (`/reference/typescript.md`, `/reference/python.md`, `/reference/ruby.md`, or `/reference/go.md`) for every signature, type, default, and error semantic you need (initialization, `withSpan` / `@span` / `bitfab_span` / `client.Span`, `getFunction` / `get_function` / `GetFunction` / `bitfab_function`, `SpanType`, `getCurrentSpan`/`getCurrentTrace`, `wrapBAML`/`wrap_baml`). If step 1 detected a framework in this application directory, also fetch the matching framework page; it documents the handler/processor/wrapper the SDK exposes for that framework, which is usually preferable to hand-wrapping every node/agent call with `withSpan`/`@span`: LangGraph / LangChain → `/frameworks/langgraph.md` (`getLangGraphCallbackHandler` / `get_langgraph_callback_handler`; in a LangChain-only project, prefer the identical aliases `getLangChainCallbackHandler` / `get_langchain_callback_handler` so the code reads naturally); OpenAI Agents SDK → `/frameworks/openai-agents.md` (`getOpenAiTracingProcessor` / `get_openai_tracing_processor`, plus the replayable run wrapper `getOpenAiAgentHandler` / `get_openai_agent_handler` (drop-in for the run call)); Claude Agent SDK → `/frameworks/claude-agent-sdk.md` (`getClaudeAgentHandler` / `get_claude_agent_handler`); BAML → `/frameworks/baml.md` (`wrapBAML` / `wrap_baml`); Vercel AI SDK → `/frameworks/vercel-ai-sdk.md` (`getVercelAiMiddleware`). Then fetch the language guide (`/typescript-sdk.md`, `/python-sdk.md`, `/ruby-sdk.md`, `/go-sdk.md`), including the Replay section for non-Go projects, for the install command, the multi-file project layout example, the BAML auto-instrumentation walkthrough, and the replay script template. Read the replay section upfront (not later) because step 13 reuses it to write the replay pipeline in the same cycle, and it should not re-fetch these pages. Fetch those pages (via web-fetch capability, in one batch since they are independent URLs, or ask the user to share them). **Do not improvise instrumentation from memory**: the API has moved and guessing will produce broken code.
6. **Instrumentation must produce a replayable trace. There are exactly two ways to get one: (1) the root span has serializable inputs, or (2) the workflow runs on a supported framework integration that records a replayable root (LangGraph / LangChain, OpenAI Agents SDK, Claude Agent SDK, or Vercel AI SDK), which captures the framework's own serializable input as the root. Establish one of these before writing any instrumentation. Trace-processor integrations (OpenAI Agents SDK) are a special case: the processor auto-captures the agent run, but on its own records a root span with an empty input (verified against a live run: the OpenAI Agents agent span is the root and carries no recorded input), so the processor ALONE is NOT replayable. Pair it with its run wrapper (`getOpenAiAgentHandler` / `get_openai_agent_handler`), a drop-in for the run call that opens a keyed root carrying the run input as a serializable argument, with the processor's spans nesting underneath, which turns it into case (1). A hand-written `withSpan`/`@span` root that takes the run input works too.**

   **The root exists so the replay harness can re-invoke it as a plain lambda with serialized inputs**: that's what makes traces searchable (a coherent unit of behavior) and replayable (runnable against current code). The root must own its state setup, not consume a pre-built stateful object the replay script can't reconstruct. Frameworks are the sharpest case (LangGraph compiled graphs, Claude Agent SDK clients, LangChain chains all require constructors + special setup), but the rule generalizes to anything stateful, configured SDK clients, prepared models, cached routers, DB sessions. For manually wrapped workflows, the root is therefore the outer workflow function that **builds** the framework / stateful object + invokes it + processes the output (API handler, message processor, job runner, pipeline coordinator), almost never the SDK's `run()` / `invoke()` itself. For callback-handler integrations that already record a replayable root (LangGraph / LangChain, Claude Agent SDK, or Vercel AI SDK), do not turn this into a mandatory manual outer span: the handler-created framework invocation root is enough when the production workflow is just the graph/chain/agent invocation. The replay callable is where you rebuild the framework/stateful object around the recorded root input. Add a same-key `withSpan`/`@span` outer root only when there is meaningful production work around the framework call (input prep, non-framework retrieval, post-processing, persistence, downstream service calls) that should be visible in the trace.

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

   Module-level dependencies (DB clients, env vars, config loaders, LLM clients) do **not** count *when accessed via module scope or closure*: replay inherits them from the app's loaded environment. The same client passed *as a function argument* IS captured as input and WILL fail. The fix when an SDK client is the only unserializable piece is usually trivial: hoist it to module scope (or capture via closure) and drop it from the argument list, leaving the wrapped function's serializable args (issue, request, options-without-the-client) intact. When the natural outer boundary still has unserializable inputs after that, do **one** of the following **before writing code**:
   - **Instrument via the framework handler or processor** (preferred whenever the workflow runs on a supported framework: LangGraph / LangChain via `getLangGraphCallbackHandler` / `get_langgraph_callback_handler`, OpenAI Agents SDK via `getOpenAiTracingProcessor` / `get_openai_tracing_processor`, Claude Agent SDK via `getClaudeAgentHandler` / `get_claude_agent_handler`, Vercel AI SDK via `getVercelAiMiddleware`). These split into two replayability cases, do not conflate them:
     - **Integrations that record a replayable root (LangGraph / LangChain, OpenAI Agents SDK, Claude Agent SDK, or Vercel AI SDK) are replayable as-is**, via one of two mechanisms. **Callback handlers** (LangGraph / LangChain, Claude Agent SDK, or Vercel AI SDK) record the framework invocation itself as the root span, with the framework's own serializable input (LangGraph initial state, agent prompt) as the recorded root input. **Trace processors** (OpenAI Agents SDK) don't record the input themselves, so their run wrapper (`getOpenAiAgentHandler` / `get_openai_agent_handler`) does it: a drop-in for the run call that records a keyed root carrying the run input, with the processor's auto-captured spans nesting underneath. Either way, the unserializable arguments above it (live dependency objects, billing callbacks, request contexts) never enter the trace, and no decorated root function needs to exist in the app code: the replay script passes the key to `replay()` with a plain callable that re-invokes the framework entrypoint with the recorded root input plus a freshly constructed environment (framework config, dependencies, safe no-op substitutes for side-effectful wiring); the SDK wraps the callable internally. On SDKs that predate explicit-key replay, wrap the callable under the same key yourself (Python `@bitfab.span("<key>")`, TS `getFunction(key).withSpan(...)`). The pattern is documented in the SDK docs' Replay section (handler subsection) and wired up in step 13 11b. Never report one of these workflows as "not replayable" because no `@span`-decorated function exists in production code.
     - **A bare trace processor (OpenAI Agents SDK) with neither its run wrapper nor a manual root is NOT replayable.** The processor captures the run, but its root span records an empty input (verified against a live run: the OpenAI Agents agent span is the root and carries no recorded input). Pair it with the run wrapper (`getOpenAiAgentHandler` / `get_openai_agent_handler`), the drop-in for the run call above, or a hand-written `withSpan`/`@span` root that takes the run input: the processor's auto-captured spans nest under that root, and replay runs against the root's serializable input. Do not treat a bare processor-only trace as replayable.
   - **Move the trace boundary inward** to the first function whose inputs are serializable (e.g. trace `processTurn(transcript, context)` instead of `handleSession(stream, peerConnection)`). This is not a refactor.
   - **Refactor** so a function with serializable inputs exists. Two flavors, chosen per case in the refactor plan:
     - **Visibility refactor (common)**: the logic that takes serializable inputs already exists inline but isn't importable (embedded in a route handler, not exported). Extract it into a named, exported function at module scope. No semantic change.
     - **Structural refactor (rare overall, mostly realtime/browser apps)**: no function with serializable inputs exists yet. Introduce one: a pure core whose parameters are serializable, with callers constructing them. A real rewrite. (This flavor is for missing serializable-*input* cores. A streaming *output* in the TypeScript and Python SDKs is handled by the `finalize` option above, not a structural refactor; only fall back here for streaming on Ruby/Go.)

   Raise this with the user in step 10 (not later); never instrument a root with unserializable inputs and try to fix it in the Replay phase.
7. Before reading any code to find workflows, ask the user how they'd like to find what to instrument first:

   > A) **Find workflows for me**: scan the codebase for every AI call, agent, and LLM-driven decision *(recommended)* → step 8
   > B) **Instrument a specific target**: name the file, function, or directory to instrument → step 9

   If they pick **A**, do the full codebase scan in step 8. If they pick **B**, ask which file, function, or directory they want to instrument (if they haven't already named it) and go to step 9 to read just that location, skipping the broad scan.
8. Read the codebase to identify ALL AI workflows, every place the app makes LLM calls, runs agents, or makes AI-driven decisions. For each, find the **outer workflow boundary** (per the rule in step 6), and also note any meaningful work **above** the agent/LLM call (auth, validation, input prep, retry/orchestration loops, multi-agent coordination), **alongside** it (custom LLM calls outside the SDK, tools that aren't registered with the SDK, downstream services), and **below** it (post-processing, parsing, persistence). These are the manual spans that will sit around any auto-captured SDK content.
9. The user named a specific file, function, or directory to instrument. Read just that location and its immediate surroundings, do NOT scan the rest of the codebase. Find the **outer workflow boundary** there (per the rule in step 6), and note the meaningful work **above** the agent/LLM call (auth, validation, input prep, retry/orchestration loops, multi-agent coordination), **alongside** it (custom LLM calls outside the SDK, tools that aren't registered with the SDK, downstream services), and **below** it (post-processing, parsing, persistence). These are the manual spans that will sit around any auto-captured SDK content. If the location holds more than one distinct AI workflow, note each.
10. Present a numbered list of workflows found, ordered by value (most complex or LLM-heavy first). For each, give:
   - **Trace boundary**: the outer workflow function that will be the trace function root (per step 6, NOT the SDK/agent call itself)
   - **Inputs**: the shape of the function's inputs, and an explicit note that they're serializable by the SDK's tracing layer. If the natural outer boundary's inputs are unserializable (live browser/runtime objects, HTTP req/res, stream writers, sockets, opaque request contexts, live dependency/billing objects), state that here and present the three resolutions from step 6 as part of this workflow's entry: **(a) instrument via the framework handler/processor** (recommended when the workflow runs on LangGraph / LangChain, OpenAI Agents SDK, Claude Agent SDK, or Vercel AI SDK; for callback handlers, the handler-recorded root stays replayable via a same-key wrapper in the replay script; for trace processors, OpenAI Agents SDK, use the run wrapper (`getOpenAiAgentHandler` / `get_openai_agent_handler`) in place of the run call so it records a replayable keyed root that takes the run input; a bare processor over plain `run()` records an empty-input root and is not replayable on its own), **(b) move the boundary inward to `<specific inner function with serializable inputs>`** (recommended when no framework handler applies and an obvious candidate exists; not a refactor), or **(c) refactor**. Do not proceed to step 11 until the user picks one, never instrument an unserializable root. **If the user picks (c), present a refactor plan, labeled as *visibility* (extract + export, logic unchanged) or *structural* (new pure-core fn), and get an explicit second confirmation before modifying code. See the "Refactor confirmation" rule below.**
   - **Output**: if the boundary returns a live stream (Vercel AI SDK `streamText` result, a `ReadableStream`, an SSE / streaming `Response`), note it here. In the **TypeScript and Python SDKs this is NOT a refactor**: instrument with the `finalize` option (TS `withSpan(key, { finalize }, fn)` with `finalizers.aiSdk` / `finalizers.readableStream`; Python `@client.span(key, finalize=...)` over an async generator with `finalizers.openai_chunks` / `finalizers.anthropic_events`), which records a serializable view while the live stream still reaches the caller (per step 6). Present it as the plan, do not offer a structural rewrite for a streaming output when `finalize` covers it. On Ruby/Go, fall back to a serializable run-to-completion core.
   - **Replay dependencies**: the external state and side-effecting dependencies the function touches that replay will have to deal with, walk what the boundary and its captured children call into: database reads, third-party APIs, queues, blob/file storage, clocks/RNG, stream writers, request/session/billing objects. Two follow-ups come out of this list, both wired up in step 13:
     - **Potential mocks**: anything with **no live counterpart at replay time** (stream writers, request/session stubs, billing/runtime callbacks, sockets) is a stub the replay script must write in. Name them here so the user knows replay won't hit the real thing; do NOT plan to mock anything that has a live counterpart (the DB, real env/config/models).
     - **Database snapshotting**: if the function **reads stored state from the database** (anything where the answer depends on the rows as they were at trace time, a decision over an order/account/document, a retrieval step), plain replay runs against *today's* data and is misleading. Flag it here and recommend `$bitfab:setup db-snapshot` (TypeScript, Python, Ruby) so replay runs against the per-trace DB branch instead. If the function only writes, or never touches the DB, say so and skip it.
   - **What's covered end-to-end**: the work above, alongside, and below any agent/LLM/SDK call that this trace will capture (be specific: list the orchestration, custom LLM calls, tools, downstream services that will become spans)
   - **Why tracing it is valuable**

   The description must commit to the actual scope. If the plan will only auto-capture an SDK's internals, say so explicitly, do NOT use language like "complete tracing of X workflow" when the trace will only cover an SDK call's internals.

   Recommend one to start with. **Ask the user to pick exactly ONE workflow to instrument first.** Never accept "multiple" or "all", each Instrument cycle produces exactly one trace function with one trace plan and one set of code changes. If the user wants to instrument several, they will be done sequentially via the loop in step 15, one at a time.
11. **Read function signatures you'll reference in the trace plan**: root function first, then any whose parameter names or return fields aren't already obvious from the discovery read (the step 8 scan, or the targeted step 9 read on the point-to-it path). Skipped leaf functions only need their names; don't Read them unless their shape appears in the plan. Never guess names. See "Trace Plan Format" and "Trace Plan Accuracy" in the Reference section below.
12. **Build the trace plan under a hard constraint: the resulting instrumentation must be purely additive.** If a candidate tree requires *any* behavior change to make spans nest correctly (awaiting a stream that wasn't awaited, delaying a call, reordering operations, blocking a callback, restructuring control flow), the tree is invalid, restructure the *tree* instead (make spans siblings, split into separate trace functions across separate cycles, or accept a flatter shape). Never present a behavior-changing approach as an option, not even as a non-recommended alternative.

   **For callback-handler SDKs (LangGraph / LangChain, Claude Agent SDK, or Vercel AI SDK), do not add a manual outer root by default.** The handler records a replayable framework invocation root and auto-captures the framework subtree. If the workflow is only the graph/chain/agent invocation, build a handler-only plan: root = the framework invocation `(agent)`, children = `[auto]` framework spans. If there is meaningful production work around the framework call (input prep, non-framework retrieval, post-processing, persistence, downstream service calls), use a hybrid plan with a same-key `withSpan`/`@span` outer root and show the handler-captured subtree beneath it. Never wrap individual framework-managed nodes/tools/retrievers/model calls just to make them visible; the callback handler already captures them.

   **For trace processor SDKs (OpenAI Agents SDK, etc.), extend beyond the processor.** The processor only auto-captures what runs *inside* the SDK's instrumented call (LLM calls, tool calls, handoffs). Everything above it (orchestration, retries, input prep), alongside it (non-SDK LLM calls, unregistered tools, downstream services), and below it (post-processing, persistence) is invisible unless you add manual spans. Default to a **hybrid plan**: trace function root wraps the workflow with manual `●` spans, the SDK call appears as one `(agent)` child whose grandchildren are `[auto]` lines, and other manual spans capture the work around it. A bare auto-only plan (root = the SDK call, no surrounding manual spans) is only valid when the workflow truly is just the SDK call with no surrounding work, confirm there's nothing meaningful above/alongside/below before defaulting to it. **Even then, route the bare call through the run wrapper (`getOpenAiAgentHandler` / `get_openai_agent_handler`) instead of plain `run()`: it records a replayable keyed root carrying the run input with the processor's spans nested underneath. A bare auto-only plan over plain `run()` records an empty-input root and is NOT replayable, which conflicts with the trace-boundary gate in step 6: fall back to it only when the user has explicitly accepted an observable-only trace. Whenever there is surrounding work, use the hybrid plan with a `withSpan`/`@span` root that takes the run input.**

   **One flow = one trace function key.** When an outer `@bitfab.span` / `withSpan` / `bitfab_span` and a framework handler wrap the same work (LangGraph / LangChain `get_langgraph_callback_handler`, OpenAI Agents SDK `get_openai_agent_handler`, Claude Agent SDK `get_claude_agent_handler`, Vercel AI SDK `getVercelAiMiddleware`), pass the **same key** to both, a second key splits one flow into two overlapping trace functions. Separate trace functions describe separate flows with their own standalone roots, never a sub-range of an outer flow.

   Then post the plan to the browser confirmation UI via `mcp__Bitfab__create_trace_plan` and open it with the `openTracePlan.js` CLI, which navigates Studio to the trace plan page and polls for the user's Confirm/Cancel decision via agent session events.

   - Build a `TracePlanTree` (`{ rootId, nodes: { [id]: TraceNode } }`) from the same span tree you'd otherwise render. Each `TraceNode` carries `id` (stable, e.g. hash of `file:line:name`), `name`, `kind` ("manual" | "auto" | "pure"), `file`, `line`, `signature`, `parentId`, `childIds`, plus `framework` (for `[auto]` lines).
   - **Every captured node MUST include `sampleInput` and `sampleOutput`.** Without samples the confirmation page can't show the user what gets captured, which is the whole point. Construct realistic example values from the function's parameter and return types (Read the file and its return-type imports if needed); for SDK calls (`openai.chat.completions.create`, `generateText`, `cohere.rerank`, etc.) use the documented response shape. Do NOT call `create_trace_plan` with a captured node missing either field.
   - **Every captured node carries an `analysis` describing what the span DOES** (uncaptured context nodes omit it). `analysis` is `{ classification, innerCall?, sideEffectKind?, readKind? }` with `classification` one of `pure` | `model_call` | `external_read` | `side_effect`. **Never leave a captured node unclassified** (it renders blank). You classify; the server derives `mockOnReplay`, `suggestedFix`, and the summary from it, so do NOT send them. The idea: replay re-runs every span by default (your code and the model are meant to re-run, that is how you test a change), classification only flags the **external world** so replay stays safe and faithful.
     - **Classify each node by its OWN body** (Read the body, don't guess from the name, a `processOrder` that charges a card reads "pure" from its name and is anything but), **excluding work already in captured children.** A wrapper or orchestrator whose model call / read / write lives in a captured child is itself `pure`, that behavior belongs to the child, so never bubble it up to the parent or root. (An external call sitting **inline** with no captured span of its own belongs to the enclosing node.)
     - **Decision procedure per captured node (first match wins):**
       1. **IS the model call**, the LLM invocation itself: an auto leaf (`openai.chat.completions.create`, a `ChatOpenAI` span) or a model call inline in this body → `model_call`. A chain `.invoke`, a graph node, or an orchestrator whose model call is a captured child is `pure`, not `model_call` (a `kind: "auto"` / `framework` tag alone does not make a span a model call; don't bubble a child's `model_call` up).
       2. **Own body mutates external state** (DB write, outbound `POST/PUT/PATCH/DELETE`, queue, email, payment charge, file or vector write) → `side_effect` + `sideEffectKind` (`db_write` | `http_outbound` | `queue` | `email` | `filesystem` | `vector_write`). Fires for real on replay; **wins over `model_call`** when one span does both.
       3. **Own body reads external mutable state** (DB `SELECT`, outbound `GET`, vector search, cache read) → `external_read` + `readKind` (`db_read` | `http_read` | `vector_search` | `cache_read` | `filesystem_read`).
       4. **Otherwise** → `pure` (local compute: parsing, formatting, prompt construction, in-memory mutation, orchestration).
     - **Invariant: a `model_call` is the leaf that issues the request, never a wrapper around one.** No `model_call` may have a `model_call` ancestor or descendant in the captured tree. The real model call is the single auto leaf that hits the API (`openai.chat.completions.create`, `messages.create`, a `ChatOpenAI` / `ChatAnthropic` span); every span above it (the chain `.invoke`, the LangGraph or agent node, your `outline()` / `summary()` wrapper) is `pure`, even when the framework labels it an LLM, chat, or chain span. After classifying, scan each parent-to-child line: if two `model_call`s sit on it, the upper one is wrong, demote it to `pure`. Nested `model_call`s are always a bug.
     - Set `innerCall: { name }` on a `model_call` / `external_read` / `side_effect`. **Don't compute `mockOnReplay`**: the server defaults it to `true` only for a `side_effect` that isn't a `db_write` (everything else re-runs; a `db_write` runs live against a db-snapshot). Read the per-node mock decisions back from `mcp__Bitfab__get_trace_plan` after the user confirms.
   - **Include surrounding code as `pure` context nodes** so the captured set is legible inside its codebase context and the user can toggle additional nodes into the capture directly in the UI without leaving the page. The test for inclusion is **"would the user plausibly want this as its own span?"**: anything they might promote to a wider root, wrap as a deeper child, or add as a peer at the same depth. Walk in three directions:
     - **~10 callers above the root**: candidates for **promoting the root upward** to a wider scope. Walk via Grep (callers of the root, then callers of those, etc.) and attach each as a `pure` ancestor. Stop at process entry points (HTTP handlers, queue workers, CLI `main`, cron jobs, page handlers, framework boot, there is no useful root above those) or when you've gathered ~10 nodes.
     - **~10 callees below each leaf**: candidates for **wrapping deeper spans**. For every captured leaf, walk downward (callees of that leaf, callees of those, etc.) and attach each as a `pure` descendant. Include any callee the user might plausibly want as its own span, LLM / tool / agent calls, prompt construction, response parsing, retry loops, fan-outs, post-processing that drives another model. Stop at pure plumbing (pass-through returns, trivial formatting or arithmetic, no further interesting activity) or ~10 nodes per leaf. **Don't stop just because you crossed an SDK / framework / stdlib boundary**: the test is "is this plausibly its own span?", not "is this in our code?".
     - **~5 siblings per captured non-root node**: candidates for **peer spans at the same depth**. For each captured non-root node, include the parent's other callees (other functions invoked from the same wrapper) as `pure` siblings. These are the nodes the user might wrap alongside the existing capture to widen the trace sideways.
     All surrounding nodes get `kind: "pure"` and are **not** included in `capturedNodeIds`. They serve two ends: **legibility** (the captured set sits inside its surrounding code so the user sees what is and isn't traced) and **modification** (they are the levers in the UI for expanding capture deeper, broader, or sideways).
   - Call `mcp__Bitfab__create_trace_plan` with `{ language, tree, capturedNodeIds, traceFunctionKey }` (and `stats` if you have a sample run), `capturedNodeIds` is your initial recommendation, must form a connected sub-tree (selecting any descendant implies its ancestors). `traceFunctionKey` is the key you'll pass to `getFunction` / `get_function` / `bitfab_function` / `WithFunctionName` in step 13; persisting it lets future Modify cycles bootstrap their `before` tree from this plan via `get_trace_plan({ traceFunctionKey })` instead of re-deriving from code. The server derives the plan's validation card (status pill + aggregate counts) from the per-node `analysis`, so you don't send a summary. The tool returns a plan id (and a `https://bitfab.ai/studio/trace-plan/<id>` URL).
   - Open the trace plan in the browser by running:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/openTracePlan.js" <planId>
   ```

   (`${BITFAB_PLUGIN_DIR}` resolves to the plugin directory; `<planId>` is the id returned by `mcp__Bitfab__create_trace_plan`.) The script navigates Studio to the trace plan page and **blocks** until the user clicks **Confirm** or **Chat about this** (up to 30 minutes).

   **Polling (mandatory, see the Blocking-process rule at the top of this skill):** keep polling the live exec session until the process exits. Do NOT wait for a chat message from the user; their confirmation arrives as stdout on the already-running process, not as a new prompt. Poll every few seconds until one of these terminal conditions, then route accordingly:

   - The script emits JSONL to stdout. If it emits `{"event":"window-opened","url":"..."}`, immediately tell the user `Studio opened: <url>` in a normal chat message before continuing to poll. `{"event":"session-ready","sessionId":"<uuid>"}` appears once the Studio session is established (on a logged-out run, an `{"event":"auth-required",...}` then `{"event":"authenticated",...}` line precede it while the user signs in, keep waiting for `session-ready`). On exit, parse the final JSON line:
     - `{"event":"confirmed","planId":"<uuid>"}`, the user confirmed in the browser. The `planId` may differ from the original if a mid-session `create_trace_plan` call created a new plan (the script auto-tracks the latest plan via `tracePlan:created` events). Call `mcp__Bitfab__get_trace_plan` with the returned `planId` to read the authoritative `capturedNodeIds` for step 13. If it differs from your initial recommendation, prune `[auto]` lines whose ancestor manual span was uncaptured, and drop manual `●` wraps that aren't in the set. **For any node the user newly captured in the UI that you hadn't classified** (a `pure` context node toggled into the set, it has no `analysis`), classify it now with the same decision procedure and set its `mockOnReplay` before instrumenting, never wrap a captured span without a mock decision (the UI renders an unclassified captured node as plain "runs live", which would silently let a side effect fire).
     - `{"event":"cancelled","planId":"<uuid>"}`, the user aborted from the browser. Tell them the trace setup was dropped and ask what they'd like to do instead. Do not write instrumentation.
     - non-zero exit (including `{"event":"timeout",...}`), surface the error to the user. Do not write instrumentation.

   **Inline fallback** (use only if `mcp__Bitfab__create_trace_plan` errors, e.g. offline or MCP unreachable): present the trace plan **using the format defined in the "Trace Plan Format" reference section below** (legend → grammar → template precedence → canonical example). **STOP**: ask the user to confirm before writing code.
13. **Write instrumentation AND the replay pipeline for this trace function in the same cycle, batched into a single message of tool calls.** Instrumentation edits go in one apply_patch / set of Edit calls; the replay script (new or updated `scripts/replay.*`) goes in the same turn. Skip the replay script entirely for Go-only projects (Go does not support replay).

   - **11a. Instrumentation edits**: follow the SDK reference exactly, purely additive. Never change behavior, arguments, return values, error handling, variable names, types, control flow, or code structure. Batch repetitive edits in parallel (one message, many Edit calls); for large mechanical fan-outs (>10 files of the same wrapper pattern), validate the pattern on one file, then do the remaining files. **For each span the trace plan marked `mockOnReplay: true`, pass that SpanOption when you wrap it** (TypeScript `withSpan(key, { type, mockOnReplay: true }, fn)`, Python `@client.span(key, type=..., mock_on_replay=True)`, Ruby equivalent), so replay's `mock: "marked"` strategy serves its recorded output. Spans the plan left not-mocked get the normal wrapper with no `mockOnReplay`.

   - **11b. Replay pipeline edits**: write or update the replay script (`scripts/replay.*` or the project's equivalent) alongside the instrumentation, grounded in the docs you already fetched in step 5:
     - **Language + SDK replay reference URL**: `https://docs.bitfab.ai/<language>-sdk.md` (TypeScript / Python / Ruby). Re-check the Replay section now to confirm the current signature, do not write from memory.
     - **Trace function key**: as confirmed in the trace plan.
     - **Trace function root**: the function's real name, full signature (param names + types), return type, absolute file path, and import path the replay script will use.
     - **Handler-instrumented workflows (no decorated root)**: when this cycle's instrumentation is a framework handler (LangGraph / LangChain callback handler, OpenAI Agents SDK run wrapper, Claude Agent SDK handler, Vercel AI SDK middleware) rather than a decorated root function, replace the "Trace function root" item with key-based replay: the replay pipeline passes the handler's key plus a plain callable to `replay()` (Python: `client.replay("<key>", fn, ...)`; TypeScript: `bitfab.replay("<key>", fn, opts)`), and the callable re-invokes the framework entrypoint with the recorded root input. The SDK wraps the callable internally; on SDKs that predate explicit-key replay, wrap it under the same key yourself (Python `@bitfab.span("<key>")`, TS `getFunction(key).withSpan(...)`). Work out: the framework entrypoint + import path (e.g. the compiled graph's `invoke`/`ainvoke`, the agent run call), the recorded root-input shape (a dict root input like a LangGraph state arrives as a single positional argument on the explicit-key path; on the older same-key-wrapper path it splats into kwargs, so legacy Python wrappers take `(**state)`), and the environment the wrapper must construct fresh (framework config, dependency objects), using **safe no-op substitutes for side-effectful wiring** (billing/credit callbacks, notification senders) so replay never charges or notifies anyone. The handler-recorded production traces and the wrapper share the key, which is all `replay()` needs; never report a handler-instrumented key as not replayable.
     - **Replay script target**: if `scripts/replay.*` (or the project's equivalent) already exists, add a new pipeline entry for this key. Otherwise create the file.
     - **Non-negotiables**: CLI arg for pipeline name; optional `--limit N` (default 10), `--trace-ids id1,id2`, and `--dataset-id <uuid>` flags (`--trace-ids` wins over `--limit` when both are passed: the SDK ignores `limit` with a warning, since an explicit ID list determines the count; `--dataset-id` forwards to `replay()` and is preferred for dataset replays: passed alone it replays the dataset's traces and durably attributes the experiment to the dataset); replay fn imports and invokes the real function (never a stub); if that function is already `withSpan`/`@span`-wrapped, pass it to `replay()` directly, never re-wrapped in a fresh closure (a plain arrow like `(x) => wrappedFn(x)` carries no trace function key, so `replay()` adds its own root span around it while `wrappedFn` records its own span underneath, nesting a duplicate); runs in the app's loaded `.env` environment (no mocked DB clients / env vars / config / models); **passes the `marked` mock strategy to `replay()`** (TypeScript `{ mock: "marked" }`, Python `mock="marked"`, Ruby `mock: "marked"`) so the spans the plan tagged `mockOnReplay: true` serve their recorded output while model calls and the rest of your code re-run, this is how the plan's mock decision actually executes; **write in a stub for every dependency flagged as a potential mock in step 10** (stream writers, session/request stubs, billing/runtime callbacks, sockets), mocking only what has no live counterpart at replay time and never anything that does (the DB, real env/config/models); if step 10 flagged the function as reading stored DB state, leave the DB unmocked and tell the user replay as written reads today's data, point them to `$bitfab:setup db-snapshot` to wire per-trace DB branches; follows the Replay Output Contract (emit the full `ReplayResult` as one JSON block via `JSON.stringify(result, null, 2)` / `json.dumps(result, indent=2, default=str)` / `JSON.pretty_generate(result)`, including every item's `durationMs`/`duration_ms`, `tokens`, and `model`; never swap the JSON block for per-field log lines, counts, lengths, hashes, or previews); reports per-item progress by passing the SDK's ready-made reporter into the progress callback (`onProgress: reportReplayProgress` in TS, `on_progress=report_replay_progress` in Python, `on_progress: Bitfab.method(:report_replay_progress)` in Ruby), which streams progress lines to stderr that the plugin polls for live progress while the replay runs in the background; prints a short human-readable summary + test run URL before the JSON dump, to stderr only; lives under `scripts/` (or the project's existing scripts location).
     - **Match the Replay-section template's fn signature verbatim, no speculative defense.** The SDK invokes the replay wrapper with captured args in their original shape; don't branch on arg arity/shape, don't add type-checker escape hatches (`any` casts, `cast(Any, ...)`, ignore comments, untyped passthroughs), and don't guard against cases the contract precludes. If the root signature contradicts what the reference template expects, surface that to the user before writing code; don't paper over it. A hard error at the call site beats silent passthrough of malformed input.
     - **Per-item error tolerance**: `bitfab.replay` records thrown wrapped-fn errors in `item.error` and keeps going; rely on that. Don't wrap the fn in try/catch returning a placeholder, that turns infra failures (stale rows, FK violations, rejected writes) into fake successes. Only allowed top-level catch: a fatal handler around `main()` that exits non-zero, so callers can tell a whole-replay crash from a clean run with some unreplayable items.
     - **Side-effect check**: if importing the instrumented function triggers module-level side effects (booting listeners/ports/prod connections), do not work around it silently, flag it to the user so they can scope the replay env correctly.

   The trace plan's `Files changed:` list must include the replay script path for this cycle (new or edited) alongside the instrumented files.
14. Tell the user how to run the app to generate the first trace AND, once traces exist, how to run the replay script for this pipeline, give exact command(s) for both. Do NOT run them yourself. (Omit the replay command for Go-only projects.) **If step 10 flagged this function as reading stored DB state** (TypeScript, Python, Ruby), add one line: replay currently reads today's data, run `$bitfab:setup db-snapshot` to make it replay against the database state at trace time.

   **Generate the trace by driving the instrumented path, not by instrumenting a new one.** If the convenient local entrypoint (a dev CLI, script, or REPL) bypasses the wrapped root and calls the inner function directly, common when prod runs behind an orchestrator (Temporal, a job/queue worker), its trace won't match production. Say so, then steer to driving the real path or rerouting the harness through the wrapped entrypoint, never add a span to a dev/test-only entrypoint just to make its trace look right.
15. **MANDATORY STOP, never silently end the cycle without the A/B/C/D prompt.** Ask the user (we recommend **A**: get a real trace flowing before instrumenting the next workflow):

   > A) **Wait for the first trace [current workflow]**: you run the app (or let me); I watch for the trace to land and report it *(recommended)* → step 16
   > B) **Instrument [next workflow]**: [why it's the next highest value] → step 10
   > C) **Instrument [other workflow]**: [alternative] → step 10
   > D) **Done instrumenting**: stop adding workflows; continue to replay verification, or finish if you ran Instrument on its own → step 1 of the Replay phase (mode `wizard`); otherwise step 1 of the Cleanup phase

   **For option A**, go to step 16 and watch for a trace before asking whether to try replay.

   B and C return to step 10 for the selected workflow. A returns there after the trace/replay follow-up prompts unless the user chooses to be done. Only D exits the Instrument loop. **If the next workflow the user wants isn't already in the discovered list** (common when the first cycle came from the point-to-it path, where step 9 only read the one named location), first run another discovery pass, scan via step 8 or read another named location via step 9, then present. Never tell the user there's nothing left to instrument just because the targeted read only surfaced one workflow.

   **After D in `wizard` mode, Replay ALWAYS runs** as a coverage-verification/backfill sweep. Step 13 already wrote a replay pipeline for every trace function instrumented in this session, so Replay is usually a no-op that confirms coverage; it still runs to catch any pre-existing trace function keys that don't yet have a pipeline and to verify Replay Output Contract compliance across all pipelines. Replay does not depend on traces existing, replay scripts are built from trace function keys in the instrumented code, not captured trace data. In `instrument` mode, D stops after the Instrument loop.
16. Restate the run command from step 14 so the user can run it (or let you run it for them). Before starting the wait, tell the user verbatim: `Run your app now to produce a trace (or tell me to run it for you). I'll watch and report the first trace when it lands, up to ~10 min. Press Esc to cancel.` Then run in a shell (allow up to ~11 min):

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/waitForTrace.js" <trace-function-key>
   ```

   The command blocks inside Node, polling Bitfab every 10s until a trace lands or the ~10 min timeout fires, so no agent tokens are burned while waiting. When it exits, parse the final stdout line as JSON:

   - **`{"status":"found","traceId":"...","url":"..."}`**: report the trace URL and preserve the returned traceId for the replay prompt → step 17
   - **`{"status":"timeout",...}`**: note that no trace arrived yet, then return to workflow selection → step 10
   - **`{"status":"interrupted",...}`**: note that the user cancelled, then return to workflow selection → step 10
17. After reporting the first trace URL, ask the user whether to try the replay script against that exact trace now. Recommend **A** for non-Go projects because this validates the replay pipeline while the user still has the workflow fresh.

   > A) **Try replay now**: run the generated replay script against the trace that just landed *(recommended)* → step 18
   > B) **Keep instrumenting**: skip replay for now and pick the next workflow → step 10
   > C) **Done instrumenting**: stop adding workflows; continue to replay verification, or finish if you ran Instrument on its own → step 1 of the Replay phase (mode `wizard`); otherwise step 1 of the Cleanup phase

   For option A, run only the current workflow's generated replay command from step 14, adding `--trace-ids <traceId>` with the trace id from step 16. If the project is Go-only and no replay command was generated, say Go has no replay support and choose option B or C instead.
18. Run the exact replay command generated in step 14 for the current workflow, adding `--trace-ids <traceId>` for the trace id returned by step 16. Keep the command's normal env loader (for example `pnpm with-env`, `dotenv run`, or the project's equivalent). Do not substitute mocks or a different entrypoint.

   If the replay exits 0, summarize the test run URL and whether items passed, changed, or errored, then continue to the next-move prompt. If it exits non-zero, surface the failing command and the important stderr/stdout lines; make only high-confidence fixes to the replay script or instrumentation, rerun once, then continue to the next-move prompt. Do not run the broad Replay phase from here; this step is only the just-captured trace smoke test.
19. After the single-trace replay attempt finishes, ask the user for the next move:

   > A) **Keep instrumenting**: pick the next workflow to trace *(recommended)* → step 10
   > B) **Instrument another target**: scan again or read a different named location → step 10
   > C) **Done instrumenting**: stop adding workflows; continue to replay verification, or finish if you ran Instrument on its own → step 1 of the Replay phase (mode `wizard`); otherwise step 1 of the Cleanup phase

## Modify

**Run only when mode is `wizard`, `instrument` or `modify`.**

Adjust an **existing** trace setup. Requires existing SDK usage in the codebase, if none exists, run Instrument first. Triggered explicitly by `$bitfab:setup modify`, or selected from the choice prompt at Instrument's existing-SDK-usage menu when existing SDK usage is found.

Every Modify cycle targets **exactly one** trace function. Never batch multiple trace functions in one cycle, if the user wants more, loop via the step 7 menu.

1. **Gather existing trace functions** by searching for SDK patterns (`getFunction("key")`, `get_function("key")`, `bitfab_function "key"`, `WithFunctionName("key")`, plus keyed framework handlers: `getLangGraphCallbackHandler("key")` / `get_langgraph_callback_handler("key")` (or the LangChain-named aliases) and `getOpenAiAgentHandler("key")` / `get_openai_agent_handler("key")` and `getClaudeAgentHandler("key")` / `get_claude_agent_handler("key")` and `getVercelAiMiddleware("key")`; plus trace-processor registrations (unkeyed in code, the key is derived server-side from the workflow name): `getOpenAiTracingProcessor()` / `get_openai_tracing_processor()`). List each key alongside its root function (or, for keys registered only via a framework handler, the handler registration site, handler keys have no decorated root and that is expected). If none are found, tell the user Modify needs existing instrumentation and suggest `$bitfab:setup instrument`.
2. **Pick exactly ONE trace function to modify.** Ask the user with the list of existing keys. Recommend the one the user most recently instrumented (or the one most recently referenced in the current session) and explain why in one line.
3. **Bootstrap the `before` `TracePlanTree` from the most recent confirmed trace plan for this trace function key**, falling back to reading the code only when no prior plan exists. The plan from the previous Instrument or Modify cycle is the source of truth for what's currently captured, re-deriving from code drops sample inputs/outputs and surrounding-context nodes the user previously confirmed.

   1. Call `mcp__Bitfab__get_trace_plan` with `{ traceFunctionKey: "<chosen key>" }` (no `planId`). Two outcomes:
      - **Prior plan found**: parse the JSON block in the response. Use its `tree` as the `before` `TracePlanTree` and its `capturedNodeIds` as the current capture set. You do not need to re-read the instrumented files. Skip step 2.
      - **"No prior confirmed trace plan found"**: there is no plan for this key yet (key created outside the skill, or first Modify cycle that predates this column). Fall through to step 2.
   2. **Code-reading fallback.** Read the instrumented files to map the existing span tree into a `TracePlanTree` (`{ rootId, nodes: { [id]: TraceNode } }`, same shape used in Instrument's build-trace-plan step). Each `TraceNode` carries `id`, `name`, `kind` ("manual" | "auto" | "pure"), `file`, `line`, `signature`, `parentId`, `childIds`, plus `framework` for `[auto]` lines.

   Either way, hold the `before` tree in memory, it seeds the `after` tree you build in step 4 and becomes the left-hand side of the inline-fallback diff in step 5. Do not present it yet.
4. **Build the modified trace plan as a `TracePlanTree` under the same PURELY ADDITIVE constraint as Instrument's build-trace-plan step.** Start from the `before` tree built in step 3 and produce an `after` tree of the same shape (`{ rootId, nodes: { [id]: TraceNode } }`) that applies the user's requested modifications. Reuse node ids unchanged for nodes that survive, that lets the trace plan UI show only what actually changes, and mint new ids for added nodes.

   **If the user didn't request anything specific** (no modifications were named in the skill invocation or earlier in the conversation), produce an `after` tree identical to the `before` tree. Don't invent changes. The user will edit the capture set directly in the UI in step 5.

   The modified tree must be implementable without behavior changes. If a requested modification requires awaiting a stream that wasn't awaited, delaying a call, reordering operations, blocking a callback, or restructuring control flow, tell the user which part doesn't fit and why, and ask them to refine the request (or suggest splitting into multiple cycles). Never present a behavior-changing approach as an option.

   **Every captured node MUST include `sampleInput` and `sampleOutput`**: same hard rule as Instrument's build-trace-plan step. Carry samples forward unchanged for surviving nodes; for newly added nodes (intermediate spans, deeper leaves, a new upstream/downstream root), construct realistic example values from the function's parameter and return types (Read the file and its return-type imports if needed). Do not advance to step 5 with a captured node missing either field.

   **Every captured node MUST also carry an `analysis`**, same hard rule and same procedure as Instrument's build-trace-plan step, so the modified plan renders the replay badges instead of blank. `analysis` is `{ classification, innerCall?, sideEffectKind?, readKind? }` (`pure` | `model_call` | `external_read` | `side_effect`); the server derives `mockOnReplay`, `suggestedFix`, and the summary from it, so you don't send them. Carry `analysis` forward unchanged for surviving captured nodes (their bodies didn't change); classify each **newly added** captured node from its body, not its name, using that step's decision procedure (first match wins): (1) is itself the model call (an auto-captured model leaf, or a span that invokes the model inline in its own body with no separately-captured model-call child) → `model_call` (re-runs live; never mock); a framework wrapper or orchestrator (a LangChain `chain.invoke`, a LangGraph node, the root that just calls model-call children) whose model call is a captured child is `pure`, not `model_call`, don't bubble the child's classification up; (2) own body mutates external state (DB write, outbound `POST/PUT/DELETE`, queue/email/charge/file/vector write) → `side_effect` with `sideEffectKind`, this wins over model_call when one span does both; (3) own body reads external mutable state (DB `SELECT`, `GET`, vector search, cache read) → `external_read` with `readKind`; (4) otherwise → `pure` (local compute, in-memory). Classify a span by its OWN body, excluding work already represented by its captured children (don't double-count). **Nested `model_call`s are always a bug:** no `model_call` may have a `model_call` ancestor or descendant, the leaf that hits the API is the only model call and the chain, graph node, or wrapper above it is `pure` even when the framework labels it an LLM or chat span; if two `model_call`s land on one parent-to-child line, demote the upper to `pure`. Omit `analysis` on the surrounding `pure` context nodes.

   **Include surrounding code as `pure` context nodes** so the modified capture is legible inside its codebase context and the user can toggle additional nodes into the capture directly in the UI without leaving the page. The test for inclusion is **"would the user plausibly want this as its own span?"**: anything they might promote to a wider root, wrap as a deeper child, or add as a peer at the same depth. Walk in three directions:
   - **~10 callers above the root**: candidates for **promoting the root upward** to a wider scope. Walk via Grep (callers of the root, then callers of those, etc.) and attach each as a `pure` ancestor. Stop at process entry points (HTTP handlers, queue workers, CLI `main`, cron jobs, page handlers, framework boot, there is no useful root above those) or when you've gathered ~10 nodes.
   - **~10 callees below each leaf**: candidates for **wrapping deeper spans**. For every existing leaf in the captured sub-tree, walk downward (callees of that leaf, callees of those, etc.) and attach each as a `pure` descendant. Include any callee the user might plausibly want as its own span, LLM / tool / agent calls, prompt construction, response parsing, retry loops, fan-outs, post-processing that drives another model. Stop at pure plumbing (pass-through returns, trivial formatting or arithmetic, no further interesting activity) or ~10 nodes per leaf. **Don't stop just because you crossed an SDK / framework / stdlib boundary**: the test is "is this plausibly its own span?", not "is this in our code?".
   - **~5 siblings per captured non-root node**: candidates for **peer spans at the same depth**. For each captured non-root node, include the parent's other callees (other functions invoked from the same wrapper) as `pure` siblings. These are the nodes the user might wrap alongside the existing capture to widen the trace sideways.

   Mark every surrounding node with `kind: "pure"` (uncaptured) and **do not** add their ids to `capturedNodeIds`. They serve two ends: **legibility** (the captured set sits inside its surrounding code so the user sees what is and isn't traced) and **modification** (they are the levers in the UI for expanding capture deeper, broader, or sideways).

   When applying a requested modification, read the relevant signatures so the plan stays accurate: for added context, name the exact keys/values and the span they attach to; for new instrumented spans, read each callee's signature and pick a type annotation (`function`, `llm`, `tool`, `agent`, `handoff`); for span removals, list each by name and confirm the underlying call is left untouched; for a new upstream/downstream root, read the new function's signature and confirm it still covers the interesting LLM/tool activity (upstream) or remains a common ancestor of every LLM/tool span (downstream).
5. **Send the modified plan straight to the trace plan UI, it is the user's primary surface for confirming or editing the change**, not the inline before/after diff. The user can adjust the captured set directly in the UI (selecting/deselecting any of the surrounding `pure` context nodes added in step 4). Confirm in the UI = apply the diff. Cancel = ask the user what they want to change. Same delivery pattern as Instrument's build-trace-plan step.

   1. **Post the modified plan and open the UI.** Call `mcp__Bitfab__create_trace_plan` with `{ language, tree, capturedNodeIds, traceFunctionKey }` (and `stats` if you have a sample run from the existing trace function):
      - `tree`, the modified `after` `TracePlanTree` from step 4, with the ~10 surrounding callers / ~10 surrounding callees included as `pure` context nodes. Each captured node carries the `analysis` you set/carried-forward in that step (omitted on `pure` context nodes).
      - `capturedNodeIds`, your initial recommendation. Must form a connected sub-tree (selecting any descendant implies its ancestors). Surrounding `pure` context nodes are not included.
      - `traceFunctionKey`, the existing key from step 2. Persisting it lets the next Modify cycle bootstrap from this plan.

      The server derives the validation card (status pill + aggregate counts) from the per-node `analysis`, so you don't send a summary. The tool returns a plan id (and a `https://bitfab.ai/studio/trace-plan/<id>` URL).

   2. **Open the trace plan in the browser** by running:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/openTracePlan.js" <planId>
   ```

   (`${BITFAB_PLUGIN_DIR}` resolves to the plugin directory; `<planId>` is the id returned by `mcp__Bitfab__create_trace_plan`.) The script navigates Studio to the trace plan page and **blocks** until the user clicks **Confirm** or **Cancel** (up to 30 minutes). If it emits `{"event":"window-opened","url":"..."}`, immediately tell the user `Studio opened: <url>` in a normal chat message before continuing to poll.

   **Polling (mandatory, see the Blocking-process rule at the top of this skill):** keep polling the live exec session until the process exits. Do NOT wait for a chat message from the user; their confirmation arrives as stdout on the already-running process, not as a new prompt. Poll every few seconds until one of these terminal conditions, then route accordingly:

   3. **On exit, parse the final JSONL line and route:**
      - `{"event":"confirmed","planId":"<uuid>"}`, call `mcp__Bitfab__get_trace_plan` with the returned `planId` (which may differ from the original if a mid-session `create_trace_plan` created a new plan; `openTracePlan.js` auto-tracks the latest plan via `tracePlan:created` events) to read the authoritative `capturedNodeIds` (the user may have toggled `pure` context nodes into the captured set or removed previously-captured nodes in the UI). Reconcile your edit plan with what's now in `capturedNodeIds`, drop manual `●` wraps no longer captured, add wraps for any newly captured nodes (classify each newly-captured node and set its `mockOnReplay` first, a node the user toggled in has no `analysis` and would otherwise default to running live), then take branch **A** (Proceed).
      - `{"event":"cancelled","planId":"<uuid>"}`, the user cancelled from the browser. Take branch **C** (Modifications), ask the user: what do they want to change? Their answer feeds back into step 4. When the loop re-runs `openTracePlan.js` with the new plan, the script reuses the existing Studio browser tab automatically.
      - non-zero exit (including `{"event":"timeout",...}`), surface the error to the user, then fall back to the inline AskUserQuestion below.

   **Inline fallback** (use only if `mcp__Bitfab__create_trace_plan` errors, e.g. offline or MCP unreachable, or `openTracePlan.js` exits non-zero): present an inline before/after diff using the Default view template from the **Trace Plan Format** reference section, list `Files changed:` (paths only, no annotations), and **STOP**: ask the user:

   > A) **Proceed**: apply the diff using the confirmed capture set *(recommended)* → step 6
   > B) **Expand details**: re-render the inline diff in the expanded view (fallback only) → step 5
   > C) **Modifications**: ask what the user wants to change, then return to building the modified plan → step 4
   > D) **Abort entirely**: drop this cycle without writing edits → step 1 of the Cleanup phase
6. **Apply the changes, purely additive to behavior.** Same rules as Instrument's write-instrumentation step: never change arguments, return values, error handling, variable names, types, control flow, or code structure. Removing a `withSpan`/`@span` wrapper is the only structural edit allowed, and only when it leaves the wrapped call, its arguments, and its return value untouched. The trace function key from step 2 stays the same, do not rename keys. Batch repetitive edits in parallel (one message, many Edit calls).
7. Tell the user how to run the app to generate a trace with the modified setup, exact command(s). Do NOT run it yourself. Then **MANDATORY STOP**: ask the user:
   > We recommend **A**: generate a trace with the modified setup so the diff is observable end-to-end.

   > A) **Generate a trace for the modified setup**: present the script to run; allow the user to let you run it *(recommended)* → step 1 of the Cleanup phase
   > B) **Modify another trace function**: returns to step 2 → step 2
   > C) **Done**: stop here → step 1 of the Cleanup phase

   B returns to step 2. A and C exit the Modify loop to cleanup (Modify does not auto-continue to Replay, the user can invoke `$bitfab:setup replay` separately).

## Inspect

**Run only when mode is `inspect`.**

Diagnose, and optionally fix, an existing Bitfab tracing setup. Triggered explicitly by `$bitfab:setup inspect` (or natural-language asks like "why aren't my traces showing up" / "what's instrumented" / "debug my tracing setup" / "inspect my tracing"). Reports auth/connection status, what's instrumented in this repo, whether the plugin and SDK are up to date, whether replay scripts cover every trace function key, and whether traces are actually arriving, then offers to apply the fixes, each confirmed individually before any change. Does **not** open Studio.

This is about trace *delivery and setup health* (is the SDK wired up and current, is the key set, are traces landing, are replay scripts in place). For improving the *quality* of a traced function's outputs (pass rates, failing cases), use `$bitfab:assistant` instead.

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
4. Check whether the plugin, SDK, and replay scripts are current, so the report can offer to fix what's stale:

   1. **Plugin**: reuse the `status` output already captured in the status-check step (step 1). If that status line included `v<X> available, run ... to update`, the plugin is behind.
   2. **SDK**: run the version check (the same mechanism `$bitfab:update` uses):

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/update.js" sdk
   ```

      Parse the `<bitfab-sdk-status>` block it prints, one JSON object per (workspace, language) with `packageName`, `current`, `latest`, `latestSource` ("remote" | "baked"), `updateAvailable`, and `renameFrom`. Treat `updateAvailable: true` as needing a fix, that flag is set both when `latest > current` **and** when `renameFrom` is non-null. A non-null `renameFrom` (e.g. `"bitfab"`) means the TypeScript workspace is on the **legacy `bitfab` npm package and must switch to `@bitfab/sdk`**; this counts as needing a fix even when the installed version already equals `latest` (the rename itself is the fix). If `remoteCheckFailed` is true for an entry, note the latest version couldn't be confirmed (offline / sandbox) rather than asserting it's current.
   3. **Replay scripts**: the same coverage check `$bitfab:assistant` runs in its Phase 2: Glob for `scripts/replay.*` (or the project's replay entrypoint) and grep it for each trace function key found in step 2. Mark replay as ✅ covers all keys, ⚠️ exists but missing keys, or ❌ no replay script.
   4. **Replayability of each root**: script coverage is only half of replay, a script that wraps a non-replayable root still won't run. Determine each key's replayability statically from source (this step does not fetch recorded trace inputs, so reason from signatures, not trace data):
      - **Keyed root-handler keys** (registered through a callback handler or a trace-processor run wrapper, LangGraph / LangChain, OpenAI Agents SDK, Claude Agent SDK, or Vercel AI SDK, with no `@span`/`withSpan`-decorated root in the app) are replayable by design: the handler (or run wrapper, `getOpenAiAgentHandler` / `get_openai_agent_handler`) records the framework's own serializable input as the root. Never flag these ⚠️, and never treat the absence of a decorated root function as non-replayable (this mirrors Instrument's rule).
      - **Bare trace-processor keys** (OpenAI Agents SDK over plain `run()`): the processor captures the run but its root span records an empty input, so a processor-only key (neither the run wrapper `getOpenAiAgentHandler` / `get_openai_agent_handler` nor a manual `withSpan`/`@span` root) is NOT replayable, flag it ⚠️ root not replayable and recommend routing the run through the run wrapper (or adding a manual root that takes the run input). If the key DOES go through the run wrapper or a manual root, check that root's signature like any decorated key (next bullet).
      - **Decorated/wrapped keys**: read the root function signature and confirm it's replayable per Instrument's trace-boundary serializability gate (serializable inputs). Flag any key whose root takes unserializable inputs (live SDK/DB clients, HTTP `Request`/`Response`, stream writers, sockets, opaque request contexts) as ⚠️ root not replayable, reasoning from the signature, not the function name. This is independent of the replay-script coverage in sub-step 3 above: a non-replayable root is ⚠️ whether or not a script exists for it (a key can be ❌ no replay script AND ⚠️ root not replayable at once), so never roll a non-replayable root up into ✅ just because it has no script.

   Hold these results for the report. (If nothing is instrumented, no trace function keys AND no trace-processor registrations, skip both the **replay** and the **replayability** checks, they are per-workflow, so there's nothing to evaluate; report both as `n/a (nothing instrumented)`, never ✅. Still run the **plugin** and **SDK** checks: the SDK may be installed and stale, or on the legacy `bitfab` package needing the `@bitfab/sdk` rename, independent of whether any trace functions exist in this repo yet.)
5. Summarize the setup health in one compact report:
   - **Auth**: authenticated as <account/org>, or not authenticated.
   - **Plugin**: up to date, or `v<X> available` (from step 4).
   - **SDK**: installed / not installed; `BITFAB_API_KEY` set / not set; per workspace, `current → latest` when out of date, **and** call out any workspace on the legacy `bitfab` package that should switch to `@bitfab/sdk` (TypeScript, from `renameFrom`).
   - **Instrumented here**: the list of keys with ✅ / ⚠️ / ❓ markers from step 3.
   - **Replay**: ✅ covers all keys / ⚠️ missing keys / ❌ none (from the replay-scripts check in step 4).
   - **Replayable**: ✅ all roots replayable / ⚠️ `<key>` root not replayable / `n/a (nothing instrumented)` (from the per-root replayability check in step 4; flagged whether or not a replay script exists for the key; never ✅ when nothing is instrumented).

   Then, for anything not healthy, name the most likely cause and the fix:
   - **Plugin or SDK out of date, or on the legacy `bitfab` package**: apply via the fix prompt below (upgrades the version and/or switches `bitfab` → `@bitfab/sdk`; same effect as `$bitfab:update`).
   - **Replay missing or incomplete**: refresh via `$bitfab:setup replay` (non-interactive; creates/extends scripts to cover every key).
   - **Root not replayable**, two failure modes, with the fix matched to each: **(a) the root takes unserializable inputs** (live SDK/DB clients, HTTP req/res, streams, opaque contexts), with or without a replay script: move the trace boundary inward to a serializable-input function or refactor to introduce one; **(b) a bare trace-processor-only key** (OpenAI Agents SDK) whose root is the processor's empty-input span: route the run through the run wrapper (`getOpenAiAgentHandler` / `get_openai_agent_handler`), or add a manual `withSpan`/`@span` root that wraps the run and takes its input. Either way, re-instrument via `$bitfab:setup modify` (or `$bitfab:setup instrument` for a fresh boundary). This is a code change, recommended here, not applied blanket.
   - **Instrumented but no traces**: the app hasn't run with tracing enabled, or `BITFAB_API_KEY` isn't set in the run environment. Run the app (or the replay script) with the key loaded.
   - **Key set but traces aren't visible in the browser**: the API key is bound to a different Clerk org/tenant than the browser session. A key resolves `API key → organization_id → clerk_organization_id → Clerk tenant` at creation time; browser visibility requires both to be the same tenant.
   - **Nothing instrumented**: run `$bitfab:setup instrument`.
   - **Want to change what's captured**: run `$bitfab:setup modify`; to see a plan visually, `$bitfab:setup view`.

   Then continue to the fix prompt. Inspect does not open Studio.
6. If the report surfaced anything stale or missing (plugin behind, SDK out of date or on the legacy `bitfab` package, or replay scripts missing/incomplete), ask the user whether to apply them, each fix is then confirmed individually in the next step (nothing is changed blanket). If everything is healthy, skip the question and go straight to cleanup.

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

**The live browser does not follow on its own.** Switching persists the new active org server-side (so future sign-ins default to it) and replaces the plugin's key, but a browser tab that's already signed in keeps showing the old org until its session is re-minted. The org actually flips in the browser on the **next** Studio open (a fresh session whose org gate runs Clerk's client-side `setActive`) or when the user picks the org from the in-app org switcher.

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

Every View invocation targets **exactly one** trace function. The browser UI's Confirm/Cancel controls have no effect here, the user is just looking at the plan.

1. **Gather existing trace functions** by searching for SDK patterns (`getFunction("key")`, `get_function("key")`, `bitfab_function "key"`, `WithFunctionName("key")`, plus keyed framework handlers: `getLangGraphCallbackHandler("key")` / `get_langgraph_callback_handler("key")` (or the LangChain-named aliases) and `getOpenAiAgentHandler("key")` / `get_openai_agent_handler("key")` and `getClaudeAgentHandler("key")` / `get_claude_agent_handler("key")` and `getVercelAiMiddleware("key")`; plus trace-processor registrations (unkeyed in code, the key is derived server-side from the workflow name): `getOpenAiTracingProcessor()` / `get_openai_tracing_processor()`). List each key alongside its root function (or, for keys registered only via a framework handler, the handler registration site, handler keys have no decorated root and that is expected). If none are found, tell the user View needs existing instrumentation and suggest `$bitfab:setup instrument`.
2. **Pick exactly ONE trace function to view.** Ask the user with the list of existing keys. Recommend the one the user most recently instrumented (or the one most recently referenced in the current session) and explain why in one line.
3. Call `mcp__Bitfab__get_trace_plan` with `{ traceFunctionKey: "<chosen key>" }` (no `planId`). Two outcomes:

   - **Prior plan found**: parse the response for the `Plan id:` line and hold that id for the next step. Take branch **A** (Open).
   - **"No prior confirmed trace plan found"**: there is no plan to view (key created outside the skill, never confirmed, or never instrumented via this skill). Tell the user there's nothing to view yet and suggest `$bitfab:setup modify` to build and confirm a plan for this key. Take branch **B** (Stop).
4. Open the trace plan in the browser by running:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/openTracePlan.js" <planId>
   ```

   (`${BITFAB_PLUGIN_DIR}` resolves to the plugin directory; `<planId>` is the id parsed from step 3.) The script emits JSONL to stdout. If it emits `{"event":"window-opened","url":"..."}`, immediately tell the user `Studio opened: <url>` in a normal chat message before continuing to poll. `{"event":"session-ready","sessionId":"<uuid>"}` appears once the Studio session is established (on a logged-out run, an `{"event":"auth-required",...}` then `{"event":"authenticated",...}` line precede it, keep waiting for `session-ready`). The script navigates Studio to the trace plan page and **blocks** until the user closes Studio or clicks Confirm/Cancel (up to 30 minutes). View is read-only; whichever button the user clicks (the final JSONL line will be `{"event":"confirmed",...}` or `{"event":"cancelled",...}`), do **not** apply edits or call `mcp__Bitfab__get_trace_plan` again. When the process exits, report that the plan was viewed and stop.

   **Polling (mandatory, see the Blocking-process rule at the top of this skill):** keep polling the live exec session until the process exits. Do NOT wait for a chat message from the user; their dismissal arrives as stdout on the already-running process, not as a new prompt.

## Replay

**Run only when mode is `wizard` or `replay`.**

Create or update replay scripts for instrumented trace functions. Requires instrumentation in the codebase; does **not** require existing traces, replay scripts are created from trace function keys in the code, not captured trace data.

Replay scripts let the team regression-test any trace function against production data with one command, they fetch historical traces, re-run them through the current code, and report old vs. new outputs side-by-side. Note: **Go does not support replay**: skip this phase if the project is Go-only.

**Relationship to Instrument.** When Replay runs via `wizard` mode or directly after Instrument, most (often all) trace function keys already have pipelines because Instrument's write-instrumentation step writes them alongside the instrumentation edits in the same cycle. This phase is then a coverage + contract-compliance sweep. Run it standalone (`$bitfab:setup replay`) to catch pre-existing trace function keys that predate that step or were added outside the skill.

**Source of truth:** two pages, read both before creating or modifying a replay script. Do not improvise from memory.
- **Canonical `replay` API signature, options, and return shape:** `/reference/typescript.md`, `/reference/python.md`, `/reference/ruby.md` (Go has no replay). Use this for the exact field names (`result` / `originalOutput` vs `original_output`), default `limit`, `maxConcurrency`/`max_concurrency`, error behavior.
- **Copy-pasteable script template + replay output contract + input serialization caveat:** `/typescript-sdk.md`, `/python-sdk.md`, `/ruby-sdk.md`. Use this for the `scripts/replay.<ext>` shape and the rules for what to print to stdout.

1. **Gather all trace function keys** by searching for SDK patterns (`getFunction("key")`, `get_function("key")`, `bitfab_function "key"`, `WithFunctionName("key")`, plus keyed framework handlers: `getLangGraphCallbackHandler("key")` / `get_langgraph_callback_handler("key")` (or the LangChain-named aliases) and `getOpenAiAgentHandler("key")` / `get_openai_agent_handler("key")` and `getClaudeAgentHandler("key")` / `get_claude_agent_handler("key")` and `getVercelAiMiddleware("key")`; plus trace-processor registrations (unkeyed in code, the key is derived server-side from the workflow name): `getOpenAiTracingProcessor()` / `get_openai_tracing_processor()`). This is the source of truth for what replay must cover.
2. **Search for existing replay scripts**: files matching `scripts/replay.*`, `scripts/*replay*`, or any file importing/calling the SDK's replay API.
3. **Compare coverage.** Replay is non-interactive once entered, do not ask the user whether to create or add scripts. Determine which case applies:
   - **All keys already have replay scripts:** verify each one conforms to the Replay Output Contract in the docs (emits the full `ReplayResult` as one JSON block, including every item's `traceId`/`trace_id`, `durationMs`/`duration_ms`, `tokens`, and `model`, never just counts or per-field log lines) and supports all four optional flags (`--code-change`, `--experiment-group-id`, `--trace-ids`, `--dataset-id`). Fix any that don't conform or are missing flags. Once every script is present and conformant, coverage is complete, there is nothing to create, proceed to the replayability safety-net (a conformant script can still wrap a non-replayable root, so the safety-net runs in this path too, not just when scripts are missing).
   - **Some keys are missing scripts, or no replay scripts exist yet:** the missing scripts must be created next.
4. **Create the replay script** following the example in the SDK reference's Replay section (`https://docs.bitfab.ai/<language>-sdk.md`), adapted to this codebase. The non-negotiables (enforced by the docs page, repeated here so the script review catches them):
   - **Ground the script in the docs, not memory.** Before writing the replay call, fetch `https://docs.bitfab.ai/reference/<language>.md` for the canonical signature and return shape, then `https://docs.bitfab.ai/<language>-sdk.md` for the script template and output contract. Quote the exact function signature + return-shape fields verbatim in your plan. Field names differ per language (Python: `result`, `original_output`; TypeScript: `result`, `originalOutput`; Ruby: `:result`, `:original_output`), do not paraphrase or invent names like `new_output`/`trace_id`.
   - **For keys with a decorated function in the app: pass the decorated function itself, not an undecorated wrapper.** The trace function key is read from the decorator/attribute on the function you pass in. A plain closure around the decorated function (e.g. `(x) => fn(x)`) carries no key, so `replay()` wraps the closure as the root span while the decorated function records its own span underneath, nesting a duplicate, pass the decorated function directly. (Handler-instrumented keys have no decorated function; see the next bullet.) For Python class methods, pass `Class.method` (or a bound `instance.method`). For TypeScript, the key is passed as a string arg alongside the function, use the exact key from the instrumented code. For Ruby, pass `receiver` + `method_name:` + `trace_function_key:` matching the `traceable` decoration.
   - **Handler-instrumented keys (no decorated function in the app) replay by explicit key.** When a key is registered only via a framework handler (`get_langgraph_callback_handler("key")`, `get_openai_agent_handler("key")`, `get_claude_agent_handler("key")`, `getVercelAiMiddleware("key")`, or the TS equivalents), there is no decorated function to import; that does NOT make the key unreplayable. Define the pipeline's replay function in the script as a plain callable and pass the key explicitly (Python: `client.replay("<key>", fn, ...)`; TypeScript: `bitfab.replay("<key>", fn, opts)`), re-invoking the framework entrypoint with the recorded root input (a dict root input arrives as a single positional argument) plus a freshly constructed environment (framework config, dependency objects). On SDKs that predate explicit-key replay, wrap the callable under the same key yourself (Python `@bitfab.span("<key>")` with a `(**state)` signature for dict roots; TS `getFunction(key).withSpan(...)`). Substitute safe no-ops only for side-effectful wiring with no live counterpart at replay time (billing/credit callbacks, notification senders). The pattern is documented in the SDK docs' Replay section (handler subsection).
   - **Use the same `Bitfab` client across instrumentation and replay.** Import it from the instrumented module (or a shared singleton), never construct a second client inside the replay script, or registered trace functions won't resolve.
   - Accept a pipeline name as a CLI argument
   - Accept optional `--limit N` (default 10) and `--trace-ids id1,id2` flags. When both are passed, `--trace-ids` wins: the SDK ignores `limit` with a warning (an explicit ID list determines the count)
   - Accept optional `--code-change <path>` flag: path to a JSON file shaped `{ "description": string, "files": [{ "path": string, "before": string, "after": string }] }`. Read the file, then pass its `description` as `codeChangeDescription` / `code_change_description` and its `files` as `codeChangeFiles` / `code_change_files` into the SDK's `replay()` call. Forward the file objects through verbatim, do **not** add a `repo`, `commit`, or other context fields; `path` is the sole identifier (use `""` for newly created or deleted files). The improve skill's iteration loop writes this file before invoking the script so each experiment shows the literal edit alongside its results in the dashboard.
   - Accept optional `--experiment-group-id <uuid>` flag: pass the value as `experimentGroupId` / `experiment_group_id` into the SDK's `replay()` call. This groups test runs from the same iteration so the experiments page can stream results live as the replay runs.
   - Accept optional `--dataset-id <uuid>` flag: pass the value as `datasetId` / `dataset_id` into the SDK's `replay()` call. For replaying a dataset, **prefer `--dataset-id` over `--trace-ids`**: when `--dataset-id` is passed without `--trace-ids`, the server replays exactly that dataset's traces AND durably attributes the resulting experiment to the dataset (it shows under the dataset's experiments even when trace lineage can't be reconstructed). Passing the dataset's trace IDs by hand is no longer necessary. If both flags are passed, every trace ID must belong to the dataset or the server rejects the call.
   - Map pipeline names to trace function keys and their replay functions
   - **Each pipeline's replay function MUST import and call the actual instrumented function** (for handler-instrumented keys: import and re-invoke the actual framework entrypoint), never a stub or identity function. If the function signature doesn't match the raw input shape, reshape arguments in the wrapper.
   - **Replay runs in the app's environment.** The script imports the app as a library, DB clients, env vars, config loaders, and model IDs resolve from the loaded environment. Do **not** mock them. Run the script with `.env` loaded (e.g. `pnpm with-env tsx scripts/replay.ts`, `dotenv run -- python scripts/replay.py`, or the project's equivalent) so the app's normal bootstrap applies.
   - **Only mock what has no live counterpart at replay time.** For factory-created instrumented functions (taking session, stream writers via closure), the wrapper passes:
     - Stream/socket writers: no-op (`{ write: () => {}, merge: () => {} }`), no client on the other end
     - Session/request identifiers: minimal stub with the fields the function reads
   - **Caveat: watch for module-level import side effects.** Importing the instrumented function transitively runs the app's module initialization, if that opens listeners, binds ports, or connects to prod, the replay script inherits it. When in doubt, confirm the replay env points at a staging/local DB before running.
   - **Follow the docs' Replay Output Contract**: capture the full `ReplayResult` (items + `testRunId` + `testRunUrl`, including `durationMs`/`duration_ms`, `tokens`, and `model` per item) into one variable and emit it as a single JSON object to stdout via `JSON.stringify(result, null, 2)` (TS), `json.dumps(result, indent=2, default=str)` (Python), or `JSON.pretty_generate(result)` (Ruby). Stdout must contain only that JSON block: no banners, counts, summaries, URLs, progress lines, env-loader noise, or previews. A subagent or `replayProgress` wrapper must be able to `JSON.parse` / `json.loads` one contiguous block; the wrapper captures stdout and appends it as the `type: "complete"` row in that replay run's `events.jsonl` for the agent to read.
   - Print a short human-readable summary (total replayed, same, changed, errors) and the test run URL to stderr only, never stdout
   - Live in a `scripts/` directory (or the project's existing scripts location)
5. **Safety net for legacy instrumentation.** First decide whether any instrumented trace function can't be replayed from the replay script. Two failure modes: **(1) not invocable**, the function isn't exported or is defined inline in a route handler; **(2) not replayable**, its root takes unserializable inputs (live SDK/DB clients, HTTP `Request`/`Response`, stream writers, sockets, opaque request contexts), so even an invocable call replays with empty or stubbed args. Such functions were introduced before Instrument's trace-boundary serializability gate, or via another path. Reason from each function's signature and visibility, and where a captured trace exists for the key, compare the signature against the trace data: an empty or `<unserializable: ...>`-stubbed recorded root input confirms the root isn't replayable. Do not execute the script to detect this.

   **Keyed root-handler keys are not a safety-net case.** A key registered only via a callback handler or a trace-processor run wrapper (LangGraph / LangChain, OpenAI Agents SDK, Claude Agent SDK, or Vercel AI SDK) has no decorated function by design and records the framework's serializable input as the root; create its pipeline with the key-based replay pattern from step 4 instead of offering these resolutions. **Bare trace-processor-only keys (OpenAI Agents SDK over plain `run()`) ARE a safety-net case, not an exemption:** the processor records an empty-input root, so a processor-only key with neither the run wrapper (`getOpenAiAgentHandler` / `get_openai_agent_handler`) nor a manual `withSpan`/`@span` root is not replayable. Offer the resolutions below, with "route the run through the run wrapper, or add a manual root that takes the run input" as the fix.

   - **every instrumented function is invocable from the replay script and its root is replayable (no safety-net case applies)**: nothing to resolve → step 1 of the Cleanup phase

   If one or more functions can't be invoked or aren't replayable, ask the user offering Instrument's trace-boundary resolutions:

   > A) **Move trace boundary inward** → step 1 of the Cleanup phase
   > B) **Refactor** *(recommended)* → step 1 of the Cleanup phase
   > C) **Leave as-is**: add a header comment noting why the key isn't replayable (not callable, or a non-replayable root such as a bare processor-only key over plain run() with an empty-input root) and flag that the script will rot → step 1 of the Cleanup phase

   **If the user picks "Refactor" (or a boundary move that requires rewriting callers), apply the "Refactor confirmation" rule below, present a refactor plan labeled as *visibility* or *structural* and get a second confirmation before modifying code.**

## DB Snapshot

**Run only when mode is `db-snapshot`.**

Set up **per-trace database snapshots for replay** so the team can re-run a historical trace against the database state that existed *when the trace was captured*, not today's data. This is what makes replay trustworthy for any code that reads stored state (a refund decision over a since-cancelled order, a retrieval step over last week's rows). Triggered explicitly by `$bitfab:setup db-snapshot`, never reached from `wizard`.

**Available for TypeScript, Python, and Ruby** (the SDKs with `ReplayEnvironment`). Go has no replay, so DB-snapshot replay does not apply, if the project is Go, say so and stop.

**Capture is automatic, there is nothing to turn on.** Every root trace already pins the wall-clock instant it ran (no client config required), so any trace can later be replayed against its historical DB state. Setup is therefore just two pieces:
1. **Connect the database once** in the Bitfab dashboard. The source database can be **any Postgres**: Bitfab provisions a branchable managed copy from it. A one-time, dashboard-side step.
2. **Wire replay** to read the per-trace branch URL: pass a `ReplayEnvironment` to the replay call and, inside the replayed function, connect using the environment's branch URL instead of your live `DATABASE_URL`.

**Source of truth:** read https://docs.bitfab.ai/db-branching.md (the end-to-end, per-language setup) and your SDK's reference (`/reference/typescript.md`, `/reference/python.md`, `/reference/ruby.md`) for the exact `ReplayEnvironment` / `replay` signatures before editing any code. The construction call, the replay option, and the accessors differ per SDK, do not improvise from memory.

1. **Confirm the SDK language.** DB-snapshot replay is available for **TypeScript, Python, and Ruby**. If the project is **Go**, tell the user Go has no replay so this doesn't apply, and route to cleanup.

   **Check authentication.** Run:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/status.js"
   ```

   If it reports not authenticated, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/login.js"` (blocks until the browser login completes), then continue.

   **Locate the replay script(s)** you'll edit later: search for files importing/calling the SDK's `replay` (commonly under `scripts/`). If there are **no** replay scripts yet, tell the user to run `$bitfab:setup replay` first to create them, then come back (route to cleanup), DB-snapshot augments an existing replay script, it does not create one from scratch. No client-config edit is needed: snapshot capture is always on, so there is nothing to add to `new Bitfab({ ... })`.
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
4. Update the replay script(s) from step 1 so the replayed function connects to the per-trace branch. Ground every edit in https://docs.bitfab.ai/db-branching.md and your SDK's `ReplayEnvironment` / `replay` reference, fetch the page for the project's language first; the construction call, the replay option, and the accessors differ per SDK.

   1. **Create one replay environment** and pass it to the replay call. Use the form for the project's language:

   **TypeScript**: `new ReplayEnvironment()`, passed as `replay(key, fn, { environment })`:

   ```ts
   import { ReplayEnvironment } from "@bitfab/sdk"

   const env = new ReplayEnvironment()
   const result = await client.replay("my-function", myInstrumentedFn, {
     limit: 10,
     environment: env,
   })
   ```

   **Python**: `ReplayEnvironment()`, passed as `environment=`:

   ```python
   from bitfab import ReplayEnvironment

   env = ReplayEnvironment()
   result = client.replay(my_instrumented_fn, limit=10, environment=env)
   ```

   **Ruby**: `Bitfab::ReplayEnvironment.new`, passed as `environment:`:

   ```ruby
   env = Bitfab::ReplayEnvironment.new
   result = client.replay(
     receiver, :my_method,
     trace_function_key: "my-function",
     limit: 10,
     environment: env,
   )
   ```

   2. **Inside the replayed function, connect through the environment's branch URL** instead of your live `DATABASE_URL`, gated on the active flag (the accessor names differ per language):
   - **TypeScript:** `const url = env.active ? env.databaseUrl : process.env.DATABASE_URL`
   - **Python:** `url = env.database_url if env.active else os.environ["DATABASE_URL"]`
   - **Ruby:** `url = env.active? ? env.database_url : ENV["DATABASE_URL"]`

   Always gate on the active flag first: it is **false** on the normal live request path, and for traces captured before the SDK version that added always-on snapshot capture. Reading the branch URL while inactive **throws**, so never read it unguarded.

   3. **Resolve the connection per call, not at module/import time.** A pool created once at import (a module-level `Pool` / engine / connection bound to `DATABASE_URL`) will never see the branch URL. If the app pins its DB client at import, refactor so the replayed function can build (or be handed) a client from the environment's branch URL for the duration of the item. Flag this when you spot an import-time pool, it's the most common reason a wired replay still hits production data.

   Leave the live request path untouched: only the replay entry point reads the environment. (Optional, TypeScript only: you can pass `dbSnapshot: { provider: "neon" }` to `new Bitfab({ ... })` to pin the provider at capture time. It is **not required**: capture works without it; the provider is otherwise resolved at replay time.)
5. Verify the wiring end-to-end with a **recently captured** trace. Capture is automatic, but a trace only carries a snapshot ref if it was recorded by an SDK version with always-on capture, so use a fresh one to be safe:

   1. Run the instrumented function once (or have the user trigger it) so a new trace lands.
   2. Run the replay script against that trace (e.g. `pnpm with-env tsx scripts/replay.ts <pipeline> --limit 1`, `python scripts/replay.py <pipeline> --limit 1`, `bundle exec ruby scripts/replay.rb <pipeline> --limit 1`, or the project's equivalent, with the app environment loaded).
   3. Confirm the branch was injected: inside the replayed function, the environment's active flag should be **true** and its branch URL's host/database should differ from the app's normal `DATABASE_URL`. Print the test run URL from the replay output so the user can open the experiment.

   If the active flag is **false** for a freshly captured trace, either the source database isn't connected (re-check the dashboard Database section, step 2) or the SDK predates always-on capture (upgrade with `$bitfab:update`).

   Caveats to surface to the user: each branch lease is short-lived (a few minutes) and is created fresh per replay item; the branch reflects the source database's state at the snapshot instant, bounded by replication lag (typically sub-second to a few seconds).

## Templates

**Run only when mode is `templates`.**

Iterate on the **span-rendering templates** for one trace function. Each round: the user describes what should look different, you call `mcp__Bitfab__get_template` → edit → `mcp__Bitfab__update_template` **with `traceFunctionKey` set to the picked key**, and the user refreshes the chromeless template-preview page to see the change rendered against a real trace. Loop until the user is satisfied. Triggered explicitly by `$bitfab:setup templates [<key>]`, never reached from `wizard`.

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

   Call `mcp__Bitfab__search_traces` with `{ traceFunctionKey: "<key>", limit: 1 }`. If the response contains a trace ID, continue. If the response indicates no traces exist (e.g. `No traces found matching the filter criteria.`), exit and tell the user in one short line: `No traces yet for <key>. Run your app (or the replay script) to generate one, then re-run \`$bitfab:setup templates <key>\` to preview.` Do NOT block waiting; the user re-invokes when they have a trace.

   - **trace exists**: continue and open the preview → step 5
   - **no traces yet for this function**: exit and tell the user to generate a trace and re-run → step 1 of the Cleanup phase
5. Launch the preview command **in the background** so the agent can keep iterating while the page stays open:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/startTemplatePreview.js" <functionKey>
   ```

   Run this in a long-lived exec session (`exec_command` with `is_background: true`); capture the session id so you can `read` it between edit rounds to check whether it has exited.

   If stdout emits `{"event":"window-opened","url":"..."}`, immediately tell the user `Studio opened: <url>` in a normal chat message before continuing to poll.

   The command **blocks until the user clicks Done in Studio**, then exits 0 with a single line like `Template preview closed [via studio]`. If the user instead just closes the browser tab without clicking Close, the process keeps running until the 30-minute timeout. The page auto-redirects to the most recent trace for the function and renders it with the org's current templates; it subscribes to SSE `template:updated` events and re-renders the affected span automatically, so the user does NOT need to refresh after each edit.

   🚨 **Stdout is a mixed JSONL + free-form stream.** Two event shapes flow over the same channel as the user interacts with the live preview:

   ```json
   {"event":"click","ts":"...","traceId":"...","spanId":"...","spanType":"...","sectionPath":"metadata","fieldPath":"metadata.tokens","rawText":"1234","selector":"..."}
   {"event":"focus","ts":"...","traceId":"...","spanId":"...","viewMode":"span","expandedSections":["metadata"]}
   ```

   `click` events fire when the user clicks a decorated element. `focus` events fire on initial load, on every span/trace selection change, and on shadow-root `<details>` open / close, so you always know the starting viewport even before any click.

   Free-form text (browser-handoff status lines, errors) goes through the same stdout. **You MUST filter to lines that parse as JSON before routing.** Skip anything that doesn't parse, never error out on non-JSON lines. The click event payload follows the template-anchor catalog returned by `mcp__Bitfab__get_template_reference`; `fieldPath` matches a row there, `sectionPath` matches a section id. Unknown anchor values are omitted (the click handler drops them); `rawText` and `selector` are always present so you can disambiguate. Focus event fields are always present; `spanId` is null when the user is on the trace overview, `viewMode` is `"trace"` or `"span"`, and `expandedSections` lists the `data-section` ids whose `<details>` is currently open.
6. Each round of the loop. **Every `mcp__Bitfab__get_template` and `mcp__Bitfab__update_template` call must include `traceFunctionKey: <key>`** (the key picked in step 1); without it you'd edit the org-global instead of this function's override.

   1. **Tail the background process's stdout** for any `{"event":"click",...}` or `{"event":"focus",...}` JSON lines that arrived since the previous round. Parse each line; skip non-JSON status lines.
      - **Most recent click** (if any) is ground truth for "what the user is referring to": its `spanType` is the template to edit, `sectionPath` + `fieldPath` (against the anchor catalog from `mcp__Bitfab__get_template_reference`) tell you which region to change. If `fieldPath` is absent, fall back to `sectionPath` + `rawText`.
      - **Most recent focus** tells you what the user is currently looking at, even without a click. Use it to anchor a question when the user's instruction is ambiguous (e.g. "make this less verbose" while their focus is on a specific span) and to pick the span type when no click is available. Focus is also helpful to confirm in your acknowledgement that you're editing the same span the user is viewing.
      - If neither signal is present since the last round, fall through to step 2 and ask normally.
   2. Ask : **"Tell me how you want your trace data to look and I'll make the changes in Bitfab. You'll see the changes update live in the Bitfab Studio (the browser tab opened from here)."** **If there was a click in the previous round, anchor the question to it** by prepending a one-line acknowledgement (e.g. "You clicked the tokens value in metadata."). Keep the framing open-ended, do NOT list the six span types up front; let the user describe what they want and pick the span type from their answer. If the user names one of the six span types (`llm`, `agent`, `function`, `guardrail`, `handoff`, `custom`), use that. If their answer is unambiguous about the rendered region but doesn't name a span type AND there was no click, fall back to which of the six span templates they want to edit. Don't guess the span type from a description like "make this less verbose," since the same description fits multiple templates.
   3. Call `mcp__Bitfab__get_template` with `spanType` and `traceFunctionKey: <key>` to read the **live** content. The response labels its source: `scoped to traceFunctionKey "<key>"` (a per-key row already exists), `org-global override` (no per-key row yet, this is your seed for the first save), or `source: file <name>` (no DB rows at all). **Always** read before write: the prior round may have edited the same template, and overwriting blindly drops that work.
   4. Edit the returned source in-context, **one focused change per round**. Resist the urge to bundle multiple unrelated tweaks into a single save: small steps let the user see each effect land on the preview and redirect mid-loop if the change isn't quite right. Stay inside the documented Nunjucks variables and filters (per the reference). Don't introduce `{% extends %}`; the assembler injects into `base.njk`'s content block, so extends will break composition. When adding new visible regions, **decorate them with the catalog anchors** (`data-section`, `data-field-path`, `data-iter-index`) so future clicks resolve cleanly.
   5. Call `mcp__Bitfab__update_template` with `spanType`, `traceFunctionKey: <key>`, and the full edited body. The tool upserts the per-function row in place (no version bump, no row juggling). On the first save for a span type the row is created; subsequent edits update it. The browser shows a brief "Editing..." status banner while the call is in flight, then a "Saved" flash when it returns, no extra signaling needed from your side.
   6. Acknowledge the save in one short line (e.g. "Saved."). The preview page subscribes to SSE `template:updated` events and re-renders automatically, do NOT tell the user to refresh. Do not paste the template body back into chat. After a non-trivial change you may briefly ask  whether the result looks right before starting the next round; for obvious tweaks (a label rename, a colour swap), skip the check and proceed.

   Before asking the user about another change, **check whether the background process from step 5 has exited**. The terminal signal is a line containing `Template preview closed` on stdout (the process exits 0 right after).

   Use `read` against the captured exec session; the `Template preview closed` line on stdout means the user clicked Close and the session has exited. **Use the same read to harvest any new `{"event":"click",...}` and `{"event":"focus",...}` JSON lines for step 1 of the next round.**

   Two ways the loop ends:

   - **background process exited (user clicked Close)**: exit the loop and acknowledge that template editing is done → step 1 of the Cleanup phase
   - **user explicitly says they're done**: exit the loop and acknowledge → step 1 of the Cleanup phase
   - **user wants another change**: loop back and apply the next edit → step 6

## Cleanup

1. Close Studio. Run this unconditionally: it resolves the active session from disk, closes the Studio tab (the daemon ends the session and stops appending to the event file), and exits quietly (`{"event":"no-active-studio"}`) when nothing was opened:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/closeStudio.js"
   ```

   No sessionId argument is needed; do not track or look up one. This is silent housekeeping: never narrate it, reason about whether a session was opened, or report the outcome to the user (no "closing Studio", no "nothing to close").

## Refactor confirmation (applies to Instrument's workflow-selection step and Replay's safety-net step)

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
   - **"Cancel"**: return to the previous choice prompt (Instrument's workflow-selection (a)/(b)/(c), or Replay's safety-net three-option prompt) so the user can pick a different resolution

Never modify existing code on a refactor path without completing this three-step confirmation. Adding new instrumentation wrappers to unchanged functions is not a refactor, this rule does not apply to Instrument's write-instrumentation step (purely-additive instrumentation).

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
   - `Files changed:` followed by a numbered list, every file the cycle will touch. This always includes the replay script path for non-Go projects (`scripts/replay.*` new or edited, per step 11b) alongside any instrumented source files. Go-only projects list only the instrumented source files.
   - `Setup: <one-line setup description>` (any plan that registers a trace processor)
   Hybrid plans (manual spans + processor) include both, with `Setup:` first then `Files changed:`. A pure-processor plan still lists `Files changed:` because the processor-registration file is edited and the replay script (non-Go) is written. Go-only pure-processor plans with a single registration file and no manual spans may include only `Setup:` plus that one file under `Files changed:`.
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

After building the plan according to the rules above, ask the user with these three options:
- **Proceed** (recommended), accept the default view as shown
- **Expand details**: re-render using the expanded view template
- **Adjust**: user wants changes; ask what

### Trace Plan Accuracy

Read function signatures when the trace plan will reference their parameter names or return fields. Skipped leaf functions can be named from grep results if their shape isn't exposed in the plan. Never guess names that appear in the plan.
