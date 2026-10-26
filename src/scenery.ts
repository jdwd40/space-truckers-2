import Phaser from 'phaser';
import { Network } from './network';
import { Pt, rand, pick } from './geom';
import { Cullable } from './render';
import type { GlowLayer } from './glow';

/** Big roadside landmarks, one per route, so a journey has recognisable waypoints. */
export type LandmarkKind = 'cruiser' | 'shipyard' | 'array' | 'moon' | 'asteroids';
export interface LandmarkSpot { kind: LandmarkKind; x: number; y: number; h: number; size: number; road: string }

const PLACEMENTS: { kind: LandmarkKind; road: string; f: number; d: number; size: number }[] = [
  { kind: 'cruiser', road: 'Frost Line', f: 0.5, d: -1700, size: 850 },
  { kind: 'shipyard', road: 'Harbor Run', f: 0.45, d: 1800, size: 800 },
  { kind: 'array', road: 'Aurora Way', f: 0.55, d: -1600, size: 520 },
  { kind: 'moon', road: 'Ice Road', f: 0.5, d: -2500, size: 950 },
  { kind: 'asteroids', road: 'Cinder Road', f: 0.5, d: -1500, size: 620 },
  { kind: 'asteroids', road: 'Slag Highway', f: 0.5, d: 1550, size: 620 },
];

export function landmarkSpots(net: Network): LandmarkSpot[] {
  const out: LandmarkSpot[] = [];
  for (const pl of PLACEMENTS) {
    const rd = net.roads.find((r) => r.name === pl.road);
    if (!rd) continue;
    const p = rd.c.at(rd.c.len * pl.f);
    out.push({ kind: pl.kind, x: p.x - Math.sin(p.h) * pl.d, y: p.y + Math.cos(p.h) * pl.d, h: p.h, size: pl.size, road: pl.road });
  }
  return out;
}
/** distance from a landmark's edge to the nearest road centre line or station; negative means it overlaps */
export function landmarkClearance(net: Network, sp: LandmarkSpot): number {
  let d = Infinity;
  for (const seg of net.segs) {
    if (sp.x < seg.path.minX - sp.size - 400 || sp.x > seg.path.maxX + sp.size + 400 || sp.y < seg.path.minY - sp.size - 400 || sp.y > seg.path.maxY + sp.size + 400) continue;
    d = Math.min(d, seg.path.nearest(sp.x, sp.y).d - 240);
  }
  for (const st of net.stations) d = Math.min(d, Math.hypot(st.x - sp.x, st.y - sp.y) - 1400);
  return d - sp.size;
}

type G = Phaser.GameObjects.Graphics;
const P = (x: number, y: number) => new Phaser.Geom.Point(x, y);
function rrect(g: G, cx: number, cy: number, w: number, h: number, a: number, col: number, alpha = 1) {
  const c = Math.cos(a), s = Math.sin(a), hw = w / 2, hh = h / 2;
  g.fillStyle(col, alpha);
  g.fillPoints([P(cx - c * hw + s * hh, cy - s * hw - c * hh), P(cx + c * hw + s * hh, cy + s * hw - c * hh), P(cx + c * hw - s * hh, cy + s * hw + c * hh), P(cx - c * hw - s * hh, cy - s * hw + c * hh)], true);
}
const rot = (x: number, y: number, a: number) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });

interface Anim { sp: LandmarkSpot; lights: Pt[]; rocks: { x: number; y: number; r: number; col: number }[]; frag: { x: number; y: number; r: number; ph: number }[] }

export class Landmarks {
  anims: Anim[] = [];
  culls: Cullable[] = [];
  constructor(scene: Phaser.Scene, net: Network, layer: Phaser.GameObjects.Layer) {
    for (const sp of landmarkSpots(net)) {
      const cl = landmarkClearance(net, sp);
      if (cl < 0) { console.warn('landmark too close to a road', sp.kind, sp.road, cl | 0); continue; }
      const g = scene.add.graphics().setDepth(3).setPosition(sp.x, sp.y).setRotation(sp.h);
      const anim: Anim = { sp, lights: [], rocks: [], frag: [] };
      this.drawStatic(scene, g, sp, anim, layer);
      layer.add(g);
      const pad = sp.size + 200;
      this.culls.push({ obj: g, x0: sp.x - pad, y0: sp.y - pad, x1: sp.x + pad, y1: sp.y + pad });
      this.anims.push(anim);
    }
  }

  // local coords: x along the road direction, y across it
  private drawStatic(scene: Phaser.Scene, g: G, sp: LandmarkSpot, anim: Anim, layer: Phaser.GameObjects.Layer) {
    if (sp.kind === 'cruiser') {
      const hull = (x0: number, x1: number, nose: boolean, tail: boolean) => {
        const pts: Phaser.Geom.Point[] = [];
        pts.push(P(x0, -150)); if (nose) { pts.push(P(x1 - 160, -150), P(x1 + 40, -60), P(x1 + 60, 0), P(x1 + 40, 60), P(x1 - 160, 150)); } else { pts.push(P(x1, -150), P(x1 + 30, -40), P(x1 - 20, 20), P(x1 + 10, 150)); }
        pts.push(P(x0, 150)); if (tail) { pts.push(P(x0 - 60, 110), P(x0 - 60, -110)); } else { pts.push(P(x0 - 25, 70), P(x0 + 20, -10), P(x0 - 30, -150)); }
        g.fillStyle(0x000000, 0.3); g.fillPoints(pts.map((p) => P(p.x + 14, p.y + 18)), true);
        g.fillStyle(0x3a4050, 1); g.fillPoints(pts, true);
        g.fillStyle(0x4d5468, 1); g.fillPoints(pts.map((p) => P(p.x, p.y * 0.72 - 20)), true);
      };
      hull(-820, -120, false, true);
      hull(80, 760, true, false);
      // bridge tower, panels, scorch marks and dark windows
      rrect(g, 380, -10, 220, 90, 0, 0x56607a); rrect(g, 420, -10, 120, 50, 0, 0x7d889f);
      for (let x = -760; x < -180; x += 70) rrect(g, x, 60, 44, 30, 0, 0x2b3140, 0.6);
      for (let x = 140; x < 700; x += 70) rrect(g, x, -70, 44, 30, 0, 0x2b3140, 0.6);
      g.fillStyle(0x1a1210, 0.8); for (let i = 0; i < 12; i++) g.fillCircle(rand(-300, 300), rand(-120, 120), rand(14, 40));
      g.fillStyle(0xd6453b, 1); g.fillRect(-700, -30, 420, 14); g.fillRect(160, -30, 400, 14);
      g.fillStyle(0xffd27a, 0.9); for (let x = -740; x < -200; x += 26) if (Math.random() < 0.35) g.fillRect(x, 95, 10, 5);
      g.fillStyle(0xffd27a, 0.9); for (let x = 160; x < 680; x += 26) if (Math.random() < 0.35) g.fillRect(x, -100, 10, 5);
      // engine bells
      for (const y of [-80, 0, 80]) { g.fillStyle(0x23293a, 1); g.fillCircle(-860, y, 32); g.fillStyle(0x3a4050, 1); g.fillCircle(-860, y, 22); g.fillStyle(0x1b2c55, 1); g.fillCircle(-860, y, 12); }
      // debris drifting in the gap
      for (let i = 0; i < 16; i++) { const x = rand(-150, 110), y = rand(-220, 220); g.fillStyle(pick([0x4d5468, 0x3a4050, 0x6b7488]), 1); g.fillTriangle(x, y, x + rand(-30, 30), y + rand(-30, 30), x + rand(-30, 30), y + rand(-30, 30)); }
      anim.lights = [{ x: 470, y: -10 }, { x: -600, y: 0 }, { x: 700, y: 0 }];
    } else if (sp.kind === 'shipyard') {
      const W = 1500, H = 820;
      g.lineStyle(40, 0x2b3140, 0.5); g.strokeRect(-W / 2 + 14, -H / 2 + 18, W, H);
      g.lineStyle(26, 0x8a94a8, 1); g.strokeRect(-W / 2, -H / 2, W, H);
      g.lineStyle(10, 0x8a94a8, 1);
      for (let x = -W / 2 + 150; x < W / 2; x += 150) g.lineBetween(x, -H / 2, x, H / 2);
      g.lineBetween(-W / 2, 0, W / 2, 0);
      g.lineStyle(6, 0x5c6478, 0.9);
      for (let x = -W / 2; x < W / 2 - 10; x += 150) { g.lineBetween(x, -H / 2, x + 150, 0); g.lineBetween(x, H / 2, x + 150, 0); }
      // the hull under construction: finished stern, bare ribs forward
      g.fillStyle(0x000000, 0.3); g.fillRoundedRect(-560 + 14, -140 + 18, 620, 280, 60);
      g.fillStyle(0x56607a, 1); g.fillRoundedRect(-560, -140, 620, 280, 60);
      g.fillStyle(0x7d889f, 1); g.fillRoundedRect(-540, -110, 560, 220, 50);
      g.fillStyle(0x3d8be0, 1); g.fillRect(-500, -16, 480, 32);
      g.lineStyle(12, 0xaab4c8, 1);
      for (let x = 90; x < 600; x += 60) { const h = 140 * (1 - (x - 90) / 700); g.lineBetween(x, -h, x, h); }
      g.lineBetween(60, -140, 620, -40); g.lineBetween(60, 140, 620, 40);
      g.fillStyle(0xffd27a, 0.9); for (let x = -520; x < 40; x += 34) g.fillRect(x, -90, 14, 6);
      // dock lamps along the top beam
      for (let x = -W / 2; x <= W / 2; x += 250) { g.fillStyle(0x23293a, 1); g.fillCircle(x, -H / 2, 14); g.fillCircle(x, H / 2, 14); anim.lights.push({ x, y: -H / 2 }, { x, y: H / 2 }); }
    } else if (sp.kind === 'array') {
      g.fillStyle(0x000000, 0.3); g.fillCircle(14, 18, 330);
      g.fillStyle(0x2b3140, 1); g.fillCircle(0, 0, 330); g.fillStyle(0x3a4050, 1); g.fillCircle(0, 0, 290);
      g.lineStyle(4, 0x5ad8ff, 0.5); g.strokeCircle(0, 0, 310); g.strokeCircle(0, 0, 150);
      g.lineStyle(18, 0x8a94a8, 1);
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; g.lineBetween(0, 0, Math.cos(a) * 280, Math.sin(a) * 280); }
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4, x = Math.cos(a) * 230, y = Math.sin(a) * 230;
        g.fillStyle(0x000000, 0.3); g.fillEllipse(x + 8, y + 10, 120, 80);
        g.fillStyle(0xdfe6f0, 1); g.fillEllipse(x, y, 120, 80); g.fillStyle(0xaab4c8, 1); g.fillEllipse(x, y, 84, 54); g.fillStyle(0x2a3a66, 1); g.fillCircle(x + 20, y, 7);
      }
      // mast tips get blinking lights; the big dish is drawn each frame
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; const x = Math.cos(a) * 300, y = Math.sin(a) * 300; g.fillStyle(0x5c6478, 1); g.fillCircle(x, y, 12); anim.lights.push({ x, y }); }
      g.fillStyle(0x56607a, 1); g.fillCircle(0, 0, 90); g.fillStyle(0x8a94a8, 1); g.fillCircle(0, 0, 60);
    } else if (sp.kind === 'moon') {
      const R = 900;
      g.fillStyle(0x000000, 0.3); g.fillCircle(30, 40, R);
      // two main halves pulled apart along a jagged fault, with a glowing core showing between
      const fault: Pt[] = []; for (let i = 0; i <= 12; i++) fault.push({ x: -R + (i / 12) * 2 * R, y: Math.sin(i * 1.7) * 90 + (i % 2 ? 60 : -60) });
      const half = (side: number) => {
        const pts: Phaser.Geom.Point[] = [];
        for (let i = 0; i <= 12; i++) pts.push(P(fault[i].x, fault[i].y + side * 70));
        for (let k = 0; k <= 20; k++) { const a = side > 0 ? (k / 20) * Math.PI : Math.PI + (k / 20) * Math.PI; pts.push(P(Math.cos(a) * R, Math.sin(a) * R + side * 70)); }
        g.fillStyle(0x6e6f7c, 1); g.fillPoints(pts, true);
        g.fillStyle(0x8a8c99, 1); g.fillPoints(pts.map((p) => P(p.x * 0.9 - 20, side > 0 ? p.y * 0.92 + 20 : p.y * 0.92 - 10)), true);
      };
      g.fillStyle(0xff9a3c, 0.9); g.fillPoints(fault.map((p) => P(p.x, p.y - 60)).concat(fault.slice().reverse().map((p) => P(p.x, p.y + 60))), true);
      half(-1); half(1);
      for (let i = 0; i < 40; i++) { const a = rand(0, Math.PI * 2), r = rand(100, R - 80); const x = Math.cos(a) * r, y = Math.sin(a) * r; if (Math.abs(y) < 160) continue; g.fillStyle(0x5a5b68, 1); g.fillCircle(x, y, rand(14, 60)); g.fillStyle(0x9c9eab, 0.8); g.fillCircle(x - 6, y - 6, rand(6, 24)); }
      // loose fragments drifting away from the fault
      for (let i = 0; i < 10; i++) { const x = rand(-R * 0.9, R * 0.9), y = (Math.random() < 0.5 ? -1 : 1) * rand(R + 60, R + 260), r = rand(22, 60); anim.frag.push({ x, y, r, ph: rand(0, 6) }); }
      for (const f of anim.frag) { g.fillStyle(0x6e6f7c, 1); g.fillTriangle(f.x - f.r, f.y + f.r * 0.6, f.x + f.r * 0.9, f.y + f.r * 0.3, f.x + f.r * 0.1, f.y - f.r); g.fillStyle(0x8a8c99, 1); g.fillTriangle(f.x - f.r * 0.6, f.y + f.r * 0.3, f.x + f.r * 0.5, f.y + f.r * 0.1, f.x, f.y - f.r * 0.6); }
    } else {
      // illuminated asteroid formation: a ring of big rocks with neon beacons and glowing crystal veins
      const n = 9;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rand(-0.2, 0.2), r = rand(300, 520);
        const x = Math.cos(a) * r, y = Math.sin(a) * r, sc = rand(2.6, 4.4);
        const w = rot(x, y, sp.h);
        const im = scene.add.image(sp.x + w.x, sp.y + w.y, 'rock' + Math.floor(Math.random() * 6)).setScale(sc).setRotation(rand(0, 6)).setDepth(2.5);
        layer.add(im);
        this.culls.push({ obj: im, x0: sp.x + w.x - 200, y0: sp.y + w.y - 200, x1: sp.x + w.x + 200, y1: sp.y + w.y + 200 });
        anim.rocks.push({ x, y, r: 60 * sc, col: i % 2 ? 0x5ad8ff : 0xff4fd8 });
      }
      g.fillStyle(0x000000, 0.3); g.fillCircle(10, 14, 110);
      g.fillStyle(0x2b3140, 1); g.fillCircle(0, 0, 110); g.fillStyle(0x56607a, 1); g.fillCircle(0, 0, 80);
      g.lineStyle(4, 0x5ad8ff, 0.6); g.strokeCircle(0, 0, 95);
      g.fillStyle(0xdfe6f0, 1); g.fillCircle(0, 0, 26);
      anim.lights.push({ x: 0, y: 0 });
    }
  }

  /** g is the plain landmark layer, fx an additive Graphics kept for lines, gl the pooled glow images */
  update(g: G, fx: G, gl: GlowLayer, time: number, cx: number, cy: number, viewR: number) {
    for (const an of this.anims) {
      const sp = an.sp;
      if (Math.hypot(sp.x - cx, sp.y - cy) > viewR + sp.size + 300) continue;
      const W = (x: number, y: number) => { const r = rot(x, y, sp.h); return { x: sp.x + r.x, y: sp.y + r.y }; };
      if (sp.kind === 'cruiser') {
        an.lights.forEach((l, i) => { const on = Math.sin(time * (1.7 + i * 0.6) + i * 2) > (i === 0 ? 0.2 : 0.75); if (!on) return; const p = W(l.x, l.y); const col = i === 0 ? 0xff3b30 : 0xffd27a; gl.dot(p.x, p.y, 4, col, 0.9); gl.soft(p.x, p.y, 16, col, 0.25); });
        const e = W(-880, 0); gl.soft(e.x, e.y, 120, 0x4fb8ff, 0.06 + 0.04 * Math.sin(time * 0.8));
      } else if (sp.kind === 'shipyard') {
        an.lights.forEach((l, i) => { const on = Math.floor(time * 2 + i) % 3 === 0; const p = W(l.x, l.y); gl.dot(p.x, p.y, on ? 5 : 3.5, on ? 0xffffff : 0xffb020, on ? 0.9 : 0.5); if (on) gl.soft(p.x, p.y, 18, 0xffffff, 0.2); });
        // travelling gantry crane across the frame
        const gx = Math.sin(time * 0.18) * 600;
        const a = W(gx, -410), b = W(gx, 410);
        g.lineStyle(16, 0x2b3140, 0.5); g.lineBetween(a.x + 10, a.y + 14, b.x + 10, b.y + 14);
        g.lineStyle(14, 0xffb347, 1); g.lineBetween(a.x, a.y, b.x, b.y);
        const t = W(gx, Math.sin(time * 0.5) * 200); g.fillStyle(0x23293a, 1); g.fillRect(t.x - 16, t.y - 16, 32, 32); gl.soft(t.x, t.y, 8, 0xffb347, 0.6);
        if (Math.sin(time * 7) > 0.8 && Math.random() < 0.7) { const w = W(gx + rand(-40, 40), rand(-100, 100)); gl.dot(w.x, w.y, 5, 0xbff4ff, 0.9); gl.soft(w.x, w.y, 30, 0x7fdcff, 0.35); }
      } else if (sp.kind === 'array') {
        const a = time * 0.2 + sp.h;
        g.fillStyle(0x000000, 0.3); g.fillEllipse(sp.x + 10 + Math.cos(a) * 20, sp.y + 14 + Math.sin(a) * 20, 240, 160);
        g.lineStyle(10, 0x8a94a8, 1); g.lineBetween(sp.x, sp.y, sp.x + Math.cos(a) * 110, sp.y + Math.sin(a) * 110);
        g.fillStyle(0xf0f4fa, 1); g.fillEllipse(sp.x + Math.cos(a) * 20, sp.y + Math.sin(a) * 20, 240, 160);
        g.fillStyle(0xbfcadb, 1); g.fillEllipse(sp.x + Math.cos(a) * 20, sp.y + Math.sin(a) * 20, 180, 110);
        g.lineStyle(3, 0x8a94a8, 0.8); for (let k = 1; k < 4; k++) g.strokeEllipse(sp.x + Math.cos(a) * 20, sp.y + Math.sin(a) * 20, 240 * k / 4, 160 * k / 4);
        g.fillStyle(0x2a3a66, 1); g.fillCircle(sp.x + Math.cos(a) * 100, sp.y + Math.sin(a) * 100, 12);
        gl.soft(sp.x + Math.cos(a) * 100, sp.y + Math.sin(a) * 100, 14, 0x5ad8ff, 0.5 + 0.3 * Math.sin(time * 5));
        an.lights.forEach((l, i) => { if (Math.sin(time * 2.2 + i * 1.6) < 0.5) return; const p = W(l.x, l.y); gl.dot(p.x, p.y, 4, 0xff3b30, 0.9); gl.soft(p.x, p.y, 14, 0xff3b30, 0.3); });
        gl.soft(sp.x, sp.y, 330, 0x5ad8ff, 0.08 + 0.04 * Math.sin(time * 1.5));
      } else if (sp.kind === 'moon') {
        const c = W(0, 0);
        gl.softEllipse(c.x, c.y, 950, 180, sp.h, 0xff9a3c, 0.12 + 0.08 * Math.sin(time * 1.1));
        for (const f of an.frag) { const p = W(f.x + Math.sin(time * 0.3 + f.ph) * 12, f.y + Math.cos(time * 0.25 + f.ph) * 10); gl.soft(p.x, p.y, f.r * 0.8, 0xff9a3c, 0.12); }
      } else {
        an.rocks.forEach((r, i) => { const p = W(r.x, r.y); const k = 0.5 + 0.5 * Math.sin(time * 1.4 + i * 0.9); gl.soft(p.x, p.y, r.r * 0.9, r.col, 0.08 + 0.1 * k); gl.dot(p.x + r.r * 0.3, p.y - r.r * 0.2, 4, r.col, 0.7 + 0.3 * k); });
        gl.dot(sp.x, sp.y, 12, 0x5ad8ff, 0.5 + 0.4 * Math.sin(time * 3)); gl.soft(sp.x, sp.y, 70, 0x5ad8ff, 0.15);
      }
    }
  }
}
