/** @jsxImportSource preact */
import { useEffect, useMemo, useState } from "preact/hooks";

import {
  defaultExplorerState,
  type ExplorerState,
  type ExplorerSortableField,
} from "../../features/data-explorer/explore.ts";
import type { DataExplorerModel } from "../../features/data-explorer/model.ts";
import type { DataExplorerPayload } from "../../features/data-explorer/payload.ts";
import { safeExplore } from "../../features/data-explorer/safe-explore.ts";
import { DataControls } from "./DataControls.tsx";
import { DataRecords } from "./DataRecords.tsx";
import { DataTable } from "./DataTable.tsx";

type Props = Readonly<{ payload: DataExplorerPayload }>;

const MAX_COMPRESSED_BYTES = 256 * 1024;
const MAX_MODEL_BYTES = 4 * 1024 * 1024;

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = window.atob(value);
  if (binary.length === 0 || binary.length > MAX_COMPRESSED_BYTES) throw new Error("PAYLOAD_SIZE");
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function decodeDataExplorerModel(gzipBase64: string): Promise<DataExplorerModel> {
  const stream = new Blob([decodeBase64(gzipBase64)])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_MODEL_BYTES) {
      await reader.cancel();
      throw new Error("PAYLOAD_SIZE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as DataExplorerModel;
}

function ExplorerStatus({ message }: Readonly<{ message: string }>) {
  return (
    <p role="status" aria-live="polite" aria-atomic="true">
      {message}
    </p>
  );
}

export function DataExplorerIsland({ payload }: Props) {
  const [model, setModel] = useState<DataExplorerModel | null>(null);
  const [rawState, setRawState] = useState<unknown>(null);
  const result = useMemo(
    () => (model === null ? null : safeExplore(model, rawState)),
    [model, rawState],
  );
  const [announcement, setAnnouncement] = useState(
    `${payload.index.length} materials are preparing.`,
  );

  useEffect(() => {
    let active = true;
    void decodeDataExplorerModel(payload.gzipBase64)
      .then((decoded) => {
        if (!active) return;
        setModel(decoded);
        setRawState(defaultExplorerState(decoded));
        setAnnouncement(`${decoded.materials.length} materials available.`);
      })
      .catch(() => {
        if (!active) return;
        setAnnouncement("The material data explorer could not be prepared.");
      });
    return () => {
      active = false;
    };
  }, [payload.gzipBase64]);

  useEffect(() => {
    if (result === null) return;
    const timer = window.setTimeout(
      () =>
        setAnnouncement(
          result.kind === "failure"
            ? "Explorer state was reset. No stale rows are shown."
            : `${result.resultCount} materials shown in ${result.group.label}.`,
        ),
      150,
    );
    return () => window.clearTimeout(timer);
  }, [result]);

  if (model === null || result === null) {
    return (
      <div class="data-explorer-island" aria-busy="true">
        <ExplorerStatus message={announcement} />
        <p>Preparing the complete material data explorer.</p>
      </div>
    );
  }

  const current = result.state;

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
      <DataControls
        model={model}
        state={current}
        onChange={(update: (state: ExplorerState) => ExplorerState) =>
          setRawState((previous: unknown) => update(safeExplore(model, previous).state))
        }
        onInvalid={() => setRawState({ invalid: true })}
        onClear={clear}
      />
      <ExplorerStatus message={announcement} />
      {result.kind === "failure" ? (
        <section role="alert">
          <h2>Data view reset</h2>
          <p>The requested explorer state was not valid. No previous rows are shown.</p>
          <button type="button" onClick={() => setRawState(defaultExplorerState(model))}>
            Reset explorer
          </button>
        </section>
      ) : result.resultCount === 0 ? (
        <section class="data-no-results">
          <h2>No materials match</h2>
          <p>Clear one or more filters to restore results.</p>
        </section>
      ) : current.view === "table" ? (
        <DataTable
          result={result}
          onSort={(field) =>
            setRawState({
              ...current,
              sort: {
                field,
                direction:
                  current.sort.field === field && current.sort.direction === "asc" ? "desc" : "asc",
              },
            })
          }
        />
      ) : (
        <DataRecords result={result} />
      )}
    </div>
  );
}
