/**
 * test_grid.js - AF-06: mapToGridMap Unit Tests
 * Tests grid mapping without browser/Playwright dependency.
 * Vector Mirror v2.0
 */
import { mapToGridMap } from '../../src/core/grid.js';

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

// Mock resolved object (what Playwright would return).
//
// §1.3 Auto-ID + F-SVG-007 Mock-Drift-Mit-Pflege (Sprint-β2 OD-β2-1 GO (a)):
// Die hardcoded ids 'box1' / 'box2' / 'txt1' simulieren SVG-Elemente MIT
// expliziter id-Attribut — diese werden vom Renderer 1:1 durchgereicht (kein
// Auto-ID-Format-Wechsel). bbox_reliability ist seit §1.2b L-003 Pflichtfeld
// im elementSchema und wird vom Renderer immer gesetzt; hier ergaenzt, damit
// der Mock dem Schema-Vertrag entspricht (verhindert Mock-Drift bei kuenftiger
// .strict()-Promotion in §1.10 oder Konsistenz-Pass).
const resolved = {
  canvas: { width: 400, height: 200, vbX: 0, vbY: 0, viewBox: '0 0 400 200' },
  elements: [
    {
      id: 'box1',
      tag: 'rect',
      bbox: { x: 10, y: 10, w: 30, h: 30 },
      fill: 'rgb(255, 0, 0)',
      stroke: 'none',
      opacity: 1,
      textContent: null,
      bbox_reliability: 'reliable',
    },
    {
      id: 'box2',
      tag: 'rect',
      bbox: { x: 200, y: 100, w: 50, h: 50 },
      fill: 'rgb(0, 0, 255)',
      stroke: 'rgb(0, 0, 0)',
      opacity: 1,
      textContent: null,
      bbox_reliability: 'reliable',
    },
    {
      id: 'txt1',
      tag: 'text',
      bbox: { x: 100, y: 50, w: 80, h: 20 },
      fill: 'rgb(0, 0, 0)',
      stroke: 'none',
      opacity: 1,
      textContent: 'Hello',
      bbox_reliability: 'reliable',
    },
  ],
};

console.log('--- GRID: Basic Mapping ---');
const gm = mapToGridMap(resolved);
assert('returns canvas', gm.canvas === resolved.canvas);
assert(
  'returns grid with cellW',
  typeof gm.grid.cellW === 'number' && gm.grid.cellW > 0,
);
assert(
  'returns grid with cellH',
  typeof gm.grid.cellH === 'number' && gm.grid.cellH > 0,
);
assert('maps 3 elements', gm.elements.length === 3);

console.log('--- GRID: Element Properties ---');
const el0 = gm.elements[0];
assert('id preserved', el0.id === 'box1');
assert('tag preserved', el0.tag === 'rect');
assert(
  'cell is string',
  typeof el0.cell === 'string' && /^[A-P]\d+$/.test(el0.cell),
);
assert('direction assigned', typeof el0.direction === 'string');
assert('color parsed from fill', el0.color === 'red');
assert('bbox preserved', el0.bbox.x === 10);
assert('cx computed', el0.cx === 25);
assert('cy computed', el0.cy === 25);

console.log('--- GRID: Color Parsing ---');
const el1 = gm.elements[1];
assert('blue parsed', el1.color === 'blue');
assert('stroke parsed', el1.stroke === 'black');

console.log('--- GRID: Text Content ---');
const el2 = gm.elements[2];
assert('textContent preserved', el2.textContent === 'Hello');

console.log('--- GRID: Cell Positions ---');
// box1 at (25, 25) in a 400x200 canvas → grid ~8x4 → cellW=50, cellH=50
// col = floor(25/50) = 0 → A, row = floor(25/50) = 0 → 1 → A1
assert('box1 in column A', el0.cell.startsWith('A'));
// box2 at (225, 125) → col = floor(225/50) = 4 → E, row = floor(125/50) = 2 → 3 → E3
assert('box2 in later column', el1.cell.charAt(0) >= 'D');

console.log('--- GRID: Span Detection ---');
// box2 is 50x50 at (200,100) → might span 1-2 cells
// Not asserting exact span, just that it's null or a valid span string
assert(
  'span is null or valid',
  el1.span === null || /^[A-P]\d+-[A-P]\d+$/.test(el1.span),
);

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
