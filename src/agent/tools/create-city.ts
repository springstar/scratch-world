import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import { CityGenerator, DEFAULT_CITY_CONFIG } from "../../citygen/city-generator.js";
import { cityDataToSceneData } from "../../citygen/scene-adapter.js";
import type { SceneManager } from "../../scene/scene-manager.js";

const parameters = Type.Object({
	prompt: Type.String({ description: "Describe the settlement's theme and atmosphere" }),
	title: Type.Optional(Type.String({ description: "Short title for the scene (max 60 chars)" })),
	theme: Type.Optional(
		Type.Union([Type.Literal("medieval"), Type.Literal("fantasy"), Type.Literal("modern")], {
			description: "Visual theme: medieval (default), fantasy, or modern",
		}),
	),
	size: Type.Optional(
		Type.Union([Type.Literal("village"), Type.Literal("town"), Type.Literal("city")], {
			description: "Settlement size: village, town (default), or city",
		}),
	),
	seed: Type.Optional(Type.Number({ description: "RNG seed for reproducible layout" })),
});

type Theme = "medieval" | "fantasy" | "modern";
type Size = "village" | "town" | "city";

interface SizeConfig {
	worldSize: number;
	segmentCountLimit: number;
	qtBounds: { x: number; y: number; width: number; height: number };
}

const SIZE_CONFIGS: Record<Size, SizeConfig> = {
	village: {
		worldSize: 60,
		segmentCountLimit: 60,
		qtBounds: { x: -30, y: -30, width: 60, height: 60 },
	},
	town: {
		worldSize: 100,
		segmentCountLimit: 120,
		qtBounds: { x: -50, y: -50, width: 100, height: 100 },
	},
	city: {
		worldSize: 140,
		segmentCountLimit: 200,
		qtBounds: { x: -70, y: -70, width: 140, height: 140 },
	},
};

export function createCityTool(
	sceneManager?: SceneManager,
	ownerId?: () => string,
	viewerUrl?: (id: string) => string,
): AgentTool<typeof parameters> {
	return {
		name: "create_city",
		label: "Generate settlement layout",
		description:
			"Procedurally generate the road network and building layout for a city, town, or village. " +
			"Returns a compact layout (building positions, bounds, theme) and pre-built sceneData (interaction objects). " +
			"IMPORTANT: After receiving this result you MUST immediately call create_scene — pass the returned " +
			"sceneData as-is and write sceneCode that renders the layout while matching the atmosphere of the original prompt. " +
			"See SKILL.md § 'Settlement Rendering' for the rendering pattern.",
		parameters,
		execute: async (_id, params: Static<typeof parameters>) => {
			const theme = (params.theme ?? "medieval") as Theme;
			const size = (params.size ?? "town") as Size;
			const sizeCfg = SIZE_CONFIGS[size];

			const cityGen = new CityGenerator({
				road: {
					...DEFAULT_CITY_CONFIG.road,
					worldSize: sizeCfg.worldSize,
					segmentCountLimit: sizeCfg.segmentCountLimit,
				},
				building: {
					...DEFAULT_CITY_CONFIG.building,
					qtBounds: sizeCfg.qtBounds,
				},
				seed: params.seed,
			});

			const cityData = cityGen.generate();

			// Bounding box
			let minX = Infinity,
				maxX = -Infinity,
				minZ = Infinity,
				maxZ = -Infinity;
			for (const b of cityData.buildings) {
				const bcx = b.bounds.x + b.bounds.width / 2;
				const bcz = b.bounds.y + b.bounds.height / 2;
				minX = Math.min(minX, bcx - b.bounds.width / 2);
				maxX = Math.max(maxX, bcx + b.bounds.width / 2);
				minZ = Math.min(minZ, bcz - b.bounds.height / 2);
				maxZ = Math.max(maxZ, bcz + b.bounds.height / 2);
			}
			if (!Number.isFinite(minX)) {
				minX = -30;
				maxX = 30;
				minZ = -30;
				maxZ = 30;
			}
			const cx = (minX + maxX) / 2;
			const cz = (minZ + maxZ) / 2;
			const groundW = maxX - minX + 20;
			const groundD = maxZ - minZ + 20;

			// Compact building summary for the agent to render
			const buildings = cityData.buildings.map((b) => ({
				type: b.type.id, // "tower" | "shop" | "house" | "cottage"
				x: +(b.bounds.x + b.bounds.width / 2).toFixed(1),
				z: +(b.bounds.y + b.bounds.height / 2).toFixed(1),
				w: +b.bounds.width.toFixed(1),
				d: +b.bounds.height.toFixed(1),
				rotY: +((b.rotation * Math.PI) / 180).toFixed(2),
			}));

			// Road segment count by type (agent decides how to render roads)
			const highways = cityData.segments.filter((s) => s.highway).length;
			const roads = cityData.segments.filter((s) => !s.highway).length;

			// sceneData carries interaction metadata (NPC dialogue, interactable flags)
			// The agent passes it verbatim to create_scene alongside the sceneCode it writes
			const sceneData = cityDataToSceneData(cityData, theme, params.prompt);

			const layout = {
				theme,
				size,
				bounds: {
					minX: +minX.toFixed(1),
					maxX: +maxX.toFixed(1),
					minZ: +minZ.toFixed(1),
					maxZ: +maxZ.toFixed(1),
					cx: +cx.toFixed(1),
					cz: +cz.toFixed(1),
				},
				ground: { width: +groundW.toFixed(1), depth: +groundD.toFixed(1) },
				roads: { highways, local: roads },
				buildings,
			};

			// When called with a sceneManager (direct tool path), create the scene immediately.
			if (sceneManager && ownerId && viewerUrl) {
				const scene = await sceneManager.createScene(ownerId(), params.prompt, params.title, sceneData);
				const url = viewerUrl(scene.sceneId);
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								sceneId: scene.sceneId,
								title: scene.title,
								viewUrl: url,
								buildingCount: buildings.length,
								segmentCount: highways + roads,
								layout,
								sceneData,
							}),
						},
					],
					details: {
						sceneId: scene.sceneId,
						title: scene.title,
						buildingCount: buildings.length,
						segmentCount: highways + roads,
					},
				};
			}

			// Agent path: return layout data for the agent to pass to create_scene.
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							instruction:
								"Layout generated. Now call create_scene immediately: pass sceneData verbatim and write sceneCode " +
								"that renders this layout while matching the atmosphere of the original prompt. " +
								"Use SKILL.md § 'Settlement Rendering' for the rendering pattern.",
							title: params.title ?? params.prompt.slice(0, 60),
							prompt: params.prompt,
							layout,
							sceneData,
						}),
					},
				],
				details: { buildingCount: buildings.length, theme, size },
			};
		},
	};
}
