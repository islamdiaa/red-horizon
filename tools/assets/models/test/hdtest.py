"""Pipeline smoke test: a small bunker exercising boxes, cylinders, decals, lamps and team paint."""
from kit import *

ID = 'hdtest'
KIND = 'structure'
ATLAS = 512


def build(m):
    m.set_meta(footprint=(1, 1), height=0.6, radius=0.6)
    m.tune(edge_light=0.1, ao_distance=0.3)
    r = m.root
    box(r, concrete(), (0.9, 0.04, 0.9), (0, 0.02, 0), bevel=0.01)
    box(r, painted(0x4a4e54, panels=(0.25, 0.2)), (0.6, 0.4, 0.6), (0, 0.24, 0), bevel=0.02)
    box(r, team(), (0.64, 0.05, 0.64), (0, 0.46, 0), bevel=0.01)
    cyl(r, metal(), 0.06, 0.3, (0.15, 0.6, -0.1), seg=12)
    light(r, (-0.2, 0.49, 0.2), 0.02, 0xff2a1a, 'blink')
    sign(m, r, (0, 0.28, 0.305), (0.4, 0.14), 'POWER|OUR STRENGTH')
    emblem(m, r, 'soviet', (0.2, 0.3, 0.30), 0.1)
    m.smoke('smoke0', (0.15, 0.76, -0.1))
