import type Database from "better-sqlite3";
import type { SessionRecord, SessionRepository } from "../types.js";

interface SessionRow {
	session_id: string;
	user_id: string;
	channel_id: string;
	active_scene_id: string | null;
	agent_messages: string;
	updated_at: number;
	signals?: string;
}

function rowToRecord(row: SessionRow): SessionRecord {
	return {
		sessionId: row.session_id,
		userId: row.user_id,
		channelId: row.channel_id,
		activeSceneId: row.active_scene_id,
		agentMessages: row.agent_messages,
		updatedAt: row.updated_at,
		signals: row.signals ?? undefined,
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
		// Additive migration for existing DBs
		try {
			this.db.exec(`ALTER TABLE sessions ADD COLUMN signals TEXT DEFAULT '[]'`);
		} catch {
			/* already exists */
		}
	}

	async save(session: SessionRecord): Promise<void> {
		this.db
			.prepare<[string, string, string, string | null, string, number, string]>(`
				INSERT INTO sessions (session_id, user_id, channel_id, active_scene_id, agent_messages, updated_at, signals)
				VALUES (?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(session_id) DO UPDATE SET
					active_scene_id = excluded.active_scene_id,
					agent_messages  = excluded.agent_messages,
					updated_at      = excluded.updated_at,
					signals         = excluded.signals
			`)
			.run(
				session.sessionId,
				session.userId,
				session.channelId,
				session.activeSceneId,
				session.agentMessages,
				session.updatedAt,
				session.signals ?? "[]",
			);
	}

	async findById(sessionId: string): Promise<SessionRecord | null> {
		const row = this.db.prepare<[string], SessionRow>("SELECT * FROM sessions WHERE session_id = ?").get(sessionId);
		return row ? rowToRecord(row) : null;
	}

	async delete(sessionId: string): Promise<void> {
		this.db.prepare<[string]>("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
	}

	async listAll(): Promise<SessionRecord[]> {
		const rows = this.db.prepare<[], SessionRow>("SELECT * FROM sessions ORDER BY updated_at DESC").all();
		return rows.map(rowToRecord);
	}
}
