import { describe, expect, it } from "vitest";

import { verifyWorkflowContracts } from "../../tools/verify-workflow-contracts.mjs";
import {
  LYCHEE_SHA256,
  LYCHEE_URL,
  safeDependencyReviewWorkflow,
  safeLinkHealthWorkflow,
} from "./workflow-fixtures";

function expectCode(label: string, source: string, code: string) {
  const result = verifyWorkflowContracts({ [label]: source });
  expect(result.issues.map((issue) => issue.code)).toContain(code);
}

describe("maintenance workflow contracts", () => {
  it("accepts review-only dependency checks", () => {
    expect(
      verifyWorkflowContracts({ "dependency-review.yml": safeDependencyReviewWorkflow() }),
    ).toEqual({ ok: true, issues: [] });
  });

  it("rejects dependency review writes and automatic review mutation", () => {
    expectCode(
      "dependency-review.yml",
      safeDependencyReviewWorkflow().replace("contents: read", "pull-requests: write"),
      "PERMISSION_FORBIDDEN",
    );
    expectCode(
      "dependency-review.yml",
      safeDependencyReviewWorkflow().replace(
        "comment-summary-in-pr: never",
        "comment-summary-in-pr: always",
      ),
      "DEPENDENCY_REVIEW_INVALID",
    );
  });

  it("accepts a checksum-verified, token-free, non-blocking Lychee run", () => {
    expect(verifyWorkflowContracts({ "link-health.yml": safeLinkHealthWorkflow() })).toEqual({
      ok: true,
      issues: [],
    });
  });

  it.each([
    [
      "moving URL",
      LYCHEE_URL,
      "https://github.com/lycheeverse/lychee/releases/latest/download/lychee.tar.gz",
      "LYCHEE_URL_INVALID",
    ],
    ["wrong checksum", LYCHEE_SHA256, "0".repeat(64), "LYCHEE_CHECKSUM_INVALID"],
    [
      "missing checksum",
      /.+sha256sum --check --strict/u,
      "echo unchecked",
      "LYCHEE_CHECKSUM_INVALID",
    ],
    [
      "execution before verification",
      "run: echo",
      'run: "$RUNNER_TEMP/lychee" --version\n      - run: echo',
      "LYCHEE_ORDER_INVALID",
    ],
    [
      "action indirection",
      "- name: Download checked Lychee archive",
      "- uses: lycheeverse/lychee-action@0123456789012345678901234567890123456789 # v1\n      - name: Download checked Lychee archive",
      "ACTION_NOT_ALLOWED",
    ],
    [
      "token expression",
      "continue-on-error: true",
      "env:\n          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n        continue-on-error: true",
      "SECRET_REFERENCE_FORBIDDEN",
    ],
    [
      "blocking external outage",
      "continue-on-error: true",
      "continue-on-error: false",
      "LINK_HEALTH_INVALID",
    ],
    [
      "repository mutation",
      "          path: link-health.md",
      "          path: link-health.md\n      - run: git commit -am update && git push",
      "MUTATION_FORBIDDEN",
    ],
  ])("rejects %s", (_name, search, replacement, code) => {
    expectCode("link-health.yml", safeLinkHealthWorkflow().replace(search, replacement), code);
  });
});
