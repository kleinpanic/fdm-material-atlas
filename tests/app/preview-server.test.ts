import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createPreviewServer } from "../../tools/verify-build-modes.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture({ productionCompression = false } = {}) {
  const output = await mkdtemp(join(tmpdir(), "atlas-preview-server-"));
  temporaryRoots.push(output);
  await mkdir(join(output, "_astro"));
  await writeFile(
    join(output, "index.html"),
    `<!doctype html><title>Atlas</title><main>${"Atlas material reference. ".repeat(100)}</main>`,
  );
  await writeFile(join(output, "_astro", "selector.js"), "export const ready = true;\n");
  await writeFile(join(output, "_astro", "atlas.woff2"), Buffer.from([0, 1, 2, 3]));
  const server = await createPreviewServer(
    { name: "test", base: "/atlas-preview/", output },
    { productionCompression },
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  return {
    output,
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

describe("the build-mode preview server", () => {
  it("negotiates bounded production gzip without mutating the artifact", async () => {
    const preview = await fixture({ productionCompression: true });
    const path = join(preview.output, "index.html");
    const original = await readFile(path);
    try {
      const compressed = await fetch(`${preview.origin}/atlas-preview/`, {
        headers: { "accept-encoding": "gzip" },
      });
      const compressedLength = Number(compressed.headers.get("content-length"));
      expect(compressed.headers.get("content-encoding")).toBe("gzip");
      expect(compressed.headers.get("vary")).toBe("Accept-Encoding");
      expect(compressedLength).toBeGreaterThan(0);
      expect(compressedLength).toBeLessThan(original.byteLength);
      expect(await compressed.text()).toContain("<title>Atlas</title>");

      const head = await fetch(`${preview.origin}/atlas-preview/`, {
        method: "HEAD",
        headers: { "accept-encoding": "gzip" },
      });
      expect(head.headers.get("content-encoding")).toBe("gzip");
      expect(Number(head.headers.get("content-length"))).toBe(compressedLength);
      expect((await head.arrayBuffer()).byteLength).toBe(0);

      const identity = await fetch(`${preview.origin}/atlas-preview/`, {
        headers: { "accept-encoding": "identity" },
      });
      expect(identity.headers.get("content-encoding")).toBeNull();
      expect(identity.headers.get("vary")).toBe("Accept-Encoding");
      expect(Number(identity.headers.get("content-length"))).toBe(original.byteLength);
      expect(await readFile(path)).toEqual(original);

      const rejected = await fetch(`${preview.origin}/atlas-preview/`, {
        headers: { "accept-encoding": "gzip;q=0, identity" },
      });
      expect(rejected.headers.get("content-encoding")).toBeNull();
      expect(Number(rejected.headers.get("content-length"))).toBe(original.byteLength);

      const binary = await fetch(`${preview.origin}/atlas-preview/_astro/atlas.woff2`, {
        headers: { "accept-encoding": "gzip" },
      });
      expect(binary.headers.get("content-encoding")).toBeNull();
      expect(Number(binary.headers.get("content-length"))).toBe(4);
    } finally {
      await preview.close();
    }
  });

  it("serves query-bearing JavaScript with a browser-valid MIME type", async () => {
    const preview = await fixture();
    try {
      const response = await fetch(
        `${preview.origin}/atlas-preview/_astro/selector.js?astro-retry=1`,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toMatch(
        /^(?:text|application)\/javascript(?:;|$)/u,
      );
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
      const unknown = await fetch(
        `${preview.origin}/atlas-preview/_astro/missing.js?astro-retry=1`,
      );

      expect(outsideBase.status).toBe(400);
      expect(traversal.status).not.toBe(200);
      expect(unknown.status).toBe(404);
    } finally {
      await preview.close();
    }
  });
});
