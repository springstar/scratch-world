import { randomUUID } from "crypto";
import type { SceneProviderRegistry } from "../providers/scene-provider-registry.js";
import type { SceneRepository } from "../storage/types.js";
import type { Scene, SceneData } from "./types.js";

export class SceneManager {
	constructor(
		private providerRegistryRef: { current: SceneProviderRegistry },
		private repo: SceneRepository,
	) {}

	async createScene(ownerId: string, prompt: string, title?: string, sceneData?: SceneData): Promise<Scene> {
		const now = Date.now();
		let scene: Scene;

		if (sceneData) {
			// Skill path: Claude provided sceneData directly
			const assetId = randomUUID();
			scene = {
				sceneId: randomUUID(),
				ownerId,
				title: title ?? prompt.slice(0, 60),
				description: prompt,
				sceneData,
				providerRef: { provider: "claude", assetId },
				version: 1,
				createdAt: now,
				updatedAt: now,
				isPublic: false,
			};
		} else {
			// Provider path
			const result = await this.providerRegistryRef.current.getActiveProvider().generate(prompt);
			const sceneId = randomUUID();
			// Some providers (e.g. Marble proxy mode) need the sceneId to build the
			// splatUrl — they return a splatUrlTemplate with a "{sceneId}" placeholder.
			let sceneData = result.sceneData;
			if (result.splatUrlTemplate) {
				sceneData = { ...sceneData, splatUrl: result.splatUrlTemplate.replace("{sceneId}", sceneId) };
			}
			scene = {
				sceneId,
				ownerId,
				title: title ?? prompt.slice(0, 60),
				description: prompt,
				sceneData,
				providerRef: result.ref,
				version: 1,
				createdAt: now,
				updatedAt: now,
				isPublic: false,
			};
		}

		await this.repo.save(scene);
		// Save initial version snapshot
		await this.repo.saveVersion({
			sceneId: scene.sceneId,
			version: 1,
			sceneData: scene.sceneData,
			providerRef: scene.providerRef,
			createdAt: now,
		});
		return scene;
	}

	async updateScene(sceneId: string, instruction: string, sceneData?: SceneData): Promise<Scene> {
		const scene = await this.requireScene(sceneId);
		const now = Date.now();
		let updated: Scene;

		if (sceneData) {
			// Skill path: Claude provided sceneData directly
			updated = {
				...scene,
				sceneData,
				version: scene.version + 1,
				updatedAt: now,
			};
		} else {
			// Provider path: use the scene's own provider (not active provider)
			const provider = this.providerRegistryRef.current.getProvider(scene.providerRef.provider);
			if (!provider) {
				throw new Error(
					`Provider "${scene.providerRef.provider}" not in registry. ` +
						`This scene was created with a Skill (generator-claude). ` +
						`Provide sceneData to update it.`,
				);
			}
			const result = await provider.edit(scene.providerRef, instruction);
			updated = {
				...scene,
				sceneData: result.sceneData,
				providerRef: result.ref,
				version: scene.version + 1,
				updatedAt: now,
			};
		}

		// Snapshot before overwriting — versions are immutable once written
		await this.repo.saveVersion({
			sceneId: updated.sceneId,
			version: updated.version,
			sceneData: updated.sceneData,
			providerRef: updated.providerRef,
			createdAt: now,
		});
		await this.repo.save(updated);
		return updated;
	}

	async getScene(sceneId: string): Promise<Scene | null> {
		return this.repo.findById(sceneId);
	}

	async listScenes(ownerId: string): Promise<Scene[]> {
		return this.repo.findByOwner(ownerId);
	}

	async shareScene(sceneId: string): Promise<Scene> {
		const scene = await this.requireScene(sceneId);
		// Reuse existing token if already shared
		const token = scene.shareToken ?? randomUUID().replace(/-/g, "");
		await this.repo.share(sceneId, token);
		return { ...scene, isPublic: true, shareToken: token };
	}

	async getSceneByShareToken(shareToken: string): Promise<Scene | null> {
		return this.repo.findByShareToken(shareToken);
	}

	// ── Private helpers ──────────────────────────────────────────────────────

	private async requireScene(sceneId: string): Promise<Scene> {
		const scene = await this.repo.findById(sceneId);
		if (!scene) throw new Error(`Scene not found: ${sceneId}`);
		return scene;
	}
}
