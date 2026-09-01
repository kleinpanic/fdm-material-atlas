import { describe, expect, it } from "vitest";

import { verifyPagesRunEvidence } from "../../tools/verify-pages-run.mjs";

const SHA = "a".repeat(40);
const expected = Object.freeze({
  workflowName: "Pages",
  workflowPath: ".github/workflows/pages.yml",
  auditedSha: SHA,
  ref: "refs/heads/main",
  defaultBranch: "main",
  event: "push",
});

function evidence() {
  return {
    runs: [
      {
        id: 41,
        name: "Pages",
        path: ".github/workflows/pages.yml",
        head_sha: SHA,
        head_ref: "refs/heads/main",
        head_branch: "main",
        event: "push",
        status: "completed",
        conclusion: "success",
      },
    ],
    jobs: [
      {
        id: 101,
        run_id: 41,
        name: "build",
        status: "completed",
        conclusion: "success",
        started_at: "2026-09-01T10:00:00Z",
        completed_at: "2026-09-01T10:10:00Z",
      },
      {
        id: 102,
        run_id: 41,
        name: "deploy",
        status: "completed",
        conclusion: "success",
        started_at: "2026-09-01T10:10:01Z",
        completed_at: "2026-09-01T10:11:00Z",
      },
      {
        id: 103,
        run_id: 41,
        name: "probe",
        status: "completed",
        conclusion: "success",
        started_at: "2026-09-01T10:11:01Z",
        completed_at: "2026-09-01T10:12:00Z",
      },
    ],
    deployments: [{ id: 201, run_id: 41, environment: "github-pages", status: "success" }],
  };
}

function code(mutate: (value: ReturnType<typeof evidence>) => void) {
  const value = evidence();
  mutate(value);
  try {
    verifyPagesRunEvidence({ expected, evidence: value });
    return "NO_ERROR";
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe("Pages release evidence", () => {
  it("accepts only the exact current successful run and ordered jobs", () => {
    expect(verifyPagesRunEvidence({ expected, evidence: evidence() })).toEqual({
      ok: true,
      code: "PAGES_RUN_VERIFIED",
      runId: 41,
      jobs: { build: { ok: true }, deploy: { ok: true }, probe: { ok: true } },
      deployment: { ok: true },
    });
  });

  it.each([
    [
      "stale run",
      (value: ReturnType<typeof evidence>) => (value.runs[0]!.head_sha = "b".repeat(40)),
      "PAGES_RUN_NOT_FOUND",
    ],
    [
      "wrong ref",
      (value: ReturnType<typeof evidence>) => (value.runs[0]!.head_ref = "refs/heads/release"),
      "PAGES_RUN_NOT_FOUND",
    ],
    [
      "wrong event",
      (value: ReturnType<typeof evidence>) => (value.runs[0]!.event = "pull_request"),
      "PAGES_RUN_NOT_FOUND",
    ],
    ["missing job", (value: ReturnType<typeof evidence>) => value.jobs.pop(), "PAGES_JOB_MISSING"],
    [
      "failed job",
      (value: ReturnType<typeof evidence>) => (value.jobs[1]!.conclusion = "failure"),
      "PAGES_JOB_FAILED",
    ],
    [
      "cross-run job",
      (value: ReturnType<typeof evidence>) => (value.jobs[2]!.run_id = 40),
      "PAGES_JOB_MISSING",
    ],
    [
      "cross-run deployment",
      (value: ReturnType<typeof evidence>) => (value.deployments[0]!.run_id = 40),
      "PAGES_DEPLOYMENT_MISSING",
    ],
  ])("rejects %s", (_name, mutate, expectedCode) => {
    expect(code(mutate)).toBe(expectedCode);
  });

  it("rejects an abbreviated expected SHA before inspecting evidence", () => {
    expect(() =>
      verifyPagesRunEvidence({
        expected: { ...expected, auditedSha: SHA.slice(0, 12) },
        evidence: evidence(),
      }),
    ).toThrowError(expect.objectContaining({ code: "PAGES_EVIDENCE_EXPECTATION_INVALID" }));
  });

  it("rejects duplicate exact candidates and duplicate required jobs", () => {
    const duplicateRun = evidence();
    duplicateRun.runs.push({ ...duplicateRun.runs[0]!, id: 42 });
    expect(code((value) => value.runs.push({ ...value.runs[0]!, id: 42 }))).toBe(
      "PAGES_RUN_AMBIGUOUS",
    );
    expect(code((value) => value.jobs.push({ ...value.jobs[0]!, id: 104 }))).toBe(
      "PAGES_JOB_AMBIGUOUS",
    );
  });

  it("rejects URL-only evidence and overlapping job order", () => {
    expect(() =>
      verifyPagesRunEvidence({ expected, evidence: { page_url: "https://example.test" } }),
    ).toThrowError(expect.objectContaining({ code: "PAGES_EVIDENCE_INPUT_INVALID" }));
    expect(
      code((value) => {
        value.jobs[1]!.started_at = "2026-09-01T10:09:00Z";
      }),
    ).toBe("PAGES_JOB_ORDER_INVALID");
  });
});
