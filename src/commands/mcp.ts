import { resolve } from "node:path";
import { log } from "../util/logger.js";
import { readLockfile, readConfig } from "../lockfile/read.js";
import { generateMcpArtifacts } from "../mcp/generate-config.js";

export interface McpOptions {
  cwd: string;
  baseUrl?: string;
  output?: string;
}

export async function runMcp(options: McpOptions): Promise<void> {
  const cwd = resolve(options.cwd);

  log.blank();
  log.header("Contrakt — mcp");
  log.blank();

  const contract = readLockfile(cwd);
  const config = readConfig(cwd);

  // Priority: flag > config > hardcoded default
  const baseUrl = options.baseUrl ?? config?.baseUrl ?? "http://localhost:3000";

  if (options.baseUrl) {
    log.info(`Using base URL ${baseUrl} (from --base-url flag)`);
  } else if (config?.baseUrl) {
    log.info(`Using base URL ${baseUrl} (from contrakt.config.json)`);
  } else {
    log.info(`Using base URL ${baseUrl} (default — edit contrakt.config.json to change)`);
  }

  const artifacts = generateMcpArtifacts(contract, {
    cwd,
    baseUrl,
    outputDir: options.output ? resolve(options.output) : undefined,
  });

  log.blank();
  log.success(`Wrote mcp.json → ${artifacts.configPath}`);
  log.success(`Wrote contrakt-mcp-server.ts → ${artifacts.serverPath}`);
  log.blank();
  log.dim(`${contract.endpoints.length} endpoint(s) registered as MCP tools.`);
  log.dim(`Start the server: tsx ${artifacts.serverPath}`);
  log.dim(`Override base URL at runtime: CONTRAKT_BASE_URL=https://staging.myapp.com tsx ${artifacts.serverPath}`);
}
