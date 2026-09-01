#!/usr/bin/env node

import { lstat, readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isMainModule } from "./lib/main-module.mjs";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_FILES = 12;
const MAX_WORKFLOW_BYTES = 256 * 1024;
const NODE_VERSION = "22.23.1";
const LYCHEE_URL =
  "https://github.com/lycheeverse/lychee/releases/download/lychee-v0.24.2/lychee-x86_64-unknown-linux-gnu.tar.gz";
const LYCHEE_SHA256 = "1f4e0ef7f6554a6ed33dd7ac144fb2e1bbed98598e7af973042fc5cd43951c9a";

const CONTROLLED_FILES = Object.freeze({
  "ci.yml": "ci",
  "ci.yaml": "ci",
  "pages.yml": "pages",
  "pages.yaml": "pages",
  "dependency-review.yml": "dependency-review",
  "dependency-review.yaml": "dependency-review",
  "link-health.yml": "link-health",
  "link-health.yaml": "link-health",
});

const ACTIONS = Object.freeze({
  "actions/checkout": Object.freeze({
    sha: "3d3c42e5aac5ba805825da76410c181273ba90b1",
    tag: "v7.0.1",
  }),
  "actions/setup-node": Object.freeze({
    sha: "820762786026740c76f36085b0efc47a31fe5020",
    tag: "v7.0.0",
  }),
  "actions/configure-pages": Object.freeze({
    sha: "45bfe0192ca1faeb007ade9deae92b16b8254a0d",
    tag: "v6.0.0",
  }),
  "actions/upload-pages-artifact": Object.freeze({
    sha: "fc324d3547104276b827a68afc52ff2a11cc49c9",
    tag: "v5.0.0",
  }),
  "actions/deploy-pages": Object.freeze({
    sha: "cd2ce8fcbc39b97be8ca5fce6e763baed58fa128",
    tag: "v5.0.0",
  }),
  "actions/dependency-review-action": Object.freeze({
    sha: "a1d282b36b6f3519aa1f3fc636f609c47dddb294",
    tag: "v5.0.0",
  }),
  "actions/upload-artifact": Object.freeze({
    sha: "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    tag: "v7.0.1",
  }),
});

export const workflowIssueCodes = Object.freeze([
  "INPUT_INVALID",
  "INPUT_LIMIT_EXCEEDED",
  "WORKFLOW_DEFAULT_DENY_REQUIRED",
  "EVENT_FORBIDDEN",
  "ACTION_NOT_ALLOWED",
  "ACTION_REF_INVALID",
  "ACTION_TAG_INVALID",
  "CHECKOUT_CREDENTIALS",
  "NODE_VERSION_INVALID",
  "PERMISSION_FORBIDDEN",
  "SHELL_EXPRESSION_FORBIDDEN",
  "SECRET_REFERENCE_FORBIDDEN",
  "PROMOTION_FORBIDDEN",
  "MUTATION_FORBIDDEN",
  "CACHE_SCOPE_FORBIDDEN",
  "PAGES_JOBS_INVALID",
  "PAGES_ARTIFACT_INVALID",
  "PAGES_ORDER_INVALID",
  "PAGES_CONCURRENCY_INVALID",
  "PAGES_ENVIRONMENT_REQUIRED",
  "DEPLOY_JOB_INVALID",
  "PROBE_COMMAND_INVALID",
  "PROBE_OUTPUT_INVALID",
  "DEPENDENCY_REVIEW_INVALID",
  "LINK_HEALTH_INVALID",
  "LYCHEE_URL_INVALID",
  "LYCHEE_CHECKSUM_INVALID",
  "LYCHEE_ORDER_INVALID",
]);

function controlledLabel(name) {
  return CONTROLLED_FILES[basename(name).toLowerCase()] ?? "workflow";
}

function issueCollector() {
  const issues = [];
  const seen = new Set();
  return {
    add(code, file) {
      const key = `${file}:${code}`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push(Object.freeze({ code, file }));
      }
    },
    result() {
      issues.sort((left, right) =>
        left.file === right.file
          ? workflowIssueCodes.indexOf(left.code) - workflowIssueCodes.indexOf(right.code)
          : left.file.localeCompare(right.file, "en"),
      );
      return Object.freeze({ ok: issues.length === 0, issues: Object.freeze(issues) });
    },
  };
}

function normalizeInputs(input, add) {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).length > MAX_FILES
  ) {
    add(
      Object.keys(input ?? {}).length > MAX_FILES ? "INPUT_LIMIT_EXCEEDED" : "INPUT_INVALID",
      "workflow",
    );
    return [];
  }
  const records = [];
  for (const [name, source] of Object.entries(input)) {
    const file = controlledLabel(name);
    if (typeof source !== "string") {
      add("INPUT_INVALID", file);
      continue;
    }
    if (Buffer.byteLength(source, "utf8") > MAX_WORKFLOW_BYTES) {
      add("INPUT_LIMIT_EXCEEDED", file);
      continue;
    }
    records.push(Object.freeze({ file, source: source.replaceAll("\r\n", "\n") }));
  }
  return records;
}

function jobBlocks(source) {
  const lines = source.split("\n");
  const jobsLine = lines.findIndex((line) => /^jobs:\s*(?:#.*)?$/u.test(line));
  if (jobsLine < 0) return new Map();
  const result = new Map();
  let current;
  let body = [];
  for (let index = jobsLine + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[^\s#]/u.test(line)) break;
    const match = /^  ([a-zA-Z0-9_-]+):\s*(?:#.*)?$/u.exec(line);
    if (match) {
      if (current) result.set(current, body.join("\n"));
      current = match[1];
      body = [line];
    } else if (current) body.push(line);
  }
  if (current) result.set(current, body.join("\n"));
  return result;
}

function stepBlocks(source) {
  const starts = [...source.matchAll(/^\s{6}-\s+(?=name:|id:|uses:|run:)/gmu)].map(
    (match) => match.index,
  );
  return starts.map((start, index) => source.slice(start, starts[index + 1] ?? source.length));
}

function runCommands(source) {
  const commands = [];
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*-?\s*run:\s*(.*)$/u.exec(lines[index]);
    if (!match) continue;
    if (match[1] === "|" || match[1] === ">") {
      const indentation = lines[index].search(/\S/u);
      const body = [];
      for (index += 1; index < lines.length; index += 1) {
        const childIndent = lines[index].search(/\S/u);
        if (lines[index].trim() !== "" && childIndent <= indentation) {
          index -= 1;
          break;
        }
        body.push(lines[index].trim());
      }
      commands.push(body.join("\n"));
    } else commands.push(match[1].trim());
  }
  return commands;
}

function validateActions(record, add) {
  const actionPattern = /^\s*-?\s*uses:\s*([^\s@#]+)@([^\s#]+)(?:\s+#\s*([^\n]+))?\s*$/gmu;
  for (const match of record.source.matchAll(actionPattern)) {
    const expected = ACTIONS[match[1]];
    if (!expected) {
      add("ACTION_NOT_ALLOWED", record.file);
      continue;
    }
    if (match[2] !== expected.sha) add("ACTION_REF_INVALID", record.file);
    if (match[3]?.trim() !== expected.tag) add("ACTION_TAG_INVALID", record.file);
  }
  const rawUses = (record.source.match(/^\s*-?\s*uses:/gmu) ?? []).length;
  const parsedUses = [...record.source.matchAll(actionPattern)].length;
  if (rawUses !== parsedUses) add("ACTION_REF_INVALID", record.file);

  for (const step of stepBlocks(record.source)) {
    if (step.includes("uses: actions/checkout@") && !/persist-credentials:\s*false\b/u.test(step))
      add("CHECKOUT_CREDENTIALS", record.file);
    if (
      step.includes("uses: actions/setup-node@") &&
      !new RegExp(
        `node-version:\\s*["']?${NODE_VERSION.replaceAll(".", "\\.")}["']?\\s*$`,
        "mu",
      ).test(step)
    )
      add("NODE_VERSION_INVALID", record.file);
    if (/uses:\s*actions\/setup-node@/u.test(step)) {
      const cache = /cache:\s*([^\s#]+)/u.exec(step)?.[1];
      if (cache && cache !== "npm") add("CACHE_SCOPE_FORBIDDEN", record.file);
      if (cache === "npm" && !/cache-dependency-path:\s*package-lock\.json\b/u.test(step))
        add("CACHE_SCOPE_FORBIDDEN", record.file);
    }
  }
}

function validateGeneric(record, add) {
  const { file, source } = record;
  if (!/^permissions:\s*\{\}\s*(?:#.*)?$/mu.test(source))
    add("WORKFLOW_DEFAULT_DENY_REQUIRED", file);
  if (/^\s*(?:pull_request_target|workflow_run):/mu.test(source)) add("EVENT_FORBIDDEN", file);
  if (/\$\{\{\s*secrets\.|\b(?:GITHUB_TOKEN|GH_TOKEN|AUTHORIZATION)\s*:/iu.test(source))
    add("SECRET_REFERENCE_FORBIDDEN", file);
  for (const command of runCommands(source)) {
    if (/\$\{\{/u.test(command)) add("SHELL_EXPRESSION_FORBIDDEN", file);
    if (
      /\b(?:git\s+(?:commit|push)|gh\s+(?:pr|issue|release)\s+(?:create|merge|edit)|auto-?merge)\b/iu.test(
        command,
      )
    )
      add("MUTATION_FORBIDDEN", file);
    if (/\bgh\s+run\s+download\b|\bdownload-artifact\b/iu.test(command))
      add("PROMOTION_FORBIDDEN", file);
  }
  if (/uses:\s*actions\/download-artifact@|uses:\s*actions\/cache@/iu.test(source))
    add("PROMOTION_FORBIDDEN", file);
  validateActions(record, add);
}

function validatePermissions(record, jobs, add) {
  for (const [name, body] of jobs) {
    for (const match of body.matchAll(/^\s{6,}([a-z-]+):\s*(read|write|none)\s*$/gmu)) {
      const permission = match[1];
      const access = match[2];
      const deployWrite =
        record.file === "pages" &&
        name === "deploy" &&
        access === "write" &&
        (permission === "pages" || permission === "id-token");
      if (access === "write" && !deployWrite) add("PERMISSION_FORBIDDEN", record.file);
    }
  }
}

function validatePages(record, add) {
  const jobs = jobBlocks(record.source);
  validatePermissions(record, jobs, add);
  const build = jobs.get("build");
  const deploy = jobs.get("deploy");
  const probe = jobs.get("probe");
  if (!build || !deploy || !probe) {
    add("PAGES_JOBS_INVALID", record.file);
    return;
  }
  if (
    !/concurrency:\s*[\s\S]*?group:\s*pages-production\s*[\s\S]*?cancel-in-progress:\s*false\b/u.test(
      record.source.slice(0, record.source.indexOf("jobs:")),
    )
  )
    add("PAGES_CONCURRENCY_INVALID", record.file);

  const uploads = [...build.matchAll(/uses:\s*actions\/upload-pages-artifact@/gu)];
  const uploadStep = stepBlocks(build).find((step) => step.includes("upload-pages-artifact@"));
  if (uploads.length !== 1 || !uploadStep || !/^\s{10}path:\s*dist-pages\s*$/mu.test(uploadStep))
    add("PAGES_ARTIFACT_INVALID", record.file);
  const uploadIndex = build.indexOf("uses: actions/upload-pages-artifact@");
  const buildIndex = Math.max(build.indexOf("astro build"), build.indexOf("build:pages"));
  const testIndex = Math.max(
    build.indexOf("verify:exact-artifact"),
    build.indexOf("ATLAS_TEST_MODE=pages"),
  );
  if (buildIndex < 0 || testIndex < buildIndex || uploadIndex < testIndex)
    add("PAGES_ORDER_INVALID", record.file);

  if (
    !/^\s{4}needs:\s*build\s*$/mu.test(deploy) ||
    !/^\s{6}pages:\s*write\s*$/mu.test(deploy) ||
    !/^\s{6}id-token:\s*write\s*$/mu.test(deploy) ||
    !/^\s{4}outputs:\s*$/mu.test(deploy) ||
    !/^\s{6}page_url:\s*\$\{\{\s*steps\.deployment\.outputs\.page_url\s*\}\}\s*$/mu.test(deploy) ||
    !/^\s{6}-\s+id:\s*deployment\s*$/mu.test(deploy) ||
    (deploy.match(/uses:\s*actions\/deploy-pages@/gu) ?? []).length !== 1 ||
    runCommands(deploy).length !== 0 ||
    /actions\/(?:checkout|setup-node|download-artifact)@|\bnpm\b/iu.test(deploy)
  )
    add("DEPLOY_JOB_INVALID", record.file);
  if (!/^\s{4}environment:\s*$/mu.test(deploy) || !/^\s{6}name:\s*github-pages\s*$/mu.test(deploy))
    add("PAGES_ENVIRONMENT_REQUIRED", record.file);

  const probeActions = [...probe.matchAll(/uses:\s*([^\s@]+)@/gu)].map((match) => match[1]);
  const probeRuns = runCommands(probe);
  if (
    !/^\s{4}needs:\s*deploy\s*$/mu.test(probe) ||
    probeActions.join(",") !== "actions/checkout,actions/setup-node" ||
    probeRuns.length !== 1 ||
    probeRuns[0] !== "node tools/probe-pages.mjs" ||
    /\b(?:npm|npx|pnpm|yarn|build|install|generate|download|cache)\b/iu.test(
      probeRuns.join("\n"),
    ) ||
    /cache:\s*\S+/iu.test(probe)
  )
    add("PROBE_COMMAND_INVALID", record.file);
  if (
    !/DEPLOYED_PAGE_URL:\s*\$\{\{\s*needs\.deploy\.outputs\.page_url\s*\}\}\s*$/mu.test(probe) ||
    /DEPLOYED_PAGE_URL:[^\n]*steps\./u.test(probe)
  )
    add("PROBE_OUTPUT_INVALID", record.file);
}

function validateDependencyReview(record, add) {
  const jobs = jobBlocks(record.source);
  validatePermissions(record, jobs, add);
  const source = record.source;
  if (
    !/^\s*pull_request:\s*$/mu.test(source) ||
    /^\s*(?:push|schedule|workflow_dispatch):/mu.test(source) ||
    (source.match(/uses:\s*actions\/dependency-review-action@/gu) ?? []).length !== 1 ||
    !/fail-on-severity:\s*moderate\b/u.test(source) ||
    !/comment-summary-in-pr:\s*never\b/u.test(source)
  )
    add("DEPENDENCY_REVIEW_INVALID", record.file);
}

function validateLinkHealth(record, add) {
  const jobs = jobBlocks(record.source);
  validatePermissions(record, jobs, add);
  const source = record.source;
  if ((source.match(new RegExp(LYCHEE_URL.replaceAll(".", "\\."), "gu")) ?? []).length !== 1)
    add("LYCHEE_URL_INVALID", record.file);
  if (
    (source.match(new RegExp(LYCHEE_SHA256, "gu")) ?? []).length !== 1 ||
    !/sha256sum\s+--check\s+--strict/u.test(source)
  )
    add("LYCHEE_CHECKSUM_INVALID", record.file);
  const checksumIndex = source.indexOf("sha256sum --check --strict");
  const extractIndex = source.indexOf("tar -xzf");
  const executeIndex = source.indexOf('"$RUNNER_TEMP/lychee"');
  if (
    checksumIndex < 0 ||
    extractIndex < checksumIndex ||
    executeIndex < extractIndex ||
    /releases\/(?:latest|nightly)|lychee-action@/iu.test(source)
  )
    add("LYCHEE_ORDER_INVALID", record.file);
  if (/releases\/(?:latest|nightly)|lychee-action@/iu.test(source))
    add("LYCHEE_URL_INVALID", record.file);
  if (
    !/^\s*schedule:\s*$/mu.test(source) ||
    !/^\s*workflow_dispatch:\s*$/mu.test(source) ||
    /^\s*(?:pull_request|push):/mu.test(source) ||
    !/continue-on-error:\s*true\b/u.test(source) ||
    !/retention-days:\s*14\b/u.test(source) ||
    /needs:\s*(?:pages|deploy|build)\b/u.test(source)
  )
    add("LINK_HEALTH_INVALID", record.file);
}

export function verifyWorkflowContracts(input) {
  const collector = issueCollector();
  const records = normalizeInputs(input, collector.add);
  for (const record of records) {
    validateGeneric(record, collector.add);
    const jobs = jobBlocks(record.source);
    if (record.file !== "pages") validatePermissions(record, jobs, collector.add);
    if (record.file === "pages") validatePages(record, collector.add);
    else if (record.file === "dependency-review") validateDependencyReview(record, collector.add);
    else if (record.file === "link-health") validateLinkHealth(record, collector.add);
  }
  return collector.result();
}

export async function readWorkflowContracts(root = PROJECT_ROOT) {
  const workflows = {};
  for (const name of Object.keys(CONTROLLED_FILES).filter((item) => item.endsWith(".yml"))) {
    const path = resolve(root, ".github", "workflows", name);
    const info = await lstat(path).catch(() => undefined);
    if (!info) continue;
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_WORKFLOW_BYTES) {
      workflows[name] = null;
      continue;
    }
    workflows[name] = await readFile(path, "utf8").catch(() => null);
  }
  return workflows;
}

async function main() {
  const result = verifyWorkflowContracts(await readWorkflowContracts());
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (await isMainModule(import.meta.url)) await main();
