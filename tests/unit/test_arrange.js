/**
 * test_arrange.js - Phase 3a: arrange() Pipeline Integration Tests (Mutation-Resilient)
 * Tests the full arrange pipeline: parseConstraints -> arrangeConstraint -> state updates -> output.
 * BAUPLAN ref: Sektion 6.4 (FILL + CENTERED-IN + ABOVE example)
 *
 * EK-4: CENTERED-IN arrange -> cx=200, cy=150 (Canvas 400x300)
 * EK-6: BAUPLAN 6.4 full example
 */
import { arrange, parseConstraints } from '../../src/pipeline.js';
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

// ── EK-4: CENTERED-IN arrange inverse ──────────────────────

console.log('--- ARRANGE: EK-4 CENTERED-IN inverse ---');
{
  const canvas = { width: 400, height: 300 };
  const elements = [
    { id: 'bg', tag: 'rect', width: 400, height: 300 },
    { id: 'sun', tag: 'circle', r: 30 },
  ];
  const constraints = ['#sun CENTERED-IN #bg'];
  const result = arrange(canvas, elements, constraints);

  assertEqual('EK-4: has structured', typeof result.structured, 'object');
  assertEqual('EK-4: has prose', typeof result.prose, 'string');
  assertEqual(
    'EK-4: sun in attributes',
    'sun' in result.structured.attributes,
    true,
  );

  const sun = result.structured.attributes.sun;
  assertEqual(
    'EK-4: sun uses delta translate',
    sun.transform,
    'translate(170 120)',
  );

  // Canary: NOT at origin
  assertNotEqual(
    'EK-4: transform is not zero',
    sun.transform,
    'translate(0 0)',
  );
}

// ── EK-6: BAUPLAN 6.4 full example (FILL + CENTERED-IN + ABOVE) ──

console.log('--- ARRANGE: EK-6 BAUPLAN 6.4 ---');
{
  const canvas = { width: 400, height: 300 };
  const elements = [
    { id: 'bg', tag: 'rect' },
    { id: 'sun', tag: 'circle', r: 30 },
    { id: 'label', tag: 'text', content: 'Hello' },
  ];
  const constraints = [
    '#bg FILL canvas',
    '#sun CENTERED-IN #bg',
    '#label ABOVE #sun',
  ];
  const result = arrange(canvas, elements, constraints);
  const attrs = result.structured.attributes;

  // bg should fill canvas
  assertEqual('EK-6: bg x=0', attrs.bg.x, 0);
  assertEqual('EK-6: bg y=0', attrs.bg.y, 0);
  assertEqual('EK-6: bg width=400', attrs.bg.width, 400);
  assertEqual('EK-6: bg height=300', attrs.bg.height, 300);

  // sun centered in bg via delta translate
  assertEqual('EK-6: sun transform', attrs.sun.transform, 'translate(170 120)');

  // text is moved vertically above the centered sun
  assertEqual(
    'EK-6: label transform',
    attrs.label.transform,
    'translate(0 120)',
  );

  assertEqual('EK-6: no warnings', result.structured.warnings.length, 0);
}

// ── Sequential override semantics ──────────────────────────

console.log('--- ARRANGE: Sequential override ---');
{
  const canvas = { width: 400, height: 300 };
  const elements = [
    { id: 'bg', tag: 'rect', width: 400, height: 300 },
    { id: 'a', tag: 'rect', width: 50, height: 50 },
    { id: 'b', tag: 'rect', width: 50, height: 50 },
  ];
  // a is placed left of b, then b is placed left of a — order matters
  const constraints = ['#a ALIGNED-LEFT #bg', '#b ALIGNED-LEFT #a'];
  const result = arrange(canvas, elements, constraints);
  const attrs = result.structured.attributes;

  // Both are already aligned; arrange should not invent a translate
  assertEqual('seq: a no translate needed', attrs.a.transform, undefined);
  assertEqual('seq: b no translate needed', attrs.b.transform, undefined);
}

// ── Error: unknown element ──────────────────────────────────

console.log('--- ARRANGE: Unknown element warning ---');
{
  const canvas = { width: 400, height: 300 };
  const elements = [{ id: 'bg', tag: 'rect', width: 400, height: 300 }];
  const constraints = ['#ghost CENTERED-IN #bg'];
  const result = arrange(canvas, elements, constraints);

  assertEqual('unknown: 1 warning', result.structured.warnings.length, 1);
  assertEqual(
    'unknown: warning mentions ghost',
    result.structured.warnings[0].includes('ghost'),
    true,
  );
  assertEqual(
    'unknown: no attributes for ghost',
    'ghost' in result.structured.attributes,
    false,
  );
}

// ── Error: duplicate IDs ────────────────────────────────────

console.log('--- ARRANGE: Duplicate ID warning ---');
{
  const canvas = { width: 400, height: 300 };
  const elements = [
    { id: 'dup', tag: 'rect', width: 50, height: 50 },
    { id: 'dup', tag: 'circle', r: 20 },
  ];
  const constraints = ['#dup CENTERED-IN #dup'];
  const result = arrange(canvas, elements, constraints);

  // §H10 R11-11: die Selbst-Referenz (#dup CENTERED-IN #dup) wird jetzt
  // ZUSÄTZLICH verweigert (Identitäts-Wache) → 2 Warnungen statt 1, und es
  // entsteht KEIN Geister-attributes-Eintrag mehr (vorher: dup → {}).
  assertEqual('duplicate: 2 warnings', result.structured.warnings.length, 2);
  assertEqual(
    'duplicate: warning mentions mehrfach',
    result.structured.warnings[0].includes('mehrfach'),
    true,
  );
  assertEqual(
    'duplicate: self-ref warning mentions Selbst-Referenz',
    result.structured.warnings[1].includes('Selbst-Referenz'),
    true,
  );
  assertEqual(
    'duplicate: kein Geister-Eintrag fuer verweigerte Selbst-Referenz',
    result.structured.attributes.dup,
    undefined,
  );
}

// ── Error: constraint without arrange (COLOR) ───────────────

console.log('--- ARRANGE: COLOR has no arrange ---');
{
  const canvas = { width: 400, height: 300 };
  const elements = [{ id: 'box', tag: 'rect', width: 50, height: 50 }];
  const constraints = ['#box COLOR red'];
  const result = arrange(canvas, elements, constraints);

  // COLOR has no arrange function — should not crash, should not produce attributes
  assertEqual(
    'color: no attributes for box',
    'box' in result.structured.attributes,
    false,
  );
  // No warning for COLOR (special case — design decision)
  assertEqual('color: no warning', result.structured.warnings.length, 0);
}

// ── SAME-SIZE arrange ───────────────────────────────────────

console.log('--- ARRANGE: SAME-SIZE ---');
{
  const canvas = { width: 400, height: 300 };
  const elements = [
    { id: 'a', tag: 'rect', width: 100, height: 80 },
    { id: 'b', tag: 'rect', width: 50, height: 40 },
  ];
  const constraints = ['#b SAME-SIZE #a'];
  const result = arrange(canvas, elements, constraints);
  const attrs = result.structured.attributes;

  assertEqual('same-size: b width=100', attrs.b.width, 100);
  assertEqual('same-size: b height=80', attrs.b.height, 80);
}

// ── FILL arrange ────────────────────────────────────────────

console.log('--- ARRANGE: FILL ---');
{
  const canvas = { width: 500, height: 400 };
  const elements = [{ id: 'bg', tag: 'rect' }];
  const constraints = ['#bg FILL canvas'];
  const result = arrange(canvas, elements, constraints);
  const attrs = result.structured.attributes;

  assertEqual('fill: bg x=0', attrs.bg.x, 0);
  assertEqual('fill: bg y=0', attrs.bg.y, 0);
  assertEqual('fill: bg width=500', attrs.bg.width, 500);
  assertEqual('fill: bg height=400', attrs.bg.height, 400);
}

// ── Canary: sign mutations ──────────────────────────────────

console.log('--- ARRANGE: Sign mutation canaries ---');
{
  const canvas = { width: 400, height: 300 };
  const elements = [
    { id: 'bg', tag: 'rect', width: 400, height: 300 },
    { id: 'sun', tag: 'circle', r: 30 },
  ];
  const constraints = ['#sun CENTERED-IN #bg'];
  const result = arrange(canvas, elements, constraints);
  const sun = result.structured.attributes.sun;

  // If signs are flipped, the translate would contain negative offsets
  assertEqual(
    'canary: transform is positive delta',
    sun.transform,
    'translate(170 120)',
  );
  assertNotEqual('canary: transform not zero', sun.transform, 'translate(0 0)');
}

// ── parseConstraints FILL ───────────────────────────────────

console.log('--- PARSE: FILL constraint ---');
{
  const parsed = parseConstraints(['#bg FILL canvas']);
  assertEqual('fill parse: type', parsed[0].type, 'FILL');
  assertEqual('fill parse: subject', parsed[0].subject, 'bg');
  assertEqual('fill parse: reference is null', parsed[0].reference, null);
}

// ── F-001 Fix: r-Patch updates BBox state ───────────────────

console.log('--- ARRANGE: F-001 r-Patch BBox propagation ---');
{
  // Custom constraint returning {r: 50} should update BBox for next constraint
  // We test indirectly: circle with r=30, after CENTERED-IN, BBox should reflect r
  const canvas = { width: 400, height: 300 };
  const elements = [
    { id: 'bg', tag: 'rect', width: 400, height: 300 },
    { id: 'dot', tag: 'circle', r: 30 },
    { id: 'label', tag: 'text', content: 'X' },
  ];
  // dot centered in bg, then label above dot — label.y depends on dot's BBox
  const constraints = ['#dot CENTERED-IN #bg', '#label ABOVE #dot'];
  const result = arrange(canvas, elements, constraints);
  const attrs = result.structured.attributes;

  // dot centered: cx=200, cy=150 → BBox: x=170, y=120, w=60, h=60
  // label above dot: y = dot.bbox.y - label.bbox.h = 120 - 0 = 120
  assertEqual(
    'F-001: dot translated to center',
    attrs.dot.transform,
    'translate(170 120)',
  );
  assertEqual(
    'F-001: label translated to propagated top',
    attrs.label.transform,
    'translate(0 120)',
  );
}

// ── F-4 Fix: NO-OVERLAP guard for non-overlapping elements ──

console.log('--- ARRANGE: F-4 NO-OVERLAP no-op for separated elements ---');
{
  const canvas = { width: 400, height: 300 };
  const elements = [
    { id: 'a', tag: 'rect', width: 50, height: 50 },
    { id: 'b', tag: 'rect', width: 50, height: 50 },
  ];
  // a and b both start at (0,0) — they overlap
  // ALIGNED-LEFT sets a.x=0 (same as b.x), still overlapping
  // NO-OVERLAP should separate them via shortest escape
  const constraints = ['#a ALIGNED-LEFT #b', '#a NO-OVERLAP #b'];
  const result = arrange(canvas, elements, constraints);
  const attrs = result.structured.attributes;

  // After ALIGNED-LEFT: a at (0,0,50,50), b at (0,0,50,50) — full overlap
  // NO-OVERLAP escapes: dxL=50, dxR=-50, dyT=50, dyB=-50 → all abs=50
  // reduce(a.abs < b.abs ? a : b) → ties keep last → dyB={dx:0, dy:-50}
  // a.x = 0 + 0 = 0, a.y = 0 + (-50) = -50
  assertEqual('F-4: a translate', attrs.a.transform, 'translate(0 -50)');
}

// ── F-1 Fix: DISTANCE-FROM cellW with clamp for edge cases ──

console.log('--- ARRANGE: F-1 DISTANCE-FROM cellW clamp ---');
{
  // Very small canvas (100px) — clamp(4,16, round(100/50))=4, cellW=25
  // Both elements start at (0,0), identical → dist=0 → push right
  // minDist = 1 * 25 = 25, targetX = 0 + 20 + 25 = 45
  const canvas = { width: 100, height: 100 };
  const elements = [
    { id: 'a', tag: 'rect', width: 20, height: 20 },
    { id: 'b', tag: 'rect', width: 20, height: 20 },
  ];
  const constraints = ['#a DISTANCE-FROM #b 1'];
  const result = arrange(canvas, elements, constraints);
  const attrs = result.structured.attributes;

  assertEqual('F-1: a translate', attrs.a.transform, 'translate(45 0)');
}

// ── F-1 Fix: Large canvas clamp ─────────────────────────────

console.log('--- ARRANGE: F-1 DISTANCE-FROM large canvas clamp ---');
{
  // Very large canvas (1000px) — clamp(4,16, round(1000/50))=16, cellW=62.5
  // Both start at (0,0), identical → push right
  // minDist = 1 * 62.5 = 62.5, targetX = 0 + 20 + 62.5 = 82.5
  const canvas = { width: 1000, height: 1000 };
  const elements = [
    { id: 'a', tag: 'rect', width: 20, height: 20 },
    { id: 'b', tag: 'rect', width: 20, height: 20 },
  ];
  const constraints = ['#a DISTANCE-FROM #b 1'];
  const result = arrange(canvas, elements, constraints);
  const attrs = result.structured.attributes;

  assertEqual('F-1 large: a translate', attrs.a.transform, 'translate(82.5 0)');
}

// ── Order-sensitivity test (F-5/F-007) ──────────────────────

console.log('--- ARRANGE: Order-sensitivity semantics ---');
{
  const canvas = { width: 400, height: 300 };
  const elements = [
    { id: 'bg', tag: 'rect', width: 400, height: 300 },
    { id: 'a', tag: 'rect', width: 60, height: 60 },
    { id: 'b', tag: 'rect', width: 60, height: 60 },
  ];
  // Order A: a left-of bg, b left-of a
  const r1 = arrange(canvas, elements, ['#a LEFT-OF #bg', '#b LEFT-OF #a']);
  // Order B: b left-of bg, a left-of b
  const r2 = arrange(canvas, elements, ['#b LEFT-OF #bg', '#a LEFT-OF #b']);

  // Results should differ because order determines which element is placed first
  const a1t = r1.structured.attributes.a?.transform;
  const a2t = r2.structured.attributes.a?.transform;
  assertNotEqual(
    'order-sensitivity: different order gives different a.transform',
    a1t,
    a2t,
  );
}

// ── Delta-translate regression: intrinsic offsets ───────────

console.log('--- ARRANGE: Delta translate for intrinsic offsets ---');
{
  const canvas = { width: 400, height: 600 };
  const elements = [
    { id: 'bg', tag: 'rect', width: 400, height: 600 },
    { id: 'ln', tag: 'line', width: 100, height: 0, x: 10, y: 20 },
  ];
  const result = arrange(canvas, elements, ['#ln CENTERED-IN #bg']);

  assertEqual(
    'delta: line uses bbox-relative translate',
    result.structured.attributes.ln.transform,
    'translate(140 280)',
  );
}

// ── Delta-translate regression: preserve non-translate order ─

console.log('--- ARRANGE: Preserve transform order around translate ---');
{
  const canvas = { width: 400, height: 600 };
  const elements = [
    { id: 'bg', tag: 'rect', width: 400, height: 600 },
    {
      id: 'ln',
      tag: 'line',
      width: 100,
      height: 0,
      x: 10,
      y: 20,
      transform: 'rotate(45) translate(5 6) scale(2)',
    },
  ];
  const result = arrange(canvas, elements, ['#ln CENTERED-IN #bg']);

  assertEqual(
    'transform order: replace translate in place',
    result.structured.attributes.ln.transform,
    'rotate(45) translate(140 280) scale(2)',
  );
}

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
