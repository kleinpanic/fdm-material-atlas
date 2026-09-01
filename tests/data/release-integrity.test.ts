import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { AtlasV1 } from "../../src/data/schema/atlas.ts";
import { decisionLaneIds } from "../../src/data/schema/decision-lane.ts";
import { parseAtlas } from "../../src/data/schema/parse-atlas.ts";
import {
  selectorCriterionIds,
  type Predicate,
  type SelectorField,
} from "../../src/data/schema/selector.ts";
import type { VisualizationTargetRef } from "../../src/data/schema/visualization.ts";
import { MATERIAL_SEMANTIC_FIELDS } from "../../src/data/source-contract/semantic-fields.ts";
import { deriveDecisionLaneMembership } from "../../src/domain/decision-lanes/membership.ts";
import { compileSelectorProjection } from "../../src/domain/selector/projection.ts";
import { compileMapProjection } from "../../src/features/map/projection.ts";
import {
  MATERIAL_CLAIM_REGISTRY,
  enumerateMaterialClaims,
} from "../../src/features/materials/claim-registry.ts";
import { buildMaterialDetailModels } from "../../src/features/materials/detail-model.ts";
import { buildEvidenceIndex } from "../../src/features/materials/evidence-model.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";
import { internalHref } from "../../src/lib/routes.ts";

const REVIEWED_MATERIAL_BASELINE = 23;
const artifactPath = resolve(import.meta.dirname, "../../src/data/public/atlas.v1.json");
const result = parseAtlas(JSON.parse(readFileSync(artifactPath, "utf8")) as unknown);
if (!result.success) throw new Error("RELEASE_CANONICAL_PARSE_FAILED");
const atlas: AtlasV1 = result.data;

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function expectUnique(values: readonly string[]): void {
  expect(new Set(values).size).toBe(values.length);
}

function predicateFields(predicate: Predicate, fields: Set<SelectorField>): void {
  switch (predicate.op) {
    case "equals":
    case "one-of":
    case "at-least":
    case "at-most":
    case "contains-any":
      fields.add(predicate.field);
      return;
    case "all":
    case "any":
      predicate.rules.forEach((rule) => predicateFields(rule, fields));
      return;
    case "not":
      predicateFields(predicate.rule, fields);
  }
}

function allBasisReferences(atlasValue: AtlasV1) {
  return [
    ...atlasValue.materials.flatMap((material) =>
      enumerateMaterialClaims(material).flatMap(({ basis }) => basis),
    ),
    ...atlasValue.processGates.flatMap(({ basis }) => basis),
  ];
}

function resolveTarget(target: VisualizationTargetRef, indexes: ReturnType<typeof targetIndexes>) {
  switch (target.kind) {
    case "material-id":
      return indexes.materialIds.filter((id) => id === target.materialId).length;
    case "material-route":
      return indexes.materialSlugs.filter((slug) => slug === target.slug).length;
    case "claim-id":
      return indexes.claimIds.filter((id) => id === target.claimId).length;
    case "decision-lane-id":
      return indexes.laneIds.filter((id) => id === target.decisionLaneId).length;
    case "selector-criterion-id":
      return indexes.criterionIds.filter((id) => id === target.selectorCriterionId).length;
    case "process-gate-id":
      return indexes.gateIds.filter((id) => id === target.processGateId).length;
  }
}

function targetIndexes() {
  return {
    materialIds: atlas.materials.map(({ id }) => id),
    materialSlugs: atlas.materials.map(({ slug }) => slug),
    claimIds: atlas.materials.flatMap((material) =>
      enumerateMaterialClaims(material).map(({ claimId }) => claimId),
    ),
    laneIds: atlas.decisionLanes.map(({ id }) => id),
    criterionIds: atlas.selector.criteria.map(({ id }) => id),
    gateIds: atlas.processGates.map(({ id }) => id),
  };
}

describe("release integrity across the canonical public Atlas", () => {
  it("keeps the reviewed live baseline and one complete 32-field semantic registry", () => {
    expect(atlas.materials).toHaveLength(REVIEWED_MATERIAL_BASELINE);
    expect(loadPublicAtlas()).toEqual(atlas);
    expect(MATERIAL_SEMANTIC_FIELDS).toHaveLength(32);
    expectUnique([...MATERIAL_SEMANTIC_FIELDS]);

    const registryKeys = MATERIAL_CLAIM_REGISTRY.flatMap(({ semanticKeys }) => semanticKeys);
    expect(registryKeys).toHaveLength(32);
    expectUnique(registryKeys);
    for (const material of atlas.materials) {
      const representedKeys = [
        "material-name",
        ...enumerateMaterialClaims(material).flatMap(({ semanticKeys }) =>
          semanticKeys.filter((key, index, keys) => keys.indexOf(key) === index),
        ),
      ];
      expect(new Set(representedKeys), material.id).toEqual(new Set(registryKeys));
    }
  });

  it("resolves every evidence edge to exactly one public source or method", () => {
    const sourceIds = atlas.sources.map(({ id }) => id);
    const methodIds = atlas.methods.map(({ id }) => id);
    expectUnique(sourceIds);
    expectUnique(methodIds);
    const references = allBasisReferences(atlas);
    expect(references.length).toBeGreaterThan(0);

    for (const reference of references) {
      const candidates = reference.kind === "source" ? sourceIds : methodIds;
      const id = reference.kind === "source" ? reference.sourceId : reference.methodId;
      expect(
        candidates.filter((candidate) => candidate === id),
        id,
      ).toHaveLength(1);
    }

    const evidenceIndex = buildEvidenceIndex(atlas);
    expect(evidenceIndex.sourceCount).toBe(sourceIds.length);
    expect(evidenceIndex.methodCount).toBe(methodIds.length);
    expect(evidenceIndex.records).toHaveLength(sourceIds.length + methodIds.length);
  });

  it("keeps every selector criterion, option, field, gate, and vocabulary deterministic", () => {
    const projection = compileSelectorProjection(atlas);
    expect(sorted(atlas.selector.criteria.map(({ id }) => id))).toEqual(
      sorted(selectorCriterionIds),
    );
    expect(sorted(projection.criteria.map(({ id }) => id))).toEqual(sorted(selectorCriterionIds));
    expect(projection.materials.map(({ id }) => id)).toEqual(
      sorted(atlas.materials.map(({ id }) => id)),
    );

    const optionIds = atlas.selector.criteria.flatMap(({ options }) => options.map(({ id }) => id));
    expectUnique(optionIds);
    for (const criterion of atlas.selector.criteria) {
      const projected = projection.criteria.filter(({ id }) => id === criterion.id);
      expect(projected).toHaveLength(1);
      expect(sorted(projected[0]!.options.map(({ id }) => id))).toEqual(
        sorted(criterion.options.map(({ id }) => id)),
      );
      expect(criterion.options.filter(({ id }) => id === criterion.defaultOptionId)).toHaveLength(
        1,
      );
    }

    const referencedFields = new Set<SelectorField>();
    const hardGateIds: string[] = [];
    for (const criterion of atlas.selector.criteria) {
      for (const option of criterion.options) {
        if (option.preferenceRule) predicateFields(option.preferenceRule, referencedFields);
        for (const gate of option.hardGates) {
          hardGateIds.push(gate.processGateId);
          predicateFields(gate.incompatibleWhen, referencedFields);
        }
      }
    }
    expect(referencedFields.size).toBeGreaterThan(0);
    const expectedFields = sorted(referencedFields);
    for (const material of projection.materials) {
      expect(material.fields.map(({ field }) => field)).toEqual(expectedFields);
      expectUnique(material.fields.map(({ field }) => field));
    }
    for (const gateId of new Set(hardGateIds)) {
      expect(atlas.processGates.filter(({ id }) => id === gateId)).toHaveLength(1);
      expect(projection.processGates.filter(({ id }) => id === gateId)).toHaveLength(1);
    }

    expectUnique(atlas.vocabularies.map(({ id }) => id));
    for (const vocabulary of atlas.vocabularies) {
      expectUnique(vocabulary.terms.map(({ value }) => value));
      expectUnique(vocabulary.terms.map(({ label }) => label));
    }
  });

  it("derives lane candidates once and preserves them across details and maps", () => {
    expect(JSON.stringify(atlas.decisionLanes)).not.toContain("candidateMaterialIds");
    const memberships = deriveDecisionLaneMembership(atlas);
    const map = compileMapProjection(atlas, "/");
    const details = buildMaterialDetailModels(atlas, "/");

    expect(sorted(memberships.map(({ id }) => id))).toEqual(sorted(decisionLaneIds));
    for (const membership of memberships) {
      expectUnique(membership.candidateMaterialIds);
      expectUnique(membership.indeterminateMaterialIds);
      const canonical = atlas.decisionLanes.filter(({ id }) => id === membership.id);
      expect(canonical).toHaveLength(1);
      expect(membership.processGates.map(({ id }) => id)).toEqual(
        sorted(canonical[0]!.processGateIds),
      );

      const decisionPath = map.lanes.filter(({ id }) => id === membership.id);
      const gateLane = map.processGates.lanes.filter(({ id }) => id === membership.id);
      expect(decisionPath).toHaveLength(1);
      expect(gateLane).toHaveLength(1);
      expect(sorted(decisionPath[0]!.candidates.map(({ id }) => id))).toEqual(
        sorted(membership.candidateMaterialIds),
      );
      expect(sorted(gateLane[0]!.candidates.map(({ id }) => id))).toEqual(
        sorted(membership.candidateMaterialIds),
      );

      for (const materialId of membership.candidateMaterialIds) {
        const detail = details.filter(({ id }) => id === materialId);
        expect(detail).toHaveLength(1);
        expect(
          detail[0]!.relationships.filter(
            ({ laneId, state }) => laneId === membership.id && state === "candidate",
          ),
        ).toHaveLength(1);
      }
    }
  });

  it("resolves every route and visualization target exactly once", () => {
    const indexes = targetIndexes();
    Object.values(indexes).forEach(expectUnique);
    const details = buildMaterialDetailModels(atlas, "/atlas-preview/");
    expect(details).toHaveLength(atlas.materials.length);
    for (const material of atlas.materials) {
      const detail = details.filter(({ id }) => id === material.id);
      expect(detail).toHaveLength(1);
      expect(detail[0]!.slug).toBe(material.slug);
      expect(detail[0]!.href).toBe(
        internalHref("/atlas-preview/", { id: "material", slug: material.slug }),
      );
    }

    const visualizationIds = atlas.visualizationReferences.map(({ id }) => id);
    expectUnique(visualizationIds);
    for (const reference of atlas.visualizationReferences) {
      for (const target of [reference.subject, ...reference.related]) {
        expect(resolveTarget(target, indexes), `${reference.id}:${target.kind}`).toBe(1);
      }
    }
    const visualizedMaterialIds = atlas.visualizationReferences.flatMap((reference) =>
      [reference.subject, ...reference.related].flatMap((target) =>
        target.kind === "material-id" ? [target.materialId] : [],
      ),
    );
    const visualizedRoutes = atlas.visualizationReferences.flatMap((reference) =>
      [reference.subject, ...reference.related].flatMap((target) =>
        target.kind === "material-route" ? [target.slug] : [],
      ),
    );
    expect(sorted(new Set(visualizedMaterialIds))).toEqual(sorted(indexes.materialIds));
    expect(sorted(new Set(visualizedRoutes))).toEqual(sorted(indexes.materialSlugs));
  });

  it("keeps every scientific visualization member inside the live canonical inventory", () => {
    const map = compileMapProjection(atlas, "/atlas-preview/");
    const materialIds = new Set(atlas.materials.map(({ id }) => id));
    const assertCanonicalMembers = (ids: readonly string[]) => {
      expectUnique(ids);
      for (const id of ids) expect(materialIds.has(id), id).toBe(true);
    };

    assertCanonicalMembers(map.serviceGuidance.records.map(({ material }) => material.id));
    expect(map.serviceGuidance.records).toHaveLength(atlas.materials.length);
    assertCanonicalMembers(map.impactFlex.records.map(({ material }) => material.id));
    expect(map.impactFlex.records).toHaveLength(atlas.materials.length);
    for (const group of map.thermalGroups) {
      assertCanonicalMembers(group.members.map(({ material }) => material.id));
      assertCanonicalMembers(group.records.map(({ material }) => material.id));
      expect(group.records).toHaveLength(atlas.materials.length);
    }
    expect(map.processGates.relationships).toHaveLength(
      atlas.decisionLanes.length * atlas.processGates.length,
    );
    for (const relationship of map.processGates.relationships) {
      expect(atlas.decisionLanes.filter(({ id }) => id === relationship.laneId)).toHaveLength(1);
      expect(atlas.processGates.filter(({ id }) => id === relationship.gateId)).toHaveLength(1);
    }
  });
});
