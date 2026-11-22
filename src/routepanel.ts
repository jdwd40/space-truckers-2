import Phaser from 'phaser';
import type { SectorMapScene } from './sectormap';
import { FONT, strokeRoute } from './render';
import { FACILITY_NAME } from './network';

/** the route the sat-nav follows is cyan, as on the rest of the map; the other compared route is amber */
const FOLLOWED = 0x3ff0ff, OTHER = 0xffa64d;
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
/** contract-clock seconds as m:ss */
export const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/**
 * The route comparison on the sector map: a card in the map's chrome (bottom left, or along the bottom of a narrow
 * screen) comparing the fastest route with the best alternative against the contract deadline, and the alternative
 * drawn on the map. Tapping a route follows it; tapping it again cancels. Hidden without a contract.
 */
export class RoutePanel {
  private box: Phaser.GameObjects.Container | null = null;
  /** the comparison shown, worked out when the card is built (not on every pan or zoom) */
  private cmp: ReturnType<SectorMapScene['world']['routeComparison']> = null;

  constructor(private map: SectorMapScene) {
    map.layouts.push(() => this.build());
    // the compared route the sat-nav is not following, under the followed one
    map.overlays.unshift((g, _v, px) => {
      const cmp = this.cmp;
      if (!cmp) return;
      const followed = this.followed();
      cmp.options.forEach((o, i) => {
        if (i === followed) return;
        const pts = map.world.net.routePoints(o.route, o.start.seg, o.start.s, Math.max(80, px * 6));
        if (pts.length < 2) return;
        strokeRoute(g, pts, Math.max(80, px * 5), Math.max(45, px * 2.5), OTHER, 0.9);
      });
    });
  }

  /**
   * The compared route the sat-nav follows: the picked one, or the fastest when none is picked. With a waypoint set it
   * follows neither (-1), so both are drawn as alternatives.
   */
  private followed(): number {
    return !this.cmp || this.map.world.waypoint ? -1 : Math.max(0, this.cmp.picked);
  }

  /** rebuild the card for the current contract and screen size */
  build() {
    this.box?.destroy(true); this.box = null;
    const map = this.map, cmp = this.cmp = map.world.routeComparison();
    if (!cmp || !cmp.options.length) return;
    const W = map.scale.width, H = map.scale.height, u = map.u, narrow = W < 640;
    const pad = 12 * u, rowH = 64 * u, headH = 46 * u;
    const w = narrow ? W - 2 * pad : Math.min(440 * u, W - 2 * pad);
    const h = headH + cmp.options.length * (rowH + 6 * u) + (cmp.picked >= 0 ? 4 * u : 0) + 26 * u;
    const x = pad, y = H - h - (narrow ? 44 * u : pad);
    const c = this.box = map.add.container(x, y); map.chrome.add(c);
    const txt = (tx: number, ty: number, s: string, size: number, color: string, bold = true) =>
      map.add.text(tx, ty, s, { fontFamily: FONT, fontSize: `${Math.round(size * u)}px`, fontStyle: bold ? 'bold' : 'normal', color })
        .setResolution(Math.min(2, window.devicePixelRatio || 1));
    const g = map.add.graphics();
    g.fillStyle(0x000000, 0.3); g.fillRoundedRect(3 * u, 4 * u, w, h, 12 * u);
    g.fillStyle(0x111a33, 0.94); g.fillRoundedRect(0, 0, w, h, 12 * u);
    g.lineStyle(2 * u, 0x3c5a9a, 1); g.strokeRoundedRect(0, 0, w, h, 12 * u);
    c.add(g);
    // the card swallows taps so nothing under it is inspected
    const back = map.add.zone(w / 2, h / 2, w, h).setInteractive();
    back.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, ev: Phaser.Types.Input.EventData) => ev?.stopPropagation?.());
    c.add(back);
    const st = map.world.jobStation()!;
    c.add(txt(14 * u, 10 * u, `ROUTES TO ${st.name.toUpperCase()}`, 14, '#ffffff'));
    c.add(txt(w - 14 * u, 12 * u, `deadline ${clock(cmp.deadline)}`, 13, '#ffd23c').setOrigin(1, 0));
    const followed = this.followed();
    cmp.options.forEach((o, i) => {
      const ry = headH + i * (rowH + 6 * u), picked = cmp.picked === i, col = i === followed ? FOLLOWED : OTHER;
      const rg = map.add.graphics();
      rg.fillStyle(picked ? 0x1d3a5c : 0x18234a, 1); rg.fillRoundedRect(8 * u, ry, w - 16 * u, rowH, 9 * u);
      rg.lineStyle((picked ? 2.5 : 1.5) * u, picked ? col : 0x2c3f73, 1); rg.strokeRoundedRect(8 * u, ry, w - 16 * u, rowH, 9 * u);
      rg.fillStyle(col, 1); rg.fillRoundedRect(16 * u, ry + 10 * u, 6 * u, rowH - 20 * u, 3 * u);
      c.add(rg);
      const late = o.eta > cmp.deadline;
      c.add(txt(32 * u, ry + 8 * u, `${picked ? '✓ Following' : i === 0 ? 'Fastest' : 'Alternative'} · ${o.name}`, 14, hex(col)));
      c.add(txt(w - 18 * u, ry + 8 * u, `ETA ${clock(o.eta)} ${late ? 'late' : 'on time'}`, 14, late ? '#ff8a8a' : '#7ff0c0').setOrigin(1, 0));
      const cams = `${o.cameras.length} camera${o.cameras.length === 1 ? '' : 's'}`;
      const fac = o.facilities.length
        ? o.facilities.map((f) => f.name + (f.kind === 'fuel-repair' ? ` (${FACILITY_NAME[f.kind]})` : ' (fuel)')).join(', ')
        : 'no fuel or repair';
      const sub = txt(32 * u, ry + 30 * u, `${o.roads.join(' › ')} · ${cams}\n${fac}`, 11.5, '#a9bce6', false);
      sub.setWordWrapWidth(w - 50 * u).setLineSpacing(1 * u);
      c.add(sub);
      const zone = map.add.zone(w / 2, ry + rowH / 2, w - 16 * u, rowH).setInteractive({ useHandCursor: true });
      zone.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, ev: Phaser.Types.Input.EventData) => {
        ev?.stopPropagation?.();
        if (picked) map.world.clearRouteChoice(); else map.world.pickRoute(i);
        this.build(); map.redraw();
      });
      c.add(zone);
    });
    const foot = map.world.waypoint ? 'Following your waypoint · tap a route to follow it instead'
      : cmp.picked >= 0 ? 'Tap the followed route again to go back to the fastest' : 'Tap a route for the sat-nav to follow it';
    c.add(txt(14 * u, h - 22 * u, foot, 11, '#8fa6d8', false));
  }
}
