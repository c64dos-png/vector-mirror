/**
 * test_3d_detection.js - §1.2 3D-Detection Pre-Gate (Sprint-α)
 *
 * Verifiziert: Renderer (src/adapters/renderer/playwright.js) erkennt
 * 3D-Vorfahren (matrix3d / perspective / preserve-3d) via Ancestor-Walk
 * VOR el.getCTM() und markiert betroffene Elemente mit
 * bbox_reliability='not_measurable' + warnings=['3D_TRANSFORM_ANCESTOR'].
 *
 * Reine 2D-Vorfahren-Ketten liefern bbox_reliability='reliable' und keine
 * 3D_TRANSFORM_ANCESTOR-Warnung.
 *
 * Empirie-Basis: an internal spec/PREFLIGHT_EMPIRIE.md
 *   R-1: el.getCTM() ist nie null bei 3D-Vorfahre (Browser kollabiert zu 2D)
 *   R-2: Detection MUSS auf getComputedStyle().transform (Identitäts-matrix3d
 *        wird vom Browser zu matrix() kollabiert → kein False-Positive)
 *   R-3: parentElement-Walk reicht (kein Shadow-DOM in unseren SVG-Inputs)
 *   R-4: Walk bis parentElement === null (3D auf BODY/HTML wirkt auch)
 *
 * Test ist browser-bound (createResolver/resolve). Schema-Validation
 * gegen elementSchema (schema.js) ist in test_schema.js abgedeckt
 * (Felder optional registriert; existing samples bleiben valid).
 */
import {
  closeResolver,
  createResolver,
  resolve,
} from '../../src/adapters/renderer/playwright.js';

let passed = 0,
  failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

// ── Fixtures (analog preflight_empirie.mjs, plus deeper-nested und identity-3D) ──

const FIXTURES = {
  // Baseline: reines 2D, kein 3D-Vorfahre. Erwartung: reliable, keine warnings.
  control_2d: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <g id="parent" transform="translate(10,10) scale(2)">
      <rect id="probe3d" x="0" y="0" width="20" height="20" fill="red"/>
    </g>
  </svg>`,

  // Identitäts-matrix3d auf parent. Browser kollabiert zu matrix() — Empirie R-2
  // sagt: das ist semantisch korrekt (kein 3D-Effekt). Detection greift hier
  // NICHT, weil computed.transform = 'matrix(...)', nicht 'matrix3d(...)'.
  // Erwartung: reliable, keine warnings. (Stellt sicher: kein False-Positive.)
  matrix3d_identity_parent: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <g id="parent" style="transform: matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 10,10,0,1);">
      <rect id="probe3d" x="0" y="0" width="20" height="20" fill="red"/>
    </g>
  </svg>`,

  // preserve-3d + rotateY: Browser liefert non-trivial matrix3d() im computed.
  // Erwartung: not_measurable + 3D_TRANSFORM_ANCESTOR.
  preserve_3d_parent: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <g id="parent" style="transform-style: preserve-3d; transform: rotateY(45deg);">
      <rect id="probe3d" x="0" y="0" width="20" height="20" fill="red"/>
    </g>
  </svg>`,

  // perspective() + rotateY: Browser liefert matrix3d() im computed.
  // Erwartung: not_measurable + 3D_TRANSFORM_ANCESTOR.
  perspective_parent: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <g id="parent" style="transform: perspective(500px) rotateY(30deg);">
      <rect id="probe3d" x="0" y="0" width="20" height="20" fill="red"/>
    </g>
  </svg>`,

  // 3D-Effekt auf gp; parent ist 2D. Walk muss bis gp laufen, nicht beim
  // ersten 2D-Vorfahre aufhören. R-4-Belegung.
  rotateX_grandparent: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <g id="gp" style="transform: rotateX(45deg);">
      <g id="parent" transform="translate(10,10)">
        <rect id="probe3d" x="0" y="0" width="20" height="20" fill="red"/>
      </g>
    </g>
  </svg>`,

  // §1.2b L-008 Defensive-Fixture: rotateX im SVG-transform-Attribut (kein CSS-style).
  // Spec (SVG 1.1 §7.6 / SVG 2 §8.5): das transform-Attribut erlaubt nur 2D-
  // Funktionen (matrix, translate, scale, rotate, skewX, skewY). rotateX/rotateY/
  // rotateZ/matrix3d/perspective sind SVG-Attribut-grammatisch NICHT erlaubt —
  // Browser kollabiert daher zu computed.transform = 'none' (oder identitäts-matrix).
  // Detection greift korrekt NICHT (kein False-Positive). Regression-Schutz für
  // den Fall, dass ein Browser sich später permissiver verhält.
  svg_attribute_rotateX_stays_2d: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <g id="parent" transform="rotateX(45deg)">
      <rect id="probe3d" x="0" y="0" width="20" height="20" fill="red"/>
    </g>
  </svg>`,
};

async function probe(page, svg) {
  const result = await resolve(page, svg);
  if (result.error) {
    return { error: result.error, message: result.message };
  }
  const el = result.elements.find((e) => e.id === 'probe3d');
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
    // ── Negative-Probe: 2D-only ─────────────────────────────────
    console.log('--- 3D-DETECTION: control_2d (2D-only) ---');
    {
      const { el } = await probe(page, FIXTURES.control_2d);
      assert('control_2d: target found', !!el);
      assert(
        'control_2d: bbox_reliability === reliable',
        el && el.bbox_reliability === 'reliable',
        el && `got ${JSON.stringify(el.bbox_reliability)}`,
      );
      assert(
        'control_2d: warnings absent or empty',
        el &&
          (el.warnings === undefined ||
            (Array.isArray(el.warnings) && el.warnings.length === 0)),
        el && `got ${JSON.stringify(el.warnings)}`,
      );
      assert(
        'control_2d: warnings does NOT contain 3D_TRANSFORM_ANCESTOR',
        el && !(el.warnings || []).includes('3D_TRANSFORM_ANCESTOR'),
      );
    }

    // ── Negative-Probe: Identitäts-matrix3d (Browser-Kollaps zu 2D) ─────
    console.log('--- 3D-DETECTION: matrix3d_identity_parent (No-False-Positive) ---');
    {
      const { el } = await probe(page, FIXTURES.matrix3d_identity_parent);
      assert('matrix3d_identity_parent: target found', !!el);
      // Empirie R-2: Browser kollabiert Identitäts-matrix3d zu matrix() —
      // computed.transform enthält dann KEIN 'matrix3d(' mehr.
      // Detection darf NICHT False-Positive feuern.
      assert(
        'matrix3d_identity_parent: bbox_reliability === reliable (no false-positive)',
        el && el.bbox_reliability === 'reliable',
        el && `got ${JSON.stringify(el.bbox_reliability)}`,
      );
      assert(
        'matrix3d_identity_parent: NO 3D_TRANSFORM_ANCESTOR warning',
        el && !(el.warnings || []).includes('3D_TRANSFORM_ANCESTOR'),
      );
    }

    // ── Positive-Probe: preserve-3d + rotateY ───────────────────
    console.log('--- 3D-DETECTION: preserve_3d_parent ---');
    {
      const { el } = await probe(page, FIXTURES.preserve_3d_parent);
      assert('preserve_3d_parent: target found', !!el);
      assert(
        'preserve_3d_parent: bbox_reliability === not_measurable',
        el && el.bbox_reliability === 'not_measurable',
        el && `got ${JSON.stringify(el.bbox_reliability)}`,
      );
      assert(
        'preserve_3d_parent: warnings includes 3D_TRANSFORM_ANCESTOR',
        el && (el.warnings || []).includes('3D_TRANSFORM_ANCESTOR'),
        el && `got ${JSON.stringify(el.warnings)}`,
      );
    }

    // ── Positive-Probe: perspective + rotateY ───────────────────
    console.log('--- 3D-DETECTION: perspective_parent ---');
    {
      const { el } = await probe(page, FIXTURES.perspective_parent);
      assert('perspective_parent: target found', !!el);
      assert(
        'perspective_parent: bbox_reliability === not_measurable',
        el && el.bbox_reliability === 'not_measurable',
        el && `got ${JSON.stringify(el.bbox_reliability)}`,
      );
      assert(
        'perspective_parent: warnings includes 3D_TRANSFORM_ANCESTOR',
        el && (el.warnings || []).includes('3D_TRANSFORM_ANCESTOR'),
        el && `got ${JSON.stringify(el.warnings)}`,
      );
    }

    // ── Positive-Probe: rotateX am Großvater (Walk-Tiefe) ───────
    console.log('--- 3D-DETECTION: rotateX_grandparent (R-4 walk depth) ---');
    {
      const { el } = await probe(page, FIXTURES.rotateX_grandparent);
      assert('rotateX_grandparent: target found', !!el);
      assert(
        'rotateX_grandparent: bbox_reliability === not_measurable (walk reaches gp)',
        el && el.bbox_reliability === 'not_measurable',
        el && `got ${JSON.stringify(el.bbox_reliability)}`,
      );
      assert(
        'rotateX_grandparent: warnings includes 3D_TRANSFORM_ANCESTOR',
        el && (el.warnings || []).includes('3D_TRANSFORM_ANCESTOR'),
        el && `got ${JSON.stringify(el.warnings)}`,
      );
    }

    // ── Defensive-Probe: SVG-Attribut rotateX bleibt 2D (§1.2b L-008) ──────
    // SVG-Attribut-Grammatik erlaubt nur 2D-Funktionen — rotateX im transform-
    // Attribut (kein style=) ist ungültig, Browser kollabiert zu non-3D
    // computed.transform. Detection darf NICHT False-Positive feuern.
    console.log('--- 3D-DETECTION: svg_attribute_rotateX_stays_2d (L-008 Defensive) ---');
    {
      const { el } = await probe(page, FIXTURES.svg_attribute_rotateX_stays_2d);
      assert('svg_attribute_rotateX_stays_2d: target found', !!el);
      assert(
        'svg_attribute_rotateX_stays_2d: bbox_reliability === reliable (no false-positive)',
        el && el.bbox_reliability === 'reliable',
        el && `got ${JSON.stringify(el.bbox_reliability)}`,
      );
      assert(
        'svg_attribute_rotateX_stays_2d: warnings absent or empty',
        el &&
          (el.warnings === undefined ||
            (Array.isArray(el.warnings) && el.warnings.length === 0)),
        el && `got ${JSON.stringify(el.warnings)}`,
      );
      assert(
        'svg_attribute_rotateX_stays_2d: warnings does NOT contain 3D_TRANSFORM_ANCESTOR',
        el && !(el.warnings || []).includes('3D_TRANSFORM_ANCESTOR'),
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
