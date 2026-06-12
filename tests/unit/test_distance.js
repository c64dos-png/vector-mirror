/**
 * test_distance.js - AF-04: DISTANCE-FROM Check Logic Test
 * Tests check behavior, not just parsing.
 * Vector Mirror v2.0
 */
import { checkConstraint } from '../../src/core/constraints/registry.js';
import '../../src/core/constraints/loader.js';

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

const grid = { cellW: 50, cellH: 50 };

// Two boxes far apart (gap > 1 * cellW = 50px)
console.log('--- DISTANCE-FROM: pass ---');
const a = {
  id: 'a',
  bbox: { x: 0, y: 0, w: 20, h: 20 },
  cx: 10,
  cy: 10,
  color: 'red',
};
const b = {
  id: 'b',
  bbox: { x: 100, y: 0, w: 20, h: 20 },
  cx: 110,
  cy: 10,
  color: 'blue',
};
const res1 = checkConstraint('DISTANCE-FROM', a, b, { grid, value: 1 });
assert('far apart passes (gap=80px, need=50px)', res1.pass === true);

// Two boxes close together (gap < 1 * cellW = 50px)
console.log('--- DISTANCE-FROM: fail ---');
const c = {
  id: 'c',
  bbox: { x: 0, y: 0, w: 20, h: 20 },
  cx: 10,
  cy: 10,
  color: 'red',
};
const d = {
  id: 'd',
  bbox: { x: 30, y: 0, w: 20, h: 20 },
  cx: 40,
  cy: 10,
  color: 'blue',
};
const res2 = checkConstraint('DISTANCE-FROM', c, d, { grid, value: 1 });
assert('close boxes fail (gap=10px, need=50px)', res2.pass === false);
// G2 (D-006): detail beschreibt nur noch das WAS/WIEVIEL-daneben (Ist-/Soll-
// Distanz + Defizit), keine Korrektur-Anweisung mehr. Die Korrektur lebt
// strukturiert in dx/dy.
assert(
  'detail contains deficit (WIEVIEL-daneben)',
  res2.detail && res2.detail.includes('Defizit'),
);
assert(
  'detail carries no correction instruction (no "erhoehen")',
  res2.detail && !res2.detail.includes('erhoehen'),
);
assert(
  'fail carries structured dx/dy correction',
  res2.dx !== undefined || res2.dy !== undefined,
);

// Custom multiplier (value=2 → need 100px)
console.log('--- DISTANCE-FROM: multiplier ---');
const res3 = checkConstraint('DISTANCE-FROM', a, b, { grid, value: 2 });
assert('80px gap fails for value=2 (need=100px)', res3.pass === false);

// Overlapping boxes (gap = 0)
console.log('--- DISTANCE-FROM: overlapping ---');
const e = {
  id: 'e',
  bbox: { x: 10, y: 10, w: 50, h: 50 },
  cx: 35,
  cy: 35,
  color: 'red',
};
const f = {
  id: 'f',
  bbox: { x: 30, y: 30, w: 50, h: 50 },
  cx: 55,
  cy: 55,
  color: 'blue',
};
const res4 = checkConstraint('DISTANCE-FROM', e, f, { grid, value: 1 });
assert('overlapping fails (gap=0, need=50px)', res4.pass === false);

// value=0 + overlap → pass=true (expectedDist = 0*cellW = 0, actualDist = 0 → 0>=0)
// Migrated coverage from legacy mirror.js block (test_diff.js "DISTANCE-FROM zero preserved")
console.log('--- DISTANCE-FROM: value=0 overlap ---');
const g = {
  id: 'g',
  bbox: { x: 0, y: 0, w: 20, h: 20 },
  cx: 10,
  cy: 10,
  color: 'red',
};
const h = {
  id: 'h',
  bbox: { x: 0, y: 0, w: 20, h: 20 },
  cx: 10,
  cy: 10,
  color: 'blue',
};
const res6 = checkConstraint('DISTANCE-FROM', g, h, { grid, value: 0 });
assert(
  'value=0 passes for overlapping elements (gap=0, need=0px)',
  res6.pass === true,
);

// Default value (undefined → defaults to 1)
console.log('--- DISTANCE-FROM: default value ---');
const res5 = checkConstraint('DISTANCE-FROM', a, b, { grid });
assert('undefined value defaults to 1 (pass)', res5.pass === true);

// D-003 HONEST-RED: negativer Ziel-Abstand ist eine INVALIDE Mess-Vorgabe.
// Frueher: expectedDist < 0 → actualDist >= expectedDist IMMER true → stiller
// PASS auf eine unmessbare Vorgabe. Jetzt: pass:null + reasonCode, NIE pass:true.
console.log('--- DISTANCE-FROM: negative target (D-003 honest-red) ---');
const resNeg = checkConstraint('DISTANCE-FROM', a, b, { grid, value: -3 });
assert('negative target → pass is null (NOT true)', resNeg.pass === null);
assert(
  'negative target → pass is NOT true (no silent PASS)',
  resNeg.pass !== true,
);
assert(
  'negative target → reasonCode INVALID_MEASUREMENT',
  resNeg.reasonCode === 'INVALID_MEASUREMENT',
);
assert(
  'negative target → reasonCategory SPECIFICATION',
  resNeg.reasonCategory === 'SPECIFICATION',
);
assert(
  'negative target → detail carries the raw value -3 unchanged (NO clamp)',
  typeof resNeg.detail === 'string' && resNeg.detail.includes('-3'),
);
assert(
  'negative target → NO dx/dy correction emitted (unmeasurable, not failing)',
  resNeg.dx === undefined && resNeg.dy === undefined,
);

// D-003 REGRESS: positiver Wert bleibt unveraendert korrekt (pass=true bei
// genuegend Abstand, pass=false bei zu nah), value=0 weiterhin pass.
console.log('--- DISTANCE-FROM: positive value regress (D-003) ---');
const resPosPass = checkConstraint('DISTANCE-FROM', a, b, { grid, value: 1 });
assert('regress: value=1 far apart still passes', resPosPass.pass === true);
const resPosFail = checkConstraint('DISTANCE-FROM', c, d, { grid, value: 1 });
assert('regress: value=1 too-close still fails', resPosFail.pass === false);
const resZero = checkConstraint('DISTANCE-FROM', g, h, { grid, value: 0 });
assert(
  'regress: value=0 overlap still passes (boundary, not negative)',
  resZero.pass === true,
);

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
