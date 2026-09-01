import { readFile } from "node:fs/promises";

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

async function readProjectFile(relativePath: string) {
  return readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

describe("maintenance workflow contracts", () => {
  it("enforces the production dependency-maintenance policy", async () => {
    const [dependabot, workflow] = await Promise.all([
      readProjectFile(".github/dependabot.yml"),
      readProjectFile(".github/workflows/dependency-review.yml"),
    ]);

    expect(verifyWorkflowContracts({ "dependency-review.yml": workflow })).toEqual({
      ok: true,
      issues: [],
    });
    expect(dependabot.match(/package-ecosystem:/gu)).toHaveLength(2);
    expect(dependabot).toMatch(/package-ecosystem: npm[\s\S]*open-pull-requests-limit: 5/u);
    expect(dependabot).toMatch(
      /package-ecosystem: github-actions[\s\S]*open-pull-requests-limit: 3/u,
    );
    expect(dependabot.match(/cooldown:/gu)).toHaveLength(2);
    expect(dependabot.match(/update-types:/gu)).toHaveLength(2);
    expect(dependabot).not.toMatch(/auto-?merge|git push|canonical|src\/data/iu);
  });

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

  it("enforces the production public-link policy and bounded diagnostics", async () => {
    const [workflow, config] = await Promise.all([
      readProjectFile(".github/workflows/link-health.yml"),
      readProjectFile(".github/lychee.toml"),
    ]);

    expect(verifyWorkflowContracts({ "link-health.yml": workflow })).toEqual({
      ok: true,
      issues: [],
    });
    expect(workflow).toContain(
      '"$RUNNER_TEMP/lychee" --config .github/lychee.toml src/data/public/atlas.v1.json',
    );
    expect(workflow).toContain("head -c 262144 link-health.raw.md > link-health.md");
    expect(workflow).not.toMatch(/\$\{\{\s*secrets\.|GITHUB_TOKEN|GH_TOKEN|AUTHORIZATION:/iu);
    expect(config).toMatch(/^scheme = \["https"\]$/mu);
    expect(config).toMatch(/^require_https = true$/mu);
    expect(config).toMatch(/^timeout = 15$/mu);
    expect(config).toMatch(/^max_retries = 2$/mu);
    expect(config).toMatch(/^max_redirects = 5$/mu);
    expect(config).toMatch(/^max_concurrency = 4$/mu);
    expect(config).toMatch(/^exclude_all_private = true$/mu);
    expect(config).toMatch(/^exclude_private = true$/mu);
    expect(config).toMatch(/^exclude_link_local = true$/mu);
    expect(config).toMatch(/^exclude_loopback = true$/mu);
    expect(config).not.toMatch(/token|secret|credential/iu);
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
