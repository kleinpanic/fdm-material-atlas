/** @jsxImportSource preact */
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import {
  decodeSelectorClientModel,
  type SelectorClientModel,
  type SelectorRuntimePageModel,
} from "../../features/selector/client-model.ts";
import {
  buildSelectorBootstrap,
  selectorPresentationAnnouncement,
  type SelectorBootstrap,
} from "../../features/selector/bootstrap.ts";
import type { MaterialId } from "../../data/schema/ids.ts";
import { isMaterialIdValue } from "../../data/schema/public-id-values.ts";
import { SELECTOR_COPY } from "../../features/selector/copy.ts";
import type { SelectorPresentation } from "../../features/selector/presentation.ts";
import { prepareSelectorPresentationEvaluator } from "../../features/selector/runtime-evaluator.ts";
import {
  presentShortlist,
  reduceShortlist,
  type ShortlistAction,
  type ShortlistFocusIntent,
  type ShortlistState,
} from "../../features/selector/shortlist.ts";
import { SelectorControls } from "./SelectorControls.tsx";
import type { SelectorResultsProps } from "./SelectorResults.tsx";

type Props = Readonly<{ pageModel: SelectorClientModel; bootstrap?: SelectorBootstrap }>;
type ResultsRenderer = typeof import("./render-selector-results.tsx");
const RESULTS_MOUNT_ID = "selector-results-mount";

function SelectorStatus({ message, immediate }: Readonly<{ message: string; immediate: boolean }>) {
  const [announcement, setAnnouncement] = useState<string>(message);
  const previousMessage = useRef<string>(message);

  useEffect(() => {
    if (previousMessage.current === message) return;
    previousMessage.current = message;
    if (immediate) {
      setAnnouncement(message);
      return;
    }
    const timer = window.setTimeout(() => setAnnouncement(message), 150);
    return () => window.clearTimeout(timer);
  }, [immediate, message]);

  return (
    <p class="selector-status" role="status" aria-live="polite" aria-atomic="true">
      {announcement}
    </p>
  );
}

function recoverBootstrap(pageModel: SelectorClientModel): SelectorBootstrap | null {
  try {
    const runtimeModel = decodeSelectorClientModel(pageModel);
    const evaluate = prepareSelectorPresentationEvaluator(runtimeModel);
    return buildSelectorBootstrap(runtimeModel, evaluate(runtimeModel.defaults));
  } catch {
    return null;
  }
}

export function SelectorIsland({ pageModel, bootstrap }: Props) {
  const initialBootstrap = bootstrap ?? recoverBootstrap(pageModel);
  if (initialBootstrap === null) {
    return (
      <div class="selector-controls-runtime">
        <section class="selector-error" role="alert">
          <h2>Recommendations are unavailable</h2>
          <p>{SELECTOR_COPY.errorState}</p>
          <p>{SELECTOR_COPY.errorAction}</p>
        </section>
      </div>
    );
  }
  return <SelectorRuntimeIsland pageModel={pageModel} bootstrap={initialBootstrap} />;
}

type PreparedRuntime = Readonly<{
  pageModel: SelectorRuntimePageModel;
  evaluate: ReturnType<typeof prepareSelectorPresentationEvaluator>;
}>;

type EvaluatedState = Readonly<{
  pageModel: SelectorRuntimePageModel;
  presentation: SelectorPresentation;
}>;

function SelectorRuntimeIsland({
  pageModel,
  bootstrap,
}: Readonly<{ pageModel: SelectorClientModel; bootstrap: SelectorBootstrap }>) {
  const [selection, setSelection] = useState<Readonly<Record<string, string>>>(
    () => bootstrap.defaults,
  );
  const [evaluated, setEvaluated] = useState<EvaluatedState | null>(null);
  const [announcementOverride, setAnnouncementOverride] = useState<string | null>(null);
  const [shortlistIds, setShortlistIds] = useState<ShortlistState>([]);
  const [showAll, setShowAll] = useState(false);
  const [eliminationsOpen, setEliminationsOpen] = useState(false);
  const [resultsActive, setResultsActive] = useState(false);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const shortlistHeadingRef = useRef<HTMLHeadingElement>(null);
  const primaryFirstRef = useRef<HTMLInputElement>(null);
  const secondaryDetailsRef = useRef<HTMLDetailsElement>(null);
  const secondarySummaryRef = useRef<HTMLElement>(null);
  const resultControlRefs = useRef(new Map<MaterialId, HTMLButtonElement>());
  const pendingFocusIntentRef = useRef<ShortlistFocusIntent | null>(null);
  const pendingPreservedMaterialRef = useRef<MaterialId | null>(null);
  const rendererPromiseRef = useRef<Promise<ResultsRenderer> | null>(null);
  const rendererRef = useRef<ResultsRenderer | null>(null);
  const renderQueuedRef = useRef(false);
  const activationFailedRef = useRef(false);
  const disposedRef = useRef(false);
  const latestResultsPropsRef = useRef<SelectorResultsProps | null>(null);
  const staticActionRef = useRef<(action: string, materialId?: string) => void>(() => undefined);
  const runtimeRef = useRef<PreparedRuntime | null>(null);

  const prepareRuntime = (): PreparedRuntime | null => {
    if (runtimeRef.current) return runtimeRef.current;
    try {
      const runtimeModel = decodeSelectorClientModel(pageModel);
      return (runtimeRef.current ??= Object.freeze({
        pageModel: runtimeModel,
        evaluate: prepareSelectorPresentationEvaluator(runtimeModel),
      }));
    } catch {
      setAnnouncementOverride(SELECTOR_COPY.errorState);
      return null;
    }
  };

  const evaluateForResults = (input: Readonly<Record<string, unknown>>): boolean => {
    const runtime = prepareRuntime();
    if (!runtime) return false;
    setEvaluated(
      Object.freeze({ pageModel: runtime.pageModel, presentation: runtime.evaluate(input) }),
    );
    setResultsActive(true);
    return true;
  };

  const presentation = evaluated?.presentation;
  const compatibleIds =
    presentation?.kind === "ranked"
      ? presentation.compatible.map(({ materialId }) => materialId)
      : bootstrap.defaultCompatibleIds;
  const shortlist = presentShortlist(shortlistIds, compatibleIds);
  const announcement =
    announcementOverride ??
    (presentation ? selectorPresentationAnnouncement(presentation) : bootstrap.defaultAnnouncement);

  const focusResultsHeading = () => {
    const mount = document.getElementById(RESULTS_MOUNT_ID);
    (
      resultsHeadingRef.current ??
      mount?.querySelector<HTMLHeadingElement>("#selector-results-heading")
    )?.focus();
  };

  const applyPendingFocus = () => {
    const preservedMaterial = pendingPreservedMaterialRef.current;
    pendingPreservedMaterialRef.current = null;
    if (preservedMaterial) {
      (resultControlRefs.current.get(preservedMaterial) ?? resultsHeadingRef.current)?.focus();
      return;
    }
    const intent = pendingFocusIntentRef.current;
    pendingFocusIntentRef.current = null;
    if (!intent || intent.kind === "preserve-trigger") return;
    if (intent.kind === "result-shortlist-control") {
      (resultControlRefs.current.get(intent.materialId) ?? resultsHeadingRef.current)?.focus();
    } else if (intent.kind === "shortlist-heading") {
      (shortlistHeadingRef.current ?? resultsHeadingRef.current)?.focus();
    } else {
      resultsHeadingRef.current?.focus();
    }
  };

  const reset = () => {
    setSelection(bootstrap.defaults);
    if (evaluated) evaluateForResults(bootstrap.defaults);
    const transition = reduceShortlist(shortlistIds, { type: "criteria-reset" });
    setShortlistIds(transition.ids);
    setAnnouncementOverride("Selector reset to published defaults.");
  };

  const applyShortlist = (action: ShortlistAction) => {
    const transition = reduceShortlist(shortlistIds, action);
    if (
      !resultsActive &&
      (action.type === "add" || action.type === "remove") &&
      isMaterialIdValue(action.materialId)
    ) {
      pendingPreservedMaterialRef.current = action.materialId;
    }
    pendingFocusIntentRef.current = transition.focusIntent;
    setShortlistIds(transition.ids);
    if (transition.announcement) setAnnouncementOverride(transition.announcement);
    evaluateForResults(selection);
  };

  const resultsProps: SelectorResultsProps | null = evaluated
    ? {
        pageModel: evaluated.pageModel,
        presentation: evaluated.presentation,
        shortlist,
        showAll,
        eliminationsOpen,
        resultsHeadingRef,
        shortlistHeadingRef,
        registerResultControl: (materialId, element) => {
          if (element) resultControlRefs.current.set(materialId, element);
          else resultControlRefs.current.delete(materialId);
        },
        onShowAll: () => setShowAll(true),
        onEliminationsToggle: setEliminationsOpen,
        onToggleShortlist: (materialId) =>
          applyShortlist(
            shortlistIds.includes(materialId)
              ? { type: "remove", materialId, currentResultIds: compatibleIds }
              : { type: "add", materialId },
          ),
        onClearShortlist: () => applyShortlist({ type: "clear" }),
        onReview: (target) => {
          if (target === "secondary-summary") {
            if (secondaryDetailsRef.current) secondaryDetailsRef.current.open = true;
            secondarySummaryRef.current?.focus();
          } else {
            primaryFirstRef.current?.focus();
          }
        },
        onReset: reset,
      }
    : null;
  latestResultsPropsRef.current = resultsProps;

  useLayoutEffect(() => {
    if (!resultsActive || !resultsProps || renderQueuedRef.current || activationFailedRef.current)
      return;
    const mount = document.getElementById(RESULTS_MOUNT_ID);
    if (!mount) {
      activationFailedRef.current = true;
      setAnnouncementOverride(SELECTOR_COPY.errorState);
      return;
    }
    renderQueuedRef.current = true;
    mount.setAttribute("aria-busy", "true");
    const openCalculationIds = Array.from(
      mount.querySelectorAll<HTMLElement>(".selector-compatible-list > li"),
    ).flatMap((item) => {
      const details = item.querySelector<HTMLDetailsElement>("details.selector-calculation");
      const materialId = item.querySelector<HTMLButtonElement>("button[data-material-id]")?.dataset
        .materialId;
      return details?.open && isMaterialIdValue(materialId) ? [materialId] : [];
    });
    const eliminationsWereOpen =
      mount.querySelector<HTMLDetailsElement>("details.selector-eliminated")?.open ?? false;
    const rendererPromise = rendererRef.current
      ? Promise.resolve(rendererRef.current)
      : (rendererPromiseRef.current ??= import("./render-selector-results.tsx"));
    void rendererPromise
      .then((renderer) => {
        if (disposedRef.current) return;
        rendererRef.current = renderer;
        const props = latestResultsPropsRef.current;
        if (!props) throw new Error("SELECTOR_RESULTS_PROPS_MISSING");
        if (mount.dataset.selectorResultsOwner !== "client") {
          mount.replaceChildren();
          mount.dataset.selectorResultsOwner = "client";
        }
        renderer.renderSelectorResults(mount, props);
        for (const materialId of openCalculationIds) {
          const button = mount.querySelector<HTMLButtonElement>(
            `button[data-material-id="${materialId}"]`,
          );
          const details = button
            ?.closest("li")
            ?.querySelector<HTMLDetailsElement>("details.selector-calculation");
          if (details) details.open = true;
        }
        const eliminations = mount.querySelector<HTMLDetailsElement>("details.selector-eliminated");
        if (eliminations && eliminationsWereOpen) eliminations.open = true;
        mount.setAttribute("aria-busy", "false");
        applyPendingFocus();
      })
      .catch(() => {
        activationFailedRef.current = true;
        mount.setAttribute("aria-busy", "false");
        setAnnouncementOverride(SELECTOR_COPY.errorState);
      })
      .finally(() => {
        renderQueuedRef.current = false;
      });
  }, [resultsActive, resultsProps]);

  staticActionRef.current = (action, materialId) => {
    if (action === "toggle-shortlist") {
      if (!isMaterialIdValue(materialId) || !compatibleIds.includes(materialId as MaterialId)) {
        setAnnouncementOverride(SELECTOR_COPY.errorState);
        return;
      }
      applyShortlist({ type: "add", materialId: materialId as MaterialId });
    } else if (action === "show-all") {
      setShowAll(true);
      evaluateForResults(selection);
    }
  };

  useEffect(() => {
    const mount = document.getElementById(RESULTS_MOUNT_ID);
    if (!mount) return;
    const onClick = (event: MouseEvent) => {
      if (mount.dataset.selectorResultsOwner === "client" || !(event.target instanceof Element)) {
        return;
      }
      const button = event.target.closest<HTMLButtonElement>("button[data-selector-command]");
      if (!button || !mount.contains(button) || button.type !== "button") return;
      const action = button.dataset.selectorCommand;
      if (action !== "toggle-shortlist" && action !== "show-all") return;
      event.preventDefault();
      staticActionRef.current(action, button.dataset.materialId);
    };
    mount.addEventListener("click", onClick);
    return () => mount.removeEventListener("click", onClick);
  }, []);

  useEffect(
    () => () => {
      disposedRef.current = true;
      const mount = document.getElementById(RESULTS_MOUNT_ID);
      if (mount?.dataset.selectorResultsOwner === "client") {
        rendererRef.current?.unmountSelectorResults(mount);
      }
    },
    [],
  );

  return (
    <div class="selector-controls-runtime">
      <SelectorControls
        pageModel={bootstrap.controls}
        selection={selection}
        primaryFirstRef={primaryFirstRef}
        secondaryDetailsRef={secondaryDetailsRef}
        secondarySummaryRef={secondarySummaryRef}
        onChange={(criterionId, optionId) => {
          const next = { ...selection, [criterionId]: optionId };
          setAnnouncementOverride(null);
          setSelection(next);
          evaluateForResults(next);
          setShortlistIds(reduceShortlist(shortlistIds, { type: "criteria-changed" }).ids);
        }}
        onInvalid={(criterionId) => {
          setAnnouncementOverride(null);
          evaluateForResults({ ...selection, [criterionId]: null });
        }}
        onView={focusResultsHeading}
        onReset={reset}
      />
      <SelectorStatus message={announcement} immediate={announcementOverride !== null} />
    </div>
  );
}
