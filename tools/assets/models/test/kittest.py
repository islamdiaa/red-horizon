"""kit regression: Cyrillic stencil, off-centre decal on a big face, buried moving part survives culling."""
from kit import *
ID = 'kittest'
KIND = 'structure'
ATLAS = 256
def build(m):
    r = m.root
    box(r, concrete(), (1.0, 0.05, 1.0), (0, 0.025, 0))
    box(r, painted(0x55595e, panels=None), (0.6, 0.4, 0.4), (0, 0.25, 0))
    stencil(m, r, 'СЛАВА', (0.0, 0.3, 0.2), 0.06)
    emblem(m, r, 'soviet', (0.22, 0.38, 0.2), 0.08)   # off-centre on the big front face
    mis = m.part('missile', at=(0, 0.05, 0))
    cyl(mis, metal(), 0.05, 0.3, (0, 0.15, 0))        # buried inside the box at rest
    emblem(m, r, 'soviet', (0.9, 0.9, 0.9), 0.05)     # touches nothing: must warn
