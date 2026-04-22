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
  /** @deprecated alias for setDisplay — only exists to handle legacy generated code */
  showPanel(html: string | null): void;
  /** Spark 2.0 Gaussian Splat rendering capabilities.
   *  Only available when provider === "splat". */
  spark?: SparkAPI;
}

/**
 * Spark 2.0 integration — exposes Gaussian Splat rendering capabilities to code-gen scripts.
 * Types kept loosely typed to avoid importing @sparkjsdev/spark into shared code.
 */
export interface SparkAPI {
  /**
   * Add a SDF-based edit to the scene splat (deformation, colorization, displacement).
   * The edit object must be created with `new world.Spark.SplatEdit(...)`.
   * Returns the edit for later removal.
   */
  addEdit(edit: unknown): void;
  /** Remove a previously added SDF edit. */
  removeEdit(edit: unknown): void;
  /**
   * Add a SplatMesh (e.g. from snowBox, imageSplats, textSplats) to the scene.
   * Returns a cleanup function that removes it.
   */
  addSplat(mesh: unknown): () => void;
  /**
   * Set depth-of-field on the scene splat.
   * @param focalDistance  World-space distance from camera to focus plane (e.g. 5.0)
   * @param apertureAngle  Bokeh aperture in radians (0 = disabled, 0.02 = subtle, 0.1 = strong)
   */
  setDof(focalDistance: number, apertureAngle: number): void;
  /** Spark 2.0 constructor classes — use to build edits and generators. */
  Spark: {
    SplatEdit: unknown;
    SplatEditSdf: unknown;
    SplatEditSdfType: Record<string, string>;
    SplatEditRgbaBlendMode: Record<string, string>;
    snowBox: (opts: Record<string, unknown>) => { snow: unknown; [k: string]: unknown };
    imageSplats: (opts: { url: string; [k: string]: unknown }) => unknown;
    textSplats: (opts: { text: string; [k: string]: unknown }) => unknown;
  };
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

export interface ScriptContext {
  /** World-space position of the object that owns this script. */
  objectPosition: { x: number; y: number; z: number };
  /** Y coordinate for display surfaces (calibrated or default 1.3). */
  displayY: number;
  /** Width of display surface in world units. */
  displayWidth: number;
  /** Height of display surface in world units. */
  displayHeight: number;
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
export function runScript(code: string, world: WorldAPI, ctx?: ScriptContext): string | null {
  try {
    const preamble = ctx
      ? `const objectPosition = ${JSON.stringify(ctx.objectPosition)};\nconst displayY = ${ctx.displayY};\nconst displayWidth = ${ctx.displayWidth};\nconst displayHeight = ${ctx.displayHeight};\n`
      : "";
    // new Function creates a function without access to the current closure,
    // reducing accidental leakage of local variables.
    // eslint-disable-next-line no-new-func
    const fn = new Function("world", preamble + code);
    fn(world);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
