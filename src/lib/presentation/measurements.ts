import type { ThermalMetricKind } from "../../data/schema/material.ts";
import type {
  DensityMeasurement,
  FanMeasurement,
  SpeedMeasurement,
  TemperatureMeasurement,
} from "../../data/schema/measurements.ts";
import {
  THERMAL_KIND_PRESENTATION,
  UNIT_PRESENTATION,
  type PublicMeasurementUnit,
} from "./labels.ts";

export type PublicMeasurement =
  TemperatureMeasurement | DensityMeasurement | SpeedMeasurement | FanMeasurement;

export type MeasurementPresentation = {
  readonly shape: "exact" | "range";
  readonly values: readonly number[];
  readonly unit: PublicMeasurementUnit;
  readonly unitLabel: string;
  readonly text: string;
};

function fail(): never {
  throw new Error("PRESENTATION_MEASUREMENT_INVALID");
}

function numberText(value: number): string {
  if (!Number.isFinite(value)) return fail();
  return Object.is(value, -0) ? "0" : String(value);
}

export function formatMeasurement(measurement: PublicMeasurement): MeasurementPresentation {
  if (!(measurement.unit in UNIT_PRESENTATION)) return fail();
  const unit = measurement.unit as PublicMeasurementUnit;
  const unitLabel = UNIT_PRESENTATION[unit].label;
  if (measurement.shape === "exact") {
    const value = measurement.value;
    return {
      shape: "exact",
      values: [value],
      unit,
      unitLabel,
      text: `${numberText(value)} ${unitLabel}`,
    };
  }
  if (measurement.shape === "range") {
    const { min, max } = measurement;
    if (min > max) return fail();
    return {
      shape: "range",
      values: [min, max],
      unit,
      unitLabel,
      text: `${numberText(min)}–${numberText(max)} ${unitLabel}`,
    };
  }
  return fail();
}

export function formatThermalMeasurement(
  metric: ThermalMetricKind,
  metricLabel: string,
  measurement: TemperatureMeasurement,
) {
  if (!(metric in THERMAL_KIND_PRESENTATION) || metricLabel.trim().length === 0) {
    throw new Error("PRESENTATION_THERMAL_INVALID");
  }
  return {
    metric,
    metricLabel,
    kindLabel: THERMAL_KIND_PRESENTATION[metric].label,
    measurement: formatMeasurement(measurement),
  } as const;
}
