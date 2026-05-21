import pc from "picocolors";
import { log } from "../util/logger.js";
import { inferSchemaFromValue } from "../inference/infer-from-value.js";
import { mergeWithSample } from "../inference/merge-schema.js";
import type { Endpoint, JSONSchema } from "../inference/types.js";

export interface SampleResult {
  endpoint: Endpoint;
  status: "sampled" | "skipped" | "failed";
  statusCode?: number;
  reason?: string;
  newFields?: string[];
  removedFields?: string[];
  mergedSchema?: JSONSchema;
}

export interface SampleRunOptions {
  baseUrl: string;
  headers?: Record<string, string>;
  paramMap?: Record<string, string>;
  includePost?: boolean;
}

export async function sampleEndpoints(
  endpoints: Endpoint[],
  opts: SampleRunOptions,
): Promise<SampleResult[]> {
  const headers = { "Accept": "application/json", ...opts.headers };
  const paramMap = opts.paramMap ?? {};
  const results: SampleResult[] = [];

  for (const endpoint of endpoints) {
    results.push(await sampleOne(endpoint, opts.baseUrl, headers, paramMap, opts.includePost));
  }
  return results;
}

export function applyResults(endpoints: Endpoint[], results: SampleResult[]): Endpoint[] {
  const byPath = new Map(results.map((r) => [`${r.endpoint.method}:${r.endpoint.path}`, r]));
  return endpoints.map((ep) => {
    const result = byPath.get(`${ep.method}:${ep.path}`);
    if (!result?.mergedSchema) return ep;
    return { ...ep, responseSchema: result.mergedSchema };
  });
}

export function printSampleResults(results: SampleResult[]): void {
  for (const result of results) {
    const label = `${result.endpoint.method} ${result.endpoint.path}`;
    if (result.status === "sampled") {
      const code = result.statusCode ? pc.dim(` ${result.statusCode}`) : "";
      const added = result.newFields?.length
        ? pc.cyan(` +${result.newFields.length} field(s): ${result.newFields.slice(0, 4).join(", ")}${result.newFields.length > 4 ? "…" : ""}`)
        : "";
      const dropped = result.removedFields?.length
        ? pc.red(` -${result.removedFields.length} field(s): ${result.removedFields.slice(0, 4).join(", ")}${result.removedFields.length > 4 ? "…" : ""}`)
        : "";
      const noChange = !added && !dropped ? pc.dim(" (no changes)") : "";
      console.log(`  ${pc.green("↓")} ${label}${code}${added}${dropped}${noChange}`);
    } else if (result.status === "skipped") {
      console.log(`  ${pc.dim("~")} ${pc.dim(label)} — ${pc.dim(result.reason)}`);
    } else {
      console.log(`  ${pc.red("✗")} ${label} — ${pc.red(result.reason ?? "failed")}`);
    }
  }
}

export async function checkReachable(baseUrl: string): Promise<boolean> {
  try {
    await fetch(baseUrl, { signal: AbortSignal.timeout(3000), method: "HEAD" });
    return true;
  } catch {
    try {
      await fetch(baseUrl, { signal: AbortSignal.timeout(3000) });
      return true;
    } catch {
      return false;
    }
  }
}

export function parseHeaders(raw: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of raw) {
    const colon = h.indexOf(":");
    if (colon === -1) { log.warn(`Skipping malformed header: "${h}"`); continue; }
    out[h.slice(0, colon).trim()] = h.slice(colon + 1).trim();
  }
  return out;
}

export function parseParams(raw: string): Record<string, string> {
  if (!raw) return {};
  return Object.fromEntries(
    raw.split(",").flatMap((pair) => {
      const eq = pair.indexOf("=");
      if (eq === -1) return [];
      return [[pair.slice(0, eq).trim(), pair.slice(eq + 1).trim()]];
    }),
  );
}

async function sampleOne(
  endpoint: Endpoint,
  baseUrl: string,
  headers: Record<string, string>,
  paramMap: Record<string, string>,
  includePost = false,
): Promise<SampleResult> {
  const isWriteMethod = endpoint.method !== "GET" && endpoint.method !== "DELETE";
  if (isWriteMethod && !includePost) {
    return { endpoint, status: "skipped", reason: `${endpoint.method} skipped (use --include-post to sample with empty body)` };
  }

  const { resolved, missing } = resolvePath(endpoint.path, paramMap);
  if (missing.length > 0) {
    return {
      endpoint, status: "skipped",
      reason: `Path param(s) not provided: ${missing.map((p) => `[${p}]`).join(", ")} — use --params ${missing.map((p) => `${p}=<value>`).join(",")}`,
    };
  }

  try {
    const res = await fetch(baseUrl + resolved, {
      method: endpoint.method,
      headers: { ...headers, ...(isWriteMethod ? { "Content-Type": "application/json" } : {}) },
      body: isWriteMethod ? "{}" : undefined,
      signal: AbortSignal.timeout(8000),
    });

    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) {
      return { endpoint, status: "failed", statusCode: res.status, reason: `Not JSON (content-type: ${ct || "none"})` };
    }

    const body = await res.json();
    const sampled = inferSchemaFromValue(body);
    const existing = endpoint.responseSchema;
    const merged = mergeWithSample(existing, sampled);
    const newFields = findNewFields(existing, merged);
    const removedFields = findRemovedFields(existing, merged);

    return {
      endpoint, status: "sampled", statusCode: res.status,
      newFields, removedFields,
      mergedSchema: (newFields.length > 0 || removedFields.length > 0) ? merged : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { endpoint, status: "failed", reason: msg.includes("timeout") ? "Timed out after 8s" : `Request failed: ${msg}` };
  }
}

function resolvePath(path: string, params: Record<string, string>): { resolved: string; missing: string[] } {
  const missing: string[] = [];
  const resolved = path.replace(/\[([^\]]+)\]/g, (_, name) => {
    if (name in params) return params[name];
    missing.push(name);
    return `[${name}]`;
  });
  return { resolved, missing };
}

function findNewFields(existing: JSONSchema | undefined, merged: JSONSchema): string[] {
  if (!existing || (existing["type"] as string) === "unknown") {
    return Object.keys((merged["properties"] ?? {}) as Record<string, unknown>);
  }
  const existingProps = Object.keys((existing["properties"] ?? {}) as Record<string, unknown>);
  const mergedProps = Object.keys((merged["properties"] ?? {}) as Record<string, unknown>);
  return mergedProps.filter((k) => !existingProps.includes(k));
}

function findRemovedFields(existing: JSONSchema | undefined, merged: JSONSchema): string[] {
  if (!existing || (existing["type"] as string) === "unknown") return [];
  const existingProps = Object.keys((existing["properties"] ?? {}) as Record<string, unknown>);
  const mergedProps = Object.keys((merged["properties"] ?? {}) as Record<string, unknown>);
  return existingProps.filter((k) => !mergedProps.includes(k));
}
