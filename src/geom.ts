export interface Pt { x: number; y: number }
export interface Pose { x: number; y: number; h: number }

export function angDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** Uniformly resampled polyline with fast lookup by distance. */
export class Path {
  xs: Float32Array; ys: Float32Array; hs: Float32Array;
  step: number; len: number; n: number;
  minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
  constructor(pts: Pt[]) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const total = cum[cum.length - 1];
    const n = Math.max(2, Math.ceil(total / 6) + 1);
    this.n = n; this.len = total; this.step = total / (n - 1);
    this.xs = new Float32Array(n); this.ys = new Float32Array(n); this.hs = new Float32Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const s = i * this.step;
      while (j < pts.length - 2 && cum[j + 1] < s) j++;
      const L = cum[j + 1] - cum[j] || 1;
      const f = clamp((s - cum[j]) / L, 0, 1);
      const x = pts[j].x + (pts[j + 1].x - pts[j].x) * f;
      const y = pts[j].y + (pts[j + 1].y - pts[j].y) * f;
      this.xs[i] = x; this.ys[i] = y;
      if (x < this.minX) this.minX = x; if (x > this.maxX) this.maxX = x;
      if (y < this.minY) this.minY = y; if (y > this.maxY) this.maxY = y;
    }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      this.hs[i] = Math.atan2(this.ys[b] - this.ys[a], this.xs[b] - this.xs[a]);
    }
  }
  at(s: number, lat = 0): Pose {
    const sc = clamp(s, 0, this.len);
    const f = sc / this.step;
    let i = Math.floor(f);
    if (i >= this.n - 1) i = this.n - 2;
    const t = f - i;
    let x = this.xs[i] + (this.xs[i + 1] - this.xs[i]) * t;
    let y = this.ys[i] + (this.ys[i + 1] - this.ys[i]) * t;
    const h = this.hs[i] + angDiff(this.hs[i], this.hs[i + 1]) * t;
    const ex = s - sc;
    if (ex !== 0) { x += Math.cos(h) * ex; y += Math.sin(h) * ex; }
    return { x: x - lat * Math.sin(h), y: y + lat * Math.cos(h), h };
  }
  nearest(x: number, y: number): { s: number; d: number } {
    let best = Infinity, bi = 0;
    for (let i = 0; i < this.n; i += 4) {
      const d = (this.xs[i] - x) ** 2 + (this.ys[i] - y) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    for (let i = Math.max(0, bi - 4); i <= Math.min(this.n - 1, bi + 4); i++) {
      const d = (this.xs[i] - x) ** 2 + (this.ys[i] - y) ** 2;
      if (d <= best) { best = d; bi = i; }
    }
    return { s: bi * this.step, d: Math.sqrt(best) };
  }
  pts(s0: number, s1: number, lat: number | ((s: number) => number) = 0, step = 16): Pt[] {
    const out: Pt[] = [];
    const n = Math.max(1, Math.ceil((s1 - s0) / step));
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      const p = this.at(s, typeof lat === 'number' ? lat : lat(s));
      out.push({ x: p.x, y: p.y });
    }
    return out;
  }
}

export function catmull(ctrl: Pt[], sub = 24): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    for (let k = 0; k < sub; k++) {
      const t = k / sub, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(ctrl[ctrl.length - 1]);
  return out;
}

export function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 80): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return out;
}
