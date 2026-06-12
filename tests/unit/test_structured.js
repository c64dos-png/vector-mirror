/**
 * test_structured.js - Phase 2: Structured Emitter Tests (Mutation-Resilient)
 * Tests formatStructured, formatInspectStructured, formatPaletteStructured
 * BAUPLAN ref: Sektion 10.4 (structuredContent Schema), 10.5 (Convergence), 10.6 (Tag-Mapping)
 *
 * MUTATION-TESTING DESIGN:
 * - Every assert checks EXACT values, not just truthiness
 * - Anti-mutation canaries: verify wrong values are NOT produced
 * - Boundary tests: exact threshold values for convergence logic
 * - Tag-Mapping coverage: circle, rect, text, ellipse (BAUPLAN 10.6)
 * - Fix-Object: verify current/target math, not just existence
 */
import {
  formatInspectStructured,
  formatPaletteStructured,
  formatStructured as formatStructuredRaw,
} from '../../src/adapters/emitter/structured.js';
import { gateCorrections } from '../../src/core/honesty.js';

// §E1: formatStructured verlangt gegatete failing-issues (_gated-Vertrag,
// fail-closed). Wrapper schleust arbitrated.failing durch honesty.js#gate-
// Corrections — exakt wie der Produktions-Caller pipeline.js. Fuer reliable-
// Elemente byte-identisch (Deltas bleiben); so testet die Suite den REALEN
// Emissions-Pfad, kein Bypass. (D-006-Suppression bei not_measurable/
// approximate ist separat in test_honesty_live.js abgedeckt.)
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

function assertDeepEqual(label, actual, expected) {
  const a = JSON.stringify(actual),
    b = JSON.stringify(expected);
  if (a === b) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}\n    got:      ${a}\n    expected: ${b}`);
    failed++;
  }
}

// ── Mock Data ───────────────────────────────────────────────

// §1.3 Auto-ID + F-SVG-007 Mock-Drift-Mit-Pflege (Sprint-β2 OD-β2-1 GO (a)):
// Die hardcoded ids 'sun' / 'bg' simulieren SVG-Elemente MIT expliziter id
// — diese werden vom Renderer 1:1 durchgereicht (kein Auto-ID-Format-Wechsel
// fuer diese Mocks). bbox_reliability ist seit §1.2b L-003 Pflichtfeld im
// elementSchema und wird hier zur Mock-Schema-Treue ergaenzt.
const mockGridMap = {
  canvas: { width: 400, height: 200 },
  grid: { cellsX: 8, cellsY: 4, cellW: 50, cellH: 50 },
  elements: [
    {
      id: 'sun',
      tag: 'circle',
      cell: 'E2',
      span: null,
      color: 'gold',
      stroke: 'transparent',
      opacity: 1,
      bbox: { x: 190, y: 90, w: 20, h: 20 },
      cx: 200,
      cy: 100,
      bbox_reliability: 'reliable',
    },
    {
      id: 'bg',
      tag: 'rect',
      cell: 'A1',
      span: 'A1-H4',
      color: 'blue',
      stroke: 'transparent',
      opacity: 1,
      bbox: { x: 0, y: 0, w: 400, h: 200 },
      cx: 200,
      cy: 100,
      bbox_reliability: 'reliable',
    },
  ],
};

const cleanArbitrated = {
  passing: [],
  failing: [],
  unchecked: [],
  diff: [],
  totals: {
    total: 0,
    passing_count: 0,
    failing_count: 0,
    unchecked_count: 0,
    diff_count: 0,
  },
};

const failArbitrated = {
  passing: [],
  failing: [
    {
      type: 'CONSTRAINT_FAIL',
      severity: 0,
      id: 'sun',
      constraintType: 'CENTERED-IN',
      reference: 'bg',
      detail: 'Verfehlt Zentrum',
      dx: -24,
      dy: -10,
    },
  ],
  unchecked: [],
  diff: [{ type: 'VERSCHOBEN', severity: 1, id: 'bg', from: 'A1', to: 'B2' }],
  totals: {
    total: 2,
    passing_count: 0,
    failing_count: 1,
    unchecked_count: 0,
    diff_count: 1,
  },
};

// ── formatStructured: PASS case ─────────────────────────────

console.log('--- STRUCTURED: Clean (PASS) ---');
const clean = formatStructured(mockGridMap, cleanArbitrated);
assertEqual('status is exactly PASS', clean.status, 'PASS');
assertNotEqual('status is NOT FAIL', clean.status, 'FAIL');
assertEqual('iteration.sequence is 1 (no prev)', clean.iteration.sequence, 1);
assertEqual('iteration.current_issues is 0', clean.iteration.current_issues, 0);
assertEqual(
  'iteration.previous_issues is 0 (default)',
  clean.iteration.previous_issues,
  0,
);
assertEqual(
  'iteration.convergence is SOLVED',
  clean.iteration.convergence,
  'SOLVED',
);
assertEqual('scene.width exact', clean.scene.width, 400);
assertEqual('scene.height exact', clean.scene.height, 200);
assertEqual('scene.grid format COLSxROWS', clean.scene.grid, '8x4');
assertEqual('scene element count', clean.scene.elements.length, 2);
assertEqual('corrections array empty', clean.corrections.length, 0);
assertEqual('diff array empty', clean.diff.length, 0);

// Anti-mutation: PASS must NOT produce corrections
assertEqual('CANARY: PASS has zero corrections', clean.corrections.length, 0);
assertEqual(
  'CANARY: scene.grid is not 4x8 (swapped)',
  clean.scene.grid !== '4x8',
  true,
);

// ── formatStructured: FAIL case ─────────────────────────────

console.log('--- STRUCTURED: With Failures (FAIL) ---');
const fail = formatStructured(mockGridMap, failArbitrated);
assertEqual('status is exactly FAIL', fail.status, 'FAIL');
assertNotEqual('status is NOT PASS', fail.status, 'PASS');
assertEqual(
  'exactly 1 correction (only CONSTRAINT_FAIL)',
  fail.corrections.length,
  1,
);
assertEqual(
  'correction element has # prefix',
  fail.corrections[0].element,
  '#sun',
);
assertNotEqual(
  'correction element not bare id',
  fail.corrections[0].element,
  'sun',
);
assertEqual(
  'correction constraint type',
  fail.corrections[0].constraint,
  'CENTERED-IN',
);
assertEqual(
  'correction reference has # prefix',
  fail.corrections[0].reference,
  '#bg',
);
assertNotEqual(
  'correction reference not bare id',
  fail.corrections[0].reference,
  'bg',
);
assertEqual('correction dx exact value', fail.corrections[0].dx, -24);
assertEqual('correction dy exact value', fail.corrections[0].dy, -10);
assertNotEqual(
  'dx is not positive (sign matters)',
  fail.corrections[0].dx > 0,
  true,
);

// Fix object: verify math (BAUPLAN 10.6 Tag-Mapping)
// P5: CENTERED-IN has dx AND dy, so fix = first axis (cx), fixes = both axes
assertEqual('fix exists', fail.corrections[0].fix !== undefined, true);
assertEqual(
  'fix.attribute is cx (circle tag mapping)',
  fail.corrections[0].fix.attribute,
  'cx',
);
assertNotEqual(
  'fix.attribute is NOT x (that would be rect)',
  fail.corrections[0].fix.attribute,
  'x',
);
assertEqual(
  'fix.current is "200" (sun.cx)',
  fail.corrections[0].fix.current,
  '200',
);
assertEqual(
  'fix.target is "176" (200 + (-24))',
  fail.corrections[0].fix.target,
  '176',
);

// P5: Multi-axis fixes array for CENTERED-IN (dx + dy)
assertEqual(
  'fixes array exists',
  Array.isArray(fail.corrections[0].fixes),
  true,
);
assertEqual(
  'fixes has 2 entries (dx + dy)',
  fail.corrections[0].fixes.length,
  2,
);
assertEqual('fixes[0] is cx', fail.corrections[0].fixes[0].attribute, 'cx');
assertEqual('fixes[0].current', fail.corrections[0].fixes[0].current, '200');
assertEqual('fixes[0].target', fail.corrections[0].fixes[0].target, '176');
assertEqual('fixes[1] is cy', fail.corrections[0].fixes[1].attribute, 'cy');
assertEqual('fixes[1].current', fail.corrections[0].fixes[1].current, '100');
assertEqual(
  'fixes[1].target is "90" (100 + (-10))',
  fail.corrections[0].fixes[1].target,
  '90',
);

// Diff: non-CONSTRAINT_FAIL entries go to diff, not corrections
assertEqual('exactly 1 diff entry', fail.diff.length, 1);
assertEqual('diff type is VERSCHOBEN', fail.diff[0].type, 'VERSCHOBEN');
assertEqual('diff id is bg', fail.diff[0].id, 'bg');
assertEqual('diff from is A1', fail.diff[0].from, 'A1');
assertEqual('diff to is B2', fail.diff[0].to, 'B2');

// ── formatStructured: Convergence (BAUPLAN 10.5) ────────────
// Tests all 4 states + boundary conditions to kill mutations in comparisons

console.log('--- STRUCTURED: Convergence (all 4 states) ---');

// IMPROVING: previous > current (3 > 1)
const improving = formatStructured(mockGridMap, failArbitrated, {
  previousIssueCount: 3,
});
assertEqual('IMPROVING: 3->1', improving.iteration.convergence, 'IMPROVING');
assertEqual('IMPROVING: sequence=2', improving.iteration.sequence, 2);
assertEqual(
  'IMPROVING: previous_issues=3',
  improving.iteration.previous_issues,
  3,
);
assertEqual(
  'IMPROVING: current_issues=1',
  improving.iteration.current_issues,
  1,
);

// STAGNATING: previous === current (1 === 1) — boundary: exact equality
const stagnating = formatStructured(mockGridMap, failArbitrated, {
  previousIssueCount: 1,
});
assertEqual('STAGNATING: 1->1', stagnating.iteration.convergence, 'STAGNATING');
assertNotEqual(
  'STAGNATING is NOT IMPROVING',
  stagnating.iteration.convergence,
  'IMPROVING',
);

// DIVERGING: previous < current (0 < 1) — boundary: zero to nonzero
const diverging = formatStructured(mockGridMap, failArbitrated, {
  previousIssueCount: 0,
});
assertEqual('DIVERGING: 0->1', diverging.iteration.convergence, 'DIVERGING');
assertNotEqual(
  'DIVERGING is NOT STAGNATING',
  diverging.iteration.convergence,
  'STAGNATING',
);

// SOLVED: current === 0 (regardless of previous) — must win over all others
const solved = formatStructured(mockGridMap, cleanArbitrated, {
  previousIssueCount: 2,
});
assertEqual('SOLVED: 2->0', solved.iteration.convergence, 'SOLVED');

// SOLVED even when previous was also 0 (0->0 = SOLVED, not STAGNATING)
const solvedFromZero = formatStructured(mockGridMap, cleanArbitrated, {
  previousIssueCount: 0,
});
assertEqual(
  'SOLVED: 0->0 (SOLVED beats STAGNATING)',
  solvedFromZero.iteration.convergence,
  'SOLVED',
);

// No previousIssueCount: sequence=1, convergence depends on current only.
// §H9 K-12 (Rekalibrierung auf die wahre Form): ohne Historie ist KEINE
// Trend-Behauptung erlaubt — Erstlauf mit Issues meldet BASELINE, nicht
// das frühere STAGNATING (Trend-Lüge ohne zweiten Messpunkt).
const noPrev = formatStructured(mockGridMap, failArbitrated);
assertEqual('no prev: sequence=1', noPrev.iteration.sequence, 1);
assertEqual(
  'no prev with issues: BASELINE (keine Trend-Behauptung)',
  noPrev.iteration.convergence,
  'BASELINE',
);

const noPrevClean = formatStructured(mockGridMap, cleanArbitrated);
assertEqual(
  'no prev, no issues: SOLVED',
  noPrevClean.iteration.convergence,
  'SOLVED',
);

// ── §1.6 KONVERGENZ-EHRLICHKEIT: Failing→Unchecked ist nie IMPROVING ──
// Epistemischer Vertrag: Konvergenz auf totalIssues = failing + unchecked.
// Ein Übergang Failing→Unchecked senkt failingCount, aber totalIssues bleibt —
// der Constraint wurde nicht gelöst, nur blind (not_measurable / Element weg).
// IMPROVING hier wäre eine Fortschritts-Lüge an den LLM.
console.log('--- STRUCTURED: §1.6 Convergence Honesty (failing→unchecked) ---');

// Vorzustand aller drei Übergänge: 1 Failing → totalIssues(prev) = 1.
const PREV_TOTAL_ONE = 1;

// blindArb: der Constraint ist von failing nach unchecked gewandert
// (1 unchecked, 0 failing) → totalIssues = 1.
const blindArb = {
  passing: [],
  failing: [],
  unchecked: [
    {
      id: 'sun',
      constraintType: 'CENTERED-IN',
      reasonCategory: 'MEASUREMENT',
      reasonCode: 'BBOX_NOT_MEASURABLE',
      hint: 'BBox des Elements konnte nicht zuverlässig gemessen werden.',
    },
  ],
  diff: [],
  totals: {
    total: 1,
    passing_count: 0,
    failing_count: 0,
    unchecked_count: 1,
    diff_count: 0,
  },
};

// Stop-Condition 1: 1 Failing → 1 Unchecked → STAGNATING (totalIssues 1→1).
const failToUnchecked = formatStructured(mockGridMap, blindArb, {
  previousIssueCount: PREV_TOTAL_ONE,
});
assertEqual(
  '§1.6 [1] 1 Failing → 1 Unchecked: convergence STAGNATING',
  failToUnchecked.iteration.convergence,
  'STAGNATING',
);
assertNotEqual(
  '§1.6 [1] Failing→Unchecked is NOT IMPROVING (no progress-lie)',
  failToUnchecked.iteration.convergence,
  'IMPROVING',
);
assertEqual(
  '§1.6 [1] current_issues counts the unchecked (totalIssues=1)',
  failToUnchecked.iteration.current_issues,
  1,
);
assertEqual(
  '§1.6 [1] total_issues = failing + unchecked = 1',
  failToUnchecked.iteration.total_issues,
  1,
);

// Stop-Condition 2: 1 Failing → 0 Failing + 0 Unchecked → SOLVED.
const failToClean = formatStructured(mockGridMap, cleanArbitrated, {
  previousIssueCount: PREV_TOTAL_ONE,
});
assertEqual(
  '§1.6 [2] 1 Failing → 0/0: convergence SOLVED',
  failToClean.iteration.convergence,
  'SOLVED',
);
assertEqual(
  '§1.6 [2] current_issues = 0 (genuinely solved)',
  failToClean.iteration.current_issues,
  0,
);

// Stop-Condition 3: 1 Failing → 0 Failing + 1 Unchecked → STAGNATING, NICHT
// IMPROVING. Der namensgebende "Pipeline-blind"-Fall: failingCount sank 1→0,
// totalIssues blieb 1. Alte Logik (auf failingCount) hätte IMPROVING gelogen.
const failToZeroFailButUnchecked = formatStructured(mockGridMap, blindArb, {
  previousIssueCount: PREV_TOTAL_ONE,
});
assertEqual(
  '§1.6 [3] 1 Failing → 0 Failing + 1 Unchecked: STAGNATING',
  failToZeroFailButUnchecked.iteration.convergence,
  'STAGNATING',
);
assertNotEqual(
  '§1.6 [3] NOT IMPROVING — failingCount sank, but pipeline went blind',
  failToZeroFailButUnchecked.iteration.convergence,
  'IMPROVING',
);

// Mutation-Killer: der Vergleich ist GENUINE totalIssues, kein hardcoded ===.
// 1 Failing → 2 Unchecked (totalIssues 1→2) muss DIVERGING ergeben, nicht
// STAGNATING — beweist, dass unchecked echt in den Vergleichswert eingeht.
const divergeBlindArb = {
  passing: [],
  failing: [],
  unchecked: [
    { ...blindArb.unchecked[0], id: 'sun' },
    { ...blindArb.unchecked[0], id: 'bg' },
  ],
  diff: [],
  totals: {
    total: 2,
    passing_count: 0,
    failing_count: 0,
    unchecked_count: 2,
    diff_count: 0,
  },
};
const failToTwoUnchecked = formatStructured(mockGridMap, divergeBlindArb, {
  previousIssueCount: PREV_TOTAL_ONE,
});
assertEqual(
  '§1.6 [canary] 1 Failing → 2 Unchecked: DIVERGING (totalIssues 1→2)',
  failToTwoUnchecked.iteration.convergence,
  'DIVERGING',
);
assertNotEqual(
  '§1.6 [canary] DIVERGING is NOT IMPROVING',
  failToTwoUnchecked.iteration.convergence,
  'IMPROVING',
);

// ── formatStructured: Element status tri-state ──────────────

console.log('--- STRUCTURED: Element Status Tri-State ---');
// fail: CONSTRAINT_FAIL -> 'fail'
assertEqual(
  'CONSTRAINT_FAIL -> status fail',
  fail.scene.elements.find((e) => e.id === 'sun').status,
  'fail',
);
assertNotEqual(
  'not ok',
  fail.scene.elements.find((e) => e.id === 'sun').status,
  'ok',
);
assertNotEqual(
  'not warn',
  fail.scene.elements.find((e) => e.id === 'sun').status,
  'warn',
);

// warn: non-CONSTRAINT_FAIL issue -> 'warn'
assertEqual(
  'VERSCHOBEN -> status warn',
  fail.scene.elements.find((e) => e.id === 'bg').status,
  'warn',
);
assertNotEqual(
  'not ok',
  fail.scene.elements.find((e) => e.id === 'bg').status,
  'ok',
);
assertNotEqual(
  'not fail',
  fail.scene.elements.find((e) => e.id === 'bg').status,
  'fail',
);

// ok: no issue -> 'ok'
assertEqual(
  'no issue -> status ok',
  clean.scene.elements.find((e) => e.id === 'sun').status,
  'ok',
);
assertEqual(
  'no issue -> status ok (bg)',
  clean.scene.elements.find((e) => e.id === 'bg').status,
  'ok',
);

// ── Tag-Mapping: buildFix for different tags (BAUPLAN 10.6) ─

console.log('--- STRUCTURED: Tag-Mapping (BAUPLAN 10.6) ---');

// rect tag: dx -> 'x', dy -> 'y', dw -> 'width', dh -> 'height'
// §1.3 / F-SVG-007: rect-spezifischer Tag-Mapping-Mock, hardcoded ids
// 'box' / 'ref' simulieren explizite id-Attribute (1:1 vom Renderer
// durchgereicht). bbox_reliability ergaenzt fuer Schema-Treue.
const rectGridMap = {
  canvas: { width: 400, height: 200 },
  grid: { cellsX: 8, cellsY: 4, cellW: 50, cellH: 50 },
  elements: [
    {
      id: 'box',
      tag: 'rect',
      cell: 'A1',
      span: null,
      color: 'red',
      stroke: 'transparent',
      opacity: 1,
      bbox: { x: 10, y: 20, w: 100, h: 50 },
      cx: 60,
      cy: 45,
      bbox_reliability: 'reliable',
    },
    {
      id: 'ref',
      tag: 'rect',
      cell: 'D3',
      span: null,
      color: 'blue',
      stroke: 'transparent',
      opacity: 1,
      bbox: { x: 150, y: 100, w: 100, h: 50 },
      cx: 200,
      cy: 125,
      bbox_reliability: 'reliable',
    },
  ],
};
const rectFailArb = {
  passing: [],
  failing: [
    {
      type: 'CONSTRAINT_FAIL',
      severity: 0,
      id: 'box',
      constraintType: 'ALIGNED-LEFT',
      reference: 'ref',
      detail: 'Nicht buendig',
      dx: 15,
    },
  ],
  unchecked: [],
  diff: [],
  totals: {
    total: 1,
    passing_count: 0,
    failing_count: 1,
    unchecked_count: 0,
    diff_count: 0,
  },
};
const rectResult = formatStructured(rectGridMap, rectFailArb);
assertEqual(
  'rect: fix.attribute is x (not cx)',
  rectResult.corrections[0].fix.attribute,
  'x',
);
assertEqual(
  'rect: fix.current is "10" (bbox.x)',
  rectResult.corrections[0].fix.current,
  '10',
);
assertEqual(
  'rect: fix.target is "25" (10+15)',
  rectResult.corrections[0].fix.target,
  '25',
);
// P5: Single-axis has fix but NO fixes array
assertEqual(
  'rect single-axis: no fixes array',
  rectResult.corrections[0].fixes,
  undefined,
);

// dw on rect -> 'width'
const rectDwArb = {
  passing: [],
  failing: [
    {
      type: 'CONSTRAINT_FAIL',
      severity: 0,
      id: 'box',
      constraintType: 'SAME-SIZE',
      reference: 'ref',
      detail: 'Groesse weicht ab',
      dw: -20,
    },
  ],
  unchecked: [],
  diff: [],
  totals: {
    total: 1,
    passing_count: 0,
    failing_count: 1,
    unchecked_count: 0,
    diff_count: 0,
  },
};
const rectDwResult = formatStructured(rectGridMap, rectDwArb);
assertEqual(
  'rect dw: fix.attribute is width',
  rectDwResult.corrections[0].fix.attribute,
  'width',
);
assertEqual(
  'rect dw: fix.current is "100" (bbox.w)',
  rectDwResult.corrections[0].fix.current,
  '100',
);
assertEqual(
  'rect dw: fix.target is "80" (100+(-20))',
  rectDwResult.corrections[0].fix.target,
  '80',
);

// circle tag: dx -> 'cx' (already tested above with sun), dw -> 'r'
// P4: circle dw/dh maps to r with div 2 (Bauplan 10.6: diameter -> radius)
// sun bbox.w=20 -> current r = 20/2 = 10, dw=10 -> target r = 10 + 10/2 = 15
const circleDwArb = {
  passing: [],
  failing: [
    {
      type: 'CONSTRAINT_FAIL',
      severity: 0,
      id: 'sun',
      constraintType: 'SAME-SIZE',
      reference: 'bg',
      detail: 'Groesse weicht ab',
      dw: 10,
    },
  ],
  unchecked: [],
  diff: [],
  totals: {
    total: 1,
    passing_count: 0,
    failing_count: 1,
    unchecked_count: 0,
    diff_count: 0,
  },
};
const circleDwResult = formatStructured(mockGridMap, circleDwArb);
assertEqual(
  'circle dw: fix.attribute is r',
  circleDwResult.corrections[0].fix.attribute,
  'r',
);
assertEqual(
  'circle dw: fix.current is "10" (bbox.w/2)',
  circleDwResult.corrections[0].fix.current,
  '10',
);
assertEqual(
  'circle dw: fix.target is "15" (10 + 10/2)',
  circleDwResult.corrections[0].fix.target,
  '15',
);
assertNotEqual(
  'circle dw: target is NOT "20" (no div 2 would give 20+10=30)',
  circleDwResult.corrections[0].fix.target,
  '30',
);

// P4: circle dh -> r with div 2 as well
const circleDhArb = {
  passing: [],
  failing: [
    {
      type: 'CONSTRAINT_FAIL',
      severity: 0,
      id: 'sun',
      constraintType: 'SAME-SIZE',
      reference: 'bg',
      detail: 'Groesse weicht ab',
      dh: -6,
    },
  ],
  unchecked: [],
  diff: [],
  totals: {
    total: 1,
    passing_count: 0,
    failing_count: 1,
    unchecked_count: 0,
    diff_count: 0,
  },
};
const circleDhResult = formatStructured(mockGridMap, circleDhArb);
assertEqual(
  'circle dh: fix.attribute is r',
  circleDhResult.corrections[0].fix.attribute,
  'r',
);
assertEqual(
  'circle dh: fix.current is "10" (bbox.h/2)',
  circleDhResult.corrections[0].fix.current,
  '10',
);
assertEqual(
  'circle dh: fix.target is "7" (10 + (-6)/2)',
  circleDhResult.corrections[0].fix.target,
  '7',
);

// P4 canary: rect dw does NOT divide (stays as-is)
assertEqual(
  'rect dw: no div (current "100", target "80")',
  rectDwResult.corrections[0].fix.current,
  '100',
);
assertEqual(
  'rect dw: target unchanged by div',
  rectDwResult.corrections[0].fix.target,
  '80',
);

// ── No-delta: buildFix returns null for zero delta ──────────

console.log('--- STRUCTURED: Zero-Delta Edge Case ---');
const zeroDeltaArb = {
  passing: [],
  failing: [
    {
      type: 'CONSTRAINT_FAIL',
      severity: 0,
      id: 'sun',
      constraintType: 'CENTERED-IN',
      reference: 'bg',
      detail: 'ok',
    },
    // NOTE: no dx/dy/dw/dh fields — all undefined
  ],
  unchecked: [],
  diff: [],
  totals: {
    total: 1,
    passing_count: 0,
    failing_count: 1,
    unchecked_count: 0,
    diff_count: 0,
  },
};
const zeroDeltaResult = formatStructured(mockGridMap, zeroDeltaArb);
assertEqual(
  'no deltas: no fix object',
  zeroDeltaResult.corrections[0].fix,
  undefined,
);

// ── formatInspectStructured ─────────────────────────────────

console.log('--- INSPECT STRUCTURED ---');
const inspected = formatInspectStructured(mockGridMap);
assertEqual('has scene object', typeof inspected.scene, 'object');
assertEqual('scene.width exact', inspected.scene.width, 400);
assertEqual('scene.height exact', inspected.scene.height, 200);
assertEqual('scene.grid exact', inspected.scene.grid, '8x4');
assertEqual('2 elements', inspected.scene.elements.length, 2);
assertEqual('first element id', inspected.scene.elements[0].id, 'sun');
assertEqual('first element tag', inspected.scene.elements[0].tag, 'circle');
assertEqual('first element color', inspected.scene.elements[0].color, 'gold');
assertEqual(
  'all status ok',
  inspected.scene.elements.every((e) => e.status === 'ok'),
  true,
);
// §E1 D-008 (F-TF-008): scene.suppressed ist UNKONDITIONAL emittiert.
// ≤7 Elemente → 0 (byte-stabil; das Feld verschwindet NICHT bei kleiner Szene).
assertEqual('inspect scene.suppressed === 0 (≤7)', inspected.scene.suppressed, 0);
assertEqual(
  'inspect scene.suppressed is a number (not undefined → keine stille Luege)',
  typeof inspected.scene.suppressed,
  'number',
);
// Anti-mutation: inspect has NO corrections/diff/iteration
assertEqual('no corrections key', inspected.corrections, undefined);
assertEqual('no diff key', inspected.diff, undefined);
assertEqual('no iteration key', inspected.iteration, undefined);
assertEqual('no status key', inspected.status, undefined);

// ── formatPaletteStructured ─────────────────────────────────

console.log('--- PALETTE STRUCTURED ---');
const pal = formatPaletteStructured(mockGridMap.elements);
assertEqual('colors is array', Array.isArray(pal.colors), true);
assertEqual('2 color entries', pal.colors.length, 2);
// Exact value checks (mutation would swap fill/stroke or elements)
assertEqual('sun id', pal.colors[0].id, 'sun');
assertEqual('sun fill exactly gold', pal.colors[0].fill, 'gold');
assertEqual(
  'sun stroke is null (transparent filtered)',
  pal.colors[0].stroke,
  null,
);
assertNotEqual(
  'sun stroke is NOT transparent string',
  pal.colors[0].stroke,
  'transparent',
);
assertEqual('bg id', pal.colors[1].id, 'bg');
assertEqual('bg fill exactly blue', pal.colors[1].fill, 'blue');
assertEqual('bg stroke is null', pal.colors[1].stroke, null);

// Non-transparent stroke should be preserved
const strokElements = [{ id: 'x', color: 'red', stroke: 'black' }];
const strokPal = formatPaletteStructured(strokElements);
assertEqual(
  'non-transparent stroke preserved',
  strokPal.colors[0].stroke,
  'black',
);
assertNotEqual(
  'non-transparent stroke not null',
  strokPal.colors[0].stroke,
  null,
);

// ── Palette cap at 7 (P6: consistent with scene element cap) ─

console.log('--- PALETTE: Element Cap ---');
const manyPaletteElements = Array.from({ length: 10 }, (_, i) => ({
  id: `p${i}`,
  color: 'red',
  stroke: 'transparent',
}));
const palCapped = formatPaletteStructured(manyPaletteElements);
assertEqual('palette capped at 7', palCapped.colors.length, 7);
assertNotEqual('palette not 10 (all)', palCapped.colors.length, 10);
assertEqual('palette first is p0', palCapped.colors[0].id, 'p0');
assertEqual('palette last shown is p6', palCapped.colors[6].id, 'p6');

// ── Element cap at 7 (BAUPLAN: slice(0,7)) ──────────────────

console.log('--- STRUCTURED: Element Cap ---');
// §1.3 / F-SVG-007: synthetische Element-Liste mit hardcoded ids 'el0'..'el9'
// (explizite id-Simulation, 1:1 vom Renderer durchgereicht). bbox_reliability
// ergaenzt fuer Schema-Treue.
const manyElements = Array.from({ length: 10 }, (_, i) => ({
  id: `el${i}`,
  tag: 'rect',
  cell: 'A1',
  span: null,
  color: 'red',
  stroke: 'transparent',
  opacity: 1,
  bbox: { x: 0, y: 0, w: 10, h: 10 },
  cx: 5,
  cy: 5,
  bbox_reliability: 'reliable',
}));
const bigGridMap = {
  canvas: { width: 400, height: 200 },
  grid: { cellsX: 8, cellsY: 4 },
  elements: manyElements,
};
const bigResult = formatStructured(bigGridMap, cleanArbitrated);
assertEqual('scene elements capped at 7', bigResult.scene.elements.length, 7);
assertNotEqual('not 10 (all)', bigResult.scene.elements.length, 10);
assertEqual('first element is el0', bigResult.scene.elements[0].id, 'el0');
assertEqual('last shown is el6', bigResult.scene.elements[6].id, 'el6');

const bigInspect = formatInspectStructured(bigGridMap);
assertEqual('inspect also capped at 7', bigInspect.scene.elements.length, 7);
// §E1 D-008 (F-TF-008): bei 10 Elementen muss der ehrliche Zaehler die 3
// verborgenen melden — sonst stille Mess-Luege (maschineller Konsument verliert
// sie ohne Signal). Symmetrisch zur analyze iteration.suppressed.
assertEqual('inspect scene.suppressed === 3 (10−7)', bigInspect.scene.suppressed, 3);
assertNotEqual('inspect suppressed NOT 0 (10 elements)', bigInspect.scene.suppressed, 0);

// ── P1-04: Tri-State Status (PASS / FAIL / PARTIAL) ─────────

console.log('--- STRUCTURED: Tri-State Status (P1-04) ---');

// PARTIAL: failing=0 ∧ unchecked>0 — the silent-pass killer
const partialArb = {
  passing: [],
  failing: [],
  unchecked: [
    {
      id: 'a',
      constraintType: 'CENTRD-IN',
      reasonCategory: 'SPECIFICATION',
      reasonCode: 'CONSTRAINT_TYPE_UNKNOWN',
      hint: "Constraint-Typ 'CENTRD-IN' ist nicht registriert.",
      suggestedCorrection: 'CENTERED-IN',
    },
  ],
  diff: [],
  totals: {
    total: 1,
    passing_count: 0,
    failing_count: 0,
    unchecked_count: 1,
    diff_count: 0,
  },
};
const partial = formatStructured(mockGridMap, partialArb);
assertEqual(
  'PARTIAL when unchecked>0 and failing=0',
  partial.status,
  'PARTIAL',
);
assertNotEqual(
  'PARTIAL is NOT PASS (silent-pass killed)',
  partial.status,
  'PASS',
);
assertNotEqual('PARTIAL is NOT FAIL', partial.status, 'FAIL');
assertEqual(
  'total_issues = failing + unchecked',
  partial.iteration.total_issues,
  1,
);
assertEqual(
  'returned_issues mirrors total (no cap)',
  partial.iteration.returned_issues,
  1,
);
assertEqual(
  'suppressed = 0 (structured ships all)',
  partial.iteration.suppressed,
  0,
);
assertEqual('unchecked surface count', partial.unchecked.length, 1);
assertEqual('unchecked.element prefixed', partial.unchecked[0].element, '#a');
assertEqual(
  'unchecked.reasonCode passed through',
  partial.unchecked[0].reasonCode,
  'CONSTRAINT_TYPE_UNKNOWN',
);
assertEqual(
  'unchecked.reasonCategory passed through',
  partial.unchecked[0].reasonCategory,
  'SPECIFICATION',
);
assertEqual(
  'unchecked.suggestedCorrection passed through',
  partial.unchecked[0].suggestedCorrection,
  'CENTERED-IN',
);

// Mixed: failing>0 wins over unchecked → status = FAIL
const mixedArb = {
  passing: [],
  failing: [
    {
      type: 'CONSTRAINT_FAIL',
      severity: 0,
      id: 'sun',
      constraintType: 'CENTERED-IN',
      reference: 'bg',
      detail: 'Verfehlt',
      dx: -5,
    },
  ],
  unchecked: [
    {
      id: 'b',
      constraintType: 'FILL',
      reasonCategory: 'MODEL',
      reasonCode: 'MEASUREMENT_AMBIGUOUS',
      hint: 'FILL nicht messbar.',
    },
  ],
  diff: [],
  totals: {
    total: 2,
    passing_count: 0,
    failing_count: 1,
    unchecked_count: 1,
    diff_count: 0,
  },
};
const mixed = formatStructured(mockGridMap, mixedArb);
assertEqual(
  'FAIL wins when both failing and unchecked exist',
  mixed.status,
  'FAIL',
);
assertEqual('mixed total_issues counts both', mixed.iteration.total_issues, 2);
assertEqual('mixed unchecked still surfaced', mixed.unchecked.length, 1);

// PASS: all empty
assertEqual('PASS empty corrections', clean.corrections.length, 0);
assertEqual('PASS empty unchecked', clean.unchecked.length, 0);

// Element status uses unchecked → 'warn'
const partialElementStatus = partial.scene.elements.find((e) => e.id === 'a');
// Note: 'a' is not in mockGridMap.elements; the unchecked id refers to an absent element here.
// Use a unchecked-surfacing test that aligns to existing element id.
const partialOnSun = formatStructured(mockGridMap, {
  passing: [],
  failing: [],
  unchecked: [
    {
      id: 'sun',
      constraintType: 'FILL',
      reasonCategory: 'MODEL',
      reasonCode: 'MEASUREMENT_AMBIGUOUS',
      hint: 'kein fill',
    },
  ],
  diff: [],
  totals: {
    total: 1,
    passing_count: 0,
    failing_count: 0,
    unchecked_count: 1,
    diff_count: 0,
  },
});
assertEqual(
  'element with unchecked → status warn',
  partialOnSun.scene.elements.find((e) => e.id === 'sun').status,
  'warn',
);

// ── §1.5 Transform-Fallback (Tags ohne dx/dy/dw/dh-Mapping) ──
// Stop-Conditions C1-C6. path/polygon → transform-Fix (front-prepend),
// path dw/dh → SIZE_FIX_UNSUPPORTED_FOR_TAG, tspan → native relativer Shift.

console.log('--- STRUCTURED: §1.5 Transform-Fallback (path/polygon) ---');
const pathGridMap = {
  canvas: { width: 400, height: 200 },
  grid: { cellsX: 8, cellsY: 4 },
  elements: [
    {
      id: 'p1',
      tag: 'path',
      cell: 'D4',
      span: null,
      color: 'red',
      stroke: 'transparent',
      opacity: 1,
      bbox: { x: 120, y: 30, w: 40, h: 40 },
      bbox_reliability: 'reliable',
    },
    {
      id: 'pg1',
      tag: 'polygon',
      cell: 'B2',
      span: null,
      color: 'green',
      stroke: 'transparent',
      opacity: 1,
      bbox: { x: 10, y: 10, w: 30, h: 30 },
      bbox_reliability: 'reliable',
    },
  ],
};

// C1: path LEFT-OF → fix.attribute === 'transform' (heute war 'dx').
const pathDxArb = {
  passing: [],
  failing: [
    {
      type: 'CONSTRAINT_FAIL',
      severity: 0,
      id: 'p1',
      constraintType: 'LEFT-OF',
      reference: 'anchor',
      detail: 'rechts statt links',
      dx: -192,
    },
  ],
  unchecked: [],
  diff: [],
  totals: {
    total: 1,
    passing_count: 0,
    failing_count: 1,
    unchecked_count: 0,
    diff_count: 0,
  },
};
const pathDxResult = formatStructured(pathGridMap, pathDxArb);
assertEqual(
  'C1: path fix.attribute is transform (NOT dx)',
  pathDxResult.corrections[0].fix.attribute,
  'transform',
);
assertNotEqual(
  'C1: path fix.attribute is NOT the toxic dx',
  pathDxResult.corrections[0].fix.attribute,
  'dx',
);
assertEqual(
  'C1: path fix.target front-prepends translate',
  pathDxResult.corrections[0].fix.target,
  'translate(-192 0)',
);
assertEqual(
  'C1: path fix.current is empty (no author transform)',
  pathDxResult.corrections[0].fix.current,
  '',
);
assertEqual(
  'C1: path single transform fix → no fixes array (dx+dy aggregated)',
  pathDxResult.corrections[0].fixes,
  undefined,
);

// C2: polygon CENTERED-IN (dx+dy) → ONE aggregated transform fix.
const polyArb = {
  passing: [],
  failing: [
    {
      type: 'CONSTRAINT_FAIL',
      severity: 0,
      id: 'pg1',
      constraintType: 'CENTERED-IN',
      reference: 'box',
      detail: 'nicht zentriert',
      dx: 100,
      dy: 50,
    },
  ],
  unchecked: [],
  diff: [],
  totals: {
    total: 1,
    passing_count: 0,
    failing_count: 1,
    unchecked_count: 0,
    diff_count: 0,
  },
};
const polyResult = formatStructured(pathGridMap, polyArb);
assertEqual(
  'C2: polygon fix.attribute is transform',
  polyResult.corrections[0].fix.attribute,
  'transform',
);
assertEqual(
  'C2: polygon dx+dy aggregated into ONE translate',
  polyResult.corrections[0].fix.target,
  'translate(100 50)',
);
assertEqual(
  'C2: polygon NO per-axis fixes array (R-B: single aggregated fix)',
  polyResult.corrections[0].fixes,
  undefined,
);

// C3: path SAME-SIZE (dw/dh) → reason SIZE_FIX_UNSUPPORTED_FOR_TAG, no dw/dh fix.
const pathSizeArb = {
  passing: [],
  failing: [
    {
      type: 'CONSTRAINT_FAIL',
      severity: 0,
      id: 'p1',
      constraintType: 'SAME-SIZE',
      reference: 'ref',
      detail: 'Groesse weicht ab',
      dw: -20,
      dh: -10,
    },
  ],
  unchecked: [],
  diff: [],
  totals: {
    total: 1,
    passing_count: 0,
    failing_count: 1,
    unchecked_count: 0,
    diff_count: 0,
  },
};
const pathSizeResult = formatStructured(pathGridMap, pathSizeArb);
assertEqual(
  'C3: path dw/dh → reason SIZE_FIX_UNSUPPORTED_FOR_TAG',
  pathSizeResult.corrections[0].reason,
  'SIZE_FIX_UNSUPPORTED_FOR_TAG',
);
assertEqual(
  'C3: path dw/dh → NO fix object (no toxic dw)',
  pathSizeResult.corrections[0].fix,
  undefined,
);
assertEqual(
  'C3: path dw/dh → NO fixes array',
  pathSizeResult.corrections[0].fixes,
  undefined,
);

// C6: path with author transform='scale(2)' → front-prepend (begins translate().
const pathScaleGridMap = {
  canvas: { width: 400, height: 200 },
  grid: { cellsX: 8, cellsY: 4 },
  elements: [
    {
      id: 'p2',
      tag: 'path',
      cell: 'D4',
      span: null,
      color: 'red',
      stroke: 'transparent',
      opacity: 1,
      bbox: { x: 120, y: 30, w: 40, h: 40 },
      transform: 'scale(2)',
      bbox_reliability: 'reliable',
    },
  ],
};
const pathScaleArb = {
  passing: [],
  failing: [
    {
      type: 'CONSTRAINT_FAIL',
      severity: 0,
      id: 'p2',
      constraintType: 'LEFT-OF',
      reference: 'anchor',
      detail: 'rechts statt links',
      dx: -192,
    },
  ],
  unchecked: [],
  diff: [],
  totals: {
    total: 1,
    passing_count: 0,
    failing_count: 1,
    unchecked_count: 0,
    diff_count: 0,
  },
};
const pathScaleResult = formatStructured(pathScaleGridMap, pathScaleArb);
assertEqual(
  'C6: path scale(2) fix.current is the author transform',
  pathScaleResult.corrections[0].fix.current,
  'scale(2)',
);
assertEqual(
  'C6: path scale(2) fix.target front-prepends translate',
  pathScaleResult.corrections[0].fix.target,
  'translate(-192 0) scale(2)',
);
assertEqual(
  'C6: path scale(2) fix.target begins with translate(',
  pathScaleResult.corrections[0].fix.target.startsWith('translate('),
  true,
);

// C4: tspan → native dx as RELATIVE shift (current '0', target = delta), NOT
// absolute coordinate, NOT transform. parent_id/parent_tag passthrough.
console.log('--- STRUCTURED: §1.5 tspan native relative shift (C4) ---');
const tspanGridMap = {
  canvas: { width: 200, height: 100 },
  grid: { cellsX: 8, cellsY: 4 },
  elements: [
    {
      id: 'ts1',
      tag: 'tspan',
      cell: 'D4',
      span: null,
      color: 'black',
      stroke: 'transparent',
      opacity: 1,
      bbox: { x: 50, y: 40, w: 60, h: 20 },
      parent_id: 't1',
      parent_tag: 'text',
      bbox_reliability: 'reliable',
    },
  ],
};
const tspanArb = {
  passing: [],
  failing: [
    {
      type: 'CONSTRAINT_FAIL',
      severity: 0,
      id: 'ts1',
      constraintType: 'LEFT-OF',
      reference: 'ref2',
      detail: 'rechts statt links',
      dx: -30,
    },
  ],
  unchecked: [],
  diff: [],
  totals: {
    total: 1,
    passing_count: 0,
    failing_count: 1,
    unchecked_count: 0,
    diff_count: 0,
  },
};
const tspanResult = formatStructured(tspanGridMap, tspanArb);
assertEqual(
  'C4: tspan fix.attribute is native dx',
  tspanResult.corrections[0].fix.attribute,
  'dx',
);
assertNotEqual(
  'C4: tspan does NOT use transform',
  tspanResult.corrections[0].fix.attribute,
  'transform',
);
assertEqual(
  'C4: tspan dx is RELATIVE shift (current 0)',
  tspanResult.corrections[0].fix.current,
  '0',
);
assertEqual(
  'C4: tspan target is the delta value (not absolute bbox coord)',
  tspanResult.corrections[0].fix.target,
  '-30',
);
assertNotEqual(
  'C4: tspan target is NOT absolute bbox.x (50)',
  tspanResult.corrections[0].fix.target,
  '50',
);
assertEqual(
  'C4: tspan scene-element carries parent_id',
  tspanResult.scene.elements.find((e) => e.id === 'ts1').parent_id,
  't1',
);
assertEqual(
  'C4: tspan scene-element carries parent_tag',
  tspanResult.scene.elements.find((e) => e.id === 'ts1').parent_tag,
  'text',
);

// tspan dx+dy → two native shift fixes (per-axis valid for tspan).
const tspanXyArb = {
  passing: [],
  failing: [
    {
      type: 'CONSTRAINT_FAIL',
      severity: 0,
      id: 'ts1',
      constraintType: 'CENTERED-IN',
      reference: 'ref2',
      detail: 'verschoben',
      dx: -30,
      dy: 12,
    },
  ],
  unchecked: [],
  diff: [],
  totals: {
    total: 1,
    passing_count: 0,
    failing_count: 1,
    unchecked_count: 0,
    diff_count: 0,
  },
};
const tspanXyResult = formatStructured(tspanGridMap, tspanXyArb);
assertEqual(
  'tspan dx+dy → fixes array has 2 entries',
  tspanXyResult.corrections[0].fixes.length,
  2,
);
assertEqual(
  'tspan fixes[0] is dx',
  tspanXyResult.corrections[0].fixes[0].attribute,
  'dx',
);
assertEqual(
  'tspan fixes[1] is dy',
  tspanXyResult.corrections[0].fixes[1].attribute,
  'dy',
);
assertEqual(
  'tspan fixes[1] target is delta',
  tspanXyResult.corrections[0].fixes[1].target,
  '12',
);

// Patch P2: tspan WITH existing native dx → shift RELATIVE to author dx (not overwrite).
// native_dx='5', delta=-30 → current='5', target='-25' (5 + (-30)).
console.log('--- STRUCTURED: §1.5 Patch P2 tspan relative-to-native-dx ---');
const tspanNativeGridMap = {
  canvas: { width: 200, height: 100 },
  grid: { cellsX: 8, cellsY: 4 },
  elements: [
    {
      id: 'ts2',
      tag: 'tspan',
      cell: 'D4',
      span: null,
      color: 'black',
      stroke: 'transparent',
      opacity: 1,
      bbox: { x: 50, y: 40, w: 60, h: 20 },
      parent_id: 't1',
      parent_tag: 'text',
      native_dx: '5',
      bbox_reliability: 'reliable',
    },
  ],
};
const tspanNativeArb = {
  passing: [],
  failing: [
    {
      type: 'CONSTRAINT_FAIL',
      severity: 0,
      id: 'ts2',
      constraintType: 'LEFT-OF',
      reference: 'ref2',
      detail: 'rechts statt links',
      dx: -30,
    },
  ],
  unchecked: [],
  diff: [],
  totals: {
    total: 1,
    passing_count: 0,
    failing_count: 1,
    unchecked_count: 0,
    diff_count: 0,
  },
};
const tspanNativeResult = formatStructured(tspanNativeGridMap, tspanNativeArb);
assertEqual(
  'P2: tspan fix.current is the AUTHOR dx (5), not 0',
  tspanNativeResult.corrections[0].fix.current,
  '5',
);
assertEqual(
  'P2: tspan fix.target is RELATIVE (5 + (-30) = -25), not overwrite',
  tspanNativeResult.corrections[0].fix.target,
  '-25',
);
// native_dx as a length-list ("4 2 1") → first numeric token is the scalar base.
const tspanListGridMap = {
  ...tspanNativeGridMap,
  elements: [
    { ...tspanNativeGridMap.elements[0], id: 'ts3', native_dx: '4 2 1' },
  ],
};
const tspanListArb = {
  ...tspanNativeArb,
  failing: [{ ...tspanNativeArb.failing[0], id: 'ts3', dx: -10 }],
};
const tspanListResult = formatStructured(tspanListGridMap, tspanListArb);
assertEqual(
  'P2: tspan dx-list "4 2 1" → base is first token (4)',
  tspanListResult.corrections[0].fix.current,
  '4',
);
assertEqual(
  'P2: tspan dx-list → target relative to first token (4 + (-10) = -6)',
  tspanListResult.corrections[0].fix.target,
  '-6',
);

// Anti-toxicity canary: NO correction across §1.5 cases emits a literal dw/dh/dx
// as a fix.attribute for a non-whitelist tag (the old `?? deltaKey` bug).
console.log('--- STRUCTURED: §1.5 anti-toxicity canary ---');
assertNotEqual(
  'CANARY: path size fix never produces attribute dw',
  pathSizeResult.corrections[0].fix?.attribute,
  'dw',
);
assertNotEqual(
  'CANARY: path size fix never produces attribute dh',
  pathSizeResult.corrections[0].fixes?.[0]?.attribute,
  'dh',
);

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
