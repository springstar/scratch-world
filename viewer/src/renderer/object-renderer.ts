import type * as THREE from "three";
import type { SceneObject } from "../types.js";

export interface RenderOptions {
  /** IBL environment map from the splat scene panorama. Applied to MeshStandardMaterial. */
  envMap?: THREE.Texture;
}

/**
 * Abstraction over how a single SceneObject is loaded into Three.js.
 *
 * Current implementations:
 *   GltfObjectRenderer — loads any object with metadata.modelUrl
 *
 * Future path: SplatObjectRenderer will implement this interface for Path A
 * (Gaussian Splat objects) without requiring changes to the caller.
 */
export interface ObjectRenderer {
  readonly type: string;
  /** Return true if this renderer knows how to handle the given object. */
  canRender(obj: SceneObject): boolean;
  /**
   * Load/create the Three.js object for obj.
   * Callers are responsible for positioning, adding to scene, and physics setup.
   * The returned Object3D must have its scale pre-applied from obj.metadata.
   */
  render(obj: SceneObject, opts?: RenderOptions): Promise<THREE.Object3D>;
  /** Dispose all GPU resources for a previously rendered object. */
  dispose(mesh: THREE.Object3D): void;
}

/**
 * Ordered registry: first renderer whose canRender() returns true is used.
 * Register more specific renderers before more general ones.
 */
export class ObjectRendererRegistry {
  private readonly renderers: ObjectRenderer[] = [];

  register(renderer: ObjectRenderer): this {
    this.renderers.push(renderer);
    return this;
  }

  /**
   * Render obj using the first matching renderer.
   * Returns null if no renderer can handle it.
   */
  async render(obj: SceneObject, opts?: RenderOptions): Promise<THREE.Object3D | null> {
    for (const renderer of this.renderers) {
      if (renderer.canRender(obj)) {
        return renderer.render(obj, opts);
      }
    }
    return null;
  }

  dispose(mesh: THREE.Object3D): void {
    for (const renderer of this.renderers) {
      renderer.dispose(mesh);
    }
  }
}
