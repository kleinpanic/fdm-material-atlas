import { describe, expect, it } from "vitest";

import { verifyWorkflowContracts } from "../../tools/verify-workflow-contracts.mjs";
import { safePagesWorkflow } from "./workflow-fixtures";

function verify(source: string) {
  return verifyWorkflowContracts({ "pages.yml": source });
}

function expectCode(source: string, code: string) {
  expect(verify(source).issues.map((issue) => issue.code)).toContain(code);
}

describe("exact-artifact Pages contract", () => {
  it("accepts build, test, one upload, deploy, and read-only probe ordering", () => {
    expect(verify(safePagesWorkflow())).toEqual({ ok: true, issues: [] });
  });

  it("requires one exact dist-pages upload", () => {
    expectCode(safePagesWorkflow().replace("path: dist-pages", "path: dist"), "PAGES_ARTIFACT_INVALID");
    expectCode(
      `${safePagesWorkflow()}\n# actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5.0.0`,
      "PAGES_ARTIFACT_INVALID",
    );
  });

  it.each([
    ["deploy rebuild", "uses: actions/deploy-pages", "run: npm run build\n      - uses: actions/deploy-pages", "DEPLOY_JOB_INVALID"],
    ["write outside deploy", "pages: read", "pages: write", "PERMISSION_FORBIDDEN"],
    ["missing environment", "environment:", "release-environment-disabled:", "PAGES_ENVIRONMENT_REQUIRED"],
    ["cancelling production", "cancel-in-progress: false", "cancel-in-progress: true", "PAGES_CONCURRENCY_INVALID"],
    ["probe install", "node tools/probe-pages.mjs", "npm ci && node tools/probe-pages.mjs", "PROBE_COMMAND_INVALID"],
    ["probe cache", "node-version: 22.23.1\n      - run: node tools/probe-pages.mjs", "node-version: 22.23.1\n          cache: npm\n      - run: node tools/probe-pages.mjs", "PROBE_COMMAND_INVALID"],
    ["probe wrong runtime", "node-version: 22.23.1", "node-version: 22", "NODE_VERSION_INVALID"],
    ["probe missing deploy output", "${{ needs.deploy.outputs.page_url }}", "https://example.test", "PROBE_OUTPUT_INVALID"],
    ["probe direct step output", "${{ needs.deploy.outputs.page_url }}", "${{ steps.deployment.outputs.page_url }}", "PROBE_OUTPUT_INVALID"],
    ["probe missing checkout control", "persist-credentials: false\n+      - uses: actions/setup-node", "persist-credentials: true\n+      - uses: actions/setup-node", "CHECKOUT_CREDENTIALS"],
  ])("rejects %s", (_name, search, replacement, code) => {
    expectCode(safePagesWorkflow().replace(search, replacement), code);
  });
});
