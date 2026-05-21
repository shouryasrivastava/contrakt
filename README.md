# Contrakt

Auto-infer API contracts from vibe-coded apps, detect schema drift, and generate MCP server configs so AI agents can call your endpoints.

## The problem

You ship a Next.js app with Cursor or Lovable. Two sessions later, an AI assistant silently changes a response shape. Your consumers break. You had no contract to catch it.

Contrakt scans your actual handler code, infers the contract, and tells you exactly what changed — without a single line of hand-written spec.

## Install

```bash
npm install -g contrakt
```

## Quickstart

```bash
cd my-nextjs-app

# 1. Infer contract + generate MCP config (run once)
contrakt init

# 2. Check for drift anytime — static analysis + live sampling if server is running
contrakt check

# 3. Intentionally changed the API? Accept it as the new baseline
contrakt check --update
```

That's the whole workflow. Commit `contrakt.lock` to your repo. Run `contrakt check` in CI.

## Commands

### `contrakt init`

Scans your Next.js API routes, infers request/response schemas, writes `contrakt.lock`, and generates an MCP server stub.

```
Options:
  --cwd <path>        Project directory (default: current directory)
  --base-url <url>    Base URL of your running app (default: http://localhost:3000)
  --force             Overwrite existing contrakt.lock without prompting
  --no-mcp            Skip MCP config generation
  --verbose           Debug logging
```

**Outputs:**
- `contrakt.lock` — versioned contract file (commit this)
- `contrakt.config.json` — deployment config (gitignore if you vary by environment)
- `mcp.json` — Claude Desktop / MCP client config snippet
- `contrakt-mcp-server.ts` — runnable MCP server stub

### `contrakt check`

The main command. Re-scans your code for static drift, and if your dev server is running, also samples live endpoints to catch runtime schema changes.

```
Options:
  --cwd <path>        Project directory
  --update            Accept current state as new baseline and update contrakt.lock
  --base-url <url>    Override base URL for live sampling
  --watch             Watch for file changes and re-check continuously
  --verbose           Debug logging

Exit codes:
  0   No breaking changes
  1   Breaking changes detected (CI-friendly)
```

**Change categories:**
- 🔴 **Breaking** — removed endpoint, removed field, changed field type, added required request field
- 🟡 **Non-breaking** — added endpoint, added optional field, new status code
- 🟢 **Additive** — description updates, JSDoc changes

**Example output (server running):**

```
Contrakt — check

Scanning /my-app
  GET /api/config

✓  No code changes.

Sampling live endpoints against http://localhost:3000
  ↓ GET /api/config 200 -1 field(s): showArchive

Breaking changes (1):
  ✗ Field "response.showArchive" was removed [GET /api/config]

Run 'contrakt check --update' to accept these changes as your new baseline.
```

### `contrakt diff <ref>`

Diff the current codebase against `contrakt.lock` at any git ref.

```bash
contrakt diff main          # vs main branch
contrakt diff HEAD~1        # vs last commit
contrakt diff v1.2.0        # vs a tag
```

```
Options:
  --cwd <path>    Project directory
  --verbose       Debug logging

Exit codes:
  0   No breaking changes vs ref
  1   Breaking changes detected
```

### `contrakt mcp`

Generates (or regenerates) the MCP server artifacts from `contrakt.lock`.

```
Options:
  --cwd <path>        Project directory
  --base-url <url>    Override base URL for this generation only
  --output <path>     Directory to write artifacts (default: project root)
  --verbose           Debug logging
```

## CI usage

```yaml
# .github/workflows/api-check.yml
- name: Check API drift
  run: contrakt check
```

`contrakt check` exits 1 on breaking changes. It only does static analysis in CI (no running server), which is fine — `contrakt.lock` is the agreed baseline, committed by a developer after running `contrakt check --update` locally.

## Base URL resolution

Three layers, highest priority first:

1. `CONTRAKT_BASE_URL` env var (runtime override in the generated MCP server)
2. `--base-url` flag (overrides config for this run only)
3. `contrakt.config.json` → `baseUrl` (written by `init`)
4. Default: `http://localhost:3000`

## Files

| File | Commit? | Purpose |
|---|---|---|
| `contrakt.lock` | ✅ Yes | Contract definition — diffed on every `check` |
| `contrakt.config.json` | Optional | Deployment config (baseUrl) |
| `mcp.json` | Optional | Claude Desktop config snippet |
| `contrakt-mcp-server.ts` | Optional | Runnable MCP server — regenerate with `mcp` |

## Using the MCP server

```bash
# Start your Next.js app
pnpm dev

# In another terminal, start the MCP server
tsx contrakt-mcp-server.ts

# Override base URL at runtime
CONTRAKT_BASE_URL=https://staging.myapp.com tsx contrakt-mcp-server.ts
```

Add to Claude Desktop's `claude_desktop_config.json`:
```json
// contents of mcp.json
```

## What gets inferred

For each route file:

- **Path** — derived from file location (`app/api/users/[id]/route.ts` → `/api/users/[id]`)
- **Methods** — exported `GET`, `POST`, `PUT`, `PATCH`, `DELETE` functions
- **Path params** — `[id]`, `[...slug]` segments
- **Query params** — `searchParams.get("key")` calls
- **Request body** — `(await req.json()) as MyType` → follows the type definition
- **Response** — `NextResponse.json({ ... })` → infers from object literal or type
- **Status codes** — collected from every `NextResponse.json` call
- **Description** — first sentence of the handler's JSDoc comment

Anything that can't be confidently inferred is marked `{ "type": "unknown" }` rather than guessed. Run `contrakt check` with your dev server running to fill in those gaps from live responses.

## Supported stacks

- ✅ Next.js App Router (`app/api/**/route.ts`)
- ✅ Next.js Pages Router (`pages/api/**/*.ts`)
- 🔜 Express
- 🔜 FastAPI

## Local development

```bash
git clone https://github.com/your-org/contrakt
cd contrakt
pnpm install
pnpm build            # compile to dist/
pnpm link --global    # make contrakt available globally
pnpm test             # run integration tests
```

## License

MIT
