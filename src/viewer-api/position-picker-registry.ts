// In-memory store: pickerId → resolver function.
// Agent tools publish a position_picker SSE event, then await the Promise returned by
// registerPicker(). The viewer sends POST /confirm-position/:pickerId to resolve it.

type Resolver = (pos: { x: number; y: number; z: number }) => void;

const pending = new Map<string, Resolver>();

const TIMEOUT_MS = 60_000;

/**
 * Register a new picker and return a Promise that resolves when the viewer confirms
 * (or after TIMEOUT_MS, in which case it resolves with the provided fallback).
 */
export function registerPicker(
	pickerId: string,
	fallback: { x: number; y: number; z: number },
): Promise<{ x: number; y: number; z: number }> {
	return new Promise((resolve) => {
		pending.set(pickerId, resolve);
		setTimeout(() => {
			if (pending.has(pickerId)) {
				pending.delete(pickerId);
				resolve(fallback);
			}
		}, TIMEOUT_MS);
	});
}

/**
 * Resolve a pending picker with the user-confirmed position.
 * Returns true if the picker was found and resolved, false if it was already timed out.
 */
export function resolvePicker(pickerId: string, pos: { x: number; y: number; z: number }): boolean {
	const fn = pending.get(pickerId);
	if (!fn) return false;
	pending.delete(pickerId);
	fn(pos);
	return true;
}
