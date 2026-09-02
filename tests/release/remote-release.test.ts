import { describe, expect, it } from "vitest";

import {
  inspectArchiveEntries,
  remoteCommandEnvironment,
  verifyRemoteSnapshot,
} from "../../tools/verify-remote-release.mjs";

const sha = (value: string) => value.repeat(40);
const human = { name: "Release Owner", email: "owner@example.test" };

type IdentityFixture = { name: string; email: string };
type CommitFixture = {
  sha: string;
  parents: string[];
  reachableFromMain: boolean;
  author: IdentityFixture;
  committer: IdentityFixture;
  message: string;
  trailers: string[];
  paths: string[];
  signature: string;
};
type RemoteSnapshotFixture = {
  expectedSha: string;
  human: IdentityFixture;
  refs: { name: string; sha: string }[];
  commits: CommitFixture[];
  runs: {
    id: number;
    sha: string;
    status: string;
    conclusion: string;
    logsScanned: boolean;
    artifactIds: number[];
  }[];
  artifacts: {
    id: number;
    runId: number;
    scanned: boolean;
    findingCount: number;
  }[];
};

function validSnapshot(): RemoteSnapshotFixture {
  return {
    expectedSha: sha("a"),
    human,
    refs: [{ name: "refs/heads/main", sha: sha("a") }],
    commits: [
      {
        sha: sha("a"),
        parents: [],
        reachableFromMain: true,
        author: { ...human },
        committer: { ...human },
        message: "feat: release atlas",
        trailers: [],
        paths: ["src/pages/index.astro"],
        signature: "valid",
      },
    ],
    runs: [
      {
        id: 1,
        sha: sha("a"),
        status: "completed",
        conclusion: "success",
        logsScanned: true,
        artifactIds: [7],
      },
    ],
    artifacts: [{ id: 7, runId: 1, scanned: true, findingCount: 0 }],
  };
}

describe("remote release snapshot", () => {
  it("accepts a complete exact-SHA human-owned public topology", () => {
    expect(verifyRemoteSnapshot(validSnapshot())).toMatchObject({
      ok: true,
      mainSha: sha("a"),
      refCount: 1,
      commitCount: 1,
      findingCount: 0,
    });
  });

  it.each([
    [
      "hidden ref",
      (value: ReturnType<typeof validSnapshot>) =>
        value.refs.push({ name: "refs/hidden/x", sha: sha("a") }),
      "REMOTE_REF_UNEXPECTED",
    ],
    [
      "wrong main",
      (value: ReturnType<typeof validSnapshot>) => {
        value.refs[0]!.sha = sha("b");
      },
      "REMOTE_MAIN_SHA_MISMATCH",
    ],
    [
      "human mismatch",
      (value: ReturnType<typeof validSnapshot>) => {
        value.commits[0]!.author.email = "bot@example.test";
      },
      "REMOTE_IDENTITY_INVALID",
    ],
    [
      "unscanned logs",
      (value: ReturnType<typeof validSnapshot>) => {
        value.runs[0]!.logsScanned = false;
      },
      "REMOTE_LOG_UNSCANNED",
    ],
    [
      "unscanned artifact",
      (value: ReturnType<typeof validSnapshot>) => {
        value.artifacts[0]!.scanned = false;
      },
      "REMOTE_ARTIFACT_UNSCANNED",
    ],
  ])("rejects %s", (_label, mutate, code) => {
    const value = validSnapshot();
    mutate(value);
    expect(() => verifyRemoteSnapshot(value)).toThrowError(expect.objectContaining({ code }));
  });

  it("keeps the Dependabot service class narrow and dependency-only", () => {
    const value = validSnapshot();
    value.refs.push({ name: "refs/heads/dependabot/npm_and_yarn/minor", sha: sha("b") });
    value.commits.push({
      sha: sha("b"),
      parents: [sha("a")],
      reachableFromMain: false,
      author: {
        name: "dependabot[bot]",
        email: "49699333+dependabot[bot]@users.noreply.github.com",
      },
      committer: { name: "GitHub", email: "noreply@github.com" },
      message: "Bump dependencies",
      trailers: [],
      paths: ["package.json", "package-lock.json"],
      signature: "valid",
    });
    expect(verifyRemoteSnapshot(value).identityClasses.dependabot).toBe(1);
    value.commits[1]!.paths = ["src/pages/index.astro"];
    expect(() => verifyRemoteSnapshot(value)).toThrowError(
      expect.objectContaining({ code: "REMOTE_SERVICE_PATH_INVALID" }),
    );
  });

  it("accepts only topology-bound GitHub pull merge commits as the second service class", () => {
    const value = validSnapshot();
    value.refs.push(
      { name: "refs/pull/3/head", sha: sha("b") },
      { name: "refs/pull/3/merge", sha: sha("c") },
    );
    value.commits.push(
      {
        sha: sha("b"),
        parents: [sha("a")],
        reachableFromMain: false,
        author: {
          name: "dependabot[bot]",
          email: "49699333+dependabot[bot]@users.noreply.github.com",
        },
        committer: { name: "GitHub", email: "noreply@github.com" },
        message: "Bump dependencies",
        trailers: [],
        paths: ["package-lock.json"],
        signature: "valid",
      },
      {
        sha: sha("c"),
        parents: [sha("a"), sha("b")],
        reachableFromMain: false,
        author: { ...human },
        committer: { name: "GitHub", email: "noreply@github.com" },
        message: "Merge pull request 3",
        trailers: [],
        paths: ["package-lock.json"],
        signature: "valid",
      },
    );
    expect(verifyRemoteSnapshot(value).identityClasses.githubService).toBe(1);
    value.commits[2]!.parents = [sha("b"), sha("a")];
    expect(() => verifyRemoteSnapshot(value)).toThrowError(
      expect.objectContaining({ code: "REMOTE_SERVICE_IDENTITY_INVALID" }),
    );
  });
});

describe("bounded archive inspection", () => {
  it("scans regular entries and rejects links, escapes, excess bytes, and protected bytes", () => {
    const policy = { exactPatterns: [Buffer.from("protected-value")] };
    expect(
      inspectArchiveEntries(
        [{ name: "job/log.txt", type: "file", bytes: Buffer.from("clean") }],
        policy,
      ),
    ).toEqual({ entryCount: 1, byteCount: 5, findingCount: 0 });
    for (const entry of [
      { name: "../escape", type: "file", bytes: Buffer.from("clean") },
      { name: "link", type: "symlink", bytes: Buffer.alloc(0) },
      { name: "log", type: "file", bytes: Buffer.from("protected-value") },
    ]) {
      expect(() => inspectArchiveEntries([entry], policy)).toThrow();
    }
  });
});

describe("remote command environment", () => {
  it("retains GitHub CLI config lookup without forwarding credential values", () => {
    const environment = remoteCommandEnvironment({
      PATH: "/usr/bin",
      HOME: "/controlled/home",
      GH_TOKEN: "do-not-forward",
      GITHUB_TOKEN: "do-not-forward",
      UNRELATED_VALUE: "do-not-forward",
    });

    expect(environment).toEqual({
      PATH: "/usr/bin",
      HOME: "/controlled/home",
      LANG: "C",
      LC_ALL: "C",
    });
    expect(environment).not.toHaveProperty("GH_TOKEN");
    expect(environment).not.toHaveProperty("GITHUB_TOKEN");
  });
});
