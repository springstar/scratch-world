import { Hono } from "hono";
import type { SceneManager } from "../../scene/scene-manager.js";

/**
 * GET /splat/:sceneId
 *
 * Proxy route: fetches the SPZ file from Marble's authenticated CDN using the
 * server-side WLT-Api-Key, then streams it to the browser.
 *
 * WHY THIS EXISTS — auth problem:
 *   Marble's spz_urls[] are protected by WLT-Api-Key.
 *   The API key lives on the backend and must never be exposed to the browser.
 *   This proxy adds the header server-side so the SplatViewer can load the splat
 *   from a plain unauthenticated URL (/splat/:sceneId).
 *
 * Caching:
 *   Response is cached for 1 hour via Cache-Control.  For permanent caching,
 *   prefer the local-cache strategy (SPZ_MODE=local) in MarbleProvider which
 *   saves the file to uploads/splats/ at generation time.
 */
export function splatProxyRoute(sceneManager: SceneManager, marbleApiKey: string | undefined): Hono {
	const app = new Hono();

	app.get("/:sceneId", async (c) => {
		if (!marbleApiKey) {
			return c.json({ error: "MARBLE_API_KEY not configured — splat proxy unavailable" }, 503);
		}

		const { sceneId } = c.req.param();
		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);

		// spz_urls are stored in metadata.spzUrls by MarbleProvider
		const meta = scene.sceneData.objects[0]?.metadata as Record<string, unknown> | undefined;
		const spzUrls = meta?.spzUrls as string[] | null | undefined;
		const spzUrl = spzUrls?.[0];

		if (!spzUrl) {
			return c.json({ error: "No SPZ URL available for this scene" }, 404);
		}

		// Fetch from Marble CDN with API key
		const upstream = await fetch(spzUrl, {
			headers: { "WLT-Api-Key": marbleApiKey },
		});

		if (!upstream.ok) {
			return c.json({ error: `Marble CDN returned ${upstream.status}` }, 502);
		}

		const body = await upstream.arrayBuffer();
		return c.body(body, 200, {
			"Content-Type": "application/octet-stream",
			"Content-Disposition": `inline; filename="${sceneId}.spz"`,
			"Cache-Control": "public, max-age=3600",
			"Access-Control-Allow-Origin": "*",
		});
	});

	return app;
}
