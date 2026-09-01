import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

function listMode(mode: string, values: Record<string, string> = {}) {
  const env = { ...process.env };
  delete env.ATLAS_PAGES_ARTIFACT;
  delete env.ATLAS_PAGES_BASE;
  Object.assign(env, { ATLAS_TEST_MODE: mode }, values);

  return spawnSync(
    "npm",
    ["exec", "--no", "--", "playwright", "test", "tests/e2e/accessibility.spec.ts", "--list"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
      timeout: 30_000,
    },
  );
}

describe("Playwright deployment-mode boundary", () => {
  it.each(["root", "repository"])("loads the %s suite without Pages-only inputs", (mode) => {
    const result = listMode(mode);

    expect(result.error).toBeUndefined();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Total: 4 tests in 1 file");
  });

  it.each([
    [{ ATLAS_PAGES_ARTIFACT: "dist-pages" }, "ATLAS_PAGES_BASE_INVALID"],
    [{ ATLAS_PAGES_ARTIFACT: "dist-pages", ATLAS_PAGES_BASE: "/../" }, "ATLAS_PAGES_BASE_INVALID"],
    [
      { ATLAS_PAGES_ARTIFACT: "dist", ATLAS_PAGES_BASE: "/fdm-material-atlas/" },
      "ATLAS_PAGES_ARTIFACT_INVALID",
    ],
  ])("rejects an unsafe Pages descriptor with %s", (values, code) => {
    const result = listMode("pages", values);

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(code);
  });
});
