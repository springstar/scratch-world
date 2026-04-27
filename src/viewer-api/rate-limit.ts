import type { Context, MiddlewareHandler, Next } from "hono";

interface WindowEntry {
	count: number;
	resetAt: number;
}

const windows = new Map<string, WindowEntry>();

// Sweep expired entries every 5 minutes to prevent unbounded growth.
setInterval(
	() => {
		const now = Date.now();
		for (const [key, entry] of windows) {
			if (entry.resetAt < now) windows.delete(key);
		}
	},
	5 * 60 * 1000,
).unref();

function clientIp(c: Context): string {
	return (c.req.header("x-forwarded-for") ?? "").split(",")[0].trim() || c.req.header("x-real-ip") || "unknown";
}

/**
 * Fixed-window rate limiter.
 * @param limit   Max requests per window.
 * @param windowMs Window duration in milliseconds.
 * @param prefix  Key prefix to namespace limits per route.
 */
export function rateLimit(limit: number, windowMs: number, prefix: string): MiddlewareHandler {
	return async (c: Context, next: Next) => {
		const key = `${prefix}:${clientIp(c)}`;
		const now = Date.now();

		let entry = windows.get(key);
		if (!entry || entry.resetAt < now) {
			entry = { count: 0, resetAt: now + windowMs };
			windows.set(key, entry);
		}

		entry.count += 1;

		c.res.headers.set("X-RateLimit-Limit", String(limit));
		c.res.headers.set("X-RateLimit-Remaining", String(Math.max(0, limit - entry.count)));
		c.res.headers.set("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

		if (entry.count > limit) {
			return c.json({ error: "Too many requests" }, 429);
		}

		await next();
	};
}
