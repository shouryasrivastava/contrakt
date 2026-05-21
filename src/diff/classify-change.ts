import type { JSONSchema, DiffResult } from "../inference/types.js";

type ChangeType = "breaking" | "non-breaking" | "additive" | "none";

interface FieldChange {
  changeType: ChangeType;
  message: string;
}

/**
 * Classify differences between two JSON Schemas.
 * `side` indicates which side of the contract this schema is on:
 * - "request": narrowing/adding required fields is breaking for callers
 * - "response": removing/narrowing fields is breaking for consumers
 */
export function classifySchemaChanges(
  old: JSONSchema | undefined,
  next: JSONSchema | undefined,
  side: "request" | "response",
  prefix = "",
): DiffResult[] {
  if (!old && !next) return [];

  if (!old && next) {
    return [
      {
        type: side === "response" ? "non-breaking" : "additive",
        message: `${prefix} schema added`,
        field: prefix,
      },
    ];
  }

  if (old && !next) {
    return [
      {
        type: "breaking",
        message: `${prefix} schema removed`,
        field: prefix,
      },
    ];
  }

  const results: DiffResult[] = [];
  const oldProps = (old!["properties"] ?? {}) as Record<string, JSONSchema>;
  const nextProps = (next!["properties"] ?? {}) as Record<string, JSONSchema>;
  const oldRequired = ((old!["required"] ?? []) as string[]);
  const nextRequired = ((next!["required"] ?? []) as string[]);

  // Check for removed fields
  for (const key of Object.keys(oldProps)) {
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    if (!(key in nextProps)) {
      results.push({
        type: "breaking",
        message: `Field "${fieldPath}" was removed`,
        field: fieldPath,
      });
    } else {
      // Field exists in both — check type change
      const change = compareFieldTypes(oldProps[key], nextProps[key], fieldPath, side);
      if (change) results.push(change);
    }
  }

  // Check for added fields
  for (const key of Object.keys(nextProps)) {
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    if (!(key in oldProps)) {
      const isRequiredInNext = nextRequired.includes(key);
      if (side === "request" && isRequiredInNext) {
        results.push({
          type: "breaking",
          message: `Required field "${fieldPath}" was added to request body`,
          field: fieldPath,
        });
      } else {
        results.push({
          type: "non-breaking",
          message: `Field "${fieldPath}" was added`,
          field: fieldPath,
        });
      }
    }
  }

  // Check required changes on existing fields
  for (const key of oldRequired) {
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    if (key in nextProps && !nextRequired.includes(key)) {
      results.push({
        type: "non-breaking",
        message: `Field "${fieldPath}" changed from required to optional`,
        field: fieldPath,
      });
    }
  }

  for (const key of nextRequired) {
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    if (key in oldProps && !oldRequired.includes(key)) {
      if (side === "request") {
        results.push({
          type: "breaking",
          message: `Field "${fieldPath}" changed from optional to required in request body`,
          field: fieldPath,
        });
      } else {
        results.push({
          type: "non-breaking",
          message: `Field "${fieldPath}" is now required in response`,
          field: fieldPath,
        });
      }
    }
  }

  return results;
}

function compareFieldTypes(
  oldField: JSONSchema,
  nextField: JSONSchema,
  fieldPath: string,
  side: "request" | "response",
): DiffResult | null {
  const oldType = oldField["type"] as string | undefined;
  const nextType = nextField["type"] as string | undefined;

  if (oldType === nextType) return null;

  if (!oldType || !nextType) return null;

  // unknown → concrete type: non-breaking (we learned more)
  if (oldType === "unknown" && nextType !== "unknown") {
    return {
      type: "non-breaking",
      message: `Field "${fieldPath}" type refined from unknown to ${nextType}`,
      field: fieldPath,
    };
  }

  // concrete → unknown: breaking (we lost info)
  if (oldType !== "unknown" && nextType === "unknown") {
    return {
      type: "breaking",
      message: `Field "${fieldPath}" type changed from ${oldType} to unknown`,
      field: fieldPath,
    };
  }

  // Any other type change is breaking
  return {
    type: "breaking",
    message: `Field "${fieldPath}" type changed from ${oldType} to ${nextType}`,
    field: fieldPath,
  };
}
