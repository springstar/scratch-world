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
    { "viewpointId": "vp_1", "name": "descriptive name", "position": {"x": 0, "y": 1.7, "z": 12}, "lookAt": {"x": 0, "y": 2, "z": 0} }
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
        "shape": "desk|chair|blackboard|window|door|wall|floor|shelf|box|pillar|hoop|court|hill|cliff|platform",
        "state": "current state string if stateful",
        "transitions": {"action verb": "next state"},
        "width": 20,
        "depth": 20,
        "height": 4
      }
    }
  ]
}

Rules:
- Generate 8-16 objects. Analyse the prompt and choose the most fitting types and shapes.
- INDOOR scenes (classroom, room, hall, lab, shop, corridor, etc.):
    Use type "terrain" for floor (shape "floor"), walls (shape "wall"), ceiling (shape "floor").
    MUST include exactly 4 walls (front, back, left, right). Wall y must equal half wall height (e.g. y:1.6 for a 3.2m wall).
    Use type "object" for furniture with the correct shape (desk, chair, blackboard, window, door, shelf, etc.).
    Use type "npc" for people. Use type "item" for small pickable items.
    Do NOT add trees or outdoor buildings to indoor scenes.
- OUTDOOR scenes (forest, city, park, beach, mountains, etc.):
    Use type "terrain" for ground and landforms. Do NOT add walls or ceiling.
    Use types "tree", "building", "npc", "item", "object" freely.
    CRITICAL for immersive outdoor scenes — use three depth layers:
      Foreground z=+5 to +15: NPCs, items, low rocks
      Midground z=-5 to +5: main buildings, trees, focal points
      Background z=-15 to -25: mountains, cliffs, forest walls (larger scale)
    NEVER put every object at y=0. Use terrain shapes to create elevation:
      terrain/hill: position.y = peak height (3-8). Objects ON the hill use same y.
      terrain/cliff: position.y = top edge height (5-12).
      terrain/platform: position.y = top surface height (1-5). Objects ON platform use same y.
      terrain/floor: position.y = 0 (or surface elevation). metadata.width/depth control size.
- Stateful objects: set metadata.state and metadata.transitions.
- Include exactly 2-3 viewpoints. Eye-level (y≈1.7) at z=+12 looking toward midground is a good default.
- Make names and descriptions vivid and specific to the theme.
- interactable: true for npc, item, interactive objects; false for terrain.
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

interface JobState {
	done: boolean;
	result?: ProviderResult;
	error?: Error;
}

export class LlmProvider implements SceneRenderProvider {
	readonly name = "llm";

	// In-memory store of sceneData by assetId for describe()
	private scenes = new Map<string, SceneData>();
	private stub = new StubProvider();

	// Async generation tracking: operationId → job state
	private jobStates = new Map<string, JobState>();

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

	async startGeneration(prompt: string, options?: GenerateOptions): Promise<{ operationId: string }> {
		const operationId = randomUUID();
		const state: JobState = { done: false };
		this.jobStates.set(operationId, state);
		this.generate(prompt, options).then(
			(result) => {
				state.done = true;
				state.result = result;
			},
			(err: unknown) => {
				state.done = true;
				state.error = err instanceof Error ? err : new Error(String(err));
			},
		);
		return { operationId };
	}

	async checkGeneration(operationId: string): Promise<ProviderResult | null> {
		const state = this.jobStates.get(operationId);
		if (!state) throw new Error(`LlmProvider: unknown operationId ${operationId}`);
		if (!state.done) return null;
		this.jobStates.delete(operationId);
		if (state.error) throw state.error;
		return state.result!;
	}
}
