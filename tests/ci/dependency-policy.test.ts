import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  AuditFailure,
  verifyLocalDependencyPolicy,
} from "../../tools/audit-direct-dependencies.mjs";

async function projectInputs() {
  return {
    manifest: JSON.parse(await readFile("package.json", "utf8")),
    lockfile: JSON.parse(await readFile("package-lock.json", "utf8")),
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function expectAuditCode(action: () => unknown, code: string) {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AuditFailure);
  expect((thrown as AuditFailure).code).toBe(code);
}

describe("durable direct-dependency policy", () => {
  it("accepts the committed exact manifest and lockfile", async () => {
    const { manifest, lockfile } = await projectInputs();
    expect(verifyLocalDependencyPolicy(manifest, lockfile)).toHaveLength(22);
  });

  it("accepts a consistent exact-version update without a handwritten version copy", async () => {
    const { manifest, lockfile } = await projectInputs();
    const updatedManifest = clone(manifest);
    const updatedLockfile = clone(lockfile);
    const version = "99.1.2";
    updatedManifest.devDependencies.prettier = version;
    updatedLockfile.packages[""].devDependencies.prettier = version;
    updatedLockfile.packages["node_modules/prettier"].version = version;
    updatedLockfile.packages["node_modules/prettier"].resolved =
      `https://registry.npmjs.org/prettier/-/prettier-${version}.tgz`;

    const result = verifyLocalDependencyPolicy(updatedManifest, updatedLockfile);
    expect(result.find((item) => item.name === "prettier")?.version).toBe(version);
  });

  it("rejects version ranges, unapproved packages, registries, and weak integrity", async () => {
    const { manifest, lockfile } = await projectInputs();

    const rangeManifest = clone(manifest);
    rangeManifest.devDependencies.prettier = "^3.9.6";
    expectAuditCode(
      () => verifyLocalDependencyPolicy(rangeManifest, clone(lockfile)),
      "MANIFEST_PIN_MISMATCH",
    );

    const expandedManifest = clone(manifest);
    expandedManifest.devDependencies.unreviewed = "1.0.0";
    expectAuditCode(
      () => verifyLocalDependencyPolicy(expandedManifest, clone(lockfile)),
      "DIRECT_SET_MISMATCH",
    );

    const foreignLock = clone(lockfile);
    foreignLock.packages["node_modules/prettier"].resolved =
      "https://packages.example/prettier-3.9.6.tgz";
    expectAuditCode(
      () => verifyLocalDependencyPolicy(clone(manifest), foreignLock),
      "LOCK_RESOLVED_MISMATCH",
    );

    const weakLock = clone(lockfile);
    weakLock.packages["node_modules/prettier"].integrity = "sha1-unsafe";
    expectAuditCode(
      () => verifyLocalDependencyPolicy(clone(manifest), weakLock),
      "LOCK_INTEGRITY_MISMATCH",
    );
  });
});
