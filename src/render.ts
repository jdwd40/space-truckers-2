import Phaser from 'phaser';
import { Network, Seg, LW, Sign, SignPanel, Station } from './network';
import { Pt, rand, clamp as clampV } from './geom';

export interface Cullable { obj: Phaser.GameObjects.GameObject & { setVisible(v: boolean): unknown }; x0: number; y0: number; x1: number; y1: number }

const ASPH = 0x3a4153, RIM = 0xa9b3c8, SHOULDER = 0x30364a, NEON = 0x5ad8ff;
export const DEPTH = { road: (l: number) => 5 + l * 3, veh: (l: number) => 6 + l * 3, sign: 7.6, station: 17, fxTop: 18 };

// ---------------------------------------------------------------- textures
const MITE_COLORS = [0xe8473f, 0x2ec4b6, 0xffc93c, 0x9b5de5, 0xf15bb5, 0x4ea8ff];
const CAB_COLORS = [0xf4f1ea, 0x3d7dd8, 0xe85d3a, 0x2f9e6e, 0xf2b134, 0x8e8ff0];
export const TRAILER_STYLES = 5;

function gfx(scene: Phaser.Scene) { return scene.make.graphics({ x: 0, y: 0 }, false); }

export function makeTextures(scene: Phaser.Scene) {
  const S = 2;
  // mites
  MITE_COLORS.forEach((c, i) => {
    const g = gfx(scene); const L = 24 * S, W = 13 * S;
    g.fillStyle(0x000000, 0.0); g.fillRect(0, 0, L + 4, W + 4);
    g.fillStyle(c, 1); g.fillTriangle(10, 2, 26, W / 2 + 2, 10, W + 2);
    g.fillStyle(c, 1); g.fillRoundedRect(4, 6, L - 6, W - 8, 10);
    g.fillStyle(0xffffff, 1); g.fillEllipse(L - 6, W / 2 + 2, 16, W - 12);
    g.fillStyle(0x1b2c55, 1); g.fillEllipse(L - 16, W / 2 + 2, 18, W - 14);
    g.fillStyle(0x8fe3ff, 0.8); g.fillEllipse(L - 13, W / 2 - 1, 7, 4);
    g.fillStyle(0x222838, 1); g.fillRect(2, W / 2 - 3, 6, 10);
    g.generateTexture('mite' + i, L + 4, W + 4); g.destroy();
  });
  // vans
  CAB_COLORS.forEach((c, i) => {
    const g = gfx(scene); const L = 34 * S, W = 15 * S;
    g.fillStyle(c, 1); g.fillRoundedRect(2, 2, L, W, 8);
    g.fillStyle(0x000000, 0.12); g.fillRect(8, W / 2 - 2, L - 22, 8);
    g.fillStyle(0x1b2c55, 1); g.fillRoundedRect(L - 14, 6, 10, W - 8, 4);
    g.fillStyle(0x8fe3ff, 0.7); g.fillRect(L - 11, 8, 3, W - 12);
    g.fillStyle(0xffffff, 0.5); g.fillRect(6, 5, L - 24, 3);
    g.generateTexture('van' + i, L + 4, W + 4); g.destroy();
  });
  // truck cabs
  const cab = (key: string, c: number, L: number, W: number, stripe: number) => {
    const g = gfx(scene); L *= S; W *= S;
    g.fillStyle(0x23293a, 1); g.fillRoundedRect(0, 4, 10, W - 4, 3);
    g.fillStyle(c, 1); g.fillRoundedRect(6, 2, L - 4, W, 9);
    g.fillStyle(stripe, 1); g.fillRect(8, W / 2 - 1, L - 18, 4);
    g.fillStyle(0x1b2c55, 1); g.fillRoundedRect(L - 14, 6, 11, W - 8, 4);
    g.fillStyle(0x9fe9ff, 0.8); g.fillRect(L - 11, 8, 3, W - 12);
    g.fillStyle(0xffffff, 0.35); g.fillRect(10, 5, L - 26, 3);
    g.generateTexture(key, L + 4, W + 4); g.destroy();
  };
  CAB_COLORS.forEach((c, i) => cab('cab' + i, c, 22, 17, i === 0 ? 0xe85d3a : 0xffffff));
  cab('cab_player', 0xd93b30, 26, 17, 0xffffff);
  // police
  {
    const g = gfx(scene); const L = 28 * S, W = 14 * S;
    g.fillStyle(0xf4f6fb, 1); g.fillRoundedRect(2, 2, L, W, 10);
    g.fillStyle(0x2346c8, 1); g.fillRect(8, 2, 10, W); g.fillRect(L - 26, 2, 6, W);
    g.fillStyle(0x1b2c55, 1); g.fillRoundedRect(L - 16, 6, 12, W - 8, 4);
    g.fillStyle(0x222838, 1); g.fillRect(L / 2 - 6, 5, 6, W - 6);
    g.generateTexture('police', L + 4, W + 4); g.destroy();
  }
  // pods: tiny, fast one-seaters
  MITE_COLORS.forEach((c, i) => {
    const g = gfx(scene); const L = 14 * S, W = 9 * S;
    g.fillStyle(c, 1); g.fillEllipse(L / 2 + 2, W / 2 + 2, L, W);
    g.fillStyle(0xffffff, 0.35); g.fillEllipse(L * 0.45, W * 0.38, L * 0.5, W * 0.25);
    g.fillStyle(0x1b2c55, 1); g.fillEllipse(L * 0.68 + 2, W / 2 + 2, L * 0.32, W * 0.5);
    g.fillStyle(0x8fe3ff, 0.9); g.fillEllipse(L * 0.7 + 2, W * 0.42 + 2, L * 0.14, W * 0.18);
    g.fillStyle(0x222838, 1); g.fillRect(2, W / 2 - 1, 5, 6);
    g.generateTexture('pod' + i, L + 4, W + 4); g.destroy();
  });
  // sport ships: sleek wedges with a racing stripe
  MITE_COLORS.forEach((c, i) => {
    const g = gfx(scene); const L = 22 * S, W = 12 * S;
    g.fillStyle(c, 1); g.fillTriangle(2, 4, 2, W, L + 2, W / 2 + 2); g.fillRoundedRect(2, 3, L * 0.62, W - 2, 6);
    g.fillStyle(0xffffff, 0.9); g.fillRect(8, W / 2 + 1, L * 0.7, 3);
    g.fillStyle(0x1b2c55, 1); g.fillEllipse(L * 0.55, W / 2 + 2, L * 0.26, W * 0.5);
    g.fillStyle(0x8fe3ff, 0.85); g.fillEllipse(L * 0.58, W * 0.42 + 2, L * 0.1, W * 0.16);
    g.fillStyle(0x222838, 1); g.fillRect(2, 5, 7, 4); g.fillRect(2, W - 3, 7, 4);
    g.generateTexture('sport' + i, L + 4, W + 4); g.destroy();
  });
  // taxi
  {
    const g = gfx(scene); const L = 24 * S, W = 13 * S;
    g.fillStyle(0xffc93c, 1); g.fillRoundedRect(2, 2, L, W, 10);
    for (let k = 0; k < 6; k++) { g.fillStyle(k % 2 ? 0x15181f : 0xffffff, 1); g.fillRect(8 + k * 5, 3, 4, 3); g.fillRect(8 + k * 5, W - 3, 4, 3); }
    g.fillStyle(0x1b2c55, 1); g.fillRoundedRect(L - 16, 6, 14, W - 8, 5);
    g.fillStyle(0xffffff, 1); g.fillRoundedRect(L / 2 - 6, W / 2 - 2, 10, 7, 2);
    g.fillStyle(0x15181f, 1); g.fillRect(L / 2 - 4, W / 2, 6, 3);
    g.generateTexture('taxi', L + 4, W + 4); g.destroy();
  }
  // passenger buses
  [0x2ec4b6, 0x4ea8ff, 0xf15bb5].forEach((c, i) => {
    const g = gfx(scene); const L = 70 * S, W = 17 * S;
    g.fillStyle(0x23293a, 1); g.fillRoundedRect(0, 4, 12, W - 4, 3);
    g.fillStyle(c, 1); g.fillRoundedRect(6, 2, L - 4, W, 12);
    g.fillStyle(0xffffff, 0.9); g.fillRoundedRect(14, 5, L - 36, 6, 3);
    g.fillStyle(0x1b2c55, 1); for (let k = 0; k < 9; k++) g.fillRoundedRect(18 + k * 14, 8, 11, W - 12, 3);
    g.fillStyle(0x9fe9ff, 0.7); for (let k = 0; k < 9; k++) g.fillRect(20 + k * 14, 10, 3, W - 16);
    g.fillStyle(0x1b2c55, 1); g.fillRoundedRect(L - 14, 6, 11, W - 8, 4);
    g.generateTexture('bus' + i, L + 4, W + 4); g.destroy();
  });
  // repair truck
  {
    const g = gfx(scene); const L = 30 * S, W = 17 * S;
    g.fillStyle(0x23293a, 1); g.fillRoundedRect(0, 4, 10, W - 4, 3);
    g.fillStyle(0xff8a1f, 1); g.fillRoundedRect(6, 2, L - 4, W, 8);
    g.fillStyle(0xffffff, 1); for (let k = 0; k < 5; k++) g.fillRect(12 + k * 7, 3, 3, W - 2);
    g.fillStyle(0x6b7488, 1); g.fillRect(10, W / 2 - 3, 30, 6); g.fillCircle(12, W / 2, 6);
    g.lineStyle(3, 0x23293a, 1); g.lineBetween(12, W / 2, 6, W / 2 + 8);
    g.fillStyle(0x1b2c55, 1); g.fillRoundedRect(L - 12, 6, 11, W - 8, 4);
    g.fillStyle(0xffb020, 1); g.fillRect(L - 20, W / 2 - 4, 5, 8);
    g.generateTexture('tow', L + 4, W + 4); g.destroy();
  }
  // glow dot
  {
    const tex = scene.textures.createCanvas('glow', 64, 64)!;
    const ctx = tex.getContext();
    const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 64); tex.refresh();
  }
  // player arrow for sat-nav
  {
    const g = gfx(scene);
    g.fillStyle(0xffffff, 1); g.fillTriangle(64, 32, 4, 4, 4, 60);
    g.fillStyle(0xff5a3c, 1); g.fillTriangle(56, 32, 12, 12, 12, 52);
    g.generateTexture('navarrow', 68, 64); g.destroy();
  }
  makeStars(scene);
  makeNebula(scene);
  makeDecor(scene);
  makeStructures(scene);
  makeAsteroids(scene);
}

export function trailerTex(scene: Phaser.Scene, len: number, style: number): string {
  const key = `tr_${len}_${style}`;
  if (scene.textures.exists(key)) return key;
  const S = 2, L = len * S, W = 17 * S;
  const g = gfx(scene);
  g.fillStyle(0x2a3040, 1); g.fillRoundedRect(0, 2, L + 2, W, 4);
  if (style === 0 || style === 1 || style === 5) {
    const cols = style === 0 ? [0xe8742f, 0xd8632a] : style === 1 ? [0x3d8be0, 0x2f74c4] : [0xe8742f, 0x3db089, 0xe1b33a, 0xd6453b];
    const n = Math.max(1, Math.round(len / 13));
    const w = (L - 4) / n;
    for (let i = 0; i < n; i++) {
      g.fillStyle(cols[i % cols.length], 1); g.fillRect(2 + i * w + 1, 4, w - 2, W - 4);
      g.fillStyle(0x000000, 0.18);
      for (let k = 3; k < w - 3; k += 5) g.fillRect(2 + i * w + k, 5, 2, W - 6);
      g.fillStyle(0xffffff, 0.18); g.fillRect(2 + i * w + 1, 4, w - 2, 3);
    }
  } else if (style === 2) {
    g.fillStyle(0xc9d3e0, 1); g.fillRoundedRect(3, 4, L - 4, W - 4, 14);
    g.fillStyle(0xffffff, 0.55); g.fillRoundedRect(8, 7, L - 16, 6, 3);
    g.fillStyle(0x7d8aa0, 1); for (let k = 18; k < L - 8; k += 26) g.fillRect(k, 4, 3, W - 4);
    g.fillStyle(0x3fb3ff, 1); g.fillRect(L / 2 - 8, W / 2 - 2, 16, 6);
  } else if (style === 3) {
    g.fillStyle(0x5a4a3a, 1); g.fillRect(2, 4, L - 2, W - 4);
    for (let k = 4; k < L - 12; k += 16) { g.fillStyle([0xc8a26a, 0xb48a52, 0xd8b678][(k / 16) % 3 | 0], 1); g.fillRect(k, 6, 13, W - 8); g.fillStyle(0x000000, 0.2); g.fillRect(k + 6, 6, 1, W - 8); }
  } else if (style === 6) {
    g.fillStyle(0xb8c2d2, 1); g.fillRoundedRect(3, 4, L - 4, W - 4, 16);
    g.fillStyle(0xffffff, 0.6); g.fillRoundedRect(8, 7, L - 16, 5, 3);
    g.fillStyle(0x6b7488, 1); for (let k = 20; k < L - 10; k += 24) g.fillRect(k, 4, 3, W - 4);
    g.fillStyle(0xff8a1f, 1); g.fillRect(L / 2 - 14, W / 2 - 1, 28, 6);
    g.fillStyle(0x3d4558, 1); g.fillCircle(L / 2 + 20, W / 2 + 1, 4);
  } else if (style === 7) {
    g.fillStyle(0xe8f3fb, 1); g.fillRoundedRect(2, 4, L - 2, W - 4, 5);
    g.fillStyle(0x8fd3ff, 1); g.fillRect(2, 4, L - 2, 5);
    g.fillStyle(0x4aa8e8, 1); g.fillRect(L * 0.3, W / 2 - 3, L * 0.4, 8);
    g.fillStyle(0xffffff, 1); for (let k = 0; k < 5; k++) g.fillCircle(8 + k * (L - 16) / 4, W - 6, 2.5);
  } else {
    g.fillStyle(0x6b5d52, 1); g.fillRoundedRect(2, 4, L - 2, W - 4, 6);
    g.fillStyle(0x3b3330, 1); g.fillRoundedRect(6, 7, L - 10, W - 10, 5);
    for (let k = 0; k < len / 2; k++) { g.fillStyle([0x9a8f86, 0x7e746c, 0xb0a296][k % 3], 1); g.fillCircle(10 + Math.random() * (L - 20), 10 + Math.random() * (W - 16), 3 + Math.random() * 4); }
  }
  g.generateTexture(key, L + 4, W + 4); g.destroy();
  return key;
}

function makeStars(scene: Phaser.Scene) {
  const size = 512;
  const tex = scene.textures.createCanvas('stars', size, size)!;
  const ctx = tex.getContext();
  ctx.fillStyle = '#0a1030'; ctx.fillRect(0, 0, size, size);
  const cols = ['110,60,200', '40,110,210', '170,70,170', '40,150,170', '90,70,220'];
  for (let i = 0; i < 22; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 40 + Math.random() * 150;
    const col = cols[i % cols.length];
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
      const gr = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      gr.addColorStop(0, `rgba(${col},0.16)`); gr.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = gr; ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    }
  }
  for (let i = 0; i < 300; i++) {
    const r = Math.random() < 0.92 ? Math.random() * 0.9 + 0.3 : Math.random() * 1.6 + 1;
    const c = ['#ffffff', '#cfe3ff', '#ffe9c4', '#a9c8ff'][Math.floor(Math.random() * 4)];
    ctx.globalAlpha = 0.35 + Math.random() * 0.65;
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1; tex.refresh();
}
function makeDecor(scene: Phaser.Scene) {
  // satellite with solar wings
  let g = gfx(scene);
  g.fillStyle(0x1e3d7a, 1); g.fillRect(4, 40, 90, 40); g.fillRect(146, 40, 90, 40);
  g.lineStyle(2, 0x5ad8ff, 0.7); for (let x = 4; x <= 94; x += 15) { g.lineBetween(x, 40, x, 80); g.lineBetween(x + 142, 40, x + 142, 80); }
  g.lineBetween(4, 60, 94, 60); g.lineBetween(146, 60, 236, 60);
  g.fillStyle(0x9aa6bd, 1); g.fillRect(94, 56, 52, 8);
  g.fillStyle(0xdfe6f0, 1); g.fillCircle(120, 60, 28); g.fillStyle(0xf2b134, 1); g.fillCircle(120, 60, 12);
  g.generateTexture('d_sat', 240, 120); g.destroy();
  // beacon buoy
  g = gfx(scene);
  g.fillStyle(0x2a3350, 1); g.fillCircle(40, 40, 30); g.fillStyle(0xdfe6f0, 1); g.fillCircle(40, 40, 22);
  g.lineStyle(4, 0xff5a3c, 1); g.strokeCircle(40, 40, 30); g.fillStyle(0xff5a3c, 1); g.fillCircle(40, 40, 8);
  g.generateTexture('d_buoy', 80, 80); g.destroy();
  // dome rock
  g = gfx(scene);
  g.fillStyle(0x4a403d, 1); g.fillCircle(80, 80, 70); g.fillStyle(0x6e625c, 1); g.fillCircle(70, 70, 56);
  g.fillStyle(0x9aa6bd, 1); g.fillCircle(84, 78, 34); g.fillStyle(0xbfe9ff, 0.9); g.fillCircle(84, 78, 28); g.fillStyle(0xffffff, 0.8); g.fillCircle(74, 68, 9);
  g.fillStyle(0x3caa55, 1); g.fillCircle(90, 86, 9); g.fillCircle(80, 90, 7);
  g.generateTexture('d_dome', 160, 160); g.destroy();
  // parked freighter
  g = gfx(scene);
  g.fillStyle(0x8f99ad, 1); g.fillRoundedRect(10, 30, 300, 60, 26); g.fillStyle(0xdfe6f0, 1); g.fillRoundedRect(20, 36, 280, 48, 22);
  for (let i = 0; i < 6; i++) { g.fillStyle([0xe8742f, 0x3d8be0, 0x3db089][i % 3], 1); g.fillRect(60 + i * 36, 40, 30, 40); }
  g.fillStyle(0x1b2c55, 1); g.fillRoundedRect(270, 46, 26, 28, 8); g.fillStyle(0x5ad8ff, 1); g.fillCircle(14, 48, 7); g.fillCircle(14, 72, 7);
  g.generateTexture('d_freighter', 320, 120); g.destroy();
  // little garden platform
  g = gfx(scene);
  g.fillStyle(0x56607a, 1); g.fillCircle(90, 90, 86); g.fillStyle(0x3e8f4e, 1); g.fillCircle(90, 90, 78);
  for (let i = 0; i < 10; i++) { const x = 90 + rand(-50, 50), y = 90 + rand(-50, 50); g.fillStyle(0x1f5f33, 1); g.fillCircle(x + 3, y + 4, 12); g.fillStyle(0x3caa55, 1); g.fillCircle(x, y, 11); g.fillStyle(0x6fd17a, 1); g.fillCircle(x - 3, y - 3, 4); }
  g.lineStyle(4, 0x5ad8ff, 0.8); g.strokeCircle(90, 90, 86);
  g.generateTexture('d_garden', 180, 180); g.destroy();
}
// roadside structures: mining stations, ship repair shops and living quarters.
// Each kind has STRUCT_VARIANTS procedurally varied layouts so the roadside never repeats exactly.
export const STRUCT_VARIANTS = 3;
export const STRUCT_SIZE: Record<string, number> = { mine: 320, repair: 300, hab: 300 };
function makeStructures(scene: Phaser.Scene) {
  const shadow = (g: Phaser.GameObjects.Graphics, fn: () => void) => { g.fillStyle(0x000000, 0.3); fn(); };
  const pad = (g: Phaser.GameObjects.Graphics, cx: number, cy: number, w: number, h: number, r: number, col: number, edge: number) => {
    shadow(g, () => g.fillRoundedRect(cx - w / 2 + 10, cy - h / 2 + 14, w, h, r));
    g.fillStyle(edge, 1); g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, r);
    g.fillStyle(col, 1); g.fillRoundedRect(cx - w / 2 + 8, cy - h / 2 + 8, w - 16, h - 16, Math.max(4, r - 6));
  };
  const lamp = (g: Phaser.GameObjects.Graphics, x: number, y: number, col: number, r = 5) => { g.fillStyle(col, 0.35); g.fillCircle(x, y, r * 2.2); g.fillStyle(col, 1); g.fillCircle(x, y, r); g.fillStyle(0xffffff, 0.9); g.fillCircle(x - r * 0.3, y - r * 0.3, r * 0.4); };

  for (let v = 0; v < STRUCT_VARIANTS; v++) {
    // ---- mining station: cracked rock pad, drill derrick, ore heaps, conveyor and amber work lights
    let g = gfx(scene); const M = STRUCT_SIZE.mine, c = M / 2;
    const rock: Pt[] = []; const n = 14 + v * 2;
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, r = (M / 2 - 8) * rand(0.78, 1); rock.push({ x: c + Math.cos(a) * r, y: c + Math.sin(a) * r }); }
    shadow(g, () => g.fillPoints(rock.map((p) => new Phaser.Geom.Point(p.x + 10, p.y + 14)), true));
    g.fillStyle(0x4a403d, 1); g.fillPoints(rock.map((p) => new Phaser.Geom.Point(p.x, p.y)), true);
    g.fillStyle(0x6e625c, 1); g.fillPoints(rock.map((p) => new Phaser.Geom.Point(c + (p.x - c) * 0.86 - 4, c + (p.y - c) * 0.86 - 4)), true);
    for (let i = 0; i < 8; i++) { g.fillStyle(0x3d3431, 1); g.fillCircle(c + rand(-90, 90), c + rand(-90, 90), rand(6, 16)); }
    // ore veins
    g.lineStyle(4, v === 1 ? 0x9be7ff : 0xffa45c, 0.7);
    for (let i = 0; i < 4; i++) { let x = c + rand(-60, 60), y = c + rand(-60, 60); for (let k = 0; k < 3; k++) { const nx = clampV(x + rand(-40, 40), c - 95, c + 95), ny = clampV(y + rand(-40, 40), c - 95, c + 95); g.lineBetween(x, y, nx, ny); x = nx; y = ny; } }
    // processing shed
    const sx = c + (v === 2 ? -60 : 50), sy = c + (v === 0 ? 40 : -50);
    pad(g, sx, sy, 110, 70, 10, 0xb9c3d4, 0x6f7a90);
    g.fillStyle(0x2a3350, 1); for (let i = 0; i < 4; i++) g.fillRect(sx - 45 + i * 24, sy - 26, 14, 52);
    // conveyor to ore heap
    const hx = c + (v === 2 ? 70 : -70), hy = c + (v === 0 ? -60 : 60);
    g.lineStyle(14, 0x5c6478, 1); g.lineBetween(sx, sy, hx, hy); g.lineStyle(4, 0xffd166, 0.8); g.lineBetween(sx, sy, hx, hy);
    for (let i = 0; i < 3; i++) { const r = 34 - i * 8; g.fillStyle(0x3a2d26, 1); g.fillCircle(hx + 4, hy + 5, r); g.fillStyle([0x7a5a3a, 0xa0784a, 0xc89a5a][i], 1); g.fillCircle(hx, hy, r); }
    g.fillStyle(v === 1 ? 0x9be7ff : 0xffa45c, 0.9); for (let i = 0; i < 6; i++) g.fillCircle(hx + rand(-22, 22), hy + rand(-22, 22), 3);
    // drill derrick
    const dx = c + (v === 1 ? -20 : 10), dy = c + (v === 1 ? 10 : -5);
    shadow(g, () => g.fillCircle(dx + 8, dy + 10, 36));
    g.fillStyle(0x8f99ad, 1); g.fillCircle(dx, dy, 36); g.fillStyle(0x2a2f3c, 1); g.fillCircle(dx, dy, 26);
    g.lineStyle(6, 0xaab4c8, 1); for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; g.lineBetween(dx, dy, dx + Math.cos(a) * 44, dy + Math.sin(a) * 44); }
    g.fillStyle(0xffa45c, 1); g.fillCircle(dx, dy, 10); g.fillStyle(0xfff1d6, 1); g.fillCircle(dx, dy, 4);
    // work lights and a warning stripe
    lamp(g, sx - 60, sy - 40, 0xffd166, 4); lamp(g, sx + 60, sy + 40, 0xffd166, 4); lamp(g, hx - 40, hy + 30, 0xff5a3c, 4);
    g.lineStyle(3, 0xffd166, 0.9); g.lineBetween(sx - 55, sy + 36, sx + 55, sy + 36);
    g.generateTexture('st_mine' + v, M, M); g.destroy();

    // ---- ship repair shop: landing pad, open-fronted hangar, a hull up on jacks and a lit wrench sign
    g = gfx(scene); const R = STRUCT_SIZE.repair, rc = R / 2;
    pad(g, rc, rc + 20, R - 30, R - 70, 26, 0x4f5870, 0x2d3447);
    // landing circle
    g.lineStyle(4, 0x5ad8ff, 0.85); g.strokeCircle(rc + (v === 0 ? 70 : -70), rc + 50, 42); g.lineStyle(3, 0xffffff, 0.6); g.strokeCircle(rc + (v === 0 ? 70 : -70), rc + 50, 14);
    // hangar
    const hgx = rc + (v === 0 ? -55 : 55), hgy = rc - 10, hw = v === 2 ? 150 : 130, hh = 100;
    shadow(g, () => g.fillRoundedRect(hgx - hw / 2 + 10, hgy - hh / 2 + 14, hw, hh, 16));
    g.fillStyle(0x8f99ad, 1); g.fillRoundedRect(hgx - hw / 2, hgy - hh / 2, hw, hh, 16);
    g.fillStyle(0xdfe6f0, 1); g.fillRoundedRect(hgx - hw / 2 + 8, hgy - hh / 2 + 8, hw - 16, hh - 16, 12);
    g.fillStyle(0x1b2c55, 1); g.fillRect(hgx - hw / 2 + 8, hgy + hh / 2 - 34, hw - 16, 26); // open bay
    g.fillStyle(0x5ad8ff, 0.5); g.fillRect(hgx - hw / 2 + 8, hgy + hh / 2 - 12, hw - 16, 4);
    for (let i = 0; i < 3; i++) { g.lineStyle(3, 0xaab4c8, 1); g.lineBetween(hgx - hw / 2 + 8, hgy - hh / 2 + 24 + i * 16, hgx + hw / 2 - 8, hgy - hh / 2 + 24 + i * 16); }
    // hull on jacks beside the hangar
    const jx = hgx, jy = hgy + hh / 2 + 36;
    g.fillStyle(0x2a3350, 1); g.fillRect(jx - 50, jy - 6, 8, 12); g.fillRect(jx + 42, jy - 6, 8, 12);
    g.fillStyle([0xf4f1ea, 0xe85d3a, 0x3d7dd8][v], 1); g.fillRoundedRect(jx - 46, jy - 11, 92, 22, 10);
    g.fillStyle(0x1b2c55, 1); g.fillRoundedRect(jx + 24, jy - 7, 16, 14, 5);
    g.fillStyle(0xffd166, 1); g.fillCircle(jx - 20, jy - 16, 3); g.fillCircle(jx, jy + 16, 3); // welding sparks
    // wrench sign
    const wx = rc + (v === 0 ? 95 : -95), wy = rc - 85;
    shadow(g, () => g.fillRoundedRect(wx - 30 + 6, wy - 18 + 8, 60, 36, 8));
    g.fillStyle(0x1f5fb8, 1); g.fillRoundedRect(wx - 30, wy - 18, 60, 36, 8); g.lineStyle(2, 0xffffff, 1); g.strokeRoundedRect(wx - 27, wy - 15, 54, 30, 6);
    g.lineStyle(6, 0xffffff, 1); g.lineBetween(wx - 12, wy + 9, wx + 10, wy - 8); g.fillStyle(0xffffff, 1); g.fillCircle(wx + 11, wy - 9, 7); g.fillStyle(0x1f5fb8, 1); g.fillCircle(wx + 13, wy - 11, 3);
    lamp(g, rc - R / 2 + 32, rc + R / 2 - 30, 0x5ad8ff, 4); lamp(g, rc + R / 2 - 32, rc + R / 2 - 30, 0x5ad8ff, 4);
    // spare parts crates
    for (let i = 0; i < 3 + v; i++) { const x = rc + rand(-100, 100), y = rc + 110 + rand(-10, 10); g.fillStyle(0x000000, 0.25); g.fillRect(x - 9 + 3, y - 6 + 4, 18, 12); g.fillStyle([0xe8742f, 0x3db089, 0xe1b33a][i % 3], 1); g.fillRect(x - 9, y - 6, 18, 12); }
    g.generateTexture('st_repair' + v, R, R); g.destroy();

    // ---- living quarters: a cluster of habitat domes and ring modules, warm windows, corridors, a small garden
    g = gfx(scene); const H = STRUCT_SIZE.hab, hc = H / 2;
    const domes: { x: number; y: number; r: number }[] = v === 0
      ? [{ x: hc - 60, y: hc - 40, r: 52 }, { x: hc + 50, y: hc - 60, r: 40 }, { x: hc + 30, y: hc + 50, r: 58 }, { x: hc - 70, y: hc + 60, r: 34 }]
      : v === 1
        ? [{ x: hc, y: hc, r: 62 }, { x: hc - 95, y: hc - 20, r: 36 }, { x: hc + 90, y: hc + 10, r: 38 }, { x: hc + 10, y: hc + 100, r: 30 }, { x: hc - 20, y: hc - 100, r: 30 }]
        : [{ x: hc - 70, y: hc - 70, r: 44 }, { x: hc + 70, y: hc - 70, r: 44 }, { x: hc + 70, y: hc + 70, r: 44 }, { x: hc - 70, y: hc + 70, r: 44 }];
    // ground plate
    pad(g, hc, hc, H - 24, H - 24, 60, 0x56607a, 0x3a4256);
    // corridors between domes (hub for v1, ring for v2)
    g.lineStyle(16, 0x8f99ad, 1);
    for (let i = 0; i < domes.length; i++) { const a = domes[i], b = domes[v === 1 ? 0 : (i + 1) % domes.length]; if (a !== b) g.lineBetween(a.x, a.y, b.x, b.y); }
    g.lineStyle(4, 0xffd9a0, 0.6);
    for (let i = 0; i < domes.length; i++) { const a = domes[i], b = domes[v === 1 ? 0 : (i + 1) % domes.length]; if (a !== b) g.lineBetween(a.x, a.y, b.x, b.y); }
    // garden patch
    const gx = hc + (v === 2 ? 0 : -10), gy = hc + (v === 2 ? 0 : 5), gr = v === 2 ? 46 : 28;
    g.fillStyle(0x3e8f4e, 1); g.fillCircle(gx, gy, gr);
    for (let i = 0; i < (v === 2 ? 8 : 4); i++) { const x = gx + rand(-gr * 0.6, gr * 0.6), y = gy + rand(-gr * 0.6, gr * 0.6); g.fillStyle(0x1f5f33, 1); g.fillCircle(x + 2, y + 3, 8); g.fillStyle(0x3caa55, 1); g.fillCircle(x, y, 7); }
    for (const d of domes) {
      shadow(g, () => g.fillCircle(d.x + 8, d.y + 10, d.r));
      g.fillStyle(0x9aa6bd, 1); g.fillCircle(d.x, d.y, d.r);
      g.fillStyle(0xe9eef6, 1); g.fillCircle(d.x, d.y, d.r - 7);
      g.fillStyle(0xffffff, 0.85); g.fillCircle(d.x - d.r * 0.3, d.y - d.r * 0.3, d.r * 0.22);
      // warm windows around the rim
      const nw = Math.max(5, Math.floor(d.r / 7));
      for (let i = 0; i < nw; i++) { const a = (i / nw) * Math.PI * 2 + 0.3; g.fillStyle(Math.random() < 0.8 ? 0xffd9a0 : 0x2a3350, 1); g.fillCircle(d.x + Math.cos(a) * (d.r - 14), d.y + Math.sin(a) * (d.r - 14), 3.5); }
    }
    // antenna mast and porch light
    const ax = hc + H / 2 - 40, ay = hc - H / 2 + 40;
    g.lineStyle(3, 0xaab4c8, 1); g.lineBetween(ax, ay + 18, ax, ay - 14); g.fillStyle(0xff5a3c, 1); g.fillCircle(ax, ay - 16, 3);
    lamp(g, hc - H / 2 + 34, hc + H / 2 - 34, 0xffd9a0, 4);
    g.generateTexture('st_hab' + v, H, H); g.destroy();
  }
}
function makeNebula(scene: Phaser.Scene) {
  const size = 256;
  const tex = scene.textures.createCanvas('nebula', size, size)!;
  const ctx = tex.getContext();
  for (let i = 0; i < 14; i++) {
    const x = 128 + (Math.random() - 0.5) * 110, y = 128 + (Math.random() - 0.5) * 110, r = 40 + Math.random() * 60;
    const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.16)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, size, size);
  }
  tex.refresh();
}
function makeAsteroids(scene: Phaser.Scene) {
  for (let k = 0; k < 6; k++) {
    const g = gfx(scene); const R = 30 + k * 6; const c = R + 4;
    const pts: Pt[] = [];
    const n = 9 + k;
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, r = R * (0.72 + Math.random() * 0.28); pts.push({ x: c + Math.cos(a) * r, y: c + Math.sin(a) * r }); }
    g.fillStyle(0x4a403d, 1); g.fillPoints(pts.map((p) => new Phaser.Geom.Point(p.x, p.y)), true);
    g.fillStyle(0x6e625c, 1); g.fillPoints(pts.map((p) => new Phaser.Geom.Point(c + (p.x - c) * 0.82 - 3, c + (p.y - c) * 0.82 - 3)), true);
    for (let i = 0; i < 4; i++) { g.fillStyle(0x3d3431, 1); g.fillCircle(c + rand(-R, R) * 0.5, c + rand(-R, R) * 0.5, rand(3, 7)); }
    g.generateTexture('rock' + k, c * 2, c * 2); g.destroy();
  }
}

export function planetTex(scene: Phaser.Scene, key: string, kind: 'terra' | 'jove' | 'violet' | 'red' | 'moon' | 'ice' | 'ember') {
  const size = 1024, R = 500;
  const tex = scene.textures.createCanvas(key, size, size)!;
  const ctx = tex.getContext();
  const c = size / 2;
  // atmosphere glow
  const glowCol = kind === 'terra' ? '90,190,255' : kind === 'jove' ? '255,170,100' : kind === 'violet' ? '200,120,255' : kind === 'red' ? '255,120,90' : kind === 'ice' ? '150,230,255' : kind === 'ember' ? '255,110,60' : '200,200,220';
  const ga = ctx.createRadialGradient(c, c, R * 0.92, c, c, R * 1.02);
  ga.addColorStop(0, `rgba(${glowCol},0.5)`); ga.addColorStop(1, `rgba(${glowCol},0)`);
  ctx.fillStyle = ga; ctx.fillRect(0, 0, size, size);
  ctx.save(); ctx.beginPath(); ctx.arc(c, c, R * 0.95, 0, Math.PI * 2); ctx.clip();
  const blob = (x: number, y: number, r: number, col: string) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
  if (kind === 'terra') {
    ctx.fillStyle = '#1f6fb8'; ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 9; i++) {
      const x = rand(100, 920), y = rand(100, 920);
      for (let k = 0; k < 40; k++) blob(x + rand(-120, 120), y + rand(-90, 90), rand(20, 70), k % 5 === 0 ? '#3f9b4a' : '#4fb35a');
      for (let k = 0; k < 10; k++) blob(x + rand(-80, 80), y + rand(-60, 60), rand(10, 30), '#2f7f3e');
    }
    ctx.globalAlpha = 0.75;
    for (let i = 0; i < 70; i++) { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(rand(0, size), rand(0, size), rand(30, 110), rand(8, 26), rand(-0.3, 0.3), 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
  } else if (kind === 'jove' || kind === 'violet' || kind === 'red') {
    const cols = kind === 'jove' ? ['#e9a46a', '#f6d7b0', '#c9733f', '#f0c08a', '#b85f35', '#f7e3c8'] : kind === 'violet' ? ['#b26ad9', '#e08ac7', '#7d4fc4', '#f0a3c2', '#9a5fd6'] : ['#c9583f', '#e2876a', '#a8432f', '#efa07c'];
    let y = 0;
    while (y < size) { const h = rand(24, 80); ctx.fillStyle = cols[Math.floor(Math.random() * cols.length)]; ctx.fillRect(0, y, size, h + 2); y += h; }
    ctx.globalAlpha = 0.45;
    for (let i = 0; i < 160; i++) { ctx.fillStyle = cols[Math.floor(Math.random() * cols.length)]; ctx.beginPath(); ctx.ellipse(rand(0, size), rand(0, size), rand(30, 160), rand(6, 22), rand(-0.15, 0.15), 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
    if (kind === 'jove') { ctx.fillStyle = '#c55b33'; ctx.beginPath(); ctx.ellipse(640, 600, 70, 36, 0, 0, Math.PI * 2); ctx.fill(); }
  } else if (kind === 'ice') {
    ctx.fillStyle = '#9fd8ee'; ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 120; i++) { ctx.globalAlpha = 0.5; ctx.fillStyle = Math.random() < 0.5 ? '#e8f8ff' : '#6fb7dd'; ctx.beginPath(); ctx.ellipse(rand(0, size), rand(0, size), rand(30, 150), rand(8, 28), rand(-0.5, 0.5), 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
  } else if (kind === 'ember') {
    ctx.fillStyle = '#2a1a1a'; ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 90; i++) blob(rand(0, size), rand(0, size), rand(20, 90), Math.random() < 0.5 ? '#3a2220' : '#1c1212');
    ctx.strokeStyle = '#ff7a2a'; ctx.lineWidth = 7; ctx.shadowColor = '#ff7a2a'; ctx.shadowBlur = 18;
    for (let i = 0; i < 26; i++) { ctx.beginPath(); let x = rand(0, size), y = rand(0, size); ctx.moveTo(x, y); for (let k = 0; k < 6; k++) { x += rand(-90, 90); y += rand(-90, 90); ctx.lineTo(x, y); } ctx.stroke(); }
    ctx.shadowBlur = 0;
  } else {
    ctx.fillStyle = '#8a8c99'; ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 60; i++) blob(rand(0, size), rand(0, size), rand(10, 60), Math.random() < 0.5 ? '#767887' : '#9c9eab');
  }
  // terminator shading
  const sh = ctx.createRadialGradient(c - R * 0.45, c - R * 0.45, R * 0.2, c, c, R * 1.25);
  sh.addColorStop(0, 'rgba(255,255,255,0.14)'); sh.addColorStop(0.55, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(5,8,30,0.75)');
  ctx.fillStyle = sh; ctx.fillRect(0, 0, size, size);
  ctx.restore();
  tex.refresh();
}

// ---------------------------------------------------------------- static world
type G = Phaser.GameObjects.Graphics;

function strokePts(g: G, pts: Pt[]) { g.strokePoints(pts as Phaser.Types.Math.Vector2Like[], false, false); }

function dashLine(g: G, seg: Seg, s0: number, s1: number, lat: number, len = 20, gap = 26) {
  const start = Math.ceil(s0 / (len + gap)) * (len + gap);
  for (let s = start; s < s1; s += len + gap) {
    const a = seg.path.at(s, lat), b = seg.path.at(Math.min(s + len, s1), lat);
    g.lineBetween(a.x, a.y, b.x, b.y);
  }
}
/** Split [s0,s1] into ranges inside/outside the side's aux zones. */
function auxRanges(seg: Seg, s0: number, s1: number, side: number, types?: string[]): { a: number; b: number; inAux: boolean }[] {
  const zones = seg.aux.filter((z) => z.side === side && (!types || types.includes(z.type)) && z.s1 > s0 && z.s0 < s1).sort((a, b) => a.s0 - b.s0);
  const out: { a: number; b: number; inAux: boolean }[] = [];
  let cur = s0;
  for (const z of zones) {
    const a = Math.max(s0, z.s0), b = Math.min(s1, z.s1);
    if (a > cur) out.push({ a: cur, b: a, inAux: false });
    out.push({ a, b, inAux: true });
    cur = b;
  }
  if (cur < s1) out.push({ a: cur, b: s1, inAux: false });
  return out;
}

function drawSegPiece(g: G, seg: Seg, s0: number, s1: number) {
  const n = seg.lanes, W = seg.laneW, half = (n * W) / 2;
  const sh = seg.shoulder ? LW : 0;
  const bandC = sh / 2, bandW = n * W + sh;
  const step = seg.kind === 'ramp' ? 10 : 18;
  const P = (lat: number | ((s: number) => number), a = s0, b = s1) => seg.path.pts(a, b, lat, step);
  if (seg.level > 0) {
    g.lineStyle(bandW + 12, 0x000000, 0.22);
    strokePts(g, P(bandC).map((p) => ({ x: p.x + 10 + 8 * seg.level, y: p.y + 14 + 10 * seg.level })));
  }
  // left aux zones (in the median)
  const leftZ = seg.aux.filter((z) => z.side < 0 && z.s1 > s0 && z.s0 < s1);
  const leftLat = (z: typeof leftZ[0]) => (s: number) => {
    const k = z.type === 'exit' ? Math.min(1, (s - z.s0) / 110) : Math.min(1, (z.s1 - s) / 110);
    return -half - (LW / 2) * Math.max(0, k);
  };
  for (const z of leftZ) { g.lineStyle(LW + 10, RIM, 1); strokePts(g, P(leftLat(z), Math.max(s0, z.s0), Math.min(s1, z.s1))); }
  // layby bays
  const lay = seg.aux.filter((z) => z.type === 'layby' && z.s1 > s0 && z.s0 < s1);
  for (const z of lay) {
    const a = Math.max(s0, z.s0 + 60), b = Math.min(s1, z.s1 - 60);
    if (b > a) { g.lineStyle(30, RIM, 1); strokePts(g, P(half + LW + 12, a, b)); g.lineStyle(22, 0x353c4e, 1); strokePts(g, P(half + LW + 12, a, b)); }
  }
  g.lineStyle(bandW + 10, RIM, 1); strokePts(g, P(bandC));
  g.lineStyle(bandW, ASPH, 1); strokePts(g, P(bandC));
  for (const z of leftZ) { g.lineStyle(LW, ASPH, 1); strokePts(g, P(leftLat(z), Math.max(s0, z.s0), Math.min(s1, z.s1))); }
  if (sh) {
    for (const r of auxRanges(seg, s0, s1, 1)) {
      if (!r.inAux) { g.lineStyle(sh - 3, SHOULDER, 1); strokePts(g, P(half + sh / 2, r.a, r.b)); }
    }
  }
  // neon edge strips
  g.lineStyle(2, NEON, 0.55);
  strokePts(g, P(half + sh + 5));
  strokePts(g, P(-half - 5));
  // edge lines
  g.lineStyle(2.5, 0xf2c94c, 0.9);
  for (const r of auxRanges(seg, s0, s1, -1)) { if (r.inAux) dashLine(g, seg, r.a, r.b, -half + 2, 14, 10); else strokePts(g, P(-half + 3, r.a, r.b)); }
  g.lineStyle(2.5, 0xffffff, 0.85);
  for (const r of auxRanges(seg, s0, s1, 1)) { if (r.inAux) dashLine(g, seg, r.a, r.b, half - 1, 14, 10); else strokePts(g, P(half - 2, r.a, r.b)); }
  if (seg.kind !== 'services') {
    g.lineStyle(2, 0xffffff, 0.6);
    for (let i = 1; i < n; i++) dashLine(g, seg, s0, s1, -half + i * W);
  }
  if (seg.kind === 'ramp' && seg.level > 0) {
    // little guide lights along flyovers
    g.fillStyle(NEON, 0.8);
    for (let s = Math.ceil(s0 / 60) * 60; s < s1; s += 60) { const p = seg.path.at(s, half + 6); g.fillCircle(p.x, p.y, 2); const q = seg.path.at(s, -half - 6); g.fillCircle(q.x, q.y, 2); }
  }
  // layby markings
  for (const z of lay) for (const sl of z.slots!) {
    if (sl.s < s0 || sl.s > s1) continue;
    g.lineStyle(2, 0xffffff, 0.5);
    const a = seg.path.at(sl.s + 6, half + 2), b = seg.path.at(sl.s + 6, half + LW + 24);
    g.lineBetween(a.x, a.y, b.x, b.y);
  }
}

function bboxOf(pts: Pt[], pad: number) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

export function drawWorld(scene: Phaser.Scene, net: Network, layer: Phaser.GameObjects.Layer): Cullable[] {
  const items: Cullable[] = [];
  const add = (obj: Cullable['obj'], bb: { x0: number; y0: number; x1: number; y1: number }) => { layer.add(obj); items.push({ obj, ...bb }); };
  const order = (s: Seg) => (s.kind === 'motorway' ? 0 : s.kind === 'avenue' ? 1 : s.kind === 'services' ? 3 : 2);
  const segs = net.segs.slice().sort((a, b) => order(a) - order(b));
  for (const seg of segs) {
    const chunk = 900;
    for (let s0 = 0; s0 < seg.len; s0 += chunk) {
      const s1 = Math.min(seg.len, s0 + chunk + 2);
      const g = scene.add.graphics();
      g.setDepth(DEPTH.road(seg.level));
      drawSegPiece(g, seg, s0, s1);
      add(g, bboxOf(seg.path.pts(s0, s1, 0, 50), 160 + seg.level * 50));
    }
  }
  // crossings
  for (const c of net.crossings) {
    const g = scene.add.graphics().setDepth(DEPTH.road(0));
    g.fillStyle(ASPH, 1); g.fillPoints(c.corners.map((p) => new Phaser.Geom.Point(p.x, p.y)), true);
    // zebra hints at box edges
    g.lineStyle(3, 0xffffff, 0.75);
    for (const l of c.lights) {
      const seg = l.seg, half = (seg.lanes * seg.laneW) / 2;
      const a = seg.path.at(l.s + 4, -half), b = seg.path.at(l.s + 4, half);
      g.lineStyle(5, 0xffffff, 0.9); g.lineBetween(a.x, a.y, b.x, b.y);
      const pole = seg.path.at(l.s, half + (seg.shoulder ? LW : 0) + 16);
      g.fillStyle(0x1c2130, 1); g.fillCircle(pole.x, pole.y, 9);
    }
    add(g, { x0: c.x - 400, y0: c.y - 400, x1: c.x + 400, y1: c.y + 400 });
  }
  // services decor
  for (const sv of net.services) {
    const seg = sv.seg; const W = seg.lanes * seg.laneW;
    const g = scene.add.graphics().setDepth(DEPTH.road(0) + 0.1);
    // islands between pump lanes
    for (let i = 0; i <= seg.lanes; i++) {
      const lat = -W / 2 + i * seg.laneW;
      const a = seg.path.at(sv.pumpS - 46, lat), b = seg.path.at(sv.pumpS + 6, lat);
      g.lineStyle(6, 0xd7dde8, 1); g.lineBetween(a.x, a.y, b.x, b.y);
      const m = seg.path.at(sv.pumpS - 20, lat);
      g.fillStyle(0x2f7de1, 1); g.fillCircle(m.x, m.y, 5);
      g.fillStyle(0xffffff, 1); g.fillCircle(m.x, m.y, 2);
    }
    add(g, { x0: sv.x - 600, y0: sv.y - 600, x1: sv.x + 600, y1: sv.y + 600 });
    // shop and garden beside the forecourt
    const gp = seg.path.at(seg.len / 2, W / 2 + 26 + 110);
    const sg = scene.add.graphics().setDepth(DEPTH.road(0) - 0.3).setPosition(gp.x, gp.y).setRotation(sv.h);
    const big = seg.lanes > 2;
    const gw = big ? 360 : 260, gh = 190;
    sg.fillStyle(0x56607a, 1); sg.fillRoundedRect(-gw / 2, -gh / 2, gw, gh, 30);
    sg.fillStyle(0x3e8f4e, 1); sg.fillRoundedRect(-gw / 2 + 10, -gh / 2 + 10, gw - 20, gh - 20, 24);
    for (let i = 0; i < (big ? 16 : 10); i++) { const x = rand(-gw / 2 + 30, gw / 2 - 30), y = rand(0, gh / 2 - 26); sg.fillStyle(0x1f5f33, 1); sg.fillCircle(x + 3, y + 4, 13); sg.fillStyle(0x3caa55, 1); sg.fillCircle(x, y, 12); sg.fillStyle(0x6fd17a, 1); sg.fillCircle(x - 3, y - 3, 5); }
    sg.fillStyle(0x0b0f18, 0.3); sg.fillRoundedRect(-56, -gh / 2 + 22, 120, 66, 10);
    sg.fillStyle(0xe8eef7, 1); sg.fillRoundedRect(-60, -gh / 2 + 16, 120, 66, 10);
    sg.fillStyle(0x2f7de1, 1); sg.fillRect(-60, -gh / 2 + 16, 120, 16);
    sg.fillStyle(0x9fe9ff, 1); sg.fillRect(-48, -gh / 2 + 52, 96, 12);
    add(sg, { x0: sv.x - 600, y0: sv.y - 600, x1: sv.x + 600, y1: sv.y + 600 });
    // canopy
    const cg = scene.add.graphics().setDepth(DEPTH.veh(0) + 0.6);
    const cp = seg.path.at(sv.pumpS - 20, 0);
    cg.setPosition(cp.x, cp.y); cg.setRotation(sv.h);
    cg.fillStyle(0xeaf2ff, 0.28); cg.fillRoundedRect(-44, -W / 2 - 14, 88, W + 28, 8);
    cg.lineStyle(3, 0x5ad8ff, 0.9); cg.strokeRoundedRect(-44, -W / 2 - 14, 88, W + 28, 8);
    add(cg, { x0: cp.x - 200, y0: cp.y - 200, x1: cp.x + 200, y1: cp.y + 200 });
  }
  // lay-by gardens
  for (const lb of net.laybys) {
    const g = scene.add.graphics().setDepth(DEPTH.road(0) - 0.2);
    const seg = lb.seg, half = (seg.lanes * LW) / 2;
    const p = seg.path.at(lb.aux.s0 + 270, half + LW + 40 + 130);
    g.fillStyle(0x56607a, 1); g.fillEllipse(p.x, p.y, 240, 240);
    g.fillStyle(0x3e8f4e, 1); g.fillEllipse(p.x, p.y, 222, 222);
    for (let i = 0; i < 9; i++) { const x = p.x + rand(-70, 70), y = p.y + rand(-70, 70); g.fillStyle(0x1f5f33, 1); g.fillCircle(x + 3, y + 4, 12); g.fillStyle(0x3caa55, 1); g.fillCircle(x, y, 11); }
    g.fillStyle(0xe8eef7, 1); g.fillRoundedRect(p.x - 22, p.y - 14, 44, 28, 6);
    add(g, { x0: p.x - 300, y0: p.y - 300, x1: p.x + 300, y1: p.y + 300 });
  }
  // signs
  for (const sg of net.signs) { const r = makeSign(scene, sg); add(r.obj, r.bb); }
  for (const ls of net.limitSigns) { const r = makeLimitSign(scene, ls.seg, ls.s, ls.limit); add(r.obj, r.bb); }
  // speed cameras
  for (const cam of net.cameras) {
    const g = scene.add.graphics().setDepth(DEPTH.veh(0) + 0.3);
    g.setPosition(cam.x, cam.y); g.setRotation(cam.seg.path.at(cam.s).h);
    g.fillStyle(0x1c2130, 1); g.fillRoundedRect(-10, -10, 20, 20, 4);
    g.fillStyle(0xffd23c, 1); g.fillRect(-8, -8, 16, 16);
    g.fillStyle(0x1c2130, 1); g.fillCircle(2, 0, 5);
    add(g, { x0: cam.x - 100, y0: cam.y - 100, x1: cam.x + 100, y1: cam.y + 100 });
  }
  return items;
}

// ---------------------------------------------------------------- signs
const FONT = '"Trebuchet MS", "Segoe UI", Arial, sans-serif';

function drawArrow(g: G, x: number, y: number, size: number, arrow: number | 'U', color = 0xffffff) {
  g.lineStyle(size * 0.22, color, 1); g.fillStyle(color, 1);
  if (arrow === 'U') {
    const r = size * 0.32;
    g.beginPath(); g.arc(x, y - size * 0.05, r, 0, Math.PI, true); g.strokePath();
    g.lineBetween(x + r, y - size * 0.05, x + r, y + size * 0.4);
    g.fillTriangle(x - r - size * 0.2, y + size * 0.02, x - r + size * 0.2, y + size * 0.02, x - r, y + size * 0.36);
    return;
  }
  const a = (arrow * Math.PI) / 180;
  const dx = Math.sin(a), dy = -Math.cos(a);
  const L = size * 0.42;
  g.lineBetween(x - dx * L, y - dy * L, x + dx * L * 0.35, y + dy * L * 0.35);
  const tx = x + dx * L, ty = y + dy * L, px = -dy, py = dx;
  g.fillTriangle(tx, ty, tx - dx * size * 0.42 + px * size * 0.3, ty - dy * size * 0.42 + py * size * 0.3, tx - dx * size * 0.42 - px * size * 0.3, ty - dy * size * 0.42 - py * size * 0.3);
}
function drawIcon(g: G, x: number, y: number, icon: string) {
  if (icon === 'fuel') {
    g.fillStyle(0xffffff, 1); g.fillRoundedRect(x - 9, y - 12, 14, 24, 3);
    g.fillStyle(0x1f5fb8, 1); g.fillRect(x - 6, y - 9, 8, 7);
    g.lineStyle(3, 0xffffff, 1); g.lineBetween(x + 5, y - 6, x + 11, y - 2); g.lineBetween(x + 11, y - 2, x + 11, y + 8);
  } else if (icon === 'P') {
    g.fillStyle(0xffffff, 1); g.fillRect(x - 8, y - 12, 5, 24); g.fillCircle(x + 2, y - 4, 9); g.fillStyle(0x1f5fb8, 1); g.fillCircle(x + 1, y - 4, 4);
  } else if (icon === 'lights') {
    g.fillStyle(0x15181f, 1); g.fillRoundedRect(x - 8, y - 15, 16, 30, 4);
    g.fillStyle(0xff4b3e, 1); g.fillCircle(x, y - 8, 4); g.fillStyle(0xffc83c, 1); g.fillCircle(x, y, 4); g.fillStyle(0x3ee07a, 1); g.fillCircle(x, y + 8, 4);
  } else if (icon === 'police') {
    g.fillStyle(0xffffff, 1); g.fillCircle(x, y, 12); g.fillStyle(0x283a8f, 1); g.fillCircle(x, y, 8); g.fillStyle(0xffd23c, 1); g.fillCircle(x, y, 4);
  }
}

function panel(scene: Phaser.Scene, c: Phaser.GameObjects.Container, cx: number, cy: number, p: SignPanel, w = 168) {
  const h = 58;
  const g = scene.add.graphics();
  g.fillStyle(0x0b0f18, 0.35); g.fillRoundedRect(cx - w / 2 + 4, cy - h / 2 + 5, w, h, 7);
  g.fillStyle(p.color, 1); g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 7);
  g.lineStyle(2.5, 0xffffff, 1); g.strokeRoundedRect(cx - w / 2 + 3, cy - h / 2 + 3, w - 6, h - 6, 5);
  const arrowRight = p.side === 'R' || (p.side === 'C' && false);
  const ax = arrowRight ? cx + w / 2 - 24 : cx - w / 2 + 24;
  if (p.arrow !== null) drawArrow(g, ax, cy, 30, p.arrow);
  let tx = cx + (p.arrow === null ? 0 : arrowRight ? -16 : 16);
  if (p.icon) { const ix = p.arrow === null ? cx - w / 2 + 22 : arrowRight ? cx - w / 2 + 20 : cx + w / 2 - 20; drawIcon(g, ix, cy, p.icon); tx += p.arrow === null ? 14 : arrowRight ? 12 : -12; }
  c.add(g);
  const t1 = scene.add.text(tx, cy - (p.sub ? 9 : 0), p.title, { fontFamily: FONT, fontSize: '17px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5).setResolution(2);
  if (t1.width > w - 60) t1.setScale((w - 60) / t1.width);
  c.add(t1);
  if (p.sub) { const t2 = scene.add.text(tx, cy + 13, p.sub, { fontFamily: FONT, fontSize: '12px', color: '#e6f2ea' }).setOrigin(0.5).setResolution(2); if (t2.width > w - 56) t2.setScale((w - 56) / t2.width); c.add(t2); }
}

function makeSign(scene: Phaser.Scene, sg: Sign) {
  const seg = sg.seg, n = seg.lanes, half = (n * LW) / 2, sh = seg.shoulder ? LW : 0;
  const base = seg.path.at(sg.s, 0);
  const c = scene.add.container(base.x, base.y);
  c.setRotation(base.h + Math.PI / 2);
  c.setDepth(sg.kind === 'gantry' ? DEPTH.sign + seg.level * 3 : 16.6);
  if (sg.kind === 'gantry') {
    const g = scene.add.graphics();
    const barW = sg.panels.length > 1 ? Math.max(n * LW + sh + 36, sg.panels.length * 144 + 16) : n * LW + sh + 36;
    const bx = sh / 2 - barW / 2;
    g.fillStyle(0x0b0f18, 0.3); g.fillRect(bx + 6, -3 + 8, barW, 7);
    g.fillStyle(0x8d97ab, 1); g.fillRect(bx, -3, barW, 7);
    g.fillStyle(0x5c6478, 1); g.fillCircle(bx, 0, 7); g.fillCircle(bx + barW, 0, 7);
    c.add(g);
    const panels = sg.panels;
    if (panels.length === 1) {
      const p = panels[0];
      const x = p.side === 'R' ? half + sh - 70 : p.side === 'L' ? -half + 70 : 0;
      panel(scene, c, x, 0, p);
    } else {
      const pw = 140, off = sh / 2;
      const xs: Record<string, number> = { L: -pw - 4, C: 0, R: pw + 4 };
      for (const p of panels) panel(scene, c, xs[p.side] + off, 0, p, pw);
    }
  } else {
    const p = sg.panels[0];
    const x = sg.side > 0 ? half + sh + 100 : -half - 100;
    const g = scene.add.graphics();
    g.fillStyle(0x5c6478, 1); g.fillRect(x - 3, 0, 6, 34);
    c.add(g);
    panel(scene, c, x, 0, p);
  }
  return { obj: c, bb: { x0: base.x - 520, y0: base.y - 520, x1: base.x + 520, y1: base.y + 520 } };
}

function makeLimitSign(scene: Phaser.Scene, seg: Seg, s: number, limit: number) {
  const half = (seg.lanes * LW) / 2 + (seg.shoulder ? LW : 0);
  const p = seg.path.at(s, half + 34);
  const c = scene.add.container(p.x, p.y).setRotation(p.h + Math.PI / 2).setDepth(DEPTH.sign);
  const g = scene.add.graphics();
  g.fillStyle(0x0b0f18, 0.35); g.fillCircle(4, 5, 23);
  g.fillStyle(0xffffff, 1); g.fillCircle(0, 0, 23);
  g.lineStyle(6, 0xd83a32, 1); g.strokeCircle(0, 0, 19);
  c.add(g);
  c.add(scene.add.text(0, 1, String(limit), { fontFamily: FONT, fontSize: '22px', fontStyle: 'bold', color: '#1a1d26' }).setOrigin(0.5).setResolution(2));
  return { obj: c, bb: { x0: p.x - 200, y0: p.y - 200, x1: p.x + 200, y1: p.y + 200 } };
}

// ---------------------------------------------------------------- stations & scenery
export function drawStation(scene: Phaser.Scene, st: Station, R: number): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setDepth(DEPTH.station);
  g.setPosition(st.x, st.y);
  const ring = (r: number, w: number, col: number, a = 1) => { g.lineStyle(w, col, a); g.strokeCircle(0, 0, r); };
  g.fillStyle(0x000000, 0.35); g.fillCircle(40, 55, R);
  if (st.id === 'kestrel') {
    ring(R - 60, 110, 0x9aa6bd); ring(R - 60, 80, 0xd9e1ee); ring(R - 60, 6, 0x5ad8ff, 0.9);
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; g.fillStyle(i % 2 ? 0xbfcadb : 0xf0f4fa, 1); g.fillRoundedRect(Math.cos(a) * (R - 60) - 34, Math.sin(a) * (R - 60) - 34, 68, 68, 12); g.fillStyle(0x5ad8ff, 0.9); g.fillCircle(Math.cos(a) * (R - 60), Math.sin(a) * (R - 60), 9); }
    g.lineStyle(26, 0xaab4c8, 1);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.26; g.lineBetween(Math.cos(a) * 200, Math.sin(a) * 200, Math.cos(a) * (R - 110), Math.sin(a) * (R - 110)); }
    g.fillStyle(0xc5cfdf, 1); g.fillCircle(0, 0, 230); g.fillStyle(0xe9eef6, 1); g.fillCircle(0, 0, 180);
    g.fillStyle(0x2a3a66, 1); g.fillCircle(0, 0, 110); g.fillStyle(0x5ad8ff, 0.9); g.fillCircle(0, 0, 70); g.fillStyle(0xffffff, 1); g.fillCircle(0, 0, 30);
  } else if (st.id === 'terra') {
    g.fillStyle(0xaeb8cb, 1); g.fillCircle(0, 0, R); g.fillStyle(0xdfe6f0, 1); g.fillCircle(0, 0, R - 40);
    ring(R - 20, 5, 0x5ad8ff, 0.9);
    g.fillStyle(0x3e8f4e, 1); for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.5; g.fillCircle(Math.cos(a) * (R - 220), Math.sin(a) * (R - 220), 120); }
    for (let i = 0; i < 40; i++) { const a = rand(0, Math.PI * 2), r = rand(R * 0.3, R - 120); g.fillStyle(0x2f9e4e, 1); g.fillCircle(Math.cos(a) * r, Math.sin(a) * r, rand(12, 22)); }
    for (let i = 0; i < 9; i++) { const a = rand(0, Math.PI * 2), r = rand(0, R * 0.45); const x = Math.cos(a) * r, y = Math.sin(a) * r, s = rand(40, 90); g.fillStyle(0x7c8aa6, 1); g.fillRoundedRect(x - s / 2 + 10, y - s / 2 + 12, s, s, 10); g.fillStyle(0xf5f8fc, 1); g.fillRoundedRect(x - s / 2, y - s / 2, s, s, 10); g.fillStyle(0x5ad8ff, 1); g.fillCircle(x, y, s * 0.18); }
    g.fillStyle(0x283a66, 1); g.fillCircle(0, 0, 110); g.fillStyle(0x7ff0c0, 1); g.fillCircle(0, 0, 60);
  } else if (st.id === 'jove') {
    const hex = (r: number) => Array.from({ length: 6 }, (_, i) => new Phaser.Geom.Point(Math.cos((i / 6) * Math.PI * 2) * r, Math.sin((i / 6) * Math.PI * 2) * r));
    g.fillStyle(0x8f99ad, 1); g.fillPoints(hex(R), true); g.fillStyle(0xcfd6e2, 1); g.fillPoints(hex(R - 40), true);
    g.lineStyle(5, 0xffa45c, 0.9); g.strokePoints(hex(R - 20), true);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; const x = Math.cos(a) * (R * 0.55), y = Math.sin(a) * (R * 0.55); g.fillStyle(0x6f7a90, 1); g.fillCircle(x + 10, y + 12, 120); g.fillStyle(0xf2f4f8, 1); g.fillCircle(x, y, 115); g.fillStyle(0xffffff, 1); g.fillCircle(x - 35, y - 35, 40); g.fillStyle(0xffa45c, 1); g.fillCircle(x, y, 22); }
    g.fillStyle(0x3a2a22, 1); g.fillCircle(0, 0, 150); g.fillStyle(0xffa45c, 1); g.fillCircle(0, 0, 90); g.fillStyle(0xfff1d6, 1); g.fillCircle(0, 0, 40);
  } else if (st.id === 'vesta') {
    const pts: Phaser.Geom.Point[] = [];
    for (let i = 0; i < 26; i++) { const a = (i / 26) * Math.PI * 2, r = R * rand(0.88, 1.05); pts.push(new Phaser.Geom.Point(Math.cos(a) * r, Math.sin(a) * r)); }
    g.fillStyle(0x4a403d, 1); g.fillPoints(pts, true);
    g.fillStyle(0x6e625c, 1); g.fillPoints(pts.map((p) => new Phaser.Geom.Point(p.x * 0.88 - 20, p.y * 0.88 - 20)), true);
    for (let i = 0; i < 20; i++) { g.fillStyle(0x3d3431, 1); g.fillCircle(rand(-R, R) * 0.6, rand(-R, R) * 0.6, rand(20, 60)); }
    for (let i = 0; i < 7; i++) { const a = rand(0, Math.PI * 2), r = rand(0, R * 0.55); const x = Math.cos(a) * r, y = Math.sin(a) * r, s = rand(50, 110); g.fillStyle(0x8a94a8, 1); g.fillCircle(x, y, s); g.fillStyle(0xdbe9f6, 1); g.fillCircle(x, y, s - 12); g.fillStyle(0x9fe9ff, 0.8); g.fillCircle(x - s * 0.3, y - s * 0.3, s * 0.3); }
    g.lineStyle(14, 0xf2b134, 1);
    for (let i = 0; i < 4; i++) { const a = rand(0, Math.PI * 2), r = rand(R * 0.3, R * 0.7); const x = Math.cos(a) * r, y = Math.sin(a) * r; g.lineBetween(x, y, x + rand(-200, 200), y + rand(-200, 200)); g.fillStyle(0x2a2f3c, 1); g.fillRect(x - 25, y - 25, 50, 50); }
    g.fillStyle(0xd9a6ff, 0.9); g.fillCircle(0, 0, 50);
  } else if (st.id === 'harbor') {
    // trading hub: container yards around eight docking arms
    const oct = (r: number) => Array.from({ length: 8 }, (_, i) => new Phaser.Geom.Point(Math.cos((i / 8) * Math.PI * 2 + Math.PI / 8) * r, Math.sin((i / 8) * Math.PI * 2 + Math.PI / 8) * r));
    g.fillStyle(0x7d889f, 1); g.fillPoints(oct(R), true); g.fillStyle(0xcfd7e4, 1); g.fillPoints(oct(R - 40), true);
    g.lineStyle(5, 0xffd166, 0.9); g.strokePoints(oct(R - 18), true);
    for (let ring = 0; ring < 3; ring++) for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + ring * 0.1, rr = R * (0.42 + ring * 0.17);
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr, cols = [0xe8742f, 0x3d8be0, 0x3db089, 0xe1b33a, 0xd6453b];
      g.fillStyle(0x000000, 0.25); g.fillRect(x - 25 + 5, y - 11 + 6, 50, 22);
      g.fillStyle(cols[(i + ring) % 5], 1); g.fillRect(x - 25, y - 11, 50, 22);
      g.fillStyle(0xffffff, 0.2); g.fillRect(x - 25, y - 11, 50, 5);
    }
    g.lineStyle(26, 0xaab4c8, 1);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.lineBetween(Math.cos(a) * 190, Math.sin(a) * 190, Math.cos(a) * (R * 0.37), Math.sin(a) * (R * 0.37)); }
    g.fillStyle(0x56607a, 1); g.fillCircle(0, 0, 200); g.fillStyle(0xe9eef6, 1); g.fillCircle(0, 0, 170);
    g.fillStyle(0x2a3a66, 1); g.fillCircle(0, 0, 105); g.fillStyle(0xffd166, 1); g.fillCircle(0, 0, 62); g.fillStyle(0xffffff, 1); g.fillCircle(0, 0, 24);
  } else if (st.id === 'glacier') {
    // ice mining outpost: crystal-studded iceberg with glowing domes
    const pts: Phaser.Geom.Point[] = [];
    for (let i = 0; i < 30; i++) { const a = (i / 30) * Math.PI * 2, r = R * (i % 2 ? rand(0.9, 1.02) : rand(0.8, 0.92)); pts.push(new Phaser.Geom.Point(Math.cos(a) * r, Math.sin(a) * r)); }
    g.fillStyle(0x5f8fb0, 1); g.fillPoints(pts, true);
    g.fillStyle(0xcfeeff, 1); g.fillPoints(pts.map((p) => new Phaser.Geom.Point(p.x * 0.9 - 14, p.y * 0.9 - 14)), true);
    g.fillStyle(0xf4fcff, 1); g.fillPoints(pts.map((p) => new Phaser.Geom.Point(p.x * 0.7 - 24, p.y * 0.7 - 24)), true);
    for (let i = 0; i < 26; i++) { const a = rand(0, Math.PI * 2), r = rand(R * 0.2, R * 0.85), s = rand(30, 80); g.fillStyle(0x7ec8ee, 0.8); g.fillTriangle(Math.cos(a) * r, Math.sin(a) * r - s, Math.cos(a) * r - s * 0.3, Math.sin(a) * r + s * 0.4, Math.cos(a) * r + s * 0.3, Math.sin(a) * r + s * 0.4); }
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.3, r = R * 0.5, x = Math.cos(a) * r, y = Math.sin(a) * r; g.fillStyle(0x6f87a8, 1); g.fillCircle(x + 8, y + 10, 90); g.fillStyle(0xe8f4fb, 1); g.fillCircle(x, y, 85); g.fillStyle(0x9be7ff, 0.9); g.fillCircle(x - 20, y - 20, 36); g.fillStyle(0xffffff, 1); g.fillCircle(x - 30, y - 30, 12); }
    g.fillStyle(0x2a4a6a, 1); g.fillCircle(0, 0, 130); g.fillStyle(0x9be7ff, 1); g.fillCircle(0, 0, 80); g.fillStyle(0xffffff, 1); g.fillCircle(0, 0, 30);
  } else {
    // ember refinery: lava-cracked rock, towers and gas flares
    const pts: Phaser.Geom.Point[] = [];
    for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2, r = R * rand(0.9, 1.04); pts.push(new Phaser.Geom.Point(Math.cos(a) * r, Math.sin(a) * r)); }
    g.fillStyle(0x2a1d1b, 1); g.fillPoints(pts, true);
    g.fillStyle(0x4a3430, 1); g.fillPoints(pts.map((p) => new Phaser.Geom.Point(p.x * 0.9 - 14, p.y * 0.9 - 14)), true);
    g.lineStyle(10, 0xff7a2a, 0.9);
    for (let i = 0; i < 12; i++) { let x = rand(-R * 0.7, R * 0.7), y = rand(-R * 0.7, R * 0.7); for (let k = 0; k < 4; k++) { const nx = x + rand(-120, 120), ny = y + rand(-120, 120); g.lineBetween(x, y, nx, ny); x = nx; y = ny; } }
    g.lineStyle(18, 0x8a94a8, 1);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2, x = Math.cos(a) * R * 0.5, y = Math.sin(a) * R * 0.5; g.lineBetween(x, y, 0, 0); }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.2, r = R * (i % 2 ? 0.42 : 0.62), x = Math.cos(a) * r, y = Math.sin(a) * r;
      g.fillStyle(0x000000, 0.3); g.fillCircle(x + 8, y + 10, 52); g.fillStyle(0x9aa6bd, 1); g.fillCircle(x, y, 50); g.fillStyle(0xdfe6f0, 1); g.fillCircle(x, y, 36); g.fillStyle(0xff8a2a, 1); g.fillCircle(x, y, 16);
    }
    g.fillStyle(0x23293a, 1); g.fillCircle(0, 0, 150); g.fillStyle(0xff7a2a, 1); g.fillCircle(0, 0, 95); g.fillStyle(0xffe0a8, 1); g.fillCircle(0, 0, 44);
  }
  // hangar doors where roads enter
  for (const seg of [...st.arr, ...st.dep]) {
    const isArr = st.arr.includes(seg);
    const sEdge = edgeS(seg, st, R, isArr);
    const p = seg.path.at(sEdge, 0);
    const w = (seg.lanes * LW) / 2 + 22;
    const nx = -Math.sin(p.h), ny = Math.cos(p.h);
    g.lineStyle(16, 0x1c2232, 1); g.lineBetween(p.x - st.x - nx * w, p.y - st.y - ny * w, p.x - st.x + nx * w, p.y - st.y + ny * w);
    g.lineStyle(5, isArr ? 0x5ad8ff : 0x7ff0c0, 1); g.lineBetween(p.x - st.x - nx * w, p.y - st.y - ny * w, p.x - st.x + nx * w, p.y - st.y + ny * w);
  }
  return g;
}
export function edgeS(seg: Seg, st: Station, R0: number, isArr: boolean): number {
  const R = R0 * 0.85;
  if (isArr) { for (let s = seg.len; s > 0; s -= 10) { const p = seg.path.at(s); if (Math.hypot(p.x - st.x, p.y - st.y) > R) return s; } return seg.len - 200; }
  for (let s = 0; s < seg.len; s += 10) { const p = seg.path.at(s); if (Math.hypot(p.x - st.x, p.y - st.y) > R) return s; }
  return 200;
}
