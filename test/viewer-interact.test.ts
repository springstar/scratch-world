import { describe, it, expect, vi, beforeEach } from "vitest";
import { interactRoute } from "../src/viewer-api/routes/interact.js";
import { RealtimeBus } from "../src/viewer-api/realtime.js";
import type { SessionManager } from "../src/session/session-manager.js";

function makeSessionManager(impl?: Partial<SessionManager>): SessionManager {
	return {
		dispatch: vi.fn(),
		dispatchViewerInteraction: vi.fn().mockResolvedValue(undefined),
		...impl,
	} as unknown as SessionManager;
}

describe("POST /interact", () => {
	let bus: RealtimeBus;
	let sessionManager: SessionManager;
	let app: ReturnType<typeof interactRoute>;

	beforeEach(() => {
		bus = new RealtimeBus();
		sessionManager = makeSessionManager();
		app = interactRoute(sessionManager, bus);
	});

	async function post(body: unknown) {
		return app.request("/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	it("returns 400 for invalid JSON", async () => {
		const res = await app.request("/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not-json",
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBe("Invalid JSON body");
	});

	it("returns 400 when required fields are missing", async () => {
		const res = await post({ sessionId: "s1", sceneId: "sc1" }); // missing objectId, action
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toContain("Missing required fields");
	});

	it("returns 200 and calls dispatchViewerInteraction for valid request", async () => {
		const res = await post({
			sessionId: "telegram:user-1",
			sceneId: "scene-1",
			objectId: "obj_main",
			action: "examine",
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(sessionManager.dispatchViewerInteraction).toHaveBeenCalledOnce();
	});

	it("passes correct arguments to dispatchViewerInteraction", async () => {
		await post({
			sessionId: "telegram:user-1",
			sceneId: "scene-1",
			objectId: "obj_main",
			action: "open",
		});
		const [sessionId, sceneId, text] = (sessionManager.dispatchViewerInteraction as ReturnType<typeof vi.fn>).mock
			.calls[0];
		expect(sessionId).toBe("telegram:user-1");
		expect(sceneId).toBe("scene-1");
		expect(text).toContain("open");
		expect(text).toContain("obj_main");
	});

	it("returns 500 and publishes error event when dispatchViewerInteraction throws", async () => {
		const errSessionManager = makeSessionManager({
			dispatchViewerInteraction: vi.fn().mockRejectedValue(new Error("Session not found: telegram:user-1")),
		});
		const errApp = interactRoute(errSessionManager, bus);

		const received: unknown[] = [];
		// Subscribe a fake ws to capture the published error
		const { EventEmitter } = await import("events");
		const ws = Object.assign(new EventEmitter(), {
			readyState: 1,
			OPEN: 1,
			send: (data: string) => received.push(JSON.parse(data)),
			close: vi.fn(),
		});
		bus.subscribe("telegram:user-1", ws as never);

		const res = await errApp.request("/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				sessionId: "telegram:user-1",
				sceneId: "scene-1",
				objectId: "obj_main",
				action: "examine",
			}),
		});

		expect(res.status).toBe(500);
		expect(received).toHaveLength(1);
		expect((received[0] as { type: string }).type).toBe("error");
	});
});
