import type { Bounds } from './network';
import type { Pt } from './geom';

/** the closest the sector map zooms in: screen pixels per world unit (a 32-unit lane is about 38 px wide) */
export const SECTOR_MAX_ZOOM = 1.2;

/**
 * Where the sector map is looking: a north-up view centred on (cx, cy) at `zoom` screen pixels per world unit, kept
 * inside the network bounds. It is plain state, so the world keeps one for the whole session and reopening the map
 * shows what the player was looking at. Screen points are in pixels from the top-left of a w × h screen; the map fills
 * the screen below `top` pixels of chrome, and (cx, cy) sits in the middle of that area.
 */
export class SectorView {
  cx: number; cy: number; zoom = 1;
  /** the zoom at which the whole network fits the screen; the map never zooms out past it */
  minZoom = 1;
  private w = 1; private h = 1; private top = 0;
  constructor(readonly bounds: Bounds) { this.cx = bounds.x0 + bounds.w / 2; this.cy = bounds.y0 + bounds.h / 2; }

  /** show the whole network on a w × h screen */
  fit(w: number, h: number, top = 0) {
    this.resize(w, h, top);
    this.zoom = this.minZoom; this.cx = this.bounds.x0 + this.bounds.w / 2; this.cy = this.bounds.y0 + this.bounds.h / 2;
  }
  /** the screen changed size (resize, rotation): keep the centre and zoom, but never zoom out past the new fit */
  resize(w: number, h: number, top = this.top) {
    this.w = Math.max(1, w); this.h = Math.max(1, h); this.top = Math.min(top, this.h - 1);
    this.minZoom = Math.min(this.w / this.bounds.w, (this.h - this.top) / this.bounds.h);
    this.clamp();
  }
  /** the screen point the view centre is drawn at */
  centre(w = this.w, h = this.h): Pt { return { x: w / 2, y: (h + this.top) / 2 }; }
  toScreen(x: number, y: number, w = this.w, h = this.h): Pt { const c = this.centre(w, h); return { x: c.x + (x - this.cx) * this.zoom, y: c.y + (y - this.cy) * this.zoom }; }
  toWorld(sx: number, sy: number, w = this.w, h = this.h): Pt { const c = this.centre(w, h); return { x: this.cx + (sx - c.x) / this.zoom, y: this.cy + (sy - c.y) / this.zoom }; }
  /** drag the map by a screen-pixel delta (the map follows the finger) */
  pan(dx: number, dy: number) { this.cx -= dx / this.zoom; this.cy -= dy / this.zoom; this.clamp(); }
  /** zoom by factor about a screen point, which stays over the same world point */
  zoomAt(sx: number, sy: number, factor: number, w = this.w, h = this.h) {
    const q = this.toWorld(sx, sy, w, h);
    this.zoom = Math.min(SECTOR_MAX_ZOOM, Math.max(this.minZoom, this.zoom * factor));
    const c = this.centre(w, h);
    this.cx = q.x - (sx - c.x) / this.zoom; this.cy = q.y - (sy - c.y) / this.zoom;
    this.clamp();
  }
  private clamp() {
    const b = this.bounds;
    this.zoom = Math.min(SECTOR_MAX_ZOOM, Math.max(this.minZoom, this.zoom));
    this.cx = Math.min(b.x1, Math.max(b.x0, this.cx)); this.cy = Math.min(b.y1, Math.max(b.y0, this.cy));
  }
}
