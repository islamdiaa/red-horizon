"""Red Horizon HD-model kit (runs inside Blender 4.5; see tools/assets/README.md).

Content scripts (tools/assets/models/<group>/<id>.py) do:

    from kit import *

    ID, FACTION, KIND = 'powr', 'soviet', 'structure'

    def build(m):
        m.set_meta(footprint=(2, 2), height=1.55, radius=1.05)
        box(m.root, concrete(), (1.6, 0.64, 0.66), (0, 0.32, 0.3), bevel=0.02)
        ...

and `node tools/assets/build.mjs <id>` bakes and exports public/models/<id>[.<faction>].glb.
"""
from . import core, decals, materials, shapes  # noqa: F401
from .core import Model, Part, T, facing_rot  # noqa: F401
from .decals import (allied_eagle, allied_star, grille as grille_img, hazard as hazard_img,  # noqa: F401
                     panel_outline, rivets as rivets_img, solid, soviet_star, text, vent as vent_img)
from .materials import (cloth, concrete, corrugated, flat, glass, glow_material, light as light_mat,  # noqa: F401
                        metal, painted, rubber, rusty, set_weather, srgb, team, track_material, tread)
from .shapes import (ac_unit, antenna, banner, bar, barrel, box, catwalk, chimney, cyl, cyl_between,  # noqa: F401
                     dish, dome, door, downpipe, emblem, grille, junction_box, rail_rect, hazard_stripes, ladder, lathe, light, panel, pipe,
                     pipe_run, prism, quad, railing, rivet_row, road_wheels, roof_clutter, roof_vent, sign,
                     slab, sphere, stencil, track_belt, vent, window, window_row)

__all__ = [n for n in dir() if not n.startswith('_')]
