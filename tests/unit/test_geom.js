/**
 * test_geom.js — AABB Geometry Mathematics
 * Vector Mirror v2.5 (P1-01 acceptance)
 *
 * Validates `src/lib/geom.js` against RB-02 Pattern 4.2 (Pomona/dyn4j).
 * Pure Node, no Playwright dependency.
 */
import {
  signedGapBoxToBox,
  signedGapComponents,
  containmentRatio,
  overflowPerEdge,
  mtv,
} from '../../src/lib/geom.js';

let passed = 0,
  failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}`);
    failed++;
  }
}

function approx(actual, expected, eps = 1e-9) {
  return Math.abs(actual - expected) <= eps;
}

const box = (x, y, w, h) => ({ x, y, w, h });

// =============================================================================
// signedGapBoxToBox
// =============================================================================
console.log('--- signedGapBoxToBox: separation ---');

// Boxes in a row: [0,0,10,10] and [30,0,10,10] → x-gap 20, y-overlap → gap = 20
assert(
  'horizontal separation, vertical overlap → planar gap',
  approx(signedGapBoxToBox(box(0, 0, 10, 10), box(30, 0, 10, 10)), 20),
);

// Stacked vertically: gap = 15
assert(
  'vertical separation, horizontal overlap → planar gap',
  approx(signedGapBoxToBox(box(0, 0, 10, 10), box(0, 25, 10, 10)), 15),
);

// Diagonal separation: dx=10, dy=10 → hypot = √200
assert(
  'diagonal separation → Euclidean hypot',
  approx(
    signedGapBoxToBox(box(0, 0, 10, 10), box(20, 20, 10, 10)),
    Math.hypot(10, 10),
  ),
);

console.log('--- signedGapBoxToBox: touching ---');

assert(
  'edge-touching on x → gap = 0',
  signedGapBoxToBox(box(0, 0, 10, 10), box(10, 0, 10, 10)) === 0,
);

assert(
  'edge-touching on y → gap = 0',
  signedGapBoxToBox(box(0, 0, 10, 10), box(0, 10, 10, 10)) === 0,
);

assert(
  'corner-touching → gap = 0',
  signedGapBoxToBox(box(0, 0, 10, 10), box(10, 10, 10, 10)) === 0,
);

console.log('--- signedGapBoxToBox: overlap ---');

// Partial overlap: a=[0,0,10,10], b=[5,5,10,10] → dx=-5, dy=-5, signedDist = max = -5
assert(
  'partial overlap → max(dx,dy) = -5',
  signedGapBoxToBox(box(0, 0, 10, 10), box(5, 5, 10, 10)) === -5,
);

// Asymmetric overlap: dx=-2 (small), dy=-8 (deep). max = -2 (dominant axis = shallowest = x).
// Pomona definition: max(dx,dy) where both negative — shallowest axis "wins".
assert(
  'asymmetric overlap → max picks shallowest axis (-2)',
  signedGapBoxToBox(box(0, 0, 10, 10), box(8, 2, 10, 10)) === -2,
);

// Identical boxes: dx = -10, dy = -10
assert(
  'identical boxes → max(-w,-h)',
  signedGapBoxToBox(box(0, 0, 10, 10), box(0, 0, 10, 10)) === -10,
);

// a fully inside b: a=[2,2,4,4] b=[0,0,10,10]
// dx = max(2-10, 0-6) = -6  (a's left edge - b's right edge dominates)
// dy = max(2-10, 0-6) = -6
// signedDist = max(-6,-6) = -6  (penetration = distance to nearest exit)
assert(
  'a inside b → both axes overlap, depth = nearest exit',
  signedGapBoxToBox(box(2, 2, 4, 4), box(0, 0, 10, 10)) === -6,
);

// =============================================================================
// signedGapComponents
// =============================================================================
console.log('--- signedGapComponents: separation ---');

const sep = signedGapComponents(box(0, 0, 10, 10), box(30, 0, 10, 10));
assert('separation: dx > 0', sep.dx === 20);
assert('separation: dy < 0 (vertical overlap)', sep.dy === -10);
assert('separation: signedDist > 0', sep.signedDist === 20);

console.log('--- signedGapComponents: overlap ---');

const ov = signedGapComponents(box(0, 0, 10, 10), box(5, 5, 10, 10));
assert('overlap: dx negative', ov.dx === -5);
assert('overlap: dy negative', ov.dy === -5);
assert('overlap: signedDist = max(dx,dy)', ov.signedDist === -5);

console.log('--- signedGapComponents: touching ---');

const tc = signedGapComponents(box(0, 0, 10, 10), box(10, 0, 10, 10));
assert('touching: dx = 0', tc.dx === 0);
assert('touching: dy <= 0', tc.dy <= 0);
assert('touching: signedDist = 0', tc.signedDist === 0);

// =============================================================================
// containmentRatio
// =============================================================================
console.log('--- containmentRatio ---');

assert(
  'fully inside → 1',
  containmentRatio(box(2, 2, 4, 4), box(0, 0, 10, 10)) === 1,
);

assert(
  'fully outside → 0',
  containmentRatio(box(100, 100, 10, 10), box(0, 0, 10, 10)) === 0,
);

// Half-out: a=[5,0,10,10] b=[0,0,10,10] → intersection 5x10 = 50, area 100 → 0.5
assert(
  'half outside east → 0.5',
  containmentRatio(box(5, 0, 10, 10), box(0, 0, 10, 10)) === 0.5,
);

// Quarter-in: a=[8,8,4,4] b=[0,0,10,10] → intersection 2x2 = 4, area 16 → 0.25
assert(
  'quarter inside (corner straddle) → 0.25',
  containmentRatio(box(8, 8, 4, 4), box(0, 0, 10, 10)) === 0.25,
);

assert(
  'zero-area subject → 0 (no area to contain)',
  containmentRatio(box(5, 5, 0, 0), box(0, 0, 10, 10)) === 0,
);

// Container fully inside subject: ratio of a is intersection/a = b.area/a.area
assert(
  'container fully inside subject → b.area/a.area',
  containmentRatio(box(0, 0, 10, 10), box(2, 2, 4, 4)) === 16 / 100,
);

// =============================================================================
// overflowPerEdge
// =============================================================================
console.log('--- overflowPerEdge ---');

const inside = overflowPerEdge(box(2, 2, 4, 4), box(0, 0, 10, 10));
assert(
  'fully inside → all zeros',
  inside.north === 0 &&
    inside.east === 0 &&
    inside.south === 0 &&
    inside.west === 0,
);

// North overflow: a sticks above b. b.y - a.y > 0 when a.y < b.y.
const north = overflowPerEdge(box(2, -5, 4, 4), box(0, 0, 10, 10));
assert(
  'overflow north only',
  north.north === 5 &&
    north.east === 0 &&
    north.south === 0 &&
    north.west === 0,
);

const east = overflowPerEdge(box(8, 2, 6, 4), box(0, 0, 10, 10));
assert(
  'overflow east only',
  east.east === 4 && east.north === 0 && east.south === 0 && east.west === 0,
);

const south = overflowPerEdge(box(2, 8, 4, 6), box(0, 0, 10, 10));
assert(
  'overflow south only',
  south.south === 4 &&
    south.north === 0 &&
    south.east === 0 &&
    south.west === 0,
);

const west = overflowPerEdge(box(-3, 2, 4, 4), box(0, 0, 10, 10));
assert(
  'overflow west only',
  west.west === 3 && west.north === 0 && west.east === 0 && west.south === 0,
);

const corner = overflowPerEdge(box(8, -2, 6, 4), box(0, 0, 10, 10));
assert(
  'two-edge overflow (north+east)',
  corner.north === 2 &&
    corner.east === 4 &&
    corner.south === 0 &&
    corner.west === 0,
);

// =============================================================================
// mtv
// =============================================================================
console.log('--- mtv: no resolution needed ---');

const sepMtv = mtv(box(0, 0, 10, 10), box(30, 0, 10, 10));
assert(
  'separated → {0,0,0}',
  sepMtv.dx === 0 && sepMtv.dy === 0 && sepMtv.abs === 0,
);

const touchMtv = mtv(box(0, 0, 10, 10), box(10, 0, 10, 10));
assert(
  'touching → {0,0,0}',
  touchMtv.dx === 0 && touchMtv.dy === 0 && touchMtv.abs === 0,
);

console.log('--- mtv: shallow-axis push ---');

// a=[0,0,10,10] b=[8,2,10,10] → dx=-2, dy=-8 → push x
const pushX = mtv(box(0, 0, 10, 10), box(8, 2, 10, 10));
assert(
  'push along shallower x-axis',
  pushX.dx === -2 && pushX.dy === 0 && pushX.abs === 2,
);
// a's center 5,5 vs b's center 13,7 → aCx<bCx → sign=-1 → dx=-2 (move a left away from b)

// a=[2,8,10,10] b=[0,0,10,10] → dx=-8, dy=-2 → push y
const pushY = mtv(box(2, 8, 10, 10), box(0, 0, 10, 10));
assert(
  'push along shallower y-axis',
  pushY.dx === 0 && pushY.dy === 2 && pushY.abs === 2,
);
// a's center 7,13 vs b's center 5,5 → aCy>bCy → sign=+1 → dy=+2 (move a down away)

console.log('--- mtv: tie-break + degenerate ---');

// equal penetration → prefer x
const tie = mtv(box(0, 0, 10, 10), box(5, 5, 10, 10));
assert(
  'equal pen → prefer x-axis',
  tie.dy === 0 && Math.abs(tie.dx) === 5 && tie.abs === 5,
);

// coincident centers (identical boxes) → deterministic
const coincident = mtv(box(0, 0, 10, 10), box(0, 0, 10, 10));
assert(
  'coincident → deterministic non-zero on x',
  coincident.dy === 0 && coincident.dx === 10 && coincident.abs === 10,
);

// MTV applied actually separates the boxes (round-trip property)
const aBox = box(0, 0, 10, 10);
const bBox = box(5, 5, 10, 10);
const v = mtv(aBox, bBox);
const moved = box(aBox.x + v.dx, aBox.y + v.dy, aBox.w, aBox.h);
assert(
  'mtv applied → boxes no longer overlap',
  signedGapBoxToBox(moved, bBox) >= 0,
);

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
