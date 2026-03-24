/**
 * Generic QuadTree for 2-D spatial indexing.
 * Port of SimWorld simworld/utils/quadtree.py.
 *
 * Items are stored with their Bounds key so they can be retrieved by
 * overlapping region queries and removed individually.
 */

import type { Bounds } from "./types.js";

interface Entry<T> {
	bounds: Bounds;
	item: T;
}

function _boundsOverlap(a: Bounds, b: Bounds): boolean {
	return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function _boundsContains(outer: Bounds, inner: Bounds): boolean {
	return (
		inner.x >= outer.x &&
		inner.y >= outer.y &&
		inner.x + inner.width <= outer.x + outer.width &&
		inner.y + inner.height <= outer.y + outer.height
	);
}

export class QuadTree<T> {
	private bounds: Bounds;
	private maxObjects: number;
	private maxLevels: number;
	private level: number;

	private objects: Entry<T>[] = [];
	private nodes: QuadTree<T>[] = [];

	constructor(bounds: Bounds, maxObjects = 10, maxLevels = 5, level = 0) {
		this.bounds = bounds;
		this.maxObjects = maxObjects;
		this.maxLevels = maxLevels;
		this.level = level;
	}

	clear(): void {
		this.objects = [];
		this.nodes = [];
	}

	private split(): void {
		const hw = this.bounds.width / 2;
		const hh = this.bounds.height / 2;
		const x = this.bounds.x;
		const y = this.bounds.y;
		const nextLevel = this.level + 1;

		this.nodes = [
			// top-right
			new QuadTree<T>(
				{ x: x + hw, y, width: hw, height: hh, rotation: 0 },
				this.maxObjects,
				this.maxLevels,
				nextLevel,
			),
			// top-left
			new QuadTree<T>({ x, y, width: hw, height: hh, rotation: 0 }, this.maxObjects, this.maxLevels, nextLevel),
			// bottom-left
			new QuadTree<T>(
				{ x, y: y + hh, width: hw, height: hh, rotation: 0 },
				this.maxObjects,
				this.maxLevels,
				nextLevel,
			),
			// bottom-right
			new QuadTree<T>(
				{ x: x + hw, y: y + hh, width: hw, height: hh, rotation: 0 },
				this.maxObjects,
				this.maxLevels,
				nextLevel,
			),
		];
	}

	private getIndex(b: Bounds): number {
		const midX = this.bounds.x + this.bounds.width / 2;
		const midY = this.bounds.y + this.bounds.height / 2;

		const fitsTop = b.y + b.height <= midY;
		const fitsBottom = b.y >= midY;
		const fitsLeft = b.x + b.width <= midX;
		const fitsRight = b.x >= midX;

		if (fitsRight && fitsTop) return 0;
		if (fitsLeft && fitsTop) return 1;
		if (fitsLeft && fitsBottom) return 2;
		if (fitsRight && fitsBottom) return 3;
		return -1; // spans multiple quadrants
	}

	insert(bounds: Bounds, item: T): void {
		if (this.nodes.length > 0) {
			const idx = this.getIndex(bounds);
			if (idx !== -1) {
				this.nodes[idx].insert(bounds, item);
				return;
			}
		}

		this.objects.push({ bounds, item });

		if (this.objects.length > this.maxObjects && this.level < this.maxLevels) {
			if (this.nodes.length === 0) this.split();

			let i = 0;
			while (i < this.objects.length) {
				const idx = this.getIndex(this.objects[i].bounds);
				if (idx !== -1) {
					const [entry] = this.objects.splice(i, 1);
					this.nodes[idx].insert(entry.bounds, entry.item);
				} else {
					i++;
				}
			}
		}
	}

	/** Return all items whose bounds overlap with `queryBounds`. */
	retrieve(queryBounds: Bounds): T[] {
		const result: T[] = this.objects.map((e) => e.item);

		if (this.nodes.length > 0) {
			const idx = this.getIndex(queryBounds);
			if (idx !== -1) {
				result.push(...this.nodes[idx].retrieve(queryBounds));
			} else {
				for (const node of this.nodes) {
					result.push(...node.retrieve(queryBounds));
				}
			}
		}
		return result;
	}

	/** Remove a specific item (matched by reference equality). */
	remove(bounds: Bounds, item: T): boolean {
		const localIdx = this.objects.findIndex((e) => e.item === item);
		if (localIdx !== -1) {
			this.objects.splice(localIdx, 1);
			return true;
		}

		if (this.nodes.length > 0) {
			const idx = this.getIndex(bounds);
			if (idx !== -1) return this.nodes[idx].remove(bounds, item);
			for (const node of this.nodes) {
				if (node.remove(bounds, item)) return true;
			}
		}
		return false;
	}

	/** Number of items stored in the entire tree. */
	size(): number {
		let n = this.objects.length;
		for (const node of this.nodes) n += node.size();
		return n;
	}
}
