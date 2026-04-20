import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type Database from "better-sqlite3";
import { Hono } from "hono";

export interface UserAsset {
	id: string;
	sessionId: string;
	name: string;
	url: string;
	kind: "texture" | "model" | "audio" | "video";
	mimeType: string;
	createdAt: number;
}

const ALLOWED_MIME: Record<string, UserAsset["kind"]> = {
	"image/png": "texture",
	"image/jpeg": "texture",
	"image/webp": "texture",
	"image/gif": "texture",
	"model/gltf-binary": "model",
	"model/gltf+json": "model",
	"audio/mpeg": "audio",
	"audio/ogg": "audio",
	"audio/wav": "audio",
	"video/mp4": "video",
	"video/webm": "video",
};

const EXT_FALLBACK: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
	glb: "model/gltf-binary",
	gltf: "model/gltf+json",
	mp3: "audio/mpeg",
	ogg: "audio/ogg",
	wav: "audio/wav",
	mp4: "video/mp4",
	webm: "video/webm",
};

export function createUserAssetsTable(db: Database.Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS user_assets (
			id          TEXT PRIMARY KEY,
			session_id  TEXT NOT NULL,
			name        TEXT NOT NULL,
			url         TEXT NOT NULL,
			kind        TEXT NOT NULL,
			mime_type   TEXT NOT NULL,
			created_at  INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_user_assets_session ON user_assets (session_id);
	`);
}

export function userAssetsRoute(db: Database.Database, projectRoot: string): Hono {
	const app = new Hono();

	// POST /user-assets?session=<sessionId>
	// multipart/form-data: file + optional name
	app.post("/", async (c) => {
		const sessionId = c.req.query("session");
		if (!sessionId) return c.json({ error: "Missing session query param" }, 400);

		const contentType = c.req.header("content-type") ?? "";
		if (!contentType.includes("multipart/form-data")) {
			return c.json({ error: "Expected multipart/form-data" }, 400);
		}

		const form = await c.req.formData();
		const file = form.get("file") as File | null;
		if (!file) return c.json({ error: "Missing 'file' field" }, 400);

		const ext = extname(file.name).slice(1).toLowerCase();
		const mimeType = file.type || EXT_FALLBACK[ext] || "";
		const kind = ALLOWED_MIME[mimeType];
		if (!kind) {
			return c.json({ error: `Unsupported file type: ${mimeType || ext}` }, 400);
		}

		// 10 MB limit
		if (file.size > 10 * 1024 * 1024) {
			return c.json({ error: "File too large (max 10 MB)" }, 400);
		}

		const id = randomUUID();
		const filename = `${id}.${ext || "bin"}`;
		const dir = join(projectRoot, "uploads", "user-assets", sessionId);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, filename), Buffer.from(await file.arrayBuffer()));

		const url = `/uploads/user-assets/${encodeURIComponent(sessionId)}/${filename}`;
		const name = (form.get("name") as string | null) || file.name;
		const asset: UserAsset = { id, sessionId, name, url, kind, mimeType, createdAt: Date.now() };

		db.prepare<[string, string, string, string, string, string, number]>(
			"INSERT INTO user_assets (id, session_id, name, url, kind, mime_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		).run(id, sessionId, name, url, kind, mimeType, asset.createdAt);

		return c.json({ ok: true, asset });
	});

	// GET /user-assets?session=<sessionId>
	app.get("/", (c) => {
		const sessionId = c.req.query("session");
		if (!sessionId) return c.json({ error: "Missing session query param" }, 400);

		const rows = db
			.prepare<
				[string],
				{
					id: string;
					session_id: string;
					name: string;
					url: string;
					kind: string;
					mime_type: string;
					created_at: number;
				}
			>("SELECT * FROM user_assets WHERE session_id = ? ORDER BY created_at DESC")
			.all(sessionId);

		const assets: UserAsset[] = rows.map((r) => ({
			id: r.id,
			sessionId: r.session_id,
			name: r.name,
			url: r.url,
			kind: r.kind as UserAsset["kind"],
			mimeType: r.mime_type,
			createdAt: r.created_at,
		}));

		return c.json({ assets });
	});

	return app;
}
