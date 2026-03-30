/**
 * asset-catalog.ts
 *
 * Seed catalog of verified CC0 GLTF/GLB assets served via CDN.
 * All URLs are verified 200 + correct content-type as of 2026-03-30.
 *
 * Scale convention: group.scale.setScalar(entry.scale) makes the asset
 * world-sized in metres. groundOffset lifts the base to y=0.
 *
 * To add entries: call the add_to_catalog agent tool.
 */

const KHRONOS = "https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models";
const THREEJS = "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf";

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

export interface AssetEntry {
  /** Stable semantic ID used in placeAsset() */
  id: string;
  /** Fully-qualified CDN URL to the GLB/GLTF file */
  url: string;
  type: AssetType;
  /** Descriptive tags for catalog search */
  tags: string[];
  /**
   * Calibrated world scale multiplier applied to group.scale.
   * e.g. KhronosGroup Duck is modelled in cm → scale = 0.01
   */
  scale: number;
  /** Y translation (metres) so model base sits on y=0 ground plane */
  groundOffset: number;
  /** Attribution / origin tag */
  source: "khronos" | "threejs" | "quaternius" | "kenney" | "discovered";
  /** True if the model contains animation clips */
  animated?: boolean;
}

export const ASSET_CATALOG: AssetEntry[] = [
  // ── Characters ───────────────────────────────────────────────────────────
  {
    id: "character_soldier",
    url: `${THREEJS}/Soldier.glb`,
    type: "character",
    tags: ["soldier", "military", "humanoid", "rigged"],
    scale: 1,
    groundOffset: 0,
    source: "threejs",
    animated: true,
  },
  {
    id: "character_xbot",
    url: `${THREEJS}/Xbot.glb`,
    type: "character",
    tags: ["humanoid", "robot", "rigged", "male"],
    scale: 1,
    groundOffset: 0,
    source: "threejs",
    animated: true,
  },
  {
    id: "character_michelle",
    url: `${THREEJS}/Michelle.glb`,
    type: "character",
    tags: ["humanoid", "female", "rigged", "dance"],
    scale: 1,
    groundOffset: 0,
    source: "threejs",
    animated: true,
  },
  {
    id: "character_robot_expressive",
    url: `${THREEJS}/RobotExpressive/RobotExpressive.glb`,
    type: "character",
    tags: ["robot", "cartoon", "expressive", "rigged"],
    scale: 1,
    groundOffset: 0,
    source: "threejs",
    animated: true,
  },
  {
    id: "character_cesium_man",
    url: `${KHRONOS}/CesiumMan/glTF-Binary/CesiumMan.glb`,
    type: "character",
    tags: ["humanoid", "male", "rigged", "walk"],
    scale: 1,
    groundOffset: 0,
    source: "khronos",
    animated: true,
  },
  {
    id: "character_brainstem",
    url: `${KHRONOS}/BrainStem/glTF-Binary/BrainStem.glb`,
    type: "character",
    tags: ["humanoid", "rigged", "detailed"],
    scale: 1,
    groundOffset: 0,
    source: "khronos",
    animated: true,
  },

  // ── Animals ───────────────────────────────────────────────────────────────
  {
    id: "animal_horse",
    url: `${THREEJS}/Horse.glb`,
    type: "animal",
    tags: ["horse", "mammal", "rigged"],
    scale: 0.012,
    groundOffset: 0,
    source: "threejs",
    animated: true,
  },
  {
    id: "animal_parrot",
    url: `${THREEJS}/Parrot.glb`,
    type: "animal",
    tags: ["bird", "parrot", "tropical", "rigged"],
    scale: 0.012,
    groundOffset: 0.6,
    source: "threejs",
    animated: true,
  },
  {
    id: "animal_flamingo",
    url: `${THREEJS}/Flamingo.glb`,
    type: "animal",
    tags: ["bird", "flamingo", "tropical", "rigged"],
    scale: 0.012,
    groundOffset: 0,
    source: "threejs",
    animated: true,
  },
  {
    id: "animal_stork",
    url: `${THREEJS}/Stork.glb`,
    type: "animal",
    tags: ["bird", "stork", "flying", "rigged"],
    scale: 0.012,
    groundOffset: 0,
    source: "threejs",
    animated: true,
  },
  {
    id: "animal_fox",
    url: `${KHRONOS}/Fox/glTF-Binary/Fox.glb`,
    type: "animal",
    tags: ["fox", "forest", "mammal", "rigged"],
    scale: 0.02,
    groundOffset: 0,
    source: "khronos",
    animated: true,
  },
  {
    id: "animal_fish",
    url: `${KHRONOS}/BarramundiFish/glTF-Binary/BarramundiFish.glb`,
    type: "animal",
    tags: ["fish", "barramundi", "aquatic"],
    scale: 1,
    groundOffset: 0.3,
    source: "khronos",
  },
  {
    id: "animal_duck",
    url: `${KHRONOS}/Duck/glTF-Binary/Duck.glb`,
    type: "animal",
    tags: ["duck", "rubber duck", "toy", "yellow"],
    scale: 0.01,
    groundOffset: 0,
    source: "khronos",
  },

  // ── Vehicles ──────────────────────────────────────────────────────────────
  {
    id: "vehicle_milk_truck",
    url: `${KHRONOS}/CesiumMilkTruck/glTF-Binary/CesiumMilkTruck.glb`,
    type: "vehicle",
    tags: ["truck", "vehicle", "vintage", "delivery"],
    scale: 1,
    groundOffset: 0,
    source: "khronos",
    animated: true,
  },
  {
    id: "vehicle_car_toy",
    url: `${KHRONOS}/ToyCar/glTF-Binary/ToyCar.glb`,
    type: "vehicle",
    tags: ["car", "toy", "small", "miniature"],
    scale: 80,
    groundOffset: 0,
    source: "khronos",
  },

  // ── Props / Objects ───────────────────────────────────────────────────────
  {
    id: "prop_lantern",
    url: `${KHRONOS}/Lantern/glTF-Binary/Lantern.glb`,
    type: "prop",
    tags: ["lantern", "lamp", "light", "chinese", "asian", "hanging"],
    scale: 1,
    groundOffset: 0,
    source: "khronos",
  },
  {
    id: "prop_antique_camera",
    url: `${KHRONOS}/AntiqueCamera/glTF-Binary/AntiqueCamera.glb`,
    type: "prop",
    tags: ["camera", "vintage", "antique", "photography"],
    scale: 1,
    groundOffset: 0,
    source: "khronos",
  },
  {
    id: "prop_iridescence_lamp",
    url: `${KHRONOS}/IridescenceLamp/glTF-Binary/IridescenceLamp.glb`,
    type: "prop",
    tags: ["lamp", "light", "modern", "iridescent"],
    scale: 1,
    groundOffset: 0,
    source: "khronos",
  },
  {
    id: "prop_water_bottle",
    url: `${KHRONOS}/WaterBottle/glTF-Binary/WaterBottle.glb`,
    type: "prop",
    tags: ["bottle", "glass", "transparent", "pbr"],
    scale: 8,
    groundOffset: 0,
    source: "khronos",
  },
  {
    id: "prop_boom_box",
    url: `${KHRONOS}/BoomBox/glTF-Binary/BoomBox.glb`,
    type: "prop",
    tags: ["boombox", "radio", "music", "retro"],
    scale: 80,
    groundOffset: 0,
    source: "khronos",
  },
  {
    id: "prop_damaged_helmet",
    url: `${KHRONOS}/DamagedHelmet/glTF-Binary/DamagedHelmet.glb`,
    type: "prop",
    tags: ["helmet", "scifi", "damaged", "metal", "pbr"],
    scale: 1,
    groundOffset: 0,
    source: "khronos",
  },
  {
    id: "prop_avocado",
    url: `${KHRONOS}/Avocado/glTF-Binary/Avocado.glb`,
    type: "prop",
    tags: ["avocado", "food", "fruit", "photogrammetry"],
    scale: 100,
    groundOffset: 0,
    source: "khronos",
  },
  {
    id: "prop_corset",
    url: `${KHRONOS}/Corset/glTF-Binary/Corset.glb`,
    type: "prop",
    tags: ["corset", "clothing", "fabric", "photogrammetry"],
    scale: 10,
    groundOffset: 0,
    source: "khronos",
  },

  // ── Furniture ─────────────────────────────────────────────────────────────
  {
    id: "furniture_chair_sheen",
    url: `${KHRONOS}/SheenChair/glTF-Binary/SheenChair.glb`,
    type: "furniture",
    tags: ["chair", "indoor", "fabric", "velvet"],
    scale: 1,
    groundOffset: 0,
    source: "khronos",
  },
  {
    id: "furniture_sofa_velvet",
    url: `${KHRONOS}/GlamVelvetSofa/glTF-Binary/GlamVelvetSofa.glb`,
    type: "furniture",
    tags: ["sofa", "couch", "indoor", "velvet", "glamour"],
    scale: 1,
    groundOffset: 0,
    source: "khronos",
  },

  // ── Nature / Environment ──────────────────────────────────────────────────
  {
    id: "nature_littlest_tokyo",
    url: `${THREEJS}/LittlestTokyo.glb`,
    type: "nature",
    tags: ["japanese", "city", "diorama", "miniature", "tokyo", "buildings", "animated"],
    scale: 0.01,
    groundOffset: 0,
    source: "threejs",
    animated: true,
  },

  // ── Vegetation (use when makeTree() fallback is not sufficient) ────────────
  {
    id: "plant_indoor_01",
    url: `${KHRONOS}/DiffuseTransmissionPlant/glTF-Binary/DiffuseTransmissionPlant.glb`,
    type: "nature",
    tags: ["plant", "indoor", "potted", "foliage", "tropical", "leaf"],
    scale: 1,
    groundOffset: 0,
    source: "khronos",
    animated: false,
  },
];

/** Find all entries matching type and optionally any of the given tags. */
export function findAssets(type: AssetType, tags?: string[]): AssetEntry[] {
  return ASSET_CATALOG.filter((e) => {
    if (e.type !== type) return false;
    if (!tags || tags.length === 0) return true;
    return tags.some((t) => e.tags.includes(t));
  });
}

/** Exact lookup by semantic id. */
export function getAsset(id: string): AssetEntry | undefined {
  return ASSET_CATALOG.find((e) => e.id === id);
}
