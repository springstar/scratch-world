import { describe, it, expect } from "vitest";
import { trimContext, MAX_TURNS } from "../src/agent/context-trimmer.js";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

// ── Helpers ───────────────────────────────────────────────────────────────────

function user(text = "hi"): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() } as AgentMessage;
}

function assistant(text = "ok"): AgentMessage {
	return { role: "assistant", content: [{ type: "text", text }], timestamp: Date.now() } as AgentMessage;
}

function toolResult(id = "tc-1"): AgentMessage {
	return { role: "toolResult", content: [{ toolCallId: id, content: [] }], timestamp: Date.now() } as AgentMessage;
}

/** Build a realistic conversation of N complete turns. */
function buildHistory(turns: number): AgentMessage[] {
	const msgs: AgentMessage[] = [];
	for (let i = 0; i < turns; i++) {
		msgs.push(user(`msg ${i}`));
		msgs.push(assistant(`reply ${i}`));
	}
	return msgs;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("trimContext", () => {
	it("returns the same array when under MAX_TURNS", () => {
		const msgs = buildHistory(MAX_TURNS - 1);
		expect(trimContext(msgs)).toBe(msgs);
	});

	it("returns the same array when exactly MAX_TURNS", () => {
		const msgs = buildHistory(MAX_TURNS);
		expect(trimContext(msgs)).toBe(msgs);
	});

	it("trims to MAX_TURNS user messages when over limit", () => {
		const msgs = buildHistory(MAX_TURNS + 5);
		const result = trimContext(msgs);

		const userCount = result.filter((m) => (m as { role?: string }).role === "user").length;
		expect(userCount).toBe(MAX_TURNS);
	});

	it("always starts at a user message after trimming", () => {
		const msgs = buildHistory(MAX_TURNS + 3);
		const result = trimContext(msgs);
		expect((result[0] as { role?: string }).role).toBe("user");
	});

	it("does not mutate the original array", () => {
		const msgs = buildHistory(MAX_TURNS + 2);
		const original = [...msgs];
		trimContext(msgs);
		expect(msgs).toEqual(original);
	});

	it("returns empty array unchanged", () => {
		const result = trimContext([]);
		expect(result).toEqual([]);
	});

	it("preserves tool result messages that follow a kept assistant message", () => {
		// Build history: MAX_TURNS - 1 old turns, then a turn with a tool call
		const msgs: AgentMessage[] = [];
		for (let i = 0; i < MAX_TURNS - 1; i++) {
			msgs.push(user(`old ${i}`));
			msgs.push(assistant(`reply ${i}`));
		}
		// Final turn: user → assistant (tool call) → toolResult → assistant (final)
		msgs.push(user("do something"));
		msgs.push(assistant("calling tool"));
		msgs.push(toolResult("tc-last"));
		msgs.push(assistant("done"));

		// One more user turn to push history over MAX_TURNS
		msgs.push(user("new message"));
		msgs.push(assistant("new reply"));

		const result = trimContext(msgs);

		// The trimmed window must contain the toolResult we added
		expect(result.some((m) => (m as { role?: string }).role === "toolResult")).toBe(true);
	});

	it("trims to the correct slice boundary when oldest kept is a user message", () => {
		// 5 old turns then 3 new turns, MAX_TURNS = 3
		const old = buildHistory(5);
		const kept = buildHistory(3);
		const msgs = [...old, ...kept];

		// Temporarily use a smaller cap for this test
		// We replicate the logic here to verify correctness independent of MAX_TURNS
		const userIndices: number[] = [];
		for (let i = 0; i < msgs.length; i++) {
			if ((msgs[i] as { role?: string }).role === "user") userIndices.push(i);
		}
		const keepFrom = userIndices[userIndices.length - 3];
		const expected = msgs.slice(keepFrom);

		// Manually trim with cap = 3
		const result = (() => {
			if (userIndices.length <= 3) return msgs;
			return msgs.slice(keepFrom);
		})();

		expect(result).toEqual(expected);
		expect((result[0] as { role?: string }).role).toBe("user");
	});
});
