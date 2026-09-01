import type { BasisRef, Claim } from "../../data/schema/evidence.ts";
import type { FactState } from "../../data/schema/fact-state.ts";
import type { ClaimId } from "../../data/schema/ids.ts";
import type { Material, ThermalObservation } from "../../data/schema/material.ts";

export type MaterialSemanticKey =
  | "material-name"
  | "family-or-fill"
  | "service-temperature-low"
  | "service-temperature-high"
  | "thermal-metric"
  | "thermal-value"
  | "wear-abrasion"
  | "impact-resistance"
  | "creep-sustained-load"
  | "outdoor-uv"
  | "moisture-sensitivity"
  | "print-difficulty"
  | "nozzle-temperature"
  | "bed-temperature"
  | "enclosure-requirement"
  | "hardened-nozzle-requirement"
  | "warp-tendency"
  | "flexibility"
  | "chemical-resistance"
  | "density"
  | "recommended-uses"
  | "tradeoffs"
  | "cooling-shrink-risk"
  | "dimensional-stability"
  | "cooling-fit-guidance"
  | "drying-priority"
  | "ventilation-category"
  | "relative-cost-tier"
  | "starting-print-speed"
  | "part-cooling-fan"
  | "bridge-speed"
  | "bridge-fan";

export type MaterialClaimGroup =
  | "identity"
  | "thermal"
  | "mechanical"
  | "environment"
  | "outcome"
  | "process"
  | "guidance"
  | "profile";

type DescriptorBase = {
  readonly key: string;
  readonly label: string;
  readonly group: MaterialClaimGroup;
  readonly displayOrder: number;
  readonly semanticKeys: readonly MaterialSemanticKey[];
};

export type MaterialIdentityDescriptor = DescriptorBase & {
  readonly kind: "identity";
  readonly read: (material: Material) => string;
};

export type MaterialScalarClaimDescriptor = DescriptorBase & {
  readonly kind: "claim" | "service-guidance" | "starting-profile";
  readonly read: (material: Material) => Claim<unknown>;
};

export type MaterialThermalClaimDescriptor = DescriptorBase & {
  readonly kind: "named-thermal-observation";
  readonly readMany: (material: Material) => readonly ThermalObservation[];
};

export type MaterialClaimDescriptor =
  MaterialIdentityDescriptor | MaterialScalarClaimDescriptor | MaterialThermalClaimDescriptor;

const descriptor = <T extends MaterialClaimDescriptor>(value: T): T => value;

/**
 * The sole typed inventory of the reviewed material-comparison contract.
 *
 * Accessors are deliberately direct. The legacy semantic-field path strings
 * remain documentation and are never interpreted at runtime.
 */
export const MATERIAL_CLAIM_REGISTRY = [
  descriptor({
    kind: "identity",
    key: "material-name",
    label: "Material name",
    group: "identity",
    displayOrder: 0,
    semanticKeys: ["material-name"],
    read: (material) => material.name,
  }),
  descriptor({
    kind: "claim",
    key: "family-or-fill",
    label: "Family or filler",
    group: "identity",
    displayOrder: 1,
    semanticKeys: ["family-or-fill"],
    read: (material) => material.familyOrFill,
  }),
  descriptor({
    kind: "service-guidance",
    key: "service-temperature",
    label: "Practical service guidance",
    group: "thermal",
    displayOrder: 2,
    semanticKeys: ["service-temperature-low", "service-temperature-high"],
    read: (material) => material.serviceTemperature,
  }),
  descriptor({
    kind: "named-thermal-observation",
    key: "named-thermal-observation",
    label: "Named thermal observation",
    group: "thermal",
    displayOrder: 3,
    semanticKeys: ["thermal-metric", "thermal-value"],
    readMany: (material) => material.thermalObservations,
  }),
  descriptor({
    kind: "claim",
    key: "wear-abrasion",
    label: "Wear and abrasion",
    group: "mechanical",
    displayOrder: 4,
    semanticKeys: ["wear-abrasion"],
    read: (material) => material.properties.wearAbrasion,
  }),
  descriptor({
    kind: "claim",
    key: "impact-resistance",
    label: "Impact resistance",
    group: "mechanical",
    displayOrder: 5,
    semanticKeys: ["impact-resistance"],
    read: (material) => material.properties.impactResistance,
  }),
  descriptor({
    kind: "claim",
    key: "creep-sustained-load",
    label: "Creep and sustained load",
    group: "mechanical",
    displayOrder: 6,
    semanticKeys: ["creep-sustained-load"],
    read: (material) => material.properties.creepSustainedLoad,
  }),
  descriptor({
    kind: "claim",
    key: "outdoor-uv",
    label: "Outdoor and UV behavior",
    group: "environment",
    displayOrder: 7,
    semanticKeys: ["outdoor-uv"],
    read: (material) => material.properties.outdoorUv,
  }),
  descriptor({
    kind: "claim",
    key: "moisture-sensitivity",
    label: "Moisture sensitivity",
    group: "environment",
    displayOrder: 8,
    semanticKeys: ["moisture-sensitivity"],
    read: (material) => material.properties.moistureSensitivity,
  }),
  descriptor({
    kind: "claim",
    key: "print-difficulty",
    label: "Print difficulty",
    group: "process",
    displayOrder: 9,
    semanticKeys: ["print-difficulty"],
    read: (material) => material.process.printDifficulty,
  }),
  descriptor({
    kind: "claim",
    key: "nozzle-temperature",
    label: "Nozzle temperature",
    group: "process",
    displayOrder: 10,
    semanticKeys: ["nozzle-temperature"],
    read: (material) => material.process.nozzleTemperature,
  }),
  descriptor({
    kind: "claim",
    key: "bed-temperature",
    label: "Bed temperature",
    group: "process",
    displayOrder: 11,
    semanticKeys: ["bed-temperature"],
    read: (material) => material.process.bedTemperature,
  }),
  descriptor({
    kind: "claim",
    key: "enclosure-requirement",
    label: "Enclosure requirement",
    group: "process",
    displayOrder: 12,
    semanticKeys: ["enclosure-requirement"],
    read: (material) => material.process.enclosure,
  }),
  descriptor({
    kind: "claim",
    key: "hardened-nozzle-requirement",
    label: "Wear-resistant nozzle requirement",
    group: "process",
    displayOrder: 13,
    semanticKeys: ["hardened-nozzle-requirement"],
    read: (material) => material.process.hardenedNozzle,
  }),
  descriptor({
    kind: "claim",
    key: "warp-tendency",
    label: "Warp tendency",
    group: "outcome",
    displayOrder: 14,
    semanticKeys: ["warp-tendency"],
    read: (material) => material.properties.warpTendency,
  }),
  descriptor({
    kind: "claim",
    key: "flexibility",
    label: "Flexibility",
    group: "mechanical",
    displayOrder: 15,
    semanticKeys: ["flexibility"],
    read: (material) => material.properties.flexibility,
  }),
  descriptor({
    kind: "claim",
    key: "chemical-resistance",
    label: "Chemical resistance",
    group: "environment",
    displayOrder: 16,
    semanticKeys: ["chemical-resistance"],
    read: (material) => material.properties.chemicalResistance,
  }),
  descriptor({
    kind: "claim",
    key: "density",
    label: "Density",
    group: "mechanical",
    displayOrder: 17,
    semanticKeys: ["density"],
    read: (material) => material.properties.density,
  }),
  descriptor({
    kind: "claim",
    key: "recommended-uses",
    label: "Recommended uses",
    group: "guidance",
    displayOrder: 18,
    semanticKeys: ["recommended-uses"],
    read: (material) => material.guidance.bestSuitedFor,
  }),
  descriptor({
    kind: "claim",
    key: "tradeoffs",
    label: "Tradeoffs",
    group: "guidance",
    displayOrder: 19,
    semanticKeys: ["tradeoffs"],
    read: (material) => material.guidance.tradeoffs,
  }),
  descriptor({
    kind: "claim",
    key: "cooling-shrink-risk",
    label: "Cooling and shrink risk",
    group: "outcome",
    displayOrder: 20,
    semanticKeys: ["cooling-shrink-risk"],
    read: (material) => material.properties.coolingShrinkRisk,
  }),
  descriptor({
    kind: "claim",
    key: "dimensional-stability",
    label: "Dimensional stability",
    group: "outcome",
    displayOrder: 21,
    semanticKeys: ["dimensional-stability"],
    read: (material) => material.properties.dimensionalStability,
  }),
  descriptor({
    kind: "claim",
    key: "cooling-fit-guidance",
    label: "Cooling and fit guidance",
    group: "guidance",
    displayOrder: 22,
    semanticKeys: ["cooling-fit-guidance"],
    read: (material) => material.guidance.coolingFit,
  }),
  descriptor({
    kind: "claim",
    key: "drying-priority",
    label: "Drying priority",
    group: "process",
    displayOrder: 23,
    semanticKeys: ["drying-priority"],
    read: (material) => material.process.dryingPriority,
  }),
  descriptor({
    kind: "claim",
    key: "ventilation-category",
    label: "Ventilation category",
    group: "process",
    displayOrder: 24,
    semanticKeys: ["ventilation-category"],
    read: (material) => material.process.ventilation,
  }),
  descriptor({
    kind: "claim",
    key: "relative-cost-tier",
    label: "Relative cost tier",
    group: "identity",
    displayOrder: 25,
    semanticKeys: ["relative-cost-tier"],
    read: (material) => material.costTier,
  }),
  descriptor({
    kind: "starting-profile",
    key: "starting-print-speed",
    label: "Starting print speed",
    group: "profile",
    displayOrder: 26,
    semanticKeys: ["starting-print-speed"],
    read: (material) => material.startingProfile.printSpeed,
  }),
  descriptor({
    kind: "starting-profile",
    key: "part-cooling-fan",
    label: "Part-cooling fan",
    group: "profile",
    displayOrder: 27,
    semanticKeys: ["part-cooling-fan"],
    read: (material) => material.startingProfile.partCoolingFan,
  }),
  descriptor({
    kind: "starting-profile",
    key: "bridge-speed",
    label: "Bridge speed",
    group: "profile",
    displayOrder: 28,
    semanticKeys: ["bridge-speed"],
    read: (material) => material.startingProfile.bridgeSpeed,
  }),
  descriptor({
    kind: "starting-profile",
    key: "bridge-fan",
    label: "Bridge fan",
    group: "profile",
    displayOrder: 29,
    semanticKeys: ["bridge-fan"],
    read: (material) => material.startingProfile.bridgeFan,
  }),
] as const satisfies readonly MaterialClaimDescriptor[];

type EnumeratedBase = {
  readonly claimId: ClaimId;
  readonly descriptorKey: string;
  readonly anchor: string;
  readonly label: string;
  readonly group: Exclude<MaterialClaimGroup, "identity"> | "identity";
  readonly displayOrder: number;
  readonly semanticKeys: readonly MaterialSemanticKey[];
  readonly fact: FactState<unknown>;
  readonly qualification?: string | undefined;
  readonly basis: readonly BasisRef[];
};

export type EnumeratedMaterialClaim =
  | (EnumeratedBase & {
      readonly kind: "claim" | "service-guidance" | "starting-profile";
      readonly claim: Claim<unknown>;
    })
  | (EnumeratedBase & {
      readonly kind: "named-thermal-observation";
      readonly observation: ThermalObservation;
    });

function scalarAnchor(key: string): string {
  return `claim-${key}`;
}

function observationAnchor(claimId: ClaimId): string {
  return `claim-named-thermal-observation-${claimId}`;
}

/** Enumerate claims in descriptor order and thermal observations by stable ID. */
export function enumerateMaterialClaims(material: Material): readonly EnumeratedMaterialClaim[] {
  const claims: EnumeratedMaterialClaim[] = [];

  for (const entry of MATERIAL_CLAIM_REGISTRY) {
    if (entry.kind === "identity") continue;
    if (entry.kind === "named-thermal-observation") {
      const observations = [...entry.readMany(material)].sort((left, right) =>
        left.id.localeCompare(right.id, "en"),
      );
      observations.forEach((observation, index) => {
        claims.push({
          kind: entry.kind,
          claimId: observation.id,
          descriptorKey: entry.key,
          anchor: observationAnchor(observation.id),
          label: observation.metricLabel,
          group: entry.group,
          displayOrder: entry.displayOrder * 1_000 + index,
          semanticKeys: entry.semanticKeys,
          fact: observation.measurement,
          qualification: observation.qualification,
          basis: observation.basis,
          observation,
        });
      });
      continue;
    }

    const claim = entry.read(material);
    claims.push({
      kind: entry.kind,
      claimId: claim.id,
      descriptorKey: entry.key,
      anchor: scalarAnchor(entry.key),
      label: entry.label,
      group: entry.group,
      displayOrder: entry.displayOrder * 1_000,
      semanticKeys: entry.semanticKeys,
      fact: claim.value,
      ...(claim.qualification === undefined ? {} : { qualification: claim.qualification }),
      basis: claim.basis,
      claim,
    });
  }

  return claims;
}
