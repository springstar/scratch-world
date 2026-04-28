import { access } from "node:fs/promises";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type Database from "better-sqlite3";
import { Hono } from "hono";
import type { IncomingMessage } from "http";
import { WebSocketServer } from "ws";
import { getRecentLogs } from "../logger.js";
import type { NarratorRegistry } from "../narrators/narrator-registry.js";
import { startNpcHeartbeat, startNpcStagnationChecker } from "../npcs/npc-heartbeat.js";
import type { SceneProviderRegistry } from "../providers/scene-provider-registry.js";
import type { SceneManager } from "../scene/scene-manager.js";
import type { SessionManager } from "../session/session-manager.js";
import type { SkillLoader } from "../skills/skill-loader.js";
import type { GeneCandidateRepository, NpcEvolutionRepository, WorldEventRepository } from "../storage/types.js";
import { catchUpWorldTime, startWorldHeartbeat, tickSceneOnce } from "../world/world-heartbeat.js";
import { rateLimit } from "./rate-limit.js";
import { RealtimeBus } from "./realtime.js";
import { chatRoute } from "./routes/chat.js";
import { colliderProxyRoute } from "./routes/collider-proxy.js";
import { confirmPositionRoute } from "./routes/confirm-position.js";
import { generatorsRoute } from "./routes/generators.js";
import { gltfProxyRoute } from "./routes/gltf-proxy.js";
import { interactRoute } from "./routes/interact.js";
import { mediaUploadRoute } from "./routes/media-upload.js";
import { npcGreetRoute } from "./routes/npc-greet.js";
import { npcInteractRoute } from "./routes/npc-interact.js";
import { scenesRoute } from "./routes/scenes.js";
import { screenshotsRoute } from "./routes/screenshots.js";
import { splatProxyRoute } from "./routes/splat-proxy.js";
import { createUserAssetsTable, userAssetsRoute } from "./routes/user-assets.js";

export interface ViewerApiOptions {
	port: number;
	db?: Database.Database | null;
	sceneManager: SceneManager;
	sessionManager: SessionManager;
	skillLoader: SkillLoader;
	providerRegistryRef: { current: SceneProviderRegistry };
	narratorRegistryRef: { current: NarratorRegistry };
	projectRoot: string;
	marbleApiKey?: string;
	publicUploadsUrl?: string;
	/** Pre-created bus shared with GenerationQueue. If omitted, a new bus is created. */
	bus?: RealtimeBus;
	/** Optional world event store for Living Worlds event generation. */
	worldEventRepo?: WorldEventRepository;
	/** Optional NPC evolution audit log store. */
	npcEvolutionRepo?: NpcEvolutionRepository;
	/** Optional Gene candidate store for auto-growth. */
	geneCandidateRepo?: GeneCandidateRepository;
}

export interface ViewerApiServer {
	bus: RealtimeBus;
	close(): Promise<void>;
}

export function startViewerApi(opts: ViewerApiOptions): ViewerApiServer {
	const {
		port,
		db = null,
		sceneManager,
		sessionManager,
		skillLoader,
		providerRegistryRef,
		narratorRegistryRef,
		projectRoot,
		marbleApiKey,
		publicUploadsUrl = `http://localhost:${opts.port}`,
		worldEventRepo,
		npcEvolutionRepo,
	} = opts;
	const bus = opts.bus ?? new RealtimeBus();

	// Ensure user_assets table exists
	createUserAssetsTable(db);

	const app = new Hono();

	// CORS — viewer app may be served from a different origin
	app.use("*", async (c, next) => {
		await next();
		c.res.headers.set("Access-Control-Allow-Origin", "*");
		c.res.headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
		c.res.headers.set("Access-Control-Allow-Headers", "Content-Type");
	});

	app.options("*", (c) => c.body(null, 204));

	// Static file serving for uploaded panoramas and locally-cached splats.
	// Rigged-model fallback: if a rigged GLB is missing (e.g. Blender not installed),
	// redirect to the original unrigged file in uploads/generated/.
	app.get("/uploads/rigged/:filename", async (c, next) => {
		const filename = c.req.param("filename");
		const riggedPath = join(projectRoot, "uploads", "rigged", filename);
		try {
			await access(riggedPath);
			// File exists — let the static middleware handle it
			return next();
		} catch {
			// File missing — redirect to unrigged equivalent
			const unrigged = filename.replace(/_rigged\.glb$/, ".glb");
			return c.redirect(`/uploads/generated/${unrigged}`, 302);
		}
	});
	app.use("/uploads/*", serveStatic({ root: projectRoot }));

	app.route(
		"/scenes",
		scenesRoute(sceneManager, projectRoot, bus, sessionManager, worldEventRepo, publicUploadsUrl, npcEvolutionRepo),
	);
	app.route("/screenshots", screenshotsRoute);
	app.use("/interact/*", rateLimit(30, 60_000, "interact"));
	app.route("/interact", interactRoute(sessionManager, sceneManager, bus));
	app.route("/npc-interact", npcInteractRoute(sceneManager, bus, worldEventRepo, npcEvolutionRepo));
	app.route("/npc-greet", npcGreetRoute(sceneManager, bus));
	app.use("/chat/*", rateLimit(20, 60_000, "chat"));
	app.route("/chat", chatRoute(sessionManager, bus));
	// Bulletin board posts: 5 per IP per 5 minutes
	app.use("/scenes/*/objects/*/messages", rateLimit(5, 5 * 60_000, "bulletin"));
	app.route("/splat", splatProxyRoute(sceneManager, marbleApiKey));
	app.route("/collider", colliderProxyRoute(sceneManager, marbleApiKey));
	app.route("/gltf-proxy", gltfProxyRoute());
	app.route("/confirm-position", confirmPositionRoute());
	app.route("/user-assets", userAssetsRoute(db, projectRoot));
	app.route("/media-upload", mediaUploadRoute(projectRoot, publicUploadsUrl));

	app.get("/health", (c) => c.json({ ok: true }));

	// Admin tick endpoint — forces a single worldHeartbeat tick for a specific scene.
	// Requires X-Admin-Secret header matching ADMIN_SECRET env var.
	// Usage: POST /admin/scenes/:id/tick
	app.post("/admin/scenes/:id/tick", async (c) => {
		const adminSecret = process.env.ADMIN_SECRET;
		if (!adminSecret) return c.json({ error: "ADMIN_SECRET not configured" }, 403);
		if (c.req.header("x-admin-secret") !== adminSecret) return c.json({ error: "Unauthorized" }, 403);

		const sceneId = c.req.param("id");
		try {
			const result = await tickSceneOnce(sceneId, sceneManager, bus, worldEventRepo);
			return c.json({ ok: true, sceneId, ...result });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return c.json({ error: msg }, 404);
		}
	});

	// Debug log viewer — returns the last N structured log entries from the in-memory ring buffer.
	// Usage: GET /debug/logs?limit=100
	app.get("/debug/logs", (c) => {
		const limit = Math.min(Number(c.req.query("limit") ?? 200), 500);
		return c.json({ logs: getRecentLogs(limit) });
	});

	// Ops signal query — returns all sessions with detected chat signals.
	// Usage: GET /debug/signals  (requires X-Admin-Secret)
	app.get("/debug/signals", async (c) => {
		const adminSecret = process.env.ADMIN_SECRET;
		if (!adminSecret) return c.json({ error: "ADMIN_SECRET not configured" }, 403);
		if (c.req.header("x-admin-secret") !== adminSecret) return c.json({ error: "Unauthorized" }, 403);
		const data = await sessionManager.listSignals();
		return c.json({ sessions: data });
	});

	// Gene candidate admin endpoints
	const { geneCandidateRepo } = opts;

	app.get("/admin/gene-candidates", async (c) => {
		const adminSecret = process.env.ADMIN_SECRET;
		if (!adminSecret) return c.json({ error: "ADMIN_SECRET not configured" }, 403);
		if (c.req.header("x-admin-secret") !== adminSecret) return c.json({ error: "Unauthorized" }, 403);
		if (!geneCandidateRepo) return c.json({ error: "Gene candidate repo not configured" }, 503);
		const status = c.req.query("status");
		const filter =
			status === "pending" ? { validated: false } : status === "approved" ? { validated: true } : undefined;
		const candidates = await geneCandidateRepo.list(filter);
		return c.json({ candidates });
	});

	app.post("/admin/gene-candidates/:id/approve", async (c) => {
		const adminSecret = process.env.ADMIN_SECRET;
		if (!adminSecret) return c.json({ error: "ADMIN_SECRET not configured" }, 403);
		if (c.req.header("x-admin-secret") !== adminSecret) return c.json({ error: "Unauthorized" }, 403);
		if (!geneCandidateRepo) return c.json({ error: "Gene candidate repo not configured" }, 503);
		await geneCandidateRepo.approve(c.req.param("id"));
		return c.json({ ok: true });
	});

	app.delete("/admin/gene-candidates/:id", async (c) => {
		const adminSecret = process.env.ADMIN_SECRET;
		if (!adminSecret) return c.json({ error: "ADMIN_SECRET not configured" }, 403);
		if (c.req.header("x-admin-secret") !== adminSecret) return c.json({ error: "Unauthorized" }, 403);
		if (!geneCandidateRepo) return c.json({ error: "Gene candidate repo not configured" }, 503);
		await geneCandidateRepo.remove(c.req.param("id"));
		return c.json({ ok: true });
	});

	// Admin dashboard — simple HTML page for testing Living Worlds and scene management.
	app.get("/admin", (c) => c.html(ADMIN_HTML));

	app.route("/", generatorsRoute(providerRegistryRef, narratorRegistryRef, skillLoader));

	// Start HTTP server
	const server = serve({ fetch: app.fetch, port }, () => {
		console.log(`Viewer API listening on http://localhost:${port}`);
	});

	// Attach WebSocket server to the same HTTP server
	// WS endpoint: ws://host/realtime/:sessionId
	const wss = new WebSocketServer({ noServer: true });

	server.on("upgrade", (req: IncomingMessage, socket, head) => {
		const url = new URL(req.url ?? "/", `http://localhost`);
		const match = url.pathname.match(/^\/realtime\/(.+)$/);
		if (!match) {
			socket.destroy();
			return;
		}
		const sessionId = decodeURIComponent(match[1]);
		wss.handleUpgrade(req, socket, head, (ws) => {
			bus.subscribe(sessionId, ws);
			ws.send(JSON.stringify({ type: "connected", sessionId }));
		});
	});

	// Start NPC world heartbeat — fire spontaneous NPC speech for active sessions
	const stopNpcHeartbeat = startNpcHeartbeat(sceneManager, bus, worldEventRepo);
	// Start NPC stagnation checker — repair/farewell for long-idle NPCs (hourly)
	const stopNpcStagnation = startNpcStagnationChecker(sceneManager, bus, worldEventRepo, npcEvolutionRepo);
	// Catchup worldTime for scenes that evolved while server was offline (no API calls)
	catchUpWorldTime(sceneManager).catch(console.error);
	// Start world evolution heartbeat — advance worldTime for living scenes
	const stopWorldHeartbeat = startWorldHeartbeat(sceneManager, bus, worldEventRepo);

	return {
		bus,
		close: () =>
			new Promise((resolve, reject) => {
				stopNpcHeartbeat();
				stopNpcStagnation();
				stopWorldHeartbeat();
				wss.close((err) => {
					if (err) reject(err);
					else resolve();
				});
			}),
	};
}

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>scratch-world admin</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font: 14px/1.5 system-ui, sans-serif; background: #0f0f13; color: #ccc; padding: 16px; }
  h1 { font-size: 18px; color: #eee; margin-bottom: 16px; }
  h2 { font-size: 14px; color: #aaa; margin: 20px 0 8px; text-transform: uppercase; letter-spacing: .5px; }
  .row { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
  input[type=text], input[type=password] {
    background: #1a1a22; border: 1px solid #333; color: #eee; padding: 6px 10px;
    border-radius: 4px; font-size: 13px; flex: 1;
  }
  button {
    background: #2a2a3a; border: 1px solid #444; color: #ddd; padding: 6px 14px;
    border-radius: 4px; font-size: 12px; cursor: pointer; white-space: nowrap;
  }
  button:hover { background: #3a3a50; }
  button.primary { background: #2d4a7a; border-color: #4a6aaa; color: #aad; }
  button.primary:hover { background: #3a5a8a; }
  button.danger { background: #4a1a1a; border-color: #7a2a2a; color: #daa; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; color: #777; padding: 6px 8px; border-bottom: 1px solid #222; }
  td { padding: 6px 8px; border-bottom: 1px solid #1a1a22; vertical-align: middle; }
  tr:hover td { background: #15151e; }
  .tag { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; }
  .tag.live { background: #1a3a1a; color: #6c6; border: 1px solid #2a4a2a; }
  .tag.static { background: #2a2a2a; color: #777; border: 1px solid #333; }
  .events { font-size: 11px; color: #888; margin-top: 4px; line-height: 1.6; }
  .log { font-family: monospace; font-size: 11px; background: #0a0a10; border: 1px solid #222;
         border-radius: 4px; padding: 10px; max-height: 300px; overflow-y: auto; color: #9a9; }
  .status { font-size: 12px; color: #666; min-width: 200px; }
  .wt { font-family: monospace; color: #bb9; }
  .visits { color: #778; }
  #msg { color: #9c9; font-size: 12px; min-height: 18px; }
</style>
</head>
<body>
<h1>scratch-world / admin</h1>
<div class="row">
  <input id="secret" type="password" placeholder="ADMIN_SECRET" />
  <button class="primary" onclick="load()">Load scenes</button>
  <span id="msg"></span>
</div>
<div id="body"></div>

<script>
const $ = id => document.getElementById(id);
function secret() { return $('secret').value.trim(); }
function msg(t, err) { $('msg').textContent = t; $('msg').style.color = err ? '#c66' : '#9c9'; }
function fmtTime(s) {
  if (s == null) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h.toString().padStart(2,'0') + ':' + m.toString().padStart(2,'0');
}

async function api(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': secret() },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return r.json();
}

async function load(statusMsg) {
  const data = await fetch('/scenes').then(r => r.json()).catch(() => null);
  if (!data || !data.scenes) { msg('Failed to load scenes', true); return; }
  renderScenes(data.scenes);
  if (statusMsg) msg(statusMsg);
}

async function tick(id, btn) {
  btn.disabled = true; btn.textContent = '…';
  const r = await api('POST', '/admin/scenes/' + id + '/tick');
  btn.disabled = false; btn.textContent = 'Tick';
  const tickMsg = r.error
    ? null
    : 'Ticked: worldTime=' + fmtTime(r.worldTime) + (r.eventGenerated ? ' + event generated' : '');
  if (r.error) msg(r.error, true);
  await load(tickMsg);
}

async function loadEvents(id, td) {
  const r = await fetch('/scenes/' + id + '/events?limit=5').then(x => x.json()).catch(() => ({}));
  if (!r.events || r.events.length === 0) { td.innerHTML = '<em style="color:#555">no events</em>'; return; }
  td.innerHTML = r.events.map(e =>
    '<div>' + fmtTime(e.worldTime) + ' <b style="color:#bb8">' + e.eventType + '</b> ' + e.headline + '</div>'
  ).join('');
}

async function loadLogs() {
  const r = await fetch('/debug/logs?limit=80').then(x => x.json()).catch(() => ({}));
  if (!r.logs) { msg('No logs', true); return; }
  $('logbox').textContent = r.logs.map(l =>
    '[' + new Date(l.ts).toISOString().slice(11,19) + '] ' + l.level + ' ' + JSON.stringify(l.msg ?? l)
  ).join('\\n');
}

function renderScenes(scenes) {
  let html = '<h2>Scenes (' + scenes.length + ')</h2>';
  html += '<table><thead><tr><th>Title</th><th>worldTime</th><th>Visits</th><th>Status</th><th>Actions</th><th>Recent Events</th></tr></thead><tbody>';
  for (const s of scenes) {
    const living = !!s.livingEnabled;
    const wt = fmtTime(s.worldTime);
    const visits = s.visitCount ?? 0;
    const tag = living
      ? '<span class="tag live">living</span>'
      : '<span class="tag static">static</span>';
    html += '<tr>';
    html += '<td><a href="/?scene=' + s.sceneId + '" target="_blank" style="color:#9ab">' + (s.title || s.sceneId) + '</a></td>';
    html += '<td class="wt">' + wt + '</td>';
    html += '<td class="visits">' + visits + '</td>';
    html += '<td>' + tag + '</td>';
    html += '<td><button onclick="tick(\\'' + s.sceneId + '\\',this)">Tick</button></td>';
    html += '<td class="events" id="ev-' + s.sceneId + '"><em style="color:#555">—</em></td>';
    html += '</tr>';
  }
  html += '</tbody></table>';
  html += '<h2>Recent Logs</h2>';
  html += '<div class="row"><button onclick="loadLogs()">Load logs</button></div>';
  html += '<div class="log" id="logbox">Click "Load logs"</div>';
  $('body').innerHTML = html;
  for (const s of scenes) {
    if (s.livingEnabled) {
      loadEvents(s.sceneId, document.getElementById('ev-' + s.sceneId));
    }
  }
}

$('secret').addEventListener('keydown', e => { if (e.key === 'Enter') load(null); });
</script>
</body>
</html>`;
