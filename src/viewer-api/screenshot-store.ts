// In-memory screenshot store with 10-minute TTL.
// Keyed by sceneId — the viewer pushes a JPEG dataUrl after each scene render.
// The evaluate_scene tool reads from here when scoring a scene.

interface Entry {
	dataUrl: string;
	ts: number;
}

const TTL_MS = 10 * 60 * 1000;
const store = new Map<string, Entry>();

export function storeScreenshot(sceneId: string, dataUrl: string): void {
	store.set(sceneId, { dataUrl, ts: Date.now() });
	// Evict expired entries on each write (cheap — store stays small)
	const now = Date.now();
	for (const [id, entry] of store) {
		if (now - entry.ts > TTL_MS) store.delete(id);
	}
}

export function getScreenshot(sceneId: string): string | null {
	const entry = store.get(sceneId);
	if (!entry) return null;
	if (Date.now() - entry.ts > TTL_MS) {
		store.delete(sceneId);
		return null;
	}
	return entry.dataUrl;
}
