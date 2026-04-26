import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { Hono } from "hono";

const ALLOWED: Record<string, "image" | "video"> = {
	"image/jpeg": "image",
	"image/png": "image",
	"image/webp": "image",
	"image/gif": "image",
	"video/mp4": "video",
	"video/webm": "video",
	"video/quicktime": "video",
};

const EXT_FALLBACK: Record<string, string> = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
	gif: "image/gif",
	mp4: "video/mp4",
	webm: "video/webm",
	mov: "video/quicktime",
};

const MAX_SIZE = 500 * 1024 * 1024; // 500 MB — video files can be large

export function mediaUploadRoute(projectRoot: string, publicBaseUrl: string): Hono {
	const app = new Hono();

	// POST /media-upload
	// multipart/form-data: file
	// Returns: { filePath, publicUrl, mimeType, kind }
	app.post("/", async (c) => {
		const contentType = c.req.header("content-type") ?? "";
		if (!contentType.includes("multipart/form-data")) {
			return c.json({ error: "Expected multipart/form-data" }, 400);
		}

		const form = await c.req.formData();
		const file = form.get("file") as File | null;
		if (!file) return c.json({ error: "Missing 'file' field" }, 400);

		const ext = extname(file.name).slice(1).toLowerCase() || "bin";
		const mimeType = file.type || EXT_FALLBACK[ext] || "";
		const kind = ALLOWED[mimeType];
		if (!kind) {
			return c.json({ error: `Unsupported media type: ${mimeType || ext}` }, 400);
		}
		if (file.size > MAX_SIZE) {
			return c.json({ error: `File too large (max ${MAX_SIZE / 1024 / 1024} MB)` }, 400);
		}

		const id = randomUUID();
		const filename = `${id}.${ext}`;
		const subdir = kind === "video" ? "videos" : "photos";
		const dir = join(projectRoot, "uploads", subdir);
		await mkdir(dir, { recursive: true });
		const filePath = join(dir, filename);
		await writeFile(filePath, Buffer.from(await file.arrayBuffer()));

		const publicUrl = `${publicBaseUrl}/uploads/${subdir}/${filename}`;

		return c.json({ filePath, publicUrl, mimeType, kind });
	});

	return app;
}
