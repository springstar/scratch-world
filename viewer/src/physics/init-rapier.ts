import RAPIER from "@dimforge/rapier3d-compat";

let promise: Promise<typeof RAPIER> | null = null;

/** Initialize Rapier WASM once per page lifetime. Returns the module. */
export function getRapier(): Promise<typeof RAPIER> {
  if (!promise) {
    promise = RAPIER.init().then(() => RAPIER);
  }
  return promise;
}
