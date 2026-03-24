import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import type { SceneManager } from "../../scene/scene-manager.js";

export function scenesRoute(sceneManager: SceneManager, projectRoot: string): Hono {
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

	// POST /scenes/:sceneId/panorama — set equirectangular skybox
	// Accepts:
	//   multipart/form-data  { file: <image> }  → uploads to /uploads/panoramas/
	//   application/json     { url: string }    → uses the URL directly
	app.post("/:sceneId/panorama", async (c) => {
		const { sceneId } = c.req.param();
		const scene = await sceneManager.getScene(sceneId);
		if (!scene) return c.json({ error: "Scene not found" }, 404);

		let skyboxUrl: string;

		const contentType = c.req.header("content-type") ?? "";
		if (contentType.includes("multipart/form-data")) {
			const form = await c.req.formData();
			const file = form.get("file") as File | null;
			if (!file) return c.json({ error: "Missing 'file' field" }, 400);

			const ext = file.name.split(".").pop() ?? "jpg";
			const filename = `${sceneId}.${ext}`;
			const uploadsDir = join(projectRoot, "uploads", "panoramas");
			await mkdir(uploadsDir, { recursive: true });
			await writeFile(join(uploadsDir, filename), Buffer.from(await file.arrayBuffer()));
			skyboxUrl = `/uploads/panoramas/${filename}`;
		} else {
			const body = await c.req.json<{ url?: string }>();
			if (!body?.url) return c.json({ error: "Missing 'url' field" }, 400);
			skyboxUrl = body.url;
		}

		const merged = {
			...scene.sceneData,
			environment: { ...scene.sceneData.environment, skyboxUrl },
		};
		const updated = await sceneManager.updateScene(sceneId, "Set panorama skybox", merged);

		return c.json({ sceneId: updated.sceneId, version: updated.version, skyboxUrl });
	});

	return app;
}
