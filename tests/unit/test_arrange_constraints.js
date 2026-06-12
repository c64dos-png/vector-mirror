/**
 * test_arrange_constraints.js - Phase 3a: arrangeConstraint Unit Tests
 * Tests each constraint's arrange() directly via the Registry.
 * All 11 types tested individually.
 */
import {
  arrangeConstraint,
  listConstraints,
} from '../../src/core/constraints/registry.js';
import '../../src/core/constraints/loader.js';

let passed = 0,
  failed = 0;

function assertEqual(label, actual, expected) {
  if (actual === expected) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(
      `  FAIL: ${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
    );
    failed++;
  }
}

function assertClose(label, actual, expected, tol = 1) {
  if (Math.abs(actual - expected) <= tol) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(
      `  FAIL: ${label} — got ${actual}, expected ~${expected} (tol=${tol})`,
    );
    failed++;
  }
}

const canvas = { width: 400, height: 300 };

// Helper: create element with bbox
function el(x, y, w, h, id = 'subj') {
  return { id, tag: 'rect', bbox: { x, y, w, h } };
}

// ── CENTERED-IN ─────────────────────────────────────────────

console.log('--- arrangeConstraint: CENTERED-IN ---');
{
  const subj = el(0, 0, 60, 60);
  const ref = el(0, 0, 400, 300, 'bg');
  const result = arrangeConstraint('CENTERED-IN', subj, ref, { canvas });
  assertClose('CENTERED-IN: cx=200', result.cx, 200);
  assertClose('CENTERED-IN: cy=150', result.cy, 150);
}

// ── NO-OVERLAP ──────────────────────────────────────────────

console.log('--- arrangeConstraint: NO-OVERLAP ---');
{
  // subj overlaps ref — subj at (90,90,60,60) overlapping ref at (100,100,60,60)
  const subj = el(90, 90, 60, 60);
  const ref = el(100, 100, 60, 60, 'ref');
  const result = arrangeConstraint('NO-OVERLAP', subj, ref, { canvas });
  // Shortest escape vectors:
  // dxL=70, dxR=-50, dyT=70, dyB=-50
  // abs: dxR=50 and dyB=50 tie → reduce(a<b) keeps last match (dyB)
  // Result: x = 90 + 0 = 90, y = 90 + (-50) = 40
  assertEqual('NO-OVERLAP: x=90', result.x, 90);
  assertEqual('NO-OVERLAP: y=40', result.y, 40);
  // Verify no overlap: subj now at (90,40,60,60), ref at (100,100,60,60)
  // subj bottom edge = 100 = ref top edge → touching, not overlapping
}

// ── NO-OVERLAP: F-4 guard for non-overlapping ───────────────

console.log('--- arrangeConstraint: NO-OVERLAP non-overlapping guard ---');
{
  // subj and ref do NOT overlap — arrange should return original position
  const subj = el(0, 0, 50, 50);
  const ref = el(200, 200, 50, 50, 'ref');
  const result = arrangeConstraint('NO-OVERLAP', subj, ref, { canvas });
  assertEqual('NO-OVERLAP guard: x unchanged', result.x, 0);
  assertEqual('NO-OVERLAP guard: y unchanged', result.y, 0);
}

// ── INSIDE ──────────────────────────────────────────────────

console.log('--- arrangeConstraint: INSIDE ---');
{
  const subj = el(-10, -10, 50, 50);
  const ref = el(0, 0, 400, 300, 'container');
  const result = arrangeConstraint('INSIDE', subj, ref, { canvas });
  assertEqual('INSIDE: x clamped to 0', result.x, 0);
  assertEqual('INSIDE: y clamped to 0', result.y, 0);
}

// ── ALIGNED-LEFT ────────────────────────────────────────────

console.log('--- arrangeConstraint: ALIGNED-LEFT ---');
{
  const subj = el(50, 50, 60, 60);
  const ref = el(20, 100, 80, 80, 'ref');
  const result = arrangeConstraint('ALIGNED-LEFT', subj, ref, { canvas });
  assertEqual('ALIGNED-LEFT: x=20', result.x, 20);
}

// ── ALIGNED-TOP ─────────────────────────────────────────────

console.log('--- arrangeConstraint: ALIGNED-TOP ---');
{
  const subj = el(50, 50, 60, 60);
  const ref = el(100, 20, 80, 80, 'ref');
  const result = arrangeConstraint('ALIGNED-TOP', subj, ref, { canvas });
  assertEqual('ALIGNED-TOP: y=20', result.y, 20);
}

// ── LEFT-OF ─────────────────────────────────────────────────

console.log('--- arrangeConstraint: LEFT-OF ---');
{
  const subj = el(0, 0, 60, 60);
  const ref = el(200, 100, 80, 80, 'ref');
  const result = arrangeConstraint('LEFT-OF', subj, ref, { canvas });
  assertEqual('LEFT-OF: x=140', result.x, 140); // ref.x - subj.w = 200 - 60
}

// ── ABOVE ───────────────────────────────────────────────────

console.log('--- arrangeConstraint: ABOVE ---');
{
  const subj = el(0, 0, 60, 60);
  const ref = el(100, 200, 80, 80, 'ref');
  const result = arrangeConstraint('ABOVE', subj, ref, { canvas });
  assertEqual('ABOVE: y=140', result.y, 140); // ref.y - subj.h = 200 - 60
}

// ── SAME-SIZE ───────────────────────────────────────────────

console.log('--- arrangeConstraint: SAME-SIZE ---');
{
  const subj = el(0, 0, 30, 30);
  const ref = el(100, 100, 80, 60, 'ref');
  const result = arrangeConstraint('SAME-SIZE', subj, ref, { canvas });
  assertEqual('SAME-SIZE: width=80', result.width, 80);
  assertEqual('SAME-SIZE: height=60', result.height, 60);
}

// ── DISTANCE-FROM ───────────────────────────────────────────

console.log('--- arrangeConstraint: DISTANCE-FROM ---');
{
  // Identical positions (dist=0) — deterministic push right (Audit Fix D)
  const subj = el(100, 100, 40, 40);
  const ref = el(100, 100, 40, 40, 'ref');
  // cellsX = clamp(4,16, round(400/50)) = 8, cellW = 50, minDist = 50
  const result = arrangeConstraint('DISTANCE-FROM', subj, ref, {
    canvas,
    value: 1,
  });
  // Push right: x = ref.x + ref.w + minDist = 100 + 40 + 50 = 190
  assertEqual('DISTANCE-FROM dist=0: x=190', result.x, 190);
  assertEqual('DISTANCE-FROM dist=0: y=100', result.y, 100);
}

console.log('--- arrangeConstraint: DISTANCE-FROM separated ---');
{
  // Already far enough apart — no-op
  const subj = el(0, 0, 40, 40);
  const ref = el(300, 300, 40, 40, 'ref');
  const result = arrangeConstraint('DISTANCE-FROM', subj, ref, {
    canvas,
    value: 1,
  });
  assertEqual('DISTANCE-FROM no-op: x=0', result.x, 0);
  assertEqual('DISTANCE-FROM no-op: y=0', result.y, 0);
}

console.log('--- arrangeConstraint: DISTANCE-FROM push axis ---');
{
  // Overlapping, subj right of ref — push right along x-axis
  const subj = el(110, 100, 40, 40);
  const ref = el(100, 100, 40, 40, 'ref');
  // Centers: subj=(130,120), ref=(120,120), dx=10, dy=0 → dominant axis = x, sign=+1
  // cellsX=8, cellW=50, minDist=50
  // targetX = ref.x + ref.w + minDist = 100 + 40 + 50 = 190
  const result = arrangeConstraint('DISTANCE-FROM', subj, ref, {
    canvas,
    value: 1,
  });
  assertEqual('DISTANCE-FROM push-right: x=190', result.x, 190);
  assertEqual('DISTANCE-FROM push-right: y=100', result.y, 100);
}

// ── FILL ────────────────────────────────────────────────────

console.log('--- arrangeConstraint: FILL ---');
{
  const subj = el(10, 10, 50, 50);
  const result = arrangeConstraint('FILL', subj, null, { canvas });
  assertEqual('FILL: x=0', result.x, 0);
  assertEqual('FILL: y=0', result.y, 0);
  assertEqual('FILL: width=400', result.width, 400);
  assertEqual('FILL: height=300', result.height, 300);
}

// ── COLOR (no arrange) ─────────────────────────────────────

console.log('--- arrangeConstraint: COLOR ---');
{
  const subj = el(0, 0, 50, 50);
  const result = arrangeConstraint('COLOR', subj, null, { canvas });
  assertEqual('COLOR: returns null', result, null);
}

// ── Unknown type ────────────────────────────────────────────

console.log('--- arrangeConstraint: UNKNOWN ---');
{
  const subj = el(0, 0, 50, 50);
  const result = arrangeConstraint('NONEXISTENT', subj, null, { canvas });
  assertEqual('UNKNOWN: returns null', result, null);
}

// ── listConstraints includes FILL ───────────────────────────

console.log('--- listConstraints: includes FILL ---');
{
  const types = listConstraints();
  const fillType = types.find((t) => t.type === 'FILL');
  assertEqual('FILL registered', !!fillType, true);
  assertEqual('FILL hasArrange', fillType.hasArrange, true);
  assertEqual('total 11 types', types.length, 11);
}

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
