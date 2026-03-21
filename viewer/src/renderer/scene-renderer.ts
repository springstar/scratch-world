import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Sky } from "three/addons/objects/Sky.js";
import { Water } from "three/addons/objects/Water.js";
import type { SceneData, SceneObject, Viewpoint } from "../types.js";

// Colour palette keyed by object type
const TYPE_COLORS: Record<string, number> = {
  building: 0x8b7355,
  terrain: 0x4a7c59,
  tree: 0x2d5a27,
  npc: 0xe8c97e,
  item: 0xd4af37,
  object: 0x9b9b9b,
};
const FALLBACK_COLOR = 0xaaaaaa;

function colorFor(type: string): number {
  return TYPE_COLORS[type] ?? FALLBACK_COLOR;
}

function makeMat(color: number, rough = 0.8, metal = 0.1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

function inferShape(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("blackboard") || n.includes("chalkboard")) return "blackboard";
  if (n.includes("desk") || n.includes("table")) return "desk";
  if (n.includes("chair") || n.includes("stool") || n.includes("seat")) return "chair";
  if (n.includes("window")) return "window";
  if (n.includes("door")) return "door";
  if (n.includes("wall")) return "wall";
  if (n.includes("court") || n.includes("hardwood")) return "court";
  if (n.includes("floor") || n.includes("ceiling")) return "floor";
  if (n.includes("shelf") || n.includes("bookcase")) return "shelf";
  if (n.includes("pillar") || n.includes("column")) return "pillar";
  if (n.includes("hoop") || n.includes("basket") || n.includes("rim")) return "hoop";
  return "box";
}

function buildObjectByShape(
  obj: SceneObject,
  x: number,
  y: number,
  z: number,
): THREE.Object3D {
  const shape = (obj.metadata.shape as string | undefined) ?? inferShape(obj.name);
  const state = obj.metadata.state as string | undefined;

  switch (shape) {
    case "blackboard":
    case "chalkboard": {
      const group = new THREE.Group();
      // Board surface
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(4, 2.5, 0.1),
        makeMat(0x1a3a2a, 0.9, 0),
      );
      board.position.y = 1.5;
      board.castShadow = true;
      board.receiveShadow = true;
      group.add(board);
      // Wooden frame
      const frameMat = makeMat(0x8b6040, 0.8, 0);
      for (const [fw, fh, fx2, fy2] of [
        [4.12, 0.08, 0, 2.76], [4.12, 0.08, 0, 0.24],
        [0.08, 2.5,  -2.02, 1.5], [0.08, 2.5, 2.02, 1.5],
      ] as [number, number, number, number][]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.06), frameMat);
        bar.position.set(fx2, fy2, 0.08);
        group.add(bar);
      }
      // Chalk tray
      const tray = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.06, 0.14), frameMat);
      tray.position.set(0, 0.3, 0.1);
      group.add(tray);

      // Text on board using CanvasTexture
      if (state !== "erased" && state !== "clean") {
        // Extract text from description or name
        const rawText: string = (obj.description ?? obj.name ?? "").trim();
        // Pull out CJK chars or short Latin words that look like board content
        const cjkMatch = rawText.match(/[\u4e00-\u9fff\u3040-\u30ff]{2,}/g);
        const quotedMatch = rawText.match(/[「"'《]([^」"'》]{1,20})[」"'》]/);
        const boardText = quotedMatch
          ? quotedMatch[1]
          : cjkMatch
          ? cjkMatch[0]
          : "";

        const canvas = document.createElement("canvas");
        canvas.width = 1024;
        canvas.height = 640;
        const ctx = canvas.getContext("2d")!;
        // Board background
        ctx.fillStyle = "#1a3a2a";
        ctx.fillRect(0, 0, 1024, 640);
        if (boardText) {
          // Main chalk text — large, centred
          ctx.fillStyle = "rgba(230,255,230,0.88)";
          ctx.font = `bold ${boardText.length <= 6 ? 140 : 100}px serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(boardText, 512, 280);
        }
        // Chalk scribble lines (decorative)
        ctx.strokeStyle = "rgba(200,240,200,0.22)";
        ctx.lineWidth = 2;
        for (let li = 0; li < 6; li++) {
          ctx.beginPath();
          ctx.moveTo(60, 420 + li * 28);
          ctx.lineTo(960, 420 + li * 28);
          ctx.stroke();
        }
        const tex = new THREE.CanvasTexture(canvas);
        const writing = new THREE.Mesh(
          new THREE.PlaneGeometry(3.8, 2.38),
          new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }),
        );
        writing.position.set(0, 1.5, 0.056);
        group.add(writing);
      }
      group.position.set(x, 0, z);
      return group;
    }

    case "desk":
    case "table": {
      const group = new THREE.Group();
      const top = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.06, 0.7),
        makeMat(0xc8a46e, 0.7, 0),
      );
      top.position.y = 0.76;
      top.castShadow = true;
      top.receiveShadow = true;
      group.add(top);
      for (const [lx, lz] of [[-0.55, -0.3], [0.55, -0.3], [-0.55, 0.3], [0.55, 0.3]] as [number, number][]) {
        const leg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.03, 0.03, 0.76, 6),
          makeMat(0xb08050, 0.8, 0),
        );
        leg.position.set(lx, 0.38, lz);
        group.add(leg);
      }
      group.position.set(x, 0, z);
      return group;
    }

    case "chair":
    case "stool": {
      const group = new THREE.Group();
      const seat = new THREE.Mesh(
        new THREE.BoxGeometry(0.45, 0.05, 0.45),
        makeMat(0xb08050, 0.8, 0),
      );
      seat.position.y = 0.45;
      group.add(seat);
      const back = new THREE.Mesh(
        new THREE.BoxGeometry(0.45, 0.5, 0.04),
        makeMat(0xb08050, 0.8, 0),
      );
      back.position.set(0, 0.73, -0.22);
      group.add(back);
      for (const [lx, lz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]] as [number, number][]) {
        const leg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025, 0.025, 0.45, 6),
          makeMat(0x8b6040, 0.9, 0),
        );
        leg.position.set(lx, 0.225, lz);
        group.add(leg);
      }
      group.position.set(x, 0, z);
      return group;
    }

    case "window": {
      const group = new THREE.Group();
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 2.0, 0.1),
        makeMat(0xd4c5a0, 0.8, 0),
      );
      frame.position.y = 1.4;
      group.add(frame);
      const glass = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 1.8, 0.04),
        new THREE.MeshStandardMaterial({ color: 0xadd8e6, roughness: 0.05, metalness: 0.1, opacity: 0.45, transparent: true, emissive: 0x88aacc, emissiveIntensity: 0.3 }),
      );
      glass.position.y = 1.4;
      group.add(glass);
      group.position.set(x, 0, z);
      return group;
    }

    case "door": {
      const group = new THREE.Group();
      const woodMat = makeMat(0x8b6040, 0.8, 0);
      const frameMat = makeMat(0x6a4828, 0.85, 0);
      // Door frame
      const frameTop = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 0.1), frameMat);
      frameTop.position.set(0, 2.15, 0);
      group.add(frameTop);
      for (const fx of [-0.5, 0.5]) {
        const frameSide = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.2, 0.1), frameMat);
        frameSide.position.set(fx, 1.1, 0);
        group.add(frameSide);
      }
      // Door panel with inset detail
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.88, 2.05, 0.07), woodMat);
      panel.position.set(0, 1.025, 0);
      group.add(panel);
      // Inset panels (upper and lower)
      for (const py of [0.55, 1.52]) {
        const inset = new THREE.Mesh(
          new THREE.BoxGeometry(0.68, 0.7, 0.03),
          makeMat(0x7a5535, 0.85, 0),
        );
        inset.position.set(0, py, 0.04);
        group.add(inset);
      }
      // Door knob
      const knob = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 8, 6),
        makeMat(0xc8a832, 0.3, 0.8),
      );
      knob.position.set(0.36, 1.05, 0.07);
      group.add(knob);
      group.position.set(x, 0, z);
      return group;
    }

    case "wall": {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(20, 3.2, 0.2),
        makeMat(0xe8e0d0, 0.95, 0),
      );
      mesh.position.set(x, y, z);
      if (Math.abs(x) > Math.abs(z)) {
        mesh.rotation.y = Math.PI / 2;
      }
      mesh.receiveShadow = true;
      return mesh;
    }

    case "floor":
    case "ceiling": {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(20, 0.15, 20),
        makeMat(shape === "ceiling" ? 0xf5f0e8 : 0xc8b89a, 1, 0),
      );
      mesh.position.set(x, shape === "ceiling" ? y + 3 : y + 0.075, z);
      mesh.receiveShadow = true;
      return mesh;
    }

    case "shelf":
    case "bookcase": {
      const group = new THREE.Group();
      const woodMat = makeMat(0xb8864e, 0.75, 0);
      // Back panel
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.0, 0.05), woodMat);
      back.position.set(0, 1.0, -0.15);
      group.add(back);
      // Side panels
      for (const sx of [-0.575, 0.575]) {
        const side = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.0, 0.35), woodMat);
        side.position.set(sx, 1.0, 0);
        group.add(side);
      }
      // Shelves (top, 3 mid, bottom)
      const shelfYs = [0.05, 0.55, 1.05, 1.55, 1.98];
      for (const sy of shelfYs) {
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.04, 0.32), woodMat);
        shelf.position.set(0, sy, 0);
        group.add(shelf);
      }
      // Books on each middle shelf
      const bookColors = [0xcc3333, 0x3366cc, 0x228844, 0xdd8822, 0x8833aa, 0x336688, 0xaa4422];
      let bci = 0;
      for (const sy of [0.59, 1.09, 1.59]) {
        let bx = -0.48;
        while (bx < 0.46) {
          const bw = 0.06 + ((bci * 7 + 3) % 5) * 0.01;
          const bh = 0.28 + ((bci * 3 + 1) % 4) * 0.04;
          const book = new THREE.Mesh(
            new THREE.BoxGeometry(bw, bh, 0.22),
            makeMat(bookColors[bci % bookColors.length], 0.9, 0),
          );
          book.position.set(bx + bw / 2, sy + bh / 2 + 0.04, 0);
          group.add(book);
          bx += bw + 0.005;
          bci++;
        }
      }
      group.position.set(x, 0, z);
      return group;
    }

    case "pillar":
    case "column": {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.25, 3, 8),
        makeMat(0xd4ccc0, 0.9, 0),
      );
      mesh.position.set(x, y + 1.5, z);
      return mesh;
    }

    case "hoop": {
      const group = new THREE.Group();
      // Support pole
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 3.5, 8),
        makeMat(0x888888, 0.6, 0.4),
      );
      pole.position.y = 1.75;
      group.add(pole);
      // Horizontal arm from pole to backboard
      const arm = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.06, 0.06),
        makeMat(0x888888, 0.6, 0.4),
      );
      arm.position.set(0.6, 3.2, 0);
      group.add(arm);
      // Backboard
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 1.08, 1.84),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.1, opacity: 0.7, transparent: true }),
      );
      board.position.set(1.2, 3.2, 0);
      group.add(board);
      // Orange border on backboard
      const border = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 1.1, 1.86),
        makeMat(0xff6600, 0.5, 0.2),
      );
      border.position.set(1.19, 3.2, 0);
      group.add(border);
      // Inner box on backboard
      const innerBox = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 0.45, 0.59),
        makeMat(0xff6600, 0.5, 0.2),
      );
      innerBox.position.set(1.18, 3.15, 0);
      group.add(innerBox);
      // Rim (torus lying horizontally)
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(0.225, 0.017, 8, 24),
        makeMat(0xff6600, 0.5, 0.3),
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.set(1.37, 3.05, 0);
      group.add(rim);
      // Net (simplified as thin cylinder)
      const net = new THREE.Mesh(
        new THREE.CylinderGeometry(0.225, 0.12, 0.45, 12, 1, true),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, opacity: 0.4, transparent: true, side: THREE.DoubleSide }),
      );
      net.position.set(1.37, 2.82, 0);
      group.add(net);
      // Mirror for right-side hoop (positive x)
      if (x > 0) group.rotation.y = Math.PI;
      group.position.set(x, 0, z);
      return group;
    }

    default: {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.8, 0.8),
        makeMat(colorFor("object")),
      );
      mesh.position.set(x, y + 0.4, z);
      mesh.castShadow = true;
      return mesh;
    }
  }
}

function applyUserData(obj: THREE.Object3D, objectId: string, interactable: boolean): void {
  obj.userData = { objectId, interactable };
  obj.traverse((child) => {
    child.userData = { objectId, interactable };
  });
}

function buildObject(obj: SceneObject): THREE.Object3D {
  const { objectId, type, position, interactable } = obj;
  const x = position.x;
  const y = position.y;
  const z = position.z;

  let root: THREE.Object3D;

  switch (type) {
    case "tree": {
      const group = new THREE.Group();
      // Trunk — slightly tapered
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.28, 2.2, 8),
        makeMat(0x5c3d1e, 0.9, 0),
      );
      trunk.position.y = 1.1;
      trunk.castShadow = true;
      group.add(trunk);
      // Multi-layer foliage — 3 overlapping spheroid clusters
      const leafMat = makeMat(colorFor("tree"), 0.95, 0);
      const layers: [number, number, number, number][] = [
        [0,    2.8, 0, 1.4],
        [0.3,  3.6, 0.2, 1.1],
        [-0.2, 4.3, -0.1, 0.85],
      ];
      for (const [lx, ly, lz, lr] of layers) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(lr, 8, 6), leafMat);
        leaf.scale.y = 0.78;
        leaf.position.set(lx, ly, lz);
        leaf.castShadow = true;
        group.add(leaf);
      }
      // Random scale/rotation for visual variety using position as seed
      const seed = Math.abs(x * 7 + z * 13) % 1;
      group.scale.setScalar(0.85 + seed * 0.45);
      group.rotation.y = seed * Math.PI * 2;
      group.position.set(x, y, z);
      root = group;
      break;
    }

    case "building": {
      const group = new THREE.Group();
      const wallMat = makeMat(colorFor("building"), 0.85, 0.05);
      const roofMat = makeMat(0x6b3a2a, 0.8, 0);
      const glassMat = new THREE.MeshStandardMaterial({
        color: 0x88bbdd, roughness: 0.05, metalness: 0.2,
        transparent: true, opacity: 0.6,
        emissive: 0x224466, emissiveIntensity: 0.15,
      });
      // Main body
      const body = new THREE.Mesh(new THREE.BoxGeometry(5, 4, 5), wallMat);
      body.position.y = 2;
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);
      // Roof
      const roof = new THREE.Mesh(new THREE.ConeGeometry(3.8, 1.8, 4), roofMat);
      roof.position.y = 4.9;
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      group.add(roof);
      // Windows — 2×2 grid on front and back faces
      const winPositions: [number, number, number][] = [
        [-1.2, 2.8, 2.51], [1.2, 2.8, 2.51],
        [-1.2, 1.2, 2.51], [1.2, 1.2, 2.51],
        [-1.2, 2.8, -2.51], [1.2, 2.8, -2.51],
        [-1.2, 1.2, -2.51], [1.2, 1.2, -2.51],
      ];
      for (const [wx, wy, wz] of winPositions) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.8), glassMat);
        win.position.set(wx, wy, wz);
        if (wz < 0) win.rotation.y = Math.PI;
        group.add(win);
      }
      // Door on front face
      const door = new THREE.Mesh(
        new THREE.PlaneGeometry(0.7, 1.6),
        makeMat(0x5a3318, 0.9, 0),
      );
      door.position.set(0, 0.8, 2.52);
      group.add(door);
      group.position.set(x, y, z);
      root = group;
      break;
    }

    case "npc": {
      const group = new THREE.Group();
      // Deterministic color from position to keep appearance stable across re-renders
      const seed = Math.abs(Math.round(x * 3 + z * 7)) % 12;
      const shirtColors = [0xcc3333, 0x3366cc, 0x228844, 0xdd8822, 0x8833aa, 0x336688,
                           0xee5544, 0x4488cc, 0x33aa66, 0xcc7722, 0x6644bb, 0x228899];
      const pantsColors = [0x222244, 0x334422, 0x443322, 0x111111, 0x444466, 0x224422,
                           0x221133, 0x223311, 0x332211, 0x000000, 0x443355, 0x112233];
      const skinTones  = [0xf5c5a0, 0xe8a87c, 0xc68642, 0x8d5524, 0xf0d0b0, 0xd4956a];
      const skinMat  = makeMat(skinTones[seed % skinTones.length], 0.9, 0);
      const shirtMat = makeMat(shirtColors[seed], 0.8, 0);
      const pantsMat = makeMat(pantsColors[seed % pantsColors.length], 0.85, 0);
      const hairMat  = makeMat([0x1a0a00, 0x3d1c02, 0xf5c518, 0x444444, 0xcc5500, 0x111111][seed % 6], 0.9, 0);

      // Legs
      for (const lx of [-0.1, 0.1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.55, 7), pantsMat);
        leg.position.set(lx, 0.275, 0);
        group.add(leg);
      }
      // Torso
      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.22), shirtMat);
      torso.position.set(0, 0.76, 0);
      group.add(torso);
      // Arms
      for (const ax of [-0.22, 0.22]) {
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.38, 6), shirtMat);
        arm.rotation.z = ax > 0 ? -0.25 : 0.25;
        arm.position.set(ax, 0.7, 0);
        group.add(arm);
      }
      // Neck
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.12, 7), skinMat);
      neck.position.set(0, 1.02, 0);
      group.add(neck);
      // Head
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 10, 8), skinMat);
      head.position.set(0, 1.23, 0);
      group.add(head);
      // Hair cap
      const hair = new THREE.Mesh(
        new THREE.SphereGeometry(0.162, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.52),
        hairMat,
      );
      hair.position.set(0, 1.31, 0);
      group.add(hair);

      group.position.set(x, y, z);
      group.castShadow = true;
      root = group;
      break;
    }

    case "item": {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.5, 1.2, 6),
        makeMat(colorFor("item"), 0.6, 0.3),
      );
      mesh.position.set(x, y + 0.6, z);
      mesh.castShadow = true;
      root = mesh;
      break;
    }

    case "terrain": {
      const shape = obj.metadata.shape as string | undefined;
      if (shape === "wall") {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(20, 3.2, 0.2),
          makeMat(0xe8e0d0, 0.95, 0),
        );
        mesh.position.set(x, y, z);
        if (Math.abs(x) > Math.abs(z)) {
          mesh.rotation.y = Math.PI / 2;
        }
        mesh.receiveShadow = true;
        root = mesh;
      } else if (shape === "ceiling") {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(20, 0.15, 20),
          makeMat(0xf5f0e8, 1, 0),
        );
        mesh.position.set(x, y + 3.075, z);
        root = mesh;
      } else if (shape === "court") {
        const group = new THREE.Group();
        // Hardwood floor — NBA standard 28m × 15m
        const floor = new THREE.Mesh(
          new THREE.BoxGeometry(28, 0.1, 15),
          makeMat(0xc8822a, 0.85, 0.05),
        );
        floor.position.y = 0.05;
        floor.receiveShadow = true;
        group.add(floor);
        const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
        // Center line
        const centerLine = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 15), lineMat);
        centerLine.position.y = 0.11;
        group.add(centerLine);
        // Center circle
        const centerCircle = new THREE.Mesh(
          new THREE.TorusGeometry(1.8, 0.05, 8, 48),
          lineMat,
        );
        centerCircle.rotation.x = Math.PI / 2;
        centerCircle.position.y = 0.11;
        group.add(centerCircle);
        // Key areas (paint) — one each end
        for (const side of [-1, 1]) {
          const paint = new THREE.Mesh(
            new THREE.BoxGeometry(5.8, 0.02, 4.9),
            makeMat(0xb06020, 0.9, 0),
          );
          paint.position.set(side * 11.1, 0.11, 0);
          group.add(paint);
          // Free-throw line
          const ftLine = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 4.9), lineMat);
          ftLine.position.set(side * 8.2, 0.115, 0);
          group.add(ftLine);
          // Baseline
          const baseline = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 15), lineMat);
          baseline.position.set(side * 14, 0.115, 0);
          group.add(baseline);
          // Three-point arc (semicircle)
          const arc = new THREE.Mesh(
            new THREE.TorusGeometry(7.24, 0.05, 8, 48, Math.PI),
            lineMat,
          );
          arc.rotation.x = Math.PI / 2;
          arc.rotation.z = side > 0 ? 0 : Math.PI;
          arc.position.set(side * 7.5, 0.115, 0);
          group.add(arc);
        }
        // Sidelines
        for (const side of [-1, 1]) {
          const sideline = new THREE.Mesh(new THREE.BoxGeometry(28, 0.02, 0.05), lineMat);
          sideline.position.set(0, 0.115, side * 7.5);
          group.add(sideline);
        }
        group.position.set(x, y, z);
        root = group;
      } else if (shape === "hill") {
        // Rounded hill — upper hemisphere dome.
        // position.y = top of hill (peak); objects on the hill sit at this y.
        const hw = (obj.metadata.width  as number | undefined) ?? 10; // half-width footprint radius
        const hh = (obj.metadata.height as number | undefined) ?? 4;  // peak height above base
        const geo = new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
        const mesh = new THREE.Mesh(geo, makeMat(0x4a6a3a, 0.95, 0));
        mesh.scale.set(hw, hh, hw);
        mesh.position.set(x, y - hh * 0.05, z); // slight sink so base blends into ground
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        root = mesh;
      } else if (shape === "cliff") {
        // Sheer rock face — tall, narrow slab.
        // position.y = top of cliff; base is buried underground.
        const cw = (obj.metadata.width  as number | undefined) ?? 12;
        const ch = (obj.metadata.height as number | undefined) ?? 8;
        const cd = (obj.metadata.depth  as number | undefined) ?? 3;
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(cw, ch, cd),
          makeMat(0x8a7a68, 0.95, 0.05),
        );
        // y places top at position.y — bury lower half underground for seamless join
        mesh.position.set(x, y - ch * 0.5 + 0.1, z);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        root = mesh;
      } else if (shape === "platform") {
        // Elevated flat slab (cliff-top, raised plaza, floating island tier).
        // position.y = top surface where objects sit.
        const pw = (obj.metadata.width  as number | undefined) ?? 10;
        const ph = (obj.metadata.height as number | undefined) ?? 2;  // slab thickness
        const pd = (obj.metadata.depth  as number | undefined) ?? 10;
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(pw, ph, pd),
          makeMat(0x9b8c7a, 0.95, 0),
        );
        mesh.position.set(x, y - ph * 0.5, z); // top surface at y
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        root = mesh;
      } else if (shape === "floor") {
        const fw = (obj.metadata.width as number | undefined) ?? 20;
        const fd = (obj.metadata.depth as number | undefined) ?? 20;
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(fw, 0.15, fd),
          makeMat(0xc8b89a, 1, 0),
        );
        mesh.position.set(x, y + 0.075, z);
        mesh.receiveShadow = true;
        root = mesh;
      } else {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(8, 0.5, 8),
          makeMat(colorFor("terrain"), 1, 0),
        );
        mesh.position.set(x, y + 0.25, z);
        mesh.receiveShadow = true;
        root = mesh;
      }
      break;
    }

    case "object": {
      root = buildObjectByShape(obj, x, y, z);
      break;
    }

    default: {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.8, 12, 8),
        makeMat(FALLBACK_COLOR),
      );
      mesh.position.set(x, y + 0.8, z);
      mesh.castShadow = true;
      root = mesh;
      break;
    }
  }

  applyUserData(root, objectId, interactable);

  // Random Y rotation for organic look (skip terrain, npcs, and indoor objects)
  if (type !== "terrain" && type !== "npc" && type !== "object") {
    root.rotation.y = Math.random() * Math.PI * 2;
  }
  // Scale jitter ±15% for trees only
  if (type === "tree") {
    const s = 0.85 + Math.random() * 0.3;
    root.scale.set(s, s, s);
  }

  return root;
}

// ── Environment presets ──────────────────────────────────────────────────────

interface EnvPreset {
  skyColor: number;       // fallback color for indoor / night
  groundColor: number;
  fogColor: number;
  sunColor: number;
  sunIntensity: number;
  sunPosition: [number, number, number];
  ambientIntensity: number;
  // Sky shader parameters (outdoor only)
  sky: {
    turbidity: number;      // atmospheric haze 1–20
    rayleigh: number;       // sky blueness
    mieCoefficient: number; // sun halo density
    mieDirectionalG: number;// sun halo sharpness
    elevation: number;      // sun elevation angle in degrees
    azimuth: number;        // sun azimuth angle in degrees
  } | null;                 // null = use flat skyColor (indoor / night)
}

function resolveEnvPreset(skybox?: string, timeOfDay?: string): EnvPreset {
  let skyColor: number;
  switch (skybox) {
    case "sunset":     skyColor = 0xff7043; break;
    case "night":      skyColor = 0x0a0a1a; break;
    case "overcast":   skyColor = 0x7b8b9e; break;
    default:           skyColor = 0x87ceeb; break; // clear_day / default
  }

  let sunColor: number;
  let sunIntensity: number;
  let sunPosition: [number, number, number];
  let ambientIntensity: number;
  let sky: EnvPreset["sky"];

  const tod = timeOfDay ?? skybox;
  switch (tod) {
    case "dawn":
    case "dusk":
    case "sunset":
      sunColor = 0xff8c42;
      sunIntensity = 0.8;
      sunPosition = [10, 5, 30];
      ambientIntensity = 0.35;
      sky = { turbidity: 10, rayleigh: 3, mieCoefficient: 0.005, mieDirectionalG: 0.7, elevation: 4, azimuth: 180 };
      break;
    case "night":
      sunColor = 0x2244aa;
      sunIntensity = 0.05;
      sunPosition = [0, 20, 0];
      ambientIntensity = 0.15;
      sky = null; // flat dark background for night
      break;
    case "noon":
      sunColor = 0xffffff;
      sunIntensity = 1.4;
      sunPosition = [5, 60, 10];
      ambientIntensity = 0.55;
      sky = { turbidity: 2, rayleigh: 0.5, mieCoefficient: 0.002, mieDirectionalG: 0.8, elevation: 70, azimuth: 180 };
      break;
    case "overcast":
      sunColor = 0xccccdd;
      sunIntensity = 0.6;
      sunPosition = [0, 40, 0];
      ambientIntensity = 0.6;
      sky = { turbidity: 20, rayleigh: 4, mieCoefficient: 0.02, mieDirectionalG: 0.5, elevation: 40, azimuth: 180 };
      break;
    default: // clear_day / dawn
      sunColor = 0xfff4e0;
      sunIntensity = 1.2;
      sunPosition = [30, 50, 20];
      ambientIntensity = 0.5;
      sky = { turbidity: 4, rayleigh: 1, mieCoefficient: 0.003, mieDirectionalG: 0.75, elevation: 35, azimuth: 180 };
      break;
  }

  return { skyColor, groundColor: 0x4a7c59, fogColor: skyColor, sunColor, sunIntensity, sunPosition, ambientIntensity, sky };
}

// ── PickResult ───────────────────────────────────────────────────────────────

export interface PickResult {
  objectId: string;
  name: string;
  interactable: boolean;
  interactionHint?: string;
}

// ── SceneRenderer ────────────────────────────────────────────────────────────

const TRANSITION_DURATION = 800; // ms

export class SceneRenderer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private ssaoPass: SSAOPass;
  private sky: Sky;
  private gltfLoader = new GLTFLoader();
  // InstancedMesh batches for trees (cleared on each loadScene)
  private treeInstances: THREE.InstancedMesh[] = [];
  // Group that owns everything added by sceneCode — cleared on every loadScene()
  private codeGroup = new THREE.Group();
  private objects = new Map<string, THREE.Object3D>(); // objectId → root
  private objectMeta = new Map<string, SceneObject>();
  private animFrame = 0;
  private raycaster = new THREE.Raycaster();
  private codeAnimCbs: Array<(delta: number) => void> = [];
  private lastFrameTime = 0;

  // Smooth transition state
  private transitionStart = 0;
  private transitionFrom = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  private transitionTo   = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  private transitioning  = false;

  // ── Demand rendering (R3F-style frameloop:"demand") ──────────────────────
  // framesDue > 0 → render this frame and decrement.
  // Always render when codeAnimCbs are active (animated scenes like Water).
  private framesDue = 0;

  // ── Adaptive DPR (R3F-style performance.regress) ──────────────────────────
  // Tracks rendering performance; lowers pixel-ratio on frame drops.
  private perfCurrent = 1;            // multiplier applied to devicePixelRatio
  private readonly perfMin    = 0.5;  // floor during regression
  private readonly perfMax    = 1;    // ceiling during recovery
  private readonly perfDebounce = 200; // ms before DPR is restored
  private perfRestoreTimer: ReturnType<typeof setTimeout> | null = null;
  // Rolling frame-time budget: if a frame exceeds this, regress.
  private readonly frameBudgetMs = 50; // ~20 fps threshold

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 40, 120);

    this.camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 500);
    this.camera.position.set(0, 8, 20);
    this.camera.lookAt(0, 0, 0);

    // antialias disabled: EffectComposer uses its own non-MSAA render targets;
    // combining antialias:true with composer causes MSAA framebuffer conflicts.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; // softer shadow edges (R3F default)
    this.renderer.shadowMap.autoUpdate = false; // update only when invalidated
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.6;

    // HDRI environment (R3F-inspired): PMREMGenerator from RoomEnvironment gives
    // physically correct IBL reflections on all MeshStandardMaterial objects.
    // One-time setup — no network requests needed.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    this.scene.environment = pmrem.fromScene(new RoomEnvironment()).texture;
    pmrem.dispose();

    // OrbitControls for free camera exploration
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 200;
    // Demand rendering: each controls change (including damping) queues a frame
    this.controls.addEventListener("change", () => this.invalidate(1));

    // Lights — will be overridden by loadScene() env settings
    this.hemi = new THREE.HemisphereLight(0x87ceeb, 0x4a7c59, 0.6);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff4e0, 1.2);
    this.sun.position.set(30, 50, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -40;
    this.sun.shadow.camera.right = 40;
    this.sun.shadow.camera.top = 40;
    this.sun.shadow.camera.bottom = -40;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 200;
    this.sun.shadow.bias = -0.001;
    this.scene.add(this.sun);

    this.setupGround();
    this.scene.add(this.codeGroup);

    // Atmospheric sky (Preetham model) — always in scene; toggled per preset
    this.sky = new Sky();
    this.sky.scale.setScalar(450000);
    this.sky.visible = false; // hidden until loadScene() activates it
    this.scene.add(this.sky);

    // Post-processing: EffectComposer + SSAO + bloom + output
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // SSAO (R3F-inspired): soft contact shadows from ambient occlusion.
    // Inserted before bloom so AO-darkened crevices don't get boosted by bloom.
    this.ssaoPass = new SSAOPass(this.scene, this.camera, canvas.clientWidth, canvas.clientHeight);
    this.ssaoPass.kernelRadius = 8;
    this.ssaoPass.minDistance = 0.002;
    this.ssaoPass.maxDistance = 0.08;
    this.composer.addPass(this.ssaoPass);
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(canvas.clientWidth, canvas.clientHeight),
      0.4,   // strength
      0.3,   // radius
      0.85,  // threshold
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.setupResizeObserver(canvas);
    this.startLoop();
  }

  async loadScene(data: SceneData): Promise<void> {
    // Remove JSON-built objects
    for (const obj of this.objects.values()) {
      this.scene.remove(obj);
    }
    this.objects.clear();
    this.objectMeta.clear();
    this.codeAnimCbs = [];

    // Dispose previous instanced tree batches
    for (const im of this.treeInstances) {
      this.scene.remove(im);
      im.geometry.dispose();
    }
    this.treeInstances = [];

    // Remove all objects added by previous sceneCode execution
    this.codeGroup.clear();

    // Apply environment settings first (needed for bloom boost logic)
    const env = data.environment ?? {};
    const preset = resolveEnvPreset(env.skybox, env.timeOfDay);

    (this.scene.fog as THREE.Fog).color.set(preset.fogColor);

    this.hemi.color.set(preset.skyColor);
    this.hemi.groundColor.set(preset.groundColor);
    this.hemi.intensity = preset.ambientIntensity;

    this.sun.color.set(preset.sunColor);
    this.sun.intensity = preset.sunIntensity;

    if (preset.sky !== null) {
      // Outdoor / atmospheric sky — activate Three.Sky shader
      this.sky.visible = true;
      this.scene.background = null;

      const skyUniforms = (this.sky.material as THREE.ShaderMaterial).uniforms;
      skyUniforms["turbidity"].value = preset.sky.turbidity;
      skyUniforms["rayleigh"].value = preset.sky.rayleigh;
      skyUniforms["mieCoefficient"].value = preset.sky.mieCoefficient;
      skyUniforms["mieDirectionalG"].value = preset.sky.mieDirectionalG;

      // Compute sun direction from elevation + azimuth angles
      const phi = THREE.MathUtils.degToRad(90 - preset.sky.elevation);
      const theta = THREE.MathUtils.degToRad(preset.sky.azimuth);
      const sunDir = new THREE.Vector3();
      sunDir.setFromSphericalCoords(1, phi, theta);
      skyUniforms["sunPosition"].value.copy(sunDir);

      // Position the directional light to match the sky sun
      this.sun.position.copy(sunDir.clone().multiplyScalar(100));
    } else {
      // Night / indoor — hide sky mesh, show flat background colour
      this.sky.visible = false;
      this.scene.background = new THREE.Color(preset.skyColor);
      this.sun.position.set(...preset.sunPosition);
    }

    // Apply bloom settings from environment.effects
    const bloomCfg = env.effects?.bloom;
    const baseStrength = bloomCfg?.strength ?? 0.4;
    const isNight = env.skybox === "night" || env.timeOfDay === "night";
    this.bloomPass.strength = isNight ? Math.max(baseStrength, 0.8) : baseStrength;
    this.bloomPass.radius = bloomCfg?.radius ?? 0.3;
    // Clamp threshold to minimum 0.9 — prevents scene-specified low thresholds
    // from blooming ordinary lit surfaces and washing out the image.
    this.bloomPass.threshold = Math.max(bloomCfg?.threshold ?? 0.9, 0.9);

    // Path C: execute sceneCode if present.
    // Mute renderer's built-in lights so sceneCode has full lighting control.
    if (data.sceneCode) {
      this.hemi.intensity = 0;
      this.sun.intensity = 0;
      this.executeCode(data.sceneCode);
      return;
    }

    // Path A + default: restore built-in lights (they were set above from preset)
    // (intensities already applied by preset above — nothing to restore here)
    const loadPromises: Promise<void>[] = [];

    // Separate trees for InstancedMesh batching (R3F-inspired)
    const treeObjects: SceneObject[] = [];

    for (const obj of data.objects) {
      const modelUrl = obj.metadata.modelUrl as string | undefined;

      // Collect trees without modelUrl for instanced batching
      if (obj.type === "tree" && !modelUrl) {
        treeObjects.push(obj);
        continue;
      }

      if (modelUrl) {
        // Path A: load GLTF model — show placeholder while loading
        const placeholder = buildObject(obj);
        this.scene.add(placeholder);
        this.objects.set(obj.objectId, placeholder);
        this.objectMeta.set(obj.objectId, obj);

        const promise = this.loadGltfModel(obj, modelUrl, placeholder);
        loadPromises.push(promise);
      } else {
        const node = buildObject(obj);
        this.scene.add(node);
        this.objects.set(obj.objectId, node);
        this.objectMeta.set(obj.objectId, obj);
      }
    }

    // Batch trees as InstancedMesh (R3F-inspired: reduces N×4 draw calls → 4)
    this.buildInstancedTrees(treeObjects);

    // Wait for all GLTF loads (errors are caught inside loadGltfModel)
    await Promise.all(loadPromises);

    // Scene is ready — queue two frames so the first render fires immediately
    this.invalidate(2);
  }

  private async loadGltfModel(obj: SceneObject, url: string, placeholder: THREE.Object3D): Promise<void> {
    try {
      const gltf = await this.gltfLoader.loadAsync(url);
      const model = gltf.scene;

      // Apply position from SceneObject
      model.position.set(obj.position.x, obj.position.y, obj.position.z);

      // Apply scale from metadata (default 1)
      const scale = (obj.metadata.scale as number | undefined) ?? 1;
      model.scale.setScalar(scale);

      // Apply vertical offset for ground alignment
      const yOffset = (obj.metadata.yOffset as number | undefined) ?? 0;
      model.position.y += yOffset;

      // Enable shadows on all meshes
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      applyUserData(model, obj.objectId, obj.interactable);

      // Replace placeholder with real model
      this.scene.remove(placeholder);
      this.scene.add(model);
      this.objects.set(obj.objectId, model);
    } catch (err) {
      console.warn(`[SceneRenderer] Failed to load GLTF from ${url}:`, err);
      // Keep placeholder — already in scene
    }
  }

  /**
   * Build InstancedMesh batches for all trees in the scene.
   * R3F-inspired: N trees → 4 draw calls (trunk + 3 foliage layers) instead of N×4.
   * Trees are generally not interactive so we store phantom Groups for the objects map.
   */
  private buildInstancedTrees(trees: SceneObject[]): void {
    if (trees.length === 0) return;

    const count = trees.length;
    const dummy = new THREE.Object3D();

    const trunkMat = makeMat(0x5c3d1e, 0.9, 0);
    const leafMat  = makeMat(colorFor("tree"), 0.95, 0);

    // One InstancedMesh per part: trunk + 3 foliage layers
    const trunkIM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.28, 2.2, 8), trunkMat, count);
    trunkIM.castShadow = true;

    const foliageConfigs: [number, number, number, number, number][] = [
      // lx, ly, lz, radius, scaleY
      [0,    2.8, 0,    1.4, 0.78],
      [0.3,  3.6, 0.2,  1.1, 0.78],
      [-0.2, 4.3, -0.1, 0.85, 0.78],
    ];
    const foliageIMs = foliageConfigs.map(([, , , r]) =>
      new THREE.InstancedMesh(new THREE.SphereGeometry(r, 8, 6), leafMat, count),
    );
    foliageIMs.forEach((im) => { im.castShadow = true; });

    trees.forEach((tree, i) => {
      const { x, y, z } = tree.position;
      const seed = Math.abs(x * 7 + z * 13) % 1;
      const s = 0.85 + seed * 0.45;
      const rotY = seed * Math.PI * 2;

      // Trunk: positioned at half-height above tree base
      dummy.position.set(x, y + 1.1 * s, z);
      dummy.rotation.set(0, rotY, 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      trunkIM.setMatrixAt(i, dummy.matrix);

      // Foliage layers (lx/lz offsets ignored for rotation simplicity — < 0.3 units)
      foliageConfigs.forEach(([lx, ly, lz, , sy], j) => {
        dummy.position.set(x + lx * s, y + ly * s, z + lz * s);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(s, s * sy, s);
        dummy.updateMatrix();
        foliageIMs[j].setMatrixAt(i, dummy.matrix);
      });

      // Phantom Group for objects map (supports pick/highlight even without real mesh)
      const phantom = new THREE.Group();
      phantom.position.set(x, y, z);
      applyUserData(phantom, tree.objectId, tree.interactable);
      this.objects.set(tree.objectId, phantom);
      this.objectMeta.set(tree.objectId, tree);
    });

    trunkIM.instanceMatrix.needsUpdate = true;
    foliageIMs.forEach((im) => { im.instanceMatrix.needsUpdate = true; });

    this.scene.add(trunkIM, ...foliageIMs);
    this.treeInstances = [trunkIM, ...foliageIMs];
  }

  executeCode(code: string): void {
    this.codeAnimCbs = [];

    // Proxy wraps codeGroup so that scene.add() / scene.remove() target the group,
    // but scene.background / scene.fog / scene.environment still reach the real Scene.
    const sceneProxy = new Proxy(this.codeGroup, {
      get: (target, prop) => {
        if (prop === "add" || prop === "remove" || prop === "children") {
          return typeof target[prop as keyof typeof target] === "function"
            ? (target[prop as keyof typeof target] as (...a: unknown[]) => unknown).bind(target)
            : target[prop as keyof typeof target];
        }
        const val = (this.scene as unknown as Record<string | symbol, unknown>)[prop as string | symbol];
        return typeof val === "function" ? val.bind(this.scene) : val;
      },
      set: (_target, prop, value) => {
        (this.scene as unknown as Record<string | symbol, unknown>)[prop as string | symbol] = value;
        return true;
      },
    });

    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function(
        "THREE", "scene", "camera", "renderer", "controls", "animate", "Water",
        code,
      );
      fn(
        THREE,
        sceneProxy,
        this.camera,
        this.renderer,
        this.controls,
        (cb: (delta: number) => void) => { this.codeAnimCbs.push(cb); },
        Water,
      );
    } catch (err) {
      console.error("[SceneRenderer] sceneCode execution error:", err);
    }
  }

  goToViewpoint(viewpoint: Viewpoint): void {
    this.transitionFrom.pos.copy(this.camera.position);
    this.transitionFrom.target.copy(this.controls.target);

    this.transitionTo.pos.set(viewpoint.position.x, viewpoint.position.y, viewpoint.position.z);
    this.transitionTo.target.set(viewpoint.lookAt.x, viewpoint.lookAt.y, viewpoint.lookAt.z);

    this.transitionStart = performance.now();
    this.transitioning = true;
    this.invalidate(Math.ceil(TRANSITION_DURATION / 16) + 4);
  }

  // Returns the first interactable object under the pointer, or null
  pick(ndcX: number, ndcY: number): PickResult | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const allMeshes: THREE.Object3D[] = [];
    for (const root of this.objects.values()) {
      root.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) allMeshes.push(child);
      });
    }
    const hits = this.raycaster.intersectObjects(allMeshes);
    if (!hits.length) return null;

    const objectId = hits[0].object.userData.objectId as string | undefined;
    if (!objectId) return null;

    const meta = this.objectMeta.get(objectId);
    if (!meta) return null;

    return {
      objectId,
      name: meta.name,
      interactable: meta.interactable,
      interactionHint: meta.interactionHint,
    };
  }

  highlightObject(objectId: string | null): void {
    for (const [id, root] of this.objects) {
      const emissive = id === objectId && objectId !== null ? 0x444400 : 0x000000;
      root.traverse((child) => {
        const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (mat?.emissive) mat.emissive.set(emissive);
      });
    }
    this.invalidate(2);
  }

  /** Queue N frames to render. Call whenever the scene visually changes. */
  invalidate(frames = 2): void {
    this.framesDue = Math.max(this.framesDue, frames);
  }

  dispose(): void {
    cancelAnimationFrame(this.animFrame);
    if (this.perfRestoreTimer !== null) clearTimeout(this.perfRestoreTimer);
    this.controls.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }

  // ── Private ──────────────────────────────────────────────────────────────

  /**
   * Adaptive DPR regression (R3F performance.regress pattern).
   * Halves the pixel ratio immediately; schedules restore after debounce.
   */
  private regress(): void {
    if (this.perfCurrent <= this.perfMin) return; // already at floor
    this.perfCurrent = this.perfMin;
    const el = this.renderer.domElement;
    this.renderer.setPixelRatio(window.devicePixelRatio * this.perfCurrent);
    this.renderer.setSize(el.clientWidth, el.clientHeight, false);
    this.ssaoPass.setSize(el.clientWidth, el.clientHeight);
    this.composer.setSize(el.clientWidth, el.clientHeight);
    if (this.perfRestoreTimer !== null) clearTimeout(this.perfRestoreTimer);
    this.perfRestoreTimer = setTimeout(() => {
      this.perfRestoreTimer = null;
      this.perfCurrent = this.perfMax;
      this.renderer.setPixelRatio(window.devicePixelRatio * this.perfCurrent);
      this.renderer.setSize(el.clientWidth, el.clientHeight, false);
      this.ssaoPass.setSize(el.clientWidth, el.clientHeight);
      this.composer.setSize(el.clientWidth, el.clientHeight);
      this.invalidate(2);
    }, this.perfDebounce);
  }

  private setupGround(): void {
    const geo = new THREE.PlaneGeometry(200, 200);
    const mat = new THREE.MeshStandardMaterial({ color: 0x5a7a3a, roughness: 1 });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02; // slightly below y=0 to avoid z-fighting with terrain objects
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  private setupResizeObserver(canvas: HTMLCanvasElement): void {
    const observer = new ResizeObserver(() => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setPixelRatio(window.devicePixelRatio * this.perfCurrent);
      this.renderer.setSize(w, h, false);
      this.ssaoPass.setSize(w, h);
      this.composer.setSize(w, h);
      this.invalidate(2);
    });
    observer.observe(canvas);
  }

  private startLoop(): void {
    const loop = (now: number) => {
      this.animFrame = requestAnimationFrame(loop);

      const delta = this.lastFrameTime > 0 ? (now - this.lastFrameTime) / 1000 : 0;
      this.lastFrameTime = now;

      // Always update controls (needed for damping to progress every RAF tick)
      this.controls.update();

      // Smooth camera transition
      if (this.transitioning) {
        const elapsed = performance.now() - this.transitionStart;
        const t = Math.min(elapsed / TRANSITION_DURATION, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        this.camera.position.lerpVectors(this.transitionFrom.pos, this.transitionTo.pos, eased);
        this.controls.target.lerpVectors(this.transitionFrom.target, this.transitionTo.target, eased);
        if (t >= 1) this.transitioning = false;
        this.invalidate(1);
      }

      // Per-frame callbacks from sceneCode (animated scenes: Water, particles…)
      const hasAnimCbs = this.codeAnimCbs.length > 0;
      for (let i = this.codeAnimCbs.length - 1; i >= 0; i--) {
        try {
          this.codeAnimCbs[i](delta);
        } catch (err) {
          console.warn("[SceneRenderer] codeAnimCb error:", err);
          this.codeAnimCbs.splice(i, 1);
        }
      }
      // Animated scenes always need the next frame
      if (hasAnimCbs) this.invalidate(1);

      // ── Demand render ─────────────────────────────────────────────────────
      // Only call composer.render() when work is queued.
      if (this.framesDue <= 0) return;
      this.framesDue--;

      // Adaptive DPR: measure JS frame time; regress on overrun
      const frameStart = performance.now();
      this.renderer.shadowMap.needsUpdate = true;
      this.composer.render();
      const frameMs = performance.now() - frameStart;
      if (frameMs > this.frameBudgetMs) this.regress();
    };
    loop(0);
  }
}
