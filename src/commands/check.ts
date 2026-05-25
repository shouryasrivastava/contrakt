import { resolve, join } from "node:path";
import { watch } from "node:fs";
import pc from "picocolors";
import { VERSION } from "../version.js";
import { log } from "../util/logger.js";
import { detectRouter } from "../scanners/detect.js";
import { readLockfile, readConfig } from "../lockfile/read.js";
import { writeLockfile } from "../lockfile/write.js";
import { diffContracts } from "../diff/diff-contract.js";
import { scanAndInfer } from "./init.js";
import {
  checkReachable,
  sampleEndpoints,
  applyResults,
  printSampleResults,
} from "./sample-runtime.js";
import { explainBreaking } from "./explain.js";
import type { Contract, DiffReport, JSONSchema } from "../inference/types.js";

export interface CheckOptions {
  cwd: string;
  watch?: boolean;
  update?: boolean;
  baseUrl?: string;
}

export async function runCheck(options: CheckOptions): Promise<void> {
  const cwd = resolve(options.cwd);

  log.blank();
  log.header("Contrakt — check");
  log.blank();

  const oldContract = readLockfile(cwd);
  const config = readConfig(cwd);
  const baseUrl = options.baseUrl ?? config?.baseUrl ?? "http://localhost:3000";

  log.info(`Scanning ${cwd}`);
  const router = detectRouter(cwd);
  const scanned = await scanAndInfer(cwd, router === "none" ? "app" : router);

  // For sampled endpoints where static analysis returns unknown, carry the
  // lockfile schema forward. Static inference gaps are not API changes.
  const oldByKey = new Map(oldContract.endpoints.map((e) => [`${e.method}:${e.path}`, e]));
  const endpoints = scanned.map((ep) => {
    const old = oldByKey.get(`${ep.method}:${ep.path}`);
    if (!old) return ep;
    if (isUnknown(ep.responseSchema) && !isUnknown(old.responseSchema)) {
      return { ...ep, responseSchema: old.responseSchema };
    }
    return ep;
  });

  const staticContract: Contract = {
    schemaSyncVersion: VERSION,
    generatedAt: new Date().toISOString(),
    projectRoot: cwd,
    stack: oldContract.stack,
    endpoints,
  };

  const staticReport = diffContracts(oldContract, staticContract);
  const staticTotal = staticReport.breaking.length + staticReport.nonBreaking.length + staticReport.additive.length;

  if (staticTotal === 0) {
    log.success("No code changes.");
  } else {
    printReport(staticReport);
  }

  // Runtime check — sample dynamic endpoints against the live server
  const sampledEndpoints = oldContract.endpoints.filter((ep) => hasSampledSchema(ep.responseSchema));

  let runtimeBreaking = 0;
  let updatedContract = staticContract;

  if (sampledEndpoints.length > 0) {
    log.blank();
    const reachable = await checkReachable(baseUrl);

    if (!reachable) {
      log.dim(`Start your dev server to also check runtime responses (${baseUrl}).`);
    } else {
      log.info(`Sampling live endpoints against ${baseUrl}`);
      const results = await sampleEndpoints(sampledEndpoints, { baseUrl });
      printSampleResults(results);

      const mergedEndpoints = applyResults(oldContract.endpoints, results);
      const runtimeContract: Contract = {
        ...oldContract,
        generatedAt: new Date().toISOString(),
        endpoints: mergedEndpoints,
      };

      const runtimeReport = diffContracts(oldContract, runtimeContract);
      runtimeBreaking = runtimeReport.breaking.length;
      const runtimeTotal = runtimeReport.breaking.length + runtimeReport.nonBreaking.length + runtimeReport.additive.length;

      if (runtimeTotal > 0) {
        log.blank();
        printReport(runtimeReport);
      } else {
        log.blank();
        log.success("No runtime changes.");
      }

      if (options.update) {
        // Merge runtime-learned schemas onto the static contract
        const finalEndpoints = staticContract.endpoints.map((ep) => {
          const runtime = mergedEndpoints.find((r) => r.method === ep.method && r.path === ep.path);
          return runtime ?? ep;
        });
        updatedContract = { ...staticContract, endpoints: finalEndpoints };
        writeLockfile(cwd, updatedContract);
        log.blank();
        log.success("Updated contrakt.lock — commit it to record this as your new baseline.");
      } else if (runtimeTotal > 0) {
        log.dim(`Run 'contrakt check --update' to accept these changes as your new baseline.`);
      }
    }
  }

  // AI impact analysis — runs if ANTHROPIC_API_KEY is set and there are breaking changes
  const allBreaking = [
    ...staticReport.breaking,
    ...(runtimeBreaking > 0 ? [] : []), // runtimeReport.breaking captured above
  ];
  await explainBreaking(cwd, staticReport.breaking);

  log.blank();

  const hasBreaking = staticReport.breaking.length > 0 || runtimeBreaking > 0;
  if (!options.watch && hasBreaking) {
    process.exit(1);
  }
}

export async function runWatch(options: { cwd: string }): Promise<void> {
  const cwd = resolve(options.cwd);
  const apiDir = join(cwd, "app", "api");

  log.blank();
  log.header("Contrakt — watch");
  log.info(`Watching ${apiDir} for changes...`);
  log.dim("Press Ctrl+C to stop.");
  log.blank();

  await runCheck({ cwd, watch: true });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  watch(apiDir, { recursive: true }, (event, filename) => {
    if (!filename) return;
    if (!/route\.(ts|js)$/.test(filename)) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      console.clear();
      log.dim(`[${new Date().toLocaleTimeString()}] Change detected in ${filename}`);
      await runCheck({ cwd, watch: true });
    }, 150);
  });

  await new Promise<void>(() => {});
}

function isUnknown(schema: JSONSchema | undefined): boolean {
  return !schema || schema["type"] === "unknown";
}

function hasSampledSchema(schema: JSONSchema | undefined): boolean {
  return !!schema && schema["x-contrakt-source"] === "sampled";
}

function printReport(report: DiffReport): void {
  if (report.breaking.length > 0) {
    log.blank();
    console.log(pc.bold(pc.red(`Breaking changes (${report.breaking.length}):`)));
    for (const change of report.breaking) {
      const location = change.path ? pc.dim(` [${change.method} ${change.path}]`) : "";
      log.breaking(`${change.message}${location}`);
    }
  }

  if (report.nonBreaking.length > 0) {
    log.blank();
    console.log(pc.bold(pc.yellow(`Non-breaking changes (${report.nonBreaking.length}):`)));
    for (const change of report.nonBreaking) {
      const location = change.path ? pc.dim(` [${change.method} ${change.path}]`) : "";
      log.nonBreaking(`${change.message}${location}`);
    }
  }

  if (report.additive.length > 0) {
    log.blank();
    console.log(pc.bold(pc.green(`Additive changes (${report.additive.length}):`)));
    for (const change of report.additive) {
      const location = change.path ? pc.dim(` [${change.method} ${change.path}]`) : "";
      log.additive(`${change.message}${location}`);
    }
  }
}
