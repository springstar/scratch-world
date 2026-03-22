/** Geometric utility functions used by road and building generators. */

import type { Point, Segment, Bounds } from "./types.js";

export const MathUtils = {
  /** Euclidean distance between two points. */
  distance(a: Point, b: Point): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  },

  /**
   * Intersection point of two infinite lines defined by segments.
   * Returns null if lines are parallel (or coincident).
   * Also returns t (param on seg1) and u (param on seg2) for range checks.
   */
  lineIntersection(
    p1: Point, p2: Point,
    p3: Point, p4: Point,
  ): { point: Point; t: number; u: number } | null {
    const d1x = p2.x - p1.x;
    const d1y = p2.y - p1.y;
    const d2x = p4.x - p3.x;
    const d2y = p4.y - p3.y;

    const denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) < 1e-10) return null;

    const dx = p3.x - p1.x;
    const dy = p3.y - p1.y;
    const t = (dx * d2y - dy * d2x) / denom;
    const u = (dx * d1y - dy * d1x) / denom;

    return {
      point: { x: p1.x + t * d1x, y: p1.y + t * d1y },
      t,
      u,
    };
  },

  /** True if segment [p1,p2] and segment [p3,p4] intersect (exclusive of shared endpoints). */
  doLineSegmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
    const r = MathUtils.lineIntersection(p1, p2, p3, p4);
    if (!r) return false;
    return r.t > 1e-10 && r.t < 1 - 1e-10 && r.u > 1e-10 && r.u < 1 - 1e-10;
  },

  /** Minimum distance from point p to segment [a, b]. */
  pointSegmentDistance(p: Point, seg: Segment): number {
    const dx = seg.end.x - seg.start.x;
    const dy = seg.end.y - seg.start.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-10) return MathUtils.distance(p, seg.start);
    const t = Math.max(0, Math.min(1, ((p.x - seg.start.x) * dx + (p.y - seg.start.y) * dy) / lenSq));
    return MathUtils.distance(p, { x: seg.start.x + t * dx, y: seg.start.y + t * dy });
  },

  /** Smallest signed difference between two angles (radians), result in [-π, π]. */
  angleDiff(a: number, b: number): number {
    let diff = (b - a) % (Math.PI * 2);
    if (diff > Math.PI)  diff -= Math.PI * 2;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return diff;
  },

  /**
   * Rotate point `p` around `center` by `angleDeg` degrees.
   * Matches SimWorld MathUtils.rotate_point().
   */
  rotatePoint(center: Point, p: Point, angleDeg: number): Point {
    const rad = (angleDeg * Math.PI) / 180;
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    return {
      x: center.x + dx * Math.cos(rad) - dy * Math.sin(rad),
      y: center.y + dx * Math.sin(rad) + dy * Math.cos(rad),
    };
  },

  /** Linearly interpolate along segment at parameter t ∈ [0,1]. */
  interpolate(seg: Segment, t: number): Point {
    return {
      x: seg.start.x + t * (seg.end.x - seg.start.x),
      y: seg.start.y + t * (seg.end.y - seg.start.y),
    };
  },

  /**
   * Get the four rotated corners of a Bounds rectangle.
   * Returns [tl, tr, bl, br] in world space.
   */
  boundsCorners(b: Bounds): [Point, Point, Point, Point] {
    const cx = b.x + b.width  / 2;
    const cy = b.y + b.height / 2;
    const center: Point = { x: cx, y: cy };
    return [
      MathUtils.rotatePoint(center, { x: b.x,           y: b.y            }, b.rotation),
      MathUtils.rotatePoint(center, { x: b.x + b.width, y: b.y            }, b.rotation),
      MathUtils.rotatePoint(center, { x: b.x,           y: b.y + b.height }, b.rotation),
      MathUtils.rotatePoint(center, { x: b.x + b.width, y: b.y + b.height }, b.rotation),
    ];
  },
};
