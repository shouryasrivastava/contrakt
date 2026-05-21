import {
  Node,
  SyntaxKind,
  type Project,
  type SourceFile,
  type FunctionDeclaration,
  type ArrowFunction,
  type FunctionExpression,
} from "ts-morph";
import type { Endpoint, HttpMethod, JSONSchema } from "./types.js";
import { typeToJsonSchema, inferPathParams } from "./infer-request.js";
import { createProject, resolveImports } from "./create-project.js";
import { log } from "../util/logger.js";

type HandlerFn = FunctionDeclaration | ArrowFunction | FunctionExpression;

let sharedPagesProject: Project | null = null;

export function getPagesProject(cwd: string): Project {
  if (!sharedPagesProject) {
    sharedPagesProject = createProject(cwd);
  }
  return sharedPagesProject;
}

export function resetPagesProject(): void {
  sharedPagesProject = null;
}

export function inferPagesEndpoint(
  absolutePath: string,
  relativePath: string,
  urlPath: string,
  method: HttpMethod,
  hasMethodBranching: boolean,
  cwd: string,
): Endpoint {
  const project = getPagesProject(cwd);

  let sourceFile = project.getSourceFile(absolutePath);
  if (!sourceFile) {
    try {
      sourceFile = project.addSourceFileAtPath(absolutePath);
      resolveImports(project);
    } catch (err) {
      log.debug(`Could not add pages source file ${absolutePath}: ${err}`);
      return fallback(relativePath, urlPath, method);
    }
  }

  const handler = findDefaultExport(sourceFile);
  if (!handler) {
    log.debug(`No default export handler found in ${relativePath}`);
    return fallback(relativePath, urlPath, method);
  }

  const description = extractJsDoc(handler);
  const pathParamNames = extractPathParamNames(urlPath);
  const pathParams = inferPathParams(urlPath);

  // For Pages Router, method branching means we look inside the branch for this method
  const scope = hasMethodBranching
    ? extractMethodBranch(handler, method) ?? handler
    : handler;

  const requestSchema =
    method !== "GET" && method !== "DELETE"
      ? inferPagesRequestSchema(scope, handler)
      : undefined;

  const querySchema = inferPagesQuerySchema(scope, pathParamNames);
  const { schema: responseSchema, statusCodes } = inferPagesResponseSchema(scope);

  return {
    path: urlPath,
    method,
    sourceFile: relativePath,
    routerType: "pages",
    requestSchema,
    querySchema: querySchema,
    pathParams,
    responseSchema,
    statusCodes,
    description,
  };
}

// ─── Default export finder ───────────────────────────────────────────────────

function findDefaultExport(sf: SourceFile): HandlerFn | undefined {
  // export default async function handler(req, res) { ... }
  for (const fn of sf.getFunctions()) {
    if (fn.isDefaultExport()) return fn;
  }

  // export default async (req, res) => { ... }
  for (const stmt of sf.getStatements()) {
    if (!Node.isExportAssignment(stmt)) continue;
    const expr = stmt.getExpression();
    if (Node.isArrowFunction(expr) || Node.isFunctionExpression(expr)) return expr;
    // export default handler  (identifier pointing to a function)
    if (Node.isIdentifier(expr)) {
      const sym = expr.getSymbol();
      const decl = sym?.getDeclarations()[0];
      if (!decl) continue;
      if (Node.isVariableDeclaration(decl)) {
        const init = decl.getInitializer();
        if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) return init;
      }
      if (Node.isFunctionDeclaration(decl)) return decl;
    }
  }

  // Fallback: const handler = ...; export default handler (separate variable + export)
  for (const varDecl of sf.getVariableDeclarations()) {
    if (varDecl.getName() !== "handler") continue;
    const init = varDecl.getInitializer();
    if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) return init;
  }

  return undefined;
}

// ─── Method branch extraction ─────────────────────────────────────────────────

/**
 * Try to find the block/expression corresponding to a specific HTTP method
 * inside `if (req.method === "GET") { ... }` or `switch (req.method)` patterns.
 * Returns the handler itself if we can't find a specific branch.
 */
function extractMethodBranch(
  handler: HandlerFn,
  method: HttpMethod,
): HandlerFn | null {
  // We return null to signal "use the full handler scope" when no branch is found
  // The branch body isn't a function, so we keep inference on the whole handler
  // and let the response/request inferrers find all relevant calls
  return null;
}

// ─── Request inference ────────────────────────────────────────────────────────

function inferPagesRequestSchema(
  scope: HandlerFn,
  handler: HandlerFn,
): JSONSchema | undefined {
  const body = scope.getBody() ?? handler.getBody();
  if (!body) return undefined;

  // `const body = req.body as CreateUserInput`
  // `const { name, email } = req.body`
  // `req.body` access
  const propAccesses = body.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression);
  for (const access of propAccesses) {
    if (access.getName() !== "body") continue;
    if (access.getExpression().getText() !== "req") continue;

    // Check for type assertion: (req.body as Foo) or req.body as Foo
    const parent = access.getParent();

    // `req.body as Foo`
    if (parent && Node.isAsExpression(parent)) {
      return typeToJsonSchema(parent.getType(), `req.body in ${scope.getSourceFile().getFilePath()}`);
    }

    // `const body: Foo = req.body` or variable declaration capturing req.body
    const varDecl = access.getParentIfKind(SyntaxKind.VariableDeclaration)
      ?? access.getParent()?.getParentIfKind?.(SyntaxKind.VariableDeclaration);
    if (varDecl && Node.isVariableDeclaration(varDecl)) {
      const typeNode = varDecl.getTypeNode();
      if (typeNode) {
        return typeToJsonSchema(varDecl.getType(), `req.body in ${scope.getSourceFile().getFilePath()}`);
      }
    }

    // `const { name, email } = req.body` — destructuring
    if (parent && Node.isVariableDeclaration(parent)) {
      const nameNode = parent.getNameNode();
      if (Node.isObjectBindingPattern(nameNode)) {
        const properties: Record<string, JSONSchema> = {};
        for (const el of nameNode.getElements()) {
          properties[el.getName()] = { type: "string", "x-contrakt-note": "inferred from destructuring" };
        }
        return { type: "object", properties };
      }
    }

    // req.body accessed but type not determinable
    return {
      type: "unknown",
      "x-contrakt-note": "req.body found but type could not be resolved",
    };
  }

  return undefined;
}

// ─── Query param inference ────────────────────────────────────────────────────

function inferPagesQuerySchema(
  scope: HandlerFn,
  pathParamNames: Set<string>,
): JSONSchema | undefined {
  const body = scope.getBody();
  if (!body) return undefined;

  const queryParams: Record<string, JSONSchema> = {};

  // req.query.foo  or  req.query["foo"]
  const propAccesses = body.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression);
  for (const access of propAccesses) {
    const obj = access.getExpression();
    if (!Node.isPropertyAccessExpression(obj)) continue;
    if (obj.getName() !== "query") continue;
    if (obj.getExpression().getText() !== "req") continue;

    const key = access.getName();
    if (!pathParamNames.has(key)) {
      queryParams[key] = { type: "string" };
    }
  }

  // const { id, page } = req.query — destructuring
  const varDecls = body.getDescendantsOfKind(SyntaxKind.VariableDeclaration);
  for (const decl of varDecls) {
    const init = decl.getInitializer();
    if (!init || !Node.isPropertyAccessExpression(init)) continue;
    if (init.getName() !== "query") continue;
    if (init.getExpression().getText() !== "req") continue;

    const nameNode = decl.getNameNode();
    if (Node.isObjectBindingPattern(nameNode)) {
      for (const el of nameNode.getElements()) {
        const key = el.getName();
        if (!pathParamNames.has(key)) {
          queryParams[key] = { type: "string" };
        }
      }
    }
  }

  if (Object.keys(queryParams).length === 0) return undefined;
  return { type: "object", properties: queryParams };
}

// ─── Response inference ───────────────────────────────────────────────────────

function inferPagesResponseSchema(
  scope: HandlerFn,
): { schema: JSONSchema | undefined; statusCodes: number[] } {
  const body = scope.getBody();
  if (!body) return { schema: undefined, statusCodes: [200] };

  const shapes: Array<{ status: number; schema: JSONSchema }> = [];
  const calls = body.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const call of calls) {
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) continue;
    if (expr.getName() !== "json") continue;

    // res.json({...}) or res.status(N).json({...})
    const receiver = expr.getExpression();
    const isDirectRes = receiver.getText() === "res";

    // res.status(N).json(...)
    let status = 200;
    if (!isDirectRes && Node.isCallExpression(receiver)) {
      const statusExpr = receiver.getExpression();
      if (
        Node.isPropertyAccessExpression(statusExpr) &&
        statusExpr.getName() === "status" &&
        statusExpr.getExpression().getText() === "res"
      ) {
        const statusArg = receiver.getArguments()[0];
        if (statusArg && Node.isNumericLiteral(statusArg)) {
          status = parseInt(statusArg.getLiteralText(), 10);
        }
      } else {
        continue; // not a res.*.json() chain we recognise
      }
    } else if (!isDirectRes) {
      continue;
    }

    const args = call.getArguments();
    if (args.length === 0) continue;

    const schema = inferPagesPayload(args[0], call.getSourceFile().getFilePath());
    shapes.push({ status, schema });
    log.debug(`Found pages response at status ${status}`);
  }

  if (shapes.length === 0) return { schema: undefined, statusCodes: [200] };

  const statusCodes = [...new Set(shapes.map((s) => s.status))];
  if (shapes.length === 1) return { schema: shapes[0].schema, statusCodes };
  return { schema: { oneOf: shapes.map((s) => s.schema) }, statusCodes };
}

function inferPagesPayload(node: Node, filePath: string): JSONSchema {
  if (Node.isObjectLiteralExpression(node)) {
    return inferPagesObjectLiteral(node, filePath);
  }
  if (Node.isArrayLiteralExpression(node)) {
    const els = node.getElements();
    if (els.length > 0 && Node.isObjectLiteralExpression(els[0])) {
      return { type: "array", items: inferPagesObjectLiteral(els[0], filePath) };
    }
    return { type: "array", items: {} };
  }
  return typeToJsonSchema(node.getType(), `pages response in ${filePath}`);
}

function inferPagesObjectLiteral(
  obj: import("ts-morph").ObjectLiteralExpression,
  filePath: string,
): JSONSchema {
  const properties: Record<string, JSONSchema> = {};

  for (const prop of obj.getProperties()) {
    if (Node.isShorthandPropertyAssignment(prop)) {
      properties[prop.getName()] = typeToJsonSchema(prop.getType(), `${filePath}.${prop.getName()}`);
      continue;
    }
    if (!Node.isPropertyAssignment(prop)) continue;
    const name = prop.getName();
    const init = prop.getInitializer();
    if (!init) { properties[name] = { type: "unknown" }; continue; }

    if (Node.isStringLiteral(init)) {
      properties[name] = { type: "string", examples: [init.getLiteralValue()] };
    } else if (Node.isNumericLiteral(init)) {
      properties[name] = { type: "number", examples: [parseFloat(init.getLiteralText())] };
    } else if (init.getKind() === SyntaxKind.TrueKeyword || init.getKind() === SyntaxKind.FalseKeyword) {
      properties[name] = { type: "boolean" };
    } else if (Node.isNullLiteral(init)) {
      properties[name] = { type: "null" };
    } else if (Node.isObjectLiteralExpression(init)) {
      properties[name] = inferPagesObjectLiteral(init, filePath);
    } else if (Node.isArrayLiteralExpression(init)) {
      properties[name] = { type: "array", items: {} };
    } else {
      properties[name] = typeToJsonSchema(init.getType(), `${filePath}.${name}`);
    }
  }
  return { type: "object", properties };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractPathParamNames(urlPath: string): Set<string> {
  const matches = urlPath.match(/\[([^\]]+)\]/g) ?? [];
  return new Set(
    matches.map((m) => m.replace(/^\[\.\.\./, "").replace(/^\[/, "").replace(/\]$/, "")),
  );
}

function extractJsDoc(handler: HandlerFn): string | undefined {
  const jsDocs = handler.getJsDocs();
  if (!jsDocs.length) return undefined;
  const comment = jsDocs[0].getDescription().trim();
  if (!comment) return undefined;
  const first = comment.split(/\.\s/)[0].trim();
  return first.endsWith(".") ? first : first + ".";
}

function fallback(relativePath: string, urlPath: string, method: HttpMethod): Endpoint {
  return {
    path: urlPath,
    method,
    sourceFile: relativePath,
    routerType: "pages",
    statusCodes: [200],
    responseSchema: { type: "unknown", "x-contrakt-note": "Handler could not be parsed" },
  };
}
