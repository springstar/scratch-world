#!/usr/bin/env tsx
/**
 * harness-bench.ts
 *
 * Runs 25 benchmark prompts against the live server, waits for scene_created events,
 * validates each scene's sceneCode statically, and writes a structured result report.
 *
 * Usage:
 *   npx tsx scripts/harness-bench.ts [--prompts <file>] [--timeout <secs>]
 *   SERVER_URL=http://localhost:3000 SESSION_ID=bench:harness npx tsx scripts/harness-bench.ts
 *
 * Flags:
 *   --prompts <file>   Path to prompts JSON (default: scripts/benchmark-prompts.json)
 *   --timeout <secs>   Seconds to wait per scene (default: 120)
 *   --parallel <n>     Max concurrent scene generations (default: 1)
 *   --ids <a,b,...>    Only run prompts with these IDs (comma-separated)
 *
 * Prerequisites:
 *   - Server running at SERVER_URL (default http://localhost:3000)
 *   - ANTHROPIC_API_KEY set in environment
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { validateSceneCode } from "../src/agent/scene-validator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ── Config ────────────────────────────────────────────────────────────────────

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:3000";
const SESSION_ID = process.env.SESSION_ID ?? `bench:harness-${Date.now()}`;
const USER_ID = SESSION_ID.startsWith("bench:") ? SESSION_ID.slice(6) : SESSION_ID;

function parseArgs(): { promptsFile: string; timeoutSecs: number; parallel: number; ids: string[] | null } {
	const args = process.argv.slice(2);
	let promptsFile = join(__dirname, "benchmark-prompts.json");
	let timeoutSecs = 120;
	let parallel = 1;
	let ids: string[] | null = null;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--prompts" && args[i + 1]) promptsFile = args[++i];
		if (args[i] === "--timeout" && args[i + 1]) timeoutSecs = parseInt(args[++i], 10);
		if (args[i] === "--parallel" && args[i + 1]) parallel = parseInt(args[++i], 10);
		if (args[i] === "--ids" && args[i + 1]) ids = args[++i].split(",");
	}

	return { promptsFile, timeoutSecs, parallel, ids };
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface BenchPrompt {
	id: string;
	prompt: string;
	category: string;
	expect_checks: string[];
}

interface BenchResult {
	id: string;
	prompt: string;
	category: string;
	expect_checks: string[];
	status: "ok" | "timeout" | "error";
	sceneId: string | null;
	title: string | null;
	viewUrl: string | null;
	durationMs: number;
	static_validation: {
		valid: boolean;
		error_count: number;
		warning_count: number;
		violations: Array<{ rule: string; severity: string; message: string }>;
	} | null;
	error: string | null;
}

interface BenchReport {
	runId: string;
	startedAt: string;
	durationMs: number;
	serverUrl: string;
	sessionId: string;
	total: number;
	ok: number;
	timeout: number;
	errors: number;
	static_pass_rate: number;
	results: BenchResult[];
}

// ── WebSocket listener ────────────────────────────────────────────────────────

type RealtimeEvent =
	| { type: "text_delta"; delta: string }
	| { type: "text_done"; text: string }
	| { type: "scene_created"; sceneId: string; title: string; viewUrl: string }
	| { type: "scene_updated"; sceneId: string; version: number }
	| { type: "error"; message: string };

function wsUrl(baseUrl: string, sessionId: string): string {
	const u = new URL(baseUrl);
	u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
	u.pathname = `/realtime/${sessionId}`;
	return u.toString();
}

function waitForSceneCreated(
	sessionId: string,
	timeoutMs: number,
): Promise<{ sceneId: string; title: string; viewUrl: string }> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(wsUrl(SERVER_URL, sessionId));
		let settled = false;
		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				ws.close();
				reject(new Error("timeout"));
			}
		}, timeoutMs);

		ws.on("message", (data) => {
			try {
				const event = JSON.parse(data.toString()) as RealtimeEvent;
				if (event.type === "scene_created" && !settled) {
					settled = true;
					clearTimeout(timer);
					ws.close();
					resolve({ sceneId: event.sceneId, title: event.title, viewUrl: event.viewUrl });
				}
				if (event.type === "error" && !settled) {
					settled = true;
					clearTimeout(timer);
					ws.close();
					reject(new Error(event.message));
				}
			} catch {
				// ignore parse errors
			}
		});

		ws.on("error", (err) => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				reject(new Error(`WebSocket error: ${err.message}`));
			}
		});

		ws.on("close", (code) => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				reject(new Error(`WebSocket closed with code ${code}`));
			}
		});
	});
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function postChat(text: string): Promise<void> {
	const res = await fetch(`${SERVER_URL}/api/chat`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			sessionId: SESSION_ID,
			userId: USER_ID,
			text,
		}),
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`POST /api/chat failed ${res.status}: ${body.slice(0, 200)}`);
	}
}

interface SceneResponse {
	sceneId: string;
	title: string;
	sceneData?: { sceneCode?: string };
}

async function fetchScene(sceneId: string): Promise<SceneResponse | null> {
	const res = await fetch(`${SERVER_URL}/api/scenes/${sceneId}?session=${SESSION_ID}`);
	if (!res.ok) return null;
	return (await res.json()) as SceneResponse;
}

// ── Run single prompt ─────────────────────────────────────────────────────────

async function runPrompt(bp: BenchPrompt, timeoutSecs: number): Promise<BenchResult> {
	const start = Date.now();
	const result: BenchResult = {
		id: bp.id,
		prompt: bp.prompt,
		category: bp.category,
		expect_checks: bp.expect_checks,
		status: "ok",
		sceneId: null,
		title: null,
		viewUrl: null,
		durationMs: 0,
		static_validation: null,
		error: null,
	};

	try {
		// Start listening before posting chat (race-free ordering)
		const wsPromise = waitForSceneCreated(SESSION_ID, timeoutSecs * 1000);
		await postChat(bp.prompt);
		const created = await wsPromise;

		result.sceneId = created.sceneId;
		result.title = created.title;
		result.viewUrl = created.viewUrl;

		// Fetch scene and run static validation
		const scene = await fetchScene(created.sceneId);
		const sceneCode = scene?.sceneData?.sceneCode ?? null;

		if (sceneCode) {
			const vResult = validateSceneCode(sceneCode, { skipAssetPrescan: true });
			result.static_validation = {
				valid: vResult.valid,
				error_count: vResult.violations.filter((v) => v.severity === "error").length,
				warning_count: vResult.violations.filter((v) => v.severity === "warning").length,
				violations: vResult.violations.map((v) => ({
					rule: v.rule,
					severity: v.severity,
					message: v.message.slice(0, 120),
				})),
			};
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg === "timeout") {
			result.status = "timeout";
		} else {
			result.status = "error";
			result.error = msg;
		}
	}

	result.durationMs = Date.now() - start;
	return result;
}

// ── Report ────────────────────────────────────────────────────────────────────

const CHECK_NAMES = ["skeleton", "anchor", "scale", "lighting", "placement", "geometry", "scatter", "depth", "characters", "atmosphere"];

function printSummary(report: BenchReport): void {
	const LINE = "─".repeat(60);
	console.log();
	console.log("BENCHMARK REPORT");
	console.log(`Run: ${report.runId}  Server: ${report.serverUrl}`);
	console.log(`Scenes: ${report.total}  OK: ${report.ok}  Timeout: ${report.timeout}  Error: ${report.errors}`);
	console.log(`Duration: ${(report.durationMs / 1000).toFixed(1)}s`);
	console.log(LINE);
	console.log();

	// Per-result table
	console.log("RESULTS");
	console.log();
	for (const r of report.results) {
		const statusIcon = r.status === "ok" ? "✓" : r.status === "timeout" ? "⏱" : "✗";
		const validStr = r.static_validation
			? `E=${r.static_validation.error_count} W=${r.static_validation.warning_count}`
			: "no-code";
		const title = (r.title ?? r.id).slice(0, 30).padEnd(30);
		const dur = `${(r.durationMs / 1000).toFixed(1)}s`;
		console.log(`  ${statusIcon} ${title} ${dur.padStart(7)}  ${validStr}`);
		if (r.static_validation?.violations.length) {
			for (const v of r.static_validation.violations) {
				const icon = v.severity === "error" ? "[E]" : "[W]";
				console.log(`      ${icon} ${v.rule}`);
			}
		}
		if (r.error) {
			console.log(`      err: ${r.error}`);
		}
	}

	console.log();
	console.log(LINE);
	console.log();

	// Violation frequency table
	const ruleCounts: Record<string, number> = {};
	let scenesWithCode = 0;
	for (const r of report.results) {
		if (!r.static_validation) continue;
		scenesWithCode++;
		for (const v of r.static_validation.violations) {
			ruleCounts[v.rule] = (ruleCounts[v.rule] ?? 0) + 1;
		}
	}

	if (Object.keys(ruleCounts).length > 0) {
		console.log("VIOLATION FREQUENCY");
		console.log();
		const sorted = Object.entries(ruleCounts).sort((a, b) => b[1] - a[1]);
		for (const [rule, count] of sorted) {
			const pct = scenesWithCode > 0 ? ((count / scenesWithCode) * 100).toFixed(0) : "0";
			console.log(`  ${rule.padEnd(36)} ×${count}  (${pct}%)`);
		}
		console.log();
	}

	// View URLs for manual inspection
	const okResults = report.results.filter((r) => r.status === "ok" && r.viewUrl);
	if (okResults.length > 0) {
		console.log("VIEW URLS (open in browser for visual inspection)");
		console.log();
		for (const r of okResults) {
			console.log(`  [${r.id}]  ${r.viewUrl}`);
		}
		console.log();
	}

	console.log(LINE);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const { promptsFile, timeoutSecs, parallel, ids } = parseArgs();
	const runId = `bench-${Date.now()}`;
	const startedAt = new Date().toISOString();
	const overallStart = Date.now();

	// Load prompts
	let prompts: BenchPrompt[] = JSON.parse(readFileSync(promptsFile, "utf-8")) as BenchPrompt[];
	if (ids) {
		prompts = prompts.filter((p) => ids.includes(p.id));
		if (prompts.length === 0) {
			console.error(`No prompts matched IDs: ${ids.join(", ")}`);
			process.exit(1);
		}
	}

	// Check server reachability
	try {
		const probe = await fetch(`${SERVER_URL}/api/health`);
		if (!probe.ok && probe.status !== 404) throw new Error(`${probe.status}`);
	} catch (err) {
		console.error(`Server unreachable at ${SERVER_URL}: ${String(err)}`);
		console.error("Start the server with: npm run dev");
		process.exit(1);
	}

	console.log(`Running ${prompts.length} benchmarks against ${SERVER_URL}  (timeout=${timeoutSecs}s, parallel=${parallel})`);
	console.log(`Session: ${SESSION_ID}`);
	console.log();

	const results: BenchResult[] = [];

	// Run in batches to respect parallelism limit
	for (let i = 0; i < prompts.length; i += parallel) {
		const batch = prompts.slice(i, i + parallel);
		const batchNum = Math.floor(i / parallel) + 1;
		const totalBatches = Math.ceil(prompts.length / parallel);
		console.log(`[${batchNum}/${totalBatches}] ${batch.map((p) => p.id).join(", ")}`);

		const batchResults = await Promise.all(batch.map((p) => runPrompt(p, timeoutSecs)));
		for (const r of batchResults) {
			const statusStr = r.status === "ok" ? `ok  (${(r.durationMs / 1000).toFixed(1)}s)` : r.status;
			console.log(`  ${r.id}: ${statusStr}`);
			results.push(r);
		}
	}

	const ok = results.filter((r) => r.status === "ok").length;
	const timedOut = results.filter((r) => r.status === "timeout").length;
	const errors = results.filter((r) => r.status === "error").length;

	const scenesWithCode = results.filter((r) => r.static_validation !== null);
	const staticPassRate =
		scenesWithCode.length > 0
			? scenesWithCode.filter((r) => r.static_validation!.valid).length / scenesWithCode.length
			: 0;

	const report: BenchReport = {
		runId,
		startedAt,
		durationMs: Date.now() - overallStart,
		serverUrl: SERVER_URL,
		sessionId: SESSION_ID,
		total: results.length,
		ok,
		timeout: timedOut,
		errors,
		static_pass_rate: staticPassRate,
		results,
	};

	printSummary(report);

	// Save JSON report
	const resultsDir = join(ROOT, "test", "harness", "results");
	mkdirSync(resultsDir, { recursive: true });
	const reportPath = join(resultsDir, `${runId}.json`);
	writeFileSync(reportPath, JSON.stringify(report, null, 2));
	console.log(`Report saved: ${reportPath}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
