/**
 * test_constraints.js - EK-2 + EK-3: Constraint Verification
 * Tests constraint registry via checkConstraint
 * Vector Mirror v2.0
 */
import { checkConstraint } from '../../src/core/constraints/registry.js';
import '../../src/core/constraints/loader.js'; // Register all constraints

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

// --- EK-2: SPOTTER-LOGIK (Delta-Check) ---
console.log('--- EK-2: SPOTTER-LOGIK (CENTERED-IN) ---');
const sun = {
  id: 'sun',
  bbox: { x: 214, y: 100, w: 20, h: 20 },
  cx: 224,
  cy: 110,
  color: 'gold',
};
const bg = {
  id: 'bg',
  bbox: { x: 0, y: 0, w: 400, h: 200 },
  cx: 200,
  cy: 100,
  color: 'blue',
};
const grid = { cellW: 50, cellH: 50 };

const res1 = checkConstraint('CENTERED-IN', sun, bg, { grid });
assert('CENTERED-IN fails when off-center', res1.pass === false);
assert(
  'CENTERED-IN reports dx correction',
  res1.detail && res1.detail.includes('dx='),
);
console.log(`  Detail: ${res1.detail}`);

// --- EK-3: 5% TOLERANZ-REGEL ---
console.log('\n--- EK-3: 5% TOLERANZ-REGEL (SAME-SIZE) ---');
const ref = {
  id: 'ref',
  bbox: { x: 0, y: 0, w: 100, h: 100 },
  cx: 50,
  cy: 50,
  color: 'red',
};

// 4px deviation at 100px -> should PASS (5% = 5px)
const subj1 = {
  id: 's1',
  bbox: { x: 0, y: 0, w: 104, h: 104 },
  cx: 52,
  cy: 52,
  color: 'red',
};
const res2 = checkConstraint('SAME-SIZE', subj1, ref, { grid });
assert('4px at 100px (5%=5px) passes', res2.pass === true);

// 6px deviation -> should FAIL
const subj2 = {
  id: 's2',
  bbox: { x: 0, y: 0, w: 106, h: 106 },
  cx: 53,
  cy: 53,
  color: 'red',
};
const res3 = checkConstraint('SAME-SIZE', subj2, ref, { grid });
assert('6px at 100px (5%=5px) fails', res3.pass === false);
console.log(`  Detail: ${res3.detail}`);

// --- EK-4: WASSERWAAGE (ALIGNED-LEFT, 2px Limit) ---
console.log('\n--- EK-4: WASSERWAAGE (ALIGNED-LEFT) ---');
const bar = {
  id: 'bar',
  bbox: { x: 100, y: 100, w: 200, h: 20 },
  cx: 200,
  cy: 110,
  color: 'gray',
};
const item = {
  id: 'item',
  bbox: { x: 103, y: 150, w: 50, h: 50 },
  cx: 128,
  cy: 175,
  color: 'blue',
};
const res4 = checkConstraint('ALIGNED-LEFT', item, bar, { grid });
assert('3px offset at 2px limit fails', res4.pass === false);
console.log(`  Detail: ${res4.detail}`);

const itemOk = {
  id: 'item2',
  bbox: { x: 101, y: 150, w: 50, h: 50 },
  cx: 126,
  cy: 175,
  color: 'blue',
};
const res5 = checkConstraint('ALIGNED-LEFT', itemOk, bar, { grid });
assert('1px offset at 2px limit passes', res5.pass === true);

// --- NO-OVERLAP ---
console.log('\n--- NO-OVERLAP ---');
const a = {
  id: 'a',
  bbox: { x: 10, y: 10, w: 50, h: 50 },
  cx: 35,
  cy: 35,
  color: 'red',
};
const b = {
  id: 'b',
  bbox: { x: 40, y: 40, w: 50, h: 50 },
  cx: 65,
  cy: 65,
  color: 'blue',
};
const res6 = checkConstraint('NO-OVERLAP', a, b, { grid });
assert('overlapping boxes fail NO-OVERLAP', res6.pass === false);
console.log(`  Detail: ${res6.detail}`);

const c = {
  id: 'c',
  bbox: { x: 100, y: 100, w: 50, h: 50 },
  cx: 125,
  cy: 125,
  color: 'green',
};
const res7 = checkConstraint('NO-OVERLAP', a, c, { grid });
assert('non-overlapping boxes pass NO-OVERLAP', res7.pass === true);

// --- COLOR ---
console.log('\n--- COLOR ---');
const red = {
  id: 'r',
  bbox: { x: 0, y: 0, w: 10, h: 10 },
  cx: 5,
  cy: 5,
  color: 'red',
};
const res8 = checkConstraint('COLOR', red, null, { grid, value: 'red' });
assert('correct color passes', res8.pass === true);
const res9 = checkConstraint('COLOR', red, null, { grid, value: 'blue' });
assert('wrong color fails', res9.pass === false);

// --- LEFT-OF ---
console.log('\n--- LEFT-OF ---');
const leftBox = {
  id: 'l',
  bbox: { x: 10, y: 10, w: 20, h: 20 },
  cx: 20,
  cy: 20,
  color: 'red',
};
const rightBox = {
  id: 'r2',
  bbox: { x: 50, y: 10, w: 20, h: 20 },
  cx: 60,
  cy: 20,
  color: 'blue',
};
const res10 = checkConstraint('LEFT-OF', leftBox, rightBox, { grid });
assert('left box passes LEFT-OF', res10.pass === true);
const res11 = checkConstraint('LEFT-OF', rightBox, leftBox, { grid });
assert('right box fails LEFT-OF', res11.pass === false);

// --- ABOVE ---
console.log('\n--- ABOVE ---');
const topBox = {
  id: 't',
  bbox: { x: 10, y: 10, w: 20, h: 20 },
  cx: 20,
  cy: 20,
  color: 'red',
};
const bottomBox = {
  id: 'bot',
  bbox: { x: 10, y: 50, w: 20, h: 20 },
  cx: 20,
  cy: 60,
  color: 'blue',
};
const res12 = checkConstraint('ABOVE', topBox, bottomBox, { grid });
assert('top box passes ABOVE', res12.pass === true);
const res13 = checkConstraint('ABOVE', bottomBox, topBox, { grid });
assert('bottom box fails ABOVE', res13.pass === false);

// --- INSIDE ---
console.log('\n--- INSIDE ---');
const outer = {
  id: 'outer',
  bbox: { x: 0, y: 0, w: 200, h: 200 },
  cx: 100,
  cy: 100,
  color: 'white',
};
const inner = {
  id: 'inner',
  bbox: { x: 10, y: 10, w: 50, h: 50 },
  cx: 35,
  cy: 35,
  color: 'blue',
};
const res14 = checkConstraint('INSIDE', inner, outer, { grid });
assert('inner box passes INSIDE', res14.pass === true);
const outside = {
  id: 'out',
  bbox: { x: 190, y: 190, w: 50, h: 50 },
  cx: 215,
  cy: 215,
  color: 'red',
};
const res15 = checkConstraint('INSIDE', outside, outer, { grid });
assert('protruding box fails INSIDE', res15.pass === false);

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
