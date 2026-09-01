#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const REGISTRY_ORIGIN = "https://registry.npmjs.org";
const LIFECYCLE_FIELDS = [
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "prepublish",
  "prepublishOnly",
];

const DIRECT_DEPENDENCIES = Object.freeze({
  "@lhci/cli": {
    section: "devDependencies",
    version: "0.15.1",
    repository: "https://github.com/GoogleChrome/lighthouse-ci",
    directory: null,
    resolved: `${REGISTRY_ORIGIN}/@lhci/cli/-/cli-0.15.1.tgz`,
    integrity:
      "sha512-yhC0oXnXqGHYy1xl4D8YqaydMZ/khFAnXGY/o2m/J3PqPa/D0nj3V6TLoH02oVMFeEF2AQim7UbmdXMiXx2tOw==",
  },
  "@astrojs/preact": {
    section: "dependencies",
    version: "6.0.4",
    repository: "https://github.com/withastro/astro",
    directory: "packages/integrations/preact",
    resolved: `${REGISTRY_ORIGIN}/@astrojs/preact/-/preact-6.0.4.tgz`,
    integrity:
      "sha512-DDBRpiO7EhDHGiRKReXV4T7IbwuzWhIpF+yce2GBOgormXpsE1uOrBd81snImaYgnMJ7g5hzSHZnmX0VO5D80A==",
  },
  "@astrojs/check": {
    section: "devDependencies",
    version: "0.9.10",
    repository: "https://github.com/withastro/astro",
    directory: "packages/language-tools/astro-check",
    resolved: `${REGISTRY_ORIGIN}/@astrojs/check/-/check-0.9.10.tgz`,
    integrity:
      "sha512-zgx/UQMozdjOa3bOxjgeCFdtpE3c9rRX6xHwa+2QXvy8z8Akifu2AtubHyv/zzC2znO8dl8fFWL4K+Ba9kS8HQ==",
  },
  "@axe-core/playwright": {
    section: "devDependencies",
    version: "4.13.0",
    repository: "https://github.com/dequelabs/axe-core-npm",
    directory: null,
    resolved: `${REGISTRY_ORIGIN}/@axe-core/playwright/-/playwright-4.13.0.tgz`,
    integrity:
      "sha512-6YLx+kxXu5GJceG4ozFg+33a2EMTdjYwWGloJ3sb9Kta5pp+ZNS53uxGVog5JetIY8s++P5UrtX+cri+u0VAVg==",
    lifecycle: {
      prepare: "npx playwright install && npm run build",
    },
  },
  "@fontsource-variable/ibm-plex-sans": {
    section: "dependencies",
    version: "5.3.0",
    repository: "https://github.com/fontsource/font-files",
    directory: "fonts/variable/ibm-plex-sans",
    resolved: `${REGISTRY_ORIGIN}/@fontsource-variable/ibm-plex-sans/-/ibm-plex-sans-5.3.0.tgz`,
    integrity:
      "sha512-agG8tXFEo0hD9+J7npa4vbbWult52eMLVaQ6WQRlhs/iCAojrMAoejru85W9HTVXHfyUj96KM7gp/KGAS87XaQ==",
  },
  "@fontsource/ibm-plex-mono": {
    section: "dependencies",
    version: "5.3.0",
    repository: "https://github.com/fontsource/font-files",
    directory: "fonts/google/ibm-plex-mono",
    resolved: `${REGISTRY_ORIGIN}/@fontsource/ibm-plex-mono/-/ibm-plex-mono-5.3.0.tgz`,
    integrity:
      "sha512-eTgnZjZEGk1QtD3ZstF+Vclo2HLAni8YMy34/DxllwZvyz1lR/1RF/xTiAquOBO7MvqBx8D2Ig2WCPMVfdZu7Q==",
  },
  "@playwright/test": {
    section: "devDependencies",
    version: "1.62.1",
    repository: "https://github.com/microsoft/playwright",
    directory: null,
    resolved: `${REGISTRY_ORIGIN}/@playwright/test/-/test-1.62.1.tgz`,
    integrity:
      "sha512-DTcUc8qii+cpHvtOwggMtBRMjKZHXYWdw8syRYu2vtzuq4Wxphqq4NfCs5Zt44L6mA8rfDfj+PHnxFc/FeK6mQ==",
  },
  "@tailwindcss/vite": {
    section: "dependencies",
    version: "4.3.3",
    repository: "https://github.com/tailwindlabs/tailwindcss",
    directory: "packages/@tailwindcss-vite",
    resolved: `${REGISTRY_ORIGIN}/@tailwindcss/vite/-/vite-4.3.3.tgz`,
    integrity:
      "sha512-yYU8cogLeSh/ms2jh8Fj7jaba/EWa7Ja6GoUqYZaraEuCI5YS6ms6ObZgjjedm+jm6XZjdNRWBpPP6Z86oOxcw==",
  },
  "@types/node": {
    section: "devDependencies",
    version: "22.20.1",
    repository: "https://github.com/DefinitelyTyped/DefinitelyTyped",
    directory: "types/node",
    resolved: `${REGISTRY_ORIGIN}/@types/node/-/node-22.20.1.tgz`,
    integrity:
      "sha512-EANqOCF9QFyra+4pfxUcX9STKJpCLjMbObVzljIJomAWSnuSIEAvyzEU53GaajbXJEgdh0iEcPL+DGvpUd4k1Q==",
  },
  astro: {
    section: "dependencies",
    version: "7.2.9",
    repository: "https://github.com/withastro/astro",
    directory: "packages/astro",
    resolved: `${REGISTRY_ORIGIN}/astro/-/astro-7.2.9.tgz`,
    integrity:
      "sha512-o5nZFo/bieF6rp4x9sQSLhI7GO7Bahpld38Y4LvX27nFoxNiuttjI+Hea81w5ksORLHgdPUlQpU9obPz5QRa8g==",
  },
  eslint: {
    section: "devDependencies",
    version: "10.7.0",
    repository: "https://github.com/eslint/eslint",
    directory: null,
    resolved: `${REGISTRY_ORIGIN}/eslint/-/eslint-10.7.0.tgz`,
    integrity:
      "sha512-GVTD7s1vdIl6UYvAfriOPeY1Df8LIZjfofLvHwde+erDHGGuHyuM6xoxRxmHiebhYuD2p1vN4wWh0XzPARSGDQ==",
  },
  "eslint-plugin-astro": {
    section: "devDependencies",
    version: "3.0.1",
    repository: "https://github.com/ota-meshi/eslint-plugin-astro",
    directory: null,
    resolved: `${REGISTRY_ORIGIN}/eslint-plugin-astro/-/eslint-plugin-astro-3.0.1.tgz`,
    integrity:
      "sha512-skys0KV/5m/rQ6a4BDAGOGtrGoBlWNYiWtoDjx25bghDwTiKXng63s4Yv823iX3ht/tH/kHtoUM2poxESGsv3w==",
  },
  "html-validate": {
    section: "devDependencies",
    version: "11.5.7",
    repository: "https://gitlab.com/html-validate/html-validate",
    directory: null,
    resolved: `${REGISTRY_ORIGIN}/html-validate/-/html-validate-11.5.7.tgz`,
    integrity:
      "sha512-PJOrBFyiaYapxSmzaW95G8TMcNGu7MdHSbRGCbrqWvTBsncjN9nv27P+fP6aCYuB6payeAVdpcwRmlaeB8VbuA==",
  },
  preact: {
    section: "dependencies",
    version: "10.29.8",
    repository: "https://github.com/preactjs/preact",
    directory: null,
    resolved: `${REGISTRY_ORIGIN}/preact/-/preact-10.29.8.tgz`,
    integrity:
      "sha512-ej2aVZ+vZ8WO7tvlQWRM9N63A0KzF9q4mWJfDUHgYaIofWY9hu74QdnQrjoPMmZi2/nZ5gN0bJCQF49xQqx09Q==",
    lifecycle: {
      prepare: "husky && npm run test:install && run-s build",
    },
  },
  prettier: {
    section: "devDependencies",
    version: "3.9.6",
    repository: "https://github.com/prettier/prettier",
    directory: null,
    resolved: `${REGISTRY_ORIGIN}/prettier/-/prettier-3.9.6.tgz`,
    integrity:
      "sha512-OpN0zzVdiaiAhxpuuj5efpIS4sY9j7bY6uR5mnj5yPzGkdkjNKSJeUThPb60Jw29QuAZgA4o+/iB49kFiaBX6g==",
  },
  "prettier-plugin-astro": {
    section: "devDependencies",
    version: "0.14.1",
    repository: "https://github.com/withastro/prettier-plugin-astro",
    directory: null,
    resolved: `${REGISTRY_ORIGIN}/prettier-plugin-astro/-/prettier-plugin-astro-0.14.1.tgz`,
    integrity:
      "sha512-RiBETaaP9veVstE4vUwSIcdATj6dKmXljouXc/DDNwBSPTp8FRkLGDSGFClKsAFeeg+13SB0Z1JZvbD76bigJw==",
  },
  tailwindcss: {
    section: "dependencies",
    version: "4.3.3",
    repository: "https://github.com/tailwindlabs/tailwindcss",
    directory: "packages/tailwindcss",
    resolved: `${REGISTRY_ORIGIN}/tailwindcss/-/tailwindcss-4.3.3.tgz`,
    integrity:
      "sha512-gOhV3P7ufE62QDGg1zVaTgCR+EtPv92k2nIhVcVKcLmxT1sUBsQGhnZj175j+MqRt4zLF7ic+sCYjfhxMxj7YQ==",
  },
  typescript: {
    section: "devDependencies",
    version: "6.0.3",
    repository: "https://github.com/microsoft/TypeScript",
    directory: null,
    resolved: `${REGISTRY_ORIGIN}/typescript/-/typescript-6.0.3.tgz`,
    integrity:
      "sha512-y2TvuxSZPDyQakkFRPZHKFm+KKVqIisdg9/CZwm9ftvKXLP8NRWj38/ODjNbr43SsoXqNuAisEf1GdCxqWcdBw==",
  },
  "typescript-eslint": {
    section: "devDependencies",
    version: "8.65.0",
    repository: "https://github.com/typescript-eslint/typescript-eslint",
    directory: "packages/typescript-eslint",
    resolved: `${REGISTRY_ORIGIN}/typescript-eslint/-/typescript-eslint-8.65.0.tgz`,
    integrity:
      "sha512-/ggrHAwyjENDusvyxbuqxAC2dTnZg/Z8F+fgQtYIz+L6n/9HfSlEZcFGV/NsMNa6CkGk0xUjUAFwC0vHOflvIA==",
  },
  vitest: {
    section: "devDependencies",
    version: "4.1.11",
    repository: "https://github.com/vitest-dev/vitest",
    directory: "packages/vitest",
    resolved: `${REGISTRY_ORIGIN}/vitest/-/vitest-4.1.11.tgz`,
    integrity:
      "sha512-fhACrNXUidIbGSBr5FlbuBkO7VWC1ZyLl0DO4CU2DrQoAPxX84Ysxs+HeGQpii5lZWV1Q4gBZTTu49mF+A6Edw==",
  },
  zod: {
    section: "dependencies",
    version: "4.5.4",
    repository: "https://github.com/colinhacks/zod",
    directory: null,
    resolved: `${REGISTRY_ORIGIN}/zod/-/zod-4.5.4.tgz`,
    integrity:
      "sha512-sC95tT5iHHH9gtpj6A81kh+NEaRAUFN+qlUPDUbRfOMvNf5QCBqsb3WgvnpVtK5Y+4UfA6KqufotuTvMGiTlsA==",
    lifecycle: {
      prepublishOnly: "tsx ../../scripts/check-versions.ts",
    },
  },
});

class AuditFailure extends Error {
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

function packagePath(name) {
  return `node_modules/${name}`;
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

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(null, "DIRECT_SET_MISMATCH");
  }
}

function assertManifestAndLock(name, expected, manifest, lockfile) {
  if (manifest[expected.section]?.[name] !== expected.version) {
    fail(name, "MANIFEST_PIN_MISMATCH");
  }

  const root = lockfile.packages?.[""];
  if (root?.[expected.section]?.[name] !== expected.version) {
    fail(name, "LOCK_ROOT_PIN_MISMATCH");
  }

  const locked = lockfile.packages?.[packagePath(name)];
  if (!locked) fail(name, "LOCK_RECORD_MISSING");
  if (locked.version !== expected.version) fail(name, "LOCK_VERSION_MISMATCH");
  if (locked.resolved !== expected.resolved) fail(name, "LOCK_RESOLVED_MISMATCH");
  if (locked.integrity !== expected.integrity) fail(name, "LOCK_INTEGRITY_MISMATCH");
}

async function fetchRegistryRecord(name, expected) {
  let response;
  try {
    response = await fetch(registryPath(name, expected.version), {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    fail(name, "REGISTRY_REQUEST_FAILED");
  }

  if (!response.ok) fail(name, "REGISTRY_STATUS_INVALID");

  let source;
  try {
    source = await response.text();
  } catch {
    fail(name, "REGISTRY_BODY_FAILED");
  }
  if (source.length > 1_000_000) fail(name, "REGISTRY_BODY_OVERSIZE");

  try {
    return JSON.parse(source);
  } catch {
    fail(name, "REGISTRY_JSON_INVALID");
  }
}

function assertRegistryRecord(name, expected, record) {
  if (record.name !== name) fail(name, "REGISTRY_NAME_MISMATCH");
  if (record.version !== expected.version) fail(name, "REGISTRY_VERSION_MISMATCH");
  if (record.dist?.tarball !== expected.resolved) fail(name, "REGISTRY_TARBALL_MISMATCH");
  if (record.dist?.integrity !== expected.integrity) fail(name, "REGISTRY_INTEGRITY_MISMATCH");
  if (canonicalRepository(record.repository) !== expected.repository) {
    fail(name, "REGISTRY_REPOSITORY_MISMATCH");
  }

  const directory =
    typeof record.repository === "object" && typeof record.repository?.directory === "string"
      ? record.repository.directory
      : null;
  if (directory !== expected.directory) fail(name, "REGISTRY_DIRECTORY_MISMATCH");

  const reviewedLifecycle = expected.lifecycle ?? {};
  for (const field of LIFECYCLE_FIELDS) {
    const actual = record.scripts?.[field] ?? null;
    const reviewed = reviewedLifecycle[field] ?? null;
    if (actual !== reviewed) fail(name, `LIFECYCLE_${field.toUpperCase()}_MISMATCH`);
  }
}

async function main() {
  const manifest = await readJson("package.json", "MANIFEST");
  const lockfile = await readJson("package-lock.json", "LOCKFILE");

  if (lockfile.lockfileVersion !== 3) fail(null, "LOCKFILE_VERSION_MISMATCH");
  assertDirectSet(manifest);

  for (const [name, expected] of Object.entries(DIRECT_DEPENDENCIES)) {
    assertManifestAndLock(name, expected, manifest, lockfile);
    const record = await fetchRegistryRecord(name, expected);
    assertRegistryRecord(name, expected, record);
  }

  process.stdout.write(
    `${JSON.stringify({ ok: true, code: "DIRECT_DEPENDENCIES_VERIFIED", count: Object.keys(DIRECT_DEPENDENCIES).length })}\n`,
  );
}

main().catch((error) => {
  const result =
    error instanceof AuditFailure
      ? { ok: false, package: error.packageName, code: error.code }
      : { ok: false, package: null, code: "AUDIT_INTERNAL_ERROR" };
  process.stderr.write(`${JSON.stringify(result)}\n`);
  process.exitCode = 1;
});
