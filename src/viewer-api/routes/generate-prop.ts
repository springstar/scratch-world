import Anthropic from "@anthropic-ai/sdk";
import { Hono } from "hono";
import sharp from "sharp";
import { generateFromImage } from "../hunyuan-client.js";
import { createJob, failJob, getJob, resolveJob } from "../job-store.js";

/**
 * Prop generation route.
 *
 * POST /:sceneId/generate-prop  — start a generation job
 *   Body: { description?: string; imageBase64?: string; imageMimeType?: string; quality: string }
 *   Returns: { jobId: string }
 *
 * GET /:sceneId/generate-prop/:jobId  — poll job status
 *   Returns: JobState (pending | done | error)
 *
 * Image path  — uses Tencent Hunyuan 3D (HUNYUAN_API_KEY required)
 * Text path   — stub: selects a CC0 GLB by keyword matching for now;
 *               replace runTextStub with a real Meshy/Rodin call when MESHY_API_KEY is available
 */

interface StubAsset {
	name: string;
	modelUrl: string;
	thumbnailUrl: string | null;
	scale: number;
	keywords: string[];
}

// Fallback CC0 assets used for text-to-3D stub (and image fallback when Hunyuan is not configured).
const STUB_ASSETS: StubAsset[] = [
	{
		name: "木桌",
		modelUrl: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/wooden_table_02/wooden_table_02_1k.gltf",
		thumbnailUrl: null,
		scale: 1,
		keywords: ["桌", "table", "desk", "wooden", "wood", "木"],
	},
	{
		name: "石墩",
		modelUrl: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/rock_moss_set_01/rock_moss_set_01_1k.gltf",
		thumbnailUrl: null,
		scale: 1,
		keywords: ["石", "rock", "stone", "boulder", "岩", "石头"],
	},
	{
		name: "陶罐",
		modelUrl: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/ceramic_pot_01/ceramic_pot_01_1k.gltf",
		thumbnailUrl: null,
		scale: 1,
		keywords: ["罐", "pot", "vase", "陶", "ceramic", "jar", "花瓶", "瓮"],
	},
	{
		name: "木桶",
		modelUrl: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/wooden_barrel/wooden_barrel_1k.gltf",
		thumbnailUrl: null,
		scale: 1,
		keywords: ["桶", "barrel", "cask", "容器", "水桶"],
	},
	{
		name: "鸭子",
		modelUrl: "https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models/Duck/glTF/Duck.gltf",
		thumbnailUrl: null,
		scale: 0.01,
		keywords: ["duck", "鸭", "bird", "鸟", "animal", "动物", "玩具"],
	},
	{
		name: "木椅",
		modelUrl: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/wooden_stool_02/wooden_stool_02_1k.gltf",
		thumbnailUrl: null,
		scale: 1,
		keywords: ["椅", "凳", "chair", "stool", "seat", "坐"],
	},
	{
		name: "蜡烛台",
		modelUrl: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/candle_holder_01/candle_holder_01_1k.gltf",
		thumbnailUrl: null,
		scale: 1,
		keywords: ["蜡烛", "烛台", "candle", "light", "灯", "火", "照明"],
	},
	{
		name: "铁砧",
		modelUrl: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/anvil_01/anvil_01_1k.gltf",
		thumbnailUrl: null,
		scale: 1,
		keywords: ["铁砧", "锻造", "anvil", "forge", "smith", "铁匠", "金属"],
	},
	{
		name: "木箱",
		modelUrl: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/wooden_crate_01/wooden_crate_01_1k.gltf",
		thumbnailUrl: null,
		scale: 1,
		keywords: ["箱", "crate", "box", "chest", "储物", "货箱", "板条箱"],
	},
	{
		name: "路灯",
		modelUrl: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/street_lamp/street_lamp_1k.gltf",
		thumbnailUrl: null,
		scale: 1,
		keywords: ["路灯", "街灯", "lamp", "lantern", "灯柱", "street light", "灯笼"],
	},
];

const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/** Build the asset catalog description for Claude. */
function buildAssetCatalog(): string {
	return STUB_ASSETS.map((a, i) => `${i}: ${a.name} (${a.keywords.slice(0, 3).join(", ")})`).join("\n");
}

/**
 * Use Claude Haiku to select the best matching asset index for the description.
 * Falls back to index 0 if API call fails or returns invalid output.
 */
async function pickStubAssetSemantic(description: string): Promise<StubAsset> {
	if (!process.env.ANTHROPIC_API_KEY) return STUB_ASSETS[0];
	try {
		const catalog = buildAssetCatalog();
		const msg = await anthropicClient.messages.create({
			model: "claude-haiku-4-5-20251001",
			max_tokens: 16,
			messages: [
				{
					role: "user",
					content: `You are selecting the best 3D prop asset for a user's description. Reply with ONLY the index number (0-${STUB_ASSETS.length - 1}) of the best match. No explanation.\n\nAsset catalog:\n${catalog}\n\nUser description: "${description}"`,
				},
			],
		});
		const text = (msg.content[0] as { type: string; text: string }).text.trim();
		const idx = parseInt(text, 10);
		if (!Number.isNaN(idx) && idx >= 0 && idx < STUB_ASSETS.length) {
			return STUB_ASSETS[idx];
		}
	} catch {
		// Fall through to default
	}
	return STUB_ASSETS[0];
}

function pickStubAssetKeyword(description?: string): StubAsset {
	if (!description) return STUB_ASSETS[0];
	const lower = description.toLowerCase();
	for (const asset of STUB_ASSETS) {
		if (asset.keywords.some((kw) => lower.includes(kw))) return asset;
	}
	return STUB_ASSETS[0];
}

/** Text-to-3D stub — uses Claude Haiku for semantic asset matching (falls back to keyword match). Replace with Meshy/Rodin when key is available. */
function runTextStub(jobId: string, description?: string): void {
	const pick =
		description && process.env.ANTHROPIC_API_KEY
			? pickStubAssetSemantic(description)
			: Promise.resolve(pickStubAssetKeyword(description));

	pick
		.then((asset) => {
			resolveJob(jobId, {
				modelUrl: asset.modelUrl,
				thumbnailUrl: asset.thumbnailUrl,
				name: asset.name,
				scale: asset.scale,
			});
		})
		.catch(() => {
			const asset = pickStubAssetKeyword(description);
			resolveJob(jobId, {
				modelUrl: asset.modelUrl,
				thumbnailUrl: asset.thumbnailUrl,
				name: asset.name,
				scale: asset.scale,
			});
		});
}

const HUNYUAN_MAX_PX = 5000;

/**
 * If either dimension of the image exceeds HUNYUAN_MAX_PX, scale it down
 * proportionally and return a new base64 JPEG string. Otherwise return as-is.
 */
async function clampImageSize(base64: string): Promise<string> {
	const buf = Buffer.from(base64, "base64");
	const meta = await sharp(buf).metadata();
	const w = meta.width ?? 0;
	const h = meta.height ?? 0;
	if (w <= HUNYUAN_MAX_PX && h <= HUNYUAN_MAX_PX) return base64;
	const scale = HUNYUAN_MAX_PX / Math.max(w, h);
	const newW = Math.round(w * scale);
	const newH = Math.round(h * scale);
	const resized = await sharp(buf).resize(newW, newH).jpeg({ quality: 92 }).toBuffer();
	return resized.toString("base64");
}

/**
 * Image-to-3D via Hunyuan. Runs in background (does not block the request).
 * Falls back to stub if HUNYUAN_API_KEY is not configured.
 */
function runImageGeneration(jobId: string, imageBase64: string, uploadsDir: string, assetName: string): void {
	if (!process.env.HUNYUAN_API_KEY) {
		// No key configured — fall back to stub so the UI still works in dev
		runTextStub(jobId, assetName);
		return;
	}

	generateFromImage(imageBase64, assetName, uploadsDir)
		.then((result) => {
			resolveJob(jobId, {
				modelUrl: result.modelUrl,
				thumbnailUrl: result.thumbnailUrl,
				name: assetName,
				scale: result.scale,
			});
		})
		.catch((err: unknown) => {
			failJob(jobId, err instanceof Error ? err.message : "Hunyuan generation failed");
		});
}

export function generatePropRoute(uploadsDir: string): Hono {
	const app = new Hono();

	// POST /generate-prop — start a generation job
	app.post("/", async (c) => {
		const body = await c.req.json<{
			description?: string;
			imageBase64?: string;
			imageMimeType?: string;
			quality?: string;
		}>();

		const jobId = createJob();

		if (body.imageBase64) {
			const assetName = body.description?.trim() || "generated_prop";
			const safeBase64 = await clampImageSize(body.imageBase64).catch(() => body.imageBase64!);
			runImageGeneration(jobId, safeBase64, uploadsDir, assetName);
		} else {
			runTextStub(jobId, body.description);
		}

		return c.json({ jobId });
	});

	// GET /generate-prop/:jobId — poll job status
	app.get("/:jobId", (c) => {
		const { jobId } = c.req.param();
		const job = getJob(jobId);
		if (!job) return c.json({ error: "Job not found" }, 404);
		return c.json(job);
	});

	return app;
}
