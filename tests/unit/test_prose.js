/**
 * test_prose.js - AF-08: formatReport Unit Test
 * Tests report generation with mock data.
 * Vector Mirror v2.0
 */
import { formatReport as formatReportRaw } from '../../src/adapters/emitter/prose.js';
import { gateCorrections } from '../../src/core/honesty.js';

// §E1 R3: formatReport hat GENAU EINE failing-Quelle (arbitrated.failing), die
// der Caller GEGATET reicht (honesty.js#gateCorrections), symmetrisch zu
// formatStructured. Wrapper injiziert die gegatete Liste als arbitrated.failing
// — exakt wie pipeline.js. Fuer reliable byte-identisch (Deltas + [dx=..px]
// bleiben); fuer not_measurable/approximate unterdrueckt (D-006/R2, separat in
// test_honesty_live.js belegt). bbox_reliability ist im Prod-Pfad garantiert
// (grid.js:69) — die Mocks tragen es jetzt explizit.
function formatReport(gridMap, arbitrated) {
  const relById = new Map(
    (gridMap.elements || []).map((el) => [el.id, el.bbox_reliability]),
  );
  const gatedFailing = gateCorrections(arbitrated.failing || [], (id) =>
    relById.get(id),
  );
  return formatReportRaw(gridMap, { ...arbitrated, failing: gatedFailing });
}

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

const mockGridMap = {
  canvas: { width: 400, height: 200, viewBox: '0 0 400 200' },
  grid: { cellW: 50, cellH: 50, cellsX: 8, cellsY: 4 },
  elements: [
    {
      id: 'sun',
      tag: 'circle',
      cell: 'E2',
      direction: 'MITTE',
      span: null,
      color: 'gold',
      stroke: 'transparent',
      opacity: 1,
      bbox: { x: 190, y: 90, w: 20, h: 20 },
      cx: 200,
      cy: 100,
      textContent: null,
      bbox_reliability: 'reliable',
    },
    {
      id: 'bg',
      tag: 'rect',
      cell: 'A1',
      direction: 'MITTE',
      span: 'A1-H4',
      color: 'blue',
      stroke: 'transparent',
      opacity: 1,
      bbox: { x: 0, y: 0, w: 400, h: 200 },
      cx: 200,
      cy: 100,
      textContent: null,
      bbox_reliability: 'reliable',
    },
  ],
};

// Test 1: Clean report (no issues)
console.log('--- PROSE: Clean Report ---');
const cleanArb = {
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
const report1 = formatReport(mockGridMap, cleanArb);
assert('contains STATUS', report1.includes('STATUS'));
assert('contains checkmark for clean', report1.includes('\u2713'));
assert('contains SZENE', report1.includes('SZENE'));
assert(
  'contains dimensions',
  report1.includes('400') && report1.includes('200'),
);
assert('contains element count', report1.includes('2 Elemente'));
assert(
  'contains element IDs',
  report1.includes('sun') && report1.includes('bg'),
);

// Test 2: Report with constraint failure (tri-state shape)
console.log('--- PROSE: With Failures ---');
// G2 (D-006): die Korrektur lebt NUR noch in strukturierten Feldern (dx/dy/
// dw/dh). detail beschreibt das WAS, kein "Korrektur:"-Leak mehr. prose.js
// baut den [dx=…]-Hinweis aus den strukturierten Feldern.
const failArb = {
  passing: [],
  failing: [
    {
      type: 'CONSTRAINT_FAIL',
      severity: 0,
      id: 'sun',
      detail: '#sun Verfehlt Zentrum',
      dx: -24,
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
const report2 = formatReport(mockGridMap, failArb);
assert('contains error count', report2.includes('1 Fehler'));
assert('contains hint count', report2.includes('1 Hinweis'));
assert('contains cross for fail', report2.includes('\u2717'));
assert('contains correction detail', report2.includes('dx=-24px'));
assert('contains move arrow', report2.includes('\u2192'));

// Test 3: Suppressed items (cap at top-3 failing + top-2 diff)
console.log('--- PROSE: Suppressed ---');
const suppArb = {
  passing: [],
  failing: [],
  unchecked: [],
  diff: [
    { type: 'NEU', severity: 3, id: 'x1', cell: 'C3', color: 'red' },
    { type: 'NEU', severity: 3, id: 'x2', cell: 'C4', color: 'red' },
    { type: 'NEU', severity: 3, id: 'x3', cell: 'C5', color: 'red' },
    { type: 'NEU', severity: 3, id: 'x4', cell: 'C6', color: 'red' },
    { type: 'NEU', severity: 3, id: 'x5', cell: 'C7', color: 'red' },
  ],
  totals: {
    total: 5,
    passing_count: 0,
    failing_count: 0,
    unchecked_count: 0,
    diff_count: 5,
  },
};
const report3 = formatReport(mockGridMap, suppArb);
assert(
  'shows suppressed count',
  report3.includes('3 weitere siehe structured'),
);

// Test 4: Exact ID matching for status/spotter lookup
console.log('--- PROSE: Exact ID matching ---');
const exactIdMap = {
  canvas: { width: 100, height: 100, viewBox: null },
  grid: { cellW: 50, cellH: 50, cellsX: 2, cellsY: 2 },
  elements: [
    {
      id: 'bg',
      tag: 'rect',
      cell: 'A1',
      direction: 'MITTE',
      span: null,
      color: 'blue',
      stroke: 'transparent',
      opacity: 1,
      bbox: { x: 0, y: 0, w: 40, h: 40 },
      cx: 20,
      cy: 20,
      textContent: null,
      bbox_reliability: 'reliable',
    },
    {
      id: 'bg2',
      tag: 'rect',
      cell: 'B1',
      direction: 'MITTE',
      span: null,
      color: 'red',
      stroke: 'transparent',
      opacity: 1,
      bbox: { x: 50, y: 0, w: 40, h: 40 },
      cx: 70,
      cy: 20,
      textContent: null,
      bbox_reliability: 'reliable',
    },
  ],
};
const exactIdArb = {
  passing: [],
  failing: [
    {
      type: 'CONSTRAINT_FAIL',
      severity: 0,
      id: 'bg2',
      // G2 (D-006): Korrektur nur strukturiert (dx), kein "Korrektur:" im detail.
      detail: '#bg2 Verfehlt Zentrum',
      dx: 10,
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
const report4 = formatReport(exactIdMap, exactIdArb);
assert(
  'does not mark #bg as failing via substring',
  report4.includes('rect#bg: A1, MITTE, blue ✗') === false,
);
assert(
  'marks #bg2 as failing',
  report4.includes('rect#bg2') && report4.includes('[dx=10px] ✗'),
);

// Test 5: FORMÄNDERUNG diff is rendered (F-TF-022 / D-005) — nicht verschluckt
console.log('--- PROSE: Form Mutation Rendered ---');
const formArb = {
  passing: [],
  failing: [],
  unchecked: [],
  diff: [
    { type: 'FORMÄNDERUNG', severity: 1, id: 'sun', from: 'circle', to: 'ellipse' },
  ],
  totals: {
    total: 1,
    passing_count: 0,
    failing_count: 0,
    unchecked_count: 0,
    diff_count: 1,
  },
};
const report5 = formatReport(mockGridMap, formArb);
assert(
  'renders FORMÄNDERUNG diff line',
  report5.includes('△ #sun: circle → ellipse (Form)'),
);
assert(
  'FORMÄNDERUNG counted as Hinweis in STATUS',
  report5.includes('1 Hinweis'),
);

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
