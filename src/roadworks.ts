import type Phaser from 'phaser';
import { Network, Seg, LW, TAPER, dist } from './network';
import { MERGE_ZONE } from './traffic';
import { pick, rand } from './geom';
import type { GlowLayer } from './glow';

/** Roadworks tuning: sites per session (at most one per road), closure length, keep-clear distances. */
export const WORKS_CFG = {
  sites: 5,
  length: [900, 1800] as [number, number],
  /** a clear run beyond the closure, so traffic can reach an exit lane after it */
  tail: 1000,
  /** stations queue at their gates, so works stay this far out */
  stationClear: 4500,
};
const AMBER = 0xffb020, SIGN = 0xb8540f, RED = 0xe0332b, WHITE = 0xf4f6fa, GO = 0x3ee07a;
/** how far before the closure the gantries stand, and the lane markings on the road */
const GANTRIES = [2000, 1000, 300], MARKS = [1600, 1050, 500];

export interface Site {
  kind: 'roadworks'; seg: Seg; s0: number; s1: number;
  lanes: number[]; open: number[];
  /** the side the open lanes are on */
  dir: -1 | 1;
  /** what the signs and the sat-nav say */
  sign: string;
}

/**
 * The lanes left open by closing `lanes` of seg over [s0, s1], or null if that layout is not allowed. Closed lanes must
 * form a block against one edge, so each has a way across to an open one. The approach and closure must sit inside the
 * section, clear of joins and tapers, so the open lanes run unbroken through the works. Slip roads and lay-bys only
 * matter on the closed side: the opposite edge lane stays open and they carry on working from it.
 */
export function openLanes(net: Network, seg: Seg, s0: number, s1: number, lanes: number[]): number[] | null {
  if (seg.kind !== 'motorway' || !(s1 > s0)) return null;
  const closed = [...lanes].sort((a, b) => a - b), n = closed.length;
  if (!n || n >= seg.lanes || closed.some((l, i) => !Number.isInteger(l) || (i > 0 && l !== closed[i - 1] + 1))) return null;
  if (closed[0] !== 0 && closed[n - 1] !== seg.lanes - 1) return null;
  const a = s0 - MERGE_ZONE, b = s1 + WORKS_CFG.tail;
  if (a < (seg.gain ? TAPER : 0) + 100 || b > seg.len - (seg.drop ? MERGE_ZONE : 100)) return null;
  const side = closed[0] === 0 ? -1 : 1;
  // merging traffic needs the edge lane for a while after a merge lane ends, as for incidents
  for (const z of seg.aux) if (z.side === side && (z.type === 'merge' ? z.s1 + 1200 : z.s1) > a && z.s0 < b) return null;
  if (seg.stops.some((st) => st.s > a && st.s < b) || seg.blocks.some((k) => k.s1 > a && k.s0 - (k.warn ?? 0) < b)) return null;
  for (const at of [a, s1]) {
    const p = seg.path.at(at);
    if (net.stations.some((st) => Math.hypot(p.x - st.x, p.y - st.y) < WORKS_CFG.stationClear)) return null;
  }
  return Array.from({ length: seg.lanes }, (_, i) => i).filter((l) => !closed.includes(l));
}

export class Roadworks {
  sites: Site[] = [];
  constructor(public net: Network) {}

  /** close `lanes` of seg over [s0, s1] and sign the approach; null if the layout is not allowed */
  add(seg: Seg, s0: number, s1: number, lanes: number[]): Site | null {
    const open = openLanes(this.net, seg, s0, s1, lanes);
    if (!open) return null;
    const closed = [...lanes].sort((a, b) => a - b), dir = open[0] < closed[0] ? -1 : 1;
    const where = dir < 0 ? 'right' : 'left', keep = dir < 0 ? 'left' : 'right';
    const sign = `${closed.length > 1 ? `${closed.length} ${where} lanes` : `${where[0].toUpperCase()}${where.slice(1)} lane`} closed · keep ${keep}`;
    const site: Site = { kind: 'roadworks', seg, s0, s1, lanes: closed, open, dir, sign };
    for (const lane of closed) seg.blocks.push({ lane, s0, s1, inc: site, warn: MERGE_ZONE });
    for (const back of GANTRIES) {
      this.net.signs.push({ seg, s: s0 - back, kind: 'gantry', side: 1, panels: [{ side: 'C', color: SIGN, title: `Roadworks ${dist(back)}`, sub: sign, arrow: dir * 45 }] });
    }
    this.net.signs.push({ seg, s: s1 + 60, kind: 'side', side: 1, panels: [{ side: 'R', color: SIGN, title: 'End of works', arrow: null }] });
    this.sites.push(site);
    return site;
  }

  /** a random allowed layout on each of a random selection of roads */
  place(count = WORKS_CFG.sites) {
    const roads = [...this.net.roads];
    while (roads.length && this.sites.length < count) {
      const road = roads.splice(Math.floor(Math.random() * roads.length), 1)[0];
      const length = rand(...WORKS_CFG.length), spots: { seg: Seg; s0: number; lanes: number[] }[] = [];
      for (const seg of [...road.f, ...road.r]) {
        const n = seg.lanes === 2 || Math.random() < 0.55 ? 1 : 2, inner = Array.from({ length: n }, (_, i) => i);
        for (const lanes of [inner, inner.map((l) => seg.lanes - 1 - l)]) {
          for (let s0 = MERGE_ZONE; s0 + length < seg.len; s0 += 100) if (openLanes(this.net, seg, s0, s0 + length, lanes)) spots.push({ seg, s0, lanes });
        }
      }
      if (spots.length) { const at = pick(spots); this.add(at.seg, at.s0, at.s0 + length, at.lanes); }
    }
  }

  /** drawn on the incident layer of each deck, which Incidents.draw has just cleared */
  draw(decks: Phaser.GameObjects.Graphics[], glows: GlowLayer[], time: number, cx: number, cy: number, r: number) {
    for (const site of this.sites) {
      const { seg, s0, s1, lanes, dir } = site, g = decks[seg.level], fx = glows[seg.level];
      const mid = seg.path.at((s0 + s1) / 2);
      if (Math.hypot(mid.x - cx, mid.y - cy) > r + (s1 - s0) / 2 + MERGE_ZONE) continue;
      const line = (w: number, col: number, sa: number, la: number, sb: number, lb: number, alpha = 1) => {
        const p = seg.path.at(sa, la), q = seg.path.at(sb, lb);
        g.lineStyle(w, col, alpha); g.lineBetween(p.x, p.y, q.x, q.y);
      };
      const lat0 = seg.laneLat(lanes[0]) - LW / 2, lat1 = seg.laneLat(lanes[lanes.length - 1]) + LW / 2;
      const edge = dir < 0 ? lat0 : lat1, flash = Math.floor(time * 3) % 2 === 0;
      // the closed lanes are tinted, and a red and white barrier runs along the open lanes
      for (let s = s0; s < s1; s += 100) line(lat1 - lat0, SIGN, s, (lat0 + lat1) / 2, Math.min(s + 100, s1), (lat0 + lat1) / 2, 0.3);
      for (let s = s0, i = 0; s < s1; s += 30, i++) line(6, i % 2 ? WHITE : RED, s, edge, Math.min(s + 30, s1), edge);
      // a barrier across every closed lane at both ends, with a flashing arrow to the open side at the start
      for (const lane of lanes) {
        const lat = seg.laneLat(lane);
        for (const s of [s0, s1]) for (let i = 0; i < 4; i++) line(10, i % 2 ? WHITE : RED, s, lat - LW / 2 + i * 8, s, lat - LW / 2 + (i + 1) * 8);
        const tip = lat + dir * 9;
        line(5, flash ? AMBER : 0x5a4a1a, s0 - 26, lat - dir * 9, s0 - 14, tip);
        line(5, flash ? AMBER : 0x5a4a1a, s0 - 2, lat - dir * 9, s0 - 14, tip);
        if (flash) { const q = seg.path.at(s0 - 14, tip); fx.soft(q.x, q.y, 18, AMBER, 0.5); }
      }
      // crews and their trucks behind the barriers
      for (let s = s0 + 300; s < s1 - 150; s += 600) {
        const lat = (lat0 + lat1) / 2;
        line(18, 0xd9a21a, s, lat, s + 44, lat);
        line(14, 0x2b3142, s + 26, lat, s + 42, lat);
        if (flash) { const q = seg.path.at(s + 34, lat); fx.soft(q.x, q.y, 16, AMBER, 0.55); }
      }
      // on the approach every lane is marked: a green arrow if it stays open, a red cross if it closes
      for (const back of MARKS) {
        const s = s0 - back;
        for (let lane = 0; lane < seg.lanes; lane++) {
          const lat = seg.laneLat(lane);
          if (lanes.includes(lane)) {
            line(5, RED, s - 11, lat - 11, s + 11, lat + 11);
            line(5, RED, s - 11, lat + 11, s + 11, lat - 11);
          } else {
            line(5, GO, s - 14, lat, s + 8, lat);
            line(5, GO, s + 14, lat, s + 2, lat - 9);
            line(5, GO, s + 14, lat, s + 2, lat + 9);
          }
        }
      }
    }
  }
}
