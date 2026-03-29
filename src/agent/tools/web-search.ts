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

interface BraveResult {
	title: string;
	url: string;
	description?: string;
}

interface BraveResponse {
	web?: {
		results?: BraveResult[];
	};
}

export function webSearchTool(): AgentTool<typeof parameters> {
	return {
		name: "web_search",
		label: "Web search",
		description:
			"Search the web for information about real-world places, landmarks, dimensions, cultural context, or any factual data needed before building a scene. Use BEFORE writing sceneCode for any named real-world location.",
		parameters,
		execute: async (_id, params: Static<typeof parameters>) => {
			const apiKey = process.env.BRAVE_SEARCH_API_KEY;
			if (!apiKey) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								error: "BRAVE_SEARCH_API_KEY not configured — using training knowledge only",
							}),
						},
					],
					details: { query: params.query, results: [] },
				};
			}

			const count = Math.min(params.count ?? 5, 10);
			const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(params.query)}&count=${count}`;

			let data: BraveResponse;
			try {
				const res = await fetch(url, {
					headers: {
						Accept: "application/json",
						"Accept-Encoding": "gzip",
						"X-Subscription-Token": apiKey,
					},
				});
				if (!res.ok) {
					const body = await res.text();
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({ error: `Brave Search API error ${res.status}: ${body.slice(0, 200)}` }),
							},
						],
						details: { query: params.query, results: [] },
					};
				}
				data = (await res.json()) as BraveResponse;
			} catch (err) {
				return {
					content: [{ type: "text", text: JSON.stringify({ error: `Network error: ${String(err)}` }) }],
					details: { query: params.query, results: [] },
				};
			}

			const results = (data.web?.results ?? []).map((r) => ({
				title: r.title,
				url: r.url,
				snippet: r.description ?? "",
			}));

			return {
				content: [{ type: "text", text: JSON.stringify({ query: params.query, results }) }],
				details: { query: params.query, results },
			};
		},
	};
}
