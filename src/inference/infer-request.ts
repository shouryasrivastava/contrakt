import {
  Project,
  Node,
  SyntaxKind,
  type FunctionDeclaration,
  type ArrowFunction,
  type FunctionExpression,
  type Type,
} from "ts-morph";
import type { JSONSchema } from "./types.js";
import { log } from "../util/logger.js";

type HandlerFn = FunctionDeclaration | ArrowFunction | FunctionExpression;

/**
 * Infer the request body schema from a handler function.
 * Looks for `await req.json()` or `await request.json()` calls.
 */
export function inferRequestSchema(
  handler: HandlerFn,
  project: Project,
): JSONSchema | undefined {
  const sourceFile = handler.getSourceFile();
  const body = handler.getBody();
  if (!body || !Node.isBlock(body)) return undefined;

  // Find variable declarations that capture `await req.json()` or `await request.json()`
  const awaitExprs = body.getDescendantsOfKind(SyntaxKind.AwaitExpression);
  for (const awaitExpr of awaitExprs) {
    const inner = awaitExpr.getExpression();
    if (!Node.isCallExpression(inner)) continue;

    const callText = inner.getExpression().getText();
    if (!callText.endsWith(".json")) continue;

    const receiver = callText.replace(/\.json$/, "");
    if (receiver !== "req" && receiver !== "request") continue;

    // Found `await req.json()` — walk up through any wrapping parentheses first
    let cursor: Node = awaitExpr;
    while (true) {
      const p = cursor.getParent();
      if (p && Node.isParenthesizedExpression(p)) {
        cursor = p;
      } else {
        break;
      }
    }
    const parent = cursor.getParent();

    // Case 1: `const body = (await req.json()) as CreateUserInput`
    if (parent && Node.isAsExpression(parent)) {
      return typeToJsonSchema(parent.getType(), `requestBody from ${sourceFile.getFilePath()}`);
    }

    // Case 2: `const body: Foo = await req.json()` — explicit type annotation on declaration
    if (parent && Node.isVariableDeclaration(parent)) {
      const typeNode = parent.getTypeNode();
      if (typeNode) {
        return typeToJsonSchema(parent.getType(), `requestBody from ${sourceFile.getFilePath()}`);
      }
    }

    // Case 3: `const { name, email } = await req.json()` — object destructuring
    const grandparent = parent?.getParent?.();
    if (grandparent && Node.isObjectBindingPattern(parent)) {
      if (Node.isVariableDeclaration(grandparent)) {
        return inferFromDestructuring(grandparent);
      }
    }

    // Can't resolve type — emit unknown
    log.debug(`Could not resolve request body type from ${sourceFile.getFilePath()}`);
    return {
      type: "unknown",
      "x-contrakt-note": "req.json() call found but type could not be resolved",
    };
  }

  return undefined;
}

/**
 * Infer query param schema by scanning for `searchParams.get("key")` calls.
 */
export function inferQuerySchema(handler: HandlerFn): JSONSchema | undefined {
  const body = handler.getBody();
  if (!body || !Node.isBlock(body)) return undefined;

  const calls = body.getDescendantsOfKind(SyntaxKind.CallExpression);
  const params: Record<string, JSONSchema> = {};

  for (const call of calls) {
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) continue;
    if (expr.getName() !== "get") continue;

    const obj = expr.getExpression().getText();
    if (!obj.includes("searchParams")) continue;

    const args = call.getArguments();
    if (args.length === 0) continue;

    const first = args[0];
    if (!Node.isStringLiteral(first)) continue;

    const key = first.getLiteralValue();
    params[key] = { type: "string" };
  }

  if (Object.keys(params).length === 0) return undefined;

  return {
    type: "object",
    properties: params,
  };
}

/**
 * Extract path params from a URL pattern like /api/users/[id].
 */
export function inferPathParams(urlPath: string): JSONSchema | undefined {
  const matches = urlPath.match(/\[([^\]]+)\]/g);
  if (!matches) return undefined;

  const properties: Record<string, JSONSchema> = {};
  const required: string[] = [];

  for (const match of matches) {
    // [...slug] is catch-all, [id] is regular
    const isCatchAll = match.startsWith("[...");
    const name = match.replace(/^\[\.\.\./, "").replace(/^\[/, "").replace(/\]$/, "");
    properties[name] = isCatchAll
      ? { type: "array", items: { type: "string" } }
      : { type: "string" };
    required.push(name);
  }

  return { type: "object", properties, required };
}

function inferFromDestructuring(decl: import("ts-morph").VariableDeclaration): JSONSchema {
  const nameNode = decl.getNameNode();
  if (!Node.isObjectBindingPattern(nameNode)) {
    return { type: "unknown", "x-contrakt-note": "destructuring pattern could not be parsed" };
  }

  const elements = nameNode.getElements();
  const properties: Record<string, JSONSchema> = {};
  for (const el of elements) {
    const name = el.getName();
    properties[name] = { type: "string", "x-contrakt-note": "inferred from destructuring" };
  }

  return { type: "object", properties };
}

/**
 * Convert a ts-morph Type to a JSON Schema object.
 * Conservative: marks anything it can't handle as unknown.
 */
export function typeToJsonSchema(type: Type, context: string): JSONSchema {
  if (type.isString() || type.isStringLiteral()) return { type: "string" };
  if (type.isNumber() || type.isNumberLiteral()) return { type: "number" };
  if (type.isBoolean() || type.isBooleanLiteral()) return { type: "boolean" };
  if (type.isNull()) return { type: "null" };
  if (type.isUndefined()) return { type: "null" };
  if (type.isAny() || type.isUnknown()) {
    return {
      type: "unknown",
      "x-contrakt-note":
        `Type resolved to any/unknown at ${context}. ` +
        `Possible causes: value built at runtime (eval, DB query, dynamic import), ` +
        `or missing type annotation. Run 'contrakt sample' (coming soon) to infer from live traffic.`,
    };
  }

  if (type.isArray()) {
    const elementType = type.getArrayElementType();
    return {
      type: "array",
      items: elementType ? typeToJsonSchema(elementType, context) : {},
    };
  }

  if (type.isUnion()) {
    const nonNull = type.getUnionTypes().filter((t) => !t.isNull() && !t.isUndefined());
    if (nonNull.length === 1) {
      const schema = typeToJsonSchema(nonNull[0], context);
      return { ...schema };
    }
    return { oneOf: nonNull.map((t) => typeToJsonSchema(t, context)) };
  }

  if (type.isInterface() || type.isObject()) {
    const properties: Record<string, JSONSchema> = {};
    const required: string[] = [];

    for (const prop of type.getProperties()) {
      const propName = prop.getName();
      const propType = prop.getTypeAtLocation(
        prop.getDeclarations()[0] ?? prop.getValueDeclaration()!,
      );
      properties[propName] = typeToJsonSchema(propType, `${context}.${propName}`);

      const isOptional = prop.isOptional();
      if (!isOptional) required.push(propName);
    }

    const schema: JSONSchema = { type: "object", properties };
    if (required.length > 0) schema["required"] = required;
    return schema;
  }

  log.debug(`Cannot convert type "${type.getText()}" to JSON Schema at ${context}`);
  return {
    type: "unknown",
    "x-contrakt-note": `Could not convert type "${type.getText()}" at ${context}`,
  };
}
