import { useState } from "react";

interface Channel {
	title: string;
	url: string;
}

interface Props {
	objectName: string;
	skillName: string;
	skillConfig: Record<string, unknown>;
	onSelect: (value: string) => void;
	onDismiss: () => void;
}

function parseChannels(config: Record<string, unknown>): Channel[] {
	if (Array.isArray(config.channels)) {
		return (config.channels as unknown[]).filter(
			(c): c is Channel =>
				typeof c === "object" &&
				c !== null &&
				typeof (c as Channel).title === "string" &&
				typeof (c as Channel).url === "string",
		);
	}
	return [];
}

export function PropInteractionPanel({ objectName, skillName, skillConfig, onSelect, onDismiss }: Props) {
	const channels = skillName === "video-player" ? parseChannels(skillConfig) : [];
	const singleUrl = typeof skillConfig.url === "string" ? skillConfig.url : "";
	const isInteractive = skillName === "code-gen" && skillConfig.mode === "interactive";
	const [request, setRequest] = useState("");

	const btnStyle: React.CSSProperties = {
		background: "rgba(120,80,255,0.12)",
		border: "1px solid rgba(120,80,255,0.25)",
		borderRadius: 8,
		color: "rgba(210,195,255,0.92)",
		fontSize: 13,
		padding: "9px 12px",
		textAlign: "left",
		cursor: "pointer",
		width: "100%",
		transition: "background 0.15s",
	};

	return (
		<div
			style={{
				position: "fixed",
				bottom: 24,
				right: 24,
				zIndex: 350,
				width: 280,
				background: "rgba(8,6,20,0.92)",
				border: "1px solid rgba(120,80,255,0.3)",
				borderRadius: 12,
				boxShadow: "0 8px 32px rgba(0,0,0,0.55)",
				fontFamily: "system-ui, -apple-system, sans-serif",
				backdropFilter: "blur(8px)",
				overflow: "hidden",
			}}
		>
			{/* Header */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					padding: "12px 14px 10px",
					borderBottom: "1px solid rgba(120,80,255,0.15)",
				}}
			>
				<span style={{ color: "rgba(200,185,255,0.95)", fontSize: 14, fontWeight: 600 }}>
					{objectName}
				</span>
				<button
					type="button"
					onClick={onDismiss}
					style={{
						background: "none",
						border: "none",
						color: "rgba(160,140,220,0.7)",
						fontSize: 18,
						cursor: "pointer",
						lineHeight: 1,
						padding: "0 2px",
					}}
				>
					×
				</button>
			</div>

			{/* Body */}
			<div style={{ padding: "10px 12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
				{skillName === "tv-display" && (
					<button
						type="button"
						onClick={() => onSelect("__view__")}
						style={{ ...btnStyle, background: "rgba(120,80,255,0.2)", border: "1px solid rgba(120,80,255,0.35)", fontSize: 14, fontWeight: 600, textAlign: "center" }}
					>
						{typeof skillConfig.title === "string" ? skillConfig.title : "查看"}
					</button>
				)}

				{skillName === "video-player" && (
					<>
						{channels.length > 0 ? (
							<>
								<div style={{ color: "rgba(160,145,210,0.7)", fontSize: 11, marginBottom: 2 }}>
									选择频道
								</div>
								{channels.map((ch) => (
									<button
										key={ch.url}
										type="button"
										onClick={() => onSelect(ch.url)}
										style={btnStyle}
										onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(120,80,255,0.25)"; }}
										onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(120,80,255,0.12)"; }}
									>
										{ch.title}
									</button>
								))}
							</>
						) : singleUrl ? (
							<button
								type="button"
								onClick={() => onSelect(singleUrl)}
								style={{ ...btnStyle, background: "rgba(120,80,255,0.2)", border: "1px solid rgba(120,80,255,0.35)", fontSize: 14, fontWeight: 600 }}
							>
								播放
							</button>
						) : null}
					</>
				)}

				{skillName === "code-gen" && (
					<>
						{isInteractive ? (
							<>
								<div style={{ color: "rgba(160,145,210,0.7)", fontSize: 11, marginBottom: 2 }}>
									描述你想要的效果
								</div>
								<textarea
									value={request}
									onChange={(e) => setRequest(e.target.value)}
									placeholder="例如：让这个物体发光并旋转…"
									rows={3}
									style={{
										background: "rgba(255,255,255,0.06)",
										border: "1px solid rgba(120,80,255,0.25)",
										borderRadius: 6,
										color: "rgba(210,195,255,0.9)",
										fontSize: 12,
										padding: "8px 10px",
										resize: "none",
										outline: "none",
										width: "100%",
										boxSizing: "border-box",
									}}
								/>
								<button
									type="button"
									disabled={!request.trim()}
									onClick={() => { if (request.trim()) onSelect(request.trim()); }}
									style={{
										...btnStyle,
										background: request.trim() ? "rgba(120,80,255,0.3)" : "rgba(120,80,255,0.08)",
										fontWeight: 600,
										textAlign: "center",
										opacity: request.trim() ? 1 : 0.5,
									}}
								>
									生成并运行
								</button>
							</>
						) : (
							<button
								type="button"
								onClick={() => onSelect("__preset__")}
								style={{ ...btnStyle, background: "rgba(120,80,255,0.2)", border: "1px solid rgba(120,80,255,0.35)", fontSize: 14, fontWeight: 600, textAlign: "center" }}
							>
								{typeof skillConfig.title === "string" ? skillConfig.title : "激活"}
							</button>
						)}
					</>
				)}
			</div>
		</div>
	);
}
