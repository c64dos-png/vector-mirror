/**
 * H9-RED K-03 — lossy-Prosa lügt Ursache (Kommentar-Fall).
 *
 * BEFUND: Ein SVG, dessen EINZIGER Sanitize-Verlust XML-Kommentare sind,
 * wird canvas_validity='lossy' klassifiziert — und die Prosa-Warnzeile
 * behauptet wörtlich "(id/name)" als entfernte Kategorie. Es wurde aber
 * weder eine id noch ein name entfernt: die Warnzeile lügt die Ursache.
 *
 * WAHRHEITS-PIN (policy-robust, pinnt NICHT die Implementierung):
 *   WENN eine Verlust-Warnzeile erscheint, darf sie KEINE Kategorie
 *   behaupten, die nicht vorkam. Bei Kommentar-only-Verlust darf der
 *   Kategorie-Claim "(id/name)" NIRGENDS in der prose stehen.
 *   - Eine korrekte Implementierung, die gar nicht warnt (Kommentar-Strip
 *     als verlustfrei wertet): PASS (vacuous).
 *   - Eine korrekte Implementierung, die warnt und die Kategorie ehrlich
 *     benennt (z.B. "Kommentar entfernt"): PASS.
 *   - Die heutige Implementierung (warnt mit falscher Kategorie): FAIL.
 *
 * Form: eigenständig, kein Framework, deterministisch. Exit 1 wenn rot.
 */
import * as M from '../../src/pipeline.js';

// Kommentar-only-Delta: identisches SVG, einziger Unterschied ist der
// XML-Kommentar. Alle Elemente/Attribute sind sanitizer-harmlos (rect,
// id, Geometrie, fill) — es gibt nichts anderes, das verloren gehen kann.
const SVG_BASIS = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100" width="400" height="100">
  <rect id="bg" x="0" y="0" width="400" height="100" fill="#112233"/>
</svg>`;

const SVG_MIT_KOMMENTAR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100" width="400" height="100">
  <!-- Hintergrund -->
  <rect id="bg" x="0" y="0" width="400" height="100" fill="#112233"/>
</svg>`;

const FALSCHE_KATEGORIE = '(id/name)';

let fails = 0;
function assert(name, cond, ist) {
  const status = cond ? 'PASS' : 'FAIL';
  if (!cond) fails++;
  console.log(`ASSERT ${name}: ${status} — ist: ${ist}`);
}

/** Erste Zeile der prose, die den falschen Kategorie-Claim trägt (oder null). */
function findeClaimZeile(prose) {
  for (const line of String(prose ?? '').split('\n')) {
    if (line.includes(FALSCHE_KATEGORIE)) return line;
  }
  return null;
}

try {
  await M.init();

  // ── Vorbedingung 1: Pipeline rendert das Kommentar-SVG erfolgreich.
  const r = await M.analyze(SVG_MIT_KOMMENTAR, []);
  const validity = r?.structured?.scene?.canvas_validity;
  assert(
    'render_ok',
    r != null && r.structured != null,
    r?.structured != null
      ? `analyze lieferte structured (canvas_validity=${validity})`
      : `analyze lieferte kein structured — prose: ${String(r?.prose).slice(0, 120)}`,
  );

  // ── Vorbedingung 2 (Kontrolle): OHNE Kommentar ist NICHTS lossy und kein
  //    Kategorie-Claim in der prose → der Kommentar ist beweisbar der EINZIGE
  //    Verlust-Auslöser im Test-SVG. Jede korrekte Implementierung besteht das:
  //    wo nichts entfernt wird, gibt es keinen Verlust zu melden.
  const ctrl = await M.analyze(SVG_BASIS, []);
  const ctrlValidity = ctrl?.structured?.scene?.canvas_validity;
  const ctrlClaim = findeClaimZeile(ctrl?.prose);
  assert(
    'kontrolle_ohne_kommentar_kein_verlust',
    ctrlValidity !== 'lossy' && ctrlClaim === null,
    `canvas_validity=${ctrlValidity}, '(id/name)'-Claim: ${ctrlClaim === null ? 'keiner' : JSON.stringify(ctrlClaim)}`,
  );

  // ── DER PIN (K-03): Kommentar-only-Verlust → die prose darf die Kategorie
  //    "(id/name)" NICHT behaupten (es wurde keine id und kein name entfernt).
  //    Vacuous-pass ist ok: erscheint künftig gar keine Warnzeile, steht auch
  //    kein "(id/name)" in der prose → PASS.
  const claimZeile = findeClaimZeile(r?.prose);
  assert(
    'pin_keine_falsche_kategorie_bei_kommentar_only',
    claimZeile === null,
    claimZeile === null
      ? `prose enthält kein '(id/name)' (canvas_validity=${validity})`
      : `canvas_validity=${validity}; Warnzeile behauptet '(id/name)' obwohl nur ein XML-Kommentar entfernt wurde: ${JSON.stringify(claimZeile)}`,
  );
} catch (err) {
  fails++;
  console.log(`ASSERT testlauf_ohne_exception: FAIL — ist: ${err?.message || err}`);
} finally {
  await M.shutdown();
}

if (fails > 0) {
  console.log(`H9-RED K-03: ROT (${fails} FAIL)`);
  process.exit(1);
} else {
  console.log('H9-RED K-03: GRUEN');
}
