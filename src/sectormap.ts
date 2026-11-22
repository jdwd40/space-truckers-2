import Phaser from 'phaser';
import type { WorldScene } from './world';
import type { Network, Road, Seg } from './network';
import { RoadLabels } from './maplabels';
import { MapInspector } from './mapinspect';
import type { Pt } from './geom';
import { SectorView } from './sectorview';
import { toast } from './state';
import { sfx } from './audio';
import { RoutePanel } from './routepanel';
import { FONT, strokeRoute, markRouteEnd } from './render';

const BG = 0x070c22;
/** from this zoom (screen px per world unit) lanes are wide enough to draw lane lines */
const LANES_ZOOM = 0.18;

/** a facility the sector map marks and labels, by its stable network id */
export interface MapFeature { id: string; kind: 'fuel' | 'fuel-repair' | 'layby' | 'police-hq'; name: string; x: number; y: number }
/** the facilities the sector map shows, from the network */
export function mapFeatures(net: Network): MapFeature[] {
  return [
    ...net.services.map((sv) => ({ id: sv.id, kind: sv.kind, name: sv.name, x: sv.x, y: sv.y })),
    ...net.laybys.map((lb) => ({ id: lb.id, kind: 'layby' as const, name: lb.name, x: lb.x, y: lb.y })),
    ...net.policeHQs.map((h) => ({ id: h.id, kind: h.kind, name: h.name, x: h.x, y: h.y })),
  ];
}
/** marker and label colours by facility kind */
const FEATURE_LOOK: Record<MapFeature['kind'], { fill: number; text: string; r: number; minZoom: number; suffix: string }> = {
  fuel: { fill: 0x2f7de1, text: '#9fd0ff', r: 160, minZoom: 0.05, suffix: '' },
  'fuel-repair': { fill: 0xe08a2f, text: '#ffd09a', r: 180, minZoom: 0.035, suffix: ' · Fuel & Repair' },
  layby: { fill: 0x3c9a6a, text: '#a8e6c4', r: 90, minZoom: 0.12, suffix: '' },
  'police-hq': { fill: 0x3a5bd8, text: '#b8c8ff', r: 110, minZoom: 0.03, suffix: '' },
};

/** draws extra world-space marks over the base map each redraw (route, waypoint, compared routes); `px` is one screen pixel in world units */
export type MapOverlay = (g: Phaser.GameObjects.Graphics, view: SectorView, px: number) => void;
/** called with the world point under a tap or click that did not drag (inspection), or under a long press or right-click (waypoints) */
export type MapTap = (at: Pt, view: SectorView) => void;
/** how long a press must be held without moving to count as a long press, in ms */
const HOLD_MS = 550;
/** how near (in screen pixels) a long press must be to the waypoint to remove it rather than move it */
const WAYPOINT_HIT_PX = 30;

interface Label { t: Phaser.GameObjects.Text; x: number; y: number; prio: number; minZoom: number; rot: number; road?: Road; idx?: number }

/**
 * The full-screen sector map: vector graphics on its own camera, drawn from the same network geometry as the sat-nav,
 * and redrawn whenever the view changes so it stays sharp at any zoom. The world owns the view state and the pause; this
 * scene only draws it and turns mouse, wheel and touch gestures into pans, zooms and taps.
 *
 * Extension points: `overlays` (extra marks drawn every redraw), `taps` (a tap at a world point), `holds` (a long press
 * or right-click at a world point), `chrome` (a layer drawn at screen scale over the map, for panels and cards),
 * `layouts` (rebuild chrome on open and resize) and `redraw()` after anything they show changes. A tap is inspection;
 * the waypoint is set, moved and removed with a hold, so the two never compete for the same gesture.
 */
export class SectorMapScene extends Phaser.Scene {
  world!: WorldScene;
  view: SectorView | null = null;
  overlays: MapOverlay[] = [];
  taps: MapTap[] = [];
  holds: MapTap[] = [];
  /** called with the world point under a mouse moving over the map with no button down (hover inspection) */
  hovers: MapTap[] = [];
  /** screen areas of chrome (cards, panels) where a press must not start a pan or a tap on the map */
  blockers: ((x: number, y: number) => boolean)[] = [];
  /** tap and hover inspection; add buttons to its card through `inspector.actions` */
  inspector!: MapInspector;
  /** called after the map is laid out for the screen (on open and resize), to rebuild chrome panels */
  layouts: (() => void)[] = [];
  mapCam!: Phaser.Cameras.Scene2D.Camera;
  uiCam!: Phaser.Cameras.Scene2D.Camera;
  mapLayer!: Phaser.GameObjects.Layer;
  chrome!: Phaser.GameObjects.Layer;
  private base!: Phaser.GameObjects.Graphics;
  private over!: Phaser.GameObjects.Graphics;
  private arrow!: Phaser.GameObjects.Image;
  private labels: Label[] = [];
  private roadLabels!: RoadLabels;
  private bar!: Phaser.GameObjects.Container;
  /** the zoom the base map was last tessellated for */
  private baseZoom = 0;
  // gesture state
  private drag: { id: number; x: number; y: number; moved: number; t: number; held: boolean } | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  /** whether the bar was last built with a "clear waypoint" button */
  private barWaypoint = false;
  private pinch: { d: number; x: number; y: number } | null = null;

  constructor() { super({ key: 'sector', active: false }); }

  /** called by the world once it has built its network, before it launches this scene */
  attach(world: WorldScene) { this.world = world; }

  create() {
    this.scene.setVisible(false); this.input.enabled = false;
    this.mapCam = this.cameras.main.setBackgroundColor(BG);
    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.mapLayer = this.add.layer(); this.chrome = this.add.layer();
    (this.mapLayer as any).cameraFilter |= this.uiCam.id;
    (this.chrome as any).cameraFilter |= this.mapCam.id;
    this.base = this.add.graphics(); this.mapLayer.add(this.base);
    this.over = this.add.graphics(); this.mapLayer.add(this.over);
    this.buildLabels();
    this.arrow = this.add.image(0, 0, 'navarrow'); this.mapLayer.add(this.arrow);
    // the player's current route, under the base map's labels
    this.overlays.push((g, _v, px) => {
      const p = this.world.player;
      if (!p.goal) return;
      const pts = this.world.net.routePoints({ trans: p.route, goal: p.goal }, p.seg, p.s, Math.max(80, px * 6));
      if (pts.length < 2) return;
      strokeRoute(g, pts, Math.max(100, px * 6), Math.max(60, px * 3.5), 0x3ff0ff);
      markRouteEnd(g, pts[pts.length - 1], Math.max(200, px * 9), Math.max(90, px * 4));
    });
    // the waypoint: a pin on the road, drawn over the route
    this.overlays.push((g, _v, px) => {
      const wp = this.world.waypoint;
      if (!wp) return;
      const r = Math.max(160, px * 11), h = r * 1.9;
      g.fillStyle(0x0c1534, 1); g.fillCircle(wp.x, wp.y - h, r * 1.25);
      g.fillTriangle(wp.x - r * 0.8, wp.y - h + r * 0.4, wp.x + r * 0.8, wp.y - h + r * 0.4, wp.x, wp.y + px * 2);
      g.fillStyle(0xff4fd8, 1); g.fillCircle(wp.x, wp.y - h, r);
      g.fillTriangle(wp.x - r * 0.62, wp.y - h + r * 0.5, wp.x + r * 0.62, wp.y - h + r * 0.5, wp.x, wp.y);
      g.fillStyle(0xffffff, 1); g.fillCircle(wp.x, wp.y - h, r * 0.4);
    });
    this.holds.push((at, v) => this.waypointAt(at, v));
    this.buildChrome();
    this.inspector = new MapInspector(this);
    // a tapped road can take the waypoint from its card, as a hold on it would
    this.inspector.actions.push({
      label: 'Set waypoint here',
      when: (_at, info) => info?.kind === 'road',
      run: (at) => { if (this.view) this.placeWaypoint(at, this.view); },
    });
    new RoutePanel(this);
    this.input.addPointer(1);
    this.input.mouse?.disableContextMenu();
    this.input.on('wheel', (ptr: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (!this.view) return;
      this.view.zoomAt(ptr.x, ptr.y, Math.exp(-dy * 0.0015), this.scale.width, this.scale.height); this.redraw();
    });
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => this.onDown(ptr));
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => this.onMove(ptr));
    this.input.on('pointerup', (ptr: Phaser.Input.Pointer) => this.onUp(ptr));
    this.scale.on('resize', () => this.layout());
  }

  show(view: SectorView) {
    this.view = view;
    this.scene.setVisible(true); this.input.enabled = true;
    // nothing of the world shows behind a full-screen map: stop drawing it while it is open
    this.world.cameras.main.setVisible(false); this.world.minicam.setVisible(false);
    this.layout();
  }
  hide() {
    this.scene.setVisible(false); this.input.enabled = false;
    this.drag = null; this.pinch = null; this.cancelHold();
    // what was picked may be gone (a cleared incident) by the time the map opens again
    this.inspector.picked = null; this.inspector.hover = null;
    this.world.cameras.main.setVisible(true); this.world.minicam.setVisible(true);
  }

  /** fit cameras and chrome to the screen, then redraw */
  private layout() {
    if (!this.view) return;
    const W = this.scale.width, H = this.scale.height;
    const top = this.insetTop;
    // the map camera covers the screen below the bar, so its centre is the view's centre
    this.mapCam.setViewport(0, top, W, H - top); this.uiCam.setSize(W, H);
    this.view.resize(W, H, top);
    this.buildChrome();
    for (const fn of this.layouts) fn();
    this.baseZoom = 0;
    this.redraw();
  }

  /** draw the map for the current view; cheap when only panning (the base map is re-tessellated only on zoom) */
  redraw() {
    const v = this.view;
    if (!v || !this.world) return;
    this.mapCam.setZoom(v.zoom); this.mapCam.centerOn(v.cx, v.cy);
    const px = 1 / v.zoom;
    const close = v.zoom >= LANES_ZOOM;
    if (close || !this.baseZoom || Math.abs(v.zoom / this.baseZoom - 1) > 0.04) { this.drawBase(px, close); this.baseZoom = v.zoom; }
    if (this.barWaypoint !== !!this.world.waypoint) this.buildChrome();
    this.over.clear();
    for (const o of this.overlays) o(this.over, v, px);
    const p = this.world.player;
    this.arrow.setPosition(p.x, p.y).setRotation(p.h).setScale(30 / 68 * px);
    this.placeLabels(px);
  }

  /**
   * Roads, stations and facilities. Zoomed out, every road is drawn and the result kept while panning; close up (lane
   * lines visible) only the roads on screen are drawn, every redraw, each deck with its own lane lines so a flyover covers
   * the road under it.
   */
  private drawBase(px: number, close: boolean) {
    const g = this.base, net = this.world.net, v = this.view!;
    g.clear();
    // sample a curve every few screen pixels: enough to look smooth, never thousands of points per road at full zoom-out
    const step = Math.min(600, Math.max(20, px * 5));
    const a = v.toWorld(0, this.insetTop), b = v.toWorld(this.scale.width, this.scale.height), pad = 300;
    const shown = (seg: Seg) => !close || !(seg.path.maxX < a.x - pad || seg.path.minX > b.x + pad || seg.path.maxY < a.y - pad || seg.path.minY > b.y + pad);
    const kindW = (seg: Seg) => (seg.kind === 'motorway' ? seg.lanes * seg.laneW : seg.kind === 'avenue' ? 90 : 60);
    // stations first, as rings under the roads that dock inside them
    for (const st of net.stations) {
      const r = Math.max(1250, px * 12);
      g.fillStyle(st.color, 0.14); g.fillCircle(st.x, st.y, r);
      g.lineStyle(Math.max(160, px * 4), st.color, 1); g.strokeCircle(st.x, st.y, r);
    }
    // deck by deck: casing, surface, then lane lines
    const segs = net.segs.filter(shown);
    const levels = [...new Set(segs.map((seg) => seg.level))].sort((x, y) => x - y);
    for (const level of levels) {
      const deck = segs.filter((seg) => seg.level === level);
      for (const pass of [0, 1]) for (const seg of deck) {
        const w = Math.max(kindW(seg), px * (seg.kind === 'motorway' ? 2.5 : 1.5));
        if (pass === 0) g.lineStyle(w + Math.max(40, px * 2), 0x0a1128, 1);
        else g.lineStyle(w, seg.kind === 'avenue' ? 0x3d4870 : seg.kind === 'motorway' ? 0x7486bd : 0x56659a, 1);
        g.strokePoints(seg.path.pts(0, seg.len, 0, step) as Phaser.Types.Math.Vector2Like[]);
      }
      if (!close) continue;
      g.lineStyle(Math.max(2, px * 1.2), 0xdfe8ff, 0.55);
      for (const seg of deck) for (let i = 1; i < seg.lanes; i++)
        g.strokePoints(seg.path.pts(0, seg.len, seg.laneLat(i) - seg.laneW / 2, step) as Phaser.Types.Math.Vector2Like[]);
    }
    for (const f of mapFeatures(net)) {
      const look = FEATURE_LOOK[f.kind], r = Math.max(look.r, px * (f.kind === 'layby' ? 4 : 6));
      g.fillStyle(0x0a1128, 1); g.fillCircle(f.x, f.y, r * 1.35);
      g.fillStyle(look.fill, 1); g.fillCircle(f.x, f.y, r);
      g.fillStyle(0xffffff, 1); g.fillCircle(f.x, f.y, r * 0.42);
    }
  }

  private buildLabels() {
    const net = this.world.net;
    this.roadLabels = new RoadLabels(net);
    const mk = (s: string, size: number, color: string, stroke: string) => {
      const t = this.add.text(0, 0, s, { fontFamily: FONT, fontSize: `${size}px`, fontStyle: 'bold', color, stroke, strokeThickness: Math.round(size / 4) })
        .setOrigin(0.5).setResolution(Math.min(2, window.devicePixelRatio || 1));
      this.mapLayer.add(t); return t;
    };
    for (const st of net.stations) this.labels.push({ t: mk(st.name, 17, '#ffffff', '#070c22'), x: st.x, y: st.y, prio: 0, minZoom: 0, rot: 0 });
    // up to three names per road, placed each redraw on stretches clear of other roads (RoadLabels)
    for (const rd of net.roads) for (let i = 0; i < 3; i++)
      this.labels.push({ t: mk(rd.name, 13, '#cfe0ff', '#0a1128'), x: 0, y: 0, prio: 1, minZoom: 0, rot: 0, road: rd, idx: i });
    for (const f of mapFeatures(net)) {
      const look = FEATURE_LOOK[f.kind];
      this.labels.push({ t: mk(f.name + look.suffix, 12, look.text, '#0a1128'), x: f.x, y: f.y, prio: 2, minZoom: look.minZoom, rot: 0 });
    }
  }

  /** keep labels the same size on screen and drop the ones that would overlap a more important label */
  private placeLabels(px: number) {
    const v = this.view!, W = this.scale.width, H = this.scale.height;
    const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const free = (b: typeof taken[number]) => b.x1 > 0 && b.x0 < W && b.y1 > 0 && b.y0 < H && !taken.some((r) => r.x0 < b.x1 && b.x0 < r.x1 && r.y0 < b.y1 && b.y0 < r.y1);
    const spots = new Map<Road, ReturnType<RoadLabels['spots']>>();
    for (const L of [...this.labels].sort((a, b) => a.prio - b.prio)) {
      L.t.setVisible(false);
      if (v.zoom < L.minZoom) continue;
      if (L.road) {
        let at = spots.get(L.road);
        if (!at) spots.set(L.road, (at = this.roadLabels.spots(L.road, v.zoom, L.t.width + 8, L.t.height + 4)));
        const spot = at[L.idx!];
        if (!spot) continue;
        L.x = spot.x; L.y = spot.y; L.rot = spot.rot;
      }
      const s = v.toScreen(L.x, L.y, W, H);
      // the label's screen size (its text is laid out at scale 1) and the axis-aligned box of it rotated, with a little air
      const c = Math.abs(Math.cos(L.rot)), sn = Math.abs(Math.sin(L.rot)), tw = L.t.width + 8, th = L.t.height + 4;
      const hw = (c * tw + sn * th) / 2, hh = (sn * tw + c * th) / 2;
      // road names sit on the road and facility names just under the marker; a station's name goes on the station or, if
      // that is crowded, under or over its ring, and slides along to stay whole on a narrow screen
      let tries: number[] = [0], dx = 0;
      if (L.prio === 2) tries = [16];
      else if (L.prio === 0) {
        const ring = Math.max(1250 * v.zoom, 12) + hh + 2;
        tries = [0, ring, -ring];
        if (s.x > 0 && s.x < W) dx = Math.max(0, 4 + hw - s.x) - Math.max(0, s.x + hw + 4 - W);
      }
      for (const dy of tries) {
        const box = { x0: s.x + dx - hw, y0: s.y + dy - hh, x1: s.x + dx + hw, y1: s.y + dy + hh };
        if (!free(box)) continue;
        taken.push(box);
        L.t.setVisible(true).setPosition(L.x + dx * px, L.y + dy * px).setScale(px).setRotation(L.rot);
        break;
      }
    }
  }

  get u() { return Math.max(0.75, Math.min(1.3, Math.min(this.scale.width / 1280, this.scale.height / 720) * 1.2)); }
  /** the height of the bar along the top; the map is drawn below it */
  get insetTop() { return Math.round(56 * this.u); }

  private buildChrome() {
    this.bar?.destroy(true);
    const W = this.scale.width, u = this.u;
    const c = this.bar = this.add.container(0, 0); this.chrome.add(c);
    const h = this.insetTop;
    const g = this.add.graphics();
    g.fillStyle(0x111a33, 0.92); g.fillRect(0, 0, W, h);
    g.lineStyle(2 * u, 0x3c5a9a, 1); g.lineBetween(0, h, W, h);
    c.add(g);
    const txt = (x: number, y: number, s: string, size: number, color: string, ox = 0) =>
      this.add.text(x, y, s, { fontFamily: FONT, fontSize: `${Math.round(size * u)}px`, fontStyle: 'bold', color }).setOrigin(ox, 0.5).setResolution(Math.min(2, window.devicePixelRatio || 1));
    const title = txt(18 * u, h / 2, 'SECTOR MAP', 22, '#ffffff'); c.add(title);
    const narrow = W < 640;
    const bw = 104 * u, bh = 40 * u, bx = W - bw / 2 - 12 * u, by = h / 2;
    const bg = this.add.graphics();
    bg.fillStyle(0x5a1f28, 0.95); bg.fillRoundedRect(bx - bw / 2, by - bh / 2, bw, bh, 9 * u);
    bg.lineStyle(2 * u, 0xff6b6b, 1); bg.strokeRoundedRect(bx - bw / 2, by - bh / 2, bw, bh, 9 * u);
    c.add(bg); c.add(txt(bx, by, '✕ Close', 17, '#ffffff', 0.5));
    if (narrow) c.add(txt(W / 2, this.scale.height - 22 * u, 'Drag to pan · pinch to zoom · hold a road for a waypoint', 13, '#8fa6d8', 0.5).setStroke('#070c22', 5 * u));
    const zone = this.add.zone(bx, by, bw, bh).setInteractive();
    zone.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, ev: Phaser.Types.Input.EventData) => { ev?.stopPropagation?.(); this.world.closeSectorMap(); });
    c.add(zone);
    // while a waypoint is set, a button beside Close removes it
    this.barWaypoint = !!this.world.waypoint;
    if (this.barWaypoint) {
      const ww = 132 * u, wx = bx - bw / 2 - 10 * u - ww / 2;
      const wg = this.add.graphics();
      wg.fillStyle(0x4a1f4a, 0.95); wg.fillRoundedRect(wx - ww / 2, by - bh / 2, ww, bh, 9 * u);
      wg.lineStyle(2 * u, 0xff4fd8, 1); wg.strokeRoundedRect(wx - ww / 2, by - bh / 2, ww, bh, 9 * u);
      c.add(wg); c.add(txt(wx, by, '✕ Waypoint', 17, '#ffffff', 0.5));
      const wz = this.add.zone(wx, by, ww, bh).setInteractive();
      wz.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, ev: Phaser.Types.Input.EventData) => { ev?.stopPropagation?.(); this.removeWaypoint(); });
      c.add(wz);
    }
    // the controls hint goes between the title and the buttons, shortened (or left out) to fit
    if (narrow) return;
    const x0 = title.x + title.width + 20 * u, x1 = bx - bw / 2 - (this.barWaypoint ? 152 * u : 0) - 20 * u;
    for (const hint of ['Drag to pan · wheel to zoom · hold or right-click a road for a waypoint · M to close', 'Hold or right-click a road for a waypoint']) {
      const t = txt((x0 + x1) / 2, h / 2, hint, 14, '#8fa6d8', 0.5);
      if (t.width <= x1 - x0) { c.add(t); break; }
      t.destroy();
    }
  }

  // ----------------------------------------------------------- waypoint
  /** a hold at a world point: on the waypoint it removes it, on a road it sets or moves it there */
  private waypointAt(at: Pt, v: SectorView) {
    const wp = this.world.waypoint, px = 1 / v.zoom;
    if (wp && Math.hypot(at.x - wp.x, at.y - wp.y) < WAYPOINT_HIT_PX * px) { this.removeWaypoint(); return; }
    this.placeWaypoint(at, v);
  }
  /** set or move the waypoint to the road at a world point (a hold, or the inspector card's "Set waypoint here") */
  placeWaypoint(at: Pt, v: SectorView) {
    const wp = this.world.waypoint, px = 1 / v.zoom;
    if (this.world.setWaypoint(at.x, at.y, Math.max(400, 24 * px))) {
      toast(wp ? 'Waypoint moved' : 'Waypoint set — your route now passes it', '#ff9cec', 2200);
      sfx.click();
    } else toast('Hold on a road to set a waypoint', '#ffd27a', 1800);
    // a waypoint replaces a picked route, so panels showing it are rebuilt
    for (const fn of this.layouts) fn();
    this.redraw();
  }
  private removeWaypoint() {
    if (!this.world.waypoint) return;
    this.world.clearWaypoint();
    toast('Waypoint removed', '#ff9cec', 1800);
    sfx.click();
    for (const fn of this.layouts) fn();
    this.redraw();
  }
  private fireHold(ptr: Phaser.Input.Pointer) {
    if (!this.view) return;
    const at = this.view.toWorld(ptr.x, ptr.y, this.scale.width, this.scale.height);
    for (const fn of this.holds) fn(at, this.view);
  }
  private cancelHold() { if (this.holdTimer) clearTimeout(this.holdTimer); this.holdTimer = null; }

  // ----------------------------------------------------------- gestures
  private onDown(ptr: Phaser.Input.Pointer) {
    if (ptr.y < this.insetTop || this.blockers.some((b) => b(ptr.x, ptr.y))) return;
    this.cancelHold();
    if (ptr.rightButtonDown()) { this.drag = null; this.fireHold(ptr); return; }
    const p1 = this.input.pointer1, p2 = this.input.pointer2;
    if (p1.isDown && p2.isDown) {
      this.drag = null;
      this.pinch = { d: Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y), x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    } else {
      const dr: NonNullable<SectorMapScene['drag']> = this.drag = { id: ptr.id, x: ptr.x, y: ptr.y, moved: 0, t: this.time.now, held: false };
      // a press held still is a long press: it fires once, while the finger is still down, and is then no tap. It is
      // timed in real time, not game time, so a slow frame rate never makes the press feel longer.
      this.holdTimer = setTimeout(() => {
        this.holdTimer = null;
        if (this.drag !== dr || dr.moved > 10 || !ptr.isDown) return;
        dr.held = true; this.fireHold(ptr); this.redraw();
      }, HOLD_MS);
    }
  }
  private onMove(ptr: Phaser.Input.Pointer) {
    const v = this.view;
    if (!v) return;
    const W = this.scale.width, H = this.scale.height;
    if (this.pinch) {
      const p1 = this.input.pointer1, p2 = this.input.pointer2;
      if (!p1.isDown || !p2.isDown) return;
      const d = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y), x = (p1.x + p2.x) / 2, y = (p1.y + p2.y) / 2;
      v.pan(x - this.pinch.x, y - this.pinch.y);
      if (this.pinch.d > 4) v.zoomAt(x, y, d / this.pinch.d, W, H);
      this.pinch = { d, x, y };
      this.redraw(); return;
    }
    const dr = this.drag;
    if (!dr && !ptr.isDown && !ptr.wasTouch && ptr.y >= this.insetTop && !this.blockers.some((b) => b(ptr.x, ptr.y)) && !this.input.hitTestPointer(ptr).length) {
      const at = v.toWorld(ptr.x, ptr.y, W, H);
      for (const fn of this.hovers) fn(at, v);
      return;
    }
    if (!dr || dr.id !== ptr.id || !ptr.isDown) return;
    v.pan(ptr.x - dr.x, ptr.y - dr.y);
    dr.moved += Math.hypot(ptr.x - dr.x, ptr.y - dr.y); dr.x = ptr.x; dr.y = ptr.y;
    this.redraw();
  }
  private onUp(ptr: Phaser.Input.Pointer) {
    if (this.pinch) { if (!this.input.pointer1.isDown && !this.input.pointer2.isDown) this.pinch = null; this.drag = null; return; }
    const dr = this.drag; this.drag = null; this.cancelHold();
    if (!dr || dr.held || dr.id !== ptr.id || dr.moved > 10 || this.time.now - dr.t > 500 || !this.view) return;
    const at = this.view.toWorld(ptr.x, ptr.y, this.scale.width, this.scale.height);
    for (const fn of this.taps) fn(at, this.view);
  }
}
