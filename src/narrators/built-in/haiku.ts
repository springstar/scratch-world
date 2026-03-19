import { completeSimple, getModel } from "@mariozechner/pi-ai";

export async function narrateWithHaiku(prompt: string): Promise<string> {
	const model = getModel("anthropic", "claude-haiku-4-5-20251001");
	if (process.env.ANTHROPIC_BASE_URL) model.baseUrl = process.env.ANTHROPIC_BASE_URL;
	const response = await completeSimple(model, {
		messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
	});
	const text = response.content
		.filter((c) => c.type === "text")
		.map((c) => (c as { type: "text"; text: string }).text)
		.join("");
	return text.trim() || "Nothing remarkable happens.";
}
