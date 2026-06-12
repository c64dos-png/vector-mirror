/**
 * H9-RED N-1 — Ungeprüfter Vorzustand: Müll-Objekt wird Konvergenz-Wahrheit.
 *
 * BEFUND: analyze(svg, constraints, {t:0.5}) übernimmt das nicht-numerische
 * Objekt ungeprüft als previousIssueCount. Folge heute: iteration.sequence=2
 * (es gab angeblich einen Vorlauf), iteration.previous_issues={t:0.5} (ein
 * Objekt im Zahlen-Feld) und — sobald mindestens ein Issue existiert —
 * convergence='DIVERGING', weil `n < {t:0.5}` und `n === {t:0.5}` beide false
 * sind. Die Pipeline behauptet also eine VERSCHLECHTERUNG gegenüber einem
 * Vorzustand, den es nie als Zahl gab. Das ist eine Fortschritts-Lüge an den
 * LLM-Caller (Closed-Loop-Vertrag: previousIssueCount ist ein totalIssues-Wert).
 *
 * WAHRHEITS-PIN (pinnt die Wahrheit, NICHT die Implementierung):
 *   Ein nicht-numerischer Vorzustand darf KEINE Konvergenz-Aussage erzeugen.
 *   Jede ehrliche Form besteht den Test:
 *   - Throw/TypeError beim Müll-Input: PASS.
 *   - Ignorieren des Mülls (Erstlauf-Semantik: sequence=1, previous_issues=0,
 *     keine vergleichende DIVERGING-Behauptung): PASS.
 *   FAIL ist genau die Lüge: kein Throw UND (sequence=2 mit nicht-numerischem
 *   previous_issues) bzw. eine DIVERGING-Behauptung aus Müll-Vorzustand.
 *
 * KONTROLLE: analyze(svg, [], 3) mit validem Integer muss weiter funktionieren
 *   (sequence=2, previous_issues=3) — der Pin verbietet nur Müll, nicht das
 *   legitime Closed-Loop-Feature.
 *
 * Form: eigenständig, kein Framework, deterministisch. Exit 1 wenn rot.
 */
import * as M from '../../src/pipeline.js';

// Zwei überlappende Rechtecke + NO-OVERLAP-Constraint ⇒ deterministisch
// mindestens 1 Issue (totalIssues > 0). Nur so ist der DIVERGING-Zweig der
// Konvergenz-Logik überhaupt erreichbar — der Befund wird voll sichtbar.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="400" height="200">
  <rect id="a" x="10" y="10" width="200" height="100" fill="#112233"/>
  <rect id="b" x="100" y="40" width="200" height="100" fill="#445566"/>
</svg>`;
const CONSTRAINTS = ['#a NO-OVERLAP #b'];

const MUELL = { t: 0.5 }; // nicht-numerischer "Vorzustand"

let fails = 0;
function assert(name, cond, ist) {
  const status = cond ? 'PASS' : 'FAIL';
  if (!cond) fails++;
  console.log(`ASSERT ${name}: ${status} — ist: ${ist}`);
}

/** Kompakte, deterministische Darstellung eines iteration-Blocks. */
function zeigeIteration(it) {
  if (!it || typeof it !== 'object') return `iteration=${JSON.stringify(it)}`;
  return (
    `sequence=${JSON.stringify(it.sequence)}, ` +
    `previous_issues=${JSON.stringify(it.previous_issues)} ` +
    `(typeof=${typeof it.previous_issues}), ` +
    `current_issues=${JSON.stringify(it.current_issues)}, ` +
    `convergence=${JSON.stringify(it.convergence)}`
  );
}

try {
  await M.init();

  // ── Vorbedingung: Das Szenario erzeugt OHNE Vorzustand deterministisch
  //    mindestens 1 Issue und KEINE vergleichende Konvergenz-Behauptung
  //    (kein Vorlauf ⇒ DIVERGING unmöglich). Jede korrekte Implementierung
  //    besteht das — es etabliert nur die Bühne für den Pin.
  const basis = await M.analyze(SVG, CONSTRAINTS);
  const itBasis = basis?.structured?.iteration;
  assert(
    'vorbedingung_issue_ohne_vorzustand',
    itBasis != null &&
      itBasis.current_issues > 0 &&
      itBasis.sequence === 1 &&
      itBasis.convergence !== 'DIVERGING',
    zeigeIteration(itBasis),
  );

  // ── DER PIN (N-1): Müll-Objekt als Vorzustand.
  //    Ehrlich ist: Throw ODER Ignorieren (sequence=1, previous_issues=0).
  //    Lüge ist: Übernahme (sequence=2 mit nicht-numerischem previous_issues).
  let muellThrew = false;
  let muellErr = null;
  let itMuell = null;
  try {
    const r = await M.analyze(SVG, CONSTRAINTS, MUELL);
    itMuell = r?.structured?.iteration;
  } catch (err) {
    muellThrew = true;
    muellErr = err;
  }

  const uebernommen =
    !muellThrew &&
    itMuell != null &&
    itMuell.sequence === 2 &&
    typeof itMuell.previous_issues !== 'number';
  assert(
    'pin_muell_vorzustand_nicht_uebernommen',
    !uebernommen,
    muellThrew
      ? `ehrlicher Throw: ${muellErr?.name}: ${muellErr?.message}`
      : `${zeigeIteration(itMuell)} — Müll-Objekt {t:0.5} wurde als Vorzustand übernommen`,
  );

  //    Eine VERGLEICHENDE Verschlechterungs-Behauptung (DIVERGING) setzt einen
  //    validen numerischen Vorzustand voraus. Aus {t:0.5} ist sie immer Lüge.
  assert(
    'pin_keine_diverging_behauptung_aus_muell',
    muellThrew || itMuell?.convergence !== 'DIVERGING',
    muellThrew
      ? `ehrlicher Throw: ${muellErr?.name}: ${muellErr?.message}`
      : `convergence=${JSON.stringify(itMuell?.convergence)} bei previous_issues=${JSON.stringify(itMuell?.previous_issues)}`,
  );

  // ── KONTROLLE: Valider Integer-Vorzustand bleibt voll funktionsfähig.
  //    Der Pin darf das legitime Closed-Loop-Feature nicht mitverbieten.
  const ctrl = await M.analyze(SVG, CONSTRAINTS, 3);
  const itCtrl = ctrl?.structured?.iteration;
  assert(
    'kontrolle_valider_integer_funktioniert',
    itCtrl != null && itCtrl.sequence === 2 && itCtrl.previous_issues === 3,
    zeigeIteration(itCtrl),
  );
} catch (err) {
  fails++;
  console.log(
    `ASSERT testlauf_ohne_exception: FAIL — ist: ${err?.message || err}`,
  );
} finally {
  await M.shutdown();
}

if (fails > 0) {
  console.log(`H9-RED N-1: ROT (${fails} FAIL)`);
  process.exit(1);
} else {
  console.log('H9-RED N-1: GRUEN');
}
