import { MaterialIdSchema, type MaterialId } from "../../data/schema/ids.ts";

export const SHORTLIST_LIMIT = 4;
export const SHORTLIST_LIMIT_ANNOUNCEMENT =
  "Shortlist holds up to 4 materials. Remove one before adding another.";

const INVALID_MATERIAL_ANNOUNCEMENT = "That material cannot be shortlisted.";

export type ShortlistState = readonly MaterialId[];

export type ShortlistFocusIntent =
  | Readonly<{ kind: "preserve-trigger" }>
  | Readonly<{ kind: "result-shortlist-control"; materialId: MaterialId }>
  | Readonly<{ kind: "shortlist-heading" }>
  | Readonly<{ kind: "results" }>;

export type ShortlistAction =
  | Readonly<{ type: "add"; materialId: unknown }>
  | Readonly<{
      type: "remove";
      materialId: unknown;
      currentResultIds: readonly unknown[];
    }>
  | Readonly<{ type: "clear" }>
  | Readonly<{ type: "criteria-changed" }>
  | Readonly<{ type: "criteria-reset" }>;

export type ShortlistTransition = Readonly<{
  ids: ShortlistState;
  announcement: string | null;
  focusIntent: ShortlistFocusIntent;
}>;

export type PresentedShortlistItem = Readonly<{
  materialId: MaterialId;
  status: "compatible" | "now-eliminated";
}>;

const unchanged = (
  ids: ShortlistState,
  announcement: string | null = null,
): ShortlistTransition => ({
  ids,
  announcement,
  focusIntent: { kind: "preserve-trigger" },
});

const parseMaterialId = (value: unknown): MaterialId | null => {
  const parsed = MaterialIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

/**
 * Apply one finite shortlist transition. The caller owns the returned state in
 * route-local component memory; this module has no browser or persistence API.
 */
export function reduceShortlist(ids: ShortlistState, action: ShortlistAction): ShortlistTransition {
  switch (action.type) {
    case "add": {
      const materialId = parseMaterialId(action.materialId);
      if (materialId === null) return unchanged(ids, INVALID_MATERIAL_ANNOUNCEMENT);
      if (ids.includes(materialId)) return unchanged(ids);
      if (ids.length >= SHORTLIST_LIMIT) {
        return unchanged(ids, SHORTLIST_LIMIT_ANNOUNCEMENT);
      }

      return {
        ids: [...ids, materialId],
        announcement: "Material added to shortlist.",
        focusIntent: { kind: "preserve-trigger" },
      };
    }

    case "remove": {
      const materialId = parseMaterialId(action.materialId);
      if (materialId === null) return unchanged(ids, INVALID_MATERIAL_ANNOUNCEMENT);
      if (!ids.includes(materialId)) return unchanged(ids);

      const currentResultIds = new Set(
        action.currentResultIds.flatMap((value) => {
          const parsed = parseMaterialId(value);
          return parsed === null ? [] : [parsed];
        }),
      );

      const remainingIds = ids.filter((id) => id !== materialId);
      return {
        ids: remainingIds,
        announcement: "Material removed from shortlist.",
        focusIntent:
          remainingIds.length === 0
            ? { kind: "results" }
            : currentResultIds.has(materialId)
              ? { kind: "result-shortlist-control", materialId }
              : { kind: "shortlist-heading" },
      };
    }

    case "clear":
      if (ids.length === 0) return unchanged(ids);
      return {
        ids: [],
        announcement: "Shortlist cleared.",
        focusIntent: { kind: "results" },
      };

    case "criteria-changed":
    case "criteria-reset":
      return unchanged(ids);
  }
}

/** Retain shortlist insertion order while projecting status from current results. */
export function presentShortlist(
  ids: ShortlistState,
  compatibleMaterialIds: readonly MaterialId[],
): readonly PresentedShortlistItem[] {
  const compatible = new Set(
    compatibleMaterialIds.flatMap((value) => {
      const parsed = parseMaterialId(value);
      return parsed === null ? [] : [parsed];
    }),
  );

  return ids.map((materialId) => ({
    materialId,
    status: compatible.has(materialId) ? "compatible" : "now-eliminated",
  }));
}
