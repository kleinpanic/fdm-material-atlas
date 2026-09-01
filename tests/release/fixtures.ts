import { createHash } from "node:crypto";

export const SHA = "a".repeat(40);
export const PRIOR_SHA = "9".repeat(40);
export const DIGEST = `sha256:${"b".repeat(64)}`;
export const ROOT_DIGEST = `sha256:${"c".repeat(64)}`;
export const REPO_DIGEST = `sha256:${"d".repeat(64)}`;

function canonicalDigest(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export function targetBaselineFixture() {
  const refs = [
    { name: "refs/heads/dependabot/npm_and_yarn/runtime", sha: "7".repeat(40), kind: "dependabot" },
    { name: "refs/heads/main", sha: PRIOR_SHA, kind: "main" },
    { name: "refs/pull/1/head", sha: "8".repeat(40), kind: "pull-head" },
    { name: "refs/pull/1/merge", sha: "6".repeat(40), kind: "pull-merge" },
  ];
  return {
    observedAt: "2026-09-01T18:09:00.000Z",
    candidateSha: SHA,
    authenticatedOwner: "kleinpanic",
    repositoryName: "fdm-material-atlas",
    nameWithOwner: "kleinpanic/fdm-material-atlas",
    priorRemoteMainSha: PRIOR_SHA,
    branch: "main",
    fullRef: "refs/heads/main",
    advertisedRefs: { count: refs.length, digest: canonicalDigest(refs), refs },
    status: "passed",
  };
}

export function prepushEvidenceFixture() {
  const baseline = targetBaselineFixture();
  const proof = {
    observedAt: "2026-09-01T18:12:00.000Z",
    candidateSha: SHA,
    priorRemoteMainSha: PRIOR_SHA,
    fullRef: "refs/heads/main",
    refTopologyDigest: baseline.advertisedRefs.digest,
    settingsDigest: ROOT_DIGEST,
    authenticatedOwner: baseline.authenticatedOwner,
    repositoryName: baseline.repositoryName,
    status: "passed",
  };
  return { ...proof, proofDigest: canonicalDigest(proof) };
}

export function candidateObservationFixture({ includePrepush = false } = {}) {
  return {
    observedAt: "2026-09-01T18:10:00.000Z",
    targetBaseline: targetBaselineFixture(),
    ...(includePrepush ? { prepushEvidence: prepushEvidenceFixture() } : {}),
    product: {
      materialCount: 23,
      sourceRecordCount: 22,
      canonicalSchemaVersion: 1,
      canonicalDigest: DIGEST,
      stack: ["Astro 7", "Preact 10", "Tailwind CSS 4", "TypeScript 6"],
      routes: ["/", "/materials/", "/compare/", "/data/", "/map/", "/method/"],
      selectorContractVersion: 1,
      selectorArchitecture: "Deterministic pure scoring engine with hard gates and reason records.",
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
  };
}

const categories = [
  "nyquist",
  "code",
  "security",
  "ui",
  "accessibility",
  "performance",
  "phase-verifier",
] as const;

export function reviewBarrierFixture() {
  return {
    candidateSha: SHA,
    candidateCreatedAt: "2026-09-01T18:00:00.000Z",
    reviewedIdentity: {
      treeDigest: DIGEST,
      workflowDigest: ROOT_DIGEST,
      lockfileDigest: REPO_DIGEST,
      rootArtifactDigest: ROOT_DIGEST,
      repositoryArtifactDigest: REPO_DIGEST,
    },
    reviews: categories.map((category, index) => ({
      category,
      candidateSha: SHA,
      observedAt: `2026-09-01T18:${String(index + 1).padStart(2, "0")}:00.000Z`,
      status: "passed",
      findingCount: 0,
      unresolvedReleaseFindingCount: 0,
      scope: category === "ui" ? "whole-product" : category,
      rootArtifactDigest: ROOT_DIGEST,
      repositoryArtifactDigest: REPO_DIGEST,
    })),
    gapClosure: { status: "none-required", discoveredGapCount: 0, results: [] },
  };
}
