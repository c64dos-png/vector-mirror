/**
 * test_auto_ids.js - §1.3 Auto-ID Content-Addressed Hash-Namespace
 *
 * Verifiziert: src/core/sanitizer/auto_ids.js (Pure-Function-Generator).
 *   1. Disjointness — extractAutoIds(svgA) ∩ extractAutoIds(svgB) = ∅
 *      fuer zwei strukturell unverwandte SVGs (Cross-SVG-Leak D-004).
 *   2. Determinismus  — extractAutoIds(svgA) 10x hintereinander identisch.
 *   3. Regex-Match    — jede ID matcht /^_[0-9a-f]{8}_(rect|circle|...)\d+$/.
 *   4. Hexagonal-Check — auto_ids.js importiert NUR aus node:crypto;
 *      KEIN Import aus adapters/ oder interface/ (REGEL-4).
 *
 * Pattern-Vorlage: test_3d_detection.js (assert-Helper + summary-line).
 * NICHT browser-bound — Pure-Function, kein Playwright noetig.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  computeSvgHashPrefix,
  extractAutoIds,
  formatAutoId,
} from '../../src/core/sanitizer/auto_ids.js';
// §1.3 LAYER-TRENNUNG (Patch2, Sprint-β2): Format-Regex ist Domain-Vertrag und
// lebt in core/element_vocabulary.js. auto_ids.js ist pure Format-Layer und
// re-exportiert sie NICHT mehr (Mini-Review F-PATCH-CODEX-001+002 Konvergenz).
import { AUTO_ID_FORMAT_REGEX } from '../../src/core/element_vocabulary.js';

let passed = 0,
  failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

// ── Fixtures: zwei strukturell unverwandte SVGs ──────────────
// Unterschiedliche Tags, Attribut-Werte, Anzahl Elemente — bewusst
// breit gestreut, damit der Hash-Praefix mit hoher Sicherheit differiert.
const SVG_A = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect x="0" y="0" width="50" height="50" fill="red"/>
  <rect x="50" y="0" width="50" height="50" fill="green"/>
  <circle cx="25" cy="75" r="10" fill="blue"/>
</svg>`;

const SVG_B = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <path d="M10,10 L190,10 L190,190 Z" fill="orange"/>
  <text x="50" y="100" font-size="14">Hello</text>
  <ellipse cx="100" cy="150" rx="40" ry="20" fill="purple"/>
  <line x1="0" y1="0" x2="200" y2="200" stroke="black"/>
</svg>`;

// Tag-Sequenzen: was playwright.js fuer Elemente OHNE explizite id sammeln
// wuerde — identisch zur Browser-Iterationsreihenfolge.
const TAGS_A = ['rect', 'rect', 'circle'];
const TAGS_B = ['path', 'text', 'ellipse', 'line'];

// §1.3 LAYER-TRENNUNG (Patch2, Sprint-β2): Regex kommt direkt aus der SSOT
// (core/element_vocabulary.js — Domain-Layer). Patch1-Re-Export über auto_ids.js
// wurde in Patch2 entfernt (Layer-Trennung Domain↔Format, F-PATCH-CODEX-001+002).
// Inline-Definition war Drift-Quelle der ursprünglichen §1.3-Basis (`g`/`tspan`
// drin, `image` nicht — F-CODEX-002).
const AUTO_ID_REGEX = AUTO_ID_FORMAT_REGEX;

// ── Test 1: Disjointness ─────────────────────────────────────
console.log('--- AUTO-IDS: Disjointness (D-004 Cross-SVG-Leak) ---');
{
  const idsA = extractAutoIds(SVG_A, TAGS_A);
  const idsB = extractAutoIds(SVG_B, TAGS_B);
  assert('SVG_A produces 3 IDs', idsA.length === 3);
  assert('SVG_B produces 4 IDs', idsB.length === 4);
  const setA = new Set(idsA);
  const intersection = idsB.filter((id) => setA.has(id));
  assert(
    'idsA ∩ idsB = ∅ (disjoint hash-prefix namespaces)',
    intersection.length === 0,
    `intersection=${JSON.stringify(intersection)}`,
  );

  // Hash-Praefix-Differenz direkt belegen (stark genug fuer 32 bit):
  const prefixA = computeSvgHashPrefix(SVG_A);
  const prefixB = computeSvgHashPrefix(SVG_B);
  assert(
    'hash prefix A != hash prefix B',
    prefixA !== prefixB,
    `prefixA=${prefixA}, prefixB=${prefixB}`,
  );
}

// ── Test 2: Determinismus ────────────────────────────────────
console.log('--- AUTO-IDS: Determinismus (Pure-Function Hash-Stabilitaet) ---');
{
  const reference = extractAutoIds(SVG_A, TAGS_A);
  let allEqual = true;
  let mismatchAt = -1;
  for (let i = 0; i < 10; i++) {
    const again = extractAutoIds(SVG_A, TAGS_A);
    if (
      again.length !== reference.length ||
      again.some((id, idx) => id !== reference[idx])
    ) {
      allEqual = false;
      mismatchAt = i;
      break;
    }
  }
  assert(
    'extractAutoIds(SVG_A) 10x identisch',
    allEqual,
    mismatchAt >= 0 ? `divergiert bei run ${mismatchAt}` : '',
  );

  // Tag-lokaler monotoner Counter
  assert(
    'rect-Counter monoton (1, 2)',
    reference[0].endsWith('_rect1') && reference[1].endsWith('_rect2'),
    `got [${reference[0]}, ${reference[1]}]`,
  );
  assert(
    'circle-Counter startet bei 1 (tag-lokal)',
    reference[2].endsWith('_circle1'),
    `got ${reference[2]}`,
  );
}

// ── Test 3: Regex-Match ──────────────────────────────────────
console.log('--- AUTO-IDS: Regex-Match (Format-Garantie) ---');
{
  const idsA = extractAutoIds(SVG_A, TAGS_A);
  const idsB = extractAutoIds(SVG_B, TAGS_B);
  const all = [...idsA, ...idsB];
  const offenders = all.filter((id) => !AUTO_ID_REGEX.test(id));
  assert(
    `alle ${all.length} Auto-IDs matchen Regex /^_[0-9a-f]{8}_<tag>\\d+$/`,
    offenders.length === 0,
    `offenders=${JSON.stringify(offenders)}`,
  );

  // formatAutoId-Punkt-Test (Format-Helper-Vertrag)
  const sample = formatAutoId('deadbeef', 'rect', 7);
  assert(
    'formatAutoId baut _<hex>_<tag><n>',
    sample === '_deadbeef_rect7',
    `got ${sample}`,
  );
  assert(
    'formatAutoId-Output matcht Regex',
    AUTO_ID_REGEX.test(sample),
    `id=${sample}`,
  );
}

// ── Test 4: Hexagonal (REGEL-4) ──────────────────────────────
// Selbst-Inspektion: auto_ids.js darf NUR aus node:* importieren
// (oder relativen Pfaden in core/lib/). KEIN adapters/, KEIN interface/.
console.log('--- AUTO-IDS: Hexagonal (REGEL-4 Import-Disziplin) ---');
{
  const here = dirname(fileURLToPath(import.meta.url));
  const modulePath = resolve(here, '../../src/core/sanitizer/auto_ids.js');
  const src = readFileSync(modulePath, 'utf8');

  // Alle ES-import Statements lokalisieren (top-level only; das Modul hat
  // keine dynamic-import-Stellen).
  const importRe = /^\s*import\s+[^;]+?from\s+['"]([^'"]+)['"]/gm;
  const specifiers = [];
  let m;
  while ((m = importRe.exec(src)) !== null) {
    specifiers.push(m[1]);
  }
  assert(
    'mindestens 1 import-statement gefunden',
    specifiers.length >= 1,
    `specifiers=${JSON.stringify(specifiers)}`,
  );

  // Erlaubt: node:* sowie relative Pfade in core/ oder lib/ (NICHT
  // adapters/, NICHT interface/).
  const forbidden = specifiers.filter((spec) => {
    if (spec.startsWith('node:')) return false;
    if (spec.startsWith('./') || spec.startsWith('../')) {
      // relative Pfade absolut machen + auf adapters/interface pruefen
      const absolute = resolve(dirname(modulePath), spec);
      if (absolute.includes('/src/adapters/')) return true;
      if (absolute.includes('/src/interface/')) return true;
      return false;
    }
    // bare specifiers (z.B. zod, playwright) → externe deps verboten
    return true;
  });
  assert(
    'KEIN Import aus adapters/, interface/ oder externer Dep',
    forbidden.length === 0,
    `forbidden=${JSON.stringify(forbidden)}`,
  );

  // Konkrete Erwartung: node:crypto ist als einziger Import drin.
  assert(
    'node:crypto wird importiert',
    specifiers.includes('node:crypto'),
    `specifiers=${JSON.stringify(specifiers)}`,
  );
}

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
