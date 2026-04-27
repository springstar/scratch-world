import postgres from "postgres";
import type { SessionRecord, SessionRepository } from "../types.js";

interface SessionRow {
	session_id: string;
	user_id: string;
	channel_id: string;
	active_scene_id: string | null;
	agent_messages: string;
	updated_at: bigint;
}

function rowToRecord(row: SessionRow): SessionRecord {
	return {
		sessionId: row.session_id,
		userId: row.user_id,
		channelId: row.channel_id,
		activeSceneId: row.active_scene_id,
		agentMessages: row.agent_messages,
		updatedAt: Number(row.updated_at),
	};
}

export class PgSessionRepo implements SessionRepository {
	private sql: ReturnType<typeof postgres>;

	constructor(connectionString: string) {
		this.sql = postgres(connectionString);
	}

	async init(): Promise<void> {
		await this.sql.unsafe(`
			CREATE TABLE IF NOT EXISTS sessions (
				session_id      TEXT PRIMARY KEY,
				user_id         TEXT NOT NULL,
				channel_id      TEXT NOT NULL,
				active_scene_id TEXT,
				agent_messages  TEXT NOT NULL DEFAULT '[]',
				updated_at      BIGINT NOT NULL
			);
		`);
	}

	async save(session: SessionRecord): Promise<void> {
		await this.sql`
			INSERT INTO sessions (session_id, user_id, channel_id, active_scene_id, agent_messages, updated_at)
			VALUES (${session.sessionId}, ${session.userId}, ${session.channelId},
			        ${session.activeSceneId ?? null}, ${session.agentMessages}, ${session.updatedAt})
			ON CONFLICT (session_id) DO UPDATE SET
				active_scene_id = EXCLUDED.active_scene_id,
				agent_messages  = EXCLUDED.agent_messages,
				updated_at      = EXCLUDED.updated_at
		`;
	}

	async findById(sessionId: string): Promise<SessionRecord | null> {
		const rows = await this.sql<SessionRow[]>`SELECT * FROM sessions WHERE session_id = ${sessionId}`;
		return rows[0] ? rowToRecord(rows[0]) : null;
	}

	async delete(sessionId: string): Promise<void> {
		await this.sql`DELETE FROM sessions WHERE session_id = ${sessionId}`;
	}
}
