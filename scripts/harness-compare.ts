#!/usr/bin/env tsx
/**
 * harness-compare.ts
 *
 * Compares two benchmark runs to detect regressions.
 * Reads JSON reports from test/harness/results/ and diffs violation rates.
 *
 * Usage:
 *   npx tsx scripts/harness-compare.ts                         # compare two most recent runs
 *   npx tsx scripts/harness-compare.ts <baseline> <current>   # explicit run IDs or file paths
 *   npx tsx scripts/harness-compare.ts --baseline             # save current latest as baseline
 *
 * Flags:
 *   --baseline        Save the most recent run as the named baseline "baseline.json"
 *   --threshold <n>   Regression threshold % (default 15). Exits non-zero if exceeded.
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RESULTS_DIR = join(ROOT, "test", "harness", "results");

// ── Types ─────────────────────────────────────────────────────────────────────

interface BenchResult {
	id: string;
	category: string;
	status: "ok" | "timeout" | "error";
	static_validation: {
		valid: boolean;
		error_count: number;
		warning_count: number;
		violations: Array<{ rule: string; severity: string }>;
	} | null;
}

interface BenchReport {
	runId: string;
	startedAt: string;
	total: number;
	ok: number;
	static_pass_rate: number;
	results: BenchResult[];
}

// ── Load ──────────────────────────────────────────────────────────────────────

function loadReport(pathOrId: string): BenchReport {
	// If it's a full path, use it directly; otherwise look in results dir
	const filePath = pathOrId.endsWith(".json")
		? pathOrId
		: join(RESULTS_DIR, pathOrId.endsWith(".json") ? pathOrId : `${pathOrId}.json`);
	return JSON.parse(readFileSync(filePath, "utf-8")) as BenchReport;
}

function findLatestReports(count: number): string[] {
	const files = readdirSync(RESULTS_DIR)
		.filter((f) => f.startsWith("bench-") && f.endsWith(".json"))
		.sort()
		.reverse()
		.slice(0, count);
	return files.map((f) => join(RESULTS_DIR, f));
}

// ── Stats ─────────────────────────────────────────────────────────────────────

interface RuleStats {
	rule: string;
	count: number;
	rate: number; // fraction of scenes (0-1)
}

function ruleStats(report: BenchReport): Map<string, RuleStats> {
	const counts = new Map<string, number>();
	let total = 0;
	for (const r of report.results) {
		if (!r.static_validation) continue;
		total++;
		for (const v of r.static_validation.violations) {
			counts.set(v.rule, (counts.get(v.rule) ?? 0) + 1);
		}
	}
	const result = new Map<string, RuleStats>();
	for (const [rule, count] of counts) {
		result.set(rule, { rule, count, rate: total > 0 ? count / total : 0 });
	}
	return result;
}

function successRate(report: BenchReport): number {
	return report.total > 0 ? report.ok / report.total : 0;
}

// ── Compare ───────────────────────────────────────────────────────────────────

interface RuleDiff {
	rule: string;
	baselineRate: number;
	currentRate: number;
	delta: number; // positive = regression, negative = improvement
}

function compareReports(
	baseline: BenchReport,
	current: BenchReport,
): { diffs: RuleDiff[]; successDelta: number; passRateDelta: number } {
	const bStats = ruleStats(baseline);
	const cStats = ruleStats(current);
	const allRules = new Set([...bStats.keys(), ...cStats.keys()]);

	const diffs: RuleDiff[] = [];
	for (const rule of allRules) {
		const baselineRate = bStats.get(rule)?.rate ?? 0;
		const currentRate = cStats.get(rule)?.rate ?? 0;
		const delta = currentRate - baselineRate;
		diffs.push({ rule, baselineRate, currentRate, delta });
	}
	diffs.sort((a, b) => b.delta - a.delta); // worst regressions first

	return {
		diffs,
		successDelta: successRate(current) - successRate(baseline),
		passRateDelta: current.static_pass_rate - baseline.static_pass_rate,
	};
}

// ── Render ────────────────────────────────────────────────────────────────────

function pct(rate: number): string {
	return `${(rate * 100).toFixed(1)}%`;
}

function sign(n: number): string {
	return n >= 0 ? `+${(n * 100).toFixed(1)}%` : `${(n * 100).toFixed(1)}%`;
}

function printCompare(
	baseline: BenchReport,
	current: BenchReport,
	regressionThreshold: number,
): boolean {
	const { diffs, successDelta, passRateDelta } = compareReports(baseline, current);
	const LINE = "─".repeat(60);

	console.log();
	console.log("REGRESSION REPORT");
	console.log(`Baseline: ${baseline.runId}  (${baseline.startedAt})`);
	console.log(`Current:  ${current.runId}  (${current.startedAt})`);
	console.log(LINE);
	console.log();

	// High-level metrics
	console.log("HIGH-LEVEL METRICS");
	console.log();
	const successIcon = successDelta < -0.05 ? "↓" : successDelta > 0.05 ? "↑" : "─";
	const passIcon = passRateDelta < -0.05 ? "↓" : passRateDelta > 0.05 ? "↑" : "─";
	console.log(
		`  Generation success rate:  ${pct(successRate(baseline))} → ${pct(successRate(current))}  ${successIcon} ${sign(successDelta)}`,
	);
	console.log(
		`  Static validation pass:   ${pct(baseline.static_pass_rate)} → ${pct(current.static_pass_rate)}  ${passIcon} ${sign(passRateDelta)}`,
	);

	// Rule-level diffs
	console.log();
	console.log(LINE);
	console.log();

	const regressions = diffs.filter((d) => d.delta > 0.01);
	const improvements = diffs.filter((d) => d.delta < -0.01);
	const unchanged = diffs.filter((d) => Math.abs(d.delta) <= 0.01);

	if (regressions.length > 0) {
		console.log("REGRESSIONS  (violation rate increased)");
		console.log();
		for (const d of regressions) {
			const icon = d.delta > 0.15 ? "!!" : d.delta > 0.05 ? " !" : "  ";
			console.log(`  ${icon} ${d.rule.padEnd(36)} ${pct(d.baselineRate)} → ${pct(d.currentRate)}  (${sign(d.delta)})`);
		}
		console.log();
	}

	if (improvements.length > 0) {
		console.log("IMPROVEMENTS  (violation rate decreased)");
		console.log();
		for (const d of improvements) {
			console.log(`     ${d.rule.padEnd(36)} ${pct(d.baselineRate)} → ${pct(d.currentRate)}  (${sign(d.delta)})`);
		}
		console.log();
	}

	if (unchanged.length > 0) {
		const rules = unchanged.map((d) => d.rule).join(", ");
		console.log(`Unchanged: ${rules}`);
		console.log();
	}

	console.log(LINE);
	console.log();

	// Regression gate check
	const maxRegression = regressions.length > 0 ? Math.max(...regressions.map((d) => d.delta)) : 0;
	const exceeded = maxRegression > regressionThreshold / 100;

	if (exceeded) {
		console.log(
			`REGRESSION GATE FAILED — worst regression ${pct(maxRegression)} exceeds threshold ${pct(regressionThreshold / 100)}`,
		);
		console.log();
	} else if (regressions.length === 0) {
		console.log("REGRESSION GATE PASSED — no regressions detected.");
		console.log();
	} else {
		console.log(
			`REGRESSION GATE PASSED — regressions below threshold (worst: ${pct(maxRegression)} < ${pct(regressionThreshold / 100)})`,
		);
		console.log();
	}

	return exceeded;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
	const args = process.argv.slice(2);

	// --baseline mode: save latest run as baseline.json
	if (args.includes("--baseline")) {
		const latest = findLatestReports(1);
		if (latest.length === 0) {
			console.error("No benchmark runs found in test/harness/results/");
			process.exit(1);
		}
		const baselinePath = join(RESULTS_DIR, "baseline.json");
		const latestData = readFileSync(latest[0]);
		writeFileSync(baselinePath, latestData);
		const report = JSON.parse(latestData.toString()) as BenchReport;
		console.log(`Baseline saved: ${baselinePath}  (run: ${report.runId})`);
		return;
	}

	// Normal compare mode
	let thresholdStr = "15";
	const positionalArgs: string[] = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--threshold" && args[i + 1]) {
			thresholdStr = args[++i];
		} else if (!args[i].startsWith("--")) {
			positionalArgs.push(args[i]);
		}
	}
	const threshold = parseFloat(thresholdStr);

	let baselinePath: string;
	let currentPath: string;

	if (positionalArgs.length >= 2) {
		baselinePath = positionalArgs[0];
		currentPath = positionalArgs[1];
	} else {
		// Auto-detect: use baseline.json + latest bench run, OR two latest bench runs
		const baselineFile = join(RESULTS_DIR, "baseline.json");
		const latestFiles = findLatestReports(2);

		try {
			readFileSync(baselineFile); // probe existence
			baselinePath = baselineFile;
			if (latestFiles.length === 0) {
				console.error("No benchmark runs found in test/harness/results/");
				process.exit(1);
			}
			currentPath = latestFiles[0];
		} catch {
			if (latestFiles.length < 2) {
				console.error(
					"Need at least 2 benchmark runs (or a baseline.json) in test/harness/results/.\n" +
						"Run 'npm run bench' to generate benchmark results, then 'npm run compare -- --baseline' to save a baseline.",
				);
				process.exit(1);
			}
			baselinePath = latestFiles[1]; // older
			currentPath = latestFiles[0]; // newer
		}
	}

	let baseline: BenchReport;
	let current: BenchReport;
	try {
		baseline = loadReport(baselinePath);
		current = loadReport(currentPath);
	} catch (err) {
		console.error(`Failed to load reports: ${String(err)}`);
		process.exit(1);
	}

	const exceeded = printCompare(baseline, current, threshold);
	process.exit(exceeded ? 1 : 0);
}

main();
