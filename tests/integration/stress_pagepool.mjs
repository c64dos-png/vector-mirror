/**
 * stress_pagepool.mjs — FIX_PLAN §1.3 Stop-Conditions (Closure-Verification)
 *
 * Drei Stop-Conditions aus FIX_PLAN.md §1.3:
 *   (a) 8 parallele Calls (rot-only vs blau-only) → 0 Cross-Kontamination
 *       in corrections-Output. Numerisch falsifizierbar via dx-Vorzeichen.
 *   (b) 100 sequenzielle Calls → Heap-Wachstum <+50 MB.
 *       RECYCLE_AFTER muss messbar gefeuert haben (≥2 fires bei N=100, ra=33).
 *   (c) NEU-4-Reproducer Sign-Flip — verifiziert in tests/audit/red_audit_reproducers.mjs.
 *
 * Methodik (b): node --expose-gc; global.gc()×2 vor Sampling (V8 generationsbasiert).
 *
 * Run: node --expose-gc tests/integration/stress_pagepool.mjs
 */

import { analyze, init, shutdown } from '../../src/pipeline.js';
import {
  __getPageMetrics,
  __setRecycleAfter,
  RECYCLE_AFTER,
} from '../../src/adapters/renderer/playwright.js';

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
function assertTrue(label, cond, detail = '') {
  if (cond) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

// Identische IDs (#a, #bg), gegensätzliche Geometrie.
// rot:  subj-Center (10,10), ref-Center (100,100) → CENTERED-IN-Korrektur dx=+90, dy=+90
// blau: subj-Center (190,190), ref-Center (100,100) → CENTERED-IN-Korrektur dx=-90, dy=-90
const SVG_ROT =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">' +
  '<rect id="bg" x="0" y="0" width="200" height="200" fill="red"/>' +
  '<circle id="a" cx="10" cy="10" r="5" fill="red"/>' +
  '</svg>';
const SVG_BLAU =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">' +
  '<rect id="bg" x="0" y="0" width="200" height="200" fill="blue"/>' +
  '<circle id="a" cx="190" cy="190" r="5" fill="blue"/>' +
  '</svg>';
const CONSTRAINT = ['#a CENTERED-IN #bg'];

if (typeof global.gc !== 'function') {
  console.error(
    'FAIL: dieser Test braucht --expose-gc. Bitte mit `node --expose-gc ...` aufrufen.',
  );
  process.exit(2);
}

await init();

try {
  // ── (a) STRESS — 8 parallele Streams, dx-Vorzeichen-Assertion ────────────
  console.log('\n--- (a) STRESS: 8 parallele Streams (4×rot + 4×blau) ---');
  const streams = [];
  for (let i = 0; i < 4; i++) streams.push({ kind: 'rot', svg: SVG_ROT });
  for (let i = 0; i < 4; i++) streams.push({ kind: 'blau', svg: SVG_BLAU });

  const results = await Promise.all(
    streams.map((s) => analyze(s.svg, CONSTRAINT)),
  );

  assertEqual(
    'alle 8 Streams haben structured-Output',
    results.filter((r) => r.structured).length,
    8,
  );

  // Eindeutigkeit der analysisIds (Map-LRU-Garantie unter Last)
  const ids = new Set(results.map((r) => r.structured.iteration.analysisId));
  assertEqual('8 unique analysisIds (keine Kollision)', ids.size, 8);

  // dx-Vorzeichen-Assertion pro Stream (Magnitude pixel-skaliert; geprüft ist nur das
  // Vorzeichen — Cross-Kontamination manifestierte sich als Vorzeichen-Flip).
  // Zusätzlich Symmetrie: |dx_rot[i]| === |dx_blau[j]| (geometrisch gespiegelt).
  const dxByKind = { rot: [], blau: [] };
  for (let i = 0; i < 8; i++) {
    const r = results[i];
    const kind = streams[i].kind;
    const corr = r.structured?.corrections ?? [];
    assertEqual(`stream[${i}] (${kind}): genau 1 correction`, corr.length, 1);
    if (corr.length === 1) {
      assertEqual(
        `stream[${i}] (${kind}): correction.element === '#a'`,
        corr[0].element,
        '#a',
      );
      const expectSign = kind === 'rot' ? +1 : -1;
      assertTrue(
        `stream[${i}] (${kind}): sign(dx) === ${expectSign} (kein Cross-Vorzeichen)`,
        Math.sign(corr[0].dx) === expectSign,
        `dx=${corr[0].dx}`,
      );
      assertTrue(
        `stream[${i}] (${kind}): sign(dy) === ${expectSign} (kein Cross-Vorzeichen)`,
        Math.sign(corr[0].dy) === expectSign,
        `dy=${corr[0].dy}`,
      );
      dxByKind[kind].push(Math.abs(corr[0].dx));
    }
  }

  // Magnitude-Konsistenz innerhalb und zwischen Stream-Klassen (gespiegelte Geometrie):
  const allMagnitudes = [...dxByKind.rot, ...dxByKind.blau];
  const uniqueMag = new Set(allMagnitudes);
  assertEqual(
    '|dx| ist konsistent über alle 8 Streams (gespiegelte Geometrie)',
    uniqueMag.size,
    1,
  );

  // ── (b) HEAP — 100 sequenzielle Calls, RECYCLE_AFTER=33 → 3 fires ────────
  console.log('\n--- (b) HEAP: 100 sequenzielle Calls (recycleAfter=33) ---');
  __setRecycleAfter(33);

  // Warm-up: einmal laufen lassen, GC-Bias minimieren
  await analyze(SVG_ROT, CONSTRAINT);
  global.gc();
  global.gc();
  const heapBefore = process.memoryUsage().heapUsed;
  const metricsBefore = __getPageMetrics();

  for (let i = 0; i < 100; i++) {
    // Alternierend, damit ID-Continuity-Pfad geübt wird
    await analyze(i % 2 === 0 ? SVG_ROT : SVG_BLAU, CONSTRAINT);
  }

  // Idle für Background-GC, dann forced GC ×2 (V8 young+old)
  await new Promise((r) => setTimeout(r, 500));
  global.gc();
  global.gc();
  const heapAfter = process.memoryUsage().heapUsed;
  const metricsAfter = __getPageMetrics();

  const heapDeltaMB = (heapAfter - heapBefore) / (1024 * 1024);
  const recycleDelta = metricsAfter.recycles - metricsBefore.recycles;

  console.log(`  heapBefore: ${(heapBefore / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  heapAfter:  ${(heapAfter / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  delta:      ${heapDeltaMB.toFixed(2)} MB`);
  console.log(
    `  recycles:   ${recycleDelta} (recycleAfter=33, N=100 → erwartet 3)`,
  );

  assertTrue(
    `Heap-Wachstum <+50 MB (delta=${heapDeltaMB.toFixed(2)} MB)`,
    heapDeltaMB < 50,
  );
  assertTrue(
    `RECYCLE_AFTER hat ≥2× gefeuert (recycles=${recycleDelta})`,
    recycleDelta >= 2,
  );

  // Restore default für ggf. nachfolgende Tests in derselben Suite
  __setRecycleAfter(RECYCLE_AFTER);
} finally {
  await shutdown();
}

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
