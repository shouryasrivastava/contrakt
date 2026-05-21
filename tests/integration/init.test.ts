import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, cpSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInit } from "../../src/commands/init.js";
import type { Contract } from "../../src/inference/types.js";
import { resetProject } from "../../src/inference/infer-endpoint.js";

const FIXTURE = new URL("../fixtures/sample-nextjs-app", import.meta.url).pathname;

function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "contrakt-test-"));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

describe("contrakt init", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmp();
    resetProject();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes contrakt.lock with all endpoints", async () => {
    await runInit({ cwd: tmpDir, baseUrl: "http://localhost:3000", force: true, mcp: false });

    const lockPath = join(tmpDir, "contrakt.lock");
    expect(existsSync(lockPath)).toBe(true);

    const contract = JSON.parse(readFileSync(lockPath, "utf8")) as Contract;
    expect(contract.stack).toBe("nextjs-app-router");
    expect(contract.schemaSyncVersion).toBe("0.1.0");

    const paths = contract.endpoints.map((e) => `${e.method} ${e.path}`);
    expect(paths).toContain("GET /api/health");
    expect(paths).toContain("GET /api/users");
    expect(paths).toContain("POST /api/users");
    expect(paths).toContain("GET /api/users/[id]");
    expect(paths).toContain("DELETE /api/users/[id]");
    expect(contract.endpoints).toHaveLength(5);
  });

  it("infers health endpoint response schema", async () => {
    await runInit({ cwd: tmpDir, baseUrl: "http://localhost:3000", force: true, mcp: false });

    const contract = JSON.parse(
      readFileSync(join(tmpDir, "contrakt.lock"), "utf8"),
    ) as Contract;

    const health = contract.endpoints.find((e) => e.path === "/api/health" && e.method === "GET");
    expect(health).toBeDefined();
    expect(health!.statusCodes).toContain(200);
    expect(health!.responseSchema).toBeDefined();

    const props = health!.responseSchema?.["properties"] as Record<string, unknown>;
    expect(props).toHaveProperty("status");
  });

  it("infers POST /api/users request schema from type cast", async () => {
    await runInit({ cwd: tmpDir, baseUrl: "http://localhost:3000", force: true, mcp: false });

    const contract = JSON.parse(
      readFileSync(join(tmpDir, "contrakt.lock"), "utf8"),
    ) as Contract;

    const post = contract.endpoints.find((e) => e.path === "/api/users" && e.method === "POST");
    expect(post).toBeDefined();
    expect(post!.requestSchema).toBeDefined();
    expect(post!.requestSchema?.["type"]).toBe("object");
    const props = post!.requestSchema?.["properties"] as Record<string, unknown>;
    expect(props).toHaveProperty("name");
    expect(props).toHaveProperty("email");
  });

  it("infers query params on GET /api/users", async () => {
    await runInit({ cwd: tmpDir, baseUrl: "http://localhost:3000", force: true, mcp: false });

    const contract = JSON.parse(
      readFileSync(join(tmpDir, "contrakt.lock"), "utf8"),
    ) as Contract;

    const list = contract.endpoints.find((e) => e.path === "/api/users" && e.method === "GET");
    expect(list).toBeDefined();
    const queryProps = list!.querySchema?.["properties"] as Record<string, unknown> | undefined;
    expect(queryProps).toHaveProperty("page");
    expect(queryProps).toHaveProperty("limit");
  });

  it("infers path params on GET /api/users/[id]", async () => {
    await runInit({ cwd: tmpDir, baseUrl: "http://localhost:3000", force: true, mcp: false });

    const contract = JSON.parse(
      readFileSync(join(tmpDir, "contrakt.lock"), "utf8"),
    ) as Contract;

    const single = contract.endpoints.find(
      (e) => e.path === "/api/users/[id]" && e.method === "GET",
    );
    expect(single).toBeDefined();
    const pathProps = single!.pathParams?.["properties"] as Record<string, unknown> | undefined;
    expect(pathProps).toHaveProperty("id");
  });

  it("writes schemasync.config.json", async () => {
    await runInit({ cwd: tmpDir, baseUrl: "http://localhost:9000", force: true, mcp: false });

    const configPath = join(tmpDir, "contrakt.config.json");
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config.baseUrl).toBe("http://localhost:9000");
  });
});
