import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import type { EvalFeedback, FeedbackEntry, RejectionFeedback } from "../feedback-logger.js";

// feedback.jsonl is at project root (four dirs up from src/agent/tools/)
const FEEDBACK_FILE = join(fileURLToPath(import.meta.url), "../../../../feedback.jsonl");

// Skills dir: src/skills/built-in/generator-claude/
const SKILLS_DIR = join(fileURLToPath(import.meta.url), "../../../../src/skills/built-in/generator-claude");

const parameters = Type.Object({
	lookbackDays: Type.Optional(
		Type.Number({
			description: "How many days of feedback to analyze (default 30)",
			minimum: 1,
			maximum: 365,
		}),
	),
});

function readFeedback(lookbackMs: number): FeedbackEntry[] {
	if (!existsSync(FEEDBACK_FILE)) return [];
	try {
		const cutoff = Date.now() - lookbackMs;
		return readFileSync(FEEDBACK_FILE, "utf-8")
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				try {
					return JSON.parse(line) as FeedbackEntry;
				} catch {
					return null;
				}
			})
			.filter((e): e is FeedbackEntry => e !== null && e.ts >= cutoff);
	} catch {
		return [];
	}
}

function readSkillFiles(): Record<string, string> {
	const out: Record<string, string> = {};
	if (!existsSync(SKILLS_DIR)) return out;
	try {
		const files = readdirSync(SKILLS_DIR)
			.filter((f) => f.endsWith(".md"))
			.sort();
		for (const f of files) {
			try {
				out[f] = readFileSync(join(SKILLS_DIR, f), "utf-8");
			} catch {
				// skip unreadable file
			}
		}
	} catch {
		// skip unreadable dir
	}
	return out;
}

export function evolveSkillsTool(): AgentTool<typeof parameters> {
	return {
		name: "evolve_skills",
		label: "Analyze skill failures and propose improvements",
		description:
			"Reads feedback.jsonl (automated evaluation failures + user rejections), identifies recurring patterns, and asks Claude to propose targeted improvements to the generator-claude skill files. Returns a proposed diff as text. The user must review and approve before applying.",
		parameters,
		execute: async (_id, params) => {
			const apiKey = process.env.ANTHROPIC_API_KEY;
			if (!apiKey) {
				return {
					content: [{ type: "text", text: JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }) }],
					details: { available: false },
				};
			}

			const days = params.lookbackDays ?? 30;
			const entries = readFeedback(days * 24 * 60 * 60 * 1000);

			if (entries.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								message: `No feedback entries found in the last ${days} days. Generate some scenes first.`,
								entries: 0,
							}),
						},
					],
					details: { entries: 0 },
				};
			}

			// Aggregate check failures
			const checkCounts: Record<string, number> = {};
			const evalEntries = entries.filter((e) => e.source === "evaluate_scene");
			for (const entry of evalEntries) {
				const data = entry.data as EvalFeedback;
				for (const [check, passed] of Object.entries(data.checks)) {
					if (!passed) checkCounts[check] = (checkCounts[check] ?? 0) + 1;
				}
			}

			const rejectionEntries = entries.filter((e) => e.source === "user_rejection");
			const rejectionTexts = rejectionEntries.map((e) => (e.data as RejectionFeedback).text).slice(-20);

			// Read current skill files (truncate each to keep prompt manageable)
			const skillFiles = readSkillFiles();
			const skillSummary = Object.entries(skillFiles)
				.map(([name, content]) => {
					const trimmed = content.length > 3000 ? `${content.slice(0, 3000)}\n... (truncated)` : content;
					return `### ${name}\n${trimmed}`;
				})
				.join("\n\n");

			const sortedChecks = Object.entries(checkCounts).sort((a, b) => b[1] - a[1]);

			const analysisPrompt = `You are analyzing failure patterns in a 3D scene generation system to improve the skill documentation.

## Feedback Summary (last ${days} days)

Total entries: ${entries.length}
Evaluation failures: ${evalEntries.length} scenes scored < 5/6
User rejections: ${rejectionEntries.length}

## Automated Check Failures (sorted by frequency)
${sortedChecks.length > 0 ? sortedChecks.map(([check, count]) => `- ${check}: failed ${count} times`).join("\n") : "No check failures recorded."}

## Recent User Rejection Messages
${rejectionTexts.length > 0 ? rejectionTexts.map((t) => `- "${t}"`).join("\n") : "No rejection messages recorded."}

## Current Skill Files
${skillSummary}

## Your Task

Propose 2–4 specific, targeted improvements to the skill files based on the failure patterns.
For each improvement:
1. Target file (e.g. "05-scene-rules.md")
2. Operation: APPEND | REPLACE | NEW_FILE
3. For REPLACE: exact old text → exact new text
4. For APPEND: text to add at end of file
5. One-sentence rationale tied to the failure pattern

Be precise — the proposed text must be copy-pasteable.`;

			const baseUrl = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
			let analysis: string;
			try {
				const res = await fetch(`${baseUrl}/v1/messages`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-api-key": apiKey,
						"anthropic-version": "2023-06-01",
					},
					body: JSON.stringify({
						model: "claude-sonnet-4-6",
						max_tokens: 2048,
						messages: [{ role: "user", content: analysisPrompt }],
					}),
				});
				if (!res.ok) {
					const body = await res.text();
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({ error: `Analysis API error ${res.status}: ${body.slice(0, 200)}` }),
							},
						],
						details: { entries: entries.length },
					};
				}
				const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
				analysis = data.content.find((b) => b.type === "text")?.text ?? "(no analysis generated)";
			} catch (err) {
				return {
					content: [{ type: "text", text: JSON.stringify({ error: `Network error: ${String(err)}` }) }],
					details: { entries: entries.length },
				};
			}

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							entries: entries.length,
							evalFailures: evalEntries.length,
							rejections: rejectionEntries.length,
							topFailures: sortedChecks.slice(0, 5),
							analysis,
						}),
					},
				],
				details: { entries: entries.length },
			};
		},
	};
}
