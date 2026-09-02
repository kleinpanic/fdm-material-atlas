/** @jsxImportSource preact */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import type { ComparisonModel, ComparisonSuccess } from "../../features/comparison/contracts.ts";
import type { ComparisonPayload } from "../../features/comparison/payload.ts";
import { safeCompare } from "../../features/comparison/safe-compare.ts";
import {
  decodeCompareUrlState,
  encodeCompareUrlState,
} from "../../features/comparison/url-state.ts";
import { CompareSelection } from "./CompareSelection.tsx";
import { ComparisonGroups } from "./ComparisonGroups.tsx";

type Props = Readonly<{
  payload: ComparisonPayload;
  base?: string | undefined;
  historyPath?: string | undefined;
}>;
type ViewState = "preparing" | "empty" | "invalid" | "ready" | "failure";

const INVALID_COPY =
  "The comparison link is not valid. Choose two to four different materials and update the comparison.";
const FAILURE_COPY = "The comparison could not be prepared. Choose the materials again and retry.";

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = window.atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function decodeComparisonModel(gzipBase64: string): Promise<ComparisonModel> {
  const compressed = decodeBase64(gzipBase64);
  const decompressed = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  return (await new Response(decompressed).json()) as ComparisonModel;
}

export function CompareIsland({ payload, base, historyPath }: Props) {
  const knownIds = useMemo(() => payload.index.map(({ id }) => id), [payload.index]);
  const modelPromise = useRef<Promise<ComparisonModel> | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [slots, setSlots] = useState<readonly string[]>(["", "", "", ""]);
  const [view, setView] = useState<ViewState>("preparing");
  const [result, setResult] = useState<ComparisonSuccess | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("Comparison controls are preparing.");

  const loadModel = () => {
    modelPromise.current ??= decodeComparisonModel(payload.gzipBase64);
    return modelPromise.current;
  };

  useEffect(() => {
    let active = true;
    setHydrated(true);
    const decoded = decodeCompareUrlState(window.location.search, knownIds);
    if (decoded.kind === "empty") {
      setView("empty");
      setAnnouncement("Choose at least two materials to begin a comparison.");
      return;
    }
    if (decoded.kind === "invalid") {
      setView("invalid");
      setSelectionError(INVALID_COPY);
      setAnnouncement("Comparison link is not valid.");
      return;
    }
    setSlots([...decoded.materialIds, ...Array(4 - decoded.materialIds.length).fill("")]);
    void loadModel()
      .then((model) => {
        if (!active) return;
        const compared = safeCompare(model, decoded.materialIds);
        if (compared.kind === "failure") {
          setView("failure");
          setAnnouncement("Comparison is unavailable.");
          return;
        }
        setResult(compared);
        setView("ready");
        setAnnouncement(
          `${compared.materials.length} materials loaded with ${compared.differenceCount} differences.`,
        );
      })
      .catch(() => {
        if (!active) return;
        setView("failure");
        setAnnouncement("Comparison is unavailable.");
      });
    return () => {
      active = false;
    };
  }, [knownIds, payload.gzipBase64]);

  const updateComparison = async () => {
    const selected = slots.filter((value) => value !== "");
    const encoded = encodeCompareUrlState(selected, knownIds, base, window.location.href);
    if (encoded.kind === "invalid") {
      setResult(null);
      setView("invalid");
      setSelectionError(INVALID_COPY);
      setAnnouncement("Comparison selection is not valid.");
      return;
    }
    setView("preparing");
    setAnnouncement("Preparing the selected comparison.");
    const model = await loadModel().catch(() => null);
    const compared = model === null ? null : safeCompare(model, encoded.materialIds);
    if (compared === null) {
      setResult(null);
      setView("failure");
      setSelectionError(FAILURE_COPY);
      setAnnouncement("Comparison is unavailable.");
      return;
    }
    if (compared.kind === "failure") {
      setResult(null);
      setView("failure");
      setSelectionError(FAILURE_COPY);
      setAnnouncement("Comparison is unavailable.");
      return;
    }
    const nextHref =
      historyPath === undefined
        ? encoded.href
        : `${historyPath}${new URL(encoded.href, window.location.origin).search}`;
    window.history.replaceState(null, "", nextHref);
    setSelectionError(null);
    setResult(compared);
    setView("ready");
    setAnnouncement(
      `${compared.materials.length} materials compared; ${compared.differenceCount} differences.`,
    );
  };

  return (
    <div class="compare-island">
      <CompareSelection
        materials={payload.index}
        slots={slots}
        disabled={!hydrated}
        error={selectionError}
        onChange={(index, value) => {
          const next = [...slots];
          next[index] = value;
          setSlots(next);
          setSelectionError(null);
        }}
        onSubmit={updateComparison}
      />
      <p role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {view === "preparing" ? <p>Comparison controls are preparing.</p> : null}
      {view === "empty" ? <p>Choose two to four materials, then update the comparison.</p> : null}
      {view === "invalid" ? (
        <section role="alert">
          <h2>Comparison link is not valid</h2>
          <p>{INVALID_COPY}</p>
        </section>
      ) : null}
      {view === "failure" ? (
        <section role="alert">
          <h2>Comparison unavailable</h2>
          <p>{FAILURE_COPY}</p>
        </section>
      ) : null}
      {view === "ready" && result !== null ? (
        <section class="comparison-results" aria-labelledby="comparison-results-heading">
          <div class="comparison-results__summary">
            <h2 id="comparison-results-heading">
              Comparison of {result.materials.length} materials
            </h2>
            <p>
              This comparison shows differences in published guidance. It does not rank a
              universally better material.
            </p>
            <p>
              {result.differenceCount} differing attributes across {result.groups.length} groups.
            </p>
            <ul>
              {result.materials.map((material) => (
                <li key={material.id}>
                  <a href={material.href}>Open {material.name} material reference</a>
                </li>
              ))}
            </ul>
          </div>
          <ComparisonGroups result={result} />
        </section>
      ) : null}
    </div>
  );
}
