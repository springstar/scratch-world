import type Database from "better-sqlite3";
import type { Scene, SceneVersion } from "../../scene/types.js";
import type { SceneRepository } from "../types.js";

interface SceneRow {
	scene_id: string;
	owner_id: string;
	title: string;
	description: string;
	scene_data: string;
	provider_ref: string;
	version: number;
	created_at: number;
	updated_at: number;
	is_public: number; // SQLite boolean: 0 | 1
	share_token: string | null;
	status: string | null;
	operation_id: string | null;
	thumbnail_url: string | null;
}

interface SceneVersionRow {
	scene_id: string;
	version: number;
	scene_data: string;
	provider_ref: string;
	created_at: number;
}

function rowToScene(row: SceneRow): Scene {
	return {
		sceneId: row.scene_id,
		ownerId: row.owner_id,
		title: row.title,
		description: row.description,
		sceneData: JSON.parse(row.scene_data),
		providerRef: JSON.parse(row.provider_ref),
		version: row.version,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		isPublic: row.is_public === 1,
		shareToken: row.share_token ?? undefined,
		status: (row.status as Scene["status"]) ?? undefined,
		operationId: row.operation_id ?? undefined,
		thumbnailUrl: row.thumbnail_url ?? undefined,
	};
}

function rowToVersion(row: SceneVersionRow): SceneVersion {
	return {
		sceneId: row.scene_id,
		version: row.version,
		sceneData: JSON.parse(row.scene_data),
		providerRef: JSON.parse(row.provider_ref),
		createdAt: row.created_at,
	};
}

export class SqliteSceneRepo implements SceneRepository {
	private db: Database.Database;

	constructor(db: Database.Database) {
		this.db = db;
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS scenes (
				scene_id    TEXT PRIMARY KEY,
				owner_id    TEXT NOT NULL,
				title       TEXT NOT NULL,
				description TEXT NOT NULL,
				scene_data  TEXT NOT NULL,
				provider_ref TEXT NOT NULL,
				version     INTEGER NOT NULL DEFAULT 1,
				created_at  INTEGER NOT NULL,
				updated_at  INTEGER NOT NULL,
				is_public   INTEGER NOT NULL DEFAULT 0,
				share_token TEXT UNIQUE
			);

			CREATE INDEX IF NOT EXISTS idx_scenes_owner ON scenes(owner_id);

			CREATE TABLE IF NOT EXISTS scene_versions (
				scene_id    TEXT NOT NULL,
				version     INTEGER NOT NULL,
				scene_data  TEXT NOT NULL,
				provider_ref TEXT NOT NULL,
				created_at  INTEGER NOT NULL,
				PRIMARY KEY (scene_id, version)
			);
		`);

		// Migration: add columns if table already exists without them
		const cols = this.db.prepare("PRAGMA table_info(scenes)").all() as Array<{ name: string }>;
		const names = new Set(cols.map((c) => c.name));
		if (!names.has("is_public")) {
			this.db.exec("ALTER TABLE scenes ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0");
		}
		if (!names.has("share_token")) {
			this.db.exec("ALTER TABLE scenes ADD COLUMN share_token TEXT");
		}
		if (!names.has("status")) {
			this.db.exec("ALTER TABLE scenes ADD COLUMN status TEXT");
		}
		if (!names.has("operation_id")) {
			this.db.exec("ALTER TABLE scenes ADD COLUMN operation_id TEXT");
		}
		if (!names.has("thumbnail_url")) {
			this.db.exec("ALTER TABLE scenes ADD COLUMN thumbnail_url TEXT");
		}
	}

	async save(scene: Scene): Promise<void> {
		this.db
			.prepare<
				[
					string,
					string,
					string,
					string,
					string,
					string,
					number,
					number,
					number,
					number,
					string | null,
					string | null,
					string | null,
					string | null,
				]
			>(`
				INSERT INTO scenes (scene_id, owner_id, title, description, scene_data, provider_ref, version, created_at, updated_at, is_public, share_token, status, operation_id, thumbnail_url)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(scene_id) DO UPDATE SET
					title        = excluded.title,
					description  = excluded.description,
					scene_data   = excluded.scene_data,
					provider_ref = excluded.provider_ref,
					version      = excluded.version,
					updated_at   = excluded.updated_at,
					is_public    = excluded.is_public,
					share_token  = excluded.share_token,
					status       = excluded.status,
					operation_id = excluded.operation_id,
					thumbnail_url = excluded.thumbnail_url
			`)
			.run(
				scene.sceneId,
				scene.ownerId,
				scene.title,
				scene.description,
				JSON.stringify(scene.sceneData),
				JSON.stringify(scene.providerRef),
				scene.version,
				scene.createdAt,
				scene.updatedAt,
				scene.isPublic ? 1 : 0,
				scene.shareToken ?? null,
				scene.status ?? null,
				scene.operationId ?? null,
				scene.thumbnailUrl ?? null,
			);
	}

	async findById(sceneId: string): Promise<Scene | null> {
		const row = this.db.prepare<[string], SceneRow>("SELECT * FROM scenes WHERE scene_id = ?").get(sceneId);
		return row ? rowToScene(row) : null;
	}

	async findByOwner(ownerId: string): Promise<Scene[]> {
		const rows = this.db
			.prepare<[string], SceneRow>("SELECT * FROM scenes WHERE owner_id = ? ORDER BY updated_at DESC")
			.all(ownerId);
		return rows.map(rowToScene);
	}

	async delete(sceneId: string): Promise<void> {
		this.db.prepare<[string]>("DELETE FROM scenes WHERE scene_id = ?").run(sceneId);
	}

	async share(sceneId: string, shareToken: string): Promise<void> {
		this.db
			.prepare<[string, string]>("UPDATE scenes SET share_token = ?, is_public = 1 WHERE scene_id = ?")
			.run(shareToken, sceneId);
	}

	async findByShareToken(shareToken: string): Promise<Scene | null> {
		const row = this.db.prepare<[string], SceneRow>("SELECT * FROM scenes WHERE share_token = ?").get(shareToken);
		return row ? rowToScene(row) : null;
	}

	async saveVersion(version: SceneVersion): Promise<void> {
		this.db
			.prepare<[string, number, string, string, number]>(`
				INSERT OR IGNORE INTO scene_versions (scene_id, version, scene_data, provider_ref, created_at)
				VALUES (?, ?, ?, ?, ?)
			`)
			.run(
				version.sceneId,
				version.version,
				JSON.stringify(version.sceneData),
				JSON.stringify(version.providerRef),
				version.createdAt,
			);
	}

	async findVersions(sceneId: string): Promise<SceneVersion[]> {
		const rows = this.db
			.prepare<[string], SceneVersionRow>("SELECT * FROM scene_versions WHERE scene_id = ? ORDER BY version DESC")
			.all(sceneId);
		return rows.map(rowToVersion);
	}

	async findVersion(sceneId: string, version: number): Promise<SceneVersion | null> {
		const row = this.db
			.prepare<[string, number], SceneVersionRow>("SELECT * FROM scene_versions WHERE scene_id = ? AND version = ?")
			.get(sceneId, version);
		return row ? rowToVersion(row) : null;
	}
}
