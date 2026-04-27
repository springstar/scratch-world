import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../src/session/session-manager.js";
import type { ChannelGateway } from "../src/channels/gateway.js";
import type { SceneManager } from "../src/scene/scene-manager.js";
import type { SessionRepository, SessionRecord } from "../src/storage/types.js";
import type { AgentEvent } from "@mariozechner/pi-agent-core";

// ── Fake Agent ───────────────────────────────────────────────────────────────

type EventHandler = (e: AgentEvent) => void;

function makeFakeAgent(onPrompt?: (emit: (e: AgentEvent) => void) => void | Promise<void>) {
	const listeners = new Set<EventHandler>();
	const messages: unknown[] = [];
	let systemPrompt = "base system prompt";

	const emit = (e: AgentEvent) => listeners.forEach((fn) => fn(e));

	return {
		state: {
			get messages() {
				return messages;
			},
			get systemPrompt() {
				return systemPrompt;
			},
		},
		setSystemPrompt: vi.fn((v: string) => {
			systemPrompt = v;
		}),
		replaceMessages: vi.fn((ms: unknown[]) => messages.splice(0, messages.length, ...ms)),
		subscribe: vi.fn((fn: EventHandler) => {
			listeners.add(fn);
			return () => listeners.delete(fn);
		}),
		prompt: vi.fn(async (_text: string) => {
			await onPrompt?.(emit);
		}),
		_emit: emit, // for tests that want to fire events after construction
	};
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSessionRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
	return {
		sessionId: "telegram:user-1",
		userId: "user-1",
		channelId: "telegram",
		activeSceneId: null,
		agentMessages: "[]",
		updatedAt: Date.now(),
		...overrides,
	};
}

function makeMsg() {
	return {
		sessionId: "telegram:user-1",
		userId: "user-1",
		channelId: "telegram",
		text: "hello",
		timestamp: Date.now(),
	};
}

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../src/agent/agent-factory.js", () => ({
	createAgent: vi.fn(),
	BASE_SYSTEM_PROMPT: "base system prompt",
	PROVIDER_BASE_PROMPT: "provider base prompt",
}));

import { createAgent } from "../src/agent/agent-factory.js";
const mockCreateAgent = vi.mocked(createAgent);

function makeGateway(): ChannelGateway {
	return {
		sendText: vi.fn().mockResolvedValue(undefined),
		sendMedia: vi.fn().mockResolvedValue(undefined),
		presentScene: vi.fn().mockResolvedValue(undefined),
	} as unknown as ChannelGateway;
}

function makeSceneManager(): SceneManager {
	return {
		getScene: vi.fn().mockResolvedValue(null),
		getActiveProvider: vi.fn().mockReturnValue({ name: "stub" }),
	} as unknown as SceneManager;
}

function makeSessionRepo(record: SessionRecord | null = null): SessionRepository {
	return {
		findById: vi.fn().mockResolvedValue(record),
		save: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn().mockResolvedValue(undefined),
	};
}

function makeSkillLoader() {
	return {
		getActivePromptMarkdown: vi.fn().mockReturnValue(null),
		getActiveSkill: vi.fn().mockReturnValue(null),
		getThreejsMarkdown: vi.fn().mockReturnValue(null),
		listSkills: vi.fn().mockReturnValue([]),
		activate: vi.fn(),
	};
}

function makeGenerationQueue() {
	return { enqueue: vi.fn(), stop: vi.fn() } as never;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("SessionManager", () => {
	let gateway: ChannelGateway;
	let sceneManager: SceneManager;

	beforeEach(() => {
		gateway = makeGateway();
		sceneManager = makeSceneManager();
		vi.clearAllMocks();
	});

	describe("activeSceneId tracking", () => {
		it("saves null when no scene tool fires", async () => {
			const agent = makeFakeAgent((emit) => {
				emit({
					type: "message_update",
					message: {} as never,
					assistantMessageEvent: { type: "text_delta", delta: "hi" },
				});
			});
			mockCreateAgent.mockReturnValue(agent as never);
			const repo = makeSessionRepo();
			const sm = new SessionManager(
				gateway,
				sceneManager,
				repo,
				"http://localhost:3001",
				makeSkillLoader() as never,
				makeGenerationQueue(),
			);

			await sm.dispatch(makeMsg());

			expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ activeSceneId: null }));
		});

		it("saves sceneId after create_scene tool fires", async () => {
			const agent = makeFakeAgent((emit) => {
				emit({
					type: "tool_execution_end",
					toolCallId: "tc-1",
					toolName: "create_scene",
					isError: false,
					result: { details: { sceneId: "scene-abc", title: "My World" }, content: [] },
				});
			});
			mockCreateAgent.mockReturnValue(agent as never);
			const repo = makeSessionRepo();
			const sm = new SessionManager(
				gateway,
				sceneManager,
				repo,
				"http://localhost:3001",
				makeSkillLoader() as never,
				makeGenerationQueue(),
			);

			await sm.dispatch(makeMsg());

			expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ activeSceneId: "scene-abc" }));
		});

		it("saves sceneId after update_scene tool fires", async () => {
			const agent = makeFakeAgent((emit) => {
				emit({
					type: "tool_execution_end",
					toolCallId: "tc-1",
					toolName: "update_scene",
					isError: false,
					result: { details: { sceneId: "scene-xyz", title: "Forest", version: 2 }, content: [] },
				});
			});
			mockCreateAgent.mockReturnValue(agent as never);
			const repo = makeSessionRepo();
			const sm = new SessionManager(
				gateway,
				sceneManager,
				repo,
				"http://localhost:3001",
				makeSkillLoader() as never,
				makeGenerationQueue(),
			);

			await sm.dispatch(makeMsg());

			expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ activeSceneId: "scene-xyz" }));
		});

		it("does not update activeSceneId when tool errors", async () => {
			const agent = makeFakeAgent((emit) => {
				emit({
					type: "tool_execution_end",
					toolCallId: "tc-1",
					toolName: "create_scene",
					isError: true,
					result: { details: { sceneId: "scene-err" }, content: [] },
				});
			});
			mockCreateAgent.mockReturnValue(agent as never);
			const repo = makeSessionRepo();
			const sm = new SessionManager(
				gateway,
				sceneManager,
				repo,
				"http://localhost:3001",
				makeSkillLoader() as never,
				makeGenerationQueue(),
			);

			await sm.dispatch(makeMsg());

			expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ activeSceneId: null }));
		});

		it("preserves existing activeSceneId when no scene tool fires", async () => {
			const existing = makeSessionRecord({ activeSceneId: "scene-prev" });
			const agent = makeFakeAgent();
			mockCreateAgent.mockReturnValue(agent as never);
			const repo = makeSessionRepo(existing);
			vi.mocked(sceneManager.getScene).mockResolvedValue(null); // skip hydration
			const sm = new SessionManager(
				gateway,
				sceneManager,
				repo,
				"http://localhost:3001",
				makeSkillLoader() as never,
				makeGenerationQueue(),
			);

			await sm.dispatch(makeMsg());

			expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ activeSceneId: "scene-prev" }));
		});

		it("updates to latest sceneId when multiple scene tools fire in one turn", async () => {
			const agent = makeFakeAgent((emit) => {
				emit({
					type: "tool_execution_end",
					toolCallId: "tc-1",
					toolName: "create_scene",
					isError: false,
					result: { details: { sceneId: "scene-first", title: "First" }, content: [] },
				});
				emit({
					type: "tool_execution_end",
					toolCallId: "tc-2",
					toolName: "update_scene",
					isError: false,
					result: { details: { sceneId: "scene-second", title: "Second", version: 2 }, content: [] },
				});
			});
			mockCreateAgent.mockReturnValue(agent as never);
			const repo = makeSessionRepo();
			const sm = new SessionManager(
				gateway,
				sceneManager,
				repo,
				"http://localhost:3001",
				makeSkillLoader() as never,
				makeGenerationQueue(),
			);

			await sm.dispatch(makeMsg());

			expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ activeSceneId: "scene-second" }));
		});
	});

	describe("presentScene", () => {
		it("calls gateway.presentScene with correct viewer URL after create_scene", async () => {
			const agent = makeFakeAgent((emit) => {
				emit({
					type: "tool_execution_end",
					toolCallId: "tc-1",
					toolName: "create_scene",
					isError: false,
					result: { details: { sceneId: "scene-abc", title: "My World" }, content: [] },
				});
			});
			mockCreateAgent.mockReturnValue(agent as never);
			const repo = makeSessionRepo();
			const sm = new SessionManager(
				gateway,
				sceneManager,
				repo,
				"http://localhost:3001",
				makeSkillLoader() as never,
				makeGenerationQueue(),
			);

			await sm.dispatch(makeMsg());

			expect(gateway.presentScene).toHaveBeenCalledWith(
				"telegram",
				"user-1",
				"My World",
				"http://localhost:3001/scene/scene-abc?session=telegram:user-1",
			);
		});

		it("does not call gateway.presentScene after get_scene", async () => {
			const agent = makeFakeAgent((emit) => {
				emit({
					type: "tool_execution_end",
					toolCallId: "tc-1",
					toolName: "get_scene",
					isError: false,
					result: { details: { sceneId: "scene-abc" }, content: [] },
				});
			});
			mockCreateAgent.mockReturnValue(agent as never);
			const repo = makeSessionRepo();
			const sm = new SessionManager(
				gateway,
				sceneManager,
				repo,
				"http://localhost:3001",
				makeSkillLoader() as never,
				makeGenerationQueue(),
			);

			await sm.dispatch(makeMsg());

			expect(gateway.presentScene).not.toHaveBeenCalled();
		});
	});

	describe("dispatchViewerInteraction", () => {
		it("saves sceneId from the viewer as activeSceneId", async () => {
			const record = makeSessionRecord();
			const agent = makeFakeAgent();
			mockCreateAgent.mockReturnValue(agent as never);
			const repo = makeSessionRepo(record);
			const bus = { publish: vi.fn(), subscribe: vi.fn(), hasSubscribers: vi.fn() } as never;
			const sm = new SessionManager(
				gateway,
				sceneManager,
				repo,
				"http://localhost:3001",
				makeSkillLoader() as never,
				makeGenerationQueue(),
			);

			await sm.dispatchViewerInteraction("telegram:user-1", "scene-viewer", "examine this", bus);

			expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ activeSceneId: "scene-viewer" }));
		});
	});

	describe("agent cache TTL", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("reuses cached agent within TTL", async () => {
			const agent = makeFakeAgent();
			mockCreateAgent.mockReturnValue(agent as never);
			const repo = makeSessionRepo();
			const sm = new SessionManager(
				gateway,
				sceneManager,
				repo,
				"http://localhost:3001",
				makeSkillLoader() as never,
				5 * 60 * 1000,
			);

			await sm.dispatch(makeMsg());
			await sm.dispatch(makeMsg());

			// createAgent called only once — second dispatch hit the cache
			expect(mockCreateAgent).toHaveBeenCalledTimes(1);
		});

		it("evicts agent after TTL and recreates on next dispatch", async () => {
			const agent = makeFakeAgent();
			mockCreateAgent.mockReturnValue(agent as never);
			const repo = makeSessionRepo();
			const TTL = 5 * 60 * 1000;
			const sm = new SessionManager(
				gateway,
				sceneManager,
				repo,
				"http://localhost:3001",
				makeSkillLoader() as never,
				makeGenerationQueue(),
				TTL,
			);

			await sm.dispatch(makeMsg());

			// Advance past TTL + sweep interval so the entry is stale and a sweep runs
			vi.advanceTimersByTime(TTL + 61_000);

			await sm.dispatch(makeMsg());

			// createAgent called twice — stale entry was evicted, new agent created
			expect(mockCreateAgent).toHaveBeenCalledTimes(2);
		});

		it("refreshes TTL on each access so active sessions stay warm", async () => {
			const agent = makeFakeAgent();
			mockCreateAgent.mockReturnValue(agent as never);
			const repo = makeSessionRepo();
			const TTL = 5 * 60 * 1000;
			const sm = new SessionManager(
				gateway,
				sceneManager,
				repo,
				"http://localhost:3001",
				makeSkillLoader() as never,
				makeGenerationQueue(),
				TTL,
			);

			await sm.dispatch(makeMsg());

			// Access repeatedly, each time within TTL window
			vi.advanceTimersByTime(TTL - 1000);
			await sm.dispatch(makeMsg());

			vi.advanceTimersByTime(TTL - 1000);
			await sm.dispatch(makeMsg());

			// Still only one agent created — TTL keeps getting refreshed
			expect(mockCreateAgent).toHaveBeenCalledTimes(1);
		});

		it("only evicts expired entries, keeps fresh ones", async () => {
			const agentA = makeFakeAgent();
			const agentB = makeFakeAgent();
			mockCreateAgent.mockReturnValueOnce(agentA as never).mockReturnValueOnce(agentB as never);

			const repo = makeSessionRepo();
			const TTL = 5 * 60 * 1000;
			const sm = new SessionManager(
				gateway,
				sceneManager,
				repo,
				"http://localhost:3001",
				makeSkillLoader() as never,
				makeGenerationQueue(),
				TTL,
			);

			const msgA = makeMsg(); // session telegram:user-1
			const msgB = { ...makeMsg(), userId: "user-2", sessionId: "telegram:user-2" };

			await sm.dispatch(msgA);

			// Advance past TTL for session A, but session B hasn't started yet
			vi.advanceTimersByTime(TTL + 61_000);

			await sm.dispatch(msgB); // session B created now (fresh)
			await sm.dispatch(msgB); // should hit B's cache

			// A was evicted; B was created once and cached
			expect(mockCreateAgent).toHaveBeenCalledTimes(2);
		});
	});

	describe("per-session queue (concurrency)", () => {
		it("serializes concurrent dispatches for the same session", async () => {
			const order: string[] = [];
			let resolveFirst!: () => void;
			const firstBlocked = new Promise<void>((res) => {
				resolveFirst = res;
			});

			const agent = makeFakeAgent(async () => {
				if (agent.prompt.mock.calls.length === 1) {
					order.push("A:start");
					await firstBlocked;
					order.push("A:end");
				} else {
					order.push("B:done");
				}
			});
			mockCreateAgent.mockReturnValue(agent as never);

			const repo = makeSessionRepo();
			const sm = new SessionManager(
				gateway,
				sceneManager,
				repo,
				"http://localhost:3001",
				makeSkillLoader() as never,
				makeGenerationQueue(),
			);

			const p1 = sm.dispatch(makeMsg());
			const p2 = sm.dispatch(makeMsg());

			// Drain microtask queue enough for p1's _dispatch to reach agent.prompt()
			for (let i = 0; i < 10; i++) await Promise.resolve();

			expect(order).toEqual(["A:start"]);

			resolveFirst();
			await Promise.all([p1, p2]);

			expect(order).toEqual(["A:start", "A:end", "B:done"]);
		});

		it("does not block a different session while one is running", async () => {
			const order: string[] = [];
			let resolveFirst!: () => void;
			const firstBlocked = new Promise<void>((res) => {
				resolveFirst = res;
			});

			const agentA = makeFakeAgent(async () => {
				order.push("A:start");
				await firstBlocked;
				order.push("A:end");
			});
			const agentB = makeFakeAgent(() => {
				order.push("B:done");
			});
			mockCreateAgent.mockReturnValueOnce(agentA as never).mockReturnValueOnce(agentB as never);

			const repo = makeSessionRepo();
			const sm = new SessionManager(
				gateway,
				sceneManager,
				repo,
				"http://localhost:3001",
				makeSkillLoader() as never,
				makeGenerationQueue(),
			);

			const msgA = makeMsg();
			const msgB = { ...makeMsg(), userId: "user-2", sessionId: "telegram:user-2" };

			const p1 = sm.dispatch(msgA);
			const p2 = sm.dispatch(msgB);

			for (let i = 0; i < 10; i++) await Promise.resolve();

			// B finishes independently — A still blocked
			expect(order).toContain("B:done");
			expect(order).toContain("A:start");
			expect(order).not.toContain("A:end");

			resolveFirst();
			await Promise.all([p1, p2]);
			expect(order).toContain("A:end");
		});

		it("continues processing after a task throws", async () => {
			let call = 0;
			const agent = makeFakeAgent(async () => {
				call++;
				if (call === 1) throw new Error("first call blew up");
			});
			mockCreateAgent.mockReturnValue(agent as never);

			const repo = makeSessionRepo();
			const sm = new SessionManager(
				gateway,
				sceneManager,
				repo,
				"http://localhost:3001",
				makeSkillLoader() as never,
				makeGenerationQueue(),
			);

			const p1 = sm.dispatch(makeMsg());
			const p2 = sm.dispatch(makeMsg());

			await expect(p1).rejects.toThrow("first call blew up");
			await expect(p2).resolves.not.toThrow();
			expect(agent.prompt).toHaveBeenCalledTimes(2);
		});
	});
});
