import type { EvidenceScope } from "../../data/schema/evidence.ts";
import { MaterialIdSchema, type ClaimId, type MaterialId } from "../../data/schema/ids.ts";
import {
  compareThermalObservations,
  ThermalObservationSchema,
  type ThermalMetricKind,
  type ThermalMethod,
  type ThermalObservation,
} from "../../data/schema/material.ts";

export type ThermalPartitionInput = {
  readonly materialId: MaterialId;
  readonly observation: ThermalObservation;
};

export type PartitionedThermalObservation = {
  readonly id: ClaimId;
  readonly metric: ThermalMetricKind;
  readonly metricLabel: string;
  readonly measurement: ThermalObservation["measurement"];
  readonly method?: Readonly<ThermalMethod>;
  readonly qualification: string;
  readonly basisScopes: readonly EvidenceScope[];
};

export type ThermalPartitionMember = {
  readonly materialId: MaterialId;
  readonly observation: PartitionedThermalObservation;
};

export type ThermalCompatibilityGroup = {
  readonly id: `thermal-group-${string}`;
  readonly metric: ThermalMetricKind;
  readonly metricLabel: string;
  readonly method?: Readonly<ThermalMethod>;
  readonly members: readonly ThermalPartitionMember[];
};

type ThermalPartitionErrorCode =
  "THERMAL_PARTITION_INPUT_INVALID" | "THERMAL_PARTITION_DUPLICATE_OBSERVATION";

function fail(code: ThermalPartitionErrorCode): never {
  throw new Error(code);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function memberKey(materialId: MaterialId, observationId: ClaimId): string {
  return `${materialId}\u0000${observationId}`;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function publicObservation(observation: ThermalObservation): PartitionedThermalObservation {
  const basisScopes = [...new Set(observation.basis.map(({ scope }) => scope))].sort(compareText);
  return {
    id: observation.id,
    metric: observation.metric,
    metricLabel: observation.metricLabel,
    measurement: structuredClone(observation.measurement),
    ...(observation.method === undefined ? {} : { method: { ...observation.method } }),
    qualification: observation.qualification,
    basisScopes,
  };
}

/**
 * Partition named thermal observations through the canonical scientific comparator.
 * Group membership never depends on labels, units, values, or source identity.
 */
export function partitionCompatibleThermalObservations(
  inputs: readonly ThermalPartitionInput[],
): readonly ThermalCompatibilityGroup[] {
  const normalized = inputs
    .map((input) => {
      const material = MaterialIdSchema.safeParse(input.materialId);
      const observation = ThermalObservationSchema.safeParse(input.observation);
      if (!material.success || !observation.success) return fail("THERMAL_PARTITION_INPUT_INVALID");
      return { materialId: material.data, observation: observation.data };
    })
    .sort((left, right) =>
      compareText(
        memberKey(left.materialId, left.observation.id),
        memberKey(right.materialId, right.observation.id),
      ),
    );

  const keys = normalized.map(({ materialId, observation }) =>
    memberKey(materialId, observation.id),
  );
  if (new Set(keys).size !== keys.length) fail("THERMAL_PARTITION_DUPLICATE_OBSERVATION");

  const partitions: { representative: ThermalObservation; members: typeof normalized }[] = [];
  for (const input of normalized) {
    const group = partitions.find(
      ({ representative }) =>
        compareThermalObservations(representative, input.observation).comparable,
    );
    if (group === undefined) {
      partitions.push({ representative: input.observation, members: [input] });
    } else {
      group.members.push(input);
    }
  }

  const groups = partitions.map(
    ({ representative, members }, index): ThermalCompatibilityGroup => ({
      id: `thermal-group-${String(index + 1).padStart(3, "0")}`,
      metric: representative.metric,
      metricLabel: representative.metricLabel,
      ...(representative.method === undefined ? {} : { method: { ...representative.method } }),
      members: members.map(({ materialId, observation }) => ({
        materialId,
        observation: publicObservation(observation),
      })),
    }),
  );

  return deepFreeze(groups);
}
