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
// Bars are ellipses (top view) standing OUT IN FRONT of the face opening.
// Their ends land on the shell surface at the sides - glue there.
CY   = 26;                                       // y where bar ends meet the shell
BARS = [[10, 46, 46], [-8, 46, 48], [-24, 42, 44]];  // [z, half-width, forward reach]
function bar_y(x, ax, ay) = CY + ay*sqrt(max(0, 1 - pow(x/ax, 2)));

module mask() {
    for (b = BARS)                         // horizontal bars
        poly([for (i = [0:31]) let(t = 180*i/31) [b[1]*cos(t), CY + b[2]*sin(t), b[0]]]);
    for (x = [-14, 0, 14])                 // vertical bars
        poly([for (b = BARS) [x, bar_y(x, b[1], b[2]), b[0]]]);
}

scale(SCALE) {
    if (PART == "shell" || PART == "both") color("white") shell();
    if (PART == "mask"  || PART == "both") color("#00a3ad") mask();
}
