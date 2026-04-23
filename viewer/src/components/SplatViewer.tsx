import { useEffect, useRef, useState } from "react";
import {
  WebGLRenderer,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  Scene,
  Color,
  HemisphereLight,
  DirectionalLight,
  ACESFilmicToneMapping,
  PMREMGenerator,
  Clock,
  Vector3,
  Box3,
  Euler,
  BoxGeometry,
  CylinderGeometry,
  SphereGeometry,
  TorusGeometry,
  PlaneGeometry,
  MeshStandardMaterial,
  MeshBasicMaterial,
  CanvasTexture,
  Mesh,
  Group,
  DoubleSide,
  AnimationMixer,
  SkinnedMesh,
  Bone,
  BufferAttribute,
} from "three";
import * as THREE from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { SparkRenderer, SplatMesh, SplatEdit, SplatEditSdf, SplatEditSdfType, SplatEditRgbaBlendMode, imageSplats, textSplats, generators } from "@sparkjsdev/spark";
import { getRapier } from "../physics/init-rapier.js";
import { buildWorldColliders } from "../physics/build-world-colliders.js";
import { createCharacterController } from "../physics/character-controller.js";
import {
  loadPhysicsProps,
  loadGltf,
  resolveModelUrl,
  buildCollider,
  syncPhysicsProps,
  disposePhysicsProps,
  type PhysicsProp,
} from "../physics/pushable-objects.js";
import { type PlacementHint, resolvePosition } from "../physics/prop-placement.js";
import { pickObject } from "../physics/raycast-pick.js";
import { extractNpcs, findNearbyInteractiveProp, findNearbyNpc, PROP_LEAVE_RADIUS } from "../physics/npc-proximity.js";
import type { SceneObject, Viewpoint } from "../types.js";
import type { AssetEntry } from "../renderer/asset-catalog.js";
import { ASSET_CATALOG } from "../renderer/asset-catalog.js";
import { patchSceneObjectPosition } from "../api.js";
import { PropPicker } from "./PropPicker.js";
import { ObjectRendererRegistry } from "../renderer/object-renderer.js";
import { GltfObjectRenderer } from "../renderer/gltf-object-renderer.js";

/**
 * Rotate `group` to stand upright.
 * Call after resetting position/rotation/scale to identity.
 *
 * Scoring: primary = (extY - extZ); bias = +0.25 for identity rotation.
 *   - A standing human is always taller than they are deep (front-to-back).
 *   - Identity bias prevents spurious rotations for already-upright models.
 *   - Candidate order breaks ties: negative rotations (rz=-π/2, rx=-π/2)
 *     are listed before their positive counterparts because they match the
 *     standard Hunyuan/Blender export convention (head in -X or +Z maps to +Y).
 */
function orientUpright(group: Group): void {
  const candidates: [number, number][] = [
    [0, 0],             // identity (gets +0.25 bonus)
    [-Math.PI / 2, 0],  // rx=-π/2: Z-up → Y-up (standard Blender export)
    [Math.PI / 2, 0],   // rx=+π/2
    [0, -Math.PI / 2],  // rz=-π/2: head-at-(-X) → +Y (preferred tie-winner)
    [0, Math.PI / 2],   // rz=+π/2
  ];

  let bestRx = 0;
  let bestRz = 0;
  let bestScore = -Infinity;

  for (const [rx, rz] of candidates) {
    group.rotation.set(rx, 0, rz);
    group.updateMatrixWorld(true);
    const bb = meshOnlyBoundingBox(group);
    const extY = bb.max.y - bb.min.y;
    const extZ = bb.max.z - bb.min.z;
    const score = extY - extZ;
    if (score > bestScore) {
      bestScore = score;
      bestRx = rx;
      bestRz = rz;
    }
  }
  group.rotation.set(bestRx, 0, bestRz);
}

/**
 * Compute the bounding box of a group excluding Bone objects.
 * Box3.setFromObject traverses the full scene graph including skeleton Bone nodes,
 * which inflates the box well beyond the visible mesh for rigged characters.
 * This helper only expands the box for Mesh / SkinnedMesh geometry.
 */
function meshOnlyBoundingBox(root: Group): Box3 {
  const box = new Box3();
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (obj instanceof Bone) return;
    if (obj instanceof Mesh || obj instanceof SkinnedMesh) {
      const geomBox = new Box3().setFromBufferAttribute(
        (obj as Mesh).geometry.attributes.position as BufferAttribute,
      );
      geomBox.applyMatrix4(obj.matrixWorld);
      box.union(geomBox);
    }
  });
  return box;
}

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
  onNpcLeave?: (objectId: string) => void;
  /** Fired when player clicks an NPC mesh — opens the chat input overlay. */
  onNpcClick?: (objectId: string, name: string) => void;
  /** Fired when the player moves (WASD/joystick) while a chat overlay is open. */
  onPlayerMove?: () => void;
  /** @deprecated use speechFeed instead */
  npcSpeech?: { npcId: string; npcName: string; text: string } | null;
  /** Per-NPC speech entries shown as head-top bubbles, keyed by unique id, auto-expire in App.tsx */
  speechFeed?: Array<{ id: string; npcId: string; npcName: string; text: string }>;
  npcPlacementPending?: boolean;
  onNpcPlace?: (pos: { x: number; y: number; z: number }) => void;
  onNpcPlaceCancel?: () => void;
  propPlacementPending?: boolean;
  onPropPlace?: (pos: { x: number; y: number; z: number }) => void;
  onPropPlaceCancel?: () => void;
  portalPlacementPending?: boolean;
  onPortalPlace?: (pos: { x: number; y: number; z: number }) => void;
  onPortalPlaceCancel?: () => void;
  onPortalApproach?: (objectId: string, targetSceneId: string | null, targetSceneName: string | null) => void;
  onPortalLeave?: () => void;
  onPropApproach?: (objectId: string, name: string, skillName: string, skillConfig: Record<string, unknown>) => void;
  onPropLeave?: () => void;
  /** Model URL for drag-to-place ghost preview during NPC/prop placement. */
  ghostModelUrl?: string;
  ghostModelScale?: number;
  /** Script mesh placement mode — mesh follows mouse until user clicks to confirm position. */
  scriptMeshPlacementPending?: boolean;
  /** The Three.js mesh(es) to reposition during scriptMeshPlacement. */
  scriptMeshes?: Array<import("three").Object3D>;
  onScriptMeshPlace?: (pos: { x: number; y: number; z: number }) => void;
  onScriptMeshPlaceCancel?: () => void;
  /** Called once renderer + camera are ready. API object lets camera tool capture frames and toggle selfie mode. */
  onCameraReady?: (api: CameraAPI) => void;
}

export interface CameraAPI {
  captureFrame: () => string;
  setSelfieMode: (on: boolean) => void;
  setFov: (fov: number) => void;
  startRecording: (fps?: number) => void;
  stopRecording: () => Promise<Blob | null>;
}

// Module-level registry so it is constructed once and shared across mounts.
const objectRendererRegistry = new ObjectRendererRegistry().register(new GltfObjectRenderer());

export function SplatViewer({ splatUrl, colliderMeshUrl, sceneObjects, viewpoints, splatGroundOffset, sceneId, sessionId, onInteract, onAddProp, onPlacementRequest, onNpcApproach, onNpcLeave, onNpcClick, onPlayerMove, npcSpeech: _npcSpeech, speechFeed, npcPlacementPending, onNpcPlace, onNpcPlaceCancel, propPlacementPending, onPropPlace, onPropPlaceCancel, portalPlacementPending, onPortalPlace, onPortalPlaceCancel, onPortalApproach, onPortalLeave, onPropApproach, onPropLeave, ghostModelUrl, ghostModelScale, scriptMeshPlacementPending, scriptMeshes, onScriptMeshPlace, onScriptMeshPlaceCancel, onCameraReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [isLocked, setIsLocked] = useState(false);
  const [physicsReady, setPhysicsReady] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const editModeRef = useRef(false);
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
  // Three.js camera — set once after camera creation, used for 3D→2D bubble projection.
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  // Prop world positions — keyed by objectId; used for prop proximity detection.
  const propPositionsRef = useRef<Map<string, { x: number; y: number; z: number }>>(new Map());
  // Prop groups — keyed by objectId; used for height-adjust drag in free-fly mode.
  const propGroupsRef = useRef<Map<string, import("three").Group>>(new Map());
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
  const onPortalPlaceRef = useRef(onPortalPlace);
  onPortalPlaceRef.current = onPortalPlace;
  const onPortalPlaceCancelRef = useRef(onPortalPlaceCancel);
  onPortalPlaceCancelRef.current = onPortalPlaceCancel;
  const portalPlacementPendingRef = useRef(portalPlacementPending);
  portalPlacementPendingRef.current = portalPlacementPending;
  const scriptMeshPlacementPendingRef = useRef(false);
  const scriptMeshesRef = useRef(scriptMeshes);
  scriptMeshesRef.current = scriptMeshes;
  const onScriptMeshPlaceRef = useRef(onScriptMeshPlace);
  onScriptMeshPlaceRef.current = onScriptMeshPlace;
  const onScriptMeshPlaceCancelRef = useRef(onScriptMeshPlaceCancel);
  onScriptMeshPlaceCancelRef.current = onScriptMeshPlaceCancel;
  const selfieModeRef = useRef(false);
  const onCameraReadyRef = useRef(onCameraReady);
  onCameraReadyRef.current = onCameraReady;
  const onNpcApproachRef = useRef(onNpcApproach);
  onNpcApproachRef.current = onNpcApproach;
  const onNpcLeaveRef = useRef(onNpcLeave);
  onNpcLeaveRef.current = onNpcLeave;
  const onNpcClickRef = useRef(onNpcClick);
  onNpcClickRef.current = onNpcClick;
  const onPlayerMoveRef = useRef(onPlayerMove);
  onPlayerMoveRef.current = onPlayerMove;
  const onPortalApproachRef = useRef(onPortalApproach);
  onPortalApproachRef.current = onPortalApproach;
  const onPortalLeaveRef = useRef(onPortalLeave);
  onPortalLeaveRef.current = onPortalLeave;
  const onPropApproachRef = useRef(onPropApproach);
  onPropApproachRef.current = onPropApproach;
  const onPropLeaveRef = useRef(onPropLeave);
  onPropLeaveRef.current = onPropLeave;
  const nearPortalIdRef = useRef<string | null>(null);
  const isTouch = typeof window !== "undefined" && "ontouchstart" in window;

  // Projected screen positions of NPC heads, updated ~30fps via RAF for speech bubble rendering.
  const [bubblePositions, setBubblePositions] = useState<Map<string, { x: number; y: number }>>(new Map());

  useEffect(() => {
    let raf = 0;
    let lastTick = 0;
    const TICK_INTERVAL = 33; // ~30fps
    const pos3 = new Vector3();
    const canvasEl = canvasRef.current;

    function tick(now: number) {
      raf = requestAnimationFrame(tick);
      if (now - lastTick < TICK_INTERVAL) return;
      lastTick = now;
      const cam = cameraRef.current;
      const groups = npcGroupsRef.current;
      if (!cam || groups.size === 0 || !canvasEl) return;
      const w = canvasEl.clientWidth;
      const h = canvasEl.clientHeight;
      const next = new Map<string, { x: number; y: number }>();
      for (const [id, group] of groups) {
        // Project head position: group world position + ~1.8m for head-top
        pos3.setFromMatrixPosition(group.matrixWorld);
        pos3.y += 1.8;
        const ndc = pos3.clone().project(cam);
        // Skip NPCs behind camera
        if (ndc.z > 1) continue;
        const sx = (ndc.x * 0.5 + 0.5) * w;
        const sy = (-ndc.y * 0.5 + 0.5) * h;
        next.set(id, { x: sx, y: sy });
      }
      setBubblePositions(next);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Ghost drag-to-place: when placement starts, begin loading the model immediately.
  // We track mouse position via a window-level listener (not canvas) so it works
  // regardless of freeFlyActive or pointer-lock state.
  const ghostLoadTriggerRef = useRef<{ url: string; scale: number } | null>(null);
  const ghostPendingGroupRef = useRef<{ group: Group; groundOffset: number } | null>(null); // loaded but not yet added to scene

  useEffect(() => {
    const pending = npcPlacementPending || propPlacementPending;
    if (pending && ghostModelUrl) {
      const trigger = { url: ghostModelUrl, scale: ghostModelScale ?? 1 };
      ghostLoadTriggerRef.current = trigger;
      ghostPendingGroupRef.current = null;
      // Start loading immediately — don't wait for first mousemove
      console.log("[ghost] loading model:", trigger.url);
      loadGltf(resolveModelUrl(trigger.url)).then((rawGroup) => {
        if (!ghostLoadTriggerRef.current) return; // cancelled
        rawGroup.position.set(0, 0, 0);
        rawGroup.rotation.set(0, 0, 0);
        rawGroup.scale.setScalar(1);
        // Orient upright before measuring height
        orientUpright(rawGroup);
        rawGroup.updateMatrixWorld(true);
        const scaledBbox = new Box3().setFromObject(rawGroup);
        const mh = scaledBbox.max.y - scaledBbox.min.y;
        const effectiveScale = mh > 0.01 ? Math.min(1.7 / mh, 10) * trigger.scale : trigger.scale;
        rawGroup.scale.setScalar(effectiveScale);
        // Compute ground offset: after all transforms, how far to lift so feet are at y=0
        rawGroup.position.set(0, 0, 0);
        rawGroup.updateMatrixWorld(true);
        const finalBbox = new Box3().setFromObject(rawGroup);
        const groundOffset = finalBbox.isEmpty() ? 0 : -finalBbox.min.y;
        rawGroup.traverse((c) => {
          if (c instanceof Mesh) {
            // depthTest=false: ghost always renders on top of splat and through walls
            const mats = Array.isArray(c.material) ? c.material : [c.material];
            const cloned = mats.map((m) => {
              const clone = (m as MeshStandardMaterial).clone();
              clone.transparent = true;
              clone.opacity = 0.8;
              clone.depthTest = false;
              clone.depthWrite = false;
              return clone;
            });
            c.material = cloned.length === 1 ? cloned[0] : cloned;
            c.renderOrder = 10;
          }
        });
        ghostPendingGroupRef.current = { group: rawGroup, groundOffset };
      }).catch((err) => { console.error("[ghost] loadGltf failed:", err); });
    } else {
      ghostLoadTriggerRef.current = null;
      ghostPendingGroupRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [npcPlacementPending, propPlacementPending, ghostModelUrl, ghostModelScale]);

  // Exit pointer lock when entering placement mode so clicks reach the free-fly handler.
  useEffect(() => {
    // prop true = new placement started → arm the ref
    if (scriptMeshPlacementPending) scriptMeshPlacementPendingRef.current = true;
    // prop false = placement ended externally (cancel/confirm from UI) → disarm
    else scriptMeshPlacementPendingRef.current = false;
  }, [scriptMeshPlacementPending]);

  useEffect(() => {
    if ((propPlacementPending || npcPlacementPending || portalPlacementPending) && document.pointerLockElement) {
      document.exitPointerLock();
    }
  }, [propPlacementPending, npcPlacementPending, portalPlacementPending, scriptMeshPlacementPending]);

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
    renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.85;

    const scene = new Scene();
    scene.background = new Color(0x0a0a14);
    // Outdoor lighting: hemisphere (sky/ground) + warm sun + cool fill
    const hemiLight = new HemisphereLight(0x87ceeb, 0x8b7355, 0.7);
    scene.add(hemiLight);
    const sunLight = new DirectionalLight(0xfff4e0, 1.2);
    sunLight.position.set(8, 15, 5);
    scene.add(sunLight);
    const fillLight = new DirectionalLight(0xadd8e6, 0.3);
    fillLight.position.set(-8, 5, -5);
    scene.add(fillLight);

    // IBL env map — loaded async from Polyhaven; applied to GLTF props once ready.
    let sceneEnvMap: import("three").Texture | null = null;
    const pmrem = new PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    new RGBELoader()
      .loadAsync("https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloofendal_48d_partly_cloudy_puresky_1k.hdr")
      .then((equirect) => {
        sceneEnvMap = pmrem.fromEquirectangular(equirect).texture;
        scene.environment = sceneEnvMap; // IBL for all scene materials
        pmrem.dispose();
        equirect.dispose();
      })
      .catch(() => { pmrem.dispose(); }); // non-fatal — props still render without IBL

    const camera = new PerspectiveCamera(65, canvas.clientWidth / canvas.clientHeight, 0.01, 1000);
    camera.position.set(0, 1.7, 0);
    cameraRef.current = camera;

    // ── Player avatar — visible only in selfie mode ───────────────────────────
    const avatarMat = new MeshStandardMaterial({
      color: 0x8899ff,
      roughness: 0.6,
      metalness: 0.2,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.92,
    });
    const avatarGroup = new Group();
    const avatarBody = new Mesh(new CylinderGeometry(0.22, 0.22, 1.0, 16), avatarMat);
    avatarBody.position.y = 0.5;
    avatarBody.renderOrder = 20;
    const avatarHead = new Mesh(new SphereGeometry(0.25, 16, 12), avatarMat);
    avatarHead.position.y = 1.35;
    avatarHead.renderOrder = 20;
    avatarGroup.add(avatarBody);
    avatarGroup.add(avatarHead);
    avatarGroup.visible = false;
    scene.add(avatarGroup);

    const clock = new Clock();
    const sparkRenderer = new SparkRenderer({ renderer, clock, enableLod: true, sortRadial: true });
    (window as unknown as Record<string, unknown>).__sparkRenderer = sparkRenderer;
    scene.add(sparkRenderer);

    const splat = new SplatMesh({ url: splatUrl });
    splat.rotation.x = Math.PI;
    scene.add(splat);
    let splatInitialized = false;
    splat.initialized.then(() => {
      splatInitialized = true;
      // Pixel sampling in freeFlyLoop confirms SparkRenderer drew the scene.
      // If the pixel check never fires (e.g. PBO still bound, dark center pixel),
      // fall back to marking ready after 3 s so the scene never stays stuck.
      setTimeout(() => {
        if (splatInitialized) {
          splatInitialized = false;
          setStatus("ready");
        }
      }, 3000);
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
      renderer.setSize(w, h, false);
    });
    ro.observe(canvas);

    // ── WASD key state ────────────────────────────────────────────────────────
    const keys = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      // Tab: handle here only when physics hasn't loaded yet (no onKeyAction registered).
      // Once physics is ready, onKeyAction owns Tab to avoid double-firing.
      if (e.key === "Tab" && physicsRef.world === null) {
        e.preventDefault();
        const entering = !editModeRef.current;
        editModeRef.current = entering;
        setEditMode(entering);
        if (!entering) {
          heightHovered = null;
          heightDrag = null;
          if (canvas) canvas.style.cursor = "";
        }
        return;
      }
      const k = e.key.toLowerCase();
      keys.add(k);
    };
    const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    let animId: number;
    let cleanupPhysics: (() => void) | null = null;

    const worldUp = new Vector3(0, 1, 0);

    // ── Contact shadow helpers ────────────────────────────────────────────────
    // Creates a soft radial blob shadow under an NPC/prop group.
    // The plane is added to the scene (NOT the group) so it stays flat on terrain.
    function createContactShadow(group: import("three").Group, groundY: number): Mesh {
      const shadowBbox = new Box3().setFromObject(group);
      const xzSpan = Math.max(
        shadowBbox.max.x - shadowBbox.min.x,
        shadowBbox.max.z - shadowBbox.min.z,
      );
      const diameter = Math.max(xzSpan * 1.5, 0.4);

      const SIZE = 128;
      const canvas2d = document.createElement("canvas");
      canvas2d.width = SIZE;
      canvas2d.height = SIZE;
      const ctx = canvas2d.getContext("2d")!;
      const cx = SIZE / 2;
      const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
      grad.addColorStop(0,    "rgba(0,0,0,0.55)");
      grad.addColorStop(0.35, "rgba(0,0,0,0.35)");
      grad.addColorStop(0.75, "rgba(0,0,0,0.08)");
      grad.addColorStop(1.0,  "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, SIZE, SIZE);

      const shadowMat = new MeshBasicMaterial({
        map: new CanvasTexture(canvas2d),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const shadowMesh = new Mesh(new PlaneGeometry(diameter, diameter), shadowMat);
      shadowMesh.rotation.x = -Math.PI / 2;
      shadowMesh.position.set(group.position.x, groundY + 0.01, group.position.z);
      shadowMesh.renderOrder = -1;
      scene.add(shadowMesh);
      return shadowMesh;
    }

    function disposeContactShadow(group: import("three").Group): void {
      const shadow = group.userData.shadowPlane as Mesh | undefined;
      if (!shadow) return;
      scene.remove(shadow);
      (shadow.material as MeshBasicMaterial).map?.dispose();
      (shadow.material as MeshBasicMaterial).dispose();
      shadow.geometry.dispose();
    }

    // ── Portal helpers ────────────────────────────────────────────────────────
    interface PortalEntry {
      position: { x: number; y: number; z: number };
      targetSceneId: string | null;
      targetSceneName: string | null;
      group: Group;
    }
    const portalMap = new Map<string, PortalEntry>();

    function createPortalMesh(pos: { x: number; y: number; z: number }): Group {
      const g = new Group();
      const SIZE = 256;

      // ── Outer neon ring — MeshStandardMaterial exploits ACES bloom ────────
      const ringMat = new MeshStandardMaterial({
        color: new Color(0x00ccff),
        emissive: new Color(0x00eeff),
        emissiveIntensity: 3.0,
        roughness: 0.15,
        metalness: 0.9,
      });
      const ring = new Mesh(new TorusGeometry(1.0, 0.12, 20, 80), ringMat);
      ring.renderOrder = 3;

      // ── Inner energy ring ─────────────────────────────────────────────────
      const innerRingMat = new MeshStandardMaterial({
        color: new Color(0x88ffff),
        emissive: new Color(0x44ffff),
        emissiveIntensity: 5.0,
        roughness: 0.0,
        metalness: 1.0,
      });
      const innerRing = new Mesh(new TorusGeometry(0.86, 0.045, 12, 60), innerRingMat);
      innerRing.renderOrder = 4;

      // ── Ring-edge haze disc — transparent centre, faint glow near torus ──
      // No dark fill, no spiral arms: only a very faint annular shimmer so the
      // scene behind the portal is fully visible through the centre.
      const hazeCv = document.createElement("canvas");
      hazeCv.width = SIZE; hazeCv.height = SIZE;
      const hCtx = hazeCv.getContext("2d")!;
      const cx = SIZE / 2;
      // Annular gradient: transparent at centre (r<0.5), peaks near ring (r≈0.85), fades to 0 at edge
      const hazeGrad = hCtx.createRadialGradient(cx, cx, cx * 0.50, cx, cx, cx);
      hazeGrad.addColorStop(0,    "rgba(0,180,255,0)");
      hazeGrad.addColorStop(0.55, "rgba(0,180,255,0.06)");
      hazeGrad.addColorStop(0.78, "rgba(40,220,255,0.18)");
      hazeGrad.addColorStop(0.90, "rgba(80,240,255,0.12)");
      hazeGrad.addColorStop(1.0,  "rgba(0,100,200,0)");
      hCtx.fillStyle = hazeGrad;
      hCtx.fillRect(0, 0, SIZE, SIZE);
      const hazeMat = new MeshBasicMaterial({
        map: new CanvasTexture(hazeCv),
        transparent: true,
        side: DoubleSide,
        depthWrite: false,
      });
      const hazeDisc = new Mesh(new PlaneGeometry(2.24, 2.24), hazeMat);
      hazeDisc.renderOrder = 2;
      g.userData.hazeDisc = hazeDisc;
      g.add(hazeDisc);

      // ── Ground glow ───────────────────────────────────────────────────────
      const glowCv = document.createElement("canvas");
      glowCv.width = SIZE; glowCv.height = SIZE;
      const gCtx = glowCv.getContext("2d")!;
      const gcx = SIZE / 2;
      const gg = gCtx.createRadialGradient(gcx, gcx, 0, gcx, gcx, gcx);
      gg.addColorStop(0,    "rgba(0,200,255,0.45)");
      gg.addColorStop(0.40, "rgba(0,120,220,0.18)");
      gg.addColorStop(0.75, "rgba(0,50,120,0.06)");
      gg.addColorStop(1,    "rgba(0,0,0,0)");
      gCtx.fillStyle = gg;
      gCtx.fillRect(0, 0, SIZE, SIZE);
      const glowMat = new MeshBasicMaterial({
        map: new CanvasTexture(glowCv), transparent: true, depthWrite: false,
      });
      const groundGlow = new Mesh(new PlaneGeometry(3.6, 3.6), glowMat);
      groundGlow.rotation.x = -Math.PI / 2;
      groundGlow.position.y = -(1.0 + 0.12); // ground relative to group centre
      groundGlow.renderOrder = 0;

      g.add(ring, innerRing, groundGlow);
      g.userData.ring = ring;
      g.userData.innerRing = innerRing;

      // Bottom of ring touches ground: group.y = pos.y + radius + tube
      g.position.set(pos.x, pos.y + 1.0 + 0.12, pos.z);
      scene.add(g);
      return g;
    }

    function disposePortal(entry: PortalEntry): void {
      const g = entry.group;
      scene.remove(g);
      g.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        child.geometry.dispose();
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) m.dispose();
      });
    }

    // Rotate portals and pulse shimmer — called each frame in both render loops.
    function tickPortals(): void {
      const t = performance.now() * 0.001;
      for (const entry of portalMap.values()) {
        const g = entry.group;
        // Slowly rotate the haze disc for a gentle swirling impression
        const hazeDisc = g.userData.hazeDisc as Mesh | undefined;
        if (hazeDisc) hazeDisc.rotation.z = t * 0.12;
        // Pulse outer ring emissive intensity
        const ring = g.userData.ring as Mesh;
        const pulse = 0.5 + 0.5 * Math.sin(t * 1.8);
        (ring.material as MeshStandardMaterial).emissiveIntensity = 2.5 + 1.5 * pulse;
        // Pulse inner ring faster
        const innerRing = g.userData.innerRing as Mesh;
        const pulse2 = 0.5 + 0.5 * Math.sin(t * 2.6 + 1.0);
        (innerRing.material as MeshStandardMaterial).emissiveIntensity = 4.0 + 3.0 * pulse2;
      }
    }

    // Load all portal objects from sceneObjects.
    function loadSinglePortal(obj: SceneObject): void {
      if (obj.type !== "portal") return;
      if (portalMap.has(obj.objectId)) return;
      const storedX = (obj.metadata.playerPosition as { x: number } | undefined)?.x ?? obj.position.x;
      const storedZ = (obj.metadata.playerPosition as { z: number } | undefined)?.z ?? obj.position.z;

      // Snap to the actual terrain floor via a downward Rapier raycast — identical
      // approach to resolvePosition() in prop-placement.ts used for props/NPCs.
      // This corrects any Y inaccuracy in the stored position and works for both
      // outdoor (real collision mesh) and indoor (synthetic flat floor) scenes.
      const fbY = splatGroundOffset !== undefined ? -splatGroundOffset : 0;
      const pw = physicsRef.world;
      const R = physicsRef.RAPIER;
      let floorY = fbY;
      if (pw && R) {
        const downRay = new R.Ray({ x: storedX, y: fbY + 2, z: storedZ }, { x: 0, y: -1, z: 0 });
        const floorHit = pw.castRay(downRay, 30, false);
        if (floorHit) floorY = (fbY + 2) - floorHit.timeOfImpact;
      }

      const pos = { x: storedX, y: floorY, z: storedZ };
      const targetSceneId = typeof obj.metadata.targetSceneId === "string" ? obj.metadata.targetSceneId : null;
      const targetSceneName = typeof obj.metadata.targetSceneName === "string" ? obj.metadata.targetSceneName : null;
      const group = createPortalMesh(pos);
      portalMap.set(obj.objectId, { position: pos, targetSceneId, targetSceneName, group });
    }

    function loadPortals(): void {
      for (const obj of sceneObjectsRef.current ?? []) {
        loadSinglePortal(obj);
      }
    }

    function removeSinglePortal(objectId: string): void {
      const entry = portalMap.get(objectId);
      if (!entry) return;
      disposePortal(entry);
      portalMap.delete(objectId);
      if (nearPortalIdRef.current === objectId) {
        nearPortalIdRef.current = null;
        onPortalLeaveRef.current?.();
      }
    }

    (window as unknown as Record<string, unknown>).__loadScenePortal = loadSinglePortal;
    (window as unknown as Record<string, unknown>).__removeScenePortal = removeSinglePortal;

    // Portal proximity check — call from physicsLoop after syncPhysicsProps.
    const PORTAL_ENTER_DIST = 1.5;
    const PORTAL_LEAVE_DIST = 2.0;
    function checkPortalProximity(playerX: number, playerZ: number): void {
      let nearId: string | null = null;
      let nearEntry: PortalEntry | null = null;
      for (const [id, entry] of portalMap) {
        const dx = entry.position.x - playerX;
        const dz = entry.position.z - playerZ;
        if (Math.sqrt(dx * dx + dz * dz) < PORTAL_ENTER_DIST) {
          nearId = id;
          nearEntry = entry;
          break;
        }
      }

      if (nearId && nearPortalIdRef.current !== nearId) {
        nearPortalIdRef.current = nearId;
        onPortalApproachRef.current?.(nearId, nearEntry!.targetSceneId, nearEntry!.targetSceneName);
      } else if (!nearId && nearPortalIdRef.current) {
        // Check still outside leave distance for all portals
        const currentEntry = portalMap.get(nearPortalIdRef.current);
        if (currentEntry) {
          const dx = currentEntry.position.x - playerX;
          const dz = currentEntry.position.z - playerZ;
          if (Math.sqrt(dx * dx + dz * dz) > PORTAL_LEAVE_DIST) {
            nearPortalIdRef.current = null;
            onPortalLeaveRef.current?.();
          }
        } else {
          nearPortalIdRef.current = null;
          onPortalLeaveRef.current?.();
        }
      }
    }

    // ── Free-fly: mouse-drag look + WASD ─────────────────────────────────────
    // No pointer lock in free-fly — mouse look only while button is held.
    // This avoids a race where the free-fly lock resolves before the physics
    // onClick fires, making the click act as a shoot instead of "enter".
    const flyEuler = new Euler(0, 0, 0, "YXZ");
    let freeFlyActive = true;
    let ffDragging = false;

    // Height-adjust drag: grab a prop or NPC in free-fly and drag up/down to reposition.
    type HeightDragTarget = { objectId: string; group: Group; isNpc: boolean };
    let heightHovered: HeightDragTarget | null = null;
    let heightDrag: (HeightDragTarget & { startMouseY: number; startGroupY: number }) | null = null;

    // NPC meshes — populated by loadSceneNpc, used for click-to-talk raycasting.
    const npcMeshList: Mesh[] = [];

    // ── Ghost drag-to-place state ─────────────────────────────────────────────
    let ghostGroup: Group | null = null;
    // Ground offset cached at load time: distance to lift the group so its bottom is at y=0
    let ghostGroundOffset = 0;

    const cleanupGhost = () => {
      if (ghostGroup) {
        scene.remove(ghostGroup);
        ghostGroup.traverse((c) => {
          if (c instanceof Mesh) {
            c.geometry.dispose();
            const mats = Array.isArray(c.material) ? c.material : [c.material];
            for (const m of mats) (m as MeshStandardMaterial).dispose();
          }
        });
        ghostGroup = null;
      }
      ghostLoadTriggerRef.current = null;
      ghostPendingGroupRef.current = null;
    };

    const updateGhostPosition = (clientX: number, clientY: number) => {
      if (!ghostGroup) return;
      const rect = canvas.getBoundingClientRect();
      const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new Raycaster();
      raycaster.setFromCamera(new Vector2(nx, ny), camera);
      const { origin, direction: dir } = raycaster.ray;

      // Nominal floor Y — independent of camera height, used as XZ projection plane.
      // Actual terrain is between fbY and fbY+2 in Marble scenes.
      const fbY = splatGroundOffset !== undefined ? -splatGroundOffset : 0;

      // Project cursor ray to nominal floor for XZ position.
      // Minimum t=1.5m prevents placing ghost inside camera when cursor is at screen bottom.
      const MIN_T = 1.5;
      const MAX_T = 100;
      let tx: number;
      let tz: number;
      if (dir.y < -0.001) {
        const rawT = (fbY - origin.y) / dir.y;
        const t = Math.max(MIN_T, Math.min(rawT, MAX_T));
        tx = origin.x + dir.x * t;
        tz = origin.z + dir.z * t;
      } else {
        // Cursor not pointing down — place 10m ahead in XZ direction
        const lenXZ = Math.sqrt(dir.x * dir.x + dir.z * dir.z) || 1;
        tx = origin.x + (dir.x / lenXZ) * 10;
        tz = origin.z + (dir.z / lenXZ) * 10;
      }

      // Downward Rapier ray from that XZ → actual terrain Y.
      // Cap terrainY to be below the camera to prevent overhead geometry hits.
      const pw = physicsRef.world;
      const R = physicsRef.RAPIER;
      // Fallback when Rapier misses (open ground, no collider): camera is at panorama eye height,
      // so ground is roughly camera.y - 1.7m. Clamp to [fbY, camera.y - 0.3] for safety.
      const eyeHeightFallback = Math.max(fbY, Math.min(camera.position.y - 1.7, camera.position.y - 0.3));
      let terrainY = eyeHeightFallback;
      if (pw && R) {
        const downRay = new R.Ray({ x: tx, y: fbY + 10, z: tz }, { x: 0, y: -1, z: 0 });
        const hit = pw.castRay(downRay, 20, true);
        if (hit && hit.timeOfImpact > 0.01) {
          const hitY = (fbY + 10) - hit.timeOfImpact;
          // Only accept hit if it's below camera (ignore ceiling/overhead colliders)
          if (hitY < origin.y - 0.3) terrainY = hitY;
        } else {
          const hit2 = pw.castRay(downRay, 20, false);
          if (hit2 && hit2.timeOfImpact > 0.01) {
            const hitY = (fbY + 10) - hit2.timeOfImpact;
            if (hitY < origin.y - 0.3) terrainY = hitY;
          }
        }
      }

      ghostGroup.position.set(tx, terrainY + ghostGroundOffset, tz);
    };

    // Script mesh placement — place mesh at fixed distance along the look direction from screen center.
    // This means WASD (camera translation) does NOT move the mesh; only mouse rotation does.
    const SCRIPT_MESH_DIST = 3.0; // metres in front of camera

    // Billboard + visibility: face camera, hide when viewing from >45° off-axis.
    const _smFwd = new Vector3();
    const _smToMesh = new Vector3();
    function tickScriptMeshes() {
      const meshes = scriptMeshesRef.current;
      if (!meshes || meshes.length === 0) return;
      camera.getWorldDirection(_smFwd);
      for (const m of meshes) {
        _smToMesh.subVectors(m.position, camera.position).normalize();
        const dot = _smFwd.dot(_smToMesh); // 1 = looking straight at it, 0 = 90°
        m.visible = dot > 0.7; // ~45° half-angle cone
        if (m.visible) m.lookAt(camera.position);
      }
    }
    const updateScriptMeshPosition = (clientX: number, clientY: number) => {
      const meshes = scriptMeshesRef.current;
      if (!meshes || meshes.length === 0) return;
      const rect = canvas.getBoundingClientRect();
      const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new Raycaster();
      raycaster.setFromCamera(new Vector2(nx, ny), camera);
      const { origin, direction: dir } = raycaster.ray;
      const tx = origin.x + dir.x * SCRIPT_MESH_DIST;
      const ty = origin.y + dir.y * SCRIPT_MESH_DIST;
      const tz = origin.z + dir.z * SCRIPT_MESH_DIST;
      for (const m of meshes) {
        m.position.set(tx, ty, tz);
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      if (!freeFlyActive) return;
      if (e.button === 0) {
        // Start height-adjust drag if in edit mode and hovering a prop or NPC
        if (editModeRef.current && heightHovered) {
          heightDrag = { ...heightHovered, startMouseY: e.clientY, startGroupY: heightHovered.group.position.y };
          canvas.style.cursor = "grabbing";
          e.preventDefault();
          return;
        }
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
            const hitX = origin.x + dir.x * hit.timeOfImpact;
            const hitZ = origin.z + dir.z * hit.timeOfImpact;
            const hitY = origin.y + dir.y * hit.timeOfImpact;
            // For NPC/prop/portal placement, always snap Y to the actual terrain surface
            // by casting a second downward ray from above the hit XZ point.
            // This prevents storing a tree-trunk or elevated-surface Y when the user
            // clicks on a raised collider rather than the ground.
            const fbY = splatGroundOffset !== undefined ? -splatGroundOffset : 0;
            let groundedY = hitY;
            const downRay = new R.Ray({ x: hitX, y: fbY + 3, z: hitZ }, { x: 0, y: -1, z: 0 });
            const groundHit = pw.castRay(downRay, 30, false);
            if (groundHit) groundedY = (fbY + 3) - groundHit.timeOfImpact;
            const pt = {
              x: hitX,
              y: groundedY,
              z: hitZ,
              ts: Date.now(),
            };
            (window as unknown as Record<string, unknown>).__clickPosition = { x: hitX, y: hitY, z: hitZ, ts: pt.ts };
            // Use ghost's current position when drag-to-place is active; fallback to raycast hit.
            // Send terrainY (ghost.y - groundOffset) so the renderer's +groundOffset lands feet on ground.
            const placementPos = ghostGroup
              ? { x: ghostGroup.position.x, y: ghostGroup.position.y - ghostGroundOffset, z: ghostGroup.position.z }
              : { x: pt.x, y: pt.y, z: pt.z };
            // If NPC placement is pending, deliver the hit position and consume the click
            if (npcPlacementPendingRef.current) {
              onNpcPlaceRef.current?.(placementPos);
              cleanupGhost();
              return;
            }
            // If prop placement is pending, deliver the hit position and consume the click
            if (propPlacementPendingRef.current) {
              onPropPlaceRef.current?.(placementPos);
              cleanupGhost();
              return;
            }
            // If portal placement is pending, deliver the hit position and consume the click
            if (portalPlacementPendingRef.current) {
              onPortalPlaceRef.current?.({ x: pt.x, y: pt.y, z: pt.z });
              return;
            }
            // If script mesh placement is pending, confirm using mesh's current position (already updated by physicsLoop)
            if (scriptMeshPlacementPendingRef.current) {
              const meshes = scriptMeshesRef.current;
              scriptMeshPlacementPendingRef.current = false;
              if (meshes && meshes.length > 0) {
                const m = meshes[0];
                onScriptMeshPlaceRef.current?.({ x: m.position.x, y: m.position.y, z: m.position.z });
              } else {
                onScriptMeshPlaceRef.current?.({ x: pt.x, y: pt.y, z: pt.z });
              }
              return;
            }
            // Show 2-second visual indicator dot at screen position
            if (clickIndicatorTimer !== null) clearTimeout(clickIndicatorTimer);
            setClickIndicator({ x: e.clientX - rect.left, y: e.clientY - rect.top });
            clickIndicatorTimer = setTimeout(() => setClickIndicator(null), 2000);
          }
        } else if (npcPlacementPendingRef.current || propPlacementPendingRef.current || portalPlacementPendingRef.current || scriptMeshPlacementPendingRef.current) {
          // No physics world available — intersect camera ray with a horizontal ground plane.
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
              const pt = ghostGroup
                ? { x: ghostGroup.position.x, y: ghostGroup.position.y - ghostGroundOffset, z: ghostGroup.position.z }
                : { x: origin.x + dir.x * t, y: groundY, z: origin.z + dir.z * t };
              if (npcPlacementPendingRef.current) {
                onNpcPlaceRef.current?.(pt);
                cleanupGhost();
              } else if (portalPlacementPendingRef.current) {
                onPortalPlaceRef.current?.(pt);
              } else if (scriptMeshPlacementPendingRef.current) {
                const meshes = scriptMeshesRef.current;
                const meshY = meshes && meshes.length > 0 ? meshes[0].position.y : pt.y;
                scriptMeshPlacementPendingRef.current = false;
                onScriptMeshPlaceRef.current?.({ x: pt.x, y: meshY, z: pt.z });
              } else {
                onPropPlaceRef.current?.(pt);
                cleanupGhost();
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
    const onMouseUp = () => {
      ffDragging = false;
      if (heightDrag) {
        const { objectId, group, isNpc } = heightDrag;
        const pos = { x: group.position.x, y: group.position.y, z: group.position.z };
        if (sceneId && sessionId) {
          patchSceneObjectPosition(sceneId, sessionId, objectId, pos).catch(console.warn);
        }
        if (!isNpc) propPositionsRef.current.set(objectId, pos);
        heightDrag = null;
        canvas.style.cursor = heightHovered ? "grab" : "";
      }
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!freeFlyActive) return;

      // Height-adjust drag: move group Y only
      if (heightDrag) {
        const dy = (heightDrag.startMouseY - e.clientY) * 0.01;
        heightDrag.group.position.y = heightDrag.startGroupY + dy;
        return;
      }

      // Right-click drag: rotate camera (in selfie mode, updates orbit angle instead of directly rotating)
      if (ffDragging) {
        const sens = 0.003;
        flyEuler.y -= e.movementX * sens;
        flyEuler.x -= e.movementY * sens;
        flyEuler.x = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, flyEuler.x));
        camera.rotation.copy(flyEuler);
        if (scriptMeshPlacementPendingRef.current) updateScriptMeshPosition(e.clientX, e.clientY);
      }
      if (ghostGroup) updateGhostPosition(e.clientX, e.clientY);

      // Hover detection for height-adjust (only in edit mode, no ghost placement active)
      if (editModeRef.current && !ghostGroup && !npcPlacementPendingRef.current && !propPlacementPendingRef.current) {
        const rect = canvas.getBoundingClientRect();
        const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        const ray = new Raycaster();
        ray.setFromCamera(new Vector2(nx, ny), camera);

        // Collect all hittable meshes from props and NPCs
        const targets: { mesh: Mesh; objectId: string; group: Group; isNpc: boolean }[] = [];
        for (const [oid, grp] of propGroupsRef.current) {
          grp.traverse((c) => { if (c instanceof Mesh) targets.push({ mesh: c, objectId: oid, group: grp, isNpc: false }); });
        }
        for (const [oid, grp] of npcGroupsRef.current) {
          grp.traverse((c) => { if (c instanceof Mesh) targets.push({ mesh: c, objectId: oid, group: grp, isNpc: true }); });
        }

        const meshes = targets.map((t) => t.mesh);
        const hits = ray.intersectObjects(meshes, false);
        if (hits.length > 0) {
          const hitMesh = hits[0].object as Mesh;
          const target = targets.find((t) => t.mesh === hitMesh);
          if (target) {
            heightHovered = { objectId: target.objectId, group: target.group, isNpc: target.isNpc };
            canvas.style.cursor = "grab";
          } else {
            heightHovered = null;
            canvas.style.cursor = "";
          }
        } else {
          heightHovered = null;
          canvas.style.cursor = "";
        }
      }
    };

    // Window-level ghost mouse tracker — fires even when cursor is outside canvas or
    // pointer-lock is active. Picks up the loaded ghost from ghostPendingGroupRef and
    // keeps it following the cursor over the terrain.
    const onWindowMouseMove = (e: MouseEvent) => {
      // Adopt the pending ghost (loaded by the React useEffect) into the scene
      if (ghostPendingGroupRef.current && !ghostGroup) {
        const pending = ghostPendingGroupRef.current;
        ghostPendingGroupRef.current = null;
        ghostGroup = pending.group;
        ghostGroundOffset = pending.groundOffset;
        scene.add(ghostGroup);
      }
      if (ghostGroup) updateGhostPosition(e.clientX, e.clientY);
      if (scriptMeshPlacementPendingRef.current) {
        const rect = canvas.getBoundingClientRect();
        const cx = document.pointerLockElement === canvas ? rect.left + rect.width / 2 : e.clientX;
        const cy = document.pointerLockElement === canvas ? rect.top + rect.height / 2 : e.clientY;
        updateScriptMeshPosition(cx, cy);
      }
    };

    // Window-level left-click handler for ghost placement — fires in both free-fly
    // and physics mode (canvas mousedown is removed by stopFreeFly in physics mode).
    const onWindowMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (!npcPlacementPendingRef.current && !propPlacementPendingRef.current && !scriptMeshPlacementPendingRef.current) return;

      const pw = physicsRef.world;
      const R = physicsRef.RAPIER;

      // Ghost's position.y = terrainY + ghostGroundOffset (origin lifted so feet touch terrain).
      // The renderer does: final.y = stored.y + groundOffset, so we must send terrainY (feet level)
      // not the lifted origin, otherwise the NPC floats ghostGroundOffset above the ground.
      let pos: { x: number; y: number; z: number };
      if (ghostGroup) {
        const terrainY = ghostGroup.position.y - ghostGroundOffset;
        pos = { x: ghostGroup.position.x, y: terrainY, z: ghostGroup.position.z };
      } else {
        // Ghost failed to load — compute position from cursor + ground plane
        const fbY = splatGroundOffset !== undefined ? -splatGroundOffset : 0;
        const rect = canvas.getBoundingClientRect();
        const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        const raycaster = new Raycaster();
        raycaster.setFromCamera(new Vector2(nx, ny), camera);
        const { origin, direction: dir } = raycaster.ray;
        // Project to nominal floor first for approximate XZ
        let tx = origin.x + dir.x * 10;
        let tz = origin.z + dir.z * 10;
        let groundY = fbY;
        if (dir.y < -0.001) {
          const t = (fbY - origin.y) / dir.y;
          if (t > 0 && t < 150) { tx = origin.x + dir.x * t; tz = origin.z + dir.z * t; }
        }
        if (pw && R) {
          // Try direct cursor ray hit first (works on covered terrain)
          const ray = new R.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
          const hit = pw.castRay(ray, 200, true);
          if (hit && hit.timeOfImpact > 0.01) {
            tx = origin.x + dir.x * hit.timeOfImpact;
            groundY = origin.y + dir.y * hit.timeOfImpact;
            tz = origin.z + dir.z * hit.timeOfImpact;
          } else {
            // Open ground: downward ray from approximate XZ
            const downRay = new R.Ray({ x: tx, y: fbY + 10, z: tz }, { x: 0, y: -1, z: 0 });
            const dHit = pw.castRay(downRay, 20, false);
            if (dHit && dHit.timeOfImpact > 0.01) groundY = (fbY + 10) - dHit.timeOfImpact;
          }
        }
        pos = { x: tx, y: groundY, z: tz };
      }

      if (npcPlacementPendingRef.current) {
        onNpcPlaceRef.current?.(pos);
        cleanupGhost();
      } else if (propPlacementPendingRef.current) {
        onPropPlaceRef.current?.(pos);
        cleanupGhost();
      } else if (scriptMeshPlacementPendingRef.current) {
        // Use mesh's own position — it's already been updated every frame by physicsLoop
        scriptMeshPlacementPendingRef.current = false;
        const meshes = scriptMeshesRef.current;
        if (meshes && meshes.length > 0) {
          const m = meshes[0];
          onScriptMeshPlaceRef.current?.({ x: m.position.x, y: m.position.y, z: m.position.z });
        } else {
          onScriptMeshPlaceRef.current?.(pos);
        }
      }
    };

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mouseup",   onMouseUp);
    canvas.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mousemove", onWindowMouseMove);
    window.addEventListener("mousedown", onWindowMouseDown);

    // Keep flyEuler in sync when camera is repositioned externally

    // ── Script sandbox state (shared across free-fly + physics loops) ─────────
    const scriptAnimCallbacks: Array<(dt: number) => void> = [];
    const scriptSpawnedObjects = new Map<string, import("three").Object3D>();
    let scriptObjCounter = 0;

    // WorldAPI — available immediately in both free-fly and physics modes.
    // initPhysics() no longer re-creates this object; it just uses window.__worldAPI.
    const worldAPI = {
      provider: "splat" as const,
      THREE,
      scene,
      camera,
      animate(cb: (dt: number) => void) {
        scriptAnimCallbacks.push(cb);
      },
      spawn(opts: {
        shape?: string;
        x?: number; y?: number; z?: number;
        width?: number; height?: number; depth?: number;
        radius?: number;
        color?: string;
        opacity?: number;
        name?: string;
      }) {
        const x = opts.x ?? 0, y = opts.y ?? 1, z = opts.z ?? 0;
        const color = opts.color ?? "#ffffff";
        const opacity = opts.opacity ?? 1;
        const mat = new MeshStandardMaterial({ color, transparent: opacity < 1, opacity });
        let geo: import("three").BufferGeometry;
        const shape = opts.shape ?? "box";
        if (shape === "sphere") {
          geo = new SphereGeometry(opts.radius ?? 0.5, 16, 16);
        } else if (shape === "cylinder") {
          geo = new CylinderGeometry(opts.radius ?? 0.3, opts.radius ?? 0.3, opts.height ?? 1, 16);
        } else if (shape === "plane") {
          geo = new PlaneGeometry(opts.width ?? 1, opts.height ?? 1);
        } else {
          geo = new BoxGeometry(opts.width ?? 1, opts.height ?? 1, opts.depth ?? 1);
        }
        const mesh = new Mesh(geo, mat);
        mesh.position.set(x, y, z);
        if (opts.name) mesh.name = opts.name;
        scene.add(mesh);
        const id = `script_obj_${++scriptObjCounter}`;
        scriptSpawnedObjects.set(id, mesh);
        return id;
      },
      despawn(objectId: string) {
        const obj = scriptSpawnedObjects.get(objectId);
        if (obj) { scene.remove(obj); scriptSpawnedObjects.delete(objectId); }
      },
      setColor(objectId: string, color: string) {
        const obj = scriptSpawnedObjects.get(objectId);
        if (obj instanceof Mesh && obj.material instanceof MeshStandardMaterial) {
          obj.material.color.set(color);
        }
      },
      showToast(text: string, durationMs = 3000) {
        window.dispatchEvent(new CustomEvent("world:toast", { detail: { text, durationMs } }));
      },
      setDisplay(html: string | null) {
        window.dispatchEvent(new CustomEvent("world:display", { detail: { html } }));
      },
      // Alias for legacy generated code that hallucinated showPanel
      showPanel(html: string | null) {
        window.dispatchEvent(new CustomEvent("world:display", { detail: { html } }));
      },
      spark: {
        addEdit(edit: unknown) {
          if (!splat.edits) splat.edits = [];
          splat.edits.push(edit as SplatEdit);
        },
        removeEdit(edit: unknown) {
          if (splat.edits) {
            const idx = splat.edits.indexOf(edit as SplatEdit);
            if (idx !== -1) splat.edits.splice(idx, 1);
          }
        },
        addSplat(mesh: unknown) {
          scene.add(mesh as SplatMesh);
          return () => scene.remove(mesh as SplatMesh);
        },
        setDof(focalDistance: number, apertureAngle: number) {
          sparkRenderer.focalDistance = focalDistance;
          sparkRenderer.apertureAngle = apertureAngle;
        },
        Spark: {
          SplatEdit,
          SplatEditSdf,
          SplatEditSdfType,
          SplatEditRgbaBlendMode,
          snowBox: generators.snowBox,
          imageSplats,
          textSplats,
        },
      },
    };
    (window as unknown as Record<string, unknown>).__worldAPI = worldAPI;

    // ── Recording state ───────────────────────────────────────────────────────
    let mediaRecorder: MediaRecorder | null = null;
    let recordedChunks: Blob[] = [];
    let stopResolve: ((blob: Blob | null) => void) | null = null;

    onCameraReadyRef.current?.({
      captureFrame: () => {
        renderer.render(scene, camera);
        return canvas.toDataURL("image/png", 1.0);
      },
      setSelfieMode: (on: boolean) => {
        selfieModeRef.current = on;
        avatarGroup.visible = on;
        if (on) {
          // Exit pointer lock so free-fly (with lookAt + orbit) takes over.
          if (document.pointerLockElement) document.exitPointerLock();
          // Init pivot at current camera position so avatar appears where player stands.
          selfiePivot.copy(camera.position);
          selfiePivotInit = true;
          // Start orbit facing the player: tilt slightly down, keep current y-angle.
          flyEuler.x = 0.15;
          // camera will be repositioned on next freeFlyLoop tick
        } else {
          selfiePivotInit = false;
          syncEuler();
        }
      },
      setFov: (fov: number) => {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      },
      startRecording: (fps = 30) => {
        if (mediaRecorder && mediaRecorder.state !== "inactive") return;
        recordedChunks = [];
        const stream = (canvas as unknown as { captureStream(fps: number): MediaStream }).captureStream(fps);
        const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
          ? "video/webm;codecs=vp9"
          : MediaRecorder.isTypeSupported("video/webm")
          ? "video/webm"
          : "video/mp4";
        mediaRecorder = new MediaRecorder(stream, { mimeType });
        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = () => {
          const blob = recordedChunks.length > 0 ? new Blob(recordedChunks, { type: mimeType }) : null;
          stopResolve?.(blob);
          stopResolve = null;
          mediaRecorder = null;
          recordedChunks = [];
        };
        mediaRecorder.start(100); // collect chunks every 100ms
      },
      stopRecording: () => {
        return new Promise<Blob | null>((resolve) => {
          if (!mediaRecorder || mediaRecorder.state === "inactive") { resolve(null); return; }
          stopResolve = resolve;
          mediaRecorder.stop();
        });
      },
    });

    const syncEuler = () => { flyEuler.setFromQuaternion(camera.quaternion, "YXZ"); };

    const freeFlyFwd   = new Vector3();
    const freeFlyRight = new Vector3();
    const freeFlyMove  = new Vector3();
    // Selfie mode pivot — tracks virtual player position in free-fly mode.
    const selfiePivot = new Vector3();
    let selfiePivotInit = false;
    let freeFlyFrameCount = 0;

    function freeFlyLoop() {
      if (!freeFlyActive) return;
      animId = requestAnimationFrame(freeFlyLoop);

      camera.getWorldDirection(freeFlyFwd);
      freeFlyFwd.y = 0;
      if (freeFlyFwd.lengthSq() > 0.0001) freeFlyFwd.normalize();
      freeFlyRight.crossVectors(freeFlyFwd, worldUp).normalize();
      freeFlyMove.set(0, 0, 0);

      if (selfieModeRef.current) {
        // Initialise pivot at current camera position first time selfie activates.
        if (!selfiePivotInit) { selfiePivot.copy(camera.position); selfiePivotInit = true; }

        if (keys.size > 0) {
          const spd = (keys.has("shift") ? 5 : 1) * 0.05;
          // Move pivot along orbit forward (XZ direction from flyEuler.y angle)
          const moveFwd = new Vector3(Math.sin(flyEuler.y), 0, Math.cos(flyEuler.y));
          const moveRight = new Vector3(Math.cos(flyEuler.y), 0, -Math.sin(flyEuler.y));
          if (keys.has("w") || keys.has("arrowup"))    selfiePivot.addScaledVector(moveFwd,   -spd);
          if (keys.has("s") || keys.has("arrowdown"))  selfiePivot.addScaledVector(moveFwd,    spd);
          if (keys.has("a") || keys.has("arrowleft"))  selfiePivot.addScaledVector(moveRight, -spd);
          if (keys.has("d") || keys.has("arrowright")) selfiePivot.addScaledVector(moveRight,  spd);
        }

        // Place avatar at pivot.
        avatarGroup.position.set(selfiePivot.x, selfiePivot.y - 0.8, selfiePivot.z);

        // Orbit camera around avatar: fly euler controls orbit angle, distance = 2.5m.
        const orbitDist = 2.5;
        camera.position.set(
          selfiePivot.x + Math.sin(flyEuler.y) * orbitDist * Math.cos(flyEuler.x),
          selfiePivot.y + Math.sin(flyEuler.x) * orbitDist + 0.5,
          selfiePivot.z + Math.cos(flyEuler.y) * orbitDist * Math.cos(flyEuler.x),
        );
        camera.lookAt(selfiePivot.x, selfiePivot.y + 0.8, selfiePivot.z);
      } else {
        selfiePivotInit = false;
        if (keys.size > 0) {
          const spd = (keys.has("shift") ? 5 : 1) * 0.05;
          if (keys.has("w") || keys.has("arrowup"))    freeFlyMove.addScaledVector(freeFlyFwd,    spd);
          if (keys.has("s") || keys.has("arrowdown"))  freeFlyMove.addScaledVector(freeFlyFwd,   -spd);
          if (keys.has("a") || keys.has("arrowleft"))  freeFlyMove.addScaledVector(freeFlyRight,  -spd);
          if (keys.has("d") || keys.has("arrowright")) freeFlyMove.addScaledVector(freeFlyRight,   spd);
          if (freeFlyMove.lengthSq() > 0) camera.position.add(freeFlyMove);
        }
      }
      tickPortals();
      tickScriptMeshes();
      renderer.render(scene, camera);
      // Update NPC animation mixers and script animate callbacks.
      // Both need a delta — compute once and share.
      const ffDelta = clock.getDelta();
      for (const [, grp] of npcGroupsRef.current) {
        const m = grp.userData.mixer as AnimationMixer | undefined;
        if (m) m.update(ffDelta);
      }
      if (scriptAnimCallbacks.length > 0) {
        for (const cb of scriptAnimCallbacks) { try { cb(ffDelta); } catch { /* ignore */ } }
      }
      if (splatInitialized && freeFlyFrameCount % 10 === 0) {
        const cx = camera.position.x;
        const cz = camera.position.z;
        const nearbyProp = findNearbyInteractiveProp(
          sceneObjectsRef.current ?? [],
          cx, cz,
          propPositionsRef.current,
        );
        const prevPropId = (window as unknown as Record<string, unknown>).__nearbyInteractiveProp as string | null ?? null;
        if (nearbyProp && nearbyProp.objectId !== prevPropId) {
          (window as unknown as Record<string, unknown>).__nearbyInteractiveProp = nearbyProp.objectId;
          onPropApproachRef.current?.(nearbyProp.objectId, nearbyProp.name, nearbyProp.skillName, nearbyProp.skillConfig);
        } else if (!nearbyProp && prevPropId !== null) {
          const prevPos = propPositionsRef.current.get(prevPropId);
          if (!prevPos || (cx - prevPos.x) ** 2 + (cz - prevPos.z) ** 2 > PROP_LEAVE_RADIUS * PROP_LEAVE_RADIUS) {
            (window as unknown as Record<string, unknown>).__nearbyInteractiveProp = null;
            onPropLeaveRef.current?.();
          }
        }
      }
      // Once the splat is parsed, sample the center pixel every ~30 frames.
      // readPixels causes a GPU-CPU sync stall; throttling keeps it cheap.
      // The 3-s setTimeout fallback above ensures we never get stuck.
      if (splatInitialized && canvas!.clientWidth > 0 && canvas!.clientHeight > 0 && ++freeFlyFrameCount % 30 === 0) {
        const gl = renderer.getContext() as WebGL2RenderingContext;
        // SparkJS may leave a PBO bound after rendering; unbind before readPixels
        // or the call fails with INVALID_OPERATION and returns zeros forever.
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
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
      heightHovered = null;
      heightDrag = null;
      if (canvas) canvas.style.cursor = "";
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

      const groundOffset = splatGroundOffset ?? 2.0;
      const isIndoor = groundOffset < 1.8;

      if (!isIndoor) {
        // Outdoor scenes: load the full collision mesh (terrain, slopes, etc.).
        await buildWorldColliders(world, colliderMeshUrl!);
        if (cancelled) { world.free(); return; }
      } else {
        // Indoor scenes: skip the collision mesh entirely.
        // The Marble-generated mesh for rooms contains dense wall/furniture geometry
        // that surrounds the spawn origin and blocks all KCC movement.
        // A large synthetic floor plane provides the only physics surface needed;
        // there is no risk of falling off cliffs indoors.
        const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(50, 0.05, 50)
            .setTranslation(0, -groundOffset - 0.05, 0)
            .setFriction(0.8),
          floorBody,
        );
      }

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
      if (cancelled) { disposed.value = true; disposePhysicsProps(props, world, scene); try { world.free(); } catch { /* Rapier WASM panic guard */ } return; }

      // NPC position overrides — maps objectId → resolved world position.
      // SceneObjects start with position {0,0,0}; after a model loads its resolved
      // position is stored here and used by the proximity check.
      const npcPositions = npcPositionsRef.current;
      npcPositions.clear();
      // Three.js groups for NPC models — cleaned up alongside props on teardown.
      const npcGroups = new Map<string, import("three").Group>();

      // Load a single NPC model and register its resolved position.
      const loadSceneNpc = async (obj: import("../types.js").SceneObject): Promise<void> => {
        // Bail early if physics has been torn down (scene switch in progress).
        if (disposed.value) return;
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
        const occupied = [...npcPositions.values(), ...props.filter((p) => !p.removed).map((p) => { const t = p.body.translation(); return { x: t.x, y: t.y, z: t.z }; })];
        // Always re-resolve position: Rapier auto-corrects bad stored Y values (e.g. fallback floor
        // from old placements).  For "exact" hints this validates the terrain Y via downward raycast.
        // CONTRACT: resolved pos.y is terrain surface (feet level); renderer adds groundOffset on top.
        const pos = resolvePosition(hint, world, occupied, viewpoints ?? [], npcGroups.size, playerPos, splatGroundOffset, cameraFwd);

        // If resolvePosition returned the fallback floor (Rapier missed — open terrain), substitute
        // a better ground estimate: the eye-height estimate stored in playerPosition.y by the
        // ghost placement flow.  This prevents NPCs from sinking below visual terrain on
        // uncollided grass/path areas.  Only applies when the playerPosition.y is meaningfully
        // above the fallback (i.e. was set by the ghost flow, not by the old fallback-only system).
        const fallbackFloor = splatGroundOffset !== undefined ? -splatGroundOffset : 0;
        const resolvedPos = (Math.abs(pos.y - fallbackFloor) < 0.01 && playerPos && playerPos.y > fallbackFloor + 0.5)
          ? { x: pos.x, y: playerPos.y, z: pos.z }
          : pos;
        npcPositions.set(obj.objectId, resolvedPos);

        // Lock position back to server only for non-exact placements (auto-resolved by arc/slot logic).
        // Exact positions are stable — re-patching every load would generate unnecessary writes.
        if (hint !== "exact" && sceneId && sessionId) {
          patchSceneObjectPosition(sceneId, sessionId, obj.objectId, resolvedPos).catch(() => { /* non-fatal */ });
        }

        const group = (await objectRendererRegistry.render(obj, { envMap: sceneEnvMap ?? undefined })) as import("three").Group | null;
        if (!group) return;
        if (disposed.value) {
          objectRendererRegistry.dispose(group);
          return;
        }
        // Orient the model upright: if the Y extent is less than 75 % of the max extent,
        // the model is lying flat. Threshold 0.75 is calibrated in the placement skill
        // to catch Joyce (ratio ≈ 0.66) without triggering on upright models.
        // Reset ALL transforms: GLTF root scene may have baked-in position/rotation that
        // Reset all transforms before measuring — GLTF root may have baked-in offsets
        // that corrupt bbox measurements if not cleared first.
        group.position.set(0, 0, 0);
        group.rotation.set(0, 0, 0);
        group.scale.setScalar(1);
        // Orient upright: try all 90° candidates, keep whichever maximises Y/horizontal ratio
        orientUpright(group);
        // Scale to targetHeight when provided — purely data-driven, no type inference.
        // Cap at 10× to guard against orientation-detection misfires on tiny models.
        let effectiveScale = scale;
        const targetHeight = typeof obj.metadata.targetHeight === "number" ? obj.metadata.targetHeight : undefined;
        if (targetHeight !== undefined && scale === 1) {
          group.updateMatrixWorld(true);
          // Use mesh-only bbox to avoid bone nodes inflating the measurement
          const scaledBbox = meshOnlyBoundingBox(group);
          const modelHeight = scaledBbox.max.y - scaledBbox.min.y;
          if (modelHeight > 0.01) effectiveScale = Math.min(targetHeight / modelHeight, 10);
        }
        group.scale.setScalar(effectiveScale);
        group.updateMatrixWorld(true);
        // Use mesh-only bbox so skeleton Bone nodes don't push min.y below ground
        const bbox = meshOnlyBoundingBox(group);
        // bbox is in world space — negate min.y directly to sit model on ground.
        const groundOffset = -bbox.min.y;
        group.position.set(resolvedPos.x, resolvedPos.y + groundOffset, resolvedPos.z);
        group.traverse((c) => {
          c.userData.objectId = obj.objectId;
          if (c instanceof Mesh) {
            c.userData.npcObjectId = obj.objectId;
            c.userData.npcName = obj.name;
            npcMeshList.push(c);
          }
        });
        scene.add(group);
        group.userData.shadowPlane = createContactShadow(group, resolvedPos.y);
        // Animation setup — plays idle loop when the GLB contains skeletal clips
        const clips = (group.userData._animations ?? []) as import("three").AnimationClip[];
        if (clips.length > 0) {
          const mixer = new AnimationMixer(group);
          const idleClip = clips.find((c) => /idle/i.test(c.name)) ?? clips[0];
          const idleAction = mixer.clipAction(idleClip);
          idleAction.play();
          group.userData.mixer = mixer;
          group.userData.animClips = clips;
          group.userData.activeAction = idleAction;
        }
        npcGroups.set(obj.objectId, group);
        npcGroupsRef.current.set(obj.objectId, group);
      };

      const removeSceneNpc = (objectId: string): void => {
        npcPositions.delete(objectId);
        // Remove tagged meshes from click-detection list
        for (let i = npcMeshList.length - 1; i >= 0; i--) {
          if (npcMeshList[i].userData.npcObjectId === objectId) npcMeshList.splice(i, 1);
        }
        const group = npcGroups.get(objectId);
        if (group) {
          disposeContactShadow(group);
          scene.remove(group);
          npcGroups.delete(objectId);
          npcGroupsRef.current.delete(objectId);
        }
      };
      (window as unknown as Record<string, unknown>).__loadSceneNpc = loadSceneNpc;
      (window as unknown as Record<string, unknown>).__removeSceneNpc = removeSceneNpc;

      // Shared animation helper used by __moveNpc and __emoteNpc
      const playNpcAnimation = (group: import("three").Group, animation: string) => {
        const mixer = group.userData.mixer as AnimationMixer | undefined;
        const clips = group.userData.animClips as import("three").AnimationClip[] | undefined;
        if (!mixer || !clips) { group.userData.pendingAnimation = animation; return; }
        const key = animation.toLowerCase();
        // First try exact match via NAME_MAP, then fuzzy substring match on clip names.
        const NAME_MAP: Record<string, string> = {
          idle: "Idle_FoldArms_Loop",
          walk: "Walk_Carry_Loop",
          wave: "Yes",
          bow: "LayToIdle",
        };
        const mapped = (NAME_MAP[key] ?? animation).toLowerCase();
        const clip =
          clips.find((c) => c.name.toLowerCase() === mapped) ??
          clips.find((c) => c.name.toLowerCase().includes(key)) ??
          clips[0];
        const prev = group.userData.activeAction as import("three").AnimationAction | undefined;
        const next = mixer.clipAction(clip);
        if (prev && prev !== next) { next.reset().fadeIn(0.3); prev.fadeOut(0.3); }
        else { next.reset().play(); }
        group.userData.activeAction = next;
      };

      // Move an NPC to a new world position.
      // Sequence: 1) turn to face target (0.3 s), 2) walk animation + translate, 3) idle on arrival.
      // Speed: ~1.2 m/s (walking pace). Minimum distance: 0.1 m — skip if already close.
      (window as unknown as Record<string, unknown>).__moveNpc = (objectId: string, pos: { x: number; y: number; z: number }) => {
        const group = npcGroups.get(objectId);
        if (!group) return;
        npcPositions.set(objectId, pos);

        const startPos = group.position.clone();
        const dx = pos.x - startPos.x;
        const dz = pos.z - startPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < 0.1) return;

        // Dismiss chat overlay when the NPC being chatted with starts moving
        onPlayerMoveRef.current?.();

        // Target yaw: NPC models face -Z by default (standard glTF forward).
        // atan2(dx, dz) gives the angle from +Z toward the target; negate for Y-up left-hand.
        const targetYaw = Math.atan2(dx, dz);
        const startYaw = group.rotation.y;

        // Normalise angle delta to [-π, π]
        let dyaw = ((targetYaw - startYaw) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;

        const TURN_MS = 300;
        const walkDurationMs = (dist / 1.2) * 1000;
        const turnStart = performance.now();

        // Phase 1: turn to face the target
        const turn = () => {
          const t = Math.min((performance.now() - turnStart) / TURN_MS, 1);
          group.rotation.y = startYaw + dyaw * t;
          if (t < 1) { requestAnimationFrame(turn); return; }
          // Phase 2: walk toward target
          group.rotation.y = targetYaw;
          playNpcAnimation(group, "walk");
          const walkStart = performance.now();
          const step = () => {
            const tw = Math.min((performance.now() - walkStart) / walkDurationMs, 1);
            const newX = startPos.x + dx * tw;
            const newZ = startPos.z + dz * tw;
            group.position.set(newX, pos.y !== undefined ? pos.y : startPos.y, newZ);
            const shadow = group.userData.shadowPlane as Mesh | undefined;
            if (shadow) { shadow.position.x = newX; shadow.position.z = newZ; }
            if (tw < 1) { requestAnimationFrame(step); return; }
            // Phase 3: arrived — switch to idle
            playNpcAnimation(group, "idle");
          };
          requestAnimationFrame(step);
        };
        requestAnimationFrame(turn);
      };

      // Play an animation clip on the NPC's AnimationMixer (if the GLB has clips).
      // Crossfades from the currently active action with a 0.3 s blend.
      (window as unknown as Record<string, unknown>).__emoteNpc = (objectId: string, animation: string) => {
        const group = npcGroups.get(objectId);
        if (!group) return;
        playNpcAnimation(group, animation);
      };

      // Load all NPCs that exist at physics init time.
      for (const obj of extractNpcs(sceneObjectsRef.current ?? [])) {
        loadSceneNpc(obj).catch((err) => {
          console.warn("[SplatViewer] failed to load NPC model", obj.name, err);
          // Still register position so proximity works even without a model.
          npcPositions.set(obj.objectId, { x: obj.position.x, y: obj.position.y, z: obj.position.z });
        });
      }

      // Physics ready — expose world refs first so loadPortals() can raycast.
      physicsRef.world = world as typeof physicsRef.world;
      physicsRef.RAPIER = RAPIER as typeof physicsRef.RAPIER;

      // Load all portals that exist at physics init time.
      loadPortals();

      setPhysicsReady(true);

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
          const rendered = await objectRendererRegistry.render(obj, { envMap: sceneEnvMap ?? undefined });
          if (rendered) {
            group = rendered as import("three").Group;
          } else {
            // No model URL — create an invisible 0.5m placeholder so the prop is
            // raycasted by the E key and skill interactions still work.
            const placeholder = new Group();
            const hitbox = new Mesh(
              new BoxGeometry(0.5, 0.5, 0.5),
              new MeshStandardMaterial({ transparent: true, opacity: 0, depthWrite: false }),
            );
            hitbox.renderOrder = -1;
            hitbox.userData.objectId = obj.objectId;
            placeholder.add(hitbox);
            group = placeholder;
          }
        } catch (err) {
          console.warn("[loadSceneProp] failed to load", obj.metadata.modelUrl, err);
          setPropLoadErrors((prev) => [...prev, obj.name]);
          return;
        }
        // Scale to targetHeight when provided — data-driven, no type inference.
        let effectiveScale = scale;
        const propTargetHeight = typeof obj.metadata.targetHeight === "number" ? obj.metadata.targetHeight : undefined;
        if (propTargetHeight !== undefined && scale === 1) {
          group.scale.setScalar(1);
          group.updateMatrixWorld(true);
          const rawBbox = new Box3().setFromObject(group);
          const rawHeight = rawBbox.max.y - rawBbox.min.y;
          if (rawHeight > 0.01) effectiveScale = Math.min(propTargetHeight / rawHeight, 10);
        }
        group.scale.setScalar(effectiveScale);
        group.updateMatrixWorld(true);
        // meshOnlyBoundingBox excludes Bone nodes; result is world space so groundOffset = -min.y directly.
        const bbox = meshOnlyBoundingBox(group);
        const groundOffset = -bbox.min.y;
        group.position.set(pos.x, pos.y + groundOffset, pos.z);
        propPositionsRef.current.set(obj.objectId, { x: group.position.x, y: group.position.y, z: group.position.z });
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
        propGroupsRef.current.set(obj.objectId, group);
      };
      (window as unknown as Record<string, unknown>).__loadSceneProp = loadSceneProp;

      // WorldAPI is now constructed at outer scope (before initPhysics) so it is
      // available in both free-fly and physics modes. No re-declaration needed here.

      const removeSceneProp = (objectId: string): void => {
        const idx = props.findIndex((p) => p.objectId === objectId);
        if (idx === -1) return;
        const [removed] = props.splice(idx, 1);
        propPositionsRef.current.delete(objectId);
        scene.remove(removed.group);
        world.removeRigidBody(removed.body);
      };
      (window as unknown as Record<string, unknown>).__removeSceneProp = removeSceneProp;

      const fwd = new Vector3();
      const right = new Vector3();

      // Last known body position — used to re-enter at the same spot after ESC.
      // Y is stored so re-entry spawns at the exact last height (no raycast needed).
      let lastBodyXZ = { x: camera.position.x, z: camera.position.z };
      let lastBodyY: number | null = null;

      // Two-path spawn: outdoor vs. indoor (same discriminator as collision setup above).
      function findSpawnPosition(startX: number, startZ: number): { x: number; y: number; z: number } {
        if (!isIndoor) {
          // PATH A: outdoor — prefer viewpoints[0] XZ (guaranteed inside the splat),
          // fall back to camera XZ only if no viewpoints are defined.
          const vp = viewpoints?.[0];
          const spawnX = vp ? vp.position.x : startX;
          const spawnZ = vp ? vp.position.z : startZ;
          return { x: spawnX, y: camera.position.y - 0.8, z: spawnZ };
        }
        // PATH B: indoor — only the synthetic floor at Y=-groundOffset exists.
        // Capsule bottom 0.1 m above it; KCC snaps down on frame 1.
        return { x: startX, y: -groundOffset + 1.0, z: startZ };
      }

      let physicsLoopFrame = 0;
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

        // Notify App when player moves so it can dismiss the chat overlay
        if ((dx !== 0 || dz !== 0) && onPlayerMoveRef.current) {
          onPlayerMoveRef.current();
        }

        cc.move(world, { x: dx, z: dz }, delta);
        world.step();

        const pos = cc.body.translation();
        lastBodyXZ.x = pos.x;
        lastBodyXZ.z = pos.z;
        lastBodyY = pos.y;
        // Eye is 0.8m above body center (standard Y-up: eye = body.y + 0.8)
        // Eye offset: 0.8 m for outdoor (normal standing height);
        // 0.5 m for indoor so the camera sits lower in the room (~1.4 m above floor).
        camera.position.set(pos.x, pos.y + (isIndoor ? 0.5 : 0.8), pos.z);
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
        checkPortalProximity(pos.x, pos.z);

        // Prop proximity — check every 10 frames (~6 Hz at 60 fps)
        if (physicsLoopFrame % 10 === 0) {
          const nearbyProp = findNearbyInteractiveProp(
            sceneObjectsRef.current ?? [],
            pos.x, pos.z,
            propPositionsRef.current,
          );
          const prevPropId = (window as unknown as Record<string, unknown>).__nearbyInteractiveProp as string | null ?? null;
          if (nearbyProp && nearbyProp.objectId !== prevPropId) {
            (window as unknown as Record<string, unknown>).__nearbyInteractiveProp = nearbyProp.objectId;
            onPropApproachRef.current?.(nearbyProp.objectId, nearbyProp.name, nearbyProp.skillName, nearbyProp.skillConfig);
          } else if (!nearbyProp && prevPropId !== null) {
            // Check leave radius (wider than approach to avoid oscillation)
            const prevPos = propPositionsRef.current.get(prevPropId);
            if (prevPos) {
              const dx = pos.x - prevPos.x;
              const dz = pos.z - prevPos.z;
              if (dx * dx + dz * dz > PROP_LEAVE_RADIUS * PROP_LEAVE_RADIUS) {
                (window as unknown as Record<string, unknown>).__nearbyInteractiveProp = null;
                onPropLeaveRef.current?.();
              }
            } else {
              (window as unknown as Record<string, unknown>).__nearbyInteractiveProp = null;
              onPropLeaveRef.current?.();
            }
          }

          // NPC proximity — open chat overlay when player walks within range
          const npcList = extractNpcs(sceneObjectsRef.current ?? []);
          const nearbyNpc = findNearbyNpc(npcList, pos.x, pos.y, pos.z, npcPositionsRef.current);
          const prevNpcId = (window as unknown as Record<string, unknown>).__nearbyNpc as string | null ?? null;
          if (nearbyNpc && nearbyNpc.objectId !== prevNpcId) {
            (window as unknown as Record<string, unknown>).__nearbyNpc = nearbyNpc.objectId;
            onNpcApproachRef.current?.(nearbyNpc.objectId, nearbyNpc.name);
          } else if (!nearbyNpc && prevNpcId !== null) {
            (window as unknown as Record<string, unknown>).__nearbyNpc = null;
            onNpcLeaveRef.current?.(prevNpcId);
          }
        }
        physicsLoopFrame++;

        // Update NPC animation mixers
        for (const [, grp] of npcGroups) {
          const m = grp.userData.mixer as AnimationMixer | undefined;
          if (m) m.update(delta);
        }

        // Run script animate callbacks from code-gen sandbox.
        // Reuse delta from physics getDelta() call — calling clock.getDelta() again
        // would return near-zero (only the time to compute physics) and make all
        // script animations run in near-slow-motion.
        if (scriptAnimCallbacks.length > 0) {
          for (const cb of scriptAnimCallbacks) { try { cb(delta); } catch { /* ignore */ } }
        }

        tickPortals();
        tickScriptMeshes();
        if (selfieModeRef.current) {
          // Third-person selfie: reposition camera 2.5m behind player body, same look direction.
          // Do NOT call lookAt — PointerLockControls owns camera orientation and calling lookAt
          // every frame causes violent spinning each time the mouse moves.
          // fwd is already computed above (from camera world direction) and is valid here.
          const bodyPos = cc.body.translation();
          avatarGroup.position.set(bodyPos.x, bodyPos.y - 0.8, bodyPos.z);
          camera.position.set(
            bodyPos.x - fwd.x * 2.5,
            bodyPos.y + 1.5,
            bodyPos.z - fwd.z * 2.5,
          );
        }
        renderer.render(scene, camera);
      }

      let hasEnteredScene = false;
      const onLockChange = () => {
        const locked = document.pointerLockElement === cv;
        // Don't update isLocked while in edit mode — it would re-show the "click to enter" overlay
        if (!editModeRef.current) setIsLocked(locked);
        if (locked && !inPhysicsMode) {
          // Re-entering walk mode — close any open chat overlay
          onPlayerMoveRef.current?.();
          const wasAlreadyIn = hasEnteredScene;
          hasEnteredScene = true;
          stopFreeFly();
          let bodyX: number;
          let bodyY: number;
          let bodyZ: number;
          if (wasAlreadyIn && lastBodyY !== null) {
            // Re-entry: return to exact last position
            bodyX = lastBodyXZ.x;
            bodyY = lastBodyY;
            bodyZ = lastBodyXZ.z;
          } else {
            // First entry: scan from camera XZ outward to find floor geometry.
            // Scenes where the origin is outside the room's collision mesh (e.g.
            // living room) would otherwise cause the body to fall indefinitely.
            const spawn = findSpawnPosition(camera.position.x, camera.position.z);
            bodyX = spawn.x;
            bodyY = spawn.y;
            bodyZ = spawn.z;
          }
          cc.body.setNextKinematicTranslation({ x: bodyX, y: bodyY, z: bodyZ });
          lastBodyXZ.x = bodyX;
          lastBodyXZ.z = bodyZ;
          cc.verticalVel = 0;
          world.step(); // commit teleport before cc.move() reads body.translation()
          clock.getDelta(); // flush accumulated delta
          // Reset prop proximity tracking so the physics loop detects the TV fresh on first frame.
          (window as unknown as Record<string, unknown>).__nearbyInteractiveProp = null;
          onPropLeaveRef.current?.();
          inPhysicsMode = true;
          physicsLoop();
        } else if (!locked && inPhysicsMode) {
          // Transition: physics walking → free-fly (Escape key) or placement mode (F key)
          inPhysicsMode = false;
          cancelAnimationFrame(animId);
          // Clear any active script display panel (bookshelf, etc.) so it doesn't persist across re-entry
          window.dispatchEvent(new CustomEvent("world:display", { detail: { html: null } }));
          // Freeze script mesh placement — fires whether keydown or lockchange comes first.
          if (scriptMeshPlacementPendingRef.current) {
            scriptMeshPlacementPendingRef.current = false;
            onScriptMeshPlaceCancelRef.current?.();
          }
          if (!placementModeActiveRef.current) {
            syncEuler();
            restartFreeFly();
          }
        }
      };
      document.addEventListener("pointerlockchange", onLockChange);

      const onClick = (e: MouseEvent) => {
        if (document.pointerLockElement !== cv) {
          // While placement is pending, clicks are handled by onMouseDown (Rapier hit).
          // Don't request pointer lock — it would steal the placement click.
          if (npcPlacementPendingRef.current || propPlacementPendingRef.current || scriptMeshPlacementPendingRef.current) return;
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
              onNpcClickRef.current?.(hitMesh.userData.npcObjectId as string, hitMesh.userData.npcName as string);
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
        if (e.key === "Tab") {
          e.preventDefault();
          const entering = !editModeRef.current;
          editModeRef.current = entering;
          setEditMode(entering);
          if (entering && document.pointerLockElement === cv) {
            document.exitPointerLock(); // releases pointer lock, onLockChange restarts free-fly
          }
          if (!entering) {
            heightHovered = null;
            heightDrag = null;
            if (canvas) canvas.style.cursor = "";
          }
          return;
        }
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
          cleanupGhost();
          onNpcPlaceCancelRef.current?.();
          return;
        }
        // ESC key: cancel pending prop placement if active
        if (e.key === "Escape" && propPlacementPendingRef.current) {
          cleanupGhost();
          onPropPlaceCancelRef.current?.();
          return;
        }
        // ESC key: cancel pending portal placement if active
        if (e.key === "Escape" && portalPlacementPendingRef.current) {
          onPortalPlaceCancelRef.current?.();
          return;
        }
        // ESC during script mesh placement: freeze the mesh and show the confirm panel.
        if (e.key === "Escape" && scriptMeshPlacementPendingRef.current) {
          scriptMeshPlacementPendingRef.current = false;
          onScriptMeshPlaceCancelRef.current?.();
          return;
        }
        // ESC: close NPC chat if open
        if (e.key === "Escape") {
          onPlayerMoveRef.current?.();
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
                onNpcClickRef.current?.(hitMesh.userData.npcObjectId as string, hitMesh.userData.npcName as string);
                return;
              }
            }
            const propId = pickObject(camera, props.flatMap((p) => p.meshes), 4);
            if (propId) { onInteractRef.current?.(propId, "pick"); return; }
            // Fallback: if no mesh was hit but a skill prop is nearby, interact with it directly
            const nearbyPropId = (window as unknown as Record<string, unknown>).__nearbyInteractiveProp as string | null;
            if (nearbyPropId) { onInteractRef.current?.(nearbyPropId, "pick"); return; }
            // Last fallback: find the closest interactable prop in the scene (no distance limit)
            {
              const camPos = camera.position;
              let bestId: string | null = null;
              let bestDist2 = Infinity;
              for (const obj of (sceneObjectsRef.current ?? [])) {
                const skillMeta = obj.metadata?.skill;
                if (!skillMeta || obj.type === "npc") continue;
                const p = propPositionsRef.current.get(obj.objectId) ?? obj.position;
                const dx = camPos.x - p.x; const dz = camPos.z - p.z;
                const d2 = dx * dx + dz * dz;
                if (d2 < bestDist2) { bestDist2 = d2; bestId = obj.objectId; }
              }
              if (bestId) { onInteractRef.current?.(bestId, "pick"); return; }
            }
          }
        }
      };
      cv.addEventListener("click", onClick);
      cv.addEventListener("contextmenu", onContextMenu);
      window.addEventListener("keydown", onKeyAction);

      (window as unknown as Record<string, unknown>).__nearbyNpc = null;
      (window as unknown as Record<string, unknown>).__nearbyInteractiveProp = null;

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
        delete (window as unknown as Record<string, unknown>).__nearbyInteractiveProp;
        onPropLeaveRef.current?.();
        delete (window as unknown as Record<string, unknown>).__playerPosition;
        delete (window as unknown as Record<string, unknown>).__cameraForward;
        delete (window as unknown as Record<string, unknown>).__spawnProp;
        delete (window as unknown as Record<string, unknown>).__loadSceneProp;
        delete (window as unknown as Record<string, unknown>).__removeSceneProp;
        delete (window as unknown as Record<string, unknown>).__loadSceneNpc;
        delete (window as unknown as Record<string, unknown>).__removeSceneNpc;
        delete (window as unknown as Record<string, unknown>).__moveNpc;
        delete (window as unknown as Record<string, unknown>).__emoteNpc;
        delete (window as unknown as Record<string, unknown>).__loadScenePortal;
        delete (window as unknown as Record<string, unknown>).__removeScenePortal;
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
        for (const group of npcGroups.values()) {
          disposeContactShadow(group);
          scene.remove(group);
        }
        npcGroups.clear();
        npcPositions.clear();
        for (const entry of portalMap.values()) {
          disposePortal(entry);
        }
        portalMap.clear();
        try { world.free(); } catch { /* Rapier WASM may panic if a body JS ref is still live */ }
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
            // Reset ALL transforms before measurement (mirrors physics path)
            g.position.set(0, 0, 0);
            g.rotation.set(0, 0, 0);
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
            const npTargetHeight = typeof obj.metadata.targetHeight === "number" ? obj.metadata.targetHeight : undefined;
            if (npTargetHeight !== undefined && scale === 1) {
              g.updateMatrixWorld(true);
              const sbbox = new Box3().setFromObject(g);
              const mh = sbbox.max.y - sbbox.min.y;
              if (mh > 0.01) effectiveScaleNp = Math.min(npTargetHeight / mh, 10);
            }
            g.scale.setScalar(effectiveScaleNp);
            g.updateMatrixWorld(true);
            const npBbox = new Box3().setFromObject(g);
            const npGroundOffset = -npBbox.min.y;
            g.position.set(pos.x, pos.y + npGroundOffset, pos.z);
            g.traverse((c) => {
              c.userData.objectId = obj.objectId;
              if (c instanceof Mesh) {
                c.userData.npcObjectId = obj.objectId;
                c.userData.npcName = obj.name;
                npcMeshList.push(c);
              }
            });
            scene.add(g);
            g.userData.shadowPlane = createContactShadow(g, pos.y);
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
        if (group) {
          disposeContactShadow(group);
          scene.remove(group);
          noPhysicsNpcGroups.delete(objectId);
        }
        noPhysicsNpcPos.delete(objectId);
      };

      // Load portals in no-physics mode too.
      loadPortals();
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
      cleanupGhost();
      ro.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onWindowMouseMove);
      window.removeEventListener("mousedown", onWindowMouseDown);
      delete (window as unknown as Record<string, unknown>).__clickPosition;
      delete (window as unknown as Record<string, unknown>).__nearbyNpc;
      delete (window as unknown as Record<string, unknown>).__nearbyInteractiveProp;
      delete (window as unknown as Record<string, unknown>).__worldAPI;
      scene.remove(avatarGroup);
      avatarMat.dispose();
      // Clean up any objects spawned by code-gen scripts.
      for (const obj of scriptSpawnedObjects.values()) scene.remove(obj);
      scriptSpawnedObjects.clear();
      scriptAnimCallbacks.length = 0;
      onPropLeaveRef.current?.();
      delete (window as unknown as Record<string, unknown>).__loadSceneNpc;
      delete (window as unknown as Record<string, unknown>).__removeSceneNpc;
      delete (window as unknown as Record<string, unknown>).__loadScenePortal;
      delete (window as unknown as Record<string, unknown>).__removeScenePortal;
      npcPositionsRef.current.clear();
      for (const g of npcGroupsRef.current.values()) {
        disposeContactShadow(g);
        scene.remove(g);
      }
      npcGroupsRef.current.clear();
      for (const entry of portalMap.values()) {
        disposePortal(entry);
      }
      portalMap.clear();
      nearPortalIdRef.current = null;
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
        style={{ width: "100%", height: "100%", display: "block", cursor: (placementMode || npcPlacementPending || propPlacementPending || portalPlacementPending) ? "crosshair" : "default" }}
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
      {physicsReady && status === "ready" && !isLocked && !editMode && !npcPlacementPending && !propPlacementPending && !portalPlacementPending && (
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
            : "Click to enter · WASD to walk · F to place · P for props · Tab to edit"}
        </div>
      )}

      {/* Edit mode overlay */}
      {editMode && (
        <div style={{
          position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
          background: "rgba(10,10,30,0.85)", backdropFilter: "blur(6px)",
          border: "1px solid rgba(120,160,255,0.4)",
          borderRadius: 8, padding: "6px 16px",
          color: "rgba(200,220,255,0.95)",
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontSize: 13, letterSpacing: 0.3,
          pointerEvents: "none",
          whiteSpace: "nowrap",
        }}>
          编辑模式 · 拖动物件/NPC 调整高度 · Tab 退出
        </div>
      )}

      {/* NPC head-top speech bubbles — one per NPC, anchored to projected head position */}
      {speechFeed && speechFeed.map((entry) => {
        const pos = bubblePositions.get(entry.npcId);
        if (!pos) return null;
        return (
          <div
            key={entry.id}
            style={{
              position: "absolute",
              left: pos.x,
              top: pos.y,
              transform: "translate(-50%, -100%)",
              background: "rgba(10,10,30,0.90)",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(120,160,255,0.35)",
              borderRadius: 10,
              padding: "7px 12px",
              color: "rgba(200,220,255,0.95)",
              fontFamily: "system-ui, -apple-system, sans-serif",
              fontSize: 13,
              zIndex: 15,
              maxWidth: 220,
              textAlign: "center",
              lineHeight: 1.5,
              pointerEvents: "none",
              whiteSpace: "pre-wrap",
            }}
          >
            <div style={{ fontSize: 11, color: "rgba(160,180,255,0.75)", marginBottom: 4, fontWeight: 600 }}>
              {entry.npcName}
            </div>
            {entry.text}
            {/* Tail pointing down */}
            <div style={{
              position: "absolute", bottom: -7, left: "50%", transform: "translateX(-50%)",
              width: 0, height: 0,
              borderLeft: "7px solid transparent",
              borderRight: "7px solid transparent",
              borderTop: "7px solid rgba(10,10,30,0.90)",
            }} />
          </div>
        );
      })}

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
          <span>{ghostModelUrl ? "移动鼠标定位 · 点击放置 NPC" : "点击地面放置 NPC"}</span>
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
          <span>{ghostModelUrl ? "移动鼠标定位 · 点击放置物件" : "点击地面放置物件"}</span>
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
