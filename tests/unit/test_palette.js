/**
 * test_palette.js - EK-1: Color Verification (W3C Standard)
 * Tests rgbToColorName from lib/palette.js
 * Vector Mirror v2.0
 */
import { rgbToColorName } from '../../src/lib/palette.js';

let passed = 0,
  failed = 0;

function assert(label, actual, expected) {
  if (actual === expected) {
    console.log(`  PASS: ${label} -> ${actual}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label} -> ${actual} (erwartet: ${expected})`);
    failed++;
  }
}

console.log('--- EK-1: FARB-VERIFIKATION (W3C Standard) ---');
assert('(255, 0, 0)', rgbToColorName(255, 0, 0), 'red');
assert('(135, 206, 235)', rgbToColorName(135, 206, 235), 'skyblue');
assert('(0, 0, 255)', rgbToColorName(0, 0, 255), 'blue');
assert('(255, 255, 255)', rgbToColorName(255, 255, 255), 'white');
assert('(0, 0, 0)', rgbToColorName(0, 0, 0), 'black');
assert('(255, 215, 0)', rgbToColorName(255, 215, 0), 'gold');

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
