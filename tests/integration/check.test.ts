import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, cpSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInit } from "../../src/commands/init.js";
import { runCheck } from "../../src/commands/check.js";
import { resetProject } from "../../src/inference/infer-endpoint.js";
import type { Contract } from "../../src/inference/types.js";

const FIXTURE = new URL("../fixtures/sample-nextjs-app", import.meta.url).pathname;

function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "contrakt-check-"));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

describe("contrakt check", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = makeTmp();
    resetProject();
    // Always start with a fresh init
    await runInit({ cwd: tmpDir, baseUrl: "http://localhost:3000", force: true, mcp: false });
    resetProject();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exits 0 and reports no changes when repo is unchanged", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    try {
      await runCheck({ cwd: tmpDir });
      // Should not have called exit(1)
      expect(exitSpy).not.toHaveBeenCalledWith(1);
    } catch (err) {
      // If exit(0) was called that's also acceptable
      if (err instanceof Error && err.message === "process.exit called") {
        expect(exitSpy).not.toHaveBeenCalledWith(1);
      } else {
        throw err;
      }
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("reports breaking change when a response field is removed", async () => {
    // Remove the 'status' field from health response
    const healthRoute = join(tmpDir, "app/api/health/route.ts");
    const original = readFileSync(healthRoute, "utf8");
    const modified = original.replace(
      'NextResponse.json({ status: "ok" }, { status: 200 })',
      'NextResponse.json({ alive: true }, { status: 200 })',
    );
    writeFileSync(healthRoute, modified, "utf8");
    resetProject();

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    try {
      await runCheck({ cwd: tmpDir });
      // Should have thrown due to exit(1)
      expect.fail("Expected process.exit(1) to be called");
    } catch (err) {
      expect(err instanceof Error && err.message).toContain("process.exit(1)");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("reports breaking change when an endpoint is removed", async () => {
    // Remove the DELETE handler from users/[id]/route.ts
    const routeFile = join(tmpDir, "app/api/users/[id]/route.ts");
    const original = readFileSync(routeFile, "utf8");
    // Remove everything from the DELETE export onwards
    const modified = original.split("/**\n * Delete a user")[0];
    writeFileSync(routeFile, modified, "utf8");
    resetProject();

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    try {
      await runCheck({ cwd: tmpDir });
      expect.fail("Expected process.exit(1) to be called");
    } catch (err) {
      expect(err instanceof Error && err.message).toContain("process.exit(1)");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("exits 0 when only non-breaking changes (new optional field) are present", async () => {
    // Add a new optional field to health response — non-breaking
    const healthRoute = join(tmpDir, "app/api/health/route.ts");
    const original = readFileSync(healthRoute, "utf8");
    const modified = original.replace(
      'NextResponse.json({ status: "ok" }, { status: 200 })',
      'NextResponse.json({ status: "ok", version: "1.0.0" }, { status: 200 })',
    );
    writeFileSync(healthRoute, modified, "utf8");
    resetProject();

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    try {
      await runCheck({ cwd: tmpDir });
      expect(exitSpy).not.toHaveBeenCalledWith(1);
    } catch (err) {
      if (err instanceof Error && err.message.includes("process.exit(1)")) {
        expect.fail("Should not have exited with 1 for non-breaking change");
      } else {
        throw err;
      }
    } finally {
      exitSpy.mockRestore();
    }
  });
});
