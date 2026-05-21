import { join } from "node:path";
import { writeJson } from "../util/fs.js";
import type { Contract } from "../inference/types.js";

export const LOCKFILE_NAME = "contrakt.lock";

export function writeLockfile(cwd: string, contract: Contract): void {
  writeJson(join(cwd, LOCKFILE_NAME), contract);
}
