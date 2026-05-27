#!/usr/bin/env tsx
import { Command } from "commander";
import { VERSION } from "../src/version.js";
import { setVerbose } from "../src/util/logger.js";
import { runInit } from "../src/commands/init.js";
import { runCheck, runWatch } from "../src/commands/check.js";
import { runMcp } from "../src/commands/mcp.js";
import { runDiff } from "../src/commands/diff.js";
import { runSample } from "../src/commands/sample.js";
import { runPublish } from "../src/commands/publish.js";

const program = new Command();

program
  .name("contrakt")
  .description("Auto-infer API contracts, detect schema drift, generate MCP configs")
  .version(VERSION);

program
  .command("init")
  .description("Scan repo, infer contract, write contrakt.lock and generate MCP config")
  .option("--cwd <path>", "project directory", process.cwd())
  .option("--base-url <url>", "base URL of the running app (default: http://localhost:3000)")
  .option("--force", "overwrite existing contrakt.lock without prompting")
  .option("--no-mcp", "skip MCP config generation")
  .option("--verbose", "enable debug logging")
  .action(async (opts) => {
    if (opts.verbose) setVerbose(true);
    await runInit({ cwd: opts.cwd, baseUrl: opts.baseUrl, force: opts.force, mcp: opts.mcp });
  });

program
  .command("check")
  .description("Check for drift: scans code + samples live endpoints if server is running")
  .option("--cwd <path>", "project directory", process.cwd())
  .option("--update", "accept current state as new baseline and update contrakt.lock")
  .option("--base-url <url>", "override base URL for live sampling")
  .option("--watch", "watch for file changes and re-check continuously")
  .option("--verbose", "enable debug logging")
  .action(async (opts) => {
    if (opts.verbose) setVerbose(true);
    if (opts.watch) {
      await runWatch({ cwd: opts.cwd });
    } else {
      await runCheck({ cwd: opts.cwd, update: opts.update, baseUrl: opts.baseUrl });
    }
  });

program
  .command("mcp")
  .description("Generate MCP server config and stub from contrakt.lock")
  .option("--cwd <path>", "project directory", process.cwd())
  .option("--base-url <url>", "override base URL for this generation only")
  .option("--output <path>", "directory to write artifacts (default: project root)")
  .option("--verbose", "enable debug logging")
  .action(async (opts) => {
    if (opts.verbose) setVerbose(true);
    await runMcp({ cwd: opts.cwd, baseUrl: opts.baseUrl, output: opts.output });
  });

program
  .command("diff <ref>")
  .description("Diff current codebase against contrakt.lock at a git ref (e.g. main, HEAD~1, abc123)")
  .option("--cwd <path>", "project directory", process.cwd())
  .option("--verbose", "enable debug logging")
  .action(async (ref: string, opts) => {
    if (opts.verbose) setVerbose(true);
    await runDiff({ cwd: opts.cwd, ref });
  });

program
  .command("sample")
  .description("Alias for 'contrakt check --update' (backwards compatibility)")
  .option("--cwd <path>", "project directory", process.cwd())
  .option("--base-url <url>", "override base URL")
  .option("--dry-run", "show what would change without writing contrakt.lock")
  .option("--verbose", "enable debug logging")
  .action(async (opts) => {
    if (opts.verbose) setVerbose(true);
    await runSample({ cwd: opts.cwd, baseUrl: opts.baseUrl, dryRun: opts.dryRun });
  });

program
  .command("publish")
  .description("Publish contrakt.lock to the public registry so AI agents can discover your API")
  .option("--cwd <path>", "project directory", process.cwd())
  .option("--name <name>", "project name on the registry (default: directory name)")
  .option("--token <token>", "API token from contrakt-registry.vercel.app/dashboard (or set CONTRAKT_TOKEN env var)")
  .option("--registry <url>", "registry URL override")
  .option("--verbose", "enable debug logging")
  .action(async (opts) => {
    if (opts.verbose) setVerbose(true);
    await runPublish({ cwd: opts.cwd, name: opts.name, token: opts.token, registry: opts.registry });
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
