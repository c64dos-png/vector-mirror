/**
 * test_honesty.js - Honesty-Gate Fundament (Schritt 1) Unit-Tests
 * Verifiziert die 4 reinen, deterministischen Funktionen aus core/honesty.js:
 *   allowDeltas · classifyCanvas · assertEmissionGated · countTruncation
 *
 * HONEST-RED zuerst: dieser Test wird vor der Implementierung geschrieben und
 * muss vor honesty.js ROT sein (Import-Fehler), danach GRUEN.
 *
 * Port-Belege:
 *   - allowDeltas  == structured.js:359  (`reliability === 'reliable'`)
 *   - assertEmissionGated == schema.js:316-345 superRefine (Live-Form)
 * Vector Mirror v2.0
 */
import {
  allowDeltas,
  assertEmissionGated,
  classifyCanvas,
  countTruncation,
  gateCorrections,
} from '../../src/core/honesty.js';

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

// ---------------------------------------------------------------------------
// allowDeltas — SSOT-Gate, byte-genauer Port von structured.js:359
//   const allowDeltas = elReliability === 'reliable';
// ---------------------------------------------------------------------------
console.log('--- HONESTY: allowDeltas (== structured.js:359) ---');
assert("allowDeltas('reliable') === true", allowDeltas('reliable') === true);
assert(
  "allowDeltas('approximate') === false (Pessimismus)",
  allowDeltas('approximate') === false,
);
assert(
  "allowDeltas('not_measurable') === false (Pessimismus)",
  allowDeltas('not_measurable') === false,
);
// Default-deny fuer alles ausserhalb des reliable-Werts (Spotter-Anti-Luege).
assert('allowDeltas(undefined) === false', allowDeltas(undefined) === false);
assert('allowDeltas(null) === false', allowDeltas(null) === false);
assert("allowDeltas('') === false", allowDeltas('') === false);
assert(
  "allowDeltas('RELIABLE') === false (case-sensitiv, byte-genau)",
  allowDeltas('RELIABLE') === false,
);
assert("allowDeltas('garbage') === false", allowDeltas('garbage') === false);
// Rueckgabe ist strikt boolean (kein truthy/falsy-Leak).
assert(
  "allowDeltas('reliable') ist typeof boolean",
  typeof allowDeltas('reliable') === 'boolean',
);
assert(
  'allowDeltas(undefined) ist typeof boolean',
  typeof allowDeltas(undefined) === 'boolean',
);

// MUTATIONS-CHECK (Andon-Cord): die Pessimismus-Invariante ist die ganze
// Daseinsberechtigung des Gates. Wuerde allowDeltas('approximate') jemals
// `true` liefern (z.B. invertierte Bedingung), MUSS dieser Test ROT werden.
// Belegt im Worklog: kuenstliche Umkehr `=== 'reliable'` -> `!== 'reliable'`
// macht genau diese Assertion rot.
assert(
  'MUTATION-GUARD: approximate darf NIEMALS Deltas erlauben',
  allowDeltas('approximate') === false,
);

// ---------------------------------------------------------------------------
// classifyCanvas — Pessimismus-Praezedenz (am-staerksten-degradiert gewinnt)
//   1. nicht-leerer sanitizeLoss      -> 'lossy'
//   2. viewBoxValidity 'degenerate'   -> 'degenerate'
//   3. viewBoxValidity 'default_replaced' -> 'default_replaced'
//   4. sonst                          -> 'valid'
// ---------------------------------------------------------------------------
console.log('--- HONESTY: classifyCanvas (Pessimismus-Praezedenz) ---');
assert(
  "valid: leerer sanitizeLoss + viewBoxValidity 'valid'",
  classifyCanvas({ viewBoxValidity: 'valid', sanitizeLoss: [] }) === 'valid',
);
assert(
  "default_replaced: viewBoxValidity 'default_replaced', kein Loss",
  classifyCanvas({
    viewBoxValidity: 'default_replaced',
    sanitizeLoss: [],
  }) === 'default_replaced',
);
assert(
  "degenerate: viewBoxValidity 'degenerate', kein Loss",
  classifyCanvas({ viewBoxValidity: 'degenerate', sanitizeLoss: [] }) ===
    'degenerate',
);
assert(
  'lossy: nicht-leerer sanitizeLoss (Array)',
  classifyCanvas({
    viewBoxValidity: 'valid',
    sanitizeLoss: ['script'],
  }) === 'lossy',
);
// Praezedenz: sanitizeLoss DOMINIERT jede viewBoxValidity (auch degenerate).
assert(
  'PRAEZEDENZ: lossy schlaegt degenerate (sanitizeLoss dominiert)',
  classifyCanvas({
    viewBoxValidity: 'degenerate',
    sanitizeLoss: ['use'],
  }) === 'lossy',
);
assert(
  'PRAEZEDENZ: lossy schlaegt default_replaced',
  classifyCanvas({
    viewBoxValidity: 'default_replaced',
    sanitizeLoss: ['animate'],
  }) === 'lossy',
);
// Praezedenz: degenerate DOMINIERT default_replaced.
assert(
  'PRAEZEDENZ: degenerate schlaegt default_replaced',
  classifyCanvas({
    viewBoxValidity: 'default_replaced',
    sanitizeLoss: [],
  }) !== 'degenerate' &&
    classifyCanvas({
      viewBoxValidity: 'degenerate',
      sanitizeLoss: [],
    }) === 'degenerate',
);
// Robustheit: fehlende/leere Felder -> Pessimismus-neutral als 'valid'
// behandeln (sanitizeLoss leer, viewBoxValidity nicht degradierend).
assert(
  'fehlendes sanitizeLoss (undefined) ist nicht-lossy',
  classifyCanvas({ viewBoxValidity: 'valid' }) === 'valid',
);
assert(
  'leeres Objekt -> valid (keine Degradierung gemeldet)',
  classifyCanvas({}) === 'valid',
);
// sanitizeLoss mit Eintraegen unterschiedlicher Form ist trotzdem lossy.
assert(
  'sanitizeLoss mit mehreren Eintraegen -> lossy',
  classifyCanvas({
    viewBoxValidity: 'valid',
    sanitizeLoss: ['a', 'b', 'c'],
  }) === 'lossy',
);

// ---------------------------------------------------------------------------
// assertEmissionGated — Live-Form von schema.js:316-345 superRefine.
//   Gegeben { scene.elements[].{id,bbox_reliability}, corrections[] }:
//   eine correction ist ein Verstoss, wenn ihr Ziel-Element
//   bbox_reliability ∈ {not_measurable, approximate} hat UND die correction
//   dx oder dy traegt. element-Praefix '#' wird gestrippt (schema.js:326).
// ---------------------------------------------------------------------------
console.log('--- HONESTY: assertEmissionGated (== schema.js:316-345) ---');

// Sauber: reliable Element mit dx -> KEIN Verstoss.
assert(
  'reliable Element mit dx -> 0 Verstoesse',
  assertEmissionGated({
    scene: { elements: [{ id: 'a', bbox_reliability: 'reliable' }] },
    corrections: [{ element: '#a', dx: 5 }],
  }).length === 0,
);

// Verstoss: approximate Element mit dx -> 1 Verstoss.
assert(
  'approximate Element mit dx -> 1 Verstoss',
  assertEmissionGated({
    scene: { elements: [{ id: 'a', bbox_reliability: 'approximate' }] },
    corrections: [{ element: '#a', dx: 5 }],
  }).length === 1,
);

// Verstoss: not_measurable Element mit dy -> 1 Verstoss.
assert(
  'not_measurable Element mit dy -> 1 Verstoss',
  assertEmissionGated({
    scene: { elements: [{ id: 'a', bbox_reliability: 'not_measurable' }] },
    corrections: [{ element: '#a', dy: -3 }],
  }).length === 1,
);

// approximate Element OHNE dx/dy -> KEIN Verstoss (nur dx/dy zaehlen).
assert(
  'approximate Element ohne dx/dy -> 0 Verstoesse',
  assertEmissionGated({
    scene: { elements: [{ id: 'a', bbox_reliability: 'approximate' }] },
    corrections: [{ element: '#a', dw: 2 }],
  }).length === 0,
);

// '#'-Praefix-Stripping: element '#box1' matcht id 'box1'.
assert(
  "'#'-Praefix wird gestrippt (element '#box1' matcht id 'box1')",
  assertEmissionGated({
    scene: { elements: [{ id: 'box1', bbox_reliability: 'approximate' }] },
    corrections: [{ element: '#box1', dx: 1 }],
  }).length === 1,
);

// Lookup-Fehlschlag (reliability undefined) -> KEIN Verstoss (schema.js:332).
assert(
  'unbekanntes element (kein Lookup-Treffer) -> 0 Verstoesse',
  assertEmissionGated({
    scene: { elements: [{ id: 'a', bbox_reliability: 'approximate' }] },
    corrections: [{ element: '#ghost', dx: 9 }],
  }).length === 0,
);

// reliable Element -> kein Verstoss, selbst mit dx und dy.
assert(
  'reliable Element mit dx UND dy -> 0 Verstoesse',
  assertEmissionGated({
    scene: { elements: [{ id: 'a', bbox_reliability: 'reliable' }] },
    corrections: [{ element: '#a', dx: 5, dy: 5 }],
  }).length === 0,
);

// Mehrere Verstoesse werden alle gemeldet.
assert(
  'zwei verletzende corrections -> 2 Verstoesse',
  assertEmissionGated({
    scene: {
      elements: [
        { id: 'a', bbox_reliability: 'approximate' },
        { id: 'b', bbox_reliability: 'not_measurable' },
      ],
    },
    corrections: [
      { element: '#a', dx: 1 },
      { element: '#b', dy: 2 },
    ],
  }).length === 2,
);

// Defensive Guards (schema.js:317-318,325): fehlende scene/elements/corrections.
assert(
  'fehlende scene -> 0 Verstoesse (defensiver Guard)',
  assertEmissionGated({ corrections: [{ element: '#a', dx: 1 }] }).length === 0,
);
assert(
  'elements kein Array -> 0 Verstoesse',
  assertEmissionGated({
    scene: { elements: null },
    corrections: [{ element: '#a', dx: 1 }],
  }).length === 0,
);
assert(
  'corrections kein Array -> 0 Verstoesse',
  assertEmissionGated({
    scene: { elements: [{ id: 'a', bbox_reliability: 'approximate' }] },
    corrections: null,
  }).length === 0,
);
assert(
  'correction.element kein String -> uebersprungen (0 Verstoesse)',
  assertEmissionGated({
    scene: { elements: [{ id: 'a', bbox_reliability: 'approximate' }] },
    corrections: [{ element: 42, dx: 1 }],
  }).length === 0,
);

// Jeder Verstoss traegt den Index der verletzenden correction (path-Aequivalent
// von schema.js:339 path:['corrections', i]).
{
  const v = assertEmissionGated({
    scene: {
      elements: [
        { id: 'a', bbox_reliability: 'reliable' },
        { id: 'b', bbox_reliability: 'approximate' },
      ],
    },
    corrections: [
      { element: '#a', dx: 1 },
      { element: '#b', dx: 2 },
    ],
  });
  assert(
    'Verstoss traegt Index der verletzenden correction (i=1)',
    v.length === 1 && v[0].index === 1,
  );
}

// ---------------------------------------------------------------------------
// countTruncation — { total, returned, suppressed }
//   total = items.length, returned = min(cap,total), suppressed = max(0,total-cap)
// ---------------------------------------------------------------------------
console.log('--- HONESTY: countTruncation ---');
assert(
  'keine Trunkierung: 3 items, cap 7 -> {3,3,0}',
  (() => {
    const r = countTruncation([1, 2, 3], 7);
    return r.total === 3 && r.returned === 3 && r.suppressed === 0;
  })(),
);
assert(
  'Trunkierung: 10 items, cap 7 -> {10,7,3}',
  (() => {
    const r = countTruncation(new Array(10).fill(0), 7);
    return r.total === 10 && r.returned === 7 && r.suppressed === 3;
  })(),
);
assert(
  'Grenzfall: total == cap -> {7,7,0}',
  (() => {
    const r = countTruncation(new Array(7).fill(0), 7);
    return r.total === 7 && r.returned === 7 && r.suppressed === 0;
  })(),
);
assert(
  'leere Liste -> {0,0,0}',
  (() => {
    const r = countTruncation([], 7);
    return r.total === 0 && r.returned === 0 && r.suppressed === 0;
  })(),
);
assert(
  'cap 0 -> alles suppressed (5 items -> {5,0,5})',
  (() => {
    const r = countTruncation([1, 2, 3, 4, 5], 0);
    return r.total === 5 && r.returned === 0 && r.suppressed === 5;
  })(),
);
assert(
  'cap groesser als total -> returned == total, suppressed 0',
  (() => {
    const r = countTruncation([1, 2], 100);
    return r.total === 2 && r.returned === 2 && r.suppressed === 0;
  })(),
);

// ---------------------------------------------------------------------------
// gateCorrections — die EINE Pessimismus-Entscheidung pro failing-issue.
//   Annotiert _gated = allowDeltas(reliabilityOf(id) ?? '?'); bei _gated===false
//   ein um dx/dy/dw/dh BEREINIGTES Derivat (kein Delta-Leak mehr moeglich).
// ---------------------------------------------------------------------------
console.log('--- HONESTY: gateCorrections (Emissions-Rand SSOT) ---');

const relMap = new Map([
  ['ok', 'reliable'],
  ['approx', 'approximate'],
  ['blind', 'not_measurable'],
]);
const relOf = (id) => relMap.get(id);

// reliable Element: _gated===true, dx/dy/dw/dh BLEIBEN (byte-identisch).
{
  const g = gateCorrections([{ id: 'ok', dx: 5, dy: -3, dw: 2, dh: 1 }], relOf);
  assert('reliable: _gated === true', g[0]._gated === true);
  assert('reliable: dx erhalten', g[0].dx === 5);
  assert('reliable: dy erhalten', g[0].dy === -3);
  assert('reliable: dw erhalten', g[0].dw === 2);
  assert('reliable: dh erhalten', g[0].dh === 1);
}

// approximate Element: _gated===false, dx/dy/dw/dh ENTFERNT (Derivat bereinigt).
{
  const g = gateCorrections(
    [{ id: 'approx', dx: 5, dy: -3, dw: 2, dh: 1, constraint: 'X' }],
    relOf,
  );
  assert('approximate: _gated === false', g[0]._gated === false);
  assert('approximate: dx entfernt', g[0].dx === undefined);
  assert('approximate: dy entfernt', g[0].dy === undefined);
  assert('approximate: dw entfernt', g[0].dw === undefined);
  assert('approximate: dh entfernt', g[0].dh === undefined);
  assert('approximate: non-delta-Felder bleiben', g[0].constraint === 'X');
}

// not_measurable Element: _gated===false, Deltas entfernt.
{
  const g = gateCorrections([{ id: 'blind', dx: 9 }], relOf);
  assert('not_measurable: _gated === false', g[0]._gated === false);
  assert('not_measurable: dx entfernt', g[0].dx === undefined);
}

// Default-deny: unbekannte id (kein Lookup-Treffer) → _gated===false, kein dx.
{
  const g = gateCorrections([{ id: 'ghost', dx: 7 }], relOf);
  assert(
    'unbekannte id: _gated === false (default-deny)',
    g[0]._gated === false,
  );
  assert('unbekannte id: dx entfernt', g[0].dx === undefined);
}

// EINE Entscheidung pro issue: jedes issue traegt _gated (Vertragsfeld).
{
  const g = gateCorrections(
    [{ id: 'ok' }, { id: 'approx' }, { id: 'ghost' }],
    relOf,
  );
  assert(
    'jedes issue traegt _gated !== undefined (fail-closed-Vertrag)',
    g.every((i) => i._gated !== undefined),
  );
  assert('Reihenfolge erhalten (3 issues)', g.length === 3);
  assert(
    '_gated ist strikt boolean',
    g.every((i) => typeof i._gated === 'boolean'),
  );
}

// Robustheit: nicht-Array → [].
assert(
  'gateCorrections(undefined) === []',
  gateCorrections(undefined, relOf).length === 0,
);
assert(
  'gateCorrections([], relOf) === []',
  gateCorrections([], relOf).length === 0,
);

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
