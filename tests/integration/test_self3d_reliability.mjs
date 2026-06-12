/**
 * test_self3d_reliability.mjs — C2 Self-3D Reliability (🔴 CRIT, browser-bound)
 *
 * Honesty-Gate Schritt 2a. Real-Chromium-Harness (KEINE Mocks).
 *
 * ZIEL: Ein 3D-Transform DIREKT AUF einem Element (rotateX/Y, rotate3d,
 * perspective, transform-style:preserve-3d) muss als 'not_measurable'
 * klassifiziert werden — NICHT (faelschlich) 'reliable'. Der bestehende
 * isAncestor3D-Walk (playwright.js) prueft NUR Vorfahren; ein Element mit
 * Self-3D faellt durch und bekommt den 'reliable'-Default → das
 * allowDeltas-Gate (structured.js:359) greift NICHT → analyze() emittiert
 * eine SCHAEDLICHE Pixel-Korrektur auf 3D-verzerrter Geometrie (Defekt 6).
 *
 * Drei Beweis-Ebenen:
 *   1) SELF-3D-SWEEP (Renderer-direkt): alle genuinen Self-3D-Formen →
 *      bbox_reliability='not_measurable' + warnings enthaelt
 *      '3D_TRANSFORM_ANCESTOR' (gleiche 3D-Warnung wie der Ancestor-Fall).
 *   2) NEGATIV-KONTROLLE: rotateZ45 (echtes 2D) bleibt 'approximate'
 *      (KEIN False-Positive); reiner translate bleibt 'approximate'
 *      (CSS-transform-Drift, unveraendert).
 *   3) DEFEKT-6-BELEG (analyze()-Pfad): ein verletztes CENTERED-IN auf einem
 *      Self-3D-Element → die correction traegt KEINE dx/dy/dw/dh/fix/fixes,
 *      weil reliability != 'reliable' das Gate suppress.
 *
 * Run direkt: `node tests/integration/test_self3d_reliability.mjs`
 */
import {
  closeResolver,
  createResolver,
  resolve,
} from '../../src/adapters/renderer/playwright.js';
import { analyze, shutdown } from '../../src/pipeline.js';

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

// ── SELF-3D SWEEP: genuine 3D-Transform DIREKT auf dem Target #probe ──────────
// Jede Form muss not_measurable ergeben. transform-origin-Variante eingeschlossen
// (Origin darf die 3D-Natur nicht maskieren). Alle als CSS-style (SVG-transform-
// Attribut erlaubt grammatisch nur 2D — siehe Negativ-Kontrolle).
const SELF3D_FIXTURES = {
  self_rotateY_89: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <rect id="probe" x="20" y="20" width="40" height="40" fill="red"
          style="transform: rotateY(89deg);"/>
  </svg>`,

  self_rotateX_60: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <rect id="probe" x="20" y="20" width="40" height="40" fill="red"
          style="transform: rotateX(60deg);"/>
  </svg>`,

  self_rotate3d: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <rect id="probe" x="20" y="20" width="40" height="40" fill="red"
          style="transform: rotate3d(1, 1, 0, 45deg);"/>
  </svg>`,

  self_perspective: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <rect id="probe" x="20" y="20" width="40" height="40" fill="red"
          style="transform: perspective(400px) rotateY(30deg);"/>
  </svg>`,

  self_preserve3d: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <rect id="probe" x="20" y="20" width="40" height="40" fill="red"
          style="transform-style: preserve-3d; transform: rotateY(45deg);"/>
  </svg>`,

  // transform-origin gesetzt: darf die 3D-Detektion NICHT unterlaufen.
  self_rotateY_with_origin: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <rect id="probe" x="20" y="20" width="40" height="40" fill="red"
          style="transform: rotateY(70deg); transform-origin: 40px 40px;"/>
  </svg>`,
};

// ── NEGATIV-KONTROLLE: echtes 2D darf NICHT als 3D durchgehen ─────────────────
const NEGATIVE_FIXTURES = {
  // rotateZ ist echtes 2D (Browser kollabiert zu matrix()) → 'approximate'.
  self_rotateZ_45: {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
      <rect id="probe" x="20" y="20" width="40" height="40" fill="red"
            style="transform: rotateZ(45deg);"/>
    </svg>`,
    expectReliability: 'approximate',
  },
  // reiner translate: CSS-transform-Drift → 'approximate' (unveraendert).
  self_translate: {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
      <rect id="probe" x="20" y="20" width="40" height="40" fill="red"
            style="transform: translate(10px, 10px);"/>
    </svg>`,
    expectReliability: 'approximate',
  },
  // kein transform: reliable (Default).
  self_none: {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
      <rect id="probe" x="20" y="20" width="40" height="40" fill="red"/>
    </svg>`,
    expectReliability: 'reliable',
  },
};

// ── DEFEKT-6-BELEG: analyze() darf auf Self-3D KEINE dx/dy emittieren ─────────
// #box3d traegt rotateY(89deg) DIREKT; #flat ist 2D-Referenz. Constraint
// CENTERED-IN ist verletzt (box3d-Center != flat-Center) → ohne korrekte
// reliability wuerde die correction dx/dy/dw/dh/fix tragen (Defekt 6).
const DEFEKT6_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <rect id="flat" x="20" y="20" width="40" height="40" fill="#ff0000"/>
  <rect id="box3d" x="100" y="100" width="40" height="40" fill="#0000ff"
        style="transform: rotateY(89deg);"/>
</svg>`;
const DEFEKT6_CONSTRAINT = '#box3d CENTERED-IN #flat';
const FORBIDDEN_KEYS = ['dx', 'dy', 'dw', 'dh', 'fix', 'fixes'];

async function probe(page, svg) {
  const result = await resolve(page, svg);
  if (result.error) return { error: result.error, message: result.message };
  const el = result.elements.find((e) => e.id === 'probe');
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
    // ── 1) SELF-3D SWEEP ──────────────────────────────────────────────────
    console.log('=== SELF-3D SWEEP (alle → not_measurable + 3D-Warnung) ===');
    for (const [name, svg] of Object.entries(SELF3D_FIXTURES)) {
      const { el, error, message } = await probe(page, svg);
      assert(
        `${name}: target found`,
        !!el,
        error ? `${error}: ${message}` : '',
      );
      assert(
        `${name}: bbox_reliability === not_measurable`,
        el && el.bbox_reliability === 'not_measurable',
        el && `got ${JSON.stringify(el.bbox_reliability)}`,
      );
      assert(
        `${name}: warnings includes 3D_TRANSFORM_ANCESTOR`,
        el && (el.warnings || []).includes('3D_TRANSFORM_ANCESTOR'),
        el && `got ${JSON.stringify(el.warnings)}`,
      );
    }

    // ── 2) NEGATIV-KONTROLLE ──────────────────────────────────────────────
    console.log('\n=== NEGATIV-KONTROLLE (kein False-Positive) ===');
    for (const [name, fx] of Object.entries(NEGATIVE_FIXTURES)) {
      const { el, error, message } = await probe(page, fx.svg);
      assert(
        `${name}: target found`,
        !!el,
        error ? `${error}: ${message}` : '',
      );
      assert(
        `${name}: bbox_reliability === ${fx.expectReliability}`,
        el && el.bbox_reliability === fx.expectReliability,
        el && `got ${JSON.stringify(el.bbox_reliability)}`,
      );
      assert(
        `${name}: NO 3D_TRANSFORM_ANCESTOR warning`,
        el && !(el.warnings || []).includes('3D_TRANSFORM_ANCESTOR'),
        el && `got ${JSON.stringify(el.warnings)}`,
      );
    }
  } finally {
    await closeResolver();
  }

  // ── 3) DEFEKT-6-BELEG (analyze()-Pfad) ──────────────────────────────────
  // analyze() nutzt seinen eigenen Renderer-Lifecycle (init/shutdown der
  // pipeline). closeResolver oben hat den Sweep-Browser geschlossen; analyze
  // initialisiert lazy einen frischen.
  console.log('\n=== DEFEKT-6-BELEG (analyze → keine dx/dy auf Self-3D) ===');
  try {
    const { structured } = await analyze(DEFEKT6_SVG, [DEFEKT6_CONSTRAINT]);
    assert('analyze: structured vorhanden', !!structured);
    const box3dEl = structured?.scene?.elements?.find((e) => e.id === 'box3d');
    assert('analyze: box3d in scene', !!box3dEl);
    assert(
      'analyze: box3d.bbox_reliability === not_measurable',
      box3dEl && box3dEl.bbox_reliability === 'not_measurable',
      box3dEl && `got ${JSON.stringify(box3dEl?.bbox_reliability)}`,
    );
    const corr = structured?.corrections?.find((c) => c.element === '#box3d');
    assert(
      'analyze: correction fuer #box3d existiert (constraint geprueft)',
      !!corr,
      `corrections=${JSON.stringify(structured?.corrections)}`,
    );
    if (corr) {
      for (const k of FORBIDDEN_KEYS) {
        assert(
          `analyze: correction[#box3d] traegt KEIN '${k}' (Defekt-6 suppress)`,
          corr[k] === undefined,
          `got ${k}=${JSON.stringify(corr[k])}`,
        );
      }
    }
  } finally {
    await shutdown();
  }

  console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error('Test-Lauf-Fehler:', e);
  process.exit(1);
});
