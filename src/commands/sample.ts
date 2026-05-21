import { runCheck } from "./check.js";
import { parseHeaders, parseParams } from "./sample-runtime.js";
import { log } from "../util/logger.js";
import { readConfig } from "../lockfile/read.js";
import { resolve } from "node:path";

export interface SampleOptions {
  cwd: string;
  baseUrl?: string;
  headers?: string[];
  params?: string;
  includePost?: boolean;
  dryRun?: boolean;
}

/** Alias for `contrakt check --update`. Kept for backwards compatibility. */
export async function runSample(options: SampleOptions): Promise<void> {
  const cwd = resolve(options.cwd);
  const config = readConfig(cwd);
  const baseUrl = options.baseUrl ?? config?.baseUrl ?? "http://localhost:3000";

  if (options.params || options.headers?.length || options.includePost) {
    log.warn("Custom headers/params are not yet supported via `check --update`. Use `contrakt check --update` for the standard flow.");
  }

  await runCheck({ cwd, baseUrl, update: !options.dryRun });
}
