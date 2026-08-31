import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const artifactPath = resolve(repositoryRoot, "src/data/public/atlas.v1.json");
const atlas = JSON.parse(readFileSync(artifactPath, "utf8")) as unknown;

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
  } else if (value !== null && typeof value === "object") {
    Object.entries(value).forEach(([key, child]) => {
      keys.add(key.replaceAll(/[-_]/gu, "").toLowerCase());
      collectKeys(child, keys);
    });
  }
  return keys;
}

describe("canonical publication boundary", () => {
  it("contains no upstream or operational metadata channels", () => {
    const keys = collectKeys(atlas);
    const forbiddenKeys = [
      "account",
      "auth",
      "candidateids",
      "candidatematerialids",
      "cellcoordinate",
      "coordinate",
      "cookie",
      "credential",
      "extractedat",
      "extractionmetadata",
      "formula",
      "generatedat",
      "locator",
      "oauth",
      "privateprovenance",
      "rawnote",
      "sourcerevision",
      "spreadsheetid",
      "spreadsheeturl",
      "token",
      "toolconfiguration",
      "toolversion",
      "workbookid",
      "workbookurl",
    ];
    for (const forbidden of forbiddenKeys) expect(keys.has(forbidden), forbidden).toBe(false);
  });

  it("preflights the mandatory external pattern file and scans all publication surfaces", () => {
    const sensitiveFile = process.env.FDM_PUBLICATION_SENSITIVE_FILE;
    expect(typeof sensitiveFile).toBe("string");
    if (sensitiveFile === undefined) return;
    expect(isAbsolute(sensitiveFile)).toBe(true);
    expect(relative(repositoryRoot, sensitiveFile).startsWith("..")).toBe(true);

    const preflight = spawnSync(process.execPath, [
      "--experimental-strip-types",
      "tools/preflight-trusted-context.ts",
      "--publication",
    ], { cwd: repositoryRoot, env: process.env, encoding: "utf8" });
    expect(preflight.status).toBe(0);
    expect(JSON.parse(preflight.stdout)).toEqual({ ok: true, mode: "publication" });

    const scan = spawnSync(process.execPath, [
      "tools/check-publication.mjs",
      "--root", repositoryRoot,
      "--remote-policy", "absent",
      "--sensitive-file", sensitiveFile,
      "--artifact", "src/data/public",
    ], { cwd: repositoryRoot, env: process.env, encoding: "utf8", timeout: 120_000 });
    expect(scan.status).toBe(0);
    const report = JSON.parse(scan.stdout) as {
      ok: boolean;
      surfaces: { surface: string; findingCount: number }[];
      findings?: unknown[];
    };
    expect(report.ok).toBe(true);
    expect(report.findings ?? []).toHaveLength(0);
    expect(new Set(report.surfaces.map(({ surface }) => surface))).toEqual(
      new Set(["repository", "working", "tracked", "history", "artifact"]),
    );
    expect(report.surfaces.every(({ findingCount }) => findingCount === 0)).toBe(true);
    expect(`${scan.stdout}${scan.stderr}${preflight.stdout}${preflight.stderr}`).not.toContain(sensitiveFile);
  }, 130_000);
});
