/**
 * test_registry_custom.js - Phase 3a DELTA-09: Custom Constraint Registration
 * EK-5: Custom constraint can be registered, listed, checked, and arranged.
 */
import {
  registerConstraint,
  checkConstraint,
  arrangeConstraint,
  listConstraints,
} from '../../src/core/constraints/registry.js';
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

console.log('--- EK-5: Custom Constraint Registration ---');

// Register a custom constraint
registerConstraint('CUSTOM-TEST', {
  check(subj, ref, ctx) {
    return { pass: true, detail: 'custom check ok' };
  },
  arrange(subj, ref, ctx) {
    return { x: 42, y: 84 };
  },
});

// listConstraints contains custom type
const types = listConstraints();
const customType = types.find((t) => t.type === 'CUSTOM-TEST');
assertEqual('custom type registered', !!customType, true);
assertEqual('custom type hasArrange', customType.hasArrange, true);

// checkConstraint works for custom type
const subj = { id: 'a', bbox: { x: 0, y: 0, w: 50, h: 50 } };
const checkResult = checkConstraint('CUSTOM-TEST', subj, null, {
  grid: { cellW: 50, cellH: 50 },
});
assertEqual('custom check pass', checkResult.pass, true);
assertEqual('custom check detail', checkResult.detail, 'custom check ok');

// arrangeConstraint works for custom type
const arrangeResult = arrangeConstraint('CUSTOM-TEST', subj, null, {
  canvas: { width: 400, height: 300 },
});
assertEqual('custom arrange x=42', arrangeResult.x, 42);
assertEqual('custom arrange y=84', arrangeResult.y, 84);

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
