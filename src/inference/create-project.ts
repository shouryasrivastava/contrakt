import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Project, type CompilerOptions } from "ts-morph";
import { ScriptTarget, ModuleKind, ModuleResolutionKind } from "typescript";
import { log } from "../util/logger.js";

/**
 * Create a ts-morph Project for the given cwd.
 * Priority: tsconfig.json → jsconfig.json → safe defaults.
 * Path aliases from either config file are extracted and passed to the
 * compiler so cross-module type resolution works (e.g. @/lib/types → ./lib/types).
 */
export function createProject(cwd: string): Project {
  const tsconfig = join(cwd, "tsconfig.json");
  const jsconfig = join(cwd, "jsconfig.json");

  if (existsSync(tsconfig)) {
    // ts-morph reads tsconfig natively — paths/baseUrl are picked up automatically
    return new Project({
      tsConfigFilePath: tsconfig,
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
    });
  }

  if (existsSync(jsconfig)) {
    log.debug(`No tsconfig.json — reading path aliases from jsconfig.json`);
    const overrides = readPathAliases(jsconfig, cwd);
    return new Project({
      compilerOptions: {
        allowJs: true,
        checkJs: false,
        strict: false,
        skipLibCheck: true,
        noEmit: true,
        ...overrides,
      },
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
    });
  }

  log.debug(`No tsconfig.json or jsconfig.json — using permissive defaults`);
  return new Project({
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      strict: false,
      skipLibCheck: true,
      noEmit: true,
    },
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
}

/**
 * Read baseUrl and paths from a tsconfig/jsconfig file and return
 * them as ts-morph CompilerOptions, with baseUrl resolved to an absolute path.
 */
function readPathAliases(
  configPath: string,
  cwd: string,
): Pick<CompilerOptions, "baseUrl" | "paths"> {
  try {
    const raw = readFileSync(configPath, "utf8");
    // Strip JSON comments (jsconfig.json allows them)
    const stripped = raw.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const parsed = JSON.parse(stripped) as {
      compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
    };

    const opts = parsed.compilerOptions ?? {};
    const result: Pick<CompilerOptions, "baseUrl" | "paths"> = {};

    if (opts.baseUrl) {
      result.baseUrl = resolve(cwd, opts.baseUrl);
      log.debug(`Path alias baseUrl: ${result.baseUrl}`);
    }

    if (opts.paths && Object.keys(opts.paths).length > 0) {
      result.paths = opts.paths;
      log.debug(`Path aliases loaded: ${Object.keys(opts.paths).join(", ")}`);
    }

    return result;
  } catch (err) {
    log.debug(`Could not read path aliases from ${configPath}: ${err}`);
    return {};
  }
}

/**
 * After adding source files to a project, call this to resolve all
 * imported files so cross-module types (e.g. @/lib/types) are available.
 * Safe to call multiple times — ts-morph deduplicates.
 */
export function resolveImports(project: Project): void {
  try {
    project.resolveSourceFileDependencies();
  } catch {
    // Non-fatal — inference continues with what's available
  }
}
