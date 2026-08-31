import type { AtlasV1 } from "../../data/schema/atlas.ts";
import {
  PublicHttpsUrlSchema,
  type EvidenceScope,
  type EvidenceSource,
  type MethodRecord,
} from "../../data/schema/evidence.ts";
import type { ClaimId, MaterialId, MethodId, SourceId } from "../../data/schema/ids.ts";
import type { Material } from "../../data/schema/material.ts";
import {
  EVIDENCE_SCOPE_ORDER,
  SOURCE_KIND_PRESENTATION,
} from "../../lib/presentation/labels.ts";
import {
  enumerateMaterialClaims,
  type EnumeratedMaterialClaim,
  type MaterialClaimGroup,
} from "./claim-registry.ts";

export type EvidenceTarget =
  | { readonly kind: "source"; readonly sourceId: SourceId }
  | { readonly kind: "method"; readonly methodId: MethodId };

export type PublicEvidenceRecord =
  | {
      readonly kind: "source";
      readonly id: SourceId;
      readonly label: string;
      readonly publisher: string;
      readonly sourceKind: EvidenceSource["kind"];
      readonly sourceKindLabel: string;
      readonly externalUrl: string;
    }
  | {
      readonly kind: "method";
      readonly id: MethodId;
      readonly label: string;
      readonly description: string;
      readonly limitations: readonly string[];
    };

export type EvidenceClaimReference = {
  readonly claimId: ClaimId;
  readonly claimAnchor: string;
  readonly label: string;
  readonly group: MaterialClaimGroup;
  readonly displayOrder: number;
};

export type MaterialEvidenceEdge = EvidenceClaimReference & {
  readonly target: EvidenceTarget;
  readonly scope: EvidenceScope;
};

export type EvidenceUse = EvidenceClaimReference & {
  readonly materialId: MaterialId;
  readonly materialSlug: string;
  readonly scope: EvidenceScope;
};

export type MaterialEvidenceRecord = {
  readonly target: EvidenceTarget;
  readonly record: PublicEvidenceRecord;
  readonly scopes: readonly EvidenceScope[];
  readonly supportedClaims: readonly EvidenceClaimReference[];
  readonly edges: readonly MaterialEvidenceEdge[];
};

export type MaterialEvidenceModel = {
  readonly materialId: MaterialId;
  readonly materialSlug: string;
  readonly edgeCount: number;
  readonly scopes: readonly EvidenceScope[];
  readonly records: readonly MaterialEvidenceRecord[];
};

export type EvidenceLedgerRecordModel = {
  readonly target: EvidenceTarget;
  readonly record: PublicEvidenceRecord;
  readonly scopes: readonly EvidenceScope[];
  readonly uses: readonly EvidenceUse[];
};

export type EvidenceIndex = {
  readonly edgeCount: number;
  readonly sourceCount: number;
  readonly methodCount: number;
  readonly records: readonly EvidenceLedgerRecordModel[];
  readonly materials: readonly MaterialEvidenceModel[];
};

export type EvidenceModelErrorCode =
  | "EVIDENCE_RECORD_DUPLICATE"
  | "EVIDENCE_SOURCE_URL_INVALID"
  | "EVIDENCE_CLAIM_DUPLICATE"
  | "EVIDENCE_CLAIM_ANCHOR_DUPLICATE"
  | "EVIDENCE_BASIS_MISSING"
  | "EVIDENCE_BASIS_WRONG_KIND"
  | "EVIDENCE_RECORD_UNUSED"
  | "EVIDENCE_MATERIAL_MISSING";

function fail(code: EvidenceModelErrorCode): never {
  throw new Error(code);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

function compareMaterials(left: Material, right: Material): number {
  return left.displayOrder - right.displayOrder || compareText(left.id, right.id);
}

function compareClaims(left: EvidenceClaimReference, right: EvidenceClaimReference): number {
  return left.displayOrder - right.displayOrder || compareText(left.claimId, right.claimId);
}

function compareScopes(left: EvidenceScope, right: EvidenceScope): number {
  return EVIDENCE_SCOPE_ORDER.indexOf(left) - EVIDENCE_SCOPE_ORDER.indexOf(right);
}

function targetId(target: EvidenceTarget): SourceId | MethodId {
  return target.kind === "source" ? target.sourceId : target.methodId;
}

function targetForBasis(reference: EnumeratedMaterialClaim["basis"][number]): EvidenceTarget {
  return reference.kind === "source"
    ? { kind: "source", sourceId: reference.sourceId }
    : { kind: "method", methodId: reference.methodId };
}

function sourceRecord(source: EvidenceSource): PublicEvidenceRecord {
  if (!PublicHttpsUrlSchema.safeParse(source.url).success) fail("EVIDENCE_SOURCE_URL_INVALID");
  return {
    kind: "source",
    id: source.id,
    label: source.title,
    publisher: source.publisher,
    sourceKind: source.kind,
    sourceKindLabel: SOURCE_KIND_PRESENTATION[source.kind].label,
    externalUrl: source.url,
  };
}

function methodRecord(method: MethodRecord): PublicEvidenceRecord {
  return {
    kind: "method",
    id: method.id,
    label: method.name,
    description: method.description,
    limitations: [...method.limitations],
  };
}

type RecordAccumulator = {
  target: EvidenceTarget;
  record: PublicEvidenceRecord;
  uses: EvidenceUse[];
};

type MaterialRecordAccumulator = {
  target: EvidenceTarget;
  record: PublicEvidenceRecord;
  edges: MaterialEvidenceEdge[];
};

function uniqueSortedScopes(scopes: readonly EvidenceScope[]): readonly EvidenceScope[] {
  return [...new Set(scopes)].sort(compareScopes);
}

function claimReference(claim: EnumeratedMaterialClaim): EvidenceClaimReference {
  return {
    claimId: claim.claimId,
    claimAnchor: claim.anchor,
    label: claim.label,
    group: claim.group,
    displayOrder: claim.displayOrder,
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function compileEvidenceGraph(atlas: AtlasV1): EvidenceIndex {
  const recordById = new Map<string, RecordAccumulator>();
  const sourceIds = new Set<string>();
  const methodIds = new Set<string>();

  for (const source of atlas.sources) {
    if (recordById.has(source.id)) fail("EVIDENCE_RECORD_DUPLICATE");
    sourceIds.add(source.id);
    recordById.set(source.id, {
      target: { kind: "source", sourceId: source.id },
      record: sourceRecord(source),
      uses: [],
    });
  }
  for (const method of atlas.methods) {
    if (recordById.has(method.id)) fail("EVIDENCE_RECORD_DUPLICATE");
    methodIds.add(method.id);
    recordById.set(method.id, {
      target: { kind: "method", methodId: method.id },
      record: methodRecord(method),
      uses: [],
    });
  }

  const materialModels: MaterialEvidenceModel[] = [];
  const seenClaimIds = new Set<string>();
  let edgeCount = 0;

  for (const material of [...atlas.materials].sort(compareMaterials)) {
    const materialRecords = new Map<string, MaterialRecordAccumulator>();
    const seenAnchors = new Set<string>();
    const claims = enumerateMaterialClaims(material);

    for (const claim of claims) {
      if (seenClaimIds.has(claim.claimId)) fail("EVIDENCE_CLAIM_DUPLICATE");
      seenClaimIds.add(claim.claimId);
      if (seenAnchors.has(claim.anchor)) fail("EVIDENCE_CLAIM_ANCHOR_DUPLICATE");
      seenAnchors.add(claim.anchor);
      const claimRef = claimReference(claim);

      for (const basis of claim.basis) {
        const id = basis.kind === "source" ? basis.sourceId : basis.methodId;
        const expectedIds = basis.kind === "source" ? sourceIds : methodIds;
        const otherIds = basis.kind === "source" ? methodIds : sourceIds;
        if (!expectedIds.has(id)) {
          if (otherIds.has(id)) fail("EVIDENCE_BASIS_WRONG_KIND");
          fail("EVIDENCE_BASIS_MISSING");
        }
        const accumulator = recordById.get(id);
        if (!accumulator) fail("EVIDENCE_BASIS_MISSING");
        const target = targetForBasis(basis);
        const edge: MaterialEvidenceEdge = {
          ...claimRef,
          target,
          scope: basis.scope,
        };
        const use: EvidenceUse = {
          ...claimRef,
          materialId: material.id,
          materialSlug: material.slug,
          scope: basis.scope,
        };
        accumulator.uses.push(use);
        const grouped = materialRecords.get(id) ?? {
          target,
          record: accumulator.record,
          edges: [],
        };
        grouped.edges.push(edge);
        materialRecords.set(id, grouped);
        edgeCount += 1;
      }
    }

    const records = [...materialRecords.values()]
      .sort((left, right) => compareText(targetId(left.target), targetId(right.target)))
      .map(({ target, record, edges }) => {
        const sortedEdges = [...edges].sort((left, right) =>
          compareClaims(left, right) || compareScopes(left.scope, right.scope)
        );
        const supportedById = new Map<string, EvidenceClaimReference>();
        for (const edge of sortedEdges) {
          if (!supportedById.has(edge.claimId)) {
            supportedById.set(edge.claimId, {
              claimId: edge.claimId,
              claimAnchor: edge.claimAnchor,
              label: edge.label,
              group: edge.group,
              displayOrder: edge.displayOrder,
            });
          }
        }
        return {
          target,
          record,
          scopes: uniqueSortedScopes(sortedEdges.map(({ scope }) => scope)),
          supportedClaims: [...supportedById.values()].sort(compareClaims),
          edges: sortedEdges,
        } satisfies MaterialEvidenceRecord;
      });
    materialModels.push({
      materialId: material.id,
      materialSlug: material.slug,
      edgeCount: records.reduce((sum, record) => sum + record.edges.length, 0),
      scopes: uniqueSortedScopes(records.flatMap(({ scopes }) => scopes)),
      records,
    });
  }

  const records = [...recordById.values()]
    .sort((left, right) => compareText(targetId(left.target), targetId(right.target)))
    .map(({ target, record, uses }) => {
      // Public methods can define selector, lane, or profile interpretation
      // without claiming support for one material fact. Sources cannot appear
      // as an unreferenced bibliography entry.
      if (uses.length === 0 && record.kind === "source") fail("EVIDENCE_RECORD_UNUSED");
      const sortedUses = [...uses].sort((left, right) =>
        compareText(left.materialSlug, right.materialSlug) ||
        compareClaims(left, right) ||
        compareScopes(left.scope, right.scope)
      );
      return {
        target,
        record,
        scopes: uniqueSortedScopes(sortedUses.map(({ scope }) => scope)),
        uses: sortedUses,
      } satisfies EvidenceLedgerRecordModel;
    });

  return deepFreeze({
    edgeCount,
    sourceCount: atlas.sources.length,
    methodCount: atlas.methods.length,
    records,
    materials: materialModels,
  });
}

/** Build the deterministic global source/method reverse-use graph. */
export function buildEvidenceIndex(atlas: AtlasV1): EvidenceIndex {
  return compileEvidenceGraph(atlas);
}

/**
 * Resolve one material's grouped evidence without constructing routes.
 * A prebuilt index can be supplied so route compilers traverse the Atlas once.
 */
export function buildMaterialEvidenceModel(
  atlas: AtlasV1,
  material: Material | MaterialId | string,
  index: EvidenceIndex = buildEvidenceIndex(atlas),
): MaterialEvidenceModel {
  const materialId = typeof material === "string" ? material : material.id;
  const model = index.materials.find(({ materialId: candidateId, materialSlug }) =>
    candidateId === materialId || materialSlug === materialId
  );
  if (!model) fail("EVIDENCE_MATERIAL_MISSING");
  return model;
}
