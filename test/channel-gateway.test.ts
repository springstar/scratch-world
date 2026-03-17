import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChannelGateway } from "../src/channels/gateway.js";
import type { ChannelAdapter, ChatMessage, OutboundMedia } from "../src/channels/types.js";

function makeAdapter(channelId: string): ChannelAdapter & { trigger: (msg: ChatMessage) => Promise<void> } {
	let handler: ((msg: ChatMessage) => Promise<void>) | null = null;
	return {
		channelId,
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		sendText: vi.fn().mockResolvedValue(undefined),
		sendMedia: vi.fn().mockResolvedValue(undefined),
		presentScene: vi.fn().mockResolvedValue(undefined),
		onMessage(h) {
			handler = h;
		},
		async trigger(msg: ChatMessage) {
			await handler?.(msg);
		},
	};
}

function makeMessage(channelId: string, userId = "user-1"): ChatMessage {
	return {
		userId,
		channelId,
		sessionId: `${channelId}:${userId}`,
		text: "hello",
		timestamp: Date.now(),
	};
}

describe("ChannelGateway", () => {
	let gateway: ChannelGateway;

	beforeEach(() => {
		gateway = new ChannelGateway();
	});

	it("routes inbound messages to the registered handler", async () => {
		const adapter = makeAdapter("telegram");
		gateway.register(adapter);

		const received: ChatMessage[] = [];
		gateway.onMessage(async (msg) => {
			received.push(msg);
		});

		const msg = makeMessage("telegram");
		await adapter.trigger(msg);
		expect(received).toHaveLength(1);
		expect(received[0].channelId).toBe("telegram");
	});

	it("calls sendText on the correct adapter", async () => {
		const tg = makeAdapter("telegram");
		const dc = makeAdapter("discord");
		gateway.register(tg);
		gateway.register(dc);

		await gateway.sendText("telegram", "user-1", "hello");
		expect(tg.sendText).toHaveBeenCalledWith("user-1", "hello");
		expect(dc.sendText).not.toHaveBeenCalled();
	});

	it("throws when sending to an unregistered channel", async () => {
		await expect(gateway.sendText("whatsapp", "user-1", "hi")).rejects.toThrow("No adapter registered");
	});

	it("calls sendMedia on the correct adapter", async () => {
		const tg = makeAdapter("telegram");
		gateway.register(tg);
		const media: OutboundMedia = { type: "image", url: "https://example.com/img.png", mimeType: "image/png" };
		await gateway.sendMedia("telegram", "user-1", media);
		expect(tg.sendMedia).toHaveBeenCalledWith("user-1", media);
	});

	it("calls presentScene on the correct adapter", async () => {
		const tg = makeAdapter("telegram");
		gateway.register(tg);
		await gateway.presentScene("telegram", "user-1", "My World", "http://localhost:3001/scene/s1?session=tg:1");
		expect(tg.presentScene).toHaveBeenCalledWith("user-1", "My World", "http://localhost:3001/scene/s1?session=tg:1");
	});

	it("silently skips presentScene for adapters without support", async () => {
		// Adapter without presentScene (simulate optional)
		const bare: ChannelAdapter & { trigger: (msg: ChatMessage) => Promise<void> } = {
			...makeAdapter("bare"),
			presentScene: undefined,
		};
		gateway.register(bare);
		await expect(gateway.presentScene("bare", "user-1", "Title", "http://localhost/scene/x")).resolves.not.toThrow();
	});

	it("starts and stops all registered adapters", async () => {
		const tg = makeAdapter("telegram");
		const dc = makeAdapter("discord");
		gateway.register(tg);
		gateway.register(dc);
		await gateway.start();
		await gateway.stop();
		expect(tg.start).toHaveBeenCalled();
		expect(dc.start).toHaveBeenCalled();
		expect(tg.stop).toHaveBeenCalled();
		expect(dc.stop).toHaveBeenCalled();
	});

	it("does not crash when no handler is registered", async () => {
		const adapter = makeAdapter("telegram");
		gateway.register(adapter);
		// no gateway.onMessage() call
		await expect(adapter.trigger(makeMessage("telegram"))).resolves.not.toThrow();
	});

	it("catches handler errors and does not propagate them", async () => {
		const adapter = makeAdapter("telegram");
		gateway.register(adapter);
		gateway.onMessage(async () => {
			throw new Error("handler blew up");
		});
		// should not throw
		await expect(adapter.trigger(makeMessage("telegram"))).resolves.not.toThrow();
	});
});
