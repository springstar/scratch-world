import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProviderRef, SceneData } from "../../scene/types.js";
import type {
	EditOptions,
	GenerateOptions,
	ProviderDescription,
	ProviderResult,
	SceneRenderProvider,
} from "../types.js";

// ── Marble API base URL and auth ─────────────────────────────────────────────

const MARBLE_BASE_URL = process.env.MARBLE_API_URL ?? "https://api.worldlabs.ai";

// The Marble staging endpoint uses a self-signed TLS certificate.
// Disable verification when pointing at a non-default URL.
if (process.env.MARBLE_API_URL) {
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 600_000; // 10 minutes

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
		splats: {
			spz_urls: string[] | Record<string, string>;
			semantics_metadata?: {
				ground_plane_offset: number;
				metric_scale_factor: number;
			};
		} | null;
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
// world_marble_url and is rendered by the Marble viewer iframe,
// OR via SplatViewer when a resolved splatUrl is provided.

function worldToSceneData(world: MarbleWorld, prompt: string, splatUrl?: string): SceneData {
	const caption = world.assets?.caption ?? prompt;
	const splatGroundOffset = world.assets?.splats?.semantics_metadata?.ground_plane_offset;

	return {
		splatUrl,
		colliderMeshUrl: world.assets?.mesh?.collider_mesh_url ?? undefined,
		splatGroundOffset,
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
					// Kept for the /splat/:sceneId proxy route — never sent to browser
					spzUrls: world.assets?.splats?.spz_urls ?? null,
				},
			},
		],
	};
}

// ── MarbleProvider ────────────────────────────────────────────────────────────

/**
 * SPZ_MODE controls how Marble splat files are served to the browser.
 *
 * IMPORTANT — AUTH PROBLEM:
 *   Marble's spz_urls[] require the WLT-Api-Key header.  That key must never
 *   reach the browser.  Two strategies are supported:
 *
 *   SPZ_MODE=proxy  (default)
 *     A server-side proxy route GET /splat/:sceneId fetches the SPZ with the
 *     API key and streams it to the browser without exposing the key.
 *     Pros: no extra disk space, URL is always fresh.
 *     Cons: every page load re-downloads from Marble CDN; no offline cache.
 *
 *   SPZ_MODE=local
 *     At generation time the provider downloads spz_urls[0] and saves it to
 *     uploads/splats/{sceneId}.spz, then sets splatUrl to the local path.
 *     Pros: served directly from local static file server, no repeat CDN cost.
 *     Cons: consumes disk; large files increase generation time slightly.
 */
type SpzMode = "proxy" | "local";

export class MarbleProvider implements SceneRenderProvider {
	readonly name = "marble";
	readonly providesOwnRendering = true;

	private readonly apiKey: string;
	private readonly projectRoot: string;
	private readonly spzMode: SpzMode;

	constructor(apiKey: string, projectRoot: string, spzMode: SpzMode = "proxy") {
		this.apiKey = apiKey;
		this.projectRoot = projectRoot;
		this.spzMode = spzMode;
	}

	async generate(prompt: string, _options?: GenerateOptions): Promise<ProviderResult> {
		console.log(`[MarbleProvider] generating world: "${prompt}"`);
		const { operationId } = await this.startGeneration(prompt);
		const world = await pollOperation(this.apiKey, operationId);
		return this.buildResult(world, prompt);
	}

	async startGeneration(prompt: string, _options?: GenerateOptions): Promise<{ operationId: string }> {
		console.log(`[MarbleProvider] starting async generation: "${prompt}"`);
		const requestBody = {
			world_prompt: { type: "text", text_prompt: prompt },
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
		return { operationId: operation_id };
	}

	async checkGeneration(operationId: string): Promise<ProviderResult | null> {
		const op = await marbleRequest<MarbleOperation>(this.apiKey, "GET", `/marble/v1/operations/${operationId}`);
		if (!op.done) {
			const progress = op.metadata?.progress_percentage ?? "?";
			console.log(`[MarbleProvider] operation ${operationId} in progress (${progress}%)…`);
			return null;
		}
		if (op.error) throw new Error(`Marble generation failed: ${op.error.message} (${op.error.code})`);
		if (!op.response) throw new Error("Marble operation done but response is null");
		return this.buildResult(op.response, op.response.display_name ?? operationId);
	}

	private async buildResult(world: MarbleWorld, prompt: string): Promise<ProviderResult> {
		// ── Resolve splatUrl based on SPZ_MODE ────────────────────────────────
		let splatUrl: string | undefined;
		const spzUrlsRaw = world.assets?.splats?.spz_urls;

		// Normalize: Marble returns either string[] or Record<string,string> (e.g. {500k, 100k, full_res})
		const pickSpzUrl = (urls: string[] | Record<string, string>): string | undefined => {
			if (Array.isArray(urls)) return urls[0];
			return urls["500k"] ?? urls["100k"] ?? urls.full_res ?? Object.values(urls)[0];
		};

		// splatUrlTemplate is set when the URL depends on the sceneId (proxy mode).
		// SceneManager will replace "{sceneId}" after the scene record is created.
		let splatUrlTemplate: string | undefined;

		if (spzUrlsRaw && (Array.isArray(spzUrlsRaw) ? spzUrlsRaw.length > 0 : Object.keys(spzUrlsRaw).length > 0)) {
			if (this.spzMode === "local") {
				// Download and cache the SPZ file server-side so the static file
				// server can serve it without ever exposing the WLT-Api-Key.
				const splatsDir = join(this.projectRoot, "uploads", "splats");
				await mkdir(splatsDir, { recursive: true });
				const fileName = `${world.world_id}.spz`;
				const localPath = join(splatsDir, fileName);

				const localSpzUrl = pickSpzUrl(spzUrlsRaw);
				console.log(`[MarbleProvider] downloading SPZ to ${localPath}…`);
				const res = await fetch(localSpzUrl!, { headers: { "WLT-Api-Key": this.apiKey } });
				if (!res.ok) {
					console.warn(`[MarbleProvider] SPZ download failed (${res.status}) — falling back to proxy mode`);
					splatUrlTemplate = "/splat/{sceneId}";
				} else {
					const buf = await res.arrayBuffer();
					await writeFile(localPath, Buffer.from(buf));
					splatUrl = `/uploads/splats/${fileName}`;
					console.log(`[MarbleProvider] SPZ cached locally → ${splatUrl}`);
				}
			} else {
				// proxy mode: GET /splat/:sceneId adds WLT-Api-Key server-side.
				// The sceneId is only known after SceneManager creates the record,
				// so we return a template that SceneManager resolves.
				splatUrlTemplate = "/splat/{sceneId}";
			}
		}

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
			sceneData: worldToSceneData(world, prompt, splatUrl),
			splatUrlTemplate,
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
