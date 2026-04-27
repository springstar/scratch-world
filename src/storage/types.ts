import type { Scene, SceneVersion } from "../scene/types.js";

// ── Scene persistence ──────────────────────────────────────────────────────

export interface SceneRepository {
	save(scene: Scene): Promise<void>;
	findById(sceneId: string): Promise<Scene | null>;
	findByOwner(ownerId: string): Promise<Scene[]>;
	findAll(): Promise<Scene[]>;
	findByProvider(provider: string): Promise<Scene[]>;
	delete(sceneId: string): Promise<void>;

	// Sharing
	share(sceneId: string, shareToken: string): Promise<void>;
	findByShareToken(shareToken: string): Promise<Scene | null>;

	// Version snapshots — written before every update, never mutated
	saveVersion(version: SceneVersion): Promise<void>;
	findVersions(sceneId: string): Promise<SceneVersion[]>;
	findVersion(sceneId: string, version: number): Promise<SceneVersion | null>;
}

// ── Session persistence ────────────────────────────────────────────────────

export interface SessionRecord {
	sessionId: string; // `${channelId}:${userId}`
	userId: string;
	channelId: string;
	activeSceneId: string | null;
	// Serialized pi-agent-core message history (JSON)
	agentMessages: string;
	updatedAt: number;
}

export interface SessionRepository {
	save(session: SessionRecord): Promise<void>;
	findById(sessionId: string): Promise<SessionRecord | null>;
	delete(sessionId: string): Promise<void>;
}

// ── World events persistence ───────────────────────────────────────────────

export interface WorldEvent {
	eventId: string;
	sceneId: string;
	worldTime: number; // 0–86400 game seconds at time of event
	eventType: string; // "weather" | "discovery" | "npc_activity" | "anomaly"
	headline: string; // ≤60 chars — shown in WorldJournal
	body: string; // 1–2 sentence flavor text
	createdAt: number; // Unix ms
}

export interface WorldEventRepository {
	init(): Promise<void>;
	addEvent(event: WorldEvent): Promise<void>;
	getRecentEvents(sceneId: string, limit?: number): Promise<WorldEvent[]>;
}
