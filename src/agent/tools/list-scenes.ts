import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { SceneManager } from "../../scene/scene-manager.js";

const parameters = Type.Object({});

export function listScenesTool(sceneManager: SceneManager): AgentTool<typeof parameters> {
	return {
		name: "list_scenes",
		label: "List scenes",
		description: "List all scenes.",
		parameters,
		execute: async (_id, _params) => {
			const scenes = await sceneManager.listScenes();
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							scenes.map((s) => ({
								sceneId: s.sceneId,
								title: s.title,
								status: s.status ?? "ready",
								version: s.version,
								updatedAt: s.updatedAt,
							})),
						),
					},
				],
				details: { count: scenes.length },
			};
		},
	};
}
