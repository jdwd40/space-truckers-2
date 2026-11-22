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

- Routing by time (#21, updated by #22): from Kestrel Station, take a contract to Terra Nova. With Harbor Run posted at 4, the sat-nav must send you over M2 and M1 through the central interchange, not along Harbor Run with a pass-through at Harbor Prime.
- Routing by time (#21, updated by #22): on a Harbor Prime contract board, compare pay with the previous build. Contracts that pass through a station pay slightly less (pay now counts only physical distance). Deadlines are now 1.15 times a legal run, so they are tighter than before, most of all on short contracts.
- Corridor (#22): drive Harbor Run and Frost Line. Limit signs must show 4 away from the stations (3 near them), Harbor Run must have one camera per carriageway, each after a "Speed check" sign, and Frost Line must have no cameras and no "Speed check" signs.
- Corridor (#22): at Harbor Prime, take a one-trailer contract to Glacier Outpost. The sat-nav must send you along Polar Express. Drive it at the posted limit: pass two "Speed check" signs and cameras and two lay-bys, with no fuel stop, and deliver early (about 114 s against a 131 s deadline) on about 40% of a tank.
- Corridor (#22): take the same contract but leave along Harbor Run. At Kestrel Station the rig must wait for dock clearance (about 20 s), then leave along Frost Line by itself without opening the job board. Driven at the posted limit, it arrives just after the deadline (about 135 s) and earns no early bonus.
- Fuel & Repair (#23): Drive Harbor Run eastbound from Harbor Prime with a trailer. The gantry 1.5 km before Harbor Pumps and the side sign at the exit must read "Fuel & Repair" with the pump-and-spanner icon. Ordinary fuel stops must not mention repair.
- Fuel & Repair (#23): Take the exit. On the entry road the sat-nav must say "Fuel stop · press D for the repair bay". Press D: a toast confirms the repair bay; press A to switch back to the pumps, then D again.
- Fuel & Repair (#23): The rig must turn off beside the pumps into the hatched bay under the yellow roof and stop at the white line. A quote must appear reading "No damage to repair", total ¢0.
- Fuel & Repair (#23): Authorise it (button or Enter): control returns, the rig pulls out and merges back onto Harbor Run eastbound beyond the facility, finding a gap in traffic by itself. Repeat with Decline (button or Esc).
- Fuel & Repair (#23): Repeat at Frost Fuel on Frost Line towards Glacier Outpost, and check the quote at desktop and narrow portrait sizes.
- Fuel & Repair (#23): Without pressing D, the rig must go to the pumps and refuel as at any fuel stop, then rejoin the same carriageway. Run low on fuel before Harbor Pumps: the sat-nav must guide you to it.
- Fuel & Repair (#23): Watch AI traffic at both facilities: it uses the pumps, never the repair bay, and merges back in without stopping on the carriageway.
- Sector map (#26): While driving, press `M` or tap **MAP (M)** under the pause and mute buttons. The full-screen sector map must open over the whole network, with every road, station and fuel stop visible below the title bar, and the HUD hidden.
- Sector map (#26): Traffic, fuel, the delivery clock and the camera must stay frozen while the map is open. Close it with `M`, `Esc`, `P` or **✕ Close**: the rig must carry on from exactly where it was, at the same speed, with the HUD back.
- Sector map (#26): `M` must do nothing on the title screen, the job board, the garage or the pause menu. Mute is now `N` (the ♪ button is unchanged).
- Sector map (#26): Desktop: the mouse wheel zooms about the pointer and dragging pans. Zoom in on a junction until lane lines appear: flyovers must be drawn over the roads they cross, and the lines must stay sharp.
- Sector map (#26): Touch, narrow portrait (about 390 × 844): pinch zooms, one-finger drag pans, and taps on the map must not reach the hidden HUD (the selected speed must not change).
- Sector map (#26): Station names, road names and fuel stop names (Harbor Pumps and Frost Fuel in orange, marked "Fuel & Repair") must stay the same size on screen at every zoom and never overlap; near a screen edge a station name moves under or over its ring instead of being cut off. Lay-by names appear once zoomed in.
- Sector map (#26): The player's arrow must sit on the rig's road pointing the way it drives, with the current route in cyan to the goal.
- Sector map (#26): Close and reopen the map in the same session: it must show the same place at the same zoom. Reloading the page starts again from the whole network.
- Sector map (#26): The HUD sat-nav must look and work as before, including at the far corners of the network (Polar Express, Ember Belt).
- Map inspection (#27): Open the map zoomed out. Every road name must sit on its own road: M2 is named on its north–south spine, Dockside Avenue and Skyport Avenue are named only once zoomed in far enough to fit along the avenue, and Meridian and Zenith Bypass are named on their loops when zoomed in, never on the central interchange.
- Map inspection (#27): Click (desktop) or tap (touch) a road. A card (bottom right; at the top, under the next-exit pill, on a narrow portrait screen) must show the carriageway, where it goes, its posted limit (Polar Express 5, Harbor Run and Frost Line 4) and its cameras (Polar Express 2 per carriageway, Harbor Run 1, Frost Line none). The carriageway is outlined and its cameras are marked as blue squares. With a mouse, hovering shows the same card until you click.
- Map inspection (#27): Click or tap Harbor Pumps or Frost Fuel: the card reads "Fuel & Repair" with the pumps and "Repair bay". An ordinary fuel stop lists only its pumps; a lay-by lists "Lay-by" and "Passengers". Tap empty map or ✕ to close the card; tapping the card itself must not inspect the road under it.
- Map inspection, closures (#27): Every roadworks site is marked with an amber diamond and the closed stretch is drawn in amber. Zoom in and tap one: the card must say "Roadworks", the carriageway, the sign text (for example "2 left lanes closed · keep right") and a lane diagram, left to right, with a red cross on each closed lane and a green arrow on each open one. Drive up to the same site: the closed lanes must match the barriers on the road.
- Map inspection, closures (#27): Wait for a breakdown or accident ahead (the HUD warns of it). Open the map: it is marked with a red warning triangle once its cones are up, and tapping it shows "Breakdown" or "Accident", the carriageway and which lanes are closed. Reopen the map after the crew has cleared it: the marker must be gone.
- Map inspection (#27): A green pill under the title bar names the next exit you can still take on your carriageway and how far it is, and the exit is ringed in green on the map with its slip road. Close the map, drive past that exit and reopen: the pill and ring must have moved on to the next exit. Check the card and pill at desktop and narrow portrait sizes.
- Route comparison (#29): at Harbor Prime, accept a contract to Glacier Outpost and open the sector map before pulling away. A "Routes to Glacier Outpost" card (bottom left; along the bottom on a narrow portrait screen) must show the deadline (about 2:11) and two routes: Fastest · Polar Express, ETA about 1:54 on time, 2 cameras, no fuel or repair; and Alternative · Via Kestrel Station, ETA about 2:15 late, Harbor Run › Frost Line, 1 camera, Harbor Pumps and Frost Fuel (both Fuel & Repair). The followed route is cyan on the map and the other amber.
- Route comparison (#29): tap the Kestrel row. It must read "✓ Following" and turn cyan, and the rig must move to the Harbor Run gate. Close the map and drive: the sat-nav keeps to Harbor Run, passes through Kestrel Station and leaves along Frost Line. After delivery at Glacier Outpost the choice is gone: the next contract uses the fastest route.
- Route comparison (#29): pick the Kestrel route again, then tap it a second time: the choice is cancelled, the rig returns to the Polar Express gate (if it has not pulled away) and the sat-nav follows the fastest route.
- Route comparison (#29): open the map while driving with no contract: there is no card, and the map pans, zooms and closes as before. Tapping the card must not pan the map or inspect what is under it.
- Waypoints (#28): With a Harbor Prime to Glacier Outpost contract, open the sector map before pulling away (the route is cyan along Polar Express) and hold a finger (or the left mouse button) still on Frost Line for about half a second, or right-click it. A pink pin must appear on the road, a toast must say the waypoint is set, a **✕ Waypoint** button must appear beside **✕ Close**, the rig must move to the Harbor Run gate, and the cyan route must run along Harbor Run, through Kestrel Station and along Frost Line. Setting a waypoint cancels a route picked from the comparison card, and picking a route there removes the waypoint.
- Waypoints (#28): Hold or right-click Polar Express instead: the pin must move there ("Waypoint moved") and the route must switch to Polar Express. A quick tap must not set or move the waypoint, and dragging to pan must not set one either, at desktop and narrow portrait sizes.
- Waypoints (#28): Hold or right-click away from any road: a toast must say to hold on a road, and the pin must stay where it was. Hold the pin itself, or press **✕ Waypoint**: the pin must go ("Waypoint removed"), the route must return to normal and, if the rig has not pulled away, it must move back to the Polar Express gate.
- Waypoints (#28): Set a waypoint on a road ahead and drive to it. On reaching it a "Waypoint reached" toast must show, the pin must be gone from the map and the sat-nav must route normally to the goal. Set one with no contract: the sat-nav must guide you to it, then show free roam again once it is reached.
- Waypoints (#28): Set a waypoint on M2 south of Kestrel Station during a Harbor Prime to Glacier Outpost run: at the Kestrel pass-through the rig must leave by the M2 gate, not straight onto Frost Line. Reload the page: no waypoint must be set (waypoints are not saved).
- Map inspection and waypoints (#27, #28): A plain click or tap on a road opens its card and must never set a waypoint; a hold or right-click sets one and must not open the card. The road card has a **Set waypoint here** button: pressing it sets (or moves) the waypoint to that spot and closes the card. With a contract, the inspection card (bottom right) and the route comparison card (bottom left) must not overlap at any window width; on a narrow screen the inspection card sits at the top.

## Scope boundaries

Roadworks are placed once when the world is built and stay for the session. Sites sit wholly inside one road section, clear of joins, lane tapers, slip roads, signals and stations.

A pull request is not a deployment. Changes remain on the feature branch until reviewed and merged.
