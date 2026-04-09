import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

/**
 * Thin client for the Tencent Hunyuan 3D image-to-3D API.
 *
 * Endpoints:
 *   POST /v1/ai3d/submit  — submit base64 image, get JobId
 *   POST /v1/ai3d/query   — poll with JobId, wait for Status: "DONE"
 *
 * The client blocks until the job is complete (or times out after 10 min).
 * It downloads the resulting GLB to uploadsDir/generated/ and returns the path.
 */

const BASE_URL = "https://api.ai3d.cloud.tencent.com";
const POLL_INTERVAL_MS = 5_000;
const GENERATION_TIMEOUT_MS = 1_200_000; // 20 min — jobs can take 10+ min under load

interface HunyuanResponse<T> {
	Response: T & { RequestId: string; Error?: { Code: string; Message: string } };
}

interface SubmitResult {
	JobId: string;
}

interface ResultFile3D {
	Type: string;
	Url: string;
	PreviewImageUrl?: string;
}

interface QueryResult {
	Status: string;
	ErrorCode: string;
	ErrorMessage: string;
	ResultFile3Ds: ResultFile3D[];
}

function headers(): Record<string, string> {
	const key = process.env.HUNYUAN_API_KEY;
	if (!key) throw new Error("HUNYUAN_API_KEY is not configured");
	return { Authorization: key, "Content-Type": "application/json" };
}

async function submitJob(imageBase64: string): Promise<string> {
	const res = await fetch(`${BASE_URL}/v1/ai3d/submit`, {
		method: "POST",
		headers: headers(),
		body: JSON.stringify({ ImageBase64: imageBase64, Model: "3.0" }),
		signal: AbortSignal.timeout(60_000),
	});
	if (!res.ok) throw new Error(`Hunyuan submit failed: ${res.status} ${await res.text()}`);
	const data = (await res.json()) as HunyuanResponse<SubmitResult>;
	if (data.Response.Error) {
		throw new Error(`Hunyuan error: ${data.Response.Error.Code} — ${data.Response.Error.Message}`);
	}
	if (!data.Response.JobId) throw new Error("Hunyuan submit returned no JobId");
	return data.Response.JobId;
}

async function pollUntilDone(jobId: string): Promise<QueryResult> {
	const deadline = Date.now() + GENERATION_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const res = await fetch(`${BASE_URL}/v1/ai3d/query`, {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({ JobId: jobId }),
			signal: AbortSignal.timeout(60_000),
		});
		if (!res.ok) throw new Error(`Hunyuan query failed: ${res.status} ${await res.text()}`);
		const data = (await res.json()) as HunyuanResponse<QueryResult>;
		if (data.Response.Error) {
			throw new Error(`Hunyuan query error: ${data.Response.Error.Code} — ${data.Response.Error.Message}`);
		}
		const result = data.Response;
		if (result.Status === "FAILED") {
			throw new Error(`Hunyuan generation failed: ${result.ErrorMessage || result.ErrorCode || "unknown"}`);
		}
		if (result.Status === "DONE") {
			const glb = result.ResultFile3Ds.find((f) => f.Type === "GLB");
			if (!glb) throw new Error("Hunyuan completed but no GLB in ResultFile3Ds");
			return result;
		}
		await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
	}
	throw new Error(`Hunyuan timed out after ${GENERATION_TIMEOUT_MS / 1000}s`);
}

async function downloadFile(url: string, destPath: string): Promise<void> {
	const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
	if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
	if (!res.body) throw new Error("Response body is empty");
	const ws = createWriteStream(destPath);
	await pipeline(res.body as unknown as NodeJS.ReadableStream, ws);
}

export interface GenerateResult {
	/** Relative URL served by the viewer-api static file server, e.g. /uploads/generated/foo.glb */
	modelUrl: string;
	/** Preview image URL from Hunyuan, if available */
	thumbnailUrl: string | null;
	/** Recommended scale (Hunyuan models are typically unit-scale, but verify) */
	scale: number;
}

/**
 * Run full image-to-3D pipeline: submit → poll → download GLB.
 *
 * @param imageBase64 Raw base64-encoded image (no data: prefix)
 * @param assetName   Safe name used in the output filename
 * @param uploadsDir  Absolute path to the project uploads/ directory
 */
export async function generateFromImage(
	imageBase64: string,
	assetName: string,
	uploadsDir: string,
): Promise<GenerateResult> {
	const generatedDir = join(uploadsDir, "generated");
	await mkdir(generatedDir, { recursive: true });

	const jobId = await submitJob(imageBase64);
	const result = await pollUntilDone(jobId);

	const glbFile = result.ResultFile3Ds.find((f) => f.Type === "GLB")!;
	const thumbFile = result.ResultFile3Ds.find((f) => f.PreviewImageUrl);

	const assetId = randomUUID().slice(0, 8);
	const safeName = assetName.replace(/[^a-z0-9_-]/gi, "_").slice(0, 40);
	const fileName = `${safeName}_${assetId}.glb`;
	const destPath = join(generatedDir, fileName);

	await downloadFile(glbFile.Url, destPath);

	// Verify download succeeded
	const fileInfo = await stat(destPath);
	if (fileInfo.size === 0) throw new Error("Downloaded GLB is empty");

	return {
		modelUrl: `/uploads/generated/${fileName}`,
		thumbnailUrl: thumbFile?.PreviewImageUrl ?? null,
		scale: 1,
	};
}
