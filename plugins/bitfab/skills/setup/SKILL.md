---
name: setup
description: "Set up Bitfab tracing to improve AI features autonomously. TRIGGER when: user wants to instrument code, add tracing, set up Bitfab, observe AI calls, add evaluation, trace LLM functions, or says anything like 'instrument', 'add tracing', 'trace my code', 'set up observability', 'hook up Bitfab', 'start tracking'. SKIP when: user is iterating on existing traced functions or debugging failures (use bitfab:assistant instead).. Invoke with $bitfab:setup [<mode>] [<what to do>]."
---

# Bitfab Setup

**When the flow branches, always present the options clearly and wait for the user's answer before proceeding.** Number or letter the options so the user can pick by reference. Rules:
- Recommend an option first, explain why in one line
- Present 2-5 concrete options
- One decision per question — never batch

**🚨 Blocking-process rule (applies to any plugin command described as "blocks until the user does X"):** When you launch a plugin CLI that blocks on a Studio interaction (`login.js`, `startDataset.js`, `openTracePlan.js`, etc.), you MUST keep the exec session alive and keep polling it until the process exits on its own.

- The process opens Studio (or navigates an existing Studio session) and polls for the user's action via agent session events. It exits only after the user completes the action in Studio (or after the timeout).
- After launching the command, keep polling the live shell/exec session every few seconds with your normal "read more output" tool. Do not idle waiting for a user message.
- The user's confirmation does NOT come back as a chat message; it comes back as the plugin process exiting with output on stdout.
- Stop polling only when: (a) the process exits 0 with its completion summary, (b) the process exits non-zero, or (c) the user explicitly cancels.
- When the process exits, immediately continue with the next step, do not wait for another user message.

This skill has seven phases: **login**, **session-logs**, **instrument**, **modify**, **view**, **replay**, and **templates**. Run individually or all at once (`all` runs login → instrument → replay; `session-logs` is standalone and does not require login; `modify` is only invoked explicitly or as a branch from the Instrument step 2 menu; `view` is only invoked explicitly; `templates` is only invoked explicitly).

Within an Instrument cycle, **instrumentation and the replay pipeline for the cycle's trace function are written in the same batch of tool calls** once the trace plan is confirmed (see step 11). The Replay phase in `all` mode is therefore a coverage-verification/backfill sweep — it typically finds every key already wired up.

**Before running plugin commands below**, resolve `BITFAB_PLUGIN_DIR` in the shell. Codex does not inject a plugin-root env var, so you must determine it. Copy and run this block verbatim — it auto-detects whichever install is active (dev, prod, or a custom `CODEX_HOME`):

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

If the block prints `ERROR: Bitfab plugin not installed`, the user hasn't installed the plugin yet — stop and tell them to add the marketplace. Otherwise proceed. The cache path includes a trailing `local` for dev installs and `<version>` for prod installs; the commands live at `$BITFAB_PLUGIN_DIR/dist/commands/*.js`.

**SDK reference:** https://docs.bitfab.ai is the source of truth for SDK install, initialization, API surface, and replay. Fetch in this order before writing any code — do not improvise from memory:
- **Canonical API surface (preferred for agents):** the dense reference pages at `/reference/typescript`, `/reference/python`, `/reference/ruby`, `/reference/go`. These list every public export, signature, type, default, and error semantic — no tutorials, no prose. Read these first.
- **Cross-SDK shared semantics:** `/reference/overview` (invariants), `/reference/span-types` (the `SpanType` enum), `/reference/http` (wire protocol).
- **Framework integrations (fetch when a framework is detected in step 1 of Instrument):** `/frameworks/langgraph`, `/frameworks/openai-agents`, `/frameworks/claude-agent-sdk`, `/frameworks/baml`. Each page documents the SDK's native handler/processor/wrapper for that framework, which is usually preferable to hand-wrapping every node/agent call with `withSpan`/`@span`.
- **Tutorials / walkthroughs / replay script template:** the language-specific guide pages (`/typescript-sdk`, `/python-sdk`, `/ruby-sdk`, `/go-sdk`). Use these for the copy-pasteable replay script and the replay output contract. During Instrument, fetch the `#replay` section before step 11 so the replay script can be written in the same cycle as instrumentation.

**MCP tools:** This skill uses `get_bitfab_api_key`, `create_trace_plan`, and `get_trace_plan` (login / instrument / modify), and — for the `templates` mode only — `list_trace_functions`, `search_traces`, `get_template_reference`, `get_template`, and `update_template`. All come from the **local plugin MCP server** (bundled with this plugin), exposed under the `mcp__Bitfab__*` prefix.

| Invocation | Action |
|---|---|
| `$bitfab:setup` or `$bitfab:setup all` | Run login, then instrument + replay (together per workflow) |
| `$bitfab:setup login` | Authenticate via browser OAuth and retrieve API key |
| `$bitfab:setup instrument` | Instrument AI workflows with Bitfab tracing |
| `$bitfab:setup modify` | Modify an existing trace setup (add context, change depth, or move the root) |
| `$bitfab:setup view` | Open the trace planner UI for an existing trace function (read-only) |
| `$bitfab:setup replay` | Create or update replay scripts for instrumented workflows |
| `$bitfab:setup session-logs` | Opt in or out of session log collection (no login required) |
| `$bitfab:setup templates [<key>]` | Iterate on the span-rendering templates for one trace function |

**CLI commands** available via Bash (all paths relative to `${BITFAB_PLUGIN_DIR}/dist/commands/`):

| Command | Description |
|---------|-------------|
| `status.js` | Check plugin authentication and connection status |
| `login.js` | Authenticate via browser OAuth (blocks until complete) |
| `openTracePlan.js <planId>` | Open the trace plan confirmation UI in Studio (blocks until user confirms or cancels) |
| `waitForTrace.js <trace-function-key>` | Poll for the first trace to arrive (blocks up to ~10 min) |
| `startTemplatePreview.js <functionKey>` | Open the template editor preview in Studio (blocks until user clicks Done) |
| `closeStudio.js <sessionId>` | Close the Studio browser tab for an agent session |

## Preamble

**Run only when mode is `all`.**

1. Render the block below **verbatim** as a single message, then continue straight to Login. Do **not** ask for confirmation, do **not** ask any extra questions, do **not** summarize in your own words.

   ```
   Bitfab captures what your AI code does, turns runs into reusable datasets, and verifies fixes by replaying them against real data.

   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
   │   CODE   │───▶│  TRACES  │───▶│ DATASETS │───▶│ IMPROVE  │
   │          │    │ (what it │    │(reusable │    │ (edit +  │
   │          │    │   did)   │    │test set) │    │ verify)  │
   └──────────┘    └──────────┘    └──────────┘    └──────────┘

   Primitives
     • Trace   — a recording of one workflow run (inputs, outputs, every step inside).
                 Ground truth for what your code actually did.
     • Dataset — a curated collection of traces (failures, a specific workflow, custom).
                 The reusable test set your changes get measured against.
     • Replay  — a tool that re-runs a dataset through your current code.
                 Turns production data into a ready-made regression test.

   Setup runs in two phases:
     1. LOGIN                 — authenticate (15s, browser)
     2. INSTRUMENT + REPLAY   — written together per workflow:
        • INSTRUMENT          — wrap your workflows with tracing (purely additive)
        • REPLAY              — generate a replay script for your trace functions
   ```

   Then proceed to Login.

## Login

**Run only when mode is `all` or `login`.**

Authenticate with Bitfab and retrieve the API key.

1. Run the status check:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/status.js"
   ```

   If the output includes `v<X> available — run ... to update`, surface that line verbatim to the user once before proceeding; do not block on it.

   If **already authenticated**, skip to step 3.
2. If **"not authenticated"**, run the login script yourself — do NOT ask the user to run it manually:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/login.js"
   ```

   Run with 600000ms (10 minute) timeout. This opens Studio to the sign-in page and polls the server until the user completes authentication in the browser. The process exits when authentication succeeds or the 10-minute timeout fires.

   **Per the Blocking-process rule at the top:** after `login.js` opens Studio, keep polling the live exec session until it exits. Do not send a "waiting for you to sign in" message and then idle; the user's sign-in will NOT arrive as a chat message; it arrives as `login.js` exiting with `Logged in as <email>` on stdout.

   **If the browser fails to open**, `login.js` prints the Studio sign-in URL. Surface it to the user verbatim so they can open it manually. The polling loop stays active for the full 10-minute timeout regardless of whether auto-launch worked.

   If `login.js` exits non-zero or the 10-minute timeout elapsed, report the error to the user and stop.
3. Call `mcp__Bitfab__get_bitfab_api_key` to retrieve the API key — **NEVER print or log the full key**. Stored at `~/.config/bitfab/credentials.json`, used for the `BITFAB_API_KEY` environment variable.
4. Check whether session log consent has already been recorded:

   ```bash
   node -e "const fs=require('fs'),os=require('os'),p=require('path').join(os.homedir(),'.config/bitfab/config.json');const c=JSON.parse(fs.existsSync(p)?fs.readFileSync(p,'utf8'):'{}');console.log(c.sessionLogConsent??'null')"
   ```

   If the output is already `true` or `false`, skip the prompt and continue. If the output is `null`, ask the user:
   - **Question:** "Allow Bitfab to collect session logs?"
   - **Description:** Used to diagnose issues and improve the product.
   - **Options:** "Allow" / "Don't allow"

   Save the answer (replace `CONSENT` with `true` or `false`):

   ```bash
   node -e "const fs=require('fs'),os=require('os'),p=require('path').join(os.homedir(),'.config/bitfab/config.json');fs.mkdirSync(require('path').dirname(p),{recursive:true});const c=JSON.parse(fs.existsSync(p)?fs.readFileSync(p,'utf8'):'{}');c.sessionLogConsent=CONSENT;fs.writeFileSync(p,JSON.stringify(c,null,2)+'\n')"
   ```

**If running `login` only**, stop here and report the result.

## Session Logs

**Run only when mode is `session-logs`.**

Opt in or out of session log collection. Does not require authentication.

1. Check whether session log consent has already been recorded:

   ```bash
   node -e "const fs=require('fs'),os=require('os'),p=require('path').join(os.homedir(),'.config/bitfab/config.json');const c=JSON.parse(fs.existsSync(p)?fs.readFileSync(p,'utf8'):'{}');console.log(c.sessionLogConsent??'null')"
   ```

   If the output is `true`, tell the user session logs are currently **enabled**. If `false`, tell the user session logs are currently **disabled**. Then ask the user:
   - **Question:** "Allow Bitfab to collect session logs?"
   - **Description:** Session logs help us diagnose issues and improve the product. They include prompts, responses, and tool calls from sessions where Bitfab tools are used.
   - **Options:** "Allow" / "Don't allow"

   Save the answer (replace `CONSENT` with `true` or `false`):

   ```bash
   node -e "const fs=require('fs'),os=require('os'),p=require('path').join(os.homedir(),'.config/bitfab/config.json');fs.mkdirSync(require('path').dirname(p),{recursive:true});const c=JSON.parse(fs.existsSync(p)?fs.readFileSync(p,'utf8'):'{}');c.sessionLogConsent=CONSENT;fs.writeFileSync(p,JSON.stringify(c,null,2)+'\n')"
   ```

   Confirm the change to the user.

## Instrument

**Run only when mode is `all` or `instrument`.**

Instrument the codebase with Bitfab tracing. Requires authentication (run Login first if needed).

Bitfab captures every AI function call — inputs, outputs, and errors — so you can see exactly what your AI is doing and discover what's going wrong. The goal is to have enough context in each trace to tell whether a call succeeded or failed, and why.

1. **Detect the project language** (TypeScript, Python, Ruby, or Go). In a monorepo, identify which directories are **applications** (services, APIs, agents) vs **libraries** (SDKs, shared packages). Focus on application directories. Also scan imports and package manifests for supported framework signals, and note which framework each application directory uses — step 5 fetches the matching framework page alongside the language reference:
   - **LangGraph / LangChain** — TS: `@langchain/langgraph`, `@langchain/core`; Python: `langgraph`, `langchain`, `langchain_core`
   - **OpenAI Agents SDK** — TS: `@openai/agents`, `setTraceProcessors`; Python: `agents` (`from agents import ...`)
   - **Claude Agent SDK** — TS: `@anthropic-ai/claude-agent-sdk`, `ClaudeSDKClient`; Python: `claude_agent_sdk`, `ClaudeSDKClient`
   - **BAML** — TS: `@boundaryml/baml`, `baml_client` import; Python: `baml-py`, `from baml_client import b`
2. **Search for existing SDK usage** (`withSpan`, `@span`, `bitfab_span`, `client.Span`, `getFunction`, `get_function`, etc.). In a monorepo, search **each application directory separately** — a root-level search can miss subdirectories.
   - If found: list the trace function keys, then ask the user:

   > A) **Search for more workflows** — find uninstrumented gaps *(recommended)*
   > B) **Modify an existing trace setup** — jump to the Modify phase
   > C) **Continue** — skip to replay

     If "Modify", jump to the Modify phase. If "Continue", skip to Replay.
   - **If usage routes through a project-local shim** (a wrapper file that re-exports `withSpan` / `@span` / `bitfab_span` / `getCurrentTrace` / `getCurrentSpan` with custom init, often named `lib/bitfab.*` or after a predecessor SDK such as `lib/simforge.*`), audit the shim before instrumenting anything new. The shim must (a) construct the SDK client (`new Bitfab(...)`, `bitfab_init()`, `Bitfab::Client.new`, etc.) at module load, **synchronously**, never lazily inside the wrapped function; and (b) hand off to the SDK call synchronously, with no `await` between the user's entry to the shim and `client.withSpan(...)` / `@bitfab.span(...)`. Lazy or async client init (e.g. `await getOrCreateTraceFunction(key)` inside the wrapped body) breaks the SDK's nesting context (TypeScript `AsyncLocalStorage`, Python `contextvars`) under any parallel fan-out (`Promise.all`, `Promise.allSettled`, `asyncio.gather`, parallel workers): every span becomes its own top-level trace instead of nesting inside its caller. Fix the shim before instrumenting anything new. (Direct callers of the SDK with no shim already satisfy this rule, skip the audit.)
   - If not found: **proceed to step 3** — no SDK usage does NOT mean nothing to instrument, it means the SDK hasn't been installed yet. NEVER conclude "nothing to instrument" before completing step 6.
3. Use the API key from the Login phase (or retrieve it now if already authenticated)
4. **Install the SDK now.** Detect the project's package manager from its manifest (`pyproject.toml` → `uv`/`poetry`; `package.json` → `pnpm`/`npm`/`yarn`/`bun`; `Gemfile` → `bundle`; `go.mod` → `go get`; `requirements.txt` → edit file + `pip install -r`) and run its canonical add command — do NOT stop to ask about version pinning or dep groups. Prefer `uv add`/`poetry add` over bare `pip install` (bare `pip install` doesn't persist to pyproject.toml). In monorepos, scope to the correct workspace (e.g. `pnpm add --filter <pkg>`, or cd into the app directory first) — running from the repo root will install into the wrong package. Default to a runtime dep for applications; a dev dep for libraries/SDKs where a runtime dep would propagate to downstream users. Then set the `BITFAB_API_KEY` environment variable.

   **Tell the user what you did.** Pick the env-handling approach that fits the project's existing convention. Whatever you do, surface it explicitly: name the file (with absolute path) or mechanism you used, so the user knows where the key now lives. Do not print the key value itself. If the key landed in a `.env`-style file, additionally tell the user that any already-running dev server, REPL, or test runner may need a restart to pick it up, since most file watchers reload code on save but not env files.
5. **Read the SDK reference.** Fetch the dense canonical reference page first — `/reference/typescript`, `/reference/python`, `/reference/ruby`, or `/reference/go` — for every signature, type, default, and error semantic you need (initialization, `withSpan` / `@span` / `bitfab_span` / `client.Span`, `getFunction` / `get_function` / `GetFunction` / `bitfab_function`, `SpanType`, `getCurrentSpan`/`getCurrentTrace`, `wrapBAML`/`wrap_baml`). If step 1 detected a framework in this application directory, also fetch the matching framework page — it documents the handler/processor/wrapper the SDK exposes for that framework, which is usually preferable to hand-wrapping every node/agent call with `withSpan`/`@span`: LangGraph/LangChain → `/frameworks/langgraph` (`getLangGraphCallbackHandler` / `get_langgraph_callback_handler`); OpenAI Agents SDK → `/frameworks/openai-agents` (`getOpenAiTracingProcessor` / `get_openai_tracing_processor`); Claude Agent SDK → `/frameworks/claude-agent-sdk` (`getClaudeAgentHandler` / `get_claude_agent_handler`); BAML → `/frameworks/baml` (`wrapBAML` / `wrap_baml`). Then fetch the language guide (`/typescript-sdk`, `/python-sdk`, `/ruby-sdk`, `/go-sdk`) — including the `#replay` section for non-Go projects — for the install command, the multi-file project layout example, the BAML auto-instrumentation walkthrough, and the replay script template. Read the replay section upfront (not later) because step 11 writes the replay pipeline in the same cycle as instrumentation. Fetch those pages (via web-fetch capability, or ask the user to share them). **Do not improvise instrumentation from memory** — the API has moved and guessing will produce broken code.
6. **The root exists so the replay harness can re-invoke it as a plain lambda with serialized inputs** — that's what makes traces searchable (a coherent unit of behavior) and replayable (runnable against current code). The root must own its state setup, not consume a pre-built stateful object the replay script can't reconstruct. Frameworks are the sharpest case (LangGraph compiled graphs, Claude Agent SDK clients, LangChain chains all require constructors + special setup), but the rule generalizes to anything stateful — configured SDK clients, prepared models, cached routers, DB sessions. The root is therefore the outer workflow function that **builds** the framework / stateful object + invokes it + processes the output (API handler, message processor, job runner, pipeline coordinator) — almost never the SDK's `run()` / `invoke()` itself.

   **Hard constraint: every wrapped function's inputs and outputs must be serializable by the SDK's tracing layer so traces can be replayed.** Every span input and output gets serialized into the trace using the SDK's language-native serialization (TypeScript/JSON, Python/JSON via Pydantic, Ruby/`to_json`, Go/`json.Marshal`). If a wrapped function takes live runtime objects that don't round-trip through that serialization, the trace can't be replayed, and badly-failing inputs can drop the entire span on the floor (not just garble the input field). Examples of unserializable inputs:
   - browser objects (`MediaStream`, `RTCPeerConnection`, `WebSocket`, DOM refs)
   - HTTP `Request` / `Response`, stream writers, open sockets
   - framework request contexts whose content is genuinely opaque (not reconstructible from headers + user id)
   - **live SDK client instances passed as arguments** (LLM clients like `OpenAI` / `Anthropic` / Bedrock, configured agents, DB connection objects, HTTP agents): class instances whose internals carry circular references, function members, or platform handles all sink superjson and `JSON.stringify`. Watch especially for an options/config bag (e.g. `options.llmProvider`, `ctx.db`) that smuggles a live client into an otherwise-serializable signature.

   Module-level dependencies (DB clients, env vars, config loaders, LLM clients) do **not** count *when accessed via module scope or closure*: replay inherits them from the app's loaded environment. The same client passed *as a function argument* IS captured as input and WILL fail. The fix when an SDK client is the only unserializable piece is usually trivial: hoist it to module scope (or capture via closure) and drop it from the argument list, leaving the wrapped function's serializable args (issue, request, options-without-the-client) intact. When the natural outer boundary still has unserializable inputs after that, do **one** of the following **before writing code**:
   - **Move the trace boundary inward** to the first function whose inputs are serializable (e.g. trace `processTurn(transcript, context)` instead of `handleSession(stream, peerConnection)`). This is not a refactor.
   - **Refactor** so a function with serializable inputs exists. Two flavors, chosen per case in the refactor plan:
     - **Visibility refactor (common)** — the logic that takes serializable inputs already exists inline but isn't importable (embedded in a route handler, not exported). Extract it into a named, exported function at module scope. No semantic change.
     - **Structural refactor (rare overall, common for realtime/streaming/browser apps)** — no function with serializable inputs exists yet. Introduce one: a pure core whose parameters are serializable, with callers constructing them. A real rewrite.

   Raise this with the user in step 8 (not later) — never instrument a root with unserializable inputs and try to fix it in the Replay phase.
7. Read the codebase to identify ALL AI workflows — every place the app makes LLM calls, runs agents, or makes AI-driven decisions. For each, find the **outer workflow boundary** (per the rule in step 6), and also note any meaningful work **above** the agent/LLM call (auth, validation, input prep, retry/orchestration loops, multi-agent coordination), **alongside** it (custom LLM calls outside the SDK, tools that aren't registered with the SDK, downstream services), and **below** it (post-processing, parsing, persistence). These are the manual spans that will sit around any auto-captured SDK content.
8. Present a numbered list of workflows found, ordered by value (most complex or LLM-heavy first). For each, give:
   - **Trace boundary** — the outer workflow function that will be the trace function root (per step 6 — NOT the SDK/agent call itself)
   - **Inputs** — the shape of the function's inputs, and an explicit note that they're serializable by the SDK's tracing layer. If the natural outer boundary's inputs are unserializable (live browser/runtime objects, HTTP req/res, stream writers, sockets, opaque request contexts), state that here and present the two resolutions from step 6 as part of this workflow's entry: **(a) move the boundary inward to `<specific inner function with serializable inputs>`** (recommended when an obvious candidate exists — not a refactor), or **(b) refactor**. Do not proceed to step 9 until the user picks one — never instrument an unserializable root. **If the user picks (b), present a refactor plan — labeled as *visibility* (extract + export, logic unchanged) or *structural* (new pure-core fn) — and get an explicit second confirmation before modifying code. See the "Refactor confirmation" rule below.**
   - **What's covered end-to-end** — the work above, alongside, and below any agent/LLM/SDK call that this trace will capture (be specific: list the orchestration, custom LLM calls, tools, downstream services that will become spans)
   - **Why tracing it is valuable**

   The description must commit to the actual scope. If the plan will only auto-capture an SDK's internals, say so explicitly — do NOT use language like "complete tracing of X workflow" when the trace will only cover an SDK call's internals.

   Recommend one to start with. **Ask the user to pick exactly ONE workflow to instrument first.** Never accept "multiple" or "all" — each Instrument cycle produces exactly one trace function with one trace plan and one set of code changes. If the user wants to instrument several, they will be done sequentially via the loop in step 13, one at a time.
9. **Read function signatures you'll reference in the trace plan** — root function first, then any whose parameter names or return fields aren't already obvious from the step 7 scan. Skipped leaf functions only need their names; don't Read them unless their shape appears in the plan. Never guess names. See "Trace Plan Format" and "Trace Plan Accuracy" in the Reference section below.
10. **Build the trace plan under a hard constraint: the resulting instrumentation must be purely additive.** If a candidate tree requires *any* behavior change to make spans nest correctly (awaiting a stream that wasn't awaited, delaying a call, reordering operations, blocking a callback, restructuring control flow), the tree is invalid — restructure the *tree* instead (make spans siblings, split into separate trace functions across separate cycles, or accept a flatter shape). Never present a behavior-changing approach as an option, not even as a non-recommended alternative.

   **For trace processor SDKs (OpenAI Agents SDK, etc.) — extend beyond the processor.** The processor only auto-captures what runs *inside* the SDK's instrumented call (LLM calls, tool calls, handoffs). Everything above it (orchestration, retries, input prep), alongside it (non-SDK LLM calls, unregistered tools, downstream services), and below it (post-processing, persistence) is invisible unless you add manual spans. Default to a **hybrid plan**: trace function root wraps the workflow with manual `●` spans, the SDK call appears as one `(agent)` child whose grandchildren are `[auto]` lines, and other manual spans capture the work around it. A bare auto-only plan (root = the SDK call, no surrounding manual spans) is only valid when the workflow truly is just the SDK call with no surrounding work — confirm there's nothing meaningful above/alongside/below before defaulting to it.

   **One flow = one trace function key.** When an outer `@bitfab.span` / `withSpan` / `bitfab_span` and a framework handler wrap the same work (LangGraph `get_langgraph_callback_handler`, Claude Agent SDK `get_claude_agent_handler`), pass the **same key** to both — a second key splits one flow into two overlapping trace functions. Separate trace functions describe separate flows with their own standalone roots, never a sub-range of an outer flow.

   Then post the plan to the browser confirmation UI via `mcp__Bitfab__create_trace_plan` and open it with the `openTracePlan.js` CLI, which navigates Studio to the trace plan page and polls for the user's Confirm/Cancel decision via agent session events.

   - Build a `TracePlanTree` (`{ rootId, nodes: { [id]: TraceNode } }`) from the same span tree you'd otherwise render. Each `TraceNode` carries `id` (stable, e.g. hash of `file:line:name`), `name`, `kind` ("manual" | "auto" | "pure"), `file`, `line`, `signature`, `parentId`, `childIds`, plus `framework` (for `[auto]` lines).
   - **Every captured node MUST include `sampleInput` and `sampleOutput`.** Without samples the confirmation page can't show the user what gets captured, which is the whole point. Construct realistic example values from the function's parameter and return types (Read the file and its return-type imports if needed); for SDK calls (`openai.chat.completions.create`, `generateText`, `cohere.rerank`, etc.) use the documented response shape. Do NOT call `create_trace_plan` with a captured node missing either field.
   - **Include surrounding code as `pure` context nodes** so the captured set is legible inside its codebase context and the user can toggle additional nodes into the capture directly in the UI without leaving the page. The test for inclusion is **"would the user plausibly want this as its own span?"** — anything they might promote to a wider root, wrap as a deeper child, or add as a peer at the same depth. Walk in three directions:
     - **~10 callers above the root** — candidates for **promoting the root upward** to a wider scope. Walk via Grep (callers of the root, then callers of those, etc.) and attach each as a `pure` ancestor. Stop at process entry points (HTTP handlers, queue workers, CLI `main`, cron jobs, page handlers, framework boot — there is no useful root above those) or when you've gathered ~10 nodes.
     - **~10 callees below each leaf** — candidates for **wrapping deeper spans**. For every captured leaf, walk downward (callees of that leaf, callees of those, etc.) and attach each as a `pure` descendant. Include any callee the user might plausibly want as its own span — LLM / tool / agent calls, prompt construction, response parsing, retry loops, fan-outs, post-processing that drives another model. Stop at pure plumbing (pass-through returns, trivial formatting or arithmetic, no further interesting activity) or ~10 nodes per leaf. **Don't stop just because you crossed an SDK / framework / stdlib boundary** — the test is "is this plausibly its own span?", not "is this in our code?".
     - **~5 siblings per captured non-root node** — candidates for **peer spans at the same depth**. For each captured non-root node, include the parent's other callees (other functions invoked from the same wrapper) as `pure` siblings. These are the nodes the user might wrap alongside the existing capture to widen the trace sideways.
     All surrounding nodes get `kind: "pure"` and are **not** included in `capturedNodeIds`. They serve two ends: **legibility** (the captured set sits inside its surrounding code so the user sees what is and isn't traced) and **modification** (they are the levers in the UI for expanding capture deeper, broader, or sideways).
   - Call `mcp__Bitfab__create_trace_plan` with `{ language, tree, capturedNodeIds, traceFunctionKey }` (and `stats` if you have a sample run) — `capturedNodeIds` is your initial recommendation, must form a connected sub-tree (selecting any descendant implies its ancestors). `traceFunctionKey` is the key you'll pass to `getFunction` / `get_function` / `bitfab_function` / `WithFunctionName` in step 11; persisting it lets future Modify cycles bootstrap their `before` tree from this plan via `get_trace_plan({ traceFunctionKey })` instead of re-deriving from code. The tool returns a plan id (and a `https://bitfab.ai/studio/trace-plan/<id>` URL).
   - Open the trace plan in the browser by running:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/openTracePlan.js" <planId>
   ```

   (`${BITFAB_PLUGIN_DIR}` resolves to the plugin directory; `<planId>` is the id returned by `mcp__Bitfab__create_trace_plan`.) The script navigates Studio to the trace plan page and **blocks** until the user clicks **Confirm** or **Chat about this** (up to 30 minutes).

   **Polling (mandatory — see the Blocking-process rule at the top of this skill):** keep polling the live exec session until the process exits. Do NOT wait for a chat message from the user; their confirmation arrives as stdout on the already-running process, not as a new prompt. Poll every few seconds until one of these terminal conditions, then route accordingly:

   - The script emits JSONL to stdout. The first line is `{"event":"session-ready","sessionId":"<uuid>"}` once the Studio session is established. On exit, parse the final JSON line:
     - `{"event":"confirmed","planId":"<uuid>"}` — the user confirmed in the browser. The `planId` may differ from the original if a mid-session `create_trace_plan` call created a new plan (the script auto-tracks the latest plan via `tracePlan:created` events). Call `mcp__Bitfab__get_trace_plan` with the returned `planId` to read the authoritative `capturedNodeIds` for step 11. If it differs from your initial recommendation, prune `[auto]` lines whose ancestor manual span was uncaptured, and drop manual `●` wraps that aren't in the set.
     - `{"event":"cancelled","planId":"<uuid>"}` — the user aborted from the browser. Tell them the trace setup was dropped and ask what they'd like to do instead. Do not write instrumentation.
     - non-zero exit (including `{"event":"timeout",...}`) — surface the error to the user. Do not write instrumentation.

   **Inline fallback** (use only if `mcp__Bitfab__create_trace_plan` errors, e.g. offline or MCP unreachable): present the trace plan **using the format defined in the "Trace Plan Format" reference section below** (legend → grammar → template precedence → canonical example). **STOP** — ask the user to confirm before writing code.
11. **Write instrumentation AND the replay pipeline for this trace function in the same cycle — batched into a single message of tool calls.** Instrumentation edits go in one apply_patch / set of Edit calls; the replay script (new or updated `scripts/replay.*`) goes in the same turn. Skip the replay script entirely for Go-only projects (Go does not support replay).

   - **11a. Instrumentation edits** — follow the SDK reference exactly, purely additive. Never change behavior, arguments, return values, error handling, variable names, types, control flow, or code structure. Batch repetitive edits in parallel (one message, many Edit calls); for large mechanical fan-outs (>10 files of the same wrapper pattern), validate the pattern on one file, then do the remaining files.

   - **11b. Replay pipeline edits** — write or update the replay script (`scripts/replay.*` or the project's equivalent) alongside the instrumentation, grounded in the docs you already fetched in step 5:
     - **Language + SDK replay reference URL** — `https://docs.bitfab.ai/<language>-sdk#replay` (TypeScript / Python / Ruby). Re-check the `#replay` section now to confirm the current signature — do not write from memory.
     - **Trace function key** — as confirmed in the trace plan.
     - **Trace function root** — the function's real name, full signature (param names + types), return type, absolute file path, and import path the replay script will use.
     - **Replay script target** — if `scripts/replay.*` (or the project's equivalent) already exists, add a new pipeline entry for this key. Otherwise create the file.
     - **Non-negotiables**: CLI arg for pipeline name; optional `--limit N` (default 10) and `--trace-ids id1,id2` flags; replay fn imports and invokes the real function (never a stub); runs in the app's loaded `.env` environment (no mocked DB clients / env vars / config / models); mocks only what has no live counterpart at replay time (stream writers, session/request stubs); follows the Replay Output Contract (emit the full `ReplayResult` as one JSON block via `JSON.stringify(result, null, 2)` / `json.dumps(result, indent=2, default=str)` / `JSON.pretty_generate(result)`, including every item's `durationMs`/`duration_ms`, `tokens`, and `model`; never swap the JSON block for per-field log lines, counts, lengths, hashes, or previews); prints a short human-readable summary + test run URL before the JSON dump; lives under `scripts/` (or the project's existing scripts location).
     - **Match the `#replay` template's fn signature verbatim — no speculative defense.** The SDK invokes the replay wrapper with captured args in their original shape; don't branch on arg arity/shape, don't add type-checker escape hatches (`any` casts, `cast(Any, ...)`, ignore comments, untyped passthroughs), and don't guard against cases the contract precludes. If the root signature contradicts what the reference template expects, surface that to the user before writing code; don't paper over it. A hard error at the call site beats silent passthrough of malformed input.
     - **Per-item error tolerance** — `bitfab.replay` records thrown wrapped-fn errors in `item.error` and keeps going; rely on that. Don't wrap the fn in try/catch returning a placeholder — that turns infra failures (stale rows, FK violations, rejected writes) into fake successes. Only allowed top-level catch: a fatal handler around `main()` that exits non-zero, so callers can tell a whole-replay crash from a clean run with some unreplayable items.
     - **Side-effect check** — if importing the instrumented function triggers module-level side effects (booting listeners/ports/prod connections), do not work around it silently — flag it to the user so they can scope the replay env correctly.

   The trace plan's `Files changed:` list must include the replay script path for this cycle (new or edited) alongside the instrumented files.
12. Tell the user how to run the app to generate the first trace AND, once traces exist, how to run the replay script for this pipeline — give exact command(s) for both. Do NOT run them yourself. (Omit the replay command for Go-only projects.)
13. **MANDATORY STOP — never silently end the cycle without the A/B/C/D prompt.** Ask the user (we recommend **A**: generate traces before instrumenting the next workflows):

   > A) **Generate traces [current workflow]** *(recommended)*
   > B) **Instrument [next workflow]** — [why it's the next highest value]
   > C) **Instrument [other workflow]** — [alternative]
   > D) **Done instrumenting** — proceed to Replay (in `all` mode) / Done (in `instrument` mode)

   **For option A**, present the script to run to the user (allow them to let you run it for them). Before starting the wait, tell the user verbatim: `Polling for first trace (up to ~10 min) — press Esc to cancel.` Then run in a shell (allow up to ~11 min): `node "${BITFAB_PLUGIN_DIR}/dist/commands/waitForTrace.js" <trace-function-key>`. The command blocks inside Node — polling Bitfab every 10s until a trace lands or the ~10 min timeout fires — so no agent tokens are burned while waiting. When it exits, parse the final stdout line as JSON: `{"status":"found","traceId":"…","url":"…"}` → report the trace URL; `{"status":"timeout",…}` → note that no trace arrived yet; `{"status":"interrupted",…}` → the user cancelled.

   A, B, and C all return to step 8 for the selected workflow. Only D exits the Instrument loop.

   **After D in `all` mode, Replay ALWAYS runs** as a coverage-verification/backfill sweep. Step 11 already wrote a replay pipeline for every trace function instrumented in this session, so Replay is usually a no-op that confirms coverage; it still runs to catch any pre-existing trace function keys that don't yet have a pipeline and to verify Replay Output Contract compliance across all pipelines. Replay does not depend on traces existing — replay scripts are built from trace function keys in the instrumented code, not captured trace data. In `instrument` mode, D stops after the Instrument loop.

## Modify

**Run only when mode is `all`, `instrument` or `modify`.**

Adjust an **existing** trace setup. Requires existing SDK usage in the codebase — if none exists, run Instrument first. Triggered explicitly by `$bitfab:setup modify`, or selected from the choice prompt at Instrument step 2 when existing SDK usage is found.

Every Modify cycle targets **exactly one** trace function. Never batch multiple trace functions in one cycle — if the user wants more, loop via the step 7 menu.

1. **Gather existing trace functions** by searching for SDK patterns (`getFunction("key")`, `get_function("key")`, `bitfab_function "key"`, `WithFunctionName("key")`). List each key alongside its root function. If none are found, tell the user Modify needs existing instrumentation and suggest `$bitfab:setup instrument`.
2. **Pick exactly ONE trace function to modify.** Ask the user with the list of existing keys. Recommend the one the user most recently instrumented (or the one most recently referenced in the current session) and explain why in one line.
3. **Bootstrap the `before` `TracePlanTree` from the most recent confirmed trace plan for this trace function key**, falling back to reading the code only when no prior plan exists. The plan from the previous Instrument or Modify cycle is the source of truth for what's currently captured — re-deriving from code drops sample inputs/outputs and surrounding-context nodes the user previously confirmed.

   1. Call `mcp__Bitfab__get_trace_plan` with `{ traceFunctionKey: "<chosen key>" }` (no `planId`). Two outcomes:
      - **Prior plan found** — parse the JSON block in the response. Use its `tree` as the `before` `TracePlanTree` and its `capturedNodeIds` as the current capture set. You do not need to re-read the instrumented files. Skip step 2.
      - **"No prior confirmed trace plan found"** — there is no plan for this key yet (key created outside the skill, or first Modify cycle that predates this column). Fall through to step 2.
   2. **Code-reading fallback.** Read the instrumented files to map the existing span tree into a `TracePlanTree` (`{ rootId, nodes: { [id]: TraceNode } }`, same shape used in Instrument step 10). Each `TraceNode` carries `id`, `name`, `kind` ("manual" | "auto" | "pure"), `file`, `line`, `signature`, `parentId`, `childIds`, plus `framework` for `[auto]` lines.

   Either way, hold the `before` tree in memory — it seeds the `after` tree you build in step 4 and becomes the left-hand side of the inline-fallback diff in step 5. Do not present it yet.
4. **Build the modified trace plan as a `TracePlanTree` under the same PURELY ADDITIVE constraint as Instrument step 10.** Start from the `before` tree built in step 3 and produce an `after` tree of the same shape (`{ rootId, nodes: { [id]: TraceNode } }`) that applies the user's requested modifications. Reuse node ids unchanged for nodes that survive — that lets the trace plan UI show only what actually changes — and mint new ids for added nodes.

   **If the user didn't request anything specific** (no modifications were named in the skill invocation or earlier in the conversation), produce an `after` tree identical to the `before` tree. Don't invent changes. The user will edit the capture set directly in the UI in step 5.

   The modified tree must be implementable without behavior changes. If a requested modification requires awaiting a stream that wasn't awaited, delaying a call, reordering operations, blocking a callback, or restructuring control flow, tell the user which part doesn't fit and why, and ask them to refine the request (or suggest splitting into multiple cycles). Never present a behavior-changing approach as an option.

   **Every captured node MUST include `sampleInput` and `sampleOutput`** — same hard rule as Instrument step 10. Carry samples forward unchanged for surviving nodes; for newly added nodes (intermediate spans, deeper leaves, a new upstream/downstream root), construct realistic example values from the function's parameter and return types (Read the file and its return-type imports if needed). Do not advance to step 5 with a captured node missing either field.

   **Include surrounding code as `pure` context nodes** so the modified capture is legible inside its codebase context and the user can toggle additional nodes into the capture directly in the UI without leaving the page. The test for inclusion is **"would the user plausibly want this as its own span?"** — anything they might promote to a wider root, wrap as a deeper child, or add as a peer at the same depth. Walk in three directions:
   - **~10 callers above the root** — candidates for **promoting the root upward** to a wider scope. Walk via Grep (callers of the root, then callers of those, etc.) and attach each as a `pure` ancestor. Stop at process entry points (HTTP handlers, queue workers, CLI `main`, cron jobs, page handlers, framework boot — there is no useful root above those) or when you've gathered ~10 nodes.
   - **~10 callees below each leaf** — candidates for **wrapping deeper spans**. For every existing leaf in the captured sub-tree, walk downward (callees of that leaf, callees of those, etc.) and attach each as a `pure` descendant. Include any callee the user might plausibly want as its own span — LLM / tool / agent calls, prompt construction, response parsing, retry loops, fan-outs, post-processing that drives another model. Stop at pure plumbing (pass-through returns, trivial formatting or arithmetic, no further interesting activity) or ~10 nodes per leaf. **Don't stop just because you crossed an SDK / framework / stdlib boundary** — the test is "is this plausibly its own span?", not "is this in our code?".
   - **~5 siblings per captured non-root node** — candidates for **peer spans at the same depth**. For each captured non-root node, include the parent's other callees (other functions invoked from the same wrapper) as `pure` siblings. These are the nodes the user might wrap alongside the existing capture to widen the trace sideways.

   Mark every surrounding node with `kind: "pure"` (uncaptured) and **do not** add their ids to `capturedNodeIds`. They serve two ends: **legibility** (the captured set sits inside its surrounding code so the user sees what is and isn't traced) and **modification** (they are the levers in the UI for expanding capture deeper, broader, or sideways).

   When applying a requested modification, read the relevant signatures so the plan stays accurate: for added context, name the exact keys/values and the span they attach to; for new instrumented spans, read each callee's signature and pick a type annotation (`function`, `llm`, `tool`, `agent`, `handoff`); for span removals, list each by name and confirm the underlying call is left untouched; for a new upstream/downstream root, read the new function's signature and confirm it still covers the interesting LLM/tool activity (upstream) or remains a common ancestor of every LLM/tool span (downstream).
5. **Send the modified plan straight to the trace plan UI — it is the user's primary surface for confirming or editing the change**, not the inline before/after diff. The user can adjust the captured set directly in the UI (selecting/deselecting any of the surrounding `pure` context nodes added in step 4). Confirm in the UI = apply the diff. Cancel = ask the user what they want to change. Same delivery pattern as Instrument step 10.

   1. **Post the modified plan and open the UI.** Call `mcp__Bitfab__create_trace_plan` with `{ language, tree, capturedNodeIds, traceFunctionKey }` (and `stats` if you have a sample run from the existing trace function):
      - `tree` — the modified `after` `TracePlanTree` from step 4, with the ~10 surrounding callers / ~10 surrounding callees included as `pure` context nodes.
      - `capturedNodeIds` — your initial recommendation. Must form a connected sub-tree (selecting any descendant implies its ancestors). Surrounding `pure` context nodes are not included.
      - `traceFunctionKey` — the existing key from step 2. Persisting it lets the next Modify cycle bootstrap from this plan.

      The tool returns a plan id (and a `https://bitfab.ai/studio/trace-plan/<id>` URL).

   2. **Open the trace plan in the browser** by running:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/openTracePlan.js" <planId>
   ```

   (`${BITFAB_PLUGIN_DIR}` resolves to the plugin directory; `<planId>` is the id returned by `mcp__Bitfab__create_trace_plan`.) The script navigates Studio to the trace plan page and **blocks** until the user clicks **Confirm** or **Cancel** (up to 30 minutes).

   **Polling (mandatory — see the Blocking-process rule at the top of this skill):** keep polling the live exec session until the process exits. Do NOT wait for a chat message from the user; their confirmation arrives as stdout on the already-running process, not as a new prompt. Poll every few seconds until one of these terminal conditions, then route accordingly:

   3. **On exit, parse the final JSONL line and route:**
      - `{"event":"confirmed","planId":"<uuid>"}` — call `mcp__Bitfab__get_trace_plan` with the returned `planId` (which may differ from the original if a mid-session `create_trace_plan` created a new plan; `openTracePlan.js` auto-tracks the latest plan via `tracePlan:created` events) to read the authoritative `capturedNodeIds` (the user may have toggled `pure` context nodes into the captured set or removed previously-captured nodes in the UI). Reconcile your edit plan with what's now in `capturedNodeIds` — drop manual `●` wraps no longer captured, add wraps for any newly captured nodes — then take branch **A** (Proceed).
      - `{"event":"cancelled","planId":"<uuid>"}` — the user cancelled from the browser. Take branch **C** (Modifications) — ask the user: what do they want to change? Their answer feeds back into step 4. When the loop re-runs `openTracePlan.js` with the new plan, the script reuses the existing Studio browser tab automatically.
      - non-zero exit (including `{"event":"timeout",...}`) — surface the error to the user, then fall back to the inline AskUserQuestion below.

   **Inline fallback** (use only if `mcp__Bitfab__create_trace_plan` errors, e.g. offline or MCP unreachable, or `openTracePlan.js` exits non-zero): present an inline before/after diff using the Default view template from the **Trace Plan Format** reference section, list `Files changed:` (paths only, no annotations), and **STOP** — ask the user:

   > A) **Proceed** — apply the diff using the confirmed capture set *(recommended)*
   > B) **Expand details** — re-render the inline diff in the expanded view (fallback only)
   > C) **Modifications** — ask what the user wants to change, then return to building the modified plan
   > D) **Abort entirely** — drop this cycle without writing edits
6. **Apply the changes — purely additive to behavior.** Same rules as Instrument step 11: never change arguments, return values, error handling, variable names, types, control flow, or code structure. Removing a `withSpan`/`@span` wrapper is the only structural edit allowed, and only when it leaves the wrapped call, its arguments, and its return value untouched. The trace function key from step 2 stays the same — do not rename keys. Batch repetitive edits in parallel (one message, many Edit calls).
7. Tell the user how to run the app to generate a trace with the modified setup — exact command(s). Do NOT run it yourself. Then **MANDATORY STOP** — ask the user:
   > We recommend **A**: generate a trace with the modified setup so the diff is observable end-to-end.

   > A) **Generate a trace for the modified setup** — present the script to run; allow the user to let you run it *(recommended)*
   > B) **Modify another trace function** — returns to step 2
   > C) **Done** — stop here

   B returns to step 2. A and C exit the Modify loop. After exit, stop (Modify does not auto-continue to Replay — the user can invoke `$bitfab:setup replay` separately).

## View

**Run only when mode is `view`.**

Open the trace planner UI for an **existing** trace function — read-only. Triggered explicitly by `$bitfab:setup view`. Useful for inspecting what's currently captured (tree shape, captured node ids, sample inputs/outputs) without making any code edits.

Every View invocation targets **exactly one** trace function. The browser UI's Confirm/Cancel controls have no effect here — the user is just looking at the plan.

1. **Gather existing trace functions** by searching for SDK patterns (`getFunction("key")`, `get_function("key")`, `bitfab_function "key"`, `WithFunctionName("key")`). List each key alongside its root function. If none are found, tell the user View needs existing instrumentation and suggest `$bitfab:setup instrument`.
2. **Pick exactly ONE trace function to view.** Ask the user with the list of existing keys. Recommend the one the user most recently instrumented (or the one most recently referenced in the current session) and explain why in one line.
3. Call `mcp__Bitfab__get_trace_plan` with `{ traceFunctionKey: "<chosen key>" }` (no `planId`). Two outcomes:

   - **Prior plan found** — parse the response for the `Plan id:` line and hold that id for the next step. Take branch **A** (Open).
   - **"No prior confirmed trace plan found"** — there is no plan to view (key created outside the skill, never confirmed, or never instrumented via this skill). Tell the user there's nothing to view yet and suggest `$bitfab:setup modify` to build and confirm a plan for this key. Take branch **B** (Stop).
4. Open the trace plan in the browser by running:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/openTracePlan.js" <planId>
   ```

   (`${BITFAB_PLUGIN_DIR}` resolves to the plugin directory; `<planId>` is the id parsed from step 3.) The script emits JSONL to stdout. The first line is `{"event":"session-ready","sessionId":"<uuid>"}`. The script navigates Studio to the trace plan page and **blocks** until the user closes Studio or clicks Confirm/Cancel (up to 30 minutes). View is read-only; whichever button the user clicks (the final JSONL line will be `{"event":"confirmed",...}` or `{"event":"cancelled",...}`), do **not** apply edits or call `mcp__Bitfab__get_trace_plan` again. When the process exits, report that the plan was viewed and stop.

   **Polling (mandatory — see the Blocking-process rule at the top of this skill):** keep polling the live exec session until the process exits. Do NOT wait for a chat message from the user; their dismissal arrives as stdout on the already-running process, not as a new prompt.

## Replay

**Run only when mode is `all` or `replay`.**

Create or update replay scripts for instrumented trace functions. Requires instrumentation in the codebase; does **not** require existing traces — replay scripts are created from trace function keys in the code, not captured trace data.

Replay scripts let the team regression-test any trace function against production data with one command — they fetch historical traces, re-run them through the current code, and report old vs. new outputs side-by-side. Note: **Go does not support replay** — skip this phase if the project is Go-only.

**Relationship to Instrument.** When Replay runs via `all` mode or directly after Instrument, most (often all) trace function keys already have pipelines because Instrument step 11 writes them in the same cycle as the instrumentation edits. This phase is then a coverage + contract-compliance sweep. Run it standalone (`$bitfab:setup replay`) to catch pre-existing trace function keys that predate the parallel-write step or were added outside the skill.

**Source of truth:** two pages — read both before creating or modifying a replay script. Do not improvise from memory.
- **Canonical `replay` API signature, options, and return shape:** `/reference/typescript#replay`, `/reference/python#replay`, `/reference/ruby#replay` (Go has no replay). Use this for the exact field names (`result` / `originalOutput` vs `original_output`), default `limit`, `maxConcurrency`/`max_concurrency`, error behavior.
- **Copy-pasteable script template + replay output contract + input serialization caveat:** `/typescript-sdk#replay`, `/python-sdk#replay`, `/ruby-sdk#replay`. Use this for the `scripts/replay.<ext>` shape and the rules for what to print to stdout.

1. **Gather all trace function keys** by searching for SDK patterns (`getFunction("key")`, `get_function("key")`, `bitfab_function "key"`, `WithFunctionName("key")`). This is the source of truth for what replay must cover.
2. **Search for existing replay scripts** — files matching `scripts/replay.*`, `scripts/*replay*`, or any file importing/calling the SDK's replay API.
3. **Compare coverage.** Replay is non-interactive once entered — do not ask the user whether to create or add scripts:
   - If replay scripts exist and cover all keys: verify each one already conforms to the Replay Output Contract in the docs (emits the full `ReplayResult` as one JSON block, including every item's `traceId`/`trace_id`, `durationMs`/`duration_ms`, `tokens`, and `model`, never just counts or per-field log lines) and supports all three optional flags (`--code-change`, `--experiment-group-id`, `--trace-ids`). If any don't conform or are missing flags, fix them; otherwise report up to date and stop.
   - If replay scripts exist but are missing trace function keys: add the missing scripts in step 4.
   - If no replay scripts exist: create them in step 4.
4. **Create the replay script** following the example in the SDK reference's Replay section (`https://docs.bitfab.ai/<language>-sdk#replay`), adapted to this codebase. The non-negotiables (enforced by the docs page, repeated here so the script review catches them):
   - **Ground the script in the docs, not memory.** Before writing the replay call, fetch `https://docs.bitfab.ai/reference/<language>#replay` for the canonical signature and return shape, then `https://docs.bitfab.ai/<language>-sdk#replay` for the script template and output contract. Quote the exact function signature + return-shape fields verbatim in your plan. Field names differ per language (Python: `result`, `original_output`; TypeScript: `result`, `originalOutput`; Ruby: `:result`, `:original_output`) — do not paraphrase or invent names like `new_output`/`trace_id`.
   - **Pass the decorated function itself, not an undecorated wrapper.** The trace function key is read from the decorator/attribute on the function you pass in. For Python class methods, pass `Class.method` (or a bound `instance.method`). For TypeScript, the key is passed as a string arg alongside the function — use the exact key from the instrumented code. For Ruby, pass `receiver` + `method_name:` + `trace_function_key:` matching the `traceable` decoration.
   - **Use the same `Bitfab` client across instrumentation and replay.** Import it from the instrumented module (or a shared singleton) — never construct a second client inside the replay script, or registered trace functions won't resolve.
   - Accept a pipeline name as a CLI argument
   - Accept optional `--limit N` (default 10) and `--trace-ids id1,id2` flags
   - Accept optional `--code-change <path>` flag: path to a JSON file shaped `{ "description": string, "files": [{ "path": string, "before": string, "after": string }] }`. Read the file, then pass its `description` as `codeChangeDescription` / `code_change_description` and its `files` as `codeChangeFiles` / `code_change_files` into the SDK's `replay()` call. Forward the file objects through verbatim — do **not** add a `repo`, `commit`, or other context fields; `path` is the sole identifier (use `""` for newly created or deleted files). The improve skill's iteration loop writes this file before invoking the script so each experiment shows the literal edit alongside its results in the dashboard.
   - Accept optional `--experiment-group-id <uuid>` flag: pass the value as `experimentGroupId` / `experiment_group_id` into the SDK's `replay()` call. This groups test runs from the same iteration so the experiments page can stream results live as the replay runs.
   - Map pipeline names to trace function keys and their replay functions
   - **Each pipeline's replay function MUST import and call the actual instrumented function** — never a stub or identity function. If the function signature doesn't match the raw input shape, reshape arguments in the wrapper.
   - **Replay runs in the app's environment.** The script imports the app as a library — DB clients, env vars, config loaders, and model IDs resolve from the loaded environment. Do **not** mock them. Run the script with `.env` loaded (e.g. `pnpm with-env tsx scripts/replay.ts`, `dotenv run -- python scripts/replay.py`, or the project's equivalent) so the app's normal bootstrap applies.
   - **Only mock what has no live counterpart at replay time.** For factory-created instrumented functions (taking session, stream writers via closure), the wrapper passes:
     - Stream/socket writers: no-op (`{ write: () => {}, merge: () => {} }`) — no client on the other end
     - Session/request identifiers: minimal stub with the fields the function reads
   - **Caveat: watch for module-level import side effects.** Importing the instrumented function transitively runs the app's module initialization — if that opens listeners, binds ports, or connects to prod, the replay script inherits it. When in doubt, confirm the replay env points at a staging/local DB before running.
   - **Follow the docs' Replay Output Contract**: capture the full `ReplayResult` (items + `testRunId` + `testRunUrl`, including `durationMs`/`duration_ms`, `tokens`, and `model` per item) into one variable and emit it as a single JSON object to stdout via `JSON.stringify(result, null, 2)` (TS), `json.dumps(result, indent=2, default=str)` (Python), or `JSON.pretty_generate(result)` (Ruby). A subagent reading the output must be able to `JSON.parse` / `json.loads` one contiguous block — do not replace the JSON dump with per-field log lines, counts, lengths, hashes, or previews. Writing the same JSON to `scripts/replay-result.json` in parallel is optional but encouraged.
   - Print a short human-readable summary (total replayed, same, changed, errors) and the test run URL ahead of the JSON dump
   - Live in a `scripts/` directory (or the project's existing scripts location)
5. **Safety net for legacy instrumentation.** If an already-instrumented function (introduced before step 6's serializability gate, or via another path) can't be invoked from the replay script — most commonly because it isn't exported, is defined inline in a route handler, or takes unserializable inputs — ask the user offering step 6's two resolutions:

   > A) **Move trace boundary inward**
   > B) **Refactor** *(recommended)*
   > C) **Leave as-is** — add a header comment noting why the function isn't callable and flag that the script will rot

   Reason from the function's signature and visibility; do not execute the script to detect this. **If the user picks "Refactor" (or a boundary move that requires rewriting callers), apply the "Refactor confirmation" rule below — present a refactor plan labeled as *visibility* or *structural* and get a second confirmation before modifying code.**

## Templates

**Run only when mode is `templates`.**

Iterate on the **span-rendering templates** for one trace function. Each round: the user describes what should look different, you call `mcp__Bitfab__get_template` → edit → `mcp__Bitfab__update_template` **with `traceFunctionKey` set to the picked key**, and the user refreshes the chromeless template-preview page to see the change rendered against a real trace. Loop until the user is satisfied. Triggered explicitly by `$bitfab:setup templates [<key>]` — never reached from `all`.

Templates control how a span's input / output renders in the Bitfab UI. They are scoped per **span type** (`llm`, `agent`, `function`, `guardrail`, `handoff`, `custom`). This phase **always passes `traceFunctionKey`** so edits become **per-function overrides**: they apply only to spans on traces of the picked function, not to other functions in the org. Resolution at render time is per-key row → org-global → file default, so the seed you see in `mcp__Bitfab__get_template` reflects whatever is currently rendering for this function. Surface this scope when the user asks for a change so they know nothing else in the org is affected.

1. If the user passed a key as the argument, use it directly and continue.

   Otherwise, follow the same picker pattern as `$bitfab:assistant`:

   1. Call `mcp__Bitfab__list_trace_functions` to enumerate the org's traced functions. The tool returns flat `FUNCTION: <key>` lines; work from those keys directly. Use **only** the keys returned: do NOT invent or infer descriptions of what each function does from its name. Key names are often ambiguous, and guessing produces hallucinated summaries that confuse the user.
   2. Grep this repo for each key in parallel (across `*.ts`, `*.tsx`, `*.py`, `*.rb`, `*.go`, `*.baml`) so you know which keys are instrumented here. Mark each as ✅ instrumented here (with file path) or ⚠️ not found in this repo.
   3. Present a compact list in the question text showing only: `<key>` · `<repo marker + path>`. No invented summaries.
   4. Ask the user with 2 options: the recommended function (prefer ✅ instrumented here, and matching session context when one is clearly relevant) and a free-text "Type a function key" option. If nothing is instrumented in this repo, say so explicitly in the question, don't hide it.

   - **argument supplied** — use it as the trace function key and continue
   - **no argument** — list trace functions, ask the user, then continue with the chosen key
2. Call `mcp__Bitfab__get_template_reference` **once** before any edit. It returns a stable agent-facing schema for Bitfab span templates: the rendering engine (Nunjucks, Jinja2-compatible), the render-context shape (top-level keys, `SpanData` / `ParsedSpanData`), the registered custom filters and tests, common patterns from the live default templates, and error-fallback behavior. Without this you cannot write a correct edit; references to undeclared variables silently render empty in production.

   Hold the reference in your working context for the rest of the loop. Do NOT call it again on subsequent edits.
3. Before opening the preview, grep the codebase for the trace function key (`<key>`) so you can see what the function actually does. The user's "change" requests are usually about surfacing something domain-specific (an input field, a tool name, a context label), and knowing the function helps you map the request to the right span type and the right field path. If grep returns nothing (the function has been renamed or the user is operating on traces from a different repo), continue without it.
4. The preview page renders the most recent trace for the function. Without at least one trace it has nothing to render, so check before opening it.

   Call `mcp__Bitfab__search_traces` with `{ traceFunctionKey: "<key>", limit: 1 }`. If the response contains a trace ID, continue. If the response indicates no traces exist (e.g. `No traces found matching the filter criteria.`), exit and tell the user in one short line: `No traces yet for <key>. Run your app (or the replay script) to generate one, then re-run \`$bitfab:setup templates <key>\` to preview.` Do NOT block waiting; the user re-invokes when they have a trace.

   - **trace exists** — continue and open the preview
   - **no traces yet for this function** — exit and tell the user to generate a trace and re-run
5. Launch the preview command **in the background** so the agent can keep iterating while the page stays open:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/startTemplatePreview.js" <functionKey>
   ```

   Run this in a long-lived exec session (`exec_command` with `is_background: true`); capture the session id so you can `read` it between edit rounds to check whether it has exited.

   The command **blocks until the user clicks Done in Studio**, then exits 0 with a single line like `Template preview closed [via studio]`. If the user instead just closes the browser tab without clicking Close, the process keeps running until the 30-minute timeout. The page auto-redirects to the most recent trace for the function and renders it with the org's current templates; it subscribes to SSE `template:updated` events and re-renders the affected span automatically, so the user does NOT need to refresh after each edit.

   🚨 **Stdout is a mixed JSONL + free-form stream.** Two event shapes flow over the same channel as the user interacts with the live preview:

   ```json
   {"event":"click","ts":"...","traceId":"...","spanId":"...","spanType":"...","sectionPath":"metadata","fieldPath":"metadata.tokens","rawText":"1234","selector":"..."}
   {"event":"focus","ts":"...","traceId":"...","spanId":"...","viewMode":"span","expandedSections":["metadata"]}
   ```

   `click` events fire when the user clicks a decorated element. `focus` events fire on initial load, on every span/trace selection change, and on shadow-root `<details>` open / close — so you always know the starting viewport even before any click.

   Free-form text (browser-handoff status lines, errors) goes through the same stdout. **You MUST filter to lines that parse as JSON before routing.** Skip anything that doesn't parse — never error out on non-JSON lines. The click event payload follows the template-anchor catalog returned by `mcp__Bitfab__get_template_reference`; `fieldPath` matches a row there, `sectionPath` matches a section id. Unknown anchor values are omitted (the click handler drops them); `rawText` and `selector` are always present so you can disambiguate. Focus event fields are always present; `spanId` is null when the user is on the trace overview, `viewMode` is `"trace"` or `"span"`, and `expandedSections` lists the `data-section` ids whose `<details>` is currently open.
6. Each round of the loop. **Every `mcp__Bitfab__get_template` and `mcp__Bitfab__update_template` call must include `traceFunctionKey: <key>`** (the key picked in step 1); without it you'd edit the org-global instead of this function's override.

   1. **Tail the background process's stdout** for any `{"event":"click",...}` or `{"event":"focus",...}` JSON lines that arrived since the previous round. Parse each line; skip non-JSON status lines.
      - **Most recent click** (if any) is ground truth for "what the user is referring to": its `spanType` is the template to edit, `sectionPath` + `fieldPath` (against the anchor catalog from `mcp__Bitfab__get_template_reference`) tell you which region to change. If `fieldPath` is absent, fall back to `sectionPath` + `rawText`.
      - **Most recent focus** tells you what the user is currently looking at, even without a click. Use it to anchor a question when the user's instruction is ambiguous (e.g. "make this less verbose" while their focus is on a specific span) and to pick the span type when no click is available. Focus is also helpful to confirm in your acknowledgement that you're editing the same span the user is viewing.
      - If neither signal is present since the last round, fall through to step 2 and ask normally.
   2. Ask : **"Tell me how you want your trace data to look and I'll make the changes in Bitfab. You'll see the changes update live in the Bitfab Studio (the browser tab opened from here)."** **If there was a click in the previous round, anchor the question to it** by prepending a one-line acknowledgement (e.g. "You clicked the tokens value in metadata."). Keep the framing open-ended — do NOT list the six span types up front; let the user describe what they want and pick the span type from their answer. If the user names one of the six span types (`llm`, `agent`, `function`, `guardrail`, `handoff`, `custom`), use that. If their answer is unambiguous about the rendered region but doesn't name a span type AND there was no click, fall back to which of the six span templates they want to edit. Don't guess the span type from a description like "make this less verbose," since the same description fits multiple templates.
   3. Call `mcp__Bitfab__get_template` with `spanType` and `traceFunctionKey: <key>` to read the **live** content. The response labels its source: `scoped to traceFunctionKey "<key>"` (a per-key row already exists), `org-global override` (no per-key row yet — this is your seed for the first save), or `source: file <name>` (no DB rows at all). **Always** read before write: the prior round may have edited the same template, and overwriting blindly drops that work.
   4. Edit the returned source in-context — **one focused change per round**. Resist the urge to bundle multiple unrelated tweaks into a single save: small steps let the user see each effect land on the preview and redirect mid-loop if the change isn't quite right. Stay inside the documented Nunjucks variables and filters (per the reference). Don't introduce `{% extends %}`; the assembler injects into `base.njk`'s content block, so extends will break composition. When adding new visible regions, **decorate them with the catalog anchors** (`data-section`, `data-field-path`, `data-iter-index`) so future clicks resolve cleanly.
   5. Call `mcp__Bitfab__update_template` with `spanType`, `traceFunctionKey: <key>`, and the full edited body. The tool upserts the per-function row in place (no version bump, no row juggling). On the first save for a span type the row is created; subsequent edits update it. The browser shows a brief "Editing..." status banner while the call is in flight, then a "Saved" flash when it returns — no extra signaling needed from your side.
   6. Acknowledge the save in one short line (e.g. "Saved."). The preview page subscribes to SSE `template:updated` events and re-renders automatically — do NOT tell the user to refresh. Do not paste the template body back into chat. After a non-trivial change you may briefly ask  whether the result looks right before starting the next round; for obvious tweaks (a label rename, a colour swap), skip the check and proceed.

   Before asking the user about another change, **check whether the background process from step 5 has exited**. The terminal signal is a line containing `Template preview closed` on stdout (the process exits 0 right after).

   Use `read` against the captured exec session; the `Template preview closed` line on stdout means the user clicked Close and the session has exited. **Use the same read to harvest any new `{"event":"click",...}` and `{"event":"focus",...}` JSON lines for step 1 of the next round.**

   Two ways the loop ends:

   - **background process exited (user clicked Close)** — exit the loop and acknowledge that template editing is done
   - **user explicitly says they're done** — exit the loop and acknowledge
   - **user wants another change** — loop back and apply the next edit

## Cleanup

1. If a Studio session was opened at any point during this flow (any command that emitted a `{"event":"session-ready","sessionId":"<uuid>"}` JSONL line), close it now:

   ```bash
   node "${BITFAB_PLUGIN_DIR}/dist/commands/closeStudio.js" <sessionId>
   ```

   If no Studio session was opened during this flow, skip this step.

## Refactor confirmation (applies to Instrument step 8 and Replay step 5)

Whenever the user picks "refactor to extract a pure core" (or any option that modifies existing functions/call sites, not just adds new wrappers), you must:

1. **Build a refactor plan** listing:
   - **Flavor** — **visibility** (extract + export, logic unchanged) or **structural** (new pure-core fn with serializable inputs, may require callers to construct them). Most cases are visibility.
   - **Source** — the function(s) that will be modified, with file path and current signature
   - **Extraction** — the new function name, its signature, and (for visibility refactors) an explicit note that the logic moves unchanged
   - **Trace wrap** — which function will carry the `getFunction(...)` / SDK trace wrap after the refactor
   - **Call sites** — every caller that will be rewritten, with file path and line range

2. **Present the plan verbatim** to the user, in the same format above.

3. **Ask the user** with exactly two options:
   - **"Apply refactor"** — proceed to write the changes
   - **"Cancel"** — return to the previous choice prompt (step 8's (a)/(b), or Replay step 5's three-option prompt) so the user can pick a different resolution

Never modify existing code on a refactor path without completing this three-step confirmation. Adding new instrumentation wrappers to unchanged functions is not a refactor — this rule does not apply to step 11's purely-additive instrumentation.

## Reference

These sections are consulted during the Instrument phase — not executed sequentially.

### Trace Plan Format

The trace plan is a strict format. Do not improvise — follow the legend, grammar, and template selection rule below. When in doubt, copy the matching canonical example verbatim and substitute names.

#### Legend

| Symbol | Meaning | Where it appears |
|---|---|---|
| `●` | Instrumented span | Default + Expanded + Processor views |
| `○` | Skipped function (not instrumented) | Only when the expand modifier is applied (on top of any base template) |
| `[root]` | Literal label for the trace function entry point | Always, on its own line above the tree |
| `[loop]` | Control-flow group: children execute in a loop | Inside the tree, in place of a span |
| `[branch]` | Control-flow group: children are conditional branches | Inside the tree, in place of a span |
| `[parallel]` | Control-flow group: children execute concurrently | Inside the tree, in place of a span |
| `[auto]` | Auto-captured by a trace processor — no manual instrumentation | Trace-processor view only |
| `(function)` `(llm)` `(tool)` `(agent)` `(handoff)` | Span type annotation | Immediately after every `●` span name |

Brackets `[…]` are structural labels (not spans). Parens `(…)` are span type annotations (only on `●` lines).

#### Grammar rules

1. **Header line** — exactly: `Trace function: "<trace-function-key>"` followed by one blank line.
2. **Root** — the next line is the literal `[root]`, with no symbol prefix.
3. **Tree body** — uses box-drawing characters only:
   - `├─` for every child except the last
   - `└─` for the last child
   - Children of a `├─` node indent with `│  ` (pipe + two spaces)
   - Children of a `└─` node indent with `   ` (three spaces, no pipe)
4. **Span lines** — `<prefix>● <name> (<type>)`. Type annotation is **required** on every `●` line.
5. **Skipped lines** — `<prefix>○ <name>`. No type annotation, no description.
6. **Control-flow lines** — `<prefix>[loop]` / `[branch]` / `[parallel]`. They take children but have no symbol and no type.
7. **Footer** — one blank line, then one or both of:
   - `Files changed:` followed by a numbered list — every file the cycle will touch. This always includes the replay script path for non-Go projects (`scripts/replay.*` new or edited, per step 11b) alongside any instrumented source files. Go-only projects list only the instrumented source files.
   - `Setup: <one-line setup description>` (any plan that registers a trace processor)
   Hybrid plans (manual spans + processor) include both, with `Setup:` first then `Files changed:`. A pure-processor plan still lists `Files changed:` because the processor-registration file is edited and the replay script (non-Go) is written. Go-only pure-processor plans with a single registration file and no manual spans may include only `Setup:` plus that one file under `Files changed:`.
8. **No descriptions, no counts, no parameter details, no blank lines between siblings, no trailing whitespace.**
9. **One trace function per plan.** A trace plan describes exactly one trace function — exactly one `Trace function: "..."` header, exactly one `[root]`, exactly one tree, exactly one `Files changed:` section. If the cycle would require instrumenting two trace functions, that's two cycles, not one plan with two trees.

#### Which template to use (precedence — check top to bottom, stop at first match)

Pick the **base template** from SDK capability and surrounding work:

1. **Trace processor (hybrid) template** — if the SDK guide says to register a processor (e.g. OpenAI Agents SDK `addTraceProcessor`) AND there is meaningful work above, alongside, or below the SDK call. The trace function root wraps the broader workflow with manual `●` spans; the SDK call appears as one `(agent)` child whose grandchildren are the `[auto]` lines; other manual spans capture work outside the SDK. This is the default for any trace processor SDK whenever there's surrounding workflow logic — which is almost always.
2. **Trace processor (bare) template** — only when the workflow truly is *just* the SDK call with no surrounding work. Children of the root span are auto-captured and shown as `[auto]` lines. Confirm before using this — if the workflow has any input prep, orchestration, retries, post-processing, or non-SDK LLM/tool calls, use the hybrid template instead.
3. **Default view** — every other case (no processor in play). This is the recommended default for SDKs without a processor.

Then apply the **expand modifier**, orthogonally:

- If the user explicitly asks for more detail ("show details", "expand", "include skipped") or selects "Expand details" from the choice prompt preview, add `○` skipped lines to whichever base template was picked. Never drop `[auto]` lines when expanding a processor template — skipped lines and auto-captured lines coexist in the tree. Without an explicit ask, do not add skipped lines.

Never mix base templates beyond the hybrid pattern. Never invent a fifth variant.

#### Canonical examples (copy-edit-substitute, do not restructure)

**Default view** — instrumented spans only:

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

**Default + expand modifier** — adds skipped (○) functions in true execution order. The same modifier applies to processor templates (hybrid or bare) when the user asks for expansion — `○` lines coexist with `[auto]` lines in that case:

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

**Trace-processor (hybrid) view** — workflow with manual spans wrapping auto-captured agent internals (default for processor SDKs):

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

The `[auto]` lines are auto-captured spans — the processor emits them inside the SDK call without manual instrumentation. They use `├─`/`└─` like normal children but carry no `●`/`○` symbol because you're not writing the span yourself. Manual `●` spans wrap the broader workflow above, alongside, and below the SDK call.

**Trace-processor (bare) view** — only when the workflow IS just the SDK call:

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

- ❌ `* outerFunction (function)` — use `●`, never `*` or `-` or `•`
- ❌ `● outerFunction` — type annotation is mandatory on every instrumented span
- ❌ `● outerFunction (function) — calls the LLM with retries` — no descriptions, no em dashes
- ❌ `● outerFunction (llm-call)` — only the listed types are valid; do not invent new ones
- ❌ `[Root]` or `[ROOT]` — literal label is lowercase `[root]`
- ❌ Mixed indentation widths (2 spaces in one branch, 4 in another)
- ❌ Blank lines between siblings inside the tree
- ❌ Omitting `Files changed:` from any plan that has manual `●` spans (hybrid trace-processor plans MUST include both `Setup:` and `Files changed:`)
- ❌ Defaulting to the bare trace-processor view when the workflow has work above, alongside, or below the SDK call — use the hybrid view and add manual spans
- ❌ Putting the SDK's agent call (e.g. `runAgent`, `Runner.run`) at `[root]` when the actual workflow has a clear outer function — the workflow function is the root, the SDK call is a child
- ❌ Inventing extra sections like `Notes:` or `Estimated coverage:`
- ❌ Two `Trace function: "..."` headers in one plan — split into two cycles
- ❌ `● someFn (llm)   ← description here` — no inline descriptions, arrows, or trailing commentary on span lines
- ❌ `● <kind>DocumentCreate (llm)` — no placeholder/template span names; expand to concrete spans (e.g., three siblings, or under a `[branch]`)
- ❌ `Files changed` without the trailing colon
- ❌ `1. lib/bitfab.ts (new) — Bitfab client + exported pipelines` — file entries are paths only, no annotations or descriptions
- ❌ Recommending an approach that requires "a tiny behavior change" — disqualified at trace plan construction; restructure the tree instead

#### Presentation step

After building the plan according to the rules above, ask the user with these three options:
- **Proceed** (recommended) — accept the default view as shown
- **Expand details** — re-render using the expanded view template
- **Adjust** — user wants changes; ask what

### Trace Plan Accuracy

Read function signatures when the trace plan will reference their parameter names or return fields. Skipped leaf functions can be named from grep results if their shape isn't exposed in the plan. Never guess names that appear in the plan.
