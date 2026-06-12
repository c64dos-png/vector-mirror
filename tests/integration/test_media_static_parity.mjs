/**
 * test_media_static_parity.mjs — DUAL-SOURCE-PARITÄT der statischen media_dependent-
 * Detektion (KB2). Real-Chromium, ECHTE Pipeline (init → __measureStaticMedia-
 * ParityCheck → shutdown).
 *
 * WARUM GEGATET: MEASURE_STATIC_MEDIA_FN (der „faithful port") re-implementiert die
 * Produktiv-Statik selbst-enthalten in der Browser-Sandbox. Der golden-diff/Flip
 * (Phase 2) vergleicht GEGEN diesen Port — driftet er vom echten resolve()-
 * media_dependent-Output, vergliche der golden-diff gegen eine FALSCHE Statik
 * (Drift = selbst eine Lüge). Der Parity-Check assertet Port == Produktiv über ein
 * Korpus. Bis hierher war er von KEINEM Test gegated → der Port-Spiegel konnte
 * still driften. Dieser Test schließt die Lücke.
 *
 * BESONDERS für §HEAL F-AT-7-01 (I2): propagateRefGraph (url(#)-Referenz-Propagation)
 * existiert doppelt — Produktiv (playwright.js ~Z.3313) UND Port (~Z.5530). Jede
 * Asymmetrie bricht hier. Die Korpus-Szene 'ref-depth2' nagelt die Tiefe-2-
 * Transitivität (Def→Def→Host) byte-genau fest (cold-Opus-Pflicht-Beweis).
 */
import {
  __measureStaticMediaParityCheck,
} from '../../src/adapters/renderer/playwright.js';
import { init, shutdown } from '../../src/pipeline.js';

let passed = 0;
let failed = 0;
function ok(cond, label) {
  if (cond) {
    passed++;
    console.log(`  PASS: ${label}`);
  } else {
    failed++;
    console.log(`  FAIL: ${label}`);
  }
}

async function main() {
  await init();
  try {
    const r = await __measureStaticMediaParityCheck();
    ok(r && typeof r.ok === 'boolean', 'Parity-Check liefert verwertbares Resultat');
    ok(Array.isArray(r.scenes) && r.scenes.length >= 4,
      `Korpus deckt >=4 Szenen ab (ist: ${r.scenes ? r.scenes.length : 0})`);

    for (const s of r.scenes || []) {
      const real = JSON.stringify(s.realIds);
      const port = JSON.stringify(s.portIds);
      ok(s.ok === true && !s.error,
        `[${s.name}] Produktiv==Port  real=${real} port=${port}${s.error ? ' ERR=' + s.error : ''}`);
    }

    // Spezifische Heil-Erwartung: die Referenz-Leck-Szenen propagieren auf den Host.
    const byName = Object.fromEntries((r.scenes || []).map((s) => [s.name, s]));
    ok(byName['marker-leak'] && JSON.stringify(byName['marker-leak'].realIds) === '["p"]',
      'marker-leak: Host #p geflaggt (Referenz-Propagation, I2)');
    ok(byName['pattern-leak'] && JSON.stringify(byName['pattern-leak'].realIds) === '["phost"]',
      'pattern-leak: Host #phost geflaggt (Referenz-Propagation, I2)');
    ok(byName['ref-depth2'] && JSON.stringify(byName['ref-depth2'].realIds) === '["host2"]',
      'ref-depth2: Host #host2 geflaggt (Tiefe-2-Transitivität, I2)');

    // Gesamt-Tor: der aggregierte ok MUSS true sein (kein Szenen-Drift).
    ok(r.ok === true, 'Aggregierte Parität: ok === true (kein Port-Drift)');
  } finally {
    await shutdown();
  }

  console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('THREW', e && e.stack ? e.stack : e);
  console.log(`\nErgebnis: ${passed} bestanden, ${failed + 1} fehlgeschlagen`);
  process.exit(1);
});
