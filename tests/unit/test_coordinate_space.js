/**
 * test_coordinate_space.js — Sprint N2 (CRITICAL Basis-Fix, Koordinatenraum)
 *
 * Honest-Red-Test fuer N2: Der Renderer (src/adapters/renderer/playwright.js)
 * MUSS bbox (x,y,w,h) JEDES Elements im USER-Koordinatenraum der SVG emittieren
 * — alle Element-/Ancestor-Transforms angewandt, ABER OHNE die
 * viewBox->viewport-Skalierung und ohne den vbX/vbY-Window-Offset.
 *
 * Invariante: <rect x="10"> -> bbox.x == 10 fuer ALLE validen SVG-Inputs,
 * unabhaengig von width/height/%/preserveAspectRatio/viewBox-Offset.
 *
 * MECHANISCHER N2-BEWEIS (Honest-Red): Gegen den AKTUELLEN (getCTM-)Code ist
 * RED_a_viewbox_only ROT (bbox.x ~= 190 statt 10, weil getCTM die
 * viewBox->viewport-Skalierung ~19.2x injiziert). Nach PATH C
 * (svg.getScreenCTM().inverse().multiply(el.getScreenCTM())) wird er GRUEN.
 *
 * Erwartungswerte EXAKT nach an internal briefing-Tabelle (maintainer-verified
 * gegen den echten Renderer, chromium-1208):
 *   viewBox-only rect x=10 y=20            -> (10, 20)
 *   viewBox="-40 -5 ..." rect x=10 y=20    -> (10, 20)
 *   viewBox + transform="translate(5 5)"   -> (15, 25)
 *   width/height + viewBox (Kontrolle)     -> (10, 20)   (Scale=1, GRUEN auch vor Fix)
 *   viewBox + transform="rotate(90)"       -> (-20, 10)  (SVG-Matrix [0 -1; 1 0])
 *
 * Toleranz: ±0.5 user-unit (Sub-Pixel-CTM-Akkumulation, vgl. ADR-026
 * 'approximate'). KEINE exakte Float-Gleichheit.
 *
 * Test ist browser-bound (createResolver/resolve), Bauvorbild
 * tests/unit/test_3d_detection.js.
 */
import {
  closeResolver,
  createResolver,
  resolve,
} from '../../src/adapters/renderer/playwright.js';

let passed = 0,
  failed = 0;

const TOL = 0.5;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function approx(actual, expected, tol = TOL) {
  return typeof actual === 'number' && Math.abs(actual - expected) <= tol;
}

// ── Fixtures: identische Rect-Geometrie x=10 y=20 w=30 h=40 ueber alle
//    Szenarien (ausser bei aufgepraegten Element-Transforms). Truth = das
//    SVG-Quell-Attribut in user-units. ───────────────────────────────────

const FIXTURES = {
  // RED: viewBox ohne width/height. getCTM-Scale ~19.2 -> bbox.x ~= 190 (FALSCH).
  // Korrekt (PATH C): (10, 20). DAS ist der Honest-Red-Kern.
  viewbox_only: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect id="r" x="10" y="20" width="30" height="40"/></svg>`,

  // RED: viewBox mit negativem Offset (vbX=-40, vbY=-5). getCTM injiziert
  // Scale + Offset -> grob falsch. Korrekt: Quell-Attribut (10, 20),
  // vbX/vbY bleibt Origin-Traeger in canvas.vbX.
  viewbox_offset: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-40 -5 100 100"><rect id="r" x="10" y="20" width="30" height="40"/></svg>`,

  // RED: viewBox-only + Element-translate(5 5). Transform-Erhalt-Beleg.
  // Korrekt: (10+5, 20+5) = (15, 25) in user-units.
  translate_preserve: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect id="r" x="10" y="20" width="30" height="40" transform="translate(5 5)"/></svg>`,

  // KONTROLL-GRUEN (vor UND nach Fix): width=height=viewBox -> getCTM-Scale=1
  // -> heute schon (10, 20). Nicht-Regression der maskierenden Fixture-Klasse.
  control_wh: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><rect id="r" x="10" y="20" width="30" height="40"/></svg>`,

  // RED: viewBox-only + Element-rotate(90). SVG-rotate-Matrix [0 -1; 1 0]
  // bildet (10,20)->(-20,10) (Punkt-Rotation um Origin). AABB der 4 Ecken
  // -> xmin = -(20+40) = -60? NEIN: rect (x=10,y=20,w=30,h=40), Ecken
  // (10,20),(40,20),(10,60),(40,60); rotate(90): (x,y)->(-y,x) ->
  // (-20,10),(-20,40),(-60,10),(-60,40). AABB: xmin=-60, ymin=10.
  // bbox.x ist das xmin der AABB = -60; bbox.y = ymin = 10.
  // Briefing-Tabelle nennt fuer den (10,20)-ECKPUNKT (-20,10); der
  // AABB-Ursprung (xmin,ymin) ist (-60,10). Wir assertieren die AABB
  // (das ist was der Renderer emittiert) UND die transformierte Ecke.
  rotate90: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect id="r" x="10" y="20" width="30" height="40" transform="rotate(90)"/></svg>`,
};

async function probe(page, svg) {
  const result = await resolve(page, svg);
  if (result.error) {
    return { error: result.error, message: result.message };
  }
  const el = result.elements.find((e) => e.id === 'r');
  return { result, el };
}

(async () => {
  let page;
  try {
    page = await createResolver();
  } catch (e) {
    console.error('Renderer-Init fehlgeschlagen:', e.message);
    process.exit(1);
  }

  try {
    // ── RED #1: viewBox-only — der Honest-Red-Kern ──────────────────
    console.log('--- COORD-SPACE: viewbox_only (RED vor Fix: bbox.x ~190) ---');
    {
      const { el, error, message } = await probe(page, FIXTURES.viewbox_only);
      assert(
        'viewbox_only: target found',
        !!el,
        error && `${error}: ${message}`,
      );
      assert(
        'viewbox_only: bbox.x ~= 10 (user-units, NICHT ~190)',
        el && approx(el.bbox.x, 10),
        el && `got bbox.x=${el.bbox.x}`,
      );
      assert(
        'viewbox_only: bbox.y ~= 20',
        el && approx(el.bbox.y, 20),
        el && `got bbox.y=${el.bbox.y}`,
      );
      assert(
        'viewbox_only: bbox.w ~= 30',
        el && approx(el.bbox.w, 30),
        el && `got bbox.w=${el.bbox.w}`,
      );
      assert(
        'viewbox_only: bbox.h ~= 40',
        el && approx(el.bbox.h, 40),
        el && `got bbox.h=${el.bbox.h}`,
      );
    }

    // ── RED #2: viewBox mit Offset ──────────────────────────────────
    console.log('--- COORD-SPACE: viewbox_offset (RED vor Fix) ---');
    {
      const { result, el, error, message } = await probe(
        page,
        FIXTURES.viewbox_offset,
      );
      assert(
        'viewbox_offset: target found',
        !!el,
        error && `${error}: ${message}`,
      );
      assert(
        'viewbox_offset: bbox.x ~= 10 (Quell-Attribut)',
        el && approx(el.bbox.x, 10),
        el && `got bbox.x=${el.bbox.x}`,
      );
      assert(
        'viewbox_offset: bbox.y ~= 20',
        el && approx(el.bbox.y, 20),
        el && `got bbox.y=${el.bbox.y}`,
      );
      // vbX/vbY bleibt der Origin-Traeger in canvas (grid.js subtrahiert ihn).
      assert(
        'viewbox_offset: canvas.vbX == -40',
        result && result.canvas && result.canvas.vbX === -40,
        result && result.canvas && `got vbX=${result.canvas.vbX}`,
      );
    }

    // ── RED #3: translate-Erhaltung ─────────────────────────────────
    console.log('--- COORD-SPACE: translate_preserve (RED vor Fix) ---');
    {
      const { el, error, message } = await probe(
        page,
        FIXTURES.translate_preserve,
      );
      assert(
        'translate_preserve: target found',
        !!el,
        error && `${error}: ${message}`,
      );
      assert(
        'translate_preserve: bbox.x ~= 15 (10 + translate 5)',
        el && approx(el.bbox.x, 15),
        el && `got bbox.x=${el.bbox.x}`,
      );
      assert(
        'translate_preserve: bbox.y ~= 25 (20 + translate 5)',
        el && approx(el.bbox.y, 25),
        el && `got bbox.y=${el.bbox.y}`,
      );
    }

    // ── KONTROLL-GRUEN: width/height (Scale=1) — Nicht-Regression ───
    console.log('--- COORD-SPACE: control_wh (GRUEN vor UND nach Fix) ---');
    {
      const { el, error, message } = await probe(page, FIXTURES.control_wh);
      assert('control_wh: target found', !!el, error && `${error}: ${message}`);
      assert(
        'control_wh: bbox.x ~= 10 (Scale=1, unveraendert)',
        el && approx(el.bbox.x, 10),
        el && `got bbox.x=${el.bbox.x}`,
      );
      assert(
        'control_wh: bbox.y ~= 20',
        el && approx(el.bbox.y, 20),
        el && `got bbox.y=${el.bbox.y}`,
      );
      assert(
        'control_wh: bbox.w ~= 30',
        el && approx(el.bbox.w, 30),
        el && `got bbox.w=${el.bbox.w}`,
      );
    }

    // ── RED #4: rotate(90) — Punkt-Rotation [0 -1; 1 0] ─────────────
    // Ecken (10,20),(40,20),(10,60),(40,60) -> rotate90 (x,y)->(-y,x):
    //   (-20,10),(-20,40),(-60,10),(-60,40). AABB: xmin=-60 ymin=10
    //   xmax=-20 ymax=40 -> bbox {x:-60, y:10, w:40, h:30}.
    // Die (10,20)-Ecke landet bei (-20,10) (Briefing-Wert) = xmax/ymin.
    console.log('--- COORD-SPACE: rotate90 (RED vor Fix; AABB user-units) ---');
    {
      const { el, error, message } = await probe(page, FIXTURES.rotate90);
      assert('rotate90: target found', !!el, error && `${error}: ${message}`);
      // AABB-Ursprung (xmin, ymin) der rotierten 4 Ecken:
      assert(
        'rotate90: bbox.x ~= -60 (AABB xmin der rotierten Ecken)',
        el && approx(el.bbox.x, -60),
        el && `got bbox.x=${el.bbox.x}`,
      );
      assert(
        'rotate90: bbox.y ~= 10 (AABB ymin; = y der (10,20)->(-20,10)-Ecke)',
        el && approx(el.bbox.y, 10),
        el && `got bbox.y=${el.bbox.y}`,
      );
      assert(
        'rotate90: bbox.w ~= 40 (Hoehe wird Breite)',
        el && approx(el.bbox.w, 40),
        el && `got bbox.w=${el.bbox.w}`,
      );
      assert(
        'rotate90: bbox.h ~= 30 (Breite wird Hoehe)',
        el && approx(el.bbox.h, 30),
        el && `got bbox.h=${el.bbox.h}`,
      );
      // Die transformierte (10,20)-Ecke (Briefing-Tabellenwert) = (xmax, ymin):
      assert(
        'rotate90: (10,20)-Ecke -> (-20,10) [Briefing-Tabelle, = xmax/ymin]',
        el && approx(el.bbox.x + el.bbox.w, -20) && approx(el.bbox.y, 10),
        el && `got xmax=${el.bbox.x + el.bbox.w}, ymin=${el.bbox.y}`,
      );
    }
  } finally {
    await closeResolver();
  }

  console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error('Test-Lauf-Fehler:', e);
  process.exit(1);
});
