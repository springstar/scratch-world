import type { SceneRenderProvider } from "../providers/types.js";
import type { SceneManager } from "../scene/scene-manager.js";
import type { RealtimeBus } from "../viewer-api/realtime.js";

const POLL_INTERVAL_MS = 3_000;
const PROGRESS_INTERVAL_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes
const MAX_CONSECUTIVE_ERRORS = 5; // tolerate this many network blips before giving up

interface PendingJob {
	type: "create" | "update";
	sceneId: string;
	sessionId: string;
	viewerUrl: string;
	title: string;
	provider: SceneRenderProvider;
	operationId: string;
	startedAt: number;
	lastProgressAt: number;
	timeoutMs: number;
	consecutiveErrors: number;
}

export interface JobCallbacks {
	onProgress: (elapsedMs: number) => void;
	onComplete: (viewUrl: string) => void;
	onError: (message: string) => void;
}

export class GenerationQueue {
	private jobs: PendingJob[] = [];
	private timer: ReturnType<typeof setInterval> | null = null;
	private listeners = new Map<string, JobCallbacks>();

	constructor(
		private bus: RealtimeBus,
		private sceneManager: SceneManager,
	) {}

	enqueue(job: Omit<PendingJob, "startedAt" | "consecutiveErrors" | "lastProgressAt">): void {
		this.jobs.push({ ...job, startedAt: Date.now(), lastProgressAt: Date.now(), consecutiveErrors: 0 });
		if (!this.timer) {
			this.timer = setInterval(() => this.tick(), POLL_INTERVAL_MS);
		}
	}

	/** Register progress/complete/error callbacks for a specific scene's generation job. */
	subscribeJob(sceneId: string, callbacks: JobCallbacks): void {
		this.listeners.set(sceneId, callbacks);
	}

	private async tick(): Promise<void> {
		if (this.jobs.length === 0) {
			if (this.timer) {
				clearInterval(this.timer);
				this.timer = null;
			}
			return;
		}

		const remaining: PendingJob[] = [];

		for (const job of this.jobs) {
			const elapsed = Date.now() - job.startedAt;
			if (elapsed > job.timeoutMs) {
				console.error(`[GenerationQueue] job ${job.operationId} timed out after ${elapsed}ms`);
				await this.sceneManager.failScene(job.sceneId).catch(console.error);
				this.bus.publish(job.sessionId, {
					type: "error",
					message: "Scene generation timed out. Please try again.",
				});
				const cb = this.listeners.get(job.sceneId);
				if (cb) {
					cb.onError("Scene generation timed out. Please try again.");
					this.listeners.delete(job.sceneId);
				}
				continue;
			}

			// Fire progress notification every PROGRESS_INTERVAL_MS
			if (Date.now() - job.lastProgressAt >= PROGRESS_INTERVAL_MS) {
				job.lastProgressAt = Date.now();
				this.listeners.get(job.sceneId)?.onProgress(elapsed);
			}

			try {
				const result = await job.provider.checkGeneration!(job.operationId);
				job.consecutiveErrors = 0;
				if (result === null) {
					// Still in progress
					remaining.push(job);
					continue;
				}
				const scene = await this.sceneManager.completeScene(job.sceneId, result);
				console.log(`[GenerationQueue] job ${job.operationId} complete for scene ${scene.sceneId}`);
				if (job.type === "update") {
					this.bus.publish(job.sessionId, {
						type: "scene_updated",
						sceneId: scene.sceneId,
						version: scene.version,
					});
				} else {
					this.bus.publish(job.sessionId, {
						type: "scene_created",
						sceneId: scene.sceneId,
						title: job.title,
						viewUrl: job.viewerUrl,
					});
				}
				const cb = this.listeners.get(job.sceneId);
				if (cb) {
					cb.onComplete(job.viewerUrl);
					this.listeners.delete(job.sceneId);
				}
			} catch (err: unknown) {
				job.consecutiveErrors += 1;
				const isTransient = isTransientError(err);
				if (isTransient && job.consecutiveErrors < MAX_CONSECUTIVE_ERRORS) {
					console.warn(
						`[GenerationQueue] job ${job.operationId} transient error (${job.consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`,
						err instanceof Error ? err.message : String(err),
					);
					remaining.push(job);
					continue;
				}
				const message = err instanceof Error ? err.message || String(err) : String(err);
				console.error(`[GenerationQueue] job ${job.operationId} failed permanently:`, err);
				await this.sceneManager.failScene(job.sceneId).catch(console.error);
				this.bus.publish(job.sessionId, { type: "error", message });
				const cb = this.listeners.get(job.sceneId);
				if (cb) {
					cb.onError(message);
					this.listeners.delete(job.sceneId);
				}
			}
		}

		this.jobs = remaining;

		if (this.jobs.length === 0 && this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	/** Stop polling and discard all pending jobs (for graceful shutdown). */
	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.jobs = [];
		this.listeners.clear();
	}
}

/** Returns true for transient network errors that warrant a retry. */
function isTransientError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	const code = (err as NodeJS.ErrnoException).code;
	if (code === "ECONNRESET" || code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ENOTFOUND") return true;
	const cause = (err as { cause?: unknown }).cause;
	if (cause instanceof Error) return isTransientError(cause);
	return false;
}

export { DEFAULT_TIMEOUT_MS };
