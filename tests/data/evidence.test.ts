import { describe, expect, expectTypeOf, it } from "vitest";
import * as z from "zod";

import {
  BasisRefSchema,
  EvidenceScopeSchema,
  EvidenceSourceSchema,
  MethodRecordSchema,
  PublicHttpsUrlSchema,
  claimSchema,
  type Claim,
} from "../../src/data/schema/evidence.ts";
import {
  ChemicalResistanceRatingSchema,
  CostTierSchema,
  FlexibilityRatingSchema,
  ImpactResistanceRatingSchema,
  PrintDifficultySchema,
  VentilationCategorySchema,
  WearAbrasionRatingSchema,
} from "../../src/data/schema/vocabularies.ts";
import { syntheticIds } from "../fixtures/schema-values.ts";

describe("dimension-specific vocabularies", () => {
  it.each([
    [WearAbrasionRatingSchema, "abrasive"],
    [ImpactResistanceRatingSchema, "very-high-impact"],
    [FlexibilityRatingSchema, "flexible"],
    [ChemicalResistanceRatingSchema, "broad-resistance"],
    [PrintDifficultySchema, "advanced"],
    [VentilationCategorySchema, "local-exhaust"],
    [CostTierSchema, "premium"],
  ] as const)("accepts a term in its own dimension", (schema, value) => {
    expect(schema.safeParse(value).success).toBe(true);
  });

  it("does not expose a universal quality scale", () => {
    expect(WearAbrasionRatingSchema.safeParse("very-high-impact").success).toBe(false);
    expect(ImpactResistanceRatingSchema.safeParse("abrasive").success).toBe(false);
    expect(FlexibilityRatingSchema.safeParse("broad-resistance").success).toBe(false);
    expect(ChemicalResistanceRatingSchema.safeParse("flexible").success).toBe(false);
    expect(PrintDifficultySchema.safeParse("premium").success).toBe(false);
  });
});

describe("public evidence links", () => {
  it.each([
    "https://materials.example.com/guide",
    "https://docs.example.org:8443/data?version=2#limits",
    "https://203.0.114.10/data",
    "https://[2606:4700:4700::1111]/guide",
  ])("accepts syntactically public HTTPS URL %s", (url) => {
    expect(PublicHttpsUrlSchema.safeParse(url).success).toBe(true);
  });

  it.each([
    "http://materials.example.com/guide",
    "ftp://materials.example.com/guide",
    "https://user:secret@materials.example.com/guide",
    "https://localhost/guide",
    "https://service.localhost/guide",
    "https://printer.local/guide",
    "https://127.0.0.1/guide",
    "https://10.2.3.4/guide",
    "https://172.16.1.1/guide",
    "https://192.168.2.2/guide",
    "https://169.254.2.2/guide",
    "https://192.0.2.4/guide",
    "https://198.51.100.2/guide",
    "https://203.0.113.2/guide",
    "https://[::1]/guide",
    "https://[fc00::1]/guide",
    "https://[fe80::1]/guide",
    "https://[2001:db8::1]/guide",
    "not a URL",
  ])("rejects non-public or malformed URL without echoing it", (url) => {
    const result = PublicHttpsUrlSchema.safeParse(url);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.every((issue) => issue.message === "URL_UNSAFE")).toBe(true);
      expect(JSON.stringify(result.error.issues)).not.toContain(url);
    }
  });
});

describe("claim-level evidence", () => {
  const allScopes = [
    "product-specific",
    "representative-product",
    "family-guidance",
    "qualitative-heuristic",
    "starting-profile-guidance",
    "derived-selector-logic",
  ] as const;

  it.each(allScopes)("retains the %s evidence scope at the basis link", (scope) => {
    const parsed = BasisRefSchema.parse({
      kind: "source",
      sourceId: syntheticIds.source,
      scope,
    });
    expect(parsed.scope).toBe(scope);
    expect(EvidenceScopeSchema.safeParse(scope).success).toBe(true);
  });

  it("distinguishes source and method basis references", () => {
    expect(
      BasisRefSchema.parse({
        kind: "source",
        sourceId: syntheticIds.source,
        scope: "product-specific",
      }),
    ).toEqual({
      kind: "source",
      sourceId: syntheticIds.source,
      scope: "product-specific",
    });
    expect(
      BasisRefSchema.parse({
        kind: "method",
        methodId: syntheticIds.method,
        scope: "derived-selector-logic",
      }),
    ).toEqual({
      kind: "method",
      methodId: syntheticIds.method,
      scope: "derived-selector-logic",
    });
  });

  it("validates strict public source and method records", () => {
    expect(
      EvidenceSourceSchema.parse({
        id: syntheticIds.source,
        title: "Alpha material guide",
        publisher: "Alpha Materials",
        kind: "manufacturer-guide",
        url: "https://materials.example.com/guide",
      }),
    ).toMatchObject({ id: syntheticIds.source, kind: "manufacturer-guide" });

    expect(
      MethodRecordSchema.parse({
        id: syntheticIds.method,
        name: "Reviewed comparison method",
        description: "Compares only values with compatible definitions.",
        limitations: ["Results require application-specific verification."],
      }),
    ).toMatchObject({ id: syntheticIds.method });

    expect(
      EvidenceSourceSchema.safeParse({
        id: syntheticIds.source,
        title: "Alpha material guide",
        publisher: "Alpha Materials",
        kind: "manufacturer-guide",
        url: "https://materials.example.com/guide",
        rawHtml: "<strong>unsafe field</strong>",
      }).success,
    ).toBe(false);
  });

  it("requires a stable claim ID, fact state, and at least one basis", () => {
    const TextClaimSchema = claimSchema(z.string().min(1));
    const claim = TextClaimSchema.parse({
      id: syntheticIds.claim,
      value: { state: "known", value: "neutral fact" },
      basis: [
        {
          kind: "method",
          methodId: syntheticIds.method,
          scope: "qualitative-heuristic",
        },
      ],
    });
    expect(claim.value).toEqual({ state: "known", value: "neutral fact" });
    expectTypeOf(claim).toEqualTypeOf<Claim<string>>();

    expect(
      TextClaimSchema.safeParse({
        id: syntheticIds.claim,
        value: { state: "known", value: "neutral fact" },
        basis: [],
      }).success,
    ).toBe(false);
    expect(
      TextClaimSchema.safeParse({
        id: "claim",
        value: { state: "known", value: "neutral fact" },
        basis: [
          {
            kind: "source",
            sourceId: syntheticIds.source,
            scope: "family-guidance",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      TextClaimSchema.safeParse({
        id: syntheticIds.claim,
        value: null,
        basis: [
          {
            kind: "source",
            sourceId: syntheticIds.source,
            scope: "family-guidance",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown keys on all evidence-bearing objects", () => {
    expect(
      BasisRefSchema.safeParse({
        kind: "source",
        sourceId: syntheticIds.source,
        scope: "family-guidance",
        coordinate: "synthetic-coordinate",
      }).success,
    ).toBe(false);
    expect(
      claimSchema(z.boolean()).safeParse({
        id: syntheticIds.claim,
        value: { state: "known", value: false },
        basis: [
          {
            kind: "method",
            methodId: syntheticIds.method,
            scope: "derived-selector-logic",
          },
        ],
        metadata: {},
      }).success,
    ).toBe(false);
  });
});
