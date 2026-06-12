/**
 * selftest.mjs — §1.9 CLI-Runner für den Eichkörper-Selftest (npm run selftest)
 *
 * Läuft die 5 Kalibrierungs-Eichkörper (EK-1..5) in-process (ein Browser) und
 * PARTIAL-matcht jedes Tool-Ergebnis gegen die UNABHÄNGIG aus den Spec-Formeln
 * abgeleiteten expected-Felder (Anti-Zirkularität REGEL-2). Exit 0 bei PASS,
 * Exit 1 bei FAIL (CI-Gate, Stop-Cond SC-3).
 */
import { runSelftest, shutdown } from '../../src/pipeline.js';

const full = process.argv.includes('--full');

try {
  const r = await runSelftest(full);
  console.log(r.prose);
  console.log(
    `\nKalibrierung: ${r.status} (${r.calibrated}/${r.total} Eichkörper)`,
  );
  if (r.failures.length > 0) {
    console.log('Abweichungen:');
    for (const f of r.failures) console.log(`  - ${f.ek}: ${f.reason}`);
  }
  await shutdown();
  process.exit(r.status === 'PASS' ? 0 : 1);
} catch (err) {
  console.error(`Selftest-Ausnahme: ${err.message}`);
  await shutdown().catch(() => {});
  process.exit(1);
}
