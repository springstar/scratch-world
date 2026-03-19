export type NarrateFn = (prompt: string) => Promise<string>;

export interface NarratorManifest {
	name: string;
	description: string;
}
