import { describe, expect, it } from "vitest";

import { METHOD_COPY } from "../../src/features/method/method-copy.ts";
import { buildMethodPageModel } from "../../src/features/method/model.ts";
import { EVIDENCE_SCOPE_ORDER } from "../../src/lib/presentation/labels.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

describe("method copy", () => {
  it("defines the six distinct thermal concepts without a generic heat score", () => {
    expect(METHOD_COPY.thermalConcepts.map(({ id }) => id)).toEqual([
      "practical-service-guidance",
      "glass-transition",
      "heat-deflection",
      "vicat-softening",
      "melting-point",
      "other-named-metric",
    ]);
    expect(METHOD_COPY.thermalNotice).toMatch(/not directly interchangeable/i);
    expect(JSON.stringify(METHOD_COPY.thermalConcepts)).not.toMatch(/heat score/i);
  });

  it("states exact selector scoring and ordering semantics", () => {
    const atlas = loadPublicAtlas();
    expect(METHOD_COPY.selectorScoring.primaryWeight).toBe(atlas.selector.primaryWeight);
    expect(METHOD_COPY.selectorScoring.secondaryWeight).toBe(atlas.selector.secondaryWeight);
    expect(METHOD_COPY.selectorScoring.stableOrder).toBe(atlas.selector.stableOrder);
    expect(METHOD_COPY.selectorScoring.explanation).toMatch(/hard constraints remove/i);
    expect(METHOD_COPY.selectorScoring.explanation).toMatch(/alignment/i);
    expect(METHOD_COPY.selectorScoring.limitation).toMatch(/not.*quality/i);
  });

  it("covers every evidence scope, fact state, and required caution", () => {
    expect(METHOD_COPY.evidenceScopes.map(({ id }) => id)).toEqual(EVIDENCE_SCOPE_ORDER);
    expect(METHOD_COPY.factStates.map(({ id }) => id)).toEqual([
      "known", "unknown", "conditional", "not-applicable", "missing",
    ]);
    const text = JSON.stringify(METHOD_COPY);
    expect(text).toMatch(/qualitative.*not a standardized property/i);
    expect(text).toMatch(/calibration starting point/i);
    expect(text).toMatch(/TDS\/SDS/i);
    expect(text).toMatch(/process history/i);
    expect(text).toMatch(/not an engineering safety certification/i);
  });

  it("contains reviewed plain text only", () => {
    const text = JSON.stringify(METHOD_COPY);
    expect(text).not.toMatch(/https?:\/\//i);
    expect(text).not.toMatch(/<\/?[a-z][^>]*>/i);
    expect(text).not.toMatch(/spreadsheet|private source/i);
    expect(text).not.toMatch(/universal material quality/i);
    expect(Object.isFrozen(METHOD_COPY)).toBe(true);
  });
});

describe("method page model", () => {
  it("projects the complete ledger under stable contents and record anchors", () => {
    const model = buildMethodPageModel(loadPublicAtlas(), "/");
    expect(model.contents.map(({ id }) => id)).toEqual([
      "evidence-scopes", "thermal-metrics", "selector-scoring", "qualitative-guidance",
      "starting-profiles", "methods", "sources", "limitations",
    ]);
    expect(model.methods).toHaveLength(8);
    expect(model.sources).toHaveLength(22);
    expect(model.methods.map(({ id }) => id)).toEqual([...model.methods.map(({ id }) => id)].sort());
    expect(model.sources.map(({ id }) => id)).toEqual([...model.sources.map(({ id }) => id)].sort());
    expect(new Set([...model.methods, ...model.sources].map(({ anchor }) => anchor)).size).toBe(30);
  });

  it("derives exact safe source actions, scopes, and material claim backlinks", () => {
    const base = "/materials-atlas/";
    const model = buildMethodPageModel(loadPublicAtlas(), base);
    expect([...model.methods, ...model.sources].flatMap(({ uses }) => uses)).toHaveLength(999);
    expect(model.sources.every(({ claimUseCount, uses }) => claimUseCount === uses.length && uses.length > 0)).toBe(true);
    expect(model.sources.every(({ externalAction }) =>
      externalAction.url.startsWith("https://") && externalAction.target === "_blank" &&
      externalAction.rel === "noopener noreferrer" && externalAction.label === "Open external source"
    )).toBe(true);
    for (const use of [...model.methods, ...model.sources].flatMap(({ uses }) => uses)) {
      expect(use.href).toBe(`${base}materials/${use.materialSlug}/#${use.claimAnchor}`);
    }
  });

  it("retains explanatory methods without fabricating claim uses", () => {
    const model = buildMethodPageModel(loadPublicAtlas(), "/");
    expect(model.methods.filter(({ uses }) => uses.length === 0)).toHaveLength(3);
    expect(model.methods.every(({ description, limitations }) => description.length > 0 && limitations.length > 0)).toBe(true);
  });

  it("is invariant to public ledger and material permutation", () => {
    const atlas = structuredClone(loadPublicAtlas());
    atlas.materials.reverse(); atlas.sources.reverse(); atlas.methods.reverse();
    expect(buildMethodPageModel(atlas, "/docs/")).toEqual(buildMethodPageModel(loadPublicAtlas(), "/docs/"));
  });

  it("fails empty ledgers and unsafe or duplicate records with stable redacted errors", () => {
    const empty = structuredClone(loadPublicAtlas());
    empty.sources = [];
    expect(() => buildMethodPageModel(empty, "/")).toThrow("METHOD_SOURCES_REQUIRED");
    const noMethods = structuredClone(loadPublicAtlas());
    noMethods.methods = [];
    expect(() => buildMethodPageModel(noMethods, "/")).toThrow("METHOD_METHODS_REQUIRED");
    const unsafe = structuredClone(loadPublicAtlas());
    unsafe.sources[0]!.url = "http://example.com";
    expect(() => buildMethodPageModel(unsafe, "/")).toThrow("EVIDENCE_SOURCE_URL_INVALID");
    const duplicate = structuredClone(loadPublicAtlas());
    duplicate.methods.push(structuredClone(duplicate.methods[0]!));
    expect(() => buildMethodPageModel(duplicate, "/")).toThrow("EVIDENCE_RECORD_DUPLICATE");
  });
});
