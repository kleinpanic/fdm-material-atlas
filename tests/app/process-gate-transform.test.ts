import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { AtlasV1 } from "../../src/data/schema/atlas.ts";
import { decisionLaneIds } from "../../src/data/schema/decision-lane.ts";
import {
  buildProcessGateMap,
  selectProcessGateContext,
} from "../../src/features/map/process-gates.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

function cloneAtlas(): AtlasV1 {
  return structuredClone(loadPublicAtlas());
}

function reverseRegistries(atlas: AtlasV1): AtlasV1 {
  atlas.materials.reverse();
  atlas.decisionLanes.reverse();
  atlas.processGates.reverse();
  atlas.visualizationReferences.reverse();
  atlas.vocabularies.reverse();
  return atlas;
}

describe("complete process-gate transform", () => {
  it("accounts for every cell in the ordered 8 by 8 matrix", () => {
    const atlas = loadPublicAtlas();
    const model = buildProcessGateMap(atlas, "/atlas-preview/");

    expect(model.lanes.map(({ id }) => id)).toEqual(decisionLaneIds);
    expect(model.gates.map(({ id }) => id)).toEqual(
      [...atlas.processGates]
        .sort((left, right) => left.id.localeCompare(right.id, "en"))
        .map(({ id }) => id),
    );
    expect(model.relationships).toHaveLength(64);
    expect(
      model.relationships.filter(({ relationship }) => relationship === "applies"),
    ).toHaveLength(13);
    expect(
      model.relationships.filter(({ relationship }) => relationship === "not-listed"),
    ).toHaveLength(51);
    expect(
      new Set(model.relationships.map(({ laneId, gateId }) => `${laneId}\u0000${gateId}`)).size,
    ).toBe(64);
    expect(new Set(model.relationships.map(({ label }) => label))).toEqual(
      new Set(["Applies — verify this gate", "Not listed for this lane"]),
    );
  });

  it("selects a lane with only its directly listed gates and live candidates", () => {
    const model = buildProcessGateMap(loadPublicAtlas(), "/repo/");
    const industrial = model.lanes.find(({ id }) => id === "lane-industrial")!;
    const selected = selectProcessGateContext(model, {
      kind: "lane",
      id: industrial.id,
    });

    expect(selected.kind).toBe("lane");
    if (selected.kind !== "lane") throw new Error("Expected lane context");
    expect(selected.lane.id).toBe("lane-industrial");
    expect(selected.gates.map(({ id }) => id)).toEqual([
      "gate-drying-capability",
      "gate-industrial-hardware",
      "gate-ventilation-capability",
    ]);
    expect(selected.candidates).toEqual(selected.lane.candidates);
    expect(selected.noAdditionalGateMessage).toBeUndefined();
    expect(selected.gates.every(({ href }) => href.startsWith("/repo/map/#gate-"))).toBe(true);
  });

  it("selects a gate with every referencing lane and lane-grouped candidate context", () => {
    const model = buildProcessGateMap(loadPublicAtlas(), "/repo/");
    const drying = model.gates.find(({ id }) => id === "gate-drying-capability")!;
    const selected = selectProcessGateContext(model, {
      kind: "gate",
      id: drying.id,
    });

    expect(selected.kind).toBe("gate");
    if (selected.kind !== "gate") throw new Error("Expected gate context");
    expect(selected.lanes.map(({ lane }) => lane.id)).toEqual([
      "lane-outdoor",
      "lane-industrial",
      "lane-support-materials",
    ]);
    expect(selected.lanes.every(({ candidates, lane }) => candidates === lane.candidates)).toBe(
      true,
    );
    expect(selected.lanes.every(({ lane }) => lane.href.startsWith("/repo/map/#lane-"))).toBe(true);

    const flattened = selected.lanes.flatMap(({ candidates }) => candidates.map(({ id }) => id));
    expect(flattened.length).toBeGreaterThan(new Set(flattened).size);
    expect(selected.gate).toMatchObject({
      label: "Drying and dry-storage capability",
      capabilityLabel: "Drying capability",
    });
    expect(selected.gate.requirement.length).toBeGreaterThan(0);
    expect(selected.gate.verification.length).toBeGreaterThan(0);
  });

  it("keeps a synthetic zero-gate lane explicit without inferring a relationship", () => {
    const atlas = cloneAtlas();
    const lane = atlas.decisionLanes.find(({ id }) => id === "lane-easy-prototypes")!;
    lane.processGateIds = [];

    const model = buildProcessGateMap(atlas);
    const selected = selectProcessGateContext(model, { kind: "lane", id: lane.id });
    expect(
      model.relationships.filter(({ relationship }) => relationship === "applies"),
    ).toHaveLength(12);
    expect(selected.kind).toBe("lane");
    if (selected.kind !== "lane") throw new Error("Expected lane context");
    expect(selected.gates).toEqual([]);
    expect(selected.noAdditionalGateMessage).toBe(
      "No additional process gate is listed for this lane.",
    );
  });

  it("is invariant to relevant registry permutations", () => {
    expect(buildProcessGateMap(reverseRegistries(cloneAtlas()), "/repo/")).toEqual(
      buildProcessGateMap(loadPublicAtlas(), "/repo/"),
    );
  });

  it.each([
    [
      "PROCESS_GATE_LANE_MISSING",
      (atlas: AtlasV1) => {
        atlas.decisionLanes.pop();
      },
    ],
    [
      "PROCESS_GATE_LANE_DUPLICATE",
      (atlas: AtlasV1) => {
        atlas.decisionLanes[1] = structuredClone(atlas.decisionLanes[0]!);
      },
    ],
    [
      "PROCESS_GATE_REGISTRY_MISSING",
      (atlas: AtlasV1) => {
        atlas.processGates.pop();
      },
    ],
    [
      "PROCESS_GATE_REGISTRY_DUPLICATE",
      (atlas: AtlasV1) => {
        atlas.processGates[1] = structuredClone(atlas.processGates[0]!);
      },
    ],
    [
      "PROCESS_GATE_REFERENCE_MISSING",
      (atlas: AtlasV1) => {
        atlas.decisionLanes[0]!.processGateIds[0] =
          "gate-missing" as AtlasV1["processGates"][number]["id"];
      },
    ],
    [
      "PROCESS_GATE_REFERENCE_DUPLICATE",
      (atlas: AtlasV1) => {
        const lane = atlas.decisionLanes.find(({ processGateIds }) => processGateIds.length > 0)!;
        lane.processGateIds.push(lane.processGateIds[0]!);
      },
    ],
  ] as const)("fails closed with %s", (code, mutate) => {
    const atlas = cloneAtlas();
    mutate(atlas);
    expect(() => buildProcessGateMap(atlas)).toThrow(code);
  });

  it("delegates candidates to live membership and exposes no capability verdict state", () => {
    const source = readFileSync("src/features/map/process-gates.ts", "utf8");
    expect(source).toMatch(/deriveDecisionLaneMembership/u);
    expect(source).not.toMatch(/candidateMaterialIds\s*:/u);
    expect(source).not.toMatch(/relationship:\s*["'](?:available|blocked|safe|pass|fail)["']/u);
    expect(source).not.toMatch(/decision-path/u);
  });
});
