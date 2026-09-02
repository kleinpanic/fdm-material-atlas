import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { verifyWorkflowContracts } from "../../tools/verify-workflow-contracts.mjs";

const CHECKOUT_SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";
const SETUP_NODE_SHA = "820762786026740c76f36085b0efc47a31fe5020";
const UPLOAD_ARTIFACT_SHA = "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a";
const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

function count(pattern: RegExp): number {
  return [...workflow.matchAll(pattern)].length;
}

function job(name: string): string {
  const start = workflow.indexOf(`\n  ${name}:`);
  if (start < 0) throw new Error(`CI_JOB_MISSING_${name.toUpperCase()}`);
  const remainder = workflow.slice(start + 1);
  const next = remainder.slice(1).search(/^  [a-z0-9_-]+:/mu);
  return next < 0 ? remainder : remainder.slice(0, next + 1);
}

function expectReadOnlyCheckoutJob(name: string): void {
  const source = job(name);
  expect(source).toMatch(/^    permissions:\n      contents: read$/mu);
  expect(source).toContain(`uses: actions/checkout@${CHECKOUT_SHA} # v7.0.1`);
  expect(source).toMatch(/persist-credentials: false/u);
  expect(source).toContain(`uses: actions/setup-node@${SETUP_NODE_SHA} # v7.0.0`);
  expect(source).toMatch(/node-version: 22\.23\.1/u);
  expect(source).toMatch(/cache: npm\n          cache-dependency-path: package-lock\.json/u);
  expect(source).toContain("npm ci --ignore-scripts --no-audit --no-fund");
}

describe("production CI workflow contract", () => {
  it("uses only safe triggers, default-deny permissions, and cancellable concurrency", () => {
    expect(workflow).toMatch(
      /^on:\n  pull_request:\n  push:\n    branches: \[main\]\n  workflow_dispatch:$/mu,
    );
    expect(workflow).not.toMatch(/^\s*(?:pull_request_target|workflow_run):/mu);
    expect(workflow).toMatch(/^permissions: \{\}$/mu);
    expect(workflow).toMatch(
      /^concurrency:\n  group: ci-\$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n  cancel-in-progress: true$/mu,
    );
  });

  it("keeps every checkout job read-only and installs from the lockfile without lifecycle scripts", () => {
    for (const name of ["quality", "build", "browser", "performance"]) {
      expectReadOnlyCheckoutJob(name);
    }
    expect(count(/uses: actions\/cache@/gu)).toBe(0);
    expect(workflow).not.toMatch(/cache:\s*(?:node_modules|dist|playwright|browser)/iu);
    expect(workflow).not.toMatch(/actions\/download-artifact@/u);
  });

  it("runs each quality surface in a stable dependency chain", () => {
    expect(job("build")).toMatch(/^    needs: quality$/mu);
    expect(job("browser")).toMatch(/^    needs: build$/mu);
    expect(job("performance")).toMatch(/^    needs: build$/mu);

    expect(job("quality")).toContain("npm run audit:dependencies");
    expect(job("quality")).toContain("npm run ci:quality");
    expect(job("quality")).toContain("npm run test:ci-contracts");

    expect(job("build")).toContain("npm run build:test-modes");
    expect(job("build")).toContain("npm run validate:html");
    expect(job("build")).toContain("npm run validate:routes");

    expect(job("browser")).toContain("npm run test:release-browser");
    expect(job("browser")).toContain("npm run test:accessibility");
    expect(job("performance")).toContain("npm run test:performance");

    for (const command of [
      "npm run ci:quality",
      "npm run test:ci-contracts",
      "npm run validate:html",
      "npm run validate:routes",
      "npm run test:release-browser",
      "npm run test:accessibility",
      "npm run test:performance",
    ]) {
      expect(workflow.split(command)).toHaveLength(2);
    }
  });

  it("audits dependencies before every reviewed browser installation", () => {
    for (const name of ["browser", "performance"]) {
      const source = job(name);
      const audit = source.indexOf("npm run audit:dependencies");
      const install = source.indexOf("npm exec --no -- playwright install --with-deps chromium");
      expect(audit).toBeGreaterThan(-1);
      expect(install).toBeGreaterThan(audit);
    }
  });

  it("validates the CI environment before running the gate", () => {
    for (const name of ["quality", "build", "browser", "performance"]) {
      const source = job(name);
      expect(source).toContain("node tools/verify-ci-environment.mjs");
      expect(source).toContain("CI_CONTEXT: ci");
      expect(source).toContain("CI_NODE_VERSION: 22.23.1");
      expect(source).toContain("CI_NPM_VERSION: 10.9.8");
      expect(source).toContain("CI_LOCKFILE_STATE: clean");
      expect(source).toContain("SITE_ORIGIN: https://atlas.example");
      expect(source).toContain("SITE_BASE_PATH: /");
    }
  });

  it("summarizes pull-request data changes from one validated exact base SHA", () => {
    const source = job("quality");
    expect(source).toContain("if: github.event_name == 'pull_request'");
    expect(source).toContain("fetch-depth: 0");
    expect(source).toContain("PR_BASE_SHA: ${{ github.event.pull_request.base.sha }}");
    expect(source).toMatch(/\^\[0-9a-f\]\{40\}\$/u);
    expect(source).toContain(
      'npm run summarize:data-change -- --base-ref "$PR_BASE_SHA" >> "$GITHUB_STEP_SUMMARY"',
    );
    expect(count(/summarize:data-change/gu)).toBe(1);
    expect(workflow).not.toMatch(/\bgh\s+pr\s+(?:comment|edit)|pull-request\/comments/iu);
  });

  it("retains only short-lived failure diagnostics and never promotes CI output", () => {
    const source = job("browser");
    expect(source).toContain(`uses: actions/upload-artifact@${UPLOAD_ARTIFACT_SHA} # v7.0.1`);
    expect(source).toContain("id: diagnostic_bounds");
    expect(source).toContain('find test-results -type f -printf . | wc -c)" -le 200');
    expect(source).toContain('du -sk test-results | cut -f1)" -le 20480');
    expect(source).toContain("if: failure() && steps.diagnostic_bounds.outcome == 'success'");
    expect(source).toContain("path: test-results");
    expect(source).toMatch(/retention-days: [1-7]\b/u);
    expect(source).not.toMatch(/src\/data\/public|sensitive|exact-pattern|\.env/iu);
    expect(workflow).not.toMatch(/upload-pages-artifact|deploy-pages|pages:\s*write|id-token:/u);
  });

  it("passes the shared workflow security verifier and contains no mutation or private-source path", () => {
    expect(verifyWorkflowContracts({ "ci.yml": workflow })).toEqual({ ok: true, issues: [] });
    expect(workflow).not.toMatch(/\$\{\{\s*secrets\.|\b(?:GOG|SHEETS?|SPREADSHEET|WORKBOOK)\b/iu);
    expect(workflow).not.toMatch(/\bgit\s+(?:commit|push)|\bgh\s+(?:pr|issue|release)/iu);
    expect(workflow).not.toMatch(/(?:refresh|ingest|source[-_ ]?sync)/iu);
  });
});
