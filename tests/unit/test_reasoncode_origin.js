/**
 * test_reasoncode_origin.js — D-003 + D-004 Honest-Red über die ECHTE Pipeline.
 *
 * Beweist, dass zwei vormals stille/ungenaue core-Diagnosen jetzt ehrlich und
 * praezise sind, gemessen am realen Datenfluss
 *   pipeline.checkAllConstraints()  →  arbitrate()  →  unchecked[].
 * KEINE handgebauten Constraint-Results: alles laeuft durch denselben Code,
 * den analyze() benutzt (checkAllConstraints + arbitrate). checkConstraint
 * deckt zusaetzlich die distance.js-Einheit direkt ab (test_distance.js).
 *
 * D-003: `#a DISTANCE-FROM #b -3` (negativer Ziel-Abstand) → frueher stiller
 *        PASS (expectedDist<0 ⇒ actualDist>=expectedDist immer true). Jetzt:
 *        pass:null → landet in unchecked[], NIE in passing[].
 *        reasonCode INVALID_MEASUREMENT, Wert -3 unveraendert (kein Clamp).
 *
 * D-004: fehlendes subject/reference → frueher generisch MEASUREMENT_AMBIGUOUS
 *        (arbitrate buildUnchecked-Default). Jetzt am Ursprung praezise:
 *        subject fehlt → SUBJECT_NOT_FOUND, reference (#ghost) fehlt →
 *        REFERENCE_NOT_FOUND.
 */

import { arbitrate } from '../../src/core/arbitrate.js';
import { registerConstraint } from '../../src/core/constraints/registry.js';
import {
  arrange,
  checkAllConstraints,
  parseConstraints,
} from '../../src/pipeline.js';
// loader.js registriert alle Standard-Constraints (Side-Effect). Pflicht, damit
// isRegistered/requiresReference im Pipeline-Pfad die echten Typen kennen.
import '../../src/core/constraints/loader.js';

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

// Minimal-Szene, wie mapToGridMap sie liefert (das Format, das
// checkAllConstraints konsumiert): elements[] + grid{cellW,cellH}.
const gridMap = {
  canvas: { width: 400, height: 300 },
  grid: { cols: 8, rows: 6, cellW: 50, cellH: 50 },
  elements: [
    {
      id: 'a',
      tag: 'rect',
      bbox: { x: 0, y: 0, w: 20, h: 20 },
      cx: 10,
      cy: 10,
      color: 'red',
      bbox_reliability: 'reliable',
    },
    {
      id: 'b',
      tag: 'rect',
      bbox: { x: 200, y: 0, w: 20, h: 20 },
      cx: 210,
      cy: 10,
      color: 'blue',
      bbox_reliability: 'reliable',
    },
  ],
};

// Hilfsfunktion: roher Datenfluss wie analyze() (ohne Renderer/Browser).
function run(constraintStrings) {
  const parsed = parseConstraints(constraintStrings);
  const results = checkAllConstraints(parsed, gridMap);
  return { results, arb: arbitrate(results, []) };
}

// =============================================================================
// D-003 HONEST-RED: negativer Ziel-Abstand über die echte Pipeline
// =============================================================================
console.log('--- D-003: #a DISTANCE-FROM #b -3 (echte Pipeline) ---');
{
  const { results, arb } = run(['#a DISTANCE-FROM #b -3']);
  const cr = results[0];
  assert('D-003: check result pass is null (NOT true)', cr.pass === null);
  assert(
    'D-003: check result pass !== true (kein stiller PASS)',
    cr.pass !== true,
  );
  assert(
    'D-003: reasonCode INVALID_MEASUREMENT',
    cr.reasonCode === 'INVALID_MEASUREMENT',
  );
  // Der entscheidende Honest-Red-Beweis: landet in unchecked, NICHT in passing.
  assert(
    'D-003: 0 passing (NICHT als bestanden gewertet)',
    arb.passing.length === 0,
  );
  assert('D-003: 0 failing', arb.failing.length === 0);
  assert('D-003: 1 unchecked (ehrlich unmessbar)', arb.unchecked.length === 1);
  assert(
    'D-003: unchecked reasonCode survives arbitrate (INVALID_MEASUREMENT)',
    arb.unchecked[0].reasonCode === 'INVALID_MEASUREMENT',
  );
  assert(
    'D-003: unchecked reasonCode is NOT generic MEASUREMENT_AMBIGUOUS',
    arb.unchecked[0].reasonCode !== 'MEASUREMENT_AMBIGUOUS',
  );
  assert(
    'D-003: detail carries raw -3 unchanged (kein Clamp)',
    typeof arb.unchecked[0].detail === 'string' &&
      arb.unchecked[0].detail.includes('-3'),
  );
}

// D-003 REGRESS: positiver Wert unveraendert korrekt durch die Pipeline.
console.log('--- D-003 REGRESS: positive value (echte Pipeline) ---');
{
  // a@(0..20) b@(200..220): AABB-gap=180px. value=1 → need 50px → PASS.
  const passRun = run(['#a DISTANCE-FROM #b 1']);
  assert('regress: value=1 → 1 passing', passRun.arb.passing.length === 1);
  assert('regress: value=1 → 0 unchecked', passRun.arb.unchecked.length === 0);
  // value=5 → need 250px > 180px gap → FAIL (echte Verletzung, kein unchecked).
  const failRun = run(['#a DISTANCE-FROM #b 5']);
  assert('regress: value=5 → 1 failing', failRun.arb.failing.length === 1);
  assert('regress: value=5 → 0 unchecked', failRun.arb.unchecked.length === 0);
}

// =============================================================================
// D-004 HONEST-RED: fehlende subject / reference über die echte Pipeline
// =============================================================================
console.log('--- D-004: #ghost reference → REFERENCE_NOT_FOUND ---');
{
  // subject existiert (a), reference #ghost existiert NICHT.
  const { results, arb } = run(['#a DISTANCE-FROM #ghost 1']);
  const cr = results[0];
  assert('D-004(ref): pass is null', cr.pass === null);
  assert(
    'D-004(ref): reasonCode REFERENCE_NOT_FOUND',
    cr.reasonCode === 'REFERENCE_NOT_FOUND',
  );
  assert(
    'D-004(ref): reasonCode is NOT generic MEASUREMENT_AMBIGUOUS',
    cr.reasonCode !== 'MEASUREMENT_AMBIGUOUS',
  );
  assert('D-004(ref): 1 unchecked', arb.unchecked.length === 1);
  assert(
    'D-004(ref): unchecked reasonCode REFERENCE_NOT_FOUND (survives arbitrate)',
    arb.unchecked[0].reasonCode === 'REFERENCE_NOT_FOUND',
  );
  assert(
    'D-004(ref): unchecked reasonCategory SPECIFICATION',
    arb.unchecked[0].reasonCategory === 'SPECIFICATION',
  );
  assert(
    'D-004(ref): hint/detail names #ghost',
    arb.unchecked[0].hint?.includes('ghost'),
  );
}

console.log('--- D-004: missing subject → SUBJECT_NOT_FOUND ---');
{
  // subject #nope existiert NICHT; reference b existiert. Ein nicht-Distance-
  // Constraint zeigt, dass der Branch generisch (nicht distance-spezifisch) ist.
  const { results, arb } = run(['#nope CENTERED-IN #b']);
  const cr = results[0];
  assert('D-004(subj): pass is null', cr.pass === null);
  assert(
    'D-004(subj): reasonCode SUBJECT_NOT_FOUND',
    cr.reasonCode === 'SUBJECT_NOT_FOUND',
  );
  assert(
    'D-004(subj): reasonCode is NOT generic MEASUREMENT_AMBIGUOUS',
    cr.reasonCode !== 'MEASUREMENT_AMBIGUOUS',
  );
  assert('D-004(subj): 1 unchecked', arb.unchecked.length === 1);
  assert(
    'D-004(subj): unchecked reasonCode SUBJECT_NOT_FOUND (survives arbitrate)',
    arb.unchecked[0].reasonCode === 'SUBJECT_NOT_FOUND',
  );
  assert(
    'D-004(subj): unchecked reasonCategory SPECIFICATION',
    arb.unchecked[0].reasonCategory === 'SPECIFICATION',
  );
  assert(
    'D-004(subj): hint/detail names #nope',
    arb.unchecked[0].hint?.includes('nope'),
  );
}

// D-004 REGRESS: beide Ids existieren → echte Auswertung, kein unchecked.
console.log('--- D-004 REGRESS: both ids exist (echte Auswertung) ---');
{
  const { arb } = run(['#a CENTERED-IN #b']);
  assert('regress: both-exist → 0 unchecked', arb.unchecked.length === 0);
  assert(
    'regress: both-exist → evaluated (passing or failing, not unchecked)',
    arb.passing.length + arb.failing.length === 1,
  );
}

// =============================================================================
// HIGH-Fix (E6 Re-Review): referenz-PFLICHTIGE Constraint OHNE Referenz CRASHED
// frueher (null-Deref ref.bbox in distance.js & Co). Jetzt fail-closed (REGEL-8):
// pass:null + REFERENCE_NOT_FOUND, KEIN Throw. Die vorige Wache greift nur bei
// truthy c.reference und liess „ref fehlt ganz" (reference:null) durchrutschen.
// `runSafe` faengt jeden Throw als expliziten Test-FAIL — kein verstecktes Werfen.
// =============================================================================
function runSafe(label, constraintStrings) {
  try {
    return { ok: true, ...run(constraintStrings) };
  } catch (e) {
    assert(`${label}: KEIN Throw (REGEL-8 fail-closed)`, false);
    return { ok: false, error: e, results: [], arb: { unchecked: [] } };
  }
}

console.log('--- HIGH: #a DISTANCE-FROM (KEINE ref) → REFERENCE_NOT_FOUND ---');
{
  const { ok, results, arb } = runSafe('missing-ref', ['#a DISTANCE-FROM']);
  assert('missing-ref: kein Throw', ok === true);
  assert('missing-ref: pass is null', results[0]?.pass === null);
  assert(
    'missing-ref: reasonCode REFERENCE_NOT_FOUND',
    results[0]?.reasonCode === 'REFERENCE_NOT_FOUND',
  );
  assert(
    'missing-ref: 1 unchecked (nicht failing/passing)',
    arb.unchecked.length === 1,
  );
  assert(
    'missing-ref: unchecked reasonCode REFERENCE_NOT_FOUND',
    arb.unchecked[0]?.reasonCode === 'REFERENCE_NOT_FOUND',
  );
}

console.log(
  '--- HIGH: #a DISTANCE-FROM # (leere ref) → REFERENCE_NOT_FOUND ---',
);
{
  const { ok, results } = runSafe('empty-ref', ['#a DISTANCE-FROM #']);
  assert('empty-ref: kein Throw', ok === true);
  assert('empty-ref: pass is null', results[0]?.pass === null);
  assert(
    'empty-ref: reasonCode REFERENCE_NOT_FOUND',
    results[0]?.reasonCode === 'REFERENCE_NOT_FOUND',
  );
}

console.log(
  '--- HIGH: alle referenz-pflichtigen Typen OHNE ref → kein Throw ---',
);
{
  // Generativ ueber die dokumentierte ref-pflichtige Menge: jeder Typ MUSS
  // fail-closed REFERENCE_NOT_FOUND liefern, KEINER darf werfen.
  const refTypes = [
    'DISTANCE-FROM',
    'CENTERED-IN',
    'INSIDE',
    'NO-OVERLAP',
    'ALIGNED-LEFT',
    'ALIGNED-TOP',
    'LEFT-OF',
    'ABOVE',
    'SAME-SIZE',
  ];
  for (const t of refTypes) {
    const { ok, results } = runSafe(`${t}-no-ref`, [`#a ${t}`]);
    assert(`${t} OHNE ref: kein Throw`, ok === true);
    assert(
      `${t} OHNE ref: reasonCode REFERENCE_NOT_FOUND`,
      results[0]?.reasonCode === 'REFERENCE_NOT_FOUND',
    );
  }
}

// REGRESS: COLOR/FILL brauchen KEINE ref → unveraendert (kein REFERENCE_NOT_FOUND).
console.log('--- HIGH REGRESS: COLOR/FILL ohne ref unveraendert ---');
{
  const color = runSafe('color', ['#a COLOR red']);
  assert('COLOR ohne ref: kein Throw', color.ok === true);
  assert(
    'COLOR ohne ref: NICHT REFERENCE_NOT_FOUND (kein ref noetig)',
    color.results[0]?.reasonCode !== 'REFERENCE_NOT_FOUND',
  );
  assert(
    'COLOR ohne ref: ausgewertet (pass true/false)',
    color.results[0]?.pass === true,
  );

  const fill = runSafe('fill', ['#a FILL']);
  assert('FILL ohne ref: kein Throw', fill.ok === true);
  assert(
    'FILL ohne ref: NICHT REFERENCE_NOT_FOUND (kein ref noetig)',
    fill.results[0]?.reasonCode !== 'REFERENCE_NOT_FOUND',
  );
}

// REGRESS (HIGH): ref-pflichtig MIT gueltiger ref → echte Auswertung, kein
// REFERENCE_NOT_FOUND, kein Throw (Beweis: die Wache blockt NICHT den Normalpfad).
console.log('--- HIGH REGRESS: #a DISTANCE-FROM #b 1 (ref da) ---');
{
  const { ok, results, arb } = runSafe('valid-ref', ['#a DISTANCE-FROM #b 1']);
  assert('valid-ref: kein Throw', ok === true);
  assert(
    'valid-ref: NICHT REFERENCE_NOT_FOUND',
    results[0]?.reasonCode !== 'REFERENCE_NOT_FOUND',
  );
  assert(
    'valid-ref: ausgewertet (passing, gap 180 >= 50)',
    arb.passing.length === 1,
  );
}

// =============================================================================
// FINDING 1 (E6 Re-Review-2): UNBEKANNTE Typen duerfen NICHT vom ref-Guard
// maskiert werden. requiresReference(unbekannt)=true (fail-closed) liess den
// HIGH-Guard frueher faelschlich auch fuer Tippfehler/Phantasie-Typen feuern →
// REFERENCE_NOT_FOUND statt CONSTRAINT_TYPE_UNKNOWN. Jetzt gated der Guard auf
// isRegistered(): unbekannte Typen fliessen weiter → CONSTRAINT_TYPE_UNKNOWN
// (+ Levenshtein-Vorschlag), KEIN Throw.
// =============================================================================
console.log(
  '--- FINDING-1: #a MADEUP (unbekannt) → CONSTRAINT_TYPE_UNKNOWN ---',
);
{
  const { ok, arb } = runSafe('madeup', ['#a MADEUP']);
  assert('madeup: kein Throw', ok === true);
  assert('madeup: 1 unchecked', arb.unchecked.length === 1);
  assert(
    'madeup: reasonCode CONSTRAINT_TYPE_UNKNOWN (NICHT REFERENCE_NOT_FOUND)',
    arb.unchecked[0]?.reasonCode === 'CONSTRAINT_TYPE_UNKNOWN',
  );
  assert(
    'madeup: NICHT vom ref-Guard maskiert',
    arb.unchecked[0]?.reasonCode !== 'REFERENCE_NOT_FOUND',
  );
}

console.log(
  '--- FINDING-1: #a CENTRD-IN (Tippfehler) → CONSTRAINT_TYPE_UNKNOWN + suggestion ---',
);
{
  const { ok, arb } = runSafe('typo', ['#a CENTRD-IN']);
  assert('typo: kein Throw', ok === true);
  assert(
    'typo: reasonCode CONSTRAINT_TYPE_UNKNOWN',
    arb.unchecked[0]?.reasonCode === 'CONSTRAINT_TYPE_UNKNOWN',
  );
  assert(
    'typo: suggestedCorrection vorhanden (CENTERED-IN)',
    arb.unchecked[0]?.suggestedCorrection === 'CENTERED-IN',
  );
  assert(
    'typo: NICHT REFERENCE_NOT_FOUND',
    arb.unchecked[0]?.reasonCode !== 'REFERENCE_NOT_FOUND',
  );
}

// INVARIANTE: bekannter ref-pflichtiger Typ ohne ref → weiterhin
// REFERENCE_NOT_FOUND (der HIGH-Fix bleibt, FINDING-1 hat ihn nicht aufgeweicht).
console.log(
  '--- FINDING-1 INVARIANTE: #a CENTERED-IN (bekannt, keine ref) ---',
);
{
  const { ok, arb } = runSafe('known-no-ref', ['#a CENTERED-IN']);
  assert('known-no-ref: kein Throw', ok === true);
  assert(
    'known-no-ref: reasonCode REFERENCE_NOT_FOUND (Invariante haelt)',
    arb.unchecked[0]?.reasonCode === 'REFERENCE_NOT_FOUND',
  );
}

// =============================================================================
// FINDING 2 (E6 Re-Review-2): arrange-Pfad nutzt jetzt dieselbe Registry-SSOT
// requiresReference() statt einer zweiten hartkodierten noRefTypes-Liste.
// =============================================================================
console.log('--- FINDING-2: arrange COLOR/FILL ohne ref unveraendert ---');
{
  const els = [{ id: 'a', tag: 'rect', x: 10, y: 10, width: 30, height: 30 }];
  const canvas = { width: 400, height: 300 };

  // COLOR ohne ref: KEINE „benoetigt eine Referenz"-Warnung (requiresReference:false).
  const colorOut = arrange(canvas, els, ['#a COLOR red']);
  assert(
    'arrange COLOR: keine "benoetigt eine Referenz"-Warnung',
    !colorOut.structured.warnings.some((w) =>
      w.includes('benoetigt eine Referenz'),
    ),
  );

  // FILL ohne ref: kein ref-Block; FILL hat arrange → patch wird angewandt.
  const fillOut = arrange(canvas, els, ['#a FILL']);
  assert(
    'arrange FILL: keine "benoetigt eine Referenz"-Warnung',
    !fillOut.structured.warnings.some((w) =>
      w.includes('benoetigt eine Referenz'),
    ),
  );
  assert(
    'arrange FILL: patch angewandt (Element fuellt Canvas, width=400)',
    fillOut.structured.attributes.a?.width === 400,
  );

  // REGRESS: ref-pflichtiger Typ OHNE ref → weiterhin geblockt (Verhalten wie zuvor).
  const distOut = arrange(canvas, els, ['#a DISTANCE-FROM']);
  assert(
    'arrange DISTANCE-FROM ohne ref: weiterhin "benoetigt eine Referenz"',
    distOut.structured.warnings.some((w) =>
      w.includes('DISTANCE-FROM benoetigt eine Referenz'),
    ),
  );
}

console.log(
  '--- FINDING-2: custom ref-freier Constraint NICHT in arrange geblockt ---',
);
{
  // Beweis fuer die SSOT: ein custom Constraint mit requiresReference:false +
  // arrange-Handler wird im arrange-Pfad NICHT mehr faelschlich blockiert
  // (frueher haette die hartkodierte noRefTypes={COLOR,FILL}-Liste ihn als
  // ref-pflichtig behandelt und mit „benoetigt eine Referenz" abgewiesen).
  registerConstraint('CUSTOM-NOREF', {
    requiresReference: false,
    check() {
      return { pass: true, detail: null };
    },
    arrange() {
      return { x: 99, y: 77 };
    },
  });
  const els = [{ id: 'a', tag: 'rect', x: 10, y: 10, width: 30, height: 30 }];
  const out = arrange({ width: 400, height: 300 }, els, ['#a CUSTOM-NOREF']);
  assert(
    'custom-noref arrange: NICHT geblockt (keine "benoetigt eine Referenz")',
    !out.structured.warnings.some((w) => w.includes('benoetigt eine Referenz')),
  );
  // Beweis: der arrange-Patch wurde tatsaechlich angewandt (Element a hat ein
  // Attribut bekommen). Die Enrichment uebersetzt {x:99,y:77} fuer ein rect mit
  // Ursprung (10,10) in transform="translate(89 67)" — entscheidend ist, dass
  // ueberhaupt ein Patch entstand (kein Block, kein "keine arrange-Funktion").
  assert(
    'custom-noref arrange: patch angewandt (Element a hat Attribute)',
    out.structured.attributes.a !== undefined &&
      Object.keys(out.structured.attributes.a).length > 0,
  );
  assert(
    'custom-noref arrange: keine "keine arrange-Funktion"-Warnung',
    !out.structured.warnings.some((w) => w.includes('keine arrange-Funktion')),
  );
}

// =============================================================================
// §H10 R11-21 FORCING (DoD-6): CONSTRAINT_UNPARSEABLE — ein nicht (vollstaendig)
// parsebarer Constraint-String wird sichtbar verweigert, nie still gedroppt
// (1:1-Bilanz) und nie zu einem Pseudo-Constraint uminterpretiert.
// =============================================================================
console.log('--- R11-21: Garbage → CONSTRAINT_UNPARSEABLE (echte Pipeline) ---');
{
  const cases = [
    ['banana', 'kein Typ-Token'],
    ['THIS IS NOT VALID', 'Rest-Token'],
    ['garbage no hashes', 'kein Typ-Token (Kleinschreibung)'],
    ['#a DISTANCE-FROM #b 3 extra', 'Rest-Token'],
    ['#a DISTANCE-FROM #b banane', 'nicht-numerischer Wert'],
  ];
  for (const [str, why] of cases) {
    const { results, arb } = run([str]);
    assert(`unparseable (${why}): 1:1-Bilanz (kein Drop)`, results.length === 1);
    assert(
      `unparseable (${why}): reasonCode CONSTRAINT_UNPARSEABLE`,
      results[0]?.reasonCode === 'CONSTRAINT_UNPARSEABLE',
    );
    assert(
      `unparseable (${why}): 1 unchecked, 0 passing (keine PASS-Luege)`,
      arb.unchecked.length === 1 && arb.passing.length === 0,
    );
    assert(
      `unparseable (${why}): hint traegt Roh-String + Grammatik-Navigation`,
      arb.unchecked[0]?.hint?.includes('Grammatik') &&
        arb.unchecked[0]?.hint?.includes(str),
    );
  }
  // Negativ-Kontrolle: hash-freie ids sind LEGAL (h9-K12-Kanon 'box LEFT-OF anker').
  const legal = run(['box LEFT-OF anker']);
  assert(
    'legal hash-frei: NICHT CONSTRAINT_UNPARSEABLE',
    legal.results[0]?.reasonCode !== 'CONSTRAINT_UNPARSEABLE',
  );
}

// =============================================================================
// §H10 R11-11 FORCING (DoD-6): SEMANTIC_SUSPICIOUS — Selbst-Referenz (Subjekt
// === Referenz) liefert ein geometrie-unabhängiges Verdikt (leeres Echo) und
// wird verweigert statt als PASS/Platzierung präsentiert.
// =============================================================================
console.log('--- R11-11: Selbst-Referenz → SEMANTIC_SUSPICIOUS ---');
{
  const { results, arb } = run(['#a CENTERED-IN #a']);
  assert('selfref: pass is null', results[0]?.pass === null);
  assert(
    'selfref: reasonCode SEMANTIC_SUSPICIOUS',
    results[0]?.reasonCode === 'SEMANTIC_SUSPICIOUS',
  );
  assert(
    'selfref: 1 unchecked, 0 passing (kein Tautologie-PASS)',
    arb.unchecked.length === 1 && arb.passing.length === 0,
  );
  assert(
    'selfref: hint trägt Navigation (anderes Element wählen)',
    arb.unchecked[0]?.hint?.includes('anderes Element'),
  );
  // Negativ-Kontrolle: echte Referenz bleibt unberührt.
  const legal = run(['#a CENTERED-IN #b']);
  assert(
    'selfref-Negativ: #a CENTERED-IN #b unverändert ausgewertet',
    legal.arb.unchecked.length === 0,
  );
}

console.log('--- R11-11: arrange verweigert Selbst-Referenz + flaggt Geister-Kette ---');
{
  const els = [
    { id: 'a', tag: 'rect', x: 10, y: 10, width: 20, height: 20 },
    { id: 'b', tag: 'rect', x: 0, y: 0, width: 60, height: 60 },
  ];
  const selfOut = arrange({ width: 100, height: 100 }, els, ['#a CENTERED-IN #a']);
  assert(
    'arrange selfref: kein attributes-Eintrag (kein Geister-Erfolg)',
    selfOut.structured.attributes.a === undefined,
  );
  assert(
    'arrange selfref: Warnung vorhanden',
    selfOut.structured.warnings.some((w) => w.includes('Selbst-Referenz')),
  );
  // (a) Abhängigkeits-Flag: b wird verweigert (#ghost fehlt), a referenziert b →
  // Wert wie heute + additive Warnung über die Ausgangslage-Basis.
  const chainOut = arrange({ width: 100, height: 100 }, els, [
    '#b CENTERED-IN #ghost',
    '#a CENTERED-IN #b',
  ]);
  assert(
    'arrange Kette: Referenz-#ghost-Warnung vorhanden',
    chainOut.structured.warnings.some((w) => w.includes('#ghost')),
  );
  assert(
    'arrange Kette: Abhängigkeits-Flag (Ausgangslage) vorhanden',
    chainOut.structured.warnings.some((w) => w.includes('Ausgangslage')),
  );
  assert(
    'arrange Kette: a-Platzierung bleibt (Wert unangetastet, Flag statt Eingriff)',
    chainOut.structured.attributes.a !== undefined,
  );
}

console.log('--- R11-21: arrange routet Verweigerung in warnings[] ---');
{
  const els = [{ id: 'a', tag: 'rect', x: 10, y: 10, width: 30, height: 30 }];
  const out = arrange({ width: 400, height: 300 }, els, ['banana']);
  assert(
    'arrange unparseable: warnings[] traegt "nicht parsebar"',
    out.structured.warnings.some((w) => w.includes('nicht parsebar')),
  );
}

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
