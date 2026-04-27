import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import type { SceneListItem } from "../api.js";

interface Props {
	scenes: SceneListItem[];
	onEnterScene: (sceneId: string) => void;
}

interface SceneNode {
	sceneId: string;
	title: string;
	worldPos: THREE.Vector3;
}

type SplatLoadStatus = "idle" | "loading" | "loaded";

interface SplatEntry {
	sceneId: string;
	splatUrl: string;
	worldPos: THREE.Vector3;
	placeholderMesh: THREE.Mesh;
	splatMesh: SplatMesh | null;
	status: SplatLoadStatus;
}

function fibonacciSphere(count: number, radius: number): THREE.Vector3[] {
	const out: THREE.Vector3[] = [];
	const phi = Math.PI * (3 - Math.sqrt(5));
	for (let i = 0; i < count; i++) {
		const y = 1 - (i / Math.max(count - 1, 1)) * 2;
		const r = Math.sqrt(Math.max(0, 1 - y * y));
		const theta = phi * i;
		out.push(new THREE.Vector3(Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius));
	}
	return out;
}

export function UniverseView({ scenes, onEnterScene }: Props) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const onEnterRef = useRef(onEnterScene);
	onEnterRef.current = onEnterScene;

	const [locked, setLocked] = useState(false);
	const [nearScene, setNearScene] = useState<{ title: string; sceneId: string; close: boolean } | null>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		// ── Three.js core ─────────────────────────────────────────────────────────
		const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

		const threeScene = new THREE.Scene();
		threeScene.background = new THREE.Color(0x00000a);

		const camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 5000);
		camera.position.set(0, 2, 50);

		// ── SparkRenderer ─────────────────────────────────────────────────────────
		const sparkRenderer = new SparkRenderer({ renderer, enableLod: true, sortRadial: true });
		threeScene.add(sparkRenderer);

		// ── Starfield ─────────────────────────────────────────────────────────────
		const STAR_COUNT = 80_000;
		const starPos = new Float32Array(STAR_COUNT * 3);
		for (let i = 0; i < STAR_COUNT; i++) {
			const theta = Math.random() * Math.PI * 2;
			const phi = Math.acos(2 * Math.random() - 1);
			const r = 800 + Math.random() * 1200;
			starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
			starPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
			starPos[i * 3 + 2] = r * Math.cos(phi);
		}
		const starGeo = new THREE.BufferGeometry();
		starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
		const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: true });
		threeScene.add(new THREE.Points(starGeo, starMat));

		// ── Scene nodes + placeholder orbs ────────────────────────────────────────
		const ready = scenes.filter((s) => s.status === "ready");
		const positions = fibonacciSphere(Math.max(ready.length, 1), 80);
		const nodes: SceneNode[] = [];
		const entries = new Map<string, SplatEntry>();
		let activeLoads = 0;
		const abortControllers = new Map<string, AbortController>();

		for (let i = 0; i < ready.length; i++) {
			const s = ready[i];
			const pos = positions[i];
			nodes.push({ sceneId: s.sceneId, title: s.title, worldPos: pos.clone() });

			const color = s.splatUrl ? 0x334466 : 0x2255cc;
			const geo = new THREE.SphereGeometry(3, 16, 16);
			const mat = new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.35 });
			const placeholderMesh = new THREE.Mesh(geo, mat);
			placeholderMesh.position.copy(pos);
			threeScene.add(placeholderMesh);

			if (s.splatUrl) {
				entries.set(s.sceneId, {
					sceneId: s.sceneId,
					splatUrl: s.splatUrl,
					worldPos: pos.clone(),
					placeholderMesh,
					splatMesh: null,
					status: "idle",
				});
			}
		}

		// ── Splat load/dispose helpers ────────────────────────────────────────────
		function loadSplat(entry: SplatEntry): void {
			entry.status = "loading";
			activeLoads += 1;
			const ctrl = new AbortController();
			abortControllers.set(entry.sceneId, ctrl);

			fetch(entry.splatUrl, { signal: ctrl.signal })
				.then((response) => {
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					if (!response.body) throw new Error("No response body");
					const contentLength = response.headers.get("content-length");
					const streamLength = contentLength ? parseInt(contentLength, 10) : undefined;
					const mesh = new SplatMesh({ stream: response.body, streamLength, lod: true });
					mesh.rotation.x = Math.PI;
					mesh.position.copy(entry.worldPos);
					mesh.scale.setScalar(0.04);
					mesh.opacity = 0.45;
					entry.splatMesh = mesh;
					threeScene.add(mesh);
					return mesh.initialized;
				})
				.then(() => {
					entry.status = "loaded";
					activeLoads -= 1;
					abortControllers.delete(entry.sceneId);
				})
				.catch((err: unknown) => {
					abortControllers.delete(entry.sceneId);
					activeLoads -= 1;
					if (ctrl.signal.aborted) return;
					// Non-abort error: revert to idle so distance check can retry
					if (entry.splatMesh) {
						threeScene.remove(entry.splatMesh);
						entry.splatMesh = null;
					}
					entry.status = "idle";
					console.warn(`[UniverseView] splat load failed for ${entry.sceneId}:`, (err as Error).message);
				});
		}

		function disposeSplat(entry: SplatEntry): void {
			const ctrl = abortControllers.get(entry.sceneId);
			if (ctrl) {
				ctrl.abort();
				abortControllers.delete(entry.sceneId);
			}
			if (entry.splatMesh) {
				// Silence internal AbortError from stream cancellation — SplatMesh's
				// async reader throws when the underlying stream is aborted.
				entry.splatMesh.initialized.catch(() => {});
				threeScene.remove(entry.splatMesh);
				entry.splatMesh.dispose();
				entry.splatMesh = null;
			}
			entry.status = "idle";
		}

		// ── Controls ──────────────────────────────────────────────────────────────
		const controls = new PointerLockControls(camera, canvas);
		const keys: Record<string, boolean> = {};
		const nearRef = { current: null as { title: string; sceneId: string; close: boolean } | null };

		const onKeyDown = (e: KeyboardEvent) => {
			keys[e.code] = true;
			if (e.code === "KeyE" && !e.repeat && nearRef.current?.close) {
				onEnterRef.current(nearRef.current.sceneId);
			}
		};
		const onKeyUp = (e: KeyboardEvent) => { delete keys[e.code]; };

		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("keyup", onKeyUp);
		canvas.addEventListener("click", () => controls.lock());
		controls.addEventListener("lock", () => setLocked(true));
		controls.addEventListener("unlock", () => setLocked(false));

		// ── Animation loop ────────────────────────────────────────────────────────
		const clock = new THREE.Clock();
		let rafId = 0;
		let lastNearId = "";

		function animate() {
			rafId = requestAnimationFrame(animate);
			const delta = clock.getDelta();

			// WASD + vertical movement
			const speed = keys["ShiftLeft"] || keys["ShiftRight"] ? 22 : 9;
			const fwd = new THREE.Vector3();
			const right = new THREE.Vector3();
			camera.getWorldDirection(fwd);
			right.crossVectors(fwd, camera.up).normalize();

			if (keys["KeyW"] || keys["ArrowUp"]) camera.position.addScaledVector(fwd, speed * delta);
			if (keys["KeyS"] || keys["ArrowDown"]) camera.position.addScaledVector(fwd, -speed * delta);
			if (keys["KeyA"] || keys["ArrowLeft"]) camera.position.addScaledVector(right, -speed * delta);
			if (keys["KeyD"] || keys["ArrowRight"]) camera.position.addScaledVector(right, speed * delta);
			if (keys["Space"]) camera.position.y += speed * delta;
			if (keys["KeyQ"] || keys["ControlLeft"]) camera.position.y -= speed * delta;

			// Proximity label
			let nearest: SceneNode | null = null;
			let nearestDist = Infinity;
			for (const node of nodes) {
				const d = camera.position.distanceTo(node.worldPos);
				if (d < 20 && d < nearestDist) { nearest = node; nearestDist = d; }
			}

			if (nearest !== null) {
				const next = { title: nearest.title, sceneId: nearest.sceneId, close: nearestDist < 10 };
				if (nearest.sceneId !== lastNearId) {
					lastNearId = nearest.sceneId;
					nearRef.current = next;
					setNearScene(next);
				} else if (next.close !== nearRef.current?.close) {
					nearRef.current = next;
					setNearScene(next);
				}
			} else if (lastNearId !== "") {
				lastNearId = "";
				nearRef.current = null;
				setNearScene(null);
			}

			// Lazy load/dispose + scale animation
			for (const entry of entries.values()) {
				const d = camera.position.distanceTo(entry.worldPos);

				// Load when approaching (max 3 concurrent)
				if (entry.status === "idle" && d < 120 && activeLoads < 3) {
					loadSplat(entry);
				}
				// Dispose when retreating (hysteresis: 150 > 120 prevents thrash)
				if ((entry.status === "loaded" || entry.status === "loading") && d > 150) {
					disposeSplat(entry);
				}
				// Scale animation: tiny star far away → ghost orb close
				if (entry.status === "loaded" && entry.splatMesh) {
					const t = Math.max(0, Math.min(1, (70 - d) / 62));
					entry.splatMesh.scale.setScalar(0.04 + t * 0.26);
				}
				// Hide placeholder once splat is loaded and close
				entry.placeholderMesh.visible = entry.status !== "loaded" || d > 70;
			}

			renderer.render(threeScene, camera);
		}
		animate();

		// ── Resize ────────────────────────────────────────────────────────────────
		const onResize = () => {
			const w = canvas.clientWidth;
			const h = canvas.clientHeight;
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
			renderer.setSize(w, h, false);
		};
		const ro = new ResizeObserver(onResize);
		ro.observe(canvas);

		return () => {
			cancelAnimationFrame(rafId);
			ro.disconnect();
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("keyup", onKeyUp);
			controls.dispose();
			for (const ctrl of abortControllers.values()) ctrl.abort();
			for (const entry of entries.values()) {
				if (entry.splatMesh) {
					threeScene.remove(entry.splatMesh);
					entry.splatMesh.dispose();
				}
				entry.placeholderMesh.geometry.dispose();
				(entry.placeholderMesh.material as THREE.MeshBasicMaterial).dispose();
				threeScene.remove(entry.placeholderMesh);
			}
			starGeo.dispose();
			starMat.dispose();
			renderer.dispose();
		};
	}, [scenes]);

	return (
		<div style={{ position: "relative", width: "100%", height: "100%" }}>
			<canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />

			{/* Click-to-start overlay */}
			{!locked && (
				<div
					style={{
						position: "absolute",
						inset: 0,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						background: "rgba(0,0,0,0.55)",
						color: "#fff",
						fontFamily: "monospace",
						fontSize: 16,
						pointerEvents: "none",
					}}
				>
					<div style={{ textAlign: "center", lineHeight: 2 }}>
						<div style={{ fontSize: 28, marginBottom: 8, letterSpacing: 2 }}>THE UNIVERSE</div>
						<div style={{ color: "#aaa" }}>Click to explore</div>
						<div style={{ color: "#888", fontSize: 13, marginTop: 4 }}>
							WASD fly · Space/Q up/down · Shift sprint · E enter world
						</div>
					</div>
				</div>
			)}

			{/* Near scene label */}
			{locked && nearScene && (
				<div
					style={{
						position: "absolute",
						bottom: "28%",
						left: "50%",
						transform: "translateX(-50%)",
						background: "rgba(0,0,0,0.72)",
						color: "#fff",
						fontFamily: "monospace",
						padding: "8px 18px",
						borderRadius: 8,
						textAlign: "center",
						pointerEvents: "none",
					}}
				>
					<div style={{ fontSize: 15, fontWeight: "bold" }}>{nearScene.title}</div>
					{nearScene.close && (
						<div style={{ fontSize: 12, color: "#88ff88", marginTop: 3 }}>Press E to enter</div>
					)}
				</div>
			)}

			{/* Crosshair */}
			{locked && (
				<div
					style={{
						position: "absolute",
						top: "50%",
						left: "50%",
						transform: "translate(-50%,-50%)",
						width: 16,
						height: 16,
						pointerEvents: "none",
					}}
				>
					<div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, background: "rgba(255,255,255,0.65)" }} />
					<div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.65)" }} />
				</div>
			)}
		</div>
	);
}
