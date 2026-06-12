/**
 * test_schema.js - Phase 2: Zod Schema Validation Tests
 * Tests that schemas accept valid input and reject invalid input.
 * BAUPLAN ref: Sektion 5 (Tools), 7.2 (SDK-Pattern)
 */
import { z } from 'zod';
import {
  analyzeInput,
  analyzeOutput,
  arrangeInput,
  arrangeOutput,
  bookmarkInput,
  bookmarkOutput,
  compareInput,
  elementSchema,
  inspectInput,
  inspectOutput,
  paletteInput,
  paletteOutput,
  constraintsOutput,
  statusOutput,
} from '../../src/interface/schema.js';

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

function validates(label, schema, data) {
  try {
    z.object(schema).parse(data);
    assert(label, true);
  } catch (e) {
    console.log(`  FAIL: ${label} — ${e.errors?.[0]?.message || e.message}`);
    failed++;
  }
}

function rejects(label, schema, data) {
  try {
    z.object(schema).parse(data);
    console.log(`  FAIL: ${label} — expected rejection`);
    failed++;
  } catch {
    assert(label, true);
  }
}

// ── analyzeInput ────────────────────────────────────────────

console.log('--- SCHEMA: analyzeInput ---');
validates('accepts svg only', analyzeInput, { svg: '<svg></svg>' });
validates('accepts svg + constraints', analyzeInput, {
  svg: '<svg></svg>',
  constraints: ['#sun CENTERED-IN #bg'],
});
validates('accepts svg + constraints + previousIssueCount', analyzeInput, {
  svg: '<svg></svg>',
  constraints: ['#sun CENTERED-IN #bg'],
  previousIssueCount: 3,
});
rejects('rejects missing svg', analyzeInput, {});
rejects('rejects non-string svg', analyzeInput, { svg: 123 });
rejects('rejects non-array constraints', analyzeInput, {
  svg: '<svg></svg>',
  constraints: 'not-array',
});
rejects('rejects negative previousIssueCount', analyzeInput, {
  svg: '<svg></svg>',
  previousIssueCount: -1,
});

// ── compareInput ────────────────────────────────────────────

console.log('--- SCHEMA: compareInput ---');
// §1.4: compareInput.analysisId akzeptiert jetzt UUID ODER Bookmark-Name (Disjunktion).
// Der frühere `rejects('... invalid UUID format', { analysisId: 'not-a-uuid' })`
// ist SUPERSEDED — 'not-a-uuid' ist jetzt ein valider Bookmark-Name. Vertrag
// wird daher zum permissiven min(1) migriert; §1.1-Invariante (Pflichtfeld,
// kein .optional()) BLEIBT — leerer/fehlender Wert wird weiter abgelehnt.
const COMPARE_UUID = '11111111-1111-4111-8111-111111111111';
validates('accepts svg + analysisId (UUID)', compareInput, {
  svg: '<svg></svg>',
  analysisId: COMPARE_UUID,
});
validates('accepts svg + analysisId (Bookmark-Name)', compareInput, {
  svg: '<svg></svg>',
  analysisId: 'baseline',
});
validates('accepts svg + constraints + analysisId', compareInput, {
  svg: '<svg></svg>',
  constraints: ['#a NO-OVERLAP #b'],
  analysisId: COMPARE_UUID,
});
rejects('rejects missing svg', compareInput, { analysisId: COMPARE_UUID });
// §1.4: Disjunktion akzeptiert Name ODER UUID — beide Pfade explizit getestet.
validates('accepts Bookmark-Name as analysisId', compareInput, {
  svg: '<svg></svg>',
  analysisId: 'audit_session_1',
});
// §1.1-Invariante bleibt: analysisId ist Pflichtfeld (kein impliziter Default).
rejects('rejects empty analysisId (min(1))', compareInput, {
  svg: '<svg></svg>',
  analysisId: '',
});
rejects('rejects compare without analysisId (Pflichtfeld §1.1)', compareInput, {
  svg: '<svg></svg>',
});

// ── bookmarkInput / bookmarkOutput (§1.4) ───────────────────
// §1.4: compareInput.analysisId akzeptiert jetzt UUID ODER Bookmark-Name (Disjunktion).
// Die WRITE-seitige Disambiguierung lebt in bookmarkInput.name: UUID-Form verboten
// (Negative-Lookahead) → Keyspaces (grids=UUID, bookmarks=Name) bleiben disjunkt.
console.log('--- SCHEMA: bookmarkInput + bookmarkOutput (§1.4) ---');
const BOOKMARK_UUID = 'a1b2c3d4-e5f6-4789-89ab-cdef01234567';
validates('bookmarkInput accepts valid name + UUID', bookmarkInput, {
  name: 'baseline',
  analysisId: BOOKMARK_UUID,
});
validates('bookmarkInput accepts name with _ . - and digits', bookmarkInput, {
  name: 'audit_session_1.v2-rc',
  analysisId: BOOKMARK_UUID,
});
// UUID-förmiger Name (Hex-Letter-Start a-f) MUSS abgelehnt werden — sonst
// Keyspace-Kollision mit grids. Empirie: abcdef01-…-… träfe ohne Lookahead beide.
rejects('bookmarkInput rejects UUID-form name (letter-start)', bookmarkInput, {
  name: 'abcdef01-1234-4567-89ab-cdef01234567',
  analysisId: BOOKMARK_UUID,
});
rejects('bookmarkInput rejects UUID-form name (digit-start)', bookmarkInput, {
  name: '11111111-1111-4111-8111-111111111111',
  analysisId: BOOKMARK_UUID,
});
rejects('bookmarkInput rejects name starting with digit', bookmarkInput, {
  name: '1baseline',
  analysisId: BOOKMARK_UUID,
});
rejects('bookmarkInput rejects empty name', bookmarkInput, {
  name: '',
  analysisId: BOOKMARK_UUID,
});
rejects('bookmarkInput rejects missing analysisId', bookmarkInput, {
  name: 'baseline',
});
rejects('bookmarkInput rejects invalid analysisId (not UUID)', bookmarkInput, {
  name: 'baseline',
  analysisId: 'not-a-uuid',
});
validates('bookmarkOutput accepts valid stored result', bookmarkOutput, {
  name: 'baseline',
  analysisId: BOOKMARK_UUID,
  stored: true,
  bookmarkCount: 1,
});
validates(
  'bookmarkOutput accepts error-path shape (stored false)',
  bookmarkOutput,
  {
    name: '',
    analysisId: BOOKMARK_UUID,
    stored: false,
    bookmarkCount: 0,
  },
);
rejects('bookmarkOutput rejects non-UUID analysisId', bookmarkOutput, {
  name: 'baseline',
  analysisId: 'not-a-uuid',
  stored: true,
  bookmarkCount: 1,
});
rejects('bookmarkOutput rejects negative bookmarkCount', bookmarkOutput, {
  name: 'baseline',
  analysisId: BOOKMARK_UUID,
  stored: true,
  bookmarkCount: -1,
});
rejects('bookmarkOutput rejects missing stored', bookmarkOutput, {
  name: 'baseline',
  analysisId: BOOKMARK_UUID,
  bookmarkCount: 1,
});

// ── inspectInput / paletteInput ─────────────────────────────

console.log('--- SCHEMA: inspectInput + paletteInput ---');
validates('inspect accepts svg', inspectInput, { svg: '<svg></svg>' });
rejects('inspect rejects missing svg', inspectInput, {});
validates('palette accepts svg', paletteInput, { svg: '<svg></svg>' });
rejects('palette rejects missing svg', paletteInput, {});

// ── arrangeInput / arrangeOutput ────────────────────────────

console.log('--- SCHEMA: arrangeInput + arrangeOutput ---');
validates('arrange accepts valid canvas/elements/constraints', arrangeInput, {
  canvas: { width: 400, height: 300 },
  elements: [
    { id: 'bg', tag: 'rect', width: 400, height: 300 },
    { id: 'sun', tag: 'circle', r: 30 },
  ],
  constraints: ['#sun CENTERED-IN #bg'],
});
validates('arrange accepts optional x/y/transform', arrangeInput, {
  canvas: { width: 400, height: 300 },
  elements: [
    {
      id: 'ln',
      tag: 'line',
      width: 100,
      height: 0,
      x: 10,
      y: 20,
      transform: 'rotate(45)',
    },
  ],
  constraints: ['#ln CENTERED-IN #ln'],
});
rejects('arrange rejects duplicate element ids', arrangeInput, {
  canvas: { width: 400, height: 300 },
  elements: [
    { id: 'dup', tag: 'rect', width: 50, height: 50 },
    { id: 'dup', tag: 'circle', r: 20 },
  ],
  constraints: ['#dup CENTERED-IN #dup'],
});
validates('arrangeOutput accepts attributes and warnings', arrangeOutput, {
  attributes: {
    sun: { cx: 200, cy: 150 },
  },
  warnings: [],
});
rejects('arrangeOutput rejects missing warnings', arrangeOutput, {
  attributes: {},
});

// ── analyzeOutput ───────────────────────────────────────────
// SSOT FIX_PLAN §1.1 (R1-F01): iteration carries
// {sequence, previous_issues, current_issues, total_issues,
//  returned_issues, suppressed, convergence}; status enum
// includes PARTIAL; analyzeOutput requires top-level `unchecked`.

// FIX_PLAN §1.3 Schicht 2: analysisId REQUIRED in iterationSchema (Server-Garantie).
// Default ist eine valide UUID v4 als Placeholder; Override pro Test moeglich.
const VALID_UUID_V4 = '11111111-1111-4111-8111-111111111111';
const iter = (overrides = {}) => ({
  sequence: 1,
  previous_issues: 0,
  current_issues: 0,
  total_issues: 0,
  returned_issues: 0,
  suppressed: 0,
  convergence: 'SOLVED',
  analysisId: VALID_UUID_V4,
  ...overrides,
});

console.log('--- SCHEMA: analyzeOutput ---');
validates('accepts valid PASS output (clean)', analyzeOutput, {
  status: 'PASS',
  iteration: iter(),
  scene: {
    width: 400,
    height: 200,
    grid: '8x4',
    elements: [
      {
        id: 'sun',
        tag: 'circle',
        cell: 'E2',
        color: 'gold',
        status: 'ok',
        // §1.2b L-003 Pflicht-Promotion: bbox_reliability ist required.
        bbox_reliability: 'reliable',
      },
    ],
  },
  corrections: [],
  unchecked: [],
  diff: [],
});
rejects('rejects invalid status', analyzeOutput, {
  status: 'MAYBE',
  iteration: iter(),
  scene: { width: 400, height: 200, grid: '8x4', elements: [] },
  corrections: [],
  unchecked: [],
  diff: [],
});
rejects('rejects invalid convergence', analyzeOutput, {
  status: 'PASS',
  iteration: iter({ convergence: 'UNKNOWN' }),
  scene: { width: 400, height: 200, grid: '8x4', elements: [] },
  corrections: [],
  unchecked: [],
  diff: [],
});

// ── analyzeOutput: tri-state PARTIAL eichkörper ─────────────
// Stop-Condition §1.1: Eichkoerper-SVG mit unchecked=1, failing=0
// produziert status:'PARTIAL' und passiert das Schema.

console.log('--- SCHEMA: analyzeOutput (PARTIAL Eichkörper) ---');
validates('accepts PARTIAL status (unchecked=1, failing=0)', analyzeOutput, {
  status: 'PARTIAL',
  iteration: iter({
    current_issues: 0, // failingCount
    total_issues: 1, // failing + unchecked
    returned_issues: 1,
    convergence: 'STAGNATING',
  }),
  scene: {
    width: 100,
    height: 100,
    grid: '4x4',
    elements: [
      {
        id: 'sun',
        tag: 'circle',
        cell: 'B2',
        color: 'gold',
        status: 'warn',
        // §1.2b L-003 Pflicht-Promotion: bbox_reliability ist required.
        bbox_reliability: 'reliable',
      },
    ],
  },
  corrections: [],
  unchecked: [
    {
      element: '#sun',
      constraint: 'INSIDE-OUTSIDE',
      reasonCategory: 'CONSTRAINT_UNKNOWN',
      reasonCode: 'CONSTRAINT_TYPE_UNKNOWN',
      hint: 'Constraint not registered',
    },
  ],
  diff: [],
});
validates('PARTIAL accepts suggestedCorrection in unchecked', analyzeOutput, {
  status: 'PARTIAL',
  iteration: iter({
    total_issues: 1,
    returned_issues: 1,
    convergence: 'STAGNATING',
  }),
  scene: { width: 100, height: 100, grid: '4x4', elements: [] },
  corrections: [],
  unchecked: [
    {
      element: '#sun',
      constraint: 'CENTRED-IN',
      reasonCategory: 'TYPO',
      reasonCode: 'CONSTRAINT_TYPE_UNKNOWN',
      hint: 'Did you mean CENTERED-IN?',
      suggestedCorrection: 'CENTERED-IN',
    },
  ],
  diff: [],
});
rejects('rejects unchecked entry without reasonCode', analyzeOutput, {
  status: 'PARTIAL',
  iteration: iter({ total_issues: 1, returned_issues: 1 }),
  scene: { width: 100, height: 100, grid: '4x4', elements: [] },
  corrections: [],
  unchecked: [
    { element: '#sun', constraint: 'X', reasonCategory: 'Y', hint: 'Z' },
  ],
  diff: [],
});
rejects('rejects analyzeOutput missing unchecked field', analyzeOutput, {
  status: 'PASS',
  iteration: iter(),
  scene: { width: 0, height: 0, grid: '0x0', elements: [] },
  corrections: [],
  diff: [],
});
rejects('rejects iteration missing total_issues', analyzeOutput, {
  status: 'PASS',
  iteration: {
    sequence: 1,
    previous_issues: 0,
    current_issues: 0,
    returned_issues: 0,
    suppressed: 0,
    convergence: 'SOLVED',
  },
  scene: { width: 0, height: 0, grid: '0x0', elements: [] },
  corrections: [],
  unchecked: [],
  diff: [],
});

// ── analyzeOutput: boundary + mutation canaries ─────────────

console.log('--- SCHEMA: analyzeOutput (boundary) ---');
validates('FAIL status accepted', analyzeOutput, {
  status: 'FAIL',
  iteration: iter({
    sequence: 2,
    previous_issues: 3,
    current_issues: 1,
    total_issues: 1,
    returned_issues: 1,
    convergence: 'IMPROVING',
  }),
  scene: { width: 400, height: 200, grid: '8x4', elements: [] },
  corrections: [
    { element: '#sun', constraint: 'CENTERED-IN', reference: '#bg', dx: -24 },
  ],
  unchecked: [],
  diff: [{ type: 'VERSCHOBEN', id: 'bg', from: 'A1', to: 'B2' }],
});
rejects('rejects element status not in enum', analyzeOutput, {
  status: 'PASS',
  iteration: iter(),
  scene: {
    width: 400,
    height: 200,
    grid: '8x4',
    elements: [
      { id: 'x', tag: 'rect', cell: 'A1', color: 'red', status: 'broken' },
    ],
  },
  corrections: [],
  unchecked: [],
  diff: [],
});
// All 5 convergence values accepted (§H9 K-12: + BASELINE = Erstlauf mit
// Issues, keine Trend-Behauptung — Schema-Emitter-Lockstep).
for (const conv of [
  'IMPROVING',
  'STAGNATING',
  'DIVERGING',
  'SOLVED',
  'BASELINE',
]) {
  validates(`convergence ${conv} accepted`, analyzeOutput, {
    status: 'PASS',
    iteration: iter({ convergence: conv }),
    scene: { width: 400, height: 200, grid: '8x4', elements: [] },
    corrections: [],
    unchecked: [],
    diff: [],
  });
}
// Nicht-Katalog-Wert must be rejected
rejects('convergence REGRESSING rejected', analyzeOutput, {
  status: 'PASS',
  iteration: iter({ convergence: 'REGRESSING' }),
  scene: { width: 400, height: 200, grid: '8x4', elements: [] },
  corrections: [],
  unchecked: [],
  diff: [],
});
// Status enum: PASS/FAIL/PARTIAL accepted, 4th rejected
for (const st of ['PASS', 'FAIL', 'PARTIAL']) {
  validates(`status ${st} accepted`, analyzeOutput, {
    status: st,
    iteration: iter(),
    scene: { width: 0, height: 0, grid: '0x0', elements: [] },
    corrections: [],
    unchecked: [],
    diff: [],
  });
}
rejects('status SOLVED rejected (not in enum)', analyzeOutput, {
  status: 'SOLVED',
  iteration: iter(),
  scene: { width: 0, height: 0, grid: '0x0', elements: [] },
  corrections: [],
  unchecked: [],
  diff: [],
});

// ── analyzeOutput: analysisId-Vertrag (Schicht 2, Server-Garantie) ──────────
console.log('--- SCHEMA: analyzeOutput (analysisId Vertrag) ---');
// REQUIRED: fehlt analysisId, Schema lehnt ab.
rejects(
  'rejects iteration missing analysisId (Server-Garantie)',
  analyzeOutput,
  {
    status: 'PASS',
    iteration: {
      sequence: 1,
      previous_issues: 0,
      current_issues: 0,
      total_issues: 0,
      returned_issues: 0,
      suppressed: 0,
      convergence: 'SOLVED',
      // analysisId fehlt absichtlich
    },
    scene: { width: 0, height: 0, grid: '0x0', elements: [] },
    corrections: [],
    unchecked: [],
    diff: [],
  },
);
// UUID v4 Format: invalid String wird abgelehnt.
rejects('rejects analysisId with invalid UUID format', analyzeOutput, {
  status: 'PASS',
  iteration: iter({ analysisId: 'not-a-uuid' }),
  scene: { width: 0, height: 0, grid: '0x0', elements: [] },
  corrections: [],
  unchecked: [],
  diff: [],
});
// Valides UUID v4 → akzeptiert.
validates('accepts valid UUID v4 analysisId', analyzeOutput, {
  status: 'PASS',
  iteration: iter({ analysisId: 'a1b2c3d4-e5f6-4789-89ab-cdef01234567' }),
  scene: { width: 0, height: 0, grid: '0x0', elements: [] },
  corrections: [],
  unchecked: [],
  diff: [],
});

// ── inspectOutput ───────────────────────────────────────────

console.log('--- SCHEMA: inspectOutput ---');
validates('accepts valid inspect output', inspectOutput, {
  scene: {
    width: 400,
    height: 200,
    grid: '8x4',
    // §E1 D-008 (F-TF-008): suppressed ist required (wie analyze iteration).
    suppressed: 0,
    elements: [
      {
        id: 'bg',
        tag: 'rect',
        cell: 'A1',
        color: 'blue',
        status: 'ok',
        // §1.2b L-003 Pflicht-Promotion: bbox_reliability ist required.
        bbox_reliability: 'reliable',
      },
    ],
  },
});
rejects('rejects inspect without scene', inspectOutput, {});
rejects('rejects inspect with missing elements', inspectOutput, {
  scene: { width: 400, height: 200, grid: '8x4', suppressed: 0 },
});
// §E1 D-008 (F-TF-008): suppressed ist required — Fehlen ist Schema-Bruch
// (verhindert Regression in die stille Trunkierungs-Luege).
rejects('rejects inspect scene without suppressed', inspectOutput, {
  scene: {
    width: 400,
    height: 200,
    grid: '8x4',
    elements: [
      {
        id: 'bg',
        tag: 'rect',
        cell: 'A1',
        color: 'blue',
        status: 'ok',
        bbox_reliability: 'reliable',
      },
    ],
  },
});

// ── paletteOutput ───────────────────────────────────────────

console.log('--- SCHEMA: paletteOutput ---');
validates('accepts valid palette output', paletteOutput, {
  colors: [{ id: 'sun', fill: 'gold', stroke: null }],
});
validates('accepts palette with non-null stroke', paletteOutput, {
  colors: [{ id: 'box', fill: 'red', stroke: 'black' }],
});
rejects('rejects palette without colors array', paletteOutput, {});
rejects('rejects palette color without id', paletteOutput, {
  colors: [{ fill: 'gold', stroke: null }],
});

// ── constraintsOutput ───────────────────────────────────────

console.log('--- SCHEMA: constraintsOutput ---');
validates('accepts valid constraints output', constraintsOutput, {
  types: [
    {
      type: 'CENTERED-IN',
      syntax: '#subject CENTERED-IN #reference',
      hasArrange: true,
    },
  ],
});
validates('accepts hasArrange false', constraintsOutput, {
  types: [
    { type: 'COLOR', syntax: '#subject COLOR farbname', hasArrange: false },
  ],
});
rejects('rejects constraint type without hasArrange', constraintsOutput, {
  types: [{ type: 'COLOR', syntax: '#subject COLOR farbname' }],
});

// ── statusOutput ────────────────────────────────────────────
// SSOT FIX_PLAN §1.2 (R2-F01): statusOutput tracks emitter — `breaker`
// is null when render-breaker not initialized, else full opossum stats
// (10 fields). Schema follows emitter, R1-F03 (§2.2.1) reduction is
// phase-2 NACHRANGIG.

const breakerStatsSample = {
  name: 'renderBreaker',
  state: 'closed',
  fires: 0,
  successes: 0,
  failures: 0,
  timeouts: 0,
  rejects: 0,
  fallbacks: 0,
  semaphoreRejections: 0,
  latencyMean: 0,
};

console.log('--- SCHEMA: statusOutput ---');
validates('accepts running status with breaker:null', statusOutput, {
  version: '2.0.0',
  browser: 'running',
  lastAnalysis: true,
  constraintTypes: 10,
  breaker: null,
});
validates('accepts stopped status with breaker:null', statusOutput, {
  version: '2.0.0',
  browser: 'stopped',
  lastAnalysis: false,
  constraintTypes: 10,
  breaker: null,
});
validates('accepts running status with full breaker stats', statusOutput, {
  version: '2.0.0',
  browser: 'running',
  lastAnalysis: true,
  constraintTypes: 10,
  breaker: breakerStatsSample,
});
for (const state of ['closed', 'open', 'half-open']) {
  validates(`breaker.state ${state} accepted`, statusOutput, {
    version: '2.0.0',
    browser: 'running',
    lastAnalysis: true,
    constraintTypes: 10,
    breaker: { ...breakerStatsSample, state },
  });
}
rejects('rejects invalid browser state', statusOutput, {
  version: '2.0.0',
  browser: 'crashed',
  lastAnalysis: true,
  constraintTypes: 10,
  breaker: null,
});
rejects('rejects missing version', statusOutput, {
  browser: 'running',
  lastAnalysis: true,
  constraintTypes: 10,
  breaker: null,
});
rejects('rejects non-boolean lastAnalysis', statusOutput, {
  version: '2.0.0',
  browser: 'running',
  lastAnalysis: 'yes',
  constraintTypes: 10,
  breaker: null,
});
rejects('rejects breaker.state not in enum', statusOutput, {
  version: '2.0.0',
  browser: 'running',
  lastAnalysis: true,
  constraintTypes: 10,
  breaker: { ...breakerStatsSample, state: 'tripped' },
});
rejects('rejects statusOutput missing breaker field', statusOutput, {
  version: '2.0.0',
  browser: 'running',
  lastAnalysis: true,
  constraintTypes: 10,
});

// ── elementSchema 3D-Detection-Felder (§1.2b L-004) ─────────
// SSOT: BRIEFING §3 Block C — Schema-Vertrag direkt testen (elementSchema
// als Export ab §1.2b verfügbar). Migrations-Reihenfolge: 3 Positiv/Reject-
// Tests laufen schon vor L-003 (Schema noch .optional()); der 4. Test
// "missing field" wird erst NACH L-003 (.optional() entfernt) grün —
// an internal spec Begründung. Pattern: validates/rejects nehmen die
// "shape"-Dict, weil sie intern z.object(schema) bauen — daher
// elementSchema.shape (z.object exposes raw shape dict).

console.log('--- SCHEMA: elementSchema 3D-Detection-Felder (§1.2b) ---');
const elementBase = {
  id: 'r1',
  tag: 'rect',
  cell: 'A1',
  color: '#fff',
  status: 'ok',
};
validates(
  'elementSchema accepts reliable without warnings',
  elementSchema.shape,
  {
    ...elementBase,
    bbox_reliability: 'reliable',
  },
);
validates(
  'elementSchema accepts not_measurable with warnings',
  elementSchema.shape,
  {
    ...elementBase,
    id: 'r2',
    bbox_reliability: 'not_measurable',
    warnings: ['3D_TRANSFORM_ANCESTOR'],
  },
);
rejects('elementSchema rejects bbox_reliability unknown', elementSchema.shape, {
  ...elementBase,
  id: 'r3',
  bbox_reliability: 'unknown',
});
// NACH L-003: bbox_reliability ist Pflicht — fehlendes Feld muss reject geben.
rejects(
  'elementSchema rejects missing bbox_reliability (after L-003 promotion)',
  elementSchema.shape,
  {
    ...elementBase,
    id: 'r4',
    // bbox_reliability fehlt absichtlich
  },
);

// ── §HEAL-R6 Variante 1: 3-wertiger paint_visible-Vertrag (F-AT-6-07) ─────────
// Die MCP-outputSchema MUSS false UND 'indeterminate' akzeptieren — sonst verwirft
// die SDK das B4-Signal zur LAUFZEIT. true ist NICHT zulässig (absent statt true).
console.log('--- SCHEMA: §HEAL-R6 paint_visible 3-wertig ---');
validates('elementSchema accepts paint_visible:false', elementSchema.shape, {
  ...elementBase,
  id: 'pv1',
  bbox_reliability: 'reliable',
  paint_visible: false,
  warnings: ['PAINT_NOT_VISIBLE'],
});
validates(
  "elementSchema accepts paint_visible:'indeterminate'",
  elementSchema.shape,
  {
    ...elementBase,
    id: 'pv2',
    bbox_reliability: 'reliable',
    paint_visible: 'indeterminate',
    warnings: ['PAINT_PRESENCE_INDETERMINATE'],
  },
);
validates('elementSchema accepts absent paint_visible', elementSchema.shape, {
  ...elementBase,
  id: 'pv3',
  bbox_reliability: 'reliable',
});
rejects(
  'elementSchema rejects paint_visible:true (absent statt true)',
  elementSchema.shape,
  {
    ...elementBase,
    id: 'pv4',
    bbox_reliability: 'reliable',
    paint_visible: true,
  },
);
rejects(
  'elementSchema rejects paint_visible unknown string',
  elementSchema.shape,
  {
    ...elementBase,
    id: 'pv5',
    bbox_reliability: 'reliable',
    paint_visible: 'maybe',
  },
);

// ── §1.5 Transform-Fallback Schema-Härtung (Block E / C5) ────
// fixSchema.attribute ist von z.string() auf z.enum gehärtet. Die toxischen
// Größen-Literale dw/dh sind NICHT in der Enum → <path dw=...> ist
// schemamechanisch unmöglich (C5). transform + tspan-natives dx/dy sind erlaubt.
console.log('--- SCHEMA: §1.5 fixSchema.attribute Enum (C5) ---');

function outputWithFix(fix, extra = {}) {
  return {
    status: 'FAIL',
    iteration: iter({ current_issues: 1, total_issues: 1 }),
    scene: {
      width: 400,
      height: 200,
      grid: '8x4',
      elements: [
        {
          id: 'p1',
          tag: 'path',
          cell: 'D4',
          color: 'red',
          status: 'fail',
          bbox_reliability: 'reliable',
        },
      ],
    },
    corrections: [
      {
        element: '#p1',
        tag: 'path',
        constraint: 'LEFT-OF',
        reference: '#anchor',
        ...extra,
        ...(fix ? { fix } : {}),
      },
    ],
    unchecked: [],
    diff: [],
  };
}

validates(
  'C5: fix.attribute="transform" passes enum',
  analyzeOutput,
  outputWithFix({
    attribute: 'transform',
    current: '',
    target: 'translate(-192 0)',
    warning: 'CSS transform property may override this attribute',
  }),
);
validates(
  'C5: fix.attribute="dx" passes enum (tspan-native relative shift)',
  analyzeOutput,
  outputWithFix({ attribute: 'dx', current: '0', target: '-30' }),
);
validates(
  'C5: whitelist fix.attribute="cx" still passes enum',
  analyzeOutput,
  outputWithFix({ attribute: 'cx', current: '200', target: '176' }),
);
rejects(
  'C5: fix.attribute="dw" REJECTED (toxic size literal, never valid)',
  analyzeOutput,
  outputWithFix({ attribute: 'dw', current: '100', target: '80' }),
);
rejects(
  'C5: fix.attribute="dh" REJECTED (toxic size literal, never valid)',
  analyzeOutput,
  outputWithFix({ attribute: 'dh', current: '50', target: '40' }),
);
rejects(
  'C5: arbitrary fix.attribute string rejected (enum closed)',
  analyzeOutput,
  outputWithFix({ attribute: 'garbage', current: '0', target: '1' }),
);
validates(
  'C3: correction.reason=SIZE_FIX_UNSUPPORTED_FOR_TAG passes',
  analyzeOutput,
  outputWithFix(null, { dw: -20, reason: 'SIZE_FIX_UNSUPPORTED_FOR_TAG' }),
);
rejects(
  'correction.reason unknown enum value rejected',
  analyzeOutput,
  outputWithFix(null, { reason: 'TOTALLY_MADE_UP' }),
);

// elementSchema: parent_id/parent_tag optional acceptance (Block E / befund_3).
console.log('--- SCHEMA: §1.5 elementSchema parent_id/parent_tag ---');
validates(
  'elementSchema accepts parent_id + parent_tag (tspan)',
  elementSchema.shape,
  {
    ...elementBase,
    id: 'ts1',
    tag: 'tspan',
    bbox_reliability: 'reliable',
    parent_id: 't1',
    parent_tag: 'text',
  },
);
validates(
  'elementSchema accepts element WITHOUT parent fields (optional)',
  elementSchema.shape,
  {
    ...elementBase,
    id: 'r5',
    bbox_reliability: 'reliable',
  },
);

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
