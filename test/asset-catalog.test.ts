/**
 * asset-catalog.test.ts
 *
 * Harness validation for the asset catalog.
 *
 * Required invariants:
 *   - All entries have required fields (id, url, type, tags, scale, source, qualityTier)
 *   - All photorealistic entries have worldSizeM defined
 *   - worldSizeM[1] (height) is in [0.01, 10] metres — catches cm/mm unit mistakes
 *   - All URLs are HTTPS
 *   - polyhaven source entries have polyhavenId
 *   - No duplicate IDs
 *
 * Optional reachability test (slow, network):
 *   ASSET_CHECK=1 npx tsx ../../node_modules/vitest/dist/cli.js --run test/asset-catalog.test.ts
 */

import { describe, it, expect } from "vitest";
import {
	ASSET_CATALOG,
	findAssets,
	findMarbleCompatibleAssets,
	getAsset,
} from "../viewer/src/renderer/asset-catalog.js";

describe("ASSET_CATALOG schema validation", () => {
	it("has no duplicate IDs", () => {
		const ids = ASSET_CATALOG.map((e) => e.id);
		const unique = new Set(ids);
		const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
		expect(dupes, `Duplicate IDs: ${dupes.join(", ")}`).toHaveLength(0);
	});

	it("all entries have required scalar fields", () => {
		for (const e of ASSET_CATALOG) {
			expect(e.id, `${e.id}: missing id`).toBeTruthy();
			expect(e.url, `${e.id}: missing url`).toBeTruthy();
			expect(e.type, `${e.id}: missing type`).toBeTruthy();
			expect(Array.isArray(e.tags), `${e.id}: tags must be array`).toBe(true);
			expect(typeof e.scale, `${e.id}: scale must be number`).toBe("number");
			expect(typeof e.groundOffset, `${e.id}: groundOffset must be number`).toBe("number");
			expect(e.source, `${e.id}: missing source`).toBeTruthy();
			expect(e.qualityTier, `${e.id}: missing qualityTier`).toBeTruthy();
		}
	});

	it("all URLs are HTTPS", () => {
		for (const e of ASSET_CATALOG) {
			expect(e.url, `${e.id}: URL must be HTTPS`).toMatch(/^https:\/\//);
		}
	});

	it("photorealistic entries have worldSizeM", () => {
		const missing = ASSET_CATALOG.filter((e) => e.qualityTier === "photorealistic" && !e.worldSizeM);
		expect(
			missing.map((e) => e.id),
			`Photorealistic entries missing worldSizeM`,
		).toHaveLength(0);
	});

	it("worldSizeM dimensions are in plausible metres range [0.01, 10]", () => {
		const bad: string[] = [];
		for (const e of ASSET_CATALOG) {
			if (!e.worldSizeM) continue;
			const [w, h, d] = e.worldSizeM;
			if (w < 0.01 || w > 10 || h < 0.01 || h > 10 || d < 0.01 || d > 10) {
				bad.push(`${e.id}: worldSizeM=[${w}, ${h}, ${d}]`);
			}
		}
		expect(bad, `Out-of-range worldSizeM:\n${bad.join("\n")}`).toHaveLength(0);
	});

	it("polyhaven entries have polyhavenId", () => {
		const missing = ASSET_CATALOG.filter((e) => e.source === "polyhaven" && !e.polyhavenId);
		expect(
			missing.map((e) => e.id),
			`Polyhaven entries missing polyhavenId`,
		).toHaveLength(0);
	});

	it("qualityTier is one of the allowed values", () => {
		const allowed = new Set(["photorealistic", "stylized", "demo"]);
		for (const e of ASSET_CATALOG) {
			expect(allowed.has(e.qualityTier), `${e.id}: invalid qualityTier '${e.qualityTier}'`).toBe(true);
		}
	});
});

describe("findAssets()", () => {
	it("filters by type", () => {
		const props = findAssets("prop");
		expect(props.length).toBeGreaterThan(0);
		expect(props.every((e) => e.type === "prop")).toBe(true);
	});

	it("filters by qualityTier", () => {
		const photorealistic = findAssets("prop", undefined, "photorealistic");
		expect(photorealistic.every((e) => e.qualityTier === "photorealistic")).toBe(true);
	});

	it("filters by tags", () => {
		const chairs = findAssets("furniture", ["chair"]);
		expect(chairs.length).toBeGreaterThan(0);
		expect(chairs.every((e) => e.tags.includes("chair"))).toBe(true);
	});
});

describe("findMarbleCompatibleAssets()", () => {
	it("returns only photorealistic entries", () => {
		const assets = findMarbleCompatibleAssets();
		expect(assets.length).toBeGreaterThan(0);
		expect(assets.every((e) => e.qualityTier === "photorealistic")).toBe(true);
	});

	it("filters by type when provided", () => {
		const furniture = findMarbleCompatibleAssets("furniture");
		expect(furniture.every((e) => e.type === "furniture")).toBe(true);
	});
});

describe("getAsset()", () => {
	it("returns entry by id", () => {
		const first = ASSET_CATALOG[0];
		const found = getAsset(first.id);
		expect(found).toBeDefined();
		expect(found?.id).toBe(first.id);
	});

	it("returns undefined for unknown id", () => {
		expect(getAsset("nonexistent_asset_xyz")).toBeUndefined();
	});
});

// Optional network reachability smoke test — only runs with ASSET_CHECK=1
describe.skipIf(!process.env.ASSET_CHECK)("URL reachability (ASSET_CHECK=1)", () => {
	it("all catalog URLs are reachable (HEAD requests)", async () => {
		const results = await Promise.allSettled(
			ASSET_CATALOG.map(async (e) => {
				const res = await fetch(e.url, { method: "HEAD" });
				if (!res.ok) throw new Error(`${e.id}: ${e.url} returned ${res.status}`);
			}),
		);
		const failures = results
			.filter((r) => r.status === "rejected")
			.map((r) => (r as PromiseRejectedResult).reason.message);
		expect(failures, `Unreachable URLs:\n${failures.join("\n")}`).toHaveLength(0);
	}, 60000);
});
