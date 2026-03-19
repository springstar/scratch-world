import { Hono } from "hono";
import type { NarratorRegistry } from "../../narrators/narrator-registry.js";
import type { SceneProviderRegistry } from "../../providers/scene-provider-registry.js";
import type { SkillLoader } from "../../skills/skill-loader.js";

export function generatorsRoute(
	providerRegistryRef: { current: SceneProviderRegistry },
	narratorRegistryRef: { current: NarratorRegistry },
	skillLoader: SkillLoader,
): Hono {
	const app = new Hono();

	// ── Providers (generators) ────────────────────────────────────────────
	app.get("/generators", (c) => {
		const registry = providerRegistryRef.current;
		return c.json({
			providers: registry.listProviders(),
			active: registry.activeProviderName,
		});
	});

	app.post("/generators/activate", async (c) => {
		const body = await c.req.json<{ name: string }>();
		try {
			providerRegistryRef.current = providerRegistryRef.current.activate(body.name);
			return c.json({ ok: true, active: body.name });
		} catch (err) {
			return c.json({ error: String(err) }, 400);
		}
	});

	// ── Skills ────────────────────────────────────────────────────────────
	app.get("/skills", (c) => {
		const skills = skillLoader.listSkills();
		const activeGenerator = skillLoader.getActiveSkill("generator");
		return c.json({
			skills,
			active: { generator: activeGenerator?.name ?? null },
		});
	});

	app.post("/skills/activate", async (c) => {
		const body = await c.req.json<{ category: "generator"; name: string }>();
		try {
			skillLoader.activate(body.category, body.name);
			return c.json({ ok: true, category: body.category, active: body.name });
		} catch (err) {
			return c.json({ error: String(err) }, 400);
		}
	});

	// ── Narrators ─────────────────────────────────────────────────────────
	app.get("/narrators", (c) => {
		const registry = narratorRegistryRef.current;
		return c.json({ narrators: registry.listNarrators(), active: registry.activeNaratorName });
	});

	app.post("/narrators/activate", async (c) => {
		const body = await c.req.json<{ name: string }>();
		try {
			narratorRegistryRef.current = narratorRegistryRef.current.activate(body.name);
			return c.json({ ok: true, active: body.name });
		} catch (err) {
			return c.json({ error: String(err) }, 400);
		}
	});

	return app;
}
