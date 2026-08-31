import { describe, expect, it } from "vitest";

import {
  SELECTOR_COPY,
  eliminatedDisclosure,
  shortlistAddLabel,
  shortlistRemoveLabel,
} from "../../src/features/selector/copy.ts";

describe("selector copy contract", () => {
  it("matches the approved orientation and ranking copy exactly", () => {
    expect(SELECTOR_COPY).toMatchObject({
      eyebrow: "Material selector",
      heading: "Choose a material that fits your process",
      taskDescription: "Set an application goal and the process constraints your printer can meet. Results explain alignment points and every hard constraint that removes a material.",
      alignmentHeading: "What the score means",
      alignmentBody: "Alignment scores reflect only the criteria you selected. They do not rank universal material quality, strength, safety, or engineering suitability.",
      rankingExplanation: "Results are sorted by alignment points, then by stable material ID when scores tie.",
      applicableMaximumNote: "The applicable maximum includes only selected choices that define an alignment preference.",
      compatibleHeading: "Compatible materials",
      compatibleCountLabel: "Compatible",
      highestAlignment: "Highest alignment",
      compatibleState: "Compatible with selected constraints",
    });
  });

  it("matches approved no-compatible, recovery, hydration, and empty copy exactly", () => {
    expect(SELECTOR_COPY).toMatchObject({
      noCompatibleHeading: "No materials match every selected constraint",
      noCompatibleBody: "Every material was removed by at least one selected hard constraint. Your selections have not changed. Review the reasons below, then choose which constraint you want to reconsider.",
      reviewSecondary: "Review printer and process constraints",
      reviewPrimary: "Choose a different application goal",
      errorState: "These selector choices could not be evaluated. Reset the selector to the published defaults and try again.",
      errorAction: "Reset selector",
      hydrationStatus: "Selector is preparing",
      noScript: "Interactive filtering needs JavaScript. The published default results remain available below.",
      emptyHeading: "No validated material records are available",
      emptyBody: "The selector cannot rank materials without a validated public dataset. This build must not be published.",
    });
  });

  it("centralizes exact unavailable-route and exclusion state text", () => {
    expect(SELECTOR_COPY).toMatchObject({
      confirmedExclusion: "Blocked by selected constraint",
      indeterminateExclusion: "Cannot verify — treated as incompatible",
      eliminatedHelp: "Open to review every hard constraint that removed a material.",
      detailsUnavailable: "Material details are not available yet",
      profileUnavailable: "Starting profile is not available yet",
      compareUnavailable: "Comparison is not available yet",
      mapUnavailable: "Decision map is not available yet",
      methodUnavailable: "Method and evidence route is not available yet",
    });
  });

  it("interpolates only canonical display labels and safe counts", () => {
    expect(shortlistAddLabel("PLA")).toBe("Add PLA to shortlist");
    expect(shortlistRemoveLabel("PLA")).toBe("Remove PLA from shortlist");
    expect(eliminatedDisclosure(23)).toBe("Eliminated materials (23)");
  });

  it("keeps controlled status and error copy free of rejected details and superiority claims", () => {
    const controlled = [
      SELECTOR_COPY.errorState,
      SELECTOR_COPY.emptyBody,
      SELECTOR_COPY.hydrationStatus,
      SELECTOR_COPY.detailsUnavailable,
      SELECTOR_COPY.profileUnavailable,
      SELECTOR_COPY.compareUnavailable,
      SELECTOR_COPY.mapUnavailable,
      SELECTOR_COPY.methodUnavailable,
    ].join(" ");
    expect(controlled).not.toMatch(/private|stack|path|SELECTOR_|\{|\[|winner|trophy|grade|percentage|certif/i);
    expect(SELECTOR_COPY.alignmentBody).toContain("universal material quality, strength, safety, or engineering suitability");
    expect(Object.values(SELECTOR_COPY).join(" ")).not.toMatch(/winner|trophy|grade|percentage|certification/i);
  });
});
