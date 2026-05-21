import { join, sep } from "node:path";
import { readFileSync } from "node:fs";
import { findFiles } from "../util/fs.js";
import { log } from "../util/logger.js";
import type { HttpMethod } from "../inference/types.js";

export interface PagesRouteFile {
  absolutePath: string;
  relativePath: string;
  urlPath: string;
  /** Methods found via req.method branching, or ["ALL"] if no branching detected */
  methods: HttpMethod[];
  hasMethodBranching: boolean;
}

const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export function scanPagesRoutes(cwd: string): PagesRouteFile[] {
  const allFiles = findFiles(cwd, /\.(ts|js)$/);
  const routes: PagesRouteFile[] = [];

  for (const rel of allFiles) {
    const normalized = rel.split(sep).join("/");
    if (!normalized.startsWith("pages/api/")) continue;
    // Skip Next.js special files
    if (normalized.includes("_middleware") || normalized.includes("_app")) continue;

    const absolutePath = join(cwd, rel);
    const src = readFileSafe(absolutePath);
    if (!src) continue;

    // Must have a default export to be a handler
    if (!hasDefaultExport(src)) {
      log.debug(`Skipping ${rel} — no default export found`);
      continue;
    }

    const urlPath = derivePageUrlPath(normalized);
    const { methods, hasMethodBranching } = detectMethods(src);

    routes.push({ absolutePath, relativePath: rel, urlPath, methods, hasMethodBranching });
    log.debug(`Found pages route: ${urlPath} [${methods.join(", ")}] in ${rel}`);
  }

  return routes;
}

/**
 * Convert a pages/api relative path to a URL path.
 * pages/api/users/index.ts → /api/users
 * pages/api/users/[id].ts  → /api/users/[id]
 * pages/api/health.ts      → /api/health
 */
export function derivePageUrlPath(relativePath: string): string {
  let path = relativePath
    .replace(/^pages/, "")          // strip leading "pages"
    .replace(/\.(ts|js)$/, "")      // strip extension
    .replace(/\/index$/, "");       // strip /index suffix

  if (!path.startsWith("/")) path = "/" + path;
  return path || "/";
}

function hasDefaultExport(src: string): boolean {
  return (
    /export\s+default\s+(async\s+)?function/.test(src) ||
    /export\s+default\s+(async\s+)?\(/.test(src) ||
    /export\s+default\s+handler/.test(src) ||
    /exports\.default\s*=/.test(src)
  );
}

function detectMethods(src: string): { methods: HttpMethod[]; hasMethodBranching: boolean } {
  const found = new Set<HttpMethod>();

  // req.method === "GET" / req.method !== "POST" / req.method === 'DELETE'
  const eqPattern = /req\.method\s*[!=]==?\s*['"]([A-Z]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = eqPattern.exec(src)) !== null) {
    const method = m[1] as HttpMethod;
    if (HTTP_METHODS.includes(method)) found.add(method);
  }

  // switch (req.method) { case "GET": ... }
  const casePattern = /case\s+['"]([A-Z]+)['"]/g;
  while ((m = casePattern.exec(src)) !== null) {
    const method = m[1] as HttpMethod;
    if (HTTP_METHODS.includes(method)) found.add(method);
  }

  if (found.size === 0) {
    // No method branching — treat as handling all methods, represent as GET for schema purposes
    return { methods: ["GET"], hasMethodBranching: false };
  }

  return { methods: [...found], hasMethodBranching: true };
}

function readFileSafe(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
