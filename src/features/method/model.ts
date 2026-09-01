import type { AtlasV1 } from "../../data/schema/atlas.ts";
import type { EvidenceScope } from "../../data/schema/evidence.ts";
import { fragmentHref, internalFragmentHref, internalHref } from "../../lib/routes.ts";
import { buildEvidenceIndex, type EvidenceUse } from "../materials/evidence-model.ts";
import { METHOD_COPY } from "./method-copy.ts";

export type MethodUseModel = EvidenceUse & {
  readonly scopeLabel: string;
  readonly href: string;
};

type MethodLedgerBase = {
  readonly id: string;
  readonly anchor: string;
  readonly scopes: readonly EvidenceScope[];
  readonly claimUseCount: number;
  readonly uses: readonly MethodUseModel[];
};

export type MethodRecordModel = MethodLedgerBase & {
  readonly kind: "method";
  readonly name: string;
  readonly description: string;
  readonly limitations: readonly string[];
};

export type SourceRecordModel = MethodLedgerBase & {
  readonly kind: "source";
  readonly title: string;
  readonly publisher: string;
  readonly sourceKindLabel: string;
  readonly externalAction: {
    readonly label: "Open external source";
    readonly url: string;
    readonly target: "_blank";
    readonly rel: "noopener noreferrer";
  };
};

export type MethodPageModel = {
  readonly href: string;
  readonly copy: typeof METHOD_COPY;
  readonly contents: readonly {
    readonly id: string;
    readonly label: string;
    readonly href: string;
  }[];
  readonly methods: readonly MethodRecordModel[];
  readonly sources: readonly SourceRecordModel[];
};

const CONTENTS = [
  ["evidence-scopes", "Evidence scopes"],
  ["thermal-metrics", "Thermal metrics"],
  ["selector-scoring", "Selector scoring"],
  ["qualitative-guidance", "Qualitative guidance"],
  ["starting-profiles", "Starting profiles"],
  ["methods", "Methods"],
  ["sources", "Sources"],
  ["limitations", "Limitations"],
] as const;

function fail(code: string): never {
  throw new Error(code);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function useModel(base: string | undefined, use: EvidenceUse): MethodUseModel {
  return {
    ...use,
    scopeLabel:
      METHOD_COPY.evidenceScopes.find(({ id }) => id === use.scope)?.label ??
      fail("METHOD_SCOPE_INVALID"),
    href: internalFragmentHref(base, { id: "material", slug: use.materialSlug }, use.claimAnchor),
  };
}

/** Compile the route-ready methodology reference from canonical public data. */
export function buildMethodPageModel(atlas: AtlasV1, base: string | undefined): MethodPageModel {
  if (atlas.sources.length === 0) fail("METHOD_SOURCES_REQUIRED");
  if (atlas.methods.length === 0) fail("METHOD_METHODS_REQUIRED");
  const index = buildEvidenceIndex(atlas);
  const methods: MethodRecordModel[] = [];
  const sources: SourceRecordModel[] = [];

  for (const ledger of index.records) {
    fragmentHref(ledger.record.id);
    const uses = ledger.uses.map((use) => useModel(base, use));
    const common = {
      id: ledger.record.id,
      anchor: ledger.record.id,
      scopes: ledger.scopes,
      claimUseCount: uses.length,
      uses,
    };
    if (ledger.record.kind === "method") {
      methods.push({
        ...common,
        kind: "method",
        name: ledger.record.label,
        description: ledger.record.description,
        limitations: ledger.record.limitations,
      });
    } else {
      sources.push({
        ...common,
        kind: "source",
        title: ledger.record.label,
        publisher: ledger.record.publisher,
        sourceKindLabel: ledger.record.sourceKindLabel,
        externalAction: {
          label: "Open external source",
          url: ledger.record.externalUrl,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      });
    }
  }

  return deepFreeze({
    href: internalHref(base, { id: "method" }),
    copy: METHOD_COPY,
    contents: CONTENTS.map(([id, label]) => ({ id, label, href: fragmentHref(id) })),
    methods,
    sources,
  });
}
