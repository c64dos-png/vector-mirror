/**
 * test_diff.js - Diff + Arbitrate Verification
 * Tests computeDiff and arbitrate
 * Vector Mirror v2.0
 */
import { computeDiff } from '../../src/core/diff.js';
import { arbitrate } from '../../src/core/arbitrate.js';

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

console.log('--- DIFF: Exact ID Matching ---');
const oldMap = {
  grid: { cellW: 50, cellH: 50 },
  elements: [
    { id: 'box1', tag: 'rect', cell: 'A1', color: 'red', cx: 25, cy: 25 },
    { id: 'box2', tag: 'rect', cell: 'B2', color: 'blue', cx: 75, cy: 75 },
  ],
};
const newMap = {
  grid: { cellW: 50, cellH: 50 },
  elements: [
    { id: 'box1', tag: 'rect', cell: 'A1', color: 'green', cx: 25, cy: 25 },
    { id: 'box2', tag: 'rect', cell: 'C3', color: 'blue', cx: 125, cy: 125 },
  ],
};

const diff = computeDiff(oldMap, newMap);
assert(
  'detects color change',
  diff.some((d) => d.type === 'FARBÄNDERUNG' && d.id === 'box1'),
);
assert(
  'detects move',
  diff.some((d) => d.type === 'VERSCHOBEN' && d.id === 'box2'),
);

console.log('\n--- DIFF: Form Mutation (F-TF-022 / D-005) ---');
// Sniper-Identität: circle#x → ellipse#x bei GLEICHER Zelle/Farbe war vorher
// ein leerer Diff (stille Mess-Lüge). Muss jetzt FORMÄNDERUNG melden.
const formOld = {
  grid: { cellW: 50, cellH: 50 },
  elements: [{ id: 'x', tag: 'circle', cell: 'A1', color: 'red', cx: 25, cy: 25 }],
};
const formNew = {
  grid: { cellW: 50, cellH: 50 },
  elements: [{ id: 'x', tag: 'ellipse', cell: 'A1', color: 'red', cx: 25, cy: 25 }],
};
const formDiff = computeDiff(formOld, formNew);
assert(
  'detects form mutation circle→ellipse (same cell/color)',
  formDiff.some(
    (d) =>
      d.type === 'FORMÄNDERUNG' &&
      d.id === 'x' &&
      d.from === 'circle' &&
      d.to === 'ellipse',
  ),
);
assert(
  'form mutation does NOT spuriously emit VERSCHOBEN/FARBÄNDERUNG',
  !formDiff.some((d) => d.type === 'VERSCHOBEN' || d.type === 'FARBÄNDERUNG'),
);

console.log('\n--- DIFF: Regression — same shape → no FORMÄNDERUNG ---');
// rect→rect (gleiche Form) darf KEIN FORMÄNDERUNG erzeugen; nur die echten
// Änderungen (VERSCHOBEN bei box2, FARBÄNDERUNG bei box1) bleiben unverändert.
const regressDiff = computeDiff(oldMap, newMap);
assert(
  'no FORMÄNDERUNG for unchanged tag (rect→rect)',
  !regressDiff.some((d) => d.type === 'FORMÄNDERUNG'),
);
assert(
  'VERSCHOBEN unchanged by fix',
  regressDiff.some((d) => d.type === 'VERSCHOBEN' && d.id === 'box2'),
);
assert(
  'FARBÄNDERUNG unchanged by fix',
  regressDiff.some((d) => d.type === 'FARBÄNDERUNG' && d.id === 'box1'),
);

console.log('\n--- DIFF: Combined form + cell change ---');
// Form UND Zelle ändern sich → beide Changes erwartet (keiner verschluckt).
const comboOld = {
  grid: { cellW: 50, cellH: 50 },
  elements: [{ id: 'y', tag: 'circle', cell: 'A1', color: 'red', cx: 25, cy: 25 }],
};
const comboNew = {
  grid: { cellW: 50, cellH: 50 },
  elements: [{ id: 'y', tag: 'rect', cell: 'B2', color: 'red', cx: 75, cy: 75 }],
};
const comboDiff = computeDiff(comboOld, comboNew);
assert(
  'combined: FORMÄNDERUNG present',
  comboDiff.some((d) => d.type === 'FORMÄNDERUNG' && d.id === 'y'),
);
assert(
  'combined: VERSCHOBEN present',
  comboDiff.some((d) => d.type === 'VERSCHOBEN' && d.id === 'y'),
);

console.log('\n--- DIFF: New + Removed Elements ---');
const newMap2 = {
  grid: { cellW: 50, cellH: 50 },
  elements: [
    { id: 'box1', tag: 'rect', cell: 'A1', color: 'red', cx: 25, cy: 25 },
    { id: 'box3', tag: 'circle', cell: 'D4', color: 'gold', cx: 175, cy: 175 },
  ],
};
const diff2 = computeDiff(oldMap, newMap2);
assert(
  'detects new element',
  diff2.some((d) => d.type === 'NEU' && d.id === 'box3'),
);
assert(
  'detects removed element',
  diff2.some((d) => d.type === 'ENTFERNT' && d.id === 'box2'),
);

console.log('\n--- ARBITRATE: Tri-State Buckets (P1-04) ---');
const constraintResults = [
  {
    pass: false,
    detail: 'Verfehlt Zentrum. Korrektur: dx=-24px',
    id: 'a',
    constraintType: 'CENTERED-IN',
  },
  { pass: true, detail: null, id: 'b', constraintType: 'INSIDE' },
];
const diffItems = [
  { type: 'VERSCHOBEN', id: 'a', from: 'A1', to: 'B2' },
  { type: 'NEU', id: 'c', cell: 'D4', color: 'gold' },
];
const arb = arbitrate(constraintResults, diffItems);
assert('totals.total = failing + unchecked + diff', arb.totals.total === 3);
assert('totals.failing_count = 1', arb.totals.failing_count === 1);
assert('totals.passing_count = 1', arb.totals.passing_count === 1);
assert('totals.unchecked_count = 0', arb.totals.unchecked_count === 0);
assert(
  'failing[0] is CONSTRAINT_FAIL',
  arb.failing[0].type === 'CONSTRAINT_FAIL',
);
assert(
  'diff sorted: VERSCHOBEN before NEU',
  arb.diff[0].type === 'VERSCHOBEN' && arb.diff[1].type === 'NEU',
);

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
