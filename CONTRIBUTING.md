# Contributing to Contrakt

Thanks for your interest in contributing. This doc covers how to get set up, run tests, and submit changes.

## Setup

```bash
git clone https://github.com/shouryasrivastava/contrakt
cd contrakt
pnpm install
```

## Development

Run the CLI directly without building:

```bash
pnpm dev init --cwd /path/to/nextjs-app
pnpm dev check
```

Build compiled output:

```bash
pnpm build
```

## Tests

```bash
pnpm test          # run all tests once
pnpm test:watch    # re-run on file changes
```

Tests are integration tests in `tests/integration/`. They spin up temp directories, run the CLI against fixture apps in `tests/fixtures/`, and assert on the output. There are no unit tests — if you add a feature, add an integration test that exercises it end to end.

## Project structure

```
bin/contrakt.ts          CLI entry point (commander)
src/
  commands/              One file per CLI command (init, check, diff, mcp, sample)
  inference/             ts-morph AST inference (request, response, types)
  diff/                  Schema diffing and change classification
  scanners/              File discovery for App Router and Pages Router
  lockfile/              Read/write contrakt.lock and contrakt.config.json
  mcp/                   MCP server stub generation
  util/                  Logger, fs helpers
tests/
  fixtures/              Minimal Next.js-like apps used by integration tests
  integration/           Integration tests (Vitest)
```

## Adding support for a new framework

1. Add a scanner in `src/scanners/` that finds route files and derives URL paths
2. Add an inferrer in `src/inference/` that extracts request/response schemas from those files
3. Update `src/scanners/detect.ts` to detect the new stack
4. Update `src/commands/init.ts` (`scanAndInfer`) to dispatch to the new inferrer
5. Add a fixture app in `tests/fixtures/` and integration tests in `tests/integration/`

## Submitting changes

1. Fork the repo and create a branch from `main`
2. Make your changes and add tests
3. Run `pnpm test` — all tests must pass
4. Run `pnpm build` — must compile without errors
5. Open a pull request with a clear description of what changed and why

## Reporting bugs

Open an issue with:
- The command you ran
- The output you got
- What you expected instead
- A minimal reproduction if possible (a small route file that triggers the issue)
