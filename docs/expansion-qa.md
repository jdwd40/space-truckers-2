# Expansion QA results

Base revision: `bc434bc`.

## Automated checks

- `npm test`: 85 tests passed across nine files, including cross-section accident framing, responder release/budget accounting, and a two-searches-per-update routing budget regression.
- `npm run typecheck`: passed.
- `npm run build`: passed. The existing large-bundle warning remains; this change does not claim to resolve bundle size.
- `git diff --check`: passed.
- Added-line/new-file scan found no hardcoded-secret, dangerous-eval, shell-injection or unsafe-deserialization pattern matches. This is a limited static check, not a security audit.

The tests cover all original station-pair reachability, widened lane alignment, bypass connectivity and road geometry, closure/jam penalties and recovery, route-refresh bounds, population limits, varied traffic selection, spawn safety, heavy-load acceleration and stopping, load/unload/upgrade refresh, and incident camera state/framing.

Both lanes of all four bypass directions were driven using the real Traffic simulation. Each simulated position was checked for routes to all seven stations. This caught an initial terminal-exit dead end; the bypasses now have continuous mandatory motorway returns with a 2-to-1 lane taper.

## Rendered browser checks

Ran the Vite development build in Chromium with controlled development-only player/traffic setup; these checks did not modify the production game or deploy anything.

- Confirmed 15 roads (including two avenues), all seven stations, M1 lane profile 5/6/5, and a bounded ordinary population plus the player.
- Triggered an actual player collision using the incident manager and advanced the real Traffic/Incidents simulation until both police and tow truck arrived and the incident entered repair.
- At 1440×900, the camera centred on the complete player rig to within 0.001 world units; cones and emergency response remained in the central gameplay view.
- Resized the same active repair scene to 390×844; the rig remained centred to within 0.001 world units and the existing HUD remained usable.
- Paused through 30 scene updates: player position, overview blend and zoom did not change.
- Released the repair and advanced the camera: player state returned to `drive` and overview blend fell below 0.001, despite the lingering incident-clear phase.
- No uncaught JavaScript errors or unhandled promise rejections were recorded during the final scoped browser run.

## Limits / remaining review

- This is a scoped simulation and visual smoke test, not a complete delivery playthrough on every route, a long-session performance benchmark, or a physical mobile-device test.
- Congestion balance and traffic density still merit normal gameplay review.
- Roadworks are covered by #7; see the roadworks checklist in `expansion-verification.md`.
- The pull request is not merged or deployed by this work.
