// Types mirroring src/scene/types.ts and src/behaviors/types.ts — kept in sync manually.
// The viewer never imports from the backend directly.

/**
 * Display payload returned by a behavior skill on /interact.
 * BehaviorOverlay.tsx renders each variant.
 */
export type DisplayConfig =
  | { type: "iframe"; url: string; title?: string }
  | { type: "video"; url: string; title?: string }
  | { type: "markdown"; content: string; title?: string }
  | { type: "table"; headers: string[]; rows: string[][]; title?: string }
  /** Client executes `code` in a WorldAPI sandbox — no overlay is shown. */
  | { type: "script"; code: string; title?: string }
  /** Arbitrary HTML rendered inside the TV/screen overlay (positioned over the prop in 3D space). */
  | { type: "html"; content: string; title?: string }
  /** tv-display skill: render HTML on the TV screen via screen-space projection. */
  | { type: "tv"; content: string; title?: string }
  /**
   * Skill needs external resources before it can generate.
   * Client renders ResourcePickerPanel; user confirms then re-POSTs /interact with
   * interactionData.confirmedResources = ResourceChoice[].
   */
  | { type: "resource-picker"; needs: ResourceNeed[]; title?: string };

/** A resource the skill identified as needed for generation. */
export interface ResourceNeed {
  kind: "texture" | "model" | "audio" | "video";
  /** Human-readable description, e.g. "particle texture for fireworks burst" */
  label: string;
  /** Pre-selected builtin option, if any. */
  suggested?: ResourceOption;
  options: ResourceOption[];
}

/** One selectable resource option. */
export interface ResourceOption {
  id: string;
  name: string;
  url: string;
  thumbnail?: string;
  source: "builtin" | "cdn" | "upload";
}

/** User-confirmed resource choices — sent back in interactionData.confirmedResources. */
export interface ResourceChoice {
  label: string;
  option: ResourceOption;
}

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

export interface SpawnPoint {
  id: string;
  label: string;
  x: number;
  z: number;
}

export interface SceneData {
  objects: SceneObject[];
  environment: EnvironmentConfig;
  viewpoints: Viewpoint[];
  sceneCode?: string;
  splatUrl?: string;
  colliderMeshUrl?: string;
  splatGroundOffset?: number; // Marble ground_plane_offset — negate for Three.js fallback Y
  spawnPoints?: SpawnPoint[];
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
  | { type: "npc_speech"; npcId: string; npcName: string; text: string; sceneId?: string }
  | { type: "npc_move"; npcId: string; position: { x: number; y: number; z: number }; sceneId?: string }
  | { type: "npc_emote"; npcId: string; animation: string; sceneId?: string }
  | { type: "npc_trade_offer"; npcId: string; npcName: string; item: string; price: string; sceneId?: string }
  | { type: "npc_waypoint"; npcId: string; npcName: string; position: { x: number; z: number }; label: string; sceneId?: string }
  | { type: "npc_quest"; npcId: string; npcName: string; title: string; objective: string; reward: string; sceneId?: string }
  | { type: "error"; message: string }
  | {
      type: "position_picker";
      pickerId: string;
      panoUrl: string;
      estimatedPos: { x: number; y: number; z: number };
      objectName: string;
      sceneId: string;
    }
  | { type: "skill_generating"; objectId: string; objectName: string; sceneId: string; skillName: string }
  | { type: "skill_ready"; objectId: string; sceneId: string };
