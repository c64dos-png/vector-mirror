/**
 * H9 HONEST-RED — K-24: lossy-Prosa luegt die Ursache (role/aria-Fall).
 *
 * BEFUND: Ein SVG mit role="img" aria-label="x" auf dem Root — OHNE Kommentare,
 * OHNE id=, OHNE name= — wird vom Sanitizer um Attribute (role/aria) erleichtert
 * und damit lossy. Die Verlust-Warnung in der Prosa behauptet aber pauschal
 * "(id/name)" als entfernte Kategorie.
 *
 * WAHRHEITS-PIN (wie K-03): WENN eine Verlust-Warnung erscheint, darf sie KEINE
 * Kategorie nennen, die nicht vorgekommen ist. Hier wurden Attribute
 * (role/aria-label) entfernt — keine id, kein name → "(id/name)" darf nicht
 * behauptet werden. Der Pin ist konditional: eine korrekte Implementierung darf
 * (a) die Warnung mit den TATSAECHLICHEN Kategorien fuellen, (b) generisch
 * formulieren oder (c) role/aria gar nicht erst strippen (kein Verlust → keine
 * Warnung). Alle drei korrekten Pfade bestehen diesen Test.
 *
 * Form: eigenstaendig, kein Framework, deterministisch. Exit 1 wenn rot.
 */
import * as M from '../../src/pipeline.js';

// K-24-Probe: role + aria-label auf dem Root, sonst nur unkritische Standard-
// Attribute. KEIN Kommentar, KEIN id=, KEIN name= in der Quelle.
const SVG_K24 =
  '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="x" ' +
  'viewBox="0 0 100 100" width="100" height="100">' +
  '<rect x="10" y="10" width="30" height="30" fill="#cc0000"/>' +
  '</svg>';

// Kausal-Kontrolle: byte-identisch bis auf das Fehlen von role/aria-label.
// Wahrheit: hier wird NICHTS entfernt → kein lossy, keine Verlust-Behauptung.
const SVG_CONTROL =
  '<svg xmlns="http://www.w3.org/2000/svg" ' +
  'viewBox="0 0 100 100" width="100" height="100">' +
  '<rect x="10" y="10" width="30" height="30" fill="#cc0000"/>' +
  '</svg>';

// Zeilen, die einen Sanitize-Verlust ankuendigen (sprachunabhaengig breit).
const LOSS_LINE_RE = /sanitiz|entfernt|gestrippt|stripped|removed|verlust|lossy/i;
// Kategorie-Behauptungen "id" / "name" als eigenstaendige Woerter
// (\b: matcht "(id/name)", matcht NICHT "width", "validity", "Namen").
const CLAIMS_ID_RE = /\bid\b/i;
const CLAIMS_NAME_RE = /\bname\b/i;

// §H9 P4 (Pin praeziser, nicht schwaecher): die Warnzeile darf den
// GESTRIPPTEN WERT zitieren (`ATTR_STRIPPED:attr="…"`) — ein Wert-Echo wie
// role="my name is id" ist ZITAT des Autor-Markups, KEINE Kategorie-
// Behauptung der Warnung. Vor dem Kategorie-Check werden daher alle
// Wert-Echos aus der Zeilen-Kopie entfernt; geprueft wird nur, was die
// Warnung selbst BEHAUPTET (Attribut-/Kategorie-Namen). Unabhaengig von der
// P1-Echo-Kappung robust (greift auch auf ungekappte Echos ohne ").
function ohneWertEchos(line) {
  return line.replace(/(ATTR_STRIPPED:[^=\s"]+)="[^"]*"/g, '$1');
}

let fails = 0;
function assert(name, cond, ist) {
  if (!cond) fails++;
  console.log(`ASSERT ${name}: ${cond ? 'PASS' : 'FAIL'} — ist: ${ist}`);
}

function lossLines(prose) {
  return String(prose || '')
    .split('\n')
    .filter((l) => LOSS_LINE_RE.test(l));
}

try {
  await M.init();
  try {
    // A1 — Fixture-Bodenwahrheit: die Quelle traegt weder id= noch name= noch
    // Kommentare. Damit ist jede "(id/name)"-Behauptung beweisbar falsch.
    const hasId = /\bid\s*=/i.test(SVG_K24);
    const hasName = /\bname\s*=/i.test(SVG_K24);
    const hasComment = SVG_K24.includes('<!--');
    assert(
      'quelle_ohne_id_name_kommentar',
      !hasId && !hasName && !hasComment,
      `id=${hasId} name=${hasName} kommentar=${hasComment} — einzige entfernbare Semantik: role/aria-label`,
    );

    // A2 — Kausal-Kontrolle (pinnt Wahrheit: kein Verlust → keine Verlust-
    // Behauptung): identisches SVG ohne role/aria darf nicht lossy sein.
    const rc = await M.analyze(SVG_CONTROL, []);
    const cvc = rc?.structured?.scene?.canvas_validity ?? '(nicht gesetzt)';
    const controlLoss = lossLines(rc?.prose);
    assert(
      'kontrolle_ohne_role_aria_ist_verlustfrei',
      cvc !== 'lossy' && controlLoss.length === 0,
      `canvas_validity=${cvc}, Verlust-Zeilen=${controlLoss.length}`,
    );

    // A3 — WAHRHEITS-PIN K-24: erscheint fuer die role/aria-Probe eine
    // Verlust-Warnung, darf sie keine nicht-vorgekommene Kategorie (id/name)
    // nennen. Konditional: kein Verlust/keine Warnung → vacuous PASS (korrekt).
    const r = await M.analyze(SVG_K24, []);
    const cv = r?.structured?.scene?.canvas_validity ?? '(nicht gesetzt)';
    const warnZeilen = lossLines(r?.prose);
    const erscheint = cv === 'lossy' || warnZeilen.length > 0;
    // §H9 P4: Kategorie-Check auf der Echo-bereinigten Kopie (siehe
    // ohneWertEchos) — zitierte Werte koennen den Pin nicht mehr faelschen.
    const luegen = warnZeilen
      .map(ohneWertEchos)
      .filter((l) => CLAIMS_ID_RE.test(l) || CLAIMS_NAME_RE.test(l));
    const ok = !erscheint || luegen.length === 0;
    assert(
      'verlust_warnung_nennt_nur_vorgekommene_kategorien',
      ok,
      ok
        ? `canvas_validity=${cv}, Warnzeilen=${warnZeilen.length}, keine id/name-Behauptung`
        : `canvas_validity=${cv}; entfernt wurden role/aria-Attribute, aber die Warnung behauptet: "${luegen[0]}"`,
    );
  } finally {
    await M.shutdown();
  }
} catch (err) {
  console.log(`H9-RED K-24: PROBE-FEHLER — ${err?.message || err}`);
  process.exit(2);
}

if (fails > 0) {
  console.log(`H9-RED K-24: ROT (${fails} FAIL)`);
  process.exit(1);
}
console.log('H9-RED K-24: GRUEN');
