/**
 * test_honesty_live.js — E1 Honest-Red: das Wahrheits-Gate honesty.js ist LIVE
 * am Emissions-Rand verdrahtet (analyze/compare/inspect).
 *
 * Diese 5 Invarianten belegen den E1-DoD (Plan §6) und sind VOR der Verdrahtung
 * jeweils ROT-ohne-Fix:
 *   1. 0-ungegated-Invariante: beide Formatter asserten input._gated; ein
 *      ungegateter formatStructured-/formatReport-Aufruf wirft.
 *   2. prose-leak D-006: not_measurable-Element → prose KEIN dx= waehrend
 *      structured kein dx. + Negativ-Kontrolle (reliable → behaelt dx).
 *   3. countTruncation live D-008: >7 Elemente → suppressed === total-7 (≠0).
 *   4. byte-Identitaet REGEL-9 + Default-deny (via gateCorrections-Modulpfad).
 *   5. D-001 Caller-Existenz: gateCorrections aus src/pipeline.js aufgerufen.
 *
 * Die browser-abhaengigen Pfade (D-006/D-008 end-to-end, EK-4) liegen im
 * selftest/e2e; hier die deterministischen Modul-/Grep-Invarianten, die KEINEN
 * Browser brauchen (E1 ist Emitter-Verdrahtung, kein Renderer).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatReport } from '../../src/adapters/emitter/prose.js';
import { formatStructured } from '../../src/adapters/emitter/structured.js';
import { gateCorrections } from '../../src/core/honesty.js';

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

const __dir = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dir, '..', '..', 'src');

// reliabilityOf-Closure aus einer elements-Liste (wie der Pipeline-Caller).
function relOf(elements) {
  const m = new Map(elements.map((e) => [e.id, e.bbox_reliability]));
  return (id) => m.get(id);
}

const blindGridMap = {
  canvas: { width: 200, height: 200 },
  grid: { cellsX: 4, cellsY: 4 },
  elements: [
    {
      id: 'box3d',
      tag: 'rect',
      cell: 'A1',
      color: 'blue',
      bbox: { x: 100, y: 100, w: 40, h: 40 },
      bbox_reliability: 'not_measurable',
      warnings: ['3D_TRANSFORM_ANCESTOR'],
    },
    {
      id: 'flat',
      tag: 'rect',
      cell: 'C3',
      color: 'red',
      bbox: { x: 20, y: 20, w: 40, h: 40 },
      bbox_reliability: 'reliable',
    },
  ],
};
// §E1 R2: ECHTES Produzenten-detail (centered-in.js:20-Form) — der detail-String
// traegt die Pixel-Korrektur, exakt wie im Prod-Pfad. Maskierungs-freier RED:
// das Gate MUSS diese Vorschreibung aus dem String entfernen (nicht nur aus den
// Objekt-Feldern). Ein Mock ohne `Korrektur: dx=..` wuerde den Leak verstecken.
const blindFailing = [
  {
    type: 'CONSTRAINT_FAIL',
    severity: 0,
    id: 'box3d',
    constraintType: 'CENTERED-IN',
    reference: 'flat',
    detail: 'Verfehlt Zentrum. Korrektur: dx=-64px, dy=-64px',
    dx: -64,
    dy: -64,
  },
];

// ── HR-1: 0-ungegated-Invariante (fail-closed) ─────────────────────────────
console.log(
  '--- HONEST-RED 1: 0-ungegated-Invariante (Formatter asserten _gated) ---',
);
{
  // Ungegated: rohe failing-issues OHNE _gated → Formatter MUSS werfen.
  let threwS = false;
  try {
    formatStructured(blindGridMap, {
      failing: blindFailing,
      unchecked: [],
      diff: [],
    });
  } catch {
    threwS = true;
  }
  assert('formatStructured wirft bei ungegatetem failing-issue', threwS);

  // R3-SYMMETRIE: formatReport hat KEINEN 3. Arg mehr. Es konsumiert NUR
  // arbitrated.failing. Ein ungegatetes arbitrated.failing → Wurf (fail-closed
  // auf der NATUERLICHEN Aufruf-Form).
  let threwP = false;
  try {
    formatReport(blindGridMap, {
      failing: blindFailing,
      unchecked: [],
      diff: [],
    });
  } catch {
    threwP = true;
  }
  assert('formatReport wirft bei ungegatetem arbitrated.failing', threwP);

  // R3 HR-1-LUECKE (das reproduzierte false-green): die WEGGELASSENE-3.-Arg-
  // Shape gibt es nicht mehr — `formatReport(gridMap, {failing: <ungegated>})`
  // darf NICHT zu `[]` kollabieren und „Alles korrekt" melden, sondern MUSS
  // werfen. (Vor R3: `gatedFailing || []` → [] → Assert umgangen → false-green.)
  let falseGreen = false;
  try {
    const out = formatReport(blindGridMap, {
      failing: blindFailing,
      unchecked: [],
      diff: [],
    });
    falseGreen = out.includes('Alles korrekt'); // erreicht nur ohne Wurf
  } catch {
    falseGreen = false; // Wurf = korrekt fail-closed, kein false-green
  }
  assert(
    'R3: weggelassene-Arg-Shape meldet NICHT „Alles korrekt" (kein false-green)',
    falseGreen === false,
  );

  // Gegated: die gegatete Liste als arbitrated.failing → kein Wurf, beide
  // Formatter konsumieren dieselbe EINE Quelle (R3-Symmetrie).
  const gated = gateCorrections(blindFailing, relOf(blindGridMap.elements));
  let ok = true;
  try {
    formatStructured(blindGridMap, { failing: gated, unchecked: [], diff: [] });
    formatReport(blindGridMap, { failing: gated, unchecked: [], diff: [] });
  } catch {
    ok = false;
  }
  assert('gegateter Pfad wirft NICHT', ok);
}

// ── HR-2: prose-leak D-006/R2 (BEIDE Kanaele: Objekt-Feld UND detail-STRING) ──
// Maskierungs-frei: das Fixture-detail traegt die ECHTE `. Korrektur: dx=..`-
// Vorschreibung (centered-in.js:20). Der Leak entkam bisher durch die
// FAILING-Top-Liste (prose.js:60-65, woertliches issue.detail aus dem
// UNGEGATETEN 2. Arg). Wir asserten KEIN dx=/Korrektur:/Δw= in der gesamten
// Prosa fuer not_measurable UND approximate; reliable bleibt byte-identisch.
console.log(
  '--- HONEST-RED 2: prose-leak D-006/R2 (not_measurable+approximate, beide Kanaele) ---',
);

// Helper: baut die Prosa exakt wie der Prod-Caller (pipeline.js): die GEGATETE
// Liste geht als arbitrated.failing (R3-Symmetrie, EINE Quelle).
function proseFor(elements, failing) {
  const gated = gateCorrections(failing, relOf(elements));
  return formatReport(
    {
      canvas: { width: 200, height: 200 },
      grid: { cellsX: 4, cellsY: 4 },
      elements,
    },
    { failing: gated, unchecked: [], diff: [] },
  );
}
const LEAK_TOKENS = [
  'dx=',
  'dy=',
  'dw=',
  'dh=',
  'Δw=',
  'Δh=',
  'Korrektur:',
  'Fluchtweg:',
];

{
  // structured-Seite (Objekt-Feld) bleibt sauber.
  const gated = gateCorrections(blindFailing, relOf(blindGridMap.elements));
  const structured = formatStructured(blindGridMap, {
    failing: gated,
    unchecked: [],
    diff: [],
  });
  const corr = structured.corrections.find((c) => c.element === '#box3d');
  assert('structured: box3d-correction traegt KEIN dx', corr.dx === undefined);
  assert('structured: box3d-correction traegt KEIN dy', corr.dy === undefined);
  assert(
    'structured: box3d-correction traegt KEIN fix',
    corr.fix === undefined,
  );

  // not_measurable: KEIN Leak-Token in der GESAMTEN Prosa (FAILING-Top-Liste
  // UND Element-Baum). RED-ohne-Fix: die Top-Liste emittiert issue.detail
  // ('Verfehlt Zentrum. Korrektur: dx=-64px, dy=-64px') woertlich.
  const proseNM = proseFor(blindGridMap.elements, blindFailing);
  for (const tok of LEAK_TOKENS) {
    assert(
      `prose(not_measurable): KEIN '${tok}' (R2 beide Kanaele)`,
      !proseNM.includes(tok),
    );
  }
  // WAS-Messung bleibt erhalten (das Auge meldet den Bruch, nur ohne Rezept).
  assert(
    'prose(not_measurable): WAS-Beschreibung bleibt (Verfehlt Zentrum)',
    proseNM.includes('Verfehlt Zentrum'),
  );

  // approximate (NICHT nur not_measurable): same-size-Form mit Δw/Δh-Inline-Leak.
  const approxElements = [
    {
      id: 'wob',
      tag: 'rect',
      cell: 'A1',
      color: 'blue',
      bbox: { x: 0, y: 0, w: 106, h: 106 },
      bbox_reliability: 'approximate',
    },
  ];
  const approxFailing = [
    {
      type: 'CONSTRAINT_FAIL',
      severity: 0,
      id: 'wob',
      constraintType: 'SAME-SIZE',
      reference: 'ref',
      detail: 'Grösse weicht ab (Δw=6px, Δh=-2px)',
      dw: -6,
      dh: 2,
    },
  ];
  const proseAP = proseFor(approxElements, approxFailing);
  for (const tok of LEAK_TOKENS) {
    assert(
      `prose(approximate): KEIN '${tok}' (Δw/Δh-Inline-Leak zu)`,
      !proseAP.includes(tok),
    );
  }
  assert(
    'prose(approximate): WAS-Beschreibung bleibt (Grösse weicht ab)',
    proseAP.includes('Grösse weicht ab'),
  );

  // Negativ-Kontrolle (Anti-Ueber-Gaten): reliable BEHAELT [dx=..px] UND die
  // volle detail-Korrektur in der FAILING-Top-Liste (BYTE-IDENTISCH zu heute).
  const reliableFailing = [
    {
      type: 'CONSTRAINT_FAIL',
      severity: 0,
      id: 'flat',
      constraintType: 'CENTERED-IN',
      reference: 'box3d',
      detail: 'Verfehlt Zentrum. Korrektur: dx=10px',
      dx: 10,
    },
  ];
  const proseR = proseFor(blindGridMap.elements, reliableFailing);
  assert(
    'prose(reliable): BEHAELT [dx=10px] (Element-Baum)',
    proseR.includes('[dx=10px]'),
  );
  assert(
    'prose(reliable): BEHAELT detail-Korrektur (Top-Liste byte-identisch)',
    proseR.includes('Verfehlt Zentrum. Korrektur: dx=10px'),
  );

  // COLOR-fail ohne dx → spotterHint byte-identisch '' (kein Klammer-Anhang).
  const colorFailing = [
    {
      type: 'CONSTRAINT_FAIL',
      severity: 0,
      id: 'flat',
      constraintType: 'COLOR',
      detail: 'Farbe ist red, soll blue sein.',
      non_spatial: true,
    },
  ];
  const proseC = proseFor(blindGridMap.elements, colorFailing);
  assert(
    'prose: COLOR-fail ohne dx → kein [..] Korrektur-Anhang',
    !proseC.includes('[dx'),
  );
}

// ── HR-3: countTruncation live D-008 ───────────────────────────────────────
console.log(
  '--- HONEST-RED 3: countTruncation live D-008 (>7 → suppressed≠0) ---',
);
{
  const nineElements = Array.from({ length: 9 }, (_, i) => ({
    id: `e${i}`,
    tag: 'rect',
    cell: 'A1',
    color: 'red',
    bbox: { x: 0, y: 0, w: 10, h: 10 },
    bbox_reliability: 'reliable',
  }));
  const bigMap = {
    canvas: { width: 400, height: 200 },
    grid: { cellsX: 8, cellsY: 4 },
    elements: nineElements,
  };
  const out = formatStructured(bigMap, {
    failing: [],
    unchecked: [],
    diff: [],
  });
  assert(
    '9 Elemente → suppressed === 2 (D-008 live, nicht hartkodiert 0)',
    out.iteration.suppressed === 2,
  );

  // Negativ: ≤7 → suppressed === 0 (test_structured:934 bleibt gruen).
  const sevenMap = { ...bigMap, elements: nineElements.slice(0, 7) };
  const out7 = formatStructured(sevenMap, {
    failing: [],
    unchecked: [],
    diff: [],
  });
  assert(
    '7 Elemente → suppressed === 0 (≤cap)',
    out7.iteration.suppressed === 0,
  );
}

// ── HR-4: byte-Identitaet REGEL-9 (gegated reliable === heute) + Default-deny ─
console.log(
  '--- HONEST-RED 4: byte-Identitaet (reliable unveraendert) + default-deny ---',
);
{
  // reliable failing → gegated identisch zum ungegateten dx-Tragen.
  const relFailing = [
    {
      type: 'CONSTRAINT_FAIL',
      severity: 0,
      id: 'flat',
      constraintType: 'ALIGNED-LEFT',
      reference: 'box3d',
      detail: '#flat nicht buendig',
      dx: 10,
    },
  ];
  const gated = gateCorrections(relFailing, relOf(blindGridMap.elements));
  const out = formatStructured(blindGridMap, {
    failing: gated,
    unchecked: [],
    diff: [],
  });
  const corr = out.corrections[0];
  assert('reliable gegated: dx === 10 (byte-stabil)', corr.dx === 10);
  assert('reliable gegated: fix existiert', corr.fix !== undefined);

  // Default-deny: failing-issue auf unbekannter id → kein dx/dy.
  const ghostFailing = [
    {
      type: 'CONSTRAINT_FAIL',
      id: 'ghost',
      constraintType: 'CENTERED-IN',
      dx: 3,
      dy: 4,
    },
  ];
  const gatedGhost = gateCorrections(
    ghostFailing,
    relOf(blindGridMap.elements),
  );
  const outGhost = formatStructured(blindGridMap, {
    failing: gatedGhost,
    unchecked: [],
    diff: [],
  });
  const ghostCorr = outGhost.corrections[0];
  assert('default-deny: unbekannte id → kein dx', ghostCorr.dx === undefined);
  assert('default-deny: unbekannte id → kein dy', ghostCorr.dy === undefined);
}

// ── HR-5: D-001 Caller-Existenz (grep) ─────────────────────────────────────
console.log(
  '--- HONEST-RED 5: gateCorrections aus src/pipeline.js aufgerufen ---',
);
{
  const pipelineSrc = readFileSync(join(SRC, 'pipeline.js'), 'utf8');
  assert(
    'src/pipeline.js importiert+ruft gateCorrections',
    /gateCorrections/.test(pipelineSrc),
  );

  // DoD-grep: keine Emissions-Reliability-Inline-Flags mehr in adapters/.
  const structuredSrc = readFileSync(
    join(SRC, 'adapters', 'emitter', 'structured.js'),
    'utf8',
  );
  const proseSrc = readFileSync(
    join(SRC, 'adapters', 'emitter', 'prose.js'),
    'utf8',
  );
  const banned = /=== ?['"]reliable['"]|elReliability|reliabilityById/;
  assert(
    'structured.js: 0 Inline-Reliability-Flags (Map/elReliability/===reliable)',
    !banned.test(structuredSrc),
  );
  assert('prose.js: 0 Inline-Reliability-Flags', !banned.test(proseSrc));
}

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
