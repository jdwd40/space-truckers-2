import Phaser from 'phaser';
import { Network, Station } from './network';
import { Pt, rand, pick } from './geom';
import { DEPTH, trailerTex } from './render';
import type { GlowLayer } from './glow';

/** Which existing stations carry a distinct outpost identity. */
export const OUTPOST_KIND: Record<string, OutpostKind | undefined> = { vesta: 'mining', harbor: 'truckstop', glacier: 'research', ember: 'scrapyard' };
export type OutpostKind = 'mining' | 'truckstop' | 'research' | 'scrapyard';

type G = Phaser.GameObjects.Graphics;
interface Spot extends Pt { a: number; r: number }
interface Crane { x: number; y: number; len: number; phase: number; speed: number; swing: number }
interface Light { x: number; y: number; col: number; r: number; flicker: number }
interface Drone { cx: number; cy: number; r: number; phase: number; speed: number; col: number }
interface Hull { x: number; y: number; w: number; h: number; a: number; col: number; open: boolean }
interface Layout {
  kind: OutpostKind; R: number; entries: number[];
  cranes: Crane[]; lights: Light[]; drones: Drone[]; welds: Pt[]; dust: Pt[];
  domes: Spot[]; antennas: Spot[]; dish: Spot | null; neon: { x: number; y: number; w: number; h: number; a: number; col: number }[];
  yards: Spot[]; silos: Spot[]; hulls: Hull[]; piles: Spot[]; rigs: { x: number; y: number; a: number; style: number; variant: number }[];
  canopies: Spot[]; diner: Spot | null; smelter: Spot | null; pit: Spot | null; building: Spot | null; conveyors: Spot[];
}

const P = (x: number, y: number) => new Phaser.Geom.Point(x, y);
function rrect(g: G, cx: number, cy: number, w: number, h: number, a: number, col: number, alpha = 1) {
  const c = Math.cos(a), s = Math.sin(a), hw = w / 2, hh = h / 2;
  g.fillStyle(col, alpha);
  g.fillPoints([P(cx - c * hw + s * hh, cy - s * hw - c * hh), P(cx + c * hw + s * hh, cy + s * hw - c * hh), P(cx + c * hw - s * hh, cy + s * hw + c * hh), P(cx - c * hw - s * hh, cy - s * hw + c * hh)], true);
}
function blob(g: G, n: number, cx: number, cy: number, r: number, col: number, jag = 0.3) {
  const pts: Phaser.Geom.Point[] = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, rr = r * (1 - jag + Math.random() * jag * 2); pts.push(P(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)); }
  g.fillStyle(col, 1); g.fillPoints(pts, true);
}

export class Outposts {
  layouts = new Map<string, Layout>();
  constructor(net: Network, R: number) {
    for (const st of net.stations) {
      const kind = OUTPOST_KIND[st.id];
      if (!kind) continue;
      const entries: number[] = [];
      for (const seg of [...st.arr, ...st.dep]) {
        const p = seg.path.at(st.arr.includes(seg) ? seg.len : 0);
        entries.push(Math.atan2(p.y - st.y, p.x - st.x));
      }
      this.layouts.set(st.id, this.layout(kind, R, entries));
    }
  }

  // ------------------------------------------------------------------ layout: keeps everything off the road corridors
  private layout(kind: OutpostKind, R: number, entries: number[]): Layout {
    const L: Layout = { kind, R, entries, cranes: [], lights: [], drones: [], welds: [], dust: [], domes: [], antennas: [], dish: null, neon: [], yards: [], silos: [], hulls: [], piles: [], rigs: [], canopies: [], diner: null, smelter: null, pit: null, building: null, conveyors: [] };
    const used: Spot[] = [];
    const clear = (a: number, r: number, margin: number) => {
      if (r < R * 0.55) return true;
      for (const e of entries) { let d = a - e; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; if (Math.cos(d) > 0 && Math.abs(Math.sin(d)) * r < margin) return false; }
      return true;
    };
    /** a free spot at radius r, at least `gap` from everything placed so far */
    const spot = (r: number, gap: number, margin = 340, prefer?: number): Spot => {
      let best: Spot | null = null;
      for (let t = 0; t < 60; t++) {
        const a = prefer !== undefined && t < 20 ? prefer + rand(-0.5, 0.5) : rand(0, Math.PI * 2);
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (!clear(a, r, margin)) continue;
        if (used.some((u) => Math.hypot(u.x - x, u.y - y) < gap)) continue;
        best = { x, y, a, r }; break;
      }
      const sp = best ?? { x: Math.cos(entries[0] + Math.PI) * r, y: Math.sin(entries[0] + Math.PI) * r, a: entries[0] + Math.PI, r };
      used.push(sp);
      return sp;
    };
    const warm = 0xffb347, cool = 0x8fe3ff, ember = 0xff7a2a;
    if (kind === 'mining') {
      L.pit = { x: 0, y: 0, a: 0, r: 0 };
      used.push({ x: 0, y: 0, a: 0, r: 0 });
      for (let i = 0; i < 3; i++) { const y = spot(780, 330, 360, (i / 3) * Math.PI * 2 + 0.4); L.yards.push(y); L.conveyors.push(y); }
      L.building = spot(640, 300, 360);
      for (let i = 0; i < 4; i++) L.silos.push(spot(560, 130, 300));
      for (let i = 0; i < 2; i++) { const c = spot(500, 220, 320); L.cranes.push({ x: c.x, y: c.y, len: 190, phase: rand(0, 6), speed: rand(0.12, 0.2), swing: rand(0.5, 0.9) }); }
      for (let i = 0; i < 6; i++) { const m = spot(880, 200, 300); L.lights.push({ x: m.x, y: m.y, col: warm, r: 60, flicker: 0 }); }
      for (let i = 0; i < 7; i++) { const a = rand(0, Math.PI * 2), r = rand(120, 380); L.dust.push({ x: Math.cos(a) * r, y: Math.sin(a) * r }); }
    } else if (kind === 'truckstop') {
      L.diner = spot(520, 380, 380);
      for (let i = 0; i < 2; i++) L.canopies.push(spot(560, 320, 380));
      // two parking rows of rigs facing the diner
      for (let row = 0; row < 2; row++) {
        const base = spot(800, 300, 400);
        for (let k = -2; k <= 2; k++) {
          const t = base.a + Math.PI / 2;
          const x = base.x + Math.cos(t) * k * 52, y = base.y + Math.sin(t) * k * 52;
          if (Math.hypot(x, y) > R - 160) continue;
          L.rigs.push({ x, y, a: base.a, style: Math.floor(rand(0, 5)), variant: Math.floor(rand(0, 6)) });
        }
      }
      for (let i = 0; i < 7; i++) { const m = spot(700 + (i % 2) * 220, 180, 300); L.lights.push({ x: m.x, y: m.y, col: warm, r: 90, flicker: 0.05 }); }
      const d = L.diner;
      L.neon.push({ x: d.x + Math.cos(d.a) * 190, y: d.y + Math.sin(d.a) * 190, w: 170, h: 46, a: d.a + Math.PI / 2, col: 0xff4fd8 });
      L.neon.push({ x: d.x, y: d.y, w: 360, h: 200, a: d.a, col: 0x5ad8ff });
    } else if (kind === 'research') {
      L.building = { x: 0, y: 0, a: 0, r: 0 };
      used.push(L.building);
      for (let i = 0; i < 3; i++) L.domes.push(spot(560, 260, 340, (i / 3) * Math.PI * 2 + 1));
      for (let i = 0; i < 4; i++) L.antennas.push(spot(760, 180, 300));
      L.dish = spot(640, 240, 340);
      for (let i = 0; i < 2; i++) L.yards.push(spot(850, 260, 320)); // solar arrays
      for (let i = 0; i < 4; i++) { const m = spot(900, 200, 300); L.lights.push({ x: m.x, y: m.y, col: cool, r: 70, flicker: 0 }); }
    } else {
      L.smelter = spot(520, 320, 360);
      const hullCols = [0x6b4a3a, 0x7f5a44, 0x5c4a46];
      for (let i = 0; i < 3; i++) { const h = spot(620 + i * 60, 330, 380); L.hulls.push({ x: h.x, y: h.y, w: i === 0 ? 460 : i === 1 ? 340 : 280, h: i === 0 ? 130 : 110, a: h.a + rand(-0.4, 0.4), col: hullCols[i], open: i === 1 }); }
      for (let i = 0; i < 6; i++) L.piles.push(spot(760, 170, 300));
      const c = spot(430, 200, 320); L.cranes.push({ x: c.x, y: c.y, len: 170, phase: rand(0, 6), speed: 0.15, swing: 0.8 });
      for (const h of L.hulls) { L.welds.push({ x: h.x + Math.cos(h.a) * h.w * 0.3, y: h.y + Math.sin(h.a) * h.w * 0.3 }); L.welds.push({ x: h.x - Math.cos(h.a) * h.w * 0.25 + Math.sin(h.a) * 40, y: h.y - Math.sin(h.a) * h.w * 0.25 - Math.cos(h.a) * 40 }); }
      for (let i = 0; i < 3; i++) { const h = L.hulls[i]; L.drones.push({ cx: h.x, cy: h.y, r: h.w * 0.45 + 40, phase: rand(0, 6), speed: rand(0.25, 0.4) * (i % 2 ? -1 : 1), col: [0xffd23c, 0x5ad8ff, 0xff7a2a][i] }); }
      for (let i = 0; i < 5; i++) { const m = spot(880, 200, 300); L.lights.push({ x: m.x, y: m.y, col: ember, r: 80, flicker: 0.08 }); }
    }
    return L;
  }

  // ------------------------------------------------------------------ static drawing (local coords around the station centre)
  draw(scene: Phaser.Scene, g: G, st: Station, extras: Phaser.GameObjects.GameObject[]) {
    const L = this.layouts.get(st.id)!;
    const R = L.R;
    const ring = (r: number, w: number, col: number, a = 1) => { g.lineStyle(w, col, a); g.strokeCircle(0, 0, r); };
    if (L.kind === 'mining') {
      blob(g, 26, 0, 0, R, 0x4a403d, 0.08);
      blob(g, 26, -18, -18, R * 0.9, 0x6e625c, 0.08);
      for (let i = 0; i < 16; i++) { g.fillStyle(0x3d3431, 1); g.fillCircle(rand(-R, R) * 0.65, rand(-R, R) * 0.65, rand(18, 50)); }
      // conveyors from the pit to the ore yards
      for (const c of L.conveyors) {
        g.lineStyle(26, 0x4d5468, 1); g.lineBetween(Math.cos(c.a) * 400, Math.sin(c.a) * 400, c.x, c.y);
        g.lineStyle(16, 0x7d889f, 1); g.lineBetween(Math.cos(c.a) * 400, Math.sin(c.a) * 400, c.x, c.y);
        g.fillStyle(0xd08a3a, 1); for (let t = 0.1; t < 0.95; t += 0.09) g.fillCircle(Math.cos(c.a) * 400 + (c.x - Math.cos(c.a) * 400) * t, Math.sin(c.a) * 400 + (c.y - Math.sin(c.a) * 400) * t, 4.5);
      }
      // the open pit with terraces and a spiral haul ramp
      g.fillStyle(0x2b2522, 1); g.fillCircle(0, 0, 420);
      for (const [r, col] of [[360, 0x5a4e48], [290, 0x4e433e], [220, 0x5a4e48], [150, 0x3c3330]] as [number, number][]) { g.lineStyle(14, col, 1); g.strokeCircle(0, 0, r); }
      g.fillStyle(0x16110f, 1); g.fillCircle(0, 0, 120);
      g.lineStyle(18, 0x8a7a6a, 1);
      for (let a = 0; a < Math.PI * 3.5; a += 0.12) { const r0 = 400 - a * 28, r1 = 400 - (a + 0.12) * 28; g.lineBetween(Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a + 0.12) * r1, Math.sin(a + 0.12) * r1); }
      g.fillStyle(0xff9a3c, 0.9); g.fillCircle(0, 0, 26);
      // ore container yards
      const cols = [0xd0683a, 0xb8502c, 0xe1b33a, 0x8a5a3a, 0xc9733f];
      for (const y of L.yards) {
        rrect(g, y.x, y.y, 230, 150, y.a, 0x3a3f4e);
        for (let i = -1; i <= 1; i++) for (let k = -1.5; k <= 1.5; k++) {
          const c = Math.cos(y.a), s = Math.sin(y.a);
          const cx = y.x + c * i * 60 + s * k * 32, cy = y.y + s * i * 60 - c * k * 32;
          rrect(g, cx + 4, cy + 5, 48, 22, y.a, 0x000000, 0.3);
          rrect(g, cx, cy, 48, 22, y.a, cols[((i + 1) * 4 + (k + 1.5)) % 5 | 0]);
          rrect(g, cx - c * 10, cy - s * 10, 3, 22, y.a, 0xffffff, 0.25);
        }
      }
      // processing plant
      const b = L.building!;
      rrect(g, b.x + 10, b.y + 12, 280, 150, b.a, 0x000000, 0.3);
      rrect(g, b.x, b.y, 280, 150, b.a, 0x56607a);
      rrect(g, b.x, b.y, 250, 120, b.a, 0x7d889f);
      for (let i = -2; i <= 2; i++) rrect(g, b.x + Math.cos(b.a) * i * 48, b.y + Math.sin(b.a) * i * 48, 14, 120, b.a, 0x4d5468);
      rrect(g, b.x, b.y, 250, 10, b.a, 0xffb347, 0.9);
      for (const s of L.silos) { g.fillStyle(0x000000, 0.3); g.fillCircle(s.x + 6, s.y + 8, 48); g.fillStyle(0x8a94a8, 1); g.fillCircle(s.x, s.y, 48); g.fillStyle(0xdfe6f0, 1); g.fillCircle(s.x - 8, s.y - 8, 32); g.fillStyle(0xd0683a, 1); g.fillCircle(s.x, s.y, 10); }
      for (const c of L.cranes) { g.fillStyle(0x000000, 0.3); g.fillRect(c.x - 30 + 6, c.y - 30 + 8, 60, 60); g.fillStyle(0x3a4050, 1); g.fillRect(c.x - 30, c.y - 30, 60, 60); g.fillStyle(0xffb347, 1); g.fillRect(c.x - 30, c.y - 30, 60, 8); g.fillStyle(0x6b7488, 1); g.fillCircle(c.x, c.y, 18); }
      for (const l of L.lights) { g.fillStyle(0x23293a, 1); g.fillCircle(l.x, l.y, 12); g.fillStyle(0xffd27a, 1); g.fillCircle(l.x, l.y, 6); }
      ring(R - 10, 6, 0xffb347, 0.6);
    } else if (L.kind === 'truckstop') {
      const oct = (r: number) => Array.from({ length: 8 }, (_, i) => P(Math.cos((i / 8) * Math.PI * 2 + Math.PI / 8) * r, Math.sin((i / 8) * Math.PI * 2 + Math.PI / 8) * r));
      g.fillStyle(0x7d889f, 1); g.fillPoints(oct(R), true); g.fillStyle(0x3a4153, 1); g.fillPoints(oct(R - 40), true);
      g.lineStyle(5, 0xffd166, 0.9); g.strokePoints(oct(R - 18), true);
      g.fillStyle(0x454c60, 1); g.fillCircle(0, 0, 640);
      // parking bays with markings
      for (const r of L.rigs) {
        const c = Math.cos(r.a), s = Math.sin(r.a);
        g.lineStyle(2.5, 0xffffff, 0.45); g.lineBetween(r.x - c * 50 + s * 24, r.y - s * 50 - c * 24, r.x + c * 50 + s * 24, r.y + s * 50 - c * 24);
      }
      // fuel canopies
      for (const c of L.canopies) {
        rrect(g, c.x + 6, c.y + 8, 300, 96, c.a, 0x000000, 0.3);
        rrect(g, c.x, c.y, 300, 96, c.a, 0xeaf2ff);
        rrect(g, c.x, c.y, 300, 14, c.a, 0x2f7de1);
        for (let i = -2; i <= 2; i++) { const px = c.x + Math.cos(c.a) * i * 58, py = c.y + Math.sin(c.a) * i * 58; g.fillStyle(0x2f7de1, 1); g.fillCircle(px, py, 8); g.fillStyle(0xffffff, 1); g.fillCircle(px, py, 3.5); }
      }
      // the diner
      const d = L.diner!;
      rrect(g, d.x + 10, d.y + 12, 360, 200, d.a, 0x000000, 0.35);
      rrect(g, d.x, d.y, 360, 200, d.a, 0xe8eef7);
      rrect(g, d.x, d.y, 360, 36, d.a, 0xff4fd8);
      rrect(g, d.x, d.y - 0, 330, 10, d.a, 0x5ad8ff);
      for (let i = -3; i <= 3; i++) {
        const c = Math.cos(d.a), s = Math.sin(d.a);
        rrect(g, d.x + c * i * 46 + s * 70, d.y + s * i * 46 - c * 70, 32, 26, d.a, 0x1b2c55);
        rrect(g, d.x + c * i * 46 + s * 70, d.y + s * i * 46 - c * 70, 26, 20, d.a, 0xffd27a, 0.85);
        rrect(g, d.x + c * i * 46 - s * 70, d.y + s * i * 46 + c * 70, 32, 26, d.a, 0x1b2c55);
        rrect(g, d.x + c * i * 46 - s * 70, d.y + s * i * 46 + c * 70, 26, 20, d.a, 0xffd27a, 0.85);
      }
      // sign pole and board
      const n = L.neon[0];
      g.lineStyle(10, 0x5c6478, 1); g.lineBetween(d.x, d.y, n.x, n.y);
      rrect(g, n.x + 4, n.y + 6, n.w + 12, n.h + 12, n.a, 0x000000, 0.35);
      rrect(g, n.x, n.y, n.w + 12, n.h + 12, n.a, 0x1a1030);
      const t = scene.add.text(st.x + n.x, st.y + n.y, 'HARBOR DINER', { fontFamily: '"Trebuchet MS", Arial', fontSize: '26px', fontStyle: 'bold', color: '#ff7fe6', stroke: '#ff4fd8', strokeThickness: 1 }).setOrigin(0.5).setRotation(n.a).setDepth(DEPTH.station + 0.2).setResolution(2);
      extras.push(t);
      const t2 = scene.add.text(st.x + n.x + Math.sin(n.a) * 22, st.y + n.y - Math.cos(n.a) * 22, 'FUEL · FOOD · OPEN 24H', { fontFamily: '"Trebuchet MS", Arial', fontSize: '11px', fontStyle: 'bold', color: '#9fe9ff' }).setOrigin(0.5).setRotation(n.a).setDepth(DEPTH.station + 0.2).setResolution(2);
      extras.push(t2);
      for (const r of L.rigs) {
        const key = 'cab' + r.variant;
        const sh = scene.add.image(st.x + r.x + 5, st.y + r.y + 7, key).setScale(0.5).setTint(0).setAlpha(0.3).setRotation(r.a).setDepth(DEPTH.station + 0.1);
        const im = scene.add.image(st.x + r.x, st.y + r.y, key).setScale(0.5).setRotation(r.a).setDepth(DEPTH.station + 0.15);
        const tk = trailerTex(scene, 46, r.style);
        const tx = st.x + r.x - Math.cos(r.a) * 38, ty = st.y + r.y - Math.sin(r.a) * 38;
        const tsh = scene.add.image(tx + 5, ty + 7, tk).setScale(0.5).setTint(0).setAlpha(0.3).setRotation(r.a).setDepth(DEPTH.station + 0.1);
        const tim = scene.add.image(tx, ty, tk).setScale(0.5).setRotation(r.a).setDepth(DEPTH.station + 0.15);
        extras.push(sh, im, tsh, tim);
      }
      for (const l of L.lights) { g.fillStyle(0x23293a, 1); g.fillCircle(l.x, l.y, 10); g.fillStyle(0xffd27a, 1); g.fillCircle(l.x, l.y, 5); }
      g.fillStyle(0x2a3a66, 1); g.fillCircle(0, 0, 150); g.fillStyle(0xffd166, 1); g.fillCircle(0, 0, 90); g.fillStyle(0xffffff, 1); g.fillCircle(0, 0, 34);
    } else if (L.kind === 'research') {
      const pts: Phaser.Geom.Point[] = [];
      for (let i = 0; i < 30; i++) { const a = (i / 30) * Math.PI * 2, r = R * (i % 2 ? rand(0.9, 1.02) : rand(0.8, 0.92)); pts.push(P(Math.cos(a) * r, Math.sin(a) * r)); }
      g.fillStyle(0x5f8fb0, 1); g.fillPoints(pts, true);
      g.fillStyle(0xcfeeff, 1); g.fillPoints(pts.map((p) => P(p.x * 0.9 - 14, p.y * 0.9 - 14)), true);
      g.fillStyle(0xf4fcff, 1); g.fillPoints(pts.map((p) => P(p.x * 0.7 - 24, p.y * 0.7 - 24)), true);
      for (let i = 0; i < 18; i++) { const a = rand(0, Math.PI * 2), r = rand(R * 0.75, R * 0.95), s = rand(24, 60); g.fillStyle(0x7ec8ee, 0.8); g.fillTriangle(Math.cos(a) * r, Math.sin(a) * r - s, Math.cos(a) * r - s * 0.3, Math.sin(a) * r + s * 0.4, Math.cos(a) * r + s * 0.3, Math.sin(a) * r + s * 0.4); }
      // corridors from the core to the domes, dish and arrays
      for (const d of [...L.domes, L.dish!, ...L.yards]) { g.lineStyle(30, 0x8fb8d6, 1); g.lineBetween(0, 0, d.x, d.y); g.lineStyle(20, 0xeaf6ff, 1); g.lineBetween(0, 0, d.x, d.y); }
      // modular core: hexagon with four wings
      const hex = (r: number) => Array.from({ length: 6 }, (_, i) => P(Math.cos((i / 6) * Math.PI * 2) * r, Math.sin((i / 6) * Math.PI * 2) * r));
      g.fillStyle(0x000000, 0.25); g.fillPoints(hex(190).map((p) => P(p.x + 10, p.y + 12)), true);
      g.fillStyle(0x8fb8d6, 1); g.fillPoints(hex(190), true); g.fillStyle(0xf8fdff, 1); g.fillPoints(hex(165), true);
      g.lineStyle(3, 0x8fe3ff, 0.8); g.strokePoints(hex(120), true);
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4, x = Math.cos(a) * 300, y = Math.sin(a) * 300; rrect(g, x + 8, y + 10, 160, 96, a, 0x000000, 0.25); rrect(g, x, y, 160, 96, a, 0x8fb8d6); rrect(g, x, y, 140, 76, a, 0xf8fdff); for (let k = -2; k <= 2; k++) rrect(g, x + Math.cos(a) * k * 26, y + Math.sin(a) * k * 26, 6, 60, a, 0x9fd8ff, 0.8); g.lineStyle(14, 0xeaf6ff, 1); g.lineBetween(0, 0, x, y); }
      g.fillStyle(0x2a4a6a, 1); g.fillCircle(0, 0, 62); g.fillStyle(0x9be7ff, 1); g.fillCircle(0, 0, 40); g.fillStyle(0xffffff, 1); g.fillCircle(0, 0, 16);
      // greenhouse domes
      for (const d of L.domes) {
        g.fillStyle(0x000000, 0.25); g.fillCircle(d.x + 8, d.y + 10, 100);
        g.fillStyle(0x8fb8d6, 1); g.fillCircle(d.x, d.y, 100); g.fillStyle(0x3e8f4e, 1); g.fillCircle(d.x, d.y, 88);
        for (let k = 0; k < 14; k++) { const x = d.x + rand(-55, 55), y = d.y + rand(-55, 55); g.fillStyle(0x1f5f33, 1); g.fillCircle(x + 3, y + 4, 13); g.fillStyle(0x3caa55, 1); g.fillCircle(x, y, 12); g.fillStyle(0x6fd17a, 1); g.fillCircle(x - 3, y - 3, 5); }
        g.lineStyle(3, 0xeaf6ff, 0.5); for (let k = 1; k < 4; k++) g.strokeCircle(d.x, d.y, 88 * k / 4);
        g.fillStyle(0xffffff, 0.35); g.fillEllipse(d.x - 30, d.y - 34, 50, 26);
      }
      // solar arrays
      for (const y of L.yards) { rrect(g, y.x, y.y, 200, 90, y.a, 0x1e3d7a); for (let k = -3; k <= 3; k++) rrect(g, y.x + Math.cos(y.a) * k * 26, y.y + Math.sin(y.a) * k * 26, 2.5, 90, y.a, 0x5ad8ff, 0.6); rrect(g, y.x, y.y, 200, 2.5, y.a, 0x5ad8ff, 0.6); }
      // dish base and antenna masts
      const ds = L.dish!;
      g.fillStyle(0x000000, 0.25); g.fillCircle(ds.x + 6, ds.y + 8, 72); g.fillStyle(0x8fb8d6, 1); g.fillCircle(ds.x, ds.y, 72); g.fillStyle(0xdfe6f0, 1); g.fillCircle(ds.x, ds.y, 56);
      for (const a of L.antennas) { g.fillStyle(0x4d5468, 1); g.fillCircle(a.x, a.y, 16); g.lineStyle(5, 0xdfe6f0, 1); g.lineBetween(a.x, a.y, a.x + Math.cos(a.a) * 70, a.y + Math.sin(a.a) * 70); g.lineStyle(3, 0xdfe6f0, 1); g.lineBetween(a.x + Math.cos(a.a) * 35 - Math.sin(a.a) * 18, a.y + Math.sin(a.a) * 35 + Math.cos(a.a) * 18, a.x + Math.cos(a.a) * 35 + Math.sin(a.a) * 18, a.y + Math.sin(a.a) * 35 - Math.cos(a.a) * 18); }
      for (const l of L.lights) { g.fillStyle(0x23293a, 1); g.fillCircle(l.x, l.y, 10); g.fillStyle(0xbff4ff, 1); g.fillCircle(l.x, l.y, 5); }
      ring(R - 12, 5, 0x9be7ff, 0.7);
    } else {
      blob(g, 28, 0, 0, R, 0x2a1d1b, 0.07);
      blob(g, 28, -14, -14, R * 0.9, 0x4a3430, 0.07);
      g.lineStyle(10, 0xff7a2a, 0.9);
      for (let i = 0; i < 10; i++) { let x = rand(-R * 0.7, R * 0.7), y = rand(-R * 0.7, R * 0.7); for (let k = 0; k < 4; k++) { const nx = x + rand(-120, 120), ny = y + rand(-120, 120); g.lineBetween(x, y, nx, ny); x = nx; y = ny; } }
      // salvage piles
      for (const p of L.piles) for (let k = 0; k < 14; k++) { const x = p.x + rand(-60, 60), y = p.y + rand(-50, 50); blob(g, 6, x, y, rand(10, 26), pick([0x7e746c, 0x9a8f86, 0x8a5a3a, 0x5c6478, 0xb0a296]), 0.4); }
      // repurposed hulls
      for (const h of L.hulls) {
        rrect(g, h.x + 10, h.y + 12, h.w, h.h, h.a, 0x000000, 0.35);
        const c = Math.cos(h.a), s = Math.sin(h.a);
        g.fillStyle(h.col, 1);
        g.fillPoints([P(h.x - c * h.w / 2 + s * h.h / 2, h.y - s * h.w / 2 - c * h.h / 2), P(h.x + c * h.w * 0.3 + s * h.h / 2, h.y + s * h.w * 0.3 - c * h.h / 2), P(h.x + c * h.w / 2, h.y + s * h.w / 2), P(h.x + c * h.w * 0.3 - s * h.h / 2, h.y + s * h.w * 0.3 + c * h.h / 2), P(h.x - c * h.w / 2 - s * h.h / 2, h.y - s * h.w / 2 + c * h.h / 2)], true);
        for (let k = -3; k <= 2; k++) rrect(g, h.x + c * k * (h.w / 7), h.y + s * k * (h.w / 7), 4, h.h - 10, h.a, 0x000000, 0.2);
        if (h.open) { rrect(g, h.x + c * h.w * 0.05, h.y + s * h.w * 0.05, h.w * 0.4, h.h * 0.55, h.a, 0x1a1210); rrect(g, h.x + c * h.w * 0.05, h.y + s * h.w * 0.05, h.w * 0.36, h.h * 0.2, h.a, 0x6b7488); }
        else for (let k = -2; k <= 2; k++) { rrect(g, h.x + c * k * 40 - s * 14, h.y + s * k * 40 + c * 14, 16, 12, h.a, 0x1b2c55); rrect(g, h.x + c * k * 40 - s * 14, h.y + s * k * 40 + c * 14, 12, 8, h.a, 0xffd27a, 0.9); }
        rrect(g, h.x - c * h.w * 0.1, h.y - s * h.w * 0.1, h.w * 0.5, 6, h.a, 0xd0683a, 0.8);
        g.fillStyle(0xffb347, 0.9); g.fillCircle(h.x + c * h.w / 2 - c * 8, h.y + s * h.w / 2 - s * 8, 5);
      }
      // smelter: furnace block and chimney
      const m = L.smelter!;
      rrect(g, m.x + 10, m.y + 12, 220, 130, m.a, 0x000000, 0.35);
      rrect(g, m.x, m.y, 220, 130, m.a, 0x4a3430); rrect(g, m.x, m.y, 190, 100, m.a, 0x6b4a3a);
      rrect(g, m.x, m.y, 190, 14, m.a, 0xff7a2a, 0.9);
      const cx = m.x + Math.cos(m.a) * 90, cy = m.y + Math.sin(m.a) * 90;
      g.fillStyle(0x000000, 0.3); g.fillCircle(cx + 6, cy + 8, 42); g.fillStyle(0x3a2a26, 1); g.fillCircle(cx, cy, 42); g.fillStyle(0x6b5d52, 1); g.fillCircle(cx, cy, 30); g.fillStyle(0x1a1210, 1); g.fillCircle(cx, cy, 18);
      for (const c of L.cranes) { g.fillStyle(0x3a4050, 1); g.fillRect(c.x - 26, c.y - 26, 52, 52); g.fillStyle(0xff7a2a, 1); g.fillRect(c.x - 26, c.y - 26, 52, 7); g.fillStyle(0x6b7488, 1); g.fillCircle(c.x, c.y, 16); }
      for (const l of L.lights) { g.fillStyle(0x23293a, 1); g.fillCircle(l.x, l.y, 10); g.fillStyle(0xffa060, 1); g.fillCircle(l.x, l.y, 5); }
      g.fillStyle(0x23293a, 1); g.fillCircle(0, 0, 130); g.fillStyle(0xff7a2a, 1); g.fillCircle(0, 0, 80); g.fillStyle(0xffe0a8, 1); g.fillCircle(0, 0, 36);
    }
  }

  // ------------------------------------------------------------------ per-frame animation (only for outposts in view)
  /** per-frame animation: g is the plain deco layer, fx an additive Graphics kept for lines, gl the pooled glow images */
  update(g: G, fx: G, gl: GlowLayer, net: Network, time: number, cx: number, cy: number, viewR: number) {
    for (const st of net.stations) {
      const L = this.layouts.get(st.id);
      if (!L || Math.hypot(st.x - cx, st.y - cy) > viewR + L.R + 200) continue;
      const X = st.x, Y = st.y;
      // crane arms swinging with a hook line
      for (const c of L.cranes) {
        const a = c.phase + Math.sin(time * c.speed + c.phase) * c.swing;
        const ex = X + c.x + Math.cos(a) * c.len, ey = Y + c.y + Math.sin(a) * c.len;
        g.lineStyle(9, 0x2b3140, 1); g.lineBetween(X + c.x + 4, Y + c.y + 6, ex + 4, ey + 6);
        g.lineStyle(8, L.kind === 'mining' ? 0xffb347 : 0xff7a2a, 1); g.lineBetween(X + c.x, Y + c.y, ex, ey);
        g.lineStyle(4, 0x2b3140, 1); g.lineBetween(X + c.x - Math.cos(a) * 50, Y + c.y - Math.sin(a) * 50, X + c.x, Y + c.y);
        const hx = X + c.x + Math.cos(a) * c.len * 0.72, hy = Y + c.y + Math.sin(a) * c.len * 0.72, drop = 18 + 10 * Math.sin(time * 0.7 + c.phase);
        g.lineStyle(2, 0xdfe6f0, 0.9); g.lineBetween(hx, hy, hx, hy + drop);
        g.fillStyle(L.kind === 'mining' ? 0xd0683a : 0x8a94a8, 1); g.fillRoundedRect(hx - 12, hy + drop, 24, 12, 3);
        g.fillStyle(0xff3b30, 0.9); g.fillCircle(ex, ey, 3);
      }
      // warm / cool floodlights
      for (const l of L.lights) {
        const k = l.flicker ? 1 - l.flicker * (Math.sin(time * 23 + l.x) > 0.6 ? 1 : 0) : 1;
        gl.soft(X + l.x, Y + l.y, l.r, l.col, 0.16 * k);
        gl.soft(X + l.x, Y + l.y, l.r * 0.35, l.col, 0.35 * k);
      }
      if (L.kind === 'mining') {
        for (let i = 0; i < L.dust.length; i++) {
          const d = L.dust[i], ph = (time * 0.18 + i * 0.37) % 1;
          gl.soft(X + d.x + ph * 30 + Math.sin(time + i) * 6, Y + d.y - ph * 24, 14 + ph * 34, 0xd8b890, 0.12 * (1 - ph));
        }
        gl.soft(X, Y, 60, 0xff9a3c, 0.25 + 0.1 * Math.sin(time * 2));
      } else if (L.kind === 'truckstop') {
        const n = L.neon[0];
        const on = Math.sin(time * 17) > -0.92 || Math.sin(time * 0.3) > 0.9;
        const c = Math.cos(n.a), s = Math.sin(n.a);
        gl.soft(X + n.x, Y + n.y, 120, 0xff4fd8, on ? 0.35 : 0.08);
        fx.lineStyle(3, 0xff7fe6, on ? 0.9 : 0.2);
        const hw = n.w / 2 + 2, hh = n.h / 2 + 2;
        const q = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({ x: X + n.x + c * x - s * y, y: Y + n.y + s * x + c * y }));
        for (let i = 0; i < 4; i++) fx.lineBetween(q[i].x, q[i].y, q[(i + 1) % 4].x, q[(i + 1) % 4].y);
        const d = L.neon[1];
        fx.lineStyle(2.5, 0x5ad8ff, 0.7 + 0.2 * Math.sin(time * 3));
        const c2 = Math.cos(d.a), s2 = Math.sin(d.a), w2 = d.w / 2 + 4, h2 = d.h / 2 + 4;
        const q2 = [[-w2, -h2], [w2, -h2], [w2, h2], [-w2, h2]].map(([x, y]) => ({ x: X + d.x + c2 * x - s2 * y, y: Y + d.y + s2 * x + c2 * y }));
        for (let i = 0; i < 4; i++) fx.lineBetween(q2[i].x, q2[i].y, q2[(i + 1) % 4].x, q2[(i + 1) % 4].y);
        // rotating beacon on the sign pole
        const ba = time * 1.6;
        gl.dot(X + n.x + Math.cos(ba) * 14, Y + n.y + Math.sin(ba) * 14, 4, 0xffd23c, 0.8);
        for (const cn of L.canopies) gl.soft(X + cn.x, Y + cn.y, 150, 0xeaf2ff, 0.12);
      } else if (L.kind === 'research') {
        const ds = L.dish!, a = time * 0.25 + ds.a, tilt = 0.55;
        const dx = X + ds.x, dy = Y + ds.y;
        g.fillStyle(0x000000, 0.25); g.fillEllipse(dx + 6 + Math.cos(a) * 8, dy + 8 + Math.sin(a) * 8, 110, 110 * tilt + 20);
        g.lineStyle(5, 0x8fb8d6, 1); g.lineBetween(dx, dy, dx + Math.cos(a) * 50, dy + Math.sin(a) * 50);
        g.fillStyle(0xf8fdff, 1); g.fillEllipse(dx + Math.cos(a) * 10, dy + Math.sin(a) * 10, 110, 70);
        g.fillStyle(0xbfe0f5, 1); g.fillEllipse(dx + Math.cos(a) * 10, dy + Math.sin(a) * 10, 80, 46);
        g.fillStyle(0x2a4a6a, 1); g.fillCircle(dx + Math.cos(a) * 44, dy + Math.sin(a) * 44, 7);
        gl.soft(dx + Math.cos(a) * 44, dy + Math.sin(a) * 44, 10, 0x9be7ff, 0.5 + 0.3 * Math.sin(time * 4));
        for (let i = 0; i < L.antennas.length; i++) {
          const an = L.antennas[i];
          if (Math.sin(time * 2.4 + i * 1.3) > 0.55) { const ax = X + an.x + Math.cos(an.a) * 70, ay = Y + an.y + Math.sin(an.a) * 70; gl.dot(ax, ay, 4, 0xff3b30, 0.9); gl.soft(ax, ay, 12, 0xff3b30, 0.3); }
        }
        for (let i = 0; i < L.domes.length; i++) { const d = L.domes[i]; gl.soft(X + d.x, Y + d.y, 110, 0x7fe08a, 0.1 + 0.06 * Math.sin(time * 1.3 + i)); }
        gl.soft(X, Y, 70, 0x9be7ff, 0.2 + 0.1 * Math.sin(time * 2));
      } else {
        // welding flashes and sparks
        for (let i = 0; i < L.welds.length; i++) {
          const w = L.welds[i], ph = (time * 0.6 + i * 0.41) % 1;
          if (ph < 0.22 && Math.random() < 0.85) {
            gl.dot(X + w.x, Y + w.y, 4, 0xbff4ff, 0.9);
            gl.soft(X + w.x, Y + w.y, 20 + Math.random() * 10, 0x7fdcff, 0.4);
            for (let k = 0; k < 5; k++) gl.dot(X + w.x + rand(-16, 16), Y + w.y + rand(-14, 10), rand(0.8, 2), 0xffd27a, 0.9);
          }
        }
        // maintenance drones circling the hulls
        for (const d of L.drones) {
          const a = time * d.speed + d.phase, bob = Math.sin(time * 2 + d.phase) * 6;
          const x = X + d.cx + Math.cos(a) * d.r, y = Y + d.cy + Math.sin(a) * d.r * 0.7 + bob;
          g.fillStyle(0x000000, 0.25); g.fillCircle(x + 8, y + 12, 7);
          g.fillStyle(0x2b3140, 1); g.fillCircle(x, y, 7); g.fillStyle(0x8a94a8, 1); g.fillCircle(x - 6, y - 5, 3); g.fillCircle(x + 6, y - 5, 3); g.fillCircle(x - 6, y + 5, 3); g.fillCircle(x + 6, y + 5, 3);
          gl.dot(x, y, 2.5, d.col, 0.9); gl.soft(x, y, 10, d.col, 0.25);
        }
        // smelter glow and embers
        const m = L.smelter!, cx2 = X + m.x + Math.cos(m.a) * 90, cy2 = Y + m.y + Math.sin(m.a) * 90;
        gl.soft(cx2, cy2, 18, 0xff7a2a, 0.45 + 0.15 * Math.sin(time * 6));
        gl.soft(cx2, cy2, 70, 0xff7a2a, 0.12);
        for (let k = 0; k < 5; k++) { const ph = (time * 0.5 + k * 0.2) % 1; gl.dot(cx2 + Math.sin(time * 3 + k) * 10 * ph, cy2 - ph * 60, 2 + ph * 3, 0xffb347, 0.6 * (1 - ph)); }
        gl.soft(X, Y, 60, 0xff7a2a, 0.25 + 0.1 * Math.sin(time * 2));
      }
    }
  }
}
