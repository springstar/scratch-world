import type { SceneRenderProvider } from "./types.js";

export class SceneProviderRegistry {
	constructor(
		private readonly providers: SceneRenderProvider[],
		private readonly activeName: string,
	) {}

	get activeProviderName(): string {
		return this.activeName;
	}

	listProviders(): { name: string; description: string }[] {
		return this.providers.map((p) => ({ name: p.name, description: p.name }));
	}

	getActiveProvider(): SceneRenderProvider {
		const provider = this.providers.find((p) => p.name === this.activeName);
		if (!provider) {
			throw new Error(`Active provider "${this.activeName}" not found in registry`);
		}
		return provider;
	}

	getProvider(name: string): SceneRenderProvider | null {
		return this.providers.find((p) => p.name === name) ?? null;
	}

	activate(name: string): SceneProviderRegistry {
		const exists = this.providers.some((p) => p.name === name);
		if (!exists) throw new Error(`Provider "${name}" not found in registry`);
		return new SceneProviderRegistry(this.providers, name);
	}
}
