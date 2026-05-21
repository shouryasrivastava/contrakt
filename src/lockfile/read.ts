import { join } from "node:path";
import { exists, readJson, writeJson } from "../util/fs.js";
import type { Contract } from "../inference/types.js";

export const LOCKFILE_NAME = "contrakt.lock";
export const CONFIG_NAME = "contrakt.config.json";

export function lockfileExists(cwd: string): boolean {
  return exists(join(cwd, LOCKFILE_NAME));
}

export function readLockfile(cwd: string): Contract {
  const path = join(cwd, LOCKFILE_NAME);
  if (!exists(path)) {
    throw new Error(`No contrakt.lock found at ${path}. Run 'contrakt init' first.`);
  }
  return readJson<Contract>(path);
}

export function readConfig(cwd: string): { baseUrl: string } | null {
  const path = join(cwd, CONFIG_NAME);
  if (!exists(path)) return null;
  return readJson<{ baseUrl: string }>(path);
}

export function writeConfig(cwd: string, config: { baseUrl: string; stack: string }): void {
  writeJson(join(cwd, CONFIG_NAME), config);
}
