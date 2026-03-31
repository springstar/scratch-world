import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

/**
 * find-gltf-assets.ts
 *
 * Agent tool for self-learning asset discovery.
 * Searches Brave for GLTF/GLB assets matching a query, HEAD-checks candidate
 * URLs to verify accessibility, and returns a ranked list for the agent to
 * review before embedding in sceneCode or calling add_to_catalog.
 */

const TRUSTED_DOMAINS = [
	"cdn.jsdelivr.net",
	"raw.githubusercontent.com",
	"threejs.org",
	"kenney.nl",
	"quaternius.com",
	"github.com",
	"poly.pizza",
];

const GLB_MIME_TYPES = ["model/gltf-binary", "application/octet-stream", "binary/octet-stream"];

const parameters = Type.Object({
	query: Type.String({
		description:
			'Descriptive search query for the asset, e.g. "pine tree low poly GLB CC0 free download" or "medieval house GLTF free 3D model"',
	}),
	assetType: Type.String({
		description:
			'Semantic category: "tree", "bush", "rock", "building", "vehicle", "character", "prop", "animal", "furniture", "nature"',
	}),
	maxResults: Type.Optional(
		Type.Number({ description: "Max candidates to return (default 5)", minimum: 1, maximum: 10 }),
	),
});

interface TavilyResult {
	title: string;
	url: string;
	content: string;
	raw_content?: string;
	score: number;
}
interface TavilyResponse {
	results?: TavilyResult[];
}

interface AssetCandidate {
	url: string;
	title: string;
	source: string;
	accessible: boolean;
	contentType?: string;
	notes: string;
}

function extractGlbUrls(results: TavilyResult[]): { url: string; title: string; source: string }[] {
	const candidates: { url: string; title: string; source: string }[] = [];

	for (const r of results) {
		const pageUrl = r.url;
		// Direct .glb or .gltf links
		if (/\.(glb|gltf)(\?|$)/i.test(pageUrl)) {
			candidates.push({ url: pageUrl, title: r.title, source: new URL(pageUrl).hostname });
			continue;
		}

		// Extract GLB URLs from raw_content (full page text) and snippet
		const searchText = `${r.raw_content ?? ""} ${r.content ?? ""}`;
		const contentUrls = searchText.match(
			/https?:\/\/(?:cdn\.jsdelivr\.net|raw\.githubusercontent\.com)[^\s"'<>)]+\.glb/gi,
		);
		if (contentUrls) {
			for (const u of contentUrls) {
				candidates.push({ url: u, title: r.title, source: "cdn.jsdelivr.net" });
			}
		}

		// GitHub blob page → convert to raw URL
		const ghBlob = pageUrl.match(/github\.com\/([^/]+\/[^/]+)\/blob\/([^/]+)\/(.+\.glb)/i);
		if (ghBlob) {
			const rawUrl = `https://raw.githubusercontent.com/${ghBlob[1]}/${ghBlob[2]}/${ghBlob[3]}`;
			candidates.push({ url: rawUrl, title: r.title, source: "github.com" });
		}
	}

	return candidates;
}

function isTrustedDomain(url: string): boolean {
	try {
		const host = new URL(url).hostname;
		return TRUSTED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
	} catch {
		return false;
	}
}

async function headCheck(url: string): Promise<{ accessible: boolean; contentType?: string }> {
	try {
		const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(4000) });
		if (!res.ok) return { accessible: false };
		const ct = res.headers.get("content-type") ?? "";
		return { accessible: true, contentType: ct };
	} catch {
		return { accessible: false };
	}
}

export function findGltfAssetsTool(): AgentTool<typeof parameters> {
	return {
		name: "find_gltf_assets",
		label: "Search for GLTF/GLB assets",
		description:
			"Search the web for free CC0 GLTF/GLB 3D assets matching a description. " +
			"Returns verified CDN-accessible URLs that can be used with stdlib.loadModel() or stdlib.placeAsset(). " +
			"Use this when the asset catalog (SKILL.md §Asset Catalog) does not have a matching entry. " +
			"After successfully using a discovered asset, call add_to_catalog to persist it.",
		parameters,
		execute: async (_id, params) => {
			const apiKey = process.env.TAVILY_API_KEY;
			if (!apiKey) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								error: "TAVILY_API_KEY not configured — cannot search for assets",
							}),
						},
					],
					details: { candidates: [] },
				};
			}

			const max = Math.min(params.maxResults ?? 5, 10);

			const searchQuery = `${params.query} filetype:glb OR site:github.com gltf free CC0`;

			let tavilyData: TavilyResponse;
			try {
				const res = await fetch("https://api.tavily.com/search", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						api_key: apiKey,
						query: searchQuery,
						search_depth: "basic",
						include_raw_content: true,
						max_results: 10,
						include_domains: TRUSTED_DOMAINS,
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
						details: { candidates: [] },
					};
				}
				tavilyData = (await res.json()) as TavilyResponse;
			} catch (err) {
				return {
					content: [{ type: "text", text: JSON.stringify({ error: `Network error: ${String(err)}` }) }],
					details: { candidates: [] },
				};
			}

			const rawResults = tavilyData.results ?? [];
			const extracted = extractGlbUrls(rawResults);

			// Also include raw search result URLs if they're trusted GLB hosts
			for (const r of rawResults) {
				if (isTrustedDomain(r.url) && /\.(glb|gltf)(\?|$)/i.test(r.url)) {
					if (!extracted.find((e) => e.url === r.url)) {
						extracted.push({ url: r.url, title: r.title, source: new URL(r.url).hostname });
					}
				}
			}

			// HEAD-check up to max*2 candidates in parallel, return first max accessible
			const toCheck = extracted.slice(0, max * 2);
			const checkResults = await Promise.all(
				toCheck.map(async (c) => {
					const check = await headCheck(c.url);
					const candidate: AssetCandidate = {
						url: c.url,
						title: c.title,
						source: c.source,
						accessible: check.accessible,
						contentType: check.contentType,
						notes: isTrustedDomain(c.url) ? "trusted domain" : "unverified domain — inspect before use",
					};

					// Warn if content-type is unexpected
					if (check.accessible && check.contentType) {
						const ct = check.contentType.toLowerCase();
						const isGlb = GLB_MIME_TYPES.some((m) => ct.includes(m));
						const isHtml = ct.includes("text/html");
						if (isHtml) {
							candidate.accessible = false;
							candidate.notes = "URL returned HTML (not a direct GLB link)";
						} else if (!isGlb) {
							candidate.notes += ` — unusual content-type: ${ct}`;
						}
					}

					return candidate;
				}),
			);

			const accessible = checkResults.filter((c) => c.accessible).slice(0, max);
			const inaccessible = checkResults.filter((c) => !c.accessible).length;

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							query: params.query,
							assetType: params.assetType,
							accessible: accessible.map((c) => ({
								url: c.url,
								title: c.title,
								source: c.source,
								contentType: c.contentType,
								notes: c.notes,
							})),
							checked: checkResults.length,
							inaccessible,
							instructions:
								"Review the accessible candidates. Pick the best match, use its URL with stdlib.loadModel(url, { scale, position }). " +
								"After confirming it renders correctly, call add_to_catalog to persist the entry.",
						}),
					},
				],
				details: { candidates: accessible },
			};
		},
	};
}
