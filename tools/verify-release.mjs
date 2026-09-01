#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readdir, readFile, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { advanceReleaseEvidence, parseReleaseEvidence } from "./lib/release-evidence.mjs";
import { isMainModule } from "./lib/main-module.mjs";
import { OPERATIONAL_PATH_EXCEPTIONS, OPERATIONAL_PATH_PATTERNS } from "./lib/prohibited-paths.mjs";
import { readProtectedPolicyFromFd } from "./lib/protected-policy-input.mjs";
import { assertRepository } from "./lib/repository-guard.mjs";
import { scanPublication } from "./scan-publication.mjs";

const execFileAsync = promisify(execFile);
const EXPECTED_OWNER = "kleinpanic";
const EXPECTED_REPOSITORY = "kleinpanic/fdm-material-atlas";
const EXPECTED_ORIGINS = new Set([
  "git@github.com:kleinpanic/fdm-material-atlas.git",
  "https://github.com/kleinpanic/fdm-material-atlas.git",
]);
const SHA = /^[a-f0-9]{40}$/u;
const QUALITY_COMMANDS = Object.freeze([
  ["install", "npm", ["ci", "--ignore-scripts"]],
  ["browser-install", "npm", ["exec", "--no", "--", "playwright", "install", "chromium"]],
  ["ci-all", "npm", ["run", "ci:all"]],
  ["build-root", "npm", ["run", "build:root"]],
  ["build-repository", "npm", ["run", "build:repository"]],
]);
const ALLOWED_IGNORED_ROOTS = new Set([
  ".agents",
  ".astro",
  ".claude",
  ".codex",
  ".cursor",
  ".gemini",
  ".gsd",
  ".opencode",
  ".planning",
  ".publication-audit",
  ".windsurf",
  "AGENTS.md",
  "CLAUDE.md",
  "CODEX.md",
  "GEMINI.md",
  "coverage",
  "dist",
  "dist-test",
  "node_modules",
  "playwright-report",
  "test-results",
]);

export class ReleaseVerificationError extends Error {
  constructor(code) {
    super(code);
    this.name = "ReleaseVerificationError";
    this.code = code;
  }
}

function fail(code) {
  throw new ReleaseVerificationError(code);
}

function controlled(error, fallback) {
  if (error instanceof ReleaseVerificationError) return error;
  return new ReleaseVerificationError(fallback);
}

function minimalEnvironment(extra = {}) {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    LANG: "C",
    LC_ALL: "C",
    CI: "1",
    ...extra,
  };
}

async function command(file, args, { cwd, timeout = 30 * 60 * 1000, env = {} } = {}) {
  const { stdout } = await execFileAsync(file, [...args], {
    cwd,
    env: minimalEnvironment(env),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout,
    windowsHide: true,
  });
  return stdout;
}

function credentialPatterns() {
  return [
    /gh[pousr]_[A-Za-z0-9]{30,}/g,
    /github_pat_[A-Za-z0-9_]{50,}/g,
    /AIza[0-9A-Za-z_-]{35}/g,
    /ya29\.[0-9A-Za-z_-]{20,}/g,
    /1\/\/[0-9A-Za-z_-]{30,}/g,
    /GOCSPX-[0-9A-Za-z_-]{20,}/g,
    /authorization\s*:\s*bearer\s+[0-9A-Za-z._~+/-]{16,}={0,2}/gi,
    /AKIA[A-Z0-9]{16}/g,
    /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{16,}/gi,
    /(?:cookie|session(?:_?token|_?id)?)\s*[:=]\s*["']?[^\s"';]{16,}/gi,
    new RegExp(["-----BEGIN ", "(?:[A-Z0-9]+ )*", "PRIVATE KEY", "-----"].join(""), "g"),
  ];
}

function scannerPolicy(protectedPolicy) {
  return Object.freeze({
    exactPatterns: Object.freeze(
      protectedPolicy.exactPatterns.map((bytes) => ({
        ruleId: "private-source-pattern",
        bytes: Buffer.from(bytes),
      })),
    ),
    operationalPathPatterns: OPERATIONAL_PATH_PATTERNS,
    operationalPathExceptions: OPERATIONAL_PATH_EXCEPTIONS,
    credentialPatterns: Object.freeze(credentialPatterns()),
    maximumBytes: 64 * 1024 * 1024,
  });
}

export function parseReleaseArguments(argv) {
  if (!Array.isArray(argv) || !["pre-publication", "post-publication"].includes(argv[0]))
    fail("RELEASE_ARGUMENTS_INVALID");
  const result = { mode: argv[0], dryRunFixture: false };
  const seen = new Set();
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (seen.has(flag)) fail("RELEASE_ARGUMENTS_INVALID");
    seen.add(flag);
    if (flag === "--dry-run-fixture") result.dryRunFixture = true;
    else if (flag === "--sensitive-fd") {
      const value = argv[index + 1];
      if (value !== "3") fail("RELEASE_POLICY_DESCRIPTOR_INVALID");
      result.sensitiveFd = 3;
      index += 1;
    } else fail("RELEASE_ARGUMENTS_INVALID");
  }
  if (!result.dryRunFixture && result.sensitiveFd !== 3) fail("RELEASE_POLICY_DESCRIPTOR_INVALID");
  if (result.mode === "pre-publication" && !result.dryRunFixture)
    fail("RELEASE_LEGACY_MODE_FIXTURE_ONLY");
  return result;
}

async function listRoutes(outputRoot) {
  const routes = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) fail("RELEASE_ARTIFACT_TOPOLOGY_INVALID");
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name === "index.html") {
        const rel = relative(outputRoot, path).split(sep).join("/");
        routes.push(rel === "index.html" ? "/" : `/${rel.slice(0, -"index.html".length)}`);
      }
    }
  }
  await walk(outputRoot);
  return routes.sort();
}

export async function deriveProductObservations({ root = process.cwd() } = {}) {
  try {
    const physicalRoot = await realpath(resolve(root));
    const canonicalBytes = await readFile(join(physicalRoot, "src/data/public/atlas.v1.json"));
    const atlas = JSON.parse(canonicalBytes.toString("utf8"));
    const packageManifest = JSON.parse(await readFile(join(physicalRoot, "package.json"), "utf8"));
    const routes = await listRoutes(join(physicalRoot, "dist-test/root"));
    const workflows = (await readdir(join(physicalRoot, ".github/workflows")))
      .filter((name) => /\.ya?ml$/u.test(name))
      .sort();
    const mapContract = await readFile(join(physicalRoot, "src/features/map/contracts.ts"), "utf8");
    const visualizationModes = [
      "decision-paths",
      "thermal-ranges",
      "process-gates",
      "impact-flex-space",
    ];
    if (visualizationModes.some((mode) => !mapContract.includes(`"${mode}"`)))
      fail("RELEASE_PRODUCT_OBSERVATION_INVALID");
    const dependencyNames = new Set([
      ...Object.keys(packageManifest.dependencies ?? {}),
      ...Object.keys(packageManifest.devDependencies ?? {}),
    ]);
    const stack = ["astro", "preact", "tailwindcss", "typescript"].filter((name) =>
      dependencyNames.has(name),
    );
    const majorDirectories = [".github", "docs", "src", "tests", "tools"];
    for (const directory of majorDirectories) await realpath(join(physicalRoot, directory));
    if (
      atlas.schemaVersion !== 1 ||
      !Array.isArray(atlas.materials) ||
      atlas.materials.length < 1 ||
      !Array.isArray(atlas.sources) ||
      atlas.sources.length < 1 ||
      stack.length !== 4 ||
      routes.length < 6 ||
      !routes.includes("/") ||
      !routes.includes("/materials/") ||
      !workflows.includes("pages.yml")
    )
      fail("RELEASE_PRODUCT_OBSERVATION_INVALID");
    return Object.freeze({
      materialCount: atlas.materials.length,
      sourceRecordCount: atlas.sources.length,
      canonicalSchemaVersion: atlas.schemaVersion,
      canonicalDigest: `sha256:${createHash("sha256").update(canonicalBytes).digest("hex")}`,
      stack,
      routes,
      selectorContractVersion: 1,
      selectorArchitecture: "Deterministic pure ranking engine with shared explanations",
      visualizationModes,
      visualizationArchitecture: "Static projections with one route-local interactive island",
      workflows,
      majorDirectories,
      limitations: [
        "Family guidance is not a universal product specification.",
        "Starting profiles require calibration.",
      ],
    });
  } catch (error) {
    throw controlled(error, "RELEASE_PRODUCT_OBSERVATION_INVALID");
  }
}

async function defaultIgnored(root) {
  const output = await command(
    "git",
    ["status", "--ignored", "--porcelain=v1", "--untracked-files=all"],
    { cwd: root },
  );
  const unexpected = new Set();
  for (const line of output.split("\n").filter((item) => item.startsWith("!! "))) {
    const path = line.slice(3).replace(/\/$/u, "");
    const top = path.split("/")[0];
    if (!ALLOWED_IGNORED_ROOTS.has(top)) unexpected.add(top);
  }
  return [...unexpected].sort();
}

async function digestFiles(root, paths) {
  const hash = createHash("sha256");
  for (const path of [...paths].sort()) {
    hash.update(path).update(Buffer.from([0]));
    hash.update(await readFile(join(root, path))).update(Buffer.from([0]));
  }
  return `sha256:${hash.digest("hex")}`;
}

async function defaultIdentity(root, git) {
  const tree = (await git(["rev-parse", "HEAD^{tree}"])).trim();
  if (!SHA.test(tree)) fail("RELEASE_IDENTITY_INVALID");
  return {
    treeDigest: `sha256:${createHash("sha256").update(tree).digest("hex")}`,
    workflowDigest: await digestFiles(
      root,
      (await readdir(join(root, ".github/workflows")))
        .filter((name) => /\.ya?ml$/u.test(name))
        .map((name) => `.github/workflows/${name}`),
    ),
    lockfileDigest: await digestFiles(root, ["package-lock.json"]),
  };
}

async function defaultGithub(root) {
  const login = JSON.parse(await command("gh", ["api", "user"], { cwd: root })).login;
  const repository = JSON.parse(
    await command(
      "gh",
      [
        "repo",
        "view",
        EXPECTED_REPOSITORY,
        "--json",
        "nameWithOwner,url,visibility,defaultBranchRef",
      ],
      { cwd: root },
    ),
  );
  const refsText = await command("git", ["ls-remote", "--refs", "origin"], { cwd: root });
  return {
    login,
    repository: {
      nameWithOwner: repository.nameWithOwner,
      url: repository.url,
      visibility: repository.visibility,
      defaultBranch: repository.defaultBranchRef?.name,
    },
    advertisedRefs: refsText
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, name] = line.split("\t");
        return { name, sha };
      }),
  };
}

async function defaultQuality(root, id) {
  const selected = QUALITY_COMMANDS.find(([candidate]) => candidate === id);
  if (!selected) fail("RELEASE_QUALITY_COMMAND_INVALID");
  await command(selected[1], selected[2], { cwd: root });
  return { status: "passed" };
}

function sameIdentity(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function verifyReleaseCandidate(options = {}) {
  const {
    mode,
    root = process.cwd(),
    evidence,
    reviewBarrier,
    sensitiveFd,
    syntheticPolicy,
    dependencies: injected = {},
  } = options;
  if (!["pre-publication", "post-publication"].includes(mode)) fail("RELEASE_MODE_INVALID");
  if (!syntheticPolicy && sensitiveFd !== 3) fail("RELEASE_POLICY_DESCRIPTOR_INVALID");
  let physicalRoot;
  try {
    physicalRoot = await realpath(resolve(root));
  } catch {
    fail("RELEASE_REPOSITORY_INVALID");
  }
  const git = injected.git ?? ((args) => command("git", args, { cwd: physicalRoot }));
  const readPolicy = injected.readPolicy ?? readProtectedPolicyFromFd;
  let protectedPolicy;
  try {
    protectedPolicy = syntheticPolicy ?? (await readPolicy({ fd: sensitiveFd }));
  } catch {
    fail("RELEASE_POLICY_INPUT_INVALID");
  }
  if (!protectedPolicy?.exactPatterns?.length) fail("RELEASE_POLICY_INPUT_INVALID");
  const policy = scannerPolicy(protectedPolicy);
  const parsedEvidence = parseReleaseEvidence(evidence);
  const head = (await git(["rev-parse", "HEAD"])).trim();
  if (head !== parsedEvidence.commitSha || !SHA.test(head)) fail("RELEASE_SHA_MISMATCH");
  if ((await git(["symbolic-ref", "-q", "HEAD"])).trim() !== "refs/heads/main")
    fail("RELEASE_BRANCH_INVALID");
  if ((await git(["status", "--porcelain=v1", "--untracked-files=all"])).trim() !== "")
    fail("RELEASE_WORKTREE_DIRTY");

  if (mode === "post-publication") {
    if (!parsedEvidence.priorVerifiedCycle) fail("RELEASE_PRIOR_SHA_MISSING");
    const origin = (await git(["remote", "get-url", "origin"])).trim();
    if (!EXPECTED_ORIGINS.has(origin)) fail("RELEASE_ORIGIN_INVALID");
    const remoteMain = (await git(["rev-parse", "--verify", "refs/remotes/origin/main"])).trim();
    if (remoteMain !== parsedEvidence.priorVerifiedCycle.commitSha) fail("RELEASE_PRIOR_SHA_STALE");
    try {
      await git(["merge-base", "--is-ancestor", remoteMain, head]);
    } catch {
      fail("RELEASE_HISTORY_NOT_DESCENDANT");
    }
    const github = await (injected.github ?? defaultGithub)(physicalRoot);
    if (
      github.login !== EXPECTED_OWNER ||
      github.repository?.nameWithOwner !== EXPECTED_REPOSITORY ||
      github.repository?.visibility !== "PUBLIC" ||
      github.repository?.defaultBranch !== "main" ||
      github.repository?.url !== `https://github.com/${EXPECTED_REPOSITORY}` ||
      !github.advertisedRefs?.some(
        (ref) =>
          ref.name === "refs/heads/main" && ref.sha === parsedEvidence.priorVerifiedCycle.commitSha,
      )
    )
      fail("RELEASE_AUTHENTICATED_TARGET_INVALID");
  } else {
    const remoteCount = (await git(["remote"])).trim();
    if (remoteCount !== "") fail("RELEASE_LEGACY_REMOTE_PRESENT");
  }

  const localRefs = (await git(["for-each-ref", "--format=%(refname)"]))
    .trim()
    .split("\n")
    .filter(Boolean);
  const allowedRefs =
    mode === "post-publication"
      ? new Set(["refs/heads/main", "refs/remotes/origin/main"])
      : new Set(["refs/heads/main"]);
  if (localRefs.some((ref) => !allowedRefs.has(ref)) || !localRefs.includes("refs/heads/main"))
    fail("RELEASE_LOCAL_REFS_INVALID");

  try {
    await (injected.inspectRepository ?? assertRepository)({
      cwd: physicalRoot,
      expectedRoot: physicalRoot,
      remotePolicy: mode === "post-publication" ? "any" : "absent",
    });
  } catch {
    fail("RELEASE_REPOSITORY_INVALID");
  }

  const observeIdentity =
    injected.observeIdentity ?? (async () => defaultIdentity(physicalRoot, git));
  const identityBefore = await observeIdentity();
  const qualityChecks = [];
  for (const [id] of QUALITY_COMMANDS) {
    const result = await (injected.runQuality ?? ((name) => defaultQuality(physicalRoot, name)))(
      id,
    );
    if (result?.status !== "passed") fail("RELEASE_QUALITY_FAILED");
    qualityChecks.push({
      id,
      status: "passed",
      observedAt: (injected.now ?? (() => new Date().toISOString()))(),
    });
  }
  const unexpectedIgnored = await (injected.inspectIgnored ?? defaultIgnored)(physicalRoot);
  if (!Array.isArray(unexpectedIgnored) || unexpectedIgnored.length > 0)
    fail("RELEASE_IGNORED_ROOT_INVALID");
  const scan =
    injected.scan ??
    (async (surface) => {
      const mapping = {
        working: ["working"],
        tracked: ["tracked"],
        history: ["history"],
        "artifact-root": ["artifact", join(physicalRoot, "dist-test/root")],
        "artifact-repository": ["artifact", join(physicalRoot, "dist-test/repository")],
      };
      const [scanMode, artifactPath] = mapping[surface];
      return scanPublication({ root: physicalRoot, mode: scanMode, artifactPath, policy });
    });
  const scanResults = {};
  for (const surface of ["working", "tracked", "history", "artifact-root", "artifact-repository"]) {
    const report = await scan(surface, { policy, root: physicalRoot });
    if (!report || report.findingCount !== 0) fail("RELEASE_PUBLICATION_SCAN_FAILED");
    scanResults[surface] = report;
  }
  const rootArtifactDigest = scanResults["artifact-root"].artifactDigest;
  const repositoryArtifactDigest = scanResults["artifact-repository"].artifactDigest;
  if (!rootArtifactDigest || !repositoryArtifactDigest) fail("RELEASE_ARTIFACT_DIGEST_MISSING");
  const product = await (injected.observeProduct ?? deriveProductObservations)({
    root: physicalRoot,
  });
  const identityAfter = await observeIdentity();
  if (!sameIdentity(identityBefore, identityAfter)) fail("RELEASE_CANDIDATE_MUTATED");
  const completeIdentity = { ...identityAfter, rootArtifactDigest, repositoryArtifactDigest };
  if (!sameIdentity(completeIdentity, reviewBarrier?.reviewedIdentity))
    fail("RELEASE_REVIEW_IDENTITY_MISMATCH");
  return advanceReleaseEvidence(parsedEvidence, {
    stage: "candidate",
    observation: {
      observedAt: (injected.now ?? (() => new Date().toISOString()))(),
      product,
      quality: { rootArtifactDigest, repositoryArtifactDigest, checks: qualityChecks },
      reviewBarrier,
    },
  });
}

async function readJsonNoFollow(path) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const details = await handle.stat();
    if (!details.isFile() || details.size > 1024 * 1024) fail("RELEASE_INPUT_INVALID");
    return JSON.parse((await handle.readFile()).toString("utf8"));
  } catch (error) {
    throw controlled(error, "RELEASE_INPUT_INVALID");
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function main() {
  try {
    const args = parseReleaseArguments(process.argv.slice(2));
    if (args.dryRunFixture) {
      process.stdout.write(
        `${JSON.stringify({ ok: true, mode: args.mode, code: "RELEASE_LOCAL_FIXTURE_PASSED" })}\n`,
      );
      return;
    }
    const root = await realpath(process.cwd());
    const evidence = await readJsonNoFollow(join(root, ".publication-audit/release-evidence.json"));
    const reviewBarrier = await readJsonNoFollow(
      join(root, ".publication-audit/review-barrier.json"),
    );
    const result = await verifyReleaseCandidate({ ...args, root, evidence, reviewBarrier });
    process.stdout.write(
      `${JSON.stringify({ ok: true, stage: result.stage, commitSha: result.commitSha })}\n`,
    );
  } catch (error) {
    const code =
      error instanceof ReleaseVerificationError ? error.code : "RELEASE_VERIFICATION_FAILED";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    process.exitCode = 1;
  }
}

if (await isMainModule(import.meta.url)) await main();
