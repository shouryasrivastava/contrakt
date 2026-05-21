import type { JSONSchema } from "./types.js";

/**
 * Merge a sampled schema onto an existing schema.
 *
 * Source tracking:
 * - Schemas/fields with `x-contrakt-source: "sampled"` came from live traffic.
 * - Schemas without that tag came from static analysis.
 *
 * Merge rules:
 * - existing is unknown → replace entirely with sampled
 * - both are objects → merge properties:
 *     - field in both              → recurse
 *     - field only in sample       → add it (mark as sampled)
 *     - field only in existing, was sampled  → DROP (gone from live response)
 *     - field only in existing, was static   → keep (static analysis saw it)
 * - type conflict                  → keep existing, annotate runtime type
 * - same concrete type, not object → existing wins (static is source of truth)
 */
export function mergeWithSample(existing: JSONSchema | undefined, sampled: JSONSchema): JSONSchema {
  if (!existing) return { ...sampled, "x-contrakt-source": "sampled" };

  const existingType = existing["type"] as string | undefined;
  const sampledType = sampled["type"] as string | undefined;

  if (existingType === "unknown") {
    return markAllSampled(sampled);
  }

  if (existingType === "object" && sampledType === "object") {
    return mergeObjects(existing, sampled);
  }

  if (existingType === "array" && sampledType === "array") {
    const existingItems = (existing["items"] ?? {}) as JSONSchema;
    const sampledItems = (sampled["items"] ?? {}) as JSONSchema;
    return { ...existing, items: mergeWithSample(existingItems, sampledItems) };
  }

  if (existingType && sampledType && existingType !== sampledType) {
    return {
      ...existing,
      "x-contrakt-sampled-type": sampledType,
      "x-contrakt-note": `Static type: ${existingType}, runtime sample saw: ${sampledType}`,
    };
  }

  return existing;
}

function mergeObjects(existing: JSONSchema, sampled: JSONSchema): JSONSchema {
  const existingProps = (existing["properties"] ?? {}) as Record<string, JSONSchema>;
  const sampledProps = (sampled["properties"] ?? {}) as Record<string, JSONSchema>;
  // A schema is "fully sampled" if its top-level source is sampled
  const existingIsSampled = existing["x-contrakt-source"] === "sampled";

  const mergedProps: Record<string, JSONSchema> = {};

  // Process existing properties
  for (const [key, existingProp] of Object.entries(existingProps)) {
    if (key in sampledProps) {
      // Present in both — recurse
      mergedProps[key] = mergeWithSample(existingProp, sampledProps[key]);
    } else {
      // Missing from new sample
      const propWasSampled =
        existingIsSampled || existingProp["x-contrakt-source"] === "sampled";
      if (propWasSampled) {
        // Was learned from live traffic and is now gone — drop it
        // (caller sees the omission as a removal)
      } else {
        // Came from static analysis — preserve it
        mergedProps[key] = existingProp;
      }
    }
  }

  // Add new properties from sample
  for (const [key, sampledProp] of Object.entries(sampledProps)) {
    if (!(key in existingProps)) {
      mergedProps[key] = { ...sampledProp, "x-contrakt-source": "sampled" };
    }
  }

  return { ...existing, "x-contrakt-source": "sampled", properties: mergedProps };
}

/** Recursively mark all properties in a schema as sampled. */
function markAllSampled(schema: JSONSchema): JSONSchema {
  const props = schema["properties"] as Record<string, JSONSchema> | undefined;
  if (!props) return { ...schema, "x-contrakt-source": "sampled" };

  const marked: Record<string, JSONSchema> = {};
  for (const [k, v] of Object.entries(props)) {
    marked[k] = markAllSampled(v);
  }
  return { ...schema, "x-contrakt-source": "sampled", properties: marked };
}
