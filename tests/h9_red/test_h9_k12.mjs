/**
 * H9-RED K-12 — Trend-Behauptung ohne Historie.
 *
 * BEFUND: Erst-analyze in frischem Prozess (kein previousIssueCount, also
 * KEINE Vorgeschichte) mit einem failenden Constraint liefert
 * iteration.sequence=1, previous_issues=0 — und behauptet trotzdem
 * convergence='STAGNATING'. "Stagnation" ist ein TREND (Vergleich zweier
 * Zeitpunkte); bei sequence=1 existiert kein zweiter Zeitpunkt. Die
 * Pipeline lügt dem LLM einen Verlauf vor, den es nie gab.
 *
 * WAHRHEITS-PIN (pinnt die Wahrheit, nicht die Implementierung):
 *   Bei sequence=1 (previous_issues=0, keine Historie) darf convergence
 *   KEINE Trend-Behauptung sein:
 *     assert convergence !== 'STAGNATING' && convergence !== 'DIVERGING'
 *   Welcher ehrliche Wert stattdessen kommt (z.B. ein Erstlauf-Marker,
 *   IMPROVING ist hier nicht gefordert/verboten — jede Nicht-Trend-Lüge
 *   im Sinne von STAGNATING/DIVERGING zählt), ist Implementierungs-Freiheit.
 *   KONTROLLE: 0-Issue-Erstlauf darf weiterhin 'SOLVED' melden — "gelöst"
 *   ist eine Zustands-, keine Trend-Aussage und braucht keine Historie.
 *
 * Form: eigenständig, kein Framework, deterministisch. Exit 1 wenn rot.
 */
import * as M from '../../src/pipeline.js';

// Deterministische Szene: 'box' liegt RECHTS von 'anker' → der Constraint
// "box LEFT-OF anker" failt beweisbar (actualMaxX=350 > expectedMaxX=10).
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100" width="400" height="100">
  <rect id="anker" x="10" y="10" width="50" height="50" fill="#112233"/>
  <rect id="box" x="300" y="10" width="50" height="50" fill="#aa3344"/>
</svg>`;

const CONSTRAINT_FAILEND = 'box LEFT-OF anker';

let fails = 0;
function assert(name, cond, ist) {
  const status = cond ? 'PASS' : 'FAIL';
  if (!cond) fails++;
  console.log(`ASSERT ${name}: ${status} — ist: ${ist}`);
}

try {
  await M.init();

  // ── ERST-ANALYZE (frischer Prozess, KEIN previousIssueCount): genau die
  //    Situation "keine Vorgeschichte".
  const r = await M.analyze(SVG, [CONSTRAINT_FAILEND]);
  const it = r?.structured?.iteration;

  // ── Vorbedingung: die Probe ist korrekt gebaut — Erstlauf-Signatur
  //    (sequence=1, previous_issues=0) UND der Constraint failt wirklich
  //    (total_issues >= 1). Schlägt DAS fehl, ist die Probe falsch, nicht
  //    die Pipeline.
  assert(
    'vorbedingung_erstlauf_mit_issue',
    it != null &&
      it.sequence === 1 &&
      it.previous_issues === 0 &&
      it.total_issues >= 1,
    it == null
      ? `kein iteration-Block — prose: ${String(r?.prose).slice(0, 120)}`
      : `sequence=${it.sequence}, previous_issues=${it.previous_issues}, total_issues=${it.total_issues}`,
  );

  // ── DER PIN (K-12): ohne Historie KEINE Trend-Behauptung. STAGNATING und
  //    DIVERGING sind Verlaufs-Urteile über (mindestens) zwei Messpunkte —
  //    bei sequence=1 gibt es nur einen. Jeder andere (ehrliche) Wert: PASS.
  assert(
    'pin_keine_trendbehauptung_ohne_historie',
    it != null && it.convergence !== 'STAGNATING' && it.convergence !== 'DIVERGING',
    `convergence=${JSON.stringify(it?.convergence)} bei sequence=${it?.sequence}, previous_issues=${it?.previous_issues} (keine Vorgeschichte)`,
  );

  // ── KONTROLLE: 0-Issue-Erstlauf (keine Constraints → nichts failt, nichts
  //    unchecked) darf 'SOLVED' bleiben — Zustandsaussage, keine Trend-Lüge.
  //    Diese Assertion verhindert eine Über-Korrektur, die SOLVED am Erstlauf
  //    mit verbietet.
  const ctrl = await M.analyze(SVG, []);
  const ctrlIt = ctrl?.structured?.iteration;
  assert(
    'kontrolle_0_issue_erstlauf_bleibt_solved',
    ctrlIt != null && ctrlIt.total_issues === 0 && ctrlIt.convergence === 'SOLVED',
    `total_issues=${ctrlIt?.total_issues}, convergence=${JSON.stringify(ctrlIt?.convergence)}`,
  );
} catch (err) {
  fails++;
  console.log(`ASSERT testlauf_ohne_exception: FAIL — ist: ${err?.message || err}`);
} finally {
  await M.shutdown();
}

if (fails > 0) {
  console.log(`H9-RED K-12: ROT (${fails} FAIL)`);
  process.exit(1);
} else {
  console.log('H9-RED K-12: GRUEN');
}
