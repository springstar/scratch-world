/**
 * WorldAPI — the surface exposed to code-gen scripts inside the sandbox.
 * Defined here so the viewer can import the type without depending on SplatViewer internals.
 */
export interface WorldAPI {
  provider: "splat" | "threejs";
  /** Full Three.js module — use world.THREE.PlaneGeometry, world.THREE.MeshBasicMaterial, etc. */
  THREE: typeof import("three");
  scene: import("three").Scene;
  camera: import("three").Camera;
  animate(cb: (dt: number) => void): void;
  spawn(opts: SpawnOpts): string;
  despawn(objectId: string): void;
  setColor(objectId: string, color: string): void;
  showToast(text: string, durationMs?: number): void;
  /** Render arbitrary HTML as a 2D overlay centered on screen (follows camera).
   *  Pass null to dismiss. */
  setDisplay(html: string | null): void;
}

export interface SpawnOpts {
  shape?: "box" | "sphere" | "cylinder" | "plane";
  x?: number;
  y?: number;
  z?: number;
  width?: number;
  height?: number;
  depth?: number;
  radius?: number;
  color?: string;
  opacity?: number;
  name?: string;
}

/**
 * Execute LLM-generated code inside a minimal sandbox.
 *
 * The code receives `world` as its only argument.  All other globals are absent
 * from the Function scope — the sandbox does not prevent access to the browser
 * global object (window), but LLM-generated code is instructed not to use it.
 *
 * Returns an error string on failure, or null on success.
 */
export function runScript(code: string, world: WorldAPI): string | null {
  try {
    // new Function creates a function without access to the current closure,
    // reducing accidental leakage of local variables.
    // eslint-disable-next-line no-new-func
    const fn = new Function("world", code);
    fn(world);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
