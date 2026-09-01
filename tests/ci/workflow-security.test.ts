import { describe, expect, it } from "vitest";

import {
  verifyWorkflowContracts,
  workflowIssueCodes,
} from "../../tools/verify-workflow-contracts.mjs";
import { safeCiWorkflow, validWorkflowSet } from "./workflow-fixtures";

function codes(workflows: Record<string, string>) {
  return verifyWorkflowContracts(workflows).issues.map((issue) => issue.code);
}

describe("workflow trust boundary", () => {
  it("accepts full-SHA default-deny read-only workflows", () => {
    expect(verifyWorkflowContracts(validWorkflowSet())).toEqual({ ok: true, issues: [] });
  });

  it.each([
    [
      "mutable action",
      /actions\/checkout@[0-9a-f]{40}/u,
      "actions/checkout@v7",
      "ACTION_REF_INVALID",
    ],
    ["privileged PR event", "pull_request:", "pull_request_target:", "EVENT_FORBIDDEN"],
    [
      "persisted credentials",
      "persist-credentials: false",
      "persist-credentials: true",
      "CHECKOUT_CREDENTIALS",
    ],
    ["workflow token write", "contents: read", "contents: write", "PERMISSION_FORBIDDEN"],
    [
      "direct expression in shell",
      "node tools/verify-ci-environment.mjs",
      "echo ${{ github.head_ref }}",
      "SHELL_EXPRESSION_FORBIDDEN",
    ],
    [
      "PR secret",
      "npm run ci:quality",
      "TOKEN=${{ secrets.RELEASE_TOKEN }} npm run ci:quality",
      "SECRET_REFERENCE_FORBIDDEN",
    ],
    ["cross-workflow promotion", "workflow_dispatch:", "workflow_run:", "EVENT_FORBIDDEN"],
    [
      "artifact promotion",
      "npm run ci:quality",
      "gh run download && npm run ci:quality",
      "PROMOTION_FORBIDDEN",
    ],
    [
      "cache promotion",
      "- run: npm run ci:quality",
      "- uses: actions/cache@0123456789012345678901234567890123456789",
      "ACTION_NOT_ALLOWED",
    ],
    ["repository mutation", "npm run ci:quality", "git push origin main", "MUTATION_FORBIDDEN"],
  ])("rejects %s with a stable code", (_name, search, replacement, code) => {
    const source = safeCiWorkflow().replace(search, replacement);
    expect(codes({ "ci.yml": source })).toContain(code);
  });

  it("reports only controlled labels and codes", () => {
    const marker = "synthetic-secret-value";
    const result = verifyWorkflowContracts({
      "/untrusted/path/that-must-not-leak.yml": `${safeCiWorkflow()}\n# ${marker}\npermissions:\n  contents: write\n`,
    });
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(JSON.stringify(result)).not.toContain("/untrusted/path");
    expect(result.issues.every((issue) => workflowIssueCodes.includes(issue.code))).toBe(true);
  });
});
