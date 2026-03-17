import type { ChannelAdapter, ChatMessage, OutboundMedia } from "./types.js";

export class ChannelGateway {
	private adapters = new Map<string, ChannelAdapter>();
	private handler: ((msg: ChatMessage) => Promise<void>) | null = null;

	register(adapter: ChannelAdapter): void {
		this.adapters.set(adapter.channelId, adapter);
		adapter.onMessage(async (msg) => {
			if (!this.handler) return;
			try {
				await this.handler(msg);
			} catch (err) {
				console.error(`[gateway] unhandled error for session ${msg.sessionId}:`, err);
			}
		});
	}

	// Register the application-level message handler (called once at startup)
	onMessage(handler: (msg: ChatMessage) => Promise<void>): void {
		this.handler = handler;
	}

	async sendText(channelId: string, userId: string, text: string): Promise<void> {
		const adapter = this.adapters.get(channelId);
		if (!adapter) throw new Error(`No adapter registered for channel: ${channelId}`);
		await adapter.sendText(userId, text);
	}

	async sendMedia(channelId: string, userId: string, media: OutboundMedia): Promise<void> {
		const adapter = this.adapters.get(channelId);
		if (!adapter) throw new Error(`No adapter registered for channel: ${channelId}`);
		await adapter.sendMedia(userId, media);
	}

	async presentScene(channelId: string, userId: string, title: string, viewerUrl: string): Promise<void> {
		const adapter = this.adapters.get(channelId);
		if (!adapter) return;
		await adapter.presentScene?.(userId, title, viewerUrl);
	}

	async start(): Promise<void> {
		await Promise.all([...this.adapters.values()].map((a) => a.start()));
	}

	async stop(): Promise<void> {
		await Promise.all([...this.adapters.values()].map((a) => a.stop()));
	}
}
