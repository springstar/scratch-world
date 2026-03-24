/**
 * RoadManager — spatial index for road segments.
 * Port of SimWorld simworld/citygen/road/road_manager.py.
 *
 * Stores segments in a QuadTree for efficient nearest-segment queries
 * and provides a can_place_segment check to avoid near-duplicate roads.
 */

import { MathUtils } from "./math-utils.js";
import { QuadTree } from "./quad-tree.js";
import type { Bounds, Segment } from "./types.js";

function segmentBounds(seg: Segment): Bounds {
	const minX = Math.min(seg.start.x, seg.end.x);
	const minY = Math.min(seg.start.y, seg.end.y);
	const maxX = Math.max(seg.start.x, seg.end.x);
	const maxY = Math.max(seg.start.y, seg.end.y);
	// Add 1-unit padding so zero-length bounds still retrieve
	return { x: minX, y: minY, width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, 1), rotation: 0 };
}

export interface RoadManagerConfig {
	qtBounds: Bounds;
	qtMaxObjects?: number;
	qtMaxLevels?: number;
	/** Minimum angle (radians) a new segment must differ from existing ones at the same endpoint */
	minAngleDiff: number;
	/** Snap distance: if a new end-point is within this many units of an existing intersection, snap to it */
	snapDistance: number;
	/** Minimum length of a segment to be inserted */
	minSegmentLength: number;
}

export class RoadManager {
	private qt: QuadTree<Segment>;
	readonly segments: Segment[] = [];
	private cfg: RoadManagerConfig;

	constructor(cfg: RoadManagerConfig) {
		this.cfg = cfg;
		this.qt = new QuadTree<Segment>(cfg.qtBounds, cfg.qtMaxObjects ?? 10, cfg.qtMaxLevels ?? 8);
	}

	addSegment(seg: Segment): void {
		this.segments.push(seg);
		this.qt.insert(segmentBounds(seg), seg);
	}

	getQuadTree(): QuadTree<Segment> {
		return this.qt;
	}

	/** Query all segments near a point (within radius). */
	nearbySegments(x: number, y: number, radius: number): Segment[] {
		const q: Bounds = { x: x - radius, y: y - radius, width: radius * 2, height: radius * 2, rotation: 0 };
		return this.qt.retrieve(q);
	}

	/**
	 * Returns false if the new segment:
	 * - is too short
	 * - would overlap an existing segment too closely (angle + proximity check)
	 * Returns a (possibly snapped) segment if it can be placed, or null otherwise.
	 */
	canPlaceSegment(seg: Segment): { ok: true; snapped: Segment } | { ok: false } {
		const len = MathUtils.distance(seg.start, seg.end);
		if (len < this.cfg.minSegmentLength) return { ok: false };

		// Snap endpoint to nearby intersection if within snapDistance
		const nearby = this.nearbySegments(seg.end.x, seg.end.y, this.cfg.snapDistance * 2);
		let snappedEnd = seg.end;

		for (const other of nearby) {
			for (const pt of [other.start, other.end]) {
				if (MathUtils.distance(seg.end, pt) < this.cfg.snapDistance) {
					snappedEnd = pt;
					break;
				}
			}
		}

		const finalSeg: Segment = { start: seg.start, end: snappedEnd, highway: seg.highway };

		// Angle check: avoid near-duplicate branches FROM the same start point.
		// Only check segments that START near our start (not ones that END there —
		// those are parent segments we are extending from, which is valid).
		const nearStart = this.nearbySegments(seg.start.x, seg.start.y, this.cfg.snapDistance);
		for (const other of nearStart) {
			if (MathUtils.distance(seg.start, other.start) < this.cfg.snapDistance) {
				const existingAngle = Math.atan2(other.end.y - other.start.y, other.end.x - other.start.x);
				const newAngle = Math.atan2(finalSeg.end.y - finalSeg.start.y, finalSeg.end.x - finalSeg.start.x);
				if (Math.abs(MathUtils.angleDiff(existingAngle, newAngle)) < this.cfg.minAngleDiff) {
					return { ok: false };
				}
			}
		}

		return { ok: true, snapped: finalSeg };
	}
}
