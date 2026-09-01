import type { AtlasV1 } from "../../data/schema/atlas.ts";
import type { EvidenceScope } from "../../data/schema/evidence.ts";
import type { FactState } from "../../data/schema/fact-state.ts";
import type { ClaimId, DecisionLaneId, MaterialId } from "../../data/schema/ids.ts";
import type { ThermalMethod, ThermalMetricKind } from "../../data/schema/material.ts";
import { deriveDecisionLaneMembership } from "../../domain/decision-lanes/membership.ts";
import {
  EVIDENCE_SCOPE_ORDER,
  projectFactState,
  type DisplayFact,
} from "../../lib/presentation/labels.ts";
import { internalFragmentHref, internalHref } from "../../lib/routes.ts";
import {
  PUBLIC_ROUTE_REGISTRY,
  buildSelectorRouteAvailability,
  type CompareRouteAvailability,
  type PublicRouteRegistry,
  type RouteAction,
} from "../../lib/public-route-registry.ts";
import {
  enumerateMaterialClaims,
  type EnumeratedMaterialClaim,
  type MaterialClaimGroup,
  type MaterialSemanticKey,
} from "./claim-registry.ts";
import {
  buildEvidenceIndex,
  buildMaterialEvidenceModel,
  type EvidenceTarget,
  type PublicEvidenceRecord,
} from "./evidence-model.ts";

export type MaterialDetailClaim = {
  readonly kind: EnumeratedMaterialClaim["kind"];
  readonly claimId: ClaimId;
  readonly descriptorKey: string;
  readonly anchor: string;
  readonly label: string;
  readonly group: MaterialClaimGroup;
  readonly displayOrder: number;
  readonly semanticKeys: readonly MaterialSemanticKey[];
  readonly fact: DisplayFact<unknown>;
  readonly qualification?: string | undefined;
  readonly scopes: readonly EvidenceScope[];
  readonly evidence: readonly {
    readonly target: EvidenceTarget;
    readonly scope: EvidenceScope;
    readonly label: string;
    readonly href: string;
  }[];
};

export type MaterialThermalObservationDetail = MaterialDetailClaim & {
  readonly kind: "named-thermal-observation";
  readonly metric: ThermalMetricKind;
  readonly metricLabel: string;
  readonly method?: ThermalMethod | undefined;
};

export type MaterialDetailModel = {
  readonly id: MaterialId;
  readonly slug: string;
  readonly displayOrder: number;
  readonly name: string;
  readonly href: string;
  readonly claims: readonly MaterialDetailClaim[];
  readonly overview: {
    readonly familyOrFill: MaterialDetailClaim;
    readonly serviceGuidance: MaterialDetailClaim;
    readonly namedThermalObservationCount: number;
    readonly printDifficulty: MaterialDetailClaim;
    readonly density: MaterialDetailClaim;
    readonly costTier: MaterialDetailClaim;
  };
  readonly thermal: {
    readonly notice: string;
    readonly serviceGuidance: MaterialDetailClaim;
    readonly namedObservations: readonly MaterialThermalObservationDetail[];
  };
  readonly properties: readonly MaterialDetailClaim[];
  readonly process: readonly MaterialDetailClaim[];
  readonly usesTradeoffs: {
    readonly recommendedUses: MaterialDetailClaim;
    readonly tradeoffs: MaterialDetailClaim;
    readonly coolingFit: MaterialDetailClaim;
  };
  readonly startingProfile: {
    readonly interpretation: "calibration-starting-point";
    readonly label: "Calibration starting point";
    readonly cautionBefore: string;
    readonly cautionAfter: string;
    readonly settings: readonly MaterialDetailClaim[];
  };
  readonly evidence: {
    readonly edgeCount: number;
    readonly scopes: readonly EvidenceScope[];
    readonly records: readonly {
      readonly record: PublicEvidenceRecord;
      readonly href: string;
      readonly scopes: readonly EvidenceScope[];
      readonly supportedClaims: readonly {
        readonly claimId: ClaimId;
        readonly claimAnchor: string;
        readonly label: string;
        readonly href: string;
      }[];
    }[];
  };
  readonly limitations: readonly string[];
  readonly continuity: {
    readonly currentMaterialId: MaterialId;
    readonly compare: CompareRouteAvailability;
    readonly relatedMaterials: readonly {
      readonly id: MaterialId;
      readonly slug: string;
      readonly name: string;
      readonly state: "candidate" | "indeterminate";
      readonly details: RouteAction;
      readonly sharedLanes: readonly {
        readonly id: DecisionLaneId;
        readonly label: string;
        readonly currentState: "candidate" | "indeterminate";
        readonly relatedState: "candidate" | "indeterminate";
      }[];
    }[];
  };
  readonly relationships: readonly {
    readonly laneId: DecisionLaneId;
    readonly label: string;
    readonly state: "candidate" | "indeterminate";
    readonly processGateIds: readonly string[];
    readonly visualizationIds: readonly string[];
    readonly action: RouteAction;
  }[];
};

const THERMAL_NOTICE =
  "Thermal values answer different questions. Practical service guidance, Tg, HDT, Vicat softening, melting point, and other named tests are not directly interchangeable.";
const PROFILE_BEFORE =
  "These values are calibration starting points. They are not guaranteed settings, maxima, manufacturer specifications, or proof that a print is safe.";
const PROFILE_AFTER =
  "Tune for the exact filament, printer, nozzle, geometry, moisture condition, chamber, cooling, and required part performance.";
const LIMITATIONS = [
  "Exact filament formulations differ. Check the relevant product TDS and SDS before use.",
  "Geometry, moisture, load, print orientation, annealing, chamber conditions, cooling, and process history can change printed-part behavior.",
  "Qualitative ratings and representative values are guidance, not universal polymer-family specifications.",
  "Starting-profile values are calibration starting points, not guaranteed settings or maxima.",
  "This material-selection information is not an engineering safety certification.",
] as const;

function fail(
  code: "DETAIL_CLAIM_MISSING" | "DETAIL_CLAIM_DUPLICATE" | "DETAIL_MATERIAL_DUPLICATE",
): never {
  throw new Error(code);
}

function compareMaterial(
  left: AtlasV1["materials"][number],
  right: AtlasV1["materials"][number],
): number {
  return left.displayOrder - right.displayOrder || left.id.localeCompare(right.id, "en");
}

function scopeOrder(left: EvidenceScope, right: EvidenceScope): number {
  return EVIDENCE_SCOPE_ORDER.indexOf(left) - EVIDENCE_SCOPE_ORDER.indexOf(right);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function recordId(target: EvidenceTarget): string {
  return target.kind === "source" ? target.sourceId : target.methodId;
}

/** Compile all material references entirely at build time. */
export function buildMaterialDetailModels(
  atlas: AtlasV1,
  base: string | undefined,
  registry: PublicRouteRegistry = PUBLIC_ROUTE_REGISTRY,
): readonly MaterialDetailModel[] {
  const evidenceIndex = buildEvidenceIndex(atlas);
  const relationships = deriveDecisionLaneMembership(atlas);
  const ids = new Set(atlas.materials.map(({ id }) => id));
  const slugs = new Set(atlas.materials.map(({ slug }) => slug));
  if (ids.size !== atlas.materials.length || slugs.size !== atlas.materials.length) {
    fail("DETAIL_MATERIAL_DUPLICATE");
  }
  const relationshipIdsByMaterial = new Map(
    atlas.materials.map(({ id }) => [
      id,
      relationships
        .filter(
          (lane) =>
            lane.candidateMaterialIds.includes(id) || lane.indeterminateMaterialIds.includes(id),
        )
        .map(({ id: laneId }) => laneId),
    ]),
  );
  const routeAvailability = buildSelectorRouteAvailability(base, registry, {
    materials: atlas.materials.map(({ id, slug }) => ({
      id,
      slug,
      decisionMapLaneIds: relationshipIdsByMaterial.get(id) ?? [],
    })),
    lanes: relationships.map(({ id, label }) => ({ id, label })),
  });
  const routeByMaterialId = new Map(
    routeAvailability.materials.map((route) => [route.materialId, route]),
  );
  const routeByLaneId = new Map(
    routeAvailability.decisionMaps.map(({ laneId, action }) => [laneId, action]),
  );
  const unavailableDecisionMap = Object.freeze({
    kind: "unavailable" as const,
    label: "Decision map is not available yet",
  });
  const materialById = new Map(atlas.materials.map((material) => [material.id, material]));
  const laneOrder = new Map(relationships.map(({ id }, index) => [id, index]));

  const models = [...atlas.materials].sort(compareMaterial).map((material) => {
    const materialEvidence = buildMaterialEvidenceModel(atlas, material, evidenceIndex);
    const evidenceRecordById = new Map(
      materialEvidence.records.map((record) => [recordId(record.target), record]),
    );
    const enumerated = enumerateMaterialClaims(material);
    const claimIds = new Set(enumerated.map(({ claimId }) => claimId));
    if (claimIds.size !== enumerated.length) fail("DETAIL_CLAIM_DUPLICATE");

    const claims = enumerated.map((claim): MaterialDetailClaim => {
      const edges = materialEvidence.records.flatMap(({ edges }) =>
        edges.filter(({ claimId }) => claimId === claim.claimId),
      );
      const evidence = edges.map(({ target, scope }) => {
        const record = evidenceRecordById.get(recordId(target));
        if (!record) return fail("DETAIL_CLAIM_MISSING");
        return {
          target,
          scope,
          label: record.record.label,
          href: internalFragmentHref(base, { id: "method" }, recordId(target)),
        };
      });
      return {
        kind: claim.kind,
        claimId: claim.claimId,
        descriptorKey: claim.descriptorKey,
        anchor: claim.anchor,
        label: claim.label,
        group: claim.group,
        displayOrder: claim.displayOrder,
        semanticKeys: claim.semanticKeys,
        fact: projectFactState(claim.fact as FactState<unknown>),
        ...(claim.qualification === undefined ? {} : { qualification: claim.qualification }),
        scopes: [...new Set(edges.map(({ scope }) => scope))].sort(scopeOrder),
        evidence,
      };
    });
    const one = (key: string): MaterialDetailClaim => {
      const matches = claims.filter(({ descriptorKey }) => descriptorKey === key);
      if (matches.length !== 1) return fail("DETAIL_CLAIM_MISSING");
      return matches[0]!;
    };
    const namedObservations = enumerated
      .filter(
        (claim): claim is Extract<EnumeratedMaterialClaim, { kind: "named-thermal-observation" }> =>
          claim.kind === "named-thermal-observation",
      )
      .map((claim): MaterialThermalObservationDetail => {
        const detail = claims.find(({ claimId }) => claimId === claim.claimId);
        if (!detail) return fail("DETAIL_CLAIM_MISSING");
        return {
          ...detail,
          kind: "named-thermal-observation",
          metric: claim.observation.metric,
          metricLabel: claim.observation.metricLabel,
          ...(claim.observation.method === undefined
            ? {}
            : { method: { ...claim.observation.method } }),
        };
      });
    const evidenceRecords = materialEvidence.records.map((record) => ({
      record: record.record,
      href: internalFragmentHref(base, { id: "method" }, recordId(record.target)),
      scopes: record.scopes,
      supportedClaims: record.supportedClaims.map((claim) => ({
        claimId: claim.claimId,
        claimAnchor: claim.claimAnchor,
        label: claim.label,
        href: internalFragmentHref(
          base,
          { id: "material", slug: material.slug },
          claim.claimAnchor,
        ),
      })),
    }));
    const materialRelationships = relationships.flatMap((lane) => {
      const state = lane.candidateMaterialIds.includes(material.id)
        ? ("candidate" as const)
        : lane.indeterminateMaterialIds.includes(material.id)
          ? ("indeterminate" as const)
          : undefined;
      return state === undefined
        ? []
        : [
            {
              laneId: lane.id,
              label: lane.label,
              state,
              processGateIds: lane.processGates.map(({ id }) => id),
              visualizationIds: lane.visualizations.map(({ id }) => id),
              action: routeByLaneId.get(lane.id) ?? unavailableDecisionMap,
            },
          ];
    });
    const relatedById = new Map<
      MaterialId,
      {
        id: MaterialId;
        slug: string;
        name: string;
        state: "candidate" | "indeterminate";
        details: RouteAction;
        sharedLanes: {
          id: DecisionLaneId;
          label: string;
          currentState: "candidate" | "indeterminate";
          relatedState: "candidate" | "indeterminate";
        }[];
      }
    >();
    for (const lane of relationships) {
      const currentState = lane.candidateMaterialIds.includes(material.id)
        ? ("candidate" as const)
        : lane.indeterminateMaterialIds.includes(material.id)
          ? ("indeterminate" as const)
          : undefined;
      if (currentState === undefined) continue;
      for (const relatedState of ["candidate", "indeterminate"] as const) {
        const relatedIds =
          relatedState === "candidate" ? lane.candidateMaterialIds : lane.indeterminateMaterialIds;
        for (const relatedId of relatedIds) {
          if (relatedId === material.id) continue;
          const relatedMaterial = materialById.get(relatedId);
          const route = routeByMaterialId.get(relatedId);
          if (!relatedMaterial || !route) return fail("DETAIL_CLAIM_MISSING");
          const existing = relatedById.get(relatedId);
          if (existing) {
            if (!existing.sharedLanes.some(({ id }) => id === lane.id)) {
              existing.sharedLanes.push({
                id: lane.id,
                label: lane.label,
                currentState,
                relatedState,
              });
            }
          } else {
            relatedById.set(relatedId, {
              id: relatedId,
              slug: relatedMaterial.slug,
              name: relatedMaterial.name,
              state:
                currentState === "candidate" && relatedState === "candidate"
                  ? "candidate"
                  : "indeterminate",
              details: route.details,
              sharedLanes: [{ id: lane.id, label: lane.label, currentState, relatedState }],
            });
          }
        }
      }
    }
    const relatedMaterials = [...relatedById.values()]
      .map((related) => ({
        ...related,
        state: related.sharedLanes.every(
          ({ currentState, relatedState }) =>
            currentState === "candidate" && relatedState === "candidate",
        )
          ? ("candidate" as const)
          : ("indeterminate" as const),
        sharedLanes: related.sharedLanes.sort(
          (left, right) =>
            (laneOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
            (laneOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER),
        ),
      }))
      .sort(
        (left, right) =>
          (left.state === "candidate" ? 0 : 1) - (right.state === "candidate" ? 0 : 1) ||
          (laneOrder.get(left.sharedLanes[0]!.id) ?? Number.MAX_SAFE_INTEGER) -
            (laneOrder.get(right.sharedLanes[0]!.id) ?? Number.MAX_SAFE_INTEGER) ||
          (materialById.get(left.id)?.displayOrder ?? Number.MAX_SAFE_INTEGER) -
            (materialById.get(right.id)?.displayOrder ?? Number.MAX_SAFE_INTEGER) ||
          left.id.localeCompare(right.id, "en"),
      );
    const serviceGuidance = one("service-temperature");
    const profileSettings = claims.filter(({ group }) => group === "profile");
    if (profileSettings.length !== 4) fail("DETAIL_CLAIM_MISSING");
    return {
      id: material.id,
      slug: material.slug,
      displayOrder: material.displayOrder,
      name: material.name,
      href: internalHref(base, { id: "material", slug: material.slug }),
      claims,
      overview: {
        familyOrFill: one("family-or-fill"),
        serviceGuidance,
        namedThermalObservationCount: namedObservations.length,
        printDifficulty: one("print-difficulty"),
        density: one("density"),
        costTier: one("relative-cost-tier"),
      },
      thermal: { notice: THERMAL_NOTICE, serviceGuidance, namedObservations },
      properties: claims.filter(({ group }) =>
        ["mechanical", "environment", "outcome"].includes(group),
      ),
      process: claims.filter(({ group }) => group === "process"),
      usesTradeoffs: {
        recommendedUses: one("recommended-uses"),
        tradeoffs: one("tradeoffs"),
        coolingFit: one("cooling-fit-guidance"),
      },
      startingProfile: {
        interpretation: material.startingProfile.interpretation,
        label: "Calibration starting point",
        cautionBefore: PROFILE_BEFORE,
        cautionAfter: PROFILE_AFTER,
        settings: profileSettings,
      },
      evidence: {
        edgeCount: materialEvidence.edgeCount,
        scopes: materialEvidence.scopes,
        records: evidenceRecords,
      },
      limitations: [...LIMITATIONS],
      continuity: {
        currentMaterialId: material.id,
        compare: routeAvailability.compare,
        relatedMaterials,
      },
      relationships: materialRelationships,
    } satisfies MaterialDetailModel;
  });

  return deepFreeze(models);
}
