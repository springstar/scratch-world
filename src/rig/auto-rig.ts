import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BLENDER_TIMEOUT_MS = 120_000;

// Common Blender installation paths (PATH is checked first via plain "blender")
const BLENDER_CANDIDATES = [
	"blender",
	"/Applications/Blender.app/Contents/MacOS/Blender",
	"/usr/bin/blender",
	"/usr/local/bin/blender",
];

/**
 * Auto-rig a static humanoid GLB using Blender Automatic Weights.
 *
 * Spawns Blender headless with rig_mesh.py.  Requires:
 *   - Blender installed (brew install --cask blender, or from https://blender.org)
 *   - src/rig/base_humanoid.glb — Quaternius Universal Animation Library 2 template
 *
 * Throws if Blender is not found or the rig script fails.
 * Callers should catch and fall back to the unrigged model.
 *
 * @param meshPath   Absolute path to the Hunyuan-generated static GLB
 * @param outputPath Absolute path for the rigged output GLB
 */
export async function autoRig(meshPath: string, outputPath: string): Promise<void> {
	await mkdir(dirname(outputPath), { recursive: true });

	const rigDir = fileURLToPath(new URL(".", import.meta.url));
	const scriptPath = `${rigDir}rig_mesh.py`;
	// Prefer .glb (UAL2_Standard — has animation actions); fall back to .blend
	const templateGlb = `${rigDir}base_humanoid.glb`;
	const templateBlend = `${rigDir}base_humanoid.blend`;
	const { existsSync } = await import("node:fs");
	const templatePath = existsSync(templateGlb) ? templateGlb : templateBlend;

	let lastError: unknown;
	for (const bin of BLENDER_CANDIDATES) {
		try {
			await spawnBlender(bin, scriptPath, templatePath, meshPath, outputPath);
			return;
		} catch (err) {
			lastError = err;
			// If the error is "not found" keep trying; otherwise it is a real failure
			const msg = err instanceof Error ? err.message : String(err);
			if (!msg.includes("ENOENT") && !msg.includes("not found")) throw err;
		}
	}
	throw new Error(
		`Blender not found in any of ${BLENDER_CANDIDATES.join(", ")} — ` +
			`install Blender and ensure it is in PATH. Last error: ${String(lastError)}`,
	);
}

function spawnBlender(
	bin: string,
	scriptPath: string,
	templatePath: string,
	meshPath: string,
	outputPath: string,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const args = [
			"--background",
			"--python",
			scriptPath,
			"--",
			"--template",
			templatePath,
			"--mesh",
			meshPath,
			"--output",
			outputPath,
		];
		const child = spawn(bin, args, { timeout: BLENDER_TIMEOUT_MS });
		let stderr = "";
		child.stderr?.on("data", (d: Buffer) => {
			stderr += d.toString();
		});
		child.on("close", (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`Blender exited with code ${code ?? "null"}. stderr: ${stderr.slice(-500)}`));
			}
		});
		child.on("error", reject);
	});
}
