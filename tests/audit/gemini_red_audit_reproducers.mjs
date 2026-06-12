import { formatStructured as formatStructuredRaw } from '../../src/adapters/emitter/structured.js';
import {
  closeResolver,
  createResolver,
  resolve,
} from '../../src/adapters/renderer/playwright.js';
import { arbitrate } from '../../src/core/arbitrate.js';
import { gateCorrections } from '../../src/core/honesty.js';
import * as pipeline from '../../src/pipeline.js';

// §E1: formatStructured verlangt jetzt gegatete failing-issues (_gated-Vertrag,
// fail-closed). Wrapper schleust die failing-Liste durch honesty.js#gate-
// Corrections wie der Prod-Caller pipeline.js (Test-Infra, kein Produkt-Pfad).
function formatStructured(gridMap, arbitrated, opts) {
  const relById = new Map(
    (gridMap.elements || []).map((el) => [el.id, el.bbox_reliability]),
  );
  const gatedFailing = gateCorrections(arbitrated.failing || [], (id) =>
    relById.get(id),
  );
  return formatStructuredRaw(
    gridMap,
    { ...arbitrated, failing: gatedFailing },
    opts,
  );
}

let fails = 0;
function check(label, cond, detail = '') {
  const ok = !!cond;
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails++;
  return ok;
}

async function run() {
  console.log('\n=== GEMINI RED AUDIT REPRODUCERS ===');

  console.log('\n[GEMINI-B1] Duplicate IDs Shadowing:');
  const page = await createResolver();
  const resDup = await resolve(
    page,
    '<svg viewBox="0 0 100 100"><rect id="dup" x="0" y="0" width="10" height="10" fill="red"/><rect id="dup" x="20" y="20" width="10" height="10" fill="blue"/></svg>',
  );
  const dups = resDup.elements.filter((e) => e.id === 'dup');
  check(
    'Beide Elemente erhalten dieselbe ID',
    dups.length === 2,
    `Count: ${dups.length}`,
  );

  console.log(
    '\n[GEMINI-B2] Browser Crash Bricking — Pipeline Cascade-Bounded (P1-03):',
  );
  // Adapter-Vorbedingung: resolve() auf totem Page liefert weiterhin LOAD_FAILED.
  // Das Permanent-Bricking war NICHT der Adapter, sondern der UNGEBUNDENE
  // Kaskaden-Effekt im Aufrufer. P1-03 (Opossum-Breaker in pipeline.js)
  // begrenzt diesen Kaskaden-Effekt: nach volumeThreshold=5 Browser-Fails
  // oeffnet der Breaker, weitere Aufrufe fast-failen mit EOPENBREAKER
  // statt jedes Mal in den 5s-Render-Timeout zu laufen.
  await page.close();
  const resCrash = await resolve(
    page,
    '<svg viewBox="0 0 100 100"><rect id="r" x="0" y="0" width="10" height="10" fill="red"/></svg>',
  );
  check(
    'Adapter-Vorbedingung: resolve() liefert LOAD_FAILED auf toter Page',
    resCrash.error === 'LOAD_FAILED',
    resCrash.message,
  );
  await closeResolver();

  // Pipeline-Pfad: frische init(), dann Browser sterben lassen, Kaskade messen.
  await pipeline.init();
  await closeResolver(); // Underlying browser kill — pipeline.page bleibt referenziert
  const goodSvg =
    '<svg viewBox="0 0 100 100"><rect id="r" x="0" y="0" width="10" height="10" fill="red"/></svg>';
  const errors = [];
  for (let i = 0; i < 7; i++) {
    const out = await pipeline.analyze(goodSvg);
    errors.push(out.prose.startsWith('Fehler:') ? out.prose : 'OK');
  }
  const status = pipeline.getStatus().structured.breaker;
  check(
    'Breaker oeffnet nach 5 Browser-Fails (volumeThreshold)',
    status?.state === 'open',
    `state=${status?.state} fires=${status?.fires} failures=${status?.failures}`,
  );
  // §1.7 Test-Staleness-Angleichung (kein Breaker-Defekt): der Test toetet den
  // Browser via closeResolver(), das die Adapter-Modulvars browser/activePage
  // NULLT. resolve() trifft daher seinen ERSTEN Guard (!activePage || !browser)
  // → LOAD_FAILED mit 'Renderer ist nicht initialisiert' (NICHT der
  // setContent-Fail-Pfad 'SVG konnte nicht geladen werden'). Beide sind
  // LOAD_FAILED-Browser-Fehler und zaehlen korrekt gegen den Breaker — der
  // genaue Wortlaut haengt vom Tot-Mechanismus ab (genullte Vars vs. toter
  // Browser bei SIGKILL). Die Assertion prueft jetzt die SEMANTIK (Browser-tot
  // → 'Fehler:'-Prefix, KEIN 'Circuit open'), nicht den exakten Wortlaut.
  check(
    'Erste 5 Aufrufe scheitern mit LOAD_FAILED (Browser tot)',
    errors
      .slice(0, 5)
      .every(
        (e) =>
          (e.includes('SVG konnte nicht geladen werden') ||
            e.includes('Renderer ist nicht initialisiert')) &&
          !e.includes('Circuit open'),
      ),
    `first5=${JSON.stringify(errors.slice(0, 5))}`,
  );
  check(
    'Aufruf 6+7 fast-failen mit EOPENBREAKER (Cascade gebunden)',
    errors.slice(5).every((e) => e.includes('Circuit open')),
    `last2=${JSON.stringify(errors.slice(5))}`,
  );
  check(
    'breaker.rejects zaehlt Fast-Fails (>=2 nach 7 Aufrufen)',
    status?.rejects >= 2,
    `rejects=${status?.rejects}`,
  );
  await pipeline.shutdown();

  console.log(
    '\n[GEMINI-B3] Arbitrate behaelt ALLE CONSTRAINT_FAIL (P1-04 Fix):',
  );
  const mockConstraints = [
    { pass: false, id: 'a', constraintType: 'C1' },
    { pass: false, id: 'b', constraintType: 'C2' },
    { pass: false, id: 'c', constraintType: 'C3' },
    { pass: false, id: 'd', constraintType: 'C4' },
  ];
  const arb = arbitrate(mockConstraints, []);
  check(
    'Arbitrate behaelt alle 4 Fails (kein Validator-Cap)',
    arb.failing.length === 4 && arb.totals.failing_count === 4,
    `failing=${arb.failing.length}`,
  );
  check(
    'arbitrate hat kein suppressed-Feld mehr (cap in prose verschoben)',
    arb.suppressed === undefined,
  );
  const struct = formatStructured(
    {
      canvas: { width: 100, height: 100 },
      grid: { cellsX: 2, cellsY: 2 },
      elements: [],
    },
    arb,
    {},
  );
  check(
    'Structured Output zeigt alle 4 issues (current_issues=4)',
    struct.iteration.current_issues === 4,
    `Gemeldet: ${struct.iteration.current_issues}`,
  );
  check(
    'iteration.total_issues = 4 (failing+unchecked)',
    struct.iteration.total_issues === 4,
  );
  check(
    'iteration.suppressed = 0 (structured kappt nicht)',
    struct.iteration.suppressed === 0,
  );

  console.log('\n[GEMINI-B4] Convergence "IMPROVING" bei falschen Issues:');
  const fakeArb2 = {
    passing: [],
    failing: mockConstraints
      .slice(0, 2)
      .map((c) => ({ ...c, type: 'CONSTRAINT_FAIL', severity: 0 })),
    unchecked: [],
    diff: [],
    totals: {
      total: 2,
      passing_count: 0,
      failing_count: 2,
      unchecked_count: 0,
      diff_count: 0,
    },
  };
  const struct2 = formatStructured(
    {
      canvas: { width: 100, height: 100 },
      grid: { cellsX: 2, cellsY: 2 },
      elements: [],
    },
    fakeArb2,
    { previousIssueCount: 3 },
  );
  check(
    'Convergence meldet IMPROVING obwohl Kontext fehlt',
    struct2.iteration.convergence === 'IMPROVING',
    `Status: ${struct2.iteration.convergence}`,
  );

  process.exit(fails === 0 ? 0 : 1);
}

run();
