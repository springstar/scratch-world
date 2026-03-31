import { Hono } from "hono";
import type { SceneManager } from "../../scene/scene-manager.js";

/**
 * GET /collider/:sceneId
 *
 * Proxy route: fetches the physics collision mesh (.glb) from Marble's CDN using
 * the server-side WLT-Api-Key, then streams it to the browser.
 *
 * WHY THIS EXISTS — same auth problem as /splat/:sceneId:
 *   Marble's collider_mesh_url is protected by WLT-Api-Key.
 *   This proxy adds the header server-side so buildWorldColliders() can load it
 *   via a plain unauthenticated URL (/collider/:sceneId).
 */
export function colliderProxyRoute(sceneManager: SceneManager, marbleApiKey: string | undefined): Hono {
	const app = new Hono();

	app.get("/:sceneId", async (c) => {
		if (!marbleApiKey) {
			return c.json({ error: "MARBLE_API_KEY not configured — collider proxy unavailable" }, 503);
		}

		const { sceneId } = c.req.param();
		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);

		const colliderMeshUrl = scene.sceneData.colliderMeshUrl;
		if (!colliderMeshUrl) {
			return c.json({ error: "No collider mesh available for this scene" }, 404);
		}

		const upstream = await fetch(colliderMeshUrl, {
			headers: { "WLT-Api-Key": marbleApiKey },
		});

		if (!upstream.ok) {
			return c.json({ error: `Marble CDN returned ${upstream.status}` }, 502);
		}

		const body = await upstream.arrayBuffer();
		return c.body(body, 200, {
			"Content-Type": "model/gltf-binary",
			"Content-Disposition": `inline; filename="${sceneId}-collider.glb"`,
			"Cache-Control": "public, max-age=3600",
			"Access-Control-Allow-Origin": "*",
		});
	});

	return app;
}
