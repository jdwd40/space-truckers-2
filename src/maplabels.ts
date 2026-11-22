import type { Network, Road, Seg } from './network';

/** where a road's name goes: a world point on the road and the text's rotation, kept upright */
export interface LabelSpot { x: number; y: number; rot: number }

/** distance between samples along a road's centre line, in world units */
const STEP = 100;
/** where a road's names go, as fractions of its length, each with the stretch searched for a clear spot */
const TARGETS: { f: number; lo: number; hi: number; extra: boolean }[] = [
  { f: 0.5, lo: 0, hi: 1, extra: false },
  { f: 0.2, lo: 0, hi: 0.35, extra: true },
  { f: 0.8, lo: 0.65, hi: 1, extra: true },
];

/**
 * Places road names on the sector map so each sits on its own road. A name is centred on its road's centre line and
 * only goes where the whole name, end to end, keeps clear of every other road (and its ramps) by half its height, at
 * the current zoom. So where roads cross or meet (M1 and M2 at the interchange, an avenue across M2, a bypass by its
 * motorway) the name moves along to a clear stretch, or waits until the map is zoomed in far enough to carry it.
 */
export class RoadLabels {
  /** per road: the centre-line samples and how far each is from the edge of the nearest other road */
  private clear = new Map<Road, { x: number; y: number; h: number; c: number }[]>();

  private roadsOf: Map<Seg, Set<string>> | null = null;
  constructor(private net: Network) {}

  /** the one road a slip road joins at both ends, or null when it joins two roads (a junction) */
  private serves(ramp: Seg): string | null {
    if (!this.roadsOf) {
      this.roadsOf = new Map();
      const add = (s: Seg, road: Seg) => {
        if (road.kind !== 'motorway' && road.kind !== 'avenue') return;
        let set = this.roadsOf!.get(s);
        if (!set) this.roadsOf!.set(s, (set = new Set()));
        set.add(road.road);
      };
      for (const t of this.net.trans) { add(t.to, t.from); add(t.from, t.to); }
    }
    const set = this.roadsOf.get(ramp);
    return set && set.size === 1 ? [...set][0] : null;
  }

  private samples(rd: Road) {
    let out = this.clear.get(rd);
    if (out) return out;
    out = [];
    // other roads, and slip roads to them (junctions); slip roads that only serve this road (its U-turns and facility
    // roads) may sit under its name
    const obstacles = this.net.segs.filter((seg) => seg.road !== rd.name && seg.kind !== 'services' && !(seg.kind === 'ramp' && this.serves(seg) === rd.name));
    for (let s = 0; s <= rd.c.len; s += STEP) {
      const p = rd.c.at(s);
      let c = Infinity;
      for (const seg of obstacles) {
        const half = (seg.lanes * seg.laneW) / 2, b = seg.path;
        const bx = Math.max(b.minX - p.x, 0, p.x - b.maxX), by = Math.max(b.minY - p.y, 0, p.y - b.maxY);
        if (Math.hypot(bx, by) - half >= c) continue;
        c = Math.min(c, b.nearest(p.x, p.y).d - half);
      }
      out.push({ x: p.x, y: p.y, h: p.h, c });
    }
    this.clear.set(rd, out);
    return out;
  }

  /**
   * Spots for a road's name at `zoom` screen pixels per world unit, for a name `w` × `h` pixels on screen: one near the
   * middle of the road, and on a long road zoomed in two more towards its ends. Empty when nowhere is clear.
   */
  spots(rd: Road, zoom: number, w: number, h: number): LabelSpot[] {
    const pts = this.samples(rd), n = pts.length;
    const along = Math.ceil(((w / 2 + 6) / zoom) / STEP), need = (h / 2 + 3) / zoom;
    // fits[i]: a name centred on sample i keeps clear of other roads along its whole length
    const ok = pts.map((p) => p.c >= need);
    const fits = pts.map((_, i) => {
      if (i - along < 0 || i + along >= n) return false;
      for (let j = i - along; j <= i + along; j++) if (!ok[j]) return false;
      return true;
    });
    const out: LabelSpot[] = [], used: number[] = [];
    const extras = zoom >= (0.06 * 25000) / rd.c.len;
    for (const t of TARGETS) {
      if (t.extra && !extras) continue;
      let best = -1;
      for (let i = Math.floor(t.lo * (n - 1)); i <= Math.ceil(t.hi * (n - 1)); i++) {
        if (!fits[i] || used.some((u) => Math.abs(u - i) < along * 4)) continue;
        if (best < 0 || Math.abs(i / (n - 1) - t.f) < Math.abs(best / (n - 1) - t.f)) best = i;
      }
      if (best < 0) continue;
      used.push(best);
      const p = pts[best];
      let rot = p.h; if (rot > Math.PI / 2) rot -= Math.PI; else if (rot < -Math.PI / 2) rot += Math.PI;
      out.push({ x: p.x, y: p.y, rot });
    }
    return out;
  }
}
