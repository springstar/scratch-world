import { Hono } from "hono";
import { storeScreenshot } from "../screenshot-store.js";

export const screenshotsRoute = new Hono();

// POST /screenshots/:sceneId
// Body: { dataUrl: string }  — JPEG data URL from the viewer canvas
screenshotsRoute.post("/:sceneId", async (c) => {
	const { sceneId } = c.req.param();
	const body = (await c.req.json()) as { dataUrl?: string };
	if (typeof body.dataUrl !== "string" || !body.dataUrl.startsWith("data:image/")) {
		return c.json({ error: "dataUrl must be a valid image data URL" }, 400);
	}
	storeScreenshot(sceneId, body.dataUrl);
	return c.json({ ok: true });
});
