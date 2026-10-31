"""Generate a mini football helmet (shell + facemask) as printable STLs.
Units: mm. +Y = front (face), +Z = up. Run: python3 make_helmet.py [scale]"""
import sys, math, numpy as np, trimesh
from manifold3d import Manifold

S = float(sys.argv[1]) if len(sys.argv) > 1 else 1.0
WALL = 2.4

def ell(rx, ry, rz, n=96):
    return Manifold.sphere(1.0, n).scale((rx, ry, rz))

def box(x0, x1, y0, y1, z0, z1):
    return Manifold.cube((x1-x0, y1-y0, z1-z0)).translate((x0, y0, z0))

def cyl_x(r, length, y, z):
    return (Manifold.cylinder(length, r, r, 64, True)
            .rotate((0, 90, 0)).translate((0, y, z)))

def tube(pts, r):
    """Round bar through a polyline, made of hulled sphere pairs."""
    out = None
    for a, b in zip(pts[:-1], pts[1:]):
        seg = Manifold.batch_hull([Manifold.sphere(r, 24).translate(a),
                                   Manifold.sphere(r, 24).translate(b)])
        out = seg if out is None else out + seg
    return out

def arc(cy, cz, rx, ry, a0, a1, n=24):
    return [(rx*math.cos(t), cy + ry*math.sin(t), cz)
            for t in np.linspace(math.radians(a0), math.radians(a1), n)]

# ---------------- shell ----------------
RX, RY, RZ = 52, 62, 58
outer = ell(RX, RY, RZ)
inner = ell(RX-WALL, RY-WALL, RZ-WALL)
shell = outer - inner
shell -= box(-99, 99, -99, 99, -99, -28)            # open bottom
shell -= box(-36, 36, 18, 99, -28, 12)               # face opening
shell -= box(-99, 99, 40, 99, -28, -10)              # chin cut-back
for sx in (-1, 1):                                   # ear holes
    shell -= cyl_x(6, 20, -2, -6).translate((sx*RX, 0, 0))
# raised center ridge + forehead nameplate pad (blank for your own text/decal)
ridge = (ell(14, RY+1.2, RZ+1.2) - ell(14, RY-WALL, RZ-WALL)) ^ box(-7, 7, -99, 99, 5, 99)
shell += ridge
pad = ell(RX+1.5, RY+1.5, RZ+1.5) ^ box(-18, 18, 20, 99, 20, 30)
shell += pad - inner
# back vent slots
for x in (-14, 14):
    shell -= box(x-3, x+3, -99, -40, 22, 34)
# ---------------- facemask ----------------
R = 2.2
cz_top, cz_mid, cz_bot = 8, -6, -18
mask = tube(arc(10, cz_top, 42, 40, 15, 165), R)       # top bar (brow)
mask += tube(arc(10, cz_mid, 44, 44, 20, 160), R)      # middle bar
mask += tube(arc(14, cz_bot, 40, 40, 25, 155), R)      # bottom bar
for x in (-12, 12):                                    # vertical bars
    yt = 10 + 40*math.sqrt(max(0, 1-(x/42)**2))
    yb = 14 + 40*math.sqrt(max(0, 1-(x/40)**2))
    mask += tube([(x, yt, cz_top), (x, yb+1, cz_mid), (x, yb, cz_bot)], R)
for sx in (-1, 1):                                     # side mounts (glue to shell)
    for z in (cz_top, cz_bot):
        mask += tube([(sx*40, 24, z), (sx*(RX-3), 22, z)], R)

def save(m, name):
    mesh = m.scale((S, S, S)).to_mesh()
    t = trimesh.Trimesh(mesh.vert_properties[:, :3], mesh.tri_verts)
    t.export(name)
    print(name, "watertight" if t.is_watertight else "NOT watertight",
          "size(mm)=", np.round(t.extents, 1))

save(shell, "helmet_shell.stl")
save(mask, "helmet_facemask.stl")
