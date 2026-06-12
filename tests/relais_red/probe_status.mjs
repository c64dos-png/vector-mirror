/**
 * RELAIS-Probe (JS-API) — status: PENDING-Semantik, Lazy-Browser, lastAnalysis.
 *
 * Claims: C-STA-CAL · C-STA-LAST (claims.js).
 *   - calibration=PENDING entsteht durch markCalibrationPending (Serverstart-
 *     Hook) und bleibt bis zum Selftest-Ende — kein Defekt-Zustand.
 *   - Browser startet lazy: vor dem ersten Mess-Call "stopped", danach "running".
 *   - lastAnalysis false bis zur ersten analyze DIESES Prozesses, dann true.
 *
 * Eigenständig, deterministisch (kein Race: PENDING wird ohne laufenden
 * Selftest gesetzt — exakt der Mechanismus des Serverstarts). Exit 1 wenn rot.
 */
import * as M from '../../src/pipeline.js';

const VB =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100"';
const SVG = `<svg ${VB}><rect id="a" x="10" y="10" width="60" height="40" fill="red"/></svg>`;

let failCount = 0;
function assert(name, cond, ist) {
  const verdict = cond ? 'PASS' : 'FAIL';
  if (!cond) failCount += 1;
  console.log(`ASSERT ${name}: ${verdict} — ist: ${ist}`);
}

try {
  const s0 = M.getStatus().structured;
  console.log(
    `OBS frisch: browser=${s0.browser}, lastAnalysis=${s0.lastAnalysis}, calibration=${JSON.stringify(s0.calibration)}`,
  );
  assert('frisch_browser_stopped', s0.browser === 'stopped', s0.browser);
  assert(
    'frisch_lastAnalysis_false',
    s0.lastAnalysis === false,
    `${s0.lastAnalysis}`,
  );

  M.markCalibrationPending();
  const s1 = M.getStatus().structured;
  console.log(`OBS pending: calibration=${JSON.stringify(s1.calibration)}`);
  assert(
    'pending_gesetzt_nicht_defekt',
    s1.calibration?.status === 'PENDING' && s1.calibration?.calibrated === 0,
    JSON.stringify(s1.calibration),
  );

  await M.inspect(SVG); // erster Mess-Call ⇒ Lazy-Start
  const s2 = M.getStatus().structured;
  console.log(
    `OBS nach inspect: browser=${s2.browser}, lastAnalysis=${s2.lastAnalysis}`,
  );
  assert('lazy_browser_running', s2.browser === 'running', s2.browser);
  assert(
    'inspect_setzt_keine_baseline',
    s2.lastAnalysis === false,
    `${s2.lastAnalysis}`,
  );

  await M.analyze(SVG, []);
  const s3 = M.getStatus().structured;
  console.log(`OBS nach analyze: lastAnalysis=${s3.lastAnalysis}`);
  assert(
    'lastAnalysis_true_in_diesem_prozess',
    s3.lastAnalysis === true,
    `${s3.lastAnalysis}`,
  );
} finally {
  await M.shutdown();
}

if (failCount > 0) {
  console.log(`RELAIS-PROBE status: ROT (${failCount} FAIL)`);
  process.exit(1);
} else {
  console.log('RELAIS-PROBE status: GRUEN');
  process.exit(0);
}
