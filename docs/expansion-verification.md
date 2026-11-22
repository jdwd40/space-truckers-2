# Haulage expansion: verification guide

## Automated gates

```sh
npm ci
npm test
npm run typecheck
npm run build
```

`npm test` runs the simulation/helper regression suite using Vitest. Headless unit tests do not replace the rendered-game checks below. CI runs the same three quality gates on pull requests and pushes to `main`.

## Playtest checklist

Start the game with `npm run dev`. Do not alter production saves to run a playtest: use a fresh browser profile or a disposable local save.

### Network and navigation (#10, #12, #14)

- Check the new roads on the sat-nav and drive both directions.
- Take a delivery across the network; all seven original stations must remain reachable.
- Drive widened highways through lane gains/drops, slip roads, services and station gates; lane paint and traffic must align.
- Introduce an accident or queue downstream of a bypass exit, then check the sat-nav selects a useful alternative before the exit is passed.
- Drive the suggested exit and merge back without teleporting through a station.
- Clear the obstruction and check ordinary routing becomes available again.
- Check a blockage behind the player or beyond an earlier exit does not incorrectly penalise the traversed route.
- Without a useful bypass, routing must still offer the best reachable route rather than dropping the destination.

### Traffic (#11)

- Check initial population and ongoing arrivals on multiple highways, not just the starting road.
- Look for different passenger, civilian, service and freight traffic with different lengths and cruise speeds.
- Observe safe following, overtaking, merging around incident cones and queues building/clearing.
- Check ordinary population remains within its configured budget during initial fill, dock bursts and convoys; incident responders and the player's vehicle are accounted for separately where appropriate.

### Cargo handling (#13)

- Compare the same cruise setting with no cargo, a small load and a road train.
- At the same starting speed, heavier cargo must take longer to stop and cover more stopping distance.
- Repeat using the brake control and a reduction in cruise setting; check automatic following and docking as well.
- Check remote pickup starts empty, collecting cargo applies the loaded handling, and delivery restores empty handling.
- Buy a cab upgrade and confirm its acceleration benefit applies once, including after subsequent loading/unloading.

### Accident camera (#15)

- Cause a player collision and watch the view transition to a centred incident overview.
- The rig, police/repair crew ahead, cone taper and an upstream queue must remain visible, without the HUD obscuring the scene.
- Keep the view through waiting and repair; confirm normal look-ahead framing returns after release.
- Repeat at desktop and narrow portrait sizes, including a resize during the incident.
- Pause during the transition; simulation and camera movement must remain frozen until resume.

### Roadworks (#7)

- Find a site on the map (amber dot). Amber gantries at 2 km, 1 km and 300 m must say which lanes are closed and which way to keep.
- The road markings on the approach must show a green arrow on every open lane and a red cross on every closed one; the sat-nav lane display must match them.
- Every closed lane must have a barrier at the start and end of the works, with a barrier line along the open lanes.
- Stay in a closed lane: your rig must stop at the barrier and pressing A or D must take you out, including from the far lane of a two-lane closure.
- Watch traffic slow on the approach, leave the closed lanes, zip in at the barrier when busy, and pick up speed after the works.

### Milestone 1: corridor and sector map

Sector map (#26):
- While driving, press `M` or tap **MAP (M)** under the pause and mute buttons. The full-screen sector map must open over the whole network, with every road, station and fuel stop visible below the title bar, and the HUD hidden.
- Traffic, fuel, the delivery clock and the camera must stay frozen while the map is open. Close it with `M`, `Esc`, `P` or **✕ Close**: the rig must carry on from exactly where it was, at the same speed, with the HUD back.
- `M` must do nothing on the title screen, the job board, the garage or the pause menu. Mute is now `N` (the ♪ button is unchanged).
- Desktop: the mouse wheel zooms about the pointer and dragging pans. Zoom in on a junction until lane lines appear: flyovers must be drawn over the roads they cross, and the lines must stay sharp.
- Touch, narrow portrait (about 390 × 844): pinch zooms, one-finger drag pans, and taps on the map must not reach the hidden HUD (the selected speed must not change).
- Station names, road names and fuel stop names must stay the same size on screen at every zoom and never overlap; near a screen edge a station name moves under or over its ring instead of being cut off. Lay-by names appear once zoomed in.
- The player's arrow must sit on the rig's road pointing the way it drives, with the current route in cyan to the goal.
- Close and reopen the map in the same session: it must show the same place at the same zoom. Reloading the page starts again from the whole network.
- The HUD sat-nav must look and work as before, including at the far corners of the network (Polar Express, Ember Belt).

## Scope boundaries

Roadworks are placed once when the world is built and stay for the session. Sites sit wholly inside one road section, clear of joins, lane tapers, slip roads, signals and stations.

A pull request is not a deployment. Changes remain on the feature branch until reviewed and merged.
