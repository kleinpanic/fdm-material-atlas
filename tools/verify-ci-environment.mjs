#!/usr/bin/env node

import { isMainModule } from "./lib/main-module.mjs";

const EXPECTED_NODE = "22.23.1";
const EXPECTED_NPM = "10.9.8";
const MAX_VALUE_BYTES = 2048;

const ALLOWED_NAMES = Object.freeze([
  "CI_CONTEXT",
  "CI_NODE_VERSION",
  "CI_NPM_VERSION",
  "CI_LOCKFILE_STATE",
  "GITHUB_EVENT_NAME",
  "GITHUB_REF",
  "GITHUB_DEFAULT_BRANCH",
  "SITE_ORIGIN",
  "SITE_BASE_PATH",
]);
const ALLOWED_NAME_SET = new Set(ALLOWED_NAMES);
const PROHIBITED_NAME =
  /(?:^|_)(?:GOG|GOOGLE_SHEETS?|SHEETS?|SPREADSHEET|WORKBOOK|PRIVATE_SOURCE)(?:_|$)|(?:^|_)(?:SOURCE|UPSTREAM)_(?:AUTH|OAUTH|TOKEN|SECRET|COOKIE|CREDENTIALS?)(?:_|$)/iu;

export const ciEnvironmentIssueCodes = Object.freeze([
  "INPUT_INVALID",
  "INPUT_NAME_FORBIDDEN",
  "INPUT_LIMIT_EXCEEDED",
  "PROHIBITED_ENVIRONMENT",
  "CONTEXT_INVALID",
  "RUNTIME_INVALID",
  "LOCKFILE_INVALID",
  "EVENT_INVALID",
  "REF_INVALID",
  "ORIGIN_INVALID",
  "BASE_INVALID",
]);

function collectIssues() {
  const issues = [];
  const seen = new Set();
  return {
    add(code, field) {
      const key = `${field}:${code}`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push(Object.freeze({ code, field }));
      }
    },
    get issues() {
      return issues;
    },
  };
}

function prohibitedNames(input) {
  return Object.keys(input).filter((name) => PROHIBITED_NAME.test(name));
}

function inputRecord(input, collector) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    collector.add("INPUT_INVALID", "environment");
    return undefined;
  }
  if (prohibitedNames(input).length > 0) {
    collector.add("PROHIBITED_ENVIRONMENT", "environment");
    return undefined;
  }
  if (Object.keys(input).some((name) => !ALLOWED_NAME_SET.has(name))) {
    collector.add("INPUT_NAME_FORBIDDEN", "environment");
    return undefined;
  }
  const result = {};
  for (const name of ALLOWED_NAMES) {
    const value = input[name];
    if (typeof value !== "string") {
      collector.add("INPUT_INVALID", "environment");
      continue;
    }
    const hasControlCharacter = [...value].some((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point <= 31 || point === 127;
    });
    if (Buffer.byteLength(value, "utf8") > MAX_VALUE_BYTES || hasControlCharacter) {
      collector.add("INPUT_LIMIT_EXCEEDED", "environment");
      continue;
    }
    result[name] = value;
  }
  return result;
}

function validBranch(value) {
  return (
    value.length >= 1 &&
    value.length <= 128 &&
    /^[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?$/u.test(value) &&
    !value.includes("//") &&
    !value.includes("..") &&
    !value.endsWith(".lock") &&
    !value.includes("@{")
  );
}

function validateRef(values, context, collector) {
  const branch = values.GITHUB_DEFAULT_BRANCH;
  const eventName = values.GITHUB_EVENT_NAME;
  const ref = values.GITHUB_REF;
  if (!validBranch(branch)) collector.add("REF_INVALID", "ref");

  const allowedEvents =
    context === "ci"
      ? new Set(["pull_request", "push", "workflow_dispatch"])
      : context === "maintenance"
        ? new Set(["schedule", "workflow_dispatch"])
        : new Set(["push", "workflow_dispatch"]);
  if (!allowedEvents.has(eventName)) collector.add("EVENT_INVALID", "event");

  const pullRequestRef = /^refs\/pull\/[1-9][0-9]*\/(?:head|merge)$/u.test(ref);
  const branchRef = /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(ref);
  const refIsValid =
    context === "ci" && eventName === "pull_request"
      ? pullRequestRef
      : branchRef && ref === `refs/heads/${branch}`;
  if (!refIsValid) collector.add("REF_INVALID", "ref");
}

function normalizeOrigin(value, collector) {
  let url;
  try {
    url = new URL(value);
  } catch {
    collector.add("ORIGIN_INVALID", "origin");
    return undefined;
  }
  const hostname = url.hostname.toLowerCase();
  const unsafeHost =
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    /^127\./u.test(hostname) ||
    /^10\./u.test(hostname) ||
    /^192\.168\./u.test(hostname) ||
    /^172\.(?:1[6-9]|2[0-9]|3[01])\./u.test(hostname);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.pathname !== "/" ||
    url.port !== "" ||
    unsafeHost ||
    value !== url.origin
  ) {
    collector.add("ORIGIN_INVALID", "origin");
    return undefined;
  }
  return url.origin;
}

function normalizeBase(value, collector) {
  if (value === "" || value === "/") return "/";
  if (
    !value.startsWith("/") ||
    !value.endsWith("/") ||
    value.includes("//") ||
    value.includes("\\") ||
    /[?#]/u.test(value) ||
    /%(?:2f|5c|2e)/iu.test(value) ||
    /[^\u0020-\u007e]/u.test(value)
  ) {
    collector.add("BASE_INVALID", "base");
    return undefined;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    collector.add("BASE_INVALID", "base");
    return undefined;
  }
  const segments = decoded.slice(1, -1).split("/");
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u.test(segment),
    )
  ) {
    collector.add("BASE_INVALID", "base");
    return undefined;
  }
  return value;
}

export function verifyCiEnvironment(input) {
  const collector = collectIssues();
  const values = inputRecord(input, collector);
  if (!values) return Object.freeze({ ok: false, issues: Object.freeze(collector.issues) });

  const context = values.CI_CONTEXT;
  if (!new Set(["ci", "pages", "maintenance", "probe"]).has(context))
    collector.add("CONTEXT_INVALID", "context");
  if (values.CI_NODE_VERSION !== EXPECTED_NODE || values.CI_NPM_VERSION !== EXPECTED_NPM)
    collector.add("RUNTIME_INVALID", "runtime");
  if (values.CI_LOCKFILE_STATE !== "clean") collector.add("LOCKFILE_INVALID", "lockfile");
  validateRef(values, context, collector);
  const siteOrigin = normalizeOrigin(values.SITE_ORIGIN, collector);
  const siteBasePath = normalizeBase(values.SITE_BASE_PATH, collector);

  if (collector.issues.length > 0)
    return Object.freeze({ ok: false, issues: Object.freeze(collector.issues) });
  return Object.freeze({
    ok: true,
    issues: Object.freeze([]),
    values: Object.freeze({
      context,
      nodeVersion: values.CI_NODE_VERSION,
      npmVersion: values.CI_NPM_VERSION,
      eventName: values.GITHUB_EVENT_NAME,
      ref: values.GITHUB_REF,
      defaultBranch: values.GITHUB_DEFAULT_BRANCH,
      siteOrigin,
      siteBasePath,
    }),
  });
}

export function selectControlledCiEnvironment(environment) {
  const selected = Object.fromEntries(ALLOWED_NAMES.map((name) => [name, environment[name] ?? ""]));
  for (const name of prohibitedNames(environment)) selected[name] = "";
  return selected;
}

async function main() {
  const result = verifyCiEnvironment(selectControlledCiEnvironment(process.env));
  process.stdout.write(
    `${JSON.stringify({ ok: result.ok, issues: result.issues.map(({ code, field }) => ({ code, field })) })}\n`,
  );
  if (!result.ok) process.exitCode = 1;
}

if (await isMainModule(import.meta.url)) await main();
