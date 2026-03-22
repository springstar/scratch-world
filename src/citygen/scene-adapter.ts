/**
 * Converts CityData produced by CityGenerator into a SceneData object
 * that the scene renderer can display.
 */

import type { CityData } from "./types.js";
import type { SceneData, SceneObject, Viewpoint } from "../scene/types.js";

// ── Naming vocabulary (round-robin per building type) ────────────────────────

const NAMES: Record<string, string[]> = {
  tower:   ["Watch Tower", "Mage Tower", "Bell Tower", "Guard Tower", "Castle Keep"],
  shop:    [
    "General Store", "Blacksmith", "Tavern & Inn", "Bakery", "Alchemist Shop",
    "Jeweler's Workshop", "Fletcher", "Herbalist", "Armor Forge", "Potion Shop",
  ],
  house:   [
    "Merchant's House", "Noble Residence", "Scholar's Dwelling",
    "Guild Member's Home", "Craftsman's House",
  ],
  cottage: ["Stone Cottage", "Worker's Hut", "Woodcutter's Cabin", "Farmstead"],
};

// Counters for round-robin naming
const nameCounters: Record<string, number> = {};

function nextName(typeId: string): string {
  const list = NAMES[typeId] ?? [`${typeId} building`];
  const idx = nameCounters[typeId] ?? 0;
  nameCounters[typeId] = (idx + 1) % list.length;
  return list[idx];
}

// ── Building type → scene metadata ──────────────────────────────────────────

interface BuildingMeta {
  buildingStyle: string;
  buildingHeight: number;
  interactable: boolean;
}

const TYPE_META: Record<string, BuildingMeta> = {
  tower:   { buildingStyle: "tower",   buildingHeight: 10, interactable: true  },
  shop:    { buildingStyle: "shop",    buildingHeight: 4,  interactable: true  },
  house:   { buildingStyle: "house",   buildingHeight: 5,  interactable: false },
  cottage: { buildingStyle: "cottage", buildingHeight: 3,  interactable: false },
};

function buildingMeta(typeId: string): BuildingMeta {
  return TYPE_META[typeId] ?? { buildingStyle: "house", buildingHeight: 4, interactable: false };
}

// ── Theme → environment ───────────────────────────────────────────────────────

type Theme = "medieval" | "fantasy" | "modern";

const THEME_ENV: Record<Theme, { skybox: string; timeOfDay: string; ambientLight: string }> = {
  medieval: { skybox: "clear_day", timeOfDay: "noon",  ambientLight: "warm" },
  fantasy:  { skybox: "sunset",    timeOfDay: "dusk",  ambientLight: "warm" },
  modern:   { skybox: "overcast",  timeOfDay: "dawn",  ambientLight: "cool" },
};

// ── NPC chatter per theme ────────────────────────────────────────────────────

const CHATTER: Record<Theme, string[]> = {
  medieval: [
    "Hail, traveller!", "Have you heard the latest news?",
    "The market is busy today.", "Watch your coin purse.",
    "The tavern serves a fine ale.", "Strange things stir at night.",
  ],
  fantasy: [
    "The ley lines pulse strongly today.", "Have you seen the sky lately?",
    "Magic is in the air.", "The ancient prophecy speaks of one like you.",
    "Beware the shadow market.", "The stars align for adventure.",
  ],
  modern: [
    "Busy day, isn't it?", "Have you seen the new development?",
    "Coffee?", "The WiFi is down again.", "Traffic was terrible.",
    "Check your messages.", "Did you hear about the new update?",
  ],
};

// ── Main converter ────────────────────────────────────────────────────────────

export function cityDataToSceneData(
  cityData: CityData,
  theme: Theme = "medieval",
  _prompt: string = "",
): SceneData {
  // Reset name counters so each call is independent
  for (const key of Object.keys(nameCounters)) {
    nameCounters[key] = 0;
  }

  const objects: SceneObject[] = [];
  let objIdx = 0;
  const nextId = (prefix: string) => `${prefix}_${objIdx++}`;

  // ── Compute city bounding box ───────────────────────────────────────────
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const b of cityData.buildings) {
    const cx = b.bounds.x + b.bounds.width / 2;
    const cz = b.bounds.y + b.bounds.height / 2;
    minX = Math.min(minX, cx - b.bounds.width / 2);
    maxX = Math.max(maxX, cx + b.bounds.width / 2);
    minZ = Math.min(minZ, cz - b.bounds.height / 2);
    maxZ = Math.max(maxZ, cz + b.bounds.height / 2);
  }
  // Fallback if no buildings
  if (!isFinite(minX)) { minX = -50; maxX = 50; minZ = -50; maxZ = 50; }
  const cityW = maxX - minX;
  const cityD = maxZ - minZ;
  const groundW = cityW + 20;
  const groundD = cityD + 20;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  // ── Ground ──────────────────────────────────────────────────────────────
  objects.push({
    objectId: nextId("ground"),
    name: "City Ground",
    type: "terrain",
    position: { x: cx, y: 0, z: cz },
    description: "The ground of the settlement.",
    interactable: false,
    metadata: { shape: "floor", width: groundW, depth: groundD },
  });

  // ── Buildings ───────────────────────────────────────────────────────────
  for (const building of cityData.buildings) {
    const bcx = building.bounds.x + building.bounds.width / 2;
    const bcz = building.bounds.y + building.bounds.height / 2;
    const typeId = building.type.id;
    const bMeta = buildingMeta(typeId);
    const rotationY = (building.rotation * Math.PI) / 180;
    const name = nextName(typeId);

    objects.push({
      objectId: nextId("bld"),
      name,
      type: "building",
      position: { x: bcx, y: 0, z: bcz },
      description: `A ${typeId} in the settlement.`,
      interactable: bMeta.interactable,
      interactionHint: bMeta.interactable ? `try 'enter the ${name.toLowerCase()}'` : undefined,
      metadata: {
        buildingStyle:  bMeta.buildingStyle,
        buildingHeight: bMeta.buildingHeight,
        buildingWidth:  building.bounds.width,
        buildingDepth:  building.bounds.height,
        rotationY,
      },
    });
  }

  // ── Trees (10 scattered near perimeter) ────────────────────────────────
  const treePositions = perimeter10(minX, maxX, minZ, maxZ);
  for (const [tx, tz] of treePositions) {
    objects.push({
      objectId: nextId("tree"),
      name: "Tree",
      type: "tree",
      position: { x: tx, y: 0, z: tz },
      description: "A tree at the edge of the settlement.",
      interactable: false,
      metadata: {},
    });
  }

  // ── NPCs near shops ─────────────────────────────────────────────────────
  const shopBuildings = cityData.buildings.filter(b => b.type.id === "shop");
  const npcChatter = CHATTER[theme];
  const npcNames = theme === "medieval"
    ? ["Village Guard", "Wandering Merchant", "Town Crier", "Curious Traveller"]
    : theme === "fantasy"
      ? ["Elven Wanderer", "Mage Apprentice", "Spirit Guide", "Market Vendor"]
      : ["Pedestrian", "Street Vendor", "Courier", "Local Resident"];

  for (let i = 0; i < 4; i++) {
    const shop = shopBuildings[i % Math.max(shopBuildings.length, 1)];
    let nx: number, nz: number;
    if (shop) {
      nx = shop.bounds.x + shop.bounds.width / 2 + (i % 2 === 0 ? 2 : -2);
      nz = shop.bounds.y + shop.bounds.height / 2 + 1.5;
    } else {
      // Scatter around city center if no shops
      const angle = (i / 4) * Math.PI * 2;
      nx = cx + Math.cos(angle) * 8;
      nz = cz + Math.sin(angle) * 8;
    }
    objects.push({
      objectId: nextId("npc"),
      name: npcNames[i],
      type: "npc",
      position: { x: nx, y: 0, z: nz },
      description: `A ${npcNames[i].toLowerCase()} going about their day.`,
      interactable: true,
      interactionHint: `try 'talk to the ${npcNames[i].toLowerCase()}'`,
      metadata: {
        moveMode: "randomwalk",
        speed: 0.8,
        maxRadius: 4,
        chatter: npcChatter.slice(0, 4),
      },
    });
  }

  // ── Environment ─────────────────────────────────────────────────────────
  const envCfg = THEME_ENV[theme];
  const environment = {
    skybox: envCfg.skybox,
    timeOfDay: envCfg.timeOfDay,
    ambientLight: envCfg.ambientLight,
  };

  // ── Viewpoints ──────────────────────────────────────────────────────────
  const viewpoints: Viewpoint[] = [
    {
      viewpointId: "vp_street",
      name: "Street Level",
      position: { x: cx, y: 1.7, z: maxZ + 10 },
      lookAt:   { x: cx, y: 1,   z: cz        },
    },
    {
      viewpointId: "vp_overview",
      name: "Bird's Eye",
      position: { x: cx, y: Math.max(cityW, cityD) * 0.6 + 10, z: maxZ + 15 },
      lookAt:   { x: cx, y: 0,   z: cz        },
    },
  ];

  return { objects, environment, viewpoints };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Generate 10 tree positions scattered just outside the city bounding box. */
function perimeter10(
  minX: number, maxX: number,
  minZ: number, maxZ: number,
): [number, number][] {
  const pad = 4;
  const positions: [number, number][] = [];
  // Simple deterministic scatter using golden-angle-like distribution
  const angles = [0, 0.628, 1.257, 1.885, 2.513, 3.142, 3.770, 4.398, 5.027, 5.655];
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const rx = (maxX - minX) / 2 + pad;
  const rz = (maxZ - minZ) / 2 + pad;
  for (let i = 0; i < 10; i++) {
    const a = angles[i];
    const r = 1 + (i % 3) * 0.15;  // slight radial variation
    positions.push([cx + Math.cos(a) * rx * r, cz + Math.sin(a) * rz * r]);
  }
  return positions;
}
