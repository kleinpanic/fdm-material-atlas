import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  advanceReleaseEvidence,
  parseReleaseEvidence,
  startFreshReleaseCycle,
  writeReleaseEvidence,
} from "../../tools/lib/release-evidence.mjs";
import { readProtectedPolicyFromFd } from "../../tools/lib/protected-policy-input.mjs";
import { DIGEST, SHA } from "./fixtures";

export function draft() {
  return startFreshReleaseCycle({
    cycleId: "release-20260901-01",
    commitSha: SHA,
    startedAt: "2026-09-01T18:00:00.000Z",
    reason: "candidate-updated",
    priorVerifiedCycle: null,
  });
}

describe("release evidence boundary", () => {
  it("starts a clean draft and round-trips deterministically", () => {
    const value = draft();
    expect(value).toEqual({
      schemaVersion: 1,
      cycleId: "release-20260901-01",
      stage: "draft",
      commitSha: SHA,
      startedAt: "2026-09-01T18:00:00.000Z",
      reason: "candidate-updated",
      priorVerifiedCycle: null,
    });
    expect(parseReleaseEvidence(JSON.parse(JSON.stringify(value)))).toEqual(value);
  });

  it("requires a different SHA and verified digest when superseding a cycle", () => {
    expect(() =>
      startFreshReleaseCycle({
        cycleId: "release-20260901-02",
        commitSha: SHA,
        startedAt: "2026-09-01T19:00:00.000Z",
        reason: "source-change",
        priorVerifiedCycle: { commitSha: SHA, digest: DIGEST },
      }),
    ).toThrowError(expect.objectContaining({ code: "RELEASE_CYCLE_SHA_REUSED" }));
    expect(() =>
      startFreshReleaseCycle({
        cycleId: "release-20260901-02",
        commitSha: "e".repeat(40),
        startedAt: "2026-09-01T19:00:00.000Z",
        reason: "source-change",
        priorVerifiedCycle: { commitSha: SHA, digest: DIGEST },
        live: { status: "passed" },
      } as never),
    ).toThrowError(expect.objectContaining({ code: "RELEASE_EVIDENCE_UNKNOWN_KEY" }));
  });

  it("rejects stage skips, regressions, SHA drift, unknown keys, and raw diagnostics", () => {
    expect(() =>
      advanceReleaseEvidence(draft(), { stage: "published", observation: {} }),
    ).toThrowError(expect.objectContaining({ code: "RELEASE_STAGE_ORDER_INVALID" }));
    expect(() => parseReleaseEvidence({ ...draft(), stage: "verified" })).toThrowError(
      expect.objectContaining({ code: "RELEASE_EVIDENCE_MISSING" }),
    );
    expect(() => parseReleaseEvidence({ ...draft(), stdout: "secret-value" })).toThrowError(
      expect.objectContaining({ code: "RELEASE_EVIDENCE_UNKNOWN_KEY" }),
    );
    expect(() =>
      advanceReleaseEvidence(draft(), {
        stage: "candidate",
        commitSha: "f".repeat(40),
        observation: {},
      } as never),
    ).toThrowError(expect.objectContaining({ code: "RELEASE_EVIDENCE_UNKNOWN_KEY" }));
  });

  it("reads a closed protected policy through a bounded positional descriptor", async () => {
    const directory = await mkdtemp(join(tmpdir(), "atlas-policy-"));
    const file = join(directory, "policy.json");
    await writeFile(
      file,
      JSON.stringify({ schemaVersion: 1, exactPatterns: ["private-locator", "private-id"] }),
      { mode: 0o600 },
    );
    const { open } = await import("node:fs/promises");
    const handle = await open(file, "r");
    try {
      const before = await handle.read(Buffer.alloc(1), 0, 1, 0);
      const result = await readProtectedPolicyFromFd({ fd: handle.fd, synthetic: true });
      const after = await handle.read(Buffer.alloc(1), 0, 1, 0);
      expect(result.exactPatterns.map((item) => item.toString("utf8"))).toEqual([
        "private-locator",
        "private-id",
      ]);
      expect(before.bytesRead).toBe(1);
      expect(after.bytesRead).toBe(1);
    } finally {
      await handle.close();
    }
  });

  it("rejects unsafe policy modes without echoing rejected content", async () => {
    const directory = await mkdtemp(join(tmpdir(), "atlas-policy-"));
    const file = join(directory, "policy.json");
    const rejected = "do-not-echo-this-pattern";
    await writeFile(file, JSON.stringify({ schemaVersion: 1, exactPatterns: [rejected] }));
    await chmod(file, 0o644);
    const { open } = await import("node:fs/promises");
    const handle = await open(file, "r");
    try {
      let message = "";
      await readProtectedPolicyFromFd({ fd: handle.fd, synthetic: true }).catch((error) => {
        message = String(error);
      });
      expect(message).toContain("PROTECTED_POLICY_MODE_INVALID");
      expect(message).not.toContain(rejected);
    } finally {
      await handle.close();
    }
  });

  it("writes parsed evidence atomically only to an ignored untracked destination", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-evidence-"));
    await writeFile(join(root, ".gitignore"), "release.json\n");
    const { execFile } = await import("node:child_process");
    await new Promise<void>((resolve, reject) =>
      execFile("git", ["init", "-q"], { cwd: root }, (error) =>
        error ? reject(error) : resolve(),
      ),
    );
    const destination = join(root, "release.json");
    await writeReleaseEvidence(destination, draft(), { root });
    expect(JSON.parse(await readFile(destination, "utf8"))).toEqual(draft());
    expect((await stat(destination)).mode & 0o777).toBe(0o600);
    await expect(
      writeReleaseEvidence(join(root, "tracked.json"), draft(), { root }),
    ).rejects.toMatchObject({
      code: "RELEASE_EVIDENCE_DESTINATION_UNSAFE",
    });
  });
});
