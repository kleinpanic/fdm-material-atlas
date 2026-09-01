/** @jsxImportSource preact */
import { useEffect, useMemo, useState } from "preact/hooks";

import { defaultExplorerState, type ExplorerState, type ExplorerSortableField } from "../../features/data-explorer/explore.ts";
import type { DataExplorerModel } from "../../features/data-explorer/model.ts";
import { safeExplore } from "../../features/data-explorer/safe-explore.ts";
import { DataControls } from "./DataControls.tsx";
import { DataRecords } from "./DataRecords.tsx";
import { DataTable } from "./DataTable.tsx";

type Props = Readonly<{ model: DataExplorerModel }>;

export function DataExplorerIsland({ model }: Props) {
  const [rawState, setRawState] = useState<unknown>(() => defaultExplorerState(model));
  const result = useMemo(() => safeExplore(model, rawState), [model, rawState]);
  const [announcement, setAnnouncement] = useState(`${model.materials.length} materials available.`);
  const current = result.state;

  useEffect(() => {
    const timer = window.setTimeout(() => setAnnouncement(result.kind === "failure"
      ? "Explorer state was reset. No stale rows are shown."
      : `${result.resultCount} materials shown in ${result.group.label}.`), 150);
    return () => window.clearTimeout(timer);
  }, [result]);

  const clear = () => {
    const group = model.groups.find(({ key }) => key === current.group)!;
    const field = group.fieldKeys.flatMap((key) => {
      const candidate = model.fields.find((item) => item.key === key);
      return candidate !== undefined && candidate.sort !== "none" ? [candidate] : [];
    })[0]!;
    setRawState({
      ...defaultExplorerState(model),
      group: current.group,
      sort: { field: field.key as ExplorerSortableField, direction: "asc" },
    });
  };

  return (
    <div class="data-explorer-island">
      <DataControls model={model} state={current} onChange={(state: ExplorerState) => setRawState(state)} onInvalid={() => setRawState({ invalid: true })} onClear={clear} />
      <p role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
      {result.kind === "failure" ? (
        <section role="alert"><h2>Data view reset</h2><p>The requested explorer state was not valid. No previous rows are shown.</p><button type="button" onClick={() => setRawState(defaultExplorerState(model))}>Reset explorer</button></section>
      ) : result.resultCount === 0 ? (
        <section class="data-no-results"><h2>No materials match</h2><p>Clear one or more filters to restore results.</p></section>
      ) : current.view === "table" ? (
        <DataTable result={result} onSort={(field) => setRawState({
          ...current,
          sort: {
            field,
            direction: current.sort.field === field && current.sort.direction === "asc" ? "desc" : "asc",
          },
        })} />
      ) : (
        <DataRecords result={result} />
      )}
    </div>
  );
}
