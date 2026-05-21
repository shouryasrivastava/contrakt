import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { VERSION } from "../version.js";
import { log } from "../util/logger.js";
import { exists } from "../util/fs.js";
import { detectRouter } from "../scanners/detect.js";
import { scanNextjsRoutes } from "../scanners/nextjs.js";
import { scanPagesRoutes } from "../scanners/nextjs-pages.js";
import { inferEndpoint, resetProject } from "../inference/infer-endpoint.js";
import { inferPagesEndpoint, resetPagesProject } from "../inference/infer-endpoint-pages.js";
import { writeLockfile, LOCKFILE_NAME } from "../lockfile/write.js";
import { writeConfig, CONFIG_NAME } from "../lockfile/read.js";
import { generateMcpArtifacts } from "../mcp/generate-config.js";
import type { Contract, Endpoint } from "../inference/types.js";

export interface InitOptions {
  cwd: string;
  baseUrl?: string;
  force?: boolean;
  mcp?: boolean;
}

const DEFAULT_BASE_URL = "http://localhost:3000";

export async function runInit(options: InitOptions): Promise<void> {
  const cwd = resolve(options.cwd);
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const lockfilePath = join(cwd, LOCKFILE_NAME);

  if (!options.baseUrl) {
    log.info(
      `Using base URL ${DEFAULT_BASE_URL} (override with --base-url or edit ${CONFIG_NAME})`,
    );
  }

  if (exists(lockfilePath) && !options.force) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`  ${LOCKFILE_NAME} already exists. Overwrite? [y/N] `);
    rl.close();
    if (answer.trim().toLowerCase() !== "y") {
      log.warn("Aborted. Use --force to skip this prompt.");
      process.exit(0);
    }
  }

  log.blank();
  log.header("Contrakt — init");
  log.blank();
  log.info(`Scanning ${cwd}`);

  const router = detectRouter(cwd);

  if (router === "none") {
    log.warn("No Next.js API routes found (checked app/api/ and pages/api/).");
    log.dim("Make sure you're running contrakt from your project root.");
    process.exit(1);
  }

  log.dim(`Detected router: ${router}`);

  const endpoints = await scanAndInfer(cwd, router);

  if (endpoints.length === 0) {
    log.warn("No API route handlers found.");
    process.exit(1);
  }

  const stack =
    router === "hybrid" ? "nextjs-hybrid"
    : router === "pages" ? "nextjs-pages-router"
    : "nextjs-app-router";

  const contract: Contract = {
    schemaSyncVersion: VERSION,
    generatedAt: new Date().toISOString(),
    projectRoot: cwd,
    stack,
    endpoints,
  };

  writeLockfile(cwd, contract);
  writeConfig(cwd, { baseUrl, stack });

  log.blank();
  log.success(`Wrote ${LOCKFILE_NAME} (${endpoints.length} endpoint(s))`);
  log.success(`Wrote ${CONFIG_NAME}`);

  if (options.mcp !== false) {
    generateMcpArtifacts(contract, { cwd, baseUrl });
    log.success(`Wrote mcp.json`);
    log.success(`Wrote contrakt-mcp-server.ts`);
    log.blank();
    log.dim(`MCP server targets: ${baseUrl}`);
  }

  log.blank();
  log.info("Next: run 'contrakt check' after making changes to detect drift.");
}

export async function scanAndInfer(cwd: string, router: "app" | "pages" | "hybrid"): Promise<Endpoint[]> {
  const endpoints: Endpoint[] = [];

  if (router === "app" || router === "hybrid") {
    resetProject();
    const routes = scanNextjsRoutes(cwd);
    log.info(`Found ${routes.length} App Router route file(s)`);
    for (const route of routes) {
      for (const method of route.methods) {
        log.dim(`  ${method} ${route.urlPath}`);
        endpoints.push(inferEndpoint(route.absolutePath, route.relativePath, route.urlPath, method, cwd));
      }
    }
  }

  if (router === "pages" || router === "hybrid") {
    resetPagesProject();
    const routes = scanPagesRoutes(cwd);
    log.info(`Found ${routes.length} Pages Router route file(s)`);
    for (const route of routes) {
      for (const method of route.methods) {
        log.dim(`  ${method} ${route.urlPath}${!route.hasMethodBranching ? " (no method branching)" : ""}`);
        endpoints.push(
          inferPagesEndpoint(
            route.absolutePath, route.relativePath, route.urlPath,
            method, route.hasMethodBranching, cwd,
          ),
        );
      }
    }
  }

  return endpoints;
}
