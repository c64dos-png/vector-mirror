// H10-RED R11-06 — Stille Paint-Zeit-Achse (fill-/opacity-SMIL ohne jedes Zeit-Signal)
//
// BEWIESEN (2 Laeufe, an internal ground-truth probe identisch):
//   smil_fill    #paint: motion_dependent=null, warnings=[], COLOR->PASS, unchecked=[]
//   smil_opacity #blink: motion_dependent=null, warnings=[], COLOR->PASS, unchecked=[]
//   smil_geom_x  #geo:   motion_dependent=true, warnings=["MOTION_DEPENDENT"], COLOR/INSIDE->unchecked
//
// PIN (Wahrheit, nicht Implementierung): Ein Element mit AKTIVER fill- ODER opacity-
// SMIL-Animation muss IRGENDEIN ehrliches Zeit-Signal tragen. Akzeptiert wird JEDE Form:
//   (a) motion_dependent truthy
//   (b) ein neues Flag mit Zeit-/Paint-Zeit-Semantik (Key-Heuristik, Wert truthy)
//   (c) ein Warning-Token mit Zeit-/Paint-Zeit-Semantik (Element- oder Dokument-Ebene)
//   (d) der COLOR-Constraint auf das Element wird unchecked statt still PASS
// Kontroll-Pins: Geometrie-SMIL (x) bleibt MOTION_DEPENDENT; statisches Element bleibt
// frei von Zeit-Flags/Zeit-Warnings. (Bestehende Nicht-Zeit-Warnings wie PAINT_OVERFLOW /
// COLOR_FROM_STROKE und das Flag has_paint_overflow zaehlen NICHT als Zeit-Signal.)
//
// Fixtures: EXAKT aus probe_R11-06.mjs uebernommen.

import * as M from '../../src/pipeline.js';

const FRAME = '<rect id="frame" x="10" y="10" width="90" height="70" fill="none" stroke="#111"/>';
const doc = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="120" viewBox="0 0 220 120">${body}</svg>`;

// EXAKT probe_R11-06.mjs:
const SVG_FILL = doc(
  `<rect id="paint" x="20" y="30" width="24" height="24" fill="#ff0000"><animate attributeName="fill" values="#ff0000;#0000ff" dur="1s" repeatCount="indefinite"/></rect>`,
);
const SVG_OPACITY = doc(
  `${FRAME}<rect id="blink" x="20" y="30" width="24" height="24" fill="#0000ff"><animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite"/></rect>`,
);
const SVG_GEOM = doc(
  `${FRAME}<rect id="geo" x="20" y="30" width="24" height="24" fill="#ff0000"><animate attributeName="x" values="20;150" dur="1s" repeatCount="indefinite"/></rect>`,
);

// --- Zeit-Signal-Detektoren (grosszuegig fuer jede korrekte Form, streng gegen ---
// --- Nicht-Zeit-Tokens wie PAINT_OVERFLOW / COLOR_FROM_STROKE / has_paint_overflow) ---

// Token traegt Zeit-Semantik: entweder direkt zeitlich, oder Paint-Begriff KOMBINIERT
// mit Zeit-/Abhaengigkeits-Begriff (in beliebiger Reihenfolge).
const TIME_TOKEN =
  /(motion|anim|smil|time|temporal|dynamic|blink|flicker)/i;
const PAINT_TIME_TOKEN =
  /((paint|fill|opacity|color)\w*[_\- ]?\w*(depend|variant))|((depend|variant)\w*[_\- ]?\w*(paint|fill|opacity|color))/i;
const tokenHasTimeSemantics = (t) =>
  TIME_TOKEN.test(String(t)) || PAINT_TIME_TOKEN.test(String(t));

// Flag-Keys mit Zeit-Semantik (z.B. motion_dependent, time_variant, paint_dependent,
// fill_animated, opacity_anim, ...). Wert muss truthy sein.
const flagSignal = (el) => {
  if (!el) return false;
  return Object.entries(el).some(
    ([k, v]) => k !== 'warnings' && tokenHasTimeSemantics(k) && Boolean(v),
  );
};

const warningSignal = (el) =>
  Boolean(el) && (el.warnings || []).some(tokenHasTimeSemantics);

const docWarningSignal = (ins) => {
  const w = ins?.structured?.warnings;
  if (!w) return false;
  return JSON.stringify(w)
    .split(/[",\[\]{}]/)
    .some((t) => t && tokenHasTimeSemantics(t));
};

// COLOR-Constraint auf das Element ist unchecked statt still PASS — oder irgendein
// unchecked-Eintrag traegt einen Zeit-Reason (wie SUBJECT_TIME_VARIANT bei Geometrie).
const constraintSignal = (an, id) => {
  const s = an?.structured;
  const unchecked = s?.unchecked || [];
  return unchecked.some((u) => {
    const j = JSON.stringify(u);
    const isColorOnTarget = /COLOR/i.test(j) && (j.includes(`#${id}`) || !j.includes('#'));
    const timeReason = tokenHasTimeSemantics(u.reasonCode ?? '');
    return isColorOnTarget || timeReason;
  });
};

const findEl = (ins, id) =>
  (ins?.structured?.scene?.elements || []).find((e) => e.id === id);

const istString = (el, an) => {
  const s = an?.structured;
  return (
    `motion_dependent=${JSON.stringify(el?.motion_dependent ?? null)}, ` +
    `warnings=${JSON.stringify(el?.warnings ?? null)}, ` +
    `analyze.status=${s?.status}, ` +
    `unchecked=${JSON.stringify((s?.unchecked || []).map((u) => ({ c: u.constraint ?? u.constraintType, rc: u.reasonCode })))}`
  );
};

let fails = 0;
const assertPin = (name, ok, ist) => {
  console.log(`ASSERT ${name}: ${ok ? 'PASS' : 'FAIL'} — ist: ${ist}`);
  if (!ok) fails++;
};

try {
  await M.init();

  // PIN 1: fill-SMIL (#paint) muss ein ehrliches Zeit-Signal tragen.
  {
    const ins = await M.inspect(SVG_FILL);
    const el = findEl(ins, 'paint');
    const an = await M.analyze(SVG_FILL, ['#paint COLOR red']);
    const signal =
      flagSignal(el) || warningSignal(el) || docWarningSignal(ins) || constraintSignal(an, 'paint');
    assertPin(
      'fill_smil_zeit_signal',
      signal,
      el ? istString(el, an) : `#paint NICHT in scene.elements; ${istString(null, an)}`,
    );
  }

  // PIN 2: opacity-SMIL (#blink, values 1;0;1 indefinite) muss ein ehrliches Zeit-Signal tragen.
  {
    const ins = await M.inspect(SVG_OPACITY);
    const el = findEl(ins, 'blink');
    const an = await M.analyze(SVG_OPACITY, ['#blink COLOR blue', '#blink INSIDE #frame']);
    const signal =
      flagSignal(el) || warningSignal(el) || docWarningSignal(ins) || constraintSignal(an, 'blink');
    assertPin(
      'opacity_smil_zeit_signal',
      signal,
      el ? istString(el, an) : `#blink NICHT in scene.elements; ${istString(null, an)}`,
    );
  }

  // KONTROLL-PIN 3: Geometrie-SMIL (x) bleibt MOTION_DEPENDENT.
  {
    const ins = await M.inspect(SVG_GEOM);
    const el = findEl(ins, 'geo');
    const ok =
      Boolean(el) &&
      (el.motion_dependent === true ||
        (el.warnings || []).some((w) => /MOTION_DEPENDENT/i.test(String(w))));
    assertPin(
      'kontroll_geom_x_motion_dependent',
      ok,
      el
        ? `motion_dependent=${JSON.stringify(el.motion_dependent ?? null)}, warnings=${JSON.stringify(el.warnings ?? [])}`
        : '#geo NICHT in scene.elements',
    );
  }

  // KONTROLL-PIN 4: Statisches Element (#frame) bleibt frei von Zeit-Flags/Zeit-Warnings.
  // (Nicht-Zeit-Warnings wie PAINT_OVERFLOW/COLOR_FROM_STROKE sind erlaubt.)
  {
    const ins = await M.inspect(SVG_OPACITY);
    const el = findEl(ins, 'frame');
    const ok = Boolean(el) && !flagSignal(el) && !warningSignal(el);
    assertPin(
      'kontroll_statisch_flag_frei',
      ok,
      el
        ? `motion_dependent=${JSON.stringify(el.motion_dependent ?? null)}, warnings=${JSON.stringify(el.warnings ?? [])}, zeit-flags=${JSON.stringify(Object.keys(el).filter((k) => k !== 'warnings' && tokenHasTimeSemantics(k) && Boolean(el[k])))}`
        : '#frame NICHT in scene.elements',
    );
  }
} finally {
  await M.shutdown();
}

console.log(`H10-RED R11-06: ${fails > 0 ? `ROT (${fails} FAIL)` : 'GRUEN'}`);
process.exit(fails > 0 ? 1 : 0);
