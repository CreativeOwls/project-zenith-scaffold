import { useEffect, useRef } from "react";

type Dot = { x: number; y: number; vx: number; vy: number; r: number };

const DOT_DENSITY = 0.00009; // dots per px^2
const LINK_DIST = 130;
const CURSOR_RADIUS = 220;

/**
 * Animated constellation canvas: drifting dots linked by faint lines,
 * with a gentle mouse parallax and cursor-proximity brightening.
 * Honours prefers-reduced-motion by freezing the drift.
 */
export function ConstellationBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let dots: Dot[] = [];
    let raf = 0;

    // pointer state (in css pixels), plus smoothed parallax offset
    const pointer = { x: -9999, y: -9999, active: false };
    const parallax = { x: 0, y: 0, tx: 0, ty: 0 };

    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.round(
        Math.min(180, Math.max(40, width * height * DOT_DENSITY)),
      );
      dots = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        r: 0.8 + Math.random() * 1.6,
      }));
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      pointer.active = true;
      parallax.tx = (pointer.x / Math.max(1, width) - 0.5) * 28;
      parallax.ty = (pointer.y / Math.max(1, height) - 0.5) * 28;
    };

    const onPointerLeave = () => {
      pointer.active = false;
      pointer.x = -9999;
      pointer.y = -9999;
      parallax.tx = 0;
      parallax.ty = 0;
    };

    const draw = () => {
      parallax.x += (parallax.tx - parallax.x) * 0.05;
      parallax.y += (parallax.ty - parallax.y) * 0.05;

      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(parallax.x, parallax.y);

      if (!reduceMotion) {
        for (const d of dots) {
          d.x += d.vx;
          d.y += d.vy;
          if (d.x < -20) d.x = width + 20;
          if (d.x > width + 20) d.x = -20;
          if (d.y < -20) d.y = height + 20;
          if (d.y > height + 20) d.y = -20;
        }
      }

      // links
      for (let i = 0; i < dots.length; i++) {
        const a = dots[i];
        for (let j = i + 1; j < dots.length; j++) {
          const b = dots[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist > LINK_DIST) continue;

          const falloff = 1 - dist / LINK_DIST;
          let alpha = falloff * 0.16;

          if (pointer.active) {
            const mx = (a.x + b.x) / 2 - pointer.x + parallax.x;
            const my = (a.y + b.y) / 2 - pointer.y + parallax.y;
            const near = 1 - Math.min(1, Math.hypot(mx, my) / CURSOR_RADIUS);
            alpha += near * falloff * 0.3;
          }

          ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      // dots
      for (const d of dots) {
        let alpha = 0.34;
        if (pointer.active) {
          const near =
            1 -
            Math.min(
              1,
              Math.hypot(
                d.x - pointer.x + parallax.x,
                d.y - pointer.y + parallax.y,
              ) / CURSOR_RADIUS,
            );
          alpha += near * 0.45;
        }
        ctx.fillStyle = `rgba(255,255,255,${Math.min(1, alpha).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
      raf = window.requestAnimationFrame(draw);
    };

    build();
    draw();

    const onResize = () => build();
    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerleave", onPointerLeave);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}

export default ConstellationBackdrop;
