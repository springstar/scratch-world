import { randomUUID } from "node:crypto";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import type { SceneManager } from "../../scene/scene-manager.js";
import type { SceneObject } from "../../scene/types.js";

const parameters = Type.Object({
	sceneId: Type.String({ description: "ID of the Marble scene to analyze" }),
});

interface VlmObject {
	name: string;
	type: string;
	description: string;
	approximate_direction: string;
	bbox_x?: number; // horizontal center of object in panorama image, 0.0 (left edge) – 1.0 (right edge)
	bbox_y?: number; // vertical center of object in panorama image, 0.0 (top) – 1.0 (bottom)
	interactable: boolean;
	interactionHint?: string;
}

const ANALYSIS_PROMPT = `You are analyzing an equirectangular (360°) panoramic photo of a 3D scene. List every distinct object or area of interest visible.

For each object return:
- name: short label (e.g. "wooden bench", "stone fountain")
- type: one of: building, furniture, vegetation, water, rock, path, npc, item, prop, terrain_feature
- description: 1–2 sentence description useful for narrative interaction
- approximate_direction: one of: front, front_left, front_right, left, right, behind, above, below
- bbox_x: horizontal center of the object in the image as a fraction 0.0–1.0 (0 = far left, 0.5 = straight ahead, 1.0 = far right / wraps back to left)
- bbox_y: vertical center of the object in the image as a fraction 0.0–1.0 (0 = top/ceiling, 0.5 = eye level, 1.0 = floor)
- interactable: true if a player could meaningfully interact with it (sit, open, pick up, examine, talk to)
- interactionHint: if interactable=true, a short hint such as "try sitting on it" or "examine the inscription"

Return ONLY a JSON array (no markdown fences, no explanation):
[{ "name": "...", "type": "...", "description": "...", "approximate_direction": "...", "bbox_x": 0.5, "bbox_y": 0.5, "interactable": true/false, "interactionHint": "..." }]

Include 5–15 objects. Skip featureless sky or flat ground unless they have notable characteristics.`;

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
						model: "claude-sonnet-4-6",
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

			// 6. Map to SceneObject[] — estimate world position from equirectangular bbox or direction fallback
			//
			// Equirectangular panorama geometry (Marble panoUrl):
			//   bbox_x = 0.5 → straight ahead (azimuth 0)
			//   bbox_x = 0.0 / 1.0 → directly behind (azimuth ±π)
			//   bbox_y = 0.5 → eye level (elevation 0)
			//   bbox_y = 0.0 → ceiling (elevation +π/2)
			//   bbox_y = 1.0 → floor (elevation -π/2)
			//
			// World space: camera at origin, -Z = forward, +X = right, +Y = up.
			// Azimuth 0 → z = -dist, azimuth π/2 → x = +dist.
			const groundOffset = scene.sceneData.splatGroundOffset ?? 0;

			// Type → typical distance from camera centre (metres)
			const typeDepth: Record<string, number> = {
				building: 8,
				terrain_feature: 6,
				vegetation: 5,
				water: 6,
				rock: 4,
				path: 5,
				furniture: 3,
				prop: 3,
				item: 2,
				npc: 3,
			};

			const panoToPos = (item: VlmObject, gndOff: number): { x: number; y: number; z: number } => {
				const baseDist = typeDepth[item.type] ?? 4;

				// Use bbox if provided and plausible
				if (item.bbox_x !== undefined && item.bbox_y !== undefined) {
					// Azimuth: bbox_x=0.5 → 0 rad (forward -Z), increases clockwise (+X direction)
					const azimuth = (item.bbox_x - 0.5) * 2 * Math.PI;
					// Elevation: bbox_y=0.5 → 0 (eye level), 0.0 → +π/2 (up), 1.0 → -π/2 (down)
					const elevation = (0.5 - item.bbox_y) * Math.PI;
					// Objects on or near the floor (elevation < -15°) are farther away than eye-level objects
					const dist = elevation < -0.26 ? baseDist * 1.4 : baseDist;
					const flatDist = dist * Math.cos(elevation);
					return {
						x: Math.round(Math.sin(azimuth) * flatDist * 10) / 10,
						y: Math.round((gndOff + 1.0 + Math.sin(elevation) * dist) * 10) / 10,
						z: Math.round(-Math.cos(azimuth) * flatDist * 10) / 10,
					};
				}

				// Fallback: coarse direction string
				const dirAngle: Record<string, number> = {
					front: 0,
					front_right: Math.PI / 4,
					right: Math.PI / 2,
					behind_right: (3 * Math.PI) / 4,
					behind: Math.PI,
					behind_left: -(3 * Math.PI) / 4,
					left: -Math.PI / 2,
					front_left: -Math.PI / 4,
				};
				const angle = dirAngle[item.approximate_direction?.toLowerCase()] ?? 0;
				return {
					x: Math.round(Math.sin(angle) * baseDist * 10) / 10,
					y: 1.0 + gndOff,
					z: Math.round(-Math.cos(angle) * baseDist * 10) / 10,
				};
			};

			const newObjects: SceneObject[] = vlmObjects.map((item) => ({
				objectId: `vlm_${randomUUID().slice(0, 8)}`,
				name: item.name,
				type: item.type,
				position: panoToPos(item, groundOffset),
				description: item.description,
				interactable: item.interactable === true,
				interactionHint: item.interactionHint,
				metadata: {
					source: "vlm_analysis",
					direction: item.approximate_direction,
					...(item.bbox_x !== undefined ? { bbox_x: item.bbox_x, bbox_y: item.bbox_y } : {}),
				},
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
