import {
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  TorusGeometry,
  type Scene,
} from "three";
import type { SceneObject } from "../types.js";

export interface PortalEntry {
  position: { x: number; y: number; z: number };
  targetSceneId: string | null;
  targetSceneName: string | null;
  group: Group;
}

interface PhysicsRef {
  world: {
    castRay(ray: unknown, maxToi: number, solid: boolean): { timeOfImpact: number } | null;
  } | null;
  RAPIER: {
    Ray: new (origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }) => unknown;
  } | null;
}

interface PortalManagerDeps {
  scene: Scene;
  physicsRef: PhysicsRef;
  getSplatGroundOffset: () => number | undefined;
  getSceneObjects: () => SceneObject[];
  nearPortalIdRef: { current: string | null };
  onPortalApproach: (portalId: string, targetSceneId: string | null, targetSceneName: string | null) => void;
  onPortalLeave: () => void;
}

export interface PortalManager {
  portalMap: Map<string, PortalEntry>;
  loadSinglePortal(obj: SceneObject): void;
  loadPortals(): void;
  removeSinglePortal(objectId: string): void;
  tickPortals(): void;
  checkPortalProximity(playerX: number, playerZ: number): void;
  dispose(): void;
}

const PORTAL_ENTER_DIST = 1.5;
const PORTAL_LEAVE_DIST = 2.0;

function createPortalMesh(pos: { x: number; y: number; z: number }, scene: Scene): Group {
  const g = new Group();
  const SIZE = 256;

  const ringMat = new MeshStandardMaterial({
    color: new Color(0x00ccff),
    emissive: new Color(0x00eeff),
    emissiveIntensity: 3.0,
    roughness: 0.15,
    metalness: 0.9,
  });
  const ring = new Mesh(new TorusGeometry(1.0, 0.12, 20, 80), ringMat);
  ring.renderOrder = 3;

  const innerRingMat = new MeshStandardMaterial({
    color: new Color(0x88ffff),
    emissive: new Color(0x44ffff),
    emissiveIntensity: 5.0,
    roughness: 0.0,
    metalness: 1.0,
  });
  const innerRing = new Mesh(new TorusGeometry(0.86, 0.045, 12, 60), innerRingMat);
  innerRing.renderOrder = 4;

  const hazeCv = document.createElement("canvas");
  hazeCv.width = SIZE; hazeCv.height = SIZE;
  const hCtx = hazeCv.getContext("2d")!;
  const cx = SIZE / 2;
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
  groundGlow.position.y = -(1.0 + 0.12);
  groundGlow.renderOrder = 0;

  g.add(ring, innerRing, groundGlow);
  g.userData.ring = ring;
  g.userData.innerRing = innerRing;

  g.position.set(pos.x, pos.y + 1.0 + 0.12, pos.z);
  scene.add(g);
  return g;
}

function disposePortalEntry(entry: PortalEntry, scene: Scene): void {
  const g = entry.group;
  scene.remove(g);
  g.traverse((child: Object3D) => {
    if (!(child instanceof Mesh)) return;
    child.geometry.dispose();
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const m of mats) m.dispose();
  });
}

export function createPortalManager(deps: PortalManagerDeps): PortalManager {
  const { scene, physicsRef, getSplatGroundOffset, getSceneObjects, nearPortalIdRef } = deps;
  const portalMap = new Map<string, PortalEntry>();

  function loadSinglePortal(obj: SceneObject): void {
    if (obj.type !== "portal") return;
    if (portalMap.has(obj.objectId)) return;
    const storedX = (obj.metadata.playerPosition as { x: number } | undefined)?.x ?? obj.position.x;
    const storedZ = (obj.metadata.playerPosition as { z: number } | undefined)?.z ?? obj.position.z;

    const splatGroundOffset = getSplatGroundOffset();
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
    const group = createPortalMesh(pos, scene);
    portalMap.set(obj.objectId, { position: pos, targetSceneId, targetSceneName, group });
  }

  function loadPortals(): void {
    for (const obj of getSceneObjects()) {
      loadSinglePortal(obj);
    }
  }

  function removeSinglePortal(objectId: string): void {
    const entry = portalMap.get(objectId);
    if (!entry) return;
    disposePortalEntry(entry, scene);
    portalMap.delete(objectId);
    if (nearPortalIdRef.current === objectId) {
      nearPortalIdRef.current = null;
      deps.onPortalLeave();
    }
  }

  function tickPortals(): void {
    const t = performance.now() * 0.001;
    for (const entry of portalMap.values()) {
      const g = entry.group;
      const hazeDisc = g.userData.hazeDisc as Mesh | undefined;
      if (hazeDisc) hazeDisc.rotation.z = t * 0.12;
      const ring = g.userData.ring as Mesh;
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.8);
      (ring.material as MeshStandardMaterial).emissiveIntensity = 2.5 + 1.5 * pulse;
      const innerRing = g.userData.innerRing as Mesh;
      const pulse2 = 0.5 + 0.5 * Math.sin(t * 2.6 + 1.0);
      (innerRing.material as MeshStandardMaterial).emissiveIntensity = 4.0 + 3.0 * pulse2;
    }
  }

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
      deps.onPortalApproach(nearId, nearEntry!.targetSceneId, nearEntry!.targetSceneName);
    } else if (!nearId && nearPortalIdRef.current) {
      const currentEntry = portalMap.get(nearPortalIdRef.current);
      if (currentEntry) {
        const dx = currentEntry.position.x - playerX;
        const dz = currentEntry.position.z - playerZ;
        if (Math.sqrt(dx * dx + dz * dz) > PORTAL_LEAVE_DIST) {
          nearPortalIdRef.current = null;
          deps.onPortalLeave();
        }
      } else {
        nearPortalIdRef.current = null;
        deps.onPortalLeave();
      }
    }
  }

  function dispose(): void {
    for (const entry of portalMap.values()) {
      disposePortalEntry(entry, scene);
    }
    portalMap.clear();
    nearPortalIdRef.current = null;
  }

  return { portalMap, loadSinglePortal, loadPortals, removeSinglePortal, tickPortals, checkPortalProximity, dispose };
}
