export interface MediaAttachment {
	type: "image" | "video" | "audio" | "file";
	url?: string;
	data?: Buffer;
	mimeType: string;
	filename?: string;
}

export interface OutboundMedia {
	type: "image" | "video" | "audio" | "file";
	url?: string;
	data?: Buffer;
	mimeType: string;
	caption?: string;
}

// Normalized inbound message — same shape regardless of channel
export interface ChatMessage {
	userId: string; // stable user ID within the channel
	channelId: string; // e.g. "telegram", "discord"
	sessionId: string; // `${channelId}:${userId}`
	text: string;
	media?: MediaAttachment[];
	timestamp: number;
}

// Each channel adapter implements this interface
export interface ChannelAdapter {
	readonly channelId: string;

	start(): Promise<void>;
	stop(): Promise<void>;

	// Register the inbound message handler (called once at startup)
	onMessage(handler: (msg: ChatMessage) => Promise<void>): void;

	sendText(userId: string, text: string): Promise<void>;
	sendMedia(userId: string, media: OutboundMedia): Promise<void>;

	// Present a newly created or updated scene to the user (optional — channels without
	// in-app browser support may leave this unimplemented)
	presentScene?(userId: string, title: string, viewerUrl: string): Promise<void>;
}
