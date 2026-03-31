import { useEffect, useRef, useState } from "react";
import {
  WebGLRenderer,
  PerspectiveCamera,
  Scene,
  Color,
  AmbientLight,
  Clock,
  Vector3,
  Box3,
  Euler,
  BoxGeometry,
  MeshStandardMaterial,
  Mesh,
} from "three";
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
import {
  loadPhysicsProps,
  syncPhysicsProps,
  disposePhysicsProps,
  type PhysicsProp,
} from "../physics/pushable-objects.js";
import { pickObject } from "../physics/raycast-pick.js";
import { extractNpcs, findNearbyNpc, type NearbyNpc } from "../physics/npc-proximity.js";
import type { SceneObject, Viewpoint } from "../types.js";

interface Props {
  splatUrl: string;
  colliderMeshUrl?: string;
  sceneObjects?: SceneObject[];
  viewpoints?: Viewpoint[];
  onInteract?: (objectId: string, action: string) => void;
}

export function SplatViewer({ splatUrl, colliderMeshUrl, sceneObjects, viewpoints, onInteract }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [isLocked, setIsLocked] = useState(false);
  const [physicsReady, setPhysicsReady] = useState(false);
  const [nearbyNpc, setNearbyNpc] = useState<NearbyNpc | null>(null);
  const onInteractRef = useRef(onInteract);
  onInteractRef.current = onInteract;
  const isTouch = typeof window !== "undefined" && "ontouchstart" in window;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setStatus("loading");
    setIsLocked(false);
    setPhysicsReady(false);
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

    splat.initialized.then(() => {
      // Marble normalises all SPZ scenes so the floor sits at world Y = 0
      // and the default viewpoint is (0, 1.7, 0) — no bounding-box maths needed.
      // Using getBoundingBox() + matrixWorld arithmetic has consistently placed
      // the camera outside the scene across many iterations; don't do it.
      setStatus("ready");
    }).catch((err: unknown) => {
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

    const worldUp = new Vector3(0, 1, 0);

    // ── Free-fly: mouse-drag look + WASD ─────────────────────────────────────
    // No pointer lock in free-fly — mouse look only while button is held.
    // This avoids a race where the free-fly lock resolves before the physics
    // onClick fires, making the click act as a shoot instead of "enter".
    const flyEuler = new Euler(0, 0, 0, "YXZ");
    let freeFlyActive = true;
    let ffDragging = false;

    const onMouseDown = (e: MouseEvent) => {
      if (!freeFlyActive) return;
      // Right-click or middle-click: drag to look
      if (e.button !== 0) { ffDragging = true; e.preventDefault(); }
      // Left-click passes through to physics onClick (do NOT lock here)
    };
    const onMouseUp = () => { ffDragging = false; };
    const onMouseMove = (e: MouseEvent) => {
      if (!freeFlyActive || !ffDragging) return;
      const sens = 0.003;
      flyEuler.y -= e.movementX * sens;
      flyEuler.x -= e.movementY * sens;
      flyEuler.x = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, flyEuler.x));
      camera.rotation.copy(flyEuler);
    };
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mouseup",   onMouseUp);
    canvas.addEventListener("mousemove", onMouseMove);

    // Keep flyEuler in sync when camera is repositioned externally
    const syncEuler = () => { flyEuler.setFromQuaternion(camera.quaternion, "YXZ"); };

    const freeFlyFwd   = new Vector3();
    const freeFlyRight = new Vector3();
    const freeFlyMove  = new Vector3();

    function freeFlyLoop() {
      if (!freeFlyActive) return;
      animId = requestAnimationFrame(freeFlyLoop);
      if (keys.size > 0) {
        const spd = (keys.has("shift") ? 5 : 1) * 0.05;
        camera.getWorldDirection(freeFlyFwd);
        freeFlyFwd.y = 0;
        if (freeFlyFwd.lengthSq() > 0.0001) freeFlyFwd.normalize();
        freeFlyRight.crossVectors(freeFlyFwd, worldUp).normalize();
        freeFlyMove.set(0, 0, 0);
        if (keys.has("w") || keys.has("arrowup"))    freeFlyMove.addScaledVector(freeFlyFwd,    spd);
        if (keys.has("s") || keys.has("arrowdown"))  freeFlyMove.addScaledVector(freeFlyFwd,   -spd);
        if (keys.has("a") || keys.has("arrowleft"))  freeFlyMove.addScaledVector(freeFlyRight,  -spd);
        if (keys.has("d") || keys.has("arrowright")) freeFlyMove.addScaledVector(freeFlyRight,   spd);
        if (freeFlyMove.lengthSq() > 0) camera.position.add(freeFlyMove);
      }
      renderer.render(scene, camera);
    }
    freeFlyLoop();

    function stopFreeFly() {
      freeFlyActive = false;
      ffDragging = false;
      cancelAnimationFrame(animId);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mouseup",   onMouseUp);
      canvas.removeEventListener("mousemove", onMouseMove);
    }

    function restartFreeFly() {
      syncEuler();
      freeFlyActive = true;
      freeFlyLoop();
    }

    // Default cleanup (used if physics never initialises)
    cleanupPhysics = () => { stopFreeFly(); };

    // ── Physics loop ──────────────────────────────────────────────────────────
    // Loads asynchronously while free-fly keeps rendering. On success, free-fly
    // continues until the user clicks to enter (pointer lock). At that point the
    // character body is teleported to the camera's current position so physics
    // starts from inside the scene, not from an arbitrary spawn coordinate.
    async function initPhysics() {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const cv: HTMLCanvasElement = canvas!;
      if (cancelled) return;

      const RAPIER = await getRapier();
      if (cancelled) return;

      const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); // standard -Y gravity; after PI-bake the floor is at world Y < camera
      await buildWorldColliders(world, colliderMeshUrl!);
      if (cancelled) { world.free(); return; }

      const cc = createCharacterController(world);

      const props: PhysicsProp[] = await loadPhysicsProps(
        world,
        scene,
        sceneObjects ?? [],
        viewpoints ?? [],
      );
      if (cancelled) { disposePhysicsProps(props, world, scene); world.free(); return; }
      const propMeshes = props.flatMap((p) => p.meshes);
      const projectiles: Projectile[] = [];
      const npcs = extractNpcs(sceneObjects ?? []);

      // Physics loaded — free-fly is still running; show the "Click to enter" overlay
      setPhysicsReady(true);

      const plc = new PointerLockControls(camera, cv);
      let inPhysicsMode = false;

      const tempBoxGeo = new BoxGeometry(0.6, 0.6, 0.6);
      const tempBoxMat = new MeshStandardMaterial({ color: 0x4488cc });
      const tempBoxes: { body: InstanceType<typeof RAPIER.RigidBody>; mesh: Mesh }[] = [];

      const fwd = new Vector3();
      const right = new Vector3();
      let lastNearbyId: string | null = null;

      const doShoot = () => shootProjectile(world, camera, scene, projectiles);
      const doInteract = (npc: NearbyNpc) => {
        onInteractRef.current?.(npc.objectId, npc.interactionHint ?? "你好");
      };

      function physicsLoop() {
        if (!inPhysicsMode) return;
        animId = requestAnimationFrame(physicsLoop);
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
        // Eye is 0.8m above body center (standard Y-up: eye = body.y + 0.8)
        camera.position.set(pos.x, pos.y + 0.8, pos.z);
        (window as unknown as Record<string, unknown>).__playerPosition = { x: pos.x, y: pos.y, z: pos.z };

        if (npcs.length > 0) {
          const nearby = findNearbyNpc(npcs, pos.x, pos.y + 0.8, pos.z);
          const newId = nearby?.objectId ?? null;
          if (newId !== lastNearbyId) {
            lastNearbyId = newId;
            setNearbyNpc(nearby);
            (window as unknown as Record<string, unknown>).__nearbyNpc = nearby;
          }
        }

        for (const b of tempBoxes) {
          const t = b.body.translation();
          b.mesh.position.set(t.x, t.y, t.z);
          const r = b.body.rotation();
          b.mesh.quaternion.set(r.x, r.y, r.z, r.w);
        }
        syncProjectiles(projectiles);
        syncPhysicsProps(props);
        cleanupOldProjectiles(world, projectiles, scene);

        renderer.render(scene, camera);
      }

      const onLockChange = () => {
        const locked = document.pointerLockElement === cv;
        setIsLocked(locked);
        if (locked && !inPhysicsMode) {
          stopFreeFly();
          // Marble scenes: floor at world Y=0, camera eye at Y=1.7.
          // Body centre = camera.y - 0.8 = 0.9; capsule bottom = 0 = floor.
          // No raycast needed — floor position is always Y=0 by Marble convention.
          cc.body.setNextKinematicTranslation({
            x: camera.position.x,
            y: camera.position.y - 0.8,
            z: camera.position.z,
          });
          cc.verticalVel = 0;
          world.step(); // commit teleport before cc.move() reads body.translation()
          clock.getDelta(); // flush accumulated delta
          inPhysicsMode = true;
          physicsLoop();
        } else if (!locked && inPhysicsMode) {
          // Transition: physics walking → free-fly (Escape key)
          inPhysicsMode = false;
          cancelAnimationFrame(animId);
          syncEuler(); // sync free-fly rotation from current camera state
          restartFreeFly();
        }
      };
      document.addEventListener("pointerlockchange", onLockChange);

      const onClick = () => {
        if (document.pointerLockElement !== cv) { plc.lock(); return; }
        doShoot();
      };
      const onContextMenu = (e: MouseEvent) => { e.preventDefault(); };
      const onKeyAction = (e: KeyboardEvent) => {
        const k = e.key.toLowerCase();
        if (k === "f" && document.pointerLockElement === cv) { doShoot(); return; }
        if (k === "g" && document.pointerLockElement === cv) {
          // Spawn a pushable box 2m ahead of the camera
          const dir = new Vector3();
          camera.getWorldDirection(dir);
          dir.y = 0;
          if (dir.lengthSq() < 0.0001) dir.set(0, 0, 1);
          dir.normalize();
          const pos = camera.position.clone().addScaledVector(dir, 2);
          const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(pos.x, pos.y, pos.z)
            .setAdditionalMass(10);
          const body = world.createRigidBody(bodyDesc);
          const HALF = 0.3;
          world.createCollider(
            RAPIER.ColliderDesc.cuboid(HALF, HALF, HALF).setRestitution(0.3).setFriction(0.8),
            body,
          );
          const mesh = new Mesh(tempBoxGeo, tempBoxMat);
          mesh.position.copy(pos);
          scene.add(mesh);
          tempBoxes.push({ body, mesh });
          return;
        }
        if (k === "e") {
          if (document.pointerLockElement === cv) {
            const propId = pickObject(camera, propMeshes, 4);
            if (propId) { onInteractRef.current?.(propId, "pick"); return; }
          }
          const npc = (window as unknown as Record<string, unknown>).__nearbyNpc as NearbyNpc | null;
          if (npc) doInteract(npc);
        }
      };
      cv.addEventListener("click", onClick);
      cv.addEventListener("contextmenu", onContextMenu);
      window.addEventListener("keydown", onKeyAction);

      (window as unknown as Record<string, unknown>).__physicsShoot = doShoot;
      (window as unknown as Record<string, unknown>).__physicsInteract = () => {
        const npc = (window as unknown as Record<string, unknown>).__nearbyNpc as NearbyNpc | null;
        if (npc) doInteract(npc);
      };
      (window as unknown as Record<string, unknown>).__nearbyNpc = null;

      cleanupPhysics = () => {
        inPhysicsMode = false;
        stopFreeFly();
        plc.dispose();
        document.removeEventListener("pointerlockchange", onLockChange);
        cv.removeEventListener("click", onClick);
        cv.removeEventListener("contextmenu", onContextMenu);
        window.removeEventListener("keydown", onKeyAction);
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
        for (const b of tempBoxes) {
          world.removeRigidBody(b.body);
          scene.remove(b.mesh);
        }
        tempBoxGeo.dispose();
        tempBoxMat.dispose();
        disposePhysicsProps(props, world, scene);
        world.free();
      };
    }

    let cancelled = false;

    if (colliderMeshUrl) {
      initPhysics().catch((err: unknown) => {
        if (!cancelled) {
          console.error("[SplatViewer] physics init failed, staying in free-fly:", err);
          // free-fly loop is already running — nothing to do
        }
      });
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
      {physicsReady && status === "ready" && !isLocked && (
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
      {physicsReady && status === "ready" && isLocked && nearbyNpc && (
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
      {physicsReady && status === "ready" && isTouch && isLocked && (
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
