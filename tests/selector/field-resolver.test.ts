import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { VocabularyDefinition } from "../../src/data/schema/atlas.ts";
import type { FactState } from "../../src/data/schema/fact-state.ts";
import type { VocabularyId } from "../../src/data/schema/ids.ts";
import type { Material } from "../../src/data/schema/material.ts";
import { selectorFieldValues, type SelectorField } from "../../src/data/schema/selector.ts";
import { parseAtlas } from "../../src/data/schema/parse-atlas.ts";
import {
  containsNormalizedSelectorLiteral,
  ORDERED_SELECTOR_FIELD_VOCABULARY,
  resolveSelectorField,
  SelectorFieldConfigurationError,
} from "../../src/domain/selector/field-resolver.ts";
import type {
  ProjectedSelectorFieldRecord,
  ProjectedSelectorMaterial,
} from "../../src/domain/selector/types.ts";

const artifactPath = resolve(import.meta.dirname, "../../src/data/public/atlas.v1.json");
const parsed = parseAtlas(JSON.parse(readFileSync(artifactPath, "utf8")) as unknown);
if (!parsed.success) throw new Error("Canonical selector resolver fixture is invalid");

const atlas = parsed.data;
const pla: Material = (() => {
  const material = atlas.materials.find(({ id }) => id === "material-pla");
  if (!material) throw new Error("Canonical PLA fixture is missing");
  return material;
})();

const orderExpected = {
  "properties.wearAbrasion.order": 1,
  "properties.impactResistance.order": 1,
  "properties.creepSustainedLoad.order": 0,
  "properties.outdoorUv.order": 1,
  "properties.moistureSensitivity.order": 0,
  "properties.warpTendency.order": 0,
  "properties.flexibility.order": 0,
  "properties.chemicalResistance.order": 0,
  "properties.coolingShrinkRisk.order": 0,
  "properties.dimensionalStability.order": 2,
  "process.printDifficulty.order": 0,
  "process.enclosure.order": 0,
  "process.hardenedNozzle.order": 0,
  "process.dryingPriority.order": 0,
  "process.ventilation.order": 0,
  "costTier.order": 0,
} as const satisfies Partial<Record<SelectorField, number>>;

const baseExpected = {
  "serviceTemperature.minimum": 40,
  "serviceTemperature.maximum": 50,
  "properties.wearAbrasion": "moderate-wear",
  "properties.impactResistance": "low-impact",
  "properties.creepSustainedLoad": "poor",
  "properties.outdoorUv": "limited",
  "properties.moistureSensitivity": "low",
  "properties.warpTendency": "low",
  "properties.flexibility": "rigid",
  "properties.chemicalResistance": "limited",
  "properties.coolingShrinkRisk": "low",
  "properties.dimensionalStability": "high",
  "process.printDifficulty": "easy",
  "process.enclosure": "not-required",
  "process.hardenedNozzle": "not-required",
  "process.dryingPriority": "optional",
  "process.ventilation": "standard-room",
  costTier: "low",
  "guidance.bestSuitedFor": ["prototypes, rigid indoor fixtures, models"],
  "guidance.tradeoffs": ["low heat resistance; brittle under impact; creeps under sustained load"],
  ...orderExpected,
} as const satisfies Record<SelectorField, string | number | readonly string[]>;

const orderedFields = Object.keys(ORDERED_SELECTOR_FIELD_VOCABULARY) as Array<
  keyof typeof ORDERED_SELECTOR_FIELD_VOCABULARY
>;

function cloneMaterial(): Material {
  return structuredClone(pla);
}

function cloneVocabularies(): VocabularyDefinition[] {
  return structuredClone(atlas.vocabularies);
}

function expectConfigurationCode(
  action: () => unknown,
  code: SelectorFieldConfigurationError["code"],
): void {
  try {
    action();
    throw new Error("Expected controlled selector configuration failure");
  } catch (error) {
    expect(error).toBeInstanceOf(SelectorFieldConfigurationError);
    expect((error as SelectorFieldConfigurationError).code).toBe(code);
    expect((error as Error).message).toBe(code);
  }
}

describe("selector field resolver", () => {
  it("covers every allow-listed field through the public resolver", () => {
    expect(selectorFieldValues).toHaveLength(36);
    expect(Object.keys(baseExpected).sort()).toEqual([...selectorFieldValues].sort());

    for (const field of selectorFieldValues) {
      expect(resolveSelectorField(pla, field, atlas.vocabularies)).toEqual({
        field,
        state: "resolved",
        value: baseExpected[field],
      });
    }
  });

  it("binds exactly all sixteen ordered selector fields to exact vocabularies", () => {
    expect(orderedFields).toHaveLength(16);
    expect(ORDERED_SELECTOR_FIELD_VOCABULARY).toEqual({
      "properties.wearAbrasion.order": "vocabulary-wear-abrasion",
      "properties.impactResistance.order": "vocabulary-impact-resistance",
      "properties.creepSustainedLoad.order": "vocabulary-creep-sustained-load",
      "properties.outdoorUv.order": "vocabulary-outdoor-uv",
      "properties.moistureSensitivity.order": "vocabulary-moisture-sensitivity",
      "properties.warpTendency.order": "vocabulary-warp-tendency",
      "properties.flexibility.order": "vocabulary-flexibility",
      "properties.chemicalResistance.order": "vocabulary-chemical-resistance",
      "properties.coolingShrinkRisk.order": "vocabulary-cooling-shrink-risk",
      "properties.dimensionalStability.order": "vocabulary-dimensional-stability",
      "process.printDifficulty.order": "vocabulary-print-difficulty",
      "process.enclosure.order": "vocabulary-enclosure-requirement",
      "process.hardenedNozzle.order": "vocabulary-hardened-nozzle-requirement",
      "process.dryingPriority.order": "vocabulary-drying-priority",
      "process.ventilation.order": "vocabulary-ventilation-category",
      "costTier.order": "vocabulary-cost-tier",
    });
  });

  it.each([
    { state: "unknown", reason: "Unknown" },
    { state: "conditional", condition: "If annealed", value: "premium" },
    { state: "not-applicable", reason: "Not applicable" },
    { state: "missing", reason: "Missing" },
  ] as const)("treats $state canonical facts as indeterminate", (fact) => {
    const material = cloneMaterial();
    material.costTier.value = fact as FactState<
      Material["costTier"]["value"] extends FactState<infer T> ? T : never
    >;

    expect(resolveSelectorField(material, "costTier", atlas.vocabularies)).toEqual({
      field: "costTier",
      state: "indeterminate",
      reason: fact.state,
    });
    expect(resolveSelectorField(material, "costTier.order", atlas.vocabularies)).toEqual({
      field: "costTier.order",
      state: "indeterminate",
      reason: fact.state,
    });
  });

  it("preserves falsey resolved values without using sentinel coercion", () => {
    const material = cloneMaterial();
    material.serviceTemperature.value = {
      state: "known",
      value: { shape: "range", min: 0, max: 0, unit: "degC" },
    };
    expect(
      resolveSelectorField(material, "serviceTemperature.minimum", atlas.vocabularies),
    ).toMatchObject({
      state: "resolved",
      value: 0,
    });

    const projected: ProjectedSelectorMaterial = {
      id: pla.id,
      label: pla.name,
      fields: [
        { field: "serviceTemperature.minimum", state: "resolved", value: 0 },
        { field: "properties.outdoorUv", state: "resolved", value: false },
      ],
    };
    expect(resolveSelectorField(projected, "serviceTemperature.minimum")).toMatchObject({
      value: 0,
    });
    expect(resolveSelectorField(projected, "properties.outdoorUv")).toMatchObject({ value: false });
  });

  it("uses only service guidance for minimum and maximum temperature", () => {
    const material = cloneMaterial();
    material.serviceTemperature.value = {
      state: "known",
      value: { shape: "exact", value: 73, unit: "degC" },
    };
    material.thermalObservations[0]!.measurement = {
      state: "known",
      value: { shape: "range", min: 400, max: 500, unit: "degC" },
    };

    expect(
      resolveSelectorField(material, "serviceTemperature.minimum", atlas.vocabularies),
    ).toMatchObject({ value: 73 });
    expect(
      resolveSelectorField(material, "serviceTemperature.maximum", atlas.vocabularies),
    ).toMatchObject({ value: 73 });
  });

  it("normalizes text lists and matches case-insensitive literal substrings without regex", () => {
    const material = cloneMaterial();
    material.guidance.bestSuitedFor.value = {
      state: "known",
      value: ["SUPPORT (breakaway)", "Decorative [fills]"],
    };
    const result = resolveSelectorField(material, "guidance.bestSuitedFor", atlas.vocabularies);
    expect(result).toEqual({
      field: "guidance.bestSuitedFor",
      state: "resolved",
      value: ["support (breakaway)", "decorative [fills]"],
    });
    expect(containsNormalizedSelectorLiteral(result, ["BREAKAWAY", "never"])).toBe(true);
    expect(containsNormalizedSelectorLiteral(result, ["support.*"])).toBe(false);
  });

  it("gives canonical and projected subjects the same result contract", () => {
    for (const field of selectorFieldValues) {
      const canonical = resolveSelectorField(pla, field, atlas.vocabularies);
      const projected: ProjectedSelectorMaterial = {
        id: pla.id,
        label: pla.name,
        fields: [canonical],
      };
      expect(resolveSelectorField(projected, field)).toEqual(canonical);
    }
  });

  it("returns missing for an absent projected field and preserves explicit indeterminate records", () => {
    const explicit: ProjectedSelectorFieldRecord = {
      field: "costTier",
      state: "indeterminate",
      reason: "conditional",
    };
    const projected: ProjectedSelectorMaterial = {
      id: pla.id,
      label: pla.name,
      fields: [explicit],
    };
    expect(resolveSelectorField(projected, "costTier")).toEqual(explicit);
    expect(resolveSelectorField(projected, "properties.flexibility")).toEqual({
      field: "properties.flexibility",
      state: "indeterminate",
      reason: "missing",
    });
  });
});

describe("ordered selector field configuration", () => {
  const field = "costTier.order" as const;
  const vocabularyId = ORDERED_SELECTOR_FIELD_VOCABULARY[field];

  function target(vocabularies: VocabularyDefinition[]): VocabularyDefinition {
    const vocabulary = vocabularies.find(({ id }) => id === vocabularyId);
    if (!vocabulary) throw new Error("Test vocabulary missing");
    return vocabulary;
  }

  it("rejects a missing vocabulary", () => {
    expectConfigurationCode(
      () =>
        resolveSelectorField(
          pla,
          field,
          atlas.vocabularies.filter(({ id }) => id !== vocabularyId),
        ),
      "SELECTOR_VOCABULARY_MISSING",
    );
  });

  it("rejects an unordered vocabulary", () => {
    const vocabularies = cloneVocabularies();
    target(vocabularies).ordered = false;
    expectConfigurationCode(
      () => resolveSelectorField(pla, field, vocabularies),
      "SELECTOR_VOCABULARY_UNORDERED",
    );
  });

  it("rejects duplicate term values", () => {
    const vocabularies = cloneVocabularies();
    const vocabulary = target(vocabularies);
    vocabulary.terms[1]!.value = vocabulary.terms[0]!.value;
    expectConfigurationCode(
      () => resolveSelectorField(pla, field, vocabularies),
      "SELECTOR_VOCABULARY_VALUE_DUPLICATE",
    );
  });

  it("rejects duplicate term orders", () => {
    const vocabularies = cloneVocabularies();
    const vocabulary = target(vocabularies);
    vocabulary.terms[1]!.order = vocabulary.terms[0]!.order;
    expectConfigurationCode(
      () => resolveSelectorField(pla, field, vocabularies),
      "SELECTOR_VOCABULARY_ORDER_DUPLICATE",
    );
  });

  it.each([undefined, Number.NaN, "1"])("rejects invalid term order %j", (order) => {
    const vocabularies = cloneVocabularies();
    target(vocabularies).terms[0]!.order = order as number | undefined;
    expectConfigurationCode(
      () => resolveSelectorField(pla, field, vocabularies),
      "SELECTOR_VOCABULARY_ORDER_INVALID",
    );
  });

  it("rejects a vocabulary that does not contain the known value", () => {
    const vocabularies = cloneVocabularies();
    target(vocabularies).terms = target(vocabularies).terms.filter(({ value }) => value !== "low");
    expectConfigurationCode(
      () => resolveSelectorField(pla, field, vocabularies),
      "SELECTOR_VOCABULARY_VALUE_MISSING",
    );
  });

  it("uses the explicitly bound vocabulary even when another vocabulary contains the same value", () => {
    const vocabularies = cloneVocabularies();
    vocabularies.unshift({
      id: "vocabulary-decoy" as VocabularyId,
      label: "Decoy",
      ordered: true,
      terms: [{ value: "low", label: "Low", order: 99 }],
    });
    expect(resolveSelectorField(pla, field, vocabularies)).toMatchObject({ value: 0 });
  });
});
