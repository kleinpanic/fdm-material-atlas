/** Zod-free selector field vocabulary shared with the browser evaluator. */
export const selectorFieldValues = [
  "serviceTemperature.minimum",
  "serviceTemperature.maximum",
  "properties.wearAbrasion",
  "properties.wearAbrasion.order",
  "properties.impactResistance",
  "properties.impactResistance.order",
  "properties.creepSustainedLoad",
  "properties.creepSustainedLoad.order",
  "properties.outdoorUv",
  "properties.outdoorUv.order",
  "properties.moistureSensitivity",
  "properties.moistureSensitivity.order",
  "properties.warpTendency",
  "properties.warpTendency.order",
  "properties.flexibility",
  "properties.flexibility.order",
  "properties.chemicalResistance",
  "properties.chemicalResistance.order",
  "properties.coolingShrinkRisk",
  "properties.coolingShrinkRisk.order",
  "properties.dimensionalStability",
  "properties.dimensionalStability.order",
  "process.printDifficulty",
  "process.printDifficulty.order",
  "process.enclosure",
  "process.enclosure.order",
  "process.hardenedNozzle",
  "process.hardenedNozzle.order",
  "process.dryingPriority",
  "process.dryingPriority.order",
  "process.ventilation",
  "process.ventilation.order",
  "costTier",
  "costTier.order",
  "guidance.bestSuitedFor",
  "guidance.tradeoffs",
] as const;

export type SelectorFieldValue = (typeof selectorFieldValues)[number];

const selectorFieldSet = new Set<string>(selectorFieldValues);

export function isSelectorFieldValue(value: unknown): value is SelectorFieldValue {
  return typeof value === "string" && selectorFieldSet.has(value);
}
