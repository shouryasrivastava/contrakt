import type { JSONSchema } from "./types.js";

/**
 * Infer a JSON Schema from an actual runtime value.
 * Used by `contrakt sample` to learn schema from live API responses.
 */
export function inferSchemaFromValue(value: unknown, depth = 0): JSONSchema {
  if (value === null) return { type: "null" };
  if (value === undefined) return { type: "null" };

  if (typeof value === "string") {
    return { type: "string", examples: [value] };
  }
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { type: "integer", examples: [value] }
      : { type: "number", examples: [value] };
  }
  if (typeof value === "boolean") {
    return { type: "boolean", examples: [value] };
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return { type: "array", items: {} };
    // Merge schemas of first few elements to handle mixed arrays
    const itemSchemas = value.slice(0, 3).map((el) => inferSchemaFromValue(el, depth + 1));
    const merged = itemSchemas.length === 1 ? itemSchemas[0] : mergeItemSchemas(itemSchemas);
    return { type: "array", items: merged };
  }

  if (typeof value === "object") {
    if (depth > 6) {
      // Prevent infinite recursion on deeply nested objects
      return { type: "object", properties: {} };
    }
    const properties: Record<string, JSONSchema> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      properties[key] = inferSchemaFromValue(val, depth + 1);
    }
    return { type: "object", properties };
  }

  return { type: "unknown", "x-contrakt-note": `Unhandled value type: ${typeof value}` };
}

function mergeItemSchemas(schemas: JSONSchema[]): JSONSchema {
  const types = new Set(schemas.map((s) => s["type"] as string));
  if (types.size === 1) return schemas[0];
  // Mixed types in array — use oneOf
  return { oneOf: schemas };
}
