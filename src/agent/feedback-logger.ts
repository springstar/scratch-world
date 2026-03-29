import { appendFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

// feedback.jsonl lives at the project root (three dirs up from src/agent/)
const FEEDBACK_FILE = join(fileURLToPath(import.meta.url), "../../../feedback.jsonl");

export interface EvalFeedback {
	checks: Record<string, boolean>;
	issues: string[];
	passed: number;
	total: number;
}

export interface RejectionFeedback {
	text: string;
}

export type FeedbackSource = "evaluate_scene" | "user_rejection";

export interface FeedbackEntry {
	ts: number;
	source: FeedbackSource;
	sceneId: string | null;
	sessionId: string;
	data: EvalFeedback | RejectionFeedback;
}

export function logFeedback(entry: FeedbackEntry): void {
	try {
		appendFileSync(FEEDBACK_FILE, `${JSON.stringify(entry)}\n`, "utf-8");
	} catch {
		// Non-fatal — never let logging failures crash the main flow
	}
}

/** Returns true if the message text signals the user wants to redo the current scene. */
export function isRejectionSignal(text: string): boolean {
	const t = text.toLowerCase();
	// Chinese rejection words
	if (/重做|不对|很差|重新|糟糕|不行|太差|难看|失败|不好|重来/.test(text)) return true;
	// English rejection words
	if (/\b(redo|redo it|that's wrong|wrong|bad|terrible|awful|ugly|broken|fix it|not right|again)\b/.test(t))
		return true;
	return false;
}
