/** @jsxImportSource preact */
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import type { PreparedSelectorActionRuntime } from "../../features/selector/action-runtime.ts";
import type {
  SelectorClientModel,
  SelectorRuntimePageModel,
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
import {
  presentShortlist,
  reduceShortlist,
  type ShortlistAction,
  type ShortlistFocusIntent,
  type ShortlistState,
} from "../../features/selector/shortlist.ts";
import { SelectorControls } from "./SelectorControls.tsx";
import type { SelectorResultsProps } from "./SelectorResults.tsx";

type Props = Readonly<{ pageModel?: SelectorClientModel; bootstrap?: SelectorBootstrap }>;
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

export function SelectorIsland({ pageModel, bootstrap }: Props) {
  if (!bootstrap)
    return <SelectorRecoveryIsland {...(pageModel ? { pageModel } : {})} />;
  return <SelectorRuntimeIsland {...(pageModel ? { pageModel } : {})} bootstrap={bootstrap} />;
}

function SelectorRecoveryIsland({ pageModel }: Readonly<{ pageModel?: SelectorClientModel }>) {
  const [recovered, setRecovered] = useState<SelectorBootstrap | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!pageModel) {
      setFailed(true);
      return;
    }
    let disposed = false;
    void import("../../features/selector/action-runtime.ts")
      .then(({ prepareSelectorActionRuntime }) => {
        const runtime = prepareSelectorActionRuntime(document, pageModel);
        const next = buildSelectorBootstrap(
          runtime.pageModel,
          runtime.evaluate(runtime.pageModel.defaults),
        );
        if (!disposed) setRecovered(next);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
    };
  }, [pageModel]);

  if (recovered)
    return (
      <SelectorRuntimeIsland {...(pageModel ? { pageModel } : {})} bootstrap={recovered} />
    );
  if (!failed) return <div class="selector-controls-runtime" aria-busy="true" />;
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

type EvaluatedState = Readonly<{
  pageModel: SelectorRuntimePageModel;
  presentation: SelectorPresentation;
}>;

function SelectorRuntimeIsland({
  pageModel,
  bootstrap,
}: Readonly<{ pageModel?: SelectorClientModel; bootstrap: SelectorBootstrap }>) {
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
  const pendingCalculationOpenRef = useRef<MaterialId | null>(null);
  const rendererPromiseRef = useRef<Promise<ResultsRenderer> | null>(null);
  const rendererRef = useRef<ResultsRenderer | null>(null);
  const renderQueuedRef = useRef(false);
  const renderedPropsRef = useRef<SelectorResultsProps | null>(null);
  const [, requestResultsRender] = useState(0);
  const activationFailedRef = useRef(false);
  const disposedRef = useRef(false);
  const latestResultsPropsRef = useRef<SelectorResultsProps | null>(null);
  const staticActionRef = useRef<(action: string, materialId?: string) => void>(() => undefined);
  const runtimeRef = useRef<PreparedSelectorActionRuntime | null>(null);
  const runtimePromiseRef = useRef<Promise<PreparedSelectorActionRuntime> | null>(null);
  const latestEvaluationRef = useRef(0);

  const prepareRuntime = async (): Promise<PreparedSelectorActionRuntime | null> => {
    if (runtimeRef.current) return runtimeRef.current;
    try {
      const runtime = await (runtimePromiseRef.current ??=
        import("../../features/selector/action-runtime.ts").then(
          ({ prepareSelectorActionRuntime }) => prepareSelectorActionRuntime(document, pageModel),
        ));
      return (runtimeRef.current ??= runtime);
    } catch {
      setAnnouncementOverride(SELECTOR_COPY.errorState);
      return null;
    }
  };

  const evaluateForResults = async (input: Readonly<Record<string, unknown>>): Promise<boolean> => {
    const evaluation = ++latestEvaluationRef.current;
    const runtime = await prepareRuntime();
    if (!runtime) return false;
    if (disposedRef.current || evaluation !== latestEvaluationRef.current) return false;
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
    if (evaluated) void evaluateForResults(bootstrap.defaults);
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
    void evaluateForResults(selection);
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
    const openCalculationIds = new Set(
      Array.from(mount.querySelectorAll<HTMLElement>(".selector-compatible-list > li")).flatMap(
        (item) => {
          const details = item.querySelector<HTMLDetailsElement>("details.selector-calculation");
          const materialId = item.querySelector<HTMLButtonElement>("button[data-material-id]")
            ?.dataset.materialId;
          return details?.open && isMaterialIdValue(materialId) ? [materialId] : [];
        },
      ),
    );
    if (pendingCalculationOpenRef.current) {
      openCalculationIds.add(pendingCalculationOpenRef.current);
    }
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
        renderedPropsRef.current = props;
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
        if (pendingCalculationOpenRef.current) {
          const calculationTrigger = mount
            .querySelector<HTMLButtonElement>(
              `button[data-material-id="${pendingCalculationOpenRef.current}"]`,
            )
            ?.closest("li")
            ?.querySelector<HTMLElement>("details.selector-calculation > summary");
          pendingCalculationOpenRef.current = null;
          calculationTrigger?.focus();
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
        if (!disposedRef.current && latestResultsPropsRef.current !== renderedPropsRef.current) {
          requestResultsRender((revision) => revision + 1);
        }
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
      void evaluateForResults(selection);
    } else if (action === "expand-calculation") {
      if (!isMaterialIdValue(materialId) || !compatibleIds.includes(materialId as MaterialId)) {
        setAnnouncementOverride(SELECTOR_COPY.errorState);
        return;
      }
      pendingCalculationOpenRef.current = materialId as MaterialId;
      void evaluateForResults(selection);
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
      if (action !== "toggle-shortlist" && action !== "show-all" && action !== "expand-calculation")
        return;
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
          void evaluateForResults(next);
          setShortlistIds(reduceShortlist(shortlistIds, { type: "criteria-changed" }).ids);
        }}
        onInvalid={(criterionId) => {
          setAnnouncementOverride(null);
          void evaluateForResults({ ...selection, [criterionId]: null });
        }}
        onView={focusResultsHeading}
        onReset={reset}
      />
      <SelectorStatus message={announcement} immediate={announcementOverride !== null} />
    </div>
  );
}
