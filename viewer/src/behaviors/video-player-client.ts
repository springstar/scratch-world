import type { DisplayConfig } from "../types.js";

function toEmbedUrl(url: string): string {
	const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
	if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1`;
	const bvMatch = url.match(/bilibili\.com\/video\/(BV[A-Za-z0-9]+)/);
	if (bvMatch) return `https://player.bilibili.com/player.html?bvid=${bvMatch[1]}&autoplay=1`;
	const biliLiveMatch = url.match(/live\.bilibili\.com\/(\d+)/);
	if (biliLiveMatch) return `https://live.bilibili.com/h5/${biliLiveMatch[1]}`;
	return url;
}

function isDirectVideo(url: string): boolean {
	return /\.(mp4|webm|ogg|mov)(\?|$)/i.test(url);
}

/** Resolve a video URL to a DisplayConfig without a server round-trip. */
export function resolveVideoDisplay(url: string, title?: string): DisplayConfig {
	if (!url) return { type: "markdown", content: "**错误:** 未指定视频地址。", title: "错误" };
	if (isDirectVideo(url)) return { type: "video", url, title };
	return { type: "iframe", url: toEmbedUrl(url), title };
}
