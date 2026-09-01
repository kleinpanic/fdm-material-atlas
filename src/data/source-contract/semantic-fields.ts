import * as z from "zod";

/** The reviewed public meaning of all 32 material comparison attributes. */
export const MATERIAL_SEMANTIC_FIELDS = [
  "name",
  "familyOrFill",
  "serviceTemperature.minimum",
  "serviceTemperature.maximum",
  "thermalObservations.metric",
  "thermalObservations.measurement",
  "properties.wearAbrasion",
  "properties.impactResistance",
  "properties.creepSustainedLoad",
  "properties.outdoorUv",
  "properties.moistureSensitivity",
  "process.printDifficulty",
  "process.nozzleTemperature",
  "process.bedTemperature",
  "process.enclosure",
  "process.hardenedNozzle",
  "properties.warpTendency",
  "properties.flexibility",
  "properties.chemicalResistance",
  "properties.density",
  "guidance.bestSuitedFor",
  "guidance.tradeoffs",
  "properties.coolingShrinkRisk",
  "properties.dimensionalStability",
  "guidance.coolingFit",
  "process.dryingPriority",
  "process.ventilation",
  "costTier",
  "startingProfile.printSpeed",
  "startingProfile.partCoolingFan",
  "startingProfile.bridgeSpeed",
  "startingProfile.bridgeFan",
] as const;

export const MaterialSemanticFieldPathSchema = z.enum(MATERIAL_SEMANTIC_FIELDS);
export type MaterialSemanticFieldPath = z.infer<typeof MaterialSemanticFieldPathSchema>;
