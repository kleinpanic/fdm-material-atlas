import type { DecisionLaneId, MaterialId, ProcessGateId } from "../../data/schema/ids.ts";
import type { PrintDifficulty } from "../../data/schema/vocabularies.ts";
import {
  MAP_MODES,
  type MapDisposition,
  type MapImpactFlexRecord,
  type MapMode,
  type MapNamedThermalRecord,
  type MapProjection,
  type MapSelectionAction,
  type MapSelectionTarget,
  type MapServiceGuidanceRecord,
} from "./contracts.ts";

export type ThermalView = "service-guidance" | "named-observations";
export type ServiceSort = "canonical" | "low-endpoint" | "high-endpoint";

export type MapRecovery = Readonly<{
  code: "MAP_STATE_RECOVERED";
  message: "The map view was reset because its previous state is no longer available.";
}>;

export type MapState = Readonly<{
  mode: MapMode;
  hydrated: boolean;
  decisionPaths: Readonly<{ laneId?: DecisionLaneId; materialId?: MaterialId }>;
  thermal: Readonly<{
    view: ThermalView;
    groupId?: string;
    materialId?: MaterialId;
    query: string;
    serviceSort: ServiceSort;
  }>;
  processGates: Readonly<{ laneId?: DecisionLaneId; gateId?: ProcessGateId }>;
  impactFlex: Readonly<{
    materialId?: MaterialId;
    query: string;
    maximumDifficulty?: PrintDifficulty;
    difficultyShapes: boolean;
  }>;
  focusPreview?: Readonly<{
    mode: MapMode;
    target: MapSelectionTarget;
  }>;
  hoverPreview?: Readonly<{
    mode: MapMode;
    target: MapSelectionTarget;
  }>;
  announcement: string;
  recovery?: MapRecovery;
}>;

const RECOVERY: MapRecovery = Object.freeze({
  code: "MAP_STATE_RECOVERED",
  message: "The map view was reset because its previous state is no longer available.",
});

const DIFFICULTIES = new Set<PrintDifficulty>(["easy", "moderate", "advanced", "expert"]);
const MAX_QUERY_LENGTH = 120;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMode(value: unknown): value is MapMode {
  return typeof value === "string" && (MAP_MODES as readonly string[]).includes(value);
}

function materialIds(projection: MapProjection): ReadonlySet<string> {
  return new Set(projection.serviceGuidance.records.map(({ material }) => material.id));
}

function hasLane(projection: MapProjection, id: unknown): id is DecisionLaneId {
  return typeof id === "string" && projection.lanes.some((lane) => lane.id === id);
}

function hasGate(projection: MapProjection, id: unknown): id is ProcessGateId {
  return typeof id === "string" && projection.processGates.gates.some((gate) => gate.id === id);
}

function hasMaterial(projection: MapProjection, id: unknown): id is MaterialId {
  return typeof id === "string" && materialIds(projection).has(id);
}

function hasGroup(projection: MapProjection, id: unknown): id is string {
  return typeof id === "string" && projection.thermalGroups.some((group) => group.id === id);
}

function decisionCandidate(
  projection: MapProjection,
  laneId: DecisionLaneId,
  materialId: MaterialId,
): boolean {
  return projection.lanes
    .find(({ id }) => id === laneId)!
    .candidates.some(({ id }) => id === materialId);
}

function baseState(): MapState {
  return deepFreeze({
    mode: "decision-paths",
    hydrated: false,
    decisionPaths: {},
    thermal: { view: "service-guidance", query: "", serviceSort: "canonical" },
    processGates: {},
    impactFlex: { query: "", difficultyShapes: false },
    announcement:
      "Interactive map controls are preparing. Every path and structured table is already available.",
  });
}

/** Create the only route-local map state. No record is selected implicitly. */
export function createInitialMapState(projection: MapProjection): MapState {
  if (
    projection.lanes.length !== 8 ||
    projection.processGates.gates.length !== 8 ||
    projection.serviceGuidance.records.length === 0
  )
    return recoverMapState(baseState());
  return baseState();
}

/** Clear every event-derived value while retaining whether hydration completed. */
export function recoverMapState(previous: Pick<MapState, "hydrated">): MapState {
  const initial = baseState();
  return deepFreeze({
    ...initial,
    hydrated: previous.hydrated,
    announcement: RECOVERY.message,
    recovery: RECOVERY,
  });
}

function lockedTarget(state: MapState, mode: MapMode): MapSelectionTarget | undefined {
  switch (mode) {
    case "decision-paths":
      if (
        state.decisionPaths.materialId !== undefined &&
        state.decisionPaths.laneId !== undefined
      ) {
        return {
          kind: "material",
          mode,
          laneId: state.decisionPaths.laneId,
          id: state.decisionPaths.materialId,
        };
      }
      return state.decisionPaths.laneId === undefined
        ? undefined
        : { kind: "lane", mode, id: state.decisionPaths.laneId };
    case "thermal-ranges":
      if (state.thermal.materialId !== undefined) {
        return { kind: "material", mode, id: state.thermal.materialId };
      }
      return state.thermal.groupId === undefined
        ? undefined
        : { kind: "thermal-group", mode, id: state.thermal.groupId };
    case "process-gates":
      if (state.processGates.gateId !== undefined) {
        return { kind: "gate", mode, id: state.processGates.gateId };
      }
      return state.processGates.laneId === undefined
        ? undefined
        : { kind: "lane", mode, id: state.processGates.laneId };
    case "impact-flex-space":
      return state.impactFlex.materialId === undefined
        ? undefined
        : { kind: "material", mode, id: state.impactFlex.materialId };
  }
}

export function selectLockedMapTarget(
  state: MapState,
  mode: MapMode,
): MapSelectionTarget | undefined {
  return lockedTarget(state, mode);
}

export function selectMapPreview(
  state: MapState,
  mode: MapMode,
): Readonly<{ source: "focus" | "hover"; target: MapSelectionTarget }> | undefined {
  if (state.hoverPreview?.mode === mode)
    return { source: "hover", target: state.hoverPreview.target };
  if (state.focusPreview?.mode === mode)
    return { source: "focus", target: state.focusPreview.target };
  return undefined;
}

export function selectEffectiveMapTarget(
  state: MapState,
  mode: MapMode,
): MapSelectionTarget | undefined {
  return selectMapPreview(state, mode)?.target ?? lockedTarget(state, mode);
}

function validTarget(
  projection: MapProjection,
  target: unknown,
  mode: MapMode,
): target is MapSelectionTarget {
  if (!isRecord(target) || target.mode !== mode || typeof target.kind !== "string") return false;
  switch (target.kind) {
    case "lane":
      return (
        (mode === "decision-paths" || mode === "process-gates") && hasLane(projection, target.id)
      );
    case "material":
      if (!hasMaterial(projection, target.id)) return false;
      return mode === "decision-paths"
        ? hasLane(projection, target.laneId) &&
            decisionCandidate(projection, target.laneId, target.id)
        : mode === "thermal-ranges" || mode === "impact-flex-space";
    case "gate":
      return mode === "process-gates" && hasGate(projection, target.id);
    case "thermal-group":
      return mode === "thermal-ranges" && hasGroup(projection, target.id);
    default:
      return false;
  }
}

function fixedAnnouncement(message: string): string {
  return message.length <= 120 ? message : "Map view updated.";
}

type MapStatePatch = Partial<{ [Key in keyof MapState]: MapState[Key] | undefined }>;

function update(state: MapState, patch: MapStatePatch, announcement: string): MapState {
  const { recovery: _recovery, ...withoutRecovery } = state;
  const next: Record<PropertyKey, unknown> = {
    ...withoutRecovery,
    ...patch,
    announcement: fixedAnnouncement(announcement),
  };
  for (const key of Reflect.ownKeys(patch)) {
    if (patch[key as keyof MapStatePatch] === undefined) delete next[key];
  }
  return deepFreeze(next as MapState);
}

function clearFilters(state: MapState, target: "thermal" | "impact-flex" | "all"): MapState {
  const { maximumDifficulty: _maximumDifficulty, ...impactWithoutMaximum } = state.impactFlex;
  return update(
    state,
    {
      ...(target === "thermal" || target === "all"
        ? { thermal: { ...state.thermal, query: "", serviceSort: "canonical" as const } }
        : {}),
      ...(target === "impact-flex" || target === "all"
        ? { impactFlex: { ...impactWithoutMaximum, query: "" } }
        : {}),
    },
    "Map filters cleared.",
  );
}

function resetView(state: MapState, mode: MapMode | "all"): MapState {
  if (mode === "all") {
    const initial = baseState();
    return deepFreeze({
      ...initial,
      hydrated: state.hydrated,
      announcement: "All map views reset.",
    });
  }
  const clearPreviews = {
    ...(state.focusPreview?.mode === mode ? { focusPreview: undefined } : {}),
    ...(state.hoverPreview?.mode === mode ? { hoverPreview: undefined } : {}),
  };
  if (mode === "decision-paths")
    return update(state, { ...clearPreviews, decisionPaths: {} }, "Map view reset.");
  if (mode === "thermal-ranges") {
    return update(
      state,
      {
        ...clearPreviews,
        thermal: { view: "service-guidance", query: "", serviceSort: "canonical" },
      },
      "Map view reset.",
    );
  }
  if (mode === "process-gates")
    return update(state, { ...clearPreviews, processGates: {} }, "Map view reset.");
  return update(
    state,
    {
      ...clearPreviews,
      impactFlex: { query: "", difficultyShapes: false },
    },
    "Map view reset.",
  );
}

/** Total pure transition boundary for DOM-originated map actions. */
export function reduceMapState(
  projection: MapProjection,
  state: MapState,
  action: unknown,
): MapState {
  if (!isRecord(action) || typeof action.type !== "string") return recoverMapState(state);
  switch (action.type) {
    case "hydration-ready":
      return update(state, { hydrated: true }, "Interactive map controls are ready.");
    case "set-mode":
      return isMode(action.mode)
        ? update(state, { mode: action.mode }, "Map section changed.")
        : recoverMapState(state);
    case "set-thermal-view":
      return action.mode === "thermal-ranges" &&
        (action.view === "service-guidance" || action.view === "named-observations")
        ? update(
            state,
            {
              mode: "thermal-ranges",
              thermal: { ...state.thermal, view: action.view },
            },
            "Thermal view changed.",
          )
        : recoverMapState(state);
    case "select-lane":
      if (!hasLane(projection, action.laneId)) return recoverMapState(state);
      if (action.mode === "decision-paths") {
        return update(
          state,
          {
            mode: action.mode,
            decisionPaths: { laneId: action.laneId },
            focusPreview: undefined,
            hoverPreview: undefined,
          },
          "Decision lane selected.",
        );
      }
      if (action.mode === "process-gates") {
        return update(
          state,
          {
            mode: action.mode,
            processGates: { laneId: action.laneId },
            focusPreview: undefined,
            hoverPreview: undefined,
          },
          "Process-gate lane selected.",
        );
      }
      return recoverMapState(state);
    case "select-material":
      if (action.mode === "decision-paths") {
        if (
          !hasLane(projection, action.laneId) ||
          !hasMaterial(projection, action.materialId) ||
          !decisionCandidate(projection, action.laneId, action.materialId)
        )
          return recoverMapState(state);
        return update(
          state,
          {
            mode: action.mode,
            decisionPaths: { laneId: action.laneId, materialId: action.materialId },
            focusPreview: undefined,
            hoverPreview: undefined,
          },
          "Decision-path material selected.",
        );
      }
      if (
        (action.mode === "thermal-ranges" || action.mode === "impact-flex-space") &&
        hasMaterial(projection, action.materialId)
      ) {
        return action.mode === "thermal-ranges"
          ? update(
              state,
              {
                mode: action.mode,
                thermal: { ...state.thermal, materialId: action.materialId },
                focusPreview: undefined,
                hoverPreview: undefined,
              },
              "Thermal material selected.",
            )
          : update(
              state,
              {
                mode: action.mode,
                impactFlex: { ...state.impactFlex, materialId: action.materialId },
                focusPreview: undefined,
                hoverPreview: undefined,
              },
              "Impact and flexibility material selected.",
            );
      }
      return recoverMapState(state);
    case "select-gate":
      return action.mode === "process-gates" && hasGate(projection, action.gateId)
        ? update(
            state,
            {
              mode: action.mode,
              processGates: { gateId: action.gateId },
              focusPreview: undefined,
              hoverPreview: undefined,
            },
            "Process gate selected.",
          )
        : recoverMapState(state);
    case "select-thermal-group":
      return action.mode === "thermal-ranges" && hasGroup(projection, action.groupId)
        ? update(
            state,
            {
              mode: action.mode,
              thermal: { ...state.thermal, view: "named-observations", groupId: action.groupId },
              focusPreview: undefined,
              hoverPreview: undefined,
            },
            "Named thermal group selected.",
          )
        : recoverMapState(state);
    case "preview-selection":
      return isMode(action.mode) &&
        (action.source === "focus" || action.source === "hover") &&
        validTarget(projection, action.target, action.mode)
        ? action.source === "focus"
          ? update(
              state,
              { focusPreview: { mode: action.mode, target: action.target } },
              state.announcement,
            )
          : update(
              state,
              { hoverPreview: { mode: action.mode, target: action.target } },
              state.announcement,
            )
        : recoverMapState(state);
    case "clear-preview":
      if (!isMode(action.mode) || (action.source !== "focus" && action.source !== "hover")) {
        return recoverMapState(state);
      }
      if (action.source === "focus") {
        return state.focusPreview?.mode === action.mode
          ? update(state, { focusPreview: undefined }, state.announcement)
          : state;
      }
      return state.hoverPreview?.mode === action.mode
        ? update(state, { hoverPreview: undefined }, state.announcement)
        : state;
    case "set-search":
      if (typeof action.query !== "string" || action.query.length > MAX_QUERY_LENGTH)
        return recoverMapState(state);
      if (action.target === "thermal") {
        return update(
          state,
          {
            thermal: { ...state.thermal, query: action.query.normalize("NFC") },
          },
          "Thermal filter updated.",
        );
      }
      if (action.target === "impact-flex") {
        return update(
          state,
          {
            impactFlex: { ...state.impactFlex, query: action.query.normalize("NFC") },
          },
          "Impact and flexibility filter updated.",
        );
      }
      return recoverMapState(state);
    case "set-service-sort":
      return action.sort === "canonical" ||
        action.sort === "low-endpoint" ||
        action.sort === "high-endpoint"
        ? update(
            state,
            { thermal: { ...state.thermal, serviceSort: action.sort } },
            "Service guidance order updated.",
          )
        : recoverMapState(state);
    case "set-maximum-difficulty":
      if (action.value === undefined) {
        const { maximumDifficulty: _maximumDifficulty, ...withoutMaximum } = state.impactFlex;
        return update(state, { impactFlex: withoutMaximum }, "Maximum print difficulty updated.");
      }
      return typeof action.value === "string" && DIFFICULTIES.has(action.value as PrintDifficulty)
        ? update(
            state,
            {
              impactFlex: {
                ...state.impactFlex,
                maximumDifficulty: action.value as PrintDifficulty,
              },
            },
            "Maximum print difficulty updated.",
          )
        : recoverMapState(state);
    case "set-difficulty-shapes":
      return typeof action.enabled === "boolean"
        ? update(
            state,
            {
              impactFlex: { ...state.impactFlex, difficultyShapes: action.enabled },
            },
            "Difficulty shape encoding updated.",
          )
        : recoverMapState(state);
    case "clear-filters":
      return action.target === "thermal" ||
        action.target === "impact-flex" ||
        action.target === "all"
        ? clearFilters(state, action.target)
        : recoverMapState(state);
    case "clear-selection": {
      if (!isMode(action.mode)) return recoverMapState(state);
      if (action.mode === "decision-paths") {
        const decisionPaths =
          action.target === "material" && state.decisionPaths.laneId !== undefined
            ? { laneId: state.decisionPaths.laneId }
            : {};
        return update(state, { decisionPaths }, "Decision-path selection cleared.");
      }
      if (action.mode === "thermal-ranges") {
        const { materialId: _materialId, ...withoutMaterial } = state.thermal;
        const { groupId: _groupId, ...withoutGroupOrMaterial } = withoutMaterial;
        const thermal = action.target === "material" ? withoutMaterial : withoutGroupOrMaterial;
        return update(state, { thermal }, "Thermal selection cleared.");
      }
      if (action.mode === "process-gates") {
        return update(state, { processGates: {} }, "Process-gate selection cleared.");
      }
      const { materialId: _materialId, ...impactWithoutMaterial } = state.impactFlex;
      return update(
        state,
        { impactFlex: impactWithoutMaterial },
        "Impact and flexibility selection cleared.",
      );
    }
    case "reset-view":
      return action.mode === "all" || isMode(action.mode)
        ? resetView(state, action.mode)
        : recoverMapState(state);
    default:
      return recoverMapState(state);
  }
}

export type MapReducer = (state: MapState, action: MapSelectionAction) => MapState;

/** Bind the immutable projection once for direct use by one Preact useReducer. */
export function createMapReducer(projection: MapProjection): MapReducer {
  return (state, action) => reduceMapState(projection, state, action);
}

function normalizedQuery(query: string): string {
  return query.trim().normalize("NFC").toLocaleLowerCase("en-US");
}

function serviceEndpoint(
  record: MapServiceGuidanceRecord,
  end: "low" | "high",
): number | undefined {
  if (record.measurement === undefined) return undefined;
  if (record.measurement.shape === "point") return record.measurement.value;
  return end === "low" ? record.measurement.low : record.measurement.high;
}

function serviceRecords(
  projection: MapProjection,
  state: MapState,
): readonly MapServiceGuidanceRecord[] {
  const query = normalizedQuery(state.thermal.query);
  const records = projection.serviceGuidance.records.map((record): MapServiceGuidanceRecord => {
    if (
      record.disposition.disposition !== "plotted" ||
      query === "" ||
      record.material.name.normalize("NFC").toLocaleLowerCase("en-US").includes(query)
    )
      return record;
    return {
      ...record,
      disposition: {
        disposition: "filtered",
        filter: { kind: "search", target: "thermal", query },
      },
    };
  });
  if (state.thermal.serviceSort === "canonical") return records;
  const end = state.thermal.serviceSort === "low-endpoint" ? "low" : "high";
  return [...records].sort((left, right) => {
    const leftValue = serviceEndpoint(left, end);
    const rightValue = serviceEndpoint(right, end);
    if (leftValue === undefined && rightValue !== undefined) return 1;
    if (leftValue !== undefined && rightValue === undefined) return -1;
    if (leftValue !== undefined && rightValue !== undefined && leftValue !== rightValue)
      return leftValue - rightValue;
    return (
      left.material.displayOrder - right.material.displayOrder ||
      left.material.id.localeCompare(right.material.id, "en")
    );
  });
}

function namedRecords(
  records: readonly MapNamedThermalRecord[],
  queryValue: string,
): readonly MapNamedThermalRecord[] {
  const query = normalizedQuery(queryValue);
  if (query === "") return records;
  return records.map((record): MapNamedThermalRecord => {
    const searchable = `${record.material.name}\u0000${record.material.id}`
      .normalize("NFC")
      .toLocaleLowerCase("en-US");
    if (searchable.includes(query)) return record;
    return {
      ...record,
      disposition: {
        disposition: "filtered",
        filter: { kind: "search", target: "thermal", query },
      },
    };
  });
}

const DIFFICULTY_ORDER = new Map<PrintDifficulty, number>(
  ["easy", "moderate", "advanced", "expert"].map((value, index) => [
    value as PrintDifficulty,
    index,
  ]),
);

function impactRecords(projection: MapProjection, state: MapState): readonly MapImpactFlexRecord[] {
  const query = normalizedQuery(state.impactFlex.query);
  const maximum =
    state.impactFlex.maximumDifficulty === undefined
      ? undefined
      : DIFFICULTY_ORDER.get(state.impactFlex.maximumDifficulty);
  return projection.impactFlex.records.map((record): MapImpactFlexRecord => {
    if (record.disposition.disposition === "omitted") return record;
    const difficulty =
      record.printDifficulty === undefined
        ? undefined
        : DIFFICULTY_ORDER.get(record.printDifficulty);
    let disposition: MapDisposition = { disposition: "plotted" };
    if (maximum !== undefined && (difficulty === undefined || difficulty > maximum)) {
      disposition = {
        disposition: "filtered",
        filter: { kind: "maximum-difficulty", value: state.impactFlex.maximumDifficulty! },
      };
    } else if (
      query !== "" &&
      !`${record.material.name}\u0000${record.material.id}`
        .normalize("NFC")
        .toLocaleLowerCase("en-US")
        .includes(query)
    ) {
      disposition = {
        disposition: "filtered",
        filter: { kind: "search", target: "impact-flex", query },
      };
    }
    return disposition.disposition === record.disposition.disposition
      ? record
      : { ...record, disposition };
  });
}

function processContext(
  projection: MapProjection,
  target: MapSelectionTarget | undefined,
): unknown {
  if (target?.mode !== "process-gates") return undefined;
  if (target.kind === "lane") {
    const lane = projection.processGates.lanes.find(({ id }) => id === target.id);
    if (lane === undefined) return undefined;
    const relationships = projection.processGates.relationships.filter(
      ({ laneId, relationship }) => laneId === lane.id && relationship === "applies",
    );
    const gateIds = new Set(relationships.map(({ gateId }) => gateId));
    return {
      kind: "lane" as const,
      lane,
      candidates: lane.candidates,
      gates: projection.processGates.gates.filter(({ id }) => gateIds.has(id)),
      relationships,
    };
  }
  if (target.kind === "gate") {
    const gate = projection.processGates.gates.find(({ id }) => id === target.id);
    if (gate === undefined) return undefined;
    const relationships = projection.processGates.relationships.filter(
      ({ gateId, relationship }) => gateId === gate.id && relationship === "applies",
    );
    const laneIds = new Set(relationships.map(({ laneId }) => laneId));
    return {
      kind: "gate" as const,
      gate,
      lanes: projection.processGates.lanes.filter(({ id }) => laneIds.has(id)),
      relationships,
    };
  }
  return undefined;
}

/** Present all four visible modes from one immutable projection and one state. */
export function buildMapView(projection: MapProjection, state: MapState) {
  const decisionLockedTarget = lockedTarget(state, "decision-paths");
  const thermalLockedTarget = lockedTarget(state, "thermal-ranges");
  const processLockedTarget = lockedTarget(state, "process-gates");
  const impactLockedTarget = lockedTarget(state, "impact-flex-space");
  const decisionPreview = selectMapPreview(state, "decision-paths");
  const thermalPreview = selectMapPreview(state, "thermal-ranges");
  const processPreview = selectMapPreview(state, "process-gates");
  const impactPreview = selectMapPreview(state, "impact-flex-space");
  const decisionTarget = selectEffectiveMapTarget(state, "decision-paths");
  const thermalTarget = selectEffectiveMapTarget(state, "thermal-ranges");
  const processTarget = selectEffectiveMapTarget(state, "process-gates");
  const impactTarget = selectEffectiveMapTarget(state, "impact-flex-space");
  const currentServiceRecords = serviceRecords(projection, state);
  const currentImpactRecords = impactRecords(projection, state);
  const selectedGroup =
    state.thermal.groupId === undefined
      ? undefined
      : projection.thermalGroups.find(({ id }) => id === state.thermal.groupId);
  const currentNamedRecords =
    selectedGroup === undefined ? [] : namedRecords(selectedGroup.records, state.thermal.query);
  const selectedImpactId =
    impactLockedTarget?.kind === "material" ? impactLockedTarget.id : undefined;
  const selectedImpact =
    selectedImpactId === undefined
      ? undefined
      : currentImpactRecords.find(({ material }) => material.id === selectedImpactId);

  return deepFreeze({
    activeTarget: selectEffectiveMapTarget(state, state.mode),
    lockedTarget: lockedTarget(state, state.mode),
    previewTarget: selectMapPreview(state, state.mode)?.target,
    previewSource: selectMapPreview(state, state.mode)?.source,
    decisionPaths: {
      lanes: projection.lanes,
      activeTarget: decisionTarget,
      lockedTarget: decisionLockedTarget,
      previewTarget: decisionPreview?.target,
      previewSource: decisionPreview?.source,
    },
    thermal: {
      view: state.thermal.view,
      query: state.thermal.query,
      serviceSort: state.thermal.serviceSort,
      domain: projection.serviceGuidance.domain,
      ticks: projection.serviceGuidance.ticks,
      serviceRecords: currentServiceRecords,
      groups: projection.thermalGroups,
      selectedGroup,
      namedRecords: currentNamedRecords,
      activeTarget: thermalTarget,
      lockedTarget: thermalLockedTarget,
      previewTarget: thermalPreview?.target,
      previewSource: thermalPreview?.source,
    },
    processGates: {
      ...projection.processGates,
      activeTarget: processTarget,
      lockedTarget: processLockedTarget,
      previewTarget: processPreview?.target,
      previewSource: processPreview?.source,
      context: processContext(projection, processTarget),
    },
    impactFlex: {
      ...projection.impactFlex,
      records: currentImpactRecords,
      query: state.impactFlex.query,
      maximumDifficulty: state.impactFlex.maximumDifficulty,
      shapesEnabled: state.impactFlex.difficultyShapes,
      activeTarget: impactTarget,
      lockedTarget: impactLockedTarget,
      previewTarget: impactPreview?.target,
      previewSource: impactPreview?.source,
      selectedOutsideFilter: selectedImpact?.disposition.disposition === "filtered",
    },
    status: {
      hydrated: state.hydrated,
      announcement: state.announcement,
      ...(state.recovery === undefined ? {} : { recovery: state.recovery }),
    },
  });
}
