#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { promisify } from "node:util";

import { readProtectedPolicyFromFd } from "./lib/protected-policy-input.mjs";
import { isMainModule } from "./lib/main-module.mjs";
import { loadPublicationPolicy } from "./lib/publication-policy.mjs";
import { parseReleaseEvidence } from "./lib/release-evidence.mjs";
import { scanBytes, scanPath } from "./scan-publication.mjs";

const execFileAsync = promisify(execFile);
const SHA = /^[a-f0-9]{40}$/u;
const REF = /^refs\/(?:heads|tags|pull)\/[A-Za-z0-9._/-]+$/u;
const SAFE_ARCHIVE_PATH = /^(?![/-])(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+/-]+$/u;
const DEPENDENCY_PATHS = new Set(["package.json", "package-lock.json", ".github/dependabot.yml"]);
const MAX_REFS = 2_000;
const MAX_COMMITS = 100_000;
const MAX_RUNS = 10_000;
const MAX_ARTIFACTS = 10_000;
const MAX_ARCHIVE_ENTRIES = 5_000;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

export class RemoteReleaseError extends Error {
  constructor(code) {
    super(code);
    this.name = "RemoteReleaseError";
    this.code = code;
  }
}

function fail(code) {
  throw new RemoteReleaseError(code);
}

function exactObject(value, code = "REMOTE_INPUT_INVALID") {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(code);
  return value;
}

function sameIdentity(actual, expected) {
  return actual?.name === expected.name && actual?.email === expected.email;
}

function digestRefs(refs) {
  const hash = createHash("sha256");
  for (const ref of [...refs].sort((a, b) => a.name.localeCompare(b.name))) {
    hash.update(ref.name).update("\0").update(ref.sha).update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

/** Inspect already-decoded archive entries without disclosing names or bytes. */
export function inspectArchiveEntries(entries, policy, limits = {}) {
  if (!Array.isArray(entries) || entries.length > (limits.maxEntries ?? MAX_ARCHIVE_ENTRIES))
    fail("REMOTE_ARCHIVE_BOUNDS");
  const maximumBytes = limits.maxBytes ?? MAX_ARCHIVE_BYTES;
  let byteCount = 0;
  for (const entry of entries) {
    exactObject(entry, "REMOTE_ARCHIVE_INVALID");
    if (
      typeof entry.name !== "string" ||
      !SAFE_ARCHIVE_PATH.test(entry.name) ||
      posix.normalize(entry.name) !== entry.name ||
      entry.type !== "file" ||
      !Buffer.isBuffer(entry.bytes)
    )
      fail("REMOTE_ARCHIVE_INVALID");
    byteCount += entry.bytes.length;
    if (byteCount > maximumBytes) fail("REMOTE_ARCHIVE_BOUNDS");
    for (const pattern of policy?.exactPatterns ?? []) {
      const bytes = Buffer.isBuffer(pattern) ? pattern : pattern.bytes;
      if (
        Buffer.isBuffer(bytes) &&
        (Buffer.from(entry.name).includes(bytes) || entry.bytes.includes(bytes))
      )
        fail("REMOTE_PROTECTED_CONTENT");
    }
    const text = entry.bytes.toString("latin1");
    if (
      /(?:authorization\s*:\s*bearer|github_pat_|gh[pousr]_|BEGIN (?:[A-Z]+ )*PRIVATE KEY)/iu.test(
        text,
      ) ||
      /(?:ACTIONS_STEP_DEBUG|RUNNER_DEBUG)\s*=\s*true/iu.test(text)
    )
      fail("REMOTE_PROHIBITED_CONTENT");
  }
  return Object.freeze({ entryCount: entries.length, byteCount, findingCount: 0 });
}

/** Verify a controlled snapshot reduced from a clean mirror and GitHub APIs. */
export function verifyRemoteSnapshot(input) {
  const value = exactObject(input);
  if (!SHA.test(value.expectedSha) || !Array.isArray(value.refs) || !Array.isArray(value.commits))
    fail("REMOTE_INPUT_INVALID");
  if (value.refs.length < 1 || value.refs.length > MAX_REFS) fail("REMOTE_REF_COUNT_INVALID");
  if (value.commits.length < 1 || value.commits.length > MAX_COMMITS)
    fail("REMOTE_COMMIT_COUNT_INVALID");
  const refNames = new Set();
  for (const ref of value.refs) {
    if (!REF.test(ref?.name) || !SHA.test(ref?.sha) || refNames.has(ref.name))
      fail(ref?.name?.startsWith("refs/") ? "REMOTE_REF_UNEXPECTED" : "REMOTE_REF_INVALID");
    refNames.add(ref.name);
  }
  const main = value.refs.find(({ name }) => name === "refs/heads/main");
  if (main?.sha !== value.expectedSha) fail("REMOTE_MAIN_SHA_MISMATCH");
  const commits = new Map(value.commits.map((commit) => [commit.sha, commit]));
  if (commits.size !== value.commits.length || !commits.has(value.expectedSha))
    fail("REMOTE_HISTORY_INCOMPLETE");
  const classes = { human: 0, dependabot: 0, githubService: 0, unexpected: 0 };
  for (const commit of value.commits) {
    if (!SHA.test(commit?.sha) || !Array.isArray(commit.parents) || !Array.isArray(commit.paths))
      fail("REMOTE_COMMIT_INVALID");
    if (commit.reachableFromMain) {
      if (!sameIdentity(commit.author, value.human) || !sameIdentity(commit.committer, value.human))
        fail("REMOTE_IDENTITY_INVALID");
      classes.human += 1;
      continue;
    }
    const serviceRefs = value.refs.filter(
      (ref) =>
        ref.sha === commit.sha &&
        (ref.name.startsWith("refs/heads/dependabot/") ||
          /^refs\/pull\/\d+\/head$/u.test(ref.name)),
    );
    const actorIsDependabot =
      commit.author?.name === "dependabot[bot]" &&
      commit.author?.email === "49699333+dependabot[bot]@users.noreply.github.com";
    const githubCommitter =
      commit.committer?.name === "GitHub" && commit.committer?.email === "noreply@github.com";
    const pullMergeRef = value.refs.find(
      (ref) => ref.sha === commit.sha && /^refs\/pull\/\d+\/merge$/u.test(ref.name),
    );
    if (pullMergeRef) {
      const pullNumber = pullMergeRef.name.split("/")[2];
      const pullHead = value.refs.find(({ name }) => name === `refs/pull/${pullNumber}/head`);
      const authorAllowed = actorIsDependabot || sameIdentity(commit.author, value.human);
      if (
        !pullHead ||
        commit.parents.length !== 2 ||
        commit.parents[0] !== value.expectedSha ||
        commit.parents[1] !== pullHead.sha ||
        !authorAllowed ||
        !githubCommitter ||
        commit.signature !== "valid"
      )
        fail("REMOTE_SERVICE_IDENTITY_INVALID");
      if (commit.paths.length < 1 || commit.paths.some((path) => !DEPENDENCY_PATHS.has(path)))
        fail("REMOTE_SERVICE_PATH_INVALID");
      classes.githubService += 1;
      continue;
    }
    if (
      serviceRefs.length !== 1 ||
      !actorIsDependabot ||
      !githubCommitter ||
      commit.signature !== "valid"
    )
      fail("REMOTE_SERVICE_IDENTITY_INVALID");
    if (commit.paths.length < 1 || commit.paths.some((path) => !DEPENDENCY_PATHS.has(path)))
      fail("REMOTE_SERVICE_PATH_INVALID");
    if (/co-authored-by:|(?:^|\n)\s*(?:claude|codex|openai|gsd)\b/iu.test(commit.message ?? ""))
      fail("REMOTE_MESSAGE_INVALID");
    classes.dependabot += 1;
  }
  if (!Array.isArray(value.runs) || value.runs.length > MAX_RUNS) fail("REMOTE_RUN_COUNT_INVALID");
  if (!Array.isArray(value.artifacts) || value.artifacts.length > MAX_ARTIFACTS)
    fail("REMOTE_ARTIFACT_COUNT_INVALID");
  const runIds = new Set();
  for (const run of value.runs) {
    if (!Number.isSafeInteger(run?.id) || run.id < 1 || runIds.has(run.id))
      fail("REMOTE_RUN_INVALID");
    runIds.add(run.id);
    if (run.status !== "completed" || run.conclusion !== "success" || !SHA.test(run.sha))
      fail("REMOTE_RUN_FAILED");
    if (run.logsScanned !== true) fail("REMOTE_LOG_UNSCANNED");
    if (!Array.isArray(run.artifactIds)) fail("REMOTE_RUN_INVALID");
  }
  const artifactIds = new Set();
  for (const artifact of value.artifacts) {
    if (!Number.isSafeInteger(artifact?.id) || artifact.id < 1 || artifactIds.has(artifact.id))
      fail("REMOTE_ARTIFACT_INVALID");
    artifactIds.add(artifact.id);
    if (!runIds.has(artifact.runId) || artifact.scanned !== true) fail("REMOTE_ARTIFACT_UNSCANNED");
    if (artifact.findingCount !== 0) fail("REMOTE_PROTECTED_CONTENT");
  }
  for (const run of value.runs) {
    if (run.artifactIds.some((id) => !artifactIds.has(id))) fail("REMOTE_ARTIFACT_UNSCANNED");
  }
  return Object.freeze({
    ok: true,
    mainSha: value.expectedSha,
    refCount: value.refs.length,
    commitCount: value.commits.length,
    advertisedRefDigest: digestRefs(value.refs),
    identityClasses: Object.freeze(classes),
    runCount: value.runs.length,
    artifactCount: value.artifacts.length,
    findingCount: 0,
    status: "passed",
  });
}

async function command(file, args, options = {}) {
  try {
    return await execFileAsync(file, args, {
      ...options,
      encoding: options.encoding ?? "utf8",
      maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
      env: remoteCommandEnvironment(),
    });
  } catch {
    fail("REMOTE_COMMAND_FAILED");
  }
}

/** Preserve local CLI configuration lookup without forwarding token-bearing environment values. */
export function remoteCommandEnvironment(env = process.env) {
  return {
    PATH: env.PATH,
    HOME: env.HOME,
    LANG: "C",
    LC_ALL: "C",
  };
}

async function git(cwd, args) {
  return (await command("git", args, { cwd })).stdout.trim();
}

async function inspectZip(path, policy) {
  const listing = (await command("unzip", ["-Z1", path])).stdout.split("\n").filter(Boolean);
  const verbose = (await command("zipinfo", ["-l", path])).stdout;
  if (/^l[rwx-]{9}\s/mu.test(verbose)) fail("REMOTE_ARCHIVE_INVALID");
  const entries = [];
  for (const name of listing) {
    if (!SAFE_ARCHIVE_PATH.test(name) || name.endsWith("/")) fail("REMOTE_ARCHIVE_INVALID");
    const bytes = (
      await command("unzip", ["-p", path, name], {
        encoding: "buffer",
        maxBuffer: MAX_ARCHIVE_BYTES,
      })
    ).stdout;
    entries.push({ name, type: "file", bytes });
  }
  return inspectArchiveEntries(entries, policy);
}

async function scanMirrorObjects(directory, commits, protectedPolicy) {
  const policy = await loadPublicationPolicy({
    root: directory,
    env: {
      PUBLICATION_SENSITIVE_PATTERNS_JSON: JSON.stringify(
        protectedPolicy.exactPatterns.map((pattern) => pattern.toString("utf8")),
      ),
    },
  });
  let findingCount = 0;
  for (const commit of commits) {
    findingCount += scanBytes(Buffer.from(commit.message), {
      policy,
      surface: "remote-history",
      location: Buffer.from(commit.sha),
      objectType: "commit",
      objectId: commit.sha,
    }).length;
    const records = (
      await command("git", ["ls-tree", "-rz", "--full-tree", commit.sha], {
        cwd: directory,
        encoding: "buffer",
      })
    ).stdout;
    for (const raw of records.subarray(0, -1).toString("utf8").split("\0")) {
      const match = raw.match(/^[0-7]{6} blob ([a-f0-9]{40})\t(.+)$/u);
      if (!match) continue;
      const [, objectId, name] = match;
      findingCount += scanPath(Buffer.from(name), {
        policy,
        surface: "remote-history",
        objectType: "blob",
      }).length;
      const bytes = (
        await command("git", ["cat-file", "blob", objectId], { cwd: directory, encoding: "buffer" })
      ).stdout;
      findingCount += scanBytes(bytes, {
        policy,
        surface: "remote-history",
        location: Buffer.from(name),
        objectType: "blob",
        objectId,
      }).length;
    }
  }
  if (findingCount !== 0) fail("REMOTE_PUBLICATION_FINDING");
}

async function buildMirrorSnapshot({
  repository,
  repositoryFullName,
  expectedSha,
  human,
  runs,
  artifacts,
  policy,
}) {
  const directory = await mkdtemp(join(tmpdir(), "atlas-remote-audit-"));
  await chmod(directory, 0o700);
  try {
    await git(directory, ["init", "-q"]);
    await git(directory, ["config", "extensions.partialClone", "false"]);
    const advertised = (await command("git", ["ls-remote", repository])).stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, name] = line.split("\t");
        return { sha, name };
      })
      .filter(({ name }) => name !== "HEAD" && !name.endsWith("^{}"));
    for (const ref of advertised) {
      if (!REF.test(ref.name) || !SHA.test(ref.sha)) fail("REMOTE_REF_UNEXPECTED");
      await git(directory, ["fetch", "--no-tags", repository, `+${ref.name}:${ref.name}`]);
    }
    const alternates = await readFile(
      join(directory, ".git/objects/info/alternates"),
      "utf8",
    ).catch(() => "");
    if (alternates !== "") fail("REMOTE_HISTORY_ALTERNATE");
    const shas = (await git(directory, ["rev-list", "--all"])).split("\n").filter(Boolean);
    const commits = [];
    for (const sha of shas) {
      const fields = (
        await git(directory, [
          "show",
          "-s",
          "--format=%H%x00%P%x00%an%x00%ae%x00%cn%x00%ce%x00%G?%x00%B",
          sha,
        ])
      ).split("\0");
      const reachableFromMain = await command(
        "git",
        ["merge-base", "--is-ancestor", sha, "refs/heads/main"],
        { cwd: directory },
      ).then(
        () => true,
        () => false,
      );
      const paths = (
        await git(directory, ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", sha])
      )
        .split("\n")
        .filter(Boolean);
      let author = { name: fields[2], email: fields[3] };
      let committer = { name: fields[4], email: fields[5] };
      let signature = fields[6] === "G" ? "valid" : "invalid";
      if (!reachableFromMain) {
        const github = JSON.parse(
          (await command("gh", ["api", `repos/${repositoryFullName}/commits/${sha}`])).stdout,
        );
        if (github.author?.login === "dependabot[bot]")
          author = {
            name: "dependabot[bot]",
            email: "49699333+dependabot[bot]@users.noreply.github.com",
          };
        if (github.committer?.login === "web-flow")
          committer = { name: "GitHub", email: "noreply@github.com" };
        signature = github.commit?.verification?.verified === true ? "valid" : "invalid";
      }
      commits.push({
        sha,
        parents: fields[1].split(" ").filter(Boolean),
        reachableFromMain,
        author,
        committer,
        signature,
        message: fields.slice(7).join("\0"),
        trailers: [],
        paths,
      });
    }
    await scanMirrorObjects(directory, commits, policy);
    return verifyRemoteSnapshot({ expectedSha, human, refs: advertised, commits, runs, artifacts });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value || !["--sensitive-fd", "--repo-name", "--evidence"].includes(flag))
      fail("REMOTE_ARGUMENT_INVALID");
    result[flag.slice(2)] = value;
  }
  if (
    result["sensitive-fd"] !== "3" ||
    !/^[A-Za-z0-9._-]+$/u.test(result["repo-name"] ?? "") ||
    !result.evidence
  )
    fail("REMOTE_ARGUMENT_INVALID");
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const policy = await readProtectedPolicyFromFd({ fd: 3 });
  closeSync(3);
  const evidence = parseReleaseEvidence(JSON.parse(await readFile(args.evidence, "utf8")));
  const report = await auditRemoteRelease({
    repoName: args["repo-name"],
    evidence,
    policy,
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

/** Run the complete remote audit with an already-consumed in-memory protected policy. */
export async function auditRemoteRelease({ repoName, evidence, policy }) {
  if (!new Set(["published", "deployed"]).has(evidence.stage))
    fail("REMOTE_EVIDENCE_STAGE_INVALID");
  const view = JSON.parse(
    (await command("gh", ["repo", "view", repoName, "--json", "nameWithOwner,defaultBranchRef"]))
      .stdout,
  );
  if (view.defaultBranchRef?.name !== "main") fail("REMOTE_TARGET_INVALID");
  const repository = `https://github.com/${view.nameWithOwner}.git`;
  const human = {
    name: (await command("git", ["config", "user.name"])).stdout.trim(),
    email: (await command("git", ["config", "user.email"])).stdout.trim(),
  };
  const runsPayload = JSON.parse(
    (
      await command("gh", [
        "api",
        "--paginate",
        "--slurp",
        `repos/${view.nameWithOwner}/actions/runs?per_page=100`,
      ])
    ).stdout,
  );
  const rawRuns = Array.isArray(runsPayload)
    ? runsPayload.flatMap((page) => page.workflow_runs ?? [])
    : (runsPayload.workflow_runs ?? []);
  const rawArtifactsPayload = JSON.parse(
    (
      await command("gh", [
        "api",
        "--paginate",
        "--slurp",
        `repos/${view.nameWithOwner}/actions/artifacts?per_page=100`,
      ])
    ).stdout,
  );
  const rawArtifacts = Array.isArray(rawArtifactsPayload)
    ? rawArtifactsPayload.flatMap((page) => page.artifacts ?? [])
    : (rawArtifactsPayload.artifacts ?? []);
  const capture = await mkdtemp(join(tmpdir(), "atlas-actions-audit-"));
  await chmod(capture, 0o700);
  const runs = [];
  const artifacts = [];
  try {
    for (const run of rawRuns) {
      const archive = join(capture, `run-${run.id}.zip`);
      const bytes = (
        await command("gh", ["api", `repos/${view.nameWithOwner}/actions/runs/${run.id}/logs`], {
          encoding: "buffer",
          maxBuffer: MAX_ARCHIVE_BYTES,
        })
      ).stdout;
      await writeFile(archive, bytes, { mode: 0o600 });
      await inspectZip(archive, policy);
      runs.push({
        id: run.id,
        sha: run.head_sha,
        status: run.status,
        conclusion: run.conclusion,
        logsScanned: true,
        artifactIds: rawArtifacts
          .filter((artifact) => artifact.workflow_run?.id === run.id)
          .map((artifact) => artifact.id),
      });
    }
    for (const artifact of rawArtifacts) {
      const archive = join(capture, `artifact-${artifact.id}.zip`);
      const bytes = (
        await command(
          "gh",
          ["api", `repos/${view.nameWithOwner}/actions/artifacts/${artifact.id}/zip`],
          { encoding: "buffer", maxBuffer: MAX_ARCHIVE_BYTES },
        )
      ).stdout;
      await writeFile(archive, bytes, { mode: 0o600 });
      await inspectZip(archive, policy);
      artifacts.push({
        id: artifact.id,
        runId: artifact.workflow_run?.id,
        scanned: true,
        findingCount: 0,
      });
    }
  } finally {
    await rm(capture, { recursive: true, force: true });
  }
  if (policy.exactPatterns.length < 1) fail("REMOTE_POLICY_EMPTY");
  const report = await buildMirrorSnapshot({
    repository,
    repositoryFullName: view.nameWithOwner,
    expectedSha: evidence.commitSha,
    human,
    runs,
    artifacts,
    policy,
  });
  if (
    report.refCount !== evidence.publication.advertisedRefs.count ||
    report.advertisedRefDigest !== evidence.publication.advertisedRefs.digest ||
    report.commitCount !== evidence.publication.history.commitCount ||
    Object.keys(report.identityClasses).some(
      (key) => report.identityClasses[key] !== evidence.publication.identityClasses[key],
    )
  )
    fail("REMOTE_BASELINE_DRIFT");
  return report;
}

if (await isMainModule(import.meta.url)) {
  main().catch((error) => {
    const code = error instanceof RemoteReleaseError ? error.code : "REMOTE_AUDIT_FAILED";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    process.exitCode = 1;
  });
}
