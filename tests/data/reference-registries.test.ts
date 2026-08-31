import { describe, expect, it } from "vitest";

import {
  ProcessGateRecordSchema,
  ProcessGateRegistrySchema,
} from "../../src/data/schema/process-gate.ts";
import {
  VisualizationReferenceRecordSchema,
  VisualizationReferenceRegistrySchema,
} from "../../src/data/schema/visualization.ts";

const basis = {
  kind: "method" as const,
  methodId: "method-capability-check",
  scope: "derived-selector-logic" as const,
};

const gate = {
  id: "gate-enclosure-capability",
  label: "Enclosure capability",
  capability: "enclosure",
  requirement: "Use an enclosure when this gate applies.",
  verification: "Confirm that the printer enclosure can hold the required conditions.",
  basis: [basis],
} as const;

describe("process-gate registry", () => {
  it("accepts a bounded gate with a stable ID and evidence basis", () => {
    expect(ProcessGateRecordSchema.parse(gate)).toEqual(gate);
    expect(ProcessGateRegistrySchema.parse([gate])).toHaveLength(1);
  });

  it.each([
    { ...gate, id: "enclosure-capability" },
    { ...gate, capability: "telepathy" },
    { ...gate, basis: [] },
    { ...gate, formula: "=EXEC()" },
    { ...gate, candidateMaterialIds: ["material-alpha"] },
  ])("rejects an invalid or expanded gate record", (value) => {
    expect(ProcessGateRecordSchema.safeParse(value).success).toBe(false);
  });
});

describe("visualization-reference registry", () => {
  const reference = {
    id: "visualization-material-overview",
    kind: "property-space",
    subject: { kind: "material-id", materialId: "material-alpha" },
    related: [
      { kind: "claim-id", claimId: "claim-alpha-density" },
      { kind: "material-route", slug: "alpha" },
      { kind: "decision-lane-id", decisionLaneId: "lane-outdoor" },
      { kind: "selector-criterion-id", selectorCriterionId: "selector-primary-goal" },
      { kind: "process-gate-id", processGateId: "gate-enclosure-capability" },
    ],
  } as const;

  it("accepts only typed resolvable target kinds", () => {
    expect(VisualizationReferenceRecordSchema.parse(reference)).toEqual(reference);
    expect(VisualizationReferenceRegistrySchema.parse([reference])).toHaveLength(1);
  });

  it.each([
    { ...reference, subject: { kind: "source-id", sourceId: "source-alpha" } },
    { ...reference, subject: { kind: "material-id", materialId: "material-alpha", slug: "alpha" } },
    { ...reference, transform: "javascript:run()" },
    { ...reference, x: 10, y: 20 },
    { ...reference, candidateMaterialIds: ["material-alpha"] },
  ])("rejects unknown targets and duplicated or executable representations", (value) => {
    expect(VisualizationReferenceRecordSchema.safeParse(value).success).toBe(false);
  });
});
