// Procedural 2026-style F1 car with painted liveries.
// Units are metres. The car's nose points along +x, +y is up, +z is the car's right side.
//
// Bodywork is "lofted": a list of cross-sections along the car, blended into one smooth
// surface (the same way real cars are designed). Each lofted surface has UVs where
// u runs tail -> nose and v runs around the section (0 bottom, .25 right, .5 top, .75 left),
// so liveries are painted onto a flat canvas and wrap onto the car.
import * as THREE from 'three';

const TAU = Math.PI * 2;

// ---------- teams ----------
export const TEAM_COLORS = {
  mercedes: '#19C3AC', ferrari: '#E8002D', mclaren: '#FF8000', red_bull: '#2B3B8F', rb: '#6692FF',
  alpine: '#F282B4', williams: '#64C4FF', aston_martin: '#229971', haas: '#AEB3B7', audi: '#9E1B32',
  sauber: '#52E252', cadillac: '#5C5F66',
};
// Teams with a full, hand-painted livery. Everyone else gets a clean base-colour scheme for now.
export const FULL_LIVERY = new Set(['red_bull']);

// Optional: drop a real 3D model (.glb) into site/models/ and list it here to replace the
// procedural car for that team. See site/models/README.md.
export const MODEL_FILES = {
  // red_bull: { url: 'models/red_bull.glb', rotationY: 0, length: 5.4 },
};

// ---------- helpers ----------
const se = (t, n) => Math.sign(t) * Math.pow(Math.abs(t), 2 / n);

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { repeat } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

function shade(hex, amt) {
  const c = new THREE.Color(hex);
  const hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt)));
  return '#' + c.getHexString();
}

// Catmull-Rom blend of section parameters, t in [0, n-1]
function sample(secs, t) {
  const i = Math.min(Math.floor(t), secs.length - 2), f = t - i;
  const p0 = secs[Math.max(i - 1, 0)], p1 = secs[i], p2 = secs[i + 1], p3 = secs[Math.min(i + 2, secs.length - 1)];
  const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (-a + 3 * b - 3 * c + d) * f * f * f);
  const o = {};
  for (const k of ['x', 'w', 'h', 'y', 'n']) o[k] = cr(p0[k], p1[k], p2[k], p3[k]);
  return o;
}

// secs: [{x, w (half width), h (half height), y (centre height), n (squareness)}], tail first, evenly spaced in x
function loft(secs, { segs = 140, radial = 72, capFront = false } = {}) {
  const pos = [], uv = [], idx = [];
  const T = secs.length - 1;
  for (let i = 0; i <= segs; i++) {
    const s = sample(secs, (i / segs) * T);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      pos.push(s.x, s.y - Math.max(s.h, 0.002) * se(Math.cos(a), s.n), Math.max(s.w, 0.002) * se(Math.sin(a), s.n));
      uv.push(i / segs, j / radial);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const sideCount = idx.length;
  if (capFront) { // fan cap on the nose-most ring (used for sidepod inlets)
    const s = sample(secs, T), c = pos.length / 3;
    pos.push(s.x, s.y, 0); uv.push(1, 0.5);
    const ring = segs * (radial + 1);
    for (let j = 0; j < radial; j++) idx.push(c, ring + j, ring + j + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.addGroup(0, sideCount, 0);
  if (capFront) g.addGroup(sideCount, idx.length - sideCount, 1);
  g.computeVertexNormals();
  return g;
}

function mesh(geo, mat, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}

function strut(a, b, r, mat) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const m = mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}

// Paint something so it reads correctly on the car's right side (as drawn) and left side
// (canvas rotated 180°, since the left side is seen from the other direction).
function onSide(g, side, x, y, H, draw) {
  g.save();
  if (side === 'right') { g.translate(x, y); draw(1); }
  else { g.translate(x, H - y); g.rotate(Math.PI); draw(-1); }
  g.restore();
}

// ---------- livery primitives ----------
function camo(g, x, y, w, h, color, density, seed) {
  const r = rng(seed);
  g.fillStyle = color;
  const n = Math.floor(w * h * density / 400);
  for (let i = 0; i < n; i++) {
    // clustered "digital" squares
    const cx = x + r() * w, cy = y + r() * h, k = 2 + Math.floor(r() * 6);
    for (let j = 0; j < k; j++) {
      const s = 4 + Math.floor(r() * 3) * 4;
      g.globalAlpha = 0.25 + r() * 0.35;
      g.fillRect(Math.round((cx + (r() - 0.5) * 40) / 4) * 4, Math.round((cy + (r() - 0.5) * 24) / 4) * 4, s, s);
    }
  }
  g.globalAlpha = 1;
}

function outlinedText(g, text, x, y, size, { fill = '#E1202A', stroke = '#FFFFFF', font = '"Archivo Black"', weight = '', width = 0, italic = false, spacing = 0 } = {}) {
  g.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${font}, "Arial Black", Impact, sans-serif`.trim();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if ('letterSpacing' in g) g.letterSpacing = spacing + 'px';
  if (width) {
    const w = g.measureText(text).width;
    g.save(); g.translate(x, y); g.scale(width / w, 1); x = 0; y = 0;
    if (stroke) { g.lineJoin = 'round'; g.lineWidth = size * 0.16 * (w / width); g.strokeStyle = stroke; g.strokeText(text, x, y); }
    g.fillStyle = fill; g.fillText(text, x, y);
    g.restore();
  } else {
    if (stroke) { g.lineJoin = 'round'; g.lineWidth = size * 0.16; g.strokeStyle = stroke; g.strokeText(text, x, y); }
    g.fillStyle = fill; g.fillText(text, x, y);
  }
  if ('letterSpacing' in g) g.letterSpacing = '0px';
}

// Stylised charging bull, facing +x when dir = 1. (w, h) is its bounding box, centred on 0,0.
function bull(g, w, h, dir, fill = '#E1202A', stroke = '#FFFFFF') {
  g.save();
  g.scale(dir * w / 200, h / 80);
  g.beginPath();
  // body from tail (left) to lowered head (right)
  g.moveTo(-96, -6);
  g.bezierCurveTo(-100, -22, -88, -30, -70, -26); // tail tuft to rump
  g.bezierCurveTo(-46, -36, -6, -36, 22, -30);    // back
  g.bezierCurveTo(40, -42, 58, -40, 66, -28);     // hump / shoulder
  g.bezierCurveTo(76, -36, 88, -40, 98, -34);     // horn base
  g.lineTo(104, -44); g.lineTo(100, -30);         // horn
  g.bezierCurveTo(106, -20, 104, -6, 96, 2);      // forehead down
  g.bezierCurveTo(92, 10, 82, 12, 74, 6);         // muzzle
  g.lineTo(70, 24); g.lineTo(84, 38); g.lineTo(76, 40); g.lineTo(58, 26); // front leg reaching forward
  g.lineTo(48, 12);
  g.bezierCurveTo(30, 12, 10, 14, -10, 10);       // belly
  g.lineTo(-30, 30); g.lineTo(-58, 40); g.lineTo(-62, 34); g.lineTo(-42, 22); // rear leg pushing back
  g.lineTo(-52, 10);
  g.bezierCurveTo(-70, 8, -86, 4, -96, -6);
  g.closePath();
  g.lineJoin = 'round';
  g.lineWidth = 9; g.strokeStyle = stroke; g.stroke();
  g.fillStyle = fill; g.fill();
  // muscle highlight
  g.beginPath(); g.moveTo(-40, -14); g.bezierCurveTo(-10, -22, 20, -20, 46, -10);
  g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.55)'; g.stroke();
  g.restore();
}

function fordOval(g, x, y, w) {
  g.save(); g.translate(x, y);
  g.beginPath(); g.ellipse(0, 0, w / 2, w / 4.2, 0, 0, TAU);
  g.fillStyle = '#1C3F94'; g.fill(); g.lineWidth = w * 0.05; g.strokeStyle = '#FFFFFF'; g.stroke();
  g.font = `italic 700 ${w * 0.3}px Georgia, "Times New Roman", serif`;
  g.fillStyle = '#FFFFFF'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('Ford', 0, 1);
  g.font = `800 ${w * 0.15}px Sora, Arial, sans-serif`; g.fillText('RACING', 0, w * 0.42);
  g.restore();
}

function numberBadge(g, x, y, r, num, { bg = '#FFFFFF', ring = '#E1202A', ink = '#E1202A' } = {}) {
  g.save(); g.translate(x, y);
  g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fillStyle = bg; g.fill();
  g.lineWidth = r * 0.16; g.strokeStyle = ring; g.stroke();
  g.font = `900 ${r * 1.25}px "Archivo Black", Impact, sans-serif`;
  g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(num), 0, r * 0.06);
  g.restore();
}

// ---------- body livery (2048 x 1024, u = tail->nose over x in [-2.25, 2.65]) ----------
const BODY_X0 = -2.25, BODY_X1 = 2.65;
const bx = (x) => ((x - BODY_X0) / (BODY_X1 - BODY_X0)) * 2048;
// canvas rows: 0 bottom, 256 left side, 512 top, 768 right side, 1024 bottom

function paintBody(L, number) {
  const [c, g] = canvas(2048, 1024);
  const H = 1024;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, L.dark); grad.addColorStop(0.5, L.base); grad.addColorStop(1, L.dark);
  g.fillStyle = grad; g.fillRect(0, 0, 2048, H);

  if (L.kind === 'red_bull') {
    camo(g, 0, 0, 2048, H, '#0A1130', 0.55, 7);
    // yellow nose tip
    const ny = g.createLinearGradient(bx(2.12), 0, bx(2.3), 0);
    ny.addColorStop(0, 'rgba(255,199,44,0)'); ny.addColorStop(1, L.accent);
    g.fillStyle = ny; g.fillRect(bx(2.12), 180, bx(2.65) - bx(2.12), 664);
    // yellow airbox & engine-cover crown
    g.fillStyle = L.accent;
    g.beginPath();
    g.moveTo(bx(-0.95), 512); g.bezierCurveTo(bx(-0.7), 360, bx(-0.2), 330, bx(0.18), 380);
    g.lineTo(bx(0.18), 644); g.bezierCurveTo(bx(-0.2), 694, bx(-0.7), 664, bx(-0.95), 512);
    g.fill();
    // charging bulls on the engine cover, heads forward
    for (const side of ['right', 'left']) {
      onSide(g, side, bx(-0.72), 640, H, (dir) => bull(g, 470, 165, dir));
      onSide(g, side, bx(1.82), 690, H, (dir) => bull(g, 150, 58, dir));
      onSide(g, side, bx(0.98), 792, H, () => outlinedText(g, 'CARLYLE', 0, 0, 40, { fill: '#FFFFFF', stroke: null, font: 'Sora', weight: 800, spacing: 6 }));
      onSide(g, side, bx(0.42), 720, H, () => outlinedText(g, 'VISA', 0, 0, 44, { fill: '#FFFFFF', stroke: null, font: 'Sora', weight: 800, italic: true }));
      onSide(g, side, bx(-1.55), 735, H, () => fordOval(g, 0, 0, 130));
    }
    // cockpit opening
    g.fillStyle = '#05070D';
    g.beginPath(); g.ellipse(bx(0.47), 512, (bx(0.86) - bx(0.08)) / 2, 72, 0, 0, TAU); g.fill();
    // nose top: ORACLE + car number
    g.save(); g.translate(bx(1.28), 512); g.rotate(Math.PI / 2);
    outlinedText(g, 'ORACLE', 0, 0, 34, { fill: '#FFFFFF', stroke: null, font: 'Sora', weight: 800, spacing: 5 });
    g.restore();
    numberBadge(g, bx(1.72), 512, 30, number);
    // red pinstripe along the nose top edges
    g.fillStyle = L.red; g.fillRect(bx(1.95), 430, bx(2.15) - bx(1.95), 6); g.fillRect(bx(1.95), 588, bx(2.15) - bx(1.95), 6);
  } else {
    // clean scheme: accent stripe sweeping from the nose over the engine cover
    g.fillStyle = L.accent;
    g.globalAlpha = 0.9;
    g.beginPath(); g.moveTo(bx(2.65), 470); g.lineTo(bx(-1.6), 492); g.lineTo(bx(-1.6), 532); g.lineTo(bx(2.65), 554); g.fill();
    g.globalAlpha = 1;
    g.fillStyle = '#05070D';
    g.beginPath(); g.ellipse(bx(0.47), 512, (bx(0.86) - bx(0.08)) / 2, 72, 0, 0, TAU); g.fill();
    numberBadge(g, bx(1.72), 512, 30, number, { bg: '#FFFFFF', ring: L.dark, ink: L.dark });
  }
  // darker underside
  const under = g.createLinearGradient(0, 0, 0, 160);
  under.addColorStop(0, 'rgba(0,0,0,.65)'); under.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = under; g.fillRect(0, 0, 2048, 160);
  g.save(); g.translate(0, H); g.scale(1, -1); g.fillRect(0, 0, 2048, 160); g.restore();
  return tex(c);
}

// ---------- sidepod livery (1024 x 512, u over x in [-1.25, 0.8]) ----------
const SP_X0 = -1.25, SP_X1 = 0.8;
const sx = (x) => ((x - SP_X0) / (SP_X1 - SP_X0)) * 1024;
// rows: 0 bottom, 128 left side, 256 top, 384 right side, 512 bottom

function paintSidepod(L, teamName) {
  const [c, g] = canvas(1024, 512);
  const H = 512;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, L.dark); grad.addColorStop(0.5, L.base); grad.addColorStop(1, L.dark);
  g.fillStyle = grad; g.fillRect(0, 0, 1024, H);
  if (L.kind === 'red_bull') {
    camo(g, 0, 0, 1024, H, '#0A1130', 0.6, 21);
    for (const side of ['right', 'left']) {
      onSide(g, side, sx(-0.3), 396, H, () => outlinedText(g, 'ORACLE', 0, 0, 74, { fill: '#F4F4F6', stroke: null, font: 'Sora', weight: 700, width: 520, spacing: 10 }));
      onSide(g, side, sx(0.02), 308, H, () => outlinedText(g, 'Red Bull', 0, 0, 58, { fill: L.red, stroke: '#FFFFFF', width: 330 }));
      onSide(g, side, sx(0.6), 300, H, () => outlinedText(g, 'ROKT', 0, 0, 34, { fill: '#FFFFFF', stroke: null, font: 'Sora', weight: 800, spacing: 2 }));
    }
  } else {
    g.fillStyle = L.accent; g.fillRect(0, 300, 1024, 10); g.fillRect(0, 202, 1024, 10);
    for (const side of ['right', 'left']) {
      onSide(g, side, sx(-0.25), 392, H, () => outlinedText(g, teamName.toUpperCase(), 0, 0, 60, { fill: L.ink, stroke: null, font: 'Sora', weight: 800, width: Math.min(560, teamName.length * 52), spacing: 6 }));
    }
  }
  const under = g.createLinearGradient(0, 0, 0, 90);
  under.addColorStop(0, 'rgba(0,0,0,.7)'); under.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = under; g.fillRect(0, 0, 1024, 90);
  g.save(); g.translate(0, H); g.scale(1, -1); g.fillRect(0, 0, 1024, 90); g.restore();
  return tex(c);
}

// Wing / plate textures read correctly from in front of (or outside) the car.
function paintPanel(L, w, h, draw, { camoSeed = 3, base } = {}) {
  const [c, g] = canvas(w, h);
  g.fillStyle = base || L.base; g.fillRect(0, 0, w, h);
  if (L.kind === 'red_bull') camo(g, 0, 0, w, h, '#0A1130', 0.5, camoSeed);
  draw && draw(g, w, h);
  return tex(c);
}

function paintCarbon() {
  const [c, g] = canvas(64, 64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    g.fillStyle = (x + y) % 2 ? '#141518' : '#1C1D21';
    g.fillRect(x * 8, y * 8, 8, 8);
  }
  return tex(c, { repeat: [10, 10] });
}

function paintSidewall(band) {
  const [c, g] = canvas(512, 512);
  g.translate(256, 256);
  g.strokeStyle = band; g.lineWidth = 7;
  g.beginPath(); g.arc(0, 0, 238, 0, TAU); g.stroke();
  g.fillStyle = '#F2F2F2';
  g.font = '800 26px Sora, Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const arcText = (text, start, radius) => {
    const step = 0.075;
    [...text].forEach((ch, i) => {
      g.save(); g.rotate(start + i * step); g.translate(0, -radius); g.fillText(ch, 0, 0); g.restore();
    });
  };
  arcText('P ZERO', -0.2, 208); arcText('P ZERO', Math.PI - 0.2, 208);
  g.font = '700 18px Sora, Arial, sans-serif';
  arcText('PIRELLI', Math.PI / 2 - 0.22, 210); arcText('PIRELLI', -Math.PI / 2 - 0.22, 210);
  return tex(c);
}

function paintRim(accent) {
  const [c, g] = canvas(256, 256);
  g.translate(128, 128);
  g.fillStyle = '#16171A'; g.beginPath(); g.arc(0, 0, 128, 0, TAU); g.fill();
  g.strokeStyle = '#2A2C31'; g.lineWidth = 10;
  for (let i = 0; i < 10; i++) { g.save(); g.rotate((i / 10) * TAU); g.beginPath(); g.moveTo(0, 20); g.lineTo(0, 118); g.stroke(); g.restore(); }
  g.strokeStyle = accent; g.lineWidth = 5; g.beginPath(); g.arc(0, 0, 120, 0, TAU); g.stroke();
  g.fillStyle = accent; g.beginPath(); g.arc(0, 0, 18, 0, TAU); g.fill();
  return tex(c);
}

// ---------- livery definitions ----------
function liveryFor(team) {
  if (team === 'red_bull') {
    return { kind: 'red_bull', base: '#1E2A63', dark: '#0B1230', accent: '#FFC72C', red: '#E1202A', ink: '#FFFFFF', tyre: '#4FA3FF', trim: '#0F1530' };
  }
  const base = TEAM_COLORS[team] || '#8C8C8C';
  const light = new THREE.Color(base).getHSL({}).l > 0.6;
  return { kind: 'generic', base, dark: shade(base, -0.22), accent: light ? '#111318' : '#FFFFFF', red: '#E1202A', ink: light ? '#111318' : '#FFFFFF', tyre: '#F2C230', trim: shade(base, -0.3) };
}

// ---------- the car ----------
const BODY = [ // x, half-width, half-height, centre y, squareness
  [-2.25, .03, .03, .40, 2.4], [-1.90, .10, .12, .41, 2.6], [-1.55, .15, .18, .43, 2.6], [-1.20, .20, .24, .45, 2.6],
  [-0.85, .24, .30, .47, 2.7], [-0.50, .28, .35, .50, 2.8], [-0.15, .30, .38, .52, 2.8], [0.20, .31, .29, .42, 3.0],
  [0.55, .30, .27, .41, 3.0], [0.90, .26, .24, .40, 3.0], [1.25, .21, .19, .40, 2.9], [1.60, .16, .145, .39, 2.7],
  [1.95, .12, .11, .36, 2.5], [2.30, .085, .08, .32, 2.4], [2.65, .03, .03, .28, 2.4],
].map(([x, w, h, y, n]) => ({ x, w, h, y, n }));

const SIDEPOD = [
  [-1.25, .04, .05, .22, 3], [-1.00, .09, .09, .25, 3.2], [-0.74, .14, .13, .28, 3.4], [-0.49, .18, .16, .31, 3.6],
  [-0.23, .21, .18, .33, 3.8], [0.03, .22, .19, .35, 4], [0.29, .22, .195, .36, 4], [0.54, .21, .19, .37, 4], [0.80, .19, .17, .38, 4],
].map(([x, w, h, y, n]) => ({ x, w, h, y, n }));

export function buildCar(team = 'red_bull', { number = 1, teamName = '' } = {}) {
  const L = liveryFor(team);
  const car = new THREE.Group();
  car.name = `car-${team}`;

  const paint = (map, extra = {}) => new THREE.MeshPhysicalMaterial({
    map, roughness: L.kind === 'red_bull' ? 0.5 : 0.32, metalness: 0.15, clearcoat: L.kind === 'red_bull' ? 0.25 : 0.8,
    clearcoatRoughness: 0.3, side: THREE.DoubleSide, ...extra,
  });
  const carbonMap = paintCarbon();
  const carbon = new THREE.MeshStandardMaterial({ map: carbonMap, color: 0xffffff, roughness: 0.42, metalness: 0.35 });
  const black = new THREE.MeshStandardMaterial({ color: 0x07080B, roughness: 0.6, metalness: 0.2 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  const trimPaint = new THREE.MeshPhysicalMaterial({ color: L.trim, roughness: 0.45, metalness: 0.2, clearcoat: 0.3 });

  // body
  const bodyMat = paint(paintBody(L, number));
  car.add(mesh(loft(BODY), bodyMat));

  // sidepods
  const podMat = paint(paintSidepod(L, teamName || team));
  for (const z of [-0.47, 0.47]) {
    const pod = mesh(loft(SIDEPOD, { segs: 90, radial: 56, capFront: true }), [podMat, black]);
    pod.position.z = z;
    car.add(pod);
  }

  // airbox intake + roll hoop
  const intake = mesh(new THREE.CircleGeometry(0.11, 32), black, false);
  intake.scale.set(1, 1.25, 1); intake.rotation.y = Math.PI / 2; intake.position.set(0.16, 0.79, 0);
  car.add(intake);

  // floor (top-view outline, extruded)
  const fs = new THREE.Shape();
  const half = [[1.25, .28], [0.95, .55], [0.6, .66], [-0.9, .72], [-1.35, .62], [-1.75, .5], [-2.05, .36]];
  fs.moveTo(half[0][0], -half[0][1]);
  half.forEach(([x, z]) => fs.lineTo(x, -z));
  [...half].reverse().forEach(([x, z]) => fs.lineTo(x, z));
  const floorGeo = new THREE.ExtrudeGeometry(fs, { depth: 0.035, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 2 });
  floorGeo.rotateX(Math.PI / 2);
  const floor = mesh(floorGeo, carbon);
  floor.position.y = 0.105;
  car.add(floor);
  // diffuser
  const diff = mesh(new THREE.BoxGeometry(0.5, 0.03, 0.9), carbon); diff.position.set(-2.0, 0.16, 0); diff.rotation.z = -0.32; car.add(diff);

  // ---- front wing ----
  const wingSpan = 1.6;
  const fwTop = paintPanel(L, 1024, 256, (g, w, h) => {
    if (L.kind === 'red_bull') {
      outlinedText(g, 'Red Bull', w * 0.27, h * 0.52, 120, { fill: L.red, stroke: '#FFFFFF', width: 380 });
      outlinedText(g, 'Red Bull', w * 0.73, h * 0.52, 120, { fill: L.red, stroke: '#FFFFFF', width: 380 });
    } else {
      g.fillStyle = L.accent; g.fillRect(0, h * 0.7, w, h * 0.12);
    }
  }, { camoSeed: 11 });
  const fwFlap = paintPanel(L, 1024, 128, (g, w, h) => {
    if (L.kind === 'red_bull') {
      outlinedText(g, 'VISA', w * 0.2, h * 0.5, 70, { fill: '#FFFFFF', stroke: null, font: 'Sora', weight: 800, italic: true });
      outlinedText(g, 'VISA', w * 0.8, h * 0.5, 70, { fill: '#FFFFFF', stroke: null, font: 'Sora', weight: 800, italic: true });
    }
  }, { camoSeed: 13, base: L.kind === 'red_bull' ? '#141C45' : L.base });
  const wingBox = (chord, thick, span, topTex) => {
    const top = paint(topTex, { side: THREE.FrontSide });
    const m = mesh(new THREE.BoxGeometry(span, thick, chord), [carbon, carbon, top, carbon, carbon, carbon]);
    m.rotation.y = Math.PI / 2; // span along z, top texture reads from the front
    return m;
  };
  const fwPlain = paintPanel(L, 512, 64, null, { camoSeed: 31, base: L.kind === 'red_bull' ? '#141C45' : L.base });
  [[2.66, 0.115, 0.30, 0.02, -0.04, fwTop], [2.47, 0.165, 0.20, 0.016, -0.32, fwPlain], [2.33, 0.225, 0.15, 0.014, -0.55, fwFlap]]
    .forEach(([x, y, chord, thick, aoa, t]) => {
      const holder = new THREE.Group();
      const w = wingBox(chord, thick, wingSpan * (x > 2.6 ? 1 : 0.94), t);
      holder.add(w); holder.position.set(x, y, 0); holder.rotation.z = aoa;
      car.add(holder);
    });
  const fEndTex = paintPanel(L, 512, 256, (g, w, h) => {
    if (L.kind === 'red_bull') {
      g.font = '800 64px Sora, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#FFFFFF'; g.fillText('Mobil', w * 0.42, h * 0.5);
      g.fillStyle = L.red; g.beginPath(); g.arc(w * 0.375, h * 0.52, 13, 0, TAU); g.fill();
    }
  }, { camoSeed: 17 });
  const fEnd = paint(fEndTex, { side: THREE.FrontSide });
  for (const z of [-0.8, 0.8]) {
    const ep = mesh(new THREE.BoxGeometry(0.5, 0.17, 0.018), [carbon, carbon, carbon, carbon, fEnd, fEnd]);
    ep.position.set(2.5, 0.17, z); ep.rotation.z = -0.12; car.add(ep);
  }
  for (const z of [-0.09, 0.09]) { // nose pylons
    const p = mesh(new THREE.BoxGeometry(0.26, 0.17, 0.014), black); p.position.set(2.52, 0.2, z); car.add(p);
  }

  // ---- rear wing ----
  const rwTop = paintPanel(L, 1024, 256, (g, w, h) => {
    if (L.kind === 'red_bull') {
      g.save(); g.translate(w / 2, h / 2);
      outlinedText(g, 'Gate', 0, 6, 150, { fill: '#FFFFFF', stroke: null, font: 'Sora', weight: 800 });
      g.restore();
    } else { g.fillStyle = L.accent; g.fillRect(0, h * 0.2, w, h * 0.1); }
  }, { camoSeed: 19 });
  [[-2.32, 0.86, 0.36, 0.03, -0.12], [-2.43, 0.99, 0.22, 0.022, -0.5]].forEach(([x, y, chord, thick, aoa], i) => {
    const holder = new THREE.Group();
    holder.add(wingBox(chord, thick, 1.0, i ? rwTop : fwTop.clone()));
    holder.position.set(x, y, 0); holder.rotation.z = aoa; car.add(holder);
  });
  const rEndTex = paintPanel(L, 512, 512, (g, w, h) => {
    if (L.kind === 'red_bull') {
      g.font = '800 92px Sora, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#FFFFFF'; g.fillText('Mobil', w * 0.4, h * 0.42);
      g.fillStyle = L.red; g.beginPath(); g.arc(w * 0.335, h * 0.445, 20, 0, TAU); g.fill();
      g.strokeStyle = '#FFFFFF'; g.lineWidth = 8; g.strokeRect(w * 0.73, h * 0.33, 76, 90);
      g.fillStyle = '#FFFFFF'; g.font = '800 70px Sora, Arial, sans-serif'; g.fillText('1', w * 0.73 + 38, h * 0.33 + 48);
      g.font = 'italic 700 34px Georgia, serif'; g.fillText('Heineken', w * 0.5, h * 0.72);
    }
  }, { camoSeed: 23 });
  const rEnd = paint(rEndTex, { side: THREE.FrontSide });
  for (const z of [-0.52, 0.52]) {
    const ep = mesh(new THREE.BoxGeometry(0.66, 0.54, 0.02), [carbon, carbon, carbon, carbon, rEnd, rEnd]);
    ep.position.set(-2.36, 0.8, z); car.add(ep);
  }
  const beam = mesh(new THREE.BoxGeometry(0.22, 0.03, 0.9), carbon); beam.position.set(-2.25, 0.48, 0); beam.rotation.z = -0.25; car.add(beam);
  const swan = mesh(new THREE.BoxGeometry(0.1, 0.5, 0.05), carbon); swan.position.set(-2.18, 0.68, 0); swan.rotation.z = 0.35; car.add(swan);

  // shark fin with race number
  const finTex = paintPanel(L, 512, 160, (g, w, h) => {
    g.fillStyle = '#FFFFFF'; g.fillRect(w * 0.62, h * 0.18, 120, 110);
    g.strokeStyle = L.red; g.lineWidth = 8; g.strokeRect(w * 0.62, h * 0.18, 120, 110);
    g.font = '900 90px "Archivo Black", Impact, sans-serif'; g.fillStyle = L.kind === 'red_bull' ? L.red : L.dark;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(number), w * 0.62 + 60, h * 0.18 + 60);
  }, { camoSeed: 29 });
  const finMat = paint(finTex, { side: THREE.FrontSide });
  const fin = mesh(new THREE.BoxGeometry(1.0, 0.24, 0.014), [trimPaint, trimPaint, trimPaint, trimPaint, finMat, finMat]);
  fin.position.set(-1.05, 0.8, 0); fin.rotation.z = -0.1; car.add(fin);

  // ---- cockpit: helmet, halo, mirrors ----
  const helmetMat = new THREE.MeshPhysicalMaterial({ color: L.kind === 'red_bull' ? 0x1E2A63 : L.base, roughness: 0.25, clearcoat: 1 });
  const helmet = mesh(new THREE.SphereGeometry(0.135, 32, 24), helmetMat);
  helmet.position.set(0.36, 0.73, 0); car.add(helmet);
  const visor = mesh(new THREE.SphereGeometry(0.138, 32, 16, -0.95, 1.9, 1.2, 0.45), new THREE.MeshPhysicalMaterial({ color: 0x0A0C12, roughness: 0.05, metalness: 0.6, clearcoat: 1 }));
  visor.position.copy(helmet.position); visor.rotation.y = Math.PI / 2; car.add(visor);
  const haloRing = new THREE.Group();
  const torus = mesh(new THREE.TorusGeometry(0.4, 0.032, 12, 48, Math.PI), black);
  torus.rotation.x = -Math.PI / 2;
  haloRing.add(torus); haloRing.rotation.set(0, -Math.PI / 2, 0.08); haloRing.position.set(0.47, 0.84, 0);
  car.add(haloRing);
  car.add(strut([0.88, 0.62, 0], [0.86, 0.86, 0], 0.03, black));
  for (const z of [-0.4, 0.4]) {
    car.add(strut([0.64, 0.68, z * 0.62], [0.64, 0.76, z], 0.012, black));
    const mirror = mesh(new THREE.BoxGeometry(0.06, 0.06, 0.13), trimPaint); mirror.position.set(0.64, 0.78, z); car.add(mirror);
  }

  // ---- wheels & suspension ----
  const sidewall = paintSidewall(L.tyre);
  const rimMap = paintRim(L.kind === 'red_bull' ? '#3E7BFF' : L.accent);
  car.userData.wheels = [];
  const wheel = (x, z, width) => {
    const R = 0.36, rIn = 0.24, c = 0.06, tw = width / 2;
    const prof = [new THREE.Vector2(rIn, -tw)];
    for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2); prof.push(new THREE.Vector2(R - c + Math.cos(a) * c, -tw + c + Math.sin(a) * c)); }
    for (let i = 0; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); prof.push(new THREE.Vector2(R - c + Math.cos(a) * c, tw - c + Math.sin(a) * c)); }
    prof.push(new THREE.Vector2(rIn, tw));
    const w = new THREE.Group();
    const tyre = mesh(new THREE.LatheGeometry(prof, 72), rubber); tyre.rotation.x = Math.PI / 2; w.add(tyre);
    const out = Math.sign(z);
    const wall = mesh(new THREE.RingGeometry(rIn + 0.005, R - 0.012, 72), new THREE.MeshStandardMaterial({ map: sidewall, transparent: true, roughness: 0.8 }), false);
    wall.position.z = out * (tw + 0.002); if (out < 0) wall.rotation.y = Math.PI; w.add(wall);
    const rim = mesh(new THREE.CircleGeometry(rIn, 48), new THREE.MeshStandardMaterial({ map: rimMap, roughness: 0.35, metalness: 0.7 }), false);
    rim.position.z = out * (tw - 0.03); if (out < 0) rim.rotation.y = Math.PI; w.add(rim);
    const barrel = mesh(new THREE.CylinderGeometry(rIn, rIn, width - 0.04, 32, 1, true), black); barrel.rotation.x = Math.PI / 2; w.add(barrel);
    w.position.set(x, R, z);
    car.add(w); car.userData.wheels.push(w);
  };
  wheel(1.7, 0.8, 0.30); wheel(1.7, -0.8, 0.30);
  wheel(-1.7, 0.77, 0.37); wheel(-1.7, -0.77, 0.37);
  for (const s of [-1, 1]) {
    // front wishbones + pushrod
    car.add(strut([1.55, 0.44, s * 0.16], [1.7, 0.45, s * 0.66], 0.016, carbon));
    car.add(strut([1.9, 0.42, s * 0.14], [1.7, 0.45, s * 0.66], 0.016, carbon));
    car.add(strut([1.5, 0.27, s * 0.18], [1.7, 0.26, s * 0.66], 0.016, carbon));
    car.add(strut([1.95, 0.27, s * 0.14], [1.7, 0.26, s * 0.66], 0.016, carbon));
    car.add(strut([1.62, 0.55, s * 0.12], [1.72, 0.27, s * 0.6], 0.014, carbon));
    // rear
    car.add(strut([-1.45, 0.45, s * 0.2], [-1.7, 0.46, s * 0.62], 0.016, carbon));
    car.add(strut([-1.95, 0.45, s * 0.14], [-1.7, 0.46, s * 0.62], 0.016, carbon));
    car.add(strut([-1.5, 0.25, s * 0.25], [-1.7, 0.24, s * 0.62], 0.016, carbon));
    car.add(strut([-1.95, 0.27, s * 0.16], [-1.7, 0.24, s * 0.62], 0.016, carbon));
  }
  return car;
}

// Replace the procedural car with a real model when one is configured (see MODEL_FILES).
export async function loadModelCar(team) {
  const cfg = MODEL_FILES[team];
  if (!cfg) return null;
  try {
    const head = await fetch(cfg.url, { method: 'HEAD' });
    if (!head.ok) return null;
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(cfg.url);
    const model = gltf.scene;
    model.rotation.y = cfg.rotationY || 0;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = (cfg.length || 5.4) / Math.max(size.x, size.z);
    model.scale.setScalar(scale);
    box.setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
    model.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    const g = new THREE.Group(); g.add(model); g.userData.wheels = [];
    return g;
  } catch (e) {
    console.warn('Could not load model for', team, e);
    return null;
  }
}

export async function carFor(team, opts) {
  return (await loadModelCar(team)) || buildCar(team, opts);
}

export function fontsReady() {
  const faces = ['400 40px "Archivo Black"', '800 40px Sora', '700 40px Sora'];
  const loaded = Promise.all(faces.map(f => document.fonts.load(f).catch(() => null)));
  // Never block the 3D scene on fonts: fall back to system fonts after 2.5 s.
  return Promise.race([loaded, new Promise(r => setTimeout(r, 2500))]);
}
