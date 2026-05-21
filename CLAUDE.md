# Contrakt — Project Memory

Read this first at the start of every session. It captures the product intent, technical decisions, and current state so you can pick up without re-deriving context.

---

## Product context

**Problem:** Vibe-coded apps (built with Cursor, Lovable, Bolt, Replit) ship fast but AI assistants silently change API shapes between sessions, breaking consumers. These apps have no machine-readable contracts, so AI agents can't reliably call them via MCP.

**What Contrakt does:**
1. **Infer** — Scans Next.js App Router route files, uses ts-morph to read actual handler code, produces JSON Schema contracts without any hand-written spec
2. **Track** — Stores contracts in `contrakt.lock`; diffs on re-run, classifies changes as breaking / non-breaking / additive
3. **Expose** — Generates an MCP server stub and `mcp.json` so any MCP-compatible client can call the app's endpoints as tools

**Target user v1:** Indie developer who shipped a Next.js app with an AI assistant and wants drift detection + MCP integration in < 2 minutes.

---

## Tech stack

- **Language:** TypeScript, Node 20+, ESM (`"type": "module"`)
- **Package manager:** pnpm
- **CLI framework:** `commander` v12
- **AST parsing:** `ts-morph` v23 (wraps TypeScript compiler API)
- **Schema:** JSON Schema Draft 2020-12
- **MCP:** `@modelcontextprotocol/sdk` v1 (generated stub only — CLI does not run MCP)
- **CLI output:** `picocolors` (not chalk)
- **Tests:** Vitest v2, integration tests only (no unit tests yet)
- **Entry point:** `bin/contrakt.ts` via `tsx`

---

## Architecture

```
bin/contrakt.ts              CLI entry, registers commander commands
src/
  commands/init.ts             scan → infer → write lockfile + MCP artifacts
  commands/check.ts            scan → infer → diff → report + exit code; runWatch() watches app/api/ with 150ms debounce
  commands/mcp.ts              read lockfile → generate MCP artifacts
  commands/diff.ts             git show <ref>:contrakt.lock → re-scan HEAD → diff → report
  scanners/nextjs.ts           glob app/api/**/route.{ts,js}, derive URL paths, regex-scan for exports
  inference/
    types.ts                   Contract, Endpoint, JSONSchema, DiffResult, DiffReport, SchemaConfig
    infer-endpoint.ts          orchestrates per-(file, method) inference; manages shared ts-morph Project
    infer-request.ts           req.json() → requestSchema; searchParams → querySchema; path → pathParams
    infer-response.ts          NextResponse.json() → responseSchema + statusCodes
  diff/
    classify-change.ts         classifySchemaChanges(old, new, side) → DiffResult[]
    diff-contract.ts           diff(oldContract, newContract) → DiffReport
  mcp/
    generate-config.ts         Contract → mcp.json + contrakt-mcp-server.ts (string template)
  lockfile/
    read.ts                    readLockfile, readConfig, writeConfig (contrakt.config.json)
    write.ts                   writeLockfile (contrakt.lock)
  util/
    logger.ts                  picocolors-based log.info/success/warn/error/breaking/nonBreaking/additive
    fs.ts                      findFiles, readJson, writeJson, exists
  version.ts                   VERSION constant (keep in sync with package.json)
tests/
  fixtures/sample-nextjs-app/  Minimal Next.js-like app with type stubs (no Next.js dep needed)
  integration/
    init.test.ts
    check.test.ts
    mcp.test.ts
```

---

## Key design decisions

**Why we roll our own diff instead of json-schema-diff-validator:**
The library reports structural differences but doesn't know contract semantics — e.g., adding a required field to a *request* body is breaking for callers, but not for a *response* consumer. Our `classify-change.ts` encodes this explicitly with a `side: "request" | "response"` parameter.

**Why baseUrl is NOT in contrakt.lock:**
The lockfile describes the contract (what the app does), not deployment (where it runs). Mixing them creates noisy diffs when colleagues run `init` on different machines. Instead: `contrakt.config.json` holds env-specific config; the generated MCP server reads `process.env.CONTRAKT_BASE_URL` with the config value as fallback.

**Three-layer base URL override:**
`CONTRAKT_BASE_URL` env var > `--base-url` flag > `contrakt.config.json` > `"http://localhost:3000"`

**Inference is conservative:**
When a type can't be resolved, emit `{ "type": "unknown", "x-contrakt-note": "..." }` rather than guessing. Bad inferences are worse than missing ones.

**Shared ts-morph Project per command run:**
`infer-endpoint.ts` maintains a module-level `Project` instance and re-uses it across all files in a single scan. Call `resetProject()` between test runs to avoid stale state.

---

## Inference rules (Next.js App Router)

1. **Path**: `app/api/users/[id]/route.ts` → `/api/users/[id]`
2. **Methods**: Exported functions/consts named GET, POST, PUT, PATCH, DELETE
3. **Path params**: `[id]` → `{ type: "string" }`, `[...slug]` → `{ type: "array", items: { type: "string" } }`
4. **Request body**: Walk up from `await req.json()` through any parentheses, check for `AsExpression` (type cast) or type annotation on the variable declaration. Also handles object destructuring.
5. **Query params**: Find `searchParams.get("key")` call expressions, collect unique keys.
6. **Response**: Find `NextResponse.json(payload, { status: N })` and `Response.json(...)` calls. Infer payload from object literal (recursive) or type. Handles both `PropertyAssignment` (`{ key: value }`) and `ShorthandPropertyAssignment` (`{ user }` — resolved through the referenced variable's type via `prop.getType()`). Multiple calls → `oneOf`.
7. **Status codes**: Collected from every `NextResponse.json` call. Default 200 if none.
8. **Description**: First sentence of the handler's leading JSDoc comment.

---

## Diff classification

| Change | Classification |
|---|---|
| Removed endpoint | **breaking** |
| Removed field | **breaking** |
| Changed field type (concrete → concrete) | **breaking** |
| `unknown` → concrete type | non-breaking (learned more) |
| concrete → `unknown` | **breaking** (lost info) |
| Added required field to request body | **breaking** |
| Added optional field | non-breaking |
| Added new endpoint | non-breaking |
| Removed status code | **breaking** |
| Added status code | non-breaking |
| Description change | additive |
| optional → required in request | **breaking** |
| required → optional in request | non-breaking |

---

## What's working (v0.1.0)

- ✅ `contrakt init` — scans Next.js App Router, infers contract, writes `contrakt.lock` + `contrakt.config.json` + MCP artifacts
- ✅ `contrakt check` — diffs against lockfile, reports all three buckets, exits 1 on breaking
- ✅ `contrakt check --watch` — watches `app/api/` for changes, re-runs check with 150ms debounce, clears screen on each run
- ✅ `contrakt mcp` — reads lockfile, regenerates MCP artifacts with optional base URL override
- ✅ `contrakt diff <ref>` — diffs live codebase scan against `contrakt.lock` at any git ref (branch, tag, SHA); exits 1 on breaking
- ✅ Type inference: object literals, shorthand property assignments (e.g. `{ user }`), `as TypeName` casts on `req.json()`, searchParams, path params
- ✅ Shorthand props fully resolved through ts-morph — `{ user }` where `user: User` now emits the full `User` schema with all fields and required constraints
- ✅ Wrapper pattern detection — `export const GET = withAuth(handler)` emits a visible warning with instructions, not a silent empty schema
- ✅ MCP server stub: one tool per endpoint, correct inputSchema, CONTRAKT_BASE_URL env var
- ✅ 18/18 integration tests passing

## What's stubbed / limited (next session work)

- ⚠️ Complex generics, conditional types, mapped types → fall through to `unknown` (acceptable for v1)
- ⚠️ Wrapper unwrapping (`withAuth(handler)`) — detected and warned, but handler body not inferred. Next step: try to follow the first argument as the handler if it's a function reference in the same file
- ⚠️ No support for Express, FastAPI, Flask (next after Next.js coverage is solid)
- ⚠️ No OpenAPI export (planned — JSON Schema is sufficient for v1)
- ⚠️ No CI integration docs (planned)
- ⚠️ No npm publish setup yet (add `prepublishOnly` script + `files` field to package.json)

## Strict scope (do NOT add without explicit instruction)

- No web UI
- No auth
- No cloud sync / hosted registry
- No stacks other than Next.js App Router
- No OpenAPI generation (yet)
- No onchain / x402 layer
- No telemetry

---

## Running locally

```bash
pnpm install
pnpm test                        # run all integration tests
pnpm link --global               # make `contrakt` available globally
contrakt init --cwd /path/to/nextjs-app
```
