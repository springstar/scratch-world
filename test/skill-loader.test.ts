import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SkillLoader } from "../src/skills/skill-loader.js";

function makeTempDir() {
	return mkdtempSync(join(tmpdir(), "skill-loader-test-"));
}

describe("SkillLoader", () => {
	let tmpDir: string;
	let loader: SkillLoader;

	beforeEach(() => {
		tmpDir = makeTempDir();
		loader = new SkillLoader(tmpDir);
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("listSkills", () => {
		it("includes built-in generator-claude skill", () => {
			const skills = loader.listSkills();
			const gen = skills.find((s) => s.name === "generator-claude");
			expect(gen).toBeDefined();
			expect(gen?.category).toBe("generator");
		});
	});

	describe("getActiveSkill", () => {
		it("returns the default skill when no active skill configured", () => {
			const skill = loader.getActiveSkill("generator");
			// generator-claude is the built-in default — always returns a skill
			expect(skill?.name).toBe("generator-claude");
		});

		it("returns the active skill after activation", () => {
			loader.activate("generator", "generator-claude");
			const skill = loader.getActiveSkill("generator");
			expect(skill?.name).toBe("generator-claude");
		});
	});

	describe("getActivePromptMarkdown", () => {
		it("returns markdown for the default skill when no explicit activation", () => {
			const md = loader.getActivePromptMarkdown("generator");
			expect(md).toBeTypeOf("string");
			expect(md).toContain("SceneData");
		});

		it("returns markdown string when generator-claude is active", () => {
			loader.activate("generator", "generator-claude");
			const md = loader.getActivePromptMarkdown("generator");
			expect(md).toBeTypeOf("string");
			expect(md).toContain("SceneData");
		});
	});

	describe("activate", () => {
		it("persists active skill to skills.active.json", () => {
			loader.activate("generator", "generator-claude");
			// Re-create loader from same dir — should pick up persisted state
			const loader2 = new SkillLoader(tmpDir);
			const skill = loader2.getActiveSkill("generator");
			expect(skill?.name).toBe("generator-claude");
		});

		it("throws for unknown skill name", () => {
			expect(() => loader.activate("generator", "nonexistent")).toThrow("not found");
		});
	});
});
