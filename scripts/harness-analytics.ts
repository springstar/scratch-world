#!/usr/bin/env tsx
/**
 * harness-analytics.ts
 *
 * Reads feedback.jsonl and dev.db to produce a structured quality report.
 * Run: npx tsx scripts/harness-analytics.ts
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ── Types ────────────────────────────────────────────────────────────────────

interface EvalChecks {
	skeleton: boolean;
	anchor: boolean;
	scale: boolean;
	lighting: boolean;
	placement: boolean;
	geometry: boolean;
	scatter: boolean;
	depth: boolean;
	characters: boolean;
	atmosphere: boolean;
}

interface EvalEntry {
	ts: number;
	source: "evaluate_scene";
	sceneId: string;
	sessionId: string;
	data: {
		checks: EvalChecks;
		issues: string[];
		passed: number;
		total: number;
	};
}

interface RejectionEntry {
	ts: number;
	source: "user_rejection";
	sceneId: string;
	sessionId: string;
	data: {
		text: string;
	};
}

type FeedbackEntry = EvalEntry | RejectionEntry;

// ── Load data ────────────────────────────────────────────────────────────────

function loadFeedback(): FeedbackEntry[] {
	const path = join(ROOT, "feedback.jsonl");
	return readFileSync(path, "utf-8")
		.split("\n")
		.filter((l) => l.trim().length > 0)
		.map((l) => JSON.parse(l) as FeedbackEntry);
}

function loadSceneTitles(): Map<string, string> {
	const map = new Map<string, string>();
	const dbPath = join(ROOT, "dev.db");
	try {
		const db = new Database(dbPath, { readonly: true });
		const rows = db.prepare("SELECT scene_id, title FROM scenes").all() as Array<{
			scene_id: string;
			title: string;
		}>;
		for (const row of rows) {
			map.set(row.scene_id, row.title);
		}
		db.close();
	} catch {
		// DB may be locked or unavailable — degrade gracefully
	}
	return map;
}

// ── Analysis ─────────────────────────────────────────────────────────────────

const CHECK_NAMES: (keyof EvalChecks)[] = [
	"skeleton",
	"anchor",
	"scale",
	"lighting",
	"placement",
	"geometry",
	"scatter",
	"depth",
	"characters",
	"atmosphere",
];

function analyzeChecks(evals: EvalEntry[]): Array<{ check: string; failRate: number; failed: number; total: number }> {
	const counts: Record<string, number> = {};
	for (const check of CHECK_NAMES) counts[check] = 0;

	for (const e of evals) {
		for (const check of CHECK_NAMES) {
			if (!e.data.checks[check]) counts[check]++;
		}
	}

	return CHECK_NAMES.map((check) => ({
		check,
		failed: counts[check],
		total: evals.length,
		failRate: evals.length > 0 ? counts[check] / evals.length : 0,
	})).sort((a, b) => b.failRate - a.failRate);
}

function scoreDistribution(evals: EvalEntry[]): Map<number, number> {
	const dist = new Map<number, number>();
	for (const e of evals) {
		const score = e.data.passed;
		dist.set(score, (dist.get(score) ?? 0) + 1);
	}
	return dist;
}

interface SceneStats {
	sceneId: string;
	title: string;
	evalScore: number | null;
	rejectionCount: number;
	issues: string[];
}

function perSceneStats(
	evals: EvalEntry[],
	rejections: RejectionEntry[],
	titles: Map<string, string>,
): SceneStats[] {
	const sceneMap = new Map<string, SceneStats>();

	// Seed from evals (keep highest-score eval per scene)
	for (const e of evals) {
		const existing = sceneMap.get(e.sceneId);
		if (!existing || e.data.passed > (existing.evalScore ?? -1)) {
			sceneMap.set(e.sceneId, {
				sceneId: e.sceneId,
				title: titles.get(e.sceneId) ?? e.sceneId.slice(0, 8),
				evalScore: e.data.passed,
				rejectionCount: existing?.rejectionCount ?? 0,
				issues: e.data.issues,
			});
		}
	}

	// Accumulate rejections
	for (const r of rejections) {
		const existing = sceneMap.get(r.sceneId);
		if (existing) {
			existing.rejectionCount++;
		} else {
			sceneMap.set(r.sceneId, {
				sceneId: r.sceneId,
				title: titles.get(r.sceneId) ?? r.sceneId.slice(0, 8),
				evalScore: null,
				rejectionCount: 1,
				issues: [],
			});
		}
	}

	return [...sceneMap.values()].sort((a, b) => {
		// Sort by rejections desc, then score asc (lower score = worse)
		if (b.rejectionCount !== a.rejectionCount) return b.rejectionCount - a.rejectionCount;
		const sa = a.evalScore ?? 10;
		const sb = b.evalScore ?? 10;
		return sa - sb;
	});
}

function topRejectionKeywords(rejections: RejectionEntry[]): Array<{ keyword: string; count: number }> {
	const KEYWORDS: string[] = [
		"重新生成", "几何体", "景深", "质感", "黑屏", "效果不好",
		"primitive", "black", "flat", "error", "wrong", "broken",
		"不好", "失败", "问题", "修复", "重建",
	];
	const counts: Record<string, number> = {};
	for (const r of rejections) {
		const text = r.data.text.toLowerCase();
		for (const kw of KEYWORDS) {
			if (text.includes(kw.toLowerCase())) {
				counts[kw] = (counts[kw] ?? 0) + 1;
			}
		}
	}
	return Object.entries(counts)
		.map(([keyword, count]) => ({ keyword, count }))
		.filter(({ count }) => count > 0)
		.sort((a, b) => b.count - a.count);
}

// ── Render ───────────────────────────────────────────────────────────────────

function pct(rate: number): string {
	return `${(rate * 100).toFixed(1)}%`;
}

function bar(rate: number, width = 20): string {
	const filled = Math.round(rate * width);
	return "█".repeat(filled) + "░".repeat(width - filled);
}

function printReport(
	evals: EvalEntry[],
	rejections: RejectionEntry[],
	titles: Map<string, string>,
): void {
	const LINE = "─".repeat(60);

	console.log();
	console.log("SCRATCH-WORLD QUALITY REPORT");
	console.log(`Data: ${evals.length} evaluations, ${rejections.length} user rejections`);
	console.log(LINE);

	// 1. Check failure rates
	console.log();
	console.log("CHECK FAILURE RATES (sorted by frequency)");
	console.log();
	const checkStats = analyzeChecks(evals);
	for (const { check, failRate, failed, total } of checkStats) {
		const label = check.padEnd(12);
		console.log(`  ${label} ${bar(failRate)}  ${pct(failRate)}  (${failed}/${total})`);
	}

	// 2. Score distribution
	console.log();
	console.log(LINE);
	console.log();
	console.log("SCORE DISTRIBUTION  (passes out of 10 checks)");
	console.log();
	const dist = scoreDistribution(evals);
	const maxCount = Math.max(...dist.values());
	for (let score = 10; score >= 0; score--) {
		const count = dist.get(score) ?? 0;
		if (count === 0 && score > 9) continue;
		const b = bar(maxCount > 0 ? count / maxCount : 0, 15);
		const marker = score >= 8 ? " ← PASS threshold" : "";
		console.log(`  ${String(score).padStart(2)}/10  ${b}  ×${count}${marker}`);
	}

	const avgScore = evals.length > 0
		? evals.reduce((s, e) => s + e.data.passed, 0) / evals.length
		: 0;
	console.log();
	console.log(`  Average score: ${avgScore.toFixed(2)}/10`);

	// 3. Per-scene breakdown
	console.log();
	console.log(LINE);
	console.log();
	console.log("TOP PROBLEM SCENES  (by rejection count)");
	console.log();
	const scenes = perSceneStats(evals, rejections, titles);
	const topScenes = scenes.slice(0, 10);
	for (const s of topScenes) {
		const scoreStr = s.evalScore !== null ? `${s.evalScore}/10` : " n/a";
		const title = s.title.length > 36 ? s.title.slice(0, 33) + "..." : s.title.padEnd(36);
		console.log(`  ${title}  score=${scoreStr}  rejections=${s.rejectionCount}`);
		if (s.issues.length > 0) {
			// Print first issue as a one-liner
			const issue = s.issues[0].slice(0, 80);
			console.log(`    └ ${issue}`);
		}
	}

	// 4. Rejection keywords
	console.log();
	console.log(LINE);
	console.log();
	console.log("TOP REJECTION KEYWORDS");
	console.log();
	const keywords = topRejectionKeywords(rejections);
	for (const { keyword, count } of keywords.slice(0, 10)) {
		const b = bar(count / rejections.length, 12);
		console.log(`  "${keyword}"  ${b}  ×${count}`);
	}

	// 5. Priority action items
	console.log();
	console.log(LINE);
	console.log();
	console.log("PRIORITY ACTION ITEMS  (checks failing >50%)");
	console.log();
	const critical = checkStats.filter((c) => c.failRate > 0.5);
	if (critical.length === 0) {
		console.log("  None — all checks below 50% failure rate.");
	} else {
		for (let i = 0; i < critical.length; i++) {
			console.log(`  ${i + 1}. [${critical[i].check}]  ${pct(critical[i].failRate)} failure`);
		}
	}

	console.log();
	console.log(LINE);
	console.log();
}

// ── Main ─────────────────────────────────────────────────────────────────────

const entries = loadFeedback();
const evals = entries.filter((e): e is EvalEntry => e.source === "evaluate_scene");
const rejections = entries.filter((e): e is RejectionEntry => e.source === "user_rejection");
const titles = loadSceneTitles();

printReport(evals, rejections, titles);
