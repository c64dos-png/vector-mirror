/**
 * test_arbitrate.js — Tri-State Validator (P1-04)
 * Vector Mirror v2.5
 *
 * Covers FIX_PLAN_2026-04-18 §1.2 P1-04 acceptance:
 *   - tri-state buckets (passing / failing / unchecked)
 *   - status PARTIAL when unchecked>0 ∧ failing===0 (asserted in test_structured)
 *   - per-reasonCode unchecked entries (CONSTRAINT_TYPE_UNKNOWN ⇒ Levenshtein suggestion)
 *   - no max-cap inside the validator (full passthrough)
 */
import { arbitrate, REASON_CODES } from '../../src/core/arbitrate.js';

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

// =============================================================================
// REASON_CODES exports the documented enum
// =============================================================================
console.log('--- REASON_CODES enum ---');
const expectedCodes = [
  'CONSTRAINT_TYPE_UNKNOWN',
  'SUBJECT_NOT_FOUND',
  'REFERENCE_NOT_FOUND',
  'REFERENCE_DEGENERATE',
  'MEASUREMENT_AMBIGUOUS',
  'SEMANTIC_SUSPICIOUS',
  'SCOPE_MISMATCH',
];
for (const c of expectedCodes) {
  assert(`REASON_CODES contains ${c}`, REASON_CODES.includes(c));
}
assert('REASON_CODES is frozen', Object.isFrozen(REASON_CODES));

// =============================================================================
// tri-state buckets
// =============================================================================
console.log('--- tri-state bucketing ---');

const triCrs = [
  { pass: true, id: 'a', constraintType: 'INSIDE' },
  {
    pass: false,
    id: 'b',
    constraintType: 'CENTERED-IN',
    detail: 'Verfehlt',
    dx: 5,
  },
  { pass: null, id: 'c', constraintType: 'FILL', detail: 'pass:null' },
];
const tri = arbitrate(triCrs, []);
assert('passing[]   has 1 entry', tri.passing.length === 1);
assert('failing[]   has 1 entry', tri.failing.length === 1);
assert('unchecked[] has 1 entry', tri.unchecked.length === 1);
assert('totals.passing_count   === 1', tri.totals.passing_count === 1);
assert('totals.failing_count   === 1', tri.totals.failing_count === 1);
assert('totals.unchecked_count === 1', tri.totals.unchecked_count === 1);
assert(
  'totals.total = failing+unchecked+diff (passing not counted)',
  tri.totals.total === 2,
);
assert('failing entry has severity 0', tri.failing[0].severity === 0);
assert('failing entry preserves dx', tri.failing[0].dx === 5);
assert(
  'failing entry typed CONSTRAINT_FAIL',
  tri.failing[0].type === 'CONSTRAINT_FAIL',
);

// =============================================================================
// reasonCode: passthrough when registry / P1-08 provides metadata
// =============================================================================
console.log('--- reasonCode passthrough ---');

const passthroughCrs = [
  {
    pass: null,
    id: 'x',
    constraintType: 'CENTERED-IN',
    reasonCategory: 'SPECIFICATION',
    reasonCode: 'REFERENCE_NOT_FOUND',
    hint: 'Referenz #ghost existiert nicht.',
    detail: 'low-level',
  },
];
const pt = arbitrate(passthroughCrs, []);
assert(
  'passthrough: reasonCategory preserved',
  pt.unchecked[0].reasonCategory === 'SPECIFICATION',
);
assert(
  'passthrough: reasonCode preserved',
  pt.unchecked[0].reasonCode === 'REFERENCE_NOT_FOUND',
);
assert('passthrough: hint preserved', pt.unchecked[0].hint.includes('#ghost'));

// suggestedCorrection passes through if provided
const ptSugg = arbitrate(
  [
    {
      pass: null,
      id: 'y',
      constraintType: 'XENTERED-IN',
      reasonCategory: 'SPECIFICATION',
      reasonCode: 'CONSTRAINT_TYPE_UNKNOWN',
      hint: 'unbekannt',
      suggestedCorrection: 'CENTERED-IN',
    },
  ],
  [],
);
assert(
  'passthrough: suggestedCorrection preserved',
  ptSugg.unchecked[0].suggestedCorrection === 'CENTERED-IN',
);

// =============================================================================
// reasonCode: fallback heuristic — typo detection (Levenshtein ≤2)
// =============================================================================
console.log('--- typo heuristic (CONSTRAINT_TYPE_UNKNOWN) ---');

const typoCr = {
  pass: null,
  id: 'a',
  constraintType: 'CENTRD-IN',
  detail: 'Unbekannt',
};
const typo = arbitrate([typoCr], []);
const tu = typo.unchecked[0];
assert(
  'typo: reasonCode = CONSTRAINT_TYPE_UNKNOWN',
  tu.reasonCode === 'CONSTRAINT_TYPE_UNKNOWN',
);
assert(
  'typo: reasonCategory = SPECIFICATION',
  tu.reasonCategory === 'SPECIFICATION',
);
assert(
  "typo: suggestedCorrection = 'CENTERED-IN'",
  tu.suggestedCorrection === 'CENTERED-IN',
);
assert('typo: hint mentions registered', tu.hint.includes('registriert'));

// 1-edit typo
const typo1 = arbitrate(
  [{ pass: null, constraintType: 'CENTERED-I', detail: 'x' }],
  [],
);
assert(
  '1-edit: suggests CENTERED-IN',
  typo1.unchecked[0].suggestedCorrection === 'CENTERED-IN',
);

// 2-edit typo
const typo2 = arbitrate(
  [{ pass: null, constraintType: 'CENTERD-I', detail: 'x' }],
  [],
);
assert(
  '2-edit: still suggests CENTERED-IN',
  typo2.unchecked[0].suggestedCorrection === 'CENTERED-IN',
);

// >2 edit distance: still flagged unknown but NO suggestion
const farTypo = arbitrate(
  [{ pass: null, constraintType: 'COMPLETELY-FOREIGN', detail: 'x' }],
  [],
);
assert(
  'far typo: still CONSTRAINT_TYPE_UNKNOWN',
  farTypo.unchecked[0].reasonCode === 'CONSTRAINT_TYPE_UNKNOWN',
);
assert(
  'far typo: no suggestion when distance > 2',
  farTypo.unchecked[0].suggestedCorrection === undefined,
);

// =============================================================================
// reasonCode: fallback heuristic — known type without metadata
// =============================================================================
console.log('--- generic fallback (MEASUREMENT_AMBIGUOUS) ---');

const ambiguousCr = {
  pass: null,
  id: 'a',
  constraintType: 'FILL',
  detail: 'kein fill messbar',
};
const amb = arbitrate([ambiguousCr], []);
assert(
  'known type pass:null → MEASUREMENT_AMBIGUOUS',
  amb.unchecked[0].reasonCode === 'MEASUREMENT_AMBIGUOUS',
);
assert(
  'reasonCategory MODEL for measurement issues',
  amb.unchecked[0].reasonCategory === 'MODEL',
);
assert(
  'hint inherited from detail',
  amb.unchecked[0].hint.includes('kein fill'),
);

// =============================================================================
// no validator-side cap: large input passes through fully
// =============================================================================
console.log('--- no validator-side cap ---');

const many = [];
for (let i = 0; i < 25; i++)
  many.push({
    pass: false,
    id: `e${i}`,
    detail: `Fail ${i}`,
    constraintType: 'INSIDE',
  });
const big = arbitrate(many, []);
assert('25 failing → 25 in failing[]', big.failing.length === 25);
assert(
  '25 failing → totals.failing_count === 25',
  big.totals.failing_count === 25,
);
assert(
  'arbitrate output has no `suppressed` field (cap moved to prose)',
  big.suppressed === undefined,
);
assert(
  'arbitrate output has no `reported` field (legacy shape gone)',
  big.reported === undefined,
);

// =============================================================================
// diff severity sort
// =============================================================================
console.log('--- diff severity sort ---');

const unsortedDiff = [
  { type: 'NEU', id: 'n', cell: 'A1', color: 'red' },
  { type: 'VERSCHOBEN', id: 'v', from: 'A1', to: 'B2' },
  { type: 'ENTFERNT', id: 'e', cell: 'A1' },
  { type: 'FARBÄNDERUNG', id: 'f', from: 'red', to: 'blue' },
];
const sorted = arbitrate([], unsortedDiff);
assert(
  'diff[0] = VERSCHOBEN (severity 1)',
  sorted.diff[0].type === 'VERSCHOBEN',
);
assert(
  'diff[1] = FARBÄNDERUNG (severity 2)',
  sorted.diff[1].type === 'FARBÄNDERUNG',
);
assert('diff[2] = NEU (severity 3)', sorted.diff[2].type === 'NEU');
assert('diff[3] = ENTFERNT (severity 4)', sorted.diff[3].type === 'ENTFERNT');
assert('totals.diff_count === 4', sorted.totals.diff_count === 4);

// =============================================================================
// empty inputs
// =============================================================================
console.log('--- empty input ---');

const empty = arbitrate([], []);
assert('empty: passing[] = []', empty.passing.length === 0);
assert('empty: failing[] = []', empty.failing.length === 0);
assert('empty: unchecked[] = []', empty.unchecked.length === 0);
assert('empty: diff[] = []', empty.diff.length === 0);
assert('empty: totals.total = 0', empty.totals.total === 0);

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
