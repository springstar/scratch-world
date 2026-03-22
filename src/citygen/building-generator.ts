/**
 * BuildingGenerator — places buildings along both sides of each road segment.
 * Port of SimWorld simworld/citygen/building/building_generator.py.
 *
 * Algorithm per segment:
 *   1. Walk along each side (left / right) from INTERSECTION_BUFFER to end.
 *   2. Pick next building type (respects numLimit quotas, tries largest first).
 *   3. Compute center position (perpendicular offset from road).
 *   4. Check: no overlap with other buildings (BuildingManager QuadTree),
 *             no overlap with road geometry (road QuadTree + corner distances).
 *   5. If ok → place; else → try smaller type or skip.
 */

import type { Building, BuildingType, Bounds, Segment } from "./types.js";
import { BuildingManager } from "./building-manager.js";
import { QuadTree } from "./quad-tree.js";
import { MathUtils } from "./math-utils.js";

export interface BuildingGeneratorConfig {
	/** World bounds for the spatial index */
	qtBounds: { x: number; y: number; width: number; height: number };
	qtMaxObjects?: number;
	qtMaxLevels?: number;

	/** Gap between road end-points and first/last building */
	buildingIntersectionDistance: number;
	/** Distance from road centre-line to building face */
	buildingSideDistance: number;
	/** Gap between adjacent buildings along road */
	buildingBuildingDistance: number;
	/** Clearance between building corner and nearest road */
	buildingRoadDistance: number;
}

export class BuildingGenerator {
	private cfg: BuildingGeneratorConfig;
	private manager: BuildingManager;
	private sortedTypes: BuildingType[]; // largest → smallest by width
	private counts: Map<BuildingType, number>;

	constructor(cfg: BuildingGeneratorConfig, buildingTypes: BuildingType[]) {
		this.cfg = cfg;
		this.manager = new BuildingManager({
			qtBounds: cfg.qtBounds,
			qtMaxObjects: cfg.qtMaxObjects,
			qtMaxLevels: cfg.qtMaxLevels,
			buildingBuildingDistance: cfg.buildingBuildingDistance,
		});
		this.sortedTypes = [...buildingTypes].sort((a, b) => b.width - a.width);
		this.counts = new Map(buildingTypes.map((b) => [b, 0]));
	}

	get buildings(): Building[] {
		return this.manager.buildings;
	}

	/** Pick the next building type respecting numLimit quotas. */
	private nextType(): BuildingType {
		// Try limited types first (shuffled)
		const limited = this.sortedTypes.filter((b) => b.numLimit !== -1);
		const shuffled = [...limited].sort(() => Math.random() - 0.5);
		for (const bt of shuffled) {
			if ((this.counts.get(bt) ?? 0) < bt.numLimit) return bt;
		}
		const unlimited = this.sortedTypes.filter((b) => b.numLimit === -1);
		if (unlimited.length > 0) return unlimited[Math.floor(Math.random() * unlimited.length)];
		return this.sortedTypes[this.sortedTypes.length - 1];
	}

	/** Smallest available type that hasn't hit its limit. */
	private smallestAvailable(): BuildingType | null {
		for (let i = this.sortedTypes.length - 1; i >= 0; i--) {
			const bt = this.sortedTypes[i];
			if (bt.numLimit === -1 || (this.counts.get(bt) ?? 0) < bt.numLimit) return bt;
		}
		return null;
	}

	/** Place buildings along one segment. Call for every road segment. */
	generateAlongSegment(seg: Segment, roadQt: QuadTree<Segment>): void {
		const dx = seg.end.x - seg.start.x;
		const dy = seg.end.y - seg.start.y;
		const length = Math.sqrt(dx * dx + dy * dy);
		if (length < 1) return;

		const ux = dx / length;
		const uy = dy / length;
		const px = -uy; // perpendicular
		const py = ux;

		const IBUF = this.cfg.buildingIntersectionDistance;
		const GAP = this.cfg.buildingBuildingDistance;
		const SIDE = this.cfg.buildingSideDistance;

		// Smallest building width — used as minimum step to prevent infinite loops
		const minWidth = this.sortedTypes[this.sortedTypes.length - 1].width;
		const MIN_STEP = minWidth + GAP;

		for (const side of [-1, 1] as const) {
			let bt = this.nextType();
			let pos = IBUF + bt.width / 2;

			while (pos < length - IBUF) {
				const rotDeg = ((Math.atan2(uy, ux) * 180) / Math.PI + (side === 1 ? 180 : 0) + 360) % 360;
				const offset = SIDE + bt.height / 2;
				const cx = seg.start.x + ux * pos + side * px * offset;
				const cy = seg.start.y + uy * pos + side * py * offset;
				const bounds: Bounds = {
					x: cx - bt.width / 2,
					y: cy - bt.height / 2,
					width: bt.width,
					height: bt.height,
					rotation: rotDeg,
				};

				if (this.manager.canPlaceBuilding(bounds) && !this.checkRoadOverlap(bounds, roadQt)) {
					// Place this building
					this.manager.addBuilding({ type: bt, bounds, rotation: rotDeg, segmentRef: seg });
					this.counts.set(bt, (this.counts.get(bt) ?? 0) + 1);

					// Find a valid next building type and advance pos
					const placedWidth = bt.width;
					bt = this.nextType();
					pos += placedWidth / 2 + bt.width / 2 + GAP;
				} else {
					// Try smaller type at this position; if none fit, advance and retry
					const idx = this.sortedTypes.indexOf(bt) + 1;
					if (idx < this.sortedTypes.length) {
						bt = this.sortedTypes[idx];
						// Re-try at same pos with smaller building (bt.width/2 might change)
						// Adjust pos so building centre stays at road distance from last boundary
						// (simple: keep pos, recalculate with new width next iteration)
					} else {
						// No building type fits here — advance by minimum step
						bt = this.nextType();
						pos += MIN_STEP;
					}
				}
			}
		}
	}

	/** Remove buildings that ended up overlapping roads (post-pass cleanup). */
	filterOverlappingBuildings(roadQt: QuadTree<Segment>): void {
		const toRemove = this.manager.buildings.filter((b) => this.checkRoadOverlap(b.bounds, roadQt));
		for (const b of toRemove) this.manager.removeBuilding(b);
	}

	private checkRoadOverlap(bounds: Bounds, roadQt: QuadTree<Segment>): boolean {
		const CLEARANCE = this.cfg.buildingRoadDistance;
		const IBUF = this.cfg.buildingIntersectionDistance;
		const margin = Math.max(CLEARANCE, IBUF);

		const searchBounds: Bounds = {
			x: bounds.x - margin,
			y: bounds.y - margin,
			width: bounds.width + 2 * margin,
			height: bounds.height + 2 * margin,
			rotation: bounds.rotation,
		};

		const nearby = roadQt.retrieve(searchBounds);
		const corners = MathUtils.boundsCorners(bounds);
		const center = {
			x: bounds.x + bounds.width / 2,
			y: bounds.y + bounds.height / 2,
		};

		const edges: [(typeof corners)[0], (typeof corners)[0]][] = [
			[corners[0], corners[1]],
			[corners[1], corners[3]],
			[corners[2], corners[3]],
			[corners[0], corners[2]],
		];

		for (const seg of nearby) {
			// Corner-to-segment distance
			for (const corner of corners) {
				if (MathUtils.pointSegmentDistance(corner, seg) <= CLEARANCE) return true;
			}
			// Edge-to-segment intersection
			for (const [ea, eb] of edges) {
				if (MathUtils.doLineSegmentsIntersect(seg.start, seg.end, ea, eb)) return true;
			}
			// Endpoint proximity to building center
			for (const pt of [seg.start, seg.end]) {
				if (MathUtils.distance(pt, center) < IBUF) return true;
			}
		}
		return false;
	}
}
