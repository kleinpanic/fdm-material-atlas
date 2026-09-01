import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { verifyWorkflowContracts } from "../../tools/verify-workflow-contracts.mjs";
import { safePagesWorkflow } from "./workflow-fixtures.js";

function verify(source: string) {
  return verifyWorkflowContracts({ "pages.yml": source });
}

function expectCode(source: string, code: string) {
  expect(verify(source).issues.map((issue) => issue.code)).toContain(code);
}

describe("exact-artifact Pages contract", () => {
  it("accepts the repository Pages workflow", async () => {
    const source = await readFile(".github/workflows/pages.yml", "utf8");
    expect(verify(source)).toEqual({ ok: true, issues: [] });
    expect(source.match(/upload-pages-artifact@/gu)).toHaveLength(1);
    expect(source.match(/astro build --outDir dist-pages/gu)).toHaveLength(1);
    expect(source).toContain("ATLAS_PAGES_ARTIFACT: dist-pages");
    expect(source).toContain("npm ci --ignore-scripts --no-audit --no-fund");
    expect(source).toContain("npm exec --no -- playwright install --with-deps chromium");
    expect(source).not.toMatch(/download-artifact|gh run download/iu);
  });

  it("accepts build, test, one upload, deploy, and read-only probe ordering", () => {
    expect(verify(safePagesWorkflow())).toEqual({ ok: true, issues: [] });
  });

  it("requires one exact dist-pages upload", () => {
    expectCode(
      safePagesWorkflow().replace("          path: dist-pages", "          path: dist"),
      "PAGES_ARTIFACT_INVALID",
    );
    expectCode(
      safePagesWorkflow().replace(
        "      - uses: actions/upload-pages-artifact@",
        "      - uses: actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5.0.0\n        with:\n          path: dist-pages\n      - uses: actions/upload-pages-artifact@",
      ),
      "PAGES_ARTIFACT_INVALID",
    );
  });

  it.each([
    [
      "deploy rebuild",
      "uses: actions/deploy-pages",
      "run: npm run build\n      - uses: actions/deploy-pages",
      "DEPLOY_JOB_INVALID",
    ],
    ["write outside deploy", "pages: read", "pages: write", "PERMISSION_FORBIDDEN"],
    [
      "missing environment",
      "environment:",
      "release-environment-disabled:",
      "PAGES_ENVIRONMENT_REQUIRED",
    ],
    [
      "cancelling production",
      "cancel-in-progress: false",
      "cancel-in-progress: true",
      "PAGES_CONCURRENCY_INVALID",
    ],
    [
      "probe install",
      "node tools/probe-pages.mjs",
      "npm ci && node tools/probe-pages.mjs",
      "PROBE_COMMAND_INVALID",
    ],
    [
      "probe cache",
      "node-version: 22.23.1\n      - run: node tools/probe-pages.mjs",
      "node-version: 22.23.1\n          cache: npm\n      - run: node tools/probe-pages.mjs",
      "PROBE_COMMAND_INVALID",
    ],
    ["probe wrong runtime", "node-version: 22.23.1", "node-version: 22", "NODE_VERSION_INVALID"],
    [
      "probe missing deploy output",
      "${{ needs.deploy.outputs.page_url }}",
      "https://example.test",
      "PROBE_OUTPUT_INVALID",
    ],
    [
      "probe direct step output",
      "${{ needs.deploy.outputs.page_url }}",
      "${{ steps.deployment.outputs.page_url }}",
      "PROBE_OUTPUT_INVALID",
    ],
    [
      "probe missing checkout control",
      "persist-credentials: false",
      "persist-credentials: true",
      "CHECKOUT_CREDENTIALS",
    ],
  ])("rejects %s", (_name, search, replacement, code) => {
    const source =
      _name === "probe missing checkout control"
        ? safePagesWorkflow().replaceAll(search, replacement)
        : safePagesWorkflow().replace(search, replacement);
    expectCode(source, code);
  });

  it.each([
    ["missing deployment id", "      - id: deployment", "      - id: omitted"],
    [
      "missing deploy output",
      "      page_url: ${{ steps.deployment.outputs.page_url }}",
      "      omitted_url: ${{ steps.deployment.outputs.page_url }}",
    ],
    [
      "cross-job step reference",
      "${{ needs.deploy.outputs.page_url }}",
      "${{ steps.deployment.outputs.page_url }}",
    ],
  ])("rejects %s", (_name, search, replacement) => {
    expect(verify(safePagesWorkflow().replace(search, replacement)).ok).toBe(false);
  });
});
