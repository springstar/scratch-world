import type { ProviderRef, SceneData } from "../../scene/types.js";
import type {
	EditOptions,
	GenerateOptions,
	ProviderDescription,
	ProviderResult,
	SceneRenderProvider,
} from "../types.js";

// ── Marble API base URL and auth ─────────────────────────────────────────────

const MARBLE_BASE_URL = "https://api.worldlabs.ai";
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 300_000; // 5 minutes

// ── Marble API response types ─────────────────────────────────────────────────

interface MarbleWorld {
	world_id: string;
	display_name: string;
	world_marble_url: string;
	model: string | null;
	tags: string[] | null;
	created_at: string | null;
	assets: {
		caption: string | null;
		thumbnail_url: string | null;
		imagery: { pano_url: string } | null;
		mesh: { collider_mesh_url: string } | null;
		splats: { spz_urls: string[] } | null;
	} | null;
}

interface MarbleOperation {
	operation_id: string;
	done: boolean;
	error: { message: string; code: string } | null;
	metadata: Record<string, unknown> | null;
	response: MarbleWorld | null;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function marbleRequest<T>(apiKey: string, method: string, path: string, body?: unknown): Promise<T> {
	const url = `${MARBLE_BASE_URL}${path}`;
	const init: RequestInit = {
		method,
		headers: {
			"WLT-Api-Key": apiKey,
			"Content-Type": "application/json",
		},
	};
	if (body !== undefined) {
		init.body = JSON.stringify(body);
	}

	const res = await fetch(url, init);
	const text = await res.text();

	if (!res.ok) {
		throw new Error(`Marble API ${method} ${path} → ${res.status}: ${text}`);
	}

	return JSON.parse(text) as T;
}

// ── Poll an operation until done or timeout ───────────────────────────────────

async function pollOperation(apiKey: string, operationId: string): Promise<MarbleWorld> {
	const deadline = Date.now() + POLL_TIMEOUT_MS;

	while (Date.now() < deadline) {
		const op = await marbleRequest<MarbleOperation>(apiKey, "GET", `/marble/v1/operations/${operationId}`);

		if (op.done) {
			if (op.error) {
				throw new Error(`Marble generation failed: ${op.error.message} (${op.error.code})`);
			}
			if (!op.response) {
				throw new Error("Marble operation done but response is null");
			}
			return op.response;
		}

		const progress = op.metadata?.progress_percentage ?? "?";
		console.log(`[MarbleProvider] operation ${operationId} in progress (${progress}%)…`);

		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
	}

	throw new Error(`Marble operation ${operationId} timed out after ${POLL_TIMEOUT_MS / 1000}s`);
}

// ── SceneData builder from a Marble World ────────────────────────────────────
// Marble returns a navigable 3D world, not a structured object graph.
// We synthesise a minimal SceneData so the rest of the system (agent tools,
// viewer API) has something to work with.  The real visual content lives at
// world_marble_url and is rendered by the Marble viewer iframe.

function worldToSceneData(world: MarbleWorld, prompt: string): SceneData {
	const caption = world.assets?.caption ?? prompt;

	return {
		environment: {
			skybox: "clear_day",
			timeOfDay: "noon",
			ambientLight: "warm",
			weather: "clear",
		},
		viewpoints: [
			{
				viewpointId: "vp_default",
				name: "default",
				position: { x: 0, y: 1.7, z: 0 },
				lookAt: { x: 0, y: 1, z: 10 },
			},
		],
		objects: [
			{
				objectId: "obj_world",
				name: world.display_name || prompt.slice(0, 60),
				type: "terrain",
				position: { x: 0, y: 0, z: 0 },
				description: caption,
				interactable: false,
				metadata: {
					worldId: world.world_id,
					marbleUrl: world.world_marble_url,
					thumbnailUrl: world.assets?.thumbnail_url ?? null,
					panoUrl: world.assets?.imagery?.pano_url ?? null,
				},
			},
		],
	};
}

// ── MarbleProvider ────────────────────────────────────────────────────────────

export class MarbleProvider implements SceneRenderProvider {
	readonly name = "marble";

	private readonly apiKey: string;

	constructor(apiKey: string) {
		this.apiKey = apiKey;
	}

	async generate(prompt: string, _options?: GenerateOptions): Promise<ProviderResult> {
		console.log(`[MarbleProvider] generating world: "${prompt}"`);

		const requestBody = {
			world_prompt: {
				type: "text",
				text_prompt: prompt,
			},
			display_name: prompt.slice(0, 64),
			model: "Marble 0.1-plus",
		};

		const { operation_id } = await marbleRequest<{ operation_id: string }>(
			this.apiKey,
			"POST",
			"/marble/v1/worlds:generate",
			requestBody,
		);

		console.log(`[MarbleProvider] operation started: ${operation_id}`);

		const world = await pollOperation(this.apiKey, operation_id);

		console.log(`[MarbleProvider] world ready: ${world.world_id} → ${world.world_marble_url}`);

		const ref: ProviderRef = {
			provider: "marble",
			assetId: world.world_id,
			viewUrl: world.world_marble_url,
			editToken: undefined,
		};

		return {
			ref,
			viewUrl: world.world_marble_url,
			thumbnailUrl: world.assets?.thumbnail_url ?? undefined,
			sceneData: worldToSceneData(world, prompt),
		};
	}

	async edit(_ref: ProviderRef, instruction: string, _options?: EditOptions): Promise<ProviderResult> {
		// Marble does not currently support incremental edits to existing worlds.
		// Generate a new world from the combined prompt and treat it as a new version.
		console.log(`[MarbleProvider] edit requested — generating new world for: "${instruction}"`);
		return this.generate(instruction);
	}

	async describe(ref: ProviderRef): Promise<ProviderDescription> {
		const world = await marbleRequest<MarbleWorld>(this.apiKey, "GET", `/marble/v1/worlds/${ref.assetId}`);

		return {
			ref: {
				...ref,
				viewUrl: world.world_marble_url,
			},
			sceneData: worldToSceneData(world, world.display_name ?? ref.assetId),
		};
	}
}
