/** Exact reviewed text for the selector experience. */
export const SELECTOR_COPY = Object.freeze({
  eyebrow: "Material selector",
  heading: "Choose a material that fits your process",
  taskDescription: "Set an application goal and the process constraints your printer can meet. Results explain alignment points and every hard constraint that removes a material.",
  alignmentHeading: "What the score means",
  alignmentBody: "Alignment scores reflect only the criteria you selected. They do not rank universal material quality, strength, safety, or engineering suitability.",
  primaryGoalLegend: "Primary application goal",
  secondaryDisclosure: "Printer and process constraints",
  defaultStateNote: "Published starting choices are active until you change them.",
  primaryAction: "View recommendations",
  resetAction: "Reset criteria",
  compatibleHeading: "Compatible materials",
  highestAlignment: "Highest alignment",
  compatibleState: "Compatible with selected constraints",
  rankingExplanation: "Results are sorted by alignment points, then by stable material ID when scores tie.",
  resultDisclosure: "Why this rank",
  applicableMaximumNote: "The applicable maximum includes only selected choices that define an alignment preference.",
  shortlistLimit: "Shortlist holds up to 4 materials. Remove one before adding another.",
  clearShortlist: "Clear shortlist",
  confirmedExclusion: "Blocked by selected constraint",
  indeterminateExclusion: "Cannot verify — treated as incompatible",
  noCompatibleHeading: "No materials match every selected constraint",
  noCompatibleBody: "Every material was removed by at least one selected hard constraint. Your selections have not changed. Review the reasons below, then choose which constraint you want to reconsider.",
  reviewSecondary: "Review printer and process constraints",
  reviewPrimary: "Choose a different application goal",
  hydrationStatus: "Selector is preparing",
  noScript: "Interactive filtering needs JavaScript. The published default results remain available below.",
  emptyHeading: "No validated material records are available",
  emptyBody: "The selector cannot rank materials without a validated public dataset. This build must not be published.",
  errorState: "These selector choices could not be evaluated. Reset the selector to the published defaults and try again.",
  errorAction: "Reset selector",
  detailsUnavailable: "Material details are not available yet",
  profileUnavailable: "Starting profile is not available yet",
  compareUnavailable: "Comparison is not available yet",
  mapUnavailable: "Decision map is not available yet",
  methodUnavailable: "Method and evidence route is not available yet",
});

/** The argument must be a canonical material display label, never raw input. */
export function shortlistAddLabel(materialName: string): string {
  return `Add ${materialName} to shortlist`;
}

/** The argument must be a canonical material display label, never raw input. */
export function shortlistRemoveLabel(materialName: string): string {
  return `Remove ${materialName} from shortlist`;
}

export function eliminatedDisclosure(count: number): string {
  return `Eliminated materials (${count})`;
}
