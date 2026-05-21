import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import pc from "picocolors";
import { VERSION } from "../version.js";
import { log } from "../util/logger.js";
import { detectRouter } from "../scanners/detect.js";
import { diffContracts } from "../diff/diff-contract.js";
import { scanAndInfer } from "./init.js";
import type { Contract, DiffReport } from "../inference/types.js";

export interface DiffOptions {
  cwd: string;
  ref: string;
}

export async function runDiff(options: DiffOptions): Promise<void> {
  const cwd = resolve(options.cwd);
  const { ref } = options;

  log.blank();
  log.header(`Contrakt — diff vs ${ref}`);
  log.blank();

  // Fetch contrakt.lock at the given git ref
  const oldContract = readLockAtRef(cwd, ref);
  if (!oldContract) {
    log.error(`Could not read contrakt.lock at git ref "${ref}".`);
    log.dim(`Make sure "${ref}" exists and contrakt.lock was committed at that ref.`);
    log.dim(`Tip: run 'contrakt init' and commit contrakt.lock first.`);
    process.exit(1);
  }

  log.info(`Loaded contract from ${ref} (${oldContract.endpoints.length} endpoint(s))`);
  log.info(`Scanning current working tree...`);

  const router = detectRouter(cwd);
  const endpoints = await scanAndInfer(cwd, router === "none" ? "app" : router);

  const newContract: Contract = {
    schemaSyncVersion: VERSION,
    generatedAt: new Date().toISOString(),
    projectRoot: cwd,
    stack: oldContract.stack,
    endpoints,
  };

  log.blank();
  log.dim(`Comparing ${ref} (${oldContract.endpoints.length} endpoints) → HEAD (${newContract.endpoints.length} endpoints)`);

  const report = diffContracts(oldContract, newContract);
  printDiffReport(report, ref);

  const total = report.breaking.length + report.nonBreaking.length + report.additive.length;
  if (total === 0) {
    log.success(`No API changes relative to ${ref}.`);
  }

  log.blank();

  if (report.breaking.length > 0) {
    process.exit(1);
  }
}

function readLockAtRef(cwd: string, ref: string): Contract | null {
  const result = spawnSync("git", ["show", `${ref}:contrakt.lock`], {
    cwd,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    log.debug(`git show failed: ${result.stderr?.trim()}`);
    return null;
  }

  try {
    return JSON.parse(result.stdout) as Contract;
  } catch {
    log.debug(`contrakt.lock at ${ref} is not valid JSON`);
    return null;
  }
}

function printDiffReport(report: DiffReport, ref: string): void {
  if (report.breaking.length > 0) {
    log.blank();
    console.log(pc.bold(pc.red(`Breaking changes vs ${ref} (${report.breaking.length}):`)));
    for (const change of report.breaking) {
      const location = change.path ? pc.dim(` [${change.method} ${change.path}]`) : "";
      log.breaking(`${change.message}${location}`);
    }
  }

  if (report.nonBreaking.length > 0) {
    log.blank();
    console.log(pc.bold(pc.yellow(`Non-breaking changes vs ${ref} (${report.nonBreaking.length}):`)));
    for (const change of report.nonBreaking) {
      const location = change.path ? pc.dim(` [${change.method} ${change.path}]`) : "";
      log.nonBreaking(`${change.message}${location}`);
    }
  }

  if (report.additive.length > 0) {
    log.blank();
    console.log(pc.bold(pc.green(`Additive changes vs ${ref} (${report.additive.length}):`)));
    for (const change of report.additive) {
      const location = change.path ? pc.dim(` [${change.method} ${change.path}]`) : "";
      log.additive(`${change.message}${location}`);
    }
  }
}
