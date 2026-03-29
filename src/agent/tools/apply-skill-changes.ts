import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

// Skills dir: src/skills/built-in/generator-claude/
const SKILLS_DIR = join(fileURLToPath(import.meta.url), "../../../../src/skills/built-in/generator-claude");

const parameters = Type.Object({
	file: Type.String({
		description:
			'Target filename within generator-claude/ (e.g. "05-scene-rules.md"). Must end in .md and contain no path separators.',
	}),
	operation: Type.Union([Type.Literal("APPEND"), Type.Literal("REPLACE")], {
		description: "APPEND adds text at end of file; REPLACE finds old text and substitutes new text.",
	}),
	appendText: Type.Optional(
		Type.String({ description: "Text to append to the end of the file (required when operation=APPEND)." }),
	),
	oldText: Type.Optional(
		Type.String({ description: "Exact text to find and replace (required when operation=REPLACE)." }),
	),
	newText: Type.Optional(Type.String({ description: "Replacement text (required when operation=REPLACE)." })),
});

type Params = Static<typeof parameters>;

export function applySkillChangesTool(): AgentTool<typeof parameters> {
	return {
		name: "apply_skill_changes",
		label: "Apply approved changes to skill files",
		description:
			"Writes approved changes from evolve_skills to the generator-claude skill files. Only modifies .md files within the generator-claude directory. Requires explicit user approval before calling.",
		parameters,
		execute: async (_id, params: Params) => {
			// Security: filename must end in .md and must not contain path separators
			const { file } = params;
			if (!file.endsWith(".md") || file.includes("/") || file.includes("\\") || file.includes("..")) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								error: `Invalid filename "${file}". Must be a plain .md filename with no path components.`,
							}),
						},
					],
					details: { ok: false },
				};
			}

			const filePath = join(SKILLS_DIR, file);

			if (params.operation === "APPEND") {
				if (!params.appendText) {
					return {
						content: [
							{ type: "text", text: JSON.stringify({ error: "appendText required for APPEND operation" }) },
						],
						details: { ok: false },
					};
				}
				const existing = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";
				const separator = existing.endsWith("\n") ? "\n" : "\n\n";
				writeFileSync(filePath, `${existing}${separator}${params.appendText}\n`, "utf-8");
				return {
					content: [{ type: "text", text: JSON.stringify({ ok: true, file, operation: "APPEND" }) }],
					details: { ok: true, file },
				};
			}

			// REPLACE
			if (!params.oldText || params.newText === undefined) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({ error: "oldText and newText required for REPLACE operation" }),
						},
					],
					details: { ok: false },
				};
			}
			if (!existsSync(filePath)) {
				return {
					content: [{ type: "text", text: JSON.stringify({ error: `File not found: ${file}` }) }],
					details: { ok: false },
				};
			}
			const content = readFileSync(filePath, "utf-8");
			if (!content.includes(params.oldText)) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								error: `oldText not found in ${file}. The file may have changed since evolve_skills was called.`,
							}),
						},
					],
					details: { ok: false },
				};
			}
			writeFileSync(filePath, content.replace(params.oldText, params.newText), "utf-8");
			return {
				content: [{ type: "text", text: JSON.stringify({ ok: true, file, operation: "REPLACE" }) }],
				details: { ok: true, file },
			};
		},
	};
}
