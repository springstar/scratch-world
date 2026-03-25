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
	| { type: "error"; message: string };

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

		ws.on("close", () => {
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
}
