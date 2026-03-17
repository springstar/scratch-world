import type Database from "better-sqlite3";
import type { SessionRecord, SessionRepository } from "../types.js";

interface SessionRow {
	session_id: string;
	user_id: string;
	channel_id: string;
	active_scene_id: string | null;
	agent_messages: string;
	updated_at: number;
}

function rowToRecord(row: SessionRow): SessionRecord {
	return {
		sessionId: row.session_id,
		userId: row.user_id,
		channelId: row.channel_id,
		activeSceneId: row.active_scene_id,
		agentMessages: row.agent_messages,
		updatedAt: row.updated_at,
	};
}

export class SqliteSessionRepo implements SessionRepository {
	private db: Database.Database;

	constructor(db: Database.Database) {
		this.db = db;
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS sessions (
				session_id      TEXT PRIMARY KEY,
				user_id         TEXT NOT NULL,
				channel_id      TEXT NOT NULL,
				active_scene_id TEXT,
				agent_messages  TEXT NOT NULL DEFAULT '[]',
				updated_at      INTEGER NOT NULL
			);
		`);
	}

	async save(session: SessionRecord): Promise<void> {
		this.db
			.prepare<[string, string, string, string | null, string, number]>(`
				INSERT INTO sessions (session_id, user_id, channel_id, active_scene_id, agent_messages, updated_at)
				VALUES (?, ?, ?, ?, ?, ?)
				ON CONFLICT(session_id) DO UPDATE SET
					active_scene_id = excluded.active_scene_id,
					agent_messages  = excluded.agent_messages,
					updated_at      = excluded.updated_at
			`)
			.run(
				session.sessionId,
				session.userId,
				session.channelId,
				session.activeSceneId,
				session.agentMessages,
				session.updatedAt,
			);
	}

	async findById(sessionId: string): Promise<SessionRecord | null> {
		const row = this.db.prepare<[string], SessionRow>("SELECT * FROM sessions WHERE session_id = ?").get(sessionId);
		return row ? rowToRecord(row) : null;
	}

	async delete(sessionId: string): Promise<void> {
		this.db.prepare<[string]>("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
	}
}
