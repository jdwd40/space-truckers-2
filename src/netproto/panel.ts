/** PROTOTYPE — throwaway, never merge. The on-screen controls and read-outs for the network feel prototype. */
import { CFG, NetProto } from './netproto';

type Opt = [label: string, value: string | number | boolean];
const ROWS: { key: keyof typeof CFG; label: string; opts: Opt[] }[] = [
  { key: 'rtt', label: 'Latency (round trip)', opts: [['0 ms', 0], ['50 ms', 50], ['100 ms', 100], ['200 ms', 200], ['400 ms', 400]] },
  { key: 'jitter', label: 'Jitter', opts: [['none', 0], ['up to 20 ms', 20], ['up to 60 ms', 60]] },
  { key: 'loss', label: 'Snapshots lost', opts: [['none', 0], ['2%', 0.02], ['10%', 0.1]] },
  { key: 'snapRate', label: 'Snapshot rate', opts: [['5 Hz', 5], ['10 Hz', 10], ['20 Hz', 20], ['30 Hz', 30], ['50 Hz', 50]] },
  { key: 'interp', label: 'Interpolation delay', opts: [['2 snapshots', -1], ['0 ms', 0], ['50 ms', 50], ['100 ms', 100], ['200 ms', 200]] },
  { key: 'display', label: 'Other ships drawn', opts: [['in the past (interpolated)', 'interp'], ['guessed forward to now', 'extrap']] },
  { key: 'lanes', label: 'Your lane changes', opts: [['predicted at once', 'predict'], ['wait for the authority', 'wait']] },
  { key: 'smooth', label: 'Corrections', opts: [['smoothed', true], ['in one jump', false]] },
  { key: 'truth', label: 'Show authority positions', opts: [['off', false], ['on (magenta)', true]] },
];

export function mountPanel(np: NetProto) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:158px;left:8px;z-index:50;width:310px;font:12px/1.35 system-ui,sans-serif;color:#dfe9ff;background:rgba(8,14,36,.88);border:1px solid #37508f;border-radius:8px;padding:8px 10px;';
  el.innerHTML = `<div style="display:flex;justify-content:space-between;cursor:pointer" id="np-h"><b>PROTOTYPE · network feel</b><span id="np-t">hide</span></div>
<div id="np-b"><div style="margin:4px 0 6px;color:#9fb4e6">Your rig is predicted here; every other ship comes from a simulated server. Does driving still feel right at 50, 100 and 200 ms?</div>
<div id="np-rows"></div><pre id="np-s" style="margin:6px 0 0;font:11px/1.4 ui-monospace,monospace;color:#bfe3c8;white-space:pre-wrap"></pre>
<button id="np-r" style="margin-top:4px">reset counters</button></div>`;
  document.body.appendChild(el);
  // keys pressed in the panel must not drive the rig
  for (const ev of ['keydown', 'keyup', 'pointerdown', 'mousedown', 'touchstart']) el.addEventListener(ev, (e) => e.stopPropagation());
  const rows = el.querySelector('#np-rows')!;
  for (const r of ROWS) {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin:2px 0;gap:8px';
    const sel = document.createElement('select');
    sel.style.cssText = 'background:#111b3d;color:#dfe9ff;border:1px solid #37508f;border-radius:4px;font:inherit;max-width:175px';
    r.opts.forEach(([label, value], i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = label; if (value === CFG[r.key]) o.selected = true; sel.appendChild(o); });
    sel.onchange = () => { (CFG as any)[r.key] = r.opts[Number(sel.value)][1]; sel.blur(); };
    row.append(r.label, sel);
    rows.appendChild(row);
  }
  const body = el.querySelector<HTMLElement>('#np-b')!, tog = el.querySelector('#np-t')!;
  el.querySelector<HTMLElement>('#np-h')!.onclick = () => { body.hidden = !body.hidden; tog.textContent = body.hidden ? 'show' : 'hide'; };
  el.querySelector<HTMLElement>('#np-r')!.onclick = () => np.reset();
  const out = el.querySelector('#np-s')!;
  setInterval(() => {
    const s = np.summary(), st = np.stats, f = (x: number) => x.toFixed(1);
    out.textContent =
`other ships shown ${s.behind.toFixed(0)} ms behind your rig
prediction error, last 10 s (a cab is 26 long)
  mean ${f(s.mean)}   95% ${f(s.p95)}   worst ${f(s.max)}
biggest single correction step ${f(s.jump)}
errors over 2 units: ${st.corrections} of ${st.sampled} snapshots
lane changes overruled: ${st.overrules}   put back on road: ${st.hard}
bumps: authority ${st.authBumps}, seen here ${st.clientBumps}
snapshot: ${st.ships} ships, about ${f(s.kbps)} kB/s`;
  }, 250);
}

/** magenta markers where the authority has each ship right now */
export function drawTruth(np: NetProto, g: { clear(): unknown; lineStyle(w: number, c: number, a: number): unknown; lineBetween(a: number, b: number, c: number, d: number): unknown; strokeCircle(x: number, y: number, r: number): unknown }) {
  g.clear();
  if (!CFG.truth) return;
  for (const v of np.truth()) {
    g.lineStyle(v.rig ? 3 : 2, v.rig ? 0xffffff : 0xff40ff, 0.75);
    g.lineBetween(v.x, v.y, v.x - Math.cos(v.h) * v.len, v.y - Math.sin(v.h) * v.len);
    g.strokeCircle(v.x, v.y, v.rig ? 7 : 4);
  }
}
