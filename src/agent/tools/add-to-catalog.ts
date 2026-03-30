import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

/**
 * add-to-catalog.ts
 *
 * Appends a new verified asset entry to viewer/src/renderer/asset-catalog.ts.
 * Security: only appends — never replaces or truncates. Validates URL format,
 * type, and id uniqueness before writing.
 */

const CATALOG_PATH = join(fileURLToPath(import.meta.url), "../../../../viewer/src/renderer/asset-catalog.ts");

const ASSET_TYPES = [
	"character",
	"vehicle",
	"prop",
	"building",
	"tree",
	"bush",
	"rock",
	"nature",
	"animal",
	"furniture",
] as const;

const parameters = Type.Object({
	id: Type.String({ description: 'Stable semantic id, e.g. "tree_pine_highland_01". Use snake_case.' }),
	url: Type.String({ description: "Full CDN URL to the GLB or GLTF file" }),
	type: Type.Union(
		ASSET_TYPES.map((t) => Type.Literal(t)),
		{ description: "Asset category" },
	),
	tags: Type.Array(Type.String(), { description: "Descriptive tags, e.g. ['pine', 'conifer', 'tall']" }),
	scale: Type.Number({ description: "World scale multiplier. model_unit * scale = metres", minimum: 0.00001 }),
	groundOffset: Type.Number({
		description: "Y offset in metres so the model base sits at y=0",
	}),
	source: Type.String({ description: 'Origin label, e.g. "kenney", "quaternius", "discovered"' }),
});

function isValidHttpUrl(s: string): boolean {
	try {
		const u = new URL(s);
		return u.protocol === "http:" || u.protocol === "https:";
	} catch {
		return false;
	}
}

function isValidId(id: string): boolean {
	return /^[a-z][a-z0-9_]*$/.test(id) && id.length <= 80;
}

export function addToCatalogTool(): AgentTool<typeof parameters> {
	return {
		name: "add_to_catalog",
		label: "Add asset to catalog",
		description:
			"Permanently adds a new verified GLTF/GLB asset to the local asset catalog (viewer/src/renderer/asset-catalog.ts). " +
			"Only call this after confirming the asset URL loads correctly in the scene. " +
			"The entry becomes immediately available to stdlib.placeAsset() in subsequent scenes.",
		parameters,
		execute: async (_id, params) => {
			if (!isValidId(params.id)) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								error: `Invalid id "${params.id}". Must be snake_case alphanumeric, max 80 chars.`,
							}),
						},
					],
					details: { added: false },
				};
			}

			if (!isValidHttpUrl(params.url)) {
				return {
					content: [{ type: "text", text: JSON.stringify({ error: `Invalid URL: "${params.url}"` }) }],
					details: { added: false },
				};
			}

			if (!existsSync(CATALOG_PATH)) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({ error: `Catalog file not found at ${CATALOG_PATH}` }),
						},
					],
					details: { added: false },
				};
			}

			const current = readFileSync(CATALOG_PATH, "utf-8");

			// Check id uniqueness
			if (current.includes(`id: "${params.id}"`)) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								error: `Asset id "${params.id}" already exists in catalog. Use a different id or update manually.`,
							}),
						},
					],
					details: { added: false },
				};
			}

			// Build the new entry as TypeScript source
			const tagsLiteral = JSON.stringify(params.tags);
			const entry = `  {
    id: "${params.id}",
    url: "${params.url}",
    type: "${params.type}",
    tags: ${tagsLiteral},
    scale: ${params.scale},
    groundOffset: ${params.groundOffset},
    source: "${params.source}",
  },`;

			// Insert before the closing ]; of ASSET_CATALOG
			const marker = "];\n\n/** Find all entries";
			if (!current.includes(marker)) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								error: "Could not find insertion point in catalog file. Manual edit required.",
							}),
						},
					],
					details: { added: false },
				};
			}

			const updated = current.replace(marker, `${entry}\n${marker}`);
			writeFileSync(CATALOG_PATH, updated, "utf-8");

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							added: true,
							id: params.id,
							url: params.url,
							message: `Asset "${params.id}" added to catalog. It is now available via stdlib.placeAsset("${params.id}", opts).`,
						}),
					},
				],
				details: { added: true, id: params.id },
			};
		},
	};
}
