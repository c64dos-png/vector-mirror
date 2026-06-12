/**
 * RELAIS-Probe (JS-API) — PARTIAL-Semantik + meta.truncated_warnings
 * + Output-Kernfelder (Block 3).
 *
 * Claims: C-GLO-03 · C-ANA-OUT (claims.js). Belegt K-10 (adjudiziert) +
 * K-26 + N-4 + Opus-P6:
 *   (i)   sichtbare Element-Warnungen allein (≤7 Elemente) ⇒ status PASS,
 *         KEIN meta-Block (meta existiert nur bei Trunkierung).
 *   (i-b) C-ANA-OUT: die ECHTEN Top-Level-Keys des analyze-Outputs sind
 *         exakt {status, iteration, scene, corrections, unchecked, diff}
 *         (ohne Trunkierung/Fehler); analysisId wohnt unter iteration,
 *         NICHT top-level (P6: die frühere Description log hier).
 *   (ii)  Warnungs-Träger auf Position ≥7 (vom Cap verdeckt) ⇒ status PARTIAL
 *         + meta.truncated_warnings nennt ihn.
 *   (iii) unchecked-Constraint ⇒ status PARTIAL.
 *
 * Eigenständig, deterministisch, Exit 1 wenn rot.
 */
import * as M from '../../src/pipeline.js';

const VB =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 100" width="800" height="100"';
// Warnungs-Träger: clock-rooted SMIL-Geometrie ⇒ MOTION_DEPENDENT (statisch erkannt).
const ANIM = (id, x) =>
  `<circle id="${id}" cx="${x}" cy="50" r="10" fill="gold"><animate attributeName="cx" from="${x}" to="${x + 40}" dur="2s"/></circle>`;
const RECT = (id, x) =>
  `<rect id="${id}" x="${x}" y="10" width="50" height="30" fill="royalblue"/>`;

let failCount = 0;
function assert(name, cond, ist) {
  const verdict = cond ? 'PASS' : 'FAIL';
  if (!cond) failCount += 1;
  console.log(`ASSERT ${name}: ${verdict} — ist: ${ist}`);
}

try {
  await M.init();

  // (i) sichtbare Warnung (Position 1 von 2) ⇒ PASS, kein meta.
  const sichtbar = await M.analyze(
    `<svg ${VB}>${RECT('r1', 10)}${ANIM('m1', 200)}</svg>`,
    [],
  );
  const warnEl = sichtbar.structured?.scene?.elements?.find(
    (e) => e.id === 'm1',
  );
  console.log(
    `OBS (i): status=${sichtbar.structured?.status}, meta=${JSON.stringify(sichtbar.structured?.meta)}`,
  );
  assert(
    'sichtbare_warnung_traegt',
    Array.isArray(warnEl?.warnings) &&
      warnEl.warnings.includes('MOTION_DEPENDENT'),
    `warnings=${JSON.stringify(warnEl?.warnings)}`,
  );
  assert(
    'sichtbare_warnung_PASS',
    sichtbar.structured?.status === 'PASS',
    sichtbar.structured?.status,
  );
  assert(
    'meta_nur_bei_trunkierung',
    sichtbar.structured?.meta === undefined,
    `meta=${JSON.stringify(sichtbar.structured?.meta)}`,
  );

  // (i-b) C-ANA-OUT (P6): echte Top-Level-Keys + analysisId unter iteration.
  const topKeys = Object.keys(sichtbar.structured || {}).sort();
  console.log(`OBS (i-b) top-level-keys: ${JSON.stringify(topKeys)}`);
  assert(
    'output_toplevel_keys_exakt',
    JSON.stringify(topKeys) ===
      JSON.stringify([
        'corrections',
        'diff',
        'iteration',
        'scene',
        'status',
        'unchecked',
      ]),
    JSON.stringify(topKeys),
  );
  assert(
    'analysisId_unter_iteration_nicht_toplevel',
    typeof sichtbar.structured?.iteration?.analysisId === 'string' &&
      !('analysisId' in (sichtbar.structured || {})),
    `typeof iteration.analysisId=${typeof sichtbar.structured?.iteration?.analysisId}, top-level analysisId=${'analysisId' in (sichtbar.structured || {})}`,
  );

  // (ii) Warnungs-Träger auf Position 8 (Index 7, vom Cap verdeckt) ⇒ PARTIAL + meta.
  const rects7 = Array.from({ length: 7 }, (_, i) =>
    RECT(`r${i + 1}`, 10 + i * 80),
  ).join('');
  const verdeckt = await M.analyze(
    `<svg ${VB}>${rects7}${ANIM('m8', 600)}</svg>`,
    [],
  );
  const tw = verdeckt.structured?.meta?.truncated_warnings;
  console.log(
    `OBS (ii): status=${verdeckt.structured?.status}, truncated_warnings=${JSON.stringify(tw)}`,
  );
  assert(
    'verdeckte_warnung_PARTIAL',
    verdeckt.structured?.status === 'PARTIAL',
    verdeckt.structured?.status,
  );
  assert(
    'meta_truncated_warnings_nennt_traeger',
    Array.isArray(tw) && tw.some((t) => t.element_id === 'm8'),
    JSON.stringify(tw),
  );

  // (iii) unchecked ⇒ PARTIAL.
  const unchecked = await M.analyze(`<svg ${VB}>${RECT('r1', 10)}</svg>`, [
    '#gibtesnicht INSIDE #r1',
  ]);
  console.log(
    `OBS (iii): status=${unchecked.structured?.status}, unchecked=${unchecked.structured?.unchecked?.length}`,
  );
  assert(
    'unchecked_PARTIAL',
    unchecked.structured?.status === 'PARTIAL' &&
      (unchecked.structured?.unchecked || []).length === 1,
    `status=${unchecked.structured?.status}`,
  );
} finally {
  await M.shutdown();
}

if (failCount > 0) {
  console.log(`RELAIS-PROBE partial_meta: ROT (${failCount} FAIL)`);
  process.exit(1);
} else {
  console.log('RELAIS-PROBE partial_meta: GRUEN');
  process.exit(0);
}
