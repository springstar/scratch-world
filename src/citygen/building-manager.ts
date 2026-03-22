/**
 * BuildingManager — QuadTree-backed spatial index for placed buildings.
 * Port of SimWorld simworld/citygen/building/building_manager.py + bbox_utils.py.
 */

import type { Building, Bounds } from "./types.js";
import { QuadTree } from "./quad-tree.js";
import { MathUtils } from "./math-utils.js";

/** Check overlap between two (possibly rotated) bounding boxes using SAT-lite. */
function bboxOverlap(a: Bounds, b: Bounds): boolean {
	const cornersA = MathUtils.boundsCorners(a);
	const cornersB = MathUtils.boundsCorners(b);

	// Ray-casting point-in-polygon for corner containment
	function pointInPoly(px: number, py: number, poly: Array<{ x: number; y: number }>): boolean {
		let inside = false;
		let x1 = poly[poly.length - 1].x;
		let y1 = poly[poly.length - 1].y;
		for (const v of poly) {
			const x2 = v.x,
				y2 = v.y;
			if (Math.min(y1, y2) < py && py <= Math.max(y1, y2) && px <= Math.max(x1, x2)) {
				if (y1 !== y2) {
					const xInt = ((py - y1) * (x2 - x1)) / (y2 - y1) + x1;
					if (x1 === x2 || px <= xInt) inside = !inside;
				}
			}
			x1 = x2;
			y1 = y2;
		}
		return inside;
	}

	type Pt = { x: number; y: number };
	function segIntersect(p1: Pt, q1: Pt, p2: Pt, q2: Pt): boolean {
		function orient(p: Pt, q: Pt, r: Pt) {
			const v = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
			return v === 0 ? 0 : v > 0 ? 1 : 2;
		}
		function onSeg(p: Pt, q: Pt, r: Pt) {
			return (
				Math.min(p.x, r.x) <= q.x &&
				q.x <= Math.max(p.x, r.x) &&
				Math.min(p.y, r.y) <= q.y &&
				q.y <= Math.max(p.y, r.y)
			);
		}
		const [o1, o2, o3, o4] = [orient(p1, q1, p2), orient(p1, q1, q2), orient(p2, q2, p1), orient(p2, q2, q1)];
		if (o1 !== o2 && o3 !== o4) return true;
		if (o1 === 0 && onSeg(p1, p2, q1)) return true;
		if (o2 === 0 && onSeg(p1, q2, q1)) return true;
		if (o3 === 0 && onSeg(p2, p1, q2)) return true;
		if (o4 === 0 && onSeg(p2, q1, q2)) return true;
		return false;
	}

	// Check corner containment both ways
	const polyA = cornersA as unknown as [Pt, Pt, Pt, Pt];
	const polyB = cornersB as unknown as [Pt, Pt, Pt, Pt];

	for (const c of cornersA) if (pointInPoly(c.x, c.y, polyB as any)) return true;
	for (const c of cornersB) if (pointInPoly(c.x, c.y, polyA as any)) return true;

	// Edge intersection
	const edgesA = [
		[cornersA[0], cornersA[1]],
		[cornersA[1], cornersA[3]],
		[cornersA[3], cornersA[2]],
		[cornersA[2], cornersA[0]],
	] as [Pt, Pt][];
	const edgesB = [
		[cornersB[0], cornersB[1]],
		[cornersB[1], cornersB[3]],
		[cornersB[3], cornersB[2]],
		[cornersB[2], cornersB[0]],
	] as [Pt, Pt][];

	for (const ea of edgesA) for (const eb of edgesB) if (segIntersect(ea[0], ea[1], eb[0], eb[1])) return true;

	return false;
}

export interface BuildingManagerConfig {
	qtBounds: { x: number; y: number; width: number; height: number };
	qtMaxObjects?: number;
	qtMaxLevels?: number;
	/** Minimum spacing between buildings */
	buildingBuildingDistance: number;
}

export class BuildingManager {
	private qt: QuadTree<Building>;
	readonly buildings: Building[] = [];
	private cfg: BuildingManagerConfig;

	constructor(cfg: BuildingManagerConfig) {
		this.cfg = cfg;
		this.qt = new QuadTree<Building>({ ...cfg.qtBounds, rotation: 0 }, cfg.qtMaxObjects ?? 10, cfg.qtMaxLevels ?? 8);
	}

	canPlaceBuilding(bounds: Bounds, buffer?: number): boolean {
		const buf = buffer ?? this.cfg.buildingBuildingDistance;
		const checkBounds: Bounds = {
			x: bounds.x - buf,
			y: bounds.y - buf,
			width: bounds.width + 2 * buf,
			height: bounds.height + 2 * buf,
			rotation: bounds.rotation,
		};

		const candidates = this.qt.retrieve(checkBounds);
		for (const building of candidates) {
			if (bboxOverlap(building.bounds, checkBounds)) return false;
		}
		return true;
	}

	addBuilding(building: Building): void {
		this.buildings.push(building);
		this.qt.insert(building.bounds, building);
	}

	removeBuilding(building: Building): void {
		const idx = this.buildings.indexOf(building);
		if (idx !== -1) this.buildings.splice(idx, 1);
		this.qt.remove(building.bounds, building);
	}
}
