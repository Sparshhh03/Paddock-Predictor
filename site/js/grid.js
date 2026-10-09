// Intro background: a fine grid of square cells. Moving the pointer lights a fixed
// square block of cells around it (brightest at the centre), which then fades out.
// Grid lines are drawn in CSS; this canvas only paints the lit cells, so idle frames are cheap.

const CELL = 14;          // px, must match --cell in styles.css
const RADIUS = 3;         // lit block is (2 * RADIUS + 1)² cells: 7 x 7
const FADE = 2.4;         // how fast cells dim (per second)
const ACCENT = [255, 75, 58];   // --accent
const HOT = [255, 196, 170];    // warm white for the centre cell

export function createGrid(host, canvas, { reducedMotion = false } = {}) {
  const ctx = canvas.getContext('2d');
  const lit = new Map(); // cell index -> intensity 0..1
  let cols = 0, rows = 0, dpr = 1, last = null, visible = true, running = false, prev = 0, idle = 0;

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    cols = Math.ceil(r.width / CELL);
    rows = Math.ceil(r.height / CELL);
    lit.clear();
    start();
  }

  // light a square block around (cx, cy); Chebyshev distance keeps the shape square
  function bump(cx, cy) {
    for (let dy = -RADIUS; dy <= RADIUS; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= rows) continue;
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= cols) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const v = Math.pow(1 - d / (RADIUS + 1), 1.5);
        const k = y * cols + x;
        if (v > (lit.get(k) || 0)) lit.set(k, v);
      }
    }
  }

  function onMove(e) {
    const r = canvas.getBoundingClientRect();
    const cx = Math.floor((e.clientX - r.left) / CELL), cy = Math.floor((e.clientY - r.top) / CELL);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) { last = null; return; }
    // fill every cell between the last and current position so fast moves leave no gaps
    if (last) {
      const steps = Math.max(Math.abs(cx - last[0]), Math.abs(cy - last[1]));
      for (let i = 1; i < steps; i++) bump(Math.round(last[0] + (cx - last[0]) * i / steps), Math.round(last[1] + (cy - last[1]) * i / steps));
    }
    bump(cx, cy);
    last = [cx, cy];
    start();
  }

  function frame(t) {
    const dt = Math.min((t - prev) / 1000 || 0, 0.1);
    prev = t;
    if (!visible) { running = false; return; }

    // ambient: now and then a single cell glows faintly, so the grid feels alive without a pointer
    if (!reducedMotion) {
      idle += dt;
      while (idle > 0.08) {
        idle -= 0.08;
        const k = Math.floor(Math.random() * cols * rows);
        if (!lit.has(k)) lit.set(k, 0.12 + Math.random() * 0.16);
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const decay = Math.exp(-dt * FADE);
    for (const [k, v0] of lit) {
      const v = v0 * decay;
      if (v < 0.02) { lit.delete(k); continue; }
      lit.set(k, v);
      const x = (k % cols) * CELL, y = Math.floor(k / cols) * CELL;
      const h = v * v * v; // only the brightest cells shift toward white
      const c = ACCENT.map((a, i) => Math.round(a + (HOT[i] - a) * h));
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(v * 0.78).toFixed(3)})`;
      ctx.fillRect(x + 1, y + 1, CELL - 1, CELL - 1);
    }
    if (lit.size || !reducedMotion) requestAnimationFrame(frame);
    else running = false;
  }

  function start() {
    if (running || !visible) return;
    running = true;
    prev = performance.now();
    requestAnimationFrame(frame);
  }

  host.addEventListener('pointermove', onMove, { passive: true });
  host.addEventListener('pointerleave', () => { last = null; });
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; start(); }).observe(canvas);
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; start(); });
  resize();
}
