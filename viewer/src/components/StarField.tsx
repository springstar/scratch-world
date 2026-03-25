import { useEffect, useRef } from "react";

interface Star {
  x: number;
  y: number;
  r: number;
  opacity: number;
  twinkleSpeed: number;
  twinkleOffset: number;
  colorIdx: number;
}

interface ShootingStar {
  x0: number;
  y0: number;
  vx: number;
  vy: number;
  age: number;
  maxAge: number;
}

// Cool blue, warm white, neutral blue-white
const STAR_COLORS: ((a: number) => string)[] = [
  (a) => `rgba(190,215,255,${a.toFixed(3)})`,
  (a) => `rgba(255,248,230,${a.toFixed(3)})`,
  (a) => `rgba(220,230,255,${a.toFixed(3)})`,
];

// Nebula blobs: cx/cy normalized, r = fraction of maxDim
const NEBULAE = [
  { cx: 0.22, cy: 0.28, r: 0.38, rgb: "90,50,200", a: 0.08 },
  { cx: 0.78, cy: 0.55, r: 0.30, rgb: "35,75,210", a: 0.07 },
  { cx: 0.55, cy: 0.12, r: 0.22, rgb: "50,160,190", a: 0.06 },
  { cx: 0.08, cy: 0.72, r: 0.24, rgb: "150,35,180", a: 0.05 },
];

export function StarField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const stars: Star[] = Array.from({ length: 280 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.5 + 0.2,
      opacity: Math.random() * 0.55 + 0.25,
      twinkleSpeed: Math.random() * 1.8 + 0.5,
      twinkleOffset: Math.random() * Math.PI * 2,
      colorIdx: Math.floor(Math.random() * 3),
    }));

    const shooters: ShootingStar[] = [];
    let nextShoot = 5 + Math.random() * 8;

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

      // Deep indigo background
      const bg = ctx.createRadialGradient(w * 0.38, h * 0.32, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.9);
      bg.addColorStop(0, "#0f0d2e");
      bg.addColorStop(0.4, "#08061c");
      bg.addColorStop(1, "#020110");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Nebula blobs
      for (const n of NEBULAE) {
        const r = n.r * Math.max(w, h);
        const g = ctx.createRadialGradient(n.cx * w, n.cy * h, 0, n.cx * w, n.cy * h, r);
        g.addColorStop(0, `rgba(${n.rgb},${n.a})`);
        g.addColorStop(0.5, `rgba(${n.rgb},${(n.a * 0.35).toFixed(3)})`);
        g.addColorStop(1, `rgba(${n.rgb},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }

      // Stars
      for (const s of stars) {
        const alpha = Math.max(0.04, s.opacity + Math.sin(t * s.twinkleSpeed + s.twinkleOffset) * 0.22);
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * h, s.r * devicePixelRatio, 0, Math.PI * 2);
        ctx.fillStyle = STAR_COLORS[s.colorIdx](alpha);
        ctx.fill();
      }

      // Spawn shooting stars
      if (t > nextShoot) {
        shooters.push({
          x0: Math.random() * 0.6,
          y0: Math.random() * 0.5,
          vx: 0.15 + Math.random() * 0.18,
          vy: 0.06 + Math.random() * 0.10,
          age: 0,
          maxAge: 0.7 + Math.random() * 0.9,
        });
        nextShoot = t + 5 + Math.random() * 9;
      }

      // Draw shooting stars
      for (let i = shooters.length - 1; i >= 0; i--) {
        const s = shooters[i];
        s.age += 0.016;
        if (s.age > s.maxAge) {
          shooters.splice(i, 1);
          continue;
        }

        const progress = s.age / s.maxAge;
        const headOpacity = progress < 0.25 ? progress / 0.25 : 1 - (progress - 0.25) / 0.75;
        const tailDelay = Math.min(0.18, s.age);

        const hx = (s.x0 + s.vx * s.age) * w;
        const hy = (s.y0 + s.vy * s.age) * h;
        const tx = (s.x0 + s.vx * (s.age - tailDelay)) * w;
        const ty = (s.y0 + s.vy * (s.age - tailDelay)) * h;

        const grad = ctx.createLinearGradient(tx, ty, hx, hy);
        grad.addColorStop(0, "rgba(200,220,255,0)");
        grad.addColorStop(0.6, `rgba(200,225,255,${(headOpacity * 0.35).toFixed(3)})`);
        grad.addColorStop(1, `rgba(245,252,255,${(headOpacity * 0.95).toFixed(3)})`);

        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(hx, hy);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.8 * devicePixelRatio;
        ctx.stroke();

        // Head glow
        const glowGrad = ctx.createRadialGradient(hx, hy, 0, hx, hy, 4 * devicePixelRatio);
        glowGrad.addColorStop(0, `rgba(245,252,255,${headOpacity.toFixed(3)})`);
        glowGrad.addColorStop(1, "rgba(200,220,255,0)");
        ctx.beginPath();
        ctx.arc(hx, hy, 4 * devicePixelRatio, 0, Math.PI * 2);
        ctx.fillStyle = glowGrad;
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
