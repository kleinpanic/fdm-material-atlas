import { describe, expect, it } from "vitest";

import { EvidenceScopeSchema, EvidenceSourceKindSchema } from "../../src/data/schema/evidence.ts";
import { ThermalMetricKindSchema } from "../../src/data/schema/material.ts";
import {
  EVIDENCE_SCOPE_ORDER,
  EVIDENCE_SCOPE_PRESENTATION,
  FACT_STATE_PRESENTATION,
  PROCESS_REQUIREMENT_PRESENTATION,
  SOURCE_KIND_PRESENTATION,
  THERMAL_KIND_PRESENTATION,
  UNIT_PRESENTATION,
  evidenceScopeLabel,
  projectFactState,
} from "../../src/lib/presentation/labels.ts";
import {
  formatMeasurement,
  formatThermalMeasurement,
} from "../../src/lib/presentation/measurements.ts";

function sortedKeys(value: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(value).sort();
}

describe("shared scientific presentation registry", () => {
  it("exhaustively labels fact and process requirement states", () => {
    expect(sortedKeys(FACT_STATE_PRESENTATION)).toEqual([
      "conditional",
      "known",
      "missing",
      "not-applicable",
      "unknown",
    ]);
    expect(sortedKeys(PROCESS_REQUIREMENT_PRESENTATION)).toEqual([
      "conditional",
      "not-applicable",
      "not-required",
      "recommended",
      "required",
      "unknown",
    ]);
    expect(Object.values(PROCESS_REQUIREMENT_PRESENTATION).map(({ label }) => label)).toEqual([
      "Not required",
      "Recommended",
      "Required",
      "Conditional — review conditions",
      "Unknown — verify before use",
      "Not applicable",
    ]);
  });

  it("keeps all evidence scopes ordered separately from exact short labels and meanings", () => {
    expect(EVIDENCE_SCOPE_ORDER).toEqual([
      "product-specific",
      "representative-product",
      "family-guidance",
      "qualitative-heuristic",
      "starting-profile-guidance",
      "derived-selector-logic",
    ]);
    expect(sortedKeys(EVIDENCE_SCOPE_PRESENTATION)).toEqual([...EvidenceScopeSchema.options].sort());
    expect(EVIDENCE_SCOPE_ORDER.map(evidenceScopeLabel)).toEqual([
      "Product-specific",
      "Representative product",
      "Family guidance",
      "Qualitative heuristic",
      "Starting-profile guidance",
      "Derived selector logic",
    ]);
    for (const scope of EVIDENCE_SCOPE_ORDER) {
      expect(EVIDENCE_SCOPE_PRESENTATION[scope].meaning.length).toBeGreaterThan(30);
    }
  });

  it("exhaustively labels thermal kinds, source kinds, and typed public units", () => {
    expect(sortedKeys(THERMAL_KIND_PRESENTATION)).toEqual([...ThermalMetricKindSchema.options].sort());
    expect(sortedKeys(SOURCE_KIND_PRESENTATION)).toEqual([...EvidenceSourceKindSchema.options].sort());
    expect(sortedKeys(UNIT_PRESENTATION)).toEqual(["degC", "g/cm3", "mm/s", "percent"]);
    expect(Object.values(UNIT_PRESENTATION).map(({ label }) => label)).toEqual([
      "°C",
      "g/cm³",
      "mm/s",
      "%",
    ]);
    expect(SOURCE_KIND_PRESENTATION["technical-data-sheet"].label).toBe("Technical data sheet");
    expect(THERMAL_KIND_PRESENTATION["heat-deflection"].label).toBe(
      "Heat deflection temperature (HDT)",
    );
  });

  it("projects all five fact states without collapsing zero or optional values", () => {
    expect(projectFactState({ state: "known", value: 0 })).toEqual({
      state: "known",
      label: "Known",
      value: 0,
    });
    expect(projectFactState({ state: "conditional", condition: "Test", value: 0 })).toMatchObject({
      state: "conditional",
      value: 0,
    });
    expect(projectFactState({ state: "not-applicable" })).toEqual({
      state: "not-applicable",
      label: "Not applicable for this material or claim.",
    });
  });
});

describe("typed measurement presentation", () => {
  it.each([
    [{ shape: "exact", value: 0, unit: "degC" } as const, "0 °C"],
    [{ shape: "range", min: 0, max: 100, unit: "percent" } as const, "0–100 %"],
    [{ shape: "exact", value: 1.24, unit: "g/cm3" } as const, "1.24 g/cm³"],
    [{ shape: "range", min: 20, max: 40, unit: "mm/s" } as const, "20–40 mm/s"],
  ])("preserves exact/range shape, zero, and unit for %j", (measurement, text) => {
    expect(formatMeasurement(measurement)).toMatchObject({
      shape: measurement.shape,
      text,
    });
  });

  it("retains complete named thermal identity separately from its measurement", () => {
    expect(
      formatThermalMeasurement(
        "heat-deflection",
        "Heat deflection temperature at 0.45 MPa",
        { shape: "exact", value: 72, unit: "degC" },
      ),
    ).toEqual({
      metric: "heat-deflection",
      metricLabel: "Heat deflection temperature at 0.45 MPa",
      kindLabel: "Heat deflection temperature (HDT)",
      measurement: {
        shape: "exact",
        values: [72],
        unit: "degC",
        unitLabel: "°C",
        text: "72 °C",
      },
    });
  });

  it("fails with controlled codes and does not reflect rejected values", () => {
    const rejected = "synthetic-reflected-value";
    expect(() => formatMeasurement({ shape: rejected } as never)).toThrow(
      "PRESENTATION_MEASUREMENT_INVALID",
    );
    try {
      formatMeasurement({ shape: rejected } as never);
    } catch (error) {
      expect(String(error)).not.toContain(rejected);
    }
  });
});
