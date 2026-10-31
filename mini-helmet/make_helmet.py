"""Mini football helmet (modern style): shell with jaw flaps, crown panel,
front bumper, and a separate 4-bar facemask. Units mm, +Y front, +Z up.
Run: python3 make_helmet.py [scale]"""
import sys, math, numpy as np, trimesh
from manifold3d import Manifold, CrossSection

S = float(sys.argv[1]) if len(sys.argv) > 1 else 1.0
WALL = 2.4
RX, RY, RZ = 50, 64, 60      # dome radii
ZS = -18                     # where the dome turns into the straight skirt
ZB = -50                     # bottom of the jaw flaps

def ell(rx, ry, rz, n=128):
    return Manifold.sphere(1.0, n).scale((rx, ry, rz))
def box(x0, x1, y0, y1, z0, z1):
    return Manifold.cube((x1-x0, y1-y0, z1-z0)).translate((x0, y0, z0))
def tube(pts, r):
    out = None
    for a, b in zip(pts[:-1], pts[1:]):
        seg = Manifold.batch_hull([Manifold.sphere(r, 24).translate(a),
                                   Manifold.sphere(r, 24).translate(b)])
        out = seg if out is None else out + seg
    return out

def body(off):
    """Dome + downward skirt (follows the dome's outline at ZS, tapering in)."""
    rx, ry, rz = RX-off, RY-off, RZ-off
    dome = ell(rx, ry, rz) ^ box(-99, 99, -99, 99, ZS, 99)
    k = math.sqrt(1-(ZS/rz)**2)
    sx, sy = rx*k, ry*k
    sec = CrossSection.circle(1.0, 128).scale((sx, sy))
    h = ZS - ZB
    skirt = Manifold.extrude(sec, h, 0, 0.0, (0.90, 0.90)).rotate((180, 0, 0)).translate((0, 0, ZS))
    return dome + skirt, sx, sy

OUT, SX, SY = body(0)
INN, _, _ = body(WALL)
shell = OUT - INN

# --- cut the helmet outline ---
shell -= box(-31, 31, 15, 99, -99, 14)                  # face opening
shell -= box(-99, 99, -99, -8, -99, -30)                # back sits higher than jaw
# curve the back->jaw transition a bit
shell -= (Manifold.cylinder(80, 14, 14, 64, True).rotate((0, 90, 0))
          .translate((0, -8, -44)))
shell -= box(-99, 99, 48, 99, -99, -36)                 # chin trimmed back
for sx in (-1, 1):                                       # ear holes
    shell -= (Manifold.cylinder(20, 5.5, 5.5, 48, True).rotate((0, 90, 0))
              .translate((sx*RX, -4, -14)))

# --- raised oval crown panel (like the flex panel on the photos) ---
crown = (ell(RX+1.6, RY+1.6, RZ+1.6) - INN) ^ \
        Manifold.cylinder(99, 1, 1, 96).scale((17, 26, 1)).translate((0, 6, 0))
groove = (ell(RX+2, RY+2, RZ+2) - ell(RX+0.6, RY+0.6, RZ+0.6)) ^ \
         (Manifold.cylinder(99, 1, 1, 96).scale((19, 28, 1)) -
          Manifold.cylinder(99, 1, 1, 96).scale((17.6, 26.6, 1))).translate((0, 6, 0))
shell = shell + crown - groove

# --- front bumper / nameplate band above the face opening ---
bumper = (ell(RX+2.2, RY+2.2, RZ+2.2) - INN) ^ box(-24, 24, 0, 99, 15, 27)
shell += bumper

# --- back bumper ---
shell += (ell(RX+1.8, RY+1.8, RZ+1.8) - INN) ^ box(-20, 20, -99, -30, -6, 6)

# ---------------- facemask ----------------
R = 2.4
CY = 18                       # where the side posts sit (on the jaw flaps)
# (z, half-width at the ends, forward reach)
BARS = [(13, 48, 52), (0, 49, 56), (-16, 48, 56), (-34, 44, 50)]
def bar_pt(t, z, ax, ay):
    return (ax*math.cos(t), CY + ay*math.sin(t), z)
mask = None
for z, ax, ay in BARS:
    pts = [bar_pt(t, z, ax, ay) for t in np.linspace(0, math.pi, 40)]
    b = tube(pts, R); mask = b if mask is None else mask + b
for t in (math.radians(70), math.radians(110)):        # two center verticals
    mask += tube([bar_pt(t, z, ax, ay) for z, ax, ay in BARS], R)
for t in (math.radians(25), math.radians(155)):        # cheek verticals
    mask += tube([bar_pt(t, z, ax, ay) for z, ax, ay in BARS[1:]], R)
for t in (0, math.pi):                                  # side posts (mount here)
    mask += tube([bar_pt(t, z, ax, ay) for z, ax, ay in BARS], R + 0.6)

def save(m, name):
    mesh = m.scale((S, S, S)).to_mesh()
    t = trimesh.Trimesh(mesh.vert_properties[:, :3], mesh.tri_verts)
    t.export(name)
    print(name, "watertight" if t.is_watertight else "NOT watertight",
          "size(mm)=", np.round(t.extents, 1))
    return t

save(shell, "helmet_shell.stl")
save(mask, "helmet_facemask.stl")
inside = (mask ^ OUT).volume() / mask.volume()
print("facemask volume inside helmet: %.1f%%" % (100*inside))
