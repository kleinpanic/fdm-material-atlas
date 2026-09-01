import { createMinimalAtlas, type MinimalAtlas } from "./atlas-minimal.valid.ts";

export function mutateAtlas(mutator: (atlas: MinimalAtlas) => void): MinimalAtlas {
  const atlas = structuredClone(createMinimalAtlas());
  mutator(atlas);
  return atlas;
}

export const privateLookingSyntheticMarker = "synthetic-sensitive-marker-never-print";
