/**
 * test_meta.js - Phase 2: Meta Tools + Pipeline parseConstraints Tests (Mutation-Resilient)
 * Tests getConstraintTypes, getStatus, parseConstraints, tool export structure.
 * BAUPLAN ref: Sektion 5 Cluster 4 (Meta), Pipeline parseConstraints
 *
 * MUTATION-TESTING DESIGN:
 * - Exact value assertions, not just truthiness
 * - Anti-mutation canaries for sign, boundary, enum
 * - parseConstraints: boundary cases (NaN, missing parts, CONSTRAINT prefix)
 * - Tool structure: verify all 6 tools exported with correct fields
 */
import {
  getConstraintTypes,
  getStatus,
  parseConstraints,
} from '../../src/pipeline.js';
import { tools } from '../../src/interface/tools.js';
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

// ── getConstraintTypes ──────────────────────────────────────

console.log('--- META: getConstraintTypes ---');
const ct = getConstraintTypes();

// Dual response structure
assertEqual('has prose string', typeof ct.prose, 'string');
assertEqual('has structured object', typeof ct.structured, 'object');
assertEqual(
  'structured has types array',
  Array.isArray(ct.structured.types),
  true,
);

// Exact count: 11 constraint types (10 BAUPLAN 4.4 + FILL from Phase 3a)
assertEqual('exactly 11 constraint types', ct.structured.types.length, 11);

// All known types present (mutation: removing one would change count + membership)
const typeNames = ct.structured.types.map((t) => t.type).sort();
const expectedTypes = [
  'ABOVE',
  'ALIGNED-LEFT',
  'ALIGNED-TOP',
  'CENTERED-IN',
  'COLOR',
  'DISTANCE-FROM',
  'FILL',
  'INSIDE',
  'LEFT-OF',
  'NO-OVERLAP',
  'SAME-SIZE',
].sort();
assertEqual(
  'all 11 types present',
  JSON.stringify(typeNames),
  JSON.stringify(expectedTypes),
);

// Each type has required fields
for (const t of ct.structured.types) {
  assertEqual(`${t.type} has syntax string`, typeof t.syntax, 'string');
  assertEqual(
    `${t.type} has hasArrange boolean`,
    typeof t.hasArrange,
    'boolean',
  );
}

// COLOR has no arrange (mutation: flipping boolean)
const colorType = ct.structured.types.find((t) => t.type === 'COLOR');
assertEqual('COLOR hasArrange is false', colorType.hasArrange, false);

// CENTERED-IN has arrange
const centeredType = ct.structured.types.find((t) => t.type === 'CENTERED-IN');
assertEqual('CENTERED-IN hasArrange is true', centeredType.hasArrange, true);

// Prose contains count
assertEqual('prose mentions count', ct.prose.includes('11'), true);

// ── getStatus ───────────────────────────────────────────────

console.log('--- META: getStatus ---');
const st = getStatus();

// Dual response structure
assertEqual('has prose string', typeof st.prose, 'string');
assertEqual('has structured object', typeof st.structured, 'object');

// Exact field values
assertEqual('version is 2.0.0', st.structured.version, '2.0.0');
assertNotEqual('version is not 1.0.0', st.structured.version, '1.0.0');
assertEqual(
  'browser is stopped (no init called)',
  st.structured.browser,
  'stopped',
);
assertEqual(
  'lastAnalysis is false (fresh start)',
  st.structured.lastAnalysis,
  false,
);
assertEqual('constraintTypes is 11', st.structured.constraintTypes, 11);

// Prose contains version
assertEqual('prose contains version', st.prose.includes('2.0.0'), true);

// ── parseConstraints ────────────────────────────────────────

console.log('--- PIPELINE: parseConstraints ---');

// Basic parsing
const basic = parseConstraints(['#sun CENTERED-IN #bg']);
assertEqual('basic: 1 result', basic.length, 1);
assertEqual('basic: type is CENTERED-IN', basic[0].type, 'CENTERED-IN');
assertEqual('basic: subject is sun (no #)', basic[0].subject, 'sun');
assertEqual('basic: reference is bg (no #)', basic[0].reference, 'bg');

// CONSTRAINT prefix stripped
const prefixed = parseConstraints(['CONSTRAINT #a NO-OVERLAP #b']);
assertEqual(
  'prefix stripped: type is NO-OVERLAP',
  prefixed[0].type,
  'NO-OVERLAP',
);
assertEqual('prefix stripped: subject is a', prefixed[0].subject, 'a');

// DISTANCE-FROM with value
const dist = parseConstraints(['#x DISTANCE-FROM #y 2.5']);
assertEqual('distance: type', dist[0].type, 'DISTANCE-FROM');
assertEqual('distance: value is 2.5', dist[0].value, 2.5);
assertEqual('distance: reference is y', dist[0].reference, 'y');

// §H10 R11-21: DISTANCE-FROM mit nicht-numerischem Wert wird VERWEIGERT
// (CONSTRAINT_UNPARSEABLE-Marker) statt still zu 1 fabriziert (alte ||-1-Lüge).
const distNaN = parseConstraints(['#x DISTANCE-FROM #y abc']);
assertEqual(
  'distance NaN: verweigert statt fabriziert',
  distNaN[0].type,
  'CONSTRAINT_UNPARSEABLE',
);
assertEqual('distance NaN: kein fabrizierter Wert', distNaN[0].value, undefined);

// DISTANCE-FROM ohne Wert-Token behaelt den Grammatik-Default 1 ([wert] optional).
const distDefault = parseConstraints(['#x DISTANCE-FROM #y']);
assertEqual('distance ohne Wert: Default 1', distDefault[0].value, 1);

// DISTANCE-FROM with 0 value -> || 1 means 0 becomes 1 (intentional per PROJEKTMAPPE)
const distZero = parseConstraints(['#x DISTANCE-FROM #y 0']);
assertEqual('distance 0: value becomes 0 (no longer 1)', distZero[0].value, 0);

// COLOR
const color = parseConstraints(['#box COLOR red']);
assertEqual('color: type is COLOR', color[0].type, 'COLOR');
assertEqual('color: subject is box', color[0].subject, 'box');
assertEqual('color: reference is null', color[0].reference, null);
assertEqual('color: value is red (lowercase)', color[0].value, 'red');

// COLOR value lowercased
const colorUpper = parseConstraints(['#box COLOR RED']);
assertEqual(
  'color uppercase: value lowercased to red',
  colorUpper[0].value,
  'red',
);

// Empty/non-array input
assertEqual('non-array returns empty', parseConstraints('not-array').length, 0);
assertEqual('null returns empty', parseConstraints(null).length, 0);
assertEqual('undefined returns empty', parseConstraints(undefined).length, 0);

// Multiple constraints
const multi = parseConstraints([
  '#a CENTERED-IN #b',
  '#c LEFT-OF #d',
  '#e COLOR blue',
]);
assertEqual('multi: 3 results', multi.length, 3);
assertEqual(
  'multi: types correct',
  multi.map((c) => c.type).join(','),
  'CENTERED-IN,LEFT-OF,COLOR',
);

// ── tools.js export structure ───────────────────────────────

console.log('--- TOOLS: Export Structure ---');
// §1.4: vector_mirror_bookmark additiv aufgenommen → 8 Tools (vorher 7).
// §1.9: vector_mirror_selftest additiv aufgenommen → 9 Tools (Eichkörper-Selftest).
assertEqual('tools array has 9 entries', tools.length, 9);

// All tool names present
const toolNames = tools.map((t) => t.name);
assertEqual('has analyze', toolNames.includes('vector_mirror_analyze'), true);
assertEqual('has compare', toolNames.includes('vector_mirror_compare'), true);
assertEqual('has bookmark', toolNames.includes('vector_mirror_bookmark'), true);
assertEqual('has inspect', toolNames.includes('vector_mirror_inspect'), true);
assertEqual('has palette', toolNames.includes('vector_mirror_palette'), true);
assertEqual(
  'has constraints',
  toolNames.includes('vector_mirror_constraints'),
  true,
);
assertEqual('has arrange', toolNames.includes('vector_mirror_arrange'), true);
assertEqual('has status', toolNames.includes('vector_mirror_status'), true);
// §1.9: 9. Tool — Eichkörper-Selftest (read-only, idempotent).
assertEqual('has selftest', toolNames.includes('vector_mirror_selftest'), true);

// Each tool has required structure
for (const t of tools) {
  assertEqual(`${t.name}: has config`, typeof t.config, 'object');
  assertEqual(`${t.name}: has handler function`, typeof t.handler, 'function');
  assertEqual(
    `${t.name}: has description`,
    typeof t.config.description,
    'string',
  );
  assertEqual(
    `${t.name}: has annotations`,
    typeof t.config.annotations,
    'object',
  );
  // §1.4: vector_mirror_bookmark ist das erste mutierende Tool (readOnlyHint:false,
  // mutiert den bookmarks-Store additiv). Die Universal-„read-only"-Invariante
  // über ALLE Tools gilt daher nicht mehr — bookmark wird hier ausgenommen und
  // unten explizit (readOnlyHint:false, idempotentHint:true) verifiziert.
  if (t.name !== 'vector_mirror_bookmark') {
    assertEqual(
      `${t.name}: readOnlyHint is true`,
      t.config.annotations.readOnlyHint,
      true,
    );
  }
  assertEqual(
    `${t.name}: destructiveHint is false`,
    t.config.annotations.destructiveHint,
    false,
  );
}

// §1.4: bookmark ist mutierend (read-write), aber idempotent (re-set unter
// gleichem Namen = newest, kein additiver Drift). Explizite Annotations-Asserts.
const bookmarkTool = tools.find((t) => t.name === 'vector_mirror_bookmark');
assertEqual(
  'bookmark readOnlyHint is false (mutiert bookmarks-Store)',
  bookmarkTool.config.annotations.readOnlyHint,
  false,
);
assertEqual(
  'bookmark IS idempotent (re-set = newest, kein Drift)',
  bookmarkTool.config.annotations.idempotentHint,
  true,
);
assertEqual(
  'bookmark destructiveHint is false',
  bookmarkTool.config.annotations.destructiveHint,
  false,
);

// compare and status are NOT idempotent (depend on lastGridMap state)
const compareTool = tools.find((t) => t.name === 'vector_mirror_compare');
assertEqual(
  'compare is NOT idempotent',
  compareTool.config.annotations.idempotentHint,
  false,
);
assertEqual(
  'compare description mentions VERSCHOBEN',
  compareTool.config.description.includes('VERSCHOBEN'),
  true,
);
assertEqual(
  'compare description mentions FARBÄNDERUNG',
  compareTool.config.description.includes('FARBÄNDERUNG'),
  true,
);
assertEqual(
  'compare description does not mention RESIZED',
  compareTool.config.description.includes('RESIZED'),
  false,
);
const statusTool = tools.find((t) => t.name === 'vector_mirror_status');
assertEqual(
  'status is NOT idempotent',
  statusTool.config.annotations.idempotentHint,
  false,
);

// analyze IS idempotent
const analyzeTool = tools.find((t) => t.name === 'vector_mirror_analyze');
assertEqual(
  'analyze IS idempotent',
  analyzeTool.config.annotations.idempotentHint,
  true,
);

// arrange IS idempotent (pure math, no state)
const arrangeTool = tools.find((t) => t.name === 'vector_mirror_arrange');
assertEqual(
  'arrange IS idempotent',
  arrangeTool.config.annotations.idempotentHint,
  true,
);
assertEqual(
  'arrange readOnlyHint',
  arrangeTool.config.annotations.readOnlyHint,
  true,
);

// FILL has arrange
const fillType = ct.structured.types.find((t) => t.type === 'FILL');
assertEqual('FILL hasArrange is true', fillType.hasArrange, true);

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
