import { describe, expect, it } from "vitest";

import type { MaterialId } from "../../src/data/schema/ids.ts";
import {
  SHORTLIST_LIMIT_ANNOUNCEMENT,
  presentShortlist,
  reduceShortlist,
  type ShortlistState,
} from "../../src/features/selector/shortlist.ts";

const id = (value: string): MaterialId => value as MaterialId;
const A = id("material-alpha");
const B = id("material-beta");
const C = id("material-charlie");
const D = id("material-delta");
const E = id("material-echo");

const empty: ShortlistState = [];

describe("reduceShortlist", () => {
  it("adds a valid material to the end without mutating the prior state", () => {
    const before = Object.freeze([A]) satisfies ShortlistState;
    const result = reduceShortlist(before, { type: "add", materialId: B });

    expect(result.ids).toEqual([A, B]);
    expect(result.ids).not.toBe(before);
    expect(before).toEqual([A]);
    expect(result.focusIntent).toEqual({ kind: "preserve-trigger" });
  });

  it("keeps duplicate additions unique and in their original position", () => {
    expect(reduceShortlist([A, B], { type: "add", materialId: A }).ids).toEqual([A, B]);
  });

  it("rejects a fifth material with the exact bounded-list announcement", () => {
    const before = Object.freeze([A, B, C, D]) satisfies ShortlistState;
    const result = reduceShortlist(before, { type: "add", materialId: E });

    expect(result.ids).toEqual(before);
    expect(result.announcement).toBe(SHORTLIST_LIMIT_ANNOUNCEMENT);
    expect(result.announcement).toBe(
      "Shortlist holds up to 4 materials. Remove one before adding another.",
    );
    expect(result.focusIntent).toEqual({ kind: "preserve-trigger" });
  });

  it("removes a material while retaining the remaining insertion order", () => {
    const result = reduceShortlist([A, B, C], {
      type: "remove",
      materialId: B,
      currentResultIds: [A, B, C],
    });

    expect(result.ids).toEqual([A, C]);
    expect(result.focusIntent).toEqual({ kind: "result-shortlist-control", materialId: B });
  });

  it("focuses the shortlist heading after removing an item absent from current results", () => {
    const result = reduceShortlist([A, B], {
      type: "remove",
      materialId: B,
      currentResultIds: [A],
    });

    expect(result.focusIntent).toEqual({ kind: "shortlist-heading" });
  });

  it("focuses the results heading when removal unmounts the final shortlist", () => {
    const result = reduceShortlist([A], {
      type: "remove",
      materialId: A,
      currentResultIds: [],
    });

    expect(result.ids).toEqual([]);
    expect(result.focusIntent).toEqual({ kind: "results" });
  });

  it("clears only after an explicit clear action", () => {
    const result = reduceShortlist([A, B], { type: "clear" });
    expect(result.ids).toEqual([]);
    expect(result.focusIntent).toEqual({ kind: "results" });
  });

  it("does not clear or reorder IDs when criteria change or reset", () => {
    const before = Object.freeze([B, A]) satisfies ShortlistState;

    expect(reduceShortlist(before, { type: "criteria-changed" }).ids).toEqual([B, A]);
    expect(reduceShortlist(before, { type: "criteria-reset" }).ids).toEqual([B, A]);
  });

  it("rejects malformed and wrong-namespace material identifiers", () => {
    const malformed = reduceShortlist(empty, { type: "add", materialId: "not a material" });
    const wrongNamespace = reduceShortlist(empty, { type: "add", materialId: "source-alpha" });

    expect(malformed.ids).toEqual([]);
    expect(wrongNamespace.ids).toEqual([]);
    expect(malformed.announcement).toBe("That material cannot be shortlisted.");
  });

  it.each([
    "material-",
    "material-UPPER",
    "material-two--segments",
    `material-${"a".repeat(152)}`,
    { toString: () => "material-alpha" },
  ])("rejects the bounded material ID edge case", (materialId) => {
    expect(reduceShortlist(empty, { type: "add", materialId }).ids).toEqual([]);
  });

  it("treats removal of an absent valid ID as a deterministic no-op", () => {
    const result = reduceShortlist([A], {
      type: "remove",
      materialId: B,
      currentResultIds: [A],
    });

    expect(result.ids).toEqual([A]);
    expect(result.focusIntent).toEqual({ kind: "preserve-trigger" });
  });
});

describe("presentShortlist", () => {
  it("retains every shortlisted ID and labels current compatibility", () => {
    expect(presentShortlist([B, A, C], [A, C])).toEqual([
      { materialId: B, status: "now-eliminated" },
      { materialId: A, status: "compatible" },
      { materialId: C, status: "compatible" },
    ]);
  });

  it("does not mutate the shortlist or compatible collection", () => {
    const shortlist = Object.freeze([A, B]) satisfies ShortlistState;
    const compatible = Object.freeze([B]) satisfies readonly MaterialId[];

    presentShortlist(shortlist, compatible);

    expect(shortlist).toEqual([A, B]);
    expect(compatible).toEqual([B]);
  });
});
