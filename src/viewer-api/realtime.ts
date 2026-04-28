import type WebSocket from "ws";

// One RealtimeBus per process. Sessions subscribe to receive push events.
// Events flow in two directions:
//   server → client: LLM text deltas, scene updates, interaction outcomes
//   (client → server goes via HTTP POST /interact, not WebSocket)

export type RealtimeEvent =
	| { type: "text_delta"; delta: string }
	| { type: "text_done"; text: string }
	| { type: "scene_created"; sceneId: string; title: string; viewUrl: string }
	| { type: "scene_updated"; sceneId: string; version: number }
	| { type: "interaction_result"; outcome: string; sceneChanged: boolean }
	| { type: "npc_speech"; npcId: string; npcName: string; text: string; sceneId?: string }
	| { type: "npc_move"; npcId: string; position: { x: number; y: number; z: number }; sceneId?: string }
	| { type: "npc_emote"; npcId: string; animation: string; sceneId?: string }
	| { type: "npc_trade_offer"; npcId: string; npcName: string; item: string; price: string; sceneId?: string }
	| {
			type: "npc_waypoint";
			npcId: string;
			npcName: string;
			position: { x: number; z: number };
			label: string;
			sceneId?: string;
	  }
	| {
			type: "npc_quest";
			npcId: string;
			npcName: string;
			title: string;
			objective: string;
			reward: string;
			sceneId?: string;
	  }
	| { type: "error"; message: string }
	| {
			type: "position_picker";
			pickerId: string;
			panoUrl: string;
			estimatedPos: { x: number; y: number; z: number };
			objectName: string;
			sceneId: string;
	  }
	| { type: "skill_generating"; objectId: string; objectName: string; sceneId: string; skillName: string }
	| { type: "skill_ready"; objectId: string; sceneId: string }
	| { type: "world_time_update"; sceneId: string; worldTime: number }
	| {
			type: "world_event";
			sceneId: string;
			eventId: string;
			worldTime: number;
			eventType: string;
			headline: string;
			body: string;
			worldNarrative?: string;
	  }
	| { type: "weather_overlay"; sceneId: string; overlayType: string; code?: string };

export class RealtimeBus {
	// sessionId → set of connected WebSocket clients
	private sockets = new Map<string, Set<WebSocket>>();

	subscribe(sessionId: string, ws: WebSocket): void {
		let clients = this.sockets.get(sessionId);
		if (!clients) {
			clients = new Set();
			this.sockets.set(sessionId, clients);
		}
		clients.add(ws);

		// Ping every 30s to keep the connection alive through Cloudflare tunnel (100s idle timeout).
		const pingInterval = setInterval(() => {
			if (ws.readyState === ws.OPEN) ws.ping();
		}, 30_000);

		ws.on("close", () => {
			clearInterval(pingInterval);
			clients!.delete(ws);
			if (clients!.size === 0) this.sockets.delete(sessionId);
		});
	}

	publish(sessionId: string, event: RealtimeEvent): void {
		const clients = this.sockets.get(sessionId);
		if (!clients || clients.size === 0) return;
		const payload = JSON.stringify(event);
		for (const ws of clients) {
			if (ws.readyState === ws.OPEN) {
				ws.send(payload);
			}
		}
	}

	hasSubscribers(sessionId: string): boolean {
		const clients = this.sockets.get(sessionId);
		return !!clients && clients.size > 0;
	}

	activeSessions(): string[] {
		return Array.from(this.sockets.keys());
	}
}
