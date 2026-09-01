import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ArtifactValidationError,
  validateBuiltArtifacts,
} from "../../tools/validate-built-html.mjs";

const temporaryRoots: string[] = [];

async function fixture(base = "/") {
  const root = await mkdtemp(join(tmpdir(), "atlas-artifact-"));
  temporaryRoots.push(root);
  const prefix = base === "/" ? "" : base.slice(1, -1);
  const output = prefix === "" ? root : join(root, prefix);
  await mkdir(join(output, "assets"), { recursive: true });
  await mkdir(join(output, "materials"), { recursive: true });
  await writeFile(join(output, "assets/site.css"), '@font-face{src:url("./atlas.woff2")}');
  await writeFile(join(output, "assets/atlas.woff2"), "font");
  await writeFile(join(output, "assets/site.js"), "export {};");
  await writeFile(join(output, "assets/mark.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(
    join(output, "materials/index.html"),
    `<!doctype html><html><head><link rel="canonical" href="https://atlas.example${base}materials/"><link rel="stylesheet" href="${base}assets/site.css"></head><body><main id="atlas"><a href="${base}#main">Home</a></main></body></html>`,
  );
  await writeFile(
    join(output, "index.html"),
    `<!doctype html><html><head><link rel="canonical" href="https://atlas.example${base}"><link rel="stylesheet" href="${base}assets/site.css"><script type="module" src="${base}assets/site.js"></script></head><body><main id="main"><a href="${base}materials/#atlas">Materials</a><img src="${base}assets/mark.svg" srcset="${base}assets/mark.svg 1x" alt=""><div style="background-image:url('${base}assets/mark.svg')"></div></main></body></html>`,
  );
  return { root, output };
}

async function expectCode(run: () => Promise<unknown>, code: string) {
  await expect(run()).rejects.toMatchObject({ code });
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("release artifact validator", () => {
  it.each(["/", "/atlas-preview/"])("accepts a closed regular artifact under %s", async (base) => {
    const { output } = await fixture(base);
    await expect(
      validateBuiltArtifacts({
        modes: [{ name: "fixture", base, output }],
        runPublicationScan: false,
      }),
    ).resolves.toMatchObject({ ok: true, modes: [{ htmlCount: 2 }] });
  });

  it.each([
    ['<a href="/missing/">Missing</a>', "ARTIFACT_LOCAL_TARGET_MISSING"],
    ['<a href="/#missing">Missing</a>', "ARTIFACT_FRAGMENT_MISSING"],
    ['<a href="/../escape/">Escape</a>', "ARTIFACT_PATH_TRAVERSAL"],
    ['<a href="javascript:alert(1)">Unsafe</a>', "ARTIFACT_PROTOCOL_UNSAFE"],
    ['<script src="https://cdn.example/app.js"></script>', "ARTIFACT_REMOTE_ASSET"],
    ['<script src="/assets/site.css"></script>', "ARTIFACT_EXTENSION_INVALID"],
  ])("rejects an unsafe emitted reference with %s", async (markup, code) => {
    const { output } = await fixture();
    await writeFile(
      join(output, "index.html"),
      `<!doctype html><html><head><link rel="canonical" href="https://atlas.example/"></head><body><main id="main">${markup}</main></body></html>`,
    );
    await expectCode(
      () =>
        validateBuiltArtifacts({
          modes: [{ name: "fixture", base: "/", output }],
          runPublicationScan: false,
        }),
      code,
    );
  });

  it("rejects malformed HTML with one stable code", async () => {
    const { output } = await fixture();
    await writeFile(
      join(output, "index.html"),
      '<!doctype html><html><head><link rel="canonical" href="https://atlas.example/"></head><body><main><div></body></html>',
    );
    await expectCode(
      () =>
        validateBuiltArtifacts({
          modes: [{ name: "fixture", base: "/", output }],
          runPublicationScan: false,
        }),
      "ARTIFACT_HTML_INVALID",
    );
  });

  it("rejects symlinks, hard links, source maps, and oversized files before release", async () => {
    const symbolic = await fixture();
    await symlink(join(symbolic.output, "assets/site.js"), join(symbolic.output, "assets/link.js"));
    await expectCode(
      () =>
        validateBuiltArtifacts({
          modes: [{ name: "fixture", base: "/", output: symbolic.output }],
          runPublicationScan: false,
        }),
      "ARTIFACT_SYMLINK_FORBIDDEN",
    );

    const hard = await fixture();
    await link(join(hard.output, "assets/site.js"), join(hard.output, "assets/hard.js"));
    await expectCode(
      () =>
        validateBuiltArtifacts({
          modes: [{ name: "fixture", base: "/", output: hard.output }],
          runPublicationScan: false,
        }),
      "ARTIFACT_HARDLINK_FORBIDDEN",
    );

    const mapped = await fixture();
    await writeFile(join(mapped.output, "assets/site.js.map"), "{}");
    await expectCode(
      () =>
        validateBuiltArtifacts({
          modes: [{ name: "fixture", base: "/", output: mapped.output }],
          runPublicationScan: false,
        }),
      "ARTIFACT_SOURCE_MAP_FORBIDDEN",
    );

    const large = await fixture();
    await writeFile(join(large.output, "assets/large.bin"), "x".repeat(32));
    await expectCode(
      () =>
        validateBuiltArtifacts({
          modes: [{ name: "fixture", base: "/", output: large.output }],
          maximumFileBytes: 16,
          runPublicationScan: false,
        }),
      "ARTIFACT_LIMIT_EXCEEDED",
    );
  });

  it("exposes only a stable code when validation fails", () => {
    expect(new ArtifactValidationError("ARTIFACT_OUTPUT_INVALID").toJSON()).toEqual({
      code: "ARTIFACT_OUTPUT_INVALID",
    });
  });
});
