import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { Phase6BuildError, verifyPhase6Build } from "../../tools/verify-phase6-build.mjs";

const roots: string[] = [];
const detailFragments = ["overview", "thermal", "properties", "process", "uses-tradeoffs", "starting-profile", "evidence", "limitations", "relationships"];
const methodFragments = ["evidence-scopes", "thermal-metrics", "selector-scoring", "qualitative-guidance", "starting-profiles", "methods", "sources", "limitations"];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "phase6-build-"));
  roots.push(root);
  const atlas = {
    materials: Array.from({ length: 23 }, (_, index) => ({ slug: `material-${index + 1}` })),
    sources: [{ id: "source-one" }],
    methods: [{ id: "method-one" }],
  };
  const atlasPath = join(root, "atlas.json");
  await writeFile(atlasPath, JSON.stringify(atlas));
  const modes = [];
  for (const [name, base] of [["root", "/"], ["repository", "/atlas-preview/"]] as const) {
    const output = join(root, name);
    modes.push({ name, base, output });
    await mkdir(join(output, "materials"), { recursive: true });
    await mkdir(join(output, "method"), { recursive: true });
    await mkdir(join(output, "_astro"), { recursive: true });
    await writeFile(join(output, "_astro", "atlas.js"), "export const atlas=true");
    const materialLinks = atlas.materials.map(({ slug }) => `<a href="${base}materials/${slug}/">${slug}</a>`).join("");
    await writeFile(join(output, "index.html"), `<!doctype html><a href="${base}materials/">Atlas</a><a href="${base}method/#selector-scoring">Method</a>`);
    await writeFile(join(output, "materials", "index.html"), `<!doctype html><astro-island props="{}"></astro-island><script src="${base}_astro/atlas.js"></script>${materialLinks}`);
    await writeFile(join(output, "method", "index.html"), `<!doctype html>${[...methodFragments, "source-one", "method-one"].map((id) => `<section id="${id}"></section>`).join("")}<a href="${base}materials/material-1/#overview">Back</a>`);
    for (const { slug } of atlas.materials) {
      const directory = join(output, "materials", slug);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "index.html"), `<!doctype html>${detailFragments.map((id) => `<section id="${id}"></section>`).join("")}<a href="${base}method/#source-one">Evidence</a>`);
    }
  }
  return { atlasPath, modes };
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function codeFor(action: () => Promise<unknown>) {
  try { await action(); return "OK"; } catch (error) {
    expect(error).toBeInstanceOf(Phase6BuildError);
    return (error as Phase6BuildError).code;
  }
}

describe("Phase 6 emitted build verifier", () => {
  it("accepts both bases with 23 static detail routes and one atlas island", async () => {
    const input = await fixture();
    await expect(verifyPhase6Build({ ...input, runPublication: false })).resolves.toMatchObject({
      ok: true,
      modes: [
        { materialCount: 23, atlasIslandCount: 1, staticRouteJavaScriptCount: 0 },
        { materialCount: 23, atlasIslandCount: 1, staticRouteJavaScriptCount: 0 },
      ],
    });
  });

  it("rejects a missing required detail fragment", async () => {
    const input = await fixture();
    const path = join(input.modes[0]!.output, "materials/material-1/index.html");
    await writeFile(path, (await readFile(path, "utf8")).replace('id="relationships"', 'id="relationship-missing"'));
    expect(await codeFor(() => verifyPhase6Build({ ...input, runPublication: false }))).toBe("PHASE6_DETAIL_FRAGMENT_MISSING");
  });

  it("rejects dangling local fragments and scripts on reference routes", async () => {
    const dangling = await fixture();
    await writeFile(join(dangling.modes[0]!.output, "index.html"), '<!doctype html><a href="/method/#missing">Broken</a>');
    expect(await codeFor(() => verifyPhase6Build({ ...dangling, runPublication: false }))).toBe("PHASE6_LOCAL_FRAGMENT_MISSING");

    const scripted = await fixture();
    const path = join(scripted.modes[0]!.output, "method/index.html");
    await writeFile(path, `${await readFile(path, "utf8")}<script>window.bad=true</script>`);
    expect(await codeFor(() => verifyPhase6Build({ ...scripted, runPublication: false }))).toBe("PHASE6_STATIC_ROUTE_SCRIPT_FORBIDDEN");
  });
});
