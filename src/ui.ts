import Phaser from 'phaser';
import { WorldScene } from './world';
import { G, SPEEDS, CLASSES, RANKS, Job, bus, rankOf, money, distTxt, save, toast, UP, UPGRADES, nextUpgrade, PAX_MAX, PAX_PAY } from './state';
import { Station } from './network';
import { clamp } from './geom';
import { sfx } from './audio';
import { ZoneDef } from './zones';

const FONT = '"Trebuchet MS", "Segoe UI", Arial, sans-serif';
const PANEL = 0x111a33, EDGE = 0x3c5a9a, CYAN = 0x5ad8ff;

type Btn = { c: Phaser.GameObjects.Container; g: Phaser.GameObjects.Graphics; t: Phaser.GameObjects.Text; w: number; h: number; draw: (fill: number, stroke: number, alpha?: number) => void };

export class UIScene extends Phaser.Scene {
  world!: WorldScene;
  u = 1;
  root!: Phaser.GameObjects.Container;
  speedBtns: Btn[] = [];
  brakeBtn!: Btn;
  laneBtns: Btn[] = [];
  limitG!: Phaser.GameObjects.Graphics; limitT!: Phaser.GameObjects.Text;
  speedT!: Phaser.GameObjects.Text;
  moneyT!: Phaser.GameObjects.Text; rankT!: Phaser.GameObjects.Text; rankBar!: Phaser.GameObjects.Graphics;
  jobT!: Phaser.GameObjects.Text; jobSub!: Phaser.GameObjects.Text; jobG!: Phaser.GameObjects.Graphics;
  paxG!: Phaser.GameObjects.Graphics; paxT!: Phaser.GameObjects.Text; paxSub!: Phaser.GameObjects.Text;
  fuelBar!: Phaser.GameObjects.Graphics; fuelT!: Phaser.GameObjects.Text;
  navG!: Phaser.GameObjects.Graphics; navTitle!: Phaser.GameObjects.Text; navSub!: Phaser.GameObjects.Text; navDist!: Phaser.GameObjects.Text;
  navOverlay!: Phaser.GameObjects.Image; navRing!: Phaser.GameObjects.Graphics;
  warnBox!: Phaser.GameObjects.Container; warnT!: Phaser.GameObjects.Text;
  toastBox!: Phaser.GameObjects.Container; toastT!: Phaser.GameObjects.Text; toastG!: Phaser.GameObjects.Graphics; toastTimer = 0;
  hintBox!: Phaser.GameObjects.Container; hintT!: Phaser.GameObjects.Text; hintG!: Phaser.GameObjects.Graphics; hintTimer = 0;
  muteBtn!: Btn;
  modal: Phaser.GameObjects.Container | null = null;
  navC = { x: 0, y: 0, R: 100 };
  banner = { x: 0, y: 0, w: 0, h: 0 };
  last: Record<string, string> = {};
  pendingBoard: { st: Station; jobs: Job[]; summary: any } | null = null;
  // "Entering <zone>" title card: shown when driving, queued otherwise, never repeated for the same zone within 60 s
  zoneCard!: Phaser.GameObjects.Container; zoneName!: Phaser.GameObjects.Text; zoneTag!: Phaser.GameObjects.Text;
  zoneCardT = -1; zoneCardZone: ZoneDef | null = null; pendingZone: ZoneDef | null = null; zoneShownAt: Record<string, number> = {};

  constructor() { super('ui'); }

  create() {
    this.world = this.scene.get('world') as unknown as WorldScene;
    this.build();
    this.scale.on('resize', () => this.time.delayedCall(30, () => this.build()));
    bus.on('toast', (m: string, c: string, d: number) => this.showToast(m, c, d));
    bus.on('hint', (m: string) => this.showHint(m));
    bus.on('hintHide', () => { if (this.hintTimer > 0.5) this.hintTimer = 0.5; });
    bus.on('board', (st: Station, jobs: Job[], summary: any) => { this.pendingBoard = { st, jobs, summary }; this.time.delayedCall(summary ? 900 : 200, () => this.openBoard()); });
    bus.on('zone', (z: ZoneDef) => { this.pendingZone = z; });
    bus.on('police', (reason: string, fine: number) => this.showToast(fine > 0 ? `🚓 Pulled over: ${reason} — fined ${money(fine)}` : `🚓 Pulled over: ${reason} — just a warning this time!`, '#ffb4b4', 5000));
    const kb = this.input.keyboard!;
    kb.on('keydown', (e: KeyboardEvent) => this.onKey(e));
    this.showTitle();
  }

  private onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' || e.key.toLowerCase() === 'p') { this.togglePause(); return; }
    if (this.modal) {
      if ((e.key === 'Enter' || e.key === ' ') && G.mode === 'title') this.startGame();
      return;
    }
    const k = e.key.toLowerCase();
    if (k >= '1' && k <= '5') bus.emit('speed', Number(k));
    else if (k === 'b' || k === ' ') bus.emit('brake');
    else if (k === 'a' || k === 'arrowleft') bus.emit('lane', -1);
    else if (k === 'd' || k === 'arrowright') bus.emit('lane', 1);
    else if (k === 'w' || k === 'arrowup') bus.emit('speed', clamp(G.speedSet + 1, 1, 5));
    else if (k === 's' || k === 'arrowdown') { if (G.speedSet <= 1) bus.emit('brake'); else bus.emit('speed', G.speedSet - 1); }
    else if (k === 'm') this.toggleMute();
    else if (k === 'e') bus.emit('act');
  }
  private toggleMute() { G.muted = !G.muted; sfx.setMuted(G.muted); this.last.mute = ''; }
  // ------------------------------------------------------------------ pause
  /** freeze gameplay (the world scene skips its update while G.paused) and show the pause menu; call again to resume */
  togglePause() {
    if (G.paused) { G.paused = false; this.closeModal(); sfx.click(); return; }
    if (G.mode !== 'drive' || this.modal) return; // nothing to pause on the title, job board or garage
    G.paused = true; sfx.click();
    const W = this.scale.width, H = this.scale.height, u = this.u;
    const c = this.dim();
    const t1 = this.txt(W / 2, H * 0.36, 'PAUSED', 64, '#ffffff', true, [0.5, 0.5]);
    t1.setStroke('#1c2a52', 10 * u).setShadow(0, 6 * u, '#000000', 12 * u, true, true);
    c.add(t1);
    c.add(this.txt(W / 2, H * 0.36 + 54 * u, 'Traffic, fuel, timers and rescue crews are all on hold.', 18, '#9fe9ff', false, [0.5, 0.5]));
    const b = this.btn(W / 2, H * 0.36 + 130 * u, 280 * u, 62 * u, 'Resume', 24, () => this.togglePause(), 0x1f8a5a, 0x7ff0c0);
    c.add(b.c);
    c.add(this.txt(W / 2, H * 0.36 + 190 * u, 'Esc or P to resume', 15, '#8fa6d8', false, [0.5, 0.5]));
  }

  // ------------------------------------------------------------------ helpers
  private txt(x: number, y: number, s: string, size: number, color = '#ffffff', bold = true, origin: [number, number] = [0, 0]) {
    return this.add.text(x, y, s, { fontFamily: FONT, fontSize: `${Math.round(size * this.u)}px`, fontStyle: bold ? 'bold' : 'normal', color }).setOrigin(origin[0], origin[1]).setResolution(Math.min(2, window.devicePixelRatio || 1));
  }
  private panel(x: number, y: number, w: number, h: number, alpha = 0.88) {
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.25); g.fillRoundedRect(x + 3 * this.u, y + 4 * this.u, w, h, 12 * this.u);
    g.fillStyle(PANEL, alpha); g.fillRoundedRect(x, y, w, h, 12 * this.u);
    g.lineStyle(2 * this.u, EDGE, 0.9); g.strokeRoundedRect(x, y, w, h, 12 * this.u);
    return g;
  }
  private btn(x: number, y: number, w: number, h: number, label: string, size: number, onClick: () => void, fill = 0x1c2a52, stroke = EDGE): Btn {
    const u = this.u;
    const c = this.add.container(x, y);
    const g = this.add.graphics();
    const draw = (f: number, s: number, a = 0.95) => { g.clear(); g.fillStyle(0x000000, 0.3); g.fillRoundedRect(-w / 2 + 2 * u, -h / 2 + 3 * u, w, h, 10 * u); g.fillStyle(f, a); g.fillRoundedRect(-w / 2, -h / 2, w, h, 10 * u); g.lineStyle(2 * u, s, 1); g.strokeRoundedRect(-w / 2, -h / 2, w, h, 10 * u); };
    draw(fill, stroke);
    const t = this.txt(0, 0, label, size, '#ffffff', true, [0.5, 0.5]);
    c.add([g, t]);
    c.setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains);
    c.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, ev: Phaser.Types.Input.EventData) => { ev?.stopPropagation?.(); sfx.init(); onClick(); c.setScale(0.94); this.time.delayedCall(90, () => c.setScale(1)); });
    return { c, g, t, w, h, draw };
  }

  // ------------------------------------------------------------------ HUD
  build() {
    const W = this.scale.width, H = this.scale.height;
    this.u = clamp(Math.min(W / 1280, H / 720), 0.55, 1.6);
    const u = this.u;
    if (this.root) this.root.destroy(true);
    this.root = this.add.container(0, 0);
    this.last = {};
    const R = this.root;
    // money & rank
    R.add(this.panel(14 * u, 14 * u, 300 * u, 74 * u));
    this.moneyT = this.txt(30 * u, 22 * u, '', 30, '#ffe27a'); R.add(this.moneyT);
    this.rankT = this.txt(30 * u, 58 * u, '', 14, '#bcd2ff', false); R.add(this.rankT);
    this.rankBar = this.add.graphics(); R.add(this.rankBar);
    // job card
    this.jobG = this.add.graphics(); R.add(this.jobG);
    this.jobT = this.txt(30 * u, 104 * u, '', 17, '#ffffff'); R.add(this.jobT);
    this.jobSub = this.txt(30 * u, 128 * u, '', 14, '#bcd2ff', false); this.jobSub.setLineSpacing(4 * u); R.add(this.jobSub);
    this.paxG = this.add.graphics(); R.add(this.paxG);
    this.paxT = this.txt(30 * u, 0, '', 15, '#ffffff'); R.add(this.paxT);
    this.paxSub = this.txt(30 * u, 0, '', 13, '#bcd2ff', false); R.add(this.paxSub);
    // fuel
    R.add(this.panel(W - 264 * u, 14 * u, 250 * u, 58 * u));
    const fg = this.add.graphics(); R.add(fg);
    this.drawFuelIcon(fg, W - 240 * u, 43 * u);
    this.fuelBar = this.add.graphics(); R.add(this.fuelBar);
    this.fuelT = this.txt(W - 26 * u, 22 * u, '', 13, '#bcd2ff', true, [1, 0]); R.add(this.fuelT);
    this.muteBtn = this.btn(W - 300 * u, 43 * u, 52 * u, 52 * u, '♪', 22, () => this.toggleMute()); R.add(this.muteBtn.c);
    const pb = this.btn(W - 360 * u, 43 * u, 52 * u, 52 * u, 'II', 20, () => this.togglePause()); R.add(pb.c);
    // speed bar
    const by = H - 52 * u;
    const bw = 62 * u, bh = 58 * u, gap = 8 * u;
    const totalW = 64 * u + 5 * (bw + gap) + 92 * u;
    let x = W / 2 - totalW / 2 - 60 * u;
    if (x < 290 * u) x = 290 * u;
    this.limitG = this.add.graphics(); R.add(this.limitG);
    const lx = x + 28 * u;
    this.limitG.fillStyle(0x000000, 0.3); this.limitG.fillCircle(lx + 2 * u, by + 3 * u, 28 * u);
    this.limitG.fillStyle(0xffffff, 1); this.limitG.fillCircle(lx, by, 28 * u);
    this.limitG.lineStyle(6 * u, 0xd83a32, 1); this.limitG.strokeCircle(lx, by, 23 * u);
    this.limitT = this.txt(lx, by + 1 * u, '5', 24, '#1a1d26', true, [0.5, 0.5]); R.add(this.limitT);
    R.add(this.txt(lx, by + 31 * u, 'LIMIT', 10, '#bcd2ff', true, [0.5, 0]));
    x += 64 * u;
    this.speedBtns = [];
    for (let k = 1; k <= 5; k++) {
      const b = this.btn(x + bw / 2, by, bw, bh, String(k), 26, () => bus.emit('speed', k));
      R.add(b.c); this.speedBtns.push(b);
      x += bw + gap;
    }
    this.brakeBtn = this.btn(x + 44 * u, by, 88 * u, bh, 'BRAKE', 17, () => bus.emit('brake'), 0x5a1f28, 0xff6b6b);
    R.add(this.brakeBtn.c);
    R.add(this.txt(x + 44 * u, by + 31 * u, 'B', 10, '#ffb4b4', true, [0.5, 0]));
    this.speedT = this.txt(W / 2 - 60 * u, by - 46 * u, '', 15, '#dfe9ff', true, [0.5, 0.5]);
    this.speedT.setX(x - (5 * (bw + gap)) / 2);
    R.add(this.speedT);
    // lane buttons
    this.laneBtns = [];
    const ly = H - 64 * u;
    for (const d of [-1, 1]) {
      const b = this.btn((d < 0 ? 70 : 186) * u, ly, 100 * u, 84 * u, '', 34, () => bus.emit('lane', d));
      const ag = this.add.graphics();
      ag.fillStyle(0xffffff, 1);
      ag.fillTriangle(d * 20 * u, 0, -d * 12 * u, -20 * u, -d * 12 * u, 20 * u);
      ag.fillStyle(CYAN, 0.9); ag.fillRect(d < 0 ? 8 * u : -22 * u, -5 * u, 14 * u, 10 * u);
      b.c.add(ag);
      R.add(b.c); this.laneBtns.push(b);
    }
    R.add(this.txt(128 * u, ly - 58 * u, 'CHANGE LANE  (A / D)', 11, '#bcd2ff', true, [0.5, 0.5]));
    // sat-nav
    const NR = Math.round(112 * u);
    this.navC = { x: W - 22 * u - NR, y: H - 22 * u - NR, R: NR };
    this.world.setNavRect(this.navC.x - NR, this.navC.y - NR, NR * 2);
    const key = 'navhole' + NR;
    if (!this.textures.exists(key)) {
      const tex = this.textures.createCanvas(key, NR * 2 + 4, NR * 2 + 4)!;
      const ctx = tex.getContext();
      ctx.fillStyle = '#0a1030'; ctx.fillRect(0, 0, NR * 2 + 4, NR * 2 + 4);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.arc(NR + 2, NR + 2, NR - 2, 0, Math.PI * 2); ctx.fill();
      tex.refresh();
    }
    this.navRing = this.add.graphics(); R.add(this.navRing);
    this.navRing.lineStyle(7 * u, 0x1c2a52, 1); this.navRing.strokeCircle(this.navC.x, this.navC.y, NR);
    this.navRing.lineStyle(2 * u, CYAN, 0.9); this.navRing.strokeCircle(this.navC.x, this.navC.y, NR + 3 * u);
    this.navRing.fillStyle(0x1c2a52, 1); this.navRing.fillRoundedRect(this.navC.x - 36 * u, this.navC.y - NR - 12 * u, 72 * u, 20 * u, 8 * u);
    R.add(this.txt(this.navC.x, this.navC.y - NR - 2 * u, 'SAT-NAV', 11, '#9fe9ff', true, [0.5, 0.5]));
    // nav banner
    const bW = 330 * u, bH = 118 * u;
    this.banner = { x: W - 14 * u - bW, y: this.navC.y - NR - 26 * u - bH, w: bW, h: bH };
    R.add(this.panel(this.banner.x, this.banner.y, bW, bH, 0.94));
    this.navG = this.add.graphics(); R.add(this.navG);
    this.navTitle = this.txt(this.banner.x + 92 * u, this.banner.y + 12 * u, '', 18, '#ffffff'); R.add(this.navTitle);
    this.navSub = this.txt(this.banner.x + 92 * u, this.banner.y + 38 * u, '', 13, '#9fe9ff', false); R.add(this.navSub);
    this.navDist = this.txt(this.banner.x + 44 * u, this.banner.y + 90 * u, '', 15, '#ffe27a', true, [0.5, 0.5]); R.add(this.navDist);
    // warning chip
    this.warnBox = this.add.container(W / 2, by - 84 * u);
    const wg = this.add.graphics();
    wg.fillStyle(0x6a1820, 0.95); wg.fillRoundedRect(-200 * u, -18 * u, 400 * u, 36 * u, 18 * u);
    wg.lineStyle(2 * u, 0xff6b6b, 1); wg.strokeRoundedRect(-200 * u, -18 * u, 400 * u, 36 * u, 18 * u);
    this.warnT = this.txt(0, 0, '', 16, '#ffffff', true, [0.5, 0.5]);
    this.warnBox.add([wg, this.warnT]); this.warnBox.setVisible(false); R.add(this.warnBox);
    this.warnBox.setInteractive(new Phaser.Geom.Rectangle(-200 * u, -18 * u, 400 * u, 36 * u), Phaser.Geom.Rectangle.Contains);
    this.warnBox.on('pointerdown', () => { if (this.last.warn && this.last.warn.startsWith('🔋')) bus.emit('act'); });
    // toast
    this.toastBox = this.add.container(W / 2, 30 * u);
    this.toastG = this.add.graphics();
    this.toastT = this.txt(0, 0, '', 18, '#ffffff', true, [0.5, 0.5]);
    this.toastBox.add([this.toastG, this.toastT]); this.toastBox.setVisible(false); R.add(this.toastBox);
    // hint
    this.hintBox = this.add.container(W / 2, H * 0.25);
    this.hintG = this.add.graphics();
    this.hintT = this.txt(0, 0, '', 16, '#ffffff', false, [0.5, 0.5]);
    this.hintT.setWordWrapWidth(470 * u).setAlign('center').setLineSpacing(4 * u);
    this.hintBox.add([this.hintG, this.hintT]); this.hintBox.setVisible(false); R.add(this.hintBox);
    // zone title card, under the toast
    this.zoneCard = this.add.container(W / 2, 96 * u);
    const zg = this.add.graphics();
    zg.fillStyle(0x0b1230, 0.3); zg.fillRoundedRect(-170 * u, -22 * u, 340 * u, 92 * u, 14 * u);
    const zl = this.txt(0, -12 * u, 'ENTERING', 12, '#9fe9ff', true, [0.5, 0.5]); zl.setLetterSpacing(3 * u);
    this.zoneName = this.txt(0, 14 * u, '', 30, '#ffffff', true, [0.5, 0.5]);
    this.zoneName.setStroke('#1c2a52', 6 * u).setShadow(0, 4 * u, '#000000', 8 * u, true, true);
    this.zoneTag = this.txt(0, 48 * u, '', 14, '#bcd2ff', false, [0.5, 0.5]);
    this.zoneCard.add([zg, zl, this.zoneName, this.zoneTag]); this.zoneCard.setVisible(false).setAlpha(0); R.add(this.zoneCard);
    if (this.zoneCardT >= 0 && this.zoneCardZone) { this.zoneName.setText(this.zoneCardZone.name); this.zoneTag.setText(this.zoneCardZone.tagline); this.zoneCard.setVisible(true); }
    if (this.modal) this.children.bringToTop(this.modal);
  }

  private drawFuelIcon(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    const u = this.u;
    g.fillStyle(0x5ad8ff, 1); g.fillRoundedRect(x - 9 * u, y - 13 * u, 15 * u, 26 * u, 3 * u);
    g.fillStyle(PANEL, 1); g.fillRect(x - 6 * u, y - 10 * u, 9 * u, 7 * u);
    g.lineStyle(3 * u, 0x5ad8ff, 1); g.lineBetween(x + 6 * u, y - 6 * u, x + 12 * u, y - 2 * u); g.lineBetween(x + 12 * u, y - 2 * u, x + 12 * u, y + 9 * u);
  }

  private drawNavArrow(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, arrow: number | 'U' | 'dock' | 'fuel' | 'warn') {
    const u = this.u;
    g.fillStyle(arrow === 'warn' ? 0xd88a1a : 0x1f7a4c, 1); g.fillRoundedRect(x - size / 2, y - size / 2, size, size, 10 * u);
    g.lineStyle(size * 0.13, 0xffffff, 1); g.fillStyle(0xffffff, 1);
    if (arrow === 'U') {
      const r = size * 0.2;
      g.beginPath(); g.arc(x, y - size * 0.06, r, 0, Math.PI, true); g.strokePath();
      g.lineBetween(x + r, y - size * 0.06, x + r, y + size * 0.3);
      g.fillTriangle(x - r - size * 0.13, y, x - r + size * 0.13, y, x - r, y + size * 0.22);
      return;
    }
    if (arrow === 'warn') {
      g.fillStyle(0xd88a1a, 1); g.fillRoundedRect(x - size / 2, y - size / 2, size, size, 10 * u);
      g.fillStyle(0xffffff, 1); g.fillTriangle(x, y - size * 0.3, x - size * 0.3, y + size * 0.24, x + size * 0.3, y + size * 0.24);
      g.fillStyle(0xd88a1a, 1); g.fillRect(x - size * 0.03, y - size * 0.14, size * 0.06, size * 0.2); g.fillCircle(x, y + size * 0.13, size * 0.04);
      return;
    }
    if (arrow === 'dock') {
      g.lineStyle(size * 0.08, 0xffffff, 1); g.strokeCircle(x, y, size * 0.26); g.fillCircle(x, y, size * 0.1);
      return;
    }
    if (arrow === 'fuel') {
      g.fillRoundedRect(x - size * 0.2, y - size * 0.26, size * 0.3, size * 0.52, 3 * u);
      g.fillStyle(0x1f7a4c, 1); g.fillRect(x - size * 0.14, y - size * 0.2, size * 0.18, size * 0.14);
      g.lineStyle(size * 0.06, 0xffffff, 1); g.lineBetween(x + size * 0.12, y - size * 0.12, x + size * 0.24, y - size * 0.04); g.lineBetween(x + size * 0.24, y - size * 0.04, x + size * 0.24, y + size * 0.2);
      return;
    }
    const a = (arrow * Math.PI) / 180;
    // bent arrow: straight stem then turn
    const sx = x - (arrow > 0 ? size * 0.1 : arrow < 0 ? -size * 0.1 : 0);
    g.lineBetween(sx, y + size * 0.32, sx, y + (arrow === 0 ? -size * 0.1 : 0));
    const dx = Math.sin(a), dy = -Math.cos(a);
    const ex = sx + dx * size * 0.22, ey = y + dy * size * 0.22 + (arrow === 0 ? -size * 0.05 : 0);
    if (arrow !== 0) g.lineBetween(sx, y, ex, ey);
    const px = -dy, py = dx, hl = size * 0.2;
    const tx = ex + dx * hl * 0.8, ty = ey + dy * hl * 0.8;
    g.fillTriangle(tx, ty, ex - dx * hl * 0.3 + px * hl, ey - dy * hl * 0.3 + py * hl, ex - dx * hl * 0.3 - px * hl, ey - dy * hl * 0.3 - py * hl);
  }

  private showToast(msg: string, color = '#ffffff', dur = 3200) {
    if (!this.toastT) return;
    const u = this.u;
    this.toastT.setText(msg).setColor(color);
    const w = this.toastT.width + 40 * u, h = 40 * u;
    this.toastG.clear();
    this.toastG.fillStyle(0x0b1230, 0.92); this.toastG.fillRoundedRect(-w / 2, -h / 2, w, h, 20 * u);
    this.toastG.lineStyle(2 * u, CYAN, 0.8); this.toastG.strokeRoundedRect(-w / 2, -h / 2, w, h, 20 * u);
    this.toastBox.setVisible(true).setAlpha(1);
    this.toastBox.y = (G.job ? 30 : 30) * u + 0 * h;
    this.toastBox.x = this.scale.width / 2;
    this.toastTimer = dur / 1000;
  }
  private showHint(msg: string) {
    if (!this.hintT) return;
    const u = this.u;
    this.hintT.setText(msg);
    const w = Math.max(this.hintT.width, 300 * u) + 44 * u, h = this.hintT.height + 34 * u;
    this.hintG.clear();
    this.hintG.fillStyle(0x0b1230, 0.94); this.hintG.fillRoundedRect(-w / 2, -h / 2, w, h, 14 * u);
    this.hintG.lineStyle(2.5 * u, 0xffd23c, 0.9); this.hintG.strokeRoundedRect(-w / 2, -h / 2, w, h, 14 * u);
    this.hintBox.setVisible(true).setAlpha(1);
    this.hintTimer = 7.5;
  }

  private showZoneCard(z: ZoneDef) {
    this.zoneCardZone = z; this.zoneCardT = 0;
    this.zoneShownAt[z.id] = this.time.now;
    this.zoneName.setText(z.name); this.zoneTag.setText(z.tagline);
    this.zoneCard.setVisible(true).setAlpha(0);
  }
  private updateZoneCard(dt: number) {
    if (this.pendingZone && G.mode === 'drive' && !this.modal && !G.paused) {
      const z = this.pendingZone; this.pendingZone = null;
      const last = this.zoneShownAt[z.id];
      if (last === undefined || this.time.now - last > 60000) this.showZoneCard(z);
    }
    if (this.zoneCardT < 0 || G.paused) return;
    // fade in 0.8 s, hold 2.6 s, fade out 1.2 s
    const t = this.zoneCardT += dt;
    const a = t < 0.8 ? t / 0.8 : t < 3.4 ? 1 : Math.max(0, 1 - (t - 3.4) / 1.2);
    this.zoneCard.setAlpha(a);
    if (t >= 4.6) { this.zoneCardT = -1; this.zoneCard.setVisible(false); }
  }

  override update(_t: number, dms: number) {
    const dt = dms / 1000;
    const u = this.u, W = this.scale.width;
    const w = this.world;
    if (!w.player) return;
    this.updateZoneCard(dt);
    const set = (k: string, v: string, t: Phaser.GameObjects.Text) => { if (this.last[k] !== v) { this.last[k] = v; t.setText(v); } };
    set('money', money(G.money), this.moneyT);
    const rank = rankOf(G.earned);
    const nextAt = RANKS[rank + 1]?.at;
    set('rank', `${RANKS[rank].name} · ${G.deliveries} deliveries` + (nextAt ? `` : ' · max rank'), this.rankT);
    const rk = `${rank}:${Math.round(G.earned)}`;
    if (this.last.rk !== rk) {
      this.last.rk = rk;
      this.rankBar.clear();
      const frac = nextAt ? (G.earned - RANKS[rank].at) / (nextAt - RANKS[rank].at) : 1;
      this.rankBar.fillStyle(0x223058, 1); this.rankBar.fillRoundedRect(200 * u, 64 * u, 100 * u, 8 * u, 4 * u);
      this.rankBar.fillStyle(0xffd23c, 1); this.rankBar.fillRoundedRect(200 * u, 64 * u, Math.max(6, 100 * frac) * u, 8 * u, 4 * u);
    }
    // job card
    const job = G.job;
    const fav = w.favours ? w.favours.hud() : '';
    const jkey = (job ? `${job.id}:${job.stage}:${Math.floor(job.elapsed)}:${Math.round(w.remain / 100)}` : 'none') + '|' + fav;
    if (this.last.job !== jkey) {
      this.last.job = jkey;
      this.jobG.clear();
      const h = (job ? 104 : 54) * u + (fav ? 22 * u : 0);
      this.jobG.fillStyle(0x000000, 0.25); this.jobG.fillRoundedRect(17 * u, 98 * u, 300 * u, h, 12 * u);
      this.jobG.fillStyle(PANEL, 0.88); this.jobG.fillRoundedRect(14 * u, 94 * u, 300 * u, h, 12 * u);
      this.jobG.lineStyle(2 * u, job ? 0xffd23c : EDGE, 0.9); this.jobG.strokeRoundedRect(14 * u, 94 * u, 300 * u, h, 12 * u);
      if (job) {
        const dest = w.net.byId[job.stage === 'pickup' ? job.from : job.to].name;
        this.jobT.setText(job.stage === 'pickup' ? `Collect: ${job.cargo}` : `${job.cargo}`);
        const left = Math.max(0, job.target - job.elapsed);
        const bonus = left > 0 ? `On-time bonus: ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}` : 'Bonus time passed — no rush';
        this.jobSub.setText(`${job.stage === 'pickup' ? 'Pick up at' : 'Deliver to'} ${dest}\nPays ${money(job.pay)} · ${distTxt(w.remain)} to go\n${bonus}` + (fav ? `\n${fav}` : ''));
      } else {
        this.jobT.setText(G.mode === 'title' ? 'Welcome, hauler' : 'No job right now');
        this.jobSub.setText('Dock at a station to pick one' + (fav ? `\n${fav}` : ''));
      }
    }
    // passengers card, tucked under the job card
    const pk = `${G.pax}:${job ? 1 : 0}:${G.mode}:${w.pstate}:${G.pax > 0 ? w.nextStationName() : ''}`;
    if (this.last.pax !== pk) {
      this.last.pax = pk;
      this.paxG.clear();
      const show = G.mode === 'drive' && (G.pax > 0 || w.pstate === 'parked');
      this.paxT.setVisible(show); this.paxSub.setVisible(show);
      if (show) {
        const y = (94 + (job ? 104 : 54) + 8) * u, h = 56 * u;
        this.paxG.fillStyle(0x000000, 0.25); this.paxG.fillRoundedRect(17 * u, y + 4 * u, 300 * u, h, 12 * u);
        this.paxG.fillStyle(PANEL, 0.88); this.paxG.fillRoundedRect(14 * u, y, 300 * u, h, 12 * u);
        this.paxG.lineStyle(2 * u, G.pax > 0 ? 0x7ff0c0 : EDGE, 0.9); this.paxG.strokeRoundedRect(14 * u, y, 300 * u, h, 12 * u);
        this.paxG.fillStyle(0x7ff0c0, 1);
        for (let i = 0; i < PAX_MAX; i++) { this.paxG.fillStyle(i < G.pax ? 0x7ff0c0 : 0x223058, 1); this.paxG.fillCircle((262 + i * 18) * u, y + 18 * u, 6 * u); }
        this.paxT.setPosition(30 * u, y + 9 * u).setText(G.pax > 0 ? `Passengers ${G.pax}/${PAX_MAX}` : 'No passengers aboard');
        this.paxSub.setPosition(30 * u, y + 31 * u).setText(G.pax > 0 ? `Drop at next station: ${w.nextStationName()} · ${money(G.pax * PAX_PAY)} on arrival` : `Hitch-hikers at lay-bys pay ${money(PAX_PAY)} each`);
      }
    }
    // fuel
    const fk = Math.round(G.fuel * 200) + (w.pstate === 'fuel' ? 'f' : '');
    if (this.last.fuel !== fk) {
      this.last.fuel = fk;
      const g = this.fuelBar; g.clear();
      const x = W - 222 * u, y = 46 * u, bw = 196 * u, bh = 14 * u;
      g.fillStyle(0x223058, 1); g.fillRoundedRect(x, y - bh / 2, bw, bh, 7 * u);
      const col = G.fuel < 0.15 ? 0xff5a4a : G.fuel < 0.3 ? 0xffb03c : 0x4fe08a;
      g.fillStyle(col, 1); g.fillRoundedRect(x, y - bh / 2, Math.max(8 * u, bw * G.fuel), bh, 7 * u);
      this.fuelT.setText(w.pstate === 'fuel' ? `REFUELLING ${Math.round(G.fuel * 100)}%` : G.fuel <= 0 ? 'EMPTY — RESERVE' : `FUEL ${Math.round(G.fuel * 100)}%${G.fuel < 0.3 ? ' — LOW' : ''}`);
      this.fuelT.setColor(G.fuel < 0.3 ? '#ffb03c' : '#bcd2ff');
    }
    // speed buttons
    const lim = w.limit;
    const sk = `${G.speedSet}:${G.braking}:${lim}:${G.mode}:${w.pstate}`;
    if (this.last.speed !== sk) {
      this.last.speed = sk;
      this.speedBtns.forEach((b, i) => {
        const k = i + 1;
        const active = G.speedSet === k && !G.braking;
        const over = k > lim;
        b.draw(active ? (over ? 0xb8542a : 0x1f8a5a) : over ? 0x3a2a35 : 0x1c2a52, active ? 0xffffff : over ? 0xb8542a : EDGE);
      });
      this.brakeBtn.draw(G.braking ? 0xd83a32 : 0x5a1f28, G.braking ? 0xffffff : 0xff6b6b);
      this.limitT.setText(String(lim));
    }
    const p = w.player;
    const sp = `${Math.round(p.v * 4.5)} km/h` + (G.braking ? (w.autoHold ? ' · waiting for green' : ' · braking') : G.speedSet ? ` · cruise ${G.speedSet}` : '');
    set('sp', sp, this.speedT);
    // mute
    const mk = G.muted ? 'm' : 'u';
    if (this.last.mute !== mk) { this.last.mute = mk; this.muteBtn.t.setText(G.muted ? '✕' : '♪'); }
    // nav banner
    const nav = w.nav;
    if (nav) {
      const nk = `${nav.title}|${nav.sub}|${Math.round(nav.dist / 50)}|${nav.lanes?.join()}|${nav.aux}|${p.lane}|${String(nav.arrow)}`;
      if (this.last.nav !== nk) {
        this.last.nav = nk;
        const b = this.banner;
        this.navTitle.setText(nav.title);
        if (this.navTitle.width > b.w - 104 * u) this.navTitle.setScale((b.w - 104 * u) / this.navTitle.width); else this.navTitle.setScale(1);
        this.navSub.setText(nav.sub);
        this.navDist.setText(nav.dist > 0 ? distTxt(nav.dist) : '');
        const g = this.navG; g.clear();
        this.drawNavArrow(g, b.x + 44 * u, b.y + 44 * u, 62 * u, nav.arrow);
        if (nav.lanes) {
          const n = nav.lanes.length;
          const lw = 26 * u, lh = 34 * u, gap = 5 * u;
          const slots: { i: number; ok: boolean; aux: boolean }[] = nav.lanes.map((ok, i) => ({ i, ok, aux: false }));
          if (nav.aux < 0) slots.unshift({ i: -1, ok: true, aux: true });
          if (nav.aux > 0) slots.push({ i: n, ok: true, aux: true });
          const tw = slots.length * (lw + gap) - gap;
          let x = b.x + 92 * u + (b.w - 104 * u - tw) / 2;
          const y = b.y + 62 * u;
          for (const sl of slots) {
            const mine = sl.i === p.lane;
            g.fillStyle(sl.ok ? (sl.aux ? 0x1f7a4c : 0x1e5a8a) : 0x232a40, 1); g.fillRoundedRect(x, y, lw, lh, 5 * u);
            g.lineStyle(2 * u, sl.ok ? 0x7ff0c0 : 0x3a4560, 1); g.strokeRoundedRect(x, y, lw, lh, 5 * u);
            g.lineStyle(3 * u, sl.ok ? 0xffffff : 0x4a5370, 1);
            const cx = x + lw / 2;
            if (sl.aux) { g.lineBetween(cx - (nav.aux > 0 ? 4 : -4) * u, y + lh - 7 * u, cx + (nav.aux > 0 ? 5 : -5) * u, y + 9 * u); g.fillStyle(0xffffff, 1); g.fillTriangle(cx + (nav.aux > 0 ? 8 : -8) * u, y + 5 * u, cx + (nav.aux > 0 ? 0 : 0) * u, y + 9 * u, cx + (nav.aux > 0 ? 7 : -7) * u, y + 14 * u); }
            else { g.lineBetween(cx, y + lh - 7 * u, cx, y + 11 * u); g.fillStyle(sl.ok ? 0xffffff : 0x4a5370, 1); g.fillTriangle(cx, y + 5 * u, cx - 5 * u, y + 12 * u, cx + 5 * u, y + 12 * u); }
            if (mine) { g.fillStyle(0xff5a3c, 1); g.fillTriangle(cx, y + lh + 3 * u, cx - 6 * u, y + lh + 11 * u, cx + 6 * u, y + lh + 11 * u); }
            x += lw + gap;
          }
        }
      }
    }
    // warnings
    let warn = '';
    if (p.state === 'crashed') { const ci = w.inc.list.find((i) => i.cas.includes(p)); warn = ci ? `${ci.kind === 'breakdown' ? '⛽' : '💥'} ${w.inc.status(ci)}` : '💥 Crash!'; }
    else if (w.pstate === 'pulled') warn = p.v > 3 ? '🚓 Police: pulling over…' : `🚓 Stopped by police — back on the road in ${Math.ceil(w.holdT)}s`;
    else if (w.hazardMsg) warn = w.hazardMsg;
    else if (w.redAhead) warn = '🚦 Red light ahead — press B to stop';
    else if (w.overT > 0.5) warn = `Over the limit (${lim}) — ease off!`;
    else if (G.mode === 'drive' && G.braking && G.speedSet === 0 && w.pstate === 'drive' && p.v < 2) warn = 'Pick a speed (1–5) to pull away';
    else if (w.pstate === 'parked') warn = 'Resting in the lay-by — pick a speed to pull out';
    if (this.last.warn !== warn) {
      this.last.warn = warn;
      this.warnBox.setVisible(!!warn);
      this.warnT.setText(warn);
      const wg = this.warnBox.list[0] as Phaser.GameObjects.Graphics;
      const ww = Math.max(300 * u, this.warnT.width + 40 * u);
      const good = warn.startsWith('Pick') || warn.startsWith('Resting') || warn.startsWith('🔋');
      wg.clear(); wg.fillStyle(good ? 0x14503a : 0x6a1820, 0.95); wg.fillRoundedRect(-ww / 2, -18 * u, ww, 36 * u, 18 * u);
      wg.lineStyle(2 * u, good ? 0x7ff0c0 : 0xff6b6b, 1); wg.strokeRoundedRect(-ww / 2, -18 * u, ww, 36 * u, 18 * u);
    }
    if (this.warnBox.visible) this.warnBox.setAlpha(0.75 + 0.25 * Math.sin(this.time.now / 160));
    // toasts & hints
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer < 0.4) this.toastBox.setAlpha(Math.max(0, this.toastTimer / 0.4)); if (this.toastTimer <= 0) this.toastBox.setVisible(false); }
    if (this.hintTimer > 0) { this.hintTimer -= dt; if (this.hintTimer < 0.5) this.hintBox.setAlpha(Math.max(0, this.hintTimer / 0.5)); if (this.hintTimer <= 0) this.hintBox.setVisible(false); }
  }

  // ------------------------------------------------------------------ modals
  private closeModal() { if (this.modal) { this.modal.destroy(true); this.modal = null; } }
  private dim(): Phaser.GameObjects.Container {
    this.closeModal();
    const W = this.scale.width, H = this.scale.height;
    const c = this.add.container(0, 0).setDepth(100);
    const bg = this.add.graphics(); bg.fillStyle(0x050817, 0.62); bg.fillRect(0, 0, W, H);
    bg.setInteractive(new Phaser.Geom.Rectangle(0, 0, W, H), Phaser.Geom.Rectangle.Contains);
    c.add(bg);
    this.modal = c;
    return c;
  }
  showTitle() {
    const W = this.scale.width, H = this.scale.height, u = this.u;
    const c = this.dim();
    const t1 = this.txt(W / 2, H * 0.22, 'SPACE TRUCKER', 72, '#ffffff', true, [0.5, 0.5]);
    t1.setStroke('#1c2a52', 10 * u).setShadow(0, 6 * u, '#000000', 12 * u, true, true);
    c.add(t1);
    c.add(this.txt(W / 2, H * 0.22 + 56 * u, 'Freelance hauling on the interstellar highways', 20, '#9fe9ff', false, [0.5, 0.5]));
    const lines = [
      ['1 – 5', 'Pick your cruise speed (click or keys)'],
      ['B', 'Brake — stops at red lights, resumes on green'],
      ['A / D', 'Change lane — move into exit lanes to leave'],
      ['Sat-nav', 'Shows your next exit and the lane to be in'],
    ];
    const px = W / 2 - 250 * u;
    c.add(this.panel(px - 20 * u, H * 0.4 - 18 * u, 540 * u, 172 * u, 0.9));
    lines.forEach(([k, d], i) => {
      c.add(this.txt(px, H * 0.4 + i * 38 * u, k, 18, '#ffe27a'));
      c.add(this.txt(px + 150 * u, H * 0.4 + i * 38 * u + 2 * u, d, 16, '#e6eeff', false));
    });
    const b = this.btn(W / 2, H * 0.4 + 230 * u, 300 * u, 66 * u, 'Start your shift', 24, () => this.startGame(), 0x1f8a5a, 0x7ff0c0);
    c.add(b.c);
    this.tweens.add({ targets: b.c, scale: 1.05, yoyo: true, repeat: -1, duration: 800, ease: 'Sine.inOut' });
    c.add(this.txt(W / 2, H - 30 * u, 'No crashes, no fail state — just the open road. Police fines and fuel keep you honest.', 14, '#8fa6d8', false, [0.5, 0.5]));
  }
  private startGame() {
    sfx.init(); sfx.setMuted(G.muted); sfx.click();
    this.closeModal();
    this.world.openFirstBoard();
  }
  openBoard() {
    const pb = this.pendingBoard; if (!pb) return;
    const { st, jobs, summary } = pb;
    const W = this.scale.width, H = this.scale.height, u = this.u;
    const c = this.dim();
    const pw = Math.min(W - 40 * u, 720 * u), ph = (summary ? 500 : 452) * u;
    const x0 = W / 2 - pw / 2, y0 = H / 2 - ph / 2;
    c.add(this.panel(x0, y0, pw, ph, 0.97));
    const hdr = this.add.graphics();
    hdr.fillStyle(st.color, 1); hdr.fillCircle(x0 + 42 * u, y0 + 42 * u, 20 * u);
    hdr.fillStyle(PANEL, 1); hdr.fillCircle(x0 + 42 * u, y0 + 42 * u, 9 * u);
    c.add(hdr);
    c.add(this.txt(x0 + 74 * u, y0 + 20 * u, `${st.name} — Job Board`, 24));
    c.add(this.txt(x0 + 74 * u, y0 + 50 * u, `${st.kind} · You have ${money(G.money)} · Rank: ${RANKS[rankOf(G.earned)].name}`, 14, '#9fe9ff', false));
    const afford = UPGRADES.some((d) => { const n = nextUpgrade(d); return !!n && n.price <= G.money; });
    const gb = this.btn(x0 + pw - 100 * u, y0 + 40 * u, 160 * u, 44 * u, afford ? 'Rig Garage ★' : 'Rig Garage', 18, () => { pb.summary = null; this.openGarage(); }, afford ? 0x8a6a1f : 0x1c2a52, afford ? 0xffe27a : EDGE);
    c.add(gb.c);
    if (afford) this.tweens.add({ targets: gb.c, scale: 1.06, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.inOut' });
    let y = y0 + 86 * u;
    if (summary) {
      const sg = this.add.graphics();
      sg.fillStyle(0x14503a, 1); sg.fillRoundedRect(x0 + 20 * u, y, pw - 40 * u, 40 * u, 10 * u);
      c.add(sg);
      const s = `Delivered ${summary.cargo}: +${money(summary.pay)}` + (summary.bonus ? `  (+${money(summary.bonus)} on-time bonus!)` : '') + (summary.rankUp ? `   ★ Promoted to ${summary.rankUp}!` : '');
      const st2 = this.txt(x0 + pw / 2, y + 20 * u, s, 16, '#b8ffd8', true, [0.5, 0.5]);
      if (st2.width > pw - 60 * u) st2.setScale((pw - 60 * u) / st2.width);
      c.add(st2);
      y += 52 * u;
    }
    jobs.forEach((job) => {
      const rh = 98 * u;
      const g = this.add.graphics();
      g.fillStyle(job.locked ? 0x1a2036 : 0x1c2a52, 1); g.fillRoundedRect(x0 + 20 * u, y, pw - 40 * u, rh - 10 * u, 10 * u);
      g.lineStyle(2 * u, job.locked ? 0x2a3350 : EDGE, 1); g.strokeRoundedRect(x0 + 20 * u, y, pw - 40 * u, rh - 10 * u, 10 * u);
      const dst = this.world.net.byId[job.to];
      g.fillStyle(dst.color, 1); g.fillCircle(x0 + 50 * u, y + 30 * u, 12 * u);
      c.add(g);
      const cls = CLASSES[job.cls];
      c.add(this.txt(x0 + 72 * u, y + 12 * u, job.cargo, 19, job.locked ? '#7f8aa8' : '#ffffff'));
      const route = job.remote ? `Collect at ${this.world.net.byId[job.from].name} → deliver to ${dst.name}` : `To ${dst.name}`;
      c.add(this.txt(x0 + 72 * u, y + 40 * u, route, 14, job.locked ? '#6a7594' : '#9fe9ff', false));
      c.add(this.txt(x0 + 72 * u, y + 62 * u, `${cls.name} · ${distTxt(job.dist)} · bonus if under ${Math.ceil(job.target / 60)} min`, 13, '#8fa6d8', false));
      c.add(this.txt(x0 + pw - 190 * u, y + 26 * u, money(job.pay), 24, job.locked ? '#7f8aa8' : '#ffe27a', true, [1, 0.5]));
      if (job.locked) {
        c.add(this.txt(x0 + pw - 100 * u, y + 44 * u, `Needs rank\n${RANKS[cls.rank].name}`, 13, '#7f8aa8', true, [0.5, 0.5]).setAlign('center'));
      } else {
        const b = this.btn(x0 + pw - 100 * u, y + 44 * u, 130 * u, 50 * u, 'Accept', 19, () => { this.closeModal(); sfx.coin(); G.mode = 'drive'; bus.emit('accept', job); }, 0x1f8a5a, 0x7ff0c0);
        c.add(b.c);
      }
      y += rh;
    });
    c.add(this.txt(W / 2, y0 + ph - 22 * u, 'Bigger hauls unlock as you earn. Spend your earnings in the Rig Garage.', 13, '#8fa6d8', false, [0.5, 0.5]));
    save();
  }

  // ------------------------------------------------------------------ rig garage
  openGarage() {
    const pb = this.pendingBoard; if (!pb) return;
    const W = this.scale.width, H = this.scale.height, u = this.u;
    const c = this.dim();
    const pw = Math.min(W - 40 * u, 720 * u), ph = 470 * u;
    const x0 = W / 2 - pw / 2, y0 = H / 2 - ph / 2;
    c.add(this.panel(x0, y0, pw, ph, 0.97));
    c.add(this.txt(x0 + 28 * u, y0 + 18 * u, 'Rig Garage', 26));
    c.add(this.txt(x0 + 28 * u, y0 + 52 * u, `You have ${money(G.money)} — upgrades are yours for good`, 14, '#9fe9ff', false));
    let y = y0 + 88 * u;
    for (const d of UPGRADES) {
      const rh = 100 * u, lvl = UP[d.id], nx = nextUpgrade(d);
      const g = this.add.graphics();
      g.fillStyle(0x1c2a52, 1); g.fillRoundedRect(x0 + 20 * u, y, pw - 40 * u, rh - 10 * u, 10 * u);
      g.lineStyle(2 * u, EDGE, 1); g.strokeRoundedRect(x0 + 20 * u, y, pw - 40 * u, rh - 10 * u, 10 * u);
      g.fillStyle(d.color, 1); g.fillCircle(x0 + 50 * u, y + 40 * u, 16 * u);
      g.fillStyle(PANEL, 1); g.fillCircle(x0 + 50 * u, y + 40 * u, 7 * u);
      for (let i = 0; i < 3; i++) {
        g.fillStyle(i < lvl ? d.color : 0x2a3556, 1); g.fillRoundedRect(x0 + 82 * u + i * 32 * u, y + 38 * u, 26 * u, 8 * u, 4 * u);
      }
      c.add(g);
      c.add(this.txt(x0 + 82 * u, y + 8 * u, d.name, 19));
      c.add(this.txt(x0 + 82 * u + 3 * 32 * u + 6 * u, y + 34 * u, lvl >= 3 ? 'MAX' : `Level ${lvl}/3`, 13, '#8fa6d8', true));
      const info = this.txt(x0 + 82 * u, y + 52 * u, nx ? `Next: ${nx.text}` : `Fully upgraded: ${d.now[3]}`, 13, nx ? '#cfe0ff' : '#b8ffd8', false);
      info.setWordWrapWidth(pw - 290 * u);
      c.add(info);
      if (nx) {
        const ok = G.money >= nx.price;
        const b = this.btn(x0 + pw - 100 * u, y + 40 * u, 140 * u, 52 * u, `Buy ${money(nx.price)}`, 17, () => {
          if (G.money < nx.price) { sfx.warn(); toast('Not enough credits yet — deliver a few more loads', '#ffd27a', 2200); return; }
          G.money -= nx.price; UP[d.id]++; save(); sfx.coin(); sfx.chime();
          this.world.applyUpgrades();
          (window as any).Tesana?.track?.('upgrade', { id: d.id, level: UP[d.id] });
          this.openGarage();
        }, ok ? 0x1f8a5a : 0x2a3350, ok ? 0x7ff0c0 : 0x3c4a70);
        c.add(b.c);
      } else {
        c.add(this.txt(x0 + pw - 100 * u, y + 40 * u, 'Maxed out', 18, '#7ff0c0', true, [0.5, 0.5]));
      }
      y += rh;
    }
    const back = this.btn(W / 2, y0 + ph - 38 * u, 260 * u, 48 * u, 'Back to the job board', 18, () => { sfx.click(); this.openBoard(); }, 0x1c2a52, EDGE);
    c.add(back.c);
  }
}
