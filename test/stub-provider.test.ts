import { describe, it, expect } from "vitest";
import { StubProvider } from "../src/providers/stub/provider.js";

describe("StubProvider", () => {
	const provider = new StubProvider();

	describe("generate", () => {
		it("returns a ProviderResult with valid shape", async () => {
			const result = await provider.generate("a medieval castle");
			expect(result.ref.provider).toBe("stub");
			expect(result.ref.assetId).toBeTruthy();
			expect(result.viewUrl).toContain("stub.local");
			expect(result.sceneData.objects.length).toBeGreaterThan(0);
			expect(result.sceneData.viewpoints.length).toBeGreaterThan(0);
		});

		it("embeds the prompt in the main object description", async () => {
			const result = await provider.generate("a dark forest");
			const main = result.sceneData.objects.find((o) => o.objectId === "obj_main");
			expect(main?.description).toContain("a dark forest");
		});

		it("returns unique assetIds on each call", async () => {
			const a = await provider.generate("scene a");
			const b = await provider.generate("scene b");
			expect(a.ref.assetId).not.toBe(b.ref.assetId);
		});

		it("includes entrance and overview viewpoints", async () => {
			const result = await provider.generate("any scene");
			const names = result.sceneData.viewpoints.map((v) => v.name);
			expect(names).toContain("entrance");
			expect(names).toContain("overview");
		});
	});

	describe("edit", () => {
		it("returns a new object reflecting the instruction", async () => {
			const generated = await provider.generate("a castle");
			const edited = await provider.edit(generated.ref, "add a drawbridge");
			const added = edited.sceneData.objects.find((o) => o.metadata?.instruction === "add a drawbridge");
			expect(added).toBeTruthy();
			expect(added?.interactable).toBe(true);
		});

		it("preserves original objects after edit", async () => {
			const generated = await provider.generate("a castle");
			const edited = await provider.edit(generated.ref, "add a tower");
			const ground = edited.sceneData.objects.find((o) => o.objectId === "obj_ground");
			const main = edited.sceneData.objects.find((o) => o.objectId === "obj_main");
			expect(ground).toBeTruthy();
			expect(main).toBeTruthy();
		});

		it("updates the viewUrl with a version timestamp", async () => {
			const generated = await provider.generate("a castle");
			const edited = await provider.edit(generated.ref, "add a moat");
			expect(edited.viewUrl).toContain("?v=");
		});
	});

	describe("describe", () => {
		it("returns the ref and sceneData", async () => {
			const generated = await provider.generate("a village");
			const description = await provider.describe(generated.ref);
			expect(description.ref).toEqual(generated.ref);
			expect(description.sceneData.objects.length).toBeGreaterThan(0);
		});
	});
});
