import {
  EVIDENCE_SCOPE_ORDER,
  EVIDENCE_SCOPE_PRESENTATION,
  FACT_STATE_PRESENTATION,
  THERMAL_KIND_PRESENTATION,
} from "../../lib/presentation/labels.ts";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const thermalConcepts = [
  {
    id: "practical-service-guidance",
    label: "Practical service guidance",
    meaning:
      "A practical low-to-high use range stated for printed parts. It depends on formulation, geometry, load, duration, and process history.",
  },
  {
    id: "glass-transition",
    label: THERMAL_KIND_PRESENTATION["glass-transition"].label,
    meaning:
      "The transition region where an amorphous portion of a polymer becomes more mobile. It is not a printed-part service limit.",
  },
  {
    id: "heat-deflection",
    label: THERMAL_KIND_PRESENTATION["heat-deflection"].label,
    meaning:
      "A temperature measured under a specified test load and specimen condition. Test method and load must accompany comparisons.",
  },
  {
    id: "vicat-softening",
    label: THERMAL_KIND_PRESENTATION["vicat-softening"].label,
    meaning:
      "A standardized indentation temperature measured with a stated load and heating rate. It is not a service-temperature guarantee.",
  },
  {
    id: "melting-point",
    label: THERMAL_KIND_PRESENTATION["melting-point"].label,
    meaning:
      "The melting point or range of crystalline regions. It does not describe stiffness or dimensional stability below melting.",
  },
  {
    id: "other-named-metric",
    label: THERMAL_KIND_PRESENTATION.other.label,
    meaning:
      "Another explicitly named thermal test or observation. Interpret it only with its stated method and conditions.",
  },
] as const;

export const METHOD_COPY = deepFreeze({
  orientation:
    "This atlas is a decision aid. Evidence scope describes support for a claim; it does not grade the claim or certify a material.",
  evidenceScopeNotice:
    "Evidence scope describes how a source or method supports a claim. It does not grade the claim or certify a material.",
  evidenceScopes: EVIDENCE_SCOPE_ORDER.map((id) => ({ id, ...EVIDENCE_SCOPE_PRESENTATION[id] })),
  thermalNotice:
    "Practical service guidance, Tg, HDT, Vicat softening, melting point or range, and other named tests are not directly interchangeable.",
  thermalConcepts,
  selectorScoring: {
    primaryWeight: 2,
    secondaryWeight: 1,
    stableOrder: "score-desc-material-asc" as const,
    explanation:
      "The primary goal contributes two preference matches. Each applicable secondary preference contributes one. Hard constraints remove incompatible or unverifiable materials before ranking. Compatible results sort by alignment score, then stable material identity.",
    limitation:
      "The score describes alignment with selected criteria. It is not material quality, strength, safety, suitability, superiority, or certification.",
  },
  factStates: (
    Object.entries(FACT_STATE_PRESENTATION) as Array<
      [keyof typeof FACT_STATE_PRESENTATION, { label: string }]
    >
  ).map(([id, item]) => ({ id, label: item.label })),
  qualitativeGuidance:
    "Qualitative guidance is dimension-specific and is a practical heuristic, not a standardized property. Unknown or conditional hard-gate facts remain conservative and visible.",
  startingProfiles:
    "Starting profiles are calibration starting points, not guaranteed settings, maxima, or substitutes for product-specific guidance.",
  cautions: [
    "Exact filament formulations differ; check the current product TDS/SDS and manufacturer guidance.",
    "Geometry, moisture, load, print orientation, annealing, chamber conditions, and process history can change printed-part behavior.",
    "Representative product values are examples, not universal polymer-family specifications.",
    "Compare named thermal tests only when their methods, loads, specimen conditions, and other test conditions are compatible.",
    "External documents can change; verify the current exact product TDS/SDS before a consequential decision.",
    "This material selection information is not an engineering safety certification.",
  ],
});

export type MethodCopy = typeof METHOD_COPY;
