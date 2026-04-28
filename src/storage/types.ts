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
	// JSON-serialized SignalEntry[]; appended on each dispatch
	signals?: string;
}

export interface SessionRepository {
	save(session: SessionRecord): Promise<void>;
	findById(sessionId: string): Promise<SessionRecord | null>;
	delete(sessionId: string): Promise<void>;
	listAll(): Promise<SessionRecord[]>;
}

// ── NPC evolution audit log ────────────────────────────────────────────────

export interface NpcEvolutionEvent {
	eventId: string;
	npcId: string;
	sceneId: string;
	trigger: "interaction" | "stagnation";
	strategy: string; // EvolutionStrategy
	interactionCount: number;
	currentPersonality: string;
	suggestedDelta: string;
	status: "pending" | "approved" | "rejected";
	appliedAt?: number;
	createdAt: number;
}

export interface NpcEvolutionRepository {
	init(): Promise<void>;
	addEvent(event: NpcEvolutionEvent): Promise<void>;
	updateStatus(eventId: string, status: "approved" | "rejected", appliedAt?: number): Promise<void>;
	listByNpc(npcId: string, limit?: number): Promise<NpcEvolutionEvent[]>;
	listPending(npcId: string): Promise<NpcEvolutionEvent[]>;
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

// ── Gene candidate persistence ─────────────────────────────────────────────

export interface GeneCandidate {
	candidateId: string; // SHA-256[:16] of code — dedup key
	request: string; // user request that triggered generation (≤120 chars)
	code: string; // the LLM-generated sceneCode
	validated: boolean; // false = pending review; true = admin-approved
	createdAt: number; // Unix ms
	approvedAt?: number; // Unix ms when approved
}

export interface GeneCandidateRepository {
	init(): Promise<void>;
	upsert(candidate: GeneCandidate): Promise<void>;
	list(filter?: { validated?: boolean }): Promise<GeneCandidate[]>;
	approve(candidateId: string): Promise<void>;
	remove(candidateId: string): Promise<void>;
}
