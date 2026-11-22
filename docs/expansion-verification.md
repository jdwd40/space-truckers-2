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

- Routing by time (#21): from Kestrel Station, take a contract to Terra Nova. The sat-nav must send you along Harbor Run with a pass-through at Harbor Prime, not over M2 and M1 through the central interchange.
- Routing by time (#21): on a Harbor Prime contract board, compare pay and deadlines with the previous build. Contracts that pass through a station pay slightly less (pay now counts only physical distance), and deadlines stay within a few seconds of before.
- Fuel & Repair (#23): Drive Harbor Run eastbound from Harbor Prime with a trailer. The gantry 1.5 km before Harbor Pumps and the side sign at the exit must read "Fuel & Repair" with the pump-and-spanner icon. Ordinary fuel stops must not mention repair.
- Fuel & Repair (#23): Take the exit. On the entry road the sat-nav must say "Fuel stop · press D for the repair bay". Press D: a toast confirms the repair bay; press A to switch back to the pumps, then D again.
- Fuel & Repair (#23): The rig must turn off beside the pumps into the hatched bay under the yellow roof and stop at the white line. A quote must appear reading "No damage to repair", total ¢0.
- Fuel & Repair (#23): Authorise it (button or Enter): control returns, the rig pulls out and merges back onto Harbor Run eastbound beyond the facility, finding a gap in traffic by itself. Repeat with Decline (button or Esc).
- Fuel & Repair (#23): Repeat at Frost Fuel on Frost Line towards Glacier Outpost, and check the quote at desktop and narrow portrait sizes.
- Fuel & Repair (#23): Without pressing D, the rig must go to the pumps and refuel as at any fuel stop, then rejoin the same carriageway. Run low on fuel before Harbor Pumps: the sat-nav must guide you to it.
- Fuel & Repair (#23): Watch AI traffic at both facilities: it uses the pumps, never the repair bay, and merges back in without stopping on the carriageway.

## Scope boundaries

Roadworks are placed once when the world is built and stay for the session. Sites sit wholly inside one road section, clear of joins, lane tapers, slip roads, signals and stations.

A pull request is not a deployment. Changes remain on the feature branch until reviewed and merged.
