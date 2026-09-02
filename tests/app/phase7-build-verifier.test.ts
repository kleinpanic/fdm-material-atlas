import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import { Phase7BuildError, verifyPhase7Build } from "../../tools/verify-phase7-build.mjs";

const roots: string[] = [];

function island(
  component: "CompareIsland" | "DataExplorerIsland",
  componentUrl: string,
  props: object,
): string {
  const assetBase = componentUrl.slice(0, componentUrl.lastIndexOf("/"));
  return `<astro-island component-url="${componentUrl}" component-export="${component}" renderer-url="${assetBase}/client.js" props='${JSON.stringify(props)}' ssr client="load"><section><h2>${component} static fallback</h2></section><!--astro:end--></astro-island>`;
}

function comparisonPayload(
  model: object = { groups: [], materials: [], thermalGroups: [] },
): object {
  return {
    index: [],
    gzipBase64: gzipSync(Buffer.from(JSON.stringify(model)), { level: 9 }).toString("base64"),
  };
}

async function writeMode(root: string, base: string): Promise<void> {
  const prefix = base === "/" ? "" : base.slice(0, -1);
  await mkdir(join(root, "compare"), { recursive: true });
  await mkdir(join(root, "data"), { recursive: true });
  await mkdir(join(root, "_astro"), { recursive: true });
  await writeFile(
    join(root, "index.html"),
    `<!doctype html><link rel="canonical" href="https://atlas.example${base}"><p>Comparison is not available yet</p>`,
  );
  await writeFile(
    join(root, "compare/index.html"),
    `<!doctype html><link rel="canonical" href="https://atlas.example${prefix}/compare/"><a href="${base}">Selector</a>${island("CompareIsland", `${prefix}/_astro/compare.js`, { payload: comparisonPayload(), base })}`,
  );
  await writeFile(
    join(root, "data/index.html"),
    `<!doctype html><link rel="canonical" href="https://atlas.example${prefix}/data/"><a href="${prefix}/compare/">Compare</a>${island("DataExplorerIsland", `${prefix}/_astro/data.js`, { model: { materials: [], fields: [], groups: [], thermalMetrics: [] } })}`,
  );
  await writeFile(join(root, "_astro/client.js"), "export const hydrate = true;");
  await writeFile(join(root, "_astro/shared.js"), "export const shared = true;");
  await writeFile(
    join(root, "_astro/compare.js"),
    "import './shared.js'; export const CompareIsland = true;",
  );
  await writeFile(
    join(root, "_astro/data.js"),
    "import './shared.js'; export const DataExplorerIsland = true;",
  );
}

async function fixture(): Promise<{ root: string; repository: string }> {
  const parent = await mkdtemp(join(tmpdir(), "phase7-build-"));
  roots.push(parent);
  const root = join(parent, "root");
  const repository = join(parent, "repository");
  await mkdir(root);
  await mkdir(repository);
  await writeMode(root, "/");
  await writeMode(repository, "/atlas-preview/");
  return { root, repository };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Phase 7 emitted build verifier", () => {
  it("accepts normalized root and repository compare/data artifacts with bounded route graphs", async () => {
    const outputs = await fixture();
    const report = await verifyPhase7Build({
      rootOutput: outputs.root,
      repositoryOutput: outputs.repository,
      prohibitedExactPatterns: ["private-fixture-sentinel"],
      runPublicationScan: false,
    });
    expect(report).toMatchObject({ ok: true, routeCount: 2 });
    expect(report.modes.map(({ mode }) => mode)).toEqual(["root", "repository"]);
    expect(
      report.modes.every(
        ({ compareGzipBytes, dataGzipBytes }) => compareGzipBytes > 0 && dataGzipBytes > 0,
      ),
    ).toBe(true);
  });

  it.each([
    [
      "SOURCE_MAP_FORBIDDEN",
      async (outputs: Awaited<ReturnType<typeof fixture>>) =>
        writeFile(join(outputs.root, "_astro/leak.js.map"), "{}"),
    ],
    [
      "CLIENT_PRIVATE_PATTERN_FORBIDDEN",
      async (outputs: Awaited<ReturnType<typeof fixture>>) =>
        writeFile(
          join(outputs.root, "_astro/compare.js"),
          "export const value='private-fixture-sentinel'",
        ),
    ],
    [
      "CLIENT_PRIVATE_PATTERN_FORBIDDEN",
      async (outputs: Awaited<ReturnType<typeof fixture>>) =>
        writeFile(
          join(outputs.root, "compare/index.html"),
          `<!doctype html><link rel="canonical" href="https://atlas.example/compare/">${island("CompareIsland", "/_astro/compare.js", { payload: comparisonPayload({ groups: [{ label: "private-fixture-sentinel" }], materials: [], thermalGroups: [] }), base: "/" })}`,
        ),
    ],
    [
      "CLIENT_REQUEST_FORBIDDEN",
      async (outputs: Awaited<ReturnType<typeof fixture>>) =>
        writeFile(join(outputs.root, "_astro/data.js"), "fetch('/public-data.json')"),
    ],
    [
      "ROUTE_LINK_INVALID",
      async (outputs: Awaited<ReturnType<typeof fixture>>) =>
        writeFile(
          join(outputs.repository, "data/index.html"),
          '<!doctype html><link rel="canonical" href="https://atlas.example/atlas-preview/data/"><a href="/compare/">Broken base</a>',
        ),
    ],
    [
      "PROPS_BOUNDARY_VIOLATION",
      async (outputs: Awaited<ReturnType<typeof fixture>>) =>
        writeFile(
          join(outputs.root, "compare/index.html"),
          `<!doctype html><link rel="canonical" href="https://atlas.example/compare/">${island("CompareIsland", "/_astro/compare.js", { payload: comparisonPayload({ groups: [], materials: [], thermalGroups: [], atlas: {} }), base: "/" })}`,
        ),
    ],
  ])("fails closed with %s", async (code, mutate) => {
    const outputs = await fixture();
    await mutate(outputs);
    const error = await verifyPhase7Build({
      rootOutput: outputs.root,
      repositoryOutput: outputs.repository,
      prohibitedExactPatterns: ["private-fixture-sentinel"],
      runPublicationScan: false,
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(Phase7BuildError);
    expect((error as Phase7BuildError).code).toBe(code);
    expect(JSON.stringify(error)).not.toContain("private-fixture-sentinel");
    expect(JSON.stringify(error)).not.toContain(outputs.root);
  });
});
