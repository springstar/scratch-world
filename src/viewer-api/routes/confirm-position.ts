import { Hono } from "hono";
import { resolvePicker } from "../position-picker-registry.js";

export function confirmPositionRoute(): Hono {
	const app = new Hono();

	// POST /confirm-position/:pickerId
	// Body: { pos: { x: number; y: number; z: number } }
	app.post("/:pickerId", async (c) => {
		const { pickerId } = c.req.param();
		const body = await c.req.json<{ pos: { x: number; y: number; z: number } }>();
		if (typeof body?.pos?.x !== "number" || typeof body?.pos?.y !== "number" || typeof body?.pos?.z !== "number") {
			return c.json({ ok: false, error: "Invalid pos" }, 400);
		}
		const resolved = resolvePicker(pickerId, body.pos);
		return c.json({ ok: resolved });
	});

	return app;
}
