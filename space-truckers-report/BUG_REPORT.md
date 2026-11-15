# Space Trucker (space-truckers-2) - graphical glitch report

Tested locally (Vite dev server, Phaser 3.90; Three.js is listed in package.json but never imported).

## Bug 1 (main): the cab and trailer flicker between two positions ("ghosting")

**Symptom:** While the rig is moving (worst at high cruise, on bends/U-bend, during lane changes and braking), the cab and trailers jump between two positions from one frame to the next. On some frames the cab is missing and only the trailer is drawn. On others the cab sits ahead of the trailer with a gap. The eye blends the two positions into a double image. It looks fine when the rig is stopped.

**Root cause:** `Trail.back(d)` in `src/traffic.ts:70-92` (called from `placeVis`, `src/world.ts:985-996`) works out positions behind the truck in two different ways:
- **Method A:** if `pushTrail()` just added a point this frame, the newest trail point equals the current position, so `d0 < 0.001` and it returns a straight line back along the heading: `x - cos(h)*d`.
- **Method B:** otherwise, it walks the trail, assuming the points are exactly `TSTEP` (3) units apart.

The two methods give different answers, and they take turns every frame or two:
- At 60 Hz this happens below about 180 u/s (cruise 1-2, and whenever the truck speeds up or slows down).
- On 120/144 Hz monitors it happens at every speed. `fps: { target: 60 }` in `main.ts:15` does not cap the frame rate.

Method B is also wrong by itself:
- Points are only pushed after the truck moves at least 3 units, so the real spacing is 3+ units (for example 4.5), not exactly 3.
- The cab and trailers are therefore drawn too far back, about 8-12 units for the cab and 40-60 for the trailer on curves in simulation.

**Made worse by:**
- The lane-change tilt `v.h = p.h + atan2(latVel, ...)` at `traffic.ts:433`. Only method A uses it, so the heading also differs by 15-35 degrees between the two methods.
- `world.ts:988`, another switch between methods just after a spawn.
- At under 40 fps the traffic update runs twice per frame (`world.ts:720-721`).

**Fix:** have `back()` use one method that walks real distances along the trail:
```ts
back(d){ let px=this.x, py=this.y, rem=d, i=this.tHead;
  for (let n=0; n<TR; n++){ const qx=this.trail[i*2], qy=this.trail[i*2+1], L=Math.hypot(qx-px,qy-py);
    if (L>1e-6 && rem<=L){ const f=rem/L; return {x:px+(qx-px)*f, y:py+(qy-py)*f}; }
    rem-=L; px=qx; py=qy; i=(i-1+TR)%TR; }
  return {x:px-Math.cos(this.h)*rem, y:py-Math.sin(this.h)*rem}; }
```
Alternative: have `pushTrail` store points at exactly 3-unit intervals (`while (d >= TSTEP)` add `head + dir*TSTEP`) and remove the `d0 < 0.001` shortcut. Commit 9167f5f only fixed the order the trail is filled after a reset and does not address this.

Screenshots: `clip_trailer_no_cab_02.png`, `clip_cab_trailer_split_03.png`, `clip_cab_trailer_ok_04.png`, `uturn_cab_detached_01.png`, `brake_gap_06.png` vs `brake_ok_05.png`.

## Bug 2: depth pops at flyovers (medium)
In `world.ts:976-983` and `1000-1001`:
- Going down off a flyover, the rig keeps the upper deck's draw depth for 0.9 s (`lvlHold`), so it is drawn over decks it has already passed under, then snaps below them.
- Going up, it switches at once while the trailers are still on the lower deck.
- The shadow offset `shOff = 5 + lvl*7` jumps between 12 and 5.

Fix: give each unit its own depth from the deck it is actually on, and ease `shOff` with the ramp height.

## Bug 3: the drop shadow copy can read as a ghost (medium-low)
In `world.ts:320` and `1001`:
- Each cab and trailer has a black copy at 0.3 alpha, offset in world space.
- The camera rotates with the road (`world.ts:934`), so on bends the dark copy swings around the truck on screen. It also inherits Bug 1.

Fix: compute the offset in screen space by rotating it by the camera angle.

## Bug 4: background flyer ships are drawn over traffic (low-medium)
In `world.ts:237-239` and `954-969`:
- Flyers are drawn at depth 16.4-16.5, above every vehicle (max 15).
- They only check for nearby roads every 0.25 s and fade slowly, so a half-transparent ship can pass over the player.

Fix: draw them below the vehicles, or check every frame and fade faster.

## Bug 5: HUD overlap
- The "xxx km/h - cruise N" readout is partly covered by the cruise buttons and lower HUD.
- At the start, the truck is hidden behind the HUD and planet, and the title overlay covers the road (`hud_start_07.png`).

## Minor
- The speed readout jumps a lot between frames (1156, then 301, then 48 km/h while braking). This may be partly due to screenshot timing.
- The "Turn back" sign on the U-bend renders upside down (`uturn_lowfuel_09.png`). This may be intentional for the return lane.
- Clicking "Start your shift" with the mouse did nothing; Enter or Space works.
- favicon.ico returns 404.
