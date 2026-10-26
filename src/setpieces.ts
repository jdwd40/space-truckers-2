import Phaser from 'phaser';
import { rand, pick } from './geom';
import type { ZoneId } from './zones';

/**
 * Rare background set pieces far below the road: a space whale, a derelict cruiser, a ring station and the odd comet.
 * They live on slow parallax layers (a smaller factor `f` means further away), well under rocks, roads and vehicles,
 * and never touch gameplay. At most one big piece and one comet are alive at a time.
 */
export type PieceKind = 'whale' | 'cruiser' | 'ring' | 'comet';

interface Piece {
  kind: PieceKind; img: Phaser.GameObjects.Image; extras: Phaser.GameObjects.Image[];
  /** position in parallax space; the on-screen world position is px + cx * (1 - f) */
  px: number; py: number; vx: number; vy: number; f: number;
  rot: number; spin: number; age: number; life: number; alpha: number; size: number;
  /** base scale, so the whale's breathing has something to multiply */
  scale: number; fading: boolean; seed: number;
}

const KIND_ALPHA: Record<PieceKind, number> = { whale: 0.75, cruiser: 0.7, ring: 0.8, comet: 0.9 };
const KIND_DEPTH: Record<PieceKind, number> = { whale: 0.75, cruiser: 0.72, ring: 0.7, comet: 0.85 };
const KIND_F: Record<PieceKind, number> = { whale: 0.35, cruiser: 0.25, ring: 0.2, comet: 0.15 };
const ZONE_KINDS: Record<ZoneId, PieceKind[]> = {
  open: ['whale', 'cruiser'], belt: ['cruiser'], nebula: ['whale'], giant: ['ring', 'whale'], ice: ['cruiser', 'whale'], shipyard: ['ring'],
};
/** body-local glow spots along the whale's flank (texture is 512 x 220, facing +x, centred) */
const WHALE_SPOTS: [number, number][] = [[-150, -20], [-110, 10], [-70, -25], [-30, 15], [10, -20], [50, 20], [90, -15], [130, 10], [165, -5]];

export class SetPieces {
  private alive: Piece[] = [];
  private pool: Piece[] = [];
  private big: Piece | null = null;
  private comet: Piece | null = null;
  private bigT = rand(25, 60);
  private cometT = rand(60, 150);
  private lastKind: PieceKind | null = null;
  private lastZone: ZoneId = 'open';
  private lights: Phaser.GameObjects.Graphics;

  constructor(private scene: Phaser.Scene, private layer: Phaser.GameObjects.Layer) {
    this.lights = scene.add.graphics().setDepth(0.86).setBlendMode(Phaser.BlendModes.ADD);
    layer.add(this.lights);
  }

  /** bring a piece in from just outside the view, aimed across it; ignores the cooldowns */
  spawn(kind: PieceKind, cx: number, cy: number, viewR: number): Piece {
    const f = KIND_F[kind];
    let p = this.pool.find((q) => q.kind === kind);
    if (p) { this.pool.splice(this.pool.indexOf(p), 1); }
    else {
      const img = this.scene.add.image(0, 0, 'sp_' + kind).setDepth(KIND_DEPTH[kind]).setVisible(false);
      this.layer.add(img);
      const extras: Phaser.GameObjects.Image[] = [];
      if (kind === 'cruiser') for (let i = 0; i < 3; i++) { const d = this.scene.add.image(0, 0, 'sp_debris' + i).setDepth(KIND_DEPTH[kind] + 0.01).setVisible(false); this.layer.add(d); extras.push(d); }
      p = { kind, img, extras, px: 0, py: 0, vx: 0, vy: 0, f, rot: 0, spin: 0, age: 0, life: 0, alpha: 0, size: 0, scale: 1, fading: false, seed: 0 };
    }
    // world length each kind should have, from its texture width
    const len = kind === 'whale' ? 700 : kind === 'cruiser' ? 900 : kind === 'ring' ? 650 : 64;
    p.scale = len / p.img.width;
    p.size = len / 2;
    p.age = 0; p.alpha = 0; p.fading = false; p.seed = Math.random() * 100;
    p.life = kind === 'comet' ? 60 : 140;
    p.rot = rand(0, Math.PI * 2);
    p.spin = kind === 'cruiser' ? rand(-0.01, 0.01) : kind === 'ring' ? rand(0.04, 0.07) * (Math.random() < 0.5 ? -1 : 1) : 0;
    // spawn on a circle outside the view, heading through a point off-centre so it crosses an edge region
    const a = rand(0, Math.PI * 2), R = viewR + p.size + 200;
    const sx = Math.cos(a) * R, sy = Math.sin(a) * R;
    const ta = rand(0, Math.PI * 2), td = kind === 'comet' ? rand(0, 0.5) * viewR : rand(0.3, 0.6) * viewR;
    const h = Math.atan2(Math.sin(ta) * td - sy, Math.cos(ta) * td - sx);
    const v = kind === 'whale' ? rand(20, 30) : kind === 'cruiser' ? rand(6, 10) : kind === 'ring' ? rand(3, 6) : rand(350, 450);
    p.vx = Math.cos(h) * v; p.vy = Math.sin(h) * v;
    p.px = cx * f + sx; p.py = cy * f + sy;
    if (kind === 'whale' || kind === 'comet') p.rot = h;
    p.img.setScale(p.scale).setAlpha(0).setVisible(true);
    for (const e of p.extras) e.setAlpha(0).setVisible(true);
    this.alive.push(p);
    if (kind === 'comet') this.comet = p; else { this.big = p; this.lastKind = kind; }
    return p;
  }

  private release(p: Piece) {
    p.img.setVisible(false); for (const e of p.extras) e.setVisible(false);
    this.alive.splice(this.alive.indexOf(p), 1);
    this.pool.push(p);
    if (p === this.big) { this.big = null; this.bigT = rand(50, 110); }
    if (p === this.comet) { this.comet = null; this.cometT = rand(120, 240); }
  }

  update(dt: number, cx: number, cy: number, viewR: number, zoneId: ZoneId, driving: boolean) {
    // spawning: timers only run while driving; a new zone brings something soon if nothing is on screen
    if (zoneId !== this.lastZone) { this.lastZone = zoneId; if (!this.big) this.bigT = Math.min(this.bigT, rand(12, 25)); }
    if (driving) {
      this.bigT -= dt; this.cometT -= dt;
      if (!this.big && this.bigT <= 0) {
        const opts = ZONE_KINDS[zoneId].filter((k) => k !== this.lastKind);
        this.spawn(pick(opts.length ? opts : ZONE_KINDS[zoneId]), cx, cy, viewR);
      }
      if (!this.comet && this.cometT <= 0) this.spawn('comet', cx, cy, viewR);
    }
    const g = this.lights; g.clear();
    for (let i = this.alive.length - 1; i >= 0; i--) {
      const p = this.alive[i];
      p.age += dt;
      p.px += p.vx * dt; p.py += p.vy * dt;
      const x = p.px + cx * (1 - p.f), y = p.py + cy * (1 - p.f);
      const off = Math.hypot(x - cx, y - cy);
      if (!p.fading && (off > viewR + p.size + 600 || p.age > p.life)) p.fading = true;
      p.alpha = p.fading ? Math.max(0, p.alpha - dt / 3) : Math.min(1, p.alpha + dt / 3);
      if (p.fading && p.alpha <= 0) { this.release(p); continue; }
      const al = p.alpha * KIND_ALPHA[p.kind];
      p.rot += p.spin * dt;
      const im = p.img;
      im.setPosition(x, y).setAlpha(al);
      const vis = al > 0.001;
      if (im.visible !== vis) im.setVisible(vis);
      if (!vis) continue;
      if (p.kind === 'whale') {
        const h = Math.atan2(p.vy, p.vx);
        im.setRotation(h + 0.05 * Math.sin(p.age * 0.6)).setScale(p.scale, p.scale * (1 + 0.03 * Math.sin(p.age * 1.2)));
        const c = Math.cos(im.rotation), s = Math.sin(im.rotation);
        WHALE_SPOTS.forEach(([lx, ly], k) => {
          const a = 0.15 + 0.2 * (0.5 + 0.5 * Math.sin(p.age * 1.4 + k * 0.9 + p.seed));
          g.fillStyle(0x8fe3ff, a * p.alpha); g.fillCircle(x + (lx * c - ly * s) * p.scale, y + (lx * s + ly * c) * p.scale, 9 * p.scale);
        });
      } else if (p.kind === 'cruiser') {
        im.setRotation(p.rot);
        // debris drifting around the wreck; running lights blink slowly
        p.extras.forEach((e, k) => {
          const oa = p.age * (0.05 + k * 0.02) + k * 2.1 + p.seed, od = (220 + k * 90) * p.scale;
          e.setPosition(x + Math.cos(oa) * od, y + Math.sin(oa) * od).setRotation(p.age * (0.2 + k * 0.1)).setScale(p.scale).setAlpha(al);
        });
        const c = Math.cos(p.rot), s = Math.sin(p.rot);
        ([[-200, -20, 2.3, 0xff6a4a], [120, 30, 2.9, 0xffb04a], [230, -10, 2.6, 0xff6a4a]] as [number, number, number, number][]).forEach(([lx, ly, per, col], k) => {
          const on = Math.sin((p.age / per) * Math.PI * 2 + k * 1.7 + p.seed) > 0.75;
          if (!on) return;
          g.fillStyle(col, 0.55 * p.alpha); g.fillCircle(x + (lx * c - ly * s) * p.scale, y + (lx * s + ly * c) * p.scale, 7 * p.scale);
        });
      } else if (p.kind === 'ring') {
        im.setRotation(p.rot);
        const r = 160 * p.scale;
        for (let k = 0; k < 16; k++) {
          const a = p.rot + (k / 16) * Math.PI * 2;
          const tw = 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(p.age * 2.3 + k * 1.3 + p.seed));
          g.fillStyle(0xcfe8ff, tw * p.alpha); g.fillCircle(x + Math.cos(a) * r, y + Math.sin(a) * r, 5 * p.scale);
        }
        if (Math.sin(p.age * 2.5) > 0.6) { g.fillStyle(0xff8a5a, 0.6 * p.alpha); g.fillCircle(x, y, 9 * p.scale); }
      } else {
        // comet: the tail is drawn behind the head, opposite its velocity, shrinking and fading over ~600 units
        im.setRotation(0);
        const v = Math.hypot(p.vx, p.vy) || 1, dx = -p.vx / v, dy = -p.vy / v;
        const n = 12;
        for (let k = 1; k <= n; k++) {
          const t = k / n, d = t * 600;
          g.fillStyle(k % 2 ? 0xbfefff : 0xffffff, 0.45 * (1 - t) * (1 - t) * p.alpha);
          g.fillCircle(x + dx * d, y + dy * d, (14 - 11 * t) + 2 * Math.sin(p.age * 9 + k));
        }
      }
    }
  }
}
