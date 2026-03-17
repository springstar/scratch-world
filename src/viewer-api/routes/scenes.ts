import { Hono } from "hono";
import type { SceneManager } from "../../scene/scene-manager.js";

export function scenesRoute(sceneManager: SceneManager): Hono {
	const app = new Hono();

	// GET /scenes/:sceneId — viewer fetches scene data on mount
	app.get("/:sceneId", async (c) => {
		const { sceneId } = c.req.param();
		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);
		return c.json({
			sceneId: scene.sceneId,
			title: scene.title,
			description: scene.description,
			version: scene.version,
			sceneData: scene.sceneData,
			providerRef: {
				provider: scene.providerRef.provider,
				viewUrl: scene.providerRef.viewUrl,
				// editToken intentionally omitted — viewer has no need for it
			},
		});
	});

	return app;
}
