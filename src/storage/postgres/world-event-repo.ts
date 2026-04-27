import postgres from "postgres";
import type { WorldEvent, WorldEventRepository } from "../types.js";

interface WorldEventRow {
	event_id: string;
	scene_id: string;
	world_time: bigint;
	event_type: string;
	headline: string;
	body: string;
	created_at: bigint;
}

function rowToEvent(row: WorldEventRow): WorldEvent {
	return {
		eventId: row.event_id,
		sceneId: row.scene_id,
		worldTime: Number(row.world_time),
		eventType: row.event_type,
		headline: row.headline,
		body: row.body,
		createdAt: Number(row.created_at),
	};
}

export class PgWorldEventRepo implements WorldEventRepository {
	private sql: ReturnType<typeof postgres>;

	constructor(connectionString: string) {
		this.sql = postgres(connectionString);
	}

	async init(): Promise<void> {
		await this.sql.unsafe(`
			CREATE TABLE IF NOT EXISTS world_events (
				event_id   TEXT PRIMARY KEY,
				scene_id   TEXT NOT NULL,
				world_time BIGINT NOT NULL,
				event_type TEXT NOT NULL,
				headline   TEXT NOT NULL,
				body       TEXT NOT NULL,
				created_at BIGINT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS world_events_scene_id ON world_events (scene_id, created_at DESC);
		`);
	}

	async addEvent(event: WorldEvent): Promise<void> {
		await this.sql`
			INSERT INTO world_events (event_id, scene_id, world_time, event_type, headline, body, created_at)
			VALUES (${event.eventId}, ${event.sceneId}, ${event.worldTime}, ${event.eventType},
			        ${event.headline}, ${event.body}, ${event.createdAt})
		`;
	}

	async getRecentEvents(sceneId: string, limit = 20): Promise<WorldEvent[]> {
		const rows = await this.sql<WorldEventRow[]>`
			SELECT * FROM world_events
			WHERE scene_id = ${sceneId}
			ORDER BY created_at DESC
			LIMIT ${limit}
		`;
		return rows.map(rowToEvent);
	}
}
