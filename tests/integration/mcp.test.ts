import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, cpSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInit } from "../../src/commands/init.js";
import { runMcp } from "../../src/commands/mcp.js";
import { resetProject } from "../../src/inference/infer-endpoint.js";

const FIXTURE = new URL("../fixtures/sample-nextjs-app", import.meta.url).pathname;

function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "contrakt-mcp-"));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

describe("contrakt mcp", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = makeTmp();
    resetProject();
    await runInit({ cwd: tmpDir, baseUrl: "http://localhost:3000", force: true, mcp: false });
    resetProject();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates mcp.json and contrakt-mcp-server.ts", async () => {
    await runMcp({ cwd: tmpDir });

    expect(existsSync(join(tmpDir, ".contrakt", "mcp.json"))).toBe(true);
    expect(existsSync(join(tmpDir, ".contrakt", "contrakt-mcp-server.ts"))).toBe(true);
  });

  it("mcp.json has mcpServers key", async () => {
    await runMcp({ cwd: tmpDir });

    const config = JSON.parse(readFileSync(join(tmpDir, ".contrakt", "mcp.json"), "utf8"));
    expect(config).toHaveProperty("mcpServers");
    const servers = Object.values(config.mcpServers) as Array<Record<string, unknown>>;
    expect(servers).toHaveLength(1);
    expect(servers[0]).toHaveProperty("command", "tsx");
  });

  it("generated server has one tool per endpoint method", async () => {
    await runMcp({ cwd: tmpDir });

    const serverSrc = readFileSync(join(tmpDir, ".contrakt", "contrakt-mcp-server.ts"), "utf8");

    // 5 endpoints: GET /api/health, GET+POST /api/users, GET+DELETE /api/users/[id]
    const toolMatches = [...serverSrc.matchAll(/"name":\s*"(get_|post_|put_|patch_|delete_)[^"]+"/g)];
    expect(toolMatches).toHaveLength(5);
  });

  it("respects --base-url flag override", async () => {
    await runMcp({ cwd: tmpDir, baseUrl: "https://staging.example.com" });

    const serverSrc = readFileSync(join(tmpDir, ".contrakt", "contrakt-mcp-server.ts"), "utf8");
    expect(serverSrc).toContain("https://staging.example.com");

    const mcpJson = JSON.parse(readFileSync(join(tmpDir, ".contrakt", "mcp.json"), "utf8"));
    const server = Object.values(mcpJson.mcpServers)[0] as Record<string, unknown>;
    expect((server["env"] as Record<string, string>)["CONTRAKT_BASE_URL"]).toBe(
      "https://staging.example.com",
    );
  });

  it("generated server reads CONTRAKT_BASE_URL env var", async () => {
    await runMcp({ cwd: tmpDir, baseUrl: "http://localhost:3000" });

    const serverSrc = readFileSync(join(tmpDir, ".contrakt", "contrakt-mcp-server.ts"), "utf8");
    expect(serverSrc).toContain("process.env.CONTRAKT_BASE_URL");
  });
});
