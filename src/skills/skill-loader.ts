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
	{
		name: "threejs-animation",
		category: "threejs",
		description: "Keyframe animation, skeletal animation, morph targets, animation mixing",
		version: "1.0.0",
	},
	{
		name: "threejs-fundamentals",
		category: "threejs",
		description: "Three.js scene setup, camera, renderer, lights, basic objects",
		version: "1.0.0",
	},
	{
		name: "threejs-geometry",
		category: "threejs",
		description: "Built-in geometries, custom BufferGeometry, procedural meshes",
		version: "1.0.0",
	},
	{
		name: "threejs-interaction",
		category: "threejs",
		description: "Raycasting, pointer events, drag controls, object picking",
		version: "1.0.0",
	},
	{
		name: "threejs-lighting",
		category: "threejs",
		description: "Light types, shadows, environment maps, light helpers",
		version: "1.0.0",
	},
	{
		name: "threejs-materials",
		category: "threejs",
		description: "MeshStandardMaterial, MeshPhysicalMaterial, shader materials",
		version: "1.0.0",
	},
	{
		name: "threejs-postprocessing",
		category: "threejs",
		description: "EffectComposer, bloom, SSAO, depth of field, custom passes",
		version: "1.0.0",
	},
	{
		name: "threejs-shaders",
		category: "threejs",
		description: "GLSL shaders, ShaderMaterial, uniforms, custom effects",
		version: "1.0.0",
	},
	{
		name: "threejs-textures",
		category: "threejs",
		description: "Texture loading, UV mapping, canvas textures, video textures",
		version: "1.0.0",
	},
	{
		name: "threejs-loaders",
		category: "threejs",
		description: "GLTFLoader, DRACOLoader, FBXLoader, asset management",
		version: "1.0.0",
	},
	{
		name: "webgpu-threejs-tsl",
		category: "threejs",
		description: "WebGPU renderer + TSL node materials, compute shaders, TSL post-processing",
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

	// Returns markdown for all enabled threejs skills, concatenated.
	// By default all threejs skills are enabled; add name to "threejs_disabled" array in skills.active.json to disable.
	getThreejsMarkdown(): string | null {
		const active = this.readActive();
		const disabled: string[] = Array.isArray(active["threejs_disabled"])
			? (active["threejs_disabled"] as string[])
			: [];
		const skills = BUILT_IN_SKILLS.filter((s) => s.category === "threejs" && !disabled.includes(s.name));
		if (skills.length === 0) return null;
		const parts = skills
			.map((s) => {
				const mdPath = join(BUILT_IN_DIR, s.name, "SKILL.md");
				if (!existsSync(mdPath)) return null;
				return readFileSync(mdPath, "utf-8");
			})
			.filter(Boolean);
		return parts.length > 0 ? parts.join("\n\n---\n\n") : null;
	}

	disableThreejsSkill(name: string): void {
		const active = this.readActive();
		const disabled: string[] = Array.isArray(active["threejs_disabled"])
			? (active["threejs_disabled"] as string[])
			: [];
		if (!disabled.includes(name)) disabled.push(name);
		active["threejs_disabled"] = disabled;
		writeFileSync(this.activeFile, `${JSON.stringify(active, null, 2)}\n`, "utf-8");
	}

	enableThreejsSkill(name: string): void {
		const active = this.readActive();
		const disabled: string[] = Array.isArray(active["threejs_disabled"])
			? (active["threejs_disabled"] as string[])
			: [];
		active["threejs_disabled"] = disabled.filter((n) => n !== name);
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
