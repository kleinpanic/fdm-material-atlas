import { describe, expect, it } from "vitest";

import { METHOD_COPY } from "../../src/features/method/method-copy.ts";
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
