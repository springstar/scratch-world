import type { BehaviorContext, DisplayConfig, SkillHandler } from "../types.js";

function toEmbedUrl(url: string): string {
	// YouTube: convert watch URL to embed URL
	const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
	if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1`;
	// Bilibili: convert regular video URL to embed URL
	const bvMatch = url.match(/bilibili\.com\/video\/(BV[A-Za-z0-9]+)/);
	if (bvMatch) return `https://player.bilibili.com/player.html?bvid=${bvMatch[1]}&autoplay=1`;
	// Bilibili live room: live.bilibili.com/<roomId>
	const biliLiveMatch = url.match(/live\.bilibili\.com\/(\d+)/);
	if (biliLiveMatch) return `https://live.bilibili.com/h5/${biliLiveMatch[1]}`;
	// Direct video file — return as-is for <video> tag
	return url;
}

function isDirectVideo(url: string): boolean {
	return /\.(mp4|webm|ogg|mov)(\?|$)/i.test(url);
}

export const videoPlayerSkill: SkillHandler = {
	name: "video-player",
	description:
		"Play a video (YouTube, Bilibili, or direct MP4/WebM URL) when the player interacts with the object. Supports single URL or multi-channel preset list.",
	configSchema: {
		url: {
			description:
				"Default video URL (single channel). Supports YouTube, Bilibili, or direct .mp4/.webm links. Optional if channels is set.",
			required: false,
		},
		channels: {
			description:
				'Array of preset channels shown in the remote-control panel. Format: [{"title": "...", "url": "..."}]. If provided, players see a channel list and pick one.',
			required: false,
		},
		title: { description: "Panel title.", required: false },
	},
	async handle(ctx: BehaviorContext): Promise<DisplayConfig> {
		// channelUrl is set by the client when the player picks a specific channel
		const url = String(ctx.config.channelUrl ?? ctx.config.url ?? "");
		const title = ctx.config.title ? String(ctx.config.title) : ctx.objectName;
		if (!url) {
			return { type: "markdown", content: "**配置错误:** url 字段缺失。", title: "错误" };
		}
		if (isDirectVideo(url)) {
			return { type: "video", url, title };
		}
		const embedUrl = toEmbedUrl(url);
		return { type: "iframe", url: embedUrl, title };
	},
};
