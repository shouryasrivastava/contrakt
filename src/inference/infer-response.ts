import {
  Node,
  SyntaxKind,
  type FunctionDeclaration,
  type ArrowFunction,
  type FunctionExpression,
  type Project,
  type ObjectLiteralExpression,
} from "ts-morph";
import type { JSONSchema } from "./types.js";
import { typeToJsonSchema } from "./infer-request.js";
import { log } from "../util/logger.js";

type HandlerFn = FunctionDeclaration | ArrowFunction | FunctionExpression;

interface ResponseShape {
  statusCode: number;
  schema: JSONSchema;
}

/**
 * Infer response schema from a handler by scanning NextResponse.json() and Response.json() calls.
 */
export function inferResponseSchema(
  handler: HandlerFn,
  _project: Project,
): { schema: JSONSchema | undefined; statusCodes: number[] } {
  const body = handler.getBody();
  if (!body) return { schema: undefined, statusCodes: [200] };

  const shapes = collectResponseShapes(body);

  if (shapes.length === 0) return { schema: undefined, statusCodes: [200] };

  const statusCodes = [...new Set(shapes.map((s) => s.statusCode))];

  if (shapes.length === 1) {
    return { schema: shapes[0].schema, statusCodes };
  }

  // Multiple shapes — build a oneOf union
  return {
    schema: { oneOf: shapes.map((s) => s.schema) },
    statusCodes,
  };
}

function collectResponseShapes(node: Node): ResponseShape[] {
  const shapes: ResponseShape[] = [];
  const calls = node.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const call of calls) {
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) continue;

    const methodName = expr.getName();
    if (methodName !== "json") continue;

    const receiverText = expr.getExpression().getText();
    const isNextResponse = receiverText === "NextResponse" || receiverText.endsWith(".NextResponse");
    const isResponse = receiverText === "Response";
    if (!isNextResponse && !isResponse) continue;

    const args = call.getArguments();
    if (args.length === 0) continue;

    const payloadArg = args[0];
    const statusCode = extractStatusCode(args[1]) ?? 200;

    const schema = inferPayloadSchema(payloadArg, call.getSourceFile().getFilePath());
    shapes.push({ statusCode, schema });
    log.debug(`Found response shape at status ${statusCode} in ${call.getSourceFile().getBaseName()}`);
  }

  return shapes;
}

function extractStatusCode(optionsArg: Node | undefined): number | undefined {
  if (!optionsArg) return undefined;

  // { status: 404 } or { status: N }
  if (Node.isObjectLiteralExpression(optionsArg)) {
    const statusProp = optionsArg.getProperty("status");
    if (!statusProp || !Node.isPropertyAssignment(statusProp)) return undefined;
    const init = statusProp.getInitializer();
    if (!init) return undefined;
    if (Node.isNumericLiteral(init)) return parseInt(init.getLiteralText(), 10);
  }

  return undefined;
}

function inferPayloadSchema(payloadArg: Node, filePath: string): JSONSchema {
  // Object literal: { status: "ok", data: [...] }
  if (Node.isObjectLiteralExpression(payloadArg)) {
    return inferObjectLiteralSchema(payloadArg, filePath);
  }

  // Array literal: [...]
  if (Node.isArrayLiteralExpression(payloadArg)) {
    const elements = payloadArg.getElements();
    if (elements.length > 0 && Node.isObjectLiteralExpression(elements[0])) {
      return {
        type: "array",
        items: inferObjectLiteralSchema(elements[0] as ObjectLiteralExpression, filePath),
      };
    }
    return { type: "array", items: {} };
  }

  // Identifier or call — try type inference
  const type = payloadArg.getType();
  return typeToJsonSchema(type, `response payload in ${filePath}`);
}

function inferObjectLiteralSchema(obj: ObjectLiteralExpression, filePath: string): JSONSchema {
  const properties: Record<string, JSONSchema> = {};

  for (const prop of obj.getProperties()) {
    // Shorthand property: `{ user }` — resolve through the referenced variable's type
    if (Node.isShorthandPropertyAssignment(prop)) {
      const name = prop.getName();
      properties[name] = typeToJsonSchema(prop.getType(), `${filePath}.${name}`);
      continue;
    }

    if (!Node.isPropertyAssignment(prop)) continue;
    const name = prop.getName();
    const init = prop.getInitializer();
    if (!init) {
      properties[name] = { type: "unknown" };
      continue;
    }

    if (Node.isStringLiteral(init)) {
      properties[name] = { type: "string", examples: [init.getLiteralValue()] };
    } else if (Node.isNumericLiteral(init)) {
      properties[name] = { type: "number", examples: [parseFloat(init.getLiteralText())] };
    } else if (init.getKind() === SyntaxKind.TrueKeyword || init.getKind() === SyntaxKind.FalseKeyword) {
      properties[name] = { type: "boolean" };
    } else if (Node.isNullLiteral(init)) {
      properties[name] = { type: "null" };
    } else if (Node.isObjectLiteralExpression(init)) {
      properties[name] = inferObjectLiteralSchema(init, filePath);
    } else if (Node.isArrayLiteralExpression(init)) {
      properties[name] = { type: "array", items: {} };
    } else {
      const type = init.getType();
      properties[name] = typeToJsonSchema(type, `${filePath}:${name}`);
    }
  }

  return { type: "object", properties };
}
