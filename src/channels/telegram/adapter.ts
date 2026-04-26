import { Bot, InlineKeyboard, InputFile } from "grammy";
import type { ChannelAdapter, ChatMessage, OutboundMedia } from "../types.js";

export class TelegramAdapter implements ChannelAdapter {
	readonly channelId = "telegram";

	private bot: Bot;
	private handler: ((msg: ChatMessage) => Promise<void>) | null = null;

	constructor(token: string) {
		this.bot = new Bot(token);

		this.bot.on("message:text", async (ctx) => {
			if (!this.handler) return;
			const msg: ChatMessage = {
				userId: String(ctx.from.id),
				channelId: this.channelId,
				sessionId: `${this.channelId}:${ctx.from.id}`,
				text: ctx.message.text,
				timestamp: ctx.message.date * 1000,
			};
			await this.handler(msg);
		});

		this.bot.on("message:photo", async (ctx) => {
			if (!this.handler) return;
			const caption = ctx.message.caption ?? "";
			const photo = ctx.message.photo.at(-1)!; // largest size

			// Download photo from Telegram CDN so the agent can use vision on it.
			let imageData: Buffer | undefined;
			try {
				const file = await ctx.api.getFile(photo.file_id);
				if (file.file_path) {
					const token = (this.bot as unknown as { token: string }).token;
					const dlUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
					const res = await fetch(dlUrl, { signal: AbortSignal.timeout(30_000) });
					if (res.ok) imageData = Buffer.from(await res.arrayBuffer());
				}
			} catch (err) {
				console.warn("[TelegramAdapter] photo download failed:", err);
			}

			const msg: ChatMessage = {
				userId: String(ctx.from.id),
				channelId: this.channelId,
				sessionId: `${this.channelId}:${ctx.from.id}`,
				text: caption,
				media: [
					{
						type: "image",
						data: imageData,
						mimeType: "image/jpeg",
					},
				],
				timestamp: ctx.message.date * 1000,
			};
			await this.handler(msg);
		});
	}

	onMessage(handler: (msg: ChatMessage) => Promise<void>): void {
		this.handler = handler;
	}

	async start(): Promise<void> {
		await this.bot.start({
			onStart: (info) => {
				console.log(`Telegram bot @${info.username} started`);
			},
		});
	}

	async stop(): Promise<void> {
		await this.bot.stop();
	}

	async sendText(userId: string, text: string): Promise<void> {
		await this.bot.api.sendMessage(userId, text, { parse_mode: "Markdown" });
	}

	async sendMedia(userId: string, media: OutboundMedia): Promise<void> {
		const source = media.data ? new InputFile(media.data, media.caption ?? "file") : media.url!;
		switch (media.type) {
			case "image":
				await this.bot.api.sendPhoto(userId, source, { caption: media.caption });
				break;
			case "video":
				await this.bot.api.sendVideo(userId, source, { caption: media.caption });
				break;
			case "audio":
				await this.bot.api.sendAudio(userId, source, { caption: media.caption });
				break;
			case "file":
				await this.bot.api.sendDocument(userId, source, { caption: media.caption });
				break;
		}
	}

	async presentScene(userId: string, title: string, viewerUrl: string): Promise<void> {
		const keyboard = new InlineKeyboard().webApp(`Open "${title}"`, viewerUrl);
		await this.bot.api.sendMessage(userId, `🌍 Your scene is ready: *${title}*`, {
			parse_mode: "Markdown",
			reply_markup: keyboard,
		});
	}
}
