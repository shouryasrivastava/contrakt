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

# 4. Publish your contract to the public registry
contrakt publish --name my-app
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
- `contrakt.config.json` — local config (baseUrl, registry info)
- `.contrakt/mcp.json` — Claude Desktop / MCP client config snippet
- `.contrakt/contrakt-mcp-server.ts` — runnable MCP server stub

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

If `ANTHROPIC_API_KEY` is set in your environment, Contrakt will also run an AI impact analysis after detecting breaking changes — it scans your codebase for consumers of the changed fields and explains what will break and how to fix it.

### `contrakt publish`

Publish your `contrakt.lock` to the [public registry](https://contrakt-registry.vercel.app) so AI agents and other developers can discover your API.

```
Options:
  --cwd <path>        Project directory
  --name <name>       Project name on the registry (default: directory name)
  --token <token>     API token (or set CONTRAKT_TOKEN env var)
  --registry <url>    Registry URL override
  --verbose           Debug logging
```

**How to get a token:**
1. Go to [contrakt-registry.vercel.app](https://contrakt-registry.vercel.app)
2. Sign in with GitHub
3. Go to **Dashboard** → **Create Token**
4. Set `export CONTRAKT_TOKEN=<token>` in your shell (or pass `--token`)

```bash
export CONTRAKT_TOKEN=your-token
contrakt publish --name my-app
# ✓  Published → https://contrakt-registry.vercel.app/c/username/my-app
```

Run `contrakt publish` again after `contrakt check --update` to keep the registry in sync.

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
  --output <path>     Directory to write artifacts (default: .contrakt/)
  --verbose           Debug logging
```

## CI usage

```yaml
# .github/workflows/api-check.yml
- name: Check API drift
  run: contrakt check
```

`contrakt check` exits 1 on breaking changes. It only does static analysis in CI (no running server), which is fine — `contrakt.lock` is the agreed baseline, committed by a developer after running `contrakt check --update` locally.

## AI impact analysis

Set `ANTHROPIC_API_KEY` to get automatic impact analysis after breaking changes are detected:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
contrakt check
```

Contrakt will grep your codebase for consumers of the changed fields and call Claude to explain what will break and suggest how to fix it — inline, right after the diff output.

## Base URL resolution

Priority order (highest first):

1. `CONTRAKT_BASE_URL` env var
2. `--base-url` flag
3. `contrakt.config.json` → `baseUrl`
4. Default: `http://localhost:3000`

## Files

| File | Commit? | Purpose |
|---|---|---|
| `contrakt.lock` | ✅ Yes | Contract definition — diffed on every `check` |
| `contrakt.config.json` | Optional | Local config (baseUrl, registry URL) — gitignore if env-specific |
| `.contrakt/mcp.json` | Optional | Claude Desktop config snippet |
| `.contrakt/contrakt-mcp-server.ts` | Optional | Runnable MCP server — regenerate with `contrakt mcp` |

## Using the MCP server

```bash
# Start your Next.js app
pnpm dev

# In another terminal, start the MCP server
tsx .contrakt/contrakt-mcp-server.ts

# Override base URL at runtime
CONTRAKT_BASE_URL=https://staging.myapp.com tsx .contrakt/contrakt-mcp-server.ts
```

Add to Claude Desktop's `claude_desktop_config.json`:
```json
// paste the contents of .contrakt/mcp.json here
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

## Registry

Contracts published with `contrakt publish` are browsable at **[contrakt-registry.vercel.app](https://contrakt-registry.vercel.app)**.

The registry source is open at [github.com/shouryasrivastava/contrakt-registry](https://github.com/shouryasrivastava/contrakt-registry).

## Local development

```bash
git clone https://github.com/shouryasrivastava/contrakt
cd contrakt
pnpm install
pnpm build            # compile to dist/
pnpm link --global    # make contrakt available globally
pnpm test             # run integration tests (26 tests)
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to add framework support and submit PRs.

## License

MIT
