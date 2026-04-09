import { randomUUID } from "node:crypto";

export type JobState =
	| { status: "pending" }
	| { status: "done"; modelUrl: string; thumbnailUrl: string | null; name: string; scale: number }
	| { status: "error"; error: string };

const jobs = new Map<string, JobState>();

export function createJob(): string {
	const jobId = randomUUID().slice(0, 12);
	jobs.set(jobId, { status: "pending" });
	return jobId;
}

export function getJob(jobId: string): JobState | undefined {
	return jobs.get(jobId);
}

export function resolveJob(
	jobId: string,
	result: { modelUrl: string; thumbnailUrl: string | null; name: string; scale: number },
): void {
	if (jobs.has(jobId)) {
		jobs.set(jobId, { ...result, status: "done" });
	}
}

export function failJob(jobId: string, error: string): void {
	if (jobs.has(jobId)) {
		jobs.set(jobId, { status: "error", error });
	}
}
