import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import astroConfig from "../../astro.config.mjs";

const APPROVED_PACKAGES = {
  "@astrojs/preact": "6.0.4",
  preact: "10.29.8",
} as const;

describe("the approved Preact renderer boundary", () => {
  it("keeps both packages exact-pinned in package metadata and lock data", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8"));
    const lockfile = JSON.parse(await readFile("package-lock.json", "utf8"));

    for (const [name, version] of Object.entries(APPROVED_PACKAGES)) {
      expect(manifest.dependencies?.[name]).toBe(version);
      expect(lockfile.packages?.[""]?.dependencies?.[name]).toBe(version);
      expect(lockfile.packages?.[`node_modules/${name}`]?.version).toBe(version);
      expect(lockfile.packages?.[`node_modules/${name}`]?.integrity).toMatch(/^sha512-/);
    }
  });

  it("loads exactly one official Preact integration without weakening the static build", () => {
    const integrations = astroConfig.integrations ?? [];
    const preactIntegrations = integrations.filter(
      (integration) => integration.name === "@astrojs/preact",
    );

    expect(preactIntegrations).toHaveLength(1);
    expect(astroConfig.output).toBe("static");
    expect(astroConfig.trailingSlash).toBe("always");
    expect(astroConfig.build?.format).toBe("directory");
    expect(astroConfig.vite?.build?.sourcemap).toBe(false);
    expect(astroConfig.vite?.plugins).toHaveLength(1);
    expect(astroConfig.fonts).toHaveLength(2);
  });

  it("keeps both packages inside the closed direct-dependency audit", async () => {
    const auditSource = await readFile("tools/audit-direct-dependencies.mjs", "utf8");

    expect(auditSource).toContain('"@astrojs/preact": {');
    expect(auditSource).toContain("preact: {");
    expect(auditSource).toContain("DIRECT_SET_MISMATCH");
    expect(auditSource).toContain("LOCK_INTEGRITY_MISMATCH");
    expect(auditSource).toContain("REGISTRY_REPOSITORY_MISMATCH");
    expect(auditSource).toContain("LIFECYCLE_${field.toUpperCase()}_MISMATCH");
  });
});
