/** @jsxImportSource preact */
import { render } from "preact";

import { SelectorResults, type SelectorResultsProps } from "./SelectorResults.tsx";

export function renderSelectorResults(mount: HTMLElement, props: SelectorResultsProps): void {
  render(<SelectorResults {...props} />, mount);
}

export function unmountSelectorResults(mount: HTMLElement): void {
  render(null, mount);
}
