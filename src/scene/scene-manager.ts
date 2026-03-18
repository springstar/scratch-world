import { randomUUID } from "crypto";
import type { ThreeDProvider } from "../providers/types.js";
import type { SceneRepository } from "../storage/types.js";
import type { InteractionResult, NavigationResult, Scene } from "./types.js";

export class SceneManager {
	constructor(
		private provider: ThreeDProvider,
		private repo: SceneRepository,
		private narrateFn: ((prompt: string) => Promise<string>) | null = null,
	) {}

	async createScene(ownerId: string, prompt: string, title?: string): Promise<Scene> {
		const result = await this.provider.generate(prompt);
		const now = Date.now();
		const scene: Scene = {
			sceneId: randomUUID(),
			ownerId,
			title: title ?? prompt.slice(0, 60),
			description: prompt,
			sceneData: result.sceneData,
			providerRef: result.ref,
			version: 1,
			createdAt: now,
			updatedAt: now,
		};
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

	async updateScene(sceneId: string, instruction: string): Promise<Scene> {
		const scene = await this.requireScene(sceneId);
		const result = await this.provider.edit(scene.providerRef, instruction);
		const now = Date.now();
		const updated: Scene = {
			...scene,
			sceneData: result.sceneData,
			providerRef: result.ref,
			version: scene.version + 1,
			updatedAt: now,
		};
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

	async navigateTo(sceneId: string, viewpointName: string): Promise<NavigationResult> {
		const scene = await this.requireScene(sceneId);
		const viewpoint = scene.sceneData.viewpoints.find((v) => v.name.toLowerCase() === viewpointName.toLowerCase());
		if (!viewpoint) {
			const available = scene.sceneData.viewpoints.map((v) => `"${v.name}"`).join(", ");
			throw new Error(`Viewpoint "${viewpointName}" not found. Available: ${available}`);
		}
		const viewUrl = scene.providerRef.viewUrl ?? "";
		return {
			sceneId,
			viewpoint,
			viewUrl: `${viewUrl}#${viewpoint.viewpointId}`,
			description: `You are now at the ${viewpoint.name}. ${this.describeObjectsNearby(scene, viewpoint.position)}`,
		};
	}

	async interactWithObject(sceneId: string, objectId: string, action: string): Promise<InteractionResult> {
		const scene = await this.requireScene(sceneId);
		const obj = scene.sceneData.objects.find((o) => o.objectId === objectId);
		if (!obj) throw new Error(`Object "${objectId}" not found in scene "${sceneId}"`);
		if (!obj.interactable) {
			return {
				sceneId,
				objectId,
				action,
				outcome: `The ${obj.name} cannot be interacted with.`,
				sceneChanged: false,
			};
		}
		// Ask the LLM to narrate the interaction if narrateFn is available
		let outcome = `You ${action} the ${obj.name}. ${obj.description}`;
		if (this.narrateFn) {
			try {
				const nearby = this.describeObjectsNearby(scene, obj.position);
				const prompt = `You are narrating a 3D world interaction.
Object: "${obj.name}" (type: ${obj.type})
Description: ${obj.description}
${obj.interactionHint ? `Hint: ${obj.interactionHint}` : ""}
User action: ${action}
${nearby ? `Nearby: ${nearby}` : ""}

Write 2-3 vivid sentences narrating what happens when the user performs this action. Be immersive and specific.`;
				outcome = await this.narrateFn(prompt);
			} catch {
				// fall through to default outcome already set above
			}
		}

		return {
			sceneId,
			objectId,
			action,
			outcome,
			sceneChanged: false,
		};
	}

	// ── Private helpers ──────────────────────────────────────────────────────

	private async requireScene(sceneId: string): Promise<Scene> {
		const scene = await this.repo.findById(sceneId);
		if (!scene) throw new Error(`Scene not found: ${sceneId}`);
		return scene;
	}

	private describeObjectsNearby(scene: Scene, position: { x: number; y: number; z: number }): string {
		const nearby = scene.sceneData.objects
			.filter((o) => {
				const dx = o.position.x - position.x;
				const dz = o.position.z - position.z;
				return Math.sqrt(dx * dx + dz * dz) < 20;
			})
			.map((o) => o.name);
		if (nearby.length === 0) return "";
		return `Nearby: ${nearby.join(", ")}.`;
	}
}
