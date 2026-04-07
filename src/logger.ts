/**
 * logger.ts
 *
 * Lightweight structured logger with session/tool context and elapsed-time timers.
 * Writes to stderr in a compact tagged format and appends to an in-memory ring buffer
 * for retrieval via the /debug/logs endpoint.
 *
 * Usage:
 *   const log = createLogger({ session: sessionId, tool: "image_to_3d" });
 *   const t = log.timer("submit");
 *   ...
 *   t.end();          // logs "[image_to_3d] submit done (1234 ms)"
 *   log.info("poll", { status: "RUN", jobId });
 *   log.error("download failed", err);
 */

export interface LogEntry {
	ts: number; // epoch ms
	level: "info" | "warn" | "error";
	tag: string; // "session:abc tool:image_to_3d" etc.
	msg: string;
	data?: Record<string, unknown>;
}

// ── Ring buffer ───────────────────────────────────────────────────────────────

const RING_SIZE = 500;
const ring: LogEntry[] = [];

export function getRecentLogs(limit = 200): LogEntry[] {
	const start = ring.length > limit ? ring.length - limit : 0;
	return ring.slice(start);
}

function push(entry: LogEntry): void {
	ring.push(entry);
	if (ring.length > RING_SIZE) ring.shift();
}

// ── Formatting ────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
	return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function formatLine(entry: LogEntry): string {
	const time = new Date(entry.ts).toISOString().slice(11, 23); // HH:MM:SS.mmm
	const level = entry.level.toUpperCase().padEnd(5);
	const data = entry.data ? ` ${JSON.stringify(entry.data)}` : "";
	return `[${time}] ${level} [${entry.tag}] ${entry.msg}${data}`;
}

// ── Logger factory ────────────────────────────────────────────────────────────

export interface Logger {
	info(msg: string, data?: Record<string, unknown>): void;
	warn(msg: string, data?: Record<string, unknown>): void;
	error(msg: string, err?: unknown, data?: Record<string, unknown>): void;
	/** Start a named timer. Call .end() to log elapsed time. */
	timer(operation: string, data?: Record<string, unknown>): { end(extraData?: Record<string, unknown>): number };
	/** Return a child logger with additional context merged into the tag. */
	child(extra: Record<string, string>): Logger;
}

export interface LogContext {
	session?: string;
	tool?: string;
	npc?: string;
	[key: string]: string | undefined;
}

export function createLogger(ctx: LogContext = {}): Logger {
	const tagParts = Object.entries(ctx)
		.filter(([, v]) => v !== undefined)
		.map(([k, v]) => `${k}:${v}`);
	const tag = tagParts.join(" ") || "app";

	function write(level: LogEntry["level"], msg: string, data?: Record<string, unknown>): void {
		const entry: LogEntry = { ts: Date.now(), level, tag, msg, data };
		push(entry);
		const line = formatLine(entry);
		if (level === "error") {
			process.stderr.write(`${line}\n`);
		} else {
			process.stderr.write(`${line}\n`);
		}
	}

	const logger: Logger = {
		info(msg, data) {
			write("info", msg, data);
		},
		warn(msg, data) {
			write("warn", msg, data);
		},
		error(msg, err, data) {
			const errStr = err instanceof Error ? err.message : err !== undefined ? String(err) : undefined;
			write("error", msg, { ...(errStr ? { error: errStr } : {}), ...data });
		},
		timer(operation, startData) {
			const start = Date.now();
			write("info", `${operation} start`, startData);
			return {
				end(extraData) {
					const elapsed = Date.now() - start;
					write("info", `${operation} done`, { elapsed: formatMs(elapsed), ...extraData });
					return elapsed;
				},
			};
		},
		child(extra) {
			const merged: LogContext = { ...ctx };
			for (const [k, v] of Object.entries(extra)) {
				merged[k] = v;
			}
			return createLogger(merged);
		},
	};

	return logger;
}

/** App-level logger (no session context). */
export const appLog = createLogger({});
