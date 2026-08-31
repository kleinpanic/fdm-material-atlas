import * as z from "zod";

import {
  BasisRefSchema,
  claimSchema,
  type BasisRef,
  type Claim,
} from "./evidence.ts";
import { factStateSchema, NormalizedTextSchema } from "./fact-state.ts";
import { ClaimIdSchema, MaterialIdSchema } from "./ids.ts";
import {
  DensityMeasurementSchema,
  FanMeasurementSchema,
  SpeedMeasurementSchema,
  TemperatureMeasurementSchema,
} from "./measurements.ts";
import {
  ChemicalResistanceRatingSchema,
  CoolingFitGuidanceSchema,
  CoolingShrinkRiskSchema,
  CostTierSchema,
  CreepSustainedLoadRatingSchema,
  DimensionalStabilitySchema,
  DryingPrioritySchema,
  EnclosureRequirementSchema,
  FlexibilityRatingSchema,
  HardenedNozzleRequirementSchema,
  ImpactResistanceRatingSchema,
  MoistureSensitivitySchema,
  OutdoorUvRatingSchema,
  PrintDifficultySchema,
  VentilationCategorySchema,
  WarpTendencySchema,
  WearAbrasionRatingSchema,
} from "./vocabularies.ts";

const MATERIAL_SLUG_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

const TextListSchema = z
  .array(NormalizedTextSchema)
  .min(1, "TEXT_LIST_EMPTY")
  .max(50, "TEXT_LIST_EXCESSIVE");

/** Practical service guidance is a claim, not a standardized thermal test. */
export const ServiceTemperatureGuidanceSchema = claimSchema(TemperatureMeasurementSchema);

export const ThermalMetricKindSchema = z.enum([
  "glass-transition",
  "heat-deflection",
  "vicat-softening",
  "melting-point",
  "other",
]);

export const ThermalMethodSchema = z.strictObject({
  standard: NormalizedTextSchema.optional(),
  loadMpa: z
    .number()
    .refine(Number.isFinite, "NUMBER_NOT_FINITE")
    .positive("THERMAL_LOAD_INVALID")
    .max(1_000, "THERMAL_LOAD_INVALID")
    .optional(),
  annealed: z.boolean().optional(),
  conditioning: NormalizedTextSchema.optional(),
  otherConditions: NormalizedTextSchema.optional(),
});

/** A named observation preserves the test identity and its applicability state. */
export const ThermalObservationSchema = z.strictObject({
  id: ClaimIdSchema,
  metric: ThermalMetricKindSchema,
  metricLabel: NormalizedTextSchema,
  measurement: factStateSchema(TemperatureMeasurementSchema),
  method: ThermalMethodSchema.optional(),
  qualification: NormalizedTextSchema,
  basis: z.array(BasisRefSchema).min(1, "CLAIM_BASIS_REQUIRED"),
});

function startingProfileClaimSchema<T extends z.ZodType>(valueSchema: T) {
  return claimSchema(valueSchema).superRefine(({ basis }, context) => {
    basis.forEach((reference, index) => {
      if (reference.scope !== "starting-profile-guidance") {
        context.addIssue({
          code: "custom",
          path: ["basis", index, "scope"],
          message: "STARTING_PROFILE_BASIS_INVALID",
        });
      }
    });
  });
}

export const StartingProfileSchema = z.strictObject({
  interpretation: z.literal("calibration-starting-point"),
  printSpeed: startingProfileClaimSchema(SpeedMeasurementSchema),
  partCoolingFan: startingProfileClaimSchema(FanMeasurementSchema),
  bridgeSpeed: startingProfileClaimSchema(SpeedMeasurementSchema),
  bridgeFan: startingProfileClaimSchema(FanMeasurementSchema),
});

export const MaterialPropertiesSchema = z.strictObject({
  wearAbrasion: claimSchema(WearAbrasionRatingSchema),
  impactResistance: claimSchema(ImpactResistanceRatingSchema),
  creepSustainedLoad: claimSchema(CreepSustainedLoadRatingSchema),
  outdoorUv: claimSchema(OutdoorUvRatingSchema),
  moistureSensitivity: claimSchema(MoistureSensitivitySchema),
  warpTendency: claimSchema(WarpTendencySchema),
  flexibility: claimSchema(FlexibilityRatingSchema),
  chemicalResistance: claimSchema(ChemicalResistanceRatingSchema),
  density: claimSchema(DensityMeasurementSchema),
  coolingShrinkRisk: claimSchema(CoolingShrinkRiskSchema),
  dimensionalStability: claimSchema(DimensionalStabilitySchema),
});

export const MaterialProcessSchema = z.strictObject({
  printDifficulty: claimSchema(PrintDifficultySchema),
  nozzleTemperature: claimSchema(TemperatureMeasurementSchema),
  bedTemperature: claimSchema(TemperatureMeasurementSchema),
  enclosure: claimSchema(EnclosureRequirementSchema),
  hardenedNozzle: claimSchema(HardenedNozzleRequirementSchema),
  dryingPriority: claimSchema(DryingPrioritySchema),
  ventilation: claimSchema(VentilationCategorySchema),
});

export const MaterialGuidanceSchema = z.strictObject({
  bestSuitedFor: claimSchema(TextListSchema),
  tradeoffs: claimSchema(TextListSchema),
  coolingFit: claimSchema(CoolingFitGuidanceSchema),
});

export const MaterialSchema = z.strictObject({
  id: MaterialIdSchema,
  slug: z
    .string()
    .min(1, "SLUG_EMPTY")
    .max(120, "SLUG_TOO_LONG")
    .regex(MATERIAL_SLUG_PATTERN, "SLUG_INVALID"),
  displayOrder: z.number().int("DISPLAY_ORDER_INVALID").min(0).max(100_000),
  name: NormalizedTextSchema,
  familyOrFill: claimSchema(NormalizedTextSchema),
  serviceTemperature: ServiceTemperatureGuidanceSchema,
  thermalObservations: z.array(ThermalObservationSchema).max(100, "THERMAL_OBSERVATIONS_EXCESSIVE"),
  properties: MaterialPropertiesSchema,
  process: MaterialProcessSchema,
  guidance: MaterialGuidanceSchema,
  costTier: claimSchema(CostTierSchema),
  startingProfile: StartingProfileSchema,
});

/**
 * The reviewed 32-column comparison contract. Two service-range bounds and the
 * named metric/value pair remain separately addressable even though each pair
 * shares one typed canonical branch.
 */
export const MATERIAL_SEMANTIC_FIELDS = [
  { key: "material-name", path: "name" },
  { key: "family-or-fill", path: "familyOrFill" },
  { key: "service-temperature-low", path: "serviceTemperature.value.value.min" },
  { key: "service-temperature-high", path: "serviceTemperature.value.value.max" },
  { key: "thermal-metric", path: "thermalObservations[].metric" },
  { key: "thermal-value", path: "thermalObservations[].measurement" },
  { key: "wear-abrasion", path: "properties.wearAbrasion" },
  { key: "impact-resistance", path: "properties.impactResistance" },
  { key: "creep-sustained-load", path: "properties.creepSustainedLoad" },
  { key: "outdoor-uv", path: "properties.outdoorUv" },
  { key: "moisture-sensitivity", path: "properties.moistureSensitivity" },
  { key: "print-difficulty", path: "process.printDifficulty" },
  { key: "nozzle-temperature", path: "process.nozzleTemperature" },
  { key: "bed-temperature", path: "process.bedTemperature" },
  { key: "enclosure-requirement", path: "process.enclosure" },
  { key: "hardened-nozzle-requirement", path: "process.hardenedNozzle" },
  { key: "warp-tendency", path: "properties.warpTendency" },
  { key: "flexibility", path: "properties.flexibility" },
  { key: "chemical-resistance", path: "properties.chemicalResistance" },
  { key: "density", path: "properties.density" },
  { key: "recommended-uses", path: "guidance.bestSuitedFor" },
  { key: "tradeoffs", path: "guidance.tradeoffs" },
  { key: "cooling-shrink-risk", path: "properties.coolingShrinkRisk" },
  { key: "dimensional-stability", path: "properties.dimensionalStability" },
  { key: "cooling-fit-guidance", path: "guidance.coolingFit" },
  { key: "drying-priority", path: "process.dryingPriority" },
  { key: "ventilation-category", path: "process.ventilation" },
  { key: "relative-cost-tier", path: "costTier" },
  { key: "starting-print-speed", path: "startingProfile.printSpeed" },
  { key: "part-cooling-fan", path: "startingProfile.partCoolingFan" },
  { key: "bridge-speed", path: "startingProfile.bridgeSpeed" },
  { key: "bridge-fan", path: "startingProfile.bridgeFan" },
] as const;

export type ServiceTemperatureGuidance = z.infer<typeof ServiceTemperatureGuidanceSchema>;
export type ThermalMetricKind = z.infer<typeof ThermalMetricKindSchema>;
export type ThermalMethod = z.infer<typeof ThermalMethodSchema>;
export type ThermalObservation = z.infer<typeof ThermalObservationSchema>;
export type StartingProfile = z.infer<typeof StartingProfileSchema>;
export type MaterialProperties = z.infer<typeof MaterialPropertiesSchema>;
export type MaterialProcess = z.infer<typeof MaterialProcessSchema>;
export type MaterialGuidance = z.infer<typeof MaterialGuidanceSchema>;
export type Material = z.infer<typeof MaterialSchema>;

export type ThermalCompatibility =
  | { comparable: true }
  | { comparable: false; code: "THERMAL_NOT_COMPARABLE" };

const THERMAL_METHOD_DIMENSIONS = [
  "standard",
  "loadMpa",
  "annealed",
  "conditioning",
  "otherConditions",
] as const satisfies readonly (keyof ThermalMethod)[];

/** Do not compare unlike thermal tests merely because both values use Celsius. */
export function compareThermalObservations(
  left: ThermalObservation,
  right: ThermalObservation,
): ThermalCompatibility {
  if (left.metric !== right.metric) {
    return { comparable: false, code: "THERMAL_NOT_COMPARABLE" };
  }
  if (left.metric === "other" && left.metricLabel !== right.metricLabel) {
    return { comparable: false, code: "THERMAL_NOT_COMPARABLE" };
  }
  for (const dimension of THERMAL_METHOD_DIMENSIONS) {
    if (left.method?.[dimension] !== right.method?.[dimension]) {
      return { comparable: false, code: "THERMAL_NOT_COMPARABLE" };
    }
  }
  return { comparable: true };
}

// Compile-time checks keep the public claim types tied to the shared evidence contract.
type _ServiceTemperatureIsClaim = ServiceTemperatureGuidance extends Claim<z.infer<typeof TemperatureMeasurementSchema>>
  ? true
  : never;
type _ThermalBasisIsShared = ThermalObservation["basis"] extends BasisRef[] ? true : never;
const _serviceTemperatureIsClaim: _ServiceTemperatureIsClaim = true;
const _thermalBasisIsShared: _ThermalBasisIsShared = true;
void _serviceTemperatureIsClaim;
void _thermalBasisIsShared;

