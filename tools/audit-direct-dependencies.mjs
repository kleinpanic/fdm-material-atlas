#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import { isMainModule } from "./lib/main-module.mjs";

const REGISTRY_ORIGIN = "https://registry.npmjs.org";
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const SHA512_INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
const LIFECYCLE_FIELDS = [
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "prepublish",
  "prepublishOnly",
];

function policy(section, repository, directory = null, lifecycle = {}) {
  return Object.freeze({ section, repository, directory, lifecycle: Object.freeze(lifecycle) });
}

// Durable trust boundary: versions and archive hashes come from the exact
// manifest and lockfile. Package identity, source, path, and lifecycle behavior
// remain closed and explicitly reviewed here.
const DIRECT_DEPENDENCIES = Object.freeze({
  "@astrojs/preact": policy(
    "dependencies",
    "https://github.com/withastro/astro",
    "packages/integrations/preact",
  ),
  "@astrojs/check": policy(
    "devDependencies",
    "https://github.com/withastro/astro",
    "packages/language-tools/astro-check",
  ),
  "@axe-core/playwright": policy(
    "devDependencies",
    "https://github.com/dequelabs/axe-core-npm",
    null,
    {
      prepare: "npx playwright install && npm run build",
    },
  ),
  "@fontsource-variable/ibm-plex-sans": policy(
    "dependencies",
    "https://github.com/fontsource/font-files",
    "fonts/variable/ibm-plex-sans",
  ),
  "@fontsource/ibm-plex-mono": policy(
    "dependencies",
    "https://github.com/fontsource/font-files",
    "fonts/google/ibm-plex-mono",
  ),
  "@playwright/test": policy("devDependencies", "https://github.com/microsoft/playwright"),
  "@tailwindcss/vite": policy(
    "dependencies",
    "https://github.com/tailwindlabs/tailwindcss",
    "packages/@tailwindcss-vite",
  ),
  "@types/node": policy(
    "devDependencies",
    "https://github.com/DefinitelyTyped/DefinitelyTyped",
    "types/node",
  ),
  astro: policy("dependencies", "https://github.com/withastro/astro", "packages/astro"),
  "chrome-launcher": policy(
    "devDependencies",
    "https://github.com/GoogleChrome/chrome-launcher",
    null,
    { prepublishOnly: "npm run build && npm run test" },
  ),
  eslint: policy("devDependencies", "https://github.com/eslint/eslint"),
  "eslint-plugin-astro": policy(
    "devDependencies",
    "https://github.com/ota-meshi/eslint-plugin-astro",
  ),
  "html-validate": policy("devDependencies", "https://gitlab.com/html-validate/html-validate"),
  lighthouse: policy("devDependencies", "https://github.com/GoogleChrome/lighthouse"),
  preact: policy("dependencies", "https://github.com/preactjs/preact", null, {
    prepare: "husky && npm run test:install && run-s build",
  }),
  prettier: policy("devDependencies", "https://github.com/prettier/prettier"),
  "prettier-plugin-astro": policy(
    "devDependencies",
    "https://github.com/withastro/prettier-plugin-astro",
  ),
  tailwindcss: policy(
    "dependencies",
    "https://github.com/tailwindlabs/tailwindcss",
    "packages/tailwindcss",
  ),
  typescript: policy("devDependencies", "https://github.com/microsoft/TypeScript"),
  "typescript-eslint": policy(
    "devDependencies",
    "https://github.com/typescript-eslint/typescript-eslint",
    "packages/typescript-eslint",
  ),
  vitest: policy("devDependencies", "https://github.com/vitest-dev/vitest", "packages/vitest"),
  zod: policy("dependencies", "https://github.com/colinhacks/zod", null, {
    prepublishOnly: "tsx ../../scripts/check-versions.ts",
  }),
});

export class AuditFailure extends Error {
  constructor(packageName, code) {
    super(code);
    this.packageName = packageName;
    this.code = code;
  }
}

function fail(packageName, code) {
  throw new AuditFailure(packageName, code);
}

async function readJson(path, code) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch {
    fail(null, `${code}_READ`);
  }
  try {
    return JSON.parse(source);
  } catch {
    fail(null, `${code}_JSON`);
  }
}

function canonicalRepository(repository) {
  const raw = typeof repository === "string" ? repository : repository?.url;
  if (typeof raw !== "string") return null;
  return raw
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git\/?$/, "")
    .replace(/\/$/, "");
}

function registryPath(name, version) {
  return `${REGISTRY_ORIGIN}/${name.replace("/", "%2f")}/${version}`;
}

function assertDirectSet(manifest) {
  const actual = Object.keys({
    ...(manifest.dependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
  }).sort();
  const expected = Object.keys(DIRECT_DEPENDENCIES).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(null, "DIRECT_SET_MISMATCH");
}

function assertRegistryArchive(name, resolved) {
  let url;
  try {
    url = new URL(resolved);
  } catch {
    fail(name, "LOCK_RESOLVED_MISMATCH");
  }
  if (url.origin !== REGISTRY_ORIGIN || url.username || url.password || url.search || url.hash) {
    fail(name, "LOCK_RESOLVED_MISMATCH");
  }
}

export function verifyLocalDependencyPolicy(manifest, lockfile) {
  if (lockfile.lockfileVersion !== 3) fail(null, "LOCKFILE_VERSION_MISMATCH");
  assertDirectSet(manifest);
  const root = lockfile.packages?.[""];
  const resolved = [];

  for (const [name, expected] of Object.entries(DIRECT_DEPENDENCIES)) {
    const version = manifest[expected.section]?.[name];
    if (typeof version !== "string" || !EXACT_VERSION.test(version)) {
      fail(name, "MANIFEST_PIN_MISMATCH");
    }
    if (root?.[expected.section]?.[name] !== version) fail(name, "LOCK_ROOT_PIN_MISMATCH");

    const locked = lockfile.packages?.[`node_modules/${name}`];
    if (!locked) fail(name, "LOCK_RECORD_MISSING");
    if (locked.version !== version) fail(name, "LOCK_VERSION_MISMATCH");
    assertRegistryArchive(name, locked.resolved);
    if (typeof locked.integrity !== "string" || !SHA512_INTEGRITY.test(locked.integrity)) {
      fail(name, "LOCK_INTEGRITY_MISMATCH");
    }
    resolved.push(Object.freeze({ name, version, locked, expected }));
  }
  return Object.freeze(resolved);
}

async function fetchRegistryRecord(name, version) {
  let response;
  try {
    response = await fetch(registryPath(name, version), {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    fail(name, "REGISTRY_REQUEST_FAILED");
  }
  if (!response.ok) fail(name, "REGISTRY_STATUS_INVALID");
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > 1_000_000)
    fail(name, "REGISTRY_BODY_OVERSIZE");
  const source = await response.text().catch(() => fail(name, "REGISTRY_BODY_FAILED"));
  if (source.length > 1_000_000) fail(name, "REGISTRY_BODY_OVERSIZE");
  try {
    return JSON.parse(source);
  } catch {
    fail(name, "REGISTRY_JSON_INVALID");
  }
}

function assertRegistryRecord({ name, version, locked, expected }, record) {
  if (record.name !== name) fail(name, "REGISTRY_NAME_MISMATCH");
  if (record.version !== version) fail(name, "REGISTRY_VERSION_MISMATCH");
  if (record.dist?.tarball !== locked.resolved) fail(name, "REGISTRY_TARBALL_MISMATCH");
  if (record.dist?.integrity !== locked.integrity) fail(name, "REGISTRY_INTEGRITY_MISMATCH");
  if (canonicalRepository(record.repository) !== expected.repository) {
    fail(name, "REGISTRY_REPOSITORY_MISMATCH");
  }
  const directory =
    typeof record.repository === "object" && typeof record.repository?.directory === "string"
      ? record.repository.directory
      : null;
  if (directory !== expected.directory) fail(name, "REGISTRY_DIRECTORY_MISMATCH");
  for (const field of LIFECYCLE_FIELDS) {
    if ((record.scripts?.[field] ?? null) !== (expected.lifecycle[field] ?? null)) {
      fail(name, `LIFECYCLE_${field.toUpperCase()}_MISMATCH`);
    }
  }
}

async function main() {
  const manifest = await readJson("package.json", "MANIFEST");
  const lockfile = await readJson("package-lock.json", "LOCKFILE");
  const dependencies = verifyLocalDependencyPolicy(manifest, lockfile);
  for (const dependency of dependencies) {
    assertRegistryRecord(
      dependency,
      await fetchRegistryRecord(dependency.name, dependency.version),
    );
  }
  process.stdout.write(
    `${JSON.stringify({ ok: true, code: "DIRECT_DEPENDENCIES_VERIFIED", count: dependencies.length })}\n`,
  );
}

if (await isMainModule(import.meta.url)) {
  main().catch((error) => {
    const result =
      error instanceof AuditFailure
        ? { ok: false, package: error.packageName, code: error.code }
        : { ok: false, package: null, code: "AUDIT_INTERNAL_ERROR" };
    process.stderr.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 1;
  });
}
