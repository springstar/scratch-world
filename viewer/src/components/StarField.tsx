import { useEffect, useRef } from "react";

interface Star {
  x: number;
  y: number;
  r: number;
  opacity: number;
  twinkleSpeed: number;
  twinkleOffset: number;
}

export function StarField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Generate stars once
    const stars: Star[] = Array.from({ length: 220 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.4 + 0.3,
      opacity: Math.random() * 0.5 + 0.3,
      twinkleSpeed: Math.random() * 0.8 + 0.3,
      twinkleOffset: Math.random() * Math.PI * 2,
    }));

    let w = 0;
    let h = 0;

    function resize() {
      if (!canvas) return;
      w = canvas.width = canvas.offsetWidth * devicePixelRatio;
      h = canvas.height = canvas.offsetHeight * devicePixelRatio;
    }
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let t = 0;
    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);

      // Deep-space gradient
      const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
      grad.addColorStop(0, "#0a0a14");
      grad.addColorStop(1, "#000008");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      for (const s of stars) {
        const alpha = s.opacity + Math.sin(t * s.twinkleSpeed + s.twinkleOffset) * 0.15;
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * h, s.r * devicePixelRatio, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200,210,255,${alpha.toFixed(3)})`;
        ctx.fill();
      }

      t += 0.016;
      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}
