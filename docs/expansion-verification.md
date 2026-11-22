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

Play these in order: it is one walk-through of the milestone. Numbers are at the posted limit with the starter rig and one trailer. Breakdowns, accidents and roadworks ahead of you add time, so judge the times on a clear run.

#### Before you start (#20)

- Load an existing save from `main` (money, earnings, deliveries, upgrades and seen hints): it must load unchanged, and the first save afterwards must write the same fields. Waypoints, a picked route and the sector map's pan and zoom are never saved.
- Every station must still be reachable: each of the seven stations offers contracts to the others on its job board.

#### Sector map (#26)

- While driving, press `M` or tap **MAP (M)** under the pause and mute buttons. The full-screen sector map must open over the whole network, with every road, station and facility visible below the title bar, and the HUD hidden.
- Traffic, fuel, the delivery clock and the camera must stay frozen while the map is open. Close it with `M`, `Esc`, `P` or **✕ Close**: the rig must carry on from exactly where it was, at the same speed, with the HUD back.
- `M` must do nothing on the title screen, the job board, the garage or the pause menu. Mute is now `N` (the ♪ button is unchanged).
- Desktop: the mouse wheel zooms about the pointer and dragging pans. Zoom in on a junction until lane lines appear: flyovers must be drawn over the roads they cross, and the lines must stay sharp.
- Touch, narrow portrait (about 390 × 844): pinch zooms, one-finger drag pans, and taps on the map must not reach the hidden HUD (the selected speed must not change).
- Station names, road names and facility names must stay the same size on screen at every zoom and never overlap. Near a screen edge a station name moves under or over its ring instead of being cut off. Lay-by names appear once zoomed in. Harbor Pumps and Frost Fuel are orange and marked "Fuel & Repair".
- Every road name must sit on its own road: M2 is named on its north–south spine; Dockside Avenue and Skyport Avenue are named only once zoomed in far enough to fit along the avenue; Meridian and Zenith Bypass are named on their loops when zoomed in, never on the central interchange.
- The player's arrow must sit on the rig's carriageway pointing the way it drives, with the current route in cyan to the goal.
- A green pill under the title bar names the next exit you can still take on your carriageway and how far it is, and the exit is ringed in green on the map with its slip road. Close the map, drive past that exit and reopen: the pill and ring must have moved on to the next exit.
- Close and reopen the map in the same session: it must show the same place at the same zoom. Reloading the page starts again from the whole network.
- The HUD sat-nav must look and work as before, including at the far corners of the network (Polar Express, Ember Belt).

#### Inspecting the map (#27)

- Click (desktop) or tap (touch) a road. A card (bottom right; at the top, under the next-exit pill, on a narrow portrait screen) must show the carriageway, where it goes, its posted limit (Polar Express 5, Harbor Run, Frost Line and Kestrel Link 4) and its cameras (Polar Express 2 per carriageway, Harbor Run 1, Frost Line none). The carriageway is outlined and its cameras are marked as blue squares. With a mouse, hovering shows the same card until you click.
- Click or tap Harbor Pumps or Frost Fuel: the card reads "Fuel & Repair" with the pumps and "Repair bay". An ordinary fuel stop lists only its pumps; a lay-by lists "Lay-by" and "Passengers". Tap empty map or ✕ to close the card; tapping the card itself must not inspect the road under it.
- Every roadworks site is marked with an amber diamond and the closed stretch is drawn in amber. Zoom in and tap one: the card must say "Roadworks", the carriageway, the sign text (for example "2 left lanes closed · keep right") and a lane diagram, left to right, with a red cross on each closed lane and a green arrow on each open one. Drive up to the same site: the closed lanes must match the barriers on the road.
- Wait for a breakdown or accident ahead (the HUD warns of it) and open the map: it is marked with a red warning triangle once its cones are up, and tapping it shows "Breakdown" or "Accident", the carriageway and which lanes are closed. Reopen the map after the crew has cleared it: the marker must be gone.
- A plain click or tap on a road opens its card and never sets a waypoint; a hold or right-click sets one and never opens the card. Check the card and pill at desktop and narrow portrait sizes.

#### The corridor: comparing routes (#29, #22)

- At Harbor Prime, accept a contract to Glacier Outpost and open the sector map before pulling away. A "Routes to Glacier Outpost" card (bottom left; along the bottom on a narrow portrait screen) must show the deadline (about 2:11) and two routes:
  - Fastest · Polar Express: ETA about 1:54 on time, 2 cameras, no fuel or repair.
  - Alternative · Via Kestrel Station: ETA about 2:15 late, Harbor Run › Frost Line, 1 camera, Harbor Pumps and Frost Fuel (both Fuel & Repair).

  The followed route is cyan on the map and the other amber. The ETAs count from the contract clock, so reopening the card later in the run shows the same deadline and later ETAs.
- With a contract, the inspection card (bottom right) and the route comparison card (bottom left) must not overlap at any window width; on a narrow screen the inspection card sits at the top. Tapping the comparison card must not pan the map or inspect what is under it.
- Open the map while driving with no contract: there is no comparison card, and the map pans, zooms and closes as before.

#### The corridor: Polar Express (#22)

- Close the map and drive the fastest route. The sat-nav must send you along Polar Express. Drive it at the posted limit: pass two "Speed check" signs and cameras and two lay-bys, with no fuel stop, and on a clear run deliver early (about 114 s against the 131 s deadline) on about 40% of a tank.

#### Waypoints (#28)

- With a Harbor Prime to Glacier Outpost contract, open the sector map before pulling away (the route is cyan along Polar Express) and hold a finger (or the left mouse button) still on Frost Line for about half a second, or right-click it. A pink pin must appear on the road, a toast must say the waypoint is set, a **✕ Waypoint** button must appear beside **✕ Close**, the rig must move to the Harbor Run gate, and the cyan route must run along Harbor Run, through Kestrel Station and along Frost Line.
- Hold or right-click Polar Express instead: the pin must move there ("Waypoint moved") and the route must switch to Polar Express. A quick tap must not set or move the waypoint, and dragging to pan must not set one either, at desktop and narrow portrait sizes.
- Hold or right-click away from any road: a toast must say to hold on a road, and the pin must stay where it was. Hold the pin itself, or press **✕ Waypoint**: the pin must go ("Waypoint removed"), the route must return to normal and, if the rig has not pulled away, it must move back to the Polar Express gate.
- The road card has a **Set waypoint here** button: pressing it sets (or moves) the waypoint to that spot and closes the card.
- Set a waypoint on a road ahead and drive to it. On reaching it a "Waypoint reached" toast must show, the pin must be gone from the map and the sat-nav must route normally to the goal. Set one with no contract: the sat-nav must guide you to it, then show free roam again once it is reached.
- Setting a waypoint cancels a route picked from the comparison card, and picking a route there removes the waypoint.
- Set a waypoint on M2 south of Kestrel Station during a Harbor Prime to Glacier Outpost run: at the Kestrel pass-through the rig must leave by the M2 gate, not straight onto Frost Line. Reload the page: no waypoint must be set.

#### The corridor: the Kestrel route and Fuel & Repair (#29, #22, #23)

- At Harbor Prime, take another contract to Glacier Outpost, open the map and tap the Kestrel row. It must read "✓ Following" and turn cyan, and the rig must move to the Harbor Run gate. Tap it a second time: the choice is cancelled, the rig returns to the Polar Express gate (if it has not pulled away) and the sat-nav follows the fastest route. Tap it again to follow it, and close the map.
- Drive Harbor Run eastbound. Limit signs must show 4 away from the stations (3 near them), and there must be one camera per carriageway, after a "Speed check" sign.
- The gantry 1.5 km before Harbor Pumps and the side sign at the exit must read "Fuel & Repair" with the pump-and-spanner icon. Ordinary fuel stops must not mention repair.
- Take the exit. On the entry road the sat-nav must say "Fuel stop · press D for the repair bay". Press D: a toast confirms the repair bay; press A to switch back to the pumps, then D again.
- The rig must turn off beside the pumps into the hatched bay under the yellow roof and stop at the white line. A quote must appear reading "No damage to repair", total ¢0.
- Authorise it (button or Enter): control returns, the rig pulls out and merges back onto Harbor Run eastbound beyond the facility, finding a gap in traffic by itself.
- At Kestrel Station the rig must wait for dock clearance (about 20 s), then leave along Frost Line by itself without opening the job board.
- Frost Line must have no cameras and no "Speed check" signs. At Frost Fuel (towards Glacier Outpost) use the repair bay again, this time with Decline (button or Esc), and check the quote at desktop and narrow portrait sizes. The rig must rejoin Frost Line towards Glacier Outpost.
- Driven at the posted limit without the repair stops, the Kestrel route arrives just after the deadline (about 135 s) and earns no early bonus. After delivery the choice is gone: the next contract uses the fastest route.
- Without pressing D at a Fuel & Repair facility, the rig must go to the pumps and refuel as at any fuel stop, then rejoin the same carriageway. Run low on fuel before Harbor Pumps: the sat-nav must guide you to it.
- Watch AI traffic at both facilities: it uses the pumps, never the repair bay, and merges back in without stopping on the carriageway.

#### Kestrel Link (#24)

- Open the sector map over Kestrel Station: the link road and its junction with Polar Express must be drawn and labelled.
- At Kestrel Station, a new gate on the north side leads onto Kestrel Link. The gantry at the gate and the one before the split must show Harbor Prime (Polar Express west, exit left) and Glacier Outpost (Polar Express east, keep right); limit signs show 3 near the station and 4 beyond. The outer lane ends before the split (the lane-ends warning appears), and AI traffic leaves and enters by the gate.
- Drive Polar Express both ways past the junction (x≈900, about halfway). Two green gantries (2.2 and 1.25 km) and a side sign at the exit must announce Kestrel Station / Kestrel Link: exit right on the eastbound carriageway, exit left on the westbound one. The two left turns must cross Polar Express on flyovers drawn over the roads they cross, with lane paint and traffic lined up through the merges and the lane gain on the link.
- Take each of the four turns once: the link to Polar Express east and west, and Polar Express east and west onto the link and into Kestrel Station, where the rig docks normally.
- With a Harbor Prime to Glacier Outpost contract, leave on Polar Express and switch routes at the junction: press D for the exit lane onto Kestrel Link, pass through Kestrel (about 20 s dock clearance) and carry on along Frost Line without the job board. At the posted limit it takes about 147 s against the 131 s deadline: slower than staying on Polar Express (about 114 s).
- Open the map on the link southbound during that run: the comparison card offers "Frost Line via Kestrel Station" and "Polar Express via Kestrel Station" (both pass through the station, so each is named by its main road). Tap the second: it alone must read "✓ Following".
- Repeat in reverse: Glacier Outpost along Frost Line, through Kestrel, out by the link gate and Polar Express west to Harbor Prime (about 149 s against 133 s). A pass-through leaves by the fastest gate, which is Harbor Run, so set a waypoint on Kestrel Link first: the rig must then leave Kestrel by the link gate. The route comparison from Glacier Outpost never offers this route (it shares Frost Line with one compared route and Polar Express with the other).

#### Police HQ (#25)

- On the sector map, Police HQ is a blue marker labelled "Police HQ" beside Kestrel Link. Tap it: the card reads "Police HQ", "Off Kestrel Link".
- Leave Kestrel Station by the Kestrel Link gate. A blue "Police HQ · Exit left" side sign comes up soon after the gate, then a left exit lane about 650 m out and a second sign at its end. Press A to move into the exit lane: a toast says "Pulling into Police HQ", and the slip road flies over the southbound carriageway into a short spur west of the link that ends in a turning loop round the blue HQ building.
- Drive the link southbound from the Polar Express junction. A gantry about 600 m before the turn shows Kestrel Station straight on and Police HQ exit right. The rig is already slowing to dock; press D to take the exit lane and drive into HQ. The rig must stop slowing for the dock, enter the loop at the slip-road speed and must not be pulled over.
- At the end of the loop a gantry shows Polar Express (left) and Kestrel Station (right). With a contract the rig takes the way out its route needs. Press A or D in the loop to pick the other way: Polar Express flies over both carriageways and merges onto the link northbound before the split; Kestrel Station merges onto the link southbound and the rig docks at Kestrel. Neither way uses a U-turn. Without a contract the rig leaves towards Polar Express unless D is pressed.
- The sat-nav never routes through Police HQ. On the link northbound with a Kestrel Station contract, the sat-nav must not send you round the HQ loop to turn back. The route comparison card never lists HQ, and holding on HQ on the sector map does not set a waypoint there.
- Check the driving view and the map at desktop and narrow portrait sizes; the flyovers must be drawn over the roads they cross.

#### Routing by time across the network (#21, #22, #24)

- From Kestrel Station, take a contract to Terra Nova. With Harbor Run posted at 4, the sat-nav must send you over M2 and M1 through the central interchange, not along Harbor Run with a pass-through at Harbor Prime. The PR lists every station pair whose fastest route changed.
- On a Harbor Prime job board, compare pay with the previous build. Contracts that pass through a station pay slightly less (pay counts only the physical distance of the fastest legal route). Deadlines are 1.25 times the legal time plus 45 s; only Harbor Prime–Glacier Outpost, the corridor, is held to 1.15 times a legal Polar Express run.
- In the driving HUD, the sat-nav guidance panel must fit its text, including "Change roads here — your rig carries on by itself" before a pass-through.

## Scope boundaries

Roadworks are placed once when the world is built and stay for the session. Sites sit wholly inside one road section, clear of joins, lane tapers, slip roads, signals and stations.

A pull request is not a deployment. Changes remain on the feature branch until reviewed and merged.
