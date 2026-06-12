/**
 * test_determinism.mjs — §1.9 Determinismus-Suite (N=100) + Kalibrierung + Mutation-Test
 *
 * ZWEI GETRENNTE BEWEISE (nicht vermischen):
 *   (A) DETERMINISMUS: N=100 gleicher Input → gleicher Output, BYTEWISE nach Strip
 *       (UUID/analysisId/ISO-ts/duration_ms/renderTime/latencyMean/auto-id-hash;
 *       status zusätzlich breaker=null + browser normalisiert; deep-sort + toFixed6).
 *       Beweist Reproduzierbarkeit über 7 Tools × 5 EK.
 *   (B) KALIBRIERUNG (Eichkörper): Output PARTIAL-matcht die anti-zirk aus den
 *       Spec-Formeln abgeleiteten expected-Felder (via runSelftest, REGEL-2).
 *       Beweist Korrektheit gegen die Spec-Wahrheit — NICHT nur Selbst-Konsistenz.
 *
 * MUTATION-TEST (PFLICHT): EIN künstlicher Drift auf einem STABILEN (nicht-
 * volatilen) Feld → strip(o) !== strip(mutate(o)). Beweist, dass der Strip NICHT
 * zu aggressiv ist (sonst False-Green: ein echter Drift würde weggestrippt).
 *
 * OD-5: N=100 Default. N=1000 nur als separates Release-Gate (NODE_DET_N=1000),
 * NICHT im Standard-CI-Lauf.
 *
 * Invocation: node tests/integration/test_determinism.mjs   (in-process, 1 Browser)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyze,
  arrange,
  compare,
  getConstraintTypes,
  getStatus,
  init,
  inspect,
  palette,
  runSelftest,
  shutdown,
} from '../../src/pipeline.js';

const N = Number(process.env.NODE_DET_N) || 100; // OD-5: 100 Default, 1000 Release-Gate

const GOLDEN = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'golden',
);
const EK_NAMES = [
  'EK-1_color',
  'EK-2_position',
  'EK-3_constraint',
  'EK-4_3d',
  'EK-5_animation',
];
const loadSvg = (name) => readFileSync(join(GOLDEN, `${name}.svg`), 'utf8');

let passed = 0;
let failed = 0;
function ok(label) {
  console.log(`  PASS: ${label}`);
  passed++;
}
function bad(label, detail = '') {
  console.log(`  FAIL: ${label}${detail ? ' — ' + detail : ''}`);
  failed++;
}
function assert(label, cond, detail = '') {
  if (cond) ok(label);
  else bad(label, detail);
}

// ── STRIP-PATTERNS (≥3 gefordert, SC-5; hier 4) + KANONISIERUNG ─────────────
// SOTA-Präzision 2: jede number → toFixed(6), Keys rekursiv sortiert. Die 4
// .replace(/…/)-Patterns werden in stripAndCanon() über STRIP_PATTERNS angewandt.
// Reihenfolge = Anwendung; jedes Pattern begründet (volatile/pro-Call-Felder).
const STRIP_PATTERNS = [
  // Pattern 1 — UUID v4 (iteration.analysisId, pro-Call frische UUID):
  [
    /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
    'UUID',
  ],
  // Pattern 2 — ISO-Timestamp (defensiv; calibration.timestamp könnte einen tragen):
  [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, 'ISO_TS'],
  // Pattern 3 — Telemetrie-Floats (duration_ms/renderTime/latencyMean, volatil):
  [/"(duration_ms|renderTime|latencyMean)"\s*:\s*[0-9.]+/g, '"$1":0'],
  // Pattern 4 — §1.3 Auto-ID-Präfix _<8hex>_ (Defense-in-Depth; EK tragen explizite ids):
  [/_[0-9a-f]{8}_/g, '_HASH_'],
];

/** Rekursiver Deep-Sort-Walker (gegen Map/Set-Iteration-Order-Drift, OneUptime-BP). */
function deepSort(value) {
  if (Array.isArray(value)) return value.map(deepSort);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort())
      out[key] = deepSort(value[key]);
    return out;
  }
  // toFixed(6) auf jeden number-Wert (Defense-in-Depth gegen künftige float-Felder).
  if (typeof value === 'number' && Number.isFinite(value))
    return Number(value.toFixed(6));
  return value;
}

/**
 * Kanonisiert + strippt einen strukturierten Output zu einer stabilen
 * Bytewise-Signatur. opts.status normalisiert breaker + browser (volatil).
 */
function stripAndCanon(obj, opts = {}) {
  const clone = JSON.parse(JSON.stringify(obj ?? null));
  if (opts.status && clone && typeof clone === 'object') {
    // status_special: breaker-Telemetrie + browser-State sind volatil → normalisieren.
    clone.breaker = null;
    if ('browser' in clone) clone.browser = 'normalized';
    if ('calibration' in clone) clone.calibration = null;
  }
  const sorted = deepSort(clone);
  let s = JSON.stringify(sorted);
  for (const [re, sub] of STRIP_PATTERNS) s = s.replace(re, sub);
  return s;
}

/** Sammelt N strip-signaturen eines async-Producers in ein Set (Determinismus). */
async function collectN(label, producer, n, opts) {
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const out = await producer();
    seen.add(stripAndCanon(out, opts));
  }
  assert(
    `[A] ${label}: ${n}× → 1 unique (deterministisch)`,
    seen.size === 1,
    `${seen.size}/${n} unique`,
  );
  return seen;
}

await init();
let exitCode = 0;
try {
  console.log(`=== §1.9 Determinismus-Suite (N=${N}) ===`);

  // Seed-analysisId für compare (braucht eine reale Baseline VOR der Schleife).
  const ek3svg = loadSvg('EK-3_constraint');
  const seed = await analyze(ek3svg, [
    '#a CENTERED-IN #bg',
    '#a NO-OVERLAP #b',
  ]);
  const seedId = seed.structured?.iteration?.analysisId;
  assert('Seed analysisId vorhanden (für compare-Baseline)', !!seedId);

  // ── (A) DETERMINISMUS: 4 Browser-Tools × 5 EK = 20 Combos, je N ─────────────
  console.log(
    '\n--- (A) DETERMINISMUS: analyze/compare/inspect/palette × 5 EK ---',
  );
  const svgs = Object.fromEntries(EK_NAMES.map((n) => [n, loadSvg(n)]));
  for (const name of EK_NAMES) {
    const svg = svgs[name];
    await collectN(
      `analyze × ${name}`,
      () => analyze(svg, []).then((r) => r.structured),
      N,
    );
    await collectN(
      `compare × ${name}`,
      () => compare(svg, [], seedId).then((r) => r.structured),
      N,
    );
    await collectN(
      `inspect × ${name}`,
      () => inspect(svg).then((r) => r.structured),
      N,
    );
    await collectN(
      `palette × ${name}`,
      () => palette(svg).then((r) => r.structured),
      N,
    );
  }

  // ── (A) DETERMINISMUS: constraints/status/arrange (input-frei bzw. fixer Input) ──
  console.log('\n--- (A) DETERMINISMUS: constraints/status/arrange ---');
  await collectN(
    'constraints (input-frei)',
    async () => getConstraintTypes().structured,
    N,
  );
  // status: breaker + browser strippen (volatil über Aufrufe mit zwischengeschalteten Renders).
  await collectN(
    'status (breaker/browser gestrippt)',
    async () => getStatus().structured,
    N,
    {
      status: true,
    },
  );
  const arrangeInput = {
    canvas: { width: 200, height: 200 },
    elements: [
      { id: 'bg', tag: 'rect', width: 200, height: 200 },
      { id: 'dot', tag: 'circle', r: 20 },
    ],
    constraints: ['#dot CENTERED-IN #bg'],
  };
  await collectN(
    'arrange (fixer Layout-Input)',
    async () =>
      arrange(
        arrangeInput.canvas,
        arrangeInput.elements,
        arrangeInput.constraints,
      ).structured,
    N,
  );

  // ── (B) KALIBRIERUNG (Eichkörper, anti-zirk PARTIAL-Match) ──────────────────
  console.log(
    '\n--- (B) KALIBRIERUNG: 5 Eichkörper PARTIAL-Match gegen Spec ---',
  );
  const cal = await runSelftest(false);
  assert(
    `[B] Kalibrierung PASS (${cal.calibrated}/${cal.total} Eichkörper)`,
    cal.status === 'PASS' && cal.calibrated === 5,
    cal.failures.map((f) => `${f.ek}: ${f.reason}`).join('; '),
  );

  // ── MUTATION-TEST (PFLICHT): Strip nicht zu aggressiv ───────────────────────
  // Ein künstlicher Drift auf STABILEN Feldern (cell, grid, status, total_issues,
  // dx) MUSS die strip-Signatur ändern. Wäre der Strip zu aggressiv (False-Green),
  // bliebe strip(o) === strip(mutate(o)) — DAS fangen wir hier.
  console.log(
    '\n--- MUTATION-TEST: künstlicher Drift → Strip erhält ihn (rot) ---',
  );
  function mutateOutput(o) {
    const m = JSON.parse(JSON.stringify(o));
    if (m.scene?.elements?.[0]) {
      // stabiles Feld: cell 'A1'→'B1' (Grid-Zelle, nie volatil/gestrippt).
      m.scene.elements[0].cell = `${m.scene.elements[0].cell}__DRIFT`;
    }
    if (m.scene) m.scene.grid = `${m.scene.grid}__DRIFT`; // grid '4x4'→'4x4__DRIFT'
    if (typeof m.status === 'string') m.status = 'MUTATED';
    if (m.iteration)
      m.iteration.total_issues = (m.iteration.total_issues ?? 0) + 1;
    if (m.corrections?.[0]?.dx !== undefined) m.corrections[0].dx += 1;
    return m;
  }
  // Auf einem analyze-Output (trägt scene + iteration + corrections.dx).
  const mutBase = (await analyze(svgs['EK-3_constraint'], ['#a NO-OVERLAP #b']))
    .structured;
  const sigBase = stripAndCanon(mutBase);
  const sigMut = stripAndCanon(mutateOutput(mutBase));
  assert(
    'MUTATION: strip(o) !== strip(mutate(o)) — Drift überlebt Strip (kein False-Green)',
    sigBase !== sigMut,
    'Strip hat den künstlichen Drift weggestrippt → ZU AGGRESSIV',
  );
  // Gegenprobe POSITIV: eine reine analysisId/timestamp-Mutation MUSS weggestrippt
  // werden (Strip funktioniert in die richtige Richtung — sonst flaket der echte Test).
  function mutateVolatileOnly(o) {
    const m = JSON.parse(JSON.stringify(o));
    if (m.iteration)
      m.iteration.analysisId = '11111111-2222-4333-8444-555555555555';
    return m;
  }
  const sigVol = stripAndCanon(mutateVolatileOnly(mutBase));
  assert(
    'MUTATION-Gegenprobe: volatile analysisId-Mutation WIRD weggestrippt (strip-Richtung korrekt)',
    sigBase === sigVol,
    'Strip entfernt die analysisId NICHT → Determinismus-Test würde flaken',
  );
} catch (err) {
  bad('Suite-Ausnahme', err.stack || err.message);
} finally {
  await shutdown();
}

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) exitCode = 1;
process.exit(exitCode);
