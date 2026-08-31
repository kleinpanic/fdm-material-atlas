import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const cli = join(repositoryRoot, "tools/preflight-trusted-context.ts");
const temporaryPaths: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "atlas-context-"));
  temporaryPaths.push(directory);
  return directory;
}

function run(
  mode: "--audit" | "--publication",
  value: string | undefined,
): ReturnType<typeof spawnSync> {
  const env = { ...process.env };
  delete env.FDM_MATERIALS_AUDIT_DIR;
  delete env.FDM_PUBLICATION_SENSITIVE_FILE;
  if (value !== undefined) {
    env[mode === "--audit" ? "FDM_MATERIALS_AUDIT_DIR" : "FDM_PUBLICATION_SENSITIVE_FILE"] = value;
  }
  return spawnSync(process.execPath, ["--experimental-strip-types", cli, mode], {
    cwd: repositoryRoot,
    env,
    encoding: "utf8",
  });
}

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("trusted external context preflight", () => {
  it("accepts only an external physical directory for audit access", async () => {
    const directory = await temporaryDirectory();
    const result = run("--audit", directory);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ ok: true, mode: "audit" });
    expect(`${result.stdout}${result.stderr}`).not.toContain(directory);
  });

  it("accepts only an external physical regular file for publication patterns", async () => {
    const directory = await temporaryDirectory();
    const file = join(directory, "patterns");
    await writeFile(file, "synthetic-sensitive-marker\n", { mode: 0o600 });

    const result = run("--publication", file);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ ok: true, mode: "publication" });
    expect(`${result.stdout}${result.stderr}`).not.toContain(file);
  });

  it.each([
    ["--audit", undefined, "TRUSTED_INPUT_UNSET"],
    ["--audit", "relative-audit", "TRUSTED_INPUT_RELATIVE"],
    ["--publication", undefined, "TRUSTED_INPUT_UNSET"],
    ["--publication", "relative-patterns", "TRUSTED_INPUT_RELATIVE"],
  ] as const)("fails closed for absent or relative %s input", (mode, value, code) => {
    const result = run(mode, value);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({ ok: false, code });
    if (value !== undefined) expect(`${result.stdout}${result.stderr}`).not.toContain(value);
  });

  it("rejects wrong types without disclosing either configured path", async () => {
    const directory = await temporaryDirectory();
    const file = join(directory, "audit-file");
    await writeFile(file, "synthetic");

    const audit = run("--audit", file);
    const publication = run("--publication", directory);

    expect(JSON.parse(audit.stderr)).toEqual({ ok: false, code: "TRUSTED_INPUT_TYPE_INVALID" });
    expect(JSON.parse(publication.stderr)).toEqual({ ok: false, code: "TRUSTED_INPUT_TYPE_INVALID" });
    expect(`${audit.stdout}${audit.stderr}`).not.toContain(file);
    expect(`${publication.stdout}${publication.stderr}`).not.toContain(directory);
  });

  it("rejects repository-contained inputs after physical resolution", async () => {
    const inside = join(repositoryRoot, ".planning", "synthetic-preflight-directory");
    await mkdir(inside, { recursive: true });
    temporaryPaths.push(inside);

    const direct = run("--audit", inside);
    expect(JSON.parse(direct.stderr)).toEqual({ ok: false, code: "TRUSTED_INPUT_INSIDE_REPOSITORY" });
    expect(`${direct.stdout}${direct.stderr}`).not.toContain(inside);

    const outside = await temporaryDirectory();
    const link = join(outside, "linked-audit");
    await symlink(inside, link);
    const linked = run("--audit", link);
    expect(JSON.parse(linked.stderr)).toEqual({ ok: false, code: "TRUSTED_INPUT_INSIDE_REPOSITORY" });
    expect(`${linked.stdout}${linked.stderr}`).not.toContain(link);
  });

  it("reports unreadable inputs with one redacted stable code", async () => {
    const directory = await temporaryDirectory();
    const missing = join(directory, "missing");
    const result = run("--publication", missing);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({ ok: false, code: "TRUSTED_INPUT_UNREADABLE" });
    expect(`${result.stdout}${result.stderr}`).not.toContain(missing);

    // Keep cleanup reliable if future cases make the directory unreadable.
    await chmod(directory, 0o700);
  });
});
