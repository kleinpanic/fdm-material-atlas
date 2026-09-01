import { describe, expect, it } from "vitest";

import { renderReleaseReport } from "../../tools/render-release-report.mjs";
import {
  DIGEST,
  prepushEvidenceFixture,
  publicationOperationFixture,
  PRIOR_SHA,
  REPO_DIGEST,
  reviewBarrierFixture,
  ROOT_DIGEST,
  SHA,
  targetBaselineFixture,
} from "./fixtures.js";

export function verifiedEvidence() {
  return {
    schemaVersion: 1,
    cycleId: "release-20260901-01",
    stage: "verified",
    commitSha: SHA,
    startedAt: "2026-09-01T18:00:00.000Z",
    reason: "candidate-updated",
    priorVerifiedCycle: { commitSha: PRIOR_SHA, digest: DIGEST },
    candidate: {
      observedAt: "2026-09-01T18:10:00.000Z",
      targetBaseline: targetBaselineFixture(),
      prepushEvidence: prepushEvidenceFixture(),
      product: {
        materialCount: 23,
        sourceRecordCount: 22,
        canonicalSchemaVersion: 1,
        canonicalDigest: DIGEST,
        stack: ["Astro 7", "Preact 10", "Tailwind CSS 4", "TypeScript 6"],
        routes: ["/", "/materials/", "/compare/", "/data/", "/map/", "/method/"],
        selectorContractVersion: 1,
        selectorArchitecture:
          "Deterministic pure scoring engine with hard gates and reason records.",
        visualizationModes: ["decision-path", "thermal-range", "process-gates", "impact-flex"],
        visualizationArchitecture: "Static projections with lazy interactive islands.",
        workflows: ["CI", "Pages", "Dependency review"],
        majorDirectories: ["public/data", "src", "tests", "tools"],
        limitations: ["No license decision has been recorded."],
      },
      quality: {
        rootArtifactDigest: ROOT_DIGEST,
        repositoryArtifactDigest: REPO_DIGEST,
        checks: [{ id: "ci-all", status: "passed", observedAt: "2026-09-01T18:11:00.000Z" }],
      },
      reviewBarrier: reviewBarrierFixture(),
    },
    publication: {
      observedAt: "2026-09-01T18:20:00.000Z",
      targetBaseline: targetBaselineFixture(),
      prepushEvidence: prepushEvidenceFixture(),
      operation: publicationOperationFixture(),
      repository: {
        nameWithOwner: "kleinpanic/fdm-material-atlas",
        url: "https://github.com/kleinpanic/fdm-material-atlas",
        visibility: "PUBLIC",
        defaultBranch: "main",
      },
      advertisedRefs: {
        count: targetBaselineFixture().advertisedRefs.count,
        digest: targetBaselineFixture().advertisedRefs.digest,
      },
      identityClasses: { human: 215, dependabot: 0, githubService: 0, unexpected: 0 },
      history: { refCount: 4, commitCount: 215, authorMismatchCount: 0, findingCount: 0 },
      policy: { scanSessionId: "scan-20260901-01", activePatternCount: 2, status: "passed" },
    },
    deployment: {
      observedAt: "2026-09-01T18:30:00.000Z",
      workflow: {
        databaseId: 55,
        file: ".github/workflows/pages.yml",
        event: "push",
        branch: "main",
        ref: "refs/heads/main",
        sha: SHA,
        runAttempt: 1,
        jobs: [
          { name: "build", databaseId: 101, conclusion: "success" },
          { name: "deploy", databaseId: 102, conclusion: "success" },
          { name: "probe", databaseId: 103, conclusion: "success" },
        ],
      },
      pages: {
        environment: "github-pages",
        artifact: { id: 201, name: "github-pages", digest: DIGEST, producerJobId: 101 },
        deployConsumerJobId: 102,
        url: "https://kleinpanic.github.io/fdm-material-atlas/",
        status: "built",
        httpsEnforced: true,
      },
    },
    verification: {
      observedAt: "2026-09-01T18:40:00.000Z",
      live: { routeCount: 29, assetCount: 53, findingCount: 0, status: "passed" },
      remote: {
        refCount: 4,
        commitCount: 215,
        advertisedRefDigest: DIGEST,
        mainSha: SHA,
        findingCount: 0,
        status: "passed",
      },
      accessibility: { status: "passed", scope: "representative-live-routes" },
      performance: { status: "passed", scope: "root-repository-pages" },
    },
  };
}

describe("fact-only completion report", () => {
  it("renders Markdown and JSON only from verified observations", () => {
    const markdown = renderReleaseReport(verifiedEvidence(), { format: "markdown" });
    expect(markdown).toContain("https://github.com/kleinpanic/fdm-material-atlas");
    expect(markdown).toContain("https://kleinpanic.github.io/fdm-material-atlas/");
    expect(markdown).toContain("23 materials");
    expect(markdown).toContain("22 source records");
    expect(markdown).toContain("No license decision has been recorded.");
    const json = JSON.parse(renderReleaseReport(verifiedEvidence(), { format: "json" }) ?? "");
    expect(json.observed.commitSha).toBe(SHA);
    expect(json.observed.routes).toHaveLength(6);
  });

  it("refuses incomplete or non-verified evidence", () => {
    expect(() =>
      renderReleaseReport({ ...verifiedEvidence(), stage: "deployed" }, { format: "markdown" }),
    ).toThrowError(expect.objectContaining({ code: "RELEASE_REPORT_NOT_VERIFIED" }));
    const missing = verifiedEvidence();
    delete (missing.candidate.product as { routes?: string[] }).routes;
    expect(() => renderReleaseReport(missing, { format: "markdown" })).toThrow();
  });

  it("rejects uncontrolled URLs and raw diagnostics without reproducing them", () => {
    const value = verifiedEvidence();
    const rejected = "https://private.invalid/sensitive";
    value.publication.repository.url = rejected;
    let message = "";
    try {
      renderReleaseReport(value, { format: "markdown" });
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain("RELEASE_EVIDENCE_VALUE_INVALID");
    expect(message).not.toContain(rejected);
  });

  it.each([
    [
      "missing baseline",
      (value: ReturnType<typeof verifiedEvidence>) =>
        delete (value.candidate as { targetBaseline?: unknown }).targetBaseline,
    ],
    [
      "stale baseline",
      (value: ReturnType<typeof verifiedEvidence>) =>
        (value.candidate.targetBaseline.observedAt = "2026-08-01T00:00:00.000Z"),
    ],
    [
      "wrong candidate",
      (value: ReturnType<typeof verifiedEvidence>) =>
        (value.candidate.targetBaseline.candidateSha = "1".repeat(40)),
    ],
    [
      "wrong prior main",
      (value: ReturnType<typeof verifiedEvidence>) =>
        (value.candidate.targetBaseline.priorRemoteMainSha = "2".repeat(40)),
    ],
    [
      "raw baseline key",
      (value: ReturnType<typeof verifiedEvidence>) =>
        Object.assign(value.candidate.targetBaseline, {
          origin: "git@example.test:owner/repo.git",
        }),
    ],
    [
      "repository URL drift",
      (value: ReturnType<typeof verifiedEvidence>) =>
        (value.candidate.targetBaseline.repositoryUrl = "https://github.com/kleinpanic/other"),
    ],
    [
      "unsorted refs",
      (value: ReturnType<typeof verifiedEvidence>) =>
        value.candidate.targetBaseline.advertisedRefs.refs.reverse(),
    ],
    [
      "wrong ref kind",
      (value: ReturnType<typeof verifiedEvidence>) =>
        (value.candidate.targetBaseline.advertisedRefs.refs[0]!.kind = "main"),
    ],
    [
      "wrong ref count",
      (value: ReturnType<typeof verifiedEvidence>) =>
        (value.candidate.targetBaseline.advertisedRefs.count = 3),
    ],
    [
      "wrong ref digest",
      (value: ReturnType<typeof verifiedEvidence>) =>
        (value.candidate.targetBaseline.advertisedRefs.digest = DIGEST),
    ],
    [
      "duplicate ref",
      (value: ReturnType<typeof verifiedEvidence>) => {
        value.candidate.targetBaseline.advertisedRefs.refs[1] = {
          ...value.candidate.targetBaseline.advertisedRefs.refs[0]!,
        };
      },
    ],
    [
      "unexpected identity",
      (value: ReturnType<typeof verifiedEvidence>) =>
        (value.candidate.targetBaseline.identityClasses.unexpected = 1),
    ],
    [
      "history finding",
      (value: ReturnType<typeof verifiedEvidence>) =>
        (value.candidate.targetBaseline.history.findingCount = 1),
    ],
    [
      "failed policy",
      (value: ReturnType<typeof verifiedEvidence>) =>
        (value.candidate.targetBaseline.policy.status = "failed"),
    ],
    [
      "missing prepush",
      (value: ReturnType<typeof verifiedEvidence>) =>
        delete (value.candidate as { prepushEvidence?: unknown }).prepushEvidence,
    ],
    [
      "stale prepush",
      (value: ReturnType<typeof verifiedEvidence>) =>
        (value.candidate.prepushEvidence.observedAt = "2026-09-01T18:01:00.000Z"),
    ],
    [
      "wrong proof digest",
      (value: ReturnType<typeof verifiedEvidence>) =>
        (value.candidate.prepushEvidence.proofDigest = DIGEST),
    ],
    [
      "raw prepush key",
      (value: ReturnType<typeof verifiedEvidence>) =>
        Object.assign(value.candidate.prepushEvidence, { stdout: "rejected" }),
    ],
    [
      "publication baseline drift",
      (value: ReturnType<typeof verifiedEvidence>) =>
        (value.publication.targetBaseline.repositoryName = "other-atlas"),
    ],
    [
      "publication proof drift",
      (value: ReturnType<typeof verifiedEvidence>) =>
        (value.publication.prepushEvidence.settingsDigest = REPO_DIGEST),
    ],
    [
      "missing publication operation",
      (value: ReturnType<typeof verifiedEvidence>) =>
        delete (value.publication as { operation?: unknown }).operation,
    ],
    [
      "publication operation drift",
      (value: ReturnType<typeof verifiedEvidence>) =>
        (value.publication.operation.resultSha = PRIOR_SHA),
    ],
  ])("rejects %s", (_name, mutate) => {
    const value = verifiedEvidence();
    mutate(value);
    expect(() => renderReleaseReport(value, { format: "json" })).toThrow();
  });
});
