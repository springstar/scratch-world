import type Database from "better-sqlite3";
import type { WorldEvent, WorldEventRepository } from "../types.js";

interface WorldEventRow {
	event_id: string;
	scene_id: string;
	world_time: number;
	event_type: string;
	headline: string;
	body: string;
	created_at: number;
}

function rowToEvent(row: WorldEventRow): WorldEvent {
	return {
		eventId: row.event_id,
		sceneId: row.scene_id,
		worldTime: row.world_time,
		eventType: row.event_type,
		headline: row.headline,
		body: row.body,
		createdAt: row.created_at,
	};
}

export class SqliteWorldEventRepo implements WorldEventRepository {
	private db: Database.Database;

	constructor(db: Database.Database) {
		this.db = db;
	}

	async init(): Promise<void> {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS world_events (
				event_id   TEXT PRIMARY KEY,
				scene_id   TEXT NOT NULL,
				world_time INTEGER NOT NULL,
				event_type TEXT NOT NULL,
				headline   TEXT NOT NULL,
				body       TEXT NOT NULL,
				created_at INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS world_events_scene_id ON world_events (scene_id, created_at DESC);
		`);
	}

	async addEvent(event: WorldEvent): Promise<void> {
		this.db
			.prepare<[string, string, number, string, string, string, number]>(`
				INSERT INTO world_events (event_id, scene_id, world_time, event_type, headline, body, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`)
			.run(
				event.eventId,
				event.sceneId,
				event.worldTime,
				event.eventType,
				event.headline,
				event.body,
				event.createdAt,
			);
	}

	async getRecentEvents(sceneId: string, limit = 20): Promise<WorldEvent[]> {
		const rows = this.db
			.prepare<[string, number], WorldEventRow>(
				`SELECT * FROM world_events WHERE scene_id = ? ORDER BY created_at DESC LIMIT ?`,
			)
			.all(sceneId, limit);
		return rows.map(rowToEvent);
	}
}
