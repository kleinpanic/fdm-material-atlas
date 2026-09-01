import { describe, expect, it } from "vitest";

import {
  SourceWorkbookDtoSchema,
  sourceLogicalRoles,
} from "../../src/data/source-contract/source-dto.ts";
import {
  MATERIAL_SEMANTIC_FIELDS,
  MaterialSemanticFieldPathSchema,
} from "../../src/data/source-contract/semantic-fields.ts";
import {
  SOURCE_CONTRACT_DESCRIPTOR,
  digestSourceContractDescriptor,
} from "../../src/data/source-contract/source-contract.ts";

const channel = {
  value: "Synthetic public value",
  note: "Synthetic public note",
  link: "https://example.com/public-reference",
  validation: { kind: "one-of" as const, options: ["first", "second"] },
  formulaSemantics: "preference-match" as const,
};

const record = {
  logicalRecordId: "material-alpha",
  semanticKey: "name",
  channels: channel,
};

const dto = {
  contractVersion: 1,
  surfaces: {
    materials: { records: [record] },
    selector: {
      records: [
        {
          ...record,
          logicalRecordId: "selector-primary-goal",
          semanticKey: "selector-primary-goal",
        },
      ],
    },
    "evidence-method": {
      records: [{ ...record, logicalRecordId: "source-alpha", semanticKey: "source-record" }],
    },
    "decision-map": {
      records: [{ ...record, logicalRecordId: "lane-outdoor", semanticKey: "lane-outdoor" }],
    },
  },
} as const;

describe("source-neutral DTO", () => {
  it("accepts exactly four logical roles and normalized semantic channels", () => {
    expect(sourceLogicalRoles).toEqual([
      "materials",
      "selector",
      "evidence-method",
      "decision-map",
    ]);
    expect(SourceWorkbookDtoSchema.parse(dto)).toEqual(dto);
  });

  it.each([
    { ...dto, metadata: { locator: "private" } },
    {
      ...dto,
      surfaces: { ...dto.surfaces, materials: { ...dto.surfaces.materials, account: "owner" } },
    },
    {
      ...dto,
      surfaces: {
        ...dto.surfaces,
        selector: { records: [{ ...dto.surfaces.selector.records[0], coordinate: "R1C1" }] },
      },
    },
    {
      ...dto,
      surfaces: {
        ...dto.surfaces,
        selector: {
          records: [
            {
              ...dto.surfaces.selector.records[0],
              channels: { ...channel, formulaSemantics: "=RUN()" },
            },
          ],
        },
      },
    },
  ])("rejects source-coupled metadata and raw executable semantics", (value) => {
    expect(SourceWorkbookDtoSchema.safeParse(value).success).toBe(false);
  });
});

describe("semantic field manifest", () => {
  it("contains exactly 32 unique canonical paths", () => {
    expect(MATERIAL_SEMANTIC_FIELDS).toHaveLength(32);
    expect(new Set(MATERIAL_SEMANTIC_FIELDS).size).toBe(32);
    expect(
      MATERIAL_SEMANTIC_FIELDS.every(
        (path) => MaterialSemanticFieldPathSchema.safeParse(path).success,
      ),
    ).toBe(true);
    expect(MATERIAL_SEMANTIC_FIELDS).toContain("serviceTemperature.minimum");
    expect(MATERIAL_SEMANTIC_FIELDS).toContain("serviceTemperature.maximum");
    expect(MATERIAL_SEMANTIC_FIELDS).toContain("thermalObservations.metric");
    expect(MATERIAL_SEMANTIC_FIELDS).toContain("thermalObservations.measurement");
  });
});

describe("reviewed source contract descriptor", () => {
  it("fixes counts, roles, selector semantics, lane IDs, and field paths", () => {
    expect(SOURCE_CONTRACT_DESCRIPTOR).toMatchObject({
      contractVersion: 1,
      expectedCounts: { materials: 23, publicSources: 22 },
      selectorWeights: { primary: 2, secondary: 1 },
    });
    expect(SOURCE_CONTRACT_DESCRIPTOR.logicalRoles).toEqual(sourceLogicalRoles);
    expect(SOURCE_CONTRACT_DESCRIPTOR.semanticFields).toEqual(MATERIAL_SEMANTIC_FIELDS);
    expect(SOURCE_CONTRACT_DESCRIPTOR.selectorCriterionIds).toHaveLength(7);
    expect(SOURCE_CONTRACT_DESCRIPTOR.decisionLaneIds).toHaveLength(8);
  });

  it("produces one deterministic SHA-256 digest from the descriptor", () => {
    const first = digestSourceContractDescriptor();
    const second = digestSourceContractDescriptor();
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(SOURCE_CONTRACT_DESCRIPTOR)).not.toContain(first);
  });
});
