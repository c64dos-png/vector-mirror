/**
 * RELAIS-Probe (JS-API) — W3C-Namens-Quantisierung + COLOR-Granularität.
 *
 * Claim: C-GLO-06 (claims.js). Belegt K-07/K-08a + H9-P3-Pin:
 *   - palette nennt Namen, nie Hex (#ff0000 ⇒ red, #ff6347 ⇒ tomato).
 *   - COLOR red gegen fill #ff0000 ⇒ PASS (notationsgleich besteht).
 *   - COLOR red gegen fill #ff6347 ⇒ FAIL (naher Nachbar besteht NICHT).
 *
 * Eigenständig, deterministisch, Exit 1 wenn rot.
 */
import * as M from '../../src/pipeline.js';

const VB =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100"';
const svgFill = (fill) =>
  `<svg ${VB}><rect id="a" x="10" y="10" width="60" height="40" fill="${fill}"/></svg>`;

let failCount = 0;
function assert(name, cond, ist) {
  const verdict = cond ? 'PASS' : 'FAIL';
  if (!cond) failCount += 1;
  console.log(`ASSERT ${name}: ${verdict} — ist: ${ist}`);
}

try {
  await M.init();

  const pRed = await M.palette(svgFill('#ff0000'));
  const pTom = await M.palette(svgFill('#ff6347'));
  const fillRed = pRed.structured?.colors?.[0]?.fill;
  const fillTom = pTom.structured?.colors?.[0]?.fill;
  console.log(`OBS palette: #ff0000=${fillRed}, #ff6347=${fillTom}`);
  assert('palette_name_nicht_hex_red', fillRed === 'red', `${fillRed}`);
  assert('palette_name_nicht_hex_tomato', fillTom === 'tomato', `${fillTom}`);
  assert(
    'palette_nirgends_hex',
    !JSON.stringify(pRed.structured).includes('#ff') &&
      !JSON.stringify(pTom.structured).includes('#ff'),
    'kein Hex im structured',
  );

  const passt = await M.analyze(svgFill('#ff0000'), ['#a COLOR red']);
  console.log(`OBS COLOR red vs #ff0000: ${passt.structured?.status}`);
  assert(
    'color_notationsgleich_besteht',
    passt.structured?.status === 'PASS',
    passt.structured?.status,
  );

  const bricht = await M.analyze(svgFill('#ff6347'), ['#a COLOR red']);
  console.log(`OBS COLOR red vs #ff6347: ${bricht.structured?.status}`);
  assert(
    'color_nachbar_faellt_durch',
    bricht.structured?.status === 'FAIL',
    bricht.structured?.status,
  );
} finally {
  await M.shutdown();
}

if (failCount > 0) {
  console.log(`RELAIS-PROBE farb_granularitaet: ROT (${failCount} FAIL)`);
  process.exit(1);
} else {
  console.log('RELAIS-PROBE farb_granularitaet: GRUEN');
  process.exit(0);
}
