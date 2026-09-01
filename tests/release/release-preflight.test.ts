import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";

import {
  ReleaseVerificationError,
  deriveProductObservations,
  parseReleaseArguments,
  verifyReleaseCandidate,
} from "../../tools/verify-release.mjs";
import { reviewBarrierFixture, SHA } from "./fixtures.js";

const PRIOR_SHA = "9".repeat(40);
const ROOT_DIGEST = `sha256:${"c".repeat(64)}`;
const REPOSITORY_DIGEST = `sha256:${"d".repeat(64)}`;

function draft() {
  return {
    schemaVersion: 1,
    cycleId: "release-20260901-03",
    stage: "draft",
    commitSha: SHA,
    startedAt: "2026-09-01T18:00:00.000Z",
    reason: "candidate-updated",
    priorVerifiedCycle: { commitSha: PRIOR_SHA, digest: `sha256:${"e".repeat(64)}` },
  } as const;
}

function product() {
  return {
    materialCount: 23,
    sourceRecordCount: 22,
    canonicalSchemaVersion: 1,
    canonicalDigest: `sha256:${"f".repeat(64)}`,
    stack: ["astro", "preact", "tailwindcss", "typescript"],
    routes: ["/", "/compare/", "/data/", "/map/", "/materials/", "/method/"],
    selectorContractVersion: 1,
    selectorArchitecture: "Deterministic pure ranking engine with shared explanations",
    visualizationModes: ["decision-paths", "thermal-ranges", "process-gates", "impact-flex-space"],
    visualizationArchitecture: "Static projections with one route-local interactive island",
    workflows: ["ci.yml", "dependency-review.yml", "link-health.yml", "pages.yml"],
    majorDirectories: [".github", "docs", "src", "tests", "tools"],
    limitations: [
      "Family guidance is not a universal product specification.",
      "Starting profiles require calibration.",
    ],
  };
}

function dependencies() {
  const calls: string[] = [];
  return {
    calls,
    git: vi.fn(async (args: readonly string[]) => {
      const key = args.join(" ");
      const values: Record<string, string> = {
        "symbolic-ref -q HEAD": "refs/heads/main\n",
        "rev-parse HEAD": `${SHA}\n`,
        "rev-parse --verify refs/remotes/origin/main": `${PRIOR_SHA}\n`,
        "merge-base --is-ancestor 9999999999999999999999999999999999999999 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa":
          "",
        "status --porcelain=v1 --untracked-files=all": "",
        "remote get-url origin": "git@github.com:atlas-owner/fdm-material-atlas.git\n",
        "for-each-ref --format=%(refname)": "refs/heads/main\nrefs/remotes/origin/main\n",
      };
      if (!(key in values)) throw new Error(`unexpected git seam: ${key}`);
      return values[key]!;
    }),
    github: vi.fn(async () => ({
      login: "atlas-owner",
      repository: {
        name: "fdm-material-atlas",
        owner: { login: "atlas-owner" },
        nameWithOwner: "atlas-owner/fdm-material-atlas",
        url: "https://github.com/atlas-owner/fdm-material-atlas",
        visibility: "PUBLIC",
        viewerPermission: "ADMIN",
        defaultBranch: "main",
      },
      advertisedRefs: [{ name: "refs/heads/main", sha: PRIOR_SHA }],
    })),
    runQuality: vi.fn(async (command: string) => {
      calls.push(command);
      return { status: "passed" as const };
    }),
    scan: vi.fn(async (surface: string) => ({
      mode: surface,
      scannedCount: 1,
      findingCount: 0,
      findings: [],
      ...(surface === "artifact-root" ? { artifactDigest: ROOT_DIGEST } : {}),
      ...(surface === "artifact-repository" ? { artifactDigest: REPOSITORY_DIGEST } : {}),
    })),
    inspectIgnored: vi.fn(async () => []),
    inspectRepository: vi.fn(async () => ({ commitCount: 3 })),
    observeProduct: vi.fn(async () => product()),
    observeIdentity: vi.fn(async () => reviewBarrierFixture().reviewedIdentity),
    readPolicy: vi.fn(async () => ({
      schemaVersion: 1 as const,
      exactPatterns: [Buffer.from("fixture-private-value")],
    })),
    now: () => "2026-09-01T20:00:00.000Z",
  };
}

async function run(overrides: Record<string, unknown> = {}) {
  const deps = dependencies();
  const result = await verifyReleaseCandidate({
    mode: "post-publication",
    root: process.cwd(),
    evidence: draft(),
    reviewBarrier: reviewBarrierFixture(),
    sensitiveFd: 3,
    dependencies: { ...deps, ...overrides },
  });
  return { result, deps };
}

describe("established repository release preflight", () => {
  it("keeps legacy pre-publication and real post-publication modes explicit", () => {
    expect(parseReleaseArguments(["pre-publication", "--dry-run-fixture"])).toEqual({
      mode: "pre-publication",
      dryRunFixture: true,
    });
    expect(parseReleaseArguments(["post-publication", "--sensitive-fd", "3"])).toEqual({
      mode: "post-publication",
      sensitiveFd: 3,
      dryRunFixture: false,
    });
    for (const argv of [[], ["post-publication"], ["post-publication", "--sensitive-file", "x"]]) {
      expect(() => parseReleaseArguments(argv)).toThrow(ReleaseVerificationError);
    }
  });

  it("passes the isolated legacy fixture with attached main and no remote", async () => {
    const deps = dependencies();
    deps.git.mockImplementation(async (args: readonly string[]) => {
      const key = args.join(" ");
      if (key === "remote") return "";
      if (key === "for-each-ref --format=%(refname)") return "refs/heads/main\n";
      return dependencies().git(args);
    });
    const legacyEvidence = {
      ...draft(),
      priorVerifiedCycle: null,
    };
    const result = await verifyReleaseCandidate({
      mode: "pre-publication",
      root: process.cwd(),
      evidence: legacyEvidence,
      reviewBarrier: reviewBarrierFixture(),
      syntheticPolicy: {
        schemaVersion: 1,
        exactPatterns: [Buffer.from("fixture-private-value")],
      },
      dependencies: deps,
    });
    expect(result.stage).toBe("candidate");
    expect(deps.github).not.toHaveBeenCalled();
  });

  it("requires descriptor 3 and never includes protected values in results or errors", async () => {
    const rejected = "fixture-private-value";
    await expect(
      verifyReleaseCandidate({
        mode: "post-publication",
        root: process.cwd(),
        evidence: draft(),
        reviewBarrier: reviewBarrierFixture(),
        sensitiveFd: 4,
        dependencies: dependencies(),
      }),
    ).rejects.toMatchObject({ code: "RELEASE_POLICY_DESCRIPTOR_INVALID" });
    await run({
      readPolicy: vi.fn(async () => {
        throw new Error(rejected);
      }),
    }).catch((error) => {
      expect(String(error)).toContain("RELEASE_POLICY_INPUT_INVALID");
      expect(JSON.stringify(error)).not.toContain(rejected);
    });
  });

  it("binds post-publication to authenticated owner, repository, origin, main, and prior SHA", async () => {
    const cases = [
      { github: vi.fn(async () => ({ ...(await dependencies().github()), login: "elsewhere" })) },
      {
        github: vi.fn(async () => ({
          ...(await dependencies().github()),
          repository: {
            ...(await dependencies().github()).repository,
            owner: { login: "elsewhere" },
          },
        })),
      },
      {
        git: vi.fn(async (args: readonly string[]) =>
          args[0] === "symbolic-ref" ? "refs/heads/other\n" : dependencies().git(args),
        ),
      },
      {
        git: vi.fn(async (args: readonly string[]) =>
          args.join(" ") === "remote get-url origin"
            ? "git@github.com:elsewhere/fdm-material-atlas.git\n"
            : dependencies().git(args),
        ),
      },
    ];
    for (const seam of cases) {
      await expect(run(seam)).rejects.toBeInstanceOf(ReleaseVerificationError);
    }
  });

  it("runs the fixed quality matrix and scans every local and artifact surface", async () => {
    const { result, deps } = await run();
    expect(deps.calls).toEqual([
      "install",
      "browser-install",
      "ci-all",
      "build-root",
      "build-repository",
    ]);
    expect(deps.scan.mock.calls.map(([surface]) => surface)).toEqual([
      "working",
      "tracked",
      "history",
      "artifact-root",
      "artifact-repository",
    ]);
    expect(result.stage).toBe("candidate");
    expect(result.commitSha).toBe(SHA);
    expect(result.candidate.product).toEqual(product());
    expect(result.candidate.targetBaseline).toMatchObject({
      observedAt: "2026-09-01T20:00:00.000Z",
      candidateSha: SHA,
      authenticatedOwner: "atlas-owner",
      repositoryName: "fdm-material-atlas",
      nameWithOwner: "atlas-owner/fdm-material-atlas",
      repositoryUrl: "https://github.com/atlas-owner/fdm-material-atlas",
      priorRemoteMainSha: PRIOR_SHA,
      branch: "main",
      fullRef: "refs/heads/main",
      status: "passed",
      advertisedRefs: {
        count: 1,
        refs: [{ name: "refs/heads/main", sha: PRIOR_SHA, kind: "main" }],
      },
      identityClasses: { human: 3, dependabot: 0, githubService: 0, unexpected: 0 },
      history: { refCount: 2, commitCount: 3, authorMismatchCount: 0, findingCount: 0 },
      policy: {
        scanSessionId: `local-${SHA.slice(0, 12)}`,
        activePatternCount: 1,
        status: "passed",
      },
    });
    expect(result.candidate.targetBaseline.advertisedRefs.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("derives target expectations from live authenticated structure without account constants", async () => {
    const source = await readFile("tools/verify-release.mjs", "utf8");
    expect(source).not.toContain("kleinpanic");
    expect(source).not.toContain("EXPECTED_OWNER");
    expect(source).not.toContain("EXPECTED_REPOSITORY");
    const { result } = await run();
    expect(result.candidate.targetBaseline.repositoryName).toBe("fdm-material-atlas");
  });

  it.each([
    ["quality", { runQuality: vi.fn(async () => ({ status: "failed" as const })) }],
    ["scan", { scan: vi.fn(async () => ({ findingCount: 1, findings: [] })) }],
    ["ignored", { inspectIgnored: vi.fn(async () => ["unexpected-root"]) }],
  ])("fails closed for a %s boundary", async (_name, seam) => {
    await expect(run(seam)).rejects.toBeInstanceOf(ReleaseVerificationError);
  });

  it("rejects side refs and source mutation after quality evidence", async () => {
    const sideRefs = dependencies();
    sideRefs.git.mockImplementation(async (args: readonly string[]) =>
      args[0] === "for-each-ref"
        ? "refs/heads/main\nrefs/heads/review-side\nrefs/remotes/origin/main\n"
        : dependencies().git(args),
    );
    await expect(run({ git: sideRefs.git })).rejects.toMatchObject({
      code: "RELEASE_LOCAL_REFS_INVALID",
    });

    let reads = 0;
    await expect(
      run({
        observeIdentity: vi.fn(async () => {
          reads += 1;
          return reads === 1
            ? reviewBarrierFixture().reviewedIdentity
            : { ...reviewBarrierFixture().reviewedIdentity, treeDigest: ROOT_DIGEST };
        }),
      }),
    ).rejects.toMatchObject({ code: "RELEASE_CANDIDATE_MUTATED" });
  });

  it("blocks repository, artifact, prior-SHA, and observation failures with stable codes", async () => {
    await expect(
      run({
        inspectRepository: vi.fn(async () => {
          throw new Error("raw repository output");
        }),
      }),
    ).rejects.toMatchObject({ code: "RELEASE_REPOSITORY_INVALID" });
    await expect(
      run({ observeProduct: vi.fn(async () => ({ ...product(), materialCount: 0 })) }),
    ).rejects.toMatchObject({ code: "RELEASE_EVIDENCE_VALUE_INVALID" });
    await expect(
      run({
        scan: vi.fn(async (surface: string) => ({
          findingCount: 0,
          findings: [],
          ...(surface === "artifact-root" ? { artifactDigest: `sha256:${"1".repeat(64)}` } : {}),
          ...(surface === "artifact-repository" ? { artifactDigest: REPOSITORY_DIGEST } : {}),
        })),
      }),
    ).rejects.toMatchObject({ code: "RELEASE_REVIEW_IDENTITY_MISMATCH" });
  });

  it("derives complete canonical observations and rejects missing inventory", async () => {
    const observed = await deriveProductObservations({ root: process.cwd() });
    expect(observed.materialCount).toBe(23);
    expect(observed.sourceRecordCount).toBe(22);
    expect(observed.visualizationModes).toEqual([
      "decision-paths",
      "thermal-ranges",
      "process-gates",
      "impact-flex-space",
    ]);
    expect(observed.routes).toContain("/materials/");
    expect(observed.workflows).toContain("pages.yml");
  });
});
