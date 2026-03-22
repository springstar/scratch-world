/**
 * RoadGenerator — priority-queue based incremental road growth.
 * Port of SimWorld simworld/citygen/road/road_generator.py.
 *
 * Algorithm:
 *   1. Seed with a root segment.
 *   2. Priority queue ordered by generation "time" (lower = earlier).
 *   3. Each step pops the lowest-priority entry and attempts to extend the road:
 *      - Branch at intersections (highway ↔ normal road probability)
 *      - Continue forward
 *   4. Collision / angle checks via RoadManager.
 */

import type { Point, Segment, Intersection } from "./types.js";
import { RoadManager } from "./road-manager.js";
import { MathUtils } from "./math-utils.js";

export interface RoadGeneratorConfig {
  /** Width / height of the world space (square) */
  worldSize: number;

  /** Minimum time-priority increment between road segments */
  segmentCountLimit: number;

  /** Highway generation probability at each branch */
  highwayBranchProb: number;

  /** Normal road branch probability */
  normalBranchProb: number;

  /** Length of a highway segment */
  highwaySegmentLength: number;

  /** Length of a normal road segment */
  normalSegmentLength: number;

  /** Max angle deviation (radians) when extending a segment */
  maxTurnAngle: number;

  /** Minimum angle difference (radians) between road branches */
  minAngleDiff: number;

  /** Snap distance for endpoint merging */
  snapDistance: number;

  /** Minimum segment length */
  minSegmentLength: number;
}

interface QueueEntry {
  t: number;       // priority (generation time)
  seg: Segment;
}

function seededRng(seed: number) {
  // Simple mulberry32 PRNG for reproducible generation
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

export class RoadGenerator {
  private cfg: RoadGeneratorConfig;
  private roadManager: RoadManager;
  private rng: () => number;

  constructor(cfg: RoadGeneratorConfig, seed = 42) {
    this.cfg = cfg;
    const half = cfg.worldSize / 2;
    this.roadManager = new RoadManager({
      qtBounds: { x: -half, y: -half, width: cfg.worldSize, height: cfg.worldSize, rotation: 0 },
      minAngleDiff: cfg.minAngleDiff,
      snapDistance: cfg.snapDistance,
      minSegmentLength: cfg.minSegmentLength,
    });
    this.rng = seededRng(seed);
  }

  generate(): { segments: Segment[]; intersections: Intersection[] } {
    const queue: QueueEntry[] = [];

    const rootSeg: Segment = {
      start: { x: 0, y: 0 },
      end: { x: this.cfg.highwaySegmentLength, y: 0 },
      highway: true,
    };
    queue.push({ t: 0, seg: rootSeg });

    let iterations = 0;

    while (queue.length > 0 && iterations < this.cfg.segmentCountLimit) {
      // Pop lowest-t entry (min-heap via sort; small N so acceptable)
      queue.sort((a, b) => a.t - b.t);
      const entry = queue.shift()!;
      iterations++;

      const accepted = this.placeSegment(entry.seg);
      if (!accepted) continue;

      // Grow from the new segment's endpoint
      this.branch(entry.seg, entry.t, queue);
    }

    const intersections = this.computeIntersections();
    return { segments: this.roadManager.segments, intersections };
  }

  /**
   * Load a predefined road network from JSON and add segments.
   * Useful for hand-authored city layouts.
   */
  loadFromJSON(data: Array<{ start: Point; end: Point; highway?: boolean }>): {
    segments: Segment[];
    intersections: Intersection[];
  } {
    for (const d of data) {
      const seg: Segment = { start: d.start, end: d.end, highway: d.highway ?? false };
      this.placeSegment(seg);
    }
    return { segments: this.roadManager.segments, intersections: this.computeIntersections() };
  }

  private placeSegment(seg: Segment): boolean {
    const result = this.roadManager.canPlaceSegment(seg);
    if (!result.ok) return false;
    this.roadManager.addSegment(result.snapped);
    return true;
  }

  private branch(seg: Segment, t: number, queue: QueueEntry[]): void {
    const angle = Math.atan2(
      seg.end.y - seg.start.y,
      seg.end.x - seg.start.x,
    );

    // Continue forward
    const forwardAngle = angle + (this.rng() - 0.5) * 2 * this.cfg.maxTurnAngle;
    const forwardLen = seg.highway
      ? this.cfg.highwaySegmentLength
      : this.cfg.normalSegmentLength;
    queue.push({
      t: t + 1,
      seg: {
        start: seg.end,
        end: {
          x: seg.end.x + Math.cos(forwardAngle) * forwardLen,
          y: seg.end.y + Math.sin(forwardAngle) * forwardLen,
        },
        highway: seg.highway,
      },
    });

    // Possible right-angle branch
    if (seg.highway && this.rng() < this.cfg.highwayBranchProb) {
      const branchAngle = angle + Math.PI / 2 * (this.rng() > 0.5 ? 1 : -1);
      queue.push({
        t: t + 5,
        seg: {
          start: seg.end,
          end: {
            x: seg.end.x + Math.cos(branchAngle) * this.cfg.normalSegmentLength,
            y: seg.end.y + Math.sin(branchAngle) * this.cfg.normalSegmentLength,
          },
          highway: false,
        },
      });
    } else if (!seg.highway && this.rng() < this.cfg.normalBranchProb) {
      const branchAngle = angle + Math.PI / 2 * (this.rng() > 0.5 ? 1 : -1);
      queue.push({
        t: t + 3,
        seg: {
          start: seg.end,
          end: {
            x: seg.end.x + Math.cos(branchAngle) * this.cfg.normalSegmentLength,
            y: seg.end.y + Math.sin(branchAngle) * this.cfg.normalSegmentLength,
          },
          highway: false,
        },
      });
    }
  }

  private computeIntersections(): Intersection[] {
    const segments = this.roadManager.segments;
    // Use a map keyed by rounded coordinate to merge nearby endpoints
    const ptMap = new Map<string, { point: Point; segments: Set<Segment> }>();

    const key = (p: Point) => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;

    for (const seg of segments) {
      for (const pt of [seg.start, seg.end]) {
        const k = key(pt);
        if (!ptMap.has(k)) ptMap.set(k, { point: pt, segments: new Set() });
        ptMap.get(k)!.segments.add(seg);
      }
    }

    const intersections: Intersection[] = [];
    for (const { point, segments: segs } of ptMap.values()) {
      if (segs.size >= 2) {
        intersections.push({ point, segments: [...segs] });
      }
    }
    return intersections;
  }

  getRoadManager(): RoadManager {
    return this.roadManager;
  }
}
