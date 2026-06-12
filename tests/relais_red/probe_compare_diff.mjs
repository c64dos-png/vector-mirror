/**
 * RELAIS-Probe (JS-API) — Diff-Vokabular + Farb-Granularität des Diffs.
 *
 * Claims: C-CMP-VOC · C-CMP-GRAN (claims.js). Belegt R9a #10 + K-07/K-12:
 *   - Vokabular: ein Umbau (Move über Zellgrenze, Namens-Farbwechsel,
 *     Entfernen, Hinzufügen) produziert VERSCHOBEN/FARBÄNDERUNG/ENTFERNT/NEU;
 *     alles Emittierte ∈ {VERSCHOBEN, FARBÄNDERUNG, FORMÄNDERUNG, NEU,
 *     ENTFERNT} (die 5 Typen aus core/diff.js).
 *   - Granularität: #ff0000 → #fe0000 (beide quantisieren zu red) erzeugt
 *     KEINE FARBÄNDERUNG; #ff0000 → #ff6347 (red→tomato) erzeugt eine.
 *
 * Eigenständig, deterministisch, Exit 1 wenn rot.
 */
import * as M from '../../src/pipeline.js';

const VB =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 100" width="800" height="100"';
const V1 =
  `<svg ${VB}>` +
  '<rect id="r1" x="10" y="10" width="40" height="30" fill="green"/>' +
  '<rect id="r2" x="300" y="10" width="40" height="30" fill="#ff0000"/>' +
  '<rect id="r3" x="600" y="10" width="40" height="30" fill="blue"/></svg>';
const V2_UMBAU =
  `<svg ${VB}>` +
  '<rect id="r1" x="500" y="10" width="40" height="30" fill="green"/>' + // VERSCHOBEN
  '<rect id="r2" x="300" y="10" width="40" height="30" fill="#ff6347"/>' + // FARBÄNDERUNG (red→tomato)
  // r3 fehlt: ENTFERNT
  '<rect id="r4" x="700" y="60" width="40" height="30" fill="gold"/></svg>'; // NEU
const V3_HEXDRIFT =
  `<svg ${VB}>` +
  '<rect id="r1" x="10" y="10" width="40" height="30" fill="green"/>' +
  '<rect id="r2" x="300" y="10" width="40" height="30" fill="#fe0000"/>' + // bleibt "red"
  '<rect id="r3" x="600" y="10" width="40" height="30" fill="blue"/></svg>';

const VOKABULAR = [
  'VERSCHOBEN',
  'FARBÄNDERUNG',
  'FORMÄNDERUNG',
  'NEU',
  'ENTFERNT',
];

let failCount = 0;
function assert(name, cond, ist) {
  const verdict = cond ? 'PASS' : 'FAIL';
  if (!cond) failCount += 1;
  console.log(`ASSERT ${name}: ${verdict} — ist: ${ist}`);
}

try {
  await M.init();

  const base = await M.analyze(V1, []);
  const id = base.structured?.iteration?.analysisId;
  assert('baseline_id', typeof id === 'string', `${id}`);

  const umbau = await M.compare(V2_UMBAU, [], id);
  const types = (umbau.structured?.diff || []).map((d) => d.type);
  console.log(`OBS umbau diff: ${JSON.stringify(umbau.structured?.diff)}`);
  assert(
    'emittiertes_im_vokabular',
    types.every((t) => VOKABULAR.includes(t)),
    JSON.stringify(types),
  );
  for (const want of ['VERSCHOBEN', 'FARBÄNDERUNG', 'NEU', 'ENTFERNT']) {
    assert(
      `typ_${want}_produziert`,
      types.includes(want),
      JSON.stringify(types),
    );
  }

  const drift = await M.compare(V3_HEXDRIFT, [], id);
  const driftTypes = (drift.structured?.diff || []).map((d) => d.type);
  console.log(`OBS hexdrift diff: ${JSON.stringify(drift.structured?.diff)}`);
  assert(
    'hexdrift_unsichtbar',
    !driftTypes.includes('FARBÄNDERUNG'),
    JSON.stringify(driftTypes),
  );
} finally {
  await M.shutdown();
}

if (failCount > 0) {
  console.log(`RELAIS-PROBE compare_diff: ROT (${failCount} FAIL)`);
  process.exit(1);
} else {
  console.log('RELAIS-PROBE compare_diff: GRUEN');
  process.exit(0);
}
