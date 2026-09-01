import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";
import { PUBLIC_ROUTE_REGISTRY } from "../../src/lib/public-route-registry.ts";
import { buildSelectorPageModel } from "../../src/features/selector/page-model.ts";
import { decodeSelectorClientModel } from "../../src/features/selector/client-model.ts";
import { evaluateSelectorSafely } from "../../src/features/selector/safe-engine.ts";
import { resolveCompareShortlistAction } from "../../src/components/selector/SelectorResults.tsx";

const pageModel = decodeSelectorClientModel(buildSelectorPageModel(loadPublicAtlas(), "/", PUBLIC_ROUTE_REGISTRY));

describe("evaluateSelectorSafely", () => {
  it("returns the current successful outcome for canonical selections", () => {
    const result = evaluateSelectorSafely(pageModel.projection, pageModel.defaults);
    expect(result.kind).toBe("success");
    if (result.kind === "success") expect(result.outcome.kind).toBe("ranked");
  });

  it("reduces invalid values to a controlled failure without echoing them", () => {
    const rejected = "<private-rejected-value>";
    const result = evaluateSelectorSafely(pageModel.projection, {
      ...pageModel.defaults,
      [pageModel.projection.criteria[0]!.id]: rejected,
    });

    expect(result).toEqual({ kind: "error", code: "SELECTOR_EVALUATION_FAILED" });
    expect(JSON.stringify(result)).not.toContain(rejected);
  });

  it("suppresses a prior ranking completely when an injected evaluator throws", () => {
    const first = evaluateSelectorSafely(pageModel.projection, pageModel.defaults);
    expect(first.kind).toBe("success");

    const secret = "do-not-expose-evaluator-message";
    const evaluator = vi.fn(() => {
      throw new Error(secret);
    });
    const failed = evaluateSelectorSafely(pageModel.projection, pageModel.defaults, evaluator);

    expect(failed).toEqual({ kind: "error", code: "SELECTOR_EVALUATION_FAILED" });
    expect(JSON.stringify(failed)).not.toMatch(/compatible|eliminated|rank|projection/i);
    expect(JSON.stringify(failed)).not.toContain(secret);
  });
});

describe("selector component boundary", () => {
  const controls = readFileSync(new URL("../../src/components/selector/SelectorControls.tsx", import.meta.url), "utf8");
  const results = readFileSync(new URL("../../src/components/selector/SelectorResults.tsx", import.meta.url), "utf8");
  const island = readFileSync(new URL("../../src/components/selector/SelectorIsland.tsx", import.meta.url), "utf8");
  const componentSource = `${controls}\n${results}`;
  const allSource = `${componentSource}\n${island}`;

  it("keeps exactly one island and one engine invocation owner", () => {
    expect(island).toContain("evaluateSelectorSafely");
    expect(componentSource).not.toMatch(/selectProjectedMaterials|evaluateSelectorSafely/);
    expect(allSource.match(/from ["']preact\/hooks["']/g)).toHaveLength(1);
  });

  it("uses native form and disclosure semantics for all seven criteria", () => {
    expect(controls).toMatch(/<form\b/);
    expect(controls).toMatch(/<fieldset\b/);
    expect(controls).toMatch(/<legend\b/);
    expect(controls).toMatch(/type="radio"/);
    expect(controls).toMatch(/<details\b/);
    expect(controls).toMatch(/<summary\b/);
    expect(controls).toMatch(/<select\b/);
    expect(controls).toMatch(/<dl\b/);
  });

  it("renders transparent compatible and eliminated records without alternate logic", () => {
    expect(results).toMatch(/<ol\b/);
    expect(results).toMatch(/<article\b/);
    expect(results).toMatch(/<details\b/);
    expect(results).toMatch(/<a\b/);
    expect(results).toContain("scoreLabel");
    expect(results).toContain("contributions.map");
    expect(results).toContain("reasons.map");
    expect(results).toContain("data-contribution-state");
    expect(results).toContain("data-exclusion-state");
    expect(results).toContain("data-shortlist-status");
    expect(results).toContain("data-alignment");
    expect(results).not.toMatch(/\.sort\s*\(|\.reduce\s*\(|awardedPoints\s*[+*-]|internalHref|fragmentHref/);
  });

  it("renders shortlist, reveal, no-match, and controlled recovery states", () => {
    expect(results).toContain("Show all");
    expect(results).toContain("Now eliminated by current constraints");
    expect(results).toContain("role=\"alert\"");
    expect(island).toContain("reduceShortlist");
    expect(island).toContain("presentShortlist");
  });

  it("uses the shared compare codec for only a complete ordered 2-4 item shortlist", () => {
    const knownMaterialIds = pageModel.projection.materials.map(({ id }) => id);
    const capability = {
      kind: "link" as const,
      href: "/compare/#comparison-matrix",
      label: "Compare shortlisted",
      base: "/",
      knownMaterialIds,
    };
    const [first, second, third, fourth, fifth] = knownMaterialIds;

    expect(resolveCompareShortlistAction(capability, [first!, second!])).toEqual({
      kind: "link",
      href: `/compare/?material=${first}&material=${second}#comparison-matrix`,
      label: "Compare shortlisted",
    });
    expect(resolveCompareShortlistAction(capability, [second!, first!])).toEqual(expect.objectContaining({
      href: `/compare/?material=${second}&material=${first}#comparison-matrix`,
    }));
    for (const invalid of [
      [],
      [first!],
      [first!, first!],
      [first!, second!, third!, fourth!, fifth!],
      [first!, "material-stale"],
    ]) {
      expect(resolveCompareShortlistAction(capability, invalid as never)).toEqual({
        kind: "unavailable",
        label: "Comparison is not available yet",
      });
    }
  });

  it("prohibits network, persistence, routing, raw HTML, and browser logging", () => {
    expect(allSource).not.toMatch(/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|dangerouslySetInnerHTML|console\.|window\.location|history\.(?:push|replace)State/);
  });

  it("imports the one shared comparison encoder and does not build query strings locally", () => {
    expect(results).toContain('from "../../features/comparison/url-state.ts"');
    expect(results).toContain("encodeCompareUrlState");
    expect(results).not.toMatch(/URLSearchParams|searchParams\.append|[?&]material=/);
  });

  it("keeps one polite status owner and a focusable result heading", () => {
    expect(island.match(/role="status"/g)).toHaveLength(1);
    expect(allSource).toContain("tabIndex={-1}");
    expect(island).toContain("150");
  });
});
