---
name: update
description: "Update Bitfab plugin and SDK to the latest versions. Invoke with $bitfab:update [plugin|sdk|all]."
---

# Bitfab Update

Update the Bitfab Codex plugin and/or every workspace's SDK in the current project.

| Invocation | What runs |
|---|---|
| `$bitfab:update` or `$bitfab:update all` | Plugin update **and** SDK update per workspace |
| `$bitfab:update plugin` | Plugin update only — skips all SDK steps |
| `$bitfab:update sdk` | SDK update only — skips the plugin check |

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

## 1. Run the update script

Pass the mode argument the user invoked through to the script (omit for the default `all`):

```bash
node "${BITFAB_PLUGIN_DIR}/dist/commands/update.js" <mode>
```

- For `$bitfab:update plugin`, run with `plugin`.
- For `$bitfab:update sdk`, run with `sdk`.
- For `$bitfab:update` or `$bitfab:update all`, run with no argument (or `all`).

The script does up to two things depending on mode:
- **Plugin phase** (`all` or `plugin`) — updates the plugin if a newer version is available.
- **SDK phase** (`all` or `sdk`) — queries the registry for the latest SDK version and prints a `<bitfab-sdk-status>` block with one JSON entry per `(workspace, language)` pair. Falls back to the baked snapshot (sets `remoteCheckFailed: true`) if the registry lookup fails.

## 2. Report the plugin result

**Run only when mode is `all` or `plugin`.**

If the plugin was updated, remind the user to restart Codex to apply the update. If the mode was `plugin`, stop here — do not run steps 3-9.

## 3. Parse the SDK status

**Run only when mode is `all` or `sdk`.**

Each line inside `<bitfab-sdk-status>` is a JSON object with fields:

- `workspacePath` — relative path of the workspace from the repo root (`"."` for non-monorepos or the root package itself)
- `language` — `"typescript" | "python" | "ruby" | "go"`
- `packageName` — the SDK package name (`bitfab`, `bitfab-py`, `bitfab`, `github.com/Project-White-Rabbit/bitfab-go`)
- `declaredVersion` — the range from the workspace's manifest. May be `null` or a loose range.
- `resolvedVersion` — the exact version from the lockfile (workspace's own lockfile, or the monorepo root lockfile used as fallback). This is the truth — what the user is actually running.
- `current` — `resolvedVersion ?? declaredVersion`. Use this for user-facing messages.
- `latest` — the latest published version (from the source indicated by `latestSource`)
- `latestSource` — `"remote"` (fetched live from the registry) or `"baked"` (snapshot from the plugin build)
- `remoteCheckFailed` — `true` when the live registry lookup failed; trigger the agent fallback (step 5)
- `updateAvailable` — `true` only when `latest > current`
- `manifestPath` / `lockfilePath` — absolute paths of the files the info came from

If there are **no lines** inside `<bitfab-sdk-status>`, the programmatic check found no SDK — but don't stop yet, run step 4 first. After that step, distinguish two cases:

- **No SDK anywhere** (no lines AND step 4 found no imports): the project isn't instrumented yet. Tell the user the Bitfab SDK isn't installed and suggest running `$bitfab:setup` to instrument the project. Stop.
- **SDKs present and current** (every entry has `updateAvailable: false` AND step 4 finds no extras): tell the user their SDKs are up to date and stop.

**Note on Codex's seatbelt sandbox:** by default Codex blocks all outbound network (including localhost). If `latestSource` is `"baked"` and `remoteCheckFailed` is `true` for every entry, the registry lookup was likely blocked by the sandbox. Point the user at the [macOS network-access issue](https://github.com/openai/codex/issues/10390) and suggest launching Codex with `--sandbox danger-full-access` to get live registry data. In the meantime step 5's fallback commands give accurate results as long as the user's shell itself has network access.

## 4. Verify with an agent pass (always)

**Run only when mode is `all` or `sdk`.**

The programmatic detection is regex-based and only knows the workspace formats we hand-coded (pnpm/npm/yarn workspaces, uv workspaces, go.work). It can miss unusual monorepo layouts, vendored SDKs, or projects using package managers we don't parse. **Always run this verification** before offering updates.

- Grep the project for SDK imports (run these in parallel):
  - TypeScript: `import .* from ["']bitfab["']` or `require\(["']bitfab["']\)`
  - Python: `^\s*(from|import) bitfab\b`
  - Ruby: `require ['"]bitfab['"]`
  - Go: `"github.com/Project-White-Rabbit/bitfab-go"`
- For each import, find its workspace directory by walking up to the nearest `package.json` / `pyproject.toml` / `Gemfile` / `go.mod`.
- Compare that set against the `workspacePath` values in `<bitfab-sdk-status>`.
- For each workspace that has imports but **no** corresponding status entry, treat it as a missed detection: ask the user which package manager that workspace uses, then go to step 5 for it (same flow as `remoteCheckFailed: true`).
- If the sets match, proceed.

## 5. Agent fallback for `remoteCheckFailed` or detection gaps

**Run only when mode is `all` or `sdk`.**

For each entry where `remoteCheckFailed: true`, or any workspace discovered only in step 4, run the package manager's native outdated command from the workspace directory. The command is authoritative — it respects private registries, mirrors, and offline caches.

| Language | Detection (from workspace/repo) | Command (run from workspace dir) |
|---|---|---|
| typescript | `pnpm-lock.yaml` at repo root → pnpm; `yarn.lock` → yarn; `bun.lock` → bun; otherwise npm | `pnpm outdated bitfab --json` / `npm outdated bitfab --json` / `yarn outdated bitfab` / `bun outdated bitfab` |
| python | `uv.lock` → uv; `poetry.lock` → poetry; otherwise pip | `uv pip list --outdated --format=json` / `poetry show -o bitfab-py` / `pip list --outdated --format=json` |
| ruby | `Gemfile.lock` | `bundle outdated bitfab --parseable` |
| go | `go.mod` | `go list -m -u -json github.com/Project-White-Rabbit/bitfab-go` |

Use the real latest from the command's output in place of `latest` when deciding whether to offer an upgrade.

## 6. Ask whether to batch-update or step through workspaces

**Run only when mode is `all` or `sdk`.**

If there are **3 or more** workspaces with `updateAvailable: true`, ask — **one decision per question**:

> A) **Update all N outdated workspaces** *(recommended)*
> B) **Ask me per workspace**
> C) **Skip everything**

**Always recommend "Update all" (option A).** Do not downgrade the recommendation based on the range specifier or lockfile shape — not for `workspace:*` / `workspace:^`, not for git refs, not for pinned `"=X.Y.Z"`, not for path deps. An outdated SDK is an outdated SDK. If the user is working inside a monorepo where the dep is workspace-linked to a sibling SDK package, they are free to pick **Skip** themselves, but the recommended action is still **Update**.

If there are **fewer than 3** outdated workspaces, skip this prompt and go straight to per-workspace.

## 7. Ask per workspace whether to update

**Run only when mode is `all` or `sdk`.**

For the next workspace with `updateAvailable: true`, ask — **one decision per question**:

> We recommend **Update**: `<workspacePath>` — `<language>` SDK `<current>` → `<latest>`.
>
> A) **Update** — run the package manager update command now *(recommended)*
> B) **Skip** — leave this workspace on `<current>`

When no outdated workspaces remain, exit and acknowledge.

## 8. Run the update for the chosen workspace

**Run only when mode is `all` or `sdk`.**

Detect the package manager from the lockfiles and run the update **from the workspace directory** (not repo root — matters in monorepos):

| Language | Command |
|---|---|
| typescript | `pnpm update bitfab@latest` / `yarn upgrade bitfab@latest` / `bun update bitfab` / `npm install bitfab@latest` |
| python | `uv add bitfab-py@latest` / `poetry add bitfab-py@latest` / `pip install -U bitfab-py` (and bump the pin in `requirements.txt` via Edit) |
| ruby | `bundle update bitfab` |
| go | `go get github.com/Project-White-Rabbit/bitfab-go@latest && go mod tidy` |

After the update, Read the manifest to verify the new version and confirm to the user, then return to the per-workspace prompt for the next workspace.

## 9. Run updates for every outdated workspace

**Run only when mode is `all` or `sdk`.**

For every workspace with `updateAvailable: true`, detect the package manager from the lockfiles and run the update **from each workspace directory** (not repo root):

| Language | Command |
|---|---|
| typescript | `pnpm update bitfab@latest` / `yarn upgrade bitfab@latest` / `bun update bitfab` / `npm install bitfab@latest` |
| python | `uv add bitfab-py@latest` / `poetry add bitfab-py@latest` / `pip install -U bitfab-py` (and bump the pin in `requirements.txt` via Edit) |
| ruby | `bundle update bitfab` |
| go | `go get github.com/Project-White-Rabbit/bitfab-go@latest && go mod tidy` |

After each update, Read the manifest to verify the new version and confirm to the user.
