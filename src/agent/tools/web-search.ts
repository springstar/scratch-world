import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";

const parameters = Type.Object({
	query: Type.String({
		description: "Search query — use specific terms for the place, landmark, or scene you are researching",
	}),
	count: Type.Optional(
		Type.Number({ description: "Number of results to return (default 5, max 10)", minimum: 1, maximum: 10 }),
	),
});

interface TavilyResult {
	title: string;
	url: string;
	content: string; // short snippet
	raw_content?: string; // full page text (markdown) — present when include_raw_content=true
	score: number;
}

interface TavilyResponse {
	answer?: string; // AI-synthesized answer to the query
	results?: TavilyResult[];
}

const RAW_CONTENT_LIMIT = 4000; // chars per result — enough for color/dimension facts without flooding context

export function webSearchTool(): AgentTool<typeof parameters> {
	return {
		name: "web_search",
		label: "Web search",
		description:
			"Search the web for information about real-world places, landmarks, dimensions, cultural context, or any factual data needed before building a scene. " +
			"Returns full page content (not just snippets) so you can extract specific details like water color, building dimensions, atmospheric conditions. " +
			"Use BEFORE writing sceneCode for any named real-world location.",
		parameters,
		execute: async (_id, params: Static<typeof parameters>) => {
			const apiKey = process.env.TAVILY_API_KEY;
			if (!apiKey) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								error: "TAVILY_API_KEY not configured — using training knowledge only. Set TAVILY_API_KEY in .env (free at https://tavily.com).",
							}),
						},
					],
					details: { query: params.query, results: [] },
				};
			}

			const count = Math.min(params.count ?? 5, 10);

			let data: TavilyResponse;
			try {
				const res = await fetch("https://api.tavily.com/search", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						api_key: apiKey,
						query: params.query,
						search_depth: "basic",
						include_raw_content: true,
						max_results: count,
					}),
				});
				if (!res.ok) {
					const body = await res.text();
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({ error: `Tavily API error ${res.status}: ${body.slice(0, 200)}` }),
							},
						],
						details: { query: params.query, results: [] },
					};
				}
				data = (await res.json()) as TavilyResponse;
			} catch (err) {
				return {
					content: [{ type: "text", text: JSON.stringify({ error: `Network error: ${String(err)}` }) }],
					details: { query: params.query, results: [] },
				};
			}

			const results = (data.results ?? []).map((r) => ({
				title: r.title,
				url: r.url,
				snippet: r.content,
				// Truncate raw content to stay within context budget
				content: r.raw_content ? r.raw_content.slice(0, RAW_CONTENT_LIMIT) : r.content,
				score: r.score,
			}));

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							query: params.query,
							// Include synthesized answer when available — often has exact figures
							answer: data.answer ?? null,
							results,
						}),
					},
				],
				details: { query: params.query, results },
			};
		},
	};
}
