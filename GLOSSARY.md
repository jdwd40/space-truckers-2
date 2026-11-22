# Space Truckers 2

A driving game on a shared network of space highways. Truckers haul contracts between stations; later, patrol officers police the same roads.

## Network

**Road**:
A named highway with two carriageways, such as Polar Express or Frost Line.
_Avoid_: Highway, motorway (as a general term)

**Carriageway**:
One direction of travel on a road, such as M1 East.
_Avoid_: Side, lane

**Station**:
A named landmark with docking gates at the ends of its roads, where contracts are loaded and delivered.
_Avoid_: Base, port, hub

**Pass-through**:
Docking at a station that is neither the pickup nor the delivery point, then departing towards the next goal.

**Link road**:
A road that joins another road part-way along at a junction instead of ending at a station.

**Facility**:
An enterable off-road place on a carriageway that a driver uses and then leaves to rejoin the same carriageway. Fuel stops, repair bays and police HQ are facilities.
_Avoid_: Stop, building

**Fuel & Repair**:
A facility where one exit leads to both fuel pumps and a repair bay.
_Avoid_: Garage, service station

**Lay-by**:
A short stopping place beside a carriageway, off the running lanes.
_Avoid_: Shoulder, pull-in

**Repair bay**:
A facility where a driver is quoted for and authorises work on their vehicle.
_Avoid_: Garage, workshop

**Police HQ**:
The facility where patrol officers start and buy their cars.

**Camera**:
A fixed speed check on one carriageway that records vehicles crossing it above the posted limit.
_Avoid_: Speed trap

**Posted limit**:
The speed limit shown for a stretch of carriageway.

**Legal time**:
How long a route takes when driven at the posted limit throughout, including pass-throughs.
_Avoid_: Free-flow time, ideal time

**Corridor**:
A pair of stations joined by more than one genuinely different route. The first corridor is Harbor Prime to Glacier Outpost.

**Route**:
A sequence of carriageways from where a driver is to a goal.
_Avoid_: Path

## Contracts

**Depot**:
The station where a contract's cargo is loaded. For a remote pickup this is the pickup station, not the station where the contract was accepted.
_Avoid_: Origin, yard

**Deadline**:
The time by which a contract must be delivered to count as early. Delivering exactly on the deadline counts as early.
_Avoid_: Target, time limit

## Navigation

**Sector map**:
The full-screen map players plan on, drawn from the same road geometry as the sat-nav.
_Avoid_: World map, overview

**Sat-nav**:
The local map in the driving HUD.
_Avoid_: Minimap

**Waypoint**:
A point a player sets on the sector map that their route must pass through before continuing to its goal.
