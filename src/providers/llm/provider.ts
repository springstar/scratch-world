import { completeSimple, getModel } from "@mariozechner/pi-ai";
import { randomUUID } from "crypto";
import type { ProviderRef, SceneData } from "../../scene/types.js";
import { StubProvider } from "../stub/provider.js";
import type {
	EditOptions,
	GenerateOptions,
	ProviderDescription,
	ProviderResult,
	SceneRenderProvider,
} from "../types.js";

const SCENE_SYSTEM_PROMPT = `\
You are a scene data generator for a 3D world engine. Return ONLY a valid JSON object with NO extra text, markdown, or code fences.

The JSON must have this exact structure:
{
  "environment": { "skybox": "clear_day|sunset|night|overcast", "timeOfDay": "dawn|noon|dusk|night", "ambientLight": "warm|cool|neutral", "weather": "clear|foggy|rainy" },
  "viewpoints": [
    { "viewpointId": "vp_1", "name": "descriptive name", "position": {"x": 0, "y": 1.7, "z": -8}, "lookAt": {"x": 0, "y": 1, "z": 0} }
  ],
  "objects": [
    {
      "objectId": "obj_1",
      "name": "vivid specific name",
      "type": "tree|building|npc|item|terrain|object",
      "position": {"x": 0, "y": 0, "z": 0},
      "description": "vivid description",
      "interactable": true,
      "interactionHint": "try 'examine the ...'",
      "metadata": {
        "shape": "desk|chair|blackboard|window|door|wall|floor|shelf|box|pillar",
        "state": "current state string if stateful",
        "transitions": {"action verb": "next state"}
      }
    }
  ]
}

Rules:
- Generate 8-16 objects. Analyse the prompt and choose the most fitting types and shapes.
- INDOOR scenes (classroom, room, hall, lab, shop, etc.):
    Use type "terrain" for floor (shape "floor"), walls (shape "wall"), ceiling (shape "floor").
    Use type "object" for furniture with the correct shape (desk, chair, blackboard, window, door, shelf, etc.).
    Use type "npc" for people. Use type "item" for small pickable items.
    Do NOT add trees or outdoor buildings to indoor scenes.
- OUTDOOR scenes (forest, city, park, etc.):
    Use type "terrain" for ground. Use type "tree", "building", "npc", "item", "object" freely.
- Stateful objects: set metadata.state (e.g. "written", "open", "closed", "on", "off") and
    metadata.transitions (e.g. {"erase": "erased", "write": "written"} for a blackboard).
- Objects positions: spread across a 40x40 unit area (x and z from -20 to 20), y=0 unless elevated.
- Include exactly 2-3 viewpoints suited to the scene.
- Make names and descriptions vivid and specific to the theme.
- interactable: true for npc, item, and interactive objects; false for floor/wall/ceiling terrain.
`.trim();

const EDIT_SYSTEM_PROMPT = `\
You are a scene data editor for a 3D world engine. You will receive the current scene JSON and an edit instruction.
Return ONLY a valid JSON object (the complete updated scene) with NO extra text, markdown, or code fences.
Apply the edit instruction to the scene, preserving existing objects unless the instruction removes them.
Add new objects with unique objectIds (use obj_<short-uuid> format).
Keep positions within the -20 to 20 range on x and z axes.
`.trim();

function extractJson(text: string): string {
	// Try to find a JSON object in the response
	const match = text.match(/\{[\s\S]*\}/);
	if (!match) throw new Error("No JSON object found in LLM response");
	return match[0];
}

function buildModel() {
	const model = getModel("anthropic", "claude-haiku-4-5-20251001");
	if (process.env.ANTHROPIC_BASE_URL) {
		model.baseUrl = process.env.ANTHROPIC_BASE_URL;
	}
	return model;
}

export class LlmProvider implements SceneRenderProvider {
	readonly name = "llm";

	// In-memory store of sceneData by assetId for describe()
	private scenes = new Map<string, SceneData>();
	private stub = new StubProvider();

	async generate(prompt: string, _options?: GenerateOptions): Promise<ProviderResult> {
		const assetId = randomUUID();
		const model = buildModel();

		let sceneData: SceneData;
		try {
			const response = await completeSimple(model, {
				systemPrompt: SCENE_SYSTEM_PROMPT,
				messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
			});

			const text = response.content
				.filter((c) => c.type === "text")
				.map((c) => (c as { type: "text"; text: string }).text)
				.join("");

			const json = extractJson(text);
			sceneData = JSON.parse(json) as SceneData;
		} catch (err) {
			console.warn("[LlmProvider] generate failed, falling back to stub:", err);
			const fallback = await this.stub.generate(prompt, _options);
			return fallback;
		}

		const ref: ProviderRef = {
			provider: "llm",
			assetId,
			viewUrl: `llm://scenes/${assetId}`,
			editToken: `edit_${assetId}`,
		};

		this.scenes.set(assetId, sceneData);

		return { ref, viewUrl: ref.viewUrl!, sceneData };
	}

	async edit(ref: ProviderRef, instruction: string, _options?: EditOptions): Promise<ProviderResult> {
		const existing = this.scenes.get(ref.assetId);
		const model = buildModel();

		let sceneData: SceneData;
		try {
			const contextJson = existing ? JSON.stringify(existing, null, 2) : "{}";
			const userMsg = `Current scene:\n${contextJson}\n\nEdit instruction: ${instruction}`;

			const response = await completeSimple(model, {
				systemPrompt: EDIT_SYSTEM_PROMPT,
				messages: [{ role: "user", content: userMsg, timestamp: Date.now() }],
			});

			const text = response.content
				.filter((c) => c.type === "text")
				.map((c) => (c as { type: "text"; text: string }).text)
				.join("");

			const json = extractJson(text);
			sceneData = JSON.parse(json) as SceneData;
		} catch (err) {
			console.warn("[LlmProvider] edit failed, falling back to stub edit:", err);
			const fallback = await this.stub.edit(ref, instruction, _options);
			return fallback;
		}

		const updatedRef: ProviderRef = { ...ref, viewUrl: `${ref.viewUrl}?v=${Date.now()}` };
		this.scenes.set(ref.assetId, sceneData);

		return { ref: updatedRef, viewUrl: updatedRef.viewUrl!, sceneData };
	}

	async describe(ref: ProviderRef): Promise<ProviderDescription> {
		const sceneData = this.scenes.get(ref.assetId);
		if (!sceneData) {
			return this.stub.describe(ref);
		}
		return { ref, sceneData };
	}
}
