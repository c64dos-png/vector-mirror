/**
 * test_frozen_clock_d2.mjs — S4/D2 Frozen-Clock-Timeline (🔴 CRIT, browser-bound)
 *
 * Real-Chromium-Harness (KEINE Mocks). Deckt die 7 Honest-Red des S4/D2-Plans:
 *
 *   1) SMIL-friert-t=0 (GEOMETRIE-DOPPELBELEG): EK-5 circle cx from=30 to=170 dur=2s.
 *      Produktiv-Frame (t=0) → gemessenes Center-x ≈ 30; eine zweite, test-only
 *      Messung bei t=1.0 → Center-x ≈ 100. Beweist Clock+Frame-KOPPLUNG (die Uhr
 *      bewegt die GEMESSENE Geometrie), nicht nur getCurrentTime()===0 (F-TF-019).
 *   2) CSS-@keyframes (animationName) → not_measurable + NON_DETERMINISTIC_MOTION.
 *   3) CSS-transition (transitionProperty/Duration, eigenständiges Signal) → dito.
 *   4) script/rAF → durch S3 ELIMINIERT (FORBID script): Element am STATISCHEN Wert,
 *      sanitize_loss trägt den script-Strip, KEIN NON_DETERMINISTIC_MOTION
 *      (Ehrlichkeits-Kontrolle: eliminiert ≠ gemessen).
 *   5) statisches SVG (EK-1/2/3-Klasse) → NICHT fälschlich geflaggt (False-Positive-Guard).
 *   6) Determinismus über die Clock: EK-5 N=40 run-to-run + über RECYCLE_AFTER → 1 unique.
 *   7) EK-5-bewusst-angepasst: in der Selftest-/Determinismus-Suite (test_determinism.mjs)
 *      + __checkEk-Doppelbeleg (hier separat als Geometrie-Beleg verankert).
 *
 * Run direkt: `node tests/integration/test_frozen_clock_d2.mjs`
 */
import {
  __probeFrozenGeometryAt,
  __setRecycleAfter,
  closeResolver,
  createResolver,
  resolve,
} from '../../src/adapters/renderer/playwright.js';

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

// ── EK-5: SMIL cx-Animation (Geometrie-Doppelbeleg-Fixture) ───────────────────
const EK5_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <rect id="bg" x="0" y="0" width="200" height="200" fill="#ffffff"/>
  <circle id="anim" cx="30" cy="100" r="15" fill="#ffa500">
    <animate attributeName="cx" from="30" to="170" dur="2s" repeatCount="indefinite"/>
  </circle>
</svg>`;

// ── CSS-@keyframes: animationName !== 'none' (Signal 1) ───────────────────────
const CSS_KEYFRAMES_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <style>
    @keyframes slide { from { transform: translateX(0); } to { transform: translateX(80px); } }
    #kf { animation: slide 3s linear infinite; }
  </style>
  <rect id="kf" x="20" y="20" width="40" height="40" fill="#3366cc"/>
</svg>`;

// ── CSS-transition: transitionProperty/Duration (Signal 2, EIGENSTÄNDIG) ──────
// animationName bleibt 'none' (Probe) → der transition-Test ist separat nötig.
const CSS_TRANSITION_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <style>
    #tr { transition: transform 2s ease; }
  </style>
  <rect id="tr" x="20" y="20" width="40" height="40" fill="#cc3366"/>
</svg>`;

// ── script/rAF: durch S3 (FORBID script) ELIMINIERT ───────────────────────────
// Das <script> rAF würde cx live mutieren — S3 strippt es VOR dem Render.
// Erwartung: #sc am STATISCHEN cx=30, sanitize_loss trägt script, KEIN Flag.
const SCRIPT_RAF_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <circle id="sc" cx="30" cy="100" r="15" fill="#ffa500"/>
  <script>
    let x = 30;
    function tick() { document.getElementById('sc').setAttribute('cx', x++); requestAnimationFrame(tick); }
    requestAnimationFrame(tick);
  </script>
</svg>`;

// ── statisch (False-Positive-Guard) ───────────────────────────────────────────
const STATIC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <rect id="box" x="20" y="20" width="40" height="40" fill="#33cc66"/>
  <circle id="dot" cx="100" cy="100" r="15" fill="#ffa500"/>
</svg>`;

// ── R2-BRUCH: @keyframes auf einem <g>-ANCESTOR (Leaf-only-Detection verfehlt) ─
// Das <g id="grp"> trägt die Animation; das gemessene <circle id="child"> hat
// childAnimName='none', aber der g-Transform komponiert via userM in die
// Kind-Geometrie → ohne Ancestor-Walk wird child fälschlich 'reliable' (stiller
// Lügen-Frame). <g> ist in SKIP_TAGS → wird NIE selbst inspiziert.
const ANCESTOR_KEYFRAMES_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <style>
    @keyframes slideG { from { transform: translateX(0); } to { transform: translateX(80px); } }
    #grp { animation: slideG 2s linear infinite; }
  </style>
  <g id="grp"><circle id="child" cx="30" cy="100" r="15" fill="#ffa500"/></g>
</svg>`;

// ── R2-BRUCH: CSS-transition auf einem <g>-ANCESTOR ───────────────────────────
const ANCESTOR_TRANSITION_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <style>
    #grpT { transition: transform 2s ease; }
  </style>
  <g id="grpT"><rect id="childT" x="20" y="20" width="40" height="40" fill="#3366cc"/></g>
</svg>`;

// ── R2-ÜBER-FLAGGEN-GUARDS: statische/deterministische SVGs NICHT degradieren ──
// (a) transition mit Komma-Liste '0s, 0s' (kein transitionDuration > 0) → statisch.
const TRANSITION_COMMA_ZERO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <style>
    #cz { transition-property: transform, opacity; transition-duration: 0s, 0s; }
  </style>
  <rect id="cz" x="20" y="20" width="40" height="40" fill="#33cc66"/>
</svg>`;
// (b) animation mit dur=0s → animationName gesetzt, aber statisch (keine Motion).
const ANIMATION_ZERO_DUR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <style>
    @keyframes nope { from { transform: translateX(0); } to { transform: translateX(80px); } }
    #az { animation: nope 0s linear; }
  </style>
  <rect id="az" x="20" y="20" width="40" height="40" fill="#33cc66"/>
</svg>`;
// (c) animation-play-state: paused → keine laufende Motion → NICHT flaggen.
const ANIMATION_PAUSED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <style>
    @keyframes nope2 { from { transform: translateX(0); } to { transform: translateX(80px); } }
    #ap { animation: nope2 2s linear infinite; animation-play-state: paused; }
  </style>
  <rect id="ap" x="20" y="20" width="40" height="40" fill="#33cc66"/>
</svg>`;

const elById = (result, id) =>
  result.error ? undefined : result.elements.find((e) => e.id === id);

(async () => {
  let page;
  try {
    page = await createResolver();
  } catch (e) {
    console.error('Renderer-Init fehlgeschlagen:', e.message);
    process.exit(1);
  }

  try {
    // ── 1) SMIL-FRIERT-t=0: GEOMETRIE-DOPPELBELEG ─────────────────────────────
    console.log(
      '=== 1) SMIL friert t=0 (Geometrie-Doppelbeleg cx=30@t0 / cx≈100@t1.0) ===',
    );
    {
      const prod = await resolve(page, EK5_SVG);
      const anim = elById(prod, 'anim');
      // Produktiv-Frame friert t=0 → Center-x (bbox.x + w/2) ≈ 30.
      const cxProd = anim ? anim.bbox.x + anim.bbox.w / 2 : NaN;
      assert(
        'EK-5 #anim gefunden (Produktiv t=0)',
        !!anim,
        prod.error ? `${prod.error}: ${prod.message}` : '',
      );
      assert(
        `EK-5 Produktiv-Center-x ≈ 30 (cx=30@t0); got ${cxProd.toFixed(3)}`,
        Math.abs(cxProd - 30) < 1.0,
        `|${cxProd} - 30| >= 1.0 → Clock NICHT bei t=0 eingefroren`,
      );

      // Doppelbeleg: test-only Messung bei t=0 und t=1.0 — beweist Kopplung.
      const g0 = await __probeFrozenGeometryAt(EK5_SVG, 'anim', 0);
      const g1 = await __probeFrozenGeometryAt(EK5_SVG, 'anim', 1.0);
      assert(
        `Probe t=0: Center-x ≈ 30; got ${g0.cx?.toFixed?.(3)}`,
        g0.cx !== undefined && Math.abs(g0.cx - 30) < 1.0,
        JSON.stringify(g0),
      );
      assert(
        `Probe t=1.0: Center-x ≈ 100 (cx≈100@t1.0); got ${g1.cx?.toFixed?.(3)}`,
        g1.cx !== undefined && Math.abs(g1.cx - 100) < 2.0,
        JSON.stringify(g1),
      );
      assert(
        'KOPPLUNG: cx(t=1.0) - cx(t=0) ≈ 70 (Clock bewegt die GEMESSENE Geometrie)',
        g0.cx !== undefined &&
          g1.cx !== undefined &&
          Math.abs(g1.cx - g0.cx - 70) < 3.0,
        `delta=${(g1.cx - g0.cx)?.toFixed?.(3)}`,
      );
    }

    // ── 2) CSS-@keyframes → not_measurable + NON_DETERMINISTIC_MOTION ─────────
    console.log('\n=== 2) CSS-@keyframes (Signal animationName) → flag ===');
    {
      const r = await resolve(page, CSS_KEYFRAMES_SVG);
      const kf = elById(r, 'kf');
      assert('CSS-@keyframes #kf gefunden', !!kf, r.error ? `${r.error}` : '');
      assert(
        'CSS-@keyframes bbox_reliability === not_measurable',
        kf && kf.bbox_reliability === 'not_measurable',
        kf && `got ${JSON.stringify(kf.bbox_reliability)}`,
      );
      assert(
        'CSS-@keyframes warnings includes NON_DETERMINISTIC_MOTION',
        kf && (kf.warnings || []).includes('NON_DETERMINISTIC_MOTION'),
        kf && `got ${JSON.stringify(kf.warnings)}`,
      );
    }

    // ── 3) CSS-transition → not_measurable + NON_DETERMINISTIC_MOTION ─────────
    console.log(
      '\n=== 3) CSS-transition (Signal transitionProperty/Duration) → flag ===',
    );
    {
      const r = await resolve(page, CSS_TRANSITION_SVG);
      const tr = elById(r, 'tr');
      assert('CSS-transition #tr gefunden', !!tr, r.error ? `${r.error}` : '');
      assert(
        'CSS-transition bbox_reliability === not_measurable',
        tr && tr.bbox_reliability === 'not_measurable',
        tr && `got ${JSON.stringify(tr.bbox_reliability)}`,
      );
      assert(
        'CSS-transition warnings includes NON_DETERMINISTIC_MOTION',
        tr && (tr.warnings || []).includes('NON_DETERMINISTIC_MOTION'),
        tr && `got ${JSON.stringify(tr.warnings)}`,
      );
    }

    // ── 4) script/rAF → durch S3 eliminiert, NICHT geflaggt ───────────────────
    console.log(
      '\n=== 4) script/rAF → durch S3 eliminiert (statisch, KEIN Flag) ===',
    );
    {
      const r = await resolve(page, SCRIPT_RAF_SVG);
      const sc = elById(r, 'sc');
      assert('script-rAF #sc gefunden', !!sc, r.error ? `${r.error}` : '');
      // script wurde gestrippt → cx bleibt statisch beim Attribut-Wert 30.
      const cxSc = sc ? sc.bbox.x + sc.bbox.w / 2 : NaN;
      assert(
        `script-rAF #sc am statischen cx=30; got ${cxSc.toFixed(3)}`,
        Math.abs(cxSc - 30) < 1.0,
        `|${cxSc} - 30| >= 1.0`,
      );
      assert(
        'script-rAF: KEIN NON_DETERMINISTIC_MOTION (eliminiert ≠ gemessen)',
        sc && !(sc.warnings || []).includes('NON_DETERMINISTIC_MOTION'),
        sc && `got ${JSON.stringify(sc.warnings)}`,
      );
      assert(
        'script-rAF: sanitize_loss trägt den script-Strip (lossless-or-loud)',
        Array.isArray(r.sanitize_loss) &&
          r.sanitize_loss.some((l) => (l.tag || '').toLowerCase() === 'script'),
        `sanitize_loss=${JSON.stringify(r.sanitize_loss)}`,
      );
    }

    // ── 5) statisch → NICHT geflaggt (False-Positive-Guard) ───────────────────
    console.log(
      '\n=== 5) statisches SVG → NICHT geflaggt (False-Positive-Guard) ===',
    );
    {
      const r = await resolve(page, STATIC_SVG);
      for (const id of ['box', 'dot']) {
        const el = elById(r, id);
        assert(`statisch #${id} gefunden`, !!el, r.error ? `${r.error}` : '');
        assert(
          `statisch #${id} bbox_reliability === reliable`,
          el && el.bbox_reliability === 'reliable',
          el && `got ${JSON.stringify(el.bbox_reliability)}`,
        );
        assert(
          `statisch #${id}: KEIN NON_DETERMINISTIC_MOTION`,
          el && !(el.warnings || []).includes('NON_DETERMINISTIC_MOTION'),
          el && `got ${JSON.stringify(el.warnings)}`,
        );
      }
    }

    // ── 7) R2: Ancestor-CSS-Motion → Kind degradiert (Leaf-only-Lücke) ───────
    console.log(
      '\n=== 7) R2 Ancestor-CSS-Motion (<g>-@keyframes/transition) → Kind not_measurable ===',
    );
    {
      const rk = await resolve(page, ANCESTOR_KEYFRAMES_SVG);
      const child = elById(rk, 'child');
      assert('Ancestor-@keyframes #child gefunden', !!child, rk.error || '');
      assert(
        'Ancestor-@keyframes #child bbox_reliability === not_measurable',
        child && child.bbox_reliability === 'not_measurable',
        child && `got ${JSON.stringify(child.bbox_reliability)}`,
      );
      assert(
        'Ancestor-@keyframes #child warnings includes NON_DETERMINISTIC_MOTION',
        child && (child.warnings || []).includes('NON_DETERMINISTIC_MOTION'),
        child && `got ${JSON.stringify(child.warnings)}`,
      );

      const rt = await resolve(page, ANCESTOR_TRANSITION_SVG);
      const childT = elById(rt, 'childT');
      assert('Ancestor-transition #childT gefunden', !!childT, rt.error || '');
      assert(
        'Ancestor-transition #childT bbox_reliability === not_measurable',
        childT && childT.bbox_reliability === 'not_measurable',
        childT && `got ${JSON.stringify(childT.bbox_reliability)}`,
      );
      assert(
        'Ancestor-transition #childT warnings includes NON_DETERMINISTIC_MOTION',
        childT && (childT.warnings || []).includes('NON_DETERMINISTIC_MOTION'),
        childT && `got ${JSON.stringify(childT.warnings)}`,
      );
    }

    // ── 8) R2: ÜBER-FLAGGEN-GUARDS (statisch NICHT zu not_measurable) ─────────
    console.log(
      '\n=== 8) R2 Über-Flaggen-Guards (Komma-0s / animation-0s / paused NICHT geflaggt) ===',
    );
    {
      const cases = [
        ['cz', TRANSITION_COMMA_ZERO_SVG, "transition '0s, 0s' (Komma-Liste)"],
        ['az', ANIMATION_ZERO_DUR_SVG, 'animation dur=0s (statisch)'],
        ['ap', ANIMATION_PAUSED_SVG, 'animation-play-state: paused'],
      ];
      for (const [id, svg, label] of cases) {
        const r = await resolve(page, svg);
        const el = elById(r, id);
        assert(`Guard ${label}: #${id} gefunden`, !!el, r.error || '');
        assert(
          `Guard ${label}: #${id} NICHT not_measurable (got ${el?.bbox_reliability})`,
          el && el.bbox_reliability !== 'not_measurable',
          el && `bbox_reliability=${JSON.stringify(el.bbox_reliability)}`,
        );
        assert(
          `Guard ${label}: #${id} KEIN NON_DETERMINISTIC_MOTION`,
          el && !(el.warnings || []).includes('NON_DETERMINISTIC_MOTION'),
          el && `got ${JSON.stringify(el.warnings)}`,
        );
      }
    }

    // ── 6) Determinismus über die Clock + über RECYCLE_AFTER-Boundary ─────────
    console.log(
      '\n=== 6) Determinismus EK-5 N=40 über RECYCLE_AFTER-Boundary ===',
    );
    {
      // RECYCLE_AFTER künstlich klein → N=40 überquert die Boundary mehrfach.
      __setRecycleAfter(7);
      const seen = new Set();
      for (let i = 0; i < 40; i++) {
        const r = await resolve(page, EK5_SVG);
        const anim = elById(r, 'anim');
        seen.add(
          anim ? `${anim.bbox.x.toFixed(6)}|${anim.bbox.w.toFixed(6)}` : 'ERR',
        );
      }
      __setRecycleAfter(50); // zurücksetzen
      assert(
        `Determinismus EK-5: 40× → 1 unique (über Recycle); got ${seen.size}`,
        seen.size === 1,
        `unique=${JSON.stringify([...seen])}`,
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
