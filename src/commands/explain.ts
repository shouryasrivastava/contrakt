import Anthropic from "@anthropic-ai/sdk";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import pc from "picocolors";
import { log } from "../util/logger.js";
import type { DiffResult } from "../inference/types.js";

const CONSUMER_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".next", "build", "out", ".turbo"]);

function* walkFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walkFiles(join(dir, entry.name));
    } else if (CONSUMER_EXTENSIONS.has(extname(entry.name))) {
      yield join(dir, entry.name);
    }
  }
}

interface ConsumerRef {
  file: string;
  line: number;
  text: string;
}

function findConsumers(cwd: string, fieldName: string): ConsumerRef[] {
  const refs: ConsumerRef[] = [];
  const pattern = new RegExp(`\\b${fieldName}\\b`);

  for (const file of walkFiles(cwd)) {
    // Skip API route files — they define the contract, not consume it
    if (file.includes(`${join("app", "api")}`) || file.includes(`${join("pages", "api")}`)) continue;
    try {
      const lines = readFileSync(file, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          refs.push({ file: relative(cwd, file), line: i + 1, text: lines[i].trim().slice(0, 120) });
          if (refs.length >= 12) return refs; // cap early
        }
      }
    } catch { /* skip unreadable files */ }
  }
  return refs;
}

function extractFieldName(message: string): string | null {
  // 'Field "response.showArchive" was removed' → "showArchive"
  const match = message.match(/"response\.([^"]+)"/);
  return match ? match[1] : null;
}

export async function explainBreaking(cwd: string, changes: DiffResult[]): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || changes.length === 0) return;

  // Only explain response-field changes — endpoint removals don't need consumer analysis
  const fieldChanges = changes.filter((c) => c.message.includes('"response.'));
  if (fieldChanges.length === 0) return;

  // Find consumer references for each changed field
  const consumerSections: string[] = [];
  for (const change of fieldChanges) {
    const fieldName = extractFieldName(change.message);
    if (!fieldName) continue;
    const refs = findConsumers(cwd, fieldName);
    if (refs.length > 0) {
      consumerSections.push(
        `Field: ${fieldName}\n${refs.map((r) => `  ${r.file}:${r.line}  ${r.text}`).join("\n")}`,
      );
    }
  }

  const changesText = fieldChanges.map((c) => `- ${c.message} [${c.method} ${c.path}]`).join("\n");
  const consumersText =
    consumerSections.length > 0
      ? `Consumer references found in codebase:\n${consumerSections.join("\n\n")}`
      : "No consumer references found in the codebase.";

  const prompt = `You are reviewing API schema drift for a Next.js app. Be direct and concise.

Breaking changes detected:
${changesText}

${consumersText}

Respond in exactly this format (skip sections that don't apply):
Impact: <which files/features will break, one sentence>
Fix: <the recommended approach, one sentence>
Steps:
1. <first step>
2. <second step>`;

  try {
    log.blank();
    log.dim("  Analyzing impact with AI...");

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    if (!text.trim()) return;

    log.blank();
    console.log(pc.bold("  AI Impact Analysis:"));
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("Impact:")) {
        console.log(`  ${pc.red("▸")} ${trimmed}`);
      } else if (trimmed.startsWith("Fix:")) {
        console.log(`  ${pc.green("▸")} ${trimmed}`);
      } else if (trimmed.startsWith("Steps:")) {
        console.log(`  ${pc.yellow("▸")} ${trimmed}`);
      } else {
        console.log(`    ${trimmed}`);
      }
    }
  } catch {
    // Non-fatal — if the API call fails, skip the explanation silently
  }
}
