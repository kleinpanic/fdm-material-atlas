import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { verifyWorkflowContracts } from "../../tools/verify-workflow-contracts.mjs";
import {
  LYCHEE_SHA256,
  LYCHEE_URL,
  safeDependabotAutomergeWorkflow,
  safeDependencyReviewWorkflow,
  safeLinkHealthWorkflow,
  safeMaintenanceHealthWorkflow,
} from "./workflow-fixtures.js";

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

  it("accepts only guarded Dependabot auto-merge behind protected checks", () => {
    expect(
      verifyWorkflowContracts({
        "dependabot-automerge.yml": safeDependabotAutomergeWorkflow(),
      }),
    ).toEqual({ ok: true, issues: [] });
  });

  it.each([
    ["actor guard", "github.actor == 'dependabot[bot]' &&\n", ""],
    ["author guard", "github.event.pull_request.user.login == 'dependabot[bot]' &&\n", ""],
    [
      "same-repository guard",
      "github.event.pull_request.head.repo.full_name == github.repository &&\n",
      "",
    ],
    [
      "Dependabot branch guard",
      "startsWith(github.event.pull_request.head.ref, 'dependabot/') &&",
      "true",
    ],
    [
      "npm minor/patch allowlist",
      "startsWith(github.event.pull_request.head.ref, 'dependabot/npm_and_yarn/npm-minor-patch-') ||\n",
      "",
    ],
    [
      "Actions minor/patch allowlist",
      "startsWith(github.event.pull_request.head.ref, 'dependabot/github_actions/actions-minor-patch-')",
      "false",
    ],
    ["protected auto-merge", "--auto --squash", "--squash"],
    ["trusted token context", "github.token", "secrets.GITHUB_TOKEN"],
  ])("rejects Dependabot auto-merge without %s", (_name, search, replacement) => {
    expectCode(
      "dependabot-automerge.yml",
      safeDependabotAutomergeWorkflow().replace(search, replacement),
      "DEPENDABOT_AUTOMERGE_INVALID",
    );
  });

  it("rejects execution of pull-request code in the privileged Dependabot workflow", () => {
    expectCode(
      "dependabot-automerge.yml",
      safeDependabotAutomergeWorkflow().replace(
        "      - name: Queue protected squash merge",
        "      - uses: actions/checkout@0123456789012345678901234567890123456789\n      - name: Queue protected squash merge",
      ),
      "DEPENDABOT_AUTOMERGE_INVALID",
    );
  });

  it("rejects guard text moved outside the job condition", () => {
    const unsafe = safeDependabotAutomergeWorkflow().replace(
      /    if: >-\n(?:      .*\n){3}      startsWith\([^\n]+\)/u,
      `    if: true
    name: >-
      github.actor == 'dependabot[bot]' &&
      github.event.pull_request.user.login == 'dependabot[bot]' &&
      github.event.pull_request.head.repo.full_name == github.repository &&
      startsWith(github.event.pull_request.head.ref, 'dependabot/') &&
      (startsWith(github.event.pull_request.head.ref, 'dependabot/npm_and_yarn/npm-minor-patch-') ||
      startsWith(github.event.pull_request.head.ref, 'dependabot/github_actions/actions-minor-patch-'))`,
    );
    expectCode("dependabot-automerge.yml", unsafe, "DEPENDABOT_AUTOMERGE_INVALID");
  });

  it("accepts a checksum-verified, token-free, non-blocking Lychee run", () => {
    expect(verifyWorkflowContracts({ "link-health.yml": safeLinkHealthWorkflow() })).toEqual({
      ok: true,
      issues: [],
    });
  });

  it("accepts scheduled health checks with a privilege-separated issue reporter", async () => {
    const production = await readProjectFile(".github/workflows/maintenance-health.yml");
    expect(verifyWorkflowContracts({ "maintenance-health.yml": production })).toEqual({
      ok: true,
      issues: [],
    });
    expect(
      verifyWorkflowContracts({
        "maintenance-health.yml": safeMaintenanceHealthWorkflow(),
      }),
    ).toEqual({ ok: true, issues: [] });
  });

  it.each([
    ["pull-request trigger", "  workflow_dispatch:", "  workflow_dispatch:\n  pull_request:"],
    ["broad health permission", "contents: read", "contents: write"],
    ["missing always guard", "if: always()", "if: success()"],
    [
      "ungated issue mutation",
      'if [ "$HEALTH_RESULT" = "success" ]; then',
      'if [ "failure" = "success" ]; then',
    ],
    ["secret token", "github.token", "secrets.GITHUB_TOKEN"],
    [
      "report checkout",
      "      - name: Maintain",
      `      - uses: actions/checkout@${"0".repeat(40)} # v7.0.1\n      - name: Maintain`,
    ],
  ])("rejects maintenance health with %s", (_name, search, replacement) => {
    expectCode(
      "maintenance-health.yml",
      safeMaintenanceHealthWorkflow().replace(search, replacement),
      "MAINTENANCE_HEALTH_INVALID",
    );
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
