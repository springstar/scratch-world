import { randomUUID } from "crypto";
import type { NarratorRegistry } from "../narrators/narrator-registry.js";
import type { SceneProviderRegistry } from "../providers/scene-provider-registry.js";
import type { SceneRepository } from "../storage/types.js";
import type { InteractionResult, NavigationResult, Scene, SceneData } from "./types.js";

export class SceneManager {
	constructor(
		private providerRegistryRef: { current: SceneProviderRegistry },
		private narratorRegistryRef: { current: NarratorRegistry },
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

		// ── State transition ─────────────────────────────────────────────────
		const transitions = obj.metadata.transitions as Record<string, string> | undefined;
		let sceneChanged = false;
		let updatedScene = scene;

		if (transitions) {
			const normalizedAction = action.toLowerCase().trim();
			const nextState =
				transitions[normalizedAction] ??
				Object.entries(transitions).find(([k]) => normalizedAction.includes(k))?.[1];

			const currentState = obj.metadata.state as string | undefined;
			if (nextState !== undefined && nextState !== currentState) {
				const updatedObjects = scene.sceneData.objects.map((o) =>
					o.objectId === objectId ? { ...o, metadata: { ...o.metadata, state: nextState } } : o,
				);
				const updatedSceneData = { ...scene.sceneData, objects: updatedObjects };
				const now = Date.now();
				updatedScene = {
					...scene,
					sceneData: updatedSceneData,
					version: scene.version + 1,
					updatedAt: now,
				};
				await this.repo.saveVersion({
					sceneId: updatedScene.sceneId,
					version: updatedScene.version,
					sceneData: updatedSceneData,
					providerRef: updatedScene.providerRef,
					createdAt: now,
				});
				await this.repo.save(updatedScene);
				sceneChanged = true;
			}
		}

		// ── Narrate ──────────────────────────────────────────────────────────
		const narrateFn = this.narratorRegistryRef.current.getActiveNarrator();
		const targetObj = updatedScene.sceneData.objects.find((o) => o.objectId === objectId) ?? obj;
		let outcome = `You ${action} the ${targetObj.name}. ${targetObj.description}`;
		if (narrateFn) {
			try {
				const nearby = this.describeObjectsNearby(scene, targetObj.position);
				const stateNote = sceneChanged
					? `The object's state changed to: ${(targetObj.metadata.state as string) ?? "unknown"}.`
					: "";
				const prompt = `You are narrating a 3D world interaction.
Object: "${targetObj.name}" (type: ${targetObj.type})
Description: ${targetObj.description}
${targetObj.interactionHint ? `Hint: ${targetObj.interactionHint}` : ""}
User action: ${action}
${stateNote}
${nearby ? `Nearby: ${nearby}` : ""}

Write 2-3 vivid sentences narrating what happens when the user performs this action. Be immersive and specific.`;
				outcome = await narrateFn(prompt);
			} catch {
				// fall through to default outcome already set above
			}
		}

		return { sceneId, objectId, action, outcome, sceneChanged };
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
