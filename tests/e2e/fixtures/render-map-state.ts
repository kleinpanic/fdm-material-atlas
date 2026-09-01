import { h } from "preact";
import render from "preact-render-to-string";

import { MapExplorerIsland } from "../../../src/components/map/MapExplorerIsland.tsx";
import {
  phase8OmissionRecoveryProjection,
  phase8OmissionRecoveryReason,
} from "../../fixtures/phase8-public-cases.ts";

const DOCUMENT_STYLE = `
  body { margin: 0; color: #19211f; background: #f3f4ef; font: 16px/1.55 sans-serif; }
  main { padding: 24px; }
  button, input, select, a { min-height: 44px; }
  .map-horizontal-scroll { overflow-x: auto; }
  table { border-collapse: collapse; }
  th, td { padding: 8px; border: 1px solid #66706d; }
`;

/** Render the real map island against a controlled test-only projection. */
export function renderMapOmissionRecoveryDocument(base = "/"): Readonly<{
  html: string;
  omittedMaterialId: string;
  omissionReason: string;
}> {
  const projection = phase8OmissionRecoveryProjection(base);
  const omitted = projection.impactFlex.records[0];
  if (omitted === undefined) throw new Error("PHASE8_OMISSION_FIXTURE_MISSING");
  const component = render(h(MapExplorerIsland, { projection }));
  return Object.freeze({
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Map omission and recovery test</title><style>${DOCUMENT_STYLE}</style></head><body><main><h1>Controlled map omission and recovery state</h1>${component}</main></body></html>`,
    omittedMaterialId: omitted.material.id,
    omissionReason: phase8OmissionRecoveryReason,
  });
}
