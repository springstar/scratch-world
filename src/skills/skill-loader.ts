import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import type { SkillManifest } from "./types.js";

const BUILT_IN_DIR = join(fileURLToPath(import.meta.url), "../../skills/built-in");

// Built-in skills are registered statically so they work without filesystem scanning at import time
const BUILT_IN_SKILLS: SkillManifest[] = [
	{
		name: "generator-claude",
		category: "generator",
		description: "Claude fills sceneData directly in the tool call — no separate provider needed",
		version: "1.0.0",
	},
	{
		name: "renderer-threejs",
		category: "renderer",
		description: "Three.js rendering patterns: PBR materials, post-processing, performance optimization, animation",
		version: "1.0.0",
	},
];

export class SkillLoader {
	private readonly activeFile: string;

	constructor(projectRoot: string) {
		this.activeFile = join(projectRoot, "skills.active.json");
	}

	listSkills(): SkillManifest[] {
		return [...BUILT_IN_SKILLS];
	}

	getActiveSkill(category: "generator" | "renderer"): SkillManifest | null {
		const active = this.readActive();
		const defaults: Record<string, string> = { generator: "generator-claude", renderer: "renderer-threejs" };
		const name = active[category] ?? defaults[category];
		return BUILT_IN_SKILLS.find((s) => s.category === category && s.name === name) ?? null;
	}

	getActivePromptMarkdown(category: "generator" | "renderer"): string | null {
		const skill = this.getActiveSkill(category);
		if (!skill) return null;
		const mdPath = join(BUILT_IN_DIR, skill.name, "SKILL.md");
		if (!existsSync(mdPath)) return null;
		return readFileSync(mdPath, "utf-8");
	}

	activate(category: "generator" | "renderer", name: string): void {
		const exists = BUILT_IN_SKILLS.some((s) => s.category === category && s.name === name);
		if (!exists) throw new Error(`Skill "${name}" not found in category "${category}"`);
		const active = this.readActive();
		active[category] = name;
		writeFileSync(this.activeFile, `${JSON.stringify(active, null, 2)}\n`, "utf-8");
	}

	private readActive(): Record<string, string> {
		if (!existsSync(this.activeFile)) return {};
		try {
			return JSON.parse(readFileSync(this.activeFile, "utf-8")) as Record<string, string>;
		} catch {
			return {};
		}
	}
}
