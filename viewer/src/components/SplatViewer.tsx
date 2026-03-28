import { useEffect, useRef, useState } from "react";
import {
  WebGLRenderer,
  PerspectiveCamera,
  Scene,
  Color,
  AmbientLight,
  Clock,
  Vector3,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { getRapier } from "../physics/init-rapier.js";
import { buildWorldColliders } from "../physics/build-world-colliders.js";
import { createCharacterController } from "../physics/character-controller.js";
import {
  shootProjectile,
  syncProjectiles,
  cleanupOldProjectiles,
  type Projectile,
} from "../physics/projectiles.js";
import { addPushableBoxes, syncPushableObjects, type PushableObject } from "../physics/pushable-objects.js";
import { extractNpcs, findNearbyNpc, type NearbyNpc } from "../physics/npc-proximity.js";
import type { SceneObject } from "../types.js";

interface Props {
  splatUrl: string;
  colliderMeshUrl?: string;
  sceneObjects?: SceneObject[];
  onInteract?: (objectId: string, action: string) => void;
}

export function SplatViewer({ splatUrl, colliderMeshUrl, sceneObjects, onInteract }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [isLocked, setIsLocked] = useState(false);
  const [nearbyNpc, setNearbyNpc] = useState<NearbyNpc | null>(null);
  const onInteractRef = useRef(onInteract);
  onInteractRef.current = onInteract;
  const isTouch = typeof window !== "undefined" && "ontouchstart" in window;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setStatus("loading");
    setIsLocked(false);
    setNearbyNpc(null);

    const renderer = new WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    const scene = new Scene();
    scene.background = new Color(0x0a0a14);
    scene.add(new AmbientLight(0xffffff, 0.6));

    const camera = new PerspectiveCamera(65, canvas.clientWidth / canvas.clientHeight, 0.01, 1000);
    camera.position.set(0, 1.7, 0);

    const clock = new Clock();
    const sparkRenderer = new SparkRenderer({ renderer, clock });
    scene.add(sparkRenderer);

    const splat = new SplatMesh({ url: splatUrl });
    splat.rotation.x = Math.PI;
    scene.add(splat);

    splat.initialized.then(() => setStatus("ready")).catch((err: unknown) => {
      setErrorMsg(err instanceof Error ? err.message : "Failed to load splat file");
      setStatus("error");
    });

    // ── Resize observer ───────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(canvas);

    // ── WASD key state ────────────────────────────────────────────────────────
    const keys = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      keys.add(e.key.toLowerCase());
    };
    const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    let animId: number;
    let cleanupPhysics: (() => void) | null = null;

    // ── Free-fly loop (no physics) ────────────────────────────────────────────
    function startFreeFlyLoop() {
      const controls = new OrbitControls(camera, canvas);
      controls.target.set(0, 1.7, 5);
      controls.enableDamping = true;
      controls.dampingFactor = 0.1;
      controls.update();

      const fwd = new Vector3();
      const right = new Vector3();
      const wasdMove = new Vector3();
      const worldUp = new Vector3(0, 1, 0);

      function loop() {
        animId = requestAnimationFrame(loop);
        if (keys.size > 0) {
          const spd = (keys.has("shift") ? 4 : 1) * 0.012;
          camera.getWorldDirection(fwd);
          fwd.y = 0;
          if (fwd.lengthSq() > 0.0001) fwd.normalize();
          right.crossVectors(fwd, worldUp).normalize();
          wasdMove.set(0, 0, 0);
          if (keys.has("w") || keys.has("arrowup"))    wasdMove.addScaledVector(fwd,   spd);
          if (keys.has("s") || keys.has("arrowdown"))  wasdMove.addScaledVector(fwd,  -spd);
          if (keys.has("a") || keys.has("arrowleft"))  wasdMove.addScaledVector(right, -spd);
          if (keys.has("d") || keys.has("arrowright")) wasdMove.addScaledVector(right,  spd);
          if (wasdMove.lengthSq() > 0) {
            camera.position.add(wasdMove);
            controls.target.add(wasdMove);
          }
        }
        controls.update();
        renderer.render(scene, camera);
      }
      animId = requestAnimationFrame(loop);
      cleanupPhysics = () => controls.dispose();
    }

    // ── Physics loop ──────────────────────────────────────────────────────────
    async function startPhysicsLoop() {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const cv: HTMLCanvasElement = canvas!;
      if (cancelled) return;

      const RAPIER = await getRapier();
      if (cancelled) return;

      const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

      await buildWorldColliders(world, colliderMeshUrl!);
      if (cancelled) { world.free(); return; }

      const cc = createCharacterController(world);
      const pushables: PushableObject[] = addPushableBoxes(world, scene);
      const projectiles: Projectile[] = [];
      const npcs = extractNpcs(sceneObjects ?? []);

      // PointerLockControls for mouse look
      const plc = new PointerLockControls(camera, cv);
      const onLockChange = () => setIsLocked(document.pointerLockElement === cv);
      document.addEventListener("pointerlockchange", onLockChange);

      // Left-click when locked OR F key: shoot. Left-click when unlocked: lock pointer.
      const doShoot = () => shootProjectile(world, camera, scene, projectiles);
      const doInteract = (npc: NearbyNpc) => {
        onInteractRef.current?.(npc.objectId, npc.interactionHint ?? "你好");
      };

      const onClick = () => {
        if (document.pointerLockElement !== cv) { plc.lock(); return; }
        doShoot();
      };
      const onContextMenu = (e: MouseEvent) => { e.preventDefault(); };
      const onKeyShoot = (e: KeyboardEvent) => {
        const k = e.key.toLowerCase();
        if (k === "f" && document.pointerLockElement === cv) { doShoot(); return; }
        if (k === "e") {
          const npc = (window as unknown as Record<string, unknown>).__nearbyNpc as NearbyNpc | null;
          if (npc) doInteract(npc);
        }
      };
      cv.addEventListener("click", onClick);
      cv.addEventListener("contextmenu", onContextMenu);
      window.addEventListener("keydown", onKeyShoot);

      // Expose callbacks for touch buttons
      (window as unknown as Record<string, unknown>).__physicsShoot = doShoot;
      (window as unknown as Record<string, unknown>).__physicsInteract = () => {
        const npc = (window as unknown as Record<string, unknown>).__nearbyNpc as NearbyNpc | null;
        if (npc) doInteract(npc);
      };
      (window as unknown as Record<string, unknown>).__nearbyNpc = null;

      const fwd = new Vector3();
      const right = new Vector3();
      const worldUp = new Vector3(0, 1, 0);
      let lastNearbyId: string | null = null;

      function loop() {
        animId = requestAnimationFrame(loop);
        const delta = clock.getDelta();
        const spd = (keys.has("shift") ? 4 : 1) * 4 * delta;

        camera.getWorldDirection(fwd);
        fwd.y = 0;
        if (fwd.lengthSq() > 0.0001) fwd.normalize();
        right.crossVectors(fwd, worldUp).normalize();

        let dx = 0; let dz = 0;
        if (keys.has("w") || keys.has("arrowup"))    { dx += fwd.x * spd;   dz += fwd.z * spd; }
        if (keys.has("s") || keys.has("arrowdown"))  { dx -= fwd.x * spd;   dz -= fwd.z * spd; }
        if (keys.has("a") || keys.has("arrowleft"))  { dx -= right.x * spd; dz -= right.z * spd; }
        if (keys.has("d") || keys.has("arrowright")) { dx += right.x * spd; dz += right.z * spd; }

        cc.move(world, { x: dx, z: dz }, delta);
        world.step();

        const pos = cc.body.translation();
        camera.position.set(pos.x, pos.y + 0.8, pos.z);
        (window as unknown as Record<string, unknown>).__playerPosition = { x: pos.x, y: pos.y, z: pos.z };

        // NPC proximity check (every frame, cheap distance math)
        if (npcs.length > 0) {
          const nearby = findNearbyNpc(npcs, pos.x, pos.y + 0.8, pos.z);
          const newId = nearby?.objectId ?? null;
          if (newId !== lastNearbyId) {
            lastNearbyId = newId;
            setNearbyNpc(nearby);
            (window as unknown as Record<string, unknown>).__nearbyNpc = nearby;
          }
        }

        syncProjectiles(projectiles);
        syncPushableObjects(pushables);
        cleanupOldProjectiles(world, projectiles, scene);

        renderer.render(scene, camera);
      }
      animId = requestAnimationFrame(loop);

      cleanupPhysics = () => {
        plc.dispose();
        document.removeEventListener("pointerlockchange", onLockChange);
        cv.removeEventListener("click", onClick);
        cv.removeEventListener("contextmenu", onContextMenu);
        window.removeEventListener("keydown", onKeyShoot);
        delete (window as unknown as Record<string, unknown>).__physicsShoot;
        delete (window as unknown as Record<string, unknown>).__physicsInteract;
        delete (window as unknown as Record<string, unknown>).__nearbyNpc;
        delete (window as unknown as Record<string, unknown>).__playerPosition;
        if (document.pointerLockElement === cv) document.exitPointerLock();
        for (const p of projectiles) {
          world.removeRigidBody(p.body);
          scene.remove(p.mesh);
          p.mesh.geometry.dispose();
        }
        for (const o of pushables) {
          world.removeRigidBody(o.body);
          scene.remove(o.mesh);
          o.mesh.geometry.dispose();
        }
        world.free();
      };
    }

    let cancelled = false;

    if (colliderMeshUrl) {
      startPhysicsLoop().catch((err: unknown) => {
        if (!cancelled) {
          console.error("[SplatViewer] physics init failed, falling back to free-fly:", err);
          startFreeFlyLoop();
        }
      });
    } else {
      startFreeFlyLoop();
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(animId);
      ro.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      cleanupPhysics?.();
      splat.dispose();
      renderer.dispose();
    };
  // sceneObjects and onInteract are accessed via refs — not reactive dependencies
  }, [splatUrl, colliderMeshUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />

      {/* Physics mode: "click to enter" overlay */}
      {colliderMeshUrl && status === "ready" && !isLocked && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)",
          color: "rgba(200,220,255,0.9)",
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontSize: 15, letterSpacing: 0.5,
          pointerEvents: "none",
        }}>
          {isTouch
            ? "Tap to enter · WASD to walk · Shoot button to fire"
            : "Click to enter · WASD to walk · Click or F to shoot · E to talk"}
        </div>
      )}

      {/* NPC proximity prompt — shown when walking near an NPC */}
      {colliderMeshUrl && status === "ready" && isLocked && nearbyNpc && (
        <div style={{
          position: "absolute", bottom: 120, left: "50%", transform: "translateX(-50%)",
          background: "rgba(10,10,30,0.82)", backdropFilter: "blur(6px)",
          border: "1px solid rgba(120,160,255,0.3)",
          borderRadius: 10, padding: "10px 20px",
          color: "rgba(200,220,255,0.95)",
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontSize: 14, letterSpacing: 0.4,
          display: "flex", alignItems: "center", gap: 12,
          pointerEvents: isTouch ? "auto" : "none",
        }}>
          <span style={{
            background: "rgba(120,160,255,0.2)", border: "1px solid rgba(120,160,255,0.5)",
            borderRadius: 4, padding: "1px 7px", fontSize: 12, fontWeight: 700,
          }}>
            {isTouch ? "TAP" : "E"}
          </span>
          与 {nearbyNpc.name} 对话
          {isTouch && (
            <button
              onPointerDown={(e) => {
                e.preventDefault();
                const interact = (window as unknown as Record<string, unknown>).__physicsInteract;
                if (typeof interact === "function") interact();
              }}
              style={{
                marginLeft: 8, padding: "4px 14px", borderRadius: 6,
                background: "rgba(120,160,255,0.25)", border: "1px solid rgba(120,160,255,0.5)",
                color: "rgba(200,220,255,0.95)", fontSize: 13, cursor: "pointer",
              }}
            >
              对话
            </button>
          )}
        </div>
      )}

      {/* Touch shoot button */}
      {colliderMeshUrl && status === "ready" && isTouch && isLocked && (
        <button
          onPointerDown={(e) => {
            e.preventDefault();
            const shoot = (window as unknown as Record<string, unknown>).__physicsShoot;
            if (typeof shoot === "function") shoot();
          }}
          style={{
            position: "absolute", bottom: 40, right: 32,
            width: 72, height: 72, borderRadius: "50%",
            background: "rgba(255,80,0,0.75)", border: "2px solid rgba(255,160,80,0.6)",
            color: "#fff", fontSize: 13, fontWeight: 600,
            fontFamily: "system-ui, sans-serif", letterSpacing: 0.5,
            cursor: "pointer", touchAction: "none",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          SHOOT
        </button>
      )}

      {/* Loading overlay */}
      {status === "loading" && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          background: "rgba(10,10,20,0.85)",
          backdropFilter: "blur(8px)",
          color: "rgba(200,220,255,0.9)",
          fontFamily: "system-ui, -apple-system, sans-serif",
          gap: 16,
        }}>
          <div style={{ fontSize: 14, letterSpacing: 0.5 }}>Loading Gaussian Splat…</div>
          <div style={{
            width: 120, height: 3, borderRadius: 2,
            background: "rgba(255,255,255,0.1)",
            overflow: "hidden",
          }}>
            <div style={{
              height: "100%",
              background: "linear-gradient(90deg, #7c4dff, #448aff)",
              animation: "splatScan 1.4s ease-in-out infinite",
            }} />
          </div>
          <style>{`
            @keyframes splatScan {
              0%   { width: 0%;   margin-left: 0; }
              50%  { width: 80%;  margin-left: 10%; }
              100% { width: 0%;   margin-left: 100%; }
            }
          `}</style>
        </div>
      )}

      {/* Error overlay */}
      {status === "error" && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          background: "rgba(10,5,5,0.88)",
          color: "#f87171",
          fontFamily: "system-ui, -apple-system, sans-serif",
          gap: 10, padding: 32, textAlign: "center",
        }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Failed to load splat</div>
          <div style={{ fontSize: 13, color: "rgba(248,113,113,0.7)", maxWidth: 360 }}>{errorMsg}</div>
        </div>
      )}
    </div>
  );
}
