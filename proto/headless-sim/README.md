# PROTOTYPE: headless simulation feasibility

Throwaway. Answers "Headless simulation feasibility" (issue #35): can the simulation tick in plain Node without Phaser,
and what does a session with 8 drivers cost? The verdict and the numbers are on that issue. Never merge this branch.

Run: `npm run proto:headless` (env: `ONLY=AC` picks scenarios, `WARM` and `MEASURE` are seconds of simulated time).

- `main.ts`: builds Network, Roadworks, Traffic and Incidents, drives 1 or 8 bot rigs between stations, times every tick.
- `phaser-stub.ts`: all of Phaser the simulation modules need at run time.
- `build.mjs`: esbuild bundle to one `.mjs` with `phaser` aliased to the stub.
- `src/traffic.ts` on this branch carries a rough multi-driver patch (per-rig controller, a view per driver, collisions for
  every driver). The 303 existing tests still pass with it.
