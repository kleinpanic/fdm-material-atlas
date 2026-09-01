import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  collectGitHubReleaseEvidence,
  executeGitHubReleaseStage,
  parseGitHubReleaseArguments,
  verifyGitHubRelease,
} from "../../tools/verify-github-release.mjs";
import { candidateObservationFixture, PRIOR_SHA, SHA, targetBaselineFixture } from "./fixtures.js";

const PRIOR = "1".repeat(40);
const CANDIDATE = "2".repeat(40);
const DEPENDABOT = "3".repeat(40);
const PULL_HEAD = "4".repeat(40);
const PULL_MERGE = "5".repeat(40);

function refs(main = PRIOR, merge = PULL_MERGE) {
  return [
    { name: "refs/heads/main", sha: main },
    { name: "refs/heads/dependabot/npm_and_yarn/runtime", sha: DEPENDABOT },
    { name: "refs/pull/1/head", sha: PULL_HEAD },
    { name: "refs/pull/1/merge", sha: merge },
  ];
}

function repository() {
  return {
    auth: { logins: ["atlas-owner"] },
    repository: {
      name: "fdm-material-atlas",
      owner: { login: "atlas-owner" },
      nameWithOwner: "atlas-owner/fdm-material-atlas",
      visibility: "PUBLIC",
      viewerPermission: "ADMIN",
      defaultBranchRef: { name: "main" },
    },
    origin: "git@github.com:atlas-owner/fdm-material-atlas.git",
    pages: {
      buildType: "workflow",
      httpsEnforced: true,
      status: "built",
    },
    refs: refs(),
    relation: "ancestor",
    localHeadSha: CANDIDATE,
  };
}

const expected = Object.freeze({
  repositoryName: "fdm-material-atlas",
  candidateSha: CANDIDATE,
  priorRemoteMainSha: PRIOR,
  defaultBranch: "main",
  refBaseline: refs(),
});

function prepush() {
  return verifyGitHubRelease({ stage: "existing-prepush", expected, evidence: repository() });
}

function code(mutator: (value: ReturnType<typeof repository>) => void) {
  const evidence = repository();
  mutator(evidence);
  try {
    verifyGitHubRelease({ stage: "existing-prepush", expected, evidence });
    return "NO_ERROR";
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe("authenticated established GitHub target", () => {
  it("accepts one authenticated owner and returns only controlled proof fields", () => {
    const proof = prepush();
    expect(proof).toMatchObject({
      ok: true,
      code: "GITHUB_PREPUSH_VERIFIED",
      stage: "existing-prepush",
      candidateSha: CANDIDATE,
      priorRemoteMainSha: PRIOR,
      refCount: 4,
    });
    expect(JSON.stringify(proof)).not.toContain("atlas-owner");
    expect(JSON.stringify(proof)).not.toContain("git@github.com");
  });

  it.each([
    [
      "missing auth",
      (value: ReturnType<typeof repository>) => (value.auth.logins = []),
      "GITHUB_AUTH_INVALID",
    ],
    [
      "ambiguous auth",
      (value: ReturnType<typeof repository>) => value.auth.logins.push("other"),
      "GITHUB_AUTH_INVALID",
    ],
    [
      "owner",
      (value: ReturnType<typeof repository>) => (value.repository.owner.login = "rejected-value"),
      "GITHUB_TARGET_MISMATCH",
    ],
    [
      "name",
      (value: ReturnType<typeof repository>) => (value.repository.name = "rejected-value"),
      "GITHUB_TARGET_MISMATCH",
    ],
    [
      "visibility",
      (value: ReturnType<typeof repository>) => (value.repository.visibility = "PRIVATE"),
      "GITHUB_REPOSITORY_SETTINGS_INVALID",
    ],
    [
      "permission",
      (value: ReturnType<typeof repository>) => (value.repository.viewerPermission = "WRITE"),
      "GITHUB_REPOSITORY_SETTINGS_INVALID",
    ],
    [
      "branch",
      (value: ReturnType<typeof repository>) => (value.repository.defaultBranchRef.name = "trunk"),
      "GITHUB_REPOSITORY_SETTINGS_INVALID",
    ],
    [
      "origin",
      (value: ReturnType<typeof repository>) =>
        (value.origin = "https://example.test/rejected-value"),
      "GITHUB_ORIGIN_INVALID",
    ],
    [
      "Pages mode",
      (value: ReturnType<typeof repository>) => (value.pages.buildType = "legacy"),
      "GITHUB_PAGES_SETTINGS_INVALID",
    ],
    [
      "HTTPS",
      (value: ReturnType<typeof repository>) => (value.pages.httpsEnforced = false),
      "GITHUB_PAGES_SETTINGS_INVALID",
    ],
    [
      "remote advance",
      (value: ReturnType<typeof repository>) => (value.refs[0]!.sha = "6".repeat(40)),
      "GITHUB_REMOTE_MAIN_CHANGED",
    ],
    [
      "dependency baseline drift",
      (value: ReturnType<typeof repository>) => (value.refs[1]!.sha = "6".repeat(40)),
      "GITHUB_REF_TOPOLOGY_INVALID",
    ],
    [
      "missing pull baseline",
      (value: ReturnType<typeof repository>) => value.refs.pop(),
      "GITHUB_REF_TOPOLOGY_INVALID",
    ],
    [
      "divergence",
      (value: ReturnType<typeof repository>) => (value.relation = "diverged"),
      "GITHUB_CANDIDATE_DIVERGED",
    ],
    [
      "local SHA drift",
      (value: ReturnType<typeof repository>) => (value.localHeadSha = "7".repeat(40)),
      "GITHUB_CANDIDATE_DIVERGED",
    ],
    [
      "unknown ref",
      (value: ReturnType<typeof repository>) =>
        value.refs.push({ name: "refs/heads/release", sha: PRIOR }),
      "GITHUB_REF_TOPOLOGY_INVALID",
    ],
  ])("rejects %s with a stable code", (_name, mutate, expectedCode) => {
    expect(code(mutate)).toBe(expectedCode);
  });

  it("does not expose rejected account or remote values", () => {
    const evidence = repository();
    evidence.repository.owner.login = "do-not-echo-owner";
    evidence.origin = "https://user:credential@example.test/do-not-echo-origin";
    let diagnostic = "";
    try {
      verifyGitHubRelease({ stage: "existing-prepush", expected, evidence });
    } catch (error) {
      diagnostic = String(error);
    }
    expect(diagnostic).not.toContain("do-not-echo");
    expect(diagnostic).not.toContain("credential");
  });
});

describe("existing repository publication transition", () => {
  it("accepts an ordinary main fast-forward with unchanged audited topology", () => {
    const evidence = repository();
    evidence.refs = refs(CANDIDATE);
    evidence.relation = "equal";
    expect(
      verifyGitHubRelease({
        stage: "existing-post-push",
        expected,
        prepush: prepush(),
        evidence,
      }),
    ).toMatchObject({
      ok: true,
      code: "GITHUB_POSTPUSH_VERIFIED",
      update: "fast-forward",
      candidateSha: CANDIDATE,
    });
  });

  it("accepts an equality no-op", () => {
    const noOpExpected = {
      ...expected,
      priorRemoteMainSha: CANDIDATE,
      refBaseline: refs(CANDIDATE),
    };
    const before = repository();
    before.refs = refs(CANDIDATE);
    before.relation = "equal";
    const proof = verifyGitHubRelease({
      stage: "existing-prepush",
      expected: noOpExpected,
      evidence: before,
    });
    expect(
      verifyGitHubRelease({
        stage: "existing-post-push",
        expected: noOpExpected,
        prepush: proof,
        evidence: before,
      }),
    ).toMatchObject({ update: "no-op" });
  });

  it("allows only a valid GitHub-signed pull merge recomputation", () => {
    const evidence = repository();
    const changedMerge = "6".repeat(40);
    evidence.refs = refs(CANDIDATE, changedMerge);
    evidence.relation = "equal";
    Object.assign(evidence, {
      mergeSyntheses: [
        {
          ref: "refs/pull/1/merge",
          sha: changedMerge,
          parents: [CANDIDATE, PULL_HEAD],
          signature: "valid",
        },
      ],
    });
    expect(
      verifyGitHubRelease({ stage: "existing-post-push", expected, prepush: prepush(), evidence }),
    ).toMatchObject({ ok: true });
  });

  it.each([
    ["missing prepush", undefined],
    ["stale prepush", { ...prepush(), candidateSha: "9".repeat(40) }],
  ])("rejects %s proof", (_name, proof) => {
    const evidence = repository();
    evidence.refs = refs(CANDIDATE);
    expect(() =>
      verifyGitHubRelease({ stage: "existing-post-push", expected, prepush: proof, evidence }),
    ).toThrowError(expect.objectContaining({ code: "GITHUB_PREPUSH_EVIDENCE_INVALID" }));
  });

  it("rejects unrelated refs, dependency heads, pull heads, and invalid merge synthesis", () => {
    for (const mutate of [
      (value: ReturnType<typeof repository>) =>
        value.refs.push({ name: "refs/tags/v1", sha: CANDIDATE }),
      (value: ReturnType<typeof repository>) => (value.refs[1]!.sha = "7".repeat(40)),
      (value: ReturnType<typeof repository>) => (value.refs[2]!.sha = "8".repeat(40)),
      (value: ReturnType<typeof repository>) => (value.refs[3]!.sha = "6".repeat(40)),
    ]) {
      const evidence = repository();
      evidence.refs = refs(CANDIDATE);
      mutate(evidence);
      expect(() =>
        verifyGitHubRelease({
          stage: "existing-post-push",
          expected,
          prepush: prepush(),
          evidence,
        }),
      ).toThrow();
    }
  });
});

function runEvidence(workflowPath = ".github/workflows/pages.yml") {
  const isPages = workflowPath.endsWith("pages.yml");
  const jobs = (
    isPages ? ["build", "deploy", "probe"] : ["quality", "build", "browser", "performance"]
  ).map((name, index) => ({
    id: 100 + index,
    name,
    runId: 41,
    attempt: 2,
    status: "completed",
    conclusion: "success",
    environment: name === "deploy" ? "github-pages" : null,
  }));
  const run = {
    id: 41,
    workflowId: isPages ? 12 : 11,
    event: "push",
    branch: "main",
    ref: "refs/heads/main",
    sha: CANDIDATE,
    attempt: 2,
    status: "completed",
    conclusion: "success",
  };
  return {
    workflow: { id: isPages ? 12 : 11, path: workflowPath, state: "active" },
    run,
    attempts: [{ ...run, attempt: 1, conclusion: "failure" }, run],
    jobs,
    artifact: isPages
      ? {
          id: 71,
          name: "github-pages",
          digest: `sha256:${"a".repeat(64)}`,
          runId: 41,
          attempt: 2,
          producerJobId: 100,
        }
      : null,
    deployment: isPages
      ? {
          id: 81,
          runId: 41,
          attempt: 2,
          environment: "github-pages",
          sha: CANDIDATE,
          ref: "refs/heads/main",
          consumerJobId: 101,
          status: "success",
        }
      : null,
  };
}

describe("exact workflow, artifact, and Pages evidence", () => {
  it.each([
    [".github/workflows/ci.yml", ["quality", "build", "browser", "performance"]],
    [".github/workflows/pages.yml", ["build", "deploy", "probe"]],
  ])("binds %s to the exact candidate and static job contract", (workflowPath, jobNames) => {
    expect(
      verifyGitHubRelease({
        stage: "run",
        expected: { ...expected, workflowPath, jobNames },
        evidence: runEvidence(workflowPath),
      }),
    ).toMatchObject({ ok: true, candidateSha: CANDIDATE, jobCount: jobNames.length, runId: 41 });
  });

  it.each([
    ["wrong workflow id", (value: ReturnType<typeof runEvidence>) => (value.run.workflowId = 99)],
    [
      "wrong event",
      (value: ReturnType<typeof runEvidence>) => (value.run.event = "workflow_dispatch"),
    ],
    [
      "wrong ref",
      (value: ReturnType<typeof runEvidence>) => (value.run.ref = "refs/heads/release"),
    ],
    ["stale SHA", (value: ReturnType<typeof runEvidence>) => (value.run.sha = PRIOR)],
    ["cross attempt", (value: ReturnType<typeof runEvidence>) => (value.jobs[0]!.attempt = 1)],
    ["selected attempt absent", (value: ReturnType<typeof runEvidence>) => value.attempts.pop()],
    [
      "ambiguous selected attempt",
      (value: ReturnType<typeof runEvidence>) => value.attempts.push({ ...value.run }),
    ],
    [
      "extra job",
      (value: ReturnType<typeof runEvidence>) =>
        value.jobs.push({ ...value.jobs[0]!, id: 999, name: "extra" }),
    ],
    [
      "skipped job",
      (value: ReturnType<typeof runEvidence>) => (value.jobs[0]!.conclusion = "skipped"),
    ],
    [
      "wrong producer",
      (value: ReturnType<typeof runEvidence>) => (value.artifact!.producerJobId = 102),
    ],
    [
      "wrong consumer",
      (value: ReturnType<typeof runEvidence>) => (value.deployment!.consumerJobId = 100),
    ],
  ])("rejects %s", (_name, mutate) => {
    const evidence = runEvidence();
    mutate(evidence);
    expect(() =>
      verifyGitHubRelease({
        stage: "run",
        expected: {
          ...expected,
          workflowPath: ".github/workflows/pages.yml",
          jobNames: ["build", "deploy", "probe"],
        },
        evidence,
      }),
    ).toThrow();
  });
});

describe("fixed read-only process seam", () => {
  it("uses only explicit gh/git reads with scrubbed environment and bounded parsing", async () => {
    const calls: Array<{ file: string; args: string[]; env: Record<string, string | undefined> }> =
      [];
    const outputs = [
      {
        stderr: "",
        stdout: JSON.stringify({
          hosts: { "github.com": [{ active: true, login: "atlas-owner" }] },
        }),
      },
      { stdout: JSON.stringify({ login: "atlas-owner" }), stderr: "" },
      { stdout: JSON.stringify(repository().repository), stderr: "" },
      { stdout: JSON.stringify(repository().pages), stderr: "" },
      { stdout: "git@github.com:atlas-owner/fdm-material-atlas.git\n", stderr: "" },
      {
        stderr: "",
        stdout: refs()
          .map((ref) => `${ref.sha}\t${ref.name}`)
          .join("\n"),
      },
      { stdout: `${CANDIDATE}\n`, stderr: "" },
      { stdout: "", stderr: "" },
    ];
    const run = async (
      file: string,
      args: string[],
      options: { env: Record<string, string | undefined> },
    ) => {
      calls.push({ file, args, env: options.env });
      return outputs.shift()!;
    };
    const proof = await collectGitHubReleaseEvidence({ expected, stage: "existing-prepush", run });
    expect(proof).toMatchObject({ code: "GITHUB_PREPUSH_VERIFIED" });
    expect(calls.map((call) => call.file)).toEqual([
      "gh",
      "gh",
      "gh",
      "gh",
      "git",
      "git",
      "git",
      "git",
    ]);
    expect(
      calls.every(
        (call) => !Object.keys(call.env).some((key) => /TOKEN|SECRET|GOOGLE|GOG/u.test(key)),
      ),
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.args.includes("create") ||
          call.args.includes("delete") ||
          call.args.includes("edit"),
      ),
    ).toBe(false);
  });
});

function candidateRelease({ includePrepush = false } = {}) {
  return {
    schemaVersion: 1,
    cycleId: "release-20260901-a",
    stage: "candidate",
    commitSha: SHA,
    startedAt: "2026-09-01T17:59:00.000Z",
    reason: "candidate-updated",
    priorVerifiedCycle: { commitSha: PRIOR_SHA, digest: `sha256:${"e".repeat(64)}` },
    candidate: candidateObservationFixture({ includePrepush }),
  };
}

function canonicalDigest(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function refreshPrepushProof(value: ReturnType<typeof candidateRelease>) {
  const proof = value.candidate.prepushEvidence!;
  proof.settingsDigest = canonicalDigest({
    visibility: "PUBLIC",
    permission: "ADMIN",
    branch: "main",
    pages: "workflow",
    https: true,
  });
  const { proofDigest: _oldDigest, ...fields } = proof;
  proof.proofDigest = canonicalDigest(fields);
}

function controlledPrepushProof() {
  const baseline = targetBaselineFixture();
  const fixedRefs = baseline.advertisedRefs.refs.filter((ref) => ref.kind !== "pull-merge");
  return {
    ok: true as const,
    code: "GITHUB_PREPUSH_VERIFIED" as const,
    stage: "existing-prepush" as const,
    candidateSha: SHA,
    priorRemoteMainSha: PRIOR_SHA,
    authenticatedOwner: baseline.authenticatedOwner,
    repositoryName: baseline.repositoryName,
    refCount: baseline.advertisedRefs.count,
    refNamesDigest: canonicalDigest(baseline.advertisedRefs.refs.map((ref) => ref.name)),
    refDigest: baseline.advertisedRefs.digest,
    fixedRefDigest: canonicalDigest(fixedRefs),
    mergeRefs: baseline.advertisedRefs.refs.filter((ref) => ref.kind === "pull-merge"),
    settingsDigest: `sha256:${"c".repeat(64)}`,
  };
}

describe("release evidence CLI contract", () => {
  it("parses only the exact named Plan 10-09 and 10-10 arguments", () => {
    expect(
      parseGitHubReleaseArguments([
        "--stage",
        "existing-prepush",
        "--repo-name",
        "fdm-material-atlas",
        "--evidence",
        ".planning/10-RELEASE-EVIDENCE.json",
      ]),
    ).toEqual({
      stage: "existing-prepush",
      repositoryName: "fdm-material-atlas",
      evidencePath: ".planning/10-RELEASE-EVIDENCE.json",
    });
    expect(
      parseGitHubReleaseArguments([
        "--stage",
        "deployed",
        "--repo-name",
        "fdm-material-atlas",
        "--evidence",
        ".planning/10-RELEASE-EVIDENCE.json",
      ]).stage,
    ).toBe("deployed");
    expect(() =>
      parseGitHubReleaseArguments([
        "existing-prepush",
        "fdm-material-atlas",
        ".planning/10-RELEASE-EVIDENCE.json",
      ]),
    ).toThrowError(expect.objectContaining({ code: "GITHUB_INPUT_INVALID" }));
    expect(() =>
      parseGitHubReleaseArguments([
        "--stage",
        "existing-prepush",
        "--stage",
        "existing-post-push",
        "--repo-name",
        "fdm-material-atlas",
        "--evidence",
        ".planning/10-RELEASE-EVIDENCE.json",
      ]),
    ).toThrowError(expect.objectContaining({ code: "GITHUB_INPUT_INVALID" }));
  });

  it("attaches one exact authenticated pre-push proof to candidate evidence", async () => {
    const current = candidateRelease();
    let written: unknown;
    const result = await executeGitHubReleaseStage({
      args: {
        stage: "existing-prepush",
        repositoryName: "fdm-material-atlas",
        evidencePath: ".planning/10-RELEASE-EVIDENCE.json",
      },
      readEvidence: async () => current,
      writeEvidence: async (_path, value) => {
        written = value;
      },
      collect: async () => controlledPrepushProof(),
      now: () => "2026-09-01T18:12:00.000Z",
    });
    expect(result).toMatchObject({ ok: true, code: "GITHUB_PREPUSH_RECORDED", stage: "candidate" });
    expect(written).toMatchObject({
      stage: "candidate",
      candidate: {
        prepushEvidence: {
          candidateSha: SHA,
          priorRemoteMainSha: PRIOR_SHA,
          authenticatedOwner: "kleinpanic",
          repositoryName: "fdm-material-atlas",
          status: "passed",
        },
      },
    });
    expect(JSON.stringify(written)).not.toContain("git@github.com");
  });

  it.each([
    [
      "missing baseline",
      (value: ReturnType<typeof candidateRelease>) =>
        Reflect.deleteProperty(value.candidate, "targetBaseline"),
    ],
    [
      "wrong repository",
      (value: ReturnType<typeof candidateRelease>) =>
        (value.candidate.targetBaseline.repositoryName = "other-atlas"),
    ],
  ])("rejects a %s before collecting live state", async (_name, mutate) => {
    const current = candidateRelease();
    mutate(current);
    let collected = false;
    await expect(
      executeGitHubReleaseStage({
        args: {
          stage: "existing-prepush",
          repositoryName: "fdm-material-atlas",
          evidencePath: ".planning/10-RELEASE-EVIDENCE.json",
        },
        readEvidence: async () => current,
        writeEvidence: async () => {},
        collect: async () => {
          collected = true;
          return controlledPrepushProof();
        },
        now: () => "2026-09-01T18:12:00.000Z",
      }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^GITHUB_|^RELEASE_/) });
    expect(collected).toBe(false);
  });

  it.each([
    ["fast-forward", PRIOR_SHA],
    ["no-op", SHA],
  ])("advances fresh post-push evidence as an exact %s", async (kind, priorSha) => {
    const current = candidateRelease({ includePrepush: true });
    current.candidate.targetBaseline.priorRemoteMainSha = priorSha;
    current.candidate.targetBaseline.advertisedRefs.refs.find(
      (ref) => ref.name === "refs/heads/main",
    )!.sha = priorSha;
    if (kind === "no-op") {
      current.priorVerifiedCycle!.commitSha = SHA;
      current.candidate.targetBaseline.advertisedRefs.digest = canonicalDigest(
        current.candidate.targetBaseline.advertisedRefs.refs,
      );
      current.candidate.prepushEvidence!.priorRemoteMainSha = SHA;
      current.candidate.prepushEvidence!.refTopologyDigest =
        current.candidate.targetBaseline.advertisedRefs.digest;
    }
    refreshPrepushProof(current);
    let written: unknown;
    const result = await executeGitHubReleaseStage({
      args: {
        stage: "existing-post-push",
        repositoryName: "fdm-material-atlas",
        evidencePath: ".planning/10-RELEASE-EVIDENCE.json",
      },
      readEvidence: async () => current,
      writeEvidence: async (_path, value) => {
        written = value;
      },
      collect: async () => ({
        ok: true,
        code: "GITHUB_POSTPUSH_VERIFIED",
        stage: "existing-post-push",
        candidateSha: SHA,
        update: kind as "no-op" | "fast-forward",
        refCount: current.candidate.targetBaseline.advertisedRefs.count,
        refDigest: current.candidate.targetBaseline.advertisedRefs.digest,
      }),
      now: () => "2026-09-01T18:20:00.000Z",
    });
    expect(result).toMatchObject({
      ok: true,
      code: "GITHUB_PUBLICATION_RECORDED",
      stage: "published",
    });
    expect(written).toMatchObject({
      stage: "published",
      publication: {
        operation: { kind, priorSha, resultSha: SHA },
        repository: {
          nameWithOwner: "kleinpanic/fdm-material-atlas",
          url: "https://github.com/kleinpanic/fdm-material-atlas",
        },
      },
    });
  });

  it("rejects stale pre-push evidence before a post-push observation", async () => {
    const current = candidateRelease({ includePrepush: true });
    await expect(
      executeGitHubReleaseStage({
        args: {
          stage: "existing-post-push",
          repositoryName: "fdm-material-atlas",
          evidencePath: ".planning/10-RELEASE-EVIDENCE.json",
        },
        readEvidence: async () => current,
        writeEvidence: async () => {},
        collect: async () => {
          throw new Error("must not collect stale evidence");
        },
        now: () => "2026-09-01T19:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "GITHUB_PREPUSH_EVIDENCE_INVALID" });
  });

  it("advances published evidence only from exact Pages workflow and artifact evidence", async () => {
    const candidate = candidateRelease({ includePrepush: true });
    refreshPrepushProof(candidate);
    let published: unknown;
    await executeGitHubReleaseStage({
      args: {
        stage: "existing-post-push",
        repositoryName: "fdm-material-atlas",
        evidencePath: ".planning/10-RELEASE-EVIDENCE.json",
      },
      readEvidence: async () => candidate,
      writeEvidence: async (_path, value) => {
        published = value;
      },
      collect: async () => ({
        ok: true,
        code: "GITHUB_POSTPUSH_VERIFIED",
        stage: "existing-post-push",
        candidateSha: SHA,
        update: "fast-forward",
        refCount: candidate.candidate.targetBaseline.advertisedRefs.count,
        refDigest: candidate.candidate.targetBaseline.advertisedRefs.digest,
      }),
      now: () => "2026-09-01T18:20:00.000Z",
    });
    let deployed: unknown;
    const deployment = {
      observedAt: "2026-09-01T18:30:00.000Z",
      workflow: {
        databaseId: 12,
        file: ".github/workflows/pages.yml",
        event: "push",
        branch: "main",
        ref: "refs/heads/main",
        sha: SHA,
        runAttempt: 2,
        jobs: [
          { name: "build", databaseId: 100, conclusion: "success" },
          { name: "deploy", databaseId: 101, conclusion: "success" },
          { name: "probe", databaseId: 102, conclusion: "success" },
        ],
      },
      pages: {
        environment: "github-pages",
        artifact: {
          id: 71,
          name: "github-pages",
          digest: `sha256:${"a".repeat(64)}`,
          producerJobId: 100,
        },
        deployConsumerJobId: 101,
        url: "https://kleinpanic.github.io/fdm-material-atlas/",
        status: "built",
        httpsEnforced: true,
      },
    };
    const result = await executeGitHubReleaseStage({
      args: {
        stage: "deployed",
        repositoryName: "fdm-material-atlas",
        evidencePath: ".planning/10-RELEASE-EVIDENCE.json",
      },
      readEvidence: async () => published,
      writeEvidence: async (_path, value) => {
        deployed = value;
      },
      collectDeployment: async () => ({ proofs: [], observation: deployment }),
    });
    expect(result).toEqual({ ok: true, code: "GITHUB_DEPLOYMENT_RECORDED", stage: "deployed" });
    expect(deployed).toMatchObject({ stage: "deployed", deployment });
  });
});
