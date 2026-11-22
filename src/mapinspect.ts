import Phaser from 'phaser';
import { dist, type Inspection, type NextExit } from './network';
import type { Pt } from './geom';
import { SPEEDS } from './speeds';
import { KMH } from './state';
import type { SectorMapScene } from './sectormap';

const FONT = '"Trebuchet MS", "Segoe UI", Arial, sans-serif';
/** how far from a tap or the mouse to look for something to inspect, in screen pixels */
const TAP_PX = 22, HOVER_PX = 12;

/**
 * A button on the inspection card, offered for the point that was tapped and what is there (a waypoint, later). Push
 * one onto `MapInspector.actions`; `when` decides whether it shows for this tap, `run` does it and returns whether the
 * card should close.
 */
export interface MapAction { label: string; when?: (at: Pt, info: Inspection | null) => boolean; run: (at: Pt, info: Inspection | null) => boolean | void }

/** the card's title, a short line under it and the details, for what Network.inspect found */
export function describe(info: Inspection): { title: string; sub: string; lines: string[] } {
  if (info.kind === 'road') {
    const limit = `Posted limit ${info.limit} · ${Math.round(SPEEDS[info.limit] * KMH)} km/h`;
    const n = info.cameras.length;
    return {
      title: info.carriageway, sub: info.towards ? `towards ${info.towards}` : info.road === info.carriageway ? 'Road' : info.road,
      lines: [limit, n ? `${n} camera${n === 1 ? '' : 's'} on this carriageway` : 'No cameras on this carriageway'],
    };
  }
  if (info.kind === 'facility') {
    const what = info.facility === 'fuel-repair' ? 'Fuel & Repair' : info.facility === 'fuel' ? 'Fuel stop' : 'Lay-by';
    return { title: info.name, sub: what, lines: info.services };
  }
  const where = `${info.carriageway}${info.towards ? ` towards ${info.towards}` : ''}`;
  const title = info.kind === 'roadworks' ? 'Roadworks' : info.incident === 'accident' ? 'Accident' : 'Breakdown';
  return { title, sub: where, lines: [info.status, `${info.open.length} of ${info.lanes} lanes open`] };
}

/**
 * Inspection on the sector map: tap (or hover with a mouse) to see what is under the point, from Network.inspect, on a
 * card along the bottom of the screen. Lane closures are marked while they last, and the next exit the player can take
 * on their carriageway is highlighted. Other features add buttons to the card through `actions`.
 */
export class MapInspector {
  /** extra buttons on the card (a waypoint action, for instance) */
  actions: MapAction[] = [];
  /** what a tap picked, kept until the next tap; the mouse's hover shows when nothing is picked */
  picked: { at: Pt; info: Inspection | null } | null = null;
  hover: Inspection | null = null;
  private card: Phaser.GameObjects.Container | null = null;
  private cardBox: { x0: number; y0: number; x1: number; y1: number } | null = null;

  constructor(private map: SectorMapScene) {
    map.taps.push((at, view) => this.tap(at, TAP_PX / view.zoom));
    map.hovers.push((at, view) => this.hoverAt(at, HOVER_PX / view.zoom));
    map.blockers.push((x, y) => !!this.cardBox && x >= this.cardBox.x0 && x <= this.cardBox.x1 && y >= this.cardBox.y0 && y <= this.cardBox.y1);
    map.overlays.push((g, _v, px) => this.drawMarks(g, px));
    map.layouts.push(() => this.refresh());
  }

  /** the next exit the player can still take on the carriageway they are on */
  nextExit(): NextExit | null {
    const p = this.map.world.player;
    if (!p?.seg) return null;
    const side = p.lane >= p.seg.lanes ? 1 : p.lane < 0 ? -1 : 0;
    return this.map.world.net.nextExit(p.seg, p.s, side);
  }

  tap(at: Pt, radius: number) {
    const info = this.map.world.net.inspect(at.x, at.y, radius);
    // a tap on empty map clears the card unless something else (a waypoint) has a use for the point
    this.picked = info || this.actions.some((a) => !a.when || a.when(at, null)) ? { at, info } : null;
    this.hover = null;
    this.render();
  }

  private hoverAt(at: Pt, radius: number) {
    if (this.picked) return;
    const info = this.map.world.net.inspect(at.x, at.y, radius);
    if (same(info, this.hover)) return;
    this.hover = info;
    this.render();
  }

  close() { this.picked = null; this.hover = null; this.render(); }

  /** redraw the map and the card after the selection changed or the screen was resized */
  render() {
    this.refresh();
    this.map.redraw();
  }

  // ----------------------------------------------------------- world-space marks
  private drawMarks(g: Phaser.GameObjects.Graphics, px: number) {
    const net = this.map.world.net;
    // the thing on the card, outlined
    const shown = this.picked?.info ?? this.hover;
    if (shown) {
      g.lineStyle(Math.max(40, px * 3), 0xffffff, 0.9);
      if (shown.kind === 'road') {
        for (const s of net.carriageway(shown.seg)) g.strokePoints(s.path.pts(0, s.len, 0, Math.max(40, px * 6)) as Phaser.Types.Math.Vector2Like[]);
        // and its cameras, as police-blue squares
        const r = Math.max(110, px * 7);
        for (const cam of shown.cameras) {
          g.fillStyle(0xffffff, 1); g.fillRect(cam.x - r * 1.3, cam.y - r * 1.3, r * 2.6, r * 2.6);
          g.fillStyle(0x283a8f, 1); g.fillRect(cam.x - r, cam.y - r, r * 2, r * 2);
          g.fillStyle(0xffffff, 1); g.fillCircle(cam.x, cam.y, r * 0.45);
        }
        g.lineStyle(Math.max(40, px * 3), 0xffffff, 0.9);
      } else if (shown.kind === 'facility') g.strokeCircle(shown.x, shown.y, Math.max(260, px * 13));
    }
    if (this.picked && !this.picked.info) {
      g.lineStyle(Math.max(30, px * 2.5), 0xffffff, 0.9); g.strokeCircle(this.picked.at.x, this.picked.at.y, Math.max(120, px * 7));
    }
    // the next exit on the player's carriageway: its slip road in green and a ring where it leaves
    const ex = this.nextExit();
    if (ex) {
      const ramp = ex.trans.to;
      g.lineStyle(Math.max(50, px * 4), 0x3ee07a, 1);
      g.strokePoints(ramp.path.pts(0, Math.min(ramp.len, 1600), 0, Math.max(40, px * 6)) as Phaser.Types.Math.Vector2Like[]);
      const r = Math.max(160, px * 10);
      g.fillStyle(0x0a1128, 0.9); g.fillCircle(ex.x, ex.y, r);
      g.lineStyle(Math.max(40, px * 3), 0x3ee07a, 1); g.strokeCircle(ex.x, ex.y, r);
      g.fillStyle(0x3ee07a, 1); g.fillCircle(ex.x, ex.y, r * 0.4);
    }
    // lane closures: the closed stretch in amber or red, and a marker on it
    for (const c of net.closures()) {
      const col = c.kind === 'roadworks' ? 0xffb020 : 0xff3b30;
      g.lineStyle(Math.max(60, px * 4), col, 0.85);
      for (const e of c.extent) g.strokePoints(e.seg.path.pts(e.s0, e.s1, 0, Math.max(20, px * 4)) as Phaser.Types.Math.Vector2Like[]);
      const r = Math.max(220, px * 11), sel = !!shown && shown.kind === c.kind && shown.x === c.x && shown.y === c.y;
      if (c.kind === 'roadworks') {
        g.fillStyle(0x0a1128, 1); g.fillPoints(diamond(c.x, c.y, r * 1.3), true);
        g.fillStyle(col, 1); g.fillPoints(diamond(c.x, c.y, r), true);
        g.fillStyle(0x0a1128, 1); g.fillRect(c.x - r * 0.45, c.y - r * 0.1, r * 0.9, r * 0.2);
      } else {
        g.fillStyle(0x0a1128, 1); g.fillPoints(triangle(c.x, c.y, r * 1.35), true);
        g.fillStyle(col, 1); g.fillPoints(triangle(c.x, c.y, r), true);
        g.fillStyle(0xffffff, 1); g.fillRect(c.x - r * 0.09, c.y - r * 0.45, r * 0.18, r * 0.5); g.fillCircle(c.x, c.y + r * 0.3, r * 0.11);
      }
      if (sel) { g.lineStyle(Math.max(30, px * 2.5), 0xffffff, 1); g.strokeCircle(c.x, c.y, r * 1.7); }
    }
  }

  // ----------------------------------------------------------- the card
  /** draw the card for what is picked or hovered, and the next-exit pill */
  refresh() {
    this.card?.destroy(true); this.card = null; this.cardBox = null;
    const m = this.map, u = m.u, W = m.scale.width, H = m.scale.height;
    const info = this.picked ? this.picked.info : this.hover;
    const ex = this.nextExit();
    const c = this.card = m.add.container(0, 0); m.chrome.add(c);
    const res = Math.min(2, window.devicePixelRatio || 1);
    const txt = (x: number, y: number, s: string, size: number, color: string, ox = 0, bold = true) =>
      m.add.text(x, y, s, { fontFamily: FONT, fontSize: `${Math.round(size * u)}px`, fontStyle: bold ? 'bold' : 'normal', color, wordWrap: { width: W - 60 * u } }).setOrigin(ox, 0).setResolution(res);
    // the next exit, in a pill under the bar
    if (ex) {
      const t = txt(0, 0, `Next exit · ${ex.label}${ex.kind === 'uturn' ? ' (turn back)' : ''} · ${dist(Math.max(0, ex.d))}`, 14, '#bff7d2');
      const pw = t.width + 24 * u, ph = t.height + 12 * u, py = m.insetTop + 10 * u, pxl = 12 * u;
      const g = m.add.graphics();
      g.fillStyle(0x0d2a1c, 0.92); g.fillRoundedRect(pxl, py, pw, ph, ph / 2);
      g.lineStyle(2 * u, 0x3ee07a, 1); g.strokeRoundedRect(pxl, py, pw, ph, ph / 2);
      t.setPosition(pxl + 12 * u, py + 6 * u);
      c.add(g); c.add(t);
    }
    const picked = this.picked;
    if (!info && !picked) return;
    const d = info ? describe(info) : { title: 'Map point', sub: '', lines: [] as string[] };
    const actions = picked ? this.actions.filter((a) => !a.when || a.when(picked.at, picked.info)) : [];
    // bottom right on a wide screen (the route comparison has the bottom left); on a narrow one at the top, under the
    // next-exit pill, as the route comparison runs along the bottom
    // (the two cards are 440u and 400u wide with 12u margins: below that, stack this one at the top as on a narrow screen)
    const narrow = W < 640 || W < 876 * u, cw = narrow ? W - 24 * u : Math.min(W - 24 * u, 400 * u), x0 = W - cw - 12 * u, pad = 14 * u;
    const parts: Phaser.GameObjects.GameObject[] = [];
    let y = pad;
    const title = txt(x0 + pad, y, d.title, 19, '#ffffff'); parts.push(title); y += title.height + 2 * u;
    if (d.sub) { const s = txt(x0 + pad, y, d.sub, 14, '#8fa6d8'); parts.push(s); y += s.height + 6 * u; }
    for (const line of d.lines) { const l = txt(x0 + pad, y, line, 15, '#e6eeff', 0, false); parts.push(l); y += l.height + 3 * u; }
    // closures get a lane diagram: one box per lane, left to right, red with a cross where closed
    let lanesY = -1;
    if (info && (info.kind === 'roadworks' || info.kind === 'incident')) { lanesY = y + 4 * u; y = lanesY + 26 * u + 4 * u; }
    const bh = 38 * u;
    let btnY = -1;
    if (actions.length) { btnY = y + 6 * u; y = btnY + bh; }
    const ch = y + pad;
    const y0 = narrow ? m.insetTop + (ex ? 52 * u : 10 * u) : H - ch - 14 * u;
    const g = m.add.graphics();
    g.fillStyle(0x000000, 0.3); g.fillRoundedRect(x0 + 3 * u, y0 + 4 * u, cw, ch, 12 * u);
    g.fillStyle(0x111a33, 0.96); g.fillRoundedRect(x0, y0, cw, ch, 12 * u);
    g.lineStyle(2 * u, 0x3c5a9a, 1); g.strokeRoundedRect(x0, y0, cw, ch, 12 * u);
    c.add(g);
    const back = m.add.zone(x0, y0, cw, ch).setOrigin(0).setInteractive();
    back.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, ev: Phaser.Types.Input.EventData) => ev?.stopPropagation?.());
    c.add(back);
    for (const p of parts) { (p as Phaser.GameObjects.Text).y += y0; c.add(p); }
    if (info && lanesY >= 0 && (info.kind === 'roadworks' || info.kind === 'incident')) {
      const bw = Math.min(46 * u, (cw - 2 * pad) / info.lanes - 6 * u), lg = m.add.graphics();
      for (let i = 0; i < info.lanes; i++) {
        const bx = x0 + pad + i * (bw + 6 * u), by = y0 + lanesY, shut = info.closed.includes(i);
        lg.fillStyle(shut ? 0x7a1f1f : 0x1d5a36, 1); lg.fillRoundedRect(bx, by, bw, 26 * u, 5 * u);
        lg.lineStyle(3 * u, shut ? 0xff6b6b : 0x3ee07a, 1);
        if (shut) { lg.lineBetween(bx + bw * 0.3, by + 6 * u, bx + bw * 0.7, by + 20 * u); lg.lineBetween(bx + bw * 0.7, by + 6 * u, bx + bw * 0.3, by + 20 * u); }
        else { lg.lineBetween(bx + bw / 2, by + 20 * u, bx + bw / 2, by + 6 * u); lg.lineBetween(bx + bw / 2, by + 6 * u, bx + bw / 2 - 6 * u, by + 12 * u); lg.lineBetween(bx + bw / 2, by + 6 * u, bx + bw / 2 + 6 * u, by + 12 * u); }
      }
      c.add(lg);
    }
    // a close cross on a picked card, and the action buttons along its foot
    const zone = (x: number, yy: number, w: number, h: number, fn: () => void) => {
      const z = m.add.zone(x, yy, w, h).setOrigin(0).setInteractive();
      z.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, ev: Phaser.Types.Input.EventData) => { ev?.stopPropagation?.(); fn(); });
      c.add(z);
    };
    if (picked) {
      const xs = txt(x0 + cw - pad, y0 + pad - 2 * u, '✕', 20, '#8fa6d8', 1); c.add(xs);
      zone(x0 + cw - 48 * u, y0, 48 * u, 48 * u, () => this.close());
    }
    if (btnY >= 0) {
      let bx = x0 + pad;
      for (const a of actions) {
        const t = txt(0, 0, a.label, 15, '#ffffff', 0.5), w = t.width + 28 * u, by = y0 + btnY;
        const bg = m.add.graphics();
        bg.fillStyle(0x1f5fb8, 1); bg.fillRoundedRect(bx, by, w, bh, 9 * u);
        bg.lineStyle(2 * u, 0x7fc2ff, 1); bg.strokeRoundedRect(bx, by, w, bh, 9 * u);
        t.setPosition(bx + w / 2, by + (bh - t.height) / 2);
        c.add(bg); c.add(t);
        zone(bx, by, w, bh, () => { if (a.run(picked!.at, picked!.info) !== false) this.close(); else this.render(); });
        bx += w + 10 * u;
      }
    }
    this.cardBox = { x0, y0, x1: x0 + cw, y1: y0 + ch };
  }
}

function same(a: Inspection | null, b: Inspection | null) {
  if (!a || !b) return a === b;
  if (a.kind === 'road' || b.kind === 'road') return a.kind === 'road' && b.kind === 'road' && a.seg === b.seg;
  return a.kind === b.kind && a.x === b.x && a.y === b.y;
}
function diamond(x: number, y: number, r: number) { return [{ x, y: y - r }, { x: x + r, y }, { x, y: y + r }, { x: x - r, y }]; }
function triangle(x: number, y: number, r: number) { return [{ x, y: y - r }, { x: x + r * 0.95, y: y + r * 0.7 }, { x: x - r * 0.95, y: y + r * 0.7 }]; }
