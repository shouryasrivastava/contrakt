import { resolve } from "node:path";
import { log } from "../util/logger.js";
import { readLockfile } from "../lockfile/read.js";
import { readConfig, writeConfig } from "../lockfile/read.js";

export interface PublishOptions {
  cwd: string;
  name?: string;
  registry?: string;
}

const DEFAULT_REGISTRY = "https://registry.contrakt.dev";

export async function runPublish(options: PublishOptions): Promise<void> {
  const cwd = resolve(options.cwd);
  const registry = options.registry ?? DEFAULT_REGISTRY;

  log.blank();
  log.header("Contrakt — publish");
  log.blank();

  const contract = readLockfile(cwd);
  const config = readConfig(cwd);

  const name =
    options.name ??
    config?.name ??
    cwd.split("/").at(-1) ??
    "my-app";

  log.info(`Publishing ${contract.endpoints.length} endpoint(s) as "${name}"...`);

  try {
    const res = await fetch(`${registry}/api/contracts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, contract }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Registry returned ${res.status}: ${text}`);
    }

    const { url, id } = (await res.json()) as { url: string; id: string };

    // Persist the registry URL into contrakt.config.json
    writeConfig(cwd, { ...config, registryUrl: url, registryId: id });

    log.blank();
    log.success(`Published → ${url}`);
    log.dim("AI agents and developers can now discover your API at that URL.");
    log.dim("Stored in contrakt.config.json — run 'contrakt publish' again to update.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isNetworkError =
      msg.includes("fetch") ||
      msg.includes("ECONNREFUSED") ||
      msg.includes("ENOTFOUND") ||
      msg.includes("timeout");

    if (isNetworkError) {
      log.blank();
      log.warn("The public registry is not yet live.");
      log.dim("Star the repo and watch for the registry launch:");
      log.dim("https://github.com/shouryasrivastava/contrakt");
    } else {
      log.error(`Publish failed: ${msg}`);
    }
  }
}
