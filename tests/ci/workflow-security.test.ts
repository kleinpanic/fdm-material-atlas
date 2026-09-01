import { describe, expect, it } from "vitest";

import {
  ciEnvironmentIssueCodes,
  verifyCiEnvironment,
} from "../../tools/verify-ci-environment.mjs";
import {
  verifyWorkflowContracts,
  workflowIssueCodes,
} from "../../tools/verify-workflow-contracts.mjs";
import { safeCiWorkflow, validWorkflowSet } from "./workflow-fixtures.js";

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

const safeEnvironment = Object.freeze({
  CI_CONTEXT: "pages",
  CI_NODE_VERSION: "22.23.1",
  CI_NPM_VERSION: "10.9.8",
  CI_LOCKFILE_STATE: "clean",
  GITHUB_EVENT_NAME: "push",
  GITHUB_REF: "refs/heads/main",
  GITHUB_DEFAULT_BRANCH: "main",
  SITE_ORIGIN: "https://atlas.example",
  SITE_BASE_PATH: "/fdm-material-atlas/",
});

describe("controlled CI environment", () => {
  it("accepts exact runtime, clean lockfile, trusted ref, origin, and base", () => {
    expect(verifyCiEnvironment(safeEnvironment)).toEqual({
      ok: true,
      issues: [],
      values: {
        context: "pages",
        nodeVersion: "22.23.1",
        npmVersion: "10.9.8",
        eventName: "push",
        ref: "refs/heads/main",
        defaultBranch: "main",
        siteOrigin: "https://atlas.example",
        siteBasePath: "/fdm-material-atlas/",
      },
    });
  });

  it("normalizes an empty Pages base to root", () => {
    const result = verifyCiEnvironment({ ...safeEnvironment, SITE_BASE_PATH: "" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.values.siteBasePath).toBe("/");
  });

  it.each([
    ["wrong Node", "CI_NODE_VERSION", "22", "RUNTIME_INVALID"],
    ["wrong npm", "CI_NPM_VERSION", "latest", "RUNTIME_INVALID"],
    ["dirty lockfile", "CI_LOCKFILE_STATE", "changed", "LOCKFILE_INVALID"],
    ["untrusted event", "GITHUB_EVENT_NAME", "pull_request_target", "EVENT_INVALID"],
    ["short ref", "GITHUB_REF", "main", "REF_INVALID"],
    ["other Pages branch", "GITHUB_REF", "refs/heads/release", "REF_INVALID"],
    ["HTTP origin", "SITE_ORIGIN", "http://atlas.example", "ORIGIN_INVALID"],
    ["origin credentials", "SITE_ORIGIN", "https://user:pass@atlas.example", "ORIGIN_INVALID"],
    ["origin query", "SITE_ORIGIN", "https://atlas.example/?token=value", "ORIGIN_INVALID"],
    ["origin fragment", "SITE_ORIGIN", "https://atlas.example/#private", "ORIGIN_INVALID"],
    ["base traversal", "SITE_BASE_PATH", "/atlas/../private/", "BASE_INVALID"],
    ["encoded separator", "SITE_BASE_PATH", "/atlas%2fprivate/", "BASE_INVALID"],
    ["repeated separator", "SITE_BASE_PATH", "/atlas//private/", "BASE_INVALID"],
    ["missing trailing slash", "SITE_BASE_PATH", "/atlas", "BASE_INVALID"],
  ])("rejects %s without returning its value", (_name, key, value, code) => {
    const result = verifyCiEnvironment({ ...safeEnvironment, [key]: value });
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(code);
    expect(JSON.stringify(result)).not.toContain(value);
  });

  it.each(["GOG_OAUTH_TOKEN", "PRIVATE_SOURCE_CREDENTIAL", "SPREADSHEET_ID", "WORKBOOK_COOKIE"])(
    "rejects prohibited environment class %s without value disclosure",
    (name) => {
      const marker = `synthetic-${name.toLowerCase()}`;
      const result = verifyCiEnvironment({ ...safeEnvironment, [name]: marker });
      expect(result).toEqual({
        ok: false,
        issues: [{ code: "PROHIBITED_ENVIRONMENT", field: "environment" }],
      });
      expect(JSON.stringify(result)).not.toContain(marker);
      expect(ciEnvironmentIssueCodes).toContain("PROHIBITED_ENVIRONMENT");
    },
  );

  it("rejects unknown controlled input names", () => {
    expect(verifyCiEnvironment({ ...safeEnvironment, SITE_BASE: "/wrong/" })).toEqual({
      ok: false,
      issues: [{ code: "INPUT_NAME_FORBIDDEN", field: "environment" }],
    });
  });
});
