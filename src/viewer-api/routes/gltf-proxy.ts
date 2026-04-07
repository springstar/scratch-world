import { Hono } from "hono";

/**
 * GET /gltf-proxy?url=<encoded-polyhaven-gltf-url>
 *
 * WHY THIS EXISTS — Polyhaven texture path mismatch:
 *   Polyhaven GLTF files reference textures as relative paths like:
 *     textures/Barrel_01_explosive_diff_1k.jpg
 *   which Three.js resolves relative to the GLTF URL:
 *     https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/Barrel_01/textures/Barrel_01_explosive_diff_1k.jpg
 *   But Polyhaven actually stores texture files at:
 *     https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/Barrel_01/Barrel_01_explosive_diff_1k.jpg
 *
 *   This proxy fetches the GLTF JSON, rewrites every image URI from the relative
 *   path to the correct absolute CDN URL, and returns the patched JSON so
 *   Three.js GLTFLoader can resolve all assets correctly.
 *
 * URL rewrite rules (derived from Polyhaven CDN structure):
 *   - textures/X.jpg  →  .../Models/jpg/<res>/<Name>/X.jpg
 *   - X.bin           →  .../Models/gltf/<res>/<Name>/X.bin  (same directory as GLTF)
 *
 * The proxy also rewrites .bin buffer URIs to absolute URLs so the GLTFLoader
 * can fetch them directly from Polyhaven without a further proxy hop.
 */
export function gltfProxyRoute(): Hono {
	const app = new Hono();

	app.get("/", async (c) => {
		const rawUrl = c.req.query("url");
		if (!rawUrl) return c.json({ error: "Missing url query parameter" }, 400);

		let gltfUrl: URL;
		try {
			gltfUrl = new URL(rawUrl);
		} catch {
			return c.json({ error: "Invalid url" }, 400);
		}

		// Only proxy Polyhaven to limit attack surface
		if (!gltfUrl.hostname.endsWith("polyhaven.org")) {
			return c.json({ error: "Only polyhaven.org URLs are supported" }, 400);
		}

		// Fetch the GLTF JSON
		let upstream: Response;
		try {
			upstream = await fetch(rawUrl);
		} catch (err) {
			return c.json({ error: `Upstream fetch failed: ${String(err)}` }, 502);
		}
		if (!upstream.ok) {
			return c.json({ error: `Upstream returned ${upstream.status}` }, 502);
		}

		let gltf: Record<string, unknown>;
		try {
			gltf = (await upstream.json()) as Record<string, unknown>;
		} catch {
			return c.json({ error: "Upstream did not return valid JSON" }, 502);
		}

		// Derive the base directory URL (everything up to and including the last /)
		const baseDir = rawUrl.slice(0, rawUrl.lastIndexOf("/") + 1);

		// Derive texture base: replace /gltf/ with /jpg/ in the path
		// e.g. .../Models/gltf/1k/Barrel_01/ → .../Models/jpg/1k/Barrel_01/
		const textureBaseDir = baseDir.replace("/Models/gltf/", "/Models/jpg/");

		// Rewrite image URIs: textures/X.jpg → <textureBaseDir>X.jpg
		const images = gltf.images as Array<{ uri?: string }> | undefined;
		if (Array.isArray(images)) {
			for (const img of images) {
				if (img.uri && !img.uri.startsWith("http") && !img.uri.startsWith("data:")) {
					const filename = img.uri.replace(/^textures\//, "");
					img.uri = `${textureBaseDir}${filename}`;
				}
			}
		}

		// Rewrite buffer URIs: X.bin → <baseDir>X.bin
		const buffers = gltf.buffers as Array<{ uri?: string }> | undefined;
		if (Array.isArray(buffers)) {
			for (const buf of buffers) {
				if (buf.uri && !buf.uri.startsWith("http") && !buf.uri.startsWith("data:")) {
					buf.uri = `${baseDir}${buf.uri}`;
				}
			}
		}

		return c.json(gltf, 200, {
			"Content-Type": "model/gltf+json",
			"Cache-Control": "public, max-age=86400",
			"Access-Control-Allow-Origin": "*",
		});
	});

	return app;
}
