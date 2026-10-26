import Phaser from 'phaser';
import { Network, Seg, Trans, Services, Station, Stop, LW, Route, Layby, Road } from './network';
import { Traffic, Veh, PlayerCtl, HITCH } from './traffic';
import { Cullable, DEPTH, drawWorld, drawStation, edgeS, makeTextures, planetTex, trailerTex, STRUCT_VARIANTS, STRUCT_SIZE } from './render';
import { angDiff, clamp, pick, rand, Pt } from './geom';
import { G, SPEEDS, CLASSES, Job, bus, toast, hint, rankOf, RANKS, save, FUEL_PRICE, money, tankMult, cabSpeed, cabAccel, PAX_MAX, PAX_PAY } from './state';
import { sfx } from './audio';
import { Incidents, Incident } from './incidents';
import { Outposts } from './outposts';
import { Landmarks } from './scenery';
import { Favours } from './favours';

const STATION_R = 1250;
const CARGO: Record<string, string[]> = {
  terra: ['Hydroponic greens', 'Fresh spring water', 'Medical kits', 'Colonist luggage', 'Fizzy drinks', 'Seed vaults'],
  kestrel: ['Starship parts', 'Robot spares', 'Data cores', 'Mail sacks', 'Solar sails'],
  jove: ['Helium-3 tanks', 'Fuel cells', 'Gas canisters', 'Coolant drums'],
  vesta: ['Iron ore', 'Ice blocks', 'Rare crystals', 'Mining drills', 'Nickel ingots'],
  harbor: ['Shipping containers', 'Trade goods', 'Souvenir crates', 'Spice barrels', 'Luxury furniture'],
  glacier: ['Frozen water cores', 'Cryo samples', 'Crystal ice', 'Coolant gel', 'Deep-freeze rations'],
  ember: ['Refined fuel', 'Smelted alloy', 'Plasma canisters', 'Slag bricks', 'Reactor rods'],
};
const TRAILER_FOR: Record<string, number> = { terra: 0, kestrel: 1, jove: 2, vesta: 4, harbor: 5, glacier: 7, ember: 6 };

export interface NavInfo { title: string; sub: string; dist: number; arrow: number | 'U' | 'dock' | 'fuel' | 'warn'; lanes: boolean[] | null; aux: number; remain: number }

interface Vis { units: Phaser.GameObjects.Image[]; shadows: Phaser.GameObjects.Image[] }
/** ambient high-altitude ship; `a` is its target alpha (0 while it is over a road or station) */
interface Flyer { img: Phaser.GameObjects.Image; sh: Phaser.GameObjects.Image; x: number; y: number; h: number; v: number; a: number }

export class WorldScene extends Phaser.Scene implements PlayerCtl {
  net!: Network;
  traffic!: Traffic;
  player!: Veh;
  layer!: Phaser.GameObjects.Layer;
  mapLayer!: Phaser.GameObjects.Layer;
  culls: Cullable[] = [];
  fx: Phaser.GameObjects.Graphics[] = [];
  fxTop!: Phaser.GameObjects.Graphics;
  guide!: Phaser.GameObjects.Graphics;
  sigG!: Phaser.GameObjects.Graphics;
  routeG!: Phaser.GameObjects.Graphics;
  mapArrow!: Phaser.GameObjects.Image;
  mapMarker!: Phaser.GameObjects.Graphics;
  mapLabels: Phaser.GameObjects.Text[] = [];
  minicam!: Phaser.Cameras.Scene2D.Camera;
  stars!: Phaser.GameObjects.TileSprite;
  rocks: Phaser.GameObjects.Image[] = [];
  paxG = new Map<Layby, Phaser.GameObjects.Graphics>();
  /** gameplay-clock timers: they only tick while the game is not paused */
  pending: { t: number; fn: () => void }[] = [];
  flyers: Flyer[] = [];
  camH = 0; zoomCur = 0.9; miniZoom = 0.05;
  /** world-space direction of one screen-space unit to the right and down, from the camera rotation: shadows fall that way */
  shX = { x: 1, y: 0 }; shY = { x: 0, y: 1 };
  dockS = new Map<Seg, number>();
  pstate: 'drive' | 'docking' | 'docked' | 'pulled' | 'park' | 'parked' | 'fuel' = 'drive';
  station: Station | null = null;
  fuelTarget: Services | null = null;
  holdT = 0; overT = 0; policeCool = 8; overWarnT = 0; autoHold = false; leavingLayby = false; laybySlot: { s: number; occ: unknown } | null = null;
  escort: { img: Phaser.GameObjects.Image; sh: Phaser.GameObjects.Image; s: number; seg: Seg; lat: number; v: number; t: number } | null = null;
  redAhead = false; limit = 5; blink = 0; routeRedraw = 0; remain = 0; nav: NavInfo | null = null;
  costs: Record<string, number> = {};
  fuelSpend = 0; lastLowWarn = -99; clk = 0;
  inc!: Incidents; incG!: Phaser.GameObjects.Graphics; hazardMsg = ''; squeezeOffer: { dir: number; t: number } | null = null;
  armed: import('./network').Aux | null = null;
  outposts!: Outposts; decoG!: Phaser.GameObjects.Graphics;
  landmarks!: Landmarks; landG!: Phaser.GameObjects.Graphics; favours!: Favours;

  constructor() { super('world'); }

  create() {
    makeTextures(this);
    this.net = new Network();
    this.layer = this.add.layer();
    this.mapLayer = this.add.layer();
    this.cameras.main.setBackgroundColor(0x0a1030);
    this.minicam = this.cameras.add(0, 0, 10, 10).setBackgroundColor(0x0c1534);
    (this.layer as any).cameraFilter |= this.minicam.id;
    (this.mapLayer as any).cameraFilter |= this.cameras.main.id;

    this.buildScenery();
    this.culls = drawWorld(this, this.net, this.layer);
    for (const lb of this.net.laybys) {
      const g = this.add.graphics().setDepth(DEPTH.veh(0) + 0.2); this.layer.add(g); this.paxG.set(lb, g);
      this.culls.push({ obj: g, x0: lb.x - 500, y0: lb.y - 500, x1: lb.x + 500, y1: lb.y + 500 });
      this.drawPax(lb);
    }
    this.landmarks = new Landmarks(this, this.net, this.layer);
    this.culls.push(...this.landmarks.culls);
    this.landG = this.add.graphics().setDepth(3.5); this.layer.add(this.landG);
    this.outposts = new Outposts(this.net, STATION_R);
    for (const st of this.net.stations) {
      const extras: Phaser.GameObjects.GameObject[] = [];
      this.layer.add(drawStation(this, st, STATION_R, this.outposts, extras));
      for (const e of extras) this.layer.add(e);
      for (const seg of st.arr) this.dockS.set(seg, edgeS(seg, st, STATION_R, true) - 70);
    }
    this.decoG = this.add.graphics().setDepth(DEPTH.station + 0.3); this.layer.add(this.decoG);
    for (let l = 0; l < 4; l++) { const g = this.add.graphics().setDepth(DEPTH.veh(l) + 0.4).setBlendMode(Phaser.BlendModes.ADD); this.fx.push(g); this.layer.add(g); }
    this.fxTop = this.add.graphics().setDepth(DEPTH.fxTop).setBlendMode(Phaser.BlendModes.ADD); this.layer.add(this.fxTop);
    this.guide = this.add.graphics(); this.layer.add(this.guide);
    this.sigG = this.add.graphics().setDepth(DEPTH.sign + 0.2); this.layer.add(this.sigG);

    this.traffic = new Traffic(this.net, this);
    this.traffic.onAdd = (v) => this.addVis(v);
    this.traffic.onRemove = (v) => this.removeVis(v);
    // dock gates: arrivals queue just short of the hangar door, departures at a barrier just outside it
    for (const st of this.net.stations) {
      for (const seg of st.arr) this.traffic.addGate(seg, edgeS(seg, st, STATION_R, true) - 20);
      for (const seg of st.dep) this.traffic.addGate(seg, edgeS(seg, st, STATION_R, false) + 170);
    }
    this.incG = this.add.graphics().setDepth(DEPTH.veh(0) + 0.25); this.layer.add(this.incG);
    this.favours = new Favours(this.net, this.traffic, this);
    bus.on('act', () => this.favours.act());
    this.inc = new Incidents(this.net, this.traffic, {
      playerCrashed: (inc, atFault, other, fee) => this.onPlayerCrashed(inc, atFault, other, fee),
      playerReleased: (inc) => this.onPlayerReleased(inc),
      bump: (fee, atFault, _o, saved) => this.onBump(fee, atFault, saved),
    });

    // the player's rig starts at Terra Nova's departure gate
    const terra = this.net.byId.terra;
    const seg = terra.dep[0];
    this.player = this.traffic.add('player', seg, 140, seg.lanes - 1, 0);
    this.player.v = 0;
    this.station = terra;
    this.traffic.player = this.player;
    this.baseAMax = this.player.aMax;
    this.applyUpgrades();
    this.refreshPlayerVis();
    this.traffic.view = { x: this.player.x, y: this.player.y, r: 1600 };
    this.traffic.populate();
    this.computeCosts();
    this.buildMap();
    this.camH = this.player.h;
    this.pstate = 'docked';

    bus.on('speed', (k: number) => this.setSpeed(k));
    bus.on('brake', () => this.toggleBrake());
    bus.on('lane', (d: number) => this.laneChange(d));
    bus.on('accept', (job: Job) => this.acceptJob(job));
    this.scale.on('resize', () => this.layoutStars());
    this.layoutStars();
    this.scene.launch('ui');
  }

  // ----------------------------------------------------------- scenery
  private buildScenery() {
    const diag = 2600;
    this.stars = this.add.tileSprite(0, 0, diag, diag, 'stars').setScrollFactor(0).setDepth(0);
    this.layer.add(this.stars);
    const neb = [[0x6a3cc9, -8000, -6000], [0x1d6fb8, 6000, -3000], [0xb04aa8, -4000, 7000], [0x2a8f9e, 9000, 8000], [0x5a3cc9, -14000, 9000], [0x3a5fd0, 3000, 12000], [0x7a3cb9, 12000, -11000], [0x2e6fb0, -12000, -11000], [0x9a3c99, 0, -4000], [0x2a7fae, -6000, 2000], [0x6a3cc9, 16000, 6000], [0x3a4fd0, -18000, -3000]];
    for (const [c, x, y] of neb) {
      const im = this.add.image(x, y, 'nebula').setTint(c).setScale(rand(30, 48)).setAlpha(0.55).setBlendMode(Phaser.BlendModes.ADD).setDepth(0.5).setRotation(rand(0, 6));
      this.layer.add(im);
    }
    const planet = (key: string, kind: 'terra' | 'jove' | 'violet' | 'red' | 'moon' | 'ice' | 'ember', x: number, y: number, r: number) => {
      planetTex(this, key, kind);
      const im = this.add.image(x, y, key).setScale(r / 500).setDepth(1);
      this.layer.add(im);
      return im;
    };
    // jove rings behind the planet
    const ring = this.add.graphics().setDepth(0.9);
    ring.setPosition(20400, -3000); ring.setRotation(-0.35);
    ring.lineStyle(380, 0xc79a6a, 0.35); ring.strokeEllipse(0, 0, 10400, 2600);
    ring.lineStyle(160, 0xe8c79a, 0.45); ring.strokeEllipse(0, 0, 9000, 2200);
    this.layer.add(ring);
    planet('pl_terra', 'terra', -19900, 1300, 3300);
    planet('pl_jove', 'jove', 20400, -3000, 3500);
    planet('pl_violet', 'violet', -9800, 10200, 3000);
    planet('pl_red', 'red', 9800, -9600, 1400);
    planet('pl_moon', 'moon', -13500, -4200, 520);
    planet('pl_moon2', 'moon', 13200, -6800, 650);
    planet('pl_moon3', 'moon', -2600, -17400, 900);
    planet('pl_ice', 'ice', 21800, -17500, 2600);
    planet('pl_ember', 'ember', -21500, 17800, 2800);
    // asteroid fields away from roads
    const occ = new Set<string>();
    const C = 250;
    for (const seg of this.net.segs) for (let s = 0; s < seg.len; s += 80) {
      const p = seg.path.at(s);
      const cx = Math.floor(p.x / C), cy = Math.floor(p.y / C);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) occ.add(`${cx + i},${cy + j}`);
    }
    const free = (x: number, y: number) => !occ.has(`${Math.floor(x / C)},${Math.floor(y / C)}`) && !this.net.stations.some((st) => Math.hypot(st.x - x, st.y - y) < STATION_R + 150);
    const addRock = (x: number, y: number, sc: number) => {
      if (!free(x, y)) return;
      const im = this.add.image(x, y, 'rock' + Math.floor(Math.random() * 6)).setScale(sc).setRotation(rand(0, 6)).setDepth(2);
      (im as any).spin = rand(-0.3, 0.3);
      this.layer.add(im); this.rocks.push(im);
    };
    for (let i = 0; i < 260; i++) { const a = rand(0, Math.PI * 2), r = rand(1000, 4200); addRock(this.net.byId.vesta.x + Math.cos(a) * r, this.net.byId.vesta.y + Math.sin(a) * r, rand(0.6, 2.6)); }
    const ore = this.net.roads.find((r) => r.name === 'Ore Road')!.c;
    for (let i = 0; i < 260; i++) { const p = ore.at(rand(0, ore.len)); const side = Math.random() < 0.5 ? -1 : 1; const d = rand(350, 2200) * side; addRock(p.x - Math.sin(p.h) * d, p.y + Math.cos(p.h) * d, rand(0.5, 2.2)); }
    for (let i = 0; i < 120; i++) addRock(rand(-20000, 20000), rand(-18000, 18000), rand(0.5, 1.6));
    // roadside structures: mining stations, ship repair shops and living quarters.
    // They hug the roadside just outside the sign band (side signs reach ~380 px from the road centreline)
    // so they stay inside the camera's view, and are spaced so the roadside stays readable and varied.
    const placed: { x: number; y: number; r: number }[] = [];
    const SIGN_BAND = 400;
    const clear = (rd: Road, x: number, y: number, half: number) => {
      for (const o of placed) if (Math.hypot(o.x - x, o.y - y) < o.r + half + 200) return false;
      if (this.net.stations.some((st) => Math.hypot(st.x - x, st.y - y) < STATION_R + half + 100)) return false;
      for (const seg of this.net.segs) {
        if (rd.f.includes(seg) || rd.r.includes(seg)) continue;
        const bb = seg.path; if (x < bb.minX - half - 300 || x > bb.maxX + half + 300 || y < bb.minY - half - 300 || y > bb.maxY + half + 300) continue;
        if (seg.path.nearest(x, y).d < half + (seg.kind === 'motorway' ? 260 : 180)) return false;
      }
      return true;
    };
    const industrial = new Set(['Ore Road', 'Slag Highway', 'Cinder Road', 'Ice Road']);
    const quiet = new Set(['Aurora Way', 'Frost Line', 'Harbor Run']);
    for (const rd of this.net.roads) {
      // weight the mix by road character: mining belts along the outer ore/slag roads, homes near the hubs
      const w = industrial.has(rd.name) ? { mine: 0.55, repair: 0.25, hab: 0.2 } : quiet.has(rd.name) ? { mine: 0.2, repair: 0.25, hab: 0.55 } : { mine: 0.3, repair: 0.35, hab: 0.35 };
      let last = '';
      for (let s = 600; s < rd.c.len - 500; s += rand(500, 1100)) {
        const q = rd.c.at(s);
        let kind = Math.random() < w.mine ? 'mine' : Math.random() < w.repair / (w.repair + w.hab) ? 'repair' : 'hab';
        if (kind === last && Math.random() < 0.7) kind = kind === 'hab' ? 'repair' : 'hab';
        const scale = rand(0.8, 1.1), half = (STRUCT_SIZE[kind] / 2) * scale * 0.95;
        const side = Math.random() < 0.5 ? -1 : 1, d = (SIGN_BAND + half + rand(0, 140)) * side;
        const x = q.x - Math.sin(q.h) * d, y = q.y + Math.cos(q.h) * d;
        if (!clear(rd, x, y, half)) continue;
        const key = 'st_' + kind + Math.floor(Math.random() * STRUCT_VARIANTS);
        // face the road, with a little jitter so rows never line up perfectly
        const rot = q.h + (side > 0 ? -Math.PI / 2 : Math.PI / 2) + rand(-0.3, 0.3) + (Math.random() < 0.25 ? Math.PI : 0);
        const im = this.add.image(x, y, key).setRotation(rot).setDepth(3.2).setScale(scale);
        (im as any).spin = 0;
        this.layer.add(im); this.rocks.push(im);
        placed.push({ x, y, r: half });
        last = kind;
        // mining stations get a scatter of spoil rock on their far side; habitats sometimes a garden platform
        if (kind === 'mine' && Math.random() < 0.6) for (let i = 0; i < 5; i++) { const a = rand(0, Math.PI * 2), r = rand(half + 40, half + 200); const rx = x + Math.cos(a) * r, ry = y + Math.sin(a) * r; if (Math.abs(rd.c.nearest(rx, ry).d) > SIGN_BAND - 60) addRock(rx, ry, rand(0.4, 1)); }
        if (kind === 'hab' && Math.random() < 0.4) { const a = q.h + (side > 0 ? Math.PI / 2 : -Math.PI / 2) + rand(-0.5, 0.5), r = half + 120; const gx = x + Math.cos(a) * r, gy = y + Math.sin(a) * r; if (clear(rd, gx, gy, 70)) { const gi = this.add.image(gx, gy, 'd_garden').setRotation(rand(0, 6)).setDepth(3).setScale(0.7); (gi as any).spin = 0; this.layer.add(gi); this.rocks.push(gi); placed.push({ x: gx, y: gy, r: 70 }); } }
      }
    }
    // roadside decor: satellites, buoys, little garden platforms, parked freighters
    const kinds = ['d_sat', 'd_buoy', 'd_dome', 'd_freighter', 'd_garden', 'd_buoy'];
    for (const rd of this.net.roads) {
      for (let s = 400; s < rd.c.len; s += rand(500, 1100)) {
        const q = rd.c.at(s);
        const side = Math.random() < 0.5 ? -1 : 1, d = rand(330, 1100) * side;
        const x = q.x - Math.sin(q.h) * d, y = q.y + Math.cos(q.h) * d;
        if (!free(x, y) || placed.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + 160)) continue;
        const k = pick(kinds);
        const im = this.add.image(x, y, k).setRotation(rand(0, 6)).setDepth(3).setScale(k === 'd_freighter' ? rand(0.9, 1.4) : rand(0.6, 1.1));
        (im as any).spin = k === 'd_sat' || k === 'd_buoy' ? rand(-0.15, 0.15) : 0;
        this.layer.add(im); this.rocks.push(im);
        placed.push({ x, y, r: 90 });
      }
    }
    // ambient flyers off the highway
    for (let i = 0; i < 12; i++) {
      const key = Math.random() < 0.6 ? 'mite' + Math.floor(Math.random() * 6) : 'van' + Math.floor(Math.random() * 6);
      const img = this.add.image(0, 0, key).setScale(0.65).setDepth(16.5);
      const sh = this.add.image(0, 0, key).setScale(0.65).setDepth(16.4).setTint(0x000000).setAlpha(0.25);
      this.layer.add(sh); this.layer.add(img);
      this.flyers.push({ img, sh, x: 1e9, y: 1e9, h: 0, v: rand(160, 320), a: 0 });
    }
  }
  private layoutStars() {
    const d = Math.hypot(this.scale.width, this.scale.height) + 40;
    this.stars.setSize(d, d);
    this.stars.setPosition(this.scale.width / 2, this.scale.height / 2);
    this.stars.setOrigin(0.5);
  }

  // ----------------------------------------------------------- sat-nav map
  private buildMap() {
    // bake the static map once into a texture (drawn every frame by the sat-nav camera)
    const S = 0.06, X0 = -22000, Y0 = -20000, TW = Math.ceil(44000 * S), TH = Math.ceil(40000 * S);
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const T = (pts: Pt[]) => pts.map((q) => ({ x: (q.x - X0) * S, y: (q.y - Y0) * S }));
    for (const pass of [0, 1]) for (const seg of this.net.segs) {
      const w = seg.kind === 'motorway' ? 150 : seg.kind === 'avenue' ? 90 : 70;
      if (pass === 0) g.lineStyle((w + 60) * S, 0x0a1128, 1); else g.lineStyle(w * S, seg.kind === 'avenue' ? 0x3d4870 : 0x6576a8, 1);
      g.strokePoints(T(seg.path.pts(0, seg.len, 0, 80)) as Phaser.Types.Math.Vector2Like[], false, false);
    }
    for (const sv of this.net.services) { const q = T([sv])[0]; g.fillStyle(0x2f7de1, 1); g.fillCircle(q.x, q.y, 260 * S); g.fillStyle(0xffffff, 1); g.fillCircle(q.x, q.y, 110 * S); }
    for (const st of this.net.stations) { const q = T([st])[0]; g.fillStyle(st.color, 1); g.fillCircle(q.x, q.y, 900 * S); g.fillStyle(0x0c1534, 1); g.fillCircle(q.x, q.y, 500 * S); }
    const rt = this.add.renderTexture(X0, Y0, TW, TH).setOrigin(0, 0);
    rt.draw(g); g.destroy();
    rt.setScale(1 / S);
    this.mapLayer.add(rt);
    for (const st of this.net.stations) {
      const t = this.add.text(st.x, st.y, st.name, { fontFamily: '"Trebuchet MS", Arial', fontSize: '48px', fontStyle: 'bold', color: '#ffffff', stroke: '#0c1534', strokeThickness: 10 }).setOrigin(0.5);
      this.mapLayer.add(t); this.mapLabels.push(t);
    }
    this.routeG = this.add.graphics(); this.mapLayer.add(this.routeG);
    this.mapMarker = this.add.graphics(); this.mapLayer.add(this.mapMarker);
    this.mapArrow = this.add.image(0, 0, 'navarrow'); this.mapLayer.add(this.mapArrow);
  }
  setNavRect(x: number, y: number, size: number) {
    this.minicam.setViewport(Math.round(x), Math.round(y), Math.round(size), Math.round(size));
    const mg = this.make.graphics({ x: 0, y: 0 }, false);
    mg.fillStyle(0xffffff, 1); mg.fillCircle(x + size / 2, y + size / 2, size / 2 - 1);
    this.minicam.setMask(mg.createGeometryMask(), true);
    this.miniZoom = size / 4200;
    this.minicam.setZoom(this.miniZoom);
  }
  private drawRoute() {
    const g = this.routeG; g.clear();
    this.mapMarker.clear();
    const p = this.player;
    if (!p.goal) return;
    const pts = this.net.routePoints({ trans: p.route, goal: p.goal, cost: 0 }, p.seg, p.s, 260);
    if (pts.length < 2) return;
    g.lineStyle(150, 0x0c1534, 1); g.strokePoints(pts as Phaser.Types.Math.Vector2Like[], false, false);
    g.lineStyle(100, 0x3ff0ff, 1); g.strokePoints(pts as Phaser.Types.Math.Vector2Like[], false, false);
    const end = pts[pts.length - 1];
    g.fillStyle(0xffd23c, 1); g.fillCircle(end.x, end.y, 320); g.fillStyle(0x0c1534, 1); g.fillCircle(end.x, end.y, 140);
  }

  // ----------------------------------------------------------- vehicle visuals
  private addVis(v: Veh) {
    const vis: Vis = { units: [], shadows: [] };
    v.gfx = vis;
    this.buildUnits(v);
  }
  private buildUnits(v: Veh) {
    const vis = v.gfx as Vis;
    for (const u of [...vis.units, ...vis.shadows]) u.destroy();
    vis.units = []; vis.shadows = [];
    const keys: string[] = [];
    if (v.type === 'mite') keys.push('mite' + v.variant);
    else if (v.type === 'pod') keys.push('pod' + v.variant);
    else if (v.type === 'sport') keys.push('sport' + v.variant);
    else if (v.type === 'taxi') keys.push('taxi');
    else if (v.type === 'bus') keys.push('bus' + (v.variant % 3));
    else if (v.type === 'tow') keys.push('tow');
    else if (v.type === 'van') keys.push('van' + v.variant);
    else if (v.type === 'police') keys.push('police');
    else if (v.type === 'player') keys.push('cab_player');
    else if (v.type === 'shuttle') keys.push('shuttle' + (v.variant % 3));
    else if (v.type === 'tanker') keys.push('cab_tank');
    else if (v.type === 'long' || v.type === 'train') keys.push('cabh' + v.variant);
    else keys.push('cab' + v.variant);
    const style = v.type === 'player' ? (G.job ? TRAILER_FOR[G.job.from] ?? 0 : 0) : v.type === 'tanker' ? 6 : [0, 1, 2, 3, 4, 5, 7][(v.variant + v.id) % 7];
    for (const t of v.trailers) keys.push(trailerTex(this, t, v.type === 'player' && G.job ? (G.job.cls === 3 ? 5 : style) : style));
    for (const k of keys) {
      const sh = this.add.image(0, 0, k).setScale(0.5).setTint(0x000000).setAlpha(0.3);
      const im = this.add.image(0, 0, k).setScale(0.5);
      this.layer.add(sh); this.layer.add(im);
      vis.shadows.push(sh); vis.units.push(im);
    }
    // put the new images where the ship is right away: left at the origin they showed there for a frame
    this.placeVis(v, vis);
  }
  private removeVis(v: Veh) {
    const vis = v.gfx as Vis | null;
    if (!vis) return;
    for (const u of [...vis.units, ...vis.shadows]) u.destroy();
    v.gfx = null;
  }
  refreshPlayerVis() {
    const p = this.player;
    const tr = G.job && G.job.stage === 'deliver' ? CLASSES[G.job.cls].trailers : [];
    p.setTrailers(tr);
    if (!p.gfx) this.addVis(p); else this.buildUnits(p);
  }

  // ----------------------------------------------------------- player control API
  setSpeed(k: number) {
    if (G.mode !== 'drive') return;
    if (this.player.state === 'crashed') { toast('Hold tight — the crew is on its way', '#ffd27a', 1500); return; }
    if (G.speedSet === 0) bus.emit('hintHide');
    G.speedSet = k;
    if (G.braking) { G.braking = false; this.autoHold = false; }
    if (this.pstate === 'parked') { this.pstate = 'drive'; this.leavingLayby = true; if (this.laybySlot) this.laybySlot.occ = null; this.laybySlot = null; toast('Pulling out of the lay-by'); }
    sfx.click();
  }
  toggleBrake() {
    if (G.mode !== 'drive' || this.player.state === 'crashed') return;
    G.braking = !G.braking;
    if (!G.braking) { this.autoHold = false; if (G.speedSet === 0) G.speedSet = 2; }
    sfx.click();
  }
  laneChange(d: number) {
    if (G.mode !== 'drive' || this.pstate === 'pulled' || this.pstate === 'fuel' || this.pstate === 'docked' || this.player.state === 'crashed') return;
    const p = this.player, seg = p.seg, n = seg.lanes;
    if (seg.kind !== 'motorway') { toast('Stay on the slip road for now', '#ffd27a', 1600); return; }
    const base = p.pend ?? p.lane;
    const tgt = base + d;
    if (tgt >= 0 && tgt < n) {
      if (this.traffic.laneClosed(seg, tgt, p.s)) { toast('That lane is coned off ahead', '#ffd27a', 1500); sfx.warn(); return; }
      const so = this.squeezeOffer;
      if (so && so.dir === d && this.clk - so.t < 4 && p.pend === null) { p.squeeze = true; this.squeezeOffer = null; toast('Squeezing in — watch the other ships!', '#ffb4a0', 1500); }
      this.traffic.ask(p, tgt, true); p.state = 'drive'; sfx.whoosh(); return;
    }
    if (tgt === n || tgt === -1) {
      const side = tgt < 0 ? -1 : 1;
      const z = seg.auxAt(p.s + 40, side) || seg.auxAt(p.s, side);
      if (z && (z.type === 'exit' || z.type === 'layby') && p.s < z.s1 - 40) { this.traffic.ask(p, tgt, true); sfx.whoosh(); return; }
      const soon = seg.aux.find((a) => a.side === side && (a.type === 'exit' || a.type === 'layby') && a.s0 > p.s && a.s0 - p.s < 1100);
      if (soon) { this.armed = soon; toast('Exit lane coming up — your rig will move over when it opens', '#9fe9ff', 2200); sfx.click(); }
      else toast(side > 0 ? 'No lane to the right here' : 'No lane to the left here', '#ffd27a', 1400);
    }
  }

  // PlayerCtl
  desired(v: Veh): number {
    if (v.state === 'crashed') return 0;
    if (this.pstate === 'docked' || this.pstate === 'fuel' || this.pstate === 'pulled' || this.pstate === 'parked') return 0;
    if (G.braking) return 0;
    const cab = cabSpeed();
    let vd = SPEEDS[G.speedSet] * cab;
    const seg = v.seg;
    if (seg.kind !== 'motorway') vd = Math.min(vd, SPEEDS[seg.limit] * cab);
    if (G.fuel <= 0) vd = Math.min(vd, SPEEDS[1]);
    if (this.pstate === 'docking') vd = Math.min(vd, 170);
    if (this.pstate === 'park') vd = Math.min(vd, 150);
    return vd;
  }
  extraGap(v: Veh): number {
    if (this.pstate === 'docking') { const d = this.dockS.get(v.seg); if (d !== undefined) return d - v.s; }
    if (this.pstate === 'park') { const z = v.seg.auxAt(v.s, 1); if (this.laybySlot) return this.laybySlot.s - v.s; if (z) return z.s1 - 20 - v.s; }
    return Infinity;
  }
  obeySignal(_v: Veh, _st: Stop, state: 'G' | 'A' | 'R'): boolean { return (G.braking || this.autoHold) && state !== 'G'; }
  brakeMin(v: Veh): number | null {
    if (v.state === 'crashed') return v.v > 0 ? -430 : null;
    if (!G.braking) return null;
    for (const st of v.seg.stops) { const d = st.s - v.s; if (d > -1 && d < 1000 && st.sig.state(st.group) !== 'G') return Math.min(-30, -(v.v * v.v) / (2 * Math.max(30, d - 12)) * 0.6); }
    return v.v > 0 ? -260 : null;
  }
  onTrans(v: Veh, t: Trans) {
    if (t.type === 'exit') {
      this.favours.onExit(t);
      if (t.svc) toast(`Pulling into ${t.svc.name}`, '#9fe9ff');
      else if (t.kind === 'uturn') toast('Turning back', '#9fe9ff');
      else toast(`Exit towards ${t.label}`, '#9fe9ff');
    } else if (t.type === 'merge') {
      hint('merge', 'Merging: your rig slides into traffic by itself when there is a gap — just keep your speed.');
    }
    if (v.route[0] !== t) this.computeRoute(false);
  }
  onBlocked(kind: 'busy' | 'nolane' = 'nolane', dir = 0) {
    if (kind === 'busy' && dir !== 0) {
      this.squeezeOffer = { dir, t: this.clk };
      toast('Lane not clear — press again to squeeze in (risky!)', '#ffd27a', 2400);
    } else toast('Lane not clear — try again in a moment', '#ffd27a', 1500);
    sfx.warn();
  }

  // ----------------------------------------------------------- crashes and bumps
  private onPlayerCrashed(inc: Incident, atFault: boolean, _other: Veh | null, fee: number) {
    const p = this.player;
    G.money = Math.max(0, G.money - fee); G.fines += fee; save();
    G.braking = true; G.speedSet = 0; this.autoHold = false; this.armed = null;
    if (G.job) G.job.delayed = true;
    sfx.crash(); this.cameras.main.shake(420, 0.008);
    const who = inc.waitFor ? 'The crew will finish at the scene ahead, then come to you' : 'Police and a repair truck are coming';
    toast(atFault ? `💥 Accident! ${money(fee)} paid. ${who} — your delivery clock is paused.` : `💥 Accident — not your fault! ${who} — your delivery clock is paused.`, '#ffb4b4', 6000);
    hint('crash', 'After a crash, both ships wait for police and a repair truck. Your delivery clock stops while you wait, and you get a little extra time when you set off.');
    if (inc.waitFor || _other && (_other.state === 'crashed' || _other.state === 'broken')) hint('wreck', 'You hit a vehicle that was already stopped. Watch the sat-nav for coned-off lanes and move over early — the police deal with one scene at a time.');
    (window as any).Tesana.gameplay.death({ levelId: G.job ? G.job.id : 'free-roam', x: p.x, y: p.y, name: 'accident' });
  }
  private onPlayerReleased(inc: Incident) {
    G.braking = false; if (G.speedSet === 0) G.speedSet = 3;
    if (G.job) { G.job.target += 25; }
    if (inc.kind === 'breakdown') {
      // the rescue truck leaves exactly a quarter of a tank, whatever its size
      G.fuel = 0.25;
      save();
      this.computeRoute(false);
      toast(G.job ? `Rescued — the truck left you a quarter tank (${Math.round(G.fuel * 100)}%). Delivery clock was paused and you get +0:25 extra time.` : `Rescued — the truck left you a quarter tank (${Math.round(G.fuel * 100)}%). Find a fuel stop soon!`, '#7ff0c0', 5500);
      (window as any).Tesana?.track?.('fuel_rescue', {});
    } else toast(G.job ? 'All fixed — back on the road! Your delivery clock was paused and you get +0:25 extra time.' : 'All fixed — back on the road!', '#7ff0c0', 5000);
    sfx.chime();
  }
  // ----------------------------------------------------------- running out of fuel
  /** the tank just hit zero: strand the rig now if we can, otherwise limp on reserve until a running lane allows it */
  private onFuelOut() {
    sfx.warn();
    if (this.strand()) return;
    toast('Out of fuel! Limping on reserve — you will break down on the motorway', '#ff8a7a', 5000);
  }
  /** breakdown for an empty tank; Incidents refuses duplicates and off-motorway spots, so this is safe to call every frame */
  private strand(): boolean {
    // not while docking, parking, refuelling or pulled over by police: those flows own the rig until they finish
    if (this.pstate !== 'drive') return false;
    const inc = this.inc.playerBreakdown();
    if (!inc) return false;
    const p = this.player;
    G.braking = true; G.speedSet = 0; this.autoHold = false; this.armed = null; this.squeezeOffer = null;
    if (G.job) G.job.delayed = true;
    toast('⛽ Out of fuel! Police and a rescue truck are coming — your delivery clock is paused.', '#ffb4b4', 6000);
    hint('fuelout', 'An empty tank is a breakdown: wait for the police and the rescue truck. They leave you a quarter of a tank — head for the nearest fuel stop.');
    (window as any).Tesana?.track?.('fuel_out', { x: p.x, y: p.y });
    return true;
  }
  baseAMax = 0;
  /** push the garage upgrades onto the player's rig */
  applyUpgrades() {
    if (this.baseAMax > 0) this.player.aMax = this.baseAMax * cabAccel();
  }
  private onBump(fee: number, atFault: boolean, saved = false) {
    G.money = Math.max(0, G.money - fee); G.fines += fee; save();
    sfx.bump(); this.cameras.main.shake(160, 0.004);
    if (saved) toast(atFault ? `Your sturdy bumpers took a big hit — no accident! ${money(fee)} repair fee` : 'Your sturdy bumpers took a big hit — no accident, and no charge', '#9fe9ff', 3600);
    else toast(atFault ? `Bump! Small scrape — ${money(fee)} repair fee` : 'Bump! The other ship cut in — no charge', '#ffd27a', 3200);
    (window as any).Tesana?.track?.('bump', { fee, atFault });
  }
  onRouteNeeded(_v: Veh) { this.computeRoute(false); }

  // ----------------------------------------------------------- jobs & routing
  goals() {
    if (this.fuelTarget) return [{ seg: this.fuelTarget.seg, s: this.fuelTarget.pumpS }];
    if (G.job) return this.net.stationGoals(this.net.byId[G.job.stage === 'pickup' ? G.job.from : G.job.to]);
    return [];
  }
  computeRoute(announce: boolean) {
    const p = this.player;
    const goals = this.goals();
    if (!goals.length) { p.route = []; p.goal = null; this.drawRoute(); return; }
    const side = p.lane >= p.seg.lanes ? 1 : p.lane < 0 ? -1 : 0;
    const r = this.net.route(p.seg, p.s, goals, side);
    p.route = r ? r.trans : [];
    p.goal = r ? r.goal : null;
    if (!r && this.fuelTarget) { this.fuelTarget = null; this.computeRoute(announce); return; }
    if (announce) toast('Route updated', '#9fe9ff', 1400);
    this.drawRoute();
  }
  private computeCosts() {
    for (const a of this.net.stations) for (const b of this.net.stations) {
      if (a === b) continue;
      let best = Infinity;
      for (const seg of a.dep) { const r = this.net.route(seg, 100, this.net.stationGoals(b)); if (r && r.cost < best) best = r.cost; }
      this.costs[a.id + '>' + b.id] = best;
    }
  }
  makeJobs(st: Station): Job[] {
    const rank = rankOf(G.earned);
    const first = G.deliveries === 0;
    let others: Station[] = Phaser.Utils.Array.Shuffle(this.net.stations.filter((o) => o !== st));
    if (first) others = others.sort((a, b) => (this.costs[st.id + '>' + a.id] ?? 0) - (this.costs[st.id + '>' + b.id] ?? 0));
    const jobs: Job[] = [];
    for (let i = 0; i < 3; i++) {
      const remote = !first && i === 2 && Math.random() < 0.65;
      let from = st, to = others[i % others.length];
      if (remote) { from = others[0]; to = pick(this.net.stations.filter((o) => o !== from)); }
      let cls = first ? 0 : Math.min(3, Math.floor(Math.random() * (rank + 2)));
      if (i === 0) cls = Math.min(cls, rank);
      const dist = this.costs[from.id + '>' + to.id] + (remote ? this.costs[st.id + '>' + from.id] : 0);
      const pay = Math.round(((80 + (dist / 1000) * 15) * CLASSES[cls].mult * (remote ? 1.2 : 1)) / 5) * 5;
      jobs.push({
        id: `${from.id}-${to.id}`, cargo: pick(CARGO[from.id]), from: from.id, to: to.id, cls, pay, dist,
        stage: from === st ? 'deliver' : 'pickup', target: dist / 225 + 45, elapsed: 0,
        locked: CLASSES[cls].rank > rank, remote,
      });
    }
    return jobs;
  }
  acceptJob(job: Job) {
    G.job = job;
    G.mode = 'drive';
    const tesana = (window as any).Tesana;
    tesana?.gameplay?.levelStart({ levelId: job.id, levelIndex: G.deliveries });
    this.refreshPlayerVis();
    const target = job.stage === 'pickup' ? job.from : job.to;
    this.depart(this.station!, target);
    if (job.stage === 'pickup') toast(`Head to ${this.net.byId[job.from].name} to collect the load`, '#9fe9ff', 4000);
    else toast(`Loaded ${job.cargo} — deliver to ${this.net.byId[job.to].name}`, '#9fe9ff', 4000);
    hint('start', 'Pick a speed (1–5) at the bottom of the screen, or press a number key, to pull away.');
  }
  depart(st: Station, targetId: string, auto = false) {
    let best = st.dep[0], bc = Infinity;
    const goals = this.net.stationGoals(this.net.byId[targetId]);
    for (const seg of st.dep) { const r = this.net.route(seg, 150, goals); if (r && r.cost < bc) { bc = r.cost; best = seg; } }
    const p = this.player;
    // only remove ships the rig would be dropped onto; the rest of the dock traffic stays and the player joins the queue
    const lane = best.lanes - 1, lat = best.laneLat(lane);
    for (const v of this.traffic.vs) if (!v.isPlayer && v.seg === best && Math.abs(v.lat - lat) < LW * 0.9 && v.s > 150 - p.totLen - 30 && v.s - v.totLen < 150 + 30) v.dead = true;
    p.seg = best; p.s = 150; p.lane = best.lanes - 1; p.lat = best.laneLat(p.lane); p.v = 0; p.pend = null; p.sig = 0; p.state = 'drive';
    p.resetTrail(); p.prevSeg = best; p.prevS = 150; p.enterS = 150;
    this.pstate = 'drive';
    G.braking = !auto; G.speedSet = auto ? 3 : 0; this.autoHold = false;
    this.camH = best.path.at(150).h;
    this.station = null;
    this.computeRoute(false);
  }
  // ----------------------------------------------------------- passengers
  /** little figures waiting beside the lay-by slots */
  private drawPax(lb: Layby) {
    const g = this.paxG.get(lb); if (!g) return;
    g.clear();
    const seg = lb.seg, lat = seg.laneLat(seg.lanes) + LW / 2 + 22;
    for (let i = 0; i < lb.waiting; i++) {
      const q = seg.path.at(lb.aux.s0 + 150 + i * 46, lat + (i % 2) * 10);
      g.fillStyle(0x000000, 0.3); g.fillCircle(q.x + 3, q.y + 4, 7);
      g.fillStyle([0xffb03c, 0x7ff0c0, 0xf15bb5, 0x8e8ff0][i % 4], 1); g.fillCircle(q.x, q.y, 7);
      g.fillStyle(0xffe9c4, 1); g.fillCircle(q.x, q.y, 3.5);
    }
    if (lb.waiting > 0) { const q = seg.path.at(lb.aux.s0 + 150 + lb.waiting * 23 - 23, lat + 34); g.fillStyle(0x1f5fb8, 1); g.fillRoundedRect(q.x - 14, q.y - 8, 28, 16, 4); g.fillStyle(0xffffff, 1); g.fillCircle(q.x - 5, q.y - 1, 2.5); g.fillCircle(q.x + 5, q.y - 1, 2.5); g.fillRect(q.x - 7, q.y + 2, 14, 3); }
  }
  /** called when the rig has come to rest in a lay-by; returns true if anyone got on */
  private boardPassengers(lb: Layby): boolean {
    const seats = PAX_MAX - G.pax;
    if (lb.waiting <= 0) { if (G.pax > 0) toast(`Nobody waiting here. ${G.pax} aboard for ${this.nextStationName()}.`, '#9fe9ff', 3500); return false; }
    if (seats <= 0) { toast(`Cab is full — ${PAX_MAX} passengers aboard. Drop them at ${this.nextStationName()} first.`, '#ffd27a', 4000); return false; }
    const n = Math.min(seats, lb.waiting);
    lb.waiting -= n; G.pax += n; if (!G.paxFrom) G.paxFrom = lb.name;
    if (lb.waiting === 0) lb.refillT = 120 + Math.random() * 120;
    this.drawPax(lb);
    sfx.chime();
    toast(`${n} passenger${n > 1 ? 's' : ''} climbed aboard (${G.pax}/${PAX_MAX}). They want the next station: ${this.nextStationName()}. ${money(PAX_PAY)} each on arrival.`, '#7ff0c0', 5000);
    hint('pax', `Hitch-hikers wait at lay-bys. Pull in, let them board, and every one of them pays ${money(PAX_PAY)} when you dock at the next station. Up to ${PAX_MAX} per trip.`);
    return true;
  }
  /** pay out everyone aboard; runs once per docking */
  private dropPassengers(st: Station) {
    const n = G.pax; if (n <= 0) return;
    const fare = n * PAX_PAY;
    G.pax = 0; G.paxFrom = '';
    G.money += fare; G.earned += fare; save();
    sfx.coin();
    toast(`${n} passenger${n > 1 ? 's' : ''} dropped off at ${st.name} — fares paid: +${money(fare)}`, '#7ff0c0', 5000);
  }
  /** the station the rig will reach next, following the planned route or the road straight ahead */
  nextStationName(): string {
    const p = this.player;
    let seg: Seg | null = p.seg;
    for (let i = 0; i < 24 && seg; i++) {
      if (seg.arrStation) return seg.arrStation.name;
      const cur: Seg = seg;
      const t: Trans | null = p.route.find((r) => r.from === cur) ?? cur.endT;
      seg = t ? t.to : null;
    }
    return 'the next station';
  }
  private onDocked() {
    const st = this.net.stations.find((s) => s.arr.includes(this.player.seg))!;
    this.station = st;
    this.pstate = 'docked';
    this.favours.onDocked(st);
    G.braking = true; G.speedSet = 0;
    sfx.dock();
    this.dropPassengers(st);
    const job = G.job;
    const tesana = (window as any).Tesana;
    if (job && job.stage === 'deliver' && job.to === st.id) {
      const bonus = job.elapsed <= job.target ? Math.round(job.pay * 0.2) : 0;
      const total = job.pay + bonus;
      const oldRank = rankOf(G.earned);
      G.money += total; G.earned += total; G.deliveries++;
      tesana?.gameplay?.levelComplete({ levelId: job.id });
      G.job = null;
      this.fuelTarget = null;
      this.computeRoute(false);
      this.refreshPlayerVis();
      sfx.chime(); setTimeout(() => sfx.coin(), 450);
      const newRank = rankOf(G.earned);
      save();
      G.mode = 'board';
      bus.emit('board', st, this.makeJobs(st), { cargo: job.cargo, pay: job.pay, bonus, rankUp: newRank > oldRank ? RANKS[newRank].name : null });
      return;
    }
    if (job && job.stage === 'pickup' && job.from === st.id) {
      job.stage = 'deliver';
      tesana?.gameplay?.checkpoint({ levelId: job.id, name: 'pickup' });
      this.refreshPlayerVis();
      toast(`Loaded ${job.cargo}! Now deliver to ${this.net.byId[job.to].name}`, '#7ff0c0', 4500);
      sfx.coin();
      this.after(1.8, () => this.depart(st, job.to, true));
      return;
    }
    if (job) {
      const tgt = job.stage === 'pickup' ? job.from : job.to;
      toast(`Passing through ${st.name} — on to ${this.net.byId[tgt].name}`, '#9fe9ff', 3500);
      this.after(1.5, () => this.depart(st, tgt, true));
      return;
    }
    G.mode = 'board';
    bus.emit('board', st, this.makeJobs(st), null);
  }
  openFirstBoard() {
    G.mode = 'board';
    bus.emit('board', this.station!, this.makeJobs(this.station!), null);
  }

  // ----------------------------------------------------------- police
  private pullOver(reason: 'speed' | 'red') {
    const p = this.player;
    const rank = rankOf(G.earned);
    const warning = !G.warned;
    G.warned = true;
    const fine = warning ? 0 : reason === 'red' ? 150 + rank * 25 : 100 + rank * 25;
    G.money = Math.max(0, G.money - fine); G.fines += fine;
    save();
    this.pstate = 'pulled';
    this.holdT = warning ? 4 : 7;
    this.policeCool = 30;
    p.state = 'held';
    if (p.lane < p.seg.lanes && p.lane >= 0) this.traffic.ask(p, p.seg.lanes, true);
    sfx.siren();
    (window as any).Tesana?.track?.('police_stop', { reason, fine });
    bus.emit('police', reason === 'red' ? 'Ran a red light' : 'Speeding', fine);
    const img = this.add.image(0, 0, 'police').setScale(0.5);
    const sh = this.add.image(0, 0, 'police').setScale(0.5).setTint(0).setAlpha(0.3);
    this.layer.add(sh); this.layer.add(img);
    if (this.escort) { this.escort.img.destroy(); this.escort.sh.destroy(); }
    this.escort = { img, sh, seg: p.seg, s: p.s - p.totLen - 160, lat: p.seg.laneLat(p.seg.lanes), v: p.v, t: 0 };
  }
  private updateEscort(dt: number) {
    const e = this.escort; if (!e) return;
    const p = this.player;
    e.t += dt;
    if (this.pstate === 'pulled' && e.seg === p.seg) {
      const target = p.s - p.totLen - 40;
      e.v = clamp((target - e.s) * 2 + p.v, 0, 520);
    } else { e.v = Math.min(480, e.v + 220 * dt); }
    e.s += e.v * dt;
    if (e.s > e.seg.len - 10) e.s = e.seg.len - 10;
    const q = e.seg.path.at(e.s, e.lat);
    e.img.setPosition(q.x, q.y).setRotation(q.h).setDepth(DEPTH.veh(0) + 0.1);
    e.sh.setPosition(q.x + 5, q.y + 7).setRotation(q.h).setDepth(DEPTH.veh(0));
    const blink = Math.floor(this.clk * 6) % 2;
    const g = this.fxTop;
    const ox = -Math.sin(q.h) * 6, oy = Math.cos(q.h) * 6;
    g.fillStyle(blink ? 0xff3344 : 0x3366ff, 0.8); g.fillCircle(q.x + (blink ? ox : -ox), q.y + (blink ? oy : -oy), 14);
    g.fillStyle(0xffffff, 0.9); g.fillCircle(q.x + (blink ? ox : -ox), q.y + (blink ? oy : -oy), 4);
    if (this.pstate !== 'pulled' && e.t > 0) {
      const a = Math.max(0, e.img.alpha - dt * 0.4);
      e.img.setAlpha(a); e.sh.setAlpha(a * 0.3);
      if (a <= 0) { e.img.destroy(); e.sh.destroy(); this.escort = null; }
    }
  }

  // ----------------------------------------------------------- main loop
  /** run fn after sec seconds of gameplay time (frozen while paused, unlike setTimeout) */
  after(sec: number, fn: () => void) { this.pending.push({ t: sec, fn }); }

  override update(_t: number, dms: number) {
    if (G.paused) return;
    const dt = Math.min(0.05, dms / 1000);
    for (const q of this.pending) q.t -= dt;
    const due = this.pending.filter((q) => q.t <= 0);
    if (due.length) { this.pending = this.pending.filter((q) => q.t > 0); for (const q of due) q.fn(); }
    this.clk += dt;
    this.blink += dt;
    const p = this.player;
    const prevS = p.s, prevSeg = p.seg;
    const cam = this.cameras.main;
    this.traffic.view = { x: cam.midPoint.x, y: cam.midPoint.y, r: Math.hypot(cam.width, cam.height) / 2 / this.zoomCur + 150 };
    const steps = dt > 0.025 ? 2 : 1;
    for (let i = 0; i < steps; i++) this.traffic.update(dt / steps);
    if (G.job && G.mode === 'drive' && p.state !== 'crashed') G.job.elapsed += dt;
    for (const lb of this.net.laybys) if (lb.refillT > 0) { lb.refillT -= dt; if (lb.refillT <= 0) { lb.waiting = 1 + Math.floor(Math.random() * 3); this.drawPax(lb); } }
    this.inc.update(dt, G.mode === 'drive' && this.pstate !== 'docked');
    this.playerLogic(dt, prevS, prevSeg);
    this.updateCamera(dt);
    this.updateVisuals(dt);
    const viewR = Math.hypot(cam.width, cam.height) / 2 / this.zoomCur;
    this.inc.draw(this.incG, this.fxTop, this.clk, cam.midPoint.x, cam.midPoint.y, viewR);
    this.decoG.clear(); this.landG.clear();
    this.outposts.update(this.decoG, this.fxTop, this.net, this.clk, cam.midPoint.x, cam.midPoint.y, viewR);
    this.landmarks.update(this.landG, this.fxTop, this.clk, cam.midPoint.x, cam.midPoint.y, viewR);
    this.favours.update(dt, G.mode === 'drive' && this.pstate !== 'docked' && p.state !== 'crashed');
    this.favours.draw(this.fxTop, this.clk);
    this.updateEscort(dt);
    this.drawGuide();
    this.drawSignals();
    this.updateMap(dt);
    sfx.engine(p.v, p.braking);
    sfx.tick(dt, p.sig !== 0 && G.mode === 'drive');
  }

  private playerLogic(dt: number, prevS: number, prevSeg: Seg) {
    const p = this.player, seg = p.seg;
    if (G.mode !== 'drive') return;
    // fuel use
    const ds = p.seg === prevSeg ? Math.max(0, p.s - prevS) : p.v * dt;
    if (G.fuel > 0) {
      G.fuel = Math.max(0, G.fuel - (ds / 95000) * (1 + 0.12 * p.trailers.length) / tankMult());
      if (G.fuel <= 0) this.onFuelOut();
    }
    // a tank that ran dry off the motorway (slip road, services, lay-by) strands the rig as soon as it is back in a running lane
    if (G.fuel <= 0 && this.pstate === 'drive' && p.state !== 'crashed' && !this.inc.playerIncident()) this.strand();
    if (G.fuel < 0.3 && !this.fuelTarget && !seg.svc && seg.kind !== 'services' && !(seg.kind === 'ramp' && seg.endT?.to.svc) && this.clk - this.lastLowWarn > 6) {
      this.lastLowWarn = this.clk;
      let best: Services | null = null, bc = Infinity;
      const side = p.lane >= seg.lanes ? 1 : p.lane < 0 ? -1 : 0;
      const after = G.job ? this.net.stationGoals(this.net.byId[G.job.stage === 'pickup' ? G.job.from : G.job.to]) : null;
      for (const sv of this.net.services) {
        const r = this.net.route(seg, p.s, [{ seg: sv.seg, s: sv.pumpS }], side);
        if (!r) continue;
        let c = r.cost * 1.5;
        if (after) { const r2 = this.net.route(sv.seg, sv.pumpS, after); c += r2 ? r2.cost : 1e6; }
        if (c < bc) { bc = c; best = sv; }
      }
      if (best) {
        this.fuelTarget = best;
        this.computeRoute(false);
        toast(`Fuel getting low — sat-nav is guiding you to ${best.name}`, '#9fe9ff', 4500);
        hint('fuel', 'Low fuel: follow the blue fuel signs. Move into the exit lane when the sat-nav says, and your rig will pull up at a free pump by itself.');
        sfx.warn();
      }
    }
    // services: refuel at the pump
    if (seg.svc && p.pump >= 0 && !p.pumpDone && p.v < 3 && p.s > seg.svc.pumpS - 20 && this.pstate === 'drive') {
      this.pstate = 'fuel'; this.fuelSpend = 0;
      toast('Refuelling…', '#9fe9ff', 2000);
    }
    if (this.pstate === 'fuel') {
      const add = Math.min(1 - G.fuel, dt * 0.2);
      G.fuel += add;
      const cost = add * 100 * FUEL_PRICE * tankMult();
      this.fuelSpend += cost;
      G.money = Math.max(0, G.money - cost);
      if (Math.random() < dt * 4) sfx.fuel();
      if (G.fuel >= 0.999) {
        G.fuel = 1; p.pumpDone = true; this.pstate = 'drive';
        toast(`Tank full — paid ${money(this.fuelSpend)}. Off you go!`, '#7ff0c0', 3500);
        sfx.coin();
        (window as any).Tesana?.gameplay?.checkpoint({ levelId: G.job ? G.job.id : 'free-roam', name: 'fuel' });
        this.fuelTarget = null;
        save();
        this.computeRoute(false);
      }
    }
    // docking
    const dS = this.dockS.get(seg);
    if (dS !== undefined && this.pstate === 'drive' && p.s > dS - 1300) {
      this.pstate = 'docking';
      toast(`Docking at ${seg.arrStation!.name}…`, '#9fe9ff', 2500);
    }
    if (this.pstate === 'docking' && dS !== undefined && p.v < 4 && p.s > dS - 40 && p.state !== 'crashed') this.onDocked();
    // armed exit: move over as soon as the exit lane opens
    if (this.armed) {
      const a = this.armed, n = seg.lanes;
      const edge = a.side > 0 ? n - 1 : 0;
      if (!seg.aux.includes(a) || p.s > a.s1 - 60) this.armed = null;
      else if (p.pend === null && p.s >= a.s0 + 5) {
        if (p.lane === edge) { this.traffic.ask(p, a.side > 0 ? n : -1, true); this.armed = null; }
        else if (p.lane >= 0 && p.lane < n) this.traffic.ask(p, p.lane + a.side, true);
      }
    }
    // lay-by & merging back
    if (seg.kind === 'motorway' && (p.lane >= seg.lanes || p.lane < 0) && Math.abs(p.lat - p.targetLat()) < 2) {
      const side = p.lane < 0 ? -1 : 1;
      const z = seg.auxAt(p.s, side);
      if (z && z.type === 'layby' && this.pstate === 'drive' && !this.leavingLayby) {
        this.pstate = 'park';
        this.laybySlot = z.slots!.find((sl) => !sl.occ && sl.s > p.s + 40) ?? null;
        if (this.laybySlot) this.laybySlot.occ = p;
        toast('Pulling into the lay-by', '#9fe9ff', 1800);
      } else if (this.pstate === 'drive' && !(z && z.type === 'exit') && p.pend === null) {
        this.traffic.ask(p, side > 0 ? seg.lanes - 1 : 0, true);
        if (Math.random() < 0.02) hint('auto-merge', 'Your rig merges back into traffic automatically when a gap opens.');
      }
    } else if (p.lane < seg.lanes && p.lane >= 0) this.leavingLayby = false;
    if (this.pstate === 'park' && p.v < 3 && this.extraGap(p) < 30) {
      this.pstate = 'parked'; G.braking = true; G.speedSet = 0;
      const lb = this.net.laybys.find((l) => l.seg === seg && p.s >= l.aux.s0 - 20 && p.s <= l.aux.s1 + 20);
      if (!lb || !this.boardPassengers(lb)) toast('Taking a break. Pick a speed when you are ready to pull out.', '#9fe9ff', 4000);
    }
    // police hold
    if (this.pstate === 'pulled') {
      if (p.v < 3) this.holdT -= dt;
      if (this.holdT <= 0) {
        this.pstate = 'drive'; p.state = 'drive';
        if (G.speedSet === 0) G.speedSet = 3;
        G.braking = false;
        toast('Drive safely! Merging back into traffic.', '#7ff0c0', 3000);
      }
    }
    this.policeCool -= dt;
    // speed enforcement
    this.limit = seg.limitAt(p.s);
    const over = seg.kind === 'motorway' && p.v > SPEEDS[this.limit] * cabSpeed() + 24 && p.lane < seg.lanes && p.lane >= 0;
    this.overT = over ? this.overT + dt : 0;
    this.overWarnT -= dt;
    if (over && this.overWarnT <= 0 && this.overT > 0.8) {
      this.overWarnT = 25;
      toast(`Speed limit here is ${this.limit} — police patrol these roads`, '#ffd27a', 3200);
    }
    if (this.policeCool <= 0 && this.pstate === 'drive' && over) {
      const nearCam = this.net.cameras.some((c) => c.seg === seg && Math.abs(c.s - p.s) < 260);
      const nearCop = this.traffic.vs.some((o) => o.type === 'police' && Math.hypot(o.x - p.x, o.y - p.y) < 650);
      if ((nearCam && this.overT > 0.3) || (nearCop && this.overT > 1.2)) this.pullOver('speed');
    }
    // red lights
    this.redAhead = false;
    for (const st of seg.stops) {
      const state = st.sig.state(st.group);
      if (seg === prevSeg && prevS < st.s && p.s >= st.s && state === 'R' && this.pstate === 'drive' && this.policeCool <= 0) this.pullOver('red');
      const d = st.s - p.s;
      if (d > 0 && d < 850 && state !== 'G' && !G.braking) this.redAhead = true;
      if (this.autoHold && state === 'G' && d > -5 && d < 1000) {
        this.autoHold = false; G.braking = false; if (G.speedSet === 0) G.speedSet = 3;
        toast('Green light — off you go', '#7ff0c0', 1600);
      }
      if (G.braking && !this.autoHold && d > 0 && d < 1000 && state !== 'G') this.autoHold = true;
    }
    if (this.redAhead) hint('red', 'Traffic lights ahead! Press B (or the brake button) and your rig stops at the line, then sets off again on green.');
    // incident awareness
    this.hazardMsg = '';
    if (seg.kind === 'motorway' && p.state !== 'crashed') {
      const hz = this.inc.hazardAhead(seg, p.s);
      if (hz) {
        const what = hz.inc.kind === 'accident' ? 'Accident' : 'Breakdown';
        if (p.lane >= 0 && p.lane < seg.lanes && this.inc.laneBlockedAhead(seg, p.lane, p.s, 2000)) this.hazardMsg = `⚠ ${what} ahead — press A or D to move over`;
        else if (this.inc.inSlowZone(seg, p.s)) this.hazardMsg = '👮 Police are directing traffic — keep it slow';
        else if (hz.d < 1800) this.hazardMsg = `⚠ ${what} ahead — a lane is coned off`;
        if (hz.d < 2200) hint('incident', 'Police have coned off a lane ahead. Watch the sat-nav — it shows which lanes are open. Press A or D to change lane; your rig slows down past the scene.');
      } else if (this.traffic.dropping(seg, p.lane, p.s) && p.pend === null) {
        this.hazardMsg = '⚠ Lane ends ahead — press A to move left';
        hint('lanedrop', 'The road narrows ahead and your lane ends. Press A to move left; if you leave it late your rig slides across by itself at the taper.');
      }
    }
    if (!this.hazardMsg) this.hazardMsg = this.favours.prompt();
    // nav info
    this.routeRedraw -= dt;
    if (this.routeRedraw <= 0) { this.routeRedraw = 1; this.drawRoute(); }
    this.nav = this.computeNav();
  }

  private computeNav(): NavInfo {
    const p = this.player, seg = p.seg;
    const lanesAll: boolean[] | null = seg.kind === 'motorway' ? Array.from({ length: seg.lanes }, (_, i) => !this.traffic.dropping(seg, i, p.s) && !this.traffic.deadLane(seg, i, p.s)) : null;
    if (!p.goal) return { title: 'Free roam', sub: 'Dock at any station for new jobs', dist: 0, arrow: 0, lanes: lanesAll, aux: 0, remain: 0 };
    if (this.pstate === 'fuel') return { title: 'Refuelling', sub: 'Filling the tank…', dist: 0, arrow: 'fuel', lanes: null, aux: 0, remain: 0 };
    let d = 0, ss = p.s, next: Trans | null = null, total = 0;
    for (const t of p.route) {
      const leg = t.fromS - ss;
      if (!next) d += leg;
      total += leg;
      if (!next && (t.type === 'exit' || t.kind === 'dock')) next = t;
      ss = t.toS;
    }
    total += p.goal.s - ss;
    this.remain = total;
    const destName = this.fuelTarget ? this.fuelTarget.name : G.job ? this.net.byId[G.job.stage === 'pickup' ? G.job.from : G.job.to].name : '';
    const hz = seg.kind === 'motorway' && p.state !== 'crashed' ? this.inc.hazardAhead(seg, p.s) : null;
    if (hz && hz.d < 2200 && (!next || d > hz.d + 500)) {
      const open = Array.from({ length: seg.lanes }, (_, i) => !hz.lanes.includes(i));
      return { title: hz.inc.kind === 'accident' ? 'Accident ahead' : 'Breakdown ahead', sub: 'Police cordon — use an open lane', dist: hz.d, arrow: 'warn', lanes: open, aux: 0, remain: total };
    }
    if (!next) {
      if (seg.kind === 'ramp' && seg.endT?.type === 'merge') return { title: `Merge onto ${seg.endT.to.name}`, sub: 'Your rig finds a gap by itself', dist: seg.len - p.s, arrow: 0, lanes: null, aux: 0, remain: total };
      if (seg.svc || (seg.kind === 'ramp' && seg.endT?.to.svc)) return { title: 'Pull up at a free pump', sub: seg.svc ? 'Queue if the pumps are busy' : 'Fuel stop', dist: total, arrow: 'fuel', lanes: null, aux: 0, remain: total };
      return { title: this.fuelTarget ? destName : `Dock at ${destName}`, sub: 'Stay on this road', dist: total, arrow: 'dock', lanes: lanesAll, aux: 0, remain: total };
    }
    if (next.kind === 'dock') return { title: `Dock at ${next.label}`, sub: 'Change roads here — your rig carries on by itself', dist: d, arrow: 'dock', lanes: lanesAll, aux: 0, remain: total };
    const side = next.side;
    let title = '';
    if (next.svc) title = `Fuel stop: ${next.svc.name}`;
    else if (next.kind === 'uturn') title = `Turn back to ${next.label}`;
    else title = `${next.label}`;
    const sub = next.kind === 'uturn' ? 'Exit right, loop over the road' : `Exit ${side > 0 ? 'right' : 'left'}`;
    let lanes = lanesAll, aux = 0;
    if (next.from === seg && lanes) {
      if (d < 3200) lanes = lanes.map((_, i) => (side > 0 ? i === seg.lanes - 1 : i === 0));
      if (p.s > next.aux!.s0 - 250) aux = side;
    }
    if (seg.kind === 'ramp' && next.from !== seg) return { title: `Merge, then ${sub.toLowerCase()}`, sub: title, dist: d, arrow: 0, lanes: null, aux: 0, remain: total };
    return { title, sub, dist: d, arrow: next.kind === 'uturn' ? 'U' : side > 0 ? 45 : -45, lanes, aux, remain: total };
  }

  private updateCamera(dt: number) {
    const cam = this.cameras.main, p = this.player;
    const base = clamp(Math.min(cam.width, cam.height) / 720, 0.5, 1.6);
    const k = clamp(p.v / 345, 0, 1);
    const tz = base * (1.1 - 0.3 * k);
    this.zoomCur += (tz - this.zoomCur) * Math.min(1, dt * 1.2);
    const ph = p.seg.path.at(p.s).h;
    this.camH += angDiff(this.camH, ph) * Math.min(1, dt * 2.2);
    cam.setZoom(this.zoomCur);
    cam.setRotation(-Math.PI / 2 - this.camH);
    // screen = R(rotation) * world, so a screen-space offset is R(-rotation) in the world
    const cr = -Math.PI / 2 - this.camH, cc = Math.cos(cr), cs = Math.sin(cr);
    this.shX = { x: cc, y: -cs }; this.shY = { x: cs, y: cc };
    const ahead = (cam.height * 0.2) / this.zoomCur;
    cam.centerOn(p.x + Math.cos(this.camH) * ahead, p.y + Math.sin(this.camH) * ahead);
    // stars
    this.stars.setScale(1 / this.zoomCur);
    this.stars.tilePositionX = cam.scrollX * 0.08 * this.zoomCur;
    this.stars.tilePositionY = cam.scrollY * 0.08 * this.zoomCur;
    this.stars.tileScaleX = this.stars.tileScaleY = 1;
    // culling
    const cx = cam.midPoint.x, cy = cam.midPoint.y;
    const r = Math.hypot(cam.width, cam.height) / 2 / this.zoomCur + 80;
    for (const c of this.culls) {
      const dx = Math.max(c.x0 - cx, 0, cx - c.x1), dy = Math.max(c.y0 - cy, 0, cy - c.y1);
      c.obj.setVisible(dx * dx + dy * dy < r * r);
    }
    if (Math.floor(this.clk * 10) % 5 === 0) for (const rk of this.rocks) rk.setVisible(Math.abs(rk.x - cx) < r + 200 && Math.abs(rk.y - cy) < r + 200);
    for (const rk of this.rocks) if (rk.visible) rk.rotation += (rk as any).spin * dt;
    // flyers: ambient ships high above the scene. They fade out well before any road or station, checked every frame,
    // so they are never taken for ghost traffic crossing the carriageway.
    for (const f of this.flyers) {
      if (Math.hypot(f.x - cx, f.y - cy) > r + 900) {
        const a = rand(0, Math.PI * 2);
        f.x = cx + Math.cos(a) * (r + 700); f.y = cy + Math.sin(a) * (r + 700);
        f.h = a + Math.PI + rand(-0.6, 0.6); f.v = rand(150, 320);
      }
      f.x += Math.cos(f.h) * f.v * dt; f.y += Math.sin(f.h) * f.v * dt;
      let near = this.net.stations.some((st) => Math.hypot(st.x - f.x, st.y - f.y) < STATION_R + 300);
      if (!near) for (const rd of this.net.roads) { if (f.x < rd.c.minX - 400 || f.x > rd.c.maxX + 400 || f.y < rd.c.minY - 400 || f.y > rd.c.maxY + 400) continue; if (rd.c.nearest(f.x, f.y).d < 380) { near = true; break; } }
      f.a = near ? 0 : 1;
      const al = f.img.alpha + Math.sign(f.a - f.img.alpha) * Math.min(Math.abs(f.a - f.img.alpha), dt * 6);
      f.img.setPosition(f.x, f.y).setRotation(f.h).setAlpha(al);
      const ox = 60, oy = 80;
      f.sh.setPosition(f.x + ox * this.shX.x + oy * this.shY.x, f.y + ox * this.shX.y + oy * this.shY.y).setRotation(f.h).setAlpha(0.25 * al);
    }
  }

  /** put a ship's cab and trailer images where the ship is, at the depth of the deck it is on */
  private placeVis(v: Veh, vis: Vis) {
    // each unit is drawn at the depth of the deck it is actually on: a unit further back than the nose has come along
    // this segment is still on the previous one. The shadow offset follows the height, easing in along a flyover's ramp.
    const deck = (dBehind: number): { lvl: number; k: number } => {
      let seg = v.seg, s = v.s - dBehind;
      if (s < v.enterS && v.prevSeg) { seg = v.prevSeg; s = v.prevS + (s - v.enterS); }
      const lvl = seg.level;
      const k = lvl > 0 && seg.kind === 'ramp' ? clamp(Math.min(s, seg.len - s) / 300, 0, 1) : 1;
      return { lvl, k };
    };
    // cab
    const fr = { x: v.x, y: v.y };
    const cr = v.back(v.cab);
    let ang = Math.atan2(fr.y - cr.y, fr.x - cr.x);
    if (v.v < 1 && v.age < 0.3) ang = v.h;
    ang += v.crashAng;
    const units: { x: number; y: number; a: number; L: number }[] = [{ x: (fr.x + cr.x) / 2, y: (fr.y + cr.y) / 2, a: ang, L: v.cab }];
    let d = v.cab + HITCH;
    for (const t of v.trailers) {
      const F = v.back(d), R = v.back(d + t);
      units.push({ x: (F.x + R.x) / 2, y: (F.y + R.y) / 2, a: Math.atan2(F.y - R.y, F.x - R.x), L: t });
      d += t + HITCH;
    }
    let lvl = 0, back = 0;
    units.forEach((u, i) => {
      const im = vis.units[i], sh = vis.shadows[i];
      const dk = deck(back + u.L / 2);
      back += u.L + HITCH;
      lvl = dk.lvl;
      if (!im) return;
      const depth = DEPTH.veh(dk.lvl);
      // the shadow falls down and to the right on screen whichever way the camera is turned
      const ox = 5 + dk.lvl * 7 * dk.k, oy = ox * 1.3;
      im.setPosition(u.x, u.y).setRotation(u.a).setDepth(depth).setAlpha(v.alpha);
      sh.setPosition(u.x + ox * this.shX.x + oy * this.shY.x, u.y + ox * this.shX.y + oy * this.shY.y).setRotation(u.a).setDepth(depth - 0.05).setAlpha(0.3 * v.alpha);
    });
    return { units, lvl };
  }
  private updateVisuals(dt: number) {
    const cam = this.cameras.main;
    const cx = cam.midPoint.x, cy = cam.midPoint.y;
    const r = Math.hypot(cam.width, cam.height) / 2 / this.zoomCur + 150;
    for (const g of this.fx) g.clear();
    this.fxTop.clear();
    const blinkOn = this.blink % 0.76 < 0.4;
    for (const v of this.traffic.vs) {
      const vis = v.gfx as Vis | null;
      if (!vis) continue;
      // the whole rig counts, so a long one is not cut off while its trailers are still on screen
      const vis2 = Math.abs(v.x - cx) < r + v.totLen && Math.abs(v.y - cy) < r + v.totLen;
      for (const u of vis.units) u.setVisible(vis2);
      for (const u of vis.shadows) u.setVisible(vis2);
      if (!vis2) continue;
      const { units, lvl } = this.placeVis(v, vis);
      if (v.alpha < 0.05) continue;
      // lights
      const g = this.fx[Math.min(3, lvl)];
      const last = units[units.length - 1];
      const ca = Math.cos(last.a), sa = Math.sin(last.a);
      const rx = last.x - ca * last.L / 2, ry = last.y - sa * last.L / 2;
      const hw = v.w / 2 - 1.5;
      const thr = v.v > 20 ? Math.min(1, v.v / 300) : 0.2;
      g.fillStyle(0x4fb8ff, 0.35 * thr * v.alpha); g.fillCircle(rx - ca * 5, ry - sa * 5, 7);
      if (v.v > 60) { g.lineStyle(4, 0x4fb8ff, 0.18 * v.alpha); g.lineBetween(rx - ca * 4, ry - sa * 4, rx - ca * (10 + v.v * 0.05), ry - sa * (10 + v.v * 0.05)); }
      const nx = -sa, ny = ca;
      if (v.braking) {
        g.fillStyle(0xff2a2a, 0.9 * v.alpha);
        g.fillCircle(rx + nx * hw, ry + ny * hw, 2.4); g.fillCircle(rx - nx * hw, ry - ny * hw, 2.4);
        g.fillStyle(0xff2a2a, 0.3 * v.alpha);
        g.fillCircle(rx + nx * hw - ca * 2, ry + ny * hw - sa * 2, 7); g.fillCircle(rx - nx * hw - ca * 2, ry - ny * hw - sa * 2, 7);
      }
      const c0 = units[0];
      const fa = Math.cos(c0.a), fs = Math.sin(c0.a);
      const fx = c0.x + fa * c0.L / 2, fy = c0.y + fs * c0.L / 2;
      const fnx = -fs, fny = fa;
      g.fillStyle(0xfff6d8, 0.55 * v.alpha);
      g.fillCircle(fx + fnx * (hw - 1), fy + fny * (hw - 1), 1.8); g.fillCircle(fx - fnx * (hw - 1), fy - fny * (hw - 1), 1.8);
      if (v.sig !== 0 && blinkOn) {
        const sd = v.sig;
        g.fillStyle(0xffa51f, 1 * v.alpha);
        g.fillCircle(fx + fnx * hw * sd, fy + fny * hw * sd, 2.6); g.fillCircle(rx + nx * hw * sd, ry + ny * hw * sd, 2.6);
        g.fillStyle(0xffa51f, 0.35 * v.alpha);
        g.fillCircle(fx + fnx * hw * sd, fy + fny * hw * sd, 8); g.fillCircle(rx + nx * hw * sd, ry + ny * hw * sd, 8);
      }
      if (v.type === 'police') {
        const b = Math.floor(this.clk * 5 + v.id) % 2;
        g.fillStyle(b ? 0xff3344 : 0x3366ff, v.siren ? 0.9 : 0.45); g.fillCircle(c0.x, c0.y, v.siren ? 5 : 6);
        if (v.siren) { g.fillStyle(b ? 0xff3344 : 0x3366ff, 0.35); g.fillCircle(c0.x, c0.y, 18); }
      } else if (v.siren || v.type === 'tow') {
        if (blinkOn) { g.fillStyle(0xffb020, 0.85); g.fillCircle(c0.x, c0.y, 4); g.fillStyle(0xffb020, 0.3); g.fillCircle(c0.x, c0.y, 14); }
      }
      if (v.hazard && blinkOn) {
        for (const sd of [-1, 1]) {
          g.fillStyle(0xffa51f, v.alpha); g.fillCircle(fx + fnx * hw * sd, fy + fny * hw * sd, 2.8); g.fillCircle(rx + nx * hw * sd, ry + ny * hw * sd, 2.8);
          g.fillStyle(0xffa51f, 0.35 * v.alpha); g.fillCircle(fx + fnx * hw * sd, fy + fny * hw * sd, 9); g.fillCircle(rx + nx * hw * sd, ry + ny * hw * sd, 9);
        }
      }
      if (v.isPlayer) {
        g.lineStyle(2, 0x5ad8ff, 0.35 + 0.15 * Math.sin(this.clk * 4));
        g.strokeCircle(c0.x, c0.y, 24);
      }
    }
    for (const f of this.flyers) {
      const ca = Math.cos(f.h), sa = Math.sin(f.h);
      this.fxTop.fillStyle(0x4fb8ff, 0.4); this.fxTop.fillCircle(f.x - ca * 9, f.y - sa * 9, 6);
      this.fxTop.lineStyle(4, 0x4fb8ff, 0.15); this.fxTop.lineBetween(f.x - ca * 9, f.y - sa * 9, f.x - ca * 40, f.y - sa * 40);
    }
  }

  private drawGuide() {
    const g = this.guide; g.clear();
    const p = this.player, seg = p.seg;
    if (!p.goal || G.mode !== 'drive') return;
    g.setDepth(DEPTH.road(seg.level) + 0.5);
    const pulse = 0.55 + 0.3 * Math.sin(this.clk * 5);
    const chev = (x: number, y: number, h: number, col: number, a: number) => {
      const c = Math.cos(h), s = Math.sin(h), nx = -s, ny = c;
      g.lineStyle(4, col, a);
      g.beginPath(); g.moveTo(x - c * 6 + nx * 8, y - s * 6 + ny * 8); g.lineTo(x + c * 4, y + s * 4); g.lineTo(x - c * 6 - nx * 8, y - s * 6 - ny * 8); g.strokePath();
    };
    const t = p.route[0];
    const phase = (this.clk * 120) % 60;
    if (seg.kind === 'motorway' && t && t.from === seg && t.type === 'exit' && t.fromS - p.s < 3000) {
      const n = seg.lanes;
      const edge = t.side > 0 ? n - 1 : 0, auxL = t.side > 0 ? n : -1;
      const a = t.aux!;
      for (let s = p.s + 70 - phase; s < t.fromS; s += 60) {
        if (s < p.s + 40) continue;
        const inZone = s >= a.s0 + 60;
        const lat = inZone ? seg.laneLat(auxL) : seg.laneLat(edge);
        const q = seg.path.at(s, lat);
        chev(q.x, q.y, q.h + (inZone ? 0 : 0), 0x5ad8ff, pulse);
      }
      const ex = seg.path.at(a.s0 + 30, (seg.laneLat(edge) + seg.laneLat(auxL)) / 2);
      if (a.s0 > p.s) { chev(ex.x, ex.y, ex.h + t.side * 0.7, 0xffffff, pulse); }
    } else if (seg.kind !== 'motorway' || !t) {
      const end = t && t.from === seg ? t.fromS : p.goal.seg === seg ? p.goal.s : seg.len;
      for (let s = p.s + 70 - phase; s < Math.min(end, p.s + 900); s += 60) {
        if (s < p.s + 40) continue;
        const q = seg.path.at(s, seg.kind === 'motorway' ? p.lat : 0);
        chev(q.x, q.y, q.h, 0x5ad8ff, pulse * 0.8);
      }
    }
  }

  private drawSignals() {
    const g = this.sigG; g.clear();
    const cam = this.cameras.main;
    for (const c of this.net.crossings) {
      if (Math.hypot(c.x - cam.midPoint.x, c.y - cam.midPoint.y) > 2500) continue;
      for (const l of c.lights) {
        const seg = l.seg;
        const half = (seg.lanes * seg.laneW) / 2 + (seg.shoulder ? LW : 0) + 16;
        const q = seg.path.at(l.s, half);
        const st = c.sig.state(l.group);
        const col = st === 'G' ? 0x3ee07a : st === 'A' ? 0xffc83c : 0xff4b3e;
        g.fillStyle(0x0d1018, 1); g.fillCircle(q.x, q.y, 9);
        g.fillStyle(col, 1); g.fillCircle(q.x, q.y, 6);
        g.fillStyle(col, 0.25); g.fillCircle(q.x, q.y, 16);
        // overhead lamp over the lanes too
        const o = seg.path.at(l.s, 0);
        g.fillStyle(col, 0.18); g.fillCircle(o.x, o.y, 12);
      }
    }
  }

  private updateMap(_dt: number) {
    const p = this.player;
    const mc = this.minicam;
    mc.setRotation(-Math.PI / 2 - this.camH);
    const ahead = 900;
    mc.centerOn(p.x + Math.cos(this.camH) * ahead, p.y + Math.sin(this.camH) * ahead);
    this.mapArrow.setPosition(p.x, p.y).setRotation(p.h).setScale(26 / 68 / this.miniZoom);
    for (const t of this.mapLabels) t.setRotation(Math.PI / 2 + this.camH).setScale(15 / 48 / this.miniZoom);
    this.mapMarker.clear();
    for (const inc of this.inc.list) {
      if (inc.phase === 'stopping') continue;
      const q = inc.seg.path.at(inc.front);
      const pulse = 0.55 + 0.45 * Math.sin(this.clk * 6);
      this.mapMarker.fillStyle(0xff4b3e, 0.9); this.mapMarker.fillCircle(q.x, q.y, 190);
      this.mapMarker.lineStyle(60, 0xffffff, pulse); this.mapMarker.strokeCircle(q.x, q.y, 260);
    }
    const t = p.route.find((x) => x.type === 'exit');
    if (t) {
      const q = t.from.path.at(t.fromS);
      this.mapMarker.lineStyle(70, 0xffffff, 0.6 + 0.4 * Math.sin(this.clk * 6));
      this.mapMarker.strokeCircle(q.x, q.y, 260);
    }
  }
}
