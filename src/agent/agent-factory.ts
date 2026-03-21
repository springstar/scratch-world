import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import type { SceneManager } from "../scene/scene-manager.js";
import { trimContext } from "./context-trimmer.js";
import { createSceneTool } from "./tools/create-scene.js";
import { getSceneTool } from "./tools/get-scene.js";
import { interactWithObjectTool } from "./tools/interact-with-object.js";
import { listScenesTool } from "./tools/list-scenes.js";
import { navigateToTool } from "./tools/navigate-to.js";
import { updateSceneTool } from "./tools/update-scene.js";

const BASE_SYSTEM_PROMPT = `\
You are a world-building companion. You help users create, explore, and evolve persistent 3D worlds through conversation.

When a user describes a place, scene, or environment they want to create, call create_scene.
When a user wants to change or add something to an existing scene, call update_scene.
When a user wants to look around, go somewhere, or change their viewpoint, call navigate_to.
When a user tries to interact with an object (touch, open, examine, pick up, etc.), call interact_with_object.
When a user asks what scenes they have, call list_scenes.
When you need the current state of a scene, call get_scene.

After each tool call, respond naturally in character — describe what the user sees, hears, or experiences as if they are present in the world. Be vivid and immersive. Keep responses concise unless the user asks for more detail.

When sharing a scene link, format it as: [View scene](url)
`.trim();

export function createAgent(
	sceneManager: SceneManager,
	userId: string,
	viewerBaseUrl: string,
	sessionId: string,
	skillPrompt: string | null = null,
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
				createSceneTool(sceneManager, ownerId, viewerUrl),
				updateSceneTool(sceneManager, viewerUrl),
				getSceneTool(sceneManager, viewerUrl),
				listScenesTool(sceneManager, ownerId),
				navigateToTool(sceneManager, viewerUrl),
				interactWithObjectTool(sceneManager),
			],
		},
		transformContext: async (messages) => trimContext(messages),
	});
}
