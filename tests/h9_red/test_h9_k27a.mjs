/**
 * H9 HONEST-RED — K-27a: 0×0-Element verschwindet spurlos.
 *
 * BEFUND: Ein SVG mit zwei Markup-Elementen — rect#ref (normal sichtbar) +
 * circle#z mit r="0" (malt bewiesen 0 Pixel, existiert aber im Markup) — wird
 * von analyze() so berichtet, als gaebe es #z nie: nicht in scene.elements,
 * iteration.suppressed bleibt 0, kein Flag, keine Prosa-Zeile; die Prosa zaehlt
 * "1 Elemente" bei 2 Markup-Elementen. Das ist eine stille Luege durch
 * Auslassung — der Spiegel verschweigt Existenz statt Unsichtbarkeit zu melden.
 *
 * WAHRHEITS-PIN (Existenz-Ehrlichkeit, NICHT Implementierung): das 0×0-Element
 * muss IRGENDWO ehrlich auftauchen. Jede der folgenden Formen erfuellt den Pin:
 *   (a) Eintrag id="z" in scene.elements MIT Unsichtbarkeits-Hinweis
 *       (paint_visible:false ODER Warning/Status der Klasse NOT_VISIBLE/
 *       unsichtbar/suppressed — exakter Flag-Name NICHT gepinnt),
 *   (b) ein suppressed-Zaehler > 0 (iteration.suppressed oder scene.suppressed),
 *   (c) anderes EXPLIZITES Existenz-Signal: "z" taucht als Wert irgendwo im
 *       structured-JSON auf (oder als #z-Zeile in der Prosa) UND irgendwo
 *       liegt ein Unsichtbarkeits-Hinweis bei.
 * Mindestens EINE Form muss vorhanden sein — heute keine → ROT.
 *
 * KONTROLLE (muss heute GRUEN sein und bleiben, Heal-3-Schutz): rect mit
 * width="0" height="40" traegt PAINT_NOT_VISIBLE / paint_visible:false —
 * degenerierte 1D-Geometrie wird bereits ehrlich gemeldet; nur die 0×0-Klasse
 * faellt durch. Diese Assertion darf nicht regressieren.
 *
 * Form: eigenstaendig, kein Framework, deterministisch. Exit 1 wenn rot.
 */
import * as M from '../../src/pipeline.js';

// K-27a-Probe: 2 Markup-Elemente, beide mit Autor-id. circle#z hat r="0"
// (0×0-Geometrie, 0 Pixel Tinte), liegt abseits von #ref (keine Ueberdeckung).
const SVG_K27A =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">' +
  '<rect id="ref" x="10" y="10" width="30" height="30" fill="#cc0000"/>' +
  '<circle id="z" cx="60" cy="60" r="0" fill="#0000cc"/>' +
  '</svg>';

// Kontroll-Probe (Heal-3): identische Szene, statt des 0×0-Kreises ein
// 1D-degeneriertes rect (width=0, height=40) — wird heute ehrlich geflaggt.
const SVG_CONTROL =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">' +
  '<rect id="ref" x="10" y="10" width="30" height="30" fill="#cc0000"/>' +
  '<rect id="w0" x="60" y="10" width="0" height="40" fill="#0000cc"/>' +
  '</svg>';

// Unsichtbarkeits-Hinweis-Klassen (sprach-/flag-tolerant, pinnt KEINEN exakten
// Namen): NOT_VISIBLE, INVISIBLE, unsichtbar, suppressed, hidden, zero-size.
const INVIS_HINT_RE =
  /not[_\s-]?visible|invisib|unsichtbar|suppress|hidden|zero[_\s-]?(size|area|paint)|paint_visible/i;

let fails = 0;
function assert(name, cond, ist) {
  if (!cond) fails++;
  console.log(`ASSERT ${name}: ${cond ? 'PASS' : 'FAIL'} — ist: ${ist}`);
}

/** Deep-Scan: kommt `val` als exakter String-Wert irgendwo im Objekt vor? */
function deepHasValue(obj, val) {
  if (obj === val) return true;
  if (Array.isArray(obj)) return obj.some((x) => deepHasValue(x, val));
  if (obj && typeof obj === 'object')
    return Object.values(obj).some((x) => deepHasValue(x, val));
  return false;
}

/** Traegt ein elements-Eintrag einen Unsichtbarkeits-Hinweis? */
function hasInvisHint(el) {
  if (!el || typeof el !== 'object') return false;
  if (el.paint_visible === false) return true;
  if (Array.isArray(el.warnings) && el.warnings.some((w) => INVIS_HINT_RE.test(String(w))))
    return true;
  if (typeof el.status === 'string' && INVIS_HINT_RE.test(el.status)) return true;
  return false;
}

try {
  await M.init();
  try {
    // A1 — KONTROLLE (heute GRUEN, Regressionsschutz Heal-3): das 1D-degenerierte
    // rect#w0 (width=0, height=40) erscheint in elements UND traegt einen
    // Unsichtbarkeits-Hinweis (PAINT_NOT_VISIBLE / paint_visible:false).
    const rc = await M.analyze(SVG_CONTROL, []);
    const elsCtrl = rc?.structured?.scene?.elements ?? [];
    const w0 = elsCtrl.find((e) => e.id === 'w0');
    const w0Honest = !!w0 && hasInvisHint(w0);
    assert(
      'kontrolle_rect_w0_h40_traegt_paint_not_visible',
      w0Honest,
      w0
        ? `w0 in elements, paint_visible=${JSON.stringify(w0.paint_visible)}, warnings=${JSON.stringify(w0.warnings ?? [])}`
        : `w0 fehlt in elements (${elsCtrl.length} Eintraege: ${elsCtrl.map((e) => e.id).join(',')})`,
    );

    // A2 — WAHRHEITS-PIN K-27a: das 0×0-Element #z muss IRGENDWO ehrlich
    // auftauchen — Form (a) ODER (b) ODER (c). Heute: keine der drei → ROT.
    const r = await M.analyze(SVG_K27A, []);
    const s = r?.structured ?? {};
    const els = s?.scene?.elements ?? [];
    const prose = String(r?.prose ?? '');

    // Form (a): in elements mit Unsichtbarkeits-Hinweis.
    const zEl = els.find((e) => e.id === 'z');
    const formA = !!zEl && hasInvisHint(zEl);

    // Form (b): suppressed-Zaehler > 0 (iteration- oder scene-seitig).
    const suppIter = Number(s?.iteration?.suppressed ?? 0);
    const suppScene = Number(s?.scene?.suppressed ?? 0);
    const formB = suppIter > 0 || suppScene > 0;

    // Form (c): explizites Existenz-Signal — "z" als Wert im structured-JSON
    // oder als #z in der Prosa, PLUS irgendein Unsichtbarkeits-Hinweis.
    const existsInJson = deepHasValue(s, 'z');
    const existsInProse = /(^|[^\w#])#z\b/.test(prose) || /\bcircle#z\b/.test(prose);
    const hintAnywhere =
      INVIS_HINT_RE.test(JSON.stringify(s)) || INVIS_HINT_RE.test(prose);
    const formC = (existsInJson || existsInProse) && hintAnywhere;

    const ok = formA || formB || formC;
    const elemIds = els.map((e) => e.id).join(',') || '(leer)';
    assert(
      'nullkreis_z_taucht_irgendwo_ehrlich_auf',
      ok,
      ok
        ? `Form a=${formA} b=${formB} c=${formC}`
        : `z spurlos verschwunden: elements=[${elemIds}] (kein z), iteration.suppressed=${suppIter}, scene.suppressed=${suppScene}, "z" im JSON=${existsInJson}, "#z" in Prosa=${existsInProse}; Prosa zaehlt: ${JSON.stringify((prose.match(/\d+\s+Elemente/) || ['?'])[0])} bei 2 Markup-Elementen`,
    );
  } finally {
    await M.shutdown();
  }
} catch (err) {
  console.log(`H9-RED K-27a: PROBE-FEHLER — ${err?.message || err}`);
  process.exit(2);
}

if (fails > 0) {
  console.log(`H9-RED K-27a: ROT (${fails} FAIL)`);
  process.exit(1);
}
console.log('H9-RED K-27a: GRUEN');
