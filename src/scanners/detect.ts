import { existsSync } from "node:fs";
import { join } from "node:path";

export type RouterPresence = "app" | "pages" | "hybrid" | "none";

export function detectRouter(cwd: string): RouterPresence {
  const hasApp = existsSync(join(cwd, "app", "api"));
  const hasPages = existsSync(join(cwd, "pages", "api"));

  if (hasApp && hasPages) return "hybrid";
  if (hasApp) return "app";
  if (hasPages) return "pages";
  return "none";
}
