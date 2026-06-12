/**
 * H9-RED K-08a — COLOR-Hex-False-Negative.
 *
 * BEFUND: rect id="a" fill="#ff0000" und Constraint ["#a COLOR #ff0000"]
 * liefert heute status=FAIL mit der Prosa "Farbe ist red, soll #ff0000
 * sein." — obwohl Soll und Ist exakt dieselbe Farbe bezeichnen (#ff0000
 * IST red). Der Checker vergleicht den quantisierten Ist-Namen wörtlich
 * mit dem rohen Soll-String, statt beide Werte als Farben zu vergleichen.
 *
 * WAHRHEITS-PIN (pinnt die Wahrheit, NICHT die Implementierung):
 *   Ein COLOR-Constraint, dessen Soll-Wert nach Quantisierung DIESELBE
 *   Farbe bezeichnet wie der gemessene Ist-Wert, darf NICHT FAIL liefern —
 *   PASS ist gefordert (kein Ausweichen nach unchecked). Es ist egal, OB
 *   und WIE die Implementierung intern quantisiert (Namens-Vergleich,
 *   Hex-Normalisierung, RGB-Vergleich, Delta-E=0 …) — jede korrekte
 *   Implementierung liefert hier PASS ohne Korrektur und ohne unchecked.
 *   KONTROLLE GEGEN AUFWEICHUNG: ["#a COLOR blue"] auf demselben Element
 *   muss FAIL bleiben (eine wirklich falsche Soll-Farbe wird erkannt).
 *
 * §H9 P3 ZUSATZ-PIN (VERSTAERKUNG, additiv — toetet die Vergroeberungs-
 * Mutation): ein Soll-HEX, dessen quantisierter Name sich vom Ist-Namen
 * unterscheidet (#ff6347 → 'tomato' ≠ 'red'), muss FAIL bleiben. Eine
 * Mutation, die den Hex-Pfad zu grob quantisiert (z.B. alles Rote → 'red'
 * oder pauschal PASS für Hex-Solls), faellt hier durch. Die Namens-Differenz
 * wird VOR dem Verdikt via parseColor verifiziert (Vorbedingung) — der Pin
 * pinnt die Mess-Granularitaet (nearest-named-color, 140 W3C-Namen, CIELAB),
 * nicht eine Implementierung.
 *
 * Form: eigenständig, kein Framework, deterministisch. Exit 1 wenn rot.
 */
import * as M from '../../src/pipeline.js';
import { parseColor } from '../../src/lib/palette.js';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100">
  <rect id="a" x="10" y="10" width="80" height="60" fill="#ff0000"/>
</svg>`;

let fails = 0;
function assert(name, cond, ist) {
  const status = cond ? 'PASS' : 'FAIL';
  if (!cond) fails++;
  console.log(`ASSERT ${name}: ${status} — ist: ${ist}`);
}

/** Alle COLOR-Einträge für Element #a aus corrections (failing-Verdikte). */
function colorCorrections(r) {
  return (r?.structured?.corrections || []).filter(
    (c) => c.constraint === 'COLOR' && String(c.element).replace(/^#/, '') === 'a',
  );
}

/** Kompakte Ist-Beschreibung eines analyze-Resultats für die Konsole. */
function beschreibe(r) {
  const s = r?.structured;
  const proseFehler = String(r?.prose ?? '')
    .split('\n')
    .find((l) => l.trimStart().startsWith('✗'));
  return (
    `status=${s?.status}, corrections=${JSON.stringify(s?.corrections ?? null)}, ` +
    `unchecked=${(s?.unchecked ?? []).length}` +
    (proseFehler ? `, prose: ${JSON.stringify(proseFehler.trim())}` : '')
  );
}

try {
  await M.init();

  // ── Vorbedingung: die Szene selbst ist sauber. Mit dem benannten Soll
  //    'red' (bezeichnet dieselbe Farbe wie #ff0000) liefert die Pipeline
  //    heute PASS — damit ist bewiesen, dass ein FAIL beim Hex-Soll NUR aus
  //    dem Soll-Wert-Vergleich stammen kann, nicht aus der Szene/Messung.
  const rNamed = await M.analyze(SVG, ['#a COLOR red']);
  assert(
    'vorbedingung_szene_sauber_named_pass',
    rNamed?.structured?.status === 'PASS' && colorCorrections(rNamed).length === 0,
    beschreibe(rNamed),
  );

  // ── DER PIN (K-08a): Soll '#ff0000' bezeichnet exakt die gemessene Farbe
  //    des Elements (fill="#ff0000"). Gefordert: PASS — keine Korrektur,
  //    kein unchecked-Ausweichen. Heute: FAIL ("Farbe ist red, soll
  //    #ff0000 sein.") → False Negative.
  const rHex = await M.analyze(SVG, ['#a COLOR #ff0000']);
  assert(
    'pin_hex_gleiche_farbe_muss_pass',
    rHex?.structured?.status === 'PASS' &&
      colorCorrections(rHex).length === 0 &&
      (rHex?.structured?.unchecked ?? []).length === 0,
    beschreibe(rHex),
  );

  // ── KONTROLLE (keine Aufweichung): eine WIRKLICH falsche Soll-Farbe
  //    ('blue' vs. gemessen #ff0000/red) muss FAIL bleiben, mit
  //    COLOR-Korrektur für #a.
  const rBlue = await M.analyze(SVG, ['#a COLOR blue']);
  assert(
    'kontrolle_blue_bleibt_fail',
    rBlue?.structured?.status === 'FAIL' && colorCorrections(rBlue).length === 1,
    beschreibe(rBlue),
  );

  // ── §H9 P3 ZUSATZ-PIN: Soll-Hex mit ANDEREM quantisierten Namen als der
  //    Ist-Wert muss FAIL bleiben. Vorbedingung: die Namens-Differenz wird
  //    erst via parseColor bewiesen (#ff6347 → 'tomato' ≠ parseColor(#ff0000)
  //    → 'red') — sonst pinnte der Verdikt-Pin ins Leere.
  const HEX_ANDERER_NAME = '#ff6347'; // W3C 'tomato'
  const sollName = parseColor(HEX_ANDERER_NAME);
  const istName = parseColor('#ff0000');
  assert(
    'vorbedingung_namens_differenz_soll_vs_ist',
    sollName !== istName,
    `parseColor(${HEX_ANDERER_NAME})=${sollName}, parseColor(#ff0000)=${istName}`,
  );
  const rTomato = await M.analyze(SVG, [`#a COLOR ${HEX_ANDERER_NAME}`]);
  assert(
    'pin_hex_anderer_quantisierter_name_bleibt_fail',
    rTomato?.structured?.status === 'FAIL' &&
      colorCorrections(rTomato).length === 1 &&
      (rTomato?.structured?.unchecked ?? []).length === 0,
    beschreibe(rTomato),
  );
} catch (err) {
  fails++;
  console.log(`ASSERT testlauf_ohne_exception: FAIL — ist: ${err?.message || err}`);
} finally {
  await M.shutdown();
}

if (fails > 0) {
  console.log(`H9-RED K-08a: ROT (${fails} FAIL)`);
  process.exit(1);
} else {
  console.log('H9-RED K-08a: GRUEN');
}
