// Mini football helmet - shell + facemask
// Units: mm. +Y = front (face), +Z = up.
// Render each part separately: set PART, then F6 and export STL.

PART  = "both";   // "shell", "mask", or "both"
SCALE = 1.0;      // overall size multiplier
WALL  = 2.4;      // shell wall thickness
$fn   = 96;

RX = 52; RY = 62; RZ = 58;   // shell outer radii (half width / length / height)
BAR = 2.2;                    // facemask bar radius

module ell(rx, ry, rz) scale([rx, ry, rz]) sphere(1);
module box(x0, x1, y0, y1, z0, z1)
    translate([x0, y0, z0]) cube([x1 - x0, y1 - y0, z1 - z0]);

// ---------------- shell ----------------
module shell() {
    difference() {
        union() {
            difference() { ell(RX, RY, RZ); ell(RX-WALL, RY-WALL, RZ-WALL); }
            // raised center ridge
            intersection() {
                difference() { ell(14, RY+1.2, RZ+1.2); ell(14, RY-WALL, RZ-WALL); }
                box(-7, 7, -99, 99, 5, 99);
            }
            // blank forehead nameplate pad
            difference() {
                intersection() { ell(RX+1.5, RY+1.5, RZ+1.5); box(-18, 18, 20, 99, 20, 30); }
                ell(RX-WALL, RY-WALL, RZ-WALL);
            }
        }
        box(-99, 99, -99, 99, -99, -28);   // open bottom
        box(-36, 36, 18, 99, -28, 12);     // face opening
        box(-99, 99, 40, 99, -28, -10);    // chin cut-back
        for (sx = [-1, 1])                 // ear holes
            translate([sx*RX, -2, -6]) rotate([0, 90, 0]) cylinder(r=6, h=20, center=true);
        for (x = [-14, 14])                // back vent slots
            box(x-3, x+3, -99, -40, 22, 34);
    }
}

// ---------------- facemask ----------------
module seg(a, b) hull() { translate(a) sphere(BAR, $fn=24); translate(b) sphere(BAR, $fn=24); }
module poly(pts) for (i = [0:len(pts)-2]) seg(pts[i], pts[i+1]);
function arc(cy, cz, rx, ry, a0, a1, n=24) =
    [for (i = [0:n-1]) let(t = a0 + (a1 - a0) * i / (n-1)) [rx*cos(t), cy + ry*sin(t), cz]];

ZT = 8; ZM = -6; ZB = -18;   // bar heights: brow, middle, bottom

module mask() {
    poly(arc(10, ZT, 42, 40, 15, 165));   // brow bar
    poly(arc(10, ZM, 44, 44, 20, 160));   // middle bar
    poly(arc(14, ZB, 40, 40, 25, 155));   // bottom bar
    for (x = [-12, 12]) {                 // vertical bars
        yt = 10 + 40*sqrt(max(0, 1 - pow(x/42, 2)));
        yb = 14 + 40*sqrt(max(0, 1 - pow(x/40, 2)));
        poly([[x, yt, ZT], [x, yb+1, ZM], [x, yb, ZB]]);
    }
    for (sx = [-1, 1], z = [ZT, ZB])      // side mounts (glue to shell)
        seg([sx*40, 24, z], [sx*(RX-3), 22, z]);
}

scale(SCALE) {
    if (PART == "shell" || PART == "both") color("white") shell();
    if (PART == "mask"  || PART == "both") color("#00a3ad") mask();
}
