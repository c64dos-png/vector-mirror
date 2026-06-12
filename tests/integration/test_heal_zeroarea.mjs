/**
 * test_heal_zeroarea.mjs — §HEAL-ZA / Heal 3 „ZeroPaintWitness" (F-AT-7-05 + F-AT-7-12)
 *
 * Real-Chromium-Harness (KEINE Mocks), Stil nach test_heal2_visibility /
 * test_heal_r6_media_dependent. Spec: docs/internal/an internal spec.
 *
 * DIE LÜGE (vorher): ein Element mit 0 FLÄCHE bei NICHT-0-Extent (rect 0×40,
 * ellipse rx=0, image w=0, CSS-genullt, fill-only-path mit 0-Extent-Achse,
 * 2-Punkt-polygon — auch DIAGONAL mit beidseitig >0-Extent, F-AT-7-12) malt
 * 0 Pixel, wurde aber als bbox_reliability:reliable + konkrete Farbe + status:ok
 * OHNE paint_visible-Flag, OHNE Warning emittiert (stille Mess-Lüge, Klasse G6;
 * Boden-Wahrheit: an internal ground-truth probe).
 *
 * DIE HEILUNG (Schwanz-A principle: attributiv exakt ⇒ exakt false):
 *   S1 DISABLE  (rect/ellipse/circle/image/foreignObject, COMPUTED-Geometrie==0,
 *               einachsig genügt — SVG2 „disables rendering", killt ALLE Kanäle)
 *   S2 FILL-TOD (path/polygon/polyline, fill EINZIGER Tinten-Kanal, 0-Extent-
 *               Achse ODER Shoelace exakt 0)
 *   ⇒ paint_visible:false + Warning PAINT_NOT_VISIBLE über die EXISTENTEN
 *   Schienen. Die GEOMETRIE bleibt unberührt: bbox_reliability reliable, bbox
 *   byte-unverändert (die bbox IST exakt — die FLÄCHE ist die Lüge).
 *
 * NEGATIV-VERTRAG (dürfen NIE geflaggt werden, Output byte-identisch zu vorher):
 *   path h-Linie MIT stroke (320 px Tinte) · 3-Punkt-polygon · ellipse OHNE rx
 *   (computed 'auto' → ry-Auflösung, malt!) · ellipse rx normal · rect Attribut 0
 *   + CSS width:40px (CSS gewinnt, malt!) · rect 20×20 · zero-length-line MIT
 *   stroke (bleibt LAUT via COLOR_FROM_STROKE/PAINT_OVERFLOW, F-AT-7-02 — KEIN
 *   paint_visible:false) · rect scale(0,1) (heute schon false via B1/maskDead —
 *   bleibt false, KEINE Doppel-Warning).
 *
 * R9: 2× inspect byte-identisch (NICHT analyze — D-028 analysisId-randomUUID);
 * SMIL width 0→40 @frozen-t0 ⇒ Verdikt false, byte-stabil.
 *
 * Run direkt: `node tests/integration/test_heal_zeroarea.mjs`
 */
import {
  closeResolver,
  createResolver,
  resolve,
} from '../../src/adapters/renderer/playwright.js';
import { inspect, shutdown } from '../../src/pipeline.js';

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

// Kanonischer Stringify: Schlüssel rekursiv sortiert → byte-stabiler Vergleich.
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') {
    return (
      '{' +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canon(v[k]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(v);
}

function byId(elements, id) {
  return (elements || []).find((e) => e.id === id);
}

function hasWarn(el, w) {
  return Array.isArray(el?.warnings) && el.warnings.includes(w);
}

function warnCount(el, w) {
  return (el?.warnings || []).filter((x) => x === w).length;
}

function bboxIs(el, x, y, w, h) {
  return (
    !!el?.bbox &&
    el.bbox.x === x &&
    el.bbox.y === y &&
    el.bbox.w === w &&
    el.bbox.h === h
  );
}

// Geflaggt-tot ⇔ BEIDE Signale (fail-loud, analog isMediaFlagged): exaktes
// paint_visible:false (NICHT 'indeterminate' — Schwanz A ist attributiv exakt)
// UND Warning PAINT_NOT_VISIBLE GENAU EINMAL (keine Doppel-Warning).
function isZeroFlagged(el) {
  return (
    !!el &&
    el.paint_visible === false &&
    warnCount(el, 'PAINT_NOT_VISIBLE') === 1
  );
}

const VB =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"';
// Anker verhindert NO_ELEMENTS, falls ein degeneriertes Element je geskippt würde.
const ANCHOR = '<rect id="anchor" x="0" y="0" width="5" height="5" fill="gray"/>';
// 1×1-PNG (data-URI): width=0 macht das Bild flächenlos — der Inhalt ist egal.
const PNG1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// ── POSITIV A (S1 DISABLE attributiv): rect 0×40 · rect 40×0 · ellipse rx=0 · ry=0 ──
const SVG_POS_A = `<svg ${VB}>
  <rect id="p_zw" x="20" y="10" width="0" height="40" fill="blue"/>
  <rect id="p_zh" x="30" y="60" width="40" height="0" fill="lime"/>
  <ellipse id="p_ze_rx" cx="20" cy="30" rx="0" ry="20" fill="orange"/>
  <ellipse id="p_ze_ry" cx="70" cy="70" rx="20" ry="0" fill="brown"/>
  ${ANCHOR}
</svg>`;

// ── POSITIV B: image w=0 · CSS-genullt (Attribut 40 + style width:0px, A1a —
// nur die COMPUTED-Lesart sieht die 0) · fill-only-path 0-Höhe · DIAGONALES
// 2-Punkt-polygon (F-AT-7-12: Extents beidseitig >0, NUR Shoelace zeugt) ──────
const SVG_POS_B = `<svg ${VB}>
  <image id="p_img" x="10" y="10" width="0" height="40" href="${PNG1}"/>
  <rect id="p_css" x="30" y="10" width="40" height="40" style="width:0px" fill="green"/>
  <path id="p_path" d="M10 60 L90 60" fill="red" stroke="none"/>
  <polygon id="p_diag" points="10,80 90,95" fill="red"/>
  ${ANCHOR}
</svg>`;

// ── POSITIV SMIL (A3): width animiert 0→40, begin=0s — der frozen-t0-Freeze
// (pauseAnimations + setCurrentTime(0)) misst computed "0px" @t0 ⇒ Verdikt
// false (R9-konform ehrlich: das Attribut sagt 40, der MESS-Frame malt 0). ──────
const SVG_SMIL = `<svg ${VB}>
  <rect id="p_smil" x="20" y="20" width="40" height="40" fill="blue">
    <animate attributeName="width" values="0;40" begin="0s" dur="2s" fill="freeze"/>
  </rect>
  ${ANCHOR}
</svg>`;

// ── NEGATIV A (falsch-tot verboten): h-Linien-path MIT stroke (A2a, 320 px) ·
// 3-Punkt-polygon normal · ellipse OHNE rx (A4a: computed 'auto' → ry-Auflösung,
// malt!) · ellipse rx explizit normal ─────────────────────────────────────────
const SVG_NEG_A = `<svg ${VB}>
  <path id="n_hstroke" d="M10 20 L90 20" fill="none" stroke="blue" stroke-width="4"/>
  <polygon id="n_tri" points="10,40 50,40 30,75" fill="red"/>
  <ellipse id="n_auto" cx="70" cy="60" ry="20" fill="teal"/>
  <ellipse id="n_rx" cx="30" cy="88" rx="10" ry="10" fill="navy"/>
  ${ANCHOR}
</svg>`;

// ── NEGATIV B: rect Attribut w=0 + CSS width:30px (A1b: CSS gewinnt, malt!) ·
// rect 20×20 normal · zero-length-line MIT stroke (zl: bleibt LAUT, F-AT-7-02) ·
// rect scale(0,1) (B1/maskDead liefert bereits false — keine Doppel-Warning) ──
const SVG_NEG_B = `<svg ${VB}>
  <rect id="n_csswins" x="10" y="10" width="0" height="20" style="width:30px" fill="red"/>
  <rect id="n_ok" x="60" y="10" width="20" height="20" fill="red"/>
  <line id="n_zl" x1="10" y1="50" x2="10" y2="50" stroke="purple" stroke-width="4"/>
  <rect id="n_scale0" x="10" y="70" width="20" height="20" fill="red" transform="scale(0,1)"/>
  ${ANCHOR}
</svg>`;

// ── PATCH-RUNDE (Triple-Review R1–R7) ────────────────────────────────────────
// POSITIV C (R4/R7-Härtung): circle r=0 MIT stroke (Disable killt stroke, GT
// 0 px) · rect w=0 MIT stroke (GT 0 px) · ellipse OHNE rx UND ry (BEIDE
// computed literal 'auto' ⇒ used 0/0 ⇒ disabled; GT 0 px auch mit stroke, R7) ·
// polygon 3 Punkte KOLLINEAR (GT 0 px — der R1-Kollinearitäts-Zeuge).
// foreignObject (R4/R5): wird von DOMPurify USE_PROFILES.svg VOR dem Auge
// GESTRIPPT (element_vocabulary.js „Defensive"; empirisch: resolve emittiert
// fO NIE, auch w=40) — ein Positiv-Beweis ist systemisch unerreichbar; die
// Fixture assertet stattdessen die LAUTE Wahrheit (sanitize_loss TAG_STRIPPED,
// keine stille Lüge möglich). Der S1-'foreignobject'-Zweig bleibt Defensive;
// R5-Casing-Beleg: playwright.js Z.3367 `el.tagName.toLowerCase()`.
const SVG_POS_C = `<svg ${VB}>
  <circle id="p_circle" cx="50" cy="30" r="0" fill="none" stroke="red" stroke-width="4"/>
  <foreignObject id="p_fo" x="10" y="10" width="0" height="40"><div xmlns="http://www.w3.org/1999/xhtml" style="width:40px;height:40px;background:red">X</div></foreignObject>
  <rect id="p_zw_stroke" x="20" y="60" width="0" height="30" fill="none" stroke="blue" stroke-width="4"/>
  <ellipse id="p_ell_auto2" cx="70" cy="70" fill="none" stroke="red" stroke-width="4"/>
  <polygon id="p_col3" points="10,10 50,50 90,90" fill="red"/>
  ${ANCHOR}
</svg>`;

// ── FLOOD (R2): GENERATIVER Filter (feFlood, userSpaceOnUse-Region) malt Tinte
// UNABHÄNGIG vom fill-Kanal. n_floodpath (S2-Kandidat, GT 10000 px!) darf NIE
// ZA-false tragen; p_floodrect (S1) bleibt false — das DISABLE killt auch den
// Filter-Output (GT 0 px: 0-dim-Element rendert nichts, Filter inklusive). ─────
const SVG_FLOOD = `<svg ${VB}>
  <defs><filter id="ff" filterUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><feFlood flood-color="red"/></filter></defs>
  <path id="n_floodpath" d="M10 60 L90 60" fill="red" stroke="none" filter="url(#ff)"/>
  <rect id="p_floodrect" x="20" y="20" width="0" height="40" fill="blue" filter="url(#ff)"/>
  ${ANCHOR}
</svg>`;

// ── NEGATIV C (R1): selbstschneidende BOWTIE-Polygone — signierte Shoelace-
// Fläche EXAKT 0, aber sie MALEN real (GT: 3280 px bzw. 1860 px; nonzero/
// evenodd füllen Teilflächen) → dürfen NIE geflaggt werden. n_float: Knapp-
// Polygon mit winziger NICHT-0-Fläche (2A=0.8, Kreuzprodukt −0.8 ≠ 0 exakt) —
// schützt gegen eine Toleranz-Mutante (|2A|<1 ⇒ Flag wäre falsch-tot). ─────────
const SVG_NEG_C = `<svg ${VB}>
  <polygon id="n_bowtie1" points="10,10 90,90 10,90 90,10" fill="red"/>
  <polygon id="n_bowtie2" points="20,20 80,20 20,80 80,80" fill="red"/>
  <polygon id="n_float" points="10,10 90,10 50,10.01" fill="red"/>
  ${ANCHOR}
</svg>`;

// ── NEGATIV D (R4/R6): 3-Punkt-polyline KOLLINEAR mit SICHTBAREM marker-mid
// (GT 60 px — der !markerVisible-Guard MUSS das Flag verhindern, M4) · image
// OHNE width-Attribut (R6). RED20 = rotes 20×20-SVG-data-URI (GT roh: 1600 px).
// R6-SYSTEM-WAHRHEIT: der Sanitizer strippt JEDEN data-/extern-href
// (sanitize_loss: EXTERNAL_USE_NOT_RESOLVED) — das GEMESSENE image ist href-los,
// computed width "0px" (NICHT 'auto'), malt im Mess-DOM real 0 px ⇒ das Flag
// ist Mess-DOM-ehrlich; der Original-Verlust läuft LAUT über sanitize_loss/
// canvas_validity. Der R6-Soll „auto-image ungeflaggt" ist Sanitizer-gated
// (auto⇒0-Substitution für image bleibt als Code-Defensive ENTFERNT). ──────────
const RED20 =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+PHJlY3Qgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiBmaWxsPSJyZWQiLz48L3N2Zz4=';
const SVG_NEG_D = `<svg ${VB}>
  <defs><marker id="mm" markerWidth="8" markerHeight="8" refX="4" refY="4"><circle cx="4" cy="4" r="4" fill="yellow"/></marker></defs>
  <polyline id="n_marker" points="10,10 50,10 90,10" fill="red" stroke="none" marker-mid="url(#mm)"/>
  <image id="n_img" x="10" y="30" height="40" href="${RED20}"/>
  ${ANCHOR}
</svg>`;

// ── STATE-SYMMETRIE (R3a): default-display:none-STATE-Elemente haben getBBox
// 0×0 (display-ARTEFAKT, nicht Autor-Geometrie). path und strukturgleiches rect
// MÜSSEN identisch behandelt werden — das bbox-basierte S2-Achsen-Prädikat
// (XOR) urteilt bei beide-Achsen-0 NICHT (geomEmpty-/STATE-Domäne). Das false
// beider stammt aus dem EXISTENTEN B1-Pfad — vor wie nach Heal 3 symmetrisch. ──
const SVG_STATE_SYM = `<svg ${VB}>
  <style>#sp,#sr{display:none} #trig:hover ~ #sp{display:block} #trig:hover ~ #sr{display:block}</style>
  <rect id="trig" x="0" y="0" width="10" height="10" fill="silver"/>
  <rect id="sr" x="20" y="20" width="40" height="30" fill="red"/>
  <path id="sp" d="M10 60 L90 60 L50 90 Z" fill="blue"/>
</svg>`;

// ── MEDIA-0×0 (R3b, Honest Red): media-durchlässiger fill-only-path mit ECHTER
// beide-Achsen-0-Autor-Geometrie. Beide-Achsen-0 ist geomEmpty-Domäne (trägt
// Autor-Information, Output wie vor Heal 3; media_dependent trägt die Wahrheit)
// — das S2-OR-Prädikat flaggte ihn fälschlich hart-false, XOR urteilt nicht. ───
const SVG_MEDIA0 = `<svg ${VB}>
  <style>@media (max-width:600px){#mp{fill:red}}</style>
  <path id="mp" d="M50 50 L50 50" fill="red"/>
  ${ANCHOR}
</svg>`;

// Positiv-Fall-Tabelle: [id, svg, bbox-Erwartung] — bbox ist die UNVERÄNDERTE
// Autor-/t0-Geometrie (die Geometrie ist NICHT die Lüge, nur die Fläche).
const POSITIVE_CASES = [
  ['p_zw', 'rect w=0 h=40', SVG_POS_A, [20, 10, 0, 40]],
  ['p_zh', 'rect w=40 h=0', SVG_POS_A, [30, 60, 40, 0]],
  ['p_ze_rx', 'ellipse rx=0', SVG_POS_A, [20, 10, 0, 40]],
  ['p_ze_ry', 'ellipse ry=0', SVG_POS_A, [50, 70, 40, 0]],
  ['p_img', 'image width=0 (data-URI)', SVG_POS_B, [10, 10, 0, 40]],
  ['p_css', 'CSS-genullt (Attr 40 + style width:0px)', SVG_POS_B, [30, 10, 0, 40]],
  ['p_path', 'path h-Linie fill-only', SVG_POS_B, [10, 60, 80, 0]],
  ['p_diag', 'polygon 2 Punkte DIAGONAL (Kollinearität)', SVG_POS_B, [10, 80, 80, 15]],
  ['p_smil', 'SMIL width 0→40 @frozen-t0', SVG_SMIL, [20, 20, 0, 40]],
  // Patch-Runde (R1/R4/R7 + R2-S1-Erhalt):
  ['p_circle', 'circle r=0 MIT stroke (Disable killt stroke)', SVG_POS_C, [50, 30, 0, 0]],
  ['p_zw_stroke', 'rect w=0 MIT stroke (Disable killt stroke)', SVG_POS_C, [20, 60, 0, 30]],
  ['p_ell_auto2', "ellipse OHNE rx+ry (beide 'auto' ⇒ disabled)", SVG_POS_C, [70, 70, 0, 0]],
  ['p_col3', 'polygon 3 Punkte KOLLINEAR', SVG_POS_C, [10, 10, 80, 80]],
  ['p_floodrect', 'rect w=0 + generativer Filter (S1 killt Filter)', SVG_FLOOD, [20, 20, 0, 40]],
];

(async () => {
  let page;
  try {
    page = await createResolver();
  } catch (e) {
    console.error('Renderer-Init fehlgeschlagen:', e.message);
    process.exit(1);
  }

  try {
    // ── POSITIV: heute Lüge → nach Fix paint_visible:false + PAINT_NOT_VISIBLE ──
    const resolved = new Map(); // svg → resolve-Resultat (jedes Fixture EINMAL rendern)
    const resOf = async (svg) => {
      if (!resolved.has(svg)) resolved.set(svg, await resolve(page, svg));
      return resolved.get(svg);
    };
    const elsOf = async (svg) => (await resOf(svg)).elements || [];

    console.log('=== POSITIV: 0-Fläche bei Nicht-0-Extent ⇒ exakt false + Warning ===');
    for (const [id, label, svg, bb] of POSITIVE_CASES) {
      const els = await elsOf(svg);
      const el = byId(els, id);
      assert(
        `${label}: #${id} EMITTIERT (kein Skip — lossless-or-loud)`,
        !!el,
        `ids=${JSON.stringify((els || []).map?.((e) => e.id))}`,
      );
      assert(
        `${label}: paint_visible === false + GENAU 1× PAINT_NOT_VISIBLE`,
        isZeroFlagged(el),
        `paint_visible=${JSON.stringify(el?.paint_visible)} warnings=${JSON.stringify(el?.warnings)}`,
      );
      assert(
        `${label}: bbox_reliability bleibt reliable (Geometrie ist NICHT die Lüge)`,
        el?.bbox_reliability === 'reliable',
        `got ${JSON.stringify(el?.bbox_reliability)}`,
      );
      assert(
        `${label}: bbox unverändert [${bb.join(',')}]`,
        bboxIs(el, ...bb),
        `got ${JSON.stringify(el?.bbox)}`,
      );
    }

    // ── NEGATIV: falsch-tot VERBOTEN — kein Flag, keine PAINT_NOT_VISIBLE ──────
    console.log('\n=== NEGATIV: malende Elemente dürfen NIE geflaggt werden ===');
    const negA = await elsOf(SVG_NEG_A);
    const negB = await elsOf(SVG_NEG_B);
    for (const [id, label, els] of [
      ['n_hstroke', 'path h-Linie MIT stroke (320 px Tinte)', negA],
      ['n_tri', 'polygon 3 Punkte normal', negA],
      ['n_auto', "ellipse OHNE rx (computed 'auto' → ry-Auflösung, malt)", negA],
      ['n_rx', 'ellipse rx explizit normal', negA],
      ['n_csswins', 'rect Attribut 0 + CSS width:30px (CSS gewinnt, malt)', negB],
      ['n_ok', 'rect 20×20 normal', negB],
      ['anchor', 'Anker-Kontrolle', negA],
    ]) {
      const el = byId(els, id);
      assert(`${label}: #${id} emittiert`, !!el);
      assert(
        `${label}: KEIN paint_visible-Feld`,
        el && !('paint_visible' in el),
        `got ${JSON.stringify(el?.paint_visible)}`,
      );
      assert(
        `${label}: KEINE PAINT_NOT_VISIBLE-Warning`,
        !hasWarn(el, 'PAINT_NOT_VISIBLE'),
        `warnings=${JSON.stringify(el?.warnings)}`,
      );
    }
    // ellipse-auto-Geometrie-Beweis: rx löst zu ry=20 auf → bbox 40 breit (malt!).
    const nAuto = byId(negA, 'n_auto');
    assert(
      "ellipse OHNE rx: bbox w=40 (auto→ry-Auflösung — 'auto' ist NIE 0)",
      bboxIs(nAuto, 50, 40, 40, 40),
      `got ${JSON.stringify(nAuto?.bbox)}`,
    );
    // CSS-gewinnt-Geometrie-Beweis: used width = 30 (Attribut-0 wäre falsch-tot).
    const nCss = byId(negB, 'n_csswins');
    assert(
      'rect Attr 0 + CSS 30px: bbox w=30 (COMPUTED-Lesart, nie Attribut)',
      bboxIs(nCss, 10, 10, 30, 20),
      `got ${JSON.stringify(nCss?.bbox)}`,
    );

    // zl: zero-length-line MIT stroke bleibt LAUT (F-AT-7-02-Schiene), NICHT tot.
    console.log('\n=== zl: zero-length-line bleibt laut (KEIN paint_visible:false) ===');
    const nZl = byId(negB, 'n_zl');
    assert('zl: #n_zl emittiert', !!nZl);
    assert(
      'zl: KEIN paint_visible-Feld (nicht falsch-tot geflaggt)',
      nZl && !('paint_visible' in nZl),
      `got ${JSON.stringify(nZl?.paint_visible)}`,
    );
    assert(
      'zl: COLOR_FROM_STROKE erhalten (Lautheit der stroke-Heilung)',
      hasWarn(nZl, 'COLOR_FROM_STROKE'),
      `warnings=${JSON.stringify(nZl?.warnings)}`,
    );
    assert(
      'zl: PAINT_OVERFLOW erhalten (stroke-Outset-Ehrlichkeit)',
      hasWarn(nZl, 'PAINT_OVERFLOW'),
      `warnings=${JSON.stringify(nZl?.warnings)}`,
    );

    // scale(0,1): B1/maskDead liefert BEREITS false — Präzedenz beidseitig sicher
    // (A5/M3): der Witness erzeugt KEINE zweite Warning, das Verdikt bleibt false.
    console.log('\n=== scale(0,1): bleibt false via B1 — KEINE Doppel-Warning ===');
    const nScale = byId(negB, 'n_scale0');
    assert('scale(0,1): #n_scale0 emittiert', !!nScale);
    assert(
      'scale(0,1): paint_visible === false (B1-CTM-Determinante, wie heute)',
      nScale?.paint_visible === false,
      `got ${JSON.stringify(nScale?.paint_visible)}`,
    );
    assert(
      'scale(0,1): GENAU 1× PAINT_NOT_VISIBLE (keine Doppel-Warning)',
      warnCount(nScale, 'PAINT_NOT_VISIBLE') === 1,
      `warnings=${JSON.stringify(nScale?.warnings)}`,
    );

    // ── PATCH-RUNDE NEGATIV (R1/R4/R6): malende Geometrien NIE flaggen ─────────
    console.log('\n=== R1/R4/R6: Bowties · Float-Knapp · marker-mid · image-auto ===');
    const negC = await elsOf(SVG_NEG_C);
    const negD = await elsOf(SVG_NEG_D);
    for (const [id, label, els] of [
      ['n_bowtie1', 'Bowtie 10,10 90,90 10,90 90,10 (malt 3280 px, Σ-Fläche 0!)', negC],
      ['n_bowtie2', 'Bowtie 20,20 80,20 20,80 80,80 (malt 1860 px, Σ-Fläche 0!)', negC],
      ['n_float', 'Float-Knapp-Polygon (2A=0.8 ≠ 0 — keine Toleranz erlaubt)', negC],
      ['n_marker', '3-Punkt-polyline kollinear + SICHTBARER marker-mid (60 px)', negD],
    ]) {
      const el = byId(els, id);
      assert(`${label}: #${id} emittiert`, !!el);
      assert(
        `${label}: KEIN paint_visible-Feld`,
        el && !('paint_visible' in el),
        `got ${JSON.stringify(el?.paint_visible)}`,
      );
      assert(
        `${label}: KEINE PAINT_NOT_VISIBLE-Warning`,
        !hasWarn(el, 'PAINT_NOT_VISIBLE'),
        `warnings=${JSON.stringify(el?.warnings)}`,
      );
    }

    // ── R6: image OHNE width — Sanitizer-System-Wahrheit (lossless-or-loud) ────
    // Der Sanitizer strippt den data-href (Mess-DOM: href-los ⇒ intrinsisch 0
    // ⇒ computed "0px", NICHT 'auto' ⇒ 0 px REAL im Mess-DOM). Das Flag ist
    // Mess-DOM-ehrlich; der Verlust ist LAUT (sanitize_loss). Würde der
    // Sanitizer je hrefs durchlassen, schützt die entfernte auto⇒0-Substitution
    // (R6-Code-Defensive) vor dem Falsch-Tot — system-testbar ist das nicht.
    console.log('\n=== R6: image ohne width — href gestrippt, LAUT + Mess-DOM-ehrlich ===');
    const negDRes = await resOf(SVG_NEG_D);
    const nImg = byId(negDRes.elements, 'n_img');
    assert('R6: #n_img emittiert', !!nImg);
    assert(
      'R6: sanitize_loss trägt image/EXTERNAL_USE_NOT_RESOLVED (laut, nicht still)',
      (negDRes.sanitize_loss || []).some(
        (l) => l.tag === 'image' && l.reason === 'EXTERNAL_USE_NOT_RESOLVED',
      ),
      `sanitize_loss=${JSON.stringify(negDRes.sanitize_loss)}`,
    );
    assert(
      'R6: Mess-DOM-ehrlich paint_visible:false + GENAU 1× PAINT_NOT_VISIBLE (href-los ⇒ 0×40)',
      isZeroFlagged(nImg),
      `paint_visible=${JSON.stringify(nImg?.paint_visible)} warnings=${JSON.stringify(nImg?.warnings)}`,
    );
    assert(
      'R6: bbox [10,30,0,40] (gemessene href-lose Geometrie)',
      bboxIs(nImg, 10, 30, 0, 40),
      `got ${JSON.stringify(nImg?.bbox)}`,
    );

    // ── R4/R5: foreignObject — sanitize-gestrippt, LAUT (lossless-or-loud) ─────
    // DOMPurify USE_PROFILES.svg strippt <foreignObject> VOR dem Auge (Defensive,
    // element_vocabulary.js) — ein fO kann NIE still falsch-lebendig gemeldet
    // werden, weil es das Auge nie erreicht; sanitize_loss trägt den Verlust.
    // Der S1-'foreignobject'-Zweig im Witness bleibt Defensive für den Tag, an
    // dem der Sanitizer fO durchlässt (R5-Casing via tagName.toLowerCase()).
    console.log('\n=== R4/R5: foreignObject sanitize-gestrippt + LAUT ===');
    const posCRes = await resOf(SVG_POS_C);
    assert(
      'fO: #p_fo NICHT in elements (DOMPurify strippt foreignObject)',
      !byId(posCRes.elements, 'p_fo'),
      `ids=${JSON.stringify((posCRes.elements || []).map((e) => e.id))}`,
    );
    assert(
      'fO: sanitize_loss trägt TAG_STRIPPED:foreignobject (laut, nicht still)',
      (posCRes.sanitize_loss || []).some(
        (l) => l.tag === 'foreignobject' && l.reason === 'TAG_STRIPPED',
      ),
      `sanitize_loss=${JSON.stringify(posCRes.sanitize_loss)}`,
    );

    // ── R2: GENERATIVER Filter rettet den S2-Kandidaten (10000 px Boden-Wahrheit).
    // KEIN hartes false; 'indeterminate' via maskDead-Operator-Walk ist erlaubt
    // und ehrlich (Region nicht trivial beweisbar) — nur die FALSE-Lüge ist verboten.
    console.log('\n=== R2: fill-only-0-Extent-path + feFlood-Filter ⇒ KEIN ZA-false ===');
    const floodEls = await elsOf(SVG_FLOOD);
    const nFlood = byId(floodEls, 'n_floodpath');
    assert('floodpath: #n_floodpath emittiert', !!nFlood);
    assert(
      'floodpath: paint_visible NIEMALS false (Filter malt die Region)',
      nFlood && nFlood.paint_visible !== false,
      `got ${JSON.stringify(nFlood?.paint_visible)}`,
    );
    assert(
      'floodpath: KEINE PAINT_NOT_VISIBLE-Warning',
      !hasWarn(nFlood, 'PAINT_NOT_VISIBLE'),
      `warnings=${JSON.stringify(nFlood?.warnings)}`,
    );

    // ── R3a: STATE-SYMMETRIE — display:none-state path ↔ rect IDENTISCH ────────
    console.log('\n=== R3a: display:none-STATE — path verhält sich EXAKT wie rect ===');
    const stateEls = await elsOf(SVG_STATE_SYM);
    const sR = byId(stateEls, 'sr');
    const sP = byId(stateEls, 'sp');
    assert('state-sym: #sr (rect) emittiert', !!sR);
    assert('state-sym: #sp (path) emittiert', !!sP);
    assert(
      'state-sym: paint_visible path === rect (KEINE Tag-Asymmetrie)',
      !!sR && !!sP && sP.paint_visible === sR.paint_visible,
      `path=${JSON.stringify(sP?.paint_visible)} rect=${JSON.stringify(sR?.paint_visible)}`,
    );
    assert(
      'state-sym: PAINT_NOT_VISIBLE-Zählung path === rect',
      warnCount(sP, 'PAINT_NOT_VISIBLE') === warnCount(sR, 'PAINT_NOT_VISIBLE'),
      `path=${JSON.stringify(sP?.warnings)} rect=${JSON.stringify(sR?.warnings)}`,
    );
    assert(
      'state-sym: beide tragen STATE_DEPENDENT',
      hasWarn(sP, 'STATE_DEPENDENT') && hasWarn(sR, 'STATE_DEPENDENT'),
      `path=${JSON.stringify(sP?.warnings)} rect=${JSON.stringify(sR?.warnings)}`,
    );

    // ── R3b: beide-Achsen-0 ist geomEmpty-/STATE-Domäne, NICHT ZA ──────────────
    console.log('\n=== R3b: media-durchlässiger 0×0-fill-path ⇒ KEIN ZA-Urteil ===');
    const mediaEls = await elsOf(SVG_MEDIA0);
    const mp = byId(mediaEls, 'mp');
    assert('media-0×0: #mp emittiert (media-durchlässig)', !!mp);
    assert(
      'media-0×0: media_dependent === true (die Achsen-Wahrheit trägt MEDIA)',
      mp?.media_dependent === true,
      `got ${JSON.stringify(mp?.media_dependent)}`,
    );
    assert(
      'media-0×0: bbox unverändert [50,50,0,0] (echte Autor-Geometrie)',
      bboxIs(mp, 50, 50, 0, 0),
      `got ${JSON.stringify(mp?.bbox)}`,
    );
    assert(
      'media-0×0: KEIN paint_visible:false + KEINE PAINT_NOT_VISIBLE (wie vor Heal 3)',
      mp && mp.paint_visible !== false && !hasWarn(mp, 'PAINT_NOT_VISIBLE'),
      `paint_visible=${JSON.stringify(mp?.paint_visible)} warnings=${JSON.stringify(mp?.warnings)}`,
    );
  } finally {
    await closeResolver();
  }

  // ── PIPELINE-PFAD (inspect → structured): MCP-Boundary + R9-Byte-Stabilität ──
  // closeResolver hat den Renderer-Sweep-Browser geschlossen; inspect() nutzt den
  // eigenen lazy Pipeline-Lifecycle (analog test_heal2_visibility).
  try {
    console.log('\n=== MCP-Boundary: SMIL-0→40 @t0 trägt false bis scene.elements ===');
    const eye = await inspect(SVG_SMIL);
    const sceneSmil = byId(eye.structured?.scene?.elements, 'p_smil');
    assert(
      'inspect: p_smil.paint_visible === false (Verdikt erreicht den Konsumenten)',
      sceneSmil?.paint_visible === false,
      `got ${JSON.stringify(sceneSmil?.paint_visible)}`,
    );
    assert(
      'inspect: p_smil trägt PAINT_NOT_VISIBLE',
      hasWarn(sceneSmil, 'PAINT_NOT_VISIBLE'),
      `warnings=${JSON.stringify(sceneSmil?.warnings)}`,
    );
    assert(
      'inspect: p_smil.bbox_reliability bleibt reliable',
      sceneSmil?.bbox_reliability === 'reliable',
      `got ${JSON.stringify(sceneSmil?.bbox_reliability)}`,
    );

    // R9: 2× inspect byte-identisch — Positiv-SVG (SMIL@t0) und Negativ-SVG.
    // BEWUSST inspect, NICHT analyze: analyze ist via iteration.analysisId
    // (randomUUID) byte-instabil (D-028) — inspect ist der stabile Pfad.
    console.log('\n=== R9: 2× inspect byte-identisch (Positiv + Negativ) ===');
    const s1 = canon((await inspect(SVG_SMIL)).structured);
    const s2 = canon((await inspect(SVG_SMIL)).structured);
    assert(
      'R9 positiv (SMIL): 2× inspect byte-identisch',
      s1 === s2,
      `len ${s1.length} vs ${s2.length}`,
    );
    const n1 = canon((await inspect(SVG_NEG_B)).structured);
    const n2 = canon((await inspect(SVG_NEG_B)).structured);
    assert(
      'R9 negativ: 2× inspect byte-identisch',
      n1 === n2,
      `len ${n1.length} vs ${n2.length}`,
    );
  } finally {
    await shutdown();
  }

  console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error('Test-Lauf-Fehler:', e);
  process.exit(1);
});
