import { describe, expect, it } from "vitest";

import { validateReviewBarrier } from "../../tools/lib/release-evidence.mjs";
import { DIGEST, REPO_DIGEST, ROOT_DIGEST, SHA } from "./release-evidence.test";

const categories = [
  "nyquist",
  "code",
  "security",
  "ui",
  "accessibility",
  "performance",
  "phase-verifier",
] as const;

export function barrier() {
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

describe("primary-orchestrator review barrier", () => {
  it("accepts one complete fresh exact-SHA review set", () => {
    expect(
      validateReviewBarrier(barrier(), {
        candidateSha: SHA,
        now: "2026-09-01T20:00:00.000Z",
        currentIdentity: barrier().reviewedIdentity,
      }),
    ).toEqual(barrier());
  });

  it.each([
    ["missing", (value: ReturnType<typeof barrier>) => value.reviews.pop(), "REVIEW_CATEGORY_MISSING"],
    [
      "duplicate",
      (value: ReturnType<typeof barrier>) => value.reviews.push({ ...value.reviews[0]! }),
      "REVIEW_CATEGORY_DUPLICATE",
    ],
    ["failed", (value: ReturnType<typeof barrier>) => (value.reviews[1]!.status = "failed"), "REVIEW_STATUS_INVALID"],
    [
      "unresolved",
      (value: ReturnType<typeof barrier>) => (value.reviews[2]!.unresolvedReleaseFindingCount = 1),
      "REVIEW_FINDINGS_OPEN",
    ],
    [
      "wrong SHA",
      (value: ReturnType<typeof barrier>) => (value.reviews[3]!.candidateSha = "f".repeat(40)),
      "REVIEW_SHA_MISMATCH",
    ],
    [
      "wrong artifact",
      (value: ReturnType<typeof barrier>) => (value.reviews[4]!.rootArtifactDigest = DIGEST),
      "REVIEW_ARTIFACT_MISMATCH",
    ],
  ])("rejects a %s review set", (_name, mutate, code) => {
    const value = barrier();
    mutate(value);
    expect(() =>
      validateReviewBarrier(value, {
        candidateSha: SHA,
        now: "2026-09-01T20:00:00.000Z",
        currentIdentity: barrier().reviewedIdentity,
      }),
    ).toThrowError(expect.objectContaining({ code }));
  });

  it("rejects stale reviews and post-review source mutation", () => {
    const stale = barrier();
    stale.reviews[0]!.observedAt = "2026-08-30T18:00:00.000Z";
    expect(() =>
      validateReviewBarrier(stale, {
        candidateSha: SHA,
        now: "2026-09-01T20:00:00.000Z",
        currentIdentity: barrier().reviewedIdentity,
      }),
    ).toThrowError(expect.objectContaining({ code: "REVIEW_TIMESTAMP_INVALID" }));

    expect(() =>
      validateReviewBarrier(barrier(), {
        candidateSha: SHA,
        now: "2026-09-01T20:00:00.000Z",
        currentIdentity: { ...barrier().reviewedIdentity, treeDigest: ROOT_DIGEST },
      }),
    ).toThrowError(expect.objectContaining({ code: "REVIEW_IDENTITY_CHANGED" }));
  });
});
