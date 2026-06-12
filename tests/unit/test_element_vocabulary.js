/**
 * test_element_vocabulary.js — Drift-Tests für SSOT-Element-Vokabular
 * Sprint-β2 §1.3 LAYER-TRENNUNG (Patch2).
 *
 * Verifiziert: src/core/element_vocabulary.js
 *   1. Disjunktheit Spotter-Set ∩ SKIP_TAGS = ∅
 *      → 4-Listen-Drift mechanisch ausgeschlossen.
 *   2. Subset DELTA_ATTRIBUTABLE_TAGS ⊆ Spotter-Set (via isSpotterTag)
 *      → Spotter-Fix-Tags sind auch Auto-ID-fähig.
 *   3. F-CODEX-002-Reproducer + F-OPUS-MINI-001-Coverage:
 *      AUTO_ID_FORMAT_REGEX matcht `image`/`tspan`/`a`/`switch`/`textpath`/
 *      `foreignobject`-Auto-IDs UND matcht NICHT `g`-Auto-ID.
 *      Patch3-Case-Konvention: kanonische Auto-IDs sind lowercase,
 *      Regex ist ohne `i`-Flag — camelCase-Form matcht NICHT mehr.
 *   4. Vollständigkeit: jede Spotter-Tag-Auto-ID matcht die Regex.
 *   5. Konsumenten-Drift (structured.js deltaToAttribute-Map):
 *      Object.keys(map) entspricht DELTA_ATTRIBUTABLE_TAGS exakt.
 *   6. Predicate-API-Garantie (ersetzt Frozen-Set-Pseudo-Test):
 *      - isSpotterTag ist eine Funktion.
 *      - GRAPHICS_ELEMENTS Export entfernt (Layer-Trennung Patch2:
 *        Set ist privat, externe Mutation V8-mechanisch unmöglich).
 *      - SKIP_TAGS + DELTA_ATTRIBUTABLE_TAGS bleiben frozen Set-Exporte
 *        (Browser-Bridge / Drift-Test brauchen Iterierung).
 *      - Case-Defensive (Patch3, F-PATCH2-OPUS-001 + F-PATCH2-CODEX-001):
 *        isSpotterTag normalisiert Input via `String(tag).toLowerCase()`.
 *        textPath / textpath / TEXTPATH → alle true. null/undefined/
 *        numerische Inputs → false (kein Throw, defensive Koerzierung).
 *
 * Pattern-Vorlage: test_auto_ids.js (assert-Helper + summary-line).
 * NICHT browser-bound — pure ES-Module-Inspektion + Set-Operationen.
 *
 * Patch2-Begründung Frozen-Test-Ersatz (F-PATCH-CODEX-001 + F-OPUS-MINI-002):
 *   `Object.isFrozen(new Set(...))` ist Schein-Defensive — `set.add(x)` läuft
 *   trotzdem (V8-Spec: Set-internal-slots sind nicht via Property-Descriptor
 *   geschützt). Patch2 entfernt den `GRAPHICS_ELEMENTS`-Export komplett und
 *   exportiert stattdessen `isSpotterTag` als Predicate. Damit ist externe
 *   Mutation V8-mechanisch ausgeschlossen, nicht nur per Konvention. Der
 *   alte `Object.isFrozen`-Test wird durch einen echten "Mutation-Surface
 *   gone"-Test ersetzt: GRAPHICS_ELEMENTS-Export ist undefined, isSpotterTag
 *   ist Function. SKIP_TAGS/DELTA_ATTRIBUTABLE_TAGS sind weiterhin Object.frozen
 *   (Konvention-Härtung, kein Vollschutz — bewusst dokumentiert).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as vocab from '../../src/core/element_vocabulary.js';
import {
  isSpotterTag,
  SKIP_TAGS,
  SPOTTER_TAGS_LIST,
  DELTA_ATTRIBUTABLE_TAGS,
  AUTO_ID_FORMAT_REGEX,
} from '../../src/core/element_vocabulary.js';

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

// Helper: probe the (private) Spotter-Set via predicate over a known
// candidate-list. Patch3-Case-Konvention: alle Tags lowercase (kanonische
// Form, identisch zu SPOTTER_TAGS_LIST). isSpotterTag normalisiert auch
// camelCase-Inputs zu lowercase (Defensive) — siehe Test 6.
const SPOTTER_PROBE_TAGS = [
  // Patch3-Spotter-Members (15, lowercase):
  'a',
  'circle',
  'ellipse',
  'foreignobject',
  'image',
  'line',
  'path',
  'polygon',
  'polyline',
  'rect',
  'switch',
  'text',
  'textpath',
  'tspan',
  'use',
];

const SPOTTER_MEMBERS = SPOTTER_PROBE_TAGS.filter((t) => isSpotterTag(t));

// ── Test 1: Disjunktheit Spotter-Set ∩ SKIP_TAGS = ∅ ──────────
console.log(
  '--- VOCAB: Disjunktheit Spotter-Set ∩ SKIP_TAGS (4-Listen-Drift) ---',
);
{
  const intersection = SPOTTER_MEMBERS.filter((t) => SKIP_TAGS.has(t));
  assert(
    'Spotter-Set ∩ SKIP_TAGS = ∅',
    intersection.length === 0,
    `intersection=${JSON.stringify(intersection)}`,
  );
}

// ── Test 2: Subset DELTA_ATTRIBUTABLE_TAGS ⊆ Spotter-Set ──────
console.log(
  '--- VOCAB: Subset DELTA_ATTRIBUTABLE_TAGS ⊆ Spotter-Set (Spotter-Fix-Kontrakt) ---',
);
{
  const offenders = [...DELTA_ATTRIBUTABLE_TAGS].filter(
    (t) => !isSpotterTag(t),
  );
  assert(
    'jeder DELTA_ATTRIBUTABLE_TAG ist auch Spotter-Tag',
    offenders.length === 0,
    `offenders=${JSON.stringify(offenders)}`,
  );
}

// ── Test 3: F-CODEX-002 + F-OPUS-MINI-001 Reproducer ──────────
console.log(
  '--- VOCAB: F-CODEX-002 + F-OPUS-MINI-001 Reproducer (image/tspan/a/switch/textPath/foreignObject + g) ---',
);
{
  assert(
    'AUTO_ID_FORMAT_REGEX.test("_deadbeef_image1") === true',
    AUTO_ID_FORMAT_REGEX.test('_deadbeef_image1'),
    'image-Tag muss matchen (F-CODEX-002-Fix)',
  );
  // F-OPUS-MINI-001 Coverage: vor Patch2 (10er-Liste) wurden diese Tags
  // systematisch gedropt. Jetzt im Spotter-Set drin.
  assert(
    'AUTO_ID_FORMAT_REGEX.test("_deadbeef_tspan1") === true',
    AUTO_ID_FORMAT_REGEX.test('_deadbeef_tspan1'),
    'tspan-Tag muss matchen (F-OPUS-MINI-001 Verhaltens-Drift)',
  );
  assert(
    'AUTO_ID_FORMAT_REGEX.test("_deadbeef_a1") === true',
    AUTO_ID_FORMAT_REGEX.test('_deadbeef_a1'),
    'a-Tag (Hyperlink-Wrap) muss matchen (F-OPUS-MINI-001)',
  );
  assert(
    'AUTO_ID_FORMAT_REGEX.test("_deadbeef_switch1") === true',
    AUTO_ID_FORMAT_REGEX.test('_deadbeef_switch1'),
    'switch-Tag (Conditional-Processing) muss matchen (F-OPUS-MINI-001)',
  );
  // Patch3-Case-Konvention: kanonische Auto-IDs sind lowercase.
  // _SPOTTER_SET hält 'textpath'/'foreignobject', Regex ist OHNE `i`-Flag.
  assert(
    'AUTO_ID_FORMAT_REGEX.test("_deadbeef_textpath1") === true',
    AUTO_ID_FORMAT_REGEX.test('_deadbeef_textpath1'),
    'textpath-Tag (kanonisch lowercase) muss matchen (F-OPUS-MINI-001)',
  );
  assert(
    'AUTO_ID_FORMAT_REGEX.test("_deadbeef_foreignobject1") === true',
    AUTO_ID_FORMAT_REGEX.test('_deadbeef_foreignobject1'),
    'foreignobject-Tag (kanonisch lowercase) muss matchen (Browser-Lowercase)',
  );
  // Browser-Pfad liefert tagName.toLowerCase() → kanonische Form ist
  // lowercase. Auto-ID-Format-Regex ist OHNE `i`-Flag deterministisch
  // case-sensitive. camelCase darf NICHT mehr matchen — Renderer produziert
  // ohnehin nur lowercase-IDs (Patch3 Case-Symmetrie).
  assert(
    'AUTO_ID_FORMAT_REGEX.test("_deadbeef_textPath1") === false (i-Flag entfernt)',
    AUTO_ID_FORMAT_REGEX.test('_deadbeef_textPath1') === false,
    'camelCase-Form darf nicht matchen — Renderer normalisiert via toLowerCase()',
  );
  assert(
    'AUTO_ID_FORMAT_REGEX.test("_deadbeef_foreignObject1") === false (i-Flag entfernt)',
    AUTO_ID_FORMAT_REGEX.test('_deadbeef_foreignObject1') === false,
    'camelCase-Form darf nicht matchen — kanonische Form ist lowercase',
  );
  // Regex-Flags-Probe: `i`-Flag ist explizit entfernt (Patch3).
  assert(
    "AUTO_ID_FORMAT_REGEX.flags === '' (kein i-Flag)",
    AUTO_ID_FORMAT_REGEX.flags === '',
    `flags="${AUTO_ID_FORMAT_REGEX.flags}" — i-Flag muss entfernt sein`,
  );
  assert(
    'AUTO_ID_FORMAT_REGEX.test("_deadbeef_g1") === false',
    AUTO_ID_FORMAT_REGEX.test('_deadbeef_g1') === false,
    'g-Tag (Container, in SKIP_TAGS) darf NICHT matchen',
  );
  assert(
    'AUTO_ID_FORMAT_REGEX.test("_deadbeef_defs1") === false',
    AUTO_ID_FORMAT_REGEX.test('_deadbeef_defs1') === false,
    'defs-Tag (Definitions, in SKIP_TAGS) darf NICHT matchen',
  );
}

// ── Test 4: Vollständigkeit — jeder Spotter-Tag matcht ────────
console.log('--- VOCAB: Vollständigkeit (jeder Spotter-Tag matcht) ---');
{
  const offenders = [];
  for (const tag of SPOTTER_MEMBERS) {
    const sampleId = `_deadbeef_${tag}1`;
    if (!AUTO_ID_FORMAT_REGEX.test(sampleId)) offenders.push(tag);
  }
  assert(
    `alle ${SPOTTER_MEMBERS.length} Spotter-Tags produzieren valide Auto-IDs`,
    offenders.length === 0,
    `offenders=${JSON.stringify(offenders)}`,
  );
}

// ── Test 5: Konsumenten-Drift structured.js deltaToAttribute-Map ──
// Source-Read statt Import — `deltaToAttribute` ist Modul-intern (nicht export),
// daher Datei einlesen und die Map-Keys via Regex extrahieren. Garantiert
// dass die SSOT-Set und die produktive Konsumenten-Map nicht auseinanderlaufen.
console.log(
  '--- VOCAB: Konsumenten-Drift structured.js deltaToAttribute-Map ---',
);
{
  const here = dirname(fileURLToPath(import.meta.url));
  const structuredPath = resolve(
    here,
    '../../src/adapters/emitter/structured.js',
  );
  const src = readFileSync(structuredPath, 'utf8');

  // Extrahiere die Top-Level-Keys aus dem `const map = { ... };`-Literal.
  // Pattern ist minimal-fragil: keys sind bareword-Identifier (kein Quoting),
  // gefolgt von Doppelpunkt + Objekt-Literal. Robust genug für unsere Map.
  const mapBlockMatch = src.match(/const map = \{([\s\S]*?)\};/);
  assert(
    'deltaToAttribute-Map-Block in structured.js gefunden',
    mapBlockMatch !== null,
    'Map-Literal nicht erkennbar — strukturierte Änderung erforderlich',
  );

  if (mapBlockMatch) {
    const block = mapBlockMatch[1];
    // Match top-level keys: Zeilen-Anfang + identifier + ':'  vor '{'
    const keyRe = /^\s*([a-z][a-zA-Z0-9]*)\s*:\s*\{/gm;
    const mapKeys = new Set();
    let m;
    while ((m = keyRe.exec(block)) !== null) mapKeys.add(m[1]);

    // Map-Keys = DELTA_ATTRIBUTABLE_TAGS (gegenseitig).
    const missingInMap = [...DELTA_ATTRIBUTABLE_TAGS].filter(
      (t) => !mapKeys.has(t),
    );
    const extraInMap = [...mapKeys].filter(
      (t) => !DELTA_ATTRIBUTABLE_TAGS.has(t),
    );
    assert(
      'Object.keys(deltaToAttribute-Map) = DELTA_ATTRIBUTABLE_TAGS',
      missingInMap.length === 0 && extraInMap.length === 0,
      `missingInMap=${JSON.stringify(missingInMap)} extraInMap=${JSON.stringify(extraInMap)} mapKeys=${JSON.stringify([...mapKeys])}`,
    );
  }
}

// ── Test 6: Predicate-API-Garantie (Patch2 Layer-Trennung) ────
// Patch1 hatte hier den Object.isFrozen-Pseudo-Test (F-PATCH-CODEX-001 +
// F-OPUS-MINI-002). Patch2 ersetzt durch echten Mutation-Surface-Test:
// GRAPHICS_ELEMENTS Export ist undefined → keine externe Set-Mutation möglich.
console.log(
  '--- VOCAB: Predicate-API-Garantie (Patch2 ersetzt Object.isFrozen-Pseudo) ---',
);
{
  assert(
    'isSpotterTag ist eine Funktion',
    typeof isSpotterTag === 'function',
    'Predicate-API muss exportiert sein',
  );
  assert(
    'GRAPHICS_ELEMENTS Export entfernt (Layer-Trennung)',
    typeof vocab.GRAPHICS_ELEMENTS === 'undefined',
    'Set-Export ist nicht-mutierbar nur wenn er nicht existiert (V8-Spec)',
  );
  // SKIP_TAGS + DELTA_ATTRIBUTABLE_TAGS bleiben als frozen Set-Exports:
  // Browser-Bridge iteriert SKIP_TAGS (`[...SKIP_TAGS]` für page.evaluate-Arg),
  // Drift-Test 5 iteriert DELTA_ATTRIBUTABLE_TAGS. Object.isFrozen ist hier
  // weiterhin Konvention-Härtung (Property-Descriptor), nicht Set-Mutation-Lock.
  assert(
    'SKIP_TAGS ist frozen (Konvention-Härtung Property-Descriptor)',
    Object.isFrozen(SKIP_TAGS),
    'Object.freeze fehlt',
  );
  assert(
    'DELTA_ATTRIBUTABLE_TAGS ist frozen (Konvention-Härtung)',
    Object.isFrozen(DELTA_ATTRIBUTABLE_TAGS),
    'Object.freeze fehlt',
  );
  // Predicate-Behavior: 'g' und unbekannte Tags müssen false liefern,
  // damit der Renderer sie korrekt skippt.
  assert(
    "isSpotterTag('g') === false",
    isSpotterTag('g') === false,
    'g (Container) darf nicht als Spotter-Tag akzeptiert werden',
  );
  assert(
    "isSpotterTag('unknown_tag_xyz') === false",
    isSpotterTag('unknown_tag_xyz') === false,
    'unbekannte Tags müssen false liefern',
  );
  // Patch3-Case-Defensive (F-PATCH2-OPUS-001 + F-PATCH2-CODEX-001 konvergent
  // HIGH): isSpotterTag normalisiert Input via String(tag).toLowerCase().
  // Browser-Pfad in playwright.js liefert `el.tagName.toLowerCase()` →
  // lowercase. Set-Inhalt ist lowercase. Drei Schreibweisen für jeden
  // camelCase-SVG-Tag (textPath / textpath / TEXTPATH) müssen identisch
  // true liefern — sonst F-1-Mismatch zurück.
  assert(
    "isSpotterTag('textPath') === true (camelCase via Normalisierung)",
    isSpotterTag('textPath') === true,
    'camelCase muss true liefern (Defensive-Normalisierung)',
  );
  assert(
    "isSpotterTag('textpath') === true (lowercase, Browser-Pfad)",
    isSpotterTag('textpath') === true,
    'lowercase ist kanonisch und liefert true',
  );
  assert(
    "isSpotterTag('TEXTPATH') === true (uppercase via Normalisierung)",
    isSpotterTag('TEXTPATH') === true,
    'uppercase muss true liefern (Defensive-Normalisierung)',
  );
  assert(
    "isSpotterTag('foreignObject') === true (camelCase via Normalisierung)",
    isSpotterTag('foreignObject') === true,
    'camelCase muss true liefern (Defensive-Normalisierung)',
  );
  assert(
    "isSpotterTag('foreignobject') === true (lowercase, Browser-Pfad)",
    isSpotterTag('foreignobject') === true,
    'lowercase ist kanonisch und liefert true',
  );
  // Defensive-Behavior bei non-string Inputs: String(tag).toLowerCase()
  // koerciert null→"null", undefined→"undefined", 123→"123" — keiner
  // matcht das Set, also false. Kein Throw (Browser-Pfad läuft in
  // Promise-Chain; TypeError wäre schwer lokalisierbar).
  assert(
    'isSpotterTag(undefined) === false (kein Throw)',
    isSpotterTag(undefined) === false,
    'undefined-Input darf weder true liefern noch werfen',
  );
  assert(
    'isSpotterTag(null) === false (kein Throw)',
    isSpotterTag(null) === false,
    'null-Input darf weder true liefern noch werfen',
  );
  assert(
    'isSpotterTag(123) === false (kein Throw, numerisch)',
    isSpotterTag(123) === false,
    'numerischer Input darf weder true liefern noch werfen',
  );
  // Case-Invariante des Bridge-Snapshot (Patch3): SPOTTER_TAGS_LIST muss
  // ausschliesslich lowercase Tokens enthalten — wird zusätzlich vom
  // Drift-Guard in playwright.js Z.128 Build-/Runtime verifiziert.
  assert(
    'SPOTTER_TAGS_LIST ist durchgängig lowercase (Case-Invariante)',
    SPOTTER_TAGS_LIST.every((t) => t === t.toLowerCase()),
    `non-lowercase entries=${JSON.stringify(SPOTTER_TAGS_LIST.filter((t) => t !== t.toLowerCase()))}`,
  );
}

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
