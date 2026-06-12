/**
 * RELAIS-Probe (JS-API) — selftest: Eichkörper-Kalibrierung, anti-zirkulär.
 *
 * Claim: C-SEL-ANTI (claims.js). Belegt R9a #11 + REGEL-2:
 *   - runSelftest(false) ⇒ PASS, calibrated 5/5 (lebendes System gegen
 *     spec-abgeleitete Wahrheit).
 *   - Anti-Zirkularität strukturell: jede EK-*.expected.json trägt PARTIELLE
 *     Spec-Felder (tool + expected), aber KEINEN Tool-Output-Dump (kein
 *     "prose", kein "structuredContent", keine analysisId).
 *
 * Eigenständig, deterministisch, Exit 1 wenn rot.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as M from '../../src/pipeline.js';

const GOLDEN = new URL('../fixtures/golden/', import.meta.url).pathname;

let failCount = 0;
function assert(name, cond, ist) {
  const verdict = cond ? 'PASS' : 'FAIL';
  if (!cond) failCount += 1;
  console.log(`ASSERT ${name}: ${verdict} — ist: ${ist}`);
}

// Anti-Zirk-Struktur der expected-Dateien (browserfrei).
const expectedFiles = readdirSync(GOLDEN)
  .filter((f) => f.endsWith('.expected.json'))
  .sort();
console.log(`OBS expected-Dateien: ${JSON.stringify(expectedFiles)}`);
assert(
  'fuenf_eichkoerper',
  expectedFiles.length === 5,
  `${expectedFiles.length}`,
);
for (const f of expectedFiles) {
  const raw = readFileSync(join(GOLDEN, f), 'utf8');
  const json = JSON.parse(raw);
  assert(
    `antizirk_${f}`,
    typeof json.tool === 'string' &&
      json.expected !== undefined &&
      !raw.includes('"prose"') &&
      !raw.includes('structuredContent') &&
      !raw.includes('analysisId'),
    `tool=${json.tool}, kein Output-Dump`,
  );
}

try {
  const r = await M.runSelftest(false);
  console.log(
    `OBS selftest: status=${r.status}, calibrated=${r.calibrated}/${r.total}, failures=${r.failures.length}`,
  );
  assert(
    'selftest_pass_5_von_5',
    r.status === 'PASS' && r.calibrated === 5 && r.total === 5,
    `${r.status} ${r.calibrated}/${r.total} ${JSON.stringify(r.failures)}`,
  );
} finally {
  await M.shutdown();
}

if (failCount > 0) {
  console.log(`RELAIS-PROBE selftest_antizirk: ROT (${failCount} FAIL)`);
  process.exit(1);
} else {
  console.log('RELAIS-PROBE selftest_antizirk: GRUEN');
  process.exit(0);
}
