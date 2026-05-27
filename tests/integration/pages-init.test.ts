import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, cpSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInit } from "../../src/commands/init.js";
import { resetProject } from "../../src/inference/infer-endpoint.js";
import { resetPagesProject } from "../../src/inference/infer-endpoint-pages.js";
import type { Contract } from "../../src/inference/types.js";

const FIXTURE = new URL("../fixtures/sample-pages-app", import.meta.url).pathname;

function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "contrakt-pages-"));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

describe("contrakt init (Pages Router)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmp();
    resetProject();
    resetPagesProject();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects pages router and sets stack correctly", async () => {
    await runInit({ cwd: tmpDir, baseUrl: "http://localhost:3000", force: true, mcp: false });

    const contract = JSON.parse(
      readFileSync(join(tmpDir, "contrakt.lock"), "utf8"),
    ) as Contract;

    expect(contract.stack).toBe("nextjs-pages-router");
  });

  it("finds all 5 endpoints across 3 files", async () => {
    await runInit({ cwd: tmpDir, baseUrl: "http://localhost:3000", force: true, mcp: false });

    const contract = JSON.parse(
      readFileSync(join(tmpDir, "contrakt.lock"), "utf8"),
    ) as Contract;

    const paths = contract.endpoints.map((e) => `${e.method} ${e.path}`);
    expect(paths).toContain("GET /api/health");
    expect(paths).toContain("GET /api/users");
    expect(paths).toContain("POST /api/users");
    expect(paths).toContain("GET /api/users/[id]");
    expect(paths).toContain("DELETE /api/users/[id]");
    expect(contract.endpoints).toHaveLength(5);
  });

  it("marks endpoints with routerType pages", async () => {
    await runInit({ cwd: tmpDir, baseUrl: "http://localhost:3000", force: true, mcp: false });

    const contract = JSON.parse(
      readFileSync(join(tmpDir, "contrakt.lock"), "utf8"),
    ) as Contract;

    for (const ep of contract.endpoints) {
      expect(ep.routerType).toBe("pages");
    }
  });

  it("infers health response schema", async () => {
    await runInit({ cwd: tmpDir, baseUrl: "http://localhost:3000", force: true, mcp: false });

    const contract = JSON.parse(
      readFileSync(join(tmpDir, "contrakt.lock"), "utf8"),
    ) as Contract;

    const health = contract.endpoints.find((e) => e.path === "/api/health");
    expect(health).toBeDefined();
    const props = health!.responseSchema?.["properties"] as Record<string, unknown>;
    expect(props).toHaveProperty("status");
  });

  it("infers POST request body from type cast", async () => {
    await runInit({ cwd: tmpDir, baseUrl: "http://localhost:3000", force: true, mcp: false });

    const contract = JSON.parse(
      readFileSync(join(tmpDir, "contrakt.lock"), "utf8"),
    ) as Contract;

    const post = contract.endpoints.find((e) => e.path === "/api/users" && e.method === "POST");
    expect(post).toBeDefined();
    expect(post!.requestSchema?.["type"]).toBe("object");
    const props = post!.requestSchema?.["properties"] as Record<string, unknown>;
    expect(props).toHaveProperty("name");
    expect(props).toHaveProperty("email");
  });

  it("infers path params on /api/users/[id]", async () => {
    await runInit({ cwd: tmpDir, baseUrl: "http://localhost:3000", force: true, mcp: false });

    const contract = JSON.parse(
      readFileSync(join(tmpDir, "contrakt.lock"), "utf8"),
    ) as Contract;

    const single = contract.endpoints.find(
      (e) => e.path === "/api/users/[id]" && e.method === "GET",
    );
    expect(single?.pathParams?.["properties"]).toHaveProperty("id");
  });

  it("infers query params on GET /api/users", async () => {
    await runInit({ cwd: tmpDir, baseUrl: "http://localhost:3000", force: true, mcp: false });

    const contract = JSON.parse(
      readFileSync(join(tmpDir, "contrakt.lock"), "utf8"),
    ) as Contract;

    const list = contract.endpoints.find((e) => e.path === "/api/users" && e.method === "GET");
    expect(list?.querySchema?.["properties"]).toHaveProperty("page");
  });

  it("generates valid MCP config with 5 tools", async () => {
    await runInit({ cwd: tmpDir, baseUrl: "http://localhost:3000", force: true, mcp: true });

    const serverSrc = readFileSync(join(tmpDir, ".contrakt", "contrakt-mcp-server.ts"), "utf8");
    const toolMatches = [...serverSrc.matchAll(/"name":\s*"(get_|post_|delete_)[^"]+"/g)];
    expect(toolMatches).toHaveLength(5);
  });
});
