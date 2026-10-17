# HD model style rules (Red Horizon)

Target: a dense, detailed winter Soviet base seen from the RTS camera (about 40° pitch, 15–30 cells away).
Every HD model must read at that distance first and reward a close-up second.

## Shape
- **Chunky, slightly exaggerated proportions.** Thick walls, heavy cornices, fat pipes, big bolts. Nothing spindly
  except antennas, rails and ladders.
- **Readable silhouettes** from the camera: stepped roof lines, stacks, gantries, tanks, dishes. Put the busy
  parts on the top and the camera-facing (+Z, south) side; the back can be simpler.
- **Same footprint and roughly the same height as the procedural model** (`node --import tsx tools/assets/rig.ts
  <id> [faction]`). Pivot at the footprint centre on the ground; structures face +Z, units face +X.
- Geometry for silhouettes and big forms; decals (free) for rivets, seams, vents, grilles, text and emblems.
- Geometric bevels on large blocks (`bevel=0.01–0.02`); everything else gets the baked shader bevel.

## Materials and colour
- **Soviet:** dark gunmetal steel (0x50–0x5a grey-blue) and weathered concrete; red banners with gold stars,
  stencilled slogans (English or Cyrillic), red warning lights, rivets, smokestacks with red bands and sooty tops.
- **Allied:** cleaner steel, glass and white paint, blue eagle banners, white star roundels, hazard stripes,
  floodlights.
- **Team colour on trims, banners, panels, skirts and plates — never whole roofs or whole walls.** Use `team()`
  (it is baked neutral and tinted in the game).
- Keep albedo in a readable range: walls 0x50–0x70, concrete 0x80–0x95, darks 0x2a–0x35. Pure black only for
  holes and bores. Detail must survive the shadow side of a building (ambient light only), so contrast comes
  from albedo (seams, panel tones, edge wear, grime), not from lighting.
- Emissive accents (red lamps, lit windows, glowing vents) are important at night: every structure gets a few.

## Weathering (automatic, tune per material)
- Edge wear on chamfers and corners (`wear=`), grime in crevices and on the lower walls (`grime=`), rust in
  cavities (`rust=`), rain / soot streaks below ledges (`streaks=`), baked AO with ground contact.
- Soot on stack and exhaust tops: `soot=(y0, y1)`.
- **Never bake snow**: the game adds settled snow (winter) and wetness (rain) at runtime.

## Budgets (checked by build.mjs)
| kind | triangles | file | atlas |
|---|---|---|---|
| structure / defence / naval | ~3k–8k | ≤ 1 MB | 1024² |
| vehicle / aircraft | ~2k–5k | ≤ 400 KB | 512² |
| whole set | | ≤ 45 MB, ≤ ~23 MB per faction | |
