/**
 * RED AUDIT 2026-04-17 — Reproducer-Suite
 * Empirische Belege für alle Findings. Sollen nach Fix als Regressionstests dienen.
 */

import { arbitrate } from '../../src/core/arbitrate.js';
import { checkConstraint } from '../../src/core/constraints/registry.js';
import {
  analyze,
  arrange,
  compare,
  init,
  inspect,
  palette,
  parseConstraints,
  shutdown,
} from '../../src/pipeline.js';
import '../../src/core/constraints/loader.js';

let fails = 0;
function check(label, cond, detail = '') {
  const ok = !!cond;
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails++;
  return ok;
}

console.log('\n=== CRITICAL FINDINGS (pure, no browser) ===');

console.log(
  '\n[C-1a] Typo-Constraint wird sichtbar als unchecked (P1-04 Fix):',
);
const r_typo = checkConstraint(
  'CENTRD-IN',
  { bbox: { x: 0, y: 0, w: 10, h: 10 } },
  { bbox: { x: 100, y: 100, w: 10, h: 10 } },
  { grid: { cellW: 50, cellH: 50 } },
);
const a_typo = arbitrate(
  [{ ...r_typo, id: 'a', constraintType: 'CENTRD-IN' }],
  [],
);
check(
  'arbitrate.unchecked enthaelt Typo (kein Silent-Pass)',
  a_typo.totals.unchecked_count === 1,
  `unchecked=${a_typo.totals.unchecked_count}, total=${a_typo.totals.total}`,
);
check(
  'reasonCode = CONSTRAINT_TYPE_UNKNOWN',
  a_typo.unchecked[0].reasonCode === 'CONSTRAINT_TYPE_UNKNOWN',
);
check(
  "suggestedCorrection = 'CENTERED-IN' (Levenshtein <=2)",
  a_typo.unchecked[0].suggestedCorrection === 'CENTERED-IN',
);

console.log('\n[C-1b] FILL-Constraint pass:null wird sichtbar als unchecked:');
const r_fill = checkConstraint(
  'FILL',
  { bbox: { x: 0, y: 0, w: 10, h: 10 } },
  null,
  { grid: { cellW: 50, cellH: 50 } },
);
check('FILL check liefert pass:null', r_fill.pass === null);
const a_fill = arbitrate([{ ...r_fill, id: 'a', constraintType: 'FILL' }], []);
check(
  'arbitrate.unchecked surface FILL (kein Silent-Pass)',
  a_fill.totals.unchecked_count === 1,
);
check(
  'reasonCode fuer FILL ist MEASUREMENT_AMBIGUOUS',
  a_fill.unchecked[0].reasonCode === 'MEASUREMENT_AMBIGUOUS',
);

console.log('\n[C-2] DISTANCE-FROM value=0:');
const subj = { id: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } };
const overlap = { id: 'b', bbox: { x: 0, y: 0, w: 10, h: 10 } };
const r_dist = checkConstraint('DISTANCE-FROM', subj, overlap, {
  grid: { cellW: 50, cellH: 50 },
  value: 0,
});
check(
  'Überlappende Objekte → DISTANCE-FROM value=0 pass=true',
  r_dist.pass === true,
  'semantisch absurd',
);

console.log('\n[M-3] Convergence STAGNATING beim ersten Call ohne prev:');

import { formatStructured } from '../../src/adapters/emitter/structured.js';
// §E1: formatStructured verlangt jetzt gegatete failing-issues (_gated-Vertrag,
// fail-closed). Wie der Prod-Caller pipeline.js die failing-Liste durch
// honesty.js#gateCorrections schleusen (Test-Infra, kein Produkt-Pfad).
import { gateCorrections } from '../../src/core/honesty.js';

const fakeMap = {
  canvas: { width: 100, height: 100 },
  grid: { cellsX: 2, cellsY: 2 },
  elements: [],
};
const fakeArb = {
  passing: [],
  failing: [{ type: 'CONSTRAINT_FAIL', severity: 0, id: 'x' }],
  unchecked: [],
  diff: [],
  totals: {
    total: 1,
    passing_count: 0,
    failing_count: 1,
    unchecked_count: 0,
    diff_count: 0,
  },
};
const relById = new Map(
  fakeMap.elements.map((e) => [e.id, e.bbox_reliability]),
);
const s = formatStructured(
  fakeMap,
  {
    ...fakeArb,
    failing: gateCorrections(fakeArb.failing, (id) => relById.get(id)),
  },
  {},
);
// §H9 K-12 (geheilt, Reproducer → Regressionstest gemäß Suite-Kopf): der
// Erstlauf mit Fehlern behauptet keinen Trend mehr — BASELINE statt des
// früheren irreführenden STAGNATING.
check(
  'Erster Call mit Fehlern: convergence = BASELINE (keine Trend-Behauptung)',
  s.iteration.convergence === 'BASELINE',
  `gemeldet: ${s.iteration.convergence}`,
);

console.log('\n=== BROWSER-ABHÄNGIGE CHECKS ===');
await init();

console.log(
  '\n[NEU-1] tspan wird als separates Element gezählt (Doppelzählung):',
);
const r1 = await analyze(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><text id="t1" x="10" y="50">Hello <tspan id="ts1">World</tspan></text></svg>',
  [],
);
const count = r1.structured?.scene.elements.length;
check('text+tspan ergibt mehr als 1 Element', count > 1, `gezählt: ${count}`);

console.log(
  '\n[NEU-2] <g id> als Constraint-Referenz: status NICHT PASS (P1-04 Fix):',
);
const r2 = await analyze(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><g id="grp"><rect x="0" y="0" width="100" height="100" fill="blue"/></g><circle id="c1" cx="300" cy="200" r="10" fill="red"/></svg>',
  ['#c1 CENTERED-IN #grp'],
);
check(
  'Status ist nicht PASS wenn #grp nicht aufloesbar',
  r2.structured?.status !== 'PASS',
  `status=${r2.structured?.status}, unchecked=${r2.structured?.unchecked?.length ?? 0}, corrections=${r2.structured?.corrections.length}`,
);

console.log(
  '\n[NEU-3] <g opacity=0.05> mit child opacity=1: Kind wird NICHT übersprungen:',
);
const r3 = await analyze(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><g opacity="0.05"><rect id="ghost" x="0" y="0" width="100" height="100" fill="red"/></g></svg>',
  [],
);
const ghostSeen = r3.structured?.scene.elements.find((e) => e.id === 'ghost');
check(
  'Fast unsichtbares Element wird als sichtbar behandelt',
  !!ghostSeen,
  `Tool sieht mehr als Mensch: ${JSON.stringify(ghostSeen)}`,
);

console.log(
  '\n[NEU-4] Cross-Session State Leak — Sign-Flip nach §1.3 Schicht 2:',
);
// Pre-Schicht-2 (rot): compare() ohne analysisId zog lastGridMap aus Modul-Scope,
//   das von svg_B-analyze ueberschrieben wurde → diff.VERSCHOBEN sichtbar.
// Post-Schicht-2 (gruen): Map<analysisId, gridMap> + Caller-Choice; expliziter idA
//   referenziert isoliert svg_A's gridMap → diff leer (Caller-Pflicht erfuellt).
const svg_A =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect x="10" y="10" width="20" height="20" fill="red"/></svg>';
const svg_B =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect x="380" y="280" width="20" height="20" fill="blue"/></svg>';
const rA = await analyze(svg_A, []);
const rB = await analyze(svg_B, []);
// Both have one <rect> without id → auto-ID "_rect1" (unveraenderter Befund).
const idA_elem = rA.structured.scene.elements[0].id;
const idB_elem = rB.structured.scene.elements[0].id;
check(
  'Beide SVGs erzeugen identische auto-IDs (Stable-Path-Kollision)',
  idA_elem === idB_elem,
  `A: ${idA_elem}, B: ${idB_elem}`,
);
// §1.3 Schicht 2: explizite analysisId aus svg_A-analyze als Caller-Choice.
const idA_analysis = rA.structured.iteration.analysisId;
const rC = await compare(svg_A, [], idA_analysis);
const diffHasVerschoben = rC.structured?.diff.some(
  (d) => d.type === 'VERSCHOBEN',
);
// Polaritaet umgedreht: Sign-Flip = Schicht-2-Erfolg.
check(
  'compare(svg_A, [], idA) zeigt KEINE Bewegungen (Isolation via explicit ID)',
  !diffHasVerschoben,
  `diff: ${JSON.stringify(rC.structured?.diff)}`,
);

console.log(
  '\n[NEU-5] inspect() ist read-only — verifiziert nach §1.3 Schicht 2:',
);
// Pre-Schicht-2 (rot): inspect() schrieb lastGridMap im Modul-Scope → compare()
//   nach inspect(svg_B) sah svg_A als "verschoben" gegen svg_B's Map → diff.length > 0.
// Post-Schicht-2 (gruen): inspect liest grids[mostRecent] read-only fuer
//   ID-Continuity, mutiert weder grids noch mostRecentAnalysisId.
//   compare(svg_A) sieht weiterhin svg_A's eigene gridMap → diff leer.
await inspect(svg_A); // read-only Probe
const rA2 = await analyze(svg_A, []);
await inspect(svg_B); // darf mostRecent NICHT auf svg_B umschalten
const rD = await compare(svg_A, [], rA2.structured.iteration.analysisId);
const contaminated = rD.structured?.diff.length > 0;
// Polaritaet umgedreht: Sign-Flip = Schicht-2-Erfolg.
check(
  'inspect() ist read-only (mostRecent unangetastet)',
  !contaminated,
  `compare nach inspect: ${rD.structured?.diff.length} diff-Eintraege`,
);

console.log('\n[NEU-6] Unicode-ID in prose-Regex:');
const r6 = await analyze(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect id="äöü" x="10" y="10" width="50" height="50"/><rect id="ref" x="100" y="100" width="200" height="200"/></svg>',
  ['#äöü CENTERED-IN #ref'],
);
const proseHasUnicode = r6.prose.includes('äöü');
check(
  'Prose-Report erwähnt Unicode-ID',
  proseHasUnicode,
  `prose snippet: ${r6.prose.split('\n')[1]}`,
);

console.log('\n[NEU-7] SVG ohne viewBox: Koordinatensystem-Fallback:');
const r7 = await analyze(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect id="r" x="100" y="50" width="50" height="50" fill="red"/></svg>',
  [],
);
const el7 = r7.structured?.scene.elements[0];
check(
  'SVG ohne viewBox liefert Element',
  !!el7,
  `scene: ${JSON.stringify(r7.structured?.scene)}`,
);

console.log(
  '\n[NEU-8] Element außerhalb viewBox (clipped): trotzdem sichtbar im Tool?',
);
const r8 = await analyze(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect id="visible" x="100" y="100" width="50" height="50" fill="blue"/><rect id="outside" x="1000" y="1000" width="50" height="50" fill="red"/></svg>',
  [],
);
const outsideEl = r8.structured?.scene.elements.find((e) => e.id === 'outside');
check(
  'Element außerhalb viewBox erscheint in Scene',
  !!outsideEl,
  `Tool sieht Element das visuell clipped ist: ${JSON.stringify(outsideEl)}`,
);

console.log('\n[NEU-9] Self-Reference #a CENTERED-IN #a:');
const r9 = await analyze(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect id="a" x="100" y="100" width="50" height="50" fill="red"/></svg>',
  ['#a CENTERED-IN #a'],
);
// §H10 R11-11: das tautologische PASS war eine stille Lüge — die Identitäts-
// Wache verweigert die Messung jetzt ehrlich (SEMANTIC_SUSPICIOUS → PARTIAL).
check(
  'Self-Reference wird ehrlich verweigert (PARTIAL, SEMANTIC_SUSPICIOUS)',
  r9.structured?.status === 'PARTIAL' &&
    r9.structured?.unchecked?.[0]?.reasonCode === 'SEMANTIC_SUSPICIOUS',
  `status: ${r9.structured?.status}, unchecked: ${JSON.stringify(r9.structured?.unchecked)}`,
);

console.log('\n[NEU-10] Text-Baseline vs bbox center:');
const r10 = await analyze(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect id="box" x="0" y="0" width="400" height="300"/><text id="txt" x="200" y="150" text-anchor="middle" dominant-baseline="middle">Centered</text></svg>',
  ['#txt CENTERED-IN #box'],
);
check(
  'Text mit dominant-baseline="middle" wird als zentriert erkannt',
  r10.structured?.status === 'PASS',
  `status: ${r10.structured?.status}, corrections: ${JSON.stringify(r10.structured?.corrections)}`,
);

await shutdown();

console.log(
  `\n=== ${fails === 0 ? 'ALLE CHECKS BESTÄTIGT' : `${fails} UNERWARTETE ABWEICHUNG(EN)`} ===`,
);
process.exit(fails === 0 ? 0 : 1);
