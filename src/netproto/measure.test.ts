/**
 * PROTOTYPE — throwaway, never merge. Not a test: a headless measurement run for the network feel prototype
 * (`npm run proto:netfeel:measure`). A bot drives contracts at the posted limit, changing lane every few seconds, through
 * full traffic held by the simulated authority, and the prediction error is logged for each network setting.
 */
import { it, vi } from 'vitest';
declare const process: { env: Record<string, string | undefined>; stdout: { write(s: string): void } };
vi.mock('phaser', async () => (await import('../test-phaser')).phaserStub);
import { G } from '../state';
import { headlessWorld, holdLimit, STEP } from '../test-world';
import { CFG, NetProto } from './netproto';
import type { WorldScene } from '../world';

const SECONDS = Number(process.env.NETFEEL_SECONDS ?? 240);

function run(label: string, cfg: Partial<typeof CFG>) {
  Object.assign(CFG, { rtt: 100, jitter: 0, loss: 0, snapRate: 20, interp: -1, display: 'interp', lanes: 'predict', smooth: true }, cfg);
  const { scene, net } = headlessWorld('harbor');
  vi.mocked(Math.random).mockRestore(); // headlessWorld pins it; the authority's traffic needs the real one
  (scene as any).refreshPlayerVis = () => {};
  scene.traffic.view = { x: scene.player.x, y: scene.player.y, r: 1600 };
  const np = new NetProto(scene);
  const ids = net.stations.map((s) => s.id);
  let laneT = 3, stuck = 0, trips = 0, docks = 0, laneAsks = 0;
  const newTrip = () => {
    const from = scene.station ?? net.byId.harbor;
    const to = ids.filter((id) => id !== from.id)[Math.floor(Math.random() * (ids.length - 1))];
    G.job = null; G.mode = 'drive'; G.fuel = 1;
    scene.depart(from, to, true);
    (scene as any).gotoId = to;
    trips++;
  };
  // free-roam towards a station: goals() falls back to the job, so give the rig a plain delivery job
  const origGoals = scene.goals.bind(scene);
  scene.goals = () => { const id = (scene as any).gotoId; return id ? net.stationGoals(net.byId[id]) : origGoals(); };
  newTrip();
  let speedSum = 0, moving = 0;
  for (let t = 0; t < SECONDS; t += STEP) {
    for (const q of scene.pending) q.t -= STEP;
    const due = scene.pending.filter((q) => q.t <= 0);
    if (due.length) { scene.pending = scene.pending.filter((q) => q.t > 0); for (const q of due) q.fn(); }
    const p = scene.player;
    scene.traffic.view = { x: p.x, y: p.y, r: 1600 };
    if (scene.pstate === 'docked' || G.mode !== 'drive') { docks++; newTrip(); }
    if (scene.pstate === 'drive' || scene.pstate === 'docking') {
      holdLimit(scene);
      laneT -= STEP;
      if (laneT <= 0 && p.seg.kind === 'motorway' && p.lane >= 0 && p.lane < p.seg.lanes && p.pend === null) {
        laneT = 2 + Math.random() * 5;
        // keep to the route near an exit; otherwise wander between lanes
        const exit = p.route[0];
        if (!(exit && exit.from === p.seg && exit.type === 'exit' && exit.fromS - p.s < 3000)) { const d = p.lane === 0 ? 1 : p.lane === p.seg.lanes - 1 ? -1 : Math.random() < 0.5 ? -1 : 1; if (p.seg.lanes > 1) { scene.laneChange(d); laneAsks++; } }
      }
      // the sat-nav's exit: arm it as a player would
      const exit = p.route[0];
      if (exit && exit.from === p.seg && exit.type === 'exit' && exit.fromS - p.s < 2500 && p.pend === null && p.lane >= 0 && p.lane < p.seg.lanes) {
        const edge = exit.side > 0 ? p.seg.lanes - 1 : 0;
        if (p.lane !== edge) scene.laneChange(exit.side); else if (!scene.armed && p.s < exit.fromS - 60) scene.laneChange(exit.side);
      }
    }
    if (scene.pstate === 'parked') scene.setSpeed(3); // pulled into a lay-by by an armed exit: pull out again
    const prevS = p.s, prevSeg = p.seg;
    np.tick(STEP);
    (scene as any).playerLogic(STEP, prevS, prevSeg);
    speedSum += p.v; if (p.v > 20) moving++;
    if (process.env.NETFEEL_DEBUG && Math.abs(t % 20) < STEP) process.stdout.write(`\nDBG t=${t.toFixed(0)} v=${p.v.toFixed(0)} pstate=${scene.pstate} mode=${G.mode} state=${p.state} seg=${p.seg.name}/${p.seg.kind} s=${p.s.toFixed(0)}/${p.seg.len.toFixed(0)} lane=${p.lane}/${p.seg.lanes} pend=${p.pend} brk=${G.braking} set=${G.speedSet} gap=${p.leadGap.toFixed(0)} fuel=${G.fuel.toFixed(2)} route=${p.route.length} pump=${p.pump}`);
    // a bot wedged somewhere (a missed exit loop, a full pump) starts a new trip rather than spoil the run
    stuck = p.v < 1 ? stuck + STEP : 0;
    if (stuck > 40) { stuck = 0; scene.station = net.byId[ids[Math.floor(Math.random() * ids.length)]]; newTrip(); }
  }
  const es = np.allErr.slice().sort((a, b) => a - b), q = (f: number) => es[Math.min(es.length - 1, Math.floor(es.length * f))] ?? 0;
  const st = np.stats, s = np.summary(SECONDS);
  const row = {
    setting: label, 'shown behind (ms)': Math.round(s.behind),
    'err mean': +(es.reduce((a, b) => a + b, 0) / Math.max(1, es.length)).toFixed(2), 'err p95': +q(0.95).toFixed(1), 'err p99': +q(0.99).toFixed(1), 'err max': +q(1).toFixed(1),
    '>2u %': +(100 * st.corrections / Math.max(1, st.sampled)).toFixed(1),
    'lane asks': laneAsks, overruled: st.overrules, 'hard snaps': st.hard, 'bumps auth': st.authBumps, 'bumps client': st.clientBumps,
    'avg speed': Math.round(speedSum / (SECONDS / STEP)), 'moving %': Math.round(100 * moving / (SECONDS / STEP)), docks, ships: st.ships, 'kB/s': +s.kbps.toFixed(1),
  };
  G.job = null; G.mode = 'drive'; G.braking = false; G.speedSet = 0;
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  return row;
}

it('measures prediction error across network settings', () => {
  const rows = [
    run('0 ms, 50 Hz, no delay', { rtt: 0, snapRate: 50, interp: 0 }),
    ...(process.env.NETFEEL_DEBUG ? [] : [
    run('50 ms, 20 Hz', { rtt: 50 }),
    run('100 ms, 20 Hz', { rtt: 100 }),
    run('200 ms, 20 Hz', { rtt: 200 }),
    run('200 ms, 10 Hz', { rtt: 200, snapRate: 10 }),
    run('200 ms, 20 Hz, guessed forward', { rtt: 200, display: 'extrap' }),
    run('100 ms, 20 Hz, guessed forward', { rtt: 100, display: 'extrap' }),
    run('200 ms, 20 Hz, lanes wait', { rtt: 200, lanes: 'wait' }),
    run('200 ms, 20 Hz, jitter 60, loss 10%', { rtt: 200, jitter: 60, loss: 0.1 }),
    ]),
  ];
  const keys = Object.keys(rows[0]) as (keyof typeof rows[0])[];
  const out = [keys.join(' | '), ...rows.map((r) => keys.map((k) => r[k]).join(' | '))].join('\n');
  process.stdout.write('\n' + out + '\n');
}, 600000);
