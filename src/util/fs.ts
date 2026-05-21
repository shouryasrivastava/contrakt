import { existsSync, readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

export function exists(filePath: string): boolean {
  return existsSync(filePath);
}

export function readJson<T = unknown>(filePath: string): T {
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export function writeJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function findFiles(cwd: string, pattern: RegExp): string[] {
  const results: string[] = [];
  walk(cwd, pattern, results);
  return results.map((f) => relative(cwd, f));
}

function walk(dir: string, pattern: RegExp, acc: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git" || entry === ".next") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, pattern, acc);
    } else if (pattern.test(full)) {
      acc.push(full);
    }
  }
}
