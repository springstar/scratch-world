import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import { getScreenshot } from "../../viewer-api/screenshot-store.js";
import { logFeedback } from "../feedback-logger.js";

const parameters = Type.Object({
	sceneId: Type.String({ description: "ID of the scene to evaluate" }),
	sessionId: Type.Optional(Type.String({ description: "Session ID for feedback logging" })),
});

interface CheckResult {
	skeleton: boolean;
	anchor: boolean;
	scale: boolean;
	lighting: boolean;
	placement: boolean;
	geometry: boolean;
	scatter: boolean;
	depth: boolean;
	characters: boolean;
	atmosphere: boolean;
}

interface EvalResponse {
	checks: CheckResult;
	issues: string[];
	passed: number;
	total: number;
}

const EVAL_PROMPT = `You are a strict 3D scene quality reviewer. Evaluate this screenshot against 10 criteria. Be harsh — a scene that looks like programmer art, not a game scene, should fail multiple checks. Return ONLY valid JSON.

CRITERIA (mark false if there is ANY doubt):

1. skeleton
   PASS: Camera can see surfaces in all directions — ground, sky/ceiling, and background boundary visible. No raw black void in any direction.
   FAIL: Any direction from camera shows pure black emptiness.

2. anchor
   PASS: ONE dominant element clearly fills ~40% of the frame and draws the eye first.
   FAIL: Scene looks like a collection of equal-sized objects with no clear focal point. OR the main feature is only a thin line at the horizon.

3. scale
   PASS: Object proportions feel real-world correct. Humans (if present) are roughly 1.8m. Buildings/trees dwarf humans appropriately.
   FAIL: Objects are wildly out of proportion — a person taller than a building, a boat as big as a house, trees dwarfed by canoe paddles.

4. lighting
   PASS: Scene has clear, consistent single-source lighting with natural shadows. Objects have shaded and lit faces.
   FAIL: Scene is uniformly dark, uniformly bright/white, or has multiple conflicting shadow directions. Flat ambient-only look.

5. placement
   PASS: All objects rest on surfaces naturally. Nothing floats without explanation.
   FAIL: Objects hover above the ground, sink into terrain, or are clearly mispositioned.

6. geometry
   PASS: No visible rendering artifacts, z-fighting, broken polygons, or missing geometry that looks like a bug.
   FAIL: Visible z-fighting (flickering stripes), missing mesh faces, corrupted geometry.

7. scatter
   PASS: Trees, bushes, rocks placed in natural irregular patterns — clusters, varied spacing, different sizes visible.
   FAIL: Trees form a visible straight row or column (colonnade). Trees at IDENTICAL height in a line. Grid pattern of equidistant trees. Even 4-5 trees in a perfect row should fail this check.

8. depth
   PASS: Objects exist at three distances — something within ~6m of camera (foreground detail), main scene 6-25m (midground), AND distant background 25m+.
   FAIL: Scene is flat — everything at one distance from camera, like a painted backdrop. No near/far layering. OR forest/vegetation only appears as a thin line at the horizon with nothing in mid/foreground.

9. characters
   PASS: Any human or animal figures look like real 3D character models with natural silhouettes.
   FAIL: Humanoid figures are clearly assembled from geometric primitives — box torso + sphere head + cone body. Traffic-cone-shaped people. Minecraft-block figures. If figures look like colored geometric objects stacked together, FAIL.

10. atmosphere
    PASS: Sky preset, fog density, and ambient mood match the environment type. Tropical/jungle = overcast or hazy sky with visible fog. Desert = clear sky, warm haze. Night = dark sky with artificial lights. Indoor = no sky, warm enclosed lighting.
    FAIL: Tropical rainforest scene has a clear blue sky with no fog (too cheerful for dense jungle). Desert has dense grey fog. Indoor scene shows outdoor sky. The atmosphere contradicts what the environment should feel like.

Return exactly this JSON (no markdown, no explanation):
{
  "checks": {
    "skeleton": true/false,
    "anchor": true/false,
    "scale": true/false,
    "lighting": true/false,
    "placement": true/false,
    "geometry": true/false,
    "scatter": true/false,
    "depth": true/false,
    "characters": true/false,
    "atmosphere": true/false
  },
  "issues": ["one sentence per failed check describing exactly what is wrong and what to fix"]
}`;

const PASS_THRESHOLD = 8; // 80% of 10

export function evaluateSceneTool(): AgentTool<typeof parameters> {
	return {
		name: "evaluate_scene",
		label: "Evaluate scene quality",
		description:
			"Scores a rendered scene screenshot against 10 quality criteria. Call after create_scene or update_scene. Fix all issues if passed < 8. Stop after 3 fix iterations.",
		parameters,
		execute: async (_id, params: Static<typeof parameters>) => {
			const apiKey = process.env.ANTHROPIC_API_KEY;
			if (!apiKey) {
				return {
					content: [{ type: "text", text: JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }) }],
					details: { sceneId: params.sceneId, available: false },
				};
			}

			const dataUrl = getScreenshot(params.sceneId);
			if (!dataUrl) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								available: false,
								message:
									"No screenshot available yet — the viewer uploads one after rendering. Wait a moment and try again, or proceed without evaluation.",
							}),
						},
					],
					details: { sceneId: params.sceneId, available: false },
				};
			}

			// Strip data URL prefix to get raw base64
			const commaIdx = dataUrl.indexOf(",");
			const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
			const mediaType = dataUrl.startsWith("data:image/png") ? "image/png" : "image/jpeg";

			const baseUrl = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
			let raw: string;
			try {
				const res = await fetch(`${baseUrl}/v1/messages`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-api-key": apiKey,
						"anthropic-version": "2023-06-01",
					},
					body: JSON.stringify({
						model: "claude-haiku-4-5-20251001",
						max_tokens: 1024,
						messages: [
							{
								role: "user",
								content: [
									{ type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
									{ type: "text", text: EVAL_PROMPT },
								],
							},
						],
					}),
				});
				if (!res.ok) {
					const body = await res.text();
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({ error: `Vision API error ${res.status}: ${body.slice(0, 200)}` }),
							},
						],
						details: { sceneId: params.sceneId, available: true },
					};
				}
				const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
				raw = data.content.find((b) => b.type === "text")?.text ?? "{}";
			} catch (err) {
				return {
					content: [{ type: "text", text: JSON.stringify({ error: `Network error: ${String(err)}` }) }],
					details: { sceneId: params.sceneId, available: true },
				};
			}

			// Strip markdown fences if present
			const cleaned = raw
				.replace(/^```(?:json)?\s*/i, "")
				.replace(/\s*```\s*$/i, "")
				.trim();

			let parsed: EvalResponse;
			try {
				const json = JSON.parse(cleaned) as { checks: CheckResult; issues: string[] };
				const checks = json.checks ?? {};
				const issues: string[] = Array.isArray(json.issues) ? json.issues : [];
				const passed = Object.values(checks).filter(Boolean).length;
				parsed = { checks: checks as CheckResult, issues, passed, total: 10 };
			} catch {
				return {
					content: [
						{ type: "text", text: JSON.stringify({ error: "Could not parse vision model response", raw }) },
					],
					details: { sceneId: params.sceneId, available: true },
				};
			}

			// Auto-log when scene fails quality threshold
			if (parsed.passed < PASS_THRESHOLD) {
				logFeedback({
					ts: Date.now(),
					source: "evaluate_scene",
					sceneId: params.sceneId,
					sessionId: params.sessionId ?? "",
					data: {
						checks: { ...parsed.checks } as Record<string, boolean>,
						issues: parsed.issues,
						passed: parsed.passed,
						total: parsed.total,
					},
				});
			}

			return {
				content: [{ type: "text", text: JSON.stringify({ sceneId: params.sceneId, ...parsed }) }],
				details: { sceneId: params.sceneId, available: true, ...parsed },
			};
		},
	};
}
