/**
 * test_pipeline_integration.js - Phase 2: Real Pipeline Integration Tests
 * Tests the ACTUAL chain: constraint.check() → arbitrate() → formatStructured()
 * NO hand-crafted mocks for arbitrated data — everything flows through real code.
 *
 * PURPOSE (P2 FIX):
 * Previous tests used mock arbitrated objects with dx/dy fields that never
 * existed in the real pipeline (arbitrate.js dropped them). After P1 fix,
 * this test PROVES the data actually flows end-to-end.
 *
 * MUTATION-TESTING DESIGN:
 * - Exact numeric values verified at each pipeline stage
 * - Tests FAIL if any stage drops fields (regression to P1 bug)
 * - Tests FAIL if division logic is wrong (regression to P4 bug)
 * - Tests FAIL if multi-axis fixes are missing (regression to P5 bug)
 */
import { checkConstraint } from '../../src/core/constraints/registry.js';
import '../../src/core/constraints/loader.js';
import { formatStructured as formatStructuredRaw } from '../../src/adapters/emitter/structured.js';
import { arbitrate } from '../../src/core/arbitrate.js';
import { gateCorrections } from '../../src/core/honesty.js';

// §E1: formatStructured verlangt jetzt gegatete failing-issues (_gated-Vertrag,
// fail-closed). Dieser Wrapper schleust arbitrated.failing durch die EINE
// Wahrheits-Quelle honesty.js#gateCorrections — exakt wie der Produktions-
// Caller pipeline.js — und ist fuer reliable-Elemente byte-identisch (Deltas
// bleiben). So testen wir den REALEN Emissions-Pfad, nicht einen Bypass.
function formatStructured(gridMap, arbitrated, opts) {
  const relById = new Map(
    (gridMap.elements || []).map((el) => [el.id, el.bbox_reliability]),
  );
  const gatedFailing = gateCorrections(arbitrated.failing || [], (id) =>
    relById.get(id),
  );
  return formatStructuredRaw(
    gridMap,
    { ...arbitrated, failing: gatedFailing },
    opts,
  );
}

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

function assertNotEqual(label, actual, forbidden) {
  if (actual !== forbidden) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(
      `  FAIL: ${label} — got forbidden value ${JSON.stringify(forbidden)}`,
    );
    failed++;
  }
}

// ── Realistic element data (as mapToGridMap would produce) ───
//
// §1.3 Auto-ID + F-SVG-007 Mock-Drift-Mit-Pflege (Sprint-β2 OD-β2-1 GO (a)):
// Die hardcoded ids 'star' / 'sky' / 'ground' / 'label' simulieren SVG-
// Elemente MIT expliziter id — diese werden vom Renderer 1:1 durchgereicht
// (kein Auto-ID-Format-Wechsel). bbox_reliability ist Pflichtfeld im
// elementSchema (§1.2b L-003); hier ergaenzt, damit der Mock dem Schema-
// Vertrag entspricht (verhindert Mock-Drift bei kuenftiger .strict()-
// Promotion).
const gridMap = {
  canvas: { width: 400, height: 300 },
  grid: { cols: 8, rows: 6, cellW: 50, cellH: 50 },
  elements: [
    {
      id: 'star',
      tag: 'circle',
      cell: 'D3',
      span: null,
      color: 'gold',
      stroke: 'transparent',
      opacity: 1,
      bbox: { x: 170, y: 110, w: 30, h: 30 },
      cx: 185,
      cy: 125,
      bbox_reliability: 'reliable',
    },
    {
      id: 'sky',
      tag: 'rect',
      cell: 'A1',
      span: 'A1-H6',
      color: 'navy',
      stroke: 'transparent',
      opacity: 1,
      bbox: { x: 0, y: 0, w: 400, h: 300 },
      cx: 200,
      cy: 150,
      bbox_reliability: 'reliable',
    },
    {
      id: 'ground',
      tag: 'rect',
      cell: 'A5',
      span: 'A5-H6',
      color: 'green',
      stroke: 'transparent',
      opacity: 1,
      bbox: { x: 0, y: 200, w: 400, h: 100 },
      cx: 200,
      cy: 250,
      bbox_reliability: 'reliable',
    },
    {
      id: 'label',
      tag: 'text',
      cell: 'C2',
      span: null,
      color: 'white',
      stroke: 'transparent',
      opacity: 1,
      bbox: { x: 100, y: 60, w: 80, h: 20 },
      cx: 140,
      cy: 70,
      bbox_reliability: 'reliable',
    },
  ],
};

// ── INTEGRATION TEST 1: CENTERED-IN (full chain, circle) ─────
// star is NOT centered in sky: star.center=(185,125), sky.center=(200,150)
// Expected dx = -(185-200) = 15, dy = -(125-150) = 25

console.log('--- INTEGRATION: CENTERED-IN (circle, full pipeline) ---');

const starEl = gridMap.elements[0];
const skyEl = gridMap.elements[1];
const groundEl = gridMap.elements[2];
const labelEl = gridMap.elements[3];
const ctx = { grid: gridMap.grid };

// Stage 1: constraint.check() returns numeric fields
const centeredResult = checkConstraint('CENTERED-IN', starEl, skyEl, ctx);
assertEqual('check: pass is false', centeredResult.pass, false);
assertEqual('check: dx is 15', centeredResult.dx, 15);
assertEqual('check: dy is 25', centeredResult.dy, 25);
assertNotEqual(
  'check: dx is not undefined (P1 regression)',
  centeredResult.dx,
  undefined,
);
assertNotEqual(
  'check: dy is not undefined (P1 regression)',
  centeredResult.dy,
  undefined,
);
assertEqual(
  'check: detail contains dx=15',
  centeredResult.detail.includes('dx=15'),
  true,
);

// Enrich like pipeline.js checkAllConstraints does
centeredResult.constraintType = 'CENTERED-IN';
centeredResult.reference = 'sky';
centeredResult.id = 'star';

// Stage 2: arbitrate() preserves ALL fields (P1 fix verification)
const arb = arbitrate([centeredResult], []);
assertEqual('arbitrate: 1 failing issue', arb.failing.length, 1);
const issue = arb.failing[0];
assertEqual(
  'arbitrate: type is CONSTRAINT_FAIL',
  issue.type,
  'CONSTRAINT_FAIL',
);
assertEqual('arbitrate: id is star', issue.id, 'star');
assertEqual(
  'arbitrate: constraintType is CENTERED-IN',
  issue.constraintType,
  'CENTERED-IN',
);
assertEqual('arbitrate: reference is sky', issue.reference, 'sky');
assertEqual('arbitrate: dx is 15 (not dropped!)', issue.dx, 15);
assertEqual('arbitrate: dy is 25 (not dropped!)', issue.dy, 25);
assertNotEqual(
  'arbitrate: dx not undefined (P1 regression guard)',
  issue.dx,
  undefined,
);
assertNotEqual(
  'arbitrate: dy not undefined (P1 regression guard)',
  issue.dy,
  undefined,
);

// Stage 3: formatStructured() produces corrections with fix objects
const structured = formatStructured(gridMap, arb);
assertEqual('structured: status is FAIL', structured.status, 'FAIL');
assertEqual('structured: 1 correction', structured.corrections.length, 1);
const corr = structured.corrections[0];
assertEqual('structured: element is #star', corr.element, '#star');
assertEqual(
  'structured: constraint is CENTERED-IN',
  corr.constraint,
  'CENTERED-IN',
);
assertEqual('structured: reference is #sky', corr.reference, '#sky');
assertEqual('structured: dx is 15', corr.dx, 15);
assertEqual('structured: dy is 25', corr.dy, 25);

// Fix object verification (P5: multi-axis)
assertEqual('structured: fix exists', corr.fix !== undefined, true);
assertEqual(
  'structured: fix.attribute is cx (circle)',
  corr.fix.attribute,
  'cx',
);
assertEqual(
  'structured: fix.current is "185" (star.cx)',
  corr.fix.current,
  '185',
);
assertEqual(
  'structured: fix.target is "200" (185 + 15)',
  corr.fix.target,
  '200',
);

// P5: Multi-axis fixes
assertEqual('structured: fixes array exists', Array.isArray(corr.fixes), true);
assertEqual('structured: fixes has 2 entries', corr.fixes.length, 2);
assertEqual(
  'structured: fixes[0].attribute is cx',
  corr.fixes[0].attribute,
  'cx',
);
assertEqual(
  'structured: fixes[1].attribute is cy',
  corr.fixes[1].attribute,
  'cy',
);
assertEqual(
  'structured: fixes[1].current is "125"',
  corr.fixes[1].current,
  '125',
);
assertEqual(
  'structured: fixes[1].target is "150" (125+25)',
  corr.fixes[1].target,
  '150',
);

// ── INTEGRATION TEST 2: ALIGNED-LEFT (rect, single axis) ─────
// ground.bbox.x=0, sky.bbox.x=0 → aligned (pass)
// But label.bbox.x=100, sky.bbox.x=0 → NOT aligned, dx = -(100-0) = -100

console.log('--- INTEGRATION: ALIGNED-LEFT (rect, single axis) ---');

const alignedResult = checkConstraint('ALIGNED-LEFT', labelEl, skyEl, ctx);
assertEqual('aligned: pass is false', alignedResult.pass, false);
assertEqual('aligned: dx is -100', alignedResult.dx, -100);
assertEqual('aligned: no dy field', alignedResult.dy, undefined);

// Enrich
alignedResult.constraintType = 'ALIGNED-LEFT';
alignedResult.reference = 'sky';
alignedResult.id = 'label';

const alignedArb = arbitrate([alignedResult], []);
assertEqual('aligned arb: dx preserved', alignedArb.failing[0].dx, -100);
assertEqual('aligned arb: dy not present', alignedArb.failing[0].dy, undefined);

const alignedStruct = formatStructured(gridMap, alignedArb);
const alignedCorr = alignedStruct.corrections[0];
assertEqual(
  'aligned struct: fix.attribute is x (text tag)',
  alignedCorr.fix.attribute,
  'x',
);
assertEqual(
  'aligned struct: fix.current is "100" (bbox.x)',
  alignedCorr.fix.current,
  '100',
);
assertEqual(
  'aligned struct: fix.target is "0" (100+(-100))',
  alignedCorr.fix.target,
  '0',
);
// P5: Single axis → no fixes array
assertEqual(
  'aligned struct: no fixes array (single axis)',
  alignedCorr.fixes,
  undefined,
);

// ── INTEGRATION TEST 3: SAME-SIZE (circle dw/dh → r with div 2) ─
// star bbox.w=30, sky bbox.w=400 → dw = -(30-400) = 370
// circle: current r = 30/2 = 15, delta r = 370/2 = 185, target r = 15+185 = 200

console.log('--- INTEGRATION: SAME-SIZE (circle, div 2 for r) ---');

const sizeResult = checkConstraint('SAME-SIZE', starEl, skyEl, ctx);
assertEqual('size: pass is false', sizeResult.pass, false);
assertEqual('size: dw is 370', sizeResult.dw, 370);
assertEqual('size: dh is 270', sizeResult.dh, 270);

sizeResult.constraintType = 'SAME-SIZE';
sizeResult.reference = 'sky';
sizeResult.id = 'star';

const sizeArb = arbitrate([sizeResult], []);
assertEqual('size arb: dw is 370', sizeArb.failing[0].dw, 370);
assertEqual('size arb: dh is 270', sizeArb.failing[0].dh, 270);

const sizeStruct = formatStructured(gridMap, sizeArb);
const sizeCorr = sizeStruct.corrections[0];

// P4: circle dw → r with div 2
assertEqual('size struct: fix.attribute is r', sizeCorr.fix.attribute, 'r');
assertEqual(
  'size struct: fix.current is "15" (30/2)',
  sizeCorr.fix.current,
  '15',
);
assertEqual(
  'size struct: fix.target is "200" (15 + 370/2)',
  sizeCorr.fix.target,
  '200',
);
assertNotEqual(
  'P4 canary: target is NOT "385" (no div would give 15+370)',
  sizeCorr.fix.target,
  '385',
);

// P5: Multi-axis fixes for dw + dh
assertEqual(
  'size struct: fixes array exists',
  Array.isArray(sizeCorr.fixes),
  true,
);
assertEqual('size struct: fixes has 2 entries', sizeCorr.fixes.length, 2);
assertEqual(
  'size struct: fixes[0] is r (dw)',
  sizeCorr.fixes[0].attribute,
  'r',
);
assertEqual(
  'size struct: fixes[1] is r (dh)',
  sizeCorr.fixes[1].attribute,
  'r',
);
assertEqual(
  'size struct: fixes[1].current is "15" (30/2)',
  sizeCorr.fixes[1].current,
  '15',
);
assertEqual(
  'size struct: fixes[1].target is "150" (15 + 270/2)',
  sizeCorr.fixes[1].target,
  '150',
);

// ── INTEGRATION TEST 4: SAME-SIZE (rect — NO div 2) ─────────
// ground bbox.w=400, sky bbox.w=400 → pass (same)
// Use ground vs star: ground is rect, ground.w=400, star.w=30 → not realistic
// Better: use dedicated rect element comparison
// ground (rect, w=400,h=100) vs sky (rect, w=400,h=300): h differs → dh = -(100-300) = 200

console.log('--- INTEGRATION: SAME-SIZE (rect, no div 2) ---');

const rectSizeResult = checkConstraint('SAME-SIZE', groundEl, skyEl, ctx);
assertEqual('rect size: pass is false', rectSizeResult.pass, false);
// ground.w=400, sky.w=400 → dw=0, ground.h=100, sky.h=300 → dh=-(100-300)=200
assertEqual('rect size: dh is 200', rectSizeResult.dh, 200);

rectSizeResult.constraintType = 'SAME-SIZE';
rectSizeResult.reference = 'sky';
rectSizeResult.id = 'ground';

const rectSizeArb = arbitrate([rectSizeResult], []);
const rectSizeStruct = formatStructured(gridMap, rectSizeArb);
const rectSizeCorr = rectSizeStruct.corrections[0];

// rect: NO div 2 — dh maps to 'height' for rect
assertEqual(
  'rect size: fix.attribute is height',
  rectSizeCorr.fix.attribute,
  'height',
);
assertEqual(
  'rect size: fix.current is "100" (ground.bbox.h)',
  rectSizeCorr.fix.current,
  '100',
);
assertEqual(
  'rect size: fix.target is "300" (100+200)',
  rectSizeCorr.fix.target,
  '300',
);
assertNotEqual(
  'rect P4 canary: target NOT "200" (div 2 would give 100+200/2=200)',
  rectSizeCorr.fix.target,
  '200',
);

// ── INTEGRATION TEST 5: NO-OVERLAP (dynamic axis) ───────────
// star overlaps sky (star is inside sky)
// NO-OVERLAP computes shortest escape vector

console.log('--- INTEGRATION: NO-OVERLAP (dynamic axis selection) ---');

const overlapResult = checkConstraint('NO-OVERLAP', starEl, skyEl, ctx);
assertEqual('overlap: pass is false', overlapResult.pass, false);
// Should have exactly ONE of dx or dy (the shortest escape)
const hasDx = overlapResult.dx !== undefined;
const hasDy = overlapResult.dy !== undefined;
assertEqual('overlap: has at least one delta', hasDx || hasDy, true);

overlapResult.constraintType = 'NO-OVERLAP';
overlapResult.reference = 'sky';
overlapResult.id = 'star';

const overlapArb = arbitrate([overlapResult], []);
const overlapIssue = overlapArb.failing[0];
// Verify arbitrate preserved the dynamic field
if (hasDx) {
  assertEqual('overlap arb: dx preserved', overlapIssue.dx, overlapResult.dx);
} else {
  assertEqual('overlap arb: dy preserved', overlapIssue.dy, overlapResult.dy);
}

const overlapStruct = formatStructured(gridMap, overlapArb);
assertEqual(
  'overlap struct: 1 correction',
  overlapStruct.corrections.length,
  1,
);
assertEqual(
  'overlap struct: fix exists',
  overlapStruct.corrections[0].fix !== undefined,
  true,
);

// ── INTEGRATION TEST 6: INSIDE (conditional dx/dy) ──────────
// star is inside sky → pass
// But if we test label vs ground: label.bbox is (100,60,80,20), ground is (0,200,400,100)
// label top (60) is above ground top (200) → dy = 200 - 60 = 140
// label left (100) is inside ground left-right (0-400) → dx = 0

console.log('--- INTEGRATION: INSIDE (conditional deltas) ---');

const insideResult = checkConstraint('INSIDE', labelEl, groundEl, ctx);
assertEqual(
  'inside: pass is false (label above ground)',
  insideResult.pass,
  false,
);
assertEqual('inside: dy is 140 (needs to move down)', insideResult.dy, 140);
// dx should NOT be present since label.x (100) >= ground.x (0) and label.x+w (180) <= ground.x+w (400)
assertEqual('inside: no dx (horizontally fine)', insideResult.dx, undefined);

insideResult.constraintType = 'INSIDE';
insideResult.reference = 'ground';
insideResult.id = 'label';

const insideArb = arbitrate([insideResult], []);
assertEqual('inside arb: dy preserved', insideArb.failing[0].dy, 140);
assertEqual('inside arb: no dx', insideArb.failing[0].dx, undefined);

const insideStruct = formatStructured(gridMap, insideArb);
const insideCorr = insideStruct.corrections[0];
assertEqual(
  'inside struct: fix is y (text tag dy)',
  insideCorr.fix.attribute,
  'y',
);
assertEqual(
  'inside struct: no fixes array (single axis)',
  insideCorr.fixes,
  undefined,
);

// ── INTEGRATION TEST 7: PASS case (constraint satisfied) ─────
// ground is inside sky → pass, no issues

console.log('--- INTEGRATION: PASS case (no issues) ---');

const passResult = checkConstraint('INSIDE', groundEl, skyEl, ctx);
assertEqual('pass: pass is true', passResult.pass, true);
assertEqual('pass: no dx', passResult.dx, undefined);
assertEqual('pass: no dy', passResult.dy, undefined);

// Full pipeline: pass=true → passing[], NOT failing[]
const passArb = arbitrate([passResult], []);
assertEqual(
  'pass arb: 0 failing (pass=true → passing)',
  passArb.failing.length,
  0,
);
assertEqual('pass arb: 1 passing entry', passArb.passing.length, 1);

const passStruct = formatStructured(gridMap, passArb);
assertEqual('pass struct: status PASS', passStruct.status, 'PASS');
assertEqual('pass struct: 0 corrections', passStruct.corrections.length, 0);
assertEqual(
  'pass struct: convergence SOLVED',
  passStruct.iteration.convergence,
  'SOLVED',
);

// ── INTEGRATION TEST 8: Mixed issues + diff ──────────────────
// Multiple constraints + diff entries through single arbitrate call

console.log('--- INTEGRATION: Mixed constraints + diff ---');

const centeredResult2 = checkConstraint('CENTERED-IN', starEl, skyEl, ctx);
centeredResult2.constraintType = 'CENTERED-IN';
centeredResult2.reference = 'sky';
centeredResult2.id = 'star';

const alignedResult2 = checkConstraint('ALIGNED-LEFT', labelEl, skyEl, ctx);
alignedResult2.constraintType = 'ALIGNED-LEFT';
alignedResult2.reference = 'sky';
alignedResult2.id = 'label';

const diff = [
  { type: 'VERSCHOBEN', id: 'ground', from: 'A5', to: 'A4' },
  { type: 'FARBÄNDERUNG', id: 'sky', detail: 'navy -> blue' },
];

// P1-04: no cap in validator. All entries flow through; failing and diff are separate buckets.
const mixedArb = arbitrate([centeredResult2, alignedResult2], diff);
assertEqual('mixed: totals.total is 4', mixedArb.totals.total, 4);
assertEqual('mixed: failing_count is 2', mixedArb.totals.failing_count, 2);
assertEqual('mixed: diff_count is 2', mixedArb.totals.diff_count, 2);
assertEqual('mixed: failing array length 2', mixedArb.failing.length, 2);
assertEqual('mixed: diff array length 2 (no cap)', mixedArb.diff.length, 2);

// failing[] is CONSTRAINT_FAIL only; diff[] is severity-sorted (VERSCHOBEN before FARBÄNDERUNG)
assertEqual(
  'mixed: failing[0] is CONSTRAINT_FAIL',
  mixedArb.failing[0].type,
  'CONSTRAINT_FAIL',
);
assertEqual(
  'mixed: failing[1] is CONSTRAINT_FAIL',
  mixedArb.failing[1].type,
  'CONSTRAINT_FAIL',
);
assertEqual(
  'mixed: diff[0] is VERSCHOBEN (severity 1)',
  mixedArb.diff[0].type,
  'VERSCHOBEN',
);
assertEqual(
  'mixed: diff[1] is FARBÄNDERUNG (severity 2)',
  mixedArb.diff[1].type,
  'FARBÄNDERUNG',
);

const mixedStruct = formatStructured(gridMap, mixedArb);
assertEqual('mixed struct: status FAIL', mixedStruct.status, 'FAIL');
assertEqual('mixed struct: 2 corrections', mixedStruct.corrections.length, 2);
assertEqual(
  'mixed struct: 2 diff entries (no cap)',
  mixedStruct.diff.length,
  2,
);
assertEqual(
  'mixed struct: first correction has dx',
  mixedStruct.corrections[0].dx,
  15,
);
assertEqual(
  'mixed struct: total_issues = failing + unchecked',
  mixedStruct.iteration.total_issues,
  2,
);

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
