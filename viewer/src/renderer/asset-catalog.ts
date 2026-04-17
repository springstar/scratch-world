/**
 * asset-catalog.ts
 *
 * Curated catalog of CC0 GLTF/GLB assets served via public CDN.
 *
 * Quality tiers:
 *   photorealistic — full PBR (Albedo/Normal/Roughness/Metallic/AO), scanned or
 *     procedural; suitable for placement in Marble photorealistic scenes.
 *   stylized       — flat-shaded, vertex-colour, or low-fi textures; animated
 *     characters are kept here because no photorealistic rigged alternative exists.
 *   demo           — Khronos/Three.js technical showcase assets.
 *
 * Scale convention: group.scale.setScalar(entry.scale) makes the asset
 * world-sized in metres. groundOffset lifts the base to y=0.
 *
 * worldSizeM: approximate [width, height, depth] in metres after scale.
 * Required for photorealistic tier; used by harness validation.
 *
 * Polyhaven URL pattern:
 *   https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/{id}/{id}_1k.gltf
 * All Polyhaven models are in metres (scale=1) unless noted.
 */

const KHRONOS = "https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models";
const THREEJS = "https://cdn.jsdelivr.net/gh/mrdoob/three.js@dev/examples/models/gltf";
const PH = (id: string) =>
  `https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/${id}/${id}_1k.gltf`;

export type AssetType =
  | "character"
  | "vehicle"
  | "prop"
  | "building"
  | "tree"
  | "bush"
  | "rock"
  | "nature"
  | "animal"
  | "furniture";

export type QualityTier = "photorealistic" | "stylized" | "demo";

export interface AssetEntry {
  /** Stable semantic ID used in placeAsset() */
  id: string;
  /** Fully-qualified CDN URL to the GLB/GLTF file */
  url: string;
  type: AssetType;
  /** Descriptive tags for catalog search */
  tags: string[];
  /** Scale multiplier: Polyhaven models are in metres → scale=1 */
  scale: number;
  /** Y translation (metres) so model base sits on y=0 ground plane */
  groundOffset: number;
  source: "khronos" | "threejs" | "quaternius" | "kenney" | "polyhaven" | "discovered";
  qualityTier: QualityTier;
  /**
   * Approximate [width, height, depth] in world-space metres after scale.
   * Required for photorealistic entries; used by harness validation.
   */
  worldSizeM?: [number, number, number];
  /** Original Polyhaven asset slug when source === "polyhaven" */
  polyhavenId?: string;
  animated?: boolean;
}

export const ASSET_CATALOG: AssetEntry[] = [
  // ── Characters (Three.js — stylized, kept for animation) ─────────────────────────
  {
    id: "character_soldier",
    url: `${THREEJS}/Soldier.glb`,
    type: "character",
    tags: ["soldier", "military", "humanoid", "rigged"],
    scale: 1, groundOffset: 0,
    source: "threejs", qualityTier: "stylized", animated: true,
  },
  {
    id: "character_xbot",
    url: `${THREEJS}/Xbot.glb`,
    type: "character",
    tags: ["humanoid", "robot", "rigged", "male"],
    scale: 1, groundOffset: 0,
    source: "threejs", qualityTier: "stylized", animated: true,
  },
  {
    id: "character_michelle",
    url: `${THREEJS}/Michelle.glb`,
    type: "character",
    tags: ["humanoid", "female", "rigged", "dance"],
    scale: 1, groundOffset: 0,
    source: "threejs", qualityTier: "stylized", animated: true,
  },
  {
    id: "character_robot_expressive",
    url: `${THREEJS}/RobotExpressive/RobotExpressive.glb`,
    type: "character",
    tags: ["robot", "cartoon", "expressive", "rigged"],
    scale: 1, groundOffset: 0,
    source: "threejs", qualityTier: "stylized", animated: true,
  },
  {
    id: "character_cesium_man",
    url: `${KHRONOS}/CesiumMan/glTF-Binary/CesiumMan.glb`,
    type: "character",
    tags: ["humanoid", "male", "rigged", "walk"],
    scale: 1, groundOffset: 0,
    source: "khronos", qualityTier: "stylized", animated: true,
  },
  {
    id: "animal_fox",
    url: `${KHRONOS}/Fox/glTF-Binary/Fox.glb`,
    type: "animal",
    tags: ["fox", "forest", "mammal", "rigged"],
    scale: 0.02, groundOffset: 0,
    source: "khronos", qualityTier: "stylized", animated: true,
  },

  // ── Furniture (Polyhaven — photorealistic scanned PBR, all in metres) ────────────
  {
    id: "furniture_armchair",
    url: PH("ArmChair_01"),
    type: "furniture",
    tags: ["armchair", "chair", "gothic", "victorian", "indoor", "wood", "seating"],
    scale: 1, groundOffset: 0,
    source: "polyhaven", qualityTier: "photorealistic",
    worldSizeM: [0.85, 1.07, 0.77], polyhavenId: "ArmChair_01",
  },
  {
    id: "furniture_green_chair",
    url: PH("GreenChair_01"),
    type: "furniture",
    tags: ["chair", "armchair", "gothic", "wooden", "indoor", "seating"],
    scale: 1, groundOffset: 0,
    source: "polyhaven", qualityTier: "photorealistic",
    worldSizeM: [0.67, 1.06, 0.66], polyhavenId: "GreenChair_01",
  },
  {
    id: "furniture_rocking_chair",
    url: PH("Rockingchair_01"),
    type: "furniture",
    tags: ["rocking chair", "chair", "wood", "vintage", "indoor", "seating"],
    scale: 1, groundOffset: 0,
    source: "polyhaven", qualityTier: "photorealistic",
    worldSizeM: [0.71, 1.0, 0.83], polyhavenId: "Rockingchair_01",
  },
  {
    id: "furniture_coffee_table",
    url: PH("CoffeeTable_01"),
    type: "furniture",
    tags: ["table", "coffee table", "wood", "vintage", "indoor"],
    scale: 1, groundOffset: 0,
    source: "polyhaven", qualityTier: "photorealistic",
    worldSizeM: [1.54, 0.52, 0.97], polyhavenId: "CoffeeTable_01",
  },
  {
    id: "furniture_bench",
    url: PH("painted_wooden_bench"),
    type: "furniture",
    tags: ["bench", "outdoor", "wooden", "painted", "seating", "park"],
    scale: 1, groundOffset: 0,
    source: "polyhaven", qualityTier: "photorealistic",
    worldSizeM: [1.16, 0.89, 0.5], polyhavenId: "painted_wooden_bench",
  },
  {
    id: "furniture_sofa_velvet",
    url: `${KHRONOS}/GlamVelvetSofa/glTF-Binary/GlamVelvetSofa.glb`,
    type: "furniture",
    tags: ["sofa", "couch", "indoor", "velvet", "glamour", "fabric"],
    scale: 1, groundOffset: 0,
    source: "khronos", qualityTier: "photorealistic",
    worldSizeM: [1.85, 0.84, 0.90],
  },

  // ── Props — industrial / storage (Polyhaven) ──────────────────────────────────────
  {
    id: "prop_barrel",
    url: PH("Barrel_01"),
    type: "prop",
    tags: ["barrel", "drum", "metal", "industrial", "storage"],
    scale: 1, groundOffset: 0,
    source: "polyhaven", qualityTier: "photorealistic",
    worldSizeM: [0.56, 0.88, 0.56], polyhavenId: "Barrel_01",
  },
  {
    id: "prop_barrel_cluster",
    url: PH("wooden_barrels_01"),
    type: "prop",
    tags: ["barrel", "wooden", "wine", "storage", "cluster", "medieval"],
    scale: 1, groundOffset: 0,
    source: "polyhaven", qualityTier: "photorealistic",
    worldSizeM: [0.74, 0.92, 0.74], polyhavenId: "wooden_barrels_01",
  },
  {
    id: "prop_cardboard_box",
    url: PH("cardboard_box_01"),
    type: "prop",
    tags: ["box", "cardboard", "storage", "warehouse", "container"],
    scale: 1, groundOffset: 0,
    source: "polyhaven", qualityTier: "photorealistic",
    worldSizeM: [0.39, 0.34, 0.52], polyhavenId: "cardboard_box_01",
  },
  {
    id: "prop_boombox",
    url: PH("boombox"),
    type: "prop",
    tags: ["boombox", "radio", "music", "retro", "electronics", "speaker"],
    scale: 1, groundOffset: 0,
    source: "polyhaven", qualityTier: "photorealistic",
    worldSizeM: [0.72, 0.47, 0.19], polyhavenId: "boombox",
  },
  {
    id: "prop_fire_extinguisher",
    url: PH("korean_fire_extinguisher_01"),
    type: "prop",
    tags: ["fire extinguisher", "safety", "industrial", "red", "equipment"],
    scale: 1, groundOffset: 0,
    source: "polyhaven", qualityTier: "photorealistic",
    worldSizeM: [0.28, 0.66, 0.37], polyhavenId: "korean_fire_extinguisher_01",
  },
  {
    id: "prop_wet_floor_sign",
    url: PH("WetFloorSign_01"),
    type: "prop",
    tags: ["wet floor sign", "caution", "yellow", "office", "safety", "sign"],
    scale: 1, groundOffset: 0,
    source: "polyhaven", qualityTier: "photorealistic",
    worldSizeM: [0.30, 0.63, 0.36], polyhavenId: "WetFloorSign_01",
  },
  {
    id: "prop_cash_register",
    url: PH("CashRegister_01"),
    type: "prop",
    tags: ["cash register", "vintage", "shop", "retro", "antique", "commerce"],
    scale: 1, groundOffset: 0,
    source: "polyhaven", qualityTier: "photorealistic",
    worldSizeM: [0.60, 0.62, 0.44], polyhavenId: "CashRegister_01",
  },
  {
    id: "prop_vintage_camera",
    url: PH("Camera_01"),
    type: "prop",
    tags: ["camera", "vintage", "rangefinder", "photography", "retro"],
    scale: 1, groundOffset: 0,
    source: "polyhaven", qualityTier: "photorealistic",
    worldSizeM: [0.21, 0.06, 0.26], polyhavenId: "Camera_01",
  },
  {
    id: "prop_tool_chest",
    url: PH("metal_tool_chest"),
    type: "prop",
    tags: ["toolbox", "metal", "storage", "workshop", "industrial"],
    scale: 1, groundOffset: 0,
    source: "polyhaven", qualityTier: "photorealistic",
    worldSizeM: [0.69, 0.35, 0.32], polyhavenId: "metal_tool_chest",
  },

  // ── Lighting (Polyhaven) ──────────────────────────────────────────────────────────
  {
    id: "prop_lantern",
    url: PH("Lantern_01"),
    type: "prop",
    tags: ["lantern", "lamp", "antique", "hurricane", "hanging", "light"],
    scale: 1, groundOffset: 0,
    source: "polyhaven", qualityTier: "photorealistic",
    worldSizeM: [0.12, 0.29, 0.10], polyhavenId: "Lantern_01",
  },
  {
    id: "prop_chandelier",
    url: PH("Chandelier_02"),
    type: "prop",
    tags: ["chandelier", "ceiling light", "elegant", "brass", "indoor", "lighting"],
    scale: 1, groundOffset: 0,
    source: "polyhaven", qualityTier: "photorealistic",
    worldSizeM: [0.68, 0.85, 0.62], polyhavenId: "Chandelier_02",
  },

  // ── Decorative / plants (Polyhaven) ───────────────────────────────────────────────
  {
    id: "prop_brass_vase",
    url: PH("brass_vase_01"),
    type: "prop",
    tags: ["vase", "brass", "decorative", "antique", "indoor"],
    scale: 1, groundOffset: 0,
    source: "polyhaven", qualityTier: "photorealistic",
    worldSizeM: [0.23, 0.69, 0.23], polyhavenId: "brass_vase_01",
  },
  {
    id: "prop_ceramic_vase",
    url: PH("ceramic_vase_01"),
    type: "prop",
    tags: ["vase", "ceramic", "decorative", "minimal", "indoor"],
    scale: 1, groundOffset: 0,
    source: "polyhaven", qualityTier: "photorealistic",
    worldSizeM: [0.20, 0.40, 0.20], polyhavenId: "ceramic_vase_01",
  },
  {
    id: "prop_planter_box",
    url: PH("planter_box_01"),
    type: "prop",
    tags: ["planter", "box", "plant", "outdoor", "wood", "garden"],
    scale: 1, groundOffset: 0,
    source: "polyhaven", qualityTier: "photorealistic",
    worldSizeM: [0.91, 0.42, 0.41], polyhavenId: "planter_box_01",
  },
  {
    id: "plant_potted",
    url: PH("potted_plant_01"),
    type: "nature",
    tags: ["plant", "potted", "indoor", "tropical", "leaf", "nature"],
    scale: 1, groundOffset: 0,
    source: "polyhaven", qualityTier: "photorealistic",
    worldSizeM: [0.37, 0.86, 0.39], polyhavenId: "potted_plant_01",
  },

  // ── Khronos PBR demos (narrow theme, kept as fallbacks) ───────────────────────────
  {
    id: "prop_damaged_helmet",
    url: `${KHRONOS}/DamagedHelmet/glTF-Binary/DamagedHelmet.glb`,
    type: "prop",
    tags: ["helmet", "scifi", "damaged", "metal", "pbr"],
    scale: 1, groundOffset: 0,
    source: "khronos", qualityTier: "demo",
  },
  {
    id: "prop_water_bottle",
    url: `${KHRONOS}/WaterBottle/glTF-Binary/WaterBottle.glb`,
    type: "prop",
    tags: ["bottle", "glass", "transparent", "pbr"],
    scale: 8, groundOffset: 0,
    source: "khronos", qualityTier: "demo",
    worldSizeM: [0.08, 0.23, 0.08],
  },
];

/** Find all entries matching type and optionally any of the given tags. */
export function findAssets(type: AssetType, tags?: string[], qualityTier?: QualityTier): AssetEntry[] {
  return ASSET_CATALOG.filter((e) => {
    if (e.type !== type) return false;
    if (qualityTier && e.qualityTier !== qualityTier) return false;
    if (!tags || tags.length === 0) return true;
    return tags.some((t) => e.tags.includes(t));
  });
}

/** Return only photorealistic entries suitable for Marble scenes. */
export function findMarbleCompatibleAssets(type?: AssetType, tags?: string[]): AssetEntry[] {
  return ASSET_CATALOG.filter((e) => {
    if (e.qualityTier !== "photorealistic") return false;
    if (type && e.type !== type) return false;
    if (!tags || tags.length === 0) return true;
    return tags.some((t) => e.tags.includes(t));
  });
}

/** Exact lookup by semantic id. */
export function getAsset(id: string): AssetEntry | undefined {
  return ASSET_CATALOG.find((e) => e.id === id);
}
