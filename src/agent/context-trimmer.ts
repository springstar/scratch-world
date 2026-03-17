import type { AgentMessage } from "@mariozechner/pi-agent-core";

/** Maximum number of user-initiated turns to keep in the agent's context window. */
export const MAX_TURNS = Number(process.env.AGENT_MAX_TURNS ?? "20");

/**
 * Trim the message history to the last MAX_TURNS user turns.
 *
 * Slices at the boundary of a user message so assistant messages and their
 * tool results are never orphaned. Always returns a new array; the original
 * is not mutated.
 */
export function trimContext(messages: AgentMessage[]): AgentMessage[] {
	if (messages.length === 0) return messages;

	// Collect indices of user messages
	const userIndices: number[] = [];
	for (let i = 0; i < messages.length; i++) {
		if ((messages[i] as { role?: string }).role === "user") userIndices.push(i);
	}

	// Nothing to trim yet
	if (userIndices.length <= MAX_TURNS) return messages;

	// Slice from the first user message we want to keep
	const keepFrom = userIndices[userIndices.length - MAX_TURNS];
	return messages.slice(keepFrom);
}
