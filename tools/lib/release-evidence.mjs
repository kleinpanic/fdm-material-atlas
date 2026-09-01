import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const STAGES = Object.freeze(["draft", "candidate", "published", "deployed", "verified"]);
const REVIEW_CATEGORIES = Object.freeze([
  "nyquist",
  "code",
  "security",
  "ui",
  "accessibility",
  "performance",
  "phase-verifier",
]);
const SHA = /^[a-f0-9]{40}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const IDENTIFIER = /^[a-z0-9][a-z0-9-]{0,79}$/u;
const MAX_REVIEW_AGE_MS = 24 * 60 * 60 * 1000;

export class ReleaseEvidenceError extends Error {
  constructor(code) {
    super(code);
    this.name = "ReleaseEvidenceError";
    this.code = code;
  }
}

function fail(code) {
  throw new ReleaseEvidenceError(code);
}

function record(value, code = "RELEASE_EVIDENCE_VALUE_INVALID") {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(code);
  return value;
}

function exactKeys(value, allowed, required = allowed, code = "RELEASE_EVIDENCE_UNKNOWN_KEY") {
  const object = record(value);
  if (Object.keys(object).some((key) => !allowed.includes(key))) fail(code);
  if (required.some((key) => !Object.hasOwn(object, key))) fail("RELEASE_EVIDENCE_MISSING");
  return object;
}

function integer(value, { minimum = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum) fail("RELEASE_EVIDENCE_VALUE_INVALID");
  return value;
}

function timestamp(value) {
  if (typeof value !== "string" || new Date(value).toISOString() !== value)
    fail("RELEASE_EVIDENCE_VALUE_INVALID");
  return value;
}

function safeText(value, maximum = 240) {
  const hasControl =
    typeof value === "string" &&
    [...value].some((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point <= 31 || point === 127;
    });
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    hasControl ||
    /(?:https?:\/\/|authorization|cookie|token|secret|password|\/home\/|[A-Za-z]:\\)/iu.test(value)
  )
    fail("RELEASE_EVIDENCE_VALUE_INVALID");
  return value;
}

function stringList(value, validator = safeText, maximum = 128) {
  if (!Array.isArray(value) || value.length > maximum) fail("RELEASE_EVIDENCE_VALUE_INVALID");
  const parsed = value.map((item) => validator(item));
  if (new Set(parsed).size !== parsed.length) fail("RELEASE_EVIDENCE_VALUE_INVALID");
  return parsed;
}

function digest(value) {
  if (typeof value !== "string" || !DIGEST.test(value)) fail("RELEASE_EVIDENCE_VALUE_INVALID");
  return value;
}

function canonicalDigest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function sha(value) {
  if (typeof value !== "string" || !SHA.test(value)) fail("RELEASE_EVIDENCE_VALUE_INVALID");
  return value;
}

function publicUrl(value, kind) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("RELEASE_EVIDENCE_VALUE_INVALID");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    fail("RELEASE_EVIDENCE_VALUE_INVALID");
  if (kind === "repository" && url.hostname !== "github.com")
    fail("RELEASE_EVIDENCE_VALUE_INVALID");
  if (kind === "pages" && !url.hostname.endsWith(".github.io"))
    fail("RELEASE_EVIDENCE_VALUE_INVALID");
  return url.href.replace(/\/$/u, kind === "pages" ? "/" : "");
}

function clone(value) {
  return structuredClone(value);
}

function parsePrior(value) {
  if (value === null) return null;
  const prior = exactKeys(value, ["commitSha", "digest"]);
  return { commitSha: sha(prior.commitSha), digest: digest(prior.digest) };
}

function parseIdentity(value) {
  const input = exactKeys(value, [
    "treeDigest",
    "workflowDigest",
    "lockfileDigest",
    "rootArtifactDigest",
    "repositoryArtifactDigest",
  ]);
  return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, digest(item)]));
}

function controlledAccount(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(value))
    fail("RELEASE_TARGET_BASELINE_INVALID");
  return value;
}

function controlledRepository(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]{1,100}$/u.test(value))
    fail("RELEASE_TARGET_BASELINE_INVALID");
  return value;
}

function refKind(name) {
  if (name === "refs/heads/main") return "main";
  if (/^refs\/heads\/dependabot\/[A-Za-z0-9._/-]+$/u.test(name)) return "dependabot";
  if (/^refs\/pull\/[1-9][0-9]*\/head$/u.test(name)) return "pull-head";
  if (/^refs\/pull\/[1-9][0-9]*\/merge$/u.test(name)) return "pull-merge";
  fail("RELEASE_TARGET_REF_INVALID");
}

function parseTargetBaseline(value, context) {
  const baseline = exactKeys(value, [
    "observedAt",
    "candidateSha",
    "authenticatedOwner",
    "repositoryName",
    "nameWithOwner",
    "repositoryUrl",
    "priorRemoteMainSha",
    "branch",
    "fullRef",
    "advertisedRefs",
    "identityClasses",
    "history",
    "policy",
    "status",
  ]);
  const observedAt = timestamp(baseline.observedAt);
  if (
    observedAt < context.startedAt ||
    observedAt > context.candidateObservedAt ||
    baseline.candidateSha !== context.rootSha ||
    baseline.priorRemoteMainSha !== context.priorVerifiedCycle?.commitSha ||
    baseline.branch !== "main" ||
    baseline.fullRef !== "refs/heads/main" ||
    baseline.status !== "passed"
  )
    fail("RELEASE_TARGET_BASELINE_INVALID");
  const owner = controlledAccount(baseline.authenticatedOwner);
  const repository = controlledRepository(baseline.repositoryName);
  if (baseline.nameWithOwner !== `${owner}/${repository}`) fail("RELEASE_TARGET_BASELINE_INVALID");
  if (
    publicUrl(baseline.repositoryUrl, "repository") !==
    `https://github.com/${baseline.nameWithOwner}`
  )
    fail("RELEASE_TARGET_BASELINE_INVALID");
  sha(baseline.candidateSha);
  sha(baseline.priorRemoteMainSha);
  const advertised = exactKeys(baseline.advertisedRefs, ["count", "digest", "refs"]);
  if (!Array.isArray(advertised.refs) || advertised.refs.length < 1 || advertised.refs.length > 512)
    fail("RELEASE_TARGET_REF_INVALID");
  const refs = advertised.refs.map((raw) => {
    const ref = exactKeys(
      raw,
      ["name", "sha", "kind"],
      ["name", "sha", "kind"],
      "RELEASE_TARGET_REF_INVALID",
    );
    if (typeof ref.name !== "string" || ref.name.length > 240) fail("RELEASE_TARGET_REF_INVALID");
    const expectedKind = refKind(ref.name);
    if (ref.kind !== expectedKind) fail("RELEASE_TARGET_REF_INVALID");
    sha(ref.sha);
    return clone(ref);
  });
  if (
    new Set(refs.map((ref) => ref.name)).size !== refs.length ||
    refs.some((ref, index) => index > 0 && ref.name <= refs[index - 1].name)
  )
    fail("RELEASE_TARGET_REF_INVALID");
  const main = refs.filter((ref) => ref.kind === "main");
  if (main.length !== 1 || main[0].sha !== baseline.priorRemoteMainSha)
    fail("RELEASE_TARGET_REF_INVALID");
  for (const ref of refs.filter((entry) => entry.kind === "pull-merge")) {
    if (!refs.some((entry) => entry.name === ref.name.replace(/\/merge$/u, "/head")))
      fail("RELEASE_TARGET_REF_INVALID");
  }
  if (advertised.count !== refs.length || digest(advertised.digest) !== canonicalDigest(refs))
    fail("RELEASE_TARGET_REF_INVALID");
  parseIdentityClasses(baseline.identityClasses);
  parseHistory(baseline.history);
  parsePolicy(baseline.policy);
  return clone(baseline);
}

function parsePrepushEvidence(value, context) {
  const proof = exactKeys(value, [
    "observedAt",
    "candidateSha",
    "priorRemoteMainSha",
    "fullRef",
    "refTopologyDigest",
    "settingsDigest",
    "authenticatedOwner",
    "repositoryName",
    "status",
    "proofDigest",
  ]);
  const observedAt = timestamp(proof.observedAt);
  if (
    observedAt <= context.candidateObservedAt ||
    proof.candidateSha !== context.rootSha ||
    proof.priorRemoteMainSha !== context.baseline.priorRemoteMainSha ||
    proof.fullRef !== context.baseline.fullRef ||
    proof.refTopologyDigest !== context.baseline.advertisedRefs.digest ||
    proof.authenticatedOwner !== context.baseline.authenticatedOwner ||
    proof.repositoryName !== context.baseline.repositoryName ||
    proof.status !== "passed"
  )
    fail("RELEASE_PREPUSH_EVIDENCE_INVALID");
  sha(proof.candidateSha);
  sha(proof.priorRemoteMainSha);
  digest(proof.refTopologyDigest);
  digest(proof.settingsDigest);
  controlledAccount(proof.authenticatedOwner);
  controlledRepository(proof.repositoryName);
  digest(proof.proofDigest);
  const canonical = {
    observedAt: proof.observedAt,
    candidateSha: proof.candidateSha,
    priorRemoteMainSha: proof.priorRemoteMainSha,
    fullRef: proof.fullRef,
    refTopologyDigest: proof.refTopologyDigest,
    settingsDigest: proof.settingsDigest,
    authenticatedOwner: proof.authenticatedOwner,
    repositoryName: proof.repositoryName,
    status: proof.status,
  };
  if (proof.proofDigest !== canonicalDigest(canonical)) fail("RELEASE_PREPUSH_EVIDENCE_INVALID");
  return clone(proof);
}

function parseIdentityClasses(value) {
  const identity = exactKeys(value, ["human", "dependabot", "githubService", "unexpected"]);
  integer(identity.human, { minimum: 1 });
  integer(identity.dependabot);
  integer(identity.githubService);
  if (integer(identity.unexpected) !== 0) fail("RELEASE_EVIDENCE_FAILED_STATUS");
  return clone(identity);
}

function parseHistory(value) {
  const history = exactKeys(value, [
    "refCount",
    "commitCount",
    "authorMismatchCount",
    "findingCount",
  ]);
  integer(history.refCount, { minimum: 1 });
  integer(history.commitCount, { minimum: 1 });
  if (integer(history.authorMismatchCount) !== 0 || integer(history.findingCount) !== 0)
    fail("RELEASE_EVIDENCE_FAILED_STATUS");
  return clone(history);
}

function parsePolicy(value) {
  const policy = exactKeys(value, ["scanSessionId", "activePatternCount", "status"]);
  if (!IDENTIFIER.test(policy.scanSessionId) || policy.status !== "passed")
    fail("RELEASE_EVIDENCE_VALUE_INVALID");
  integer(policy.activePatternCount, { minimum: 1 });
  return clone(policy);
}

function parsePublicationOperation(value, context) {
  const operation = exactKeys(value, [
    "kind",
    "priorSha",
    "resultSha",
    "observedAt",
    "proofDigest",
  ]);
  timestamp(operation.observedAt);
  if (
    !["no-op", "fast-forward"].includes(operation.kind) ||
    operation.priorSha !== context.baseline.priorRemoteMainSha ||
    operation.resultSha !== context.rootSha ||
    operation.observedAt <= context.prepushObservedAt ||
    operation.observedAt >= context.publicationObservedAt ||
    (operation.kind === "no-op") !== (operation.priorSha === operation.resultSha)
  )
    fail("RELEASE_PUBLICATION_OPERATION_INVALID");
  sha(operation.priorSha);
  sha(operation.resultSha);
  digest(operation.proofDigest);
  const canonical = {
    kind: operation.kind,
    priorSha: operation.priorSha,
    resultSha: operation.resultSha,
    observedAt: operation.observedAt,
  };
  if (operation.proofDigest !== canonicalDigest(canonical))
    fail("RELEASE_PUBLICATION_OPERATION_INVALID");
  return clone(operation);
}

function sameIdentity(left, right) {
  return Object.keys(left).every((key) => left[key] === right[key]);
}

export function validateReviewBarrier(value, context = {}) {
  const input = exactKeys(value, [
    "candidateSha",
    "candidateCreatedAt",
    "reviewedIdentity",
    "reviews",
    "gapClosure",
  ]);
  const candidateSha = sha(input.candidateSha);
  const createdAt = timestamp(input.candidateCreatedAt);
  if (context.candidateSha !== candidateSha) fail("REVIEW_SHA_MISMATCH");
  const reviewedIdentity = parseIdentity(input.reviewedIdentity);
  const currentIdentity = parseIdentity(context.currentIdentity);
  if (!sameIdentity(reviewedIdentity, currentIdentity)) fail("REVIEW_IDENTITY_CHANGED");
  const now = Date.parse(timestamp(context.now));
  if (!Array.isArray(input.reviews)) fail("REVIEW_CATEGORY_MISSING");
  const reviews = input.reviews.map((raw) => {
    const review = exactKeys(raw, [
      "category",
      "candidateSha",
      "observedAt",
      "status",
      "findingCount",
      "unresolvedReleaseFindingCount",
      "scope",
      "rootArtifactDigest",
      "repositoryArtifactDigest",
    ]);
    if (!REVIEW_CATEGORIES.includes(review.category)) fail("REVIEW_CATEGORY_UNKNOWN");
    if (review.candidateSha !== candidateSha) fail("REVIEW_SHA_MISMATCH");
    const observed = Date.parse(timestamp(review.observedAt));
    if (observed < Date.parse(createdAt) || observed > now || now - observed > MAX_REVIEW_AGE_MS)
      fail("REVIEW_TIMESTAMP_INVALID");
    if (review.status !== "passed") fail("REVIEW_STATUS_INVALID");
    integer(review.findingCount);
    if (integer(review.unresolvedReleaseFindingCount) !== 0) fail("REVIEW_FINDINGS_OPEN");
    if (review.category === "ui" && review.scope !== "whole-product") fail("REVIEW_SCOPE_INVALID");
    safeText(review.scope, 80);
    if (
      digest(review.rootArtifactDigest) !== reviewedIdentity.rootArtifactDigest ||
      digest(review.repositoryArtifactDigest) !== reviewedIdentity.repositoryArtifactDigest
    )
      fail("REVIEW_ARTIFACT_MISMATCH");
    return clone(review);
  });
  for (const category of REVIEW_CATEGORIES) {
    const count = reviews.filter((review) => review.category === category).length;
    if (count === 0) fail("REVIEW_CATEGORY_MISSING");
    if (count !== 1) fail("REVIEW_CATEGORY_DUPLICATE");
  }
  const gap = exactKeys(input.gapClosure, ["status", "discoveredGapCount", "results"]);
  const count = integer(gap.discoveredGapCount);
  if (!Array.isArray(gap.results)) fail("REVIEW_GAP_INVALID");
  if (gap.status === "none-required") {
    if (count !== 0 || gap.results.length !== 0) fail("REVIEW_GAP_INVALID");
  } else if (gap.status === "closed") {
    if (count < 1 || gap.results.length !== count) fail("REVIEW_GAP_INVALID");
    for (const raw of gap.results) {
      const result = exactKeys(raw, ["id", "candidateSha", "status", "rereviewStatus"]);
      if (
        !IDENTIFIER.test(result.id) ||
        result.candidateSha !== candidateSha ||
        result.status !== "passed" ||
        result.rereviewStatus !== "passed"
      )
        fail("REVIEW_GAP_INVALID");
    }
  } else fail("REVIEW_GAP_INVALID");
  return clone(input);
}

function parseProduct(value) {
  const product = exactKeys(value, [
    "materialCount",
    "sourceRecordCount",
    "canonicalSchemaVersion",
    "canonicalDigest",
    "stack",
    "routes",
    "selectorContractVersion",
    "selectorArchitecture",
    "visualizationModes",
    "visualizationArchitecture",
    "workflows",
    "majorDirectories",
    "limitations",
  ]);
  integer(product.materialCount, { minimum: 1 });
  integer(product.sourceRecordCount, { minimum: 1 });
  integer(product.canonicalSchemaVersion, { minimum: 1 });
  digest(product.canonicalDigest);
  stringList(product.stack);
  stringList(product.routes, (route) => {
    if (typeof route !== "string" || !/^\/[a-z0-9/-]*$/u.test(route) || !route.endsWith("/"))
      fail("RELEASE_EVIDENCE_VALUE_INVALID");
    return route;
  });
  integer(product.selectorContractVersion, { minimum: 1 });
  safeText(product.selectorArchitecture);
  stringList(product.visualizationModes, (mode) => {
    if (typeof mode !== "string" || !IDENTIFIER.test(mode)) fail("RELEASE_EVIDENCE_VALUE_INVALID");
    return mode;
  });
  safeText(product.visualizationArchitecture);
  stringList(product.workflows);
  stringList(product.majorDirectories, (path) => {
    if (typeof path !== "string" || isAbsolute(path) || !/^[A-Za-z0-9._/-]+$/u.test(path))
      fail("RELEASE_EVIDENCE_VALUE_INVALID");
    return path;
  });
  stringList(product.limitations);
  return clone(product);
}

function parseCandidate(value, context) {
  const allowed = [
    "observedAt",
    "targetBaseline",
    "prepushEvidence",
    "product",
    "quality",
    "reviewBarrier",
  ];
  const required = ["observedAt", "product", "quality", "reviewBarrier"];
  if (context.priorVerifiedCycle) required.push("targetBaseline");
  const candidate = exactKeys(value, allowed, required);
  timestamp(candidate.observedAt);
  let baseline;
  if (candidate.targetBaseline !== undefined) {
    baseline = parseTargetBaseline(candidate.targetBaseline, {
      ...context,
      candidateObservedAt: candidate.observedAt,
    });
  }
  if (candidate.prepushEvidence !== undefined) {
    if (!baseline) fail("RELEASE_PREPUSH_EVIDENCE_INVALID");
    parsePrepushEvidence(candidate.prepushEvidence, {
      rootSha: context.rootSha,
      candidateObservedAt: candidate.observedAt,
      baseline,
    });
  }
  parseProduct(candidate.product);
  const quality = exactKeys(candidate.quality, [
    "rootArtifactDigest",
    "repositoryArtifactDigest",
    "checks",
  ]);
  digest(quality.rootArtifactDigest);
  digest(quality.repositoryArtifactDigest);
  if (!Array.isArray(quality.checks) || quality.checks.length < 1) fail("RELEASE_EVIDENCE_MISSING");
  for (const raw of quality.checks) {
    const check = exactKeys(raw, ["id", "status", "observedAt"]);
    if (!IDENTIFIER.test(check.id) || check.status !== "passed")
      fail("RELEASE_EVIDENCE_VALUE_INVALID");
    timestamp(check.observedAt);
  }
  validateReviewBarrier(candidate.reviewBarrier, {
    candidateSha: context.rootSha,
    now: candidate.reviewBarrier.reviews.reduce(
      (latest, review) => (review.observedAt > latest ? review.observedAt : latest),
      candidate.observedAt,
    ),
    currentIdentity: candidate.reviewBarrier.reviewedIdentity,
  });
  return clone(candidate);
}

function parsePublication(value, candidate, rootSha) {
  const publication = exactKeys(value, [
    "observedAt",
    "targetBaseline",
    "prepushEvidence",
    "operation",
    "repository",
    "advertisedRefs",
    "identityClasses",
    "history",
    "policy",
  ]);
  timestamp(publication.observedAt);
  if (!candidate.targetBaseline || !candidate.prepushEvidence)
    fail("RELEASE_PREPUSH_EVIDENCE_INVALID");
  const targetBaseline = parseTargetBaseline(publication.targetBaseline, {
    rootSha,
    startedAt: candidate.targetBaseline.observedAt,
    candidateObservedAt: candidate.observedAt,
    priorVerifiedCycle: { commitSha: candidate.targetBaseline.priorRemoteMainSha },
  });
  const prepushEvidence = parsePrepushEvidence(publication.prepushEvidence, {
    rootSha,
    candidateObservedAt: candidate.observedAt,
    baseline: targetBaseline,
  });
  parsePublicationOperation(publication.operation, {
    rootSha,
    baseline: targetBaseline,
    prepushObservedAt: prepushEvidence.observedAt,
    publicationObservedAt: publication.observedAt,
  });
  if (
    JSON.stringify(targetBaseline) !== JSON.stringify(candidate.targetBaseline) ||
    JSON.stringify(prepushEvidence) !== JSON.stringify(candidate.prepushEvidence) ||
    publication.observedAt <= prepushEvidence.observedAt
  )
    fail("RELEASE_PUBLICATION_BASELINE_MISMATCH");
  const repository = exactKeys(publication.repository, [
    "nameWithOwner",
    "url",
    "visibility",
    "defaultBranch",
  ]);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository.nameWithOwner))
    fail("RELEASE_EVIDENCE_VALUE_INVALID");
  publicUrl(repository.url, "repository");
  if (repository.visibility !== "PUBLIC" || repository.defaultBranch !== "main")
    fail("RELEASE_EVIDENCE_VALUE_INVALID");
  if (
    repository.nameWithOwner !== targetBaseline.nameWithOwner ||
    repository.url !== targetBaseline.repositoryUrl
  )
    fail("RELEASE_PUBLICATION_BASELINE_MISMATCH");
  const advertisedRefs = exactKeys(publication.advertisedRefs, ["count", "digest"]);
  integer(advertisedRefs.count, { minimum: 1 });
  digest(advertisedRefs.digest);
  parseIdentityClasses(publication.identityClasses);
  parseHistory(publication.history);
  parsePolicy(publication.policy);
  if (
    advertisedRefs.count !== targetBaseline.advertisedRefs.count ||
    advertisedRefs.digest !== targetBaseline.advertisedRefs.digest ||
    JSON.stringify(publication.identityClasses) !==
      JSON.stringify(targetBaseline.identityClasses) ||
    JSON.stringify(publication.history) !== JSON.stringify(targetBaseline.history) ||
    JSON.stringify(publication.policy) !== JSON.stringify(targetBaseline.policy)
  )
    fail("RELEASE_PUBLICATION_BASELINE_MISMATCH");
  return clone(publication);
}

function parseDeployment(value, rootSha) {
  const deployment = exactKeys(value, ["observedAt", "workflow", "pages"]);
  timestamp(deployment.observedAt);
  const workflow = exactKeys(deployment.workflow, [
    "databaseId",
    "file",
    "event",
    "branch",
    "ref",
    "sha",
    "runAttempt",
    "jobs",
  ]);
  integer(workflow.databaseId, { minimum: 1 });
  if (
    !/^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/u.test(workflow.file) ||
    !["push", "workflow_dispatch"].includes(workflow.event) ||
    workflow.branch !== "main" ||
    workflow.ref !== "refs/heads/main" ||
    workflow.sha !== rootSha
  )
    fail("RELEASE_WORKFLOW_MISMATCH");
  integer(workflow.runAttempt, { minimum: 1 });
  if (!Array.isArray(workflow.jobs) || workflow.jobs.length !== 3)
    fail("RELEASE_WORKFLOW_MISMATCH");
  const expectedJobs = ["build", "deploy", "probe"];
  for (const name of expectedJobs) {
    const matches = workflow.jobs.filter((job) => job?.name === name);
    if (matches.length !== 1) fail("RELEASE_WORKFLOW_MISMATCH");
    const job = exactKeys(matches[0], ["name", "databaseId", "conclusion"]);
    integer(job.databaseId, { minimum: 1 });
    if (job.conclusion !== "success") fail("RELEASE_EVIDENCE_FAILED_STATUS");
  }
  const pages = exactKeys(deployment.pages, [
    "environment",
    "artifact",
    "deployConsumerJobId",
    "url",
    "status",
    "httpsEnforced",
  ]);
  if (
    pages.environment !== "github-pages" ||
    pages.status !== "built" ||
    pages.httpsEnforced !== true
  )
    fail("RELEASE_EVIDENCE_FAILED_STATUS");
  const artifact = exactKeys(pages.artifact, ["id", "name", "digest", "producerJobId"]);
  integer(artifact.id, { minimum: 1 });
  if (artifact.name !== "github-pages") fail("RELEASE_WORKFLOW_MISMATCH");
  digest(artifact.digest);
  integer(artifact.producerJobId, { minimum: 1 });
  integer(pages.deployConsumerJobId, { minimum: 1 });
  if (
    artifact.producerJobId !== workflow.jobs.find((job) => job.name === "build").databaseId ||
    pages.deployConsumerJobId !== workflow.jobs.find((job) => job.name === "deploy").databaseId
  )
    fail("RELEASE_WORKFLOW_MISMATCH");
  publicUrl(pages.url, "pages");
  return clone(deployment);
}

function parseVerification(value, rootSha) {
  const verification = exactKeys(value, [
    "observedAt",
    "live",
    "remote",
    "accessibility",
    "performance",
  ]);
  timestamp(verification.observedAt);
  const live = exactKeys(verification.live, ["routeCount", "assetCount", "findingCount", "status"]);
  integer(live.routeCount, { minimum: 1 });
  integer(live.assetCount, { minimum: 1 });
  if (integer(live.findingCount) !== 0 || live.status !== "passed")
    fail("RELEASE_EVIDENCE_FAILED_STATUS");
  const remote = exactKeys(verification.remote, [
    "refCount",
    "commitCount",
    "advertisedRefDigest",
    "mainSha",
    "findingCount",
    "status",
  ]);
  integer(remote.refCount, { minimum: 1 });
  integer(remote.commitCount, { minimum: 1 });
  digest(remote.advertisedRefDigest);
  if (remote.mainSha !== rootSha) fail("RELEASE_REMOTE_SHA_MISMATCH");
  sha(remote.mainSha);
  if (integer(remote.findingCount) !== 0 || remote.status !== "passed")
    fail("RELEASE_EVIDENCE_FAILED_STATUS");
  for (const key of ["accessibility", "performance"]) {
    const item = exactKeys(verification[key], ["status", "scope"]);
    if (item.status !== "passed") fail("RELEASE_EVIDENCE_FAILED_STATUS");
    safeText(item.scope, 100);
  }
  return clone(verification);
}

export function parseReleaseEvidence(value) {
  const stage = record(value).stage;
  if (!STAGES.includes(stage)) fail("RELEASE_STAGE_INVALID");
  const stageIndex = STAGES.indexOf(stage);
  const stageFields = ["candidate", "publication", "deployment", "verification"].slice(
    0,
    stageIndex,
  );
  const allowed = [
    "schemaVersion",
    "cycleId",
    "stage",
    "commitSha",
    "startedAt",
    "reason",
    "priorVerifiedCycle",
    ...stageFields,
  ];
  const input = exactKeys(value, allowed);
  if (input.schemaVersion !== 1 || !IDENTIFIER.test(input.cycleId))
    fail("RELEASE_EVIDENCE_VALUE_INVALID");
  sha(input.commitSha);
  timestamp(input.startedAt);
  if (
    ![
      "candidate-updated",
      "source-change",
      "review-remediation",
      "deployment-remediation",
    ].includes(input.reason)
  )
    fail("RELEASE_EVIDENCE_VALUE_INVALID");
  parsePrior(input.priorVerifiedCycle);
  if (stageIndex >= 1)
    parseCandidate(input.candidate, {
      rootSha: input.commitSha,
      startedAt: input.startedAt,
      priorVerifiedCycle: input.priorVerifiedCycle,
    });
  if (stageIndex >= 2) parsePublication(input.publication, input.candidate, input.commitSha);
  if (stageIndex >= 3) parseDeployment(input.deployment, input.commitSha);
  if (stageIndex >= 4) parseVerification(input.verification, input.commitSha);
  const times = [
    input.startedAt,
    input.candidate?.observedAt,
    input.publication?.observedAt,
    input.deployment?.observedAt,
    input.verification?.observedAt,
  ].filter(Boolean);
  if (times.some((time, index) => index > 0 && time <= times[index - 1]))
    fail("RELEASE_TIMESTAMP_STALE");
  return clone(input);
}

export function startFreshReleaseCycle(value) {
  const input = exactKeys(value, [
    "cycleId",
    "commitSha",
    "startedAt",
    "reason",
    "priorVerifiedCycle",
  ]);
  const prior = parsePrior(input.priorVerifiedCycle);
  if (prior?.commitSha === input.commitSha) fail("RELEASE_CYCLE_SHA_REUSED");
  return parseReleaseEvidence({ schemaVersion: 1, stage: "draft", ...clone(input) });
}

export function advanceReleaseEvidence(current, transition) {
  const parsed = parseReleaseEvidence(current);
  const input = exactKeys(transition, ["stage", "observation"]);
  const nextIndex = STAGES.indexOf(input.stage);
  if (nextIndex !== STAGES.indexOf(parsed.stage) + 1) fail("RELEASE_STAGE_ORDER_INVALID");
  const field = [null, "candidate", "publication", "deployment", "verification"][nextIndex];
  return parseReleaseEvidence({ ...parsed, stage: input.stage, [field]: clone(input.observation) });
}

export function attachPrepushEvidence(current, proof) {
  const parsed = parseReleaseEvidence(current);
  if (parsed.stage !== "candidate") fail("RELEASE_PREPUSH_STAGE_INVALID");
  if (parsed.candidate.prepushEvidence !== undefined) fail("RELEASE_PREPUSH_DUPLICATE");
  return parseReleaseEvidence({
    ...parsed,
    candidate: { ...parsed.candidate, prepushEvidence: clone(proof) },
  });
}

function inside(root, path) {
  const rel = relative(root, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function insideOrSame(root, path) {
  return path === root || inside(root, path);
}

async function gitOk(root, args) {
  try {
    await execFileAsync("git", args, {
      cwd: root,
      env: { PATH: process.env.PATH, LANG: "C", LC_ALL: "C" },
      maxBuffer: 1024 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

export async function writeReleaseEvidence(path, value, { root = process.cwd() } = {}) {
  const parsed = parseReleaseEvidence(value);
  const physicalRoot = await realpath(resolve(root)).catch(() =>
    fail("RELEASE_EVIDENCE_DESTINATION_UNSAFE"),
  );
  const destination = resolve(path);
  if (!inside(physicalRoot, destination)) fail("RELEASE_EVIDENCE_DESTINATION_UNSAFE");
  const physicalParent = await realpath(dirname(destination)).catch(() =>
    fail("RELEASE_EVIDENCE_DESTINATION_UNSAFE"),
  );
  if (!insideOrSame(physicalRoot, physicalParent)) fail("RELEASE_EVIDENCE_DESTINATION_UNSAFE");
  const rel = relative(physicalRoot, destination).split(sep).join("/");
  if (
    !(await gitOk(physicalRoot, ["check-ignore", "-q", "--", rel])) ||
    (await gitOk(physicalRoot, ["ls-files", "--error-unmatch", "--", rel]))
  )
    fail("RELEASE_EVIDENCE_DESTINATION_UNSAFE");
  const existing = await lstat(destination).catch((error) =>
    error?.code === "ENOENT" ? null : fail("RELEASE_EVIDENCE_DESTINATION_UNSAFE"),
  );
  if (existing && (!existing.isFile() || existing.isSymbolicLink()))
    fail("RELEASE_EVIDENCE_DESTINATION_UNSAFE");
  const temp = `${destination}.tmp-${randomBytes(12).toString("hex")}`;
  let handle;
  try {
    handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    await handle.writeFile(`${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temp, destination);
    await chmod(destination, 0o600);
    const directory = await open(dirname(destination), constants.O_RDONLY);
    await directory.sync().catch(() => {});
    await directory.close();
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temp).catch(() => {});
    if (error instanceof ReleaseEvidenceError) throw error;
    fail("RELEASE_EVIDENCE_WRITE_FAILED");
  }
}
