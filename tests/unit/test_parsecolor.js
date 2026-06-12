/**
 * test_parsecolor.js - AF-05: parseColor Path Coverage
 * Tests all 4 paths: transparent, gradient, rgb(), fallback.
 * Vector Mirror v2.0
 */
import { parseColor } from '../../src/lib/palette.js';

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

// Path 1: Transparent (null, none, rgba(0,0,0,0))
console.log('--- parseColor: transparent ---');
assert('null', parseColor(null), 'transparent');
assert('undefined', parseColor(undefined), 'transparent');
assert('empty string', parseColor(''), 'transparent');
assert('none', parseColor('none'), 'transparent');
assert('rgba(0,0,0,0)', parseColor('rgba(0, 0, 0, 0)'), 'transparent');

// Path 2: Gradient
console.log('--- parseColor: gradient ---');
assert('url(#grad)', parseColor('url(#gradient1)'), 'gradient');
assert('url(linear)', parseColor('url(#linear-grad)'), 'gradient');

// Path 3: RGB parsing
console.log('--- parseColor: rgb ---');
assert('rgb(255,0,0)', parseColor('rgb(255, 0, 0)'), 'red');
assert('rgb(0,0,255)', parseColor('rgb(0, 0, 255)'), 'blue');
assert('rgb(255,255,255)', parseColor('rgb(255, 255, 255)'), 'white');
assert('rgba(255,215,0,1)', parseColor('rgba(255, 215, 0, 1)'), 'gold');

// Path 4: Hex-Quantisierung (§H9 K-08a: Hex wird in DENSELBEN Namensraum
// quantisiert wie rgb() — der frühere pass-through war die Wurzel des
// COLOR-False-Negatives, Rekalibrierung auf die wahre Form).
console.log('--- parseColor: hex ---');
assert('hex #rrggbb', parseColor('#ff0000'), 'red');
assert('hex #rgb', parseColor('#f00'), 'red');
assert('hex case-insensitiv', parseColor('#FF0000'), 'red');

// Path 5: Fallback (pass-through)
console.log('--- parseColor: fallback ---');
assert('named color', parseColor('red'), 'red');
assert('unbekannter Token pass-through', parseColor('blurple'), 'blurple');

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
