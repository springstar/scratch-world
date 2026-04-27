import postgres from "postgres";
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
	created_at: bigint;
	updated_at: bigint;
	is_public: boolean;
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
	created_at: bigint;
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
		createdAt: Number(row.created_at),
		updatedAt: Number(row.updated_at),
		isPublic: row.is_public,
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
		createdAt: Number(row.created_at),
	};
}

export class PgSceneRepo implements SceneRepository {
	private sql: ReturnType<typeof postgres>;

	constructor(connectionString: string) {
		this.sql = postgres(connectionString);
	}

	async init(): Promise<void> {
		await this.sql.unsafe(`
			CREATE TABLE IF NOT EXISTS scenes (
				scene_id     TEXT PRIMARY KEY,
				owner_id     TEXT NOT NULL,
				title        TEXT NOT NULL,
				description  TEXT NOT NULL,
				scene_data   TEXT NOT NULL,
				provider_ref TEXT NOT NULL,
				version      INTEGER NOT NULL DEFAULT 1,
				created_at   BIGINT NOT NULL,
				updated_at   BIGINT NOT NULL,
				is_public    BOOLEAN NOT NULL DEFAULT FALSE,
				share_token  TEXT UNIQUE
			);

			CREATE INDEX IF NOT EXISTS idx_scenes_owner ON scenes(owner_id);

			CREATE TABLE IF NOT EXISTS scene_versions (
				scene_id     TEXT NOT NULL,
				version      INTEGER NOT NULL,
				scene_data   TEXT NOT NULL,
				provider_ref TEXT NOT NULL,
				created_at   BIGINT NOT NULL,
				PRIMARY KEY (scene_id, version)
			);
		`);

		// Migrations: add columns if table already exists without them
		await this.sql.unsafe(`ALTER TABLE scenes ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE`);
		await this.sql.unsafe(`ALTER TABLE scenes ADD COLUMN IF NOT EXISTS share_token TEXT`);
		await this.sql.unsafe(`ALTER TABLE scenes ADD COLUMN IF NOT EXISTS status TEXT`);
		await this.sql.unsafe(`ALTER TABLE scenes ADD COLUMN IF NOT EXISTS operation_id TEXT`);
		await this.sql.unsafe(`ALTER TABLE scenes ADD COLUMN IF NOT EXISTS thumbnail_url TEXT`);
	}

	async save(scene: Scene): Promise<void> {
		await this.sql`
			INSERT INTO scenes
				(scene_id, owner_id, title, description, scene_data, provider_ref, version, created_at, updated_at, is_public, share_token, status, operation_id, thumbnail_url)
			VALUES
				(${scene.sceneId}, ${scene.ownerId}, ${scene.title}, ${scene.description},
				 ${JSON.stringify(scene.sceneData)}, ${JSON.stringify(scene.providerRef)},
				 ${scene.version}, ${scene.createdAt}, ${scene.updatedAt},
				 ${scene.isPublic}, ${scene.shareToken ?? null}, ${scene.status ?? null},
				 ${scene.operationId ?? null}, ${scene.thumbnailUrl ?? null})
			ON CONFLICT (scene_id) DO UPDATE SET
				title         = EXCLUDED.title,
				description   = EXCLUDED.description,
				scene_data    = EXCLUDED.scene_data,
				provider_ref  = EXCLUDED.provider_ref,
				version       = EXCLUDED.version,
				updated_at    = EXCLUDED.updated_at,
				is_public     = EXCLUDED.is_public,
				share_token   = EXCLUDED.share_token,
				status        = EXCLUDED.status,
				operation_id  = EXCLUDED.operation_id,
				thumbnail_url = EXCLUDED.thumbnail_url
		`;
	}

	async findById(sceneId: string): Promise<Scene | null> {
		const rows = await this.sql<SceneRow[]>`SELECT * FROM scenes WHERE scene_id = ${sceneId}`;
		return rows[0] ? rowToScene(rows[0]) : null;
	}

	async findByOwner(ownerId: string): Promise<Scene[]> {
		const rows = await this.sql<SceneRow[]>`
			SELECT * FROM scenes WHERE owner_id = ${ownerId} ORDER BY updated_at DESC
		`;
		return rows.map(rowToScene);
	}

	async findAll(): Promise<Scene[]> {
		const rows = await this.sql<SceneRow[]>`SELECT * FROM scenes ORDER BY updated_at DESC`;
		return rows.map(rowToScene);
	}

	async findByProvider(provider: string): Promise<Scene[]> {
		const rows = await this.sql<SceneRow[]>`
			SELECT * FROM scenes
			WHERE provider_ref::jsonb->>'provider' = ${provider}
			ORDER BY updated_at DESC
		`;
		return rows.map(rowToScene);
	}

	async delete(sceneId: string): Promise<void> {
		await this.sql`DELETE FROM scenes WHERE scene_id = ${sceneId}`;
	}

	async share(sceneId: string, shareToken: string): Promise<void> {
		await this.sql`
			UPDATE scenes SET share_token = ${shareToken}, is_public = TRUE WHERE scene_id = ${sceneId}
		`;
	}

	async findByShareToken(shareToken: string): Promise<Scene | null> {
		const rows = await this.sql<SceneRow[]>`SELECT * FROM scenes WHERE share_token = ${shareToken}`;
		return rows[0] ? rowToScene(rows[0]) : null;
	}

	async saveVersion(version: SceneVersion): Promise<void> {
		await this.sql`
			INSERT INTO scene_versions (scene_id, version, scene_data, provider_ref, created_at)
			VALUES (${version.sceneId}, ${version.version}, ${JSON.stringify(version.sceneData)},
			        ${JSON.stringify(version.providerRef)}, ${version.createdAt})
			ON CONFLICT DO NOTHING
		`;
	}

	async findVersions(sceneId: string): Promise<SceneVersion[]> {
		const rows = await this.sql<SceneVersionRow[]>`
			SELECT * FROM scene_versions WHERE scene_id = ${sceneId} ORDER BY version DESC
		`;
		return rows.map(rowToVersion);
	}

	async findVersion(sceneId: string, version: number): Promise<SceneVersion | null> {
		const rows = await this.sql<SceneVersionRow[]>`
			SELECT * FROM scene_versions WHERE scene_id = ${sceneId} AND version = ${version}
		`;
		return rows[0] ? rowToVersion(rows[0]) : null;
	}
}
