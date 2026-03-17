import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import type WebSocket from "ws";
import { RealtimeBus } from "../src/viewer-api/realtime.js";
import type { RealtimeEvent } from "../src/viewer-api/realtime.js";

// Minimal WebSocket stub
function makeWs(readyState: number = 1 /* OPEN */): WebSocket {
	const emitter = new EventEmitter();
	return Object.assign(emitter, {
		readyState,
		OPEN: 1,
		send: vi.fn(),
		close: vi.fn(),
	}) as unknown as WebSocket;
}

describe("RealtimeBus", () => {
	let bus: RealtimeBus;

	beforeEach(() => {
		bus = new RealtimeBus();
	});

	it("reports no subscribers for unknown sessionId", () => {
		expect(bus.hasSubscribers("session-1")).toBe(false);
	});

	it("reports subscribers after a client connects", () => {
		const ws = makeWs();
		bus.subscribe("session-1", ws);
		expect(bus.hasSubscribers("session-1")).toBe(true);
	});

	it("publishes event to a subscribed client", () => {
		const ws = makeWs();
		bus.subscribe("session-1", ws);
		const event: RealtimeEvent = { type: "text_delta", delta: "hello" };
		bus.publish("session-1", event);
		expect(ws.send).toHaveBeenCalledWith(JSON.stringify(event));
	});

	it("publishes to all clients subscribed to the same session", () => {
		const ws1 = makeWs();
		const ws2 = makeWs();
		bus.subscribe("session-1", ws1);
		bus.subscribe("session-1", ws2);
		bus.publish("session-1", { type: "text_done", text: "done" });
		expect(ws1.send).toHaveBeenCalledTimes(1);
		expect(ws2.send).toHaveBeenCalledTimes(1);
	});

	it("does not publish to clients of a different session", () => {
		const ws1 = makeWs();
		const ws2 = makeWs();
		bus.subscribe("session-1", ws1);
		bus.subscribe("session-2", ws2);
		bus.publish("session-1", { type: "text_delta", delta: "hi" });
		expect(ws1.send).toHaveBeenCalledTimes(1);
		expect(ws2.send).not.toHaveBeenCalled();
	});

	it("does not send to a client that is not OPEN", () => {
		const ws = makeWs(3 /* CLOSED */);
		bus.subscribe("session-1", ws);
		bus.publish("session-1", { type: "text_delta", delta: "hi" });
		expect(ws.send).not.toHaveBeenCalled();
	});

	it("removes client and cleans up session on close", () => {
		const ws = makeWs();
		bus.subscribe("session-1", ws);
		expect(bus.hasSubscribers("session-1")).toBe(true);
		// Simulate WebSocket close event
		ws.emit("close");
		expect(bus.hasSubscribers("session-1")).toBe(false);
	});

	it("silently ignores publish to session with no subscribers", () => {
		expect(() => bus.publish("nonexistent", { type: "text_delta", delta: "x" })).not.toThrow();
	});
});
