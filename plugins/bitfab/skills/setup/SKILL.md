---
name: setup
description: "Set up and maintain Bitfab tracing for AI features. TRIGGER when: user wants to set up Bitfab, instrument code, add tracing/observability for LLM or agent calls, observe AI calls, add evaluation, trace LLM functions, trace a new workflow, change what an existing trace captures, re-instrument an existing traced function (move a database read or other side effect in or out of a span, change what a span records as its input/output), inspect or debug their tracing setup (what's instrumented, why traces aren't showing up), or understand what Bitfab is; or says anything like 'instrument', 'add tracing', 'trace my code', 'set up observability', 'hook up Bitfab', 'start tracking my AI workflow', 'trace a new workflow', 'update my tracing setup', 're-instrument', 're-instrument <function>', 'move the database read out of the span', 'make this trace replayable without a database', 'change what this span records as input', 'why aren't my traces showing up', 'what is Bitfab', 'set up database snapshots', 'replay against my database state at trace time', 'analyze the repo for what to instrument', 'analyze-repo', 'instrument the second/next/other one', 'instrument another function'. This trigger applies even mid-conversation and after setup already ran: every additional function to instrument must re-enter this skill. SKIP when: user is (a) improving the QUALITY of a traced function's outputs, fixing failures, pass rates, labeling, running experiments (use bitfab:assistant); or (b) upgrading the plugin/SDK to a newer *version* (use bitfab:update). Invoke with $bitfab:setup [wizard|explain|login|session-logs|instrument|modify|inspect|switch-org|replay|db-snapshot|templates|analyze-repo] [<what to do>]."
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

This skill has eleven phases: **explain**, **login**, **session-logs**, **instrument**, **modify**, **inspect**, **switch-org**, **replay**, **db-snapshot**, **templates**, and **analyze-repo**. Run individually or through setup (`wizard` runs login → instrument; `explain` is a standalone read-only overview that requires no login; `session-logs` is standalone and does not require login; `modify` is only invoked explicitly or as a branch from Instrument's existing-SDK-usage menu; `inspect` is a standalone diagnostic (with optional one-shot fixes) invoked explicitly; `switch-org` is a standalone account action (requires auth) invoked explicitly; `db-snapshot` is only invoked explicitly; `templates` is only invoked explicitly; `analyze-repo` is a standalone, **non-interactive** batch action (requires auth) invoked explicitly: it scans, picks the top few candidates, and reports source locations and replay dependencies, asking nothing and editing no code).

**Natural-language aliases:** "explain Bitfab" → `explain`; "trace a new workflow" / "instrument another function" → `instrument`; "adjust what is captured" / "re-instrument" → `modify`; "why are my traces missing" → `inspect`; "switch org" → `switch-org`; "set up database snapshots" → `db-snapshot`; "analyze the repo" → `analyze-repo` (read-only source recommendations).

When instrumenting a workflow, **its instrumentation and replay pipeline are written together in the same cycle** after the workflow is selected (see Instrument's write-instrumentation step). The standalone `replay` mode remains available for coverage-verification and backfill.

**Preserve the project's capture opt-out.** When initialization sets `captureEnabled: false` / `capture_enabled=False`, keep framework handlers, processors, callbacks, middleware, and wrappers installed so the application continues to run normally, but verify that ordinary execution produces no client-owned records, including local BAML calls. Replay and seed modes are explicit recording operations and continue to produce records. Never "fix" an opt-out by removing an integration or preventing the wrapped framework call from running.

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
- **Default to opt-out tracing.** For TypeScript, install and wire the matching `@bitfab/transform` build adapter, then use `withTrace`/`trace` for the workflow root and `withNode`/`node` only where a discovered call needs naming, typing, capture, finalization, or replay-mocking policy. For Python 3.12+, use `@client.trace` and `@client.node` the same way. Opt-in `withSpan`/`span` remains supported, but setup chooses it only when opt-out is technically impossible: Ruby, Go, Python before 3.12, a TypeScript build path for which the documented transform adapters truly cannot be wired, or a live streaming root whose output opt-out tracing cannot finalize without changing behavior. Framework handlers, processors, and their generated spans are compatible descendants of an opt-out root and are never by themselves a reason to choose spans. Keep the framework integration and use `withNode`/`node` for first-party calls that need explicit policy. Existing manual spans in the selected call stack are also not a reason to fall back. Convert that whole call stack to one opt-out surface. Before converting a span-bearing helper in place, inspect every production caller and confirm each caller belongs to the same opt-out surface; a helper shared with an opt-in caller requires a disjoint trace boundary or explicit refactor confirmation. Remove redundant span wrappers and replace policy-bearing spans with nodes. Preserve their names, types, capture controls, finalizers, and replay-mocking behavior. TypeScript `withNode` requires a named function, so preserve an existing name or use an additive named function form; stop for refactor confirmation if naming it would require a non-additive rewrite. Never put `withSpan` beneath `withTrace`. The SDK raises `MixedTracingError`. Name all three primitives when fetching a reference page so the fetched guidance cannot collapse back to spans alone.
- **Cross-SDK shared semantics:** `/reference/overview.md` (invariants), `/reference/span-types.md` (the `SpanType` enum), `/reference/http.md` (wire protocol).
- **Framework integrations (fetch when a framework is detected in step 1 of Instrument):** `/frameworks/langgraph.md`, `/frameworks/openai-agents.md`, `/frameworks/claude-agent-sdk.md`, `/frameworks/baml.md`, `/frameworks/vercel-ai-sdk.md`. Each page documents the SDK's native handler/processor/wrapper for that framework, which is usually preferable to hand-wrapping every node/agent call with `withSpan`/`@span`.
- **Tutorials / walkthroughs / replay registry module template:** the language-specific documentation pages (`/typescript-sdk.md`, `/python-sdk.md`, `/ruby-sdk.md`, `/go-sdk.md`). Use these for the copy-pasteable replay registry module and the replay output contract. During Instrument, fetch the Replay section before Instrument's write-instrumentation step so the replay registry module can be written alongside the instrumentation in the same cycle without re-fetching.

**MCP tools:** Use the plugin tools for authentication, trace functions, trace search, organizations, database connection status, and templates as specified by each step.


**Product pages:** Link to the existing app pages for experiments, datasets, and other dashboard features. Use /plugin only for automatic-close login and template previews. Page commands print one JSON line with `event: "link"` and `url`, then exit. Relay the URL in chat. The user reports review decisions in chat; fetch current saved state with MCP before continuing. Never treat printing a link or closing a browser tab as approval.

**CLI commands** available via Bash (all paths relative to `${BITFAB_PLUGIN_DIR}/dist/commands/`):

| Command | Description |
|---------|-------------|
| `pageLink.js <path>` | Print a clickable product page URL and exit. |
| `openExperiments.js <testRunIds>` | Print a link to experiments. |
| `startDataset.js <key> <datasetId>` | Print a dataset link. |
| `status.js` | Check plugin authentication and connection status |
| `login.js` | Open a sign-in window and wait for authentication. Relay the printed sign-in link as a fallback. |
| `switchOrg.js [<clerkOrganizationId>]` | List the user's Bitfab orgs (no args), or switch the plugin's active org and replace the local API key (with a <clerkOrganizationId> arg) |
| `startTemplatePreview.js <functionKey>` | Print a template preview link and exit. |
| `update.js <mode>` | Check plugin + SDK versions and install the latest (used by inspect to detect and fix staleness) |
| `sessionLogConsent.js [get|set true|set false]` | Read (`get` prints `true`/`false`/`null`) or persist (`set true|false`) the global session-log consent flag |

## Modes

Read `$ARGUMENTS` first. If its first token is exactly one of the mode names below, run that mode. Otherwise, when this skill documents how to route the remaining arguments (see its intro), follow that; if it doesn't, run `wizard` and treat `$ARGUMENTS` as its input. Run only that mode's section below and skip the others.

| Mode | Trigger | What it does |
|------|---------|--------------|
| `wizard` | `wizard` (default) | Run login, then instrument workflows until the user is done. |
| `explain` | `explain` | Explain what Bitfab is and what each mode does (read-only, no login). |
| `login` | `login` | Authenticate for setup and instrumentation. |
| `session-logs` | `session-logs` | Opt in or out of session log collection (no login required). |
| `instrument` | `instrument` | Instrument AI workflows with Bitfab tracing. |
| `modify` | `modify` | Modify an existing trace setup (add context, change depth, or move the root). |
| `inspect` | `inspect` | Diagnose (and offer to fix) your tracing setup: auth, what's instrumented, plugin/SDK freshness, replay coverage, trace arrival. |
| `switch-org` | `switch-org` | Switch which Bitfab org the plugin reads and writes (replaces the local API key). |
| `replay` | `replay` | Create or update replay registry modules for instrumented workflows. |
| `db-snapshot` | `db-snapshot` | Set up per-trace database snapshots so replay runs against the DB state at trace time (TypeScript, Python, Ruby). |
| `templates` | `templates` | Iterate on the span-rendering templates for one trace function. |
| `analyze-repo` | `analyze-repo` | Read-only discovery: scan source, rank the top workflows to instrument, and report recommendations without creating artifacts or changing code. |

## Login

**Run only when mode is `wizard`, `login` or `instrument`.**

Authenticate with Bitfab and retrieve the API key.

1. Run the status check:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/status.js"
   ```

   If the output includes `v<X> available, run ... to update`, surface that line verbatim to the user once before proceeding; do not block on it.

   If **already authenticated**, skip to step 3.
2. If not authenticated, run node "${BITFAB_PLUGIN_DIR}/dist/commands/login.js" as a long-running background process. Immediately relay its sign-in URL to the user. Poll the process while keeping the conversation available. The command automatically opens a sign-in window and exits after authentication, or after ten minutes. The printed link is available if the window cannot open. On failure, report the error and let the user retry. Never print or request API keys in chat.
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

Teach the opt-out tracing and replay primitives the user instruments with. Read-only, no code changes, no browser interaction. Runs inside `wizard` (right after Login, before the approach question) and standalone via `$bitfab:setup explain` (or natural-language asks like "what is Bitfab" / "explain Bitfab"), which needs no authentication.

1. Render the block below **verbatim** as a single message, as formatted markdown (do **not** wrap it in a code fence, do **not** reword it, and do **not** add a summary or an ASCII diagram). This is the education the rest of setup depends on: a user who does not understand `withTrace`, `withNode`, and `replay` cannot make the capture and replay decisions instrumentation asks of them. Do **not** authenticate, scan the codebase, ask any questions, or edit anything here, in either mode.

   ```markdown
   **Purpose**

   Bitfab's SDK captures each instrumented method's inputs, outputs, and surrounding context as a trace at runtime. During development, developers and coding agents can inject captured trace data and modify code execution at the per-method level to test AI features end-to-end.

   **How to instrument**

   Bitfab provides opt-out tracing and safe replay during development. For TypeScript and Python 3.12+, the core primitives are:

   - `withTrace(...)` / `trace(...)` for one workflow root
   - `withNode(...)` / `node(...)` to configure a discovered call
   - `replay(...)` to run recorded scenarios against current code

   Default to opt-out tracing. A trace root records its serializable inputs and output plus every first-party call beneath it. Most descendants need no wrapper. Add a node only when a call needs a name, type, capture override, finalizer, or replay-mocking policy. TypeScript requires the matching `@bitfab/transform` build adapter; setup installs and configures it. Python requires 3.12+. Opt-in spans remain supported; setup uses them as the fallback for Ruby, Go, unsupported runtimes, and live streaming roots that opt-out tracing cannot finalize without changing behavior. Keep one tracing surface per call stack. Never mix `withSpan` beneath `withTrace`; the SDK rejects mixed tracing surfaces.

   `replay` calls into your trace root and can modify each captured descendant in one of five ways:

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

   Recommend **A** and say why in one line: it is the whole flow (SDK install, instrumentation, replay registry module). Ask this once; do not re-ask it later in the session.
2. The user asked to be walked through it. **Before anything else** (before dispatching to the *Instrument* section, before a single probe or file read), render the content of the block below **verbatim** as formatted markdown: no code fence, no rewording, no additions.

   ```markdown
   **What's about to happen next**

   - This wizard will guide Codex on how to use the Bitfab plugin to analyze your repository. Codex will then instrument your AI features and register their production entrypoints in a replay registry using the Bitfab SDK.
   - Whenever Codex needs your input, it will prompt you
   - Setup takes about 10 - 17 minutes depending on how many features you want to instrument and how complex your AI features are.
   ```

   This is the user's only warning about what the skill is about to do to their repository and how long it takes. It has to reach them between saying "walk me through it" and the next question they get asked, so nothing, not the language detection, not the existing-usage report, may come first.

   Then go to the *Instrument* section and start at its first step. The guided path ends here: do **not** continue into the self-serve handoff that follows, which belongs to option B and tells you to stop.
3. The user is instrumenting on their own. Give them the pointers below in one short message, then **stop**: do not scan the codebase, read files, or edit anything.

   - **Docs:** https://docs.bitfab.ai, start with the SDK documentation for their language (`/typescript-sdk`, `/python-sdk`, `/ruby-sdk`, `/go-sdk`); each one covers install, initialization, wrapping a workflow, and (outside Go) the replay registry module. Name the language's page directly if the project's language is already obvious from the conversation; do not go read the repo to find out.
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
2. **Search for existing SDK usage** (`withTrace`, `trace`, `withNode`, `node`, `withSpan`, `@span`, `bitfab_span`, `client.Span`, `getFunction`, `get_function`, and the TypeScript transform/build adapter). In a monorepo, search **each application directory separately**: a root-level search can miss subdirectories. Classify each result as opt-out tracing, framework auto-capture, or opt-in spans. Existing spans elsewhere in the repository do not establish a house style for new instrumentation.
   - If found: ask the user, **listing the existing trace function keys inside the question's own text** (`<key>` · its root function, or its handler registration site for handler-only keys), so the user picks against the actual list instead of a message scrolled above the prompt:

   > A) **Search for more workflows**: find workflows that aren't traced yet *(recommended)* → step 3
   > B) **I'll name the workflow to instrument**: type the file, function, or directory and I read only that, no codebase scan → step 3
   > C) **Change what an existing trace captures**: adjust what one of the keys above records; type its key to go straight to it → step 1 of the Modify phase

     **B and C are both free-text options, and this is the earliest point either answer can land.** Say so in the question: they can type a workflow to instrument, or the key of an existing trace to change, instead of picking anything.
     - **B (a target to instrument)**: carry that target through the SDK install and doc steps and treat the discovery question at step 7 as already answered by it, then read just that location at step 9. Without this option a user who already knows their target has to answer "search" here, sit through the install, and then answer the same question again four steps later, which is asking them to repeat themselves.
     - **C (an existing key to change)**: the keys are right there in the question, so a named key routes to the Modify phase with the target already settled, and Modify is told to skip both the search you just ran and its own which-function question when it arrives holding a key. Only a bare C leaves Modify to ask.

     **There is deliberately no "done, finish setup" option here.** The user invoked setup and nothing has been instrumented this session, so an exit offered as a peer of the two real options invites them to undo the thing they just asked for. A user who genuinely wants out says so in free text, which is the last of the runtime routes below; do not manufacture a menu item for it.

     Routes that are conditions rather than options:

   - **no existing SDK usage found**: continue → step 3
   - **the user says in free text that they are done and want no changes**: continue → step 1 of the Cleanup phase
   - **If usage routes through a project-local shim** (a wrapper file that re-exports `withTrace` / `trace` / `withNode` / `node` / `withSpan` / `@span` / `bitfab_span` / `getCurrentTrace` / `getCurrentSpan` with custom init, often named `lib/bitfab.*` or after a predecessor SDK such as `lib/simforge.*`), audit the shim before instrumenting anything new. The shim must (a) construct the SDK client (`new Bitfab(...)`, `bitfab_init()`, `Bitfab::Client.new`, etc.) at module load, **synchronously**, never lazily inside the wrapped function; and (b) hand off to the SDK trace, node, or span call synchronously, with no `await` between the user's entry to the shim and that SDK call. Lazy or async client init (e.g. `await getOrCreateTraceFunction(key)` inside the wrapped body) breaks the SDK's nesting context (TypeScript `AsyncLocalStorage`, Python `contextvars`) under any parallel fan-out (`Promise.all`, `Promise.allSettled`, `asyncio.gather`, parallel workers): captured calls become separate top-level traces instead of nesting inside their caller. Fix the shim before instrumenting anything new. (Direct callers of the SDK with no shim already satisfy this rule, skip the audit.)
   - If not found: **proceed to step 3**: no SDK usage does NOT mean nothing to instrument, it means the SDK hasn't been installed yet. NEVER conclude "nothing to instrument" before completing step 6.
3. Use the API key from the Login phase (or retrieve it now if already authenticated)
4. **Say one line before you install anything.** This is the deliberate exception to the "do not pre-announce" execution-style rule, and the only one in this phase. The workflow and application workspace are settled now. Name both, then say that you are installing the SDK and opt-out capture support and setting the API key before instrumenting that workflow. One line, nothing around it, then get on with it.

   **Install the SDK now.** Detect the project's package manager from its manifest (`pyproject.toml` → `uv`/`poetry`; `package.json` → `pnpm`/`npm`/`yarn`/`bun`; `Gemfile` → `bundle`; `go.mod` → `go get`; `requirements.txt` → edit file + `pip install -r`) and run its canonical add command, do NOT stop to ask about version pinning, dependency groups, package publishing, or whether a supported transform adapter should be added. The user's request to instrument authorizes the dependencies and build wiring required by the selected approach. Prefer `uv add`/`poetry add` over bare `pip install` (bare `pip install` doesn't persist to pyproject.toml). In monorepos, scope to the correct workspace (e.g. `pnpm add --filter <pkg>`, or cd into the app directory first), running from the repo root will install into the wrong package. Install the SDK as a runtime dependency whenever instrumented code ships or executes from the package, including published libraries and CLIs. Use a development dependency only when the instrumented code is excluded from the published/runtime artifact. Then set the `BITFAB_API_KEY` environment variable.

   **Install opt-out capture support at the same time.** For TypeScript, add `@bitfab/transform` as a development dependency in the same application workspace and wire its adapter into the actual server build before instrumenting. Inspect the build tool and use the matching documented adapter. For Next.js, wrap the existing config with `@bitfab/transform/next` while preserving existing wrappers such as Sentry; do not replace or bypass them. For tsup, add the `@bitfab/transform/esbuild` plugin to the existing tsup esbuild options. For direct Node or `tsx`, update the real start command to register `@bitfab/transform/register`. The package also ships documented adapters for Vite, Rollup, webpack, Rspack, Rsbuild, Rolldown, Bun, SWC, Babel, Nest, and the TypeScript compiler. Verify the transformed build path covers the production entrypoint. Do not call a build unsupported until you have checked these adapters and the language guide. For Python, verify the runtime is 3.12+ before choosing `trace`/`node`. Fall back to opt-in spans only when the language/runtime or build path truly cannot support subtree capture, or when the selected root returns a live stream that opt-out tracing cannot finalize without changing behavior. A published package, a framework-generated span model, or the need to add a supported transform adapter is not a fallback reason. State the concrete technical blocker to the user and keep the whole selected call stack on one tracing surface.

   **Keep organization-specific keys isolated.** Inspect how the selected application already names and loads Bitfab keys before changing its client initialization. A TypeScript client whose configured `apiKey` is missing or resolves empty falls back to `BITFAB_API_KEY`. If this client intentionally uses a dedicated key for another organization or environment, also set `captureEnabled` from the presence of that dedicated key. Never rely on an empty dedicated key to disable tracing because the fallback can send traces to the organization bound to `BITFAB_API_KEY`. Do not replace an existing general-purpose `BITFAB_API_KEY` when the application deliberately keeps these destinations separate.

   **Tell the user what you did.** Pick the env-handling approach that fits the project's existing convention. Whatever you do, surface it explicitly: name the file (with absolute path) or mechanism you used, so the user knows where the key now lives. Do not print the key value itself. If the key landed in a `.env`-style file, additionally tell the user that any already-running dev server, REPL, or test runner may need a restart to pick it up, since most file watchers reload code on save but not env files.
5. **Read the SDK reference.** Fetch the dense canonical reference page first (`/reference/typescript.md`, `/reference/python.md`, `/reference/ruby.md`, or `/reference/go.md`) for every signature, type, default, and error semantic you need (initialization, `withSpan` / `@span` / `bitfab_span` / `client.Span`, the subtree primitives `withTrace` / `trace` and `withNode` / `node` in TypeScript and Python, `getFunction` / `get_function` / `GetFunction` / `bitfab_function`, `SpanType`, `getCurrentSpan`/`getCurrentTrace`, `wrapBAML`/`wrap_baml`). **Ask the page for all three primitives by name, not just spans**: the fetch returns an answer to your prompt rather than the page, so a prompt about `withSpan`/`@span` alone comes back documenting spans alone, and you will instrument without ever learning that `trace` (a root that captures every first-party call beneath it, no decorators) and `node` (naming, typing, capture, and replay-mock policy for one call inside that subtree) exist. If step 1 detected a framework in this application directory, also fetch the matching framework page; it documents the handler/processor/wrapper the SDK exposes for that framework, which is usually preferable to hand-wrapping every node/agent call with `withSpan`/`@span`: LangGraph / LangChain → `/frameworks/langgraph.md` (`getLangGraphCallbackHandler` / `get_langgraph_callback_handler`; in a LangChain-only project, prefer the identical aliases `getLangChainCallbackHandler` / `get_langchain_callback_handler` so the code reads naturally; Experimental (alpha) tool replay: `getLangGraphIntegration` / `get_langgraph_integration` with `createInvoker` / `create_invoker` / `create_async_invoker`); OpenAI Agents SDK → `/frameworks/openai-agents.md` (`getOpenAiTracingProcessor` / `get_openai_tracing_processor`, plus the replayable run wrapper `getOpenAiAgentHandler` / `get_openai_agent_handler` (drop-in for the run call)); Claude Agent SDK → `/frameworks/claude-agent-sdk.md` (`getClaudeAgentHandler` / `get_claude_agent_handler`); BAML → `/frameworks/baml.md` (`wrapBAML` / `wrap_baml`); Vercel AI SDK → `/frameworks/vercel-ai-sdk.md` (`getVercelAiMiddleware`). Then fetch the language guide (`/typescript-sdk.md`, `/python-sdk.md`, `/ruby-sdk.md`, `/go-sdk.md`), including the Replay section for non-Go projects, for the install command, the multi-file project layout example, the BAML auto-instrumentation walkthrough, and the replay registry module template. Read the replay section upfront (not later) because step 12 reuses it to write the replay pipeline in the same cycle, and it should not re-fetch these pages. Fetch those pages (via web-fetch capability, in one batch since they are independent URLs, or ask the user to share them). **Do not improvise instrumentation from memory**: the API has moved and guessing will produce broken code.
6. **Instrumentation must produce a replayable trace. There are exactly two ways to get one: (1) a `withTrace`/`trace` root, or an opt-in fallback root span, has serializable inputs; or (2) the workflow runs on a supported framework integration that records a replayable root (LangGraph / LangChain, OpenAI Agents SDK, Claude Agent SDK, or Vercel AI SDK), which captures the framework's own serializable input as the root. Establish one of these before writing any instrumentation. Trace-processor integrations (OpenAI Agents SDK) are a special case: the processor auto-captures the agent run, but on its own records a root span with an empty input (verified against a live run: the OpenAI Agents agent span is the root and carries no recorded input), so the processor ALONE is NOT replayable. Pair it with its run wrapper (`getOpenAiAgentHandler` / `get_openai_agent_handler`), a drop-in for the run call that opens a keyed root carrying the run input as a serializable argument, with the processor's spans nesting underneath, which turns it into case (1). In an opt-out workflow, use a `withTrace`/`trace` root and configure descendants with `withNode`/`node`; use a hand-written `withSpan`/`@span` root only for a documented opt-in fallback.**

   **The root exists so the replay harness can re-invoke it as a plain lambda with serialized inputs**: that's what makes traces searchable (a coherent unit of behavior) and replayable (runnable against current code). The root must own its state setup, not consume a pre-built stateful object the replay registry module can't reconstruct. Frameworks are the sharpest case (LangGraph compiled graphs, Claude Agent SDK clients, LangChain chains all require constructors + special setup), but the rule generalizes to anything stateful, configured SDK clients, prepared models, cached routers, DB sessions. The root is therefore the outer workflow function that **builds** the framework / stateful object + invokes it + processes the output (API handler, message processor, job runner, pipeline coordinator), almost never the SDK's `run()` / `invoke()` itself. Framework handlers and processors keep their native agent, LLM, and tool spans beneath the opt-out root; their span model complements subtree capture rather than replacing it. The replay callable rebuilds the framework/stateful object around the recorded root input. Put the opt-out trace root around the application workflow boundary whenever the runtime supports it, including when the workflow is mostly one framework invocation. Use `withNode`/`node` for first-party calls that need explicit naming, typing, capture, finalization, or replay-mocking policy. Use a hand-written root span only for a documented technical fallback, and never put it beneath an opt-out trace.

   **Wrap the code path that runs the real workload (serves traffic, processes the actual jobs), not an entrypoint that exists only to test or explore locally.** The test is role, not form: a cron-driven batch script or an ETL job is production and worth wrapping; a dev CLI or notebook that exists only to poke at the workflow is not. Instrument the real path even when you'll run it in dev to generate traces.

   **Hard constraint: every wrapped function's inputs and outputs must be serializable by the SDK's tracing layer so traces can be replayed.** Every span input and output gets serialized into the trace using the SDK's language-native serialization (TypeScript/JSON, Python/JSON via Pydantic, Ruby/`to_json`, Go/`json.Marshal`). If a wrapped function takes live runtime objects that don't round-trip through that serialization, the trace can't be replayed, and badly-failing inputs can drop the entire span on the floor (not just garble the input field). Examples of unserializable inputs:
   - browser objects (`MediaStream`, `RTCPeerConnection`, `WebSocket`, DOM refs)
   - HTTP `Request` / `Response`, stream writers, open sockets
   - framework request contexts whose content is genuinely opaque (not reconstructible from headers + user id)
   - **live SDK client instances passed as arguments** (LLM clients like `OpenAI` / `Anthropic` / Bedrock, configured agents, DB connection objects, HTTP agents): class instances whose internals carry circular references, function members, or platform handles all sink superjson and `JSON.stringify`. Watch especially for an options/config bag (e.g. `options.llmProvider`, `ctx.db`) that smuggles a live client into an otherwise-serializable signature.

   **Unserializable OUTPUTS (live streams) are a separate case from unserializable inputs, and in the TypeScript SDK they do NOT require a refactor.** A function whose inputs are serializable but which returns a live stream the caller consumes directly (a Vercel AI SDK `streamText` result, a `ReadableStream`, an SSE / streaming `Response`) is the common shape for chat and agent endpoints. Serializing that object as-is captures nothing replayable, and awaiting it to completion before returning would break streaming and first-byte latency. Record a drained, serializable view of the stream as the span output instead:
   - **TypeScript: treat this root as an explicit opt-in fallback and use the `withSpan` `finalize` option** (`withSpan(key, { type, finalize }, fn)`). Keep this call stack entirely opt-in; never put this span beneath `withTrace`. The wrapped function returns the live stream to the caller unchanged; the span records `await finalize(result)` (e.g. `{ text, usage, toolCalls }`). Pass the prebuilt `finalizers.aiSdk` for the Vercel AI SDK, or `finalizers.readableStream` for a raw `ReadableStream` (reading the AI SDK result's promises does not disturb the caller's stream, since it tees internally). This is **purely-additive instrumentation, NOT a refactor**: do it in the write-instrumentation step with no second confirmation. The trace stays replayable as long as the function's *inputs* are serializable. Never push the user into a structural rewrite of a streaming endpoint when `finalize` covers it.
   - **Python: also use the `finalize` option** (`@client.span(key, type=..., finalize=...)`). The idiomatic, non-destructive shape is an **async generator** that `yield`s its chunks (the caller still receives every chunk); `finalize` then receives the collected chunks and returns a serializable summary. Pass `finalizers.openai_chunks` for OpenAI streaming or `finalizers.anthropic_events` for Anthropic. Same rule: **purely-additive, NOT a refactor**, no second confirmation. (Python streams are single-consumer, so prefer the async-generator form over draining a returned stream object.)
   - **Ruby / Go (no `finalize` yet): introduce a serializable completion.** Trace a core that runs the turn to completion and returns `{ text, usage, ... }`, with the streaming wired around it (the structural refactor below).

   Module-level dependencies (DB clients, env vars, config loaders, LLM clients) do **not** count *when accessed via module scope or closure*: replay resolves them from the app's runtime wiring instead of serializing them as span inputs. The same client passed *as a function argument* IS captured as input and WILL fail. The fix when an SDK client is the only unserializable piece is usually trivial: hoist it to module scope (or capture via closure) and drop it from the argument list, leaving the wrapped function's serializable args (issue, request, options-without-the-client) intact. When the natural outer boundary still has unserializable inputs after that, do **one** of the following **before writing code**:
   - **Instrument via the framework handler or processor** (preferred whenever the workflow runs on a supported framework: LangGraph / LangChain via `getLangGraphCallbackHandler` / `get_langgraph_callback_handler`, OpenAI Agents SDK via `getOpenAiTracingProcessor` / `get_openai_tracing_processor`, Claude Agent SDK via `getClaudeAgentHandler` / `get_claude_agent_handler`, Vercel AI SDK via `getVercelAiMiddleware`). These split into two replayability cases, do not conflate them:
     - **Integrations that record a replayable root (LangGraph / LangChain, OpenAI Agents SDK, Claude Agent SDK, or Vercel AI SDK) are replayable as-is**, via one of two mechanisms. **Callback handlers** (LangGraph / LangChain, Claude Agent SDK, or Vercel AI SDK) record the framework invocation itself as the root span, with the framework's own serializable input (LangGraph initial state, agent prompt) as the recorded root input. **Trace processors** (OpenAI Agents SDK) don't record the input themselves, so their run wrapper (`getOpenAiAgentHandler` / `get_openai_agent_handler`) does it: a drop-in for the run call that records a keyed root carrying the run input, with the processor's auto-captured spans nesting underneath. Either way, the unserializable arguments above it (live dependency objects, billing callbacks, request contexts) never enter the trace, and no decorated root function needs to exist in the app code: the replay registry module passes the key to `replay()` with a plain callable that re-invokes the same framework entrypoint production calls with the recorded root input plus reconstructed runtime wiring (framework config and dependencies); the SDK wraps the callable internally. Unsafe calls made by that wiring still need replay-mockable marked spans; use no-op values only for replay-only callback slots with no recorded call to mock. On SDKs that predate explicit-key replay, wrap the callable under the same key yourself (Python `@bitfab.span("<key>")`, TS `getFunction(key).withSpan(...)`). The pattern is documented in the SDK docs' Replay section (handler subsection) and wired up in step 12 11b. Never report one of these workflows as "not replayable" because no `@span`-decorated function exists in production code.
     - **A bare trace processor (OpenAI Agents SDK) with neither its run wrapper nor a manual root is NOT replayable.** The processor captures the run, but its root span records an empty input (verified against a live run: the OpenAI Agents agent span is the root and carries no recorded input). Pair it with the run wrapper (`getOpenAiAgentHandler` / `get_openai_agent_handler`), the drop-in for the run call above, or, in a supported subtree runtime, a `withTrace`/`trace` root that takes the run input: the processor's auto-captured spans nest under that root, and replay runs against the root's serializable input. Use a hand-written span root only when opt-out is technically unavailable. Do not treat a bare processor-only trace as replayable.
   - **Move the trace boundary inward** to the first function whose inputs are serializable (e.g. trace `processTurn(transcript, context)` instead of `handleSession(stream, peerConnection)`). This is not a refactor.
   - **Refactor** so a function with serializable inputs exists. Two flavors, chosen per case in the refactor plan:
     - **Visibility refactor (common)**: the logic that takes serializable inputs already exists inline but isn't importable (embedded in a route handler, not exported). Extract it into a named, exported function at module scope. No semantic change.
     - **Structural refactor (rare overall, mostly realtime/browser apps)**: no function with serializable inputs exists yet. Introduce one: a pure core whose parameters are serializable, with callers constructing them. A real rewrite. (This flavor is for missing serializable-*input* cores. A streaming *output* in the TypeScript and Python SDKs is handled by the `finalize` option above, not a structural refactor; only fall back here for streaming on Ruby/Go.)

   Raise this with the user in step 10 (not later); never instrument a root with unserializable inputs and try to fix it in the Replay phase.
7. Use the target or discovery choice already supplied in this conversation. If a target is known, read it directly; if the user already requested a scan, scan now. Ask only when the target is still unclear. - **a target file, function, or directory is already known**: continue → step 9
   - **the user already asked to discover workflows**: continue → step 8 > A) **Find workflows for me** *(recommended)* → step 8
   > B) **I'll name the target** → step 9
8. Read the codebase to identify ALL AI workflows, every place the app makes LLM calls, runs agents, or makes AI-driven decisions. For each, find the **outer workflow boundary** (per the rule in step 6), and also note any meaningful work **above** the agent/LLM call (auth, validation, input prep, retry/orchestration loops, multi-agent coordination), **alongside** it (custom LLM calls outside the SDK, tools that aren't registered with the SDK, downstream services), and **below** it (post-processing, parsing, persistence). In supported TypeScript and Python workflows, this is the opt-out trace subtree; identify only the descendants that need explicit node policy. Only in fallback runtimes, identify the spans needed around auto-captured SDK content. Framework integrations in supported runtimes stay inside the opt-out trace subtree.
9. The user named a specific file, function, or directory to instrument. Read just that location and its immediate surroundings, do NOT scan the rest of the codebase. Find the **outer workflow boundary** there (per the rule in step 6), and note the meaningful work **above** the agent/LLM call (auth, validation, input prep, retry/orchestration loops, multi-agent coordination), **alongside** it (custom LLM calls outside the SDK, tools that aren't registered with the SDK, downstream services), and **below** it (post-processing, parsing, persistence). In supported TypeScript and Python workflows, this is the opt-out trace subtree; identify only the descendants that need explicit node policy. Only in fallback runtimes, identify the spans needed around auto-captured SDK content. Framework integrations in supported runtimes stay inside the opt-out trace subtree. If the location holds more than one distinct AI workflow, note each.
10. Present a numbered list of workflows found, ordered by value (most complex or LLM-heavy first). For each, give:
   - **Trace boundary**: the outer workflow function that will be the trace function root (per step 6, NOT the SDK/agent call itself)
   - **Inputs**: the shape of the function's inputs, and an explicit note that they're serializable by the SDK's tracing layer. If the natural outer boundary's inputs are unserializable (live browser/runtime objects, HTTP req/res, stream writers, sockets, opaque request contexts, live dependency/billing objects), state that here and present the three resolutions from step 6 as part of this workflow's entry: **(a) instrument via the framework handler/processor** (recommended when the workflow runs on LangGraph / LangChain, OpenAI Agents SDK, Claude Agent SDK, or Vercel AI SDK; for callback handlers, the handler-recorded root stays replayable by passing the key to `replay()` with a callable that invokes the same production framework entrypoint, using a same-key wrapper only on SDKs that predate explicit-key replay; for trace processors, OpenAI Agents SDK, use the run wrapper (`getOpenAiAgentHandler` / `get_openai_agent_handler`) in place of the run call so it records a replayable keyed root that takes the run input; a bare processor over plain `run()` records an empty-input root and is not replayable on its own), **(b) move the boundary inward to `<specific inner function with serializable inputs>`** (recommended when no framework handler applies and an obvious candidate exists; not a refactor), or **(c) refactor**. Do not proceed to step 11 until the user picks one, never instrument an unserializable root. **If the user picks (c), present a refactor plan, labeled as *visibility* (extract + export, logic unchanged) or *structural* (new pure-core fn), and get an explicit second confirmation before modifying code. See the "Refactor confirmation" rule below.**
   - **Sensitive capture**: identify calls whose inputs or outputs can contain secrets, credentials, private file contents, or other values the application's display redaction does not protect at capture time. This is not a reason to switch the workflow to opt-in spans. Keep the opt-out root and apply `withNode`/`node` capture controls at the smallest sensitive first-party boundary so the call remains in the trace without recording its content. If the sensitive value is inline in the root input/output and cannot be isolated additively, state that concrete blocker before writing instrumentation.
   - **Output**: if the boundary returns a live stream (Vercel AI SDK `streamText` result, a `ReadableStream`, an SSE / streaming `Response`), note it here. In the **TypeScript and Python SDKs this is NOT a refactor**: treat the streaming root as the explicit opt-in fallback, keep its selected call stack entirely opt-in, and instrument with the `finalize` option (TS `withSpan(key, { finalize }, fn)` with `finalizers.aiSdk` / `finalizers.readableStream`; Python `@client.span(key, finalize=...)` over an async generator with `finalizers.openai_chunks` / `finalizers.anthropic_events`), which records a serializable view while the live stream still reaches the caller (per step 6). Present it as the instrumentation approach, do not offer a structural rewrite for a streaming output when `finalize` covers it. On Ruby/Go, fall back to a serializable run-to-completion core.
   - **Replay dependencies**: the external state and side-effecting dependencies the function touches that replay will have to deal with, walk what the boundary and its captured children call into: database reads, third-party APIs, queues, blob/file storage, clocks/RNG, stream writers, request/session/billing objects. Two follow-ups come out of this list, both wired up in step 12:
     - **Replay safety**: every unsafe external action (database write, outbound mutation, queue publish, email, payment, or similar) must be a mockable descendant selected for recorded-output mocking, whether or not the dependency exists at replay time. Verify it executes in the replay root's context: Python worker-thread dispatch requires `Bitfab(trace_across_threads=True)`; Ruby child threads, pre-created consumers, and other processes do not inherit replay interception, so move the unsafe boundary into the replay context. For TypeScript, note any synchronous unsafe span because lazy `mock: "marked"` cannot substitute it; the replay registry module must use `mock: "all"` only when freezing every matched child is acceptable, otherwise the existing boundary must already return a Promise or the workflow is not safely replayable without a behavior-changing refactor. Separately, list runtime values the replay callable must synthesize because no value exists to pass (stream writers, request/session objects, sockets, or replay-only callback slots); these are wiring, not the replay safety boundary.
     - **Database snapshotting**: if the function **reads stored state from the database** (anything where the answer depends on the rows as they were at trace time, a decision over an order/account/document, a retrieval step), plain replay runs against *today's* data and is misleading. Flag it here and recommend `$bitfab:setup db-snapshot` (TypeScript, Python, Ruby) so replay runs against the per-trace DB branch instead. If the function only writes, or never touches the DB, say so and skip it.
   - **What's covered end-to-end**: the work above, alongside, and below any agent/LLM/SDK call that this trace will capture (be specific: list the orchestration, custom LLM calls, tools, downstream services that will become spans)
   - **Why tracing it is valuable**

   The description must commit to the actual scope. If the instrumentation will only auto-capture an SDK's internals, say so explicitly, do NOT use language like "complete tracing of X workflow" when the trace will only cover an SDK call's internals.

   Recommend one to start with. **Ask the user to pick exactly ONE workflow to instrument first.** Never accept "multiple" or "all", instrumenting one workflow produces exactly one trace function with one set of code changes. If the user wants to instrument several, they will be done sequentially via the loop in step 14, one at a time.
11. Read the selected root function, its exact signature, callers, stateful dependencies, and transitive calls that already use Bitfab instrumentation. Choose a stable trace function key from the existing conventions. Preserve the real production entrypoint and caller behavior. Verify that recorded inputs can reconstruct the same root during replay; rebuild clients and framework objects inside the replay callable. For live stream outputs, use the documented finalize support and preserve streaming behavior. Read the SDK reference and use its native integration for the detected framework. If any manual span can execute beneath the selected opt-out root, plan its conversion before writing. Inspect every production caller of each span-bearing helper, not only calls reachable from the selected root. Convert a helper in place only when every caller belongs to the same opt-out surface; otherwise choose a disjoint trace boundary or stop for refactor confirmation so existing opt-in callers cannot encounter `withNode`. Remove a redundant span wrapper or replace it with a node while preserving its name, type, capture controls, finalizer, and replay-mocking behavior. For TypeScript, confirm every `withNode` target is a named function; preserve its existing name or use an additive named function form, and stop if that requires a non-additive rewrite. An existing span in this call stack does not make opt-out technically impossible. Once this is established, proceed directly to instrumentation and replay setup. Ask only if the workflow itself remains ambiguous or a non-additive application refactor is required; follow the refactor-confirmation appendix for that case.
12. **Write instrumentation AND the replay registry module for this trace function in the same cycle.** Skip the registry for Go-only projects.

   **Default instrumentation policy:** use opt-out tracing whenever the selected TypeScript or Python workflow supports it. TypeScript setup must install and configure `@bitfab/transform` in the application build, then put `withTrace`/`trace` on the existing workflow root. Python 3.12+ uses `trace` on the root. Let first-party descendants be discovered automatically and use `withNode`/`node` for external reads, unsafe side effects, model calls, naming, typing, capture overrides, finalization, and replay mocking. Do not add `withSpan` inside an opt-out trace. Existing `withSpan` usage is not a reason to extend the opt-in pattern. When a manual span already runs inside the selected call stack, migrate the call stack instead of abandoning opt-out. Before converting a span-bearing helper in place, inspect every production caller and confirm each caller belongs to the same opt-out surface; if an opt-in caller remains, use a disjoint trace boundary or stop for refactor confirmation. Remove redundant span wrappers. Replace spans that carry policy with nodes and preserve that policy. TypeScript `withNode` requires a named function, so preserve an existing name or use an additive named function form; stop for refactor confirmation if naming it requires a non-additive rewrite. This tracing-surface migration is instrumentation work, not an application refactor. Stop for refactor confirmation only if preserving application behavior requires changing the underlying function or its callers. Spans remain supported, but during setup choose them only when opt-out is technically impossible: Ruby, Go, unsupported Python runtimes, a TypeScript build path unsupported by every documented transform adapter, or a live streaming root whose output opt-out tracing cannot finalize without changing behavior. Framework integrations and their generated spans remain nested beneath the opt-out root; they do not justify a span root. Adding a supported transform adapter, including the esbuild adapter used by tsup, is required setup work rather than a fallback reason. Report the concrete technical blocker and keep the selected call stack on one tracing surface.

   - **11a. Instrumentation edits**: follow the SDK reference exactly, purely additive. Never change behavior, arguments, return values, error handling, variable names, types, control flow, or code structure. **Wrapping means wrapping, not silently rewriting.** Attach the opt-out trace to the existing root and configure only the discovered nodes that need policy. Rewriting, re-implementing, inlining, or hand-reconstructing a framework/SDK call to seat a root is sometimes genuinely necessary, but it is a refactor, not additive instrumentation: never do it silently as part of the write step. Any such rewrite must preserve behavior exactly (labeled *visibility* or *structural* in the refactor plan); a rewrite that would change behavior is never allowed, fall back to an additive root or move the boundary inward instead. Try the additive root first, when the natural root is opaque or stream-returning, reach for the framework handler/middleware or the `finalize` option wrapped around the *unchanged* call. If none of those fit and a rewrite really is required, STOP, present the refactor plan to the user in plain terms and get an explicit yes before touching the code (the "Refactor confirmation" rules below say what the plan must contain), then proceed once they approve. **Likewise, if the additive wrap doesn't typecheck, STOP and surface it rather than dropping or loosening an argument, weakening validation, or otherwise quietly changing runtime behavior to make it compile** (the same "no type-checker escape hatches, don't paper over it" rule the replay step enforces): a compile error on a purely-additive wrap means the wrap isn't additive, so either find the additive form or present it to the user as a refactor and get approval first. Batch repetitive edits in parallel (one message, many Edit calls); for large mechanical fan-outs (>10 files of the same wrapper pattern), validate the pattern on one file, then do the remaining files. **For each external read or unsafe side effect that replay must mock, configure the discovered node with replay mocking** (TypeScript `withNode({ type, mockOnReplay: true }, fn)` / `@client.node(...)`; Python `@client.node(type=..., mock_on_replay=True)`). Under opt-in fallback, put the equivalent option on the span. This lets replay's `mock: "marked"` strategy serve its recorded output without mixing tracing surfaces.

   - **11b. Replay registry edits**: write or update the registry module alongside instrumentation, using the registry-only contract above:
     - **Language + SDK replay reference URL**: use `https://docs.bitfab.ai/<language>-sdk.md` and re-check the Replay Registry section.
     - **Trace function key**: as chosen for this workflow.
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

   Include the replay registry module in the change summary alongside the instrumented files.
13. Give the user a clear completion message that explains how to run the instrumented workflow and, once traces exist, the SDK-installed replay command with this registry. If the repository reveals an exact command or user action that drives the real instrumented path, provide it. If it does not, name the application path or workflow that must be exercised without inventing a command. Always give the exact `bitfab-replay --registry ...` command when a registry was created. Do NOT run either command yourself. (Omit the replay command for Go-only projects.) **If step 10 flagged this function as reading stored DB state (or reading the workflow at step 11 noted a captured node that reads stored database state, an `external_read` with `readKind: db_read` specifically, not an `http_read` / `vector_search` / `cache_read` / `filesystem_read`)** (TypeScript, Python, Ruby), add one line: replay currently reads today's data, run `$bitfab:setup db-snapshot` to make it replay against the database state at trace time.

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
14. After reporting the completed instrumentation and how to run it, continue with another workflow if the user already requested one. Otherwise ask what to do next. > A) **Find another workflow** → step 8
   > B) **I'll name another target** → step 9
   > C) **Done** *(recommended)* → step 1 of the Cleanup phase

## Modify

**Run only when mode is `wizard`, `instrument` or `modify`.**

Adjust an **existing** trace setup. Requires existing SDK usage in the codebase, if none exists, run Instrument first. Triggered explicitly by `$bitfab:setup modify`, or selected from the choice prompt at Instrument's existing-SDK-usage menu when existing SDK usage is found.

Every Modify cycle targets **exactly one** trace function. Never batch multiple trace functions in one cycle, if the user wants more, loop via the step 5 menu.

1. **Skip the search when you already hold the keys**: arriving from Instrument's existing-SDK-usage menu means you ran exactly this search one step ago, and re-running it makes the user watch the same greps twice for the same answer. Otherwise **gather existing trace functions** by searching for SDK patterns (`getFunction("key")`, `get_function("key")`, `bitfab_function "key"`, `WithFunctionName("key")`, plus keyed framework handlers: `getLangGraphCallbackHandler("key")` / `get_langgraph_callback_handler("key")` (or the LangChain-named aliases) and `getOpenAiAgentHandler("key")` / `get_openai_agent_handler("key")` and `getClaudeAgentHandler("key")` / `get_claude_agent_handler("key")` and `getVercelAiMiddleware("key")`; plus trace-processor registrations (unkeyed in code, the key is derived server-side from the workflow name): `getOpenAiTracingProcessor()` / `get_openai_tracing_processor()`). List each key alongside its root function (or, for keys registered only via a framework handler, the handler registration site, handler keys have no decorated root and that is expected). If none are found, tell the user Modify needs existing instrumentation and suggest `$bitfab:setup instrument`.

   - **the key is already settled (passed as `$bitfab:setup modify <key>`, or named at Instrument's existing-SDK-usage menu)**: skip the which-function question, the user already answered it → step 3
   - **no instrumented trace functions exist (nothing to modify)**: continue → step 1 of the Cleanup phase
   - **one or more trace functions exist**: continue → step 2
2. **Pick exactly ONE trace function to modify.** (You only reach this step when the key is not already settled; a key named at Instrument's existing-SDK-usage menu or passed as `$bitfab:setup modify <key>` routes past it.) Ask the user with the list of existing keys. Recommend the one the user most recently instrumented (or the one most recently referenced in the current session) and explain why in one line.
3. Read the chosen function, its root registration, wrappers, framework handler or processor, keyed client, and replay registry module directly from the current source. Inventory the captured calls and replay mocks that actually exist. The code is the source of truth. Reuse the existing function key and preserve unrelated user edits. Apply the requested change after checking the affected call signatures and replay dependencies.
4. Apply the user-requested instrumentation changes to the current source. Follow the SDK reference and the existing framework integration. Preserve behavior, arguments, return values, error handling, and streaming semantics. Keep the same trace function key unless the user requested a rename, and update the replay registry module in the same change so it calls the production traced root with reconstructed dependencies. If the request requires a behavior-changing refactor, follow the refactor-confirmation appendix before making that refactor. Validate the affected code and report exactly what changed.
5. Tell the user how to run the app to generate a trace with the modified setup, exact command(s). Do NOT run it yourself. Then **MANDATORY STOP**: ask the user:
   > We recommend **A**: generate a trace with the modified setup so the diff is observable end-to-end.

   > A) **Generate a trace for the modified setup**: present the script to run; allow the user to let you run it *(recommended)* → step 1 of the Cleanup phase
   > B) **Modify another trace function**: pick another traced function to adjust → step 2
   > C) **Done**: stop here → step 1 of the Cleanup phase

   B returns to step 2. A and C exit the Modify loop to cleanup (Modify does not auto-continue to Replay, the user can invoke `$bitfab:setup replay` separately).

   **Re-entry rule:** If the user requests another instrumentation change, read that workflow from current source and apply the requested change through this skill.

## Inspect

**Run only when mode is `inspect`.**

Diagnose, and optionally fix, an existing Bitfab tracing setup. Triggered explicitly by `$bitfab:setup inspect` (or natural-language asks like "why aren't my traces showing up" / "what's instrumented" / "debug my tracing setup" / "inspect my tracing"). Reports auth/connection status, what's instrumented in this repo, whether the plugin and SDK are up to date, whether replay registry modules cover every trace function key, and whether traces are actually arriving, then offers to apply the fixes, each confirmed individually before any change. Does **not** open Bitfab.

This is about trace *delivery and setup health* (is the SDK wired up and current, is the key set, are traces landing, are replay registry modules in place). For improving the *quality* of a traced function's outputs (pass rates, failing cases), use `$bitfab:assistant` instead.

1. Run the status check and report the result to the user:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/status.js"
   ```

   Report whether they're authenticated and which org/account the plugin is connected to. If **not authenticated**, note that trace arrival can't be confirmed without login and suggest `$bitfab:setup login`, but continue with the read-only code inspection below regardless (it does not require auth).
2. Search the codebase for SDK usage and trace function keys (`getFunction("key")`, `get_function("key")`, `bitfab_function "key"`, `WithFunctionName("key")`, plus keyed framework handlers: `getLangGraphCallbackHandler("key")` / `get_langgraph_callback_handler("key")` (or the LangChain-named aliases) and `getOpenAiAgentHandler("key")` / `get_openai_agent_handler("key")` and `getClaudeAgentHandler("key")` / `get_claude_agent_handler("key")` and `getVercelAiMiddleware("key")`; plus trace-processor registrations (unkeyed in code, the key is derived server-side from the workflow name): `getOpenAiTracingProcessor()` / `get_openai_tracing_processor()`). In a monorepo, search **each application directory separately**: a root-level search can miss subdirectories. Report:
   - Whether the SDK is installed (check the package manifest) and whether `BITFAB_API_KEY` is set (in `.env`-style files or the environment), do **not** print the key value.
   - Each trace function key found, alongside its root function and file path.
   - **Trace-processor registrations (OpenAI Agents SDK) too**, even though they are unkeyed in code: the registration site (`setTraceProcessors` / `set_trace_processors` with the Bitfab processor) is itself an instrumented workflow whose key is derived server-side from the workflow name. Note whether each run is routed through the run wrapper (`getOpenAiAgentHandler` / `get_openai_agent_handler`), enclosed by an opt-out `withTrace`/`trace` root, or, only in a fallback runtime, wrapped in a manual `withSpan`/`@span` root. The replayability check in step 4 needs this; a bare processor over plain `run()` with none of these is not replayable.
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
      - **Bare trace-processor keys** (OpenAI Agents SDK over plain `run()`): the processor captures the run but its root span records an empty input, so a processor-only key without the run wrapper `getOpenAiAgentHandler` / `get_openai_agent_handler` or an application root is NOT replayable. Flag it ⚠️ root not replayable and recommend adding a `withTrace`/`trace` root that takes the run input in supported subtree runtimes, or routing through the run wrapper. Recommend a manual `withSpan`/`@span` root only when opt-out is technically unavailable. When an application root exists, check its signature like any decorated key (next bullet).
      - **Decorated/wrapped keys**: read the root function signature and confirm it's replayable per Instrument's trace-boundary serializability requirement (serializable inputs). Flag any key whose root takes unserializable inputs (live SDK/DB clients, HTTP `Request`/`Response`, stream writers, sockets, opaque request contexts) as ⚠️ root not replayable, reasoning from the signature, not the function name. This is independent of the replay-registry coverage in sub-step 3 above: a non-replayable root is ⚠️ whether or not a registry exists for it (a key can be ❌ no replay registry module AND ⚠️ root not replayable at once), so never roll a non-replayable root up into ✅ just because it has no registry entry.

   Hold these results for the report. (If nothing is instrumented, no trace function keys AND no trace-processor registrations, skip both the **replay** and the **replayability** checks, they are per-workflow, so there's nothing to evaluate; report both as `n/a (nothing instrumented)`, never ✅. Still run the **plugin** and **SDK** checks: the SDK may be installed and stale, or on the legacy `bitfab` package needing the `@bitfab/sdk` rename, independent of whether any trace functions exist in this repo yet.)
5. Summarize the setup health in one compact report:
   - **Auth**: authenticated as <account/org>, or not authenticated.
   - **Plugin**: up to date, or `v<X> available` (from step 4).
   - **SDK**: installed / not installed; `BITFAB_API_KEY` set / not set; per workspace, `current → latest` when out of date, **and** call out any workspace on the legacy `bitfab` package that should switch to `@bitfab/sdk` (TypeScript, from `renameFrom`).
   - **Instrumented here**: the list of keys with ✅ / ⚠️ / ❓ markers from step 3.
   - **Replay**: ✅ covers all keys / ⚠️ missing keys / ❌ none (from the replay-registry check in step 4).
   - **Replayable**: ✅ all roots replayable / ⚠️ `<key>` root not replayable / `n/a (nothing instrumented)` (from the per-root replayability check in step 4; flagged whether or not a replay registry module exists for the key; never ✅ when nothing is instrumented).

   Then, for anything not healthy, name the most likely cause and the fix:
   - **Plugin or SDK out of date, or on the legacy `bitfab` package**: apply via the fix prompt below (upgrades the version and/or switches `bitfab` → `@bitfab/sdk`; same effect as `$bitfab:update`).
   - **Replay missing or incomplete**: refresh via `$bitfab:setup replay` (non-interactive; creates or extends registry entries to cover every key).
   - **Root not replayable**, two failure modes, with the fix matched to each: **(a) the root takes unserializable inputs** (live SDK/DB clients, HTTP req/res, streams, opaque contexts), with or without a replay registry module: move the trace boundary inward to a serializable-input function or refactor to introduce one; **(b) a bare trace-processor-only key** (OpenAI Agents SDK) whose root is the processor's empty-input span: add a `withTrace`/`trace` root that wraps the run and takes its input in a supported subtree runtime, or route the run through the run wrapper (`getOpenAiAgentHandler` / `get_openai_agent_handler`). Use a manual `withSpan`/`@span` root only when opt-out is technically unavailable. Either way, re-instrument via `$bitfab:setup modify` (or `$bitfab:setup instrument` for a fresh boundary). This is a code change, recommended here, not applied blanket.
   - **Instrumented but no traces**: the app hasn't run with tracing enabled, or `BITFAB_API_KEY` isn't set in the run environment. Run the app with the key loaded.
   - **Key set but traces aren't visible in the browser**: the API key is bound to a different Clerk org/tenant than the browser session. A key resolves `API key → organization_id → clerk_organization_id → Clerk tenant` at creation time; browser visibility requires both to be the same tenant.
   - **Nothing instrumented**: run `$bitfab:setup instrument`.
   - **Want to change what's captured**: run `$bitfab:setup modify`.

   Then continue to the fix prompt. Inspect does not open Bitfab.
6. If the report surfaced anything stale or missing (plugin behind, SDK out of date or on the legacy `bitfab` package, or replay registry modules missing/incomplete), ask the user whether to apply them, each fix is then confirmed individually in the next step (nothing is changed blanket). If everything is healthy, skip the question and go straight to cleanup.

   > A) **Review and apply fixes**: go through each fix one at a time, confirming before any change *(recommended)* → step 7
   > B) **Just report**: make no changes → step 1 of the Cleanup phase
7. **Apply fixes individually, confirm each before changing anything; never bundle them into one blanket change.** Go through only the items step 4 flagged as stale or missing, and for each, ask the user (one decision per question) and apply only if the user approves. Skip any they decline and continue to the next.

   - **Plugin behind**: ask the user to update; if yes, run `node "${BITFAB_PLUGIN_DIR}/dist/commands/update.js" plugin` and remind the user to restart Codex so the new plugin loads.
   - **SDK out of date** (`updateAvailable: true`, `renameFrom` null), name the workspace and the `current → latest` jump, then ask the user to upgrade; if yes, run the package manager's upgrade from that workspace directory (the same commands `$bitfab:update` uses): npm / pnpm / yarn / bun `add @bitfab/sdk@latest`; uv / poetry / pip `bitfab-py@latest`; `bundle update bitfab`; `go get github.com/Project-White-Rabbit/bitfab-go@latest && go mod tidy`. Read the manifest afterward to confirm the new version. Each workspace is its own decision.
   - **On the legacy `bitfab` package** (`renameFrom` non-null), this rewrites import sites, so **preview before touching code**: list every `from "bitfab"` / `require("bitfab")` site you would change, then ask the user to proceed. If yes, remove the old package and add the new one in one step (e.g. `pnpm remove bitfab && pnpm add @bitfab/sdk@latest`, or the npm / yarn / bun equivalent) and rewrite those imports to `@bitfab/sdk`. Do this even when `current` already equals `latest`, the rename is the fix. (TypeScript-only; Python / Ruby / Go package names don't change.)
   - **Replay missing or incomplete**: ask the user to refresh; if yes, run `$bitfab:setup replay` to create or extend the scripts so every trace function key is covered (it is non-interactive).

   For unusual monorepos or private registries, defer to `$bitfab:update`. Report what was applied and what the user declined. Do not open Bitfab.

## Switch Org

**Run only when mode is `switch-org`.**

Switch which Bitfab organization the plugin reads and writes. Triggered explicitly by `$bitfab:setup switch-org` (or natural-language asks like "switch org" / "change org" / "switch to the <name> org" / "I'm in the wrong org"). The plugin's org is set by the API key in `~/.config/bitfab/credentials.json`; this lists the user's orgs, switches to the chosen one, and replaces that local key. Requires authentication. Does **not** open Bitfab.

**The live browser does not follow on its own.** Switching persists the new active org server-side (so future sign-ins default to it) and replaces the plugin's key, but a browser tab that's already signed in keeps showing the old org until its session is re-minted. The org actually flips in the browser on the **next** Bitfab open (a fresh session whose org check runs Clerk's client-side `setActive`) or when the user picks the org from the in-app org switcher.

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
   - `{"event":"switched","status":"switched"|"already-aligned","clerkOrganizationId":"...","organizationName":"...","apiKey":"..."}`: success. The plugin now reads and writes that org and its API key has been replaced locally. Tell the user in one line: the plugin is now connected to **<organizationName>**. Then tell them to select **<organizationName>** with the in-app org switcher to align their browser with the plugin. Opening a plugin page link does not change the browser's active organization. Hold on to the `apiKey` value from this JSON; the next step uses it to sync the app's local key, and you must never echo that value to the user.
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

## Replay

**Run only when mode is `replay`.**

Create or update replay registry modules for instrumented trace functions. Requires instrumentation in the codebase; does **not** require existing traces, replay registry modules are created from trace function keys in the code, not captured trace data.

The SDK-installed `bitfab-replay` command lets the team regression-test any registered trace function against production data with one command: it fetches historical traces, re-runs them through the current code, and reports old vs. new outputs side-by-side. The project owns only the registry module. **Go supports programmatic replay through its SDK, but has no installed replay registry CLI.** For a Go-only project, point to https://docs.bitfab.ai/go-sdk.md and https://docs.bitfab.ai/reference/go.md for the replay API, then skip this registry-specific phase.

**Relationship to Instrument.** Instrument's write-instrumentation step writes each replay pipeline alongside the instrumentation edits. Run this mode standalone (`$bitfab:setup replay`) to catch pre-existing trace function keys that predate that step or were added outside the skill.

**Source of truth:** two pages, read both before creating or modifying a replay registry module. Do not improvise from memory.
- **Canonical `replay` API signature, options, and return shape:** `/reference/typescript.md`, `/reference/python.md`, `/reference/ruby.md` (these are the languages supported by this registry workflow). Use this for the exact field names (`result` / `originalOutput` vs `original_output`), default `limit`, `maxConcurrency`/`max_concurrency`, error behavior.
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
5. **Legacy instrumentation with a non-replayable root.** First decide whether any instrumented trace function can't be replayed from the replay registry module. Two failure modes: **(1) not invocable**, the function isn't exported or is defined inline in a route handler; **(2) not replayable**, its root takes unserializable inputs (live SDK/DB clients, HTTP `Request`/`Response`, stream writers, sockets, opaque request contexts), so even an invocable call replays with empty or stubbed args. Such functions were introduced before Instrument's trace-boundary serializability requirement, or via another path. Reason from each function's signature and visibility, and where a captured trace exists for the key, compare the signature against the trace data: an empty or `<unserializable: ...>`-stubbed recorded root input confirms the root isn't replayable. Do not execute replay to detect this.

   **Keyed root-handler keys are not affected.** A key registered only via a callback handler or a trace-processor run wrapper (LangGraph / LangChain, OpenAI Agents SDK, Claude Agent SDK, or Vercel AI SDK) has no decorated function by design and records the framework's serializable input as the root; create its pipeline with the key-based replay pattern from step 4 instead of offering these resolutions. **Bare trace-processor-only keys (OpenAI Agents SDK over plain `run()`) ARE affected, not exempt:** the processor records an empty-input root, so a processor-only key without the run wrapper or an application root is not replayable. Offer "add a `withTrace`/`trace` root that takes the run input, or route the run through the run wrapper" in supported subtree runtimes; offer a manual span root only when opt-out is technically unavailable.

   - **every instrumented function is invocable from the replay registry module and its root is replayable (nothing left to resolve)**: nothing to resolve → step 1 of the Cleanup phase

   If one or more functions can't be invoked or aren't replayable, ask the user offering Instrument's trace-boundary resolutions:

   > A) **Move the trace to an inner function** → step 1 of the Cleanup phase
   > B) **Refactor** *(recommended)* → step 1 of the Cleanup phase
   > C) **Leave as-is**: add a header comment explaining why this one can't be replayed later (it can't be called directly, or it records no inputs to replay from over plain run() with an empty-input root) and flag that the script will rot → step 1 of the Cleanup phase

   **If the user picks "Refactor" (or a boundary move that requires rewriting callers), present a refactor plan labeled as *visibility* or *structural* and get a second confirmation before modifying code (the "Refactor confirmation" rules below say what the plan must contain).**

## DB Snapshot

**Run only when mode is `db-snapshot`.**

Set up **per-trace database snapshots for replay** so the team can re-run a historical trace against the database state that existed *when the trace was captured*, not today's data. This is what makes replay trustworthy for any code that reads stored state (a refund decision over a since-cancelled order, a retrieval step over last week's rows). Triggered explicitly by `$bitfab:setup db-snapshot`, never reached from `wizard`.

**This registry-based setup flow supports TypeScript, Python, and Ruby.** Go also supports database-snapshot replay through its programmatic API. For Go, point to https://docs.bitfab.ai/go-sdk.md and https://docs.bitfab.ai/reference/go.md for `ReplayOptions.DBBranch` and `GetCurrentReplayBranch(ctx)`, then stop this registry-specific flow.

**Capture is automatic in current SDKs, there is nothing to turn on.** Eligible root traces captured by an SDK version with always-on snapshot references pin the wall-clock instant they ran (no client config required), so those traces can later be replayed against their historical DB state, subject to replication lag. Older traces without a snapshot reference use the normal database path. Setup is therefore just two pieces:
1. **Connect the database once** in the Bitfab dashboard. The source database can be **any Postgres**: Bitfab provisions a branchable managed copy from it. A one-time, dashboard-side step.
2. **Wire replay** to read the per-trace branch URL: pass `dbBranch` to the replay call and, inside the replayed function, connect using the resolved branch's URL instead of your live `DATABASE_URL`.

**Source of truth:** read https://docs.bitfab.ai/db-branching.md (the end-to-end, per-language setup) and your SDK's reference (`/reference/typescript.md`, `/reference/python.md`, `/reference/ruby.md`) for the exact `replay` / branch-accessor signatures before editing any code. The replay option and the accessor names differ per SDK, do not improvise from memory.

1. **Confirm the SDK language.** This registry-based flow supports **TypeScript, Python, and Ruby**. If the project is **Go**, explain that its SDK supports database-snapshot replay through the programmatic API, point to https://docs.bitfab.ai/go-sdk.md and https://docs.bitfab.ai/reference/go.md for `ReplayOptions.DBBranch` and `GetCurrentReplayBranch(ctx)`, and route to cleanup.

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
   2. **Mandatory replay-safety check, before any replay command.** Read the replay registry module, the real production root it imports, and every reachable external-action span. Inventory database writes, outbound mutations, queue publishes, email, payments, filesystem writes, and similar unsafe actions. Confirm each one is behind a manual replay-mockable descendant selected by the registry entry's actual strategy and has a serializable recorded output; `mock: "marked"` requires `mockOnReplay` on that boundary. Confirm the boundary runs in the same replay context: Python worker threads require `trace_across_threads=True`; Python async-generator spans cannot be mocked; Ruby child threads, pre-created consumers, and processes do not inherit replay interception; TypeScript synchronous selected spans cannot use lazy `marked` output and may use `all` only when freezing every matched child is acceptable. Also reject unsafe import-time/module initialization, because it runs before replay interception. Confirm the replay call requests `dbBranch` / `db_branch`. If any unsafe action is unselected, unmockable, outside context, or uncertain, **do not run the smoke test**; report the exact blocker and required boundary change. Mocking, not the app environment, is the safety boundary.
   3. Run the SDK-installed replay command against only the verified ID using `--trace-ids <fresh-trace-id>` (for example, `pnpm with-env bitfab-replay --registry scripts/replayRegistry.ts <pipeline> --trace-ids <fresh-trace-id>`, `poetry run bitfab-replay --registry scripts/replay_registry.py <pipeline> --trace-ids <fresh-trace-id>`, or `bundle exec bitfab-replay --registry scripts/replay_registry.rb <pipeline> --trace-ids <fresh-trace-id>`, with the app's normal environment loader). Never substitute `--limit 1`.
   4. Confirm the branch was injected: inside the replayed function, `getCurrentReplayBranch()` (TypeScript), `get_current_replay_branch()` (Python), or `Bitfab.current_replay_branch` (Ruby) must be non-null. Compare its `databaseUrl` / `database_url` host and database with the app's normal `DATABASE_URL`; they should differ. Print the test run URL from the replay output so the user can open the experiment.

   If the branch accessor is null for a freshly captured trace, check that the source database is connected, that the trace actually carries a snapshot reference, and that the SDK supports always-on capture (upgrade with `$bitfab:update` when needed). Re-check the dashboard Database section in step 2; there is no separate replay-environment active flag.

   Caveats to surface to the user: each branch lease is short-lived (a few minutes) and is created fresh per replay item; the branch reflects the source database's state at the snapshot instant, bounded by replication lag (typically sub-second to a few seconds).

## Templates

**Run only when mode is `templates`.**

Iterate on span-rendering templates for one trace function. Read the current template and reference, apply the requested change, then save it with traceFunctionKey set. Provide the regular template-preview link when useful. Keep review decisions in chat.

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

   Call `mcp__Bitfab__search_traces` with `{ traceFunctionKey: "<key>", limit: 1 }`. If the response contains a trace ID, continue. If the response indicates no traces exist (e.g. `No traces found matching the filter criteria.`), exit and tell the user in one short line: `No traces yet for <key>. Run your app to generate one, then re-run \`$bitfab:setup templates <key>\` to preview.` Do NOT block waiting; the user re-invokes when they have a trace.

   - **trace exists**: continue and choose the preview mode → step 5
   - **no traces yet for this function**: exit and tell the user to generate a trace and re-run → step 1 of the Cleanup phase
5. The user can watch template saves in a trace they already have open, or on the template-preview page. Both update through normal template:updated events. Offer a preview link when useful. Ask for requested changes in chat. - **edit inline against the trace already on screen**: skip the preview; edit in place while the user's current view updates live → step 7
   - **open the live preview page**: provide the preview link, then enter the edit loop → step 6
6. Run node "${BITFAB_PLUGIN_DIR}/dist/commands/startTemplatePreview.js" <key> and relay the returned URL as a clickable link. Continue the template edit loop in chat. Template saves update the preview through normal organization events. The link command exits immediately.
7. Each edit is driven by the user’s request in chat. Include traceFunctionKey: <key> in every template read and save. Ask which span or region they mean when unclear.

   2. Ask the user what they want changed in the trace view. Identify the span type and rendered region from their answer. If that is ambiguous, clarify it in chat before editing. Both the regular trace view and the linked preview update on save.

   3. Call `mcp__Bitfab__get_template` with `spanType` and `traceFunctionKey: <key>` to read the **live** content. The response labels its source: `scoped to traceFunctionKey "<key>"` (a per-key row already exists), `org-global override` (no per-key row yet, this is your seed for the first save), or `source: file <name>` (no DB rows at all). **Always** read before write: the prior round may have edited the same template, and overwriting blindly drops that work.
   4. Edit the returned source in-context, **one focused change per round**. Resist the urge to bundle multiple unrelated tweaks into a single save: small steps let the user see each effect land on the preview and redirect mid-loop if the change isn't quite right. Stay inside the documented Nunjucks variables and filters (per the reference). Don't introduce `{% extends %}`; the assembler injects into `base.njk`'s content block, so extends will break composition. When adding new visible regions, **decorate them with the catalog anchors** (`data-section`, `data-field-path`, `data-iter-index`) so future clicks resolve cleanly.
   5. Call `mcp__Bitfab__save_template` with `spanType`, `traceFunctionKey: <key>`, and the full edited body. The tool upserts the per-function row in place (no version bump, no row juggling). On the first save for a span type the row is created; subsequent edits update it. The preview updates when the save completes.
   6. Acknowledge the save in one short line (e.g. "Saved."). The live view (the preview page in preview mode, or the trace the user already has open in inline mode) subscribes to SSE `template:updated` events and re-renders automatically, so do NOT tell the user to refresh. Do not paste the template body back into chat. After a non-trivial change you may briefly ask  whether the result looks right before starting the next round; for obvious tweaks (a label rename, a colour swap), skip the check and proceed.


   Continue until the user says they are done. - **user explicitly says they're done (the only exit in inline mode)**: exit the loop and acknowledge → step 1 of the Cleanup phase
   - **user wants another change**: loop back and apply the next edit → step 7

## Analyze Repo

**Run only when mode is `analyze-repo`.**

Analyze the repository without changing code or asking for confirmation. Read the source, identify the most valuable AI workflows to instrument, and report recommendations with file locations and replay considerations. No server-side planning artifact is created.

1. **First, confirm authentication non-interactively.** Call `mcp__Bitfab__get_bitfab_api_key` to retrieve the API key for the plugin's active org. If it returns a key, hold it and continue. If it errors or returns no key, **STOP the whole phase immediately**: this mode cannot run the interactive login (that needs a browser sign-in). Tell the user to run `$bitfab:setup login` first, then re-run `$bitfab:setup analyze-repo`. Do not prompt, do not retry, do not fall through to scanning.

   **Then detect the project language** (TypeScript, Python, Ruby, or Go). In a monorepo, identify which directories are **applications** (services, APIs, agents) vs **libraries** (SDKs, shared packages) and focus on the application directories. Scan imports and package manifests for supported framework signals, and note which framework each application directory uses:
   - **LangGraph / LangChain**: TS: `@langchain/langgraph`, `@langchain/core`; Python: `langgraph`, `langchain`, `langchain_core`
   - **OpenAI Agents SDK**: TS: `@openai/agents`, `setTraceProcessors`; Python: `agents` (`from agents import ...`)
   - **Claude Agent SDK**: TS: `@anthropic-ai/claude-agent-sdk`, `query(`; Python: `claude_agent_sdk`, `ClaudeSDKClient`, `query(`
   - **BAML**: TS: `@boundaryml/baml`, `baml_client` import; Python: `baml-py`, `from baml_client import b`
   - **Vercel AI SDK**: TS: `ai`, `wrapLanguageModel`, `streamText`, `generateText` (TypeScript only)
2. **First, check the skill invocation arguments for free-text guidance.** Anything after a `guidance:` marker (e.g. `analyze-repo guidance: focus on the billing and checkout flows`) is the user's steer on what to prioritize. When present, let it shape this scan: bias toward the areas, directories, or workflow types the guidance names, and still record other candidates you find so selection can fall back to them. When absent, scan the whole codebase evenhandedly as below. Never treat the guidance as a reason to prompt the user or to skip the non-interactive contract.

   Read the codebase to identify **every** AI workflow, each place the app makes LLM calls, runs agents, or makes AI-driven decisions. In a monorepo, search each application directory separately (a root-level search misses subdirectories). For each workflow, find the **outer workflow boundary** (the function that builds any framework/stateful object, invokes it, and processes the output, e.g. an API handler, message processor, job runner, or pipeline coordinator, almost never the SDK's own `run()`/`invoke()` call), and note the meaningful work **above** it (auth, validation, input prep, retry/orchestration loops, multi-agent coordination), **alongside** it (custom LLM calls outside the SDK, unregistered tools, downstream services), and **below** it (post-processing, parsing, persistence). In supported TypeScript and Python workflows, this analysis identifies the opt-out trace root and the descendants that need explicit `withNode`/`node` policy. Only in fallback runtimes does it identify spans to add around auto-captured SDK content. In supported TypeScript and Python framework integrations, the native framework spans stay beneath the opt-out root.

   **Record each candidate's replayability up front, because it drives selection in the next step.** A trace is replayable only if either (1) the boundary's inputs are serializable by the SDK's tracing layer, or (2) the workflow runs on a supported framework integration that records a replayable root (LangGraph / LangChain, OpenAI Agents SDK, Claude Agent SDK, or Vercel AI SDK). Flag boundaries whose natural inputs are **unserializable**: live SDK client instances passed as arguments (`OpenAI`/`Anthropic`/Bedrock clients, configured agents, DB connections, often smuggled inside an options/config bag), HTTP `Request`/`Response`, stream writers, open sockets, browser objects, or genuinely opaque request contexts. Module-scope or closure-captured dependencies do NOT count as unserializable inputs because runtime wiring resolves them without storing them as span arguments; only values passed **as arguments** do. Note, per candidate: the trace function boundary, its input shape and whether it is serializable, and the external state/side effects it touches (DB reads/writes, third-party APIs, queues, blob storage).

   **Also record each candidate's existing instrumentation, so the report describes the delta between what's already traced and what's recommended.** Grep each workflow for existing Bitfab SDK usage (`withTrace`, `trace`, `withNode`, `node`, `withSpan`, `@span`, `bitfab_span`, `client.Span`, `getFunction`, `get_function`, `bitfab_function`, `WithFunctionName`) and for the TypeScript transform/build adapter. For each candidate note whether it is **already instrumented** and, if so: its `traceFunctionKey`; whether capture is an opt-out trace tree, framework auto-capture, or an opt-in span tree; whether the TypeScript production entrypoint is transformed; which descendants have explicit node/span configuration; and which captured descendants serve their recorded output on replay. Existing opt-in spans elsewhere in a repository do not establish a house style and are not a reason to recommend more opt-in instrumentation. If the selected call stack already contains spans, recommend a coherent conversion or a disjoint trace root rather than placing `withTrace`/`trace` around those spans, which would raise `MixedTracingError`. Use this map in step 4 to distinguish existing instrumentation from recommended changes. An already-instrumented candidate remains eligible when source analysis identifies useful improvements. Do not build or upload planning artifacts.
3. Rank the workflows found in step 2 by tracing value, most valuable first: prefer complex or LLM-heavy workflows, multi-step agents, and high-traffic production paths; deprioritize thin single-call wrappers and anything that only exists to test or explore locally (dev CLIs, notebooks).

   **If the invocation carried free-text `guidance:` (see step 2), let it drive this ranking**: candidates matching the user's steer come first, and only fill the remaining slots with the general value ranking above. Treat the guidance as a strong preference, not a hard filter: if it matches fewer than N candidates, top up from the rest rather than recommending fewer workflows.

   **Pick the top N**, where N is the workflow cap for this run. Read N from the skill invocation arguments: if they include a `limit=<number>` token (e.g. `analyze-repo limit=3`), use that number; otherwise default to **5**. Pick fewer than N only if fewer valid candidates exist; pick more than N only if several are clearly tied for value and cheap to assess (never exceed N when it was explicitly passed).

   **Resolve serializability without prompting or editing code**, since this mode never refactors:
   - If the natural boundary's inputs are serializable, keep it as-is.
   - If they are unserializable but an obvious **inner** function with serializable inputs exists, move the boundary inward to that function (not a refactor, just a different, already-importable boundary).
   - If the workflow runs on a framework integration (LangGraph / LangChain, OpenAI Agents SDK, Claude Agent SDK, or Vercel AI SDK), keep the integration and recommend an opt-out root around the nearest serializable application or framework invocation boundary; its native agent, LLM, and tool spans nest beneath that root.
   - If the only cleanly *replayable* boundary would require a **refactor** (extracting/exporting a new function, restructuring call sites), do NOT drop the candidate and do not recommend an unserializable or root-only span as a substitute. Report that it requires an interactive `$bitfab:setup instrument` pass to create a serializable boundary, then recommend opt-out `withTrace`/`trace` plus `withNode`/`node` on that boundary when the runtime supports it. Only **drop** a candidate when there is no identifiable production workflow boundary at all. Report every one of the N selected workflows; dropping should be rare.

   If **zero** valid candidates remain, skip to step 4 and say so.
4. Print one plain-markdown report of the selected workflows. Lead with "Identified N workflows to instrument". For each, give the function key, root file and signature, what it does, frameworks, existing instrumentation, tracing value, additive instrumentation approach, replay dependencies, and estimated effort. Distinguish already-instrumented workflows and candidates requiring a refactor. Do not edit code, upload artifacts, wait for review, or claim changes were made. The user can ask setup to instrument a named workflow from this report.

## Cleanup

1. The requested setup work is complete.

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

### Instrumentation requirements

Read function signatures and bodies before instrumenting. Instrument the real production path. Keep additions behavior-preserving; preserve call order, argument and return types, error handling, streaming, and time-to-first-token. Use framework-native handlers/processors where documented. Keep one trace function key per coherent workflow, and implement its replay callable during the same cycle. Mock external reads and unsafe side effects using the SDK replay controls; keep model calls live. For non-additive refactors, follow the refactor-confirmation appendix. No persisted planning document or extra approval is required for authorized additive instrumentation.
