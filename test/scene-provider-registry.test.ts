import { describe, it, expect } from "vitest";
import { SceneProviderRegistry } from "../src/providers/scene-provider-registry.js";
import { StubProvider } from "../src/providers/stub/provider.js";

function makeRegistry(active = "stub") {
	return new SceneProviderRegistry([new StubProvider()], active);
}

describe("SceneProviderRegistry", () => {
	describe("getActiveProvider", () => {
		it("returns the active provider", () => {
			const registry = makeRegistry("stub");
			expect(registry.getActiveProvider().name).toBe("stub");
		});

		it("throws when active provider not in registry", () => {
			const registry = makeRegistry("nonexistent");
			expect(() => registry.getActiveProvider()).toThrow("nonexistent");
		});
	});

	describe("getProvider", () => {
		it("returns provider by name", () => {
			const registry = makeRegistry();
			expect(registry.getProvider("stub")).not.toBeNull();
			expect(registry.getProvider("stub")?.name).toBe("stub");
		});

		it("returns null for unknown name", () => {
			const registry = makeRegistry();
			expect(registry.getProvider("unknown")).toBeNull();
		});
	});

	describe("activate", () => {
		it("returns new registry instance with updated active provider", () => {
			const registry = makeRegistry("stub");
			const registry2 = new SceneProviderRegistry(
				[new StubProvider(), { name: "other", generate: async () => { throw new Error(); }, edit: async () => { throw new Error(); }, describe: async () => { throw new Error(); } }],
				"stub",
			);
			const activated = registry2.activate("other");
			expect(activated.activeProviderName).toBe("other");
			// Original unchanged
			expect(registry2.activeProviderName).toBe("stub");
		});

		it("throws for unknown provider name", () => {
			const registry = makeRegistry("stub");
			expect(() => registry.activate("nonexistent")).toThrow("not found");
		});
	});

	describe("listProviders", () => {
		it("lists all registered providers", () => {
			const registry = makeRegistry();
			const providers = registry.listProviders();
			expect(providers).toHaveLength(1);
			expect(providers[0].name).toBe("stub");
		});
	});
});
