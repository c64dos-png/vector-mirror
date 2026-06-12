/**
 * RELAIS-Probe (JS-API) — canvas_validity=lossy + Verlust-Details im Text-Kanal.
 *
 * Claim: C-GLO-02 (claims.js). Belegt K-06/K-24:
 *   - Ein render-neutraler Strip (Kommentar) macht den Canvas lossy.
 *   - Die Verlust-DETAILS (Sanitizer-Zeile) stehen NUR in der Prosa;
 *     structured trägt nur das Flag (canvas_validity).
 *   - Negativrand: sauberes SVG bleibt valid, keine Sanitizer-Zeile.
 *
 * Eigenständig, deterministisch, Exit 1 wenn rot.
 */
import * as M from '../../src/pipeline.js';

const VB =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100"';
const LOSSY = `<svg ${VB}><!-- bau-notiz --><rect id="r1" x="10" y="10" width="60" height="40" fill="red"/></svg>`;
const CLEAN = `<svg ${VB}><rect id="r1" x="10" y="10" width="60" height="40" fill="red"/></svg>`;

let failCount = 0;
function assert(name, cond, ist) {
  const verdict = cond ? 'PASS' : 'FAIL';
  if (!cond) failCount += 1;
  console.log(`ASSERT ${name}: ${verdict} — ist: ${ist}`);
}

try {
  await M.init();

  const r = await M.inspect(LOSSY);
  const cv = r.structured?.scene?.canvas_validity;
  const prosaZeile = (r.prose || '')
    .split('\n')
    .find((l) => l.includes('Sanitizer'));
  console.log(`OBS lossy: canvas_validity=${cv}`);
  console.log(`OBS Verlust-Zeile: ${prosaZeile ?? '<keine>'}`);

  assert('kommentar_strip_lossy', cv === 'lossy', `canvas_validity=${cv}`);
  assert(
    'details_im_textkanal',
    typeof prosaZeile === 'string' && prosaZeile.includes('Sanitizer hat'),
    prosaZeile ?? '<keine>',
  );
  assert(
    'structured_traegt_nur_flag',
    !JSON.stringify(r.structured).includes('Sanitizer'),
    'structured enthält keine Sanitizer-Detail-Zeile (nur das lossy-Flag)',
  );

  const c = await M.inspect(CLEAN);
  const ccv = c.structured?.scene?.canvas_validity;
  console.log(`OBS clean: canvas_validity=${ccv}`);
  assert('negativrand_valid', ccv === 'valid', `canvas_validity=${ccv}`);
  assert(
    'negativrand_keine_zeile',
    !(c.prose || '').includes('Sanitizer'),
    'keine Sanitizer-Zeile im sauberen Fall',
  );
} finally {
  await M.shutdown();
}

if (failCount > 0) {
  console.log(`RELAIS-PROBE lossy_textkanal: ROT (${failCount} FAIL)`);
  process.exit(1);
} else {
  console.log('RELAIS-PROBE lossy_textkanal: GRUEN');
  process.exit(0);
}
