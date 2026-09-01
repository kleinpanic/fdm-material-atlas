#!/usr/bin/env node

import { lstat, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";

import { isMainModule } from "./lib/main-module.mjs";

const MAX_RECORDS = 500;
const MAX_BYTES = 2 * 1024 * 1024;
const JOB_NAMES = Object.freeze(["build", "deploy", "probe"]);

export const pagesRunEvidenceCodes = Object.freeze([
  "PAGES_EVIDENCE_INPUT_INVALID",
  "PAGES_EVIDENCE_EXPECTATION_INVALID",
  "PAGES_RUN_NOT_FOUND",
  "PAGES_RUN_AMBIGUOUS",
  "PAGES_RUN_UNTRUSTED",
  "PAGES_JOB_MISSING",
  "PAGES_JOB_AMBIGUOUS",
  "PAGES_JOB_FAILED",
  "PAGES_JOB_ORDER_INVALID",
  "PAGES_DEPLOYMENT_MISSING",
  "PAGES_DEPLOYMENT_MISMATCH",
]);

export class PagesRunEvidenceError extends Error {
  constructor(code) {
    super(code);
    this.name = "PagesRunEvidenceError";
    this.code = code;
  }
}

function fail(code) {
  throw new PagesRunEvidenceError(code);
}

function exactString(value, pattern, maximum = 256) {
  const hasControlCharacter =
    typeof value === "string" &&
    [...value].some((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point <= 31 || point === 127;
    });
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    pattern.test(value) &&
    !hasControlCharacter
  );
}

function expectation(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    fail("PAGES_EVIDENCE_EXPECTATION_INVALID");
  const { workflowName, workflowPath, auditedSha, ref, defaultBranch, event } = input;
  if (
    !exactString(workflowName, /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/u) ||
    !exactString(workflowPath, /^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/u) ||
    !exactString(auditedSha, /^[a-f0-9]{40}$/u, 40) ||
    !exactString(defaultBranch, /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u, 128) ||
    ref !== `refs/heads/${defaultBranch}` ||
    !new Set(["push", "workflow_dispatch"]).has(event)
  )
    fail("PAGES_EVIDENCE_EXPECTATION_INVALID");
  return Object.freeze({ workflowName, workflowPath, auditedSha, ref, defaultBranch, event });
}

function evidenceRecord(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    fail("PAGES_EVIDENCE_INPUT_INVALID");
  const arrays = [input.runs, input.jobs, input.deployments];
  if (
    arrays.some((value) => !Array.isArray(value) || value.length > MAX_RECORDS) ||
    arrays.some((value) => value.some((entry) => typeof entry !== "object" || entry === null))
  )
    fail("PAGES_EVIDENCE_INPUT_INVALID");
  return input;
}

function numericId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function time(value) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail("PAGES_EVIDENCE_INPUT_INVALID");
  return parsed;
}

export function verifyPagesRunEvidence(input) {
  const expected = expectation(input?.expected);
  const evidence = evidenceRecord(input?.evidence);
  const workflowRuns = evidence.runs.filter(
    (run) => run.name === expected.workflowName && run.path === expected.workflowPath,
  );
  const exactRuns = workflowRuns.filter(
    (run) =>
      run.head_sha === expected.auditedSha &&
      run.head_ref === expected.ref &&
      run.head_branch === expected.defaultBranch &&
      run.event === expected.event,
  );
  if (exactRuns.length === 0) fail("PAGES_RUN_NOT_FOUND");
  if (exactRuns.length !== 1) fail("PAGES_RUN_AMBIGUOUS");
  const run = exactRuns[0];
  if (
    !numericId(run.id) ||
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    !/^[a-f0-9]{40}$/u.test(run.head_sha)
  )
    fail("PAGES_RUN_UNTRUSTED");

  const selectedJobs = [];
  for (const name of JOB_NAMES) {
    const matches = evidence.jobs.filter((job) => job.run_id === run.id && job.name === name);
    if (matches.length === 0) fail("PAGES_JOB_MISSING");
    if (matches.length !== 1) fail("PAGES_JOB_AMBIGUOUS");
    const job = matches[0];
    if (
      !numericId(job.id) ||
      job.status !== "completed" ||
      job.conclusion !== "success" ||
      !numericId(job.run_id)
    )
      fail("PAGES_JOB_FAILED");
    selectedJobs.push(job);
  }
  for (let index = 1; index < selectedJobs.length; index += 1) {
    if (time(selectedJobs[index].started_at) < time(selectedJobs[index - 1].completed_at))
      fail("PAGES_JOB_ORDER_INVALID");
  }

  const deployments = evidence.deployments.filter(
    (deployment) => deployment.run_id === run.id && deployment.environment === "github-pages",
  );
  if (deployments.length !== 1) fail("PAGES_DEPLOYMENT_MISSING");
  if (
    !numericId(deployments[0].id) ||
    deployments[0].status !== "success" ||
    deployments[0].run_id !== run.id
  )
    fail("PAGES_DEPLOYMENT_MISMATCH");

  return Object.freeze({
    ok: true,
    code: "PAGES_RUN_VERIFIED",
    runId: run.id,
    jobs: Object.freeze(
      Object.fromEntries(selectedJobs.map((job) => [job.name, Object.freeze({ ok: true })])),
    ),
    deployment: Object.freeze({ ok: true }),
  });
}

async function readEvidence(path) {
  const absolute = resolve(path);
  const stat = await lstat(absolute).catch(() => fail("PAGES_EVIDENCE_INPUT_INVALID"));
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES)
    fail("PAGES_EVIDENCE_INPUT_INVALID");
  if ((await realpath(absolute)) !== absolute) fail("PAGES_EVIDENCE_INPUT_INVALID");
  return JSON.parse(await readFile(absolute, "utf8"));
}

async function main() {
  if (process.argv.length !== 9) fail("PAGES_EVIDENCE_INPUT_INVALID");
  const [, , path, workflowName, workflowPath, auditedSha, ref, defaultBranch, event] =
    process.argv;
  const report = verifyPagesRunEvidence({
    evidence: await readEvidence(path),
    expected: { workflowName, workflowPath, auditedSha, ref, defaultBranch, event },
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (await isMainModule(import.meta.url)) {
  main().catch((error) => {
    const code = pagesRunEvidenceCodes.includes(error?.code)
      ? error.code
      : "PAGES_EVIDENCE_INPUT_INVALID";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    process.exitCode = 1;
  });
}
