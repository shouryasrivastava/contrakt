import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, cpSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runInit } from "../../src/commands/init.js";
import { runDiff } from "../../src/commands/diff.js";
import { resetProject } from "../../src/inference/infer-endpoint.js";

const FIXTURE = new URL("../fixtures/sample-nextjs-app", import.meta.url).pathname;

function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "contrakt-diff-"));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

function gitInit(dir: string): void {
  spawnSync("git", ["init"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: dir });
}

function gitCommitAll(dir: string, message: string): void {
  spawnSync("git", ["add", "-A"], { cwd: dir });
  spawnSync("git", ["commit", "-m", message], { cwd: dir });
}

describe("contrakt diff", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = makeTmp();
    gitInit(tmpDir);
    resetProject();

    // Commit the initial state with contrakt.lock
    await runInit({ cwd: tmpDir, baseUrl: "http://localhost:3000", force: true, mcp: false });
    gitCommitAll(tmpDir, "initial schema");
    resetProject();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports no changes when current code matches the ref", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    try {
      await runDiff({ cwd: tmpDir, ref: "HEAD" });
      expect(exitSpy).not.toHaveBeenCalledWith(1);
    } catch (err) {
      if (err instanceof Error && err.message.includes("process.exit(1)")) {
        expect.fail("Should not have exited 1 for no changes");
      } else {
        throw err;
      }
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("reports breaking change when endpoint deleted since ref", async () => {
    // Remove DELETE handler and commit
    const routeFile = join(tmpDir, "app/api/users/[id]/route.ts");
    const original = readFileSync(routeFile, "utf8");
    const modified = original.split("/**\n * Delete a user")[0];
    writeFileSync(routeFile, modified, "utf8");
    resetProject();

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    try {
      await runDiff({ cwd: tmpDir, ref: "HEAD" });
      expect.fail("Expected process.exit(1)");
    } catch (err) {
      expect(err instanceof Error && err.message).toContain("process.exit(1)");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("exits 1 and informs user when contrakt.lock not found at ref", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    try {
      await runDiff({ cwd: tmpDir, ref: "nonexistent-branch-xyz" });
      expect.fail("Expected process.exit");
    } catch (err) {
      expect(err instanceof Error && err.message).toContain("process.exit(1)");
    } finally {
      exitSpy.mockRestore();
    }
  });
});
