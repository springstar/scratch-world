export interface SkillManifest {
	name: string;
	category: "generator" | "renderer" | "threejs";
	description: string;
	version: string;
}
