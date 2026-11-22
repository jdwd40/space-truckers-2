/**
 * PROTOTYPE, throwaway. Question (issue #35): can Network, Traffic, Incidents, Roadworks and player rigs tick in plain
 * Node without Phaser, and what does a session cost? Run with `npm run proto:headless`.
 *
 * Drivers are bots, not WorldScene: each has its own controller (cruise at the limit, obey signals, take its exits,
 * leave closed lanes), drives to a random station, "docks" by reappearing at that station\x27s departure gate, and repeats.
 */
import { Network, type Station } from "../../src/network";
import { Traffic, TRAFFIC_CFG, Veh, type PlayerCtl } from "../../src/traffic";
import { Incidents } from "../../src/incidents";
import { Roadworks } from "../../src/roadworks";
import { SPEEDS } from "../../src/speeds";
import { pick } from "../../src/geom";

const STEP = 0.02, VIEW_R = 1600;
const now = () => Number(process.hrtime.bigint()) / 1e6;

interface Scenario { name: string; drivers: number; maxVehicles: number; maxLocals: number; lod: boolean; multi: boolean }
const NEAR = Math.ceil(TRAFFIC_CFG.nearTarget * TRAFFIC_CFG.hubBoost); // 146: the busiest a driver\x27s surroundings get
const scaled = (n: number) => ({ maxVehicles: 500 - NEAR + n * NEAR, maxLocals: n * NEAR + 40 });
const SCENARIOS: Scenario[] = [
  { name: "A solo, code as shipped (1 driver, 500 budget)", drivers: 1, maxVehicles: 500, maxLocals: 560, lod: true, multi: false },
  { name: "B 8 drivers sharing today\x27s 500 budget", drivers: 8, maxVehicles: 500, maxLocals: 560, lod: true, multi: true },
  { name: "C 8 drivers, budget scaled so each sees solo density", drivers: 8, ...scaled(8), lod: true, multi: true },
  { name: "D as C, every ship stepped at full rate (no far LOD)", drivers: 8, ...scaled(8), lod: false, multi: true },
];

interface Bot { v: Veh; dest: Station; stuck: number; trips: number; resets: number; view: { x: number; y: number; r: number } }

function run(sc: Scenario, warmS: number, measureS: number) {
  Veh.NID = 1;
  TRAFFIC_CFG.maxVehicles = sc.maxVehicles; TRAFFIC_CFG.maxLocals = sc.maxLocals;
  const t0 = now();
  const net = new Network();
  const works = new Roadworks(net); works.place();
  const tBuild = now() - t0;

  const bots: Bot[] = [];
  const reroute = (v: Veh) => {
    const b = bots.find((x) => x.v === v)!;
    const side = v.lane >= v.seg.lanes ? 1 : v.lane < 0 ? -1 : 0;
    const r = net.route(v.seg, v.s, net.stationGoals(b.dest), side, true);
    v.route = r ? r.trans : []; v.goal = r ? r.goal : null;
  };
  const ctl: PlayerCtl = {
    desired: (v) => SPEEDS[v.seg.limitAt(v.s)],
    extraGap: () => Infinity,
    obeySignal: (_v, _st, state) => state !== "G",
    brakeMin: () => null,
    onTrans: () => {},
    onBlocked: () => {},
    onRouteNeeded: reroute,
  };
  const traffic = new Traffic(net, ctl);
  traffic.lod = sc.lod;
  // dock gates, as WorldScene.create adds them (edgeS lives in render.ts, so approximate the positions)
  for (const st of net.stations) {
    for (const seg of st.arr) traffic.addGate(seg, seg.len - 200);
    for (const seg of st.dep) traffic.addGate(seg, 300);
  }
  const inc = new Incidents(net, traffic, { playerCrashed() {}, playerReleased() {}, bump() {} });

  const place = (b: Bot, st: Station) => {
    const seg = st.dep[0], v = b.v;
    v.seg = seg; v.s = 150; v.lane = seg.lanes - 1; v.lat = seg.laneLat(v.lane); v.v = 0; v.pend = null; v.state = "drive";
    v.resetTrail();
    b.dest = pick(net.stations.filter((o) => o !== st));
    v.route = []; reroute(v);
  };
  for (let i = 0; i < sc.drivers; i++) {
    const st = net.stations[i % net.stations.length], seg = st.dep[0];
    const v = traffic.add("player", seg, 150, seg.lanes - 1, 0);
    v.setTrailers([54]);
    const b: Bot = { v, dest: st, stuck: 0, trips: 0, resets: 0, view: { x: v.x, y: v.y, r: VIEW_R } };
    bots.push(b); place(b, st);
  }
  traffic.player = bots[0].v; traffic.view = bots[0].view;
  if (sc.multi) { traffic.views = bots.map((b) => b.view); traffic.players = bots.map((b) => b.v); for (const b of bots) b.v.ctl = ctl; }
  const tPop0 = now(); traffic.populate(); const tPop = now() - tPop0;

  const botLane = (v: Veh) => {
    if (v.pend !== null) return;
    const seg = v.seg, n = seg.lanes;
    if (seg.kind === "ramp" || seg.kind === "services") return;
    if (v.lane >= n || v.lane < 0) {
      const side = v.lane < 0 ? -1 : 1, z = seg.auxAt(v.s, side);
      if (!(z && z.type === "exit")) traffic.ask(v, side > 0 ? n - 1 : 0, true);
      return;
    }
    if (traffic.laneClosed(seg, v.lane, v.s)) {
      const out = traffic.stepOut(seg, v.lane, v.s);
      if (out !== null) traffic.ask(v, out, true);
      return;
    }
    const t = v.route[0];
    if (t && t.from === seg && t.type === "exit" && t.fromS - v.s < 2800) {
      const edge = t.side > 0 ? n - 1 : 0;
      if (v.lane !== edge) traffic.ask(v, v.lane + t.side, true);
      else if (v.s >= t.aux!.s0 + 5 && v.s < t.fromS - 30) traffic.ask(v, t.side > 0 ? n : -1, true);
      return;
    }
    if (traffic.dropping(seg, v.lane, v.s) && v.lane > 0) traffic.ask(v, v.lane - 1, true);
  };

  let tick = 0;
  const step = () => {
    const focus = bots[tick % bots.length];
    traffic.player = focus.v; traffic.view = focus.view; // Incidents reads the single player and view: take turns
    for (const b of bots) {
      const v = b.v;
      b.view.x = v.x; b.view.y = v.y;
      if (tick % 10 === 0) botLane(v);
      if (v.seg.arrStation && v.s > v.seg.len - 160) { b.trips++; place(b, v.seg.arrStation as Station); }
      b.stuck = v.v < 1 && v.state !== "crashed" ? b.stuck + STEP : 0;
      if (b.stuck > 90) { b.resets++; b.stuck = 0; place(b, pick(net.stations)); }
    }
    traffic.update(STEP);
    inc.update(STEP, true);
    tick++;
  };

  for (let i = 0; i < warmS / STEP; i++) step();
  if (global.gc) global.gc();
  const N = Math.round(measureS / STEP), ms = new Float64Array(N);
  let vehSum = 0, farSum = 0, incMax = 0, km = 0;
  const cpu0 = process.cpuUsage(), w0 = now();
  for (let i = 0; i < N; i++) {
    const a = now(); step(); ms[i] = now() - a;
    vehSum += traffic.vs.length; incMax = Math.max(incMax, inc.list.length);
    let far = 0; for (const v of traffic.vs) if (v.far) far++;
    farSum += far;
    for (const b of bots) km += b.v.v * STEP;
  }
  const wall = now() - w0, cpu = process.cpuUsage(cpu0);
  ms.sort();
  const q = (p: number) => ms[Math.min(N - 1, Math.floor(N * p))], mean = ms.reduce((a, b) => a + b, 0) / N;
  const mem = process.memoryUsage();
  return {
    scenario: sc.name,
    "vehicles (mean)": Math.round(vehSum / N), "of which far (mean)": Math.round(farSum / N),
    "tick mean ms": +mean.toFixed(3), "p50": +q(0.5).toFixed(3), "p95": +q(0.95).toFixed(3), "p99": +q(0.99).toFixed(3), "max": +q(1).toFixed(2),
    "% of one core at 50 Hz": +((mean / (STEP * 1000)) * 100).toFixed(1),
    "max tick rate Hz": Math.round(1000 / mean),
    "cpu s per sim s": +((cpu.user + cpu.system) / 1e6 / measureS).toFixed(4),
    "sim speed x real time": +(measureS * 1000 / wall).toFixed(1),
    "world build ms": Math.round(tBuild), "populate ms": Math.round(tPop),
    "heap MB": Math.round(mem.heapUsed / 1e6), "rss MB": Math.round(mem.rss / 1e6),
    "driver trips": bots.reduce((a, b) => a + b.trips, 0), "driver units driven": Math.round(km), "stuck resets": bots.reduce((a, b) => a + b.resets, 0),
    "incidents max active": incMax,
  };
}

const warm = Number(process.env.WARM ?? 60), measure = Number(process.env.MEASURE ?? 300);
const only = process.env.ONLY;
console.log(`node ${process.version} on ${process.arch}, warm-up ${warm}s, measured ${measure}s of simulated time at ${1 / STEP} Hz`);
const rows = SCENARIOS.filter((s) => !only || only.includes(s.name[0])).map((s) => { const r = run(s, warm, measure); console.log(JSON.stringify(r)); return r; });
console.table(Object.fromEntries(Object.keys(rows[0]).filter((k) => k !== "scenario").map((k) => [k, Object.fromEntries(rows.map((r) => [r.scenario[0], (r as any)[k]]))])));
