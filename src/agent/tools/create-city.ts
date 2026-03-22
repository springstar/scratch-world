import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import type { SceneManager } from "../../scene/scene-manager.js";
import { CityGenerator, DEFAULT_CITY_CONFIG } from "../../citygen/city-generator.js";
import { cityDataToSceneData } from "../../citygen/scene-adapter.js";

const parameters = Type.Object({
	prompt: Type.String({ description: "Describe the city's theme and atmosphere" }),
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
	sceneManager: SceneManager,
	ownerId: () => string,
	viewerUrl: (sceneId: string) => string,
): AgentTool<typeof parameters> {
	return {
		name: "create_city",
		label: "Generate procedural city",
		description:
			"Procedurally generate a city, town, or village with road networks, buildings, trees, and NPCs. " +
			"Use this for settlement-scale scenes (city, town, village, commercial district). " +
			"Use create_scene for everything else (indoor, nature, sports, single locations).",
		parameters,
		execute: async (_id, params: Static<typeof parameters>) => {
			const theme = (params.theme ?? "medieval") as Theme;
			const size = (params.size ?? "town") as Size;
			const sizeCfg = SIZE_CONFIGS[size];

			// Build CityConfig from size preset, merging with defaults
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
			const sceneData = cityDataToSceneData(cityData, theme, params.prompt);

			const scene = await sceneManager.createScene(ownerId(), params.prompt, params.title, sceneData);

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							sceneId: scene.sceneId,
							title: scene.title,
							viewUrl: viewerUrl(scene.sceneId),
							buildingCount: cityData.buildings.length,
							segmentCount: cityData.segments.length,
						}),
					},
				],
				details: { sceneId: scene.sceneId, title: scene.title },
			};
		},
	};
}
