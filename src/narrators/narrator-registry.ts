import type { NarrateFn, NarratorManifest } from "./types.js";

interface NarratorEntry {
	manifest: NarratorManifest;
	fn: NarrateFn;
}

export class NarratorRegistry {
	constructor(
		private readonly narrators: NarratorEntry[],
		private readonly activeName: string,
	) {}

	get activeNaratorName(): string {
		return this.activeName;
	}

	getActiveNarrator(): NarrateFn | null {
		const entry = this.narrators.find((n) => n.manifest.name === this.activeName);
		return entry?.fn ?? null;
	}

	listNarrators(): NarratorManifest[] {
		return this.narrators.map((n) => n.manifest);
	}

	activate(name: string): NarratorRegistry {
		const exists = this.narrators.some((n) => n.manifest.name === name);
		if (!exists && name !== "none") throw new Error(`Narrator "${name}" not found`);
		return new NarratorRegistry(this.narrators, name);
	}
}
