import { randomUUID } from "node:crypto";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import type { SceneManager } from "../../scene/scene-manager.js";
import type { SceneObject, Vec3 } from "../../scene/types.js";

const parameters = Type.Object({
	sceneId: Type.String({ description: "ID of the Marble scene to analyze" }),
});

interface VlmObject {
	name: string;
	type: string;
	description: string;
	approximate_direction: string;
	interactable: boolean;
	interactionHint?: string;
}

const ANALYSIS_PROMPT = `You are analyzing a panoramic photo of a 3D scene. List every distinct object or area of interest visible.

For each object return:
- name: short label (e.g. "wooden bench", "stone fountain")
- type: one of: building, furniture, vegetation, water, rock, path, npc, item, prop, terrain_feature
- description: 1–2 sentence description useful for narrative interaction
- approximate_direction: one of: front, front_left, front_right, left, right, behind, above, below
- interactable: true if a player could meaningfully interact with it (sit, open, pick up, examine, talk to)
- interactionHint: if interactable=true, a short hint such as "try sitting on it" or "examine the inscription"

Return ONLY a JSON array (no markdown fences, no explanation):
[{ "name": "...", "type": "...", "description": "...", "approximate_direction": "...", "interactable": true/false, "interactionHint": "..." }]

Include 5–15 objects. Skip featureless sky or flat ground unless they have notable characteristics.`;

function directionToPosition(dir: string): Vec3 {
	switch (dir) {
		case "front":
			return { x: 0, y: 1, z: 10 };
		case "front_left":
			return { x: -7, y: 1, z: 7 };
		case "front_right":
			return { x: 7, y: 1, z: 7 };
		case "left":
			return { x: -10, y: 1, z: 0 };
		case "right":
			return { x: 10, y: 1, z: 0 };
		case "behind":
			return { x: 0, y: 1, z: -10 };
		case "above":
			return { x: 0, y: 5, z: 0 };
		case "below":
			return { x: 0, y: 0, z: 0 };
		default:
			return { x: 0, y: 1, z: 10 };
	}
}

export function analyzeSceneObjectsTool(sceneManager: SceneManager): AgentTool<typeof parameters> {
	return {
		name: "analyze_scene_objects",
		label: "Analyze scene objects via VLM",
		description:
			"Analyzes the panoramic image of a Marble scene using Claude Vision to identify objects. " +
			"Writes the results to sceneData.objects so they are available for interaction and prop placement. " +
			"Call when the user asks what is in a scene, or before placing props.",
		parameters,
		execute: async (_id, params: Static<typeof parameters>) => {
			const apiKey = process.env.ANTHROPIC_API_KEY;
			if (!apiKey) {
				return {
					content: [{ type: "text", text: JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }) }],
					details: { sceneId: params.sceneId },
				};
			}

			// 1. Load scene
			const scene = await sceneManager.getScene(params.sceneId);
			if (!scene) {
				return {
					content: [{ type: "text", text: JSON.stringify({ error: `Scene ${params.sceneId} not found` }) }],
					details: { sceneId: params.sceneId },
				};
			}

			// 2. Resolve image URL — prefer panoUrl (360°), fall back to thumbnail
			const meta = scene.sceneData.objects[0]?.metadata as Record<string, unknown> | undefined;
			const panoUrl = typeof meta?.panoUrl === "string" ? meta.panoUrl : null;
			const imageUrl = panoUrl ?? scene.thumbnailUrl ?? null;
			if (!imageUrl) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({ error: "No panorama or thumbnail available for this scene" }),
						},
					],
					details: { sceneId: params.sceneId },
				};
			}

			// 3. Fetch image and encode as base64
			let base64: string;
			let mediaType: "image/jpeg" | "image/png" | "image/webp";
			try {
				const res = await fetch(imageUrl);
				if (!res.ok) {
					return {
						content: [
							{ type: "text", text: JSON.stringify({ error: `Failed to fetch image: HTTP ${res.status}` }) },
						],
						details: { sceneId: params.sceneId },
					};
				}
				const buf = await res.arrayBuffer();
				base64 = Buffer.from(buf).toString("base64");
				const lower = imageUrl.toLowerCase();
				mediaType = lower.includes(".png") ? "image/png" : lower.includes(".webp") ? "image/webp" : "image/jpeg";
			} catch (err) {
				return {
					content: [{ type: "text", text: JSON.stringify({ error: `Image fetch error: ${String(err)}` }) }],
					details: { sceneId: params.sceneId },
				};
			}

			// 4. Call Claude Haiku Vision
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
						max_tokens: 2048,
						messages: [
							{
								role: "user",
								content: [
									{ type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
									{ type: "text", text: ANALYSIS_PROMPT },
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
						details: { sceneId: params.sceneId },
					};
				}
				const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
				raw = data.content.find((b) => b.type === "text")?.text ?? "[]";
			} catch (err) {
				return {
					content: [{ type: "text", text: JSON.stringify({ error: `Vision API network error: ${String(err)}` }) }],
					details: { sceneId: params.sceneId },
				};
			}

			// 5. Parse response
			const cleaned = raw
				.replace(/^```(?:json)?\s*/i, "")
				.replace(/\s*```\s*$/i, "")
				.trim();

			let vlmObjects: VlmObject[];
			try {
				vlmObjects = JSON.parse(cleaned) as VlmObject[];
				if (!Array.isArray(vlmObjects)) throw new Error("Expected JSON array");
			} catch {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({ error: "Could not parse VLM response", raw: raw.slice(0, 300) }),
						},
					],
					details: { sceneId: params.sceneId },
				};
			}

			// 6. Map to SceneObject[]
			const newObjects: SceneObject[] = vlmObjects.map((item) => ({
				objectId: `vlm_${randomUUID().slice(0, 8)}`,
				name: item.name,
				type: item.type,
				position: directionToPosition(item.approximate_direction),
				description: item.description,
				interactable: item.interactable === true,
				interactionHint: item.interactionHint,
				metadata: { source: "vlm_analysis", direction: item.approximate_direction },
			}));

			// 7. Merge: keep non-VLM objects (e.g. obj_world, props), replace previous VLM pass
			const retained = scene.sceneData.objects.filter(
				(o) => (o.metadata as Record<string, unknown>)?.source !== "vlm_analysis",
			);
			const mergedObjects = [...retained, ...newObjects];

			// 8. Persist via skill path (no provider call)
			try {
				await sceneManager.updateScene(params.sceneId, "Analyzed scene objects via VLM", {
					...scene.sceneData,
					objects: mergedObjects,
				});
			} catch (err) {
				return {
					content: [{ type: "text", text: JSON.stringify({ error: `Failed to save objects: ${String(err)}` }) }],
					details: { sceneId: params.sceneId },
				};
			}

			const result = {
				sceneId: params.sceneId,
				objectCount: newObjects.length,
				objects: newObjects.map((o) => ({
					objectId: o.objectId,
					name: o.name,
					type: o.type,
					description: o.description,
					interactable: o.interactable,
					interactionHint: o.interactionHint,
					direction: (o.metadata as Record<string, unknown>).direction,
				})),
			};

			return {
				content: [{ type: "text", text: JSON.stringify(result) }],
				details: { sceneId: params.sceneId, objectCount: newObjects.length },
			};
		},
	};
}
