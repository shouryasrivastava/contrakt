import { resolve } from "node:path";
import { log } from "../util/logger.js";
import { readLockfile, readConfig, writeConfig } from "../lockfile/read.js";

export interface PublishOptions {
  cwd: string;
  name?: string;
  token?: string;
  registry?: string;
}

const DEFAULT_REGISTRY = "https://contrakt-registry.vercel.app";

export async function runPublish(options: PublishOptions): Promise<void> {
  const cwd = resolve(options.cwd);
  const registry = options.registry ?? DEFAULT_REGISTRY;

  log.blank();
  log.header("Contrakt — publish");
  log.blank();

  const contract = readLockfile(cwd);
  const config = readConfig(cwd);

  // Token resolution: --token flag > CONTRAKT_TOKEN env var > contrakt.config.json
  const token =
    options.token ??
    process.env.CONTRAKT_TOKEN ??
    config?.token;

  if (!token) {
    log.error("No API token found.");
    log.blank();
    log.dim("Get a token from your dashboard:");
    log.dim(`  ${registry}/dashboard`);
    log.blank();
    log.dim("Then either:");
    log.dim("  export CONTRAKT_TOKEN=<token>  (recommended)");
    log.dim("  contrakt publish --token <token>");
    process.exit(1);
  }

  const name =
    options.name ??
    config?.name ??
    cwd.split("/").at(-1) ??
    "my-app";

  log.info(`Publishing ${contract.endpoints.length} endpoint(s) as "${name}"...`);

  try {
    const res = await fetch(`${registry}/api/contracts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ name, contract }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Registry returned ${res.status}: ${text}`);
    }

    const { url, id } = (await res.json()) as { url: string; id: string };

    // Persist registry info into contrakt.config.json (never writes the token to disk)
    writeConfig(cwd, { ...config, registryUrl: url, registryId: id });

    log.blank();
    log.success(`Published → ${url}`);
    log.dim("AI agents and developers can now discover your API at that URL.");
    log.dim("Run 'contrakt publish' again to push updates.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isNetworkError =
      msg.includes("fetch") ||
      msg.includes("ECONNREFUSED") ||
      msg.includes("ENOTFOUND") ||
      msg.includes("timeout");

    if (isNetworkError) {
      log.blank();
      log.warn("Could not reach the registry.");
      log.dim(`Is ${registry} reachable?`);
    } else {
      log.error(`Publish failed: ${msg}`);
      process.exit(1);
    }
  }
}
