export const SHA = "a".repeat(40);
export const DIGEST = `sha256:${"b".repeat(64)}`;
export const ROOT_DIGEST = `sha256:${"c".repeat(64)}`;
export const REPO_DIGEST = `sha256:${"d".repeat(64)}`;

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
