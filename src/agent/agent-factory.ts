import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import type { GenerationQueue } from "../generation/generation-queue.js";
import type { SceneManager } from "../scene/scene-manager.js";
import { trimContext } from "./context-trimmer.js";
import { createCityTool } from "./tools/create-city.js";
import { createSceneTool } from "./tools/create-scene.js";
import { getSceneTool } from "./tools/get-scene.js";
import { listScenesTool } from "./tools/list-scenes.js";
import { shareSceneTool } from "./tools/share-scene.js";
import { updateSceneTool } from "./tools/update-scene.js";

export const BASE_SYSTEM_PROMPT = `\
You are a world-building companion. You help users create, explore, and evolve persistent 3D worlds through conversation.

When a user describes a place, scene, or environment they want to create, call create_scene.
When a user wants a city, town, village, settlement, or commercial district, call create_city THEN immediately call create_scene (see settlement workflow below).
When a user wants to change or add something to an existing scene, call update_scene.
When a user asks what scenes they have, call list_scenes.
When you need the current state of a scene, call get_scene.
When a user asks to share a scene, get a link, or make a scene public, call share_scene.

## Settlement workflow (MANDATORY for any city/town/village request)

1. Call create_city to generate the road network and building layout.
2. Read the returned layout (building positions, bounds, theme) AND re-read the user's original prompt.
3. Immediately call create_scene with:
   - sceneData: pass the returned sceneData verbatim (interaction metadata)
   - sceneCode: write it yourself using SKILL.md § "Settlement Rendering" as your guide
   - The sceneCode MUST reflect the atmosphere of the original prompt — lighting, fog, NPC count,
     building style, time of day — not a generic template. "Quiet village at dusk" looks very
     different from "bustling medieval market at noon". Let the prompt drive every visual choice.

## General rules

After each tool call, respond naturally in character — describe what the user sees, hears, or experiences as if they are present in the world. Be vivid and immersive. Keep responses concise unless the user asks for more detail.

When sharing a scene link, format it as: [View scene](url)
When sharing a public scene link, format it as: [Share link](url) — anyone with this link can view the scene.

IMPORTANT: If a tool result contains a "violations" field, you MUST call update_scene immediately with corrected sceneCode that fixes every listed violation. Do not respond to the user until all violations are resolved.
`.trim();

export function createAgent(
	sceneManager: SceneManager,
	userId: string,
	viewerBaseUrl: string,
	sessionId: string,
	skillPrompt: string | null = null,
	generationQueue: GenerationQueue,
): Agent {
	const ownerId = () => userId;
	const viewerUrl = (sceneId: string) => `${viewerBaseUrl}/scene/${sceneId}?session=${sessionId}`;
	const model = getModel("anthropic", "claude-sonnet-4-6");

	// Allow overriding the API base URL via env var (e.g. for ofox proxy)
	if (process.env.ANTHROPIC_BASE_URL) {
		model.baseUrl = process.env.ANTHROPIC_BASE_URL;
		// Many proxies don't support the fine-grained-tool-streaming beta — override the header.
		// Allow further customization via ANTHROPIC_BETA (e.g. set to empty string to disable all betas).
		model.headers = { "anthropic-beta": process.env.ANTHROPIC_BETA ?? "" };
	}

	const systemPrompt = skillPrompt
		? `${BASE_SYSTEM_PROMPT}\n\n## Scene Generation\n\n${skillPrompt}`
		: BASE_SYSTEM_PROMPT;

	return new Agent({
		initialState: {
			systemPrompt,
			model,
			tools: [
				createSceneTool(sceneManager, ownerId, viewerUrl, generationQueue, sessionId),
				createCityTool(),
				updateSceneTool(sceneManager, viewerUrl, generationQueue, sessionId),
				getSceneTool(sceneManager, viewerUrl),
				listScenesTool(sceneManager, ownerId),
				shareSceneTool(sceneManager, viewerBaseUrl, sessionId),
			],
		},
		transformContext: async (messages) => trimContext(messages),
	});
}
