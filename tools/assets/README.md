# HD models: the Blender asset factory (`tools/assets`)

Baked, hand-modelled-looking models for buildings and vehicles, built by **scripts** in Blender 4.5 LTS (headless,
CPU Cycles) and loaded by the game as GLB (`public/models/*.glb`). The procedural models in `src/render/models`
stay: they are the Standard option, the fallback while a GLB loads or fails, and the far LOD of every HD model.

```
tools/assets/
  setup-blender.sh        install the pinned Blender 4.5.14 into ~/.cache/red-horizon/blender (sha256-checked)
  fetch-textures.mjs      download the pinned CC0 Poly Haven inputs (textures.json, md5-checked)
  build.mjs               build one / some / all models -> public/models/<id>[.<faction>].glb + manifest.json
  rig.ts                  dump a procedural model's rig (node names, pivots, points, height, triangles)
  view.mjs                in-game screenshot of a benchmark scene / focused type, HD on or off, + stats
  hdcheck.mjs             in-game damage stages / construction hologram / collapse of a structure type
  hdlazy.mjs              in-game lazy loading: a structure built and a unit produced while their HD model loads
  modview.mjs             in-game structures in a row, before / after their upgrade modules build in (+ draw calls)
  footprint.ts            top-view height map of a structure (procedural and HD): roofs and yards for module anchors
  restart-view-server.sh  (re)start your no-HMR vite server (needed after adding a NEW .glb)
  memguard.sh <MB>        wait until that much memory is available (run before a headless browser)
  STYLE.md                art direction and budgets
  kit/                    the Python API (runs inside Blender): core, shapes, materials, decals, patterns, bake, export;
                          rig, anim, skin, vat (rigged infantry)
  models/<group>/<id>.py  one script per model (groups: allies, soviet, vehicles, infantry, aircraft, naval; test = kit checks)
  infantry.mjs            HD infantry: clip contact sheets, in-game battles, benchmarks (see Rigged infantry)
  terrain/                scanned ground materials (build.mjs, bake.py, textures.json) and shots.mjs (terrain screenshots)
```

## Setup (once per machine)

```sh
tools/assets/setup-blender.sh            # ~360 MB download, verified against download.blender.org's sha256
node tools/assets/fetch-textures.mjs     # ~18 MB of 1k CC0 textures into ~/.cache/red-horizon/textures
```
Both are idempotent. `setup-blender.sh --check` just runs `blender -b` and prints the version. The tarball needs
`xz`; Blender's own libraries are bundled, nothing else needs to be installed.

## Building

```sh
node tools/assets/build.mjs --list               # model scripts and their output keys
node tools/assets/build.mjs powr.soviet 3tnk     # by key (id.faction) or id (all factions of that id)
node tools/assets/build.mjs powr --quick         # half atlas, few samples: fast iteration, NEVER commit
node tools/assets/build.mjs powr --preview       # + Cycles stills: /tmp/rh-assets/<key>-rts.png, -close.png
node tools/assets/build.mjs --all                # everything except models/test/
```
- One Blender at a time, 4 threads by default (`--threads N`, max 6). A structure takes
  ~1–1.5 min, a vehicle ~15–45 s.
- **Memory guard:** before each Blender run build.mjs waits until `/proc/meminfo` MemAvailable is ≥ 3 GB
  (`--min-mem MB`, `RH_MIN_MEM_MB`), polling every 30 s, so a shared machine is never pushed into swap.
  Run `tools/assets/memguard.sh 4096` before starting a headless browser (view.mjs, hdcheck.mjs).
- Logs: `/tmp/rh-assets/<key>.log`. Debug maps: run the kit directly with `--debug DIR` (see `kit/run.py`).
- The runner prints triangles, KB and budget checks per model and the set / per-faction totals, and merges each
  built model into `public/models/manifest.json` (id -> file, bytes, hash, type, faction, kind, tris, parts,
  points...) right after its Blender run: re-read under a lock file (`manifest.lock`, stale after 60 s) and
  written atomically, so parallel builds never drop each other's entries.
- `node tools/assets/build.mjs --reindex` rebuilds the manifest from the GLBs on disk (their glTF extras).
- Commit the `.glb` files and `manifest.json` (the game builds without Blender). Never commit `--quick` output.

## How to make a model (walkthrough)

1. **Look at the procedural model and its rig.**
   ```sh
   node --import tsx tools/assets/rig.ts 3tnk                 # units
   node --import tsx tools/assets/rig.ts powr soviet          # structures (dressing per faction)
   node tools/assets/view.mjs --port <port> --scene A --hd 0 --focus powr --dist 8 --out /tmp/before.png
   ```
   `rig.ts` prints the node tree (names, local and model-space positions), muzzles, smoke / steam points,
   height, radius, body bounds and the procedural triangle counts. **Animated parts and points must use these
   node names** (`turret`, `b0`/`b1` barrels, `m0`/`m1` muzzles, `door`, `dish`, `rotor`, `exhaust`,
   `smoke0`, `steam0`, ...): the game's animation drives the procedural nodes and the HD parts ride on them.
   Keep pivots within a few hundredths of the procedural ones (the far LOD is the procedural body).

2. **Create `tools/assets/models/<group>/<id>.py`:**
   ```python
   import math
   from kit import *

   ID, FACTION, KIND = 'powr', 'soviet', 'structure'   # FACTION None for faction-neutral; KIND sets the atlas

   def build(m):
       m.set_meta(footprint=(2, 2), height=1.55, radius=1.05)    # height / radius: selection ring, health bar
       r = m.root                                                # the static body
       steel = painted(0x5d646b, panels=(0.2, 0.16), wear=0.6, rust=0.25)
       box(r, concrete(), (1.98, 0.05, 1.98), (0, 0.025, 0), bevel=0.018)       # foundation
       box(r, steel, (1.6, 0.6, 0.66), (-0.08, 0.35, 0.3), bevel=0.01)          # a hall
       sign(m, r, (-0.1, 0.48, 0.65), (0.7, 0.24), 'POWER|OUR STRENGTH', emblem='soviet', lights=3)
       chimney(m, r, (-0.6, 1.07, -0.6), 0.88, 0.165, smoke='smoke0')          # adds the smoke point
       m.steam('steam0', (-0.03, 0.795, 0.1))
   ```
   Units: `t = m.part('turret', at=(-0.05, 0.236, 0))`, `b = m.part('b0', parent='turret', at=(0.24, 0.05, -0.05))`,
   `m.muzzle('m0', (0.66, 0.05, -0.05))` (turret frame), `track_belt(r, L, H, W, (0, 0, z))` for each track.
   See `models/soviet/powr.py` and `models/vehicles/3tnk.py` (the two hero models) for complete examples.

3. **Iterate fast:** `node tools/assets/build.mjs <key> --quick --preview` and look at the two stills.
   Then a full build and an in-game check (restart your view server after the first build of a new model):
   ```sh
   node tools/assets/build.mjs <key>
   tools/assets/restart-view-server.sh <port>
   node tools/assets/view.mjs --port <port> --scene A --focus <id> --dist 8 --out /tmp/after-close.png
   node tools/assets/view.mjs --port <port> --scene A --focus <id> --dist 20 --out /tmp/after-default.png
   node tools/assets/view.mjs --port <port> --scene E --focus <id> --dist 10 --out /tmp/after-night.png
   ```
   The view tool prints draw calls, triangles, the HD status (loaded / failed keys) and console warnings.
   Compare with `--hd 0` (and `--extra q=medium` for the Medium tier). `--nth -1` focuses the last entity of the type (scene B: the army, not the factory).
   Structures: `node tools/assets/hdcheck.mjs <port> /tmp/rh-assets 1 <id>` shoots the damaged / wrecked stages,
   the construction hologram and the collapse, and lists console warnings.

4. **Check the budget line** printed by build.mjs (triangles, KB) and the STYLE.md rules, then commit the `.glb`
   and the `manifest.json` change.

## Conventions

- **Game coordinates everywhere** (the same as `src/render/models`): +X east, +Y up, +Z south (towards the
  camera); 1 unit = 1 map cell. Structures: footprint centred on the origin, ground at y = 0, front facing +Z.
  Units face +X. Rotations are three.js XYZ Euler angles in radians, so numbers from the TS builders paste over.
- `facing` arguments: `'+z'` (front, default), `'-z'`, `'+x'`, `'-x'`, `'+y'` (up), `'-y'`, or a yaw in radians.
- Points: `m.point(name, at, part, kind)`; shorthands `m.muzzle`, `m.smoke`, `m.steam`, `m.sparks`. A point named
  like a procedural node moves that node; new names add extra smoke / steam / spark / muzzle points.
- `m.set_meta(height=, radius=, keep=[...], snow=)`: `keep` lists procedural extras to keep (e.g.
  `['glow:charge']` for charge glows driven by the procedural animation, `'fx:<key>'` effect meshes, `'track'`);
  everything else procedural is replaced. `snow` scales settled snow (default 1 for structures, 0.3 for units).

## Kit API

### Structure (`kit.core`)
| call | |
|---|---|
| `m.root`, `m.part(name, parent='root', at, rot, cull=True, ground=None)` | parts = rigid nodes; geometry is added in the part's frame (`cull`, `ground`: see the bake) |
| `m.point / muzzle / smoke / steam / sparks` | named empties (see Conventions) |
| `m.decal(img, at, size, facing, part, depth, roll, team, rough, metal, emit, height, tint, boost, normal, up, rot)` | projected decal |
| `m.look(edge_light=, edge_radius=, chamfer_edge=, ao_distance=, dirt_h=, ao=)` | per-model look knobs (`m.tune` is the same call) |
| `m.set_meta(...)` | glTF extras + manifest |
| `T(at, rot, scale)`, `facing_rot(facing)`, `normal_rot(normal, up)` | matrices / Eulers for your own math |

**Orientation.** Every `facing=` argument (decals and all the helpers below) takes `'+z'` (front, default), `'-z'`,
`'+x'`, `'-x'`, `'+y'` (up: roofs), `'-y'`, a yaw angle in radians, or any `(rx, ry, rz)` Euler, e.g.
`normal_rot((0, 0.6, 0.8))` for a sloped roof or a raked armour plate (`normal_rot(n, up)` turns +Z to `n` with the
feature's top towards `up`, default +Y; for normals near +-Y the top points north / south like `'+y'` / `'-y'`).
`m.decal` also takes `normal=(x, y, z)` (+ optional `up=`) or `rot=(rx, ry, rz)` directly; `roll` still turns the
image in its plane. A non-procedural part name (e.g. `m.part('pit', ground=False)`) is a static node that stays
with its parent in the game: use it to group static geometry that needs its own `cull` / `ground` setting.

**Look knobs** (`m.look`, call it anywhere in `build`): `edge_light` (edge catch-light, 0.07), `edge_radius`
(bevel-shader edge mask radius, 0.014), `chamfer_edge` (edge mask on geometric chamfers, 0.45), `ao_distance`
(AO reach in units, 0.32; ~0.42 for deeper crevices on 2x2 / 3x3 structures), `dirt_h` (ground dirt height,
0.2 structures / 0.07 units), `ao` (how much baked AO darkens the albedo for every material that does not set its
own with `set_weather(mat, ao=)`, 0.55; glass and lamps keep theirs). Keep edge light and wear modest: they read
as pale halos at RTS zoom.

### Shapes (`kit.shapes`; `p` = a part, `m` = the model for decal-using helpers)
- Primitives: `box(p, mat, (w,h,d), at, rot, bevel)`, `slab(p, mat, x0,x1, y0,y1, z0,z1)`,
  `cyl(p, mat, r, h, at, rot, r2, seg, caps, bevel)` (axis Y), `cyl_between(p, mat, a, b, r)`, `bar(p, mat, a, b, w)`,
  `sphere`, `dome`, `lathe(p, mat, [(r, y)...], at, seg, rot, scale, cap_top, cap_bottom, inward=False, double=False)`,
  `prism(p, mat, [(x, y)...], depth, at)` (profile in XY extruded along Z), `quad`, and:
  - `lathe_in(p, mat, [(r, y)...], at, seg, rot, cap_bottom=False, cap_top=False)`: faces look at the axis (the inside
    of a cooling tower, tank or silo seen over its rim; `cap_bottom` = an upward floor). `lathe(..., double=True)`
    keeps both sides of a thin open shell (the inner side gets its own atlas space).
  - `torus(p, mat, R, t, at, seg=16, tseg=8, rot=None, smooth=True)`: ring around local Y (tyres, collars, coils,
    hatch rims); `smooth` shades the tube round even with 6-8 sides. Pass `rot=` by keyword.
  - `sector(p, mat, r0, r1, x0, x1, a0, a1, seg=3, at, rot, caps=False)`: part of a cylinder / cone surface along
    local X (radius r0 at x0 to r1 at x1) between angles a0..a1 around X (0 = +Y, increasing towards +Z): quartered
    rocket paint, split drums, fairings; `caps=True` closes it into a solid pie wedge. `rot=(0, 0, pi/2)` stands it on Y.
  - `loft(p, mat, [(y, [(x, z), ...]), ...], at, rot, bevel)`: closed solid through horizontal top-view rings, bottom
    to top, same point count and order in every ring; a smaller top ring gives sloped, light-catching sides
    (turrets, hulls, hip roofs, plinths).
- Hard-surface detail: `panel` (raised plate), `rivet_row(m, p, a, b, facing)` (decal), `vent(m, p, at, (w,h), facing)`,
  `grille(...)`, `junction_box(p, at, size, facing, conduit)`, `light(p, at, r, color, mode)` (lamp + emissive lens).
- Industrial: `pipe(p, mat, a, b, r)`, `pipe_run(p, mat, [pts], r)`, `downpipe(p, mat, at, y0, y1, facing)`,
  `ladder(p, mat, at, h, facing, cage)`, `railing(p, mat, a, b, h)`, `rail_rect(...)`, `catwalk(m, p, at, length, width, axis)`.
- Buildings: `window(p, at, (w,h), facing, lit)`, `window_row(p, at, n, size, gap, dark=(i...))`,
  `glazing(m, p, at, (w,h), nx, ny=1, facing, dark=0.45 | dark_panes={i...}, seed, lit, strength, t, frame, pane)`
  (a glazed band / curtain wall: ONE lit glass quad + a mullion decal projected with `emit=0.0`, so the bars and
  the dark panes don't glow; any number of panes for two triangles; `at` = the glass centre, its face 0.003 out),
  `door(m, p, at, (w,h), facing, kind='roller'|'double'|'hatch', hazard_frame)`, `ac_unit`, `roof_vent`, `roof_clutter`,
  `chimney(m, p, at, h, r, r_top, mat, bands, band_mat, lights, smoke, ladder_side)`, `antenna`, `dish`.
- Faction dressing: `banner(m, p, at, (w,h), facing, emblem='soviet'|'allied'|'allied_star', color='team'|hex)`,
  `sign(m, p, at, (w,h), 'LINE 1|LINE 2', emblem=, lights=)`, `stencil(m, p, text, at, height, facing)`,
  `hazard_stripes(m, p, at, (w,h), facing)`, `emblem(m, p, kind, at, size, facing)`.
- Vehicles: `track_belt(p, L, H, W, at)` (scrolling tread, the game's track material), `road_wheels(...)`,
  `barrel(p, mat, length, r, at)` (along +X with a muzzle brake).

### Materials (`kit.materials`, colours are sRGB hex like the procedural palette)
`painted(color, team, wear, grime, rust, streaks, rough, metal, panels=(w,h), rivets, soot=(y0,y1))`,
`team(...)` (team-colour paint), `concrete(color, joints=(w,h), soot=)`, `metal(color)` (bare / gun steel),
`rusty(color, amount)`, `corrugated(color, along, pitch)`, `tread()`, `rubber()`, `cloth(color | team=True)`,
`glass(color, lit=0xRRGGBB)`, `light_mat(color, strength, mode)` (`'steady'|'blink'|'pulse'|'flicker'|'strobe'`,
animated in the game), `flat(color)`, `track_material()`,
`glow_material('glow:<slot>', color, double_sided=False)` (separately animated emissive meshes; one slot can hold
several colours, e.g. a shipyard's red and green harbour lights: one call per colour, exported into the slot's one
mesh as vertex colours; `double_sided=True` also lights the back faces of thin fins, flags and rings).
Equal arguments return the same material. Weathering is automatic (see below); the amounts are per material,
and `set_weather(mat, wear=, grime=, rust=, streaks=, ao=, soot=, bevel=)` adjusts one afterwards.
Per-model knobs: `m.look(...)` (above; use it instead of overriding kit module globals).

### Decal images (`kit.decals`)
`soviet_star()`, `allied_eagle()`, `allied_star()`, `text(lines, color, field, stencil)` (Rajdhani Bold),
`hazard()`, `rivets(n)`, `vent()`, `grille()`, `panel_outline()`, `solid(color)`,
`mullions(nx, ny, aspect, px, frame, t, dark, seed, pane, dark_panes)` (window-frame grid with dark panes; project
with `emit=0.0` over lit glass, as `glazing` does), `team_paint(k)`. Project with `m.decal(...)`.

**Team shades** (the grey-decal trick): a decal with `team=1` repaints its area as team paint, and the game
multiplies the baked albedo by `teamColour / TEAM_GREY` (TEAM_GREY = linear 0.7 = sRGB `0xdbdbdb`). So the grey
you project sets the shade: `m.decal(team_paint(0.6), ..., team=1)` paints a dark team shade (recess bands,
stripes, shadowed trims), `team_paint(1.0)` (= `solid(0xdbdbdb)`) the clean team colour, `team_paint(1.3)` a light
one. Any grey `solid(...)` works the same; a coloured image with `team=1` tints the team colour.
`team=0` does the opposite: it masks the team colour off under a decal (white text on a team-coloured banner).
Decals cost no triangles; text and emblems get extra atlas density automatically (`boost`). Text with
non-Latin characters (Cyrillic slogans) uses Russo One automatically; `font='rajdhani'|'russo'|<path>` on
`text` / `stencil` / `sign` overrides. A decal is wired into every material whose faces overlap its box; one
that touches nothing prints `[kit] WARNING: decal ... touches no faces` (check position, facing, depth).

## What the bake does (`kit.bake`)

1. Faces nobody can see are deleted (ground contacts, faces flush against or buried in other geometry), per
   part and only against that part's own geometry (parts move: a silo missile that starts buried is kept);
   `m.part(..., cull=False)` keeps every face of a part and its children.
2. One atlas (`atlas`) for every part: round primitives bring their own cylindrical / planar UVs, the rest is
   smart-projected; islands are equalised in texel density, decal-covered islands get 1.8x, downward-facing
   ones 0.4x, then AABB-packed with a 2 px gutter (the run logs the atlas coverage; 55-75% is normal). Round
   surfaces are cut into quarter-turn strips so they pack tightly. Every bake fills the gutters itself (the
   islands grow into them like Blender's EXTEND margin, but for all parts at once: Blender's own margin is per
   object and would paint a moving part's colours over the border of a neighbouring root island).
3. Phase 1 masks: **AO** with a ground plane (contact shadows) and **edge** curvature (bevel shader + the chamfers
   `box(bevel=)` makes). `m.ground = False` drops the plane for the whole model; `m.part(..., ground=False)` bakes
   just that part (and its children, unless they say `ground=True`) without it: a silo missile resting below
   y = 0 would otherwise be blacked out, while the silo keeps its contact shadows (the other parts still occlude
   it). Note the plane also covers holes in a ground slab: below-ground lining that should get light through an
   opening goes in a `ground=False` part too.
4. Smart materials read the masks and add: edge wear (bare steel / scuffed concrete), cavity grime, ground dirt,
   rust (Poly Haven rust spots), rain / soot streaks, soot bands, baked AO; decals are applied before weathering.
5. Phase 2: base colour, (roughness, metalness, team), (emit, emit mode), tangent-space normal (bevel shader +
   panel seams, rivets, decal relief).
6. Export (`kit.export`): GLB with **KHR_mesh_quantization** (int16 positions, int8 normals / tangents, uint16
   UVs) and **EXT_texture_webp**: base (sRGB), ORM (AO, roughness, metalness), normal, mask (R team, G emit / 4,
   B emit mode / 4; half resolution) — no decoders, nothing that needs `wasm-unsafe-eval`.

## Runtime (src/render/models/hd.ts)

- Settings › Graphics › **Model detail: HD / Standard** (default HD on High and Medium, Standard on Low; `?hd=0|1`
  overrides for tests). Anything missing or failed stays procedural silently.
- **Memory tiers** (decoded once at load, `createImageBitmap` resize, mipmapped): **High** = base colour and normal
  at the atlas size, ORM and mask at half; **Medium** (and Low with HD forced) = everything at half. Per template:
  structure 13.3 MB High / 5.3 MB Medium, vehicle 3.3 / 1.3 MB (RGBA8 + mips). The kit already writes ORM at
  half resolution.
- **Lazy per-type loading:** the loading screen loads the factions' 6 most common units and every type the battle
  starts with; everything else loads the first time it is placed, seen or produced and renders procedural
  meanwhile. The switch to HD only happens when nobody can see it: before the view was ever on screen, while it is
  hidden / off-screen, during a structure's construction (hologram + build-up), or while a unit is still inside
  the structure it rolls out of. A finished, on-screen structure stays procedural (its next instance is HD).
- **Disposal:** templates unused for 5 minutes are dropped (Medium: always; High: only above 192 MB of HD
  textures); the GLB bytes stay cached, so a later request re-decodes in ~100 ms.
- The service worker caches `/models/` (cache-first); during a battle the factions' remaining GLBs are downloaded
  quietly so offline play keeps HD for lazily loaded types too.
- Test hooks: `?hdlazy=1` (skip the loading-screen preload), `?q=medium` (tier), `hdStatus()` / `hdDebugDrop()`
  in hd.ts; `node tools/assets/hdlazy.mjs <port>` shoots a structure and a unit swapping lazily.
- An HD model is grafted onto the procedural instance: its skeleton reuses the procedural nodes, so every animation
  channel, muzzle, smoke / steam point, turret pop-off, ragdoll and the collapse (procedural fracture chunks
  under the explosion) work unchanged. The far LOD is the procedural distant body (`HD_LOD_K` x the procedural
  LOD distance). Thumbnails and the construction hologram use the HD body automatically.
- One shader program for all HD bodies (`rh-hd-v1`): team colour from the mask, the procedural damage variants
  (scorch, cracks, burnt-through holes with embers, electro flash), powered / unpowered and animated emissives,
  settled snow, and the weather (wet / snow) + rim-light patches. Textures and geometry are shared per template;
  at most 2 materials per model (body + glass) plus the shared track / glow materials.

## Rigged infantry (`kit.rig`, `kit.anim`, `kit.skin`, `kit.vat`)

Soldiers and dogs are skinned models on two shared rigs, animated by baked clips and drawn as an instanced crowd
(`src/render/models/infantry-hd.ts`). Everything lives in `models/infantry/` and builds into `public/models/infantry/`
with its own `manifest.json` (build.mjs routes the group there):

```sh
node tools/assets/build.mjs anim.human anim.dog        # the clip sets (vertex animation textures), ~1 s each
node tools/assets/build.mjs anim.human --preview       # + a stick-figure contact sheet: /tmp/rh-assets/anim.human-N.png
node tools/assets/build.mjs e1                         # both riflemen (e1.soviet, e1.allies), ~1-2.5 min each
node tools/assets/infantry.mjs sheet --port <port> --out /tmp/e1.png --q 'type=e1&fac=soviet&clips=rifle.,death.'
node tools/assets/infantry.mjs battle --port <port> --n 100 --out /tmp/battle.png     # an in-game infantry battle
node tools/assets/infantry.mjs bench --port <port> --n 300                             # calls / tris / frame time per preset
```

- **Rigs** (`kit.rig`): `HUMAN` (hips, spine, chest, neck, head, upper arm / forearm / hand, thigh / shin / foot per
  side, plus `weapon` and `prop` bones for what the right and left hands hold) and `DOG` (pelvis, spine, chest, neck,
  head, jaw, two tail bones, three bones per leg). Game frame, rest orientation = identity for every bone, so a pose is
  just a world matrix per bone and the skinning matrix is `W @ inverse(T(rest))`. Helpers: `rx / ry / rz / lean`,
  `ik2` (two-bone IK), `frame_rot`, `hand_rot`.
- **Clips** (`kit.anim`): procedural key-pose animation, no motion capture. `HumanBody` builds a pose: the trunk by
  forward kinematics (`torso(hips_pos, hips_rot, spine, chest, neck, head)`, `look`), legs and arms by IK
  (`leg(side, ankle, foot_rot)`, `arm_ik(side, wrist, hand, pole)`, `arm_fk`), props (`weapon(m4)`, `prop(m4)`; scale 0
  hides one: a thrown grenade). `Keys` interpolates key values (numbers, tuples, vectors, rotations) with easing,
  `Gait` / `WALK` / `RUN` / `legs_for_gait` give planted-foot locomotion with hip bob, sway, yaw and roll, `kick` /
  `spring` give recoil envelopes, `noise1(t, seed, period)` breathing and sway that loop. `Clip(name, duration, fn,
  loop, fps, **meta)`; meta like `stride` (model units per cycle: the game locks the playback rate to the ground speed),
  `shot`, `release`. The clip content is in `models/infantry/_clips.py` (humans: one set per weapon kind) and `_dog.py`.
- **VAT** (`kit.vat`): `bake(skeleton, clips)` samples every clip at its fps into an RGBA16F texture, texel
  (3 * bone + row, frame) = a row of the bone's skinning matrix, clips stacked; a loop repeats its first frame at its
  end so the shader's linear filter interpolates every frame pair. The run checks bone lengths (rigid within 3 mm),
  loop closure and IK reach (`over_3mm` lists clips whose hands miss their grips). `write_anim` stores the skeleton as
  glTF nodes plus the texture as an embedded half-float buffer (`extras.rh_anim`: bones, parents, rest, clips, vat).
  `key_actions` keys every clip on a Blender armature (`--keep-blend out.blend` saves it for inspection).
- **Skinned geometry** (`kit.skin`): `Skin(m, HUMAN)` adds a `skin` part whose bmesh carries bone weights (vertex
  groups = bone indices). `tube(mats, [ring(at, a, b, weights)...])` makes smooth limbs and torsos (weights blend
  across the joints), `rigid(shape, bone)` puts any kit shape on one bone, `blend(shape, fn)` custom weights. The bake
  runs as for every model (bind pose = an A-pose with the props floating in front, so their AO stays clean).
  `write_skinned` exports a glTF skinned mesh (JOINTS_0 / WEIGHTS_0, two bones per vertex, inverse bind matrices with
  the dequantisation folded in), a decimated `body_lod1` (30 %: the crowd's far LOD) and points (muzzles) under their bones.
- **Soldiers** (`models/infantry/_soldier.py`): `Soldier(m, faction)`, `body(...)` (torso, trousers, boots, sleeves,
  gloves, head; `coat=True` for the greatcoat), `helmet('m1' | 'ssh40' | 'ushanka' | 'hardhat' | 'medic' | 'gasmask' |
  'fedora' | 'beanie' | 'cap' | 'tanya')`, kit (`belt`, `pouches`, `straps`, `pack`, `skatka`, `grenades`, ...), weapons
  in the weapon bone's frame (`rifle('ak' | 'm16' | 'tesla')`, `launcher('rpg' | 'dragon')`, `flamer()`, `pistols()`,
  `held(...)`), `finish(set=...)`. Team colour: the outer torso garment and the helmet (team mask) plus team decals.
  Weapon grips (where the clips put the hands) are shared in `_gear.py`.
- Budgets: infantry 2500 triangles (body; the far LOD ~30 %) and 250 KB per GLB; a clip set < 800 KB.

## Terrain materials and nature (`tools/assets/terrain`, `models/nature`)

**Ground.** `node tools/assets/terrain/build.mjs` fetches the pinned 1k scans (`terrain/textures.json`, md5-checked,
into the shared texture cache) and bakes each material in headless Blender (numpy) into
`public/textures/terrain/<name>.albedo.webp` (RGB, crevice AO folded in, large-scale lighting flattened so the tiling
does not show) and `<name>.nrm.webp` (normal X/Y, height, 128 + 127 x roughness in alpha), 512 px, plus
`manifest.json` (about 5 MB in all). `build.mjs grass rock` rebakes some; `--pin <id>` pins new Poly Haven ids.
The climate layer sets (ten slots: ground, variation, dirt, rock, sand, gravel, road, mud, snow, concrete) and their
tiling and colour grading are in `src/render/terrain-materials.ts`; the shader is in `src/render/terrain.ts`.

**Trees and rocks.** `models/nature/*.py` (helpers in `_nature.py`, `_rocks.py`; KIND `nature`) build into
`public/models/nature/` with their own manifest (budget: 1200 triangles, 200 KB). Origin at the trunk base / rock
centre on the ground, the procedural model's size (it stays the far LOD). Rocks are baked neutral grey: the game
tints them per climate. `src/render/vegetation.ts` instances them for the near blocks (wind sway, weather, felled
trees as before). `node tools/assets/terrain/shots.mjs --port <port> --out DIR --tag after` shoots the benchmark
scenes and close-ups (roads, cliffs, trees, snow, aprons); `?terrain=classic` / `?nature=classic` show the
procedural look for A/B.

## Gotchas
- **Restart the view server after building a new model** (no file watching: new public files 404 until restart).
- Thin parts (< 0.01) and tiny parts waste texels: prefer decals.
- Text needs space: a slogan board should be ≥ 0.5 units wide on a structure; vehicles: stencils ≥ 0.03 high.
- Glass as a separate glossy material: put `glass()` faces in, export splits them only if the model sets
  `m.separate_glass = True` (costs a draw call); by default glass is just a glossy region of the atlas.
- Rebuilds are not bit-identical (hidden-face culling and bake sampling vary slightly): only rebuild the models
  you changed, so the other GLBs keep their hashes and the players' caches.
- Keep model scripts self-contained; extend the kit (`kit/`) only for features several models need.

## Credits
- Texture inputs: [Poly Haven](https://polyhaven.com) (CC0): rusty_painted_metal, rusty_metal_02, metal_plate,
  corrugated_iron_02, concrete_wall_008, rough_concrete, painted_metal_shutter, rusty_metal_grid, green_metal_rust,
  container_side, cliff_side, rock_face. Used only as inputs; the shipped atlases are our own bakes.
- Terrain materials: Poly Haven (CC0) scans, re-baked into our own tiling sets: leafy_grass, forrest_ground_01,
  forest_ground_04, rock_face_03, coast_sand_01, ganges_river_pebbles, asphalt_04, asphalt_snow, brown_mud_02,
  snow_01, snow_02, cracked_concrete, rocks_ground_05, coast_sand_05, brown_mud_rocks_01, sand_01, mud_cracked_dry_03,
  dry_ground_rocks, cliff_side, rocky_trail_02, gravel_road, dense_sand.
- Decal fonts: Rajdhani Bold (SIL OFL, already shipped in public/fonts) for Latin text; **Russo One** (Jovanny
  Lemonad, SIL Open Font License 1.1, google/fonts `ofl/russoone/` at a pinned commit, sha256-checked by
  fetch-textures.mjs into ~/.cache/red-horizon/fonts/, with its OFL.txt) for Cyrillic. Both are build-time
  inputs only, rasterised into the atlases; neither is shipped from public/ for decals.
- Blender 4.5 LTS (GPL), used as a tool only.
