import { describe, expect, it } from "vitest";

import { validateReviewBarrier } from "../../tools/lib/release-evidence.mjs";
import { DIGEST, reviewBarrierFixture, ROOT_DIGEST, SHA } from "./fixtures.js";

describe("primary-orchestrator review barrier", () => {
  it("accepts one complete fresh exact-SHA review set", () => {
    expect(
      validateReviewBarrier(reviewBarrierFixture(), {
        candidateSha: SHA,
        now: "2026-09-01T20:00:00.000Z",
        currentIdentity: reviewBarrierFixture().reviewedIdentity,
      }),
    ).toEqual(reviewBarrierFixture());
  });

  it.each([
    [
      "missing",
      (value: ReturnType<typeof reviewBarrierFixture>) => value.reviews.pop(),
      "REVIEW_CATEGORY_MISSING",
    ],
    [
      "duplicate",
      (value: ReturnType<typeof reviewBarrierFixture>) =>
        value.reviews.push({ ...value.reviews[0]! }),
      "REVIEW_CATEGORY_DUPLICATE",
    ],
    [
      "failed",
      (value: ReturnType<typeof reviewBarrierFixture>) => (value.reviews[1]!.status = "failed"),
      "REVIEW_STATUS_INVALID",
    ],
    [
      "unresolved",
      (value: ReturnType<typeof reviewBarrierFixture>) =>
        (value.reviews[2]!.unresolvedReleaseFindingCount = 1),
      "REVIEW_FINDINGS_OPEN",
    ],
    [
      "wrong SHA",
      (value: ReturnType<typeof reviewBarrierFixture>) =>
        (value.reviews[3]!.candidateSha = "f".repeat(40)),
      "REVIEW_SHA_MISMATCH",
    ],
    [
      "wrong artifact",
      (value: ReturnType<typeof reviewBarrierFixture>) =>
        (value.reviews[4]!.rootArtifactDigest = DIGEST),
      "REVIEW_ARTIFACT_MISMATCH",
    ],
  ])("rejects a %s review set", (_name, mutate, code) => {
    const value = reviewBarrierFixture();
    mutate(value);
    expect(() =>
      validateReviewBarrier(value, {
        candidateSha: SHA,
        now: "2026-09-01T20:00:00.000Z",
        currentIdentity: reviewBarrierFixture().reviewedIdentity,
      }),
    ).toThrowError(expect.objectContaining({ code }));
  });

  it("rejects stale reviews and post-review source mutation", () => {
    const stale = reviewBarrierFixture();
    stale.reviews[0]!.observedAt = "2026-08-30T18:00:00.000Z";
    expect(() =>
      validateReviewBarrier(stale, {
        candidateSha: SHA,
        now: "2026-09-01T20:00:00.000Z",
        currentIdentity: reviewBarrierFixture().reviewedIdentity,
      }),
    ).toThrowError(expect.objectContaining({ code: "REVIEW_TIMESTAMP_INVALID" }));

    expect(() =>
      validateReviewBarrier(reviewBarrierFixture(), {
        candidateSha: SHA,
        now: "2026-09-01T20:00:00.000Z",
        currentIdentity: { ...reviewBarrierFixture().reviewedIdentity, treeDigest: ROOT_DIGEST },
      }),
    ).toThrowError(expect.objectContaining({ code: "REVIEW_IDENTITY_CHANGED" }));
  });
});
