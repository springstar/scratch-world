import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import { getScreenshot } from "../../viewer-api/screenshot-store.js";
import { logFeedback } from "../feedback-logger.js";

const parameters = Type.Object({
	sceneId: Type.String({ description: "ID of the scene to evaluate" }),
	sessionId: Type.Optional(Type.String({ description: "Session ID for feedback logging" })),
});

interface CheckResult {
	skeleton: boolean;
	anchor: boolean;
	scale: boolean;
	lighting: boolean;
	placement: boolean;
	positionApi: boolean;
}

interface EvalResponse {
	checks: CheckResult;
	issues: string[];
	passed: number;
	total: number;
}

const EVAL_PROMPT = `You are evaluating a 3D scene screenshot for quality. Score it against these 6 criteria. Return ONLY valid JSON, no explanation.

Criteria:
1. skeleton: Can the camera see surfaces in all directions (no black void visible)?
2. anchor: Is there ONE dominant element filling ~40% of the frame?
3. scale: Do objects appear at realistic real-world proportions? (humans ~1.8m, rooms correct size, etc.)
4. lighting: Does the scene have natural, consistent lighting without harsh artifacts or extreme darkness?
5. placement: Do objects rest on surfaces naturally (nothing obviously floating without reason)?
6. positionApi: No obvious rendering glitches or broken geometry?

Return exactly this JSON structure:
{
  "checks": {
    "skeleton": true/false,
    "anchor": true/false,
    "scale": true/false,
    "lighting": true/false,
    "placement": true/false,
    "positionApi": true/false
  },
  "issues": ["describe each failed check in one sentence"]
}`;

export function evaluateSceneTool(): AgentTool<typeof parameters> {
	return {
		name: "evaluate_scene",
		label: "Evaluate scene quality",
		description:
			"Scores a rendered scene screenshot against 6 quality criteria (spatial skeleton, dominant anchor, scale, lighting, placement, geometry). Call after create_scene or update_scene to verify quality and decide whether to iterate.",
		parameters,
		execute: async (_id, params: Static<typeof parameters>) => {
			const apiKey = process.env.ANTHROPIC_API_KEY;
			if (!apiKey) {
				return {
					content: [{ type: "text", text: JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }) }],
					details: { sceneId: params.sceneId, available: false },
				};
			}

			const dataUrl = getScreenshot(params.sceneId);
			if (!dataUrl) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								available: false,
								message:
									"No screenshot available yet — the viewer uploads one after rendering. Wait a moment and try again, or proceed without evaluation.",
							}),
						},
					],
					details: { sceneId: params.sceneId, available: false },
				};
			}

			// Strip data URL prefix to get raw base64
			const commaIdx = dataUrl.indexOf(",");
			const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
			const mediaType = dataUrl.startsWith("data:image/png") ? "image/png" : "image/jpeg";

			const baseUrl = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
			let raw: string;
			try {
				const res = await fetch(`${baseUrl}/v1/messages`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-api-key": apiKey,
						"anthropic-version": "2023-06-01",
					},
					body: JSON.stringify({
						model: "claude-haiku-4-5-20251001",
						max_tokens: 512,
						messages: [
							{
								role: "user",
								content: [
									{ type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
									{ type: "text", text: EVAL_PROMPT },
								],
							},
						],
					}),
				});
				if (!res.ok) {
					const body = await res.text();
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({ error: `Vision API error ${res.status}: ${body.slice(0, 200)}` }),
							},
						],
						details: { sceneId: params.sceneId, available: true },
					};
				}
				const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
				raw = data.content.find((b) => b.type === "text")?.text ?? "{}";
			} catch (err) {
				return {
					content: [{ type: "text", text: JSON.stringify({ error: `Network error: ${String(err)}` }) }],
					details: { sceneId: params.sceneId, available: true },
				};
			}

			let parsed: EvalResponse;
			try {
				const json = JSON.parse(raw) as { checks: CheckResult; issues: string[] };
				const checks = json.checks ?? {};
				const issues: string[] = Array.isArray(json.issues) ? json.issues : [];
				const passed = Object.values(checks).filter(Boolean).length;
				parsed = { checks: checks as CheckResult, issues, passed, total: 6 };
			} catch {
				return {
					content: [
						{ type: "text", text: JSON.stringify({ error: "Could not parse vision model response", raw }) },
					],
					details: { sceneId: params.sceneId, available: true },
				};
			}

			// Auto-log when scene fails quality threshold
			if (parsed.passed < 5) {
				logFeedback({
					ts: Date.now(),
					source: "evaluate_scene",
					sceneId: params.sceneId,
					sessionId: params.sessionId ?? "",
					data: {
						checks: { ...parsed.checks } as Record<string, boolean>,
						issues: parsed.issues,
						passed: parsed.passed,
						total: parsed.total,
					},
				});
			}

			return {
				content: [{ type: "text", text: JSON.stringify({ sceneId: params.sceneId, ...parsed }) }],
				details: { sceneId: params.sceneId, available: true, ...parsed },
			};
		},
	};
}
