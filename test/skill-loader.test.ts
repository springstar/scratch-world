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
		it("returns built-in generator-claude skill", () => {
			const skills = loader.listSkills();
			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("generator-claude");
			expect(skills[0].category).toBe("generator");
		});
	});

	describe("getActiveSkill", () => {
		it("returns null when no active skill configured", () => {
			const skill = loader.getActiveSkill("generator");
			expect(skill).toBeNull();
		});

		it("returns the active skill after activation", () => {
			loader.activate("generator", "generator-claude");
			const skill = loader.getActiveSkill("generator");
			expect(skill?.name).toBe("generator-claude");
		});
	});

	describe("getActivePromptMarkdown", () => {
		it("returns null when no active skill", () => {
			const md = loader.getActivePromptMarkdown("generator");
			expect(md).toBeNull();
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
