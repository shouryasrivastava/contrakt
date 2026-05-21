import {
  Node,
  SyntaxKind,
  type Project,
  type FunctionDeclaration,
  type ArrowFunction,
  type FunctionExpression,
} from "ts-morph";
import type { Endpoint, HttpMethod } from "./types.js";
import { inferRequestSchema, inferQuerySchema, inferPathParams } from "./infer-request.js";
import { inferResponseSchema } from "./infer-response.js";
import { createProject, resolveImports } from "./create-project.js";
import { log } from "../util/logger.js";

type HandlerFn = FunctionDeclaration | ArrowFunction | FunctionExpression;

let sharedProject: Project | null = null;

function getProject(cwd: string): Project {
  if (!sharedProject) {
    sharedProject = createProject(cwd);
  }
  return sharedProject;
}

export function resetProject(): void {
  sharedProject = null;
}

/**
 * Infer a single Endpoint for a given route file + HTTP method.
 */
export function inferEndpoint(
  absolutePath: string,
  relativePath: string,
  urlPath: string,
  method: HttpMethod,
  cwd: string,
): Endpoint {
  const project = getProject(cwd);

  // Add the file if not already added
  let sourceFile = project.getSourceFile(absolutePath);
  if (!sourceFile) {
    try {
      sourceFile = project.addSourceFileAtPath(absolutePath);
      resolveImports(project);
    } catch (err) {
      log.debug(`Could not add source file ${absolutePath}: ${err}`);
      return buildFallbackEndpoint(relativePath, urlPath, method);
    }
  }

  const result = findHandlerFunction(sourceFile, method);
  if (!result.found) {
    if (result.reason === "wrapper") {
      log.warn(
        `Detected wrapped handler (${result.wrapperText}()) for ${method} ${urlPath} in ${relativePath} — schema inference skipped. ` +
          `Export a plain function for full inference. See docs.`,
      );
      return buildFallbackEndpoint(relativePath, urlPath, method, "wrapper-pattern");
    }
    log.debug(`No handler found for ${method} in ${relativePath}`);
    return buildFallbackEndpoint(relativePath, urlPath, method);
  }

  const handler = result.handler;
  const description = extractJsDocDescription(handler);
  const requestSchema = method !== "GET" && method !== "DELETE"
    ? inferRequestSchema(handler, project)
    : undefined;
  const querySchema = inferQuerySchema(handler);
  const pathParams = inferPathParams(urlPath);
  const { schema: responseSchema, statusCodes } = inferResponseSchema(handler, project);

  return {
    path: urlPath,
    method,
    sourceFile: relativePath,
    requestSchema,
    querySchema,
    pathParams,
    responseSchema,
    statusCodes,
    description,
  };
}

export type FindHandlerResult =
  | { found: true; handler: HandlerFn }
  | { found: false; reason: "not-found" | "wrapper"; wrapperText?: string };

export function findHandlerFunction(
  sourceFile: import("ts-morph").SourceFile,
  method: HttpMethod,
): FindHandlerResult {
  // export async function GET(...) { ... }
  const fnDecl = sourceFile.getFunctions().find((f) => f.getName() === method && f.isExported());
  if (fnDecl) return { found: true, handler: fnDecl };

  // export const GET = ...
  for (const varDecl of sourceFile.getVariableDeclarations()) {
    if (varDecl.getName() !== method) continue;
    const parent = varDecl.getParent()?.getParent();
    if (!parent) continue;
    if (!Node.isVariableStatement(parent) || !parent.isExported()) continue;

    const init = varDecl.getInitializer();
    if (!init) continue;

    // export const GET = async (...) => { ... }
    if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
      return { found: true, handler: init };
    }

    // export const GET = withAuth(handler) — wrapper pattern
    if (Node.isCallExpression(init)) {
      return { found: false, reason: "wrapper", wrapperText: init.getExpression().getText() };
    }
  }

  return { found: false, reason: "not-found" };
}

function extractJsDocDescription(handler: HandlerFn): string | undefined {
  const jsDocs = handler.getJsDocs();
  if (!jsDocs.length) return undefined;

  const comment = jsDocs[0].getDescription().trim();
  if (!comment) return undefined;

  // Return only the first sentence
  const firstSentence = comment.split(/\.\s/)[0].trim();
  return firstSentence.endsWith(".") ? firstSentence : firstSentence + ".";
}

function buildFallbackEndpoint(
  relativePath: string,
  urlPath: string,
  method: HttpMethod,
  reason?: string,
): Endpoint {
  const note =
    reason === "wrapper-pattern"
      ? "Handler is a wrapped export (e.g. withAuth(fn)) — export a plain function for full inference"
      : "Handler could not be parsed";
  return {
    path: urlPath,
    method,
    sourceFile: relativePath,
    statusCodes: [200],
    requestSchema: undefined,
    responseSchema: {
      type: "unknown",
      "x-contrakt-note": note,
    },
  };
}
