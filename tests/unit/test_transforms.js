/**
 * test_transforms.js — Sprint §1.5 Block F: lib/transforms.js Token-Algebra
 *
 * Verifiziert die ZWEI bewusst getrennten Translate-Merge-Semantiken (R-A-Auflösung):
 *   1. buildTransform   (REPLACE-IN-PLACE) — Erhalt der arrange-Semantik.
 *      Empirie-Anker: test_arrange.js:428 'rotate(45) translate(5 6) scale(2)'
 *      → 'rotate(45) translate(140 280) scale(2)'.
 *   2. prependTranslate (FRONT-PREPEND) — §1.5-Position-Fix, Welt-Koordinate.
 *      Stop-Cond C6: <path transform='scale(2)'> Fix → Output beginnt mit 'translate('.
 *   3. Idempotenz (G-14): wiederholte Anwendung mit gleichem dx/dy ist Fixpunkt
 *      (bestehende translate-Tokens werden vorher entfernt).
 *
 * Pure ES-Module-Inspektion, NICHT browser-bound.
 */
import {
  buildTransform,
  hasTranslateTransform,
  prependTranslate,
} from '../../src/lib/transforms.js';

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

function assertTrue(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

// ── hasTranslateTransform ───────────────────────────────────
console.log('--- TRANSFORMS: hasTranslateTransform ---');
assertEqual('detects translate', hasTranslateTransform('translate(1 2)'), true);
assertEqual(
  'detects translateX',
  hasTranslateTransform('foo translateX(3)'),
  true,
);
assertEqual('no translate in scale', hasTranslateTransform('scale(2)'), false);
assertEqual('null is false', hasTranslateTransform(null), false);
assertEqual('undefined is false', hasTranslateTransform(undefined), false);
assertEqual('empty is false', hasTranslateTransform(''), false);

// ── buildTransform: REPLACE-IN-PLACE (arrange-Semantik) ─────
console.log('--- TRANSFORMS: buildTransform (replace-in-place, arrange) ---');
assertEqual(
  'empty → bare translate',
  buildTransform('', 5, 10),
  'translate(5 10)',
);
assertEqual(
  'undefined → bare translate',
  buildTransform(undefined, 5, 10),
  'translate(5 10)',
);
assertEqual(
  'scale → translate prepended (no existing translate, insertAt=0)',
  buildTransform('scale(2)', 5, 10),
  'translate(5 10) scale(2)',
);
// KERN-ANKER der arrange-Semantik (test_arrange.js:428): bestehender translate
// wird AN SEINER POSITION ersetzt, NICHT front-prepended.
assertEqual(
  'rotate translate scale → replace translate IN PLACE',
  buildTransform('rotate(45) translate(5 6) scale(2)', 140, 280),
  'rotate(45) translate(140 280) scale(2)',
);
assertEqual(
  'scale then translate → translate stays after scale (NOT front)',
  buildTransform('scale(2) translate(1 1)', 7, 8),
  'scale(2) translate(7 8)',
);

// ── prependTranslate: FRONT-PREPEND (§1.5-Position-Fix) ─────
console.log('--- TRANSFORMS: prependTranslate (front-prepend, §1.5) ---');
assertEqual(
  'empty → bare translate',
  prependTranslate('', 5, 10),
  'translate(5 10)',
);
assertEqual(
  'undefined → bare translate',
  prependTranslate(undefined, 5, 10),
  'translate(5 10)',
);
// C6: scale → translate FRONT (Output beginnt mit translate()).
assertEqual(
  'scale → translate FRONT-prepended',
  prependTranslate('scale(2)', 5, 10),
  'translate(5 10) scale(2)',
);
assertTrue(
  'C6: scale(2) fix output begins with translate(',
  prependTranslate('scale(2)', -192, 0).startsWith('translate('),
  prependTranslate('scale(2)', -192, 0),
);
// KERN-UNTERSCHIED zu buildTransform: hier wird IMMER front-prepended, auch
// wenn ein translate hinter scale stand.
assertEqual(
  'scale then translate → translate moves to FRONT (≠ buildTransform)',
  prependTranslate('scale(2) translate(1 1)', 7, 8),
  'translate(7 8) scale(2)',
);
assertEqual(
  'rotate translate scale → translate FRONT, rest order kept',
  prependTranslate('rotate(45) translate(5 6) scale(2)', 140, 280),
  'translate(140 280) rotate(45) scale(2)',
);

// ── Idempotenz (G-14) ───────────────────────────────────────
console.log('--- TRANSFORMS: Idempotenz (G-14) ---');
{
  // buildTransform: zweimal gleiches dx/dy → Fixpunkt.
  const once = buildTransform('rotate(45) translate(5 6) scale(2)', 140, 280);
  const twice = buildTransform(once, 140, 280);
  assertEqual('buildTransform idempotent (G-14)', twice, once);
}
{
  // prependTranslate: zweimal gleiches dx/dy → Fixpunkt (existing translate
  // wird vorher entfernt, kein Doppel-translate).
  const once = prependTranslate('scale(2)', -192, 0);
  const twice = prependTranslate(once, -192, 0);
  assertEqual('prependTranslate idempotent (G-14)', twice, once);
  assertTrue(
    'prependTranslate no double-translate after re-apply',
    (twice.match(/translate\(/g) || []).length === 1,
    twice,
  );
}

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
