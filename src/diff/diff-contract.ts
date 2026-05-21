import type { Contract, Endpoint, DiffResult, DiffReport } from "../inference/types.js";
import { classifySchemaChanges } from "./classify-change.js";

export function diffContracts(oldContract: Contract, newContract: Contract): DiffReport {
  const report: DiffReport = { breaking: [], nonBreaking: [], additive: [] };

  const oldEndpoints = new Map(
    oldContract.endpoints.map((e) => [`${e.method}:${e.path}`, e]),
  );
  const newEndpoints = new Map(
    newContract.endpoints.map((e) => [`${e.method}:${e.path}`, e]),
  );

  // Removed endpoints
  for (const [key, oldEp] of oldEndpoints) {
    if (!newEndpoints.has(key)) {
      report.breaking.push({
        type: "breaking",
        message: `Endpoint ${oldEp.method} ${oldEp.path} was removed`,
        path: oldEp.path,
        method: oldEp.method,
      });
    }
  }

  // Added endpoints
  for (const [key, newEp] of newEndpoints) {
    if (!oldEndpoints.has(key)) {
      report.nonBreaking.push({
        type: "non-breaking",
        message: `Endpoint ${newEp.method} ${newEp.path} was added`,
        path: newEp.path,
        method: newEp.method,
      });
    }
  }

  // Changed endpoints
  for (const [key, oldEp] of oldEndpoints) {
    const newEp = newEndpoints.get(key);
    if (!newEp) continue;

    const changes = diffEndpoint(oldEp, newEp);
    for (const change of changes) {
      const entry = { ...change, path: oldEp.path, method: oldEp.method };
      if (change.type === "breaking") report.breaking.push(entry);
      else if (change.type === "non-breaking") report.nonBreaking.push(entry);
      else report.additive.push(entry);
    }
  }

  return report;
}

function diffEndpoint(old: Endpoint, next: Endpoint): DiffResult[] {
  const results: DiffResult[] = [];

  // Request schema diff
  results.push(...classifySchemaChanges(old.requestSchema, next.requestSchema, "request", "body"));

  // Response schema diff
  results.push(
    ...classifySchemaChanges(old.responseSchema, next.responseSchema, "response", "response"),
  );

  // Query schema diff
  results.push(...classifySchemaChanges(old.querySchema, next.querySchema, "request", "query"));

  // Status codes — added status codes are non-breaking, removed are breaking
  const oldCodes = new Set(old.statusCodes);
  const newCodes = new Set(next.statusCodes);
  for (const code of oldCodes) {
    if (!newCodes.has(code)) {
      results.push({
        type: "breaking",
        message: `Status code ${code} was removed`,
        field: `statusCode.${code}`,
      });
    }
  }
  for (const code of newCodes) {
    if (!oldCodes.has(code)) {
      results.push({
        type: "non-breaking",
        message: `Status code ${code} was added`,
        field: `statusCode.${code}`,
      });
    }
  }

  // Description changes are purely additive
  if (old.description !== next.description && next.description) {
    results.push({
      type: "additive",
      message: `Description updated`,
      field: "description",
    });
  }

  return results;
}
