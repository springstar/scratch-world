import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import type { SceneManager } from "../../scene/scene-manager.js";

const parameters = Type.Object({
	sceneId: Type.String({ description: "ID of the scene to share" }),
});

export function shareSceneTool(
	sceneManager: SceneManager,
	viewerBaseUrl: string,
	sessionId: string,
): AgentTool<typeof parameters> {
	return {
		name: "share_scene",
		label: "Share scene (generate public link)",
		description:
			"Make a scene publicly accessible and return a shareable link. " +
			"Anyone with the link can view the scene in read-only mode. " +
			"Call this when the user asks to share, publish, or get a link for a scene.",
		parameters,
		execute: async (_id, params: Static<typeof parameters>) => {
			const scene = await sceneManager.shareScene(params.sceneId);
			const shareUrl = `${viewerBaseUrl}/scene/${scene.sceneId}?token=${scene.shareToken}&session=${sessionId}`;
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ sceneId: scene.sceneId, title: scene.title, shareUrl }),
					},
				],
				details: { sceneId: scene.sceneId, title: scene.title, shareUrl },
			};
		},
	};
}
