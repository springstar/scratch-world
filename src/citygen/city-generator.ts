/**
 * CityGenerator — top-level orchestrator.
 * Port of SimWorld simworld/citygen/city_generator.py.
 *
 * Usage:
 *   const city = new CityGenerator(config).generate();
 *   // city.segments  → road network
 *   // city.buildings → placed buildings
 */

import type { CityData, BuildingType } from "./types.js";
import { RoadGenerator, type RoadGeneratorConfig } from "./road-generator.js";
import { BuildingGenerator, type BuildingGeneratorConfig } from "./building-generator.js";

export interface CityConfig {
  road: RoadGeneratorConfig;
  building: BuildingGeneratorConfig;
  buildingTypes: BuildingType[];
  /** Optional RNG seed for reproducible cities */
  seed?: number;
}

/** Sensible defaults suitable for a small town (~100 × 100 units). */
export const DEFAULT_CITY_CONFIG: CityConfig = {
  road: {
    worldSize: 120,
    segmentCountLimit: 200,
    highwayBranchProb: 0.04,
    normalBranchProb: 0.12,
    highwaySegmentLength: 20,
    normalSegmentLength: 8,
    maxTurnAngle: 0.3,          // ~17°
    minAngleDiff: 0.15,
    snapDistance: 1.5,
    minSegmentLength: 3,
  },
  building: {
    qtBounds: { x: -60, y: -60, width: 120, height: 120 },
    buildingIntersectionDistance: 2,
    buildingSideDistance: 2.5,
    buildingBuildingDistance: 0.8,
    buildingRoadDistance: 1.0,
  },
  buildingTypes: [
    { id: "tower",   width: 6,   height: 4,   numLimit: 3  },
    { id: "shop",    width: 4,   height: 3,   numLimit: 20 },
    { id: "house",   width: 3,   height: 3,   numLimit: -1 },
    { id: "cottage", width: 2,   height: 2,   numLimit: -1 },
  ],
};

export class CityGenerator {
  private cfg: CityConfig;

  constructor(cfg: Partial<CityConfig> = {}) {
    this.cfg = {
      road: { ...DEFAULT_CITY_CONFIG.road, ...cfg.road },
      building: { ...DEFAULT_CITY_CONFIG.building, ...cfg.building },
      buildingTypes: cfg.buildingTypes ?? DEFAULT_CITY_CONFIG.buildingTypes,
      seed: cfg.seed,
    };
  }

  generate(): CityData {
    // 1. Generate road network
    const roadGen = new RoadGenerator(this.cfg.road, this.cfg.seed ?? 42);
    const { segments, intersections } = roadGen.generate();

    // 2. Place buildings along each segment
    const buildingGen = new BuildingGenerator(this.cfg.building, this.cfg.buildingTypes);
    const roadQt = roadGen.getRoadManager().getQuadTree();

    for (const seg of segments) {
      buildingGen.generateAlongSegment(seg, roadQt);
    }

    // 3. Clean up any buildings that ended up too close to roads
    buildingGen.filterOverlappingBuildings(roadQt);

    return { segments, intersections, buildings: buildingGen.buildings };
  }

  /**
   * Load road data from a hand-authored JSON and place buildings on top.
   * Useful for AI-generated city layouts.
   */
  generateFromRoads(
    roads: Array<{ start: { x: number; y: number }; end: { x: number; y: number }; highway?: boolean }>,
  ): CityData {
    const roadGen = new RoadGenerator(this.cfg.road, this.cfg.seed ?? 42);
    const { segments, intersections } = roadGen.loadFromJSON(roads);

    const buildingGen = new BuildingGenerator(this.cfg.building, this.cfg.buildingTypes);
    const roadQt = roadGen.getRoadManager().getQuadTree();

    for (const seg of segments) {
      buildingGen.generateAlongSegment(seg, roadQt);
    }
    buildingGen.filterOverlappingBuildings(roadQt);

    return { segments, intersections, buildings: buildingGen.buildings };
  }
}
