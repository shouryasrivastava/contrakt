import { join, sep } from "node:path";
import { findFiles } from "../util/fs.js";
import { log } from "../util/logger.js";
import type { HttpMethod } from "../inference/types.js";

export interface RouteFile {
  /** Absolute path to the route file */
  absolutePath: string;
  /** Relative path from cwd */
  relativePath: string;
  /** Derived URL path, e.g. /api/users/[id] */
  urlPath: string;
  /** HTTP methods exported from this file */
  methods: HttpMethod[];
}

const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const ROUTE_PATTERN = /route\.(ts|js)$/;

/**
 * Scan a Next.js App Router project for API route files.
 * Returns one RouteFile per route.ts / route.js found under app/api/.
 */
export function scanNextjsRoutes(cwd: string): RouteFile[] {
  const allFiles = findFiles(cwd, ROUTE_PATTERN);
  const routes: RouteFile[] = [];

  for (const rel of allFiles) {
    // Only care about app/api/** paths
    const normalized = rel.split(sep).join("/");
    if (!normalized.startsWith("app/api/")) continue;

    const absolutePath = join(cwd, rel);
    const urlPath = deriveUrlPath(normalized);
    const methods = extractExportedMethods(absolutePath);

    if (methods.length === 0) {
      log.debug(`Skipping ${rel} — no HTTP method exports found`);
      continue;
    }

    routes.push({ absolutePath, relativePath: rel, urlPath, methods });
    log.debug(`Found route: ${urlPath} [${methods.join(", ")}] in ${rel}`);
  }

  return routes;
}

/**
 * Convert a relative file path to a Next.js URL path.
 * app/api/users/[id]/route.ts → /api/users/[id]
 */
export function deriveUrlPath(relativePath: string): string {
  // Strip leading app/, trailing /route.ts or /route.js
  let path = relativePath
    .replace(/^app/, "")
    .replace(/\/route\.(ts|js)$/, "");
  if (!path.startsWith("/")) path = "/" + path;
  return path;
}

/**
 * Read a route file's source text and find exported HTTP method function names.
 * Uses a regex scan rather than full parsing — fast and dependency-free.
 * Full AST parsing happens later in the inference phase.
 */
function extractExportedMethods(absolutePath: string): HttpMethod[] {
  let src: string;
  try {
    src = readFileSync(absolutePath, "utf8");
  } catch {
    return [];
  }

  const found: HttpMethod[] = [];
  for (const method of HTTP_METHODS) {
    // Matches: export async function GET, export function GET, export const GET =
    const pattern = new RegExp(
      `export\\s+(async\\s+)?function\\s+${method}\\b|export\\s+const\\s+${method}\\s*=`,
    );
    if (pattern.test(src)) found.push(method);
  }
  return found;
}

import { readFileSync } from "node:fs";
