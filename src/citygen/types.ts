/** Core geometric types for the city generator. */

export interface Point {
	x: number;
	y: number;
}

/** A road segment between two points. */
export interface Segment {
	start: Point;
	end: Point;
	/** true = highway, false = normal road */
	highway: boolean;
}

/** Axis-aligned bounding box with optional rotation (degrees). */
export interface Bounds {
	x: number; // top-left x
	y: number; // top-left y
	width: number;
	height: number;
	rotation: number; // degrees
}

export interface Intersection {
	point: Point;
	/** Segments that meet at this intersection */
	segments: Segment[];
}

export interface BuildingType {
	/** Unique label, e.g. "house", "shop", "tower" */
	id: string;
	/** Footprint along the road direction (units) */
	width: number;
	/** Footprint perpendicular to the road (units) */
	height: number;
	/** Max count, -1 = unlimited */
	numLimit: number;
}

export interface Building {
	type: BuildingType;
	bounds: Bounds;
	/** Rotation in degrees (faces road) */
	rotation: number;
	/** The segment this building was placed along */
	segmentRef?: Segment;
}

/** Full city output returned by CityGenerator.generate() */
export interface CityData {
	segments: Segment[];
	intersections: Intersection[];
	buildings: Building[];
}
