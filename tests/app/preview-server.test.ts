import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createPreviewServer } from "../../tools/verify-build-modes.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const output = await mkdtemp(join(tmpdir(), "atlas-preview-server-"));
  temporaryRoots.push(output);
  await mkdir(join(output, "_astro"));
  await writeFile(join(output, "index.html"), "<!doctype html><title>Atlas</title>");
  await writeFile(join(output, "_astro", "selector.js"), "export const ready = true;\n");
  const server = await createPreviewServer({ name: "test", base: "/atlas-preview/", output });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

describe("the build-mode preview server", () => {
  it("serves query-bearing JavaScript with a browser-valid MIME type", async () => {
    const preview = await fixture();
    try {
      const response = await fetch(`${preview.origin}/atlas-preview/_astro/selector.js?astro-retry=1`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toMatch(/^(?:text|application)\/javascript(?:;|$)/u);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await response.text()).toContain("ready = true");
    } finally {
      await preview.close();
    }
  });

  it("keeps the repository base, traversal attempts, and unknown files fail-closed", async () => {
    const preview = await fixture();
    try {
      const outsideBase = await fetch(`${preview.origin}/_astro/selector.js`);
      const traversal = await fetch(`${preview.origin}/atlas-preview/%2e%2e/_astro/selector.js`);
      const unknown = await fetch(`${preview.origin}/atlas-preview/_astro/missing.js?astro-retry=1`);

      expect(outsideBase.status).toBe(400);
      expect(traversal.status).not.toBe(200);
      expect(unknown.status).toBe(404);
    } finally {
      await preview.close();
    }
  });
});
