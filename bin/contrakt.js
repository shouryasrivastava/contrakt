#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..");
const tsx = join(packageRoot, "node_modules", ".bin", "tsx");
const entry = join(__dirname, "contrakt.ts");

const result = spawnSync(tsx, [entry, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(result.status ?? 0);
