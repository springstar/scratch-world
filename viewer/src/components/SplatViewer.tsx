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
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

interface Props {
  splatUrl: string;
}

export function SplatViewer({ splatUrl }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setStatus("loading");

    // ── Classic WebGL renderer (SparkRenderer requires WebGLRenderer) ────────
    const renderer = new WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    const scene = new Scene();
    scene.background = new Color(0x0a0a14);
    scene.add(new AmbientLight(0xffffff, 0.6));

    const camera = new PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.01, 2000);
    camera.position.set(0, 0, 3);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;

    const clock = new Clock();
    const sparkRenderer = new SparkRenderer({ renderer, clock });
    scene.add(sparkRenderer);

    // ── Load splat ────────────────────────────────────────────────────────────
    const splat = new SplatMesh({ url: splatUrl });
    scene.add(splat);

    splat.initialized.then(() => {
      // Auto-fit camera to the loaded splat's bounding box
      const box = splat.getBoundingBox();
      const center = new Vector3();
      box.getCenter(center);
      const size = new Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      camera.position.copy(center).addScaledVector(new Vector3(0, 0.2, 1).normalize(), maxDim * 1.8);
      controls.target.copy(center);
      controls.update();
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

    // ── WASD keyboard navigation ──────────────────────────────────────────────
    const keys = new Set<string>();
    const fwd   = new Vector3();
    const right  = new Vector3();
    const wasdMove = new Vector3();
    const worldUp  = new Vector3(0, 1, 0);

    const onKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      keys.add(e.key.toLowerCase());
    };
    const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup",   onKeyUp);

    // ── Render loop ───────────────────────────────────────────────────────────
    let animId: number;

    function loop() {
      animId = requestAnimationFrame(loop);

      // Apply WASD movement
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

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup",   onKeyUp);
      controls.dispose();
      splat.dispose();
      renderer.dispose();
    };
  }, [splatUrl]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />

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
