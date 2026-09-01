#!/usr/bin/env node

import { execFile as nodeExecFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import {
  advanceReleaseEvidence,
  attachPrepushEvidence,
  parseReleaseEvidence,
  writeReleaseEvidence,
} from "./lib/release-evidence.mjs";
import { isMainModule } from "./lib/main-module.mjs";

const execFile = promisify(nodeExecFile);
const SHA = /^[a-f0-9]{40}$/u;
const NAME = /^[A-Za-z0-9_.-]{1,100}$/u;
const MAX_OUTPUT = 2 * 1024 * 1024;
const MAX_PREPUSH_AGE_MS = 15 * 60 * 1000;
const SAFE_ENV = Object.freeze({
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  LANG: "C",
  LC_ALL: "C",
});
const STAGES = new Set(["established-target", "existing-prepush", "existing-post-push", "run"]);
const WORKFLOWS = Object.freeze({
  ".github/workflows/ci.yml": Object.freeze(["quality", "build", "browser", "performance"]),
  ".github/workflows/pages.yml": Object.freeze(["build", "deploy", "probe"]),
});

export const githubReleaseCodes = Object.freeze([
  "GITHUB_INPUT_INVALID",
  "GITHUB_AUTH_INVALID",
  "GITHUB_TARGET_MISMATCH",
  "GITHUB_REPOSITORY_SETTINGS_INVALID",
  "GITHUB_ORIGIN_INVALID",
  "GITHUB_PAGES_SETTINGS_INVALID",
  "GITHUB_REF_TOPOLOGY_INVALID",
  "GITHUB_REMOTE_MAIN_CHANGED",
  "GITHUB_CANDIDATE_DIVERGED",
  "GITHUB_PREPUSH_EVIDENCE_INVALID",
  "GITHUB_POSTPUSH_INVALID",
  "GITHUB_WORKFLOW_INVALID",
  "GITHUB_RUN_INVALID",
  "GITHUB_JOB_INVALID",
  "GITHUB_ARTIFACT_INVALID",
  "GITHUB_DEPLOYMENT_INVALID",
  "GITHUB_COMMAND_FAILED",
]);

export class GitHubReleaseError extends Error {
  constructor(code) {
    super(code);
    this.name = "GitHubReleaseError";
    this.code = code;
  }
}

function fail(code) {
  throw new GitHubReleaseError(code);
}

function object(value, code = "GITHUB_INPUT_INVALID") {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(code);
  return value;
}

function safeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function fullSha(value) {
  return typeof value === "string" && SHA.test(value);
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function sortedRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 512)
    fail("GITHUB_REF_TOPOLOGY_INVALID");
  const parsed = value.map((entry) => {
    const ref = object(entry, "GITHUB_REF_TOPOLOGY_INVALID");
    if (
      typeof ref.name !== "string" ||
      !fullSha(ref.sha) ||
      !(
        ref.name === "refs/heads/main" ||
        /^refs\/heads\/dependabot\/[A-Za-z0-9._/-]+$/u.test(ref.name) ||
        /^refs\/pull\/[1-9][0-9]*\/(?:head|merge)$/u.test(ref.name)
      )
    )
      fail("GITHUB_REF_TOPOLOGY_INVALID");
    const kind =
      ref.name === "refs/heads/main"
        ? "main"
        : ref.name.startsWith("refs/heads/dependabot/")
          ? "dependabot"
          : ref.name.endsWith("/head")
            ? "pull-head"
            : "pull-merge";
    if (ref.kind !== undefined && ref.kind !== kind) fail("GITHUB_REF_TOPOLOGY_INVALID");
    return { name: ref.name, sha: ref.sha, kind };
  });
  parsed.sort((left, right) => left.name.localeCompare(right.name, "en"));
  if (new Set(parsed.map((ref) => ref.name)).size !== parsed.length)
    fail("GITHUB_REF_TOPOLOGY_INVALID");
  if (parsed.filter((ref) => ref.name === "refs/heads/main").length !== 1)
    fail("GITHUB_REF_TOPOLOGY_INVALID");
  for (const ref of parsed.filter((item) => item.name.endsWith("/merge"))) {
    const head = ref.name.replace(/\/merge$/u, "/head");
    if (!parsed.some((item) => item.name === head)) fail("GITHUB_REF_TOPOLOGY_INVALID");
  }
  return parsed;
}

function expectedInput(value) {
  const expected = object(value);
  if (
    !NAME.test(expected.repositoryName) ||
    !fullSha(expected.candidateSha) ||
    !fullSha(expected.priorRemoteMainSha) ||
    expected.defaultBranch !== "main"
  )
    fail("GITHUB_INPUT_INVALID");
  if (
    expected.authenticatedOwner !== undefined &&
    (typeof expected.authenticatedOwner !== "string" || !NAME.test(expected.authenticatedOwner))
  )
    fail("GITHUB_INPUT_INVALID");
  return {
    ...expected,
    ...(expected.refBaseline === undefined
      ? {}
      : { refBaseline: sortedRefs(expected.refBaseline) }),
  };
}

function verifyTarget(expected, rawEvidence) {
  const evidence = object(rawEvidence);
  const auth = object(evidence.auth, "GITHUB_AUTH_INVALID");
  if (
    !Array.isArray(auth.logins) ||
    auth.logins.length !== 1 ||
    typeof auth.logins[0] !== "string" ||
    !NAME.test(auth.logins[0])
  )
    fail("GITHUB_AUTH_INVALID");
  const login = auth.logins[0];
  if (expected.authenticatedOwner !== undefined && login !== expected.authenticatedOwner)
    fail("GITHUB_AUTH_INVALID");
  const repository = object(evidence.repository);
  const owner = object(repository.owner);
  if (
    repository.name !== expected.repositoryName ||
    owner.login !== login ||
    repository.nameWithOwner !== `${login}/${expected.repositoryName}`
  )
    fail("GITHUB_TARGET_MISMATCH");
  if (
    repository.visibility !== "PUBLIC" ||
    repository.viewerPermission !== "ADMIN" ||
    object(repository.defaultBranchRef).name !== expected.defaultBranch
  )
    fail("GITHUB_REPOSITORY_SETTINGS_INVALID");
  const allowedOrigins = new Set([
    `git@github.com:${login}/${expected.repositoryName}.git`,
    `https://github.com/${login}/${expected.repositoryName}.git`,
  ]);
  if (!allowedOrigins.has(evidence.origin)) fail("GITHUB_ORIGIN_INVALID");
  const pages = object(evidence.pages);
  if (pages.buildType !== "workflow" || pages.httpsEnforced !== true || pages.status !== "built")
    fail("GITHUB_PAGES_SETTINGS_INVALID");
  const refs = sortedRefs(evidence.refs);
  const main = refs.find((ref) => ref.name === "refs/heads/main");
  return { refs, mainSha: main.sha };
}

function proofFromTarget(stage, expected, target) {
  const refNames = target.refs.map((ref) => ref.name);
  const fixedRefs = target.refs.filter((ref) => !ref.name.endsWith("/merge"));
  const mergeRefs = target.refs.filter((ref) => ref.name.endsWith("/merge"));
  return Object.freeze({
    ok: true,
    code: stage === "existing-prepush" ? "GITHUB_PREPUSH_VERIFIED" : "GITHUB_TARGET_VERIFIED",
    stage,
    candidateSha: expected.candidateSha,
    priorRemoteMainSha: expected.priorRemoteMainSha,
    authenticatedOwner: expected.authenticatedOwner,
    repositoryName: expected.repositoryName,
    refCount: target.refs.length,
    refNamesDigest: digest(refNames),
    refDigest: digest(target.refs),
    fixedRefDigest: digest(fixedRefs),
    mergeRefs: Object.freeze(mergeRefs.map((ref) => Object.freeze({ ...ref }))),
    settingsDigest: digest({
      visibility: "PUBLIC",
      permission: "ADMIN",
      branch: "main",
      pages: "workflow",
      https: true,
    }),
  });
}

function verifyPrepush(expected, evidence) {
  const target = verifyTarget(expected, evidence);
  if (target.mainSha !== expected.priorRemoteMainSha) fail("GITHUB_REMOTE_MAIN_CHANGED");
  if (evidence.localHeadSha !== expected.candidateSha) fail("GITHUB_CANDIDATE_DIVERGED");
  if (expected.refBaseline === undefined || digest(target.refs) !== digest(expected.refBaseline))
    fail("GITHUB_REF_TOPOLOGY_INVALID");
  if (!new Set(["ancestor", "equal"]).has(evidence.relation)) fail("GITHUB_CANDIDATE_DIVERGED");
  if (evidence.relation === "equal" && expected.priorRemoteMainSha !== expected.candidateSha)
    fail("GITHUB_CANDIDATE_DIVERGED");
  return proofFromTarget("existing-prepush", expected, target);
}

function verifyPostpush(expected, evidence, prepush) {
  if (
    typeof prepush !== "object" ||
    prepush === null ||
    prepush.code !== "GITHUB_PREPUSH_VERIFIED" ||
    prepush.stage !== "existing-prepush" ||
    prepush.candidateSha !== expected.candidateSha ||
    prepush.priorRemoteMainSha !== expected.priorRemoteMainSha
  )
    fail("GITHUB_PREPUSH_EVIDENCE_INVALID");
  const target = verifyTarget(expected, evidence);
  if (target.mainSha !== expected.candidateSha) fail("GITHUB_REMOTE_MAIN_CHANGED");
  if (
    prepush.settingsDigest !== proofFromTarget("existing-prepush", expected, target).settingsDigest
  )
    fail("GITHUB_POSTPUSH_INVALID");
  if (
    prepush.refCount !== target.refs.length ||
    prepush.refNamesDigest !== digest(target.refs.map((ref) => ref.name))
  )
    fail("GITHUB_REF_TOPOLOGY_INVALID");
  const fixedRefs = target.refs.filter((ref) => !ref.name.endsWith("/merge"));
  const priorFixed = prepush.fixedRefDigest;
  const expectedFixed = fixedRefs.map((ref) =>
    ref.name === "refs/heads/main" ? { ...ref, sha: expected.priorRemoteMainSha } : ref,
  );
  if (priorFixed !== digest(expectedFixed)) fail("GITHUB_REF_TOPOLOGY_INVALID");
  const priorMerges = new Map(prepush.mergeRefs.map((ref) => [ref.name, ref.sha]));
  const synthesis = new Map(
    (Array.isArray(evidence.mergeSyntheses) ? evidence.mergeSyntheses : []).map((item) => [
      item?.ref,
      item,
    ]),
  );
  if (synthesis.size !== (evidence.mergeSyntheses?.length ?? 0)) fail("GITHUB_POSTPUSH_INVALID");
  const usedSyntheses = new Set();
  for (const ref of target.refs.filter((item) => item.name.endsWith("/merge"))) {
    if (priorMerges.get(ref.name) === ref.sha) continue;
    const record = object(synthesis.get(ref.name), "GITHUB_POSTPUSH_INVALID");
    usedSyntheses.add(ref.name);
    const headRef = ref.name.replace(/\/merge$/u, "/head");
    const head = target.refs.find((item) => item.name === headRef);
    if (
      record.sha !== ref.sha ||
      record.signature !== "valid" ||
      !Array.isArray(record.parents) ||
      record.parents.length !== 2 ||
      record.parents[0] !== expected.candidateSha ||
      record.parents[1] !== head?.sha
    )
      fail("GITHUB_POSTPUSH_INVALID");
  }
  if ([...synthesis.keys()].some((name) => !usedSyntheses.has(name)))
    fail("GITHUB_POSTPUSH_INVALID");
  return Object.freeze({
    ok: true,
    code: "GITHUB_POSTPUSH_VERIFIED",
    stage: "existing-post-push",
    candidateSha: expected.candidateSha,
    update: expected.priorRemoteMainSha === expected.candidateSha ? "no-op" : "fast-forward",
    refCount: target.refs.length,
    refDigest: digest(target.refs),
  });
}

function verifyRun(expected, rawEvidence) {
  if (!Object.hasOwn(WORKFLOWS, expected.workflowPath)) fail("GITHUB_WORKFLOW_INVALID");
  const contractJobs = WORKFLOWS[expected.workflowPath];
  if (
    !Array.isArray(expected.jobNames) ||
    expected.jobNames.length !== contractJobs.length ||
    expected.jobNames.some((name, index) => name !== contractJobs[index])
  )
    fail("GITHUB_WORKFLOW_INVALID");
  const evidence = object(rawEvidence);
  const workflow = object(evidence.workflow, "GITHUB_WORKFLOW_INVALID");
  if (
    !safeInteger(workflow.id) ||
    workflow.path !== expected.workflowPath ||
    workflow.state !== "active"
  )
    fail("GITHUB_WORKFLOW_INVALID");
  const run = object(evidence.run, "GITHUB_RUN_INVALID");
  if (
    !safeInteger(run.id) ||
    run.workflowId !== workflow.id ||
    run.event !== "push" ||
    run.branch !== "main" ||
    run.ref !== "refs/heads/main" ||
    run.sha !== expected.candidateSha ||
    !safeInteger(run.attempt) ||
    run.status !== "completed" ||
    run.conclusion !== "success"
  )
    fail("GITHUB_RUN_INVALID");
  if (
    !Array.isArray(evidence.attempts) ||
    evidence.attempts.length < 1 ||
    evidence.attempts.length > 100
  )
    fail("GITHUB_RUN_INVALID");
  const selectedAttempts = evidence.attempts.filter(
    (attempt) => attempt?.id === run.id && attempt?.attempt === run.attempt,
  );
  if (selectedAttempts.length !== 1 || JSON.stringify(selectedAttempts[0]) !== JSON.stringify(run))
    fail("GITHUB_RUN_INVALID");
  if (!Array.isArray(evidence.jobs) || evidence.jobs.length !== contractJobs.length)
    fail("GITHUB_JOB_INVALID");
  const jobs = contractJobs.map((name) => {
    const matches = evidence.jobs.filter((job) => job?.name === name);
    if (matches.length !== 1) fail("GITHUB_JOB_INVALID");
    const job = object(matches[0], "GITHUB_JOB_INVALID");
    if (
      !safeInteger(job.id) ||
      job.runId !== run.id ||
      job.attempt !== run.attempt ||
      job.status !== "completed" ||
      job.conclusion !== "success"
    )
      fail("GITHUB_JOB_INVALID");
    return job;
  });
  if (expected.workflowPath.endsWith("pages.yml")) {
    const artifact = object(evidence.artifact, "GITHUB_ARTIFACT_INVALID");
    const build = jobs.find((job) => job.name === "build");
    if (
      !safeInteger(artifact.id) ||
      artifact.name !== "github-pages" ||
      !/^sha256:[a-f0-9]{64}$/u.test(artifact.digest) ||
      artifact.runId !== run.id ||
      artifact.attempt !== run.attempt ||
      artifact.producerJobId !== build.id
    )
      fail("GITHUB_ARTIFACT_INVALID");
    const deployment = object(evidence.deployment, "GITHUB_DEPLOYMENT_INVALID");
    const deploy = jobs.find((job) => job.name === "deploy");
    if (
      !safeInteger(deployment.id) ||
      deployment.runId !== run.id ||
      deployment.attempt !== run.attempt ||
      deployment.environment !== "github-pages" ||
      deployment.sha !== expected.candidateSha ||
      deployment.ref !== "refs/heads/main" ||
      deployment.consumerJobId !== deploy.id ||
      deployment.status !== "success" ||
      deploy.environment !== "github-pages"
    )
      fail("GITHUB_DEPLOYMENT_INVALID");
  } else if (evidence.artifact !== null || evidence.deployment !== null) {
    fail("GITHUB_RUN_INVALID");
  }
  return Object.freeze({
    ok: true,
    code: "GITHUB_RUN_VERIFIED",
    stage: "run",
    candidateSha: expected.candidateSha,
    workflowId: workflow.id,
    runId: run.id,
    runAttempt: run.attempt,
    jobCount: jobs.length,
  });
}

export function verifyGitHubRelease(input) {
  const request = object(input);
  if (!STAGES.has(request.stage)) fail("GITHUB_INPUT_INVALID");
  const expected = expectedInput(request.expected);
  if (request.stage === "run") return verifyRun(expected, request.evidence);
  if (request.stage === "existing-prepush") return verifyPrepush(expected, request.evidence);
  if (request.stage === "existing-post-push")
    return verifyPostpush(expected, request.evidence, request.prepush);
  const target = verifyTarget(expected, request.evidence);
  return proofFromTarget("established-target", expected, target);
}

export function advancePublishedGitHubEvidence(current, proof, observation) {
  if (proof?.code !== "GITHUB_POSTPUSH_VERIFIED" || proof?.candidateSha !== current?.commitSha)
    fail("GITHUB_POSTPUSH_INVALID");
  return advanceReleaseEvidence(current, { stage: "published", observation });
}

function parseJson(stdout, code = "GITHUB_COMMAND_FAILED") {
  if (typeof stdout !== "string" || Buffer.byteLength(stdout) > MAX_OUTPUT) fail(code);
  try {
    return JSON.parse(stdout);
  } catch {
    fail(code);
  }
}

function parseLsRemote(stdout) {
  if (typeof stdout !== "string" || Buffer.byteLength(stdout) > MAX_OUTPUT)
    fail("GITHUB_COMMAND_FAILED");
  return sortedRefs(
    stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const match = /^([a-f0-9]{40})\t([^\s]+)$/u.exec(line);
        if (!match) fail("GITHUB_REF_TOPOLOGY_INVALID");
        return { sha: match[1], name: match[2] };
      }),
  );
}

async function defaultRun(file, args, options) {
  try {
    return await execFile(file, args, { ...options, encoding: "utf8", maxBuffer: MAX_OUTPUT });
  } catch {
    fail("GITHUB_COMMAND_FAILED");
  }
}

async function runRead(run, file, args) {
  return run(file, args, { env: { ...SAFE_ENV }, maxBuffer: MAX_OUTPUT, shell: false });
}

function pagesFromApi(value) {
  return {
    buildType: value.buildType ?? value.build_type,
    httpsEnforced: value.httpsEnforced ?? value.https_enforced,
    status: value.status,
  };
}

function activeAuthLogins(value) {
  const status = object(value, "GITHUB_AUTH_INVALID");
  const hosts = object(status.hosts ?? status, "GITHUB_AUTH_INVALID");
  const accounts = hosts["github.com"];
  if (!Array.isArray(accounts)) fail("GITHUB_AUTH_INVALID");
  const logins = accounts
    .filter((account) => account?.active === true)
    .map((account) => account?.login)
    .filter((login) => typeof login === "string" && NAME.test(login));
  if (logins.length !== 1) fail("GITHUB_AUTH_INVALID");
  return logins;
}

export async function collectGitHubReleaseEvidence({
  expected: rawExpected,
  stage,
  prepush,
  run = defaultRun,
}) {
  const expected = expectedInput(rawExpected);
  if (!new Set(["established-target", "existing-prepush", "existing-post-push"]).has(stage))
    fail("GITHUB_INPUT_INVALID");
  const authStatus = parseJson(
    (await runRead(run, "gh", ["auth", "status", "--active", "--json", "hosts"])).stdout,
    "GITHUB_AUTH_INVALID",
  );
  const logins = activeAuthLogins(authStatus);
  const user = parseJson((await runRead(run, "gh", ["api", "user"])).stdout);
  if (user.login !== logins[0]) fail("GITHUB_AUTH_INVALID");
  const target = `${user.login}/${expected.repositoryName}`;
  const repository = parseJson(
    (
      await runRead(run, "gh", [
        "repo",
        "view",
        target,
        "--json",
        "name,owner,nameWithOwner,visibility,viewerPermission,defaultBranchRef",
      ])
    ).stdout,
  );
  const pagesRaw = parseJson((await runRead(run, "gh", ["api", `repos/${target}/pages`])).stdout);
  const origin = (await runRead(run, "git", ["remote", "get-url", "origin"])).stdout.trim();
  const refs = parseLsRemote((await runRead(run, "git", ["ls-remote", "origin"])).stdout);
  const localHeadSha = (await runRead(run, "git", ["rev-parse", "HEAD"])).stdout.trim();
  if (!fullSha(localHeadSha)) fail("GITHUB_COMMAND_FAILED");
  let relation = "equal";
  if (expected.priorRemoteMainSha !== expected.candidateSha) {
    try {
      await runRead(run, "git", [
        "merge-base",
        "--is-ancestor",
        expected.priorRemoteMainSha,
        expected.candidateSha,
      ]);
      relation = "ancestor";
    } catch {
      relation = "diverged";
    }
  }
  const mergeSyntheses = [];
  if (stage === "existing-post-push" && expected.refBaseline) {
    const prior = new Map(expected.refBaseline.map((ref) => [ref.name, ref.sha]));
    for (const ref of refs.filter(
      (entry) => entry.kind === "pull-merge" && prior.get(entry.name) !== entry.sha,
    )) {
      const commit = parseJson(
        (await runRead(run, "gh", ["api", `repos/${target}/git/commits/${ref.sha}`])).stdout,
      );
      mergeSyntheses.push({
        ref: ref.name,
        sha: ref.sha,
        parents: Array.isArray(commit.parents) ? commit.parents.map((parent) => parent?.sha) : [],
        signature:
          commit.verification?.verified === true && commit.verification?.reason === "valid"
            ? "valid"
            : "invalid",
      });
    }
  }
  return verifyGitHubRelease({
    stage,
    expected,
    prepush,
    evidence: {
      auth: { logins },
      repository,
      origin,
      pages: pagesFromApi(pagesRaw),
      refs,
      relation,
      localHeadSha,
      mergeSyntheses,
    },
  });
}

function normalizeRun(raw, workflowId) {
  return {
    id: raw.id,
    workflowId: raw.workflow_id ?? workflowId,
    event: raw.event,
    branch: raw.head_branch,
    ref: raw.head_branch === "main" ? "refs/heads/main" : "",
    sha: raw.head_sha,
    attempt: raw.run_attempt,
    status: raw.status,
    conclusion: raw.conclusion,
  };
}

async function collectWorkflowRun({ run, target, candidateSha, workflowPath, jobNames, pages }) {
  const workflowFile = workflowPath.split("/").at(-1);
  const workflow = parseJson(
    (await runRead(run, "gh", ["api", `repos/${target}/actions/workflows/${workflowFile}`])).stdout,
  );
  const runs = parseJson(
    (
      await runRead(run, "gh", [
        "api",
        `repos/${target}/actions/workflows/${workflow.id}/runs?event=push&branch=main&per_page=100`,
      ])
    ).stdout,
  );
  const matches = (Array.isArray(runs.workflow_runs) ? runs.workflow_runs : []).filter(
    (entry) =>
      entry?.head_sha === candidateSha &&
      entry?.event === "push" &&
      entry?.head_branch === "main" &&
      entry?.status === "completed" &&
      entry?.conclusion === "success",
  );
  if (matches.length !== 1) fail("GITHUB_RUN_INVALID");
  const selected = normalizeRun(matches[0], workflow.id);
  const attempts = [];
  for (let attempt = 1; attempt <= selected.attempt; attempt += 1) {
    const rawAttempt = parseJson(
      (
        await runRead(run, "gh", [
          "api",
          `repos/${target}/actions/runs/${selected.id}/attempts/${attempt}`,
        ])
      ).stdout,
    );
    attempts.push(normalizeRun(rawAttempt, workflow.id));
  }
  const rawJobs = parseJson(
    (
      await runRead(run, "gh", [
        "api",
        `repos/${target}/actions/runs/${selected.id}/attempts/${selected.attempt}/jobs?filter=all&per_page=100`,
      ])
    ).stdout,
  );
  const jobs = (Array.isArray(rawJobs.jobs) ? rawJobs.jobs : []).map((job) => ({
    id: job.id,
    name: job.name,
    runId: selected.id,
    attempt: selected.attempt,
    status: job.status,
    conclusion: job.conclusion,
    environment: job.name === "deploy" && pages ? "github-pages" : null,
  }));
  let artifact = null;
  let deployment = null;
  let pagesObservation = null;
  if (pages) {
    const artifacts = parseJson(
      (
        await runRead(run, "gh", [
          "api",
          `repos/${target}/actions/runs/${selected.id}/artifacts?per_page=100`,
        ])
      ).stdout,
    );
    const matches = (Array.isArray(artifacts.artifacts) ? artifacts.artifacts : []).filter(
      (entry) => entry?.name === "github-pages" && entry?.expired !== true,
    );
    if (matches.length !== 1) fail("GITHUB_ARTIFACT_INVALID");
    const build = jobs.find((job) => job.name === "build");
    artifact = {
      id: matches[0].id,
      name: matches[0].name,
      digest: matches[0].digest,
      runId: matches[0].workflow_run?.id ?? selected.id,
      attempt: selected.attempt,
      producerJobId: build?.id,
    };
    const rawDeployments = parseJson(
      (
        await runRead(run, "gh", [
          "api",
          `repos/${target}/deployments?sha=${candidateSha}&environment=github-pages&per_page=100`,
        ])
      ).stdout,
    );
    const deployments = (Array.isArray(rawDeployments) ? rawDeployments : []).filter(
      (entry) => entry?.sha === candidateSha && entry?.environment === "github-pages",
    );
    if (deployments.length !== 1) fail("GITHUB_DEPLOYMENT_INVALID");
    const statuses = parseJson(
      (
        await runRead(run, "gh", [
          "api",
          `repos/${target}/deployments/${deployments[0].id}/statuses?per_page=100`,
        ])
      ).stdout,
    );
    if (!Array.isArray(statuses) || statuses[0]?.state !== "success")
      fail("GITHUB_DEPLOYMENT_INVALID");
    const deploy = jobs.find((job) => job.name === "deploy");
    deployment = {
      id: deployments[0].id,
      runId: selected.id,
      attempt: selected.attempt,
      environment: "github-pages",
      sha: candidateSha,
      ref: "refs/heads/main",
      consumerJobId: deploy?.id,
      status: "success",
    };
    pagesObservation = { artifact, deployment };
  }
  const evidence = {
    workflow: { id: workflow.id, path: workflow.path, state: workflow.state },
    run: selected,
    attempts,
    jobs,
    artifact,
    deployment,
  };
  const proof = verifyGitHubRelease({
    stage: "run",
    expected: {
      repositoryName: target.split("/")[1],
      candidateSha,
      priorRemoteMainSha: candidateSha,
      defaultBranch: "main",
      workflowPath,
      jobNames,
    },
    evidence,
  });
  return { proof, workflow, selected, jobs, pagesObservation };
}

export async function collectGitHubDeploymentEvidence({ expected, run = defaultRun, now }) {
  const authStatus = parseJson(
    (await runRead(run, "gh", ["auth", "status", "--active", "--json", "hosts"])).stdout,
    "GITHUB_AUTH_INVALID",
  );
  const logins = activeAuthLogins(authStatus);
  const user = parseJson((await runRead(run, "gh", ["api", "user"])).stdout);
  if (user.login !== logins[0] || user.login !== expected.authenticatedOwner)
    fail("GITHUB_AUTH_INVALID");
  const target = `${user.login}/${expected.repositoryName}`;
  const repository = parseJson(
    (
      await runRead(run, "gh", [
        "repo",
        "view",
        target,
        "--json",
        "name,owner,nameWithOwner,visibility,viewerPermission,defaultBranchRef",
      ])
    ).stdout,
  );
  const pagesRaw = parseJson((await runRead(run, "gh", ["api", `repos/${target}/pages`])).stdout);
  const origin = (await runRead(run, "git", ["remote", "get-url", "origin"])).stdout.trim();
  const refs = parseLsRemote((await runRead(run, "git", ["ls-remote", "origin"])).stdout);
  const targetState = verifyTarget(
    {
      ...expected,
      priorRemoteMainSha: expected.candidateSha,
      defaultBranch: "main",
    },
    {
      auth: { logins },
      repository,
      origin,
      pages: pagesFromApi(pagesRaw),
      refs,
    },
  );
  if (targetState.mainSha !== expected.candidateSha) fail("GITHUB_REMOTE_MAIN_CHANGED");
  const ci = await collectWorkflowRun({
    run,
    target,
    candidateSha: expected.candidateSha,
    workflowPath: ".github/workflows/ci.yml",
    jobNames: WORKFLOWS[".github/workflows/ci.yml"],
    pages: false,
  });
  const pages = await collectWorkflowRun({
    run,
    target,
    candidateSha: expected.candidateSha,
    workflowPath: ".github/workflows/pages.yml",
    jobNames: WORKFLOWS[".github/workflows/pages.yml"],
    pages: true,
  });
  const expectedUrl = `https://${expected.authenticatedOwner}.github.io/${expected.repositoryName}/`;
  const pageUrl = pagesRaw.html_url ?? pagesRaw.htmlUrl;
  if (pageUrl !== expectedUrl) fail("GITHUB_PAGES_SETTINGS_INVALID");
  return {
    proofs: [ci.proof, pages.proof],
    observation: {
      observedAt: now(),
      workflow: {
        databaseId: pages.workflow.id,
        file: pages.workflow.path,
        event: pages.selected.event,
        branch: pages.selected.branch,
        ref: pages.selected.ref,
        sha: pages.selected.sha,
        runAttempt: pages.selected.attempt,
        jobs: pages.jobs.map((job) => ({
          name: job.name,
          databaseId: job.id,
          conclusion: job.conclusion,
        })),
      },
      pages: {
        environment: "github-pages",
        artifact: {
          id: pages.pagesObservation.artifact.id,
          name: pages.pagesObservation.artifact.name,
          digest: pages.pagesObservation.artifact.digest,
          producerJobId: pages.pagesObservation.artifact.producerJobId,
        },
        deployConsumerJobId: pages.pagesObservation.deployment.consumerJobId,
        url: pageUrl,
        status: "built",
        httpsEnforced: true,
      },
    },
  };
}

export function parseGitHubReleaseArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 6) fail("GITHUB_INPUT_INVALID");
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!new Set(["--stage", "--repo-name", "--evidence"]).has(flag) || values.has(flag))
      fail("GITHUB_INPUT_INVALID");
    if (typeof value !== "string" || value.length < 1) fail("GITHUB_INPUT_INVALID");
    values.set(flag, value);
  }
  const stage = values.get("--stage");
  const repositoryName = values.get("--repo-name");
  const evidencePath = values.get("--evidence");
  if (
    !new Set(["existing-prepush", "existing-post-push", "deployed"]).has(stage) ||
    !NAME.test(repositoryName) ||
    typeof evidencePath !== "string"
  )
    fail("GITHUB_INPUT_INVALID");
  return Object.freeze({ stage, repositoryName, evidencePath });
}

function baselineExpected(parsed, repositoryName) {
  if (parsed.stage !== "candidate") fail("GITHUB_PREPUSH_EVIDENCE_INVALID");
  const baseline = parsed.candidate?.targetBaseline;
  if (
    !baseline ||
    baseline.repositoryName !== repositoryName ||
    baseline.candidateSha !== parsed.commitSha ||
    baseline.branch !== "main" ||
    baseline.fullRef !== "refs/heads/main"
  )
    fail("GITHUB_PREPUSH_EVIDENCE_INVALID");
  return {
    baseline,
    expected: {
      authenticatedOwner: baseline.authenticatedOwner,
      repositoryName,
      candidateSha: parsed.commitSha,
      priorRemoteMainSha: baseline.priorRemoteMainSha,
      defaultBranch: baseline.branch,
      refBaseline: baseline.advertisedRefs.refs,
    },
  };
}

function canonicalProof(value) {
  return { ...value, proofDigest: digest(value) };
}

function timestampAfter(value) {
  return new Date(Date.parse(value) + 1).toISOString();
}

function persistedPrepushAsVerifierProof(parsed) {
  const baseline = parsed.candidate.targetBaseline;
  const proof = parsed.candidate.prepushEvidence;
  if (!proof) fail("GITHUB_PREPUSH_EVIDENCE_INVALID");
  const target = { refs: sortedRefs(baseline.advertisedRefs.refs) };
  const reconstructed = proofFromTarget(
    "existing-prepush",
    {
      candidateSha: parsed.commitSha,
      priorRemoteMainSha: baseline.priorRemoteMainSha,
      authenticatedOwner: baseline.authenticatedOwner,
      repositoryName: baseline.repositoryName,
    },
    target,
  );
  if (
    reconstructed.refDigest !== proof.refTopologyDigest ||
    reconstructed.settingsDigest !== proof.settingsDigest
  )
    fail("GITHUB_PREPUSH_EVIDENCE_INVALID");
  return reconstructed;
}

function publicationObservation(parsed, update, observedAt) {
  const baseline = parsed.candidate.targetBaseline;
  const operationFields = {
    kind: update,
    priorSha: baseline.priorRemoteMainSha,
    resultSha: parsed.commitSha,
    observedAt,
  };
  return {
    observedAt: timestampAfter(observedAt),
    targetBaseline: baseline,
    prepushEvidence: parsed.candidate.prepushEvidence,
    operation: canonicalProof(operationFields),
    repository: {
      nameWithOwner: baseline.nameWithOwner,
      url: baseline.repositoryUrl,
      visibility: "PUBLIC",
      defaultBranch: "main",
    },
    advertisedRefs: {
      count: baseline.advertisedRefs.count,
      digest: baseline.advertisedRefs.digest,
    },
    identityClasses: baseline.identityClasses,
    history: baseline.history,
    policy: baseline.policy,
  };
}

async function defaultReadEvidence(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    fail("GITHUB_INPUT_INVALID");
  }
}

export async function executeGitHubReleaseStage({
  args,
  root = process.cwd(),
  readEvidence = defaultReadEvidence,
  writeEvidence = writeReleaseEvidence,
  collect = collectGitHubReleaseEvidence,
  collectDeployment = collectGitHubDeploymentEvidence,
  now = () => new Date().toISOString(),
}) {
  const raw = await readEvidence(args.evidencePath);
  const parsed = parseReleaseEvidence(raw);
  if (args.stage === "deployed") {
    if (
      parsed.stage !== "published" ||
      parsed.candidate?.targetBaseline?.repositoryName !== args.repositoryName
    )
      fail("GITHUB_INPUT_INVALID");
    const baseline = parsed.candidate.targetBaseline;
    const result = await collectDeployment({
      expected: {
        authenticatedOwner: baseline.authenticatedOwner,
        repositoryName: baseline.repositoryName,
        candidateSha: parsed.commitSha,
      },
      now,
    });
    const next = advanceReleaseEvidence(parsed, {
      stage: "deployed",
      observation: result.observation,
    });
    await writeEvidence(args.evidencePath, next, { root });
    return Object.freeze({ ok: true, code: "GITHUB_DEPLOYMENT_RECORDED", stage: next.stage });
  }
  const { baseline, expected } = baselineExpected(parsed, args.repositoryName);
  if (args.stage === "existing-prepush") {
    const proof = await collect({ stage: args.stage, expected });
    if (
      proof?.code !== "GITHUB_PREPUSH_VERIFIED" ||
      proof.candidateSha !== parsed.commitSha ||
      proof.priorRemoteMainSha !== baseline.priorRemoteMainSha ||
      proof.authenticatedOwner !== baseline.authenticatedOwner ||
      proof.repositoryName !== baseline.repositoryName ||
      proof.refDigest !== baseline.advertisedRefs.digest
    )
      fail("GITHUB_PREPUSH_EVIDENCE_INVALID");
    const proofFields = {
      observedAt: now(),
      candidateSha: parsed.commitSha,
      priorRemoteMainSha: baseline.priorRemoteMainSha,
      fullRef: baseline.fullRef,
      refTopologyDigest: baseline.advertisedRefs.digest,
      settingsDigest: proof.settingsDigest,
      authenticatedOwner: baseline.authenticatedOwner,
      repositoryName: baseline.repositoryName,
      status: "passed",
    };
    const next = attachPrepushEvidence(parsed, canonicalProof(proofFields));
    await writeEvidence(args.evidencePath, next, { root });
    return Object.freeze({ ok: true, code: "GITHUB_PREPUSH_RECORDED", stage: next.stage });
  }
  const prepush = parsed.candidate.prepushEvidence;
  const observedAt = now();
  const age = Date.parse(observedAt) - Date.parse(prepush?.observedAt ?? "");
  if (!Number.isFinite(age) || age <= 0 || age > MAX_PREPUSH_AGE_MS)
    fail("GITHUB_PREPUSH_EVIDENCE_INVALID");
  const verifierProof = persistedPrepushAsVerifierProof(parsed);
  const proof = await collect({ stage: args.stage, expected, prepush: verifierProof });
  if (
    proof?.code !== "GITHUB_POSTPUSH_VERIFIED" ||
    proof.candidateSha !== parsed.commitSha ||
    !new Set(["no-op", "fast-forward"]).has(proof.update)
  )
    fail("GITHUB_POSTPUSH_INVALID");
  const next = advanceReleaseEvidence(parsed, {
    stage: "published",
    observation: publicationObservation(parsed, proof.update, observedAt),
  });
  await writeEvidence(args.evidencePath, next, { root });
  return Object.freeze({ ok: true, code: "GITHUB_PUBLICATION_RECORDED", stage: next.stage });
}

async function main() {
  const args = parseGitHubReleaseArguments(process.argv.slice(2));
  const report = await executeGitHubReleaseStage({ args });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (await isMainModule(import.meta.url)) {
  main().catch((error) => {
    const code = githubReleaseCodes.includes(error?.code) ? error.code : "GITHUB_COMMAND_FAILED";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    process.exitCode = 1;
  });
}
