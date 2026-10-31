// Mini football helmet (modern style) - shell with jaw flaps, crown panel,
// front/back bumpers, and a separate 4-bar facemask.
// Units: mm. +Y = front (face), +Z = up.
// Render one part at a time: set PART, F6, then File > Export > STL.

PART  = "both";   // "shell", "mask", or "both"
SCALE = 1.0;
WALL  = 2.4;
$fn   = 96;

RX = 50; RY = 64; RZ = 60;   // dome radii
ZS = -18;                    // dome turns into straight skirt here
ZB = -50;                    // bottom of jaw flaps

module ell(rx, ry, rz) scale([rx, ry, rz]) sphere(1);
module box(x0, x1, y0, y1, z0, z1) translate([x0, y0, z0]) cube([x1-x0, y1-y0, z1-z0]);

// Dome + tapered skirt, shrunk by `off`
module body(off) {
    rx = RX-off; ry = RY-off; rz = RZ-off;
    k = sqrt(1 - pow(ZS/rz, 2));
    intersection() { ell(rx, ry, rz); box(-99, 99, -99, 99, ZS, 99); }
    translate([0, 0, ZS]) mirror([0, 0, 1])
        linear_extrude(height = ZS - ZB, scale = 0.90)
            scale([rx*k, ry*k]) circle(1);
}
module oval_prism(rx, ry) scale([rx, ry, 1]) cylinder(r=1, h=99);
module skin(grow) difference() { ell(RX+grow, RY+grow, RZ+grow); body(WALL); }

module shell() {
    difference() {
        union() {
            difference() { body(0); body(WALL); }
            intersection() { skin(1.6); translate([0, 6, 0]) oval_prism(17, 26); }  // crown panel
            intersection() { skin(2.2); box(-24, 24, 0, 99, 15, 27); }              // front bumper
            intersection() { skin(1.8); box(-20, 20, -99, -30, -6, 6); }            // back bumper
        }
        box(-31, 31, 15, 99, -99, 14);                       // face opening
        box(-99, 99, -99, -8, -99, -30);                     // back sits higher
        translate([0, -8, -44]) rotate([0, 90, 0]) cylinder(r=14, h=80, center=true);
        box(-99, 99, 48, 99, -99, -36);                      // chin trimmed back
        for (sx = [-1, 1])                                   // ear holes
            translate([sx*RX, -4, -14]) rotate([0, 90, 0]) cylinder(r=5.5, h=20, center=true);
        intersection() {                                     // groove around crown panel
            difference() { ell(RX+2, RY+2, RZ+2); ell(RX+0.6, RY+0.6, RZ+0.6); }
            translate([0, 6, 0]) difference() { oval_prism(19, 28); oval_prism(17.6, 26.6); }
        }
    }
}

// ---------------- facemask ----------------
R  = 2.4;
CY = 18;                                                  // side posts sit here (on jaw flaps)
BARS = [[13, 48, 52], [0, 49, 56], [-16, 48, 56], [-34, 44, 50]];  // [z, half-width, reach]
function bp(t, b) = [b[1]*cos(t), CY + b[2]*sin(t), b[0]];

module seg(a, b, r) hull() { translate(a) sphere(r, $fn=24); translate(b) sphere(r, $fn=24); }
module poly(pts, r=R) for (i = [0:len(pts)-2]) seg(pts[i], pts[i+1], r);

module mask() {
    for (b = BARS) poly([for (i = [0:39]) bp(180*i/39, b)]);              // horizontal bars
    for (t = [70, 110]) poly([for (b = BARS) bp(t, b)]);                  // center verticals
    for (t = [25, 155]) poly([for (i = [1:3]) bp(t, BARS[i])]);           // cheek verticals
    for (t = [0, 180])  poly([for (b = BARS) bp(t, b)], R + 0.6);         // side posts
}

scale(SCALE) {
    if (PART == "shell" || PART == "both") color("white") shell();
    if (PART == "mask"  || PART == "both") color("white") mask();
}
