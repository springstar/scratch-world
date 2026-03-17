import * as readline from "node:readline";
import type { ChannelAdapter, ChatMessage, OutboundMedia } from "../types.js";

/**
 * StdinAdapter — reads user input from stdin, prints replies to stdout.
 * Useful for local testing without a Telegram bot token.
 *
 * Usage: set CHANNEL=stdin in .env (or run with CHANNEL=stdin npm run dev)
 */
export class StdinAdapter implements ChannelAdapter {
	readonly channelId = "stdin";

	private handler: ((msg: ChatMessage) => Promise<void>) | null = null;
	private rl: readline.Interface | null = null;

	onMessage(handler: (msg: ChatMessage) => Promise<void>): void {
		this.handler = handler;
	}

	async start(): Promise<void> {
		this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });

		console.log('\n[stdin] Ready. Type a message and press Enter. Ctrl+C to exit.\n');

		this.rl.on("line", async (line) => {
			const text = line.trim();
			if (!text || !this.handler) return;

			const msg: ChatMessage = {
				userId: "local-user",
				channelId: this.channelId,
				sessionId: "stdin:local-user",
				text,
				timestamp: Date.now(),
			};

			try {
				await this.handler(msg);
			} catch (err) {
				console.error("[stdin] handler error:", err);
			}
		});

		this.rl.on("close", () => process.exit(0));
	}

	async stop(): Promise<void> {
		this.rl?.close();
	}

	async sendText(_userId: string, text: string): Promise<void> {
		console.log(`\n[bot] ${text}\n`);
	}

	async sendMedia(_userId: string, media: OutboundMedia): Promise<void> {
		console.log(`\n[bot] (media: ${media.type}) ${media.url ?? "(buffer)"}\n`);
	}

	async presentScene(_userId: string, title: string, viewerUrl: string): Promise<void> {
		console.log(`\n[bot] Scene ready: ${title}`);
		console.log(`      Open in browser: ${viewerUrl}\n`);
	}
}
