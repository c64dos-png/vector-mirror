// H10-RED R11-01: Sichtbarkeits-Verschwinden CSS-versteckter Elemente
// Bodenwahrheit: an internal ground-truth probe (+ run1/run2 identisch)
//
// WAHRHEITS-PIN (implementierungs-agnostisch):
//   Ein im Markup EXISTENTES, per CSS verstecktes Element (display:none / opacity:0 /
//   visibility:hidden) muss IRGENDWO ehrlich auftauchen — eine der Formen genuegt:
//     (A) in scene.elements gelistet MIT einem Unsichtbarkeits-Signal, ODER
//     (B) in einem Zaehler/Listenfeld der Szene > 0 / nicht-leer (suppressed, hidden_*, ...), ODER
//     (C) Constraint darauf wird NICHT mit SUBJECT_NOT_FOUND quittiert, sondern entweder
//         regulaer ausgewertet ODER mit einem reasonCode/Detail, das Existenz+Versteckt-Sein
//         ausdrueckt (hidden/unsichtbar/suppressed/exist...).
//   Kontroll-Pin: ein geometrisch unsichtbares Element (width=0) bleibt sichtbar gelistet
//   (heutiges, korrektes Verhalten — darf nicht mitverschwinden).
//
// Heute (2-Lauf-bewiesen): h1/h2/h3 fehlen komplett in scene.elements, suppressed=0,
// kein hidden-Feld, analyze => SUBJECT_NOT_FOUND ("#hX nicht gefunden") => ROT.

import * as M from '../../src/pipeline.js';

// EXAKTE Fixtures der Probe R11-01:
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
  <rect id="v1" x="10" y="10" width="20" height="20" fill="#ff0000"/>
  <rect id="v2" x="40" y="10" width="20" height="20" fill="#00ff00"/>
  <rect id="v3" x="70" y="10" width="20" height="20" fill="#0000ff"/>
  <rect id="h1" x="10" y="50" width="20" height="20" fill="#ffaa00" display="none"/>
  <rect id="h2" x="40" y="50" width="20" height="20" fill="#aa00ff" opacity="0"/>
  <rect id="h3" x="70" y="50" width="20" height="20" fill="#00aaff" visibility="hidden"/>
</svg>`;

const svg0 = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect id="z" x="10" y="10" width="0" height="20" fill="red"/><rect id="v" x="40" y="10" width="20" height="20" fill="blue"/></svg>`;

let failCount = 0;
function assert(name, ok, ist) {
  console.log(`ASSERT ${name}: ${ok ? 'PASS' : 'FAIL'} — ist: ${ist}`);
  if (!ok) failCount += 1;
}

const HIDDEN_SIGNAL_RE = /hidden|invisib|unsichtbar|versteckt|suppress|"display"\s*:\s*"none"|"visible"\s*:\s*false|"opacity"\s*:\s*0(?![.\d])/i;
const COUNTER_KEY_RE = /suppress|hidden|invisib|omit|filter|entfernt|versteckt/i;

// (A) Element gelistet UND traegt ein Unsichtbarkeits-Signal?
function elementSignal(scene, id) {
  const el = (scene?.elements || []).find((e) => e && e.id === id);
  if (!el) return { ok: false, ist: `#${id} fehlt in scene.elements` };
  const json = JSON.stringify(el);
  if (HIDDEN_SIGNAL_RE.test(json)) return { ok: true, ist: `#${id} gelistet mit Signal: ${json}` };
  return { ok: false, ist: `#${id} gelistet, aber ohne Unsichtbarkeits-Signal: ${json}` };
}

// (B) Irgendein Zaehler-/Listenfeld der Szene, das Verstecktes ehrlich zaehlt?
function counterSignal(scene) {
  for (const [k, v] of Object.entries(scene || {})) {
    if (!COUNTER_KEY_RE.test(k)) continue;
    if (typeof v === 'number' && v > 0) return { ok: true, ist: `scene.${k}=${v}` };
    if (Array.isArray(v) && v.length > 0) return { ok: true, ist: `scene.${k}=${JSON.stringify(v)}` };
    if (v && typeof v === 'object' && Object.keys(v).length > 0) return { ok: true, ist: `scene.${k}=${JSON.stringify(v)}` };
  }
  const keys = Object.entries(scene || {})
    .filter(([k]) => COUNTER_KEY_RE.test(k))
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  return { ok: false, ist: keys.length ? keys.join(', ') : 'kein hidden/suppressed-Feld' };
}

// (C) Constraint-Antwort ehrlich (Existenz anerkannt)?
async function constraintSignal(id) {
  try {
    const an = await M.analyze(svg, [`#${id} INSIDE #v1`]);
    const st = an.structured || {};
    const unchecked = st.unchecked || [];
    if (unchecked.length === 0) {
      // regulaer ausgewertet => Element wurde gefunden => ehrlich
      return { ok: true, ist: `Constraint regulaer ausgewertet, status=${st.status}` };
    }
    const rcs = unchecked.map((x) => `${x.reasonCode}:${x.detail ?? x.hint ?? ''}`).join(' | ');
    const notFound = unchecked.some((x) => /NOT_FOUND/i.test(String(x.reasonCode)));
    const expressesHidden = HIDDEN_SIGNAL_RE.test(rcs) || /exist/i.test(rcs);
    if (!notFound && expressesHidden) return { ok: true, ist: `reasonCode ehrlich: ${rcs}` };
    return { ok: false, ist: `unchecked=${rcs}` };
  } catch (e) {
    return { ok: false, ist: `analyze THREW: ${e.message}` };
  }
}

// (C') P1-VERSTAERKUNG (Patch-Runde, 3/3 Linsen): REFERENZ-Symmetrie. Eine im
// Markup existente, css-versteckte REFERENZ (`#v1 INSIDE #hX`) darf NICHT mit
// einem *_NOT_FOUND quittiert werden (Existenz-Luege) — ehrlich ist einzig:
// regulaere Auswertung ODER ein reasonCode/Detail, das Existenz+Versteckt-Sein
// ausdrueckt. STRENGER als der Subjekt-Pin oben (kein Szene-Zaehler-Ausweg):
// das Verdikt selbst muss die Wahrheit tragen.
async function referenceSignal(id) {
  try {
    const an = await M.analyze(svg, [`#v1 INSIDE #${id}`]);
    const st = an.structured || {};
    const unchecked = st.unchecked || [];
    if (unchecked.length === 0) {
      return { ok: true, ist: `Constraint regulaer ausgewertet, status=${st.status}` };
    }
    const rcs = unchecked.map((x) => `${x.reasonCode}:${x.detail ?? x.hint ?? ''}`).join(' | ');
    const notFound = unchecked.some((x) => /NOT_FOUND/i.test(String(x.reasonCode)));
    const expressesHidden = HIDDEN_SIGNAL_RE.test(rcs) || /exist/i.test(rcs);
    if (!notFound && expressesHidden) return { ok: true, ist: `reasonCode ehrlich: ${rcs}` };
    return { ok: false, ist: `unchecked=${rcs}` };
  } catch (e) {
    return { ok: false, ist: `analyze THREW: ${e.message}` };
  }
}

await M.init();
try {
  let scene = null;
  try {
    const r = await M.inspect(svg);
    scene = r.structured?.scene ?? null;
  } catch (e) {
    scene = null;
    console.log(`# inspect THREW: ${e.message}`);
  }

  // Fixture-Sanitaet: sichtbare Elemente muessen gelistet sein (heute gruen)
  const ids = (scene?.elements || []).map((e) => e.id);
  assert(
    'sichtbare_elemente_gelistet',
    ['v1', 'v2', 'v3'].every((id) => ids.includes(id)),
    `elements.ids=[${ids.join(',')}]`
  );

  // Kern-Pin: jedes CSS-versteckte Element muss IRGENDWO ehrlich auftauchen (A ODER B ODER C)
  const cnt = counterSignal(scene);
  for (const id of ['h1', 'h2', 'h3']) {
    const a = elementSignal(scene, id);
    const c = await constraintSignal(id);
    const ok = a.ok || cnt.ok || c.ok;
    assert(
      `verstecktes_${id}_ehrlich_irgendwo`,
      ok,
      `(A) ${a.ist}; (B) ${cnt.ist}; (C) ${c.ist}`
    );
  }

  // P1-Pin (Verstaerkung): dieselben versteckten Elemente als REFERENZ — das
  // Verdikt selbst muss Existenz+Versteckt-Sein tragen, nie *_NOT_FOUND.
  for (const id of ['h1', 'h2', 'h3']) {
    const cr = await referenceSignal(id);
    assert(`verstecktes_${id}_als_referenz_ehrlich`, cr.ok, cr.ist);
  }

  // Kontroll-Pin: width=0-Element bleibt sichtbar gelistet (heutiges Verhalten)
  try {
    const r0 = await M.inspect(svg0);
    const ids0 = (r0.structured?.scene?.elements || []).map((e) => e.id);
    assert('kontrolle_width0_bleibt_gelistet', ids0.includes('z'), `elements.ids=[${ids0.join(',')}]`);
  } catch (e) {
    assert('kontrolle_width0_bleibt_gelistet', false, `inspect THREW: ${e.message}`);
  }
} finally {
  await M.shutdown();
}

if (failCount > 0) {
  console.log(`H10-RED R11-01: ROT (${failCount} FAIL)`);
  process.exitCode = 1;
} else {
  console.log('H10-RED R11-01: GRUEN');
}
