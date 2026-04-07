import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import { randomUUID } from "crypto";
import { createWriteStream } from "fs";
import { mkdir, readFile } from "fs/promises";
import { join } from "path";
import { pipeline } from "stream/promises";

/**
 * image-to-3d.ts
 *
 * Converts an uploaded photo to a GLB 3D model using the Tencent Hunyuan 3D API.
 *
 * Pipeline:
 *   1. Read the local image file and encode it as base64
 *   2. Submit a generation job via POST /v1/ai3d/submit
 *   3. Poll POST /v1/ai3d/query with the returned JobId until complete
 *   4. Download the GLB from the result URL to uploads/generated/ on the local server
 *   5. Return the hosted URL so the agent can call add_to_catalog + place_prop
 *
 * Configuration (env var):
 *   HUNYUAN_API_KEY  — Tencent Hunyuan API key (required)
 */

const HUNYUAN_BASE_URL = "https://api.ai3d.cloud.tencent.com";
const POLL_INTERVAL_MS = 5_000;
const GENERATION_TIMEOUT_MS = 180_000; // 3 minutes

const parameters = Type.Object({
	imagePath: Type.String({
		description:
			"Absolute server-side path to the uploaded photo file " +
			"(injected as [上传图片: path=...] in the user message).",
	}),
	assetName: Type.String({
		description:
			'Human-readable name for the asset, e.g. "My cat" or "Living room shelf". ' +
			"Used as the catalog entry name.",
	}),
});

// ── Hunyuan API helpers ───────────────────────────────────────────────────────

interface HunyuanResponse<T> {
	Response: T & { RequestId: string; Error?: { Code: string; Message: string } };
}

interface SubmitResult {
	JobId: string;
}

interface ResultFile3D {
	Type: string; // "GLB" | "OBJ" | ...
	Url: string;
	PreviewImageUrl?: string;
}

interface QueryResult {
	Status: string; // "RUN" | "DONE" | "FAILED"
	ErrorCode: string;
	ErrorMessage: string;
	ResultFile3Ds: ResultFile3D[];
}

function apiHeaders(): Record<string, string> {
	const key = process.env.HUNYUAN_API_KEY;
	if (!key) throw new Error("HUNYUAN_API_KEY environment variable is not set");
	return {
		Authorization: key,
		"Content-Type": "application/json",
	};
}

/**
 * Submit an image-to-3D generation job.
 * Returns the JobId for subsequent polling.
 */
async function submitJob(imageBase64: string): Promise<string> {
	const body = JSON.stringify({
		ImageBase64: imageBase64,
		Model: "3.0",
	});

	const res = await fetch(`${HUNYUAN_BASE_URL}/v1/ai3d/submit`, {
		method: "POST",
		headers: apiHeaders(),
		body,
		signal: AbortSignal.timeout(30_000),
	});
	if (!res.ok) throw new Error(`Hunyuan submit failed: ${res.status} ${await res.text()}`);

	const data = (await res.json()) as HunyuanResponse<SubmitResult>;
	if (data.Response.Error) {
		throw new Error(`Hunyuan submit error: ${data.Response.Error.Code} — ${data.Response.Error.Message}`);
	}
	if (!data.Response.JobId) throw new Error("Hunyuan submit returned no JobId");
	return data.Response.JobId;
}

/**
 * Query job status. Returns the full QueryResult when complete.
 * Throws if the job failed or timed out.
 */
async function pollJob(jobId: string): Promise<QueryResult> {
	const deadline = Date.now() + GENERATION_TIMEOUT_MS;

	while (Date.now() < deadline) {
		const res = await fetch(`${HUNYUAN_BASE_URL}/v1/ai3d/query`, {
			method: "POST",
			headers: apiHeaders(),
			body: JSON.stringify({ JobId: jobId }),
			signal: AbortSignal.timeout(15_000),
		});
		if (!res.ok) throw new Error(`Hunyuan query failed: ${res.status} ${await res.text()}`);

		const data = (await res.json()) as HunyuanResponse<QueryResult>;
		if (data.Response.Error) {
			throw new Error(`Hunyuan query error: ${data.Response.Error.Code} — ${data.Response.Error.Message}`);
		}

		const result = data.Response;
		const status = result.Status ?? "";

		if (status === "FAILED") {
			const msg = result.ErrorMessage || result.ErrorCode || "unknown error";
			throw new Error(`Hunyuan 3D generation failed for job ${jobId}: ${msg}`);
		}

		if (status === "DONE") {
			const glbFile = result.ResultFile3Ds.find((f) => f.Type === "GLB");
			if (!glbFile) throw new Error(`Hunyuan job ${jobId} completed but no GLB file in ResultFile3Ds`);
			return result;
		}

		// Still processing — wait and retry
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
	}

	throw new Error(`Hunyuan 3D generation timed out after ${GENERATION_TIMEOUT_MS / 1000}s (job ${jobId})`);
}

/**
 * Download a remote file and save it to a local path.
 */
async function downloadFile(url: string, destPath: string): Promise<void> {
	const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
	if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
	if (!res.body) throw new Error("Response has no body");
	const writeStream = createWriteStream(destPath);
	await pipeline(res.body as unknown as NodeJS.ReadableStream, writeStream);
}

// ── Tool factory ──────────────────────────────────────────────────────────────

export function imageToSdTool(uploadsDir: string, viewerBaseUrl: string): AgentTool<typeof parameters> {
	return {
		name: "image_to_3d",
		label: "Photo → 3D model",
		description:
			"Convert a user-uploaded photo into a GLB 3D model using Hunyuan 3D. " +
			"The resulting model is saved to the server and can be placed in any Marble scene " +
			"via place_prop or persisted with add_to_catalog. " +
			"Call this when the user uploads a photo and asks to 'turn it into a 3D object', " +
			"'add it to the scene', or 'make a 3D version of this'. " +
			"imagePath comes from the [上传图片: path=...] prefix in the user message.",
		parameters,
		execute: async (_id, params: Static<typeof parameters>) => {
			if (!process.env.HUNYUAN_API_KEY) {
				return {
					content: [
						{ type: "text", text: JSON.stringify({ error: "HUNYUAN_API_KEY is not configured on the server." }) },
					],
					details: {},
				};
			}

			const generatedDir = join(uploadsDir, "generated");
			await mkdir(generatedDir, { recursive: true });

			// ── 1. Read and encode image ──────────────────────────────────────
			let imageBase64: string;
			try {
				const buf = await readFile(params.imagePath);
				imageBase64 = buf.toString("base64");
			} catch (err) {
				return {
					content: [
						{ type: "text", text: JSON.stringify({ error: `Failed to read image file: ${String(err)}` }) },
					],
					details: {},
				};
			}

			// ── 2. Submit generation job ──────────────────────────────────────
			let jobId: string;
			try {
				jobId = await submitJob(imageBase64);
			} catch (err) {
				return {
					content: [
						{ type: "text", text: JSON.stringify({ error: `Failed to submit Hunyuan job: ${String(err)}` }) },
					],
					details: {},
				};
			}

			// ── 3. Poll until complete ────────────────────────────────────────
			let result: QueryResult;
			try {
				result = await pollJob(jobId);
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								error:
									`Hunyuan generation failed: ${String(err)}. ` +
									"The service may be busy or the account quota exhausted — ask the user to try again.",
							}),
						},
					],
					details: {},
				};
			}

			// ── 4. Download GLB to local uploads/generated/ ───────────────────
			const glbFile = result.ResultFile3Ds.find((f) => f.Type === "GLB")!;
			const assetId = randomUUID().slice(0, 8);
			const safeName = params.assetName.replace(/[^a-z0-9_-]/gi, "_").slice(0, 40);
			const fileName = `${safeName}_${assetId}.glb`;
			const destPath = join(generatedDir, fileName);

			try {
				await downloadFile(glbFile.Url, destPath);
			} catch (err) {
				return {
					content: [
						{ type: "text", text: JSON.stringify({ error: `Failed to download generated GLB: ${String(err)}` }) },
					],
					details: {},
				};
			}

			// ── 5. Return hosted URL ──────────────────────────────────────────
			const hostedUrl = `${viewerBaseUrl}/uploads/generated/${fileName}`;
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							status: "success",
							assetName: params.assetName,
							modelUrl: hostedUrl,
							scale: 1,
							instructions:
								"The 3D model is ready. You can now: " +
								"(1) Call add_to_catalog to persist it in the asset catalog. " +
								"(2) Call place_prop with this modelUrl to add it to the active scene.",
						}),
					},
				],
				details: { modelUrl: hostedUrl },
			};
		},
	};
}
