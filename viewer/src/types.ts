// Types mirroring src/scene/types.ts — kept in sync manually.
// The viewer never imports from the backend directly.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Viewpoint {
  viewpointId: string;
  name: string;
  position: Vec3;
  lookAt: Vec3;
}

export interface SceneObject {
  objectId: string;
  name: string;
  type: string;
  position: Vec3;
  description: string;
  interactable: boolean;
  interactionHint?: string;
  metadata: Record<string, unknown>;
}

export interface EnvironmentConfig {
  skybox?: string;
  skyboxUrl?: string; // equirectangular panorama URL — overrides procedural sky
  ambientLight?: string;
  weather?: string;
  timeOfDay?: string;
  effects?: {
    bloom?: { strength?: number; radius?: number; threshold?: number };
  };
}

export interface SceneData {
  objects: SceneObject[];
  environment: EnvironmentConfig;
  viewpoints: Viewpoint[];
  sceneCode?: string;
  splatUrl?: string; // URL to a Gaussian splat file (.spz / .ply / .splat) — activates SplatViewer
}

export interface SceneResponse {
  sceneId: string;
  title: string;
  description: string;
  version: number;
  status?: "generating" | "ready" | "failed";
  sceneData: SceneData;
  providerRef: {
    provider: string;
    viewUrl?: string;
  };
}

export type RealtimeEvent =
  | { type: "connected"; sessionId: string }
  | { type: "text_delta"; delta: string }
  | { type: "text_done"; text: string }
  | { type: "scene_created"; sceneId: string; title: string; viewUrl: string }
  | { type: "scene_updated"; sceneId: string; version: number }
  | { type: "interaction_result"; outcome: string; sceneChanged: boolean }
  | { type: "error"; message: string };
