"""kit regression: two colours in one glow slot (red / green harbour lights), double-sided glow fin."""
from kit import *
ID = 'glowtest'
KIND = 'structure'
ATLAS = 256
def build(m):
    r = m.root
    box(r, concrete(), (1.0, 0.05, 1.0), (0, 0.025, 0))
    sphere(r, glow_material('glow:harbour', 0xff3020), 0.03, (-0.3, 0.1, 0.3), seg=8, rings=5)
    sphere(r, glow_material('glow:harbour', 0x40ff70), 0.03, (0.3, 0.1, 0.3), seg=8, rings=5)
    quad(r, glow_material('glow:fin', 0x40a0ff, double_sided=True), (0.2, 0.1), (0, 0.2, 0))
