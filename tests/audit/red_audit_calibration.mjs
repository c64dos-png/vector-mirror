/**
 * RED AUDIT CALIBRATION SUITE v2
 *
 * Philosophy: Every test must have a Positive Control (Baseline OK) and a
 * Negative Control (Exploit/Failure state).
 * Improved: Added null-checks to catch expected architecture crashes gracefully.
 */
import assert from 'node:assert';
import * as pipeline from '../../src/pipeline.js';
import {
  resolve,
  createResolver,
} from '../../src/adapters/renderer/playwright.js';

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  return async () => {
    try {
      await fn();
      console.log('  ✓ [PASS] ' + name);
      passed++;
    } catch (err) {
      console.log('  ✗ [FAIL] ' + name);
      console.log('      Reason: ' + err.message);
      failed++;
    }
  };
}

async function runAll() {
  console.log('=== RED AUDIT CALIBRATION SUITE v2 ===\n');

  await pipeline.init();

  const tests = [
    runTest('G-11: Geometry 3D Transform Calibration', async () => {
      const page = await createResolver();

      const svg3D =
        '<svg width="100" height="100"><g style="transform: rotateX(45deg);"><rect id="rect3d" x="10" y="10" width="10" height="10" /></g></svg>';
      const res3D = await resolve(page, svg3D);
      const el3D = res3D.elements.find((e) => e.id === 'rect3d');

      assert.ok(el3D, '3D Element should be found');

      // The core test: Does the system flag this as unreliable?
      const isFlagged =
        el3D.bbox_reliability === 'not_measurable' ||
        (el3D.warnings && el3D.warnings.includes('3D_TRANSFORM_ANCESTOR'));

      assert.strictEqual(
        isFlagged,
        true,
        'System failed to flag 3D transform (ADR-026 Violation).',
      );

      // §1.4 FINDING-2 (Reviewer): KEIN closeResolver() hier. createResolver()
      // gibt eine eigene Page zurück, die G-11 direkt via resolve(page,...) nutzt;
      // closeResolver() schloss aber den SUITE-geteilten Browser, den pipeline.init()
      // (Z.32) hält. pipeline.js' Modul-`page` blieb als stale closed-Ref zurück →
      // der `if (!page) await init()`-Guard übersprang Re-Init → der nachfolgende
      // G-01/G-02-Test rendert gegen eine geschlossene Page → analyze.structured=null.
      // Teardown übernimmt pipeline.shutdown() am Suite-Ende (Z.~99). G-11-Assertion
      // unverändert (3D-Flagging-Test läuft identisch, bleibt grün).
    }),

    runTest('G-01/G-02: Named-Baseline (Bookmark) Roundtrip', async () => {
      // §1.4: Named-Baseline via Bookmark ersetzt den §1.1-entfernten most-recent-Leak.
      // Invariante (gleicher Input → 0 Diff) bleibt; Setup nun leak-frei (REGEL-2 gewahrt).
      const svgA =
        '<svg width="100" height="100"><circle id="A" cx="50" cy="50" r="10" fill="red"/></svg>';

      const idA = (await pipeline.analyze(svgA, [])).structured.iteration
        .analysisId;
      await pipeline.bookmark('audit_session_1', idA);
      const resCompare = await pipeline.compare(svgA, [], 'audit_session_1');

      if (!resCompare?.structured)
        throw new Error(
          'Bookmark-based compare returned null — named baseline broken.',
        );
      assert.strictEqual(
        resCompare.structured.diff.length,
        0,
        'Named-baseline compare: same input must yield 0 diffs.',
      );
    }),

    runTest('G-14: Arrange Transform Idempotence', async () => {
      const canvas = { width: 100, height: 100 };
      const offsetElements = [
        {
          id: 'a',
          tag: 'rect',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          transform: 'scale(1)',
        },
        { id: 'b', tag: 'rect', x: 20, y: 0, width: 10, height: 10 },
      ];

      // Step 1: Arrange once
      const res1 = pipeline.arrange(canvas, offsetElements, [
        '#a ALIGNED-LEFT #b',
      ]);
      const firstT = res1.structured.attributes['a'].transform;

      // Step 2: Feed back and move again
      offsetElements[0].transform = firstT;
      offsetElements[0].x = 10;
      const res2 = pipeline.arrange(canvas, offsetElements, [
        '#a ALIGNED-LEFT #b',
      ]);

      const finalT = res2.structured.attributes['a'].transform;
      const translateCount = (finalT.match(/translate/g) || []).length;

      assert.strictEqual(
        translateCount,
        1,
        'Idempotence failure: translate() tokens stacked. Found: ' + finalT,
      );
    }),
  ];

  for (const test of tests) {
    await test();
  }

  await pipeline.shutdown();
  console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
}

runAll()
  .then(() => {
    // DoD-8 / §G-KORR K1: fail-loud Exit. Ohne dies exitete die Suite IMMER 0
    // (catch(console.error)) und ein Calibration-Bruch wuerde still geschluckt
    // (Falsch-Gruen). Erfolg (failed===0) -> Exit 0, sonst Exit 1.
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    // Crash-vor-Zaehler (throw in Setup/runAll) -> hart rot, nie still gruen.
    console.error('Calibration-Ausnahme: ' + (err?.stack || err));
    process.exit(1);
  });
