import { useEffect, useRef, useState } from "react";
import {
  WebGLRenderer,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  Scene,
  Color,
  AmbientLight,
  DirectionalLight,
  ACESFilmicToneMapping,
  PMREMGenerator,
  Clock,
  Vector3,
  Box3,
  Euler,
  BoxGeometry,
  SphereGeometry,
  MeshStandardMaterial,
  Mesh,
} from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { getRapier } from "../physics/init-rapier.js";
import { buildWorldColliders } from "../physics/build-world-colliders.js";
import { createCharacterController } from "../physics/character-controller.js";
import {
  loadPhysicsProps,
  loadGltf,
  buildCollider,
  syncPhysicsProps,
  disposePhysicsProps,
  type PhysicsProp,
} from "../physics/pushable-objects.js";
import { type PlacementHint, resolvePosition } from "../physics/prop-placement.js";
import { pickObject } from "../physics/raycast-pick.js";
import { extractNpcs } from "../physics/npc-proximity.js";
import type { SceneObject, Viewpoint } from "../types.js";
import type { AssetEntry } from "../renderer/asset-catalog.js";
import { ASSET_CATALOG } from "../renderer/asset-catalog.js";
import { patchSceneObjectPosition } from "../api.js";
import { PropPicker } from "./PropPicker.js";
import { ObjectRendererRegistry } from "../renderer/object-renderer.js";
import { GltfObjectRenderer } from "../renderer/gltf-object-renderer.js";

interface Props {
  splatUrl: string;
  colliderMeshUrl?: string;
  sceneObjects?: SceneObject[];
  viewpoints?: Viewpoint[];
  splatGroundOffset?: number;
  sceneId?: string;
  sessionId?: string;
  onInteract?: (objectId: string, action: string) => void;
  onAddProp?: (entry: AssetEntry, objectId: string) => void;
  onPlacementRequest?: (text: string) => void;
  onNpcApproach?: (objectId: string, name: string) => void;
  onNpcLeave?: () => void;
  npcSpeech?: { npcId: string; npcName: string; text: string } | null;
  npcPlacementPending?: boolean;
  onNpcPlace?: (pos: { x: number; y: number; z: number }) => void;
  onNpcPlaceCancel?: () => void;
  propPlacementPending?: boolean;
  onPropPlace?: (pos: { x: number; y: number; z: number }) => void;
  onPropPlaceCancel?: () => void;
}

// Module-level registry so it is constructed once and shared across mounts.
const objectRendererRegistry = new ObjectRendererRegistry().register(new GltfObjectRenderer());

export function SplatViewer({ splatUrl, colliderMeshUrl, sceneObjects, viewpoints, splatGroundOffset, sceneId, sessionId, onInteract, onAddProp, onPlacementRequest, onNpcApproach, onNpcLeave, npcSpeech, npcPlacementPending, onNpcPlace, onNpcPlaceCancel, propPlacementPending, onPropPlace, onPropPlaceCancel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [isLocked, setIsLocked] = useState(false);
  const [physicsReady, setPhysicsReady] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const selectedPropRef = useRef<AssetEntry | null>(null);
  const onAddPropRef = useRef(onAddProp);
  onAddPropRef.current = onAddProp;
  const [clickIndicator, setClickIndicator] = useState<{ x: number; y: number } | null>(null);
  const [propLoadErrors, setPropLoadErrors] = useState<string[]>([]);
  const [placementMode, setPlacementMode] = useState(false);
  const placementModeActiveRef = useRef(false);
  const doPlacementRef = useRef<((text: string) => void) | null>(null);
  const exitPlacementRef = useRef<(() => void) | null>(null);
  const lastMousePosRef = useRef({ x: 0, y: 0 });
  const onInteractRef = useRef(onInteract);
  onInteractRef.current = onInteract;
  const sceneObjectsRef = useRef(sceneObjects);
  sceneObjectsRef.current = sceneObjects;
  // NPC resolved positions — populated by loadSceneNpc when physics runs,
  // empty when no collider mesh (proximity falls back to SceneObject.position).
  const npcPositionsRef = useRef<Map<string, { x: number; y: number; z: number }>>(new Map());
  // NPC Three.js groups — populated by both the physics path and the no-physics fallback.
  const npcGroupsRef = useRef<Map<string, import("three").Group>>(new Map());
  const onPlacementRequestRef = useRef(onPlacementRequest);
  onPlacementRequestRef.current = onPlacementRequest;
  const onNpcPlaceRef = useRef(onNpcPlace);
  onNpcPlaceRef.current = onNpcPlace;
  const onNpcPlaceCancelRef = useRef(onNpcPlaceCancel);
  onNpcPlaceCancelRef.current = onNpcPlaceCancel;
  const npcPlacementPendingRef = useRef(npcPlacementPending);
  npcPlacementPendingRef.current = npcPlacementPending;
  const onPropPlaceRef = useRef(onPropPlace);
  onPropPlaceRef.current = onPropPlace;
  const onPropPlaceCancelRef = useRef(onPropPlaceCancel);
  onPropPlaceCancelRef.current = onPropPlaceCancel;
  const propPlacementPendingRef = useRef(propPlacementPending);
  propPlacementPendingRef.current = propPlacementPending;
  const onNpcApproachRef = useRef(onNpcApproach);
  onNpcApproachRef.current = onNpcApproach;
  const onNpcLeaveRef = useRef(onNpcLeave);
  onNpcLeaveRef.current = onNpcLeave;
  const isTouch = typeof window !== "undefined" && "ontouchstart" in window;

  // Exit pointer lock when entering placement mode so clicks reach the free-fly handler.
  useEffect(() => {
    if ((propPlacementPending || npcPlacementPending) && document.pointerLockElement) {
      document.exitPointerLock();
    }
  }, [propPlacementPending, npcPlacementPending]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setStatus("loading");
    setIsLocked(false);
    setPhysicsReady(false);
    setClickIndicator(null);
    setPlacementMode(false);
    placementModeActiveRef.current = false;

    // Shared ref so the free-fly left-click handler can access the Rapier world
    // after physics initialises, without a React re-render cycle.
    const physicsRef: {
      world: { castRay: (ray: unknown, maxToi: number, solid: boolean) => { timeOfImpact: number } | null } | null;
      RAPIER: { Ray: new (o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }) => unknown } | null;
    } = { world: null, RAPIER: null };

    let clickIndicatorTimer: ReturnType<typeof setTimeout> | null = null;

    const renderer = new WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.85;

    const scene = new Scene();
    scene.background = new Color(0x0a0a14);
    scene.add(new AmbientLight(0xffffff, 0.5));
    const sunLight = new DirectionalLight(0xfff4e0, 1.2);
    sunLight.position.set(5, 10, 5);
    scene.add(sunLight);

    // IBL env map — loaded async from Polyhaven; applied to GLTF props once ready.
    let sceneEnvMap: import("three").Texture | null = null;
    const pmrem = new PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    new RGBELoader()
      .loadAsync("https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloofendal_48d_partly_cloudy_puresky_1k.hdr")
      .then((equirect) => {
        sceneEnvMap = pmrem.fromEquirectangular(equirect).texture;
        pmrem.dispose();
        equirect.dispose();
      })
      .catch(() => { pmrem.dispose(); }); // non-fatal — props still render without IBL

    const camera = new PerspectiveCamera(65, canvas.clientWidth / canvas.clientHeight, 0.01, 1000);
    camera.position.set(0, 1.7, 0);

    const clock = new Clock();
    const sparkRenderer = new SparkRenderer({ renderer, clock });
    scene.add(sparkRenderer);

    const splat = new SplatMesh({ url: splatUrl });
    splat.rotation.x = Math.PI;
    scene.add(splat);
    let splatInitialized = false;
    splat.initialized.then(() => {
      splatInitialized = true;
      // setStatus("ready") is deferred to freeFlyLoop — it samples the canvas
      // pixel to confirm SparkRenderer has actually uploaded and drawn the scene.
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
      const k = e.key.toLowerCase();
      keys.add(k);
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

    // NPC meshes — populated by loadSceneNpc, used for click-to-talk raycasting.
    const npcMeshList: Mesh[] = [];

    const onMouseDown = (e: MouseEvent) => {
      if (!freeFlyActive) return;
      if (e.button === 0) {
        // Left-click: raycast against physics colliders to record click target
        const pw = physicsRef.world;
        const R = physicsRef.RAPIER;
        if (pw && R) {
          const rect = canvas.getBoundingClientRect();
          const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
          const raycaster = new Raycaster();
          raycaster.setFromCamera(new Vector2(nx, ny), camera);
          const origin = raycaster.ray.origin;
          const dir = raycaster.ray.direction;
          const ray = new R.Ray(
            { x: origin.x, y: origin.y, z: origin.z },
            { x: dir.x, y: dir.y, z: dir.z },
          );
          const hit = pw.castRay(ray, 200, true);
          if (hit) {
            const pt = {
              x: origin.x + dir.x * hit.timeOfImpact,
              y: origin.y + dir.y * hit.timeOfImpact,
              z: origin.z + dir.z * hit.timeOfImpact,
              ts: Date.now(),
            };
            (window as unknown as Record<string, unknown>).__clickPosition = pt;
            // If NPC placement is pending, deliver the hit position and consume the click
            if (npcPlacementPendingRef.current) {
              onNpcPlaceRef.current?.({ x: pt.x, y: pt.y, z: pt.z });
              return;
            }
            // If prop placement is pending, deliver the hit position and consume the click
            if (propPlacementPendingRef.current) {
              onPropPlaceRef.current?.({ x: pt.x, y: pt.y, z: pt.z });
              return;
            }
            // Show 2-second visual indicator dot at screen position
            if (clickIndicatorTimer !== null) clearTimeout(clickIndicatorTimer);
            setClickIndicator({ x: e.clientX - rect.left, y: e.clientY - rect.top });
            clickIndicatorTimer = setTimeout(() => setClickIndicator(null), 2000);
          }
        } else if (npcPlacementPendingRef.current || propPlacementPendingRef.current) {
          // No physics world available — intersect camera ray with a horizontal ground plane.
          // splatGroundOffset is the Marble ground_plane_offset — negate for Three.js world Y.
          const groundY = splatGroundOffset !== undefined ? -splatGroundOffset : (camera.position.y - 1.7);
          const rect = canvas.getBoundingClientRect();
          const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
          const raycaster = new Raycaster();
          raycaster.setFromCamera(new Vector2(nx, ny), camera);
          const origin = raycaster.ray.origin;
          const dir = raycaster.ray.direction;
          // Solve ray-plane intersection: origin.y + t * dir.y = groundY
          if (Math.abs(dir.y) > 0.001) {
            const t = (groundY - origin.y) / dir.y;
            if (t > 0) {
              const pt = { x: origin.x + dir.x * t, y: groundY, z: origin.z + dir.z * t };
              if (npcPlacementPendingRef.current) {
                onNpcPlaceRef.current?.(pt);
              } else {
                onPropPlaceRef.current?.(pt);
              }
            }
          }
        }
        return; // left-click does not start drag
      }
      // Right-click or middle-click: drag to look
      ffDragging = true;
      e.preventDefault();
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
      // Once the splat is parsed, sample the center pixel each frame.
      // SparkRenderer uploads to GPU asynchronously; the scene is visible only
      // after the first non-background draw call completes.
      if (splatInitialized && canvas!.clientWidth > 0 && canvas!.clientHeight > 0) {
        const gl = renderer.getContext();
        const px = new Uint8Array(4);
        gl.readPixels(
          Math.floor(canvas!.clientWidth / 2),
          Math.floor(canvas!.clientHeight / 2),
          1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px,
        );
        // Background is 0x0a0a14 (10,10,20) — any meaningfully brighter pixel means the scene rendered
        if (px[0] > 20 || px[1] > 20 || px[2] > 30) {
          splatInitialized = false; // stop sampling
          setStatus("ready");
        }
      }
    }
    freeFlyLoop();

    function stopFreeFly() {
      freeFlyActive = false;
      ffDragging = false;
      cancelAnimationFrame(animId);
      canvas!.removeEventListener("mousedown", onMouseDown);
      canvas!.removeEventListener("mouseup",   onMouseUp);
      canvas!.removeEventListener("mousemove", onMouseMove);
    }

    function restartFreeFly() {
      syncEuler();
      freeFlyActive = true;
      canvas!.addEventListener("mousedown", onMouseDown);
      canvas!.addEventListener("mouseup",   onMouseUp);
      canvas!.addEventListener("mousemove", onMouseMove);
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

      const disposed = { value: false };
      const props: PhysicsProp[] = loadPhysicsProps(
        world,
        scene,
        sceneObjects ?? [],
        viewpoints ?? [],
        disposed,
        splatGroundOffset,
        (name) => setPropLoadErrors((prev) => [...prev, name]),
      );
      if (cancelled) { disposed.value = true; disposePhysicsProps(props, world, scene); world.free(); return; }

      // NPC position overrides — maps objectId → resolved world position.
      // SceneObjects start with position {0,0,0}; after a model loads its resolved
      // position is stored here and used by the proximity check.
      const npcPositions = npcPositionsRef.current;
      npcPositions.clear();
      // Three.js groups for NPC models — cleaned up alongside props on teardown.
      const npcGroups = new Map<string, import("three").Group>();

      // Load a single NPC model and register its resolved position.
      const loadSceneNpc = async (obj: import("../types.js").SceneObject): Promise<void> => {
        // Skip if already registered (dedup guard for concurrent loadSceneById + scene_updated calls)
        if (npcPositions.has(obj.objectId)) return;
        const modelUrl = obj.metadata.modelUrl as string | undefined;
        if (!modelUrl) {
          // No model — register position and create an invisible sphere hitbox so
          // the NPC is still clickable via the raycaster.
          const pos = { x: obj.position.x, y: obj.position.y, z: obj.position.z };
          npcPositions.set(obj.objectId, pos);
          const hitbox = new Mesh(
            new SphereGeometry(0.6, 8, 8),
            new MeshStandardMaterial({ transparent: true, opacity: 0, depthWrite: false }),
          );
          hitbox.position.set(pos.x, pos.y + 1.0, pos.z);
          hitbox.userData.npcObjectId = obj.objectId;
          hitbox.userData.npcName = obj.name;
          hitbox.renderOrder = -1;
          scene.add(hitbox);
          npcMeshList.push(hitbox);
          npcGroups.set(obj.objectId, hitbox as unknown as import("three").Group);
          return;
        }
        const scale = typeof obj.metadata.scale === "number" ? obj.metadata.scale : 1;
        const hint = obj.metadata.placement as PlacementHint | undefined;
        const playerPos = obj.metadata.playerPosition as { x: number; y: number; z: number } | undefined;
        const cameraFwd = obj.metadata.cameraForward as { x: number; z: number } | undefined;
        const occupied = [...npcPositions.values(), ...props.map((p) => { const t = p.body.translation(); return { x: t.x, y: t.y, z: t.z }; })];
        const pos = resolvePosition(hint, world, occupied, viewpoints ?? [], npcGroups.size, playerPos, splatGroundOffset, cameraFwd);
        npcPositions.set(obj.objectId, pos);

        // Lock position back to server so it is stable on next reload.
        if (hint !== "exact" && sceneId && sessionId) {
          patchSceneObjectPosition(sceneId, sessionId, obj.objectId, pos).catch(() => { /* non-fatal */ });
        }

        const group = (await objectRendererRegistry.render(obj, { envMap: sceneEnvMap ?? undefined })) as import("three").Group | null;
        if (!group) return;
        if (disposed.value) {
          objectRendererRegistry.dispose(group);
          return;
        }
        // Detect models not in Y-up orientation (common for Hunyuan exports).
        // Find the dominant axis; if Y is not dominant, rotate the model to stand upright.
        group.scale.setScalar(1);
        group.updateMatrixWorld(true);
        const rawBboxNpc = new Box3().setFromObject(group);
        const rawExtX = rawBboxNpc.max.x - rawBboxNpc.min.x;
        const rawExtY = rawBboxNpc.max.y - rawBboxNpc.min.y;
        const rawExtZ = rawBboxNpc.max.z - rawBboxNpc.min.z;
        const rawMaxExt = Math.max(rawExtX, rawExtY, rawExtZ);
        if (rawMaxExt > 0.01 && rawExtY < rawMaxExt * 0.75) {
          if (rawExtX >= rawExtZ) {
            // X-dominant: lying sideways. Hunyuan models have head at -X; rotate -90° around Z.
            group.rotation.z = -Math.PI / 2;
          } else {
            // Z-dominant: Z-up export. Rotate -90° around X to map +Z to +Y.
            group.rotation.x = -Math.PI / 2;
          }
        }
        // Auto-scale to human height (~1.6 m) when no explicit scale was provided.
        let effectiveScale = scale;
        if (scale === 1) {
          group.updateMatrixWorld(true);
          const scaledBbox = new Box3().setFromObject(group);
          const modelHeight = scaledBbox.max.y - scaledBbox.min.y;
          if (modelHeight > 0.01) {
            const TARGET_NPC_HEIGHT = 1.6;
            effectiveScale = TARGET_NPC_HEIGHT / modelHeight;
          }
        }
        group.scale.setScalar(effectiveScale);
        group.updateMatrixWorld(true);
        const bbox = new Box3().setFromObject(group);
        // bbox is in world space — negate min.y directly to sit model on ground.
        const groundOffset = -bbox.min.y;
        group.position.set(pos.x, pos.y + groundOffset, pos.z);
        group.traverse((c) => {
          c.userData.objectId = obj.objectId;
          if (c instanceof Mesh) {
            c.userData.npcObjectId = obj.objectId;
            c.userData.npcName = obj.name;
            npcMeshList.push(c);
          }
        });
        scene.add(group);
        npcGroups.set(obj.objectId, group);
      };

      const removeSceneNpc = (objectId: string): void => {
        npcPositions.delete(objectId);
        // Remove tagged meshes from click-detection list
        for (let i = npcMeshList.length - 1; i >= 0; i--) {
          if (npcMeshList[i].userData.npcObjectId === objectId) npcMeshList.splice(i, 1);
        }
        const group = npcGroups.get(objectId);
        if (group) {
          scene.remove(group);
          npcGroups.delete(objectId);
        }
      };
      (window as unknown as Record<string, unknown>).__loadSceneNpc = loadSceneNpc;
      (window as unknown as Record<string, unknown>).__removeSceneNpc = removeSceneNpc;

      // Move an NPC's group to a new world position (interpolation via animateNpcMove)
      (window as unknown as Record<string, unknown>).__moveNpc = (objectId: string, pos: { x: number; y: number; z: number }) => {
        const group = npcGroups.get(objectId);
        if (!group) return;
        npcPositions.set(objectId, pos);
        // Animate movement over ~1.5s by updating position each frame
        const startPos = group.position.clone();
        const endPos = { x: pos.x, y: group.position.y, z: pos.z };
        const durationMs = 1500;
        const startTime = performance.now();
        const step = () => {
          const t = Math.min((performance.now() - startTime) / durationMs, 1);
          group.position.set(
            startPos.x + (endPos.x - startPos.x) * t,
            endPos.y,
            startPos.z + (endPos.z - startPos.z) * t,
          );
          if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      };

      // Play an animation clip on the NPC's AnimationMixer (if the GLB has clips)
      (window as unknown as Record<string, unknown>).__emoteNpc = (objectId: string, animation: string) => {
        const group = npcGroups.get(objectId);
        if (!group) return;
        // Store animation name for the render loop to pick up
        group.userData.pendingAnimation = animation;
      };

      // Load all NPCs that exist at physics init time.
      for (const obj of extractNpcs(sceneObjectsRef.current ?? [])) {
        loadSceneNpc(obj).catch((err) => {
          console.warn("[SplatViewer] failed to load NPC model", obj.name, err);
          // Still register position so proximity works even without a model.
          npcPositions.set(obj.objectId, { x: obj.position.x, y: obj.position.y, z: obj.position.z });
        });
      }

      // Physics ready — GLBs load in background; show "Click to enter" immediately
      setPhysicsReady(true);

      physicsRef.world = world as typeof physicsRef.world;
      physicsRef.RAPIER = RAPIER as typeof physicsRef.RAPIER;

      // Placement mode: track mouse position so doPlacement can raycast on submit
      const onPlacementMouseMove = (e: MouseEvent) => {
        const rect = cv.getBoundingClientRect();
        lastMousePosRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      };
      window.addEventListener("mousemove", onPlacementMouseMove);

      doPlacementRef.current = (text: string) => {
        const rect = cv.getBoundingClientRect();
        const nx = (lastMousePosRef.current.x / rect.width) * 2 - 1;
        const ny = -(lastMousePosRef.current.y / rect.height) * 2 + 1;
        const raycaster = new Raycaster();
        raycaster.setFromCamera(new Vector2(nx, ny), camera);
        const origin = raycaster.ray.origin;
        const dir = raycaster.ray.direction;
        const ray = new RAPIER.Ray(
          { x: origin.x, y: origin.y, z: origin.z },
          { x: dir.x, y: dir.y, z: dir.z },
        );
        const hit = world.castRay(ray, 200, true);
        if (hit) {
          (window as unknown as Record<string, unknown>).__clickPosition = {
            x: origin.x + dir.x * hit.timeOfImpact,
            y: origin.y + dir.y * hit.timeOfImpact,
            z: origin.z + dir.z * hit.timeOfImpact,
            ts: Date.now(),
          };
        }
        placementModeActiveRef.current = false;
        setPlacementMode(false);
        syncEuler();
        restartFreeFly();
        onPlacementRequestRef.current?.(text);
      };

      exitPlacementRef.current = () => {
        placementModeActiveRef.current = false;
        setPlacementMode(false);
        syncEuler();
        restartFreeFly();
      };

      const plc = new PointerLockControls(camera, cv);
      let inPhysicsMode = false;

      const tempBoxGeo = new BoxGeometry(0.6, 0.6, 0.6);
      const tempBoxMat = new MeshStandardMaterial({ color: 0x4488cc });
      const tempBoxes: { body: InstanceType<typeof RAPIER.RigidBody>; mesh: Mesh }[] = [];

      // Spawn a GLB asset from the catalog into the live physics world.
      // Accepts an optional pre-generated objectId (from PropPicker) so the same
      // id can be used for both local spawn and REST persistence.
      const spawnGlbProp = async (entry: AssetEntry, objectId?: string): Promise<void> => {
        const group = await loadGltf(entry.url);
        group.scale.setScalar(entry.scale);
        group.updateMatrixWorld(true);
        const dir = new Vector3();
        camera.getWorldDirection(dir);
        dir.y = 0;
        if (dir.lengthSq() < 0.0001) dir.set(0, 0, -1);
        dir.normalize();
        const spawnPos = camera.position.clone().addScaledVector(dir, 3);
        const bbox = new Box3().setFromObject(group);
        const groundOffset = -bbox.min.y * entry.scale;
        group.position.set(spawnPos.x, spawnPos.y + groundOffset, spawnPos.z);
        scene.add(group);
        group.updateMatrixWorld(true);
        const bboxWorld = new Box3().setFromObject(group);
        const centre = new Vector3();
        bboxWorld.getCenter(centre);
        const body = world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic().setTranslation(centre.x, centre.y, centre.z).setAdditionalMass(10),
        );
        buildCollider(world, body, group, "box");
        const meshes: import("three").Object3D[] = [];
        const oid = objectId ?? `spawned_${Math.random().toString(36).slice(2, 8)}`;
        group.traverse((c) => {
          c.userData.objectId = oid;
          if (c instanceof Mesh) meshes.push(c);
        });
        props.push({ body, group, objectId: oid, meshes });
      };
      (window as unknown as Record<string, unknown>).__spawnProp = spawnGlbProp;

      // Load a persisted SceneObject prop into the live physics world.
      // Called by App.tsx when scene_updated brings in new props so they appear
      // without requiring a page reload.
      const loadSceneProp = async (obj: import("../types.js").SceneObject): Promise<void> => {
        // Skip if already in the physics world (e.g. called by both loadSceneById and scene_updated)
        if (props.some((p) => p.objectId === obj.objectId)) return;
        const scale = typeof obj.metadata.scale === "number" ? obj.metadata.scale : 1;
        const physicsShape = (obj.metadata.physicsShape as string | undefined) ?? "box";
        const mass = typeof obj.metadata.mass === "number" ? obj.metadata.mass : 10;
        const hint = obj.metadata.placement as PlacementHint | undefined;
        const playerPos = obj.metadata.playerPosition as { x: number; y: number; z: number } | undefined;
        const cameraFwd = obj.metadata.cameraForward as { x: number; z: number } | undefined;
        const occupied = props.map((p) => {
          const t = p.body.translation();
          return { x: t.x, y: t.y, z: t.z };
        });
        const pos = resolvePosition(hint, world, occupied, viewpoints ?? [], props.length, playerPos, splatGroundOffset, cameraFwd);

        // Lock position back to server so it is stable on next reload.
        if (hint !== "exact" && sceneId && sessionId) {
          patchSceneObjectPosition(sceneId, sessionId, obj.objectId, pos).catch(() => { /* non-fatal */ });
        }

        let group: import("three").Group;
        try {
          group = (await objectRendererRegistry.render(obj, { envMap: sceneEnvMap ?? undefined })) as import("three").Group;
        } catch (err) {
          console.warn("[loadSceneProp] failed to load", obj.metadata.modelUrl, err);
          setPropLoadErrors((prev) => [...prev, obj.name]);
          return;
        }
        // Auto-normalize scale for models without an explicit scale — clamp height to 0.3–2.5m.
        // Hunyuan GLBs are typically ~0.5m tall at scale=1 which is correct; but guard against
        // extreme sizes that would make the prop invisible or overwhelm the scene.
        let effectiveScale = scale;
        if (scale === 1) {
          group.scale.setScalar(1);
          group.updateMatrixWorld(true);
          const rawBbox = new Box3().setFromObject(group);
          const rawHeight = rawBbox.max.y - rawBbox.min.y;
          if (rawHeight > 0.01) {
            const TARGET_MAX_HEIGHT = 2.5;
            const TARGET_MIN_HEIGHT = 0.3;
            if (rawHeight > TARGET_MAX_HEIGHT) effectiveScale = TARGET_MAX_HEIGHT / rawHeight;
            else if (rawHeight < TARGET_MIN_HEIGHT) effectiveScale = TARGET_MIN_HEIGHT / rawHeight;
          }
        }
        group.scale.setScalar(effectiveScale);
        group.updateMatrixWorld(true);
        const bbox = new Box3().setFromObject(group);
        const groundOffset = -bbox.min.y * effectiveScale;
        group.position.set(pos.x, pos.y + groundOffset, pos.z);
        scene.add(group);
        group.updateMatrixWorld(true);
        const bboxWorld = new Box3().setFromObject(group);
        const centre = new Vector3();
        bboxWorld.getCenter(centre);
        const body = world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic().setTranslation(centre.x, centre.y, centre.z).setAdditionalMass(mass),
        );
        buildCollider(world, body, group, physicsShape);
        const meshes: import("three").Object3D[] = [];
        group.traverse((c) => {
          c.userData.objectId = obj.objectId;
          if (c instanceof Mesh) meshes.push(c);
        });
        props.push({ body, group, objectId: obj.objectId, meshes });
      };
      (window as unknown as Record<string, unknown>).__loadSceneProp = loadSceneProp;

      const removeSceneProp = (objectId: string): void => {
        const idx = props.findIndex((p) => p.objectId === objectId);
        if (idx === -1) return;
        const [removed] = props.splice(idx, 1);
        scene.remove(removed.group);
        world.removeRigidBody(removed.body);
      };
      (window as unknown as Record<string, unknown>).__removeSceneProp = removeSceneProp;

      const fwd = new Vector3();
      const right = new Vector3();

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
        // Expose normalised camera forward (XZ only) for placement direction calculations
        if (fwd.lengthSq() > 0.0001) {
          (window as unknown as Record<string, unknown>).__cameraForward = { x: fwd.x, z: fwd.z };
        }

        for (const b of tempBoxes) {
          const t = b.body.translation();
          b.mesh.position.set(t.x, t.y, t.z);
          const r = b.body.rotation();
          b.mesh.quaternion.set(r.x, r.y, r.z, r.w);
        }
        syncPhysicsProps(props);

        renderer.render(scene, camera);
      }

      let hasEnteredScene = false;
      const onLockChange = () => {
        const locked = document.pointerLockElement === cv;
        setIsLocked(locked);
        if (locked && !inPhysicsMode) {
          hasEnteredScene = true;
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
          // Transition: physics walking → free-fly (Escape key) or placement mode (F key)
          inPhysicsMode = false;
          cancelAnimationFrame(animId);
          if (!placementModeActiveRef.current) {
            syncEuler();
            restartFreeFly();
          }
          // If placement mode is active: renderer stops; dialog is visible; free-fly restarts on submit/cancel
        }
      };
      document.addEventListener("pointerlockchange", onLockChange);

      const onClick = (e: MouseEvent) => {
        if (document.pointerLockElement !== cv) {
          // While placement is pending, clicks are handled by onMouseDown (Rapier hit).
          // Don't request pointer lock — it would steal the placement click.
          if (npcPlacementPendingRef.current || propPlacementPendingRef.current) return;
          // NPC click-to-talk: only after user has entered the scene at least once
          if (hasEnteredScene && npcMeshList.length > 0) {
            const rect = cv.getBoundingClientRect();
            const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            const npcRaycaster = new Raycaster();
            npcRaycaster.setFromCamera(new Vector2(nx, ny), camera);
            const npcHits = npcRaycaster.intersectObjects(npcMeshList, false);
            if (npcHits.length > 0) {
              const hitMesh = npcHits[0].object;
              onNpcApproachRef.current?.(hitMesh.userData.npcObjectId as string, hitMesh.userData.npcName as string);
              return; // don't lock pointer
            }
          }
          plc.lock();
          return;
        }
      };
      const onContextMenu = (e: MouseEvent) => { e.preventDefault(); };
      const onKeyAction = (e: KeyboardEvent) => {
        // Never fire scene shortcuts when the user is typing in a text field
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        const k = e.key.toLowerCase();
        if (k === "f") {
          placementModeActiveRef.current = true;
          setPlacementMode(true);
          if (document.pointerLockElement === cv) {
            document.exitPointerLock(); // onLockChange will stop physics loop
          }
          // If already in free-fly: free-fly loop continues; dialog is shown on top
          return;
        }
        // ESC key: cancel pending NPC placement if active
        if (e.key === "Escape" && npcPlacementPendingRef.current) {
          onNpcPlaceCancelRef.current?.();
          return;
        }
        // ESC key: cancel pending prop placement if active
        if (e.key === "Escape" && propPlacementPendingRef.current) {
          onPropPlaceCancelRef.current?.();
          return;
        }
        // ESC: close NPC chat if open
        if (e.key === "Escape") {
          onNpcLeaveRef.current?.();
          return;
        }
        if (k === "g" && document.pointerLockElement === cv) {
          // Spawn last-selected catalog asset (or prop_boom_box as default) ahead of camera.
          // Ephemeral — for quick physics interaction, not persisted.
          const entry = selectedPropRef.current ?? ASSET_CATALOG.find((a) => a.id === "prop_boom_box");
          if (entry) spawnGlbProp(entry).catch(console.warn);
          return;
        }
        if (k === "p") {
          // Open prop picker — exit pointer lock first so cursor is available
          if (document.pointerLockElement === cv) document.exitPointerLock();
          setShowPicker((v) => !v);
          return;
        }
        if (k === "e") {
          if (document.pointerLockElement === cv) {
            // NPC click-to-talk (E key in physics/pointer-lock mode)
            if (npcMeshList.length > 0) {
              const npcRaycaster = new Raycaster();
              npcRaycaster.setFromCamera(new Vector2(0, 0), camera);
              const npcHits = npcRaycaster.intersectObjects(npcMeshList, false);
              if (npcHits.length > 0 && npcHits[0].distance < 8) {
                const hitMesh = npcHits[0].object;
                document.exitPointerLock();
                onNpcApproachRef.current?.(hitMesh.userData.npcObjectId as string, hitMesh.userData.npcName as string);
                return;
              }
            }
            const propId = pickObject(camera, props.flatMap((p) => p.meshes), 4);
            if (propId) { onInteractRef.current?.(propId, "pick"); return; }
          }
        }
      };
      cv.addEventListener("click", onClick);
      cv.addEventListener("contextmenu", onContextMenu);
      window.addEventListener("keydown", onKeyAction);

      (window as unknown as Record<string, unknown>).__nearbyNpc = null;

      cleanupPhysics = () => {
        inPhysicsMode = false;
        disposed.value = true;
        stopFreeFly();
        plc.dispose();
        document.removeEventListener("pointerlockchange", onLockChange);
        cv.removeEventListener("click", onClick);
        cv.removeEventListener("contextmenu", onContextMenu);
        window.removeEventListener("keydown", onKeyAction);
        delete (window as unknown as Record<string, unknown>).__nearbyNpc;
        delete (window as unknown as Record<string, unknown>).__playerPosition;
        delete (window as unknown as Record<string, unknown>).__cameraForward;
        delete (window as unknown as Record<string, unknown>).__spawnProp;
        delete (window as unknown as Record<string, unknown>).__loadSceneProp;
        delete (window as unknown as Record<string, unknown>).__removeSceneProp;
        delete (window as unknown as Record<string, unknown>).__loadSceneNpc;
        delete (window as unknown as Record<string, unknown>).__removeSceneNpc;
        delete (window as unknown as Record<string, unknown>).__moveNpc;
        delete (window as unknown as Record<string, unknown>).__emoteNpc;
        physicsRef.world = null;
        physicsRef.RAPIER = null;
        doPlacementRef.current = null;
        exitPlacementRef.current = null;
        placementModeActiveRef.current = false;
        setPlacementMode(false);
        window.removeEventListener("mousemove", onPlacementMouseMove);
        if (document.pointerLockElement === cv) document.exitPointerLock();
        for (const b of tempBoxes) {
          world.removeRigidBody(b.body);
          scene.remove(b.mesh);
        }
        tempBoxGeo.dispose();
        tempBoxMat.dispose();
        disposePhysicsProps(props, world, scene);
        for (const group of npcGroups.values()) { scene.remove(group); }
        npcGroups.clear();
        npcPositions.clear();
        world.free();
      };
    }

    let cancelled = false;

    // When there is no physics collider, initPhysics never runs, so NPCs would
    // never load. Load them here using obj.position (already persisted as "exact"
    // after the first placement) so click-to-talk works in free-fly-only scenes.
    if (!colliderMeshUrl) {
      const noPhysicsNpcGroups = npcGroupsRef.current;
      const noPhysicsNpcPos = npcPositionsRef.current;
      noPhysicsNpcGroups.clear();
      noPhysicsNpcPos.clear();

      const loadNpcNoPhysics = (obj: import("../types.js").SceneObject) => {
        if (noPhysicsNpcPos.has(obj.objectId)) return;
        const pos = { x: obj.position.x, y: obj.position.y, z: obj.position.z };
        noPhysicsNpcPos.set(obj.objectId, pos);

        const modelUrl = obj.metadata.modelUrl as string | undefined;
        if (!modelUrl) {
          const hitbox = new Mesh(
            new SphereGeometry(0.6, 8, 8),
            new MeshStandardMaterial({ transparent: true, opacity: 0, depthWrite: false }),
          );
          hitbox.position.set(pos.x, pos.y + 1.0, pos.z);
          hitbox.userData.npcObjectId = obj.objectId;
          hitbox.userData.npcName = obj.name;
          hitbox.renderOrder = -1;
          scene.add(hitbox);
          npcMeshList.push(hitbox);
          noPhysicsNpcGroups.set(obj.objectId, hitbox as unknown as import("three").Group);
          return;
        }

        const scale = typeof obj.metadata.scale === "number" ? obj.metadata.scale : 1;
        objectRendererRegistry
          .render(obj, { envMap: sceneEnvMap ?? undefined })
          .then((group) => {
            if (!group || cancelled) return;
            const g = group as import("three").Group;
            // Detect models not in Y-up orientation; same logic as physics path.
            g.scale.setScalar(1);
            g.updateMatrixWorld(true);
            const rawBboxNp = new Box3().setFromObject(g);
            const npExtX = rawBboxNp.max.x - rawBboxNp.min.x;
            const npExtY = rawBboxNp.max.y - rawBboxNp.min.y;
            const npExtZ = rawBboxNp.max.z - rawBboxNp.min.z;
            const npMaxExt = Math.max(npExtX, npExtY, npExtZ);
            if (npMaxExt > 0.01 && npExtY < npMaxExt * 0.75) {
              if (npExtX >= npExtZ) {
                g.rotation.z = -Math.PI / 2;
              } else {
                g.rotation.x = -Math.PI / 2;
              }
            }
            let effectiveScaleNp = scale;
            if (scale === 1) {
              g.updateMatrixWorld(true);
              const sbbox = new Box3().setFromObject(g);
              const mh = sbbox.max.y - sbbox.min.y;
              if (mh > 0.01) effectiveScaleNp = 1.6 / mh;
            }
            g.scale.setScalar(effectiveScaleNp);
            g.updateMatrixWorld(true);
            const npBbox = new Box3().setFromObject(g);
            g.position.set(pos.x, pos.y + (-npBbox.min.y), pos.z);
            g.traverse((c) => {
              c.userData.objectId = obj.objectId;
              if (c instanceof Mesh) {
                c.userData.npcObjectId = obj.objectId;
                c.userData.npcName = obj.name;
                npcMeshList.push(c);
              }
            });
            scene.add(g);
            noPhysicsNpcGroups.set(obj.objectId, g);
          })
          .catch((err: unknown) => {
            console.warn("[SplatViewer] NPC no-physics load failed", obj.name, err);
          });
      };

      for (const obj of extractNpcs(sceneObjectsRef.current ?? [])) {
        loadNpcNoPhysics(obj);
      }

      // Register window hooks so App.tsx can inject NPCs added after initial load
      (window as unknown as Record<string, unknown>).__loadSceneNpc = (obj: import("../types.js").SceneObject) => {
        loadNpcNoPhysics(obj);
        return Promise.resolve();
      };
      (window as unknown as Record<string, unknown>).__removeSceneNpc = (objectId: string) => {
        for (let i = npcMeshList.length - 1; i >= 0; i--) {
          if (npcMeshList[i].userData.npcObjectId === objectId) npcMeshList.splice(i, 1);
        }
        const group = noPhysicsNpcGroups.get(objectId);
        if (group) { scene.remove(group); noPhysicsNpcGroups.delete(objectId); }
        noPhysicsNpcPos.delete(objectId);
      };
    }

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
      if (clickIndicatorTimer !== null) clearTimeout(clickIndicatorTimer);
      ro.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      delete (window as unknown as Record<string, unknown>).__clickPosition;
      delete (window as unknown as Record<string, unknown>).__nearbyNpc;
      delete (window as unknown as Record<string, unknown>).__loadSceneNpc;
      delete (window as unknown as Record<string, unknown>).__removeSceneNpc;
      npcPositionsRef.current.clear();
      for (const g of npcGroupsRef.current.values()) { scene.remove(g); }
      npcGroupsRef.current.clear();
      doPlacementRef.current = null;
      exitPlacementRef.current = null;
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
        style={{ width: "100%", height: "100%", display: "block", cursor: (placementMode || npcPlacementPending || propPlacementPending) ? "crosshair" : "default" }}
      />

      {/* Prop picker overlay */}
      <PropPicker
        visible={showPicker}
        onSelect={(entry) => {
          selectedPropRef.current = entry;
          setShowPicker(false);
          // Persist via REST; App.tsx's scene_updated handler will call
          // window.__loadSceneProp to inject it into the live physics world.
          onAddPropRef.current?.(entry, "");
        }}
        onClose={() => setShowPicker(false)}
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
            ? "Tap to enter · WASD to walk"
            : "Click to enter · WASD to walk · F to place · P for props"}
        </div>
      )}

      {/* NPC speech bubble — shown for any NPC speech (player-triggered or NPC-to-NPC) */}
      {npcSpeech && (
        <div style={{
          position: "absolute", bottom: 160, left: "50%", transform: "translateX(-50%)",
          background: "rgba(10,10,30,0.88)", backdropFilter: "blur(8px)",
          border: "1px solid rgba(120,160,255,0.3)",
          borderRadius: 12, padding: "12px 18px",
          color: "rgba(200,220,255,0.95)",
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontSize: 14, zIndex: 15,
          maxWidth: 360, textAlign: "center", lineHeight: 1.6,
          pointerEvents: "none",
        }}>
          <div style={{ fontSize: 12, color: "rgba(160,180,255,0.7)", marginBottom: 6 }}>
            {npcSpeech.npcName}
          </div>
          {npcSpeech.text}
        </div>
      )}

      {/* Crosshair — shown while walking (pointer-locked) */}
      {physicsReady && status === "ready" && isLocked && !placementMode && (
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none", zIndex: 5,
        }}>
          <div style={{ position: "absolute", width: 20, height: 1, top: 0, left: -10, background: "rgba(255,255,255,0.75)", boxShadow: "0 0 2px rgba(0,0,0,0.9)" }} />
          <div style={{ position: "absolute", width: 1, height: 20, top: -10, left: 0, background: "rgba(255,255,255,0.75)", boxShadow: "0 0 2px rgba(0,0,0,0.9)" }} />
        </div>
      )}

      {/* Placement mode dialog */}
      {placementMode && (
        <div style={{
          position: "absolute", bottom: 90, left: "50%", transform: "translateX(-50%)",
          background: "rgba(8,8,24,0.92)", backdropFilter: "blur(10px)",
          border: "1px solid rgba(120,160,255,0.35)", borderRadius: 12,
          padding: "14px 18px",
          color: "rgba(200,220,255,0.95)",
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontSize: 14, zIndex: 20,
          display: "flex", flexDirection: "column", gap: 10,
          minWidth: 300,
        }}>
          <div style={{ fontSize: 12, color: "rgba(160,180,255,0.65)", letterSpacing: 0.3 }}>
            将鼠标移到目标位置，输入想放置的物件
          </div>
          <form onSubmit={(e) => {
            e.preventDefault();
            const text = ((e.currentTarget.elements as HTMLFormControlsCollection).namedItem("q") as HTMLInputElement | null)?.value.trim();
            if (text) doPlacementRef.current?.(text);
          }}>
            <input
              name="q"
              autoFocus
              autoComplete="off"
              placeholder="例如：一把椅子、一棵树..."
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.preventDefault(); exitPlacementRef.current?.(); }
              }}
              style={{
                width: "100%", padding: "8px 10px",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(120,160,255,0.28)",
                borderRadius: 7, color: "rgba(220,235,255,0.95)",
                fontSize: 14, outline: "none", boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button type="submit" style={{
                flex: 1, padding: "7px 0",
                background: "rgba(100,140,255,0.22)",
                border: "1px solid rgba(100,140,255,0.45)",
                borderRadius: 7, color: "rgba(200,220,255,0.95)",
                fontSize: 13, cursor: "pointer",
              }}>确定放置</button>
              <button type="button" onClick={() => exitPlacementRef.current?.()} style={{
                padding: "7px 14px",
                background: "transparent",
                border: "1px solid rgba(150,150,180,0.25)",
                borderRadius: 7, color: "rgba(160,170,200,0.6)",
                fontSize: 13, cursor: "pointer",
              }}>取消</button>
            </div>
          </form>
          <div style={{ fontSize: 11, color: "rgba(110,130,170,0.45)", textAlign: "center" }}>ESC 取消</div>
        </div>
      )}

      {/* NPC placement hint — shown when App.tsx has a pending NPC waiting to be placed */}
      {npcPlacementPending && (
        <div style={{
          position: "absolute", bottom: 90, left: "50%", transform: "translateX(-50%)",
          background: "rgba(8,8,24,0.92)", backdropFilter: "blur(10px)",
          border: "1px solid rgba(120,160,255,0.35)", borderRadius: 12,
          padding: "12px 20px",
          color: "rgba(200,220,255,0.95)",
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontSize: 14, zIndex: 20,
          display: "flex", alignItems: "center", gap: 10,
          whiteSpace: "nowrap",
        }}>
          <span style={{ fontSize: 18 }}>🧍</span>
          <span>点击地面放置 NPC</span>
          <span style={{ fontSize: 11, color: "rgba(140,150,180,0.5)", marginLeft: 4 }}>· ESC 取消</span>
        </div>
      )}

      {/* Prop placement hint — shown when App.tsx has a pending prop waiting to be placed */}
      {propPlacementPending && (
        <div style={{
          position: "absolute", bottom: 90, left: "50%", transform: "translateX(-50%)",
          background: "rgba(8,8,24,0.92)", backdropFilter: "blur(10px)",
          border: "1px solid rgba(100,200,160,0.35)", borderRadius: 12,
          padding: "12px 20px",
          color: "rgba(200,255,220,0.95)",
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontSize: 14, zIndex: 20,
          display: "flex", alignItems: "center", gap: 10,
          whiteSpace: "nowrap",
        }}>
          <span>点击地面放置物件</span>
          <span style={{ fontSize: 11, color: "rgba(140,150,180,0.5)", marginLeft: 4 }}>· ESC 取消</span>
        </div>
      )}

      {/* Click target indicator — fades after 2s */}
      {clickIndicator && (
        <div style={{
          position: "absolute",
          left: clickIndicator.x - 8,
          top: clickIndicator.y - 8,
          width: 16, height: 16, borderRadius: "50%",
          background: "rgba(100,200,255,0.85)",
          border: "2px solid rgba(180,230,255,0.9)",
          boxShadow: "0 0 8px rgba(100,200,255,0.7)",
          pointerEvents: "none",
          animation: "clickDot 2s ease-out forwards",
        }} />
      )}

      {/* Prop load error notification */}
      {propLoadErrors.length > 0 && (
        <div style={{
          position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)",
          background: "rgba(30,10,10,0.88)", backdropFilter: "blur(6px)",
          border: "1px solid rgba(255,100,100,0.4)",
          borderRadius: 8, padding: "10px 14px",
          color: "rgba(255,180,180,0.95)",
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontSize: 13, zIndex: 25,
          display: "flex", alignItems: "center", gap: 10,
          maxWidth: 360,
        }}>
          <span style={{ flex: 1 }}>
            无法加载: {propLoadErrors.join("、")}
          </span>
          <button
            type="button"
            onClick={() => setPropLoadErrors([])}
            style={{
              background: "transparent", border: "none",
              color: "rgba(255,180,180,0.7)", cursor: "pointer",
              fontSize: 16, lineHeight: 1, padding: "0 2px",
            }}
          >✕</button>
        </div>
      )}
      <style>{`
        @keyframes clickDot {
          0%   { opacity: 1; transform: scale(1); }
          70%  { opacity: 0.6; transform: scale(1.4); }
          100% { opacity: 0; transform: scale(0.6); }
        }
      `}</style>

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
