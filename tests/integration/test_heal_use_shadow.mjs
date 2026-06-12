/**
 * test_heal_use_shadow.mjs — Heal 6 „use-Shadow-Detektion" (F-AT-8-02 / D-024)
 *
 * Real-Chromium-Harness (KEINE Mocks), Stil nach test_heal_zeroarea.
 * Spec: docs/internal/an internal spec.
 * Boden-Wahrheit: an internal ground-truth probe
 * probe-h1-use-shadow-3d-motion.mjs (c5b3f9e).
 *
 * DIE LÜGE (vorher): beide Self-or-Ancestor-Walks (isSelfOrAncestor3D /
 * isSelfOrAncestorNonSmilMotion) springen nie über die use-Grenze; die
 * Heal-5-Propagation deckt nur clock-rooted SMIL. Eine use-Instanz mit
 * CSS/WAAPI-animiertem oder 3D-transformiertem Shadow-Inhalt blieb
 * bbox_reliability:'reliable' OHNE Warnung — bei beweisbar instabiler Zahl
 * (Boden-Wahrheit c5b3f9e: prozess-differierende reliable-Zahl 121.33 vs 120).
 *
 * DIE HEILUNG (Ergebnis-Propagation, 4. Wiederholung des Musters T3a/I2/Heal-5):
 * Detektor-Treffer des Def-Lichtbaums (nonSmilMotionSet / threeDSet) via
 * propagateUseGraph-Fixpunkt auf die Instanzen heben; OR-Terme an den EINZIGEN
 * Call-Sites is3D / hasNonSmilMotion; KB3-Schwester: motionExcluded im
 * Mess-Walk (MEASURE_WALK_FN) erhält denselben use-Graph-Lift.
 *
 * EMPIRIE-ANKER (E1/E2, an internal session artifact, je 2× stabil):
 *   E1: getComputedStyle().transform am NICHT-gerenderten <symbol>-Kind liefert
 *       die RESOLVED matrix3d-/matrix-Form (KEIN Keyword; rotateX(60deg) →
 *       'matrix3d(…)', rotate(45deg) → 'matrix(…)') → der Set-Scan nutzt den
 *       WALK-IDENTISCHEN Per-Knoten-Check, kein keyword-Sonderpfad nötig.
 *   E2: animationName/PlayState/Duration am Def-Knoten sind auch für
 *       STYLESHEET-Selektoren faithful (drift/2s/running; paused korrekt);
 *       el.getAnimations() liefert die laufende CSSAnimation auch am Def-Knoten.
 *
 * NEGATIV-VERTRAG (byte-identisch zu HEAD 3a1410f, Kanons unten eingebettet):
 *   ustat (statisches Symbol) · d3d/danim (Direkt-Fälle, waren schon ehrlich;
 *   danim-bbox.x/w wall-clock-volatil → maskiert verglichen) · u2d (2D-rotate
 *   im Shadow ⇒ KEIN 3D-Flag) · use→use-Zyklus terminiert (Emissions-Menge
 *   unverändert) · manchor bleibt motionExcluded:false (kein Über-Ausschluss).
 *
 * R9: 2× inspect byte-identisch (statisches 3D-Shadow-Fixture; NICHT analyze —
 * D-028 analysisId-randomUUID).
 *
 * Run direkt: `node tests/integration/test_heal_use_shadow.mjs`
 */
import {
  __measureAtViewports,
  __measureStaticMediaParityCheck,
  closeResolver,
  createResolver,
  measureViewportDivergence,
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
  if (v === undefined) return 'null';
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
  const s = JSON.stringify(v);
  return s === undefined ? 'null' : s;
}

function byId(elements, id) {
  return (elements || []).find((e) => e.id === id);
}

function warnCount(el, w) {
  return (el?.warnings || []).filter((x) => x === w).length;
}

// Wall-Clock-volatile bbox-Komponenten (laufende CSS-Animation drückt
// translateX in x; Float-Rauschen in w) maskieren — der REST muss byte-gleich
// zum HEAD-Kanon sein.
function maskWallClock(el) {
  if (!el || !el.bbox) return el;
  return { ...el, bbox: { ...el.bbox, x: 'WALLCLOCK', w: 'WALLCLOCK' } };
}

const VB =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 110" width="320" height="110"';

// ── F1 KERN (probe-h1-Spiegel): direkt vs use-Shadow, 3D + CSS-Motion + statisch ──
const SVG_SHADOW = `<svg ${VB}>
  <style>@keyframes drift{from{transform:translateX(0px)}to{transform:translateX(40px)}}</style>
  <defs>
    <symbol id="sym3d"><rect x="0" y="10" width="40" height="40" fill="red" style="transform: rotateX(60deg)"/></symbol>
    <symbol id="symAnim"><rect x="0" y="60" width="30" height="30" fill="blue" style="animation: drift 2s linear infinite"/></symbol>
    <symbol id="symStat"><rect x="0" y="60" width="30" height="30" fill="green"/></symbol>
  </defs>
  <rect id="d3d" x="10" y="10" width="40" height="40" fill="purple" style="transform: rotateX(60deg)"/>
  <use id="u3d" href="#sym3d" x="80"/>
  <rect id="danim" x="10" y="60" width="30" height="30" fill="orange" style="animation: drift 2s linear infinite"/>
  <use id="uanim" href="#symAnim" x="120"/>
  <use id="ustat" href="#symStat" x="240"/>
</svg>`;

// ── F1b STYLESHEET-SELEKTOR-Quelle (E2): Animation via <style>#id{…}, nicht
// style-Attribut — die Detektion MUSS beide Quellen tragen. ──────────────────
const SVG_SHADOW_CSS = `<svg ${VB}>
  <style>@keyframes drift{from{transform:translateX(0px)}to{transform:translateX(40px)}} #animTarget{animation: drift 2s linear infinite}</style>
  <defs>
    <symbol id="symAnimCss"><rect id="animTarget" x="0" y="60" width="30" height="30" fill="blue"/></symbol>
  </defs>
  <use id="uanimcss" href="#symAnimCss" x="120"/>
  <rect id="anchorcss" x="0" y="0" width="5" height="5" fill="gray"/>
</svg>`;

// ── F1c 3D-PRÄDIKAT-ÄSTE im Shadow (E1-Pinning je Ast, Finishing R2b):
// perspective(…) · transform-style:preserve-3d (Container im Symbol) ·
// rotate3d(…) — jeder Ast des Per-Knoten-Prädikats MUSS die Instanz flaggen. ──
const SVG_3D_BRANCHES = `<svg ${VB}>
  <defs>
    <symbol id="symPersp"><rect x="0" y="0" width="20" height="20" fill="red" style="transform: perspective(100px)"/></symbol>
    <symbol id="symPres"><g style="transform-style: preserve-3d"><rect x="0" y="0" width="20" height="20" fill="blue"/></g></symbol>
    <symbol id="symRot3d"><rect x="0" y="0" width="20" height="20" fill="green" style="transform: rotate3d(1,0,0,60deg)"/></symbol>
  </defs>
  <use id="upersp" href="#symPersp" x="10" y="10"/>
  <use id="upres" href="#symPres" x="80" y="10"/>
  <use id="urot3d" href="#symRot3d" x="150" y="10"/>
  <rect id="anchor3db" x="0" y="90" width="5" height="5" fill="gray"/>
</svg>`;

// ── F2 NEGATIV: 2D-rotate im Shadow darf NIE 3D-flaggen (Spec-Negativ-Pflicht) ──
const SVG_2D = `<svg ${VB}>
  <defs>
    <symbol id="sym2d"><rect x="0" y="10" width="40" height="40" fill="red" style="transform: rotate(45deg)"/></symbol>
  </defs>
  <use id="u2d" href="#sym2d" x="80"/>
  <rect id="anchor2d" x="0" y="0" width="5" height="5" fill="gray"/>
</svg>`;

// ── F3 NESTED: use → symbol → use → animiertes Symbol (Fixpunkt über 2 Stufen) ──
const SVG_NESTED = `<svg ${VB}>
  <style>@keyframes drift{from{transform:translateX(0px)}to{transform:translateX(40px)}}</style>
  <defs>
    <symbol id="symAnimN"><rect x="0" y="0" width="30" height="30" fill="blue" style="animation: drift 2s linear infinite"/></symbol>
    <symbol id="symMid"><use href="#symAnimN"/></symbol>
  </defs>
  <use id="unested" href="#symMid" x="10" y="10"/>
  <rect id="anchorn" x="0" y="80" width="5" height="5" fill="gray"/>
</svg>`;

// ── F4 ZYKLUS: use→use-Zyklen (symbol-vermittelt UND Light-DOM-direkt) MÜSSEN
// terminieren; Emissions-Menge bleibt exakt wie HEAD (nur anchorc). ───────────
const SVG_CYCLE = `<svg ${VB}>
  <defs>
    <symbol id="cs1"><use href="#cs2"/></symbol>
    <symbol id="cs2"><use href="#cs1"/></symbol>
  </defs>
  <use id="ucyc" href="#cs1" x="10" y="10"/>
  <use id="ua" href="#ub" x="60" y="10"/>
  <use id="ub" href="#ua" x="90" y="10"/>
  <rect id="anchorc" x="0" y="80" width="5" height="5" fill="gray"/>
</svg>`;

// ── F4b R1-NEGATIV (Adversarial F1, Finishing R2a): KIND eines animierten/3D-
// Containers als use-Ziel — der use-Klon enthält den Container NICHT (SVG2
// §5.6: geklont wird NUR der referenzierte Subtree), die Instanz-bbox ist
// byte-stabil ⇒ Instanz MUSS reliable + flag-frei bleiben (@HEAD korrekt).
// Die Direkt-Kinder selbst bleiben via Walk ehrlich not_measurable (Kontrolle).
// Tötet die Nachfahren-Wiedereinführungs-Mutante in den Set-Scans. ───────────
const SVG_INNER = `<svg ${VB}>
  <style>@keyframes drift{from{transform:translateX(0px)}to{transform:translateX(40px)}}</style>
  <g style="animation: drift 2s linear infinite">
    <rect id="innerAnim" x="10" y="10" width="20" height="20" fill="red"/>
  </g>
  <g style="transform: rotateX(60deg)">
    <rect id="inner3d" x="10" y="60" width="20" height="20" fill="blue"/>
  </g>
  <use id="uinnerAnim" href="#innerAnim" x="120"/>
  <use id="uinner3d" href="#inner3d" x="180"/>
</svg>`;

// ── F5 KB3: use-Shadow-CSS-Animation mit hoher Drift-Geschwindigkeit
// (1000 px/s — jede Pass-Lücke > ε_geom erzeugt Wall-Clock-Divergenz). Der
// Mess-Detektor darf daraus NIE ein media-Falsch-Flag machen: motionExcluded
// MUSS am use-Record greifen (use-Graph-Lift im MEASURE_WALK_FN). ─────────────
const SVG_KB3 = `<svg ${VB}>
  <style>@keyframes mdrift{from{transform:translateX(0px)}to{transform:translateX(100000px)}}</style>
  <defs>
    <symbol id="symFast"><rect x="0" y="0" width="30" height="30" fill="blue" style="animation: mdrift 100s linear infinite"/></symbol>
  </defs>
  <use id="um" href="#symFast" x="10" y="10"/>
  <rect id="manchor" x="0" y="80" width="10" height="10" fill="gray"/>
</svg>`;

// ── F5b KB3-STYLESHEET-SELEKTOR (Finishing R2c): Symbol-Animation via
// <style>-Selektor (NICHT style-Attribut) — der getAnimations-Scan im
// MEASURE_WALK_FN MUSS auch diese Quelle am Def-Knoten sehen (E2-Befund). ─────
const SVG_KB3_CSS = `<svg ${VB}>
  <style>@keyframes mdrift2{from{transform:translateX(0px)}to{transform:translateX(100000px)}} #fastTarget{animation: mdrift2 100s linear infinite}</style>
  <defs>
    <symbol id="symFastCss"><rect id="fastTarget" x="0" y="0" width="30" height="30" fill="blue"/></symbol>
  </defs>
  <use id="umcss" href="#symFastCss" x="10" y="10"/>
  <rect id="manchor2" x="0" y="80" width="10" height="10" fill="gray"/>
</svg>`;

// ── F6 R9: statisches 3D-Shadow-Fixture (KEINE laufende Animation → byte-stabil) ──
const SVG_R9 = `<svg ${VB}>
  <defs>
    <symbol id="sym3d"><rect x="0" y="10" width="40" height="40" fill="red" style="transform: rotateX(60deg)"/></symbol>
    <symbol id="symStat"><rect x="0" y="60" width="30" height="30" fill="green"/></symbol>
  </defs>
  <rect id="d3d" x="10" y="10" width="40" height="40" fill="purple" style="transform: rotateX(60deg)"/>
  <use id="u3d" href="#sym3d" x="80"/>
  <use id="ustat" href="#symStat" x="240"/>
</svg>`;

// ── HEAD-KANONS (3a1410f, VOR dem Bau erzeugt: an internal session artifact
// gen_canons_head_run{1,2}.log — 2× verifiziert deterministisch). Diese Records
// dürfen sich durch Heal 6 um KEIN Byte ändern. ───────────────────────────────
const HEAD_USTAT =
  '{"bbox":{"h":30,"w":30,"x":240,"y":60},"bbox_reliability":"reliable","fill":"indeterminate","id":"ustat","opacity":1,"parent_id":null,"parent_tag":"svg","stroke":"indeterminate","tag":"use","textContent":null,"transform":null,"warnings":["USE_FILL_INDETERMINATE"]}';
const HEAD_D3D =
  '{"bbox":{"h":20,"w":40,"x":10,"y":5},"bbox_reliability":"not_measurable","fill":"rgb(128, 0, 128)","id":"d3d","opacity":1,"parent_id":null,"parent_tag":"svg","stroke":"none","tag":"rect","textContent":null,"transform":null,"warnings":["3D_TRANSFORM_ANCESTOR"]}';
const HEAD_DANIM_MASKED =
  '{"bbox":{"h":30,"w":"WALLCLOCK","x":"WALLCLOCK","y":60},"bbox_reliability":"not_measurable","fill":"rgb(255, 165, 0)","id":"danim","opacity":1,"parent_id":null,"parent_tag":"svg","stroke":"none","tag":"rect","textContent":null,"transform":null,"warnings":["NON_DETERMINISTIC_MOTION"]}';
const HEAD_U2D =
  '{"bbox":{"h":56.56854248046875,"w":56.56854248046875,"x":44.64466094970703,"y":7.071067810058594},"bbox_reliability":"reliable","fill":"indeterminate","id":"u2d","opacity":1,"parent_id":null,"parent_tag":"svg","stroke":"indeterminate","tag":"use","textContent":null,"transform":null,"warnings":["USE_FILL_INDETERMINATE"]}';
const HEAD_ANCHOR2D =
  '{"bbox":{"h":5,"w":5,"x":0,"y":0},"bbox_reliability":"reliable","fill":"rgb(128, 128, 128)","id":"anchor2d","opacity":1,"parent_id":null,"parent_tag":"svg","stroke":"none","tag":"rect","textContent":null,"transform":null}';
const HEAD_ANCHORN =
  '{"bbox":{"h":5,"w":5,"x":0,"y":80},"bbox_reliability":"reliable","fill":"rgb(128, 128, 128)","id":"anchorn","opacity":1,"parent_id":null,"parent_tag":"svg","stroke":"none","tag":"rect","textContent":null,"transform":null}';
const HEAD_ANCHORC =
  '{"bbox":{"h":5,"w":5,"x":0,"y":80},"bbox_reliability":"reliable","fill":"rgb(128, 128, 128)","id":"anchorc","opacity":1,"parent_id":null,"parent_tag":"svg","stroke":"none","tag":"rect","textContent":null,"transform":null}';

(async () => {
  let page;
  try {
    page = await createResolver();
  } catch (e) {
    console.error('Renderer-Init fehlgeschlagen:', e.message);
    process.exit(1);
  }

  try {
    // ════ BEWEIS-PFLICHT 1 (Rot-vor-Bau): die use-Instanz MUSS die Wahrheit
    //      ihres Shadow-Inhalts tragen ════
    console.log('=== P1: use-Shadow-Motion/3D ⇒ not_measurable + Warnung ===');
    const r1 = await resolve(page, SVG_SHADOW);
    const uanim = byId(r1.elements, 'uanim');
    const u3d = byId(r1.elements, 'u3d');
    const ustat = byId(r1.elements, 'ustat');
    const d3d = byId(r1.elements, 'd3d');
    const danim = byId(r1.elements, 'danim');

    assert('uanim emittiert', !!uanim);
    assert(
      "uanim: bbox_reliability === 'not_measurable' (CSS-animierter Shadow)",
      uanim?.bbox_reliability === 'not_measurable',
      `got ${JSON.stringify(uanim?.bbox_reliability)}`,
    );
    assert(
      'uanim: GENAU 1× NON_DETERMINISTIC_MOTION',
      warnCount(uanim, 'NON_DETERMINISTIC_MOTION') === 1,
      `warnings=${JSON.stringify(uanim?.warnings)}`,
    );
    assert(
      "uanim: warnings exakt ['NON_DETERMINISTIC_MOTION','USE_FILL_INDETERMINATE'] (Append, kein Clobber)",
      canon(uanim?.warnings) ===
        '["NON_DETERMINISTIC_MOTION","USE_FILL_INDETERMINATE"]',
      `warnings=${JSON.stringify(uanim?.warnings)}`,
    );
    assert(
      'uanim: KEIN 3D-Flag (Achsen getrennt)',
      warnCount(uanim, '3D_TRANSFORM_ANCESTOR') === 0,
      `warnings=${JSON.stringify(uanim?.warnings)}`,
    );
    assert(
      'uanim: motion_dependent bleibt ABSENT (CSS ≠ SMIL-Zeit-Achse, Heal-5 unberührt)',
      uanim?.motion_dependent === undefined,
      `got ${JSON.stringify(uanim?.motion_dependent)}`,
    );

    assert('u3d emittiert', !!u3d);
    assert(
      "u3d: bbox_reliability === 'not_measurable' (3D-transformierter Shadow)",
      u3d?.bbox_reliability === 'not_measurable',
      `got ${JSON.stringify(u3d?.bbox_reliability)}`,
    );
    assert(
      'u3d: GENAU 1× 3D_TRANSFORM_ANCESTOR',
      warnCount(u3d, '3D_TRANSFORM_ANCESTOR') === 1,
      `warnings=${JSON.stringify(u3d?.warnings)}`,
    );
    assert(
      "u3d: warnings exakt ['3D_TRANSFORM_ANCESTOR','USE_FILL_INDETERMINATE']",
      canon(u3d?.warnings) ===
        '["3D_TRANSFORM_ANCESTOR","USE_FILL_INDETERMINATE"]',
      `warnings=${JSON.stringify(u3d?.warnings)}`,
    );
    assert(
      'u3d: KEIN Motion-Flag (Achsen getrennt)',
      warnCount(u3d, 'NON_DETERMINISTIC_MOTION') === 0,
      `warnings=${JSON.stringify(u3d?.warnings)}`,
    );
    assert(
      'u3d: bbox byte-unverändert [80,5,40,20] (Flag, KEIN Geometrie-Edit)',
      !!u3d?.bbox &&
        u3d.bbox.x === 80 &&
        u3d.bbox.y === 5 &&
        u3d.bbox.w === 40 &&
        u3d.bbox.h === 20,
      `bbox=${JSON.stringify(u3d?.bbox)}`,
    );

    console.log('\n=== P1b: Stylesheet-Selektor-Quelle (E2) trägt ebenso ===');
    const r1b = await resolve(page, SVG_SHADOW_CSS);
    const uanimcss = byId(r1b.elements, 'uanimcss');
    assert(
      "uanimcss: bbox_reliability === 'not_measurable' (<style>#id{animation:…})",
      uanimcss?.bbox_reliability === 'not_measurable',
      `got ${JSON.stringify(uanimcss?.bbox_reliability)}`,
    );
    assert(
      'uanimcss: GENAU 1× NON_DETERMINISTIC_MOTION',
      warnCount(uanimcss, 'NON_DETERMINISTIC_MOTION') === 1,
      `warnings=${JSON.stringify(uanimcss?.warnings)}`,
    );

    console.log('\n=== P1c: 3D-Prädikat-Äste im Shadow (E1-Pinning je Ast) ===');
    const r1c = await resolve(page, SVG_3D_BRANCHES);
    for (const [id, label] of [
      ['upersp', 'perspective(100px)'],
      ['upres', 'transform-style:preserve-3d (Container im Symbol)'],
      ['urot3d', 'rotate3d(1,0,0,60deg)'],
    ]) {
      const e = byId(r1c.elements, id);
      assert(
        `${id} (${label}): not_measurable + GENAU 1× 3D_TRANSFORM_ANCESTOR`,
        e?.bbox_reliability === 'not_measurable' &&
          warnCount(e, '3D_TRANSFORM_ANCESTOR') === 1,
        `rel=${JSON.stringify(e?.bbox_reliability)} warnings=${JSON.stringify(e?.warnings)}`,
      );
    }
    assert(
      'anchor3db: reliable, flag-frei (Kontrolle)',
      byId(r1c.elements, 'anchor3db')?.bbox_reliability === 'reliable' &&
        !byId(r1c.elements, 'anchor3db')?.warnings,
      `got ${canon(byId(r1c.elements, 'anchor3db'))}`,
    );

    // ════ BEWEIS-PFLICHT 2 (Negativ-Vertrag): byte-identisch zu HEAD ════
    console.log('\n=== P2: Negativ-Vertrag — byte-identisch zu HEAD 3a1410f ===');
    assert(
      'ustat (statisches Symbol): Record byte-identisch zu HEAD',
      canon(ustat) === HEAD_USTAT,
      `got ${canon(ustat)}`,
    );
    assert(
      'd3d (Direkt-3D, war ehrlich): Record byte-identisch zu HEAD',
      canon(d3d) === HEAD_D3D,
      `got ${canon(d3d)}`,
    );
    assert(
      'danim (Direkt-Motion, war ehrlich): Record byte-identisch zu HEAD (bbox.x/w wall-clock-maskiert)',
      canon(maskWallClock(danim)) === HEAD_DANIM_MASKED,
      `got ${canon(maskWallClock(danim))}`,
    );
    assert(
      'danim: bbox-Plausibilität (y=60, h=30, x∈[10,55])',
      !!danim?.bbox &&
        danim.bbox.y === 60 &&
        danim.bbox.h === 30 &&
        danim.bbox.x >= 10 &&
        danim.bbox.x <= 55,
      `bbox=${JSON.stringify(danim?.bbox)}`,
    );

    const r2 = await resolve(page, SVG_2D);
    const u2d = byId(r2.elements, 'u2d');
    assert(
      'u2d (2D-rotate im Shadow): KEIN 3D-Flag, NICHT not_measurable',
      warnCount(u2d, '3D_TRANSFORM_ANCESTOR') === 0 &&
        warnCount(u2d, 'NON_DETERMINISTIC_MOTION') === 0 &&
        u2d?.bbox_reliability !== 'not_measurable',
      `rel=${JSON.stringify(u2d?.bbox_reliability)} warnings=${JSON.stringify(u2d?.warnings)}`,
    );
    assert(
      'u2d: Record byte-identisch zu HEAD',
      canon(u2d) === HEAD_U2D,
      `got ${canon(u2d)}`,
    );
    assert(
      'anchor2d: Record byte-identisch zu HEAD',
      canon(byId(r2.elements, 'anchor2d')) === HEAD_ANCHOR2D,
      `got ${canon(byId(r2.elements, 'anchor2d'))}`,
    );

    console.log('\n=== P2b: nested-use auf animiertes Ziel ⇒ Flag (Fixpunkt) ===');
    const r3 = await resolve(page, SVG_NESTED);
    const unested = byId(r3.elements, 'unested');
    assert(
      "unested (use→symbol→use→animiertes Symbol): 'not_measurable'",
      unested?.bbox_reliability === 'not_measurable',
      `got ${JSON.stringify(unested?.bbox_reliability)}`,
    );
    assert(
      'unested: GENAU 1× NON_DETERMINISTIC_MOTION',
      warnCount(unested, 'NON_DETERMINISTIC_MOTION') === 1,
      `warnings=${JSON.stringify(unested?.warnings)}`,
    );
    assert(
      'anchorn: Record byte-identisch zu HEAD',
      canon(byId(r3.elements, 'anchorn')) === HEAD_ANCHORN,
      `got ${canon(byId(r3.elements, 'anchorn'))}`,
    );

    console.log('\n=== P2c: use→use-Zyklus terminiert, Emissions-Menge unverändert ===');
    const r4 = await resolve(page, SVG_CYCLE);
    assert(
      'Zyklus: resolve terminiert ohne Fehler',
      !!r4 && !r4.error,
      `error=${JSON.stringify(r4?.error)}`,
    );
    assert(
      "Zyklus: Emissions-Menge exakt ['anchorc'] (wie HEAD — Zyklus rendert nichts)",
      canon((r4.elements || []).map((e) => e.id)) === '["anchorc"]',
      `ids=${JSON.stringify((r4.elements || []).map((e) => e.id))}`,
    );
    assert(
      'anchorc: Record byte-identisch zu HEAD',
      canon(byId(r4.elements, 'anchorc')) === HEAD_ANCHORC,
      `got ${canon(byId(r4.elements, 'anchorc'))}`,
    );

    console.log('\n=== P2d (R1/Adversarial F1): Kind eines animierten/3D-Containers als use-Ziel ⇒ KEIN Flag ===');
    const r5 = await resolve(page, SVG_INNER);
    const uinnerAnim = byId(r5.elements, 'uinnerAnim');
    const uinner3d = byId(r5.elements, 'uinner3d');
    const innerAnim = byId(r5.elements, 'innerAnim');
    const inner3d = byId(r5.elements, 'inner3d');
    assert(
      "uinnerAnim (use→Kind eines animierten <g>): 'reliable' + KEIN Motion-Flag (Klon enthält Container NICHT)",
      uinnerAnim?.bbox_reliability === 'reliable' &&
        warnCount(uinnerAnim, 'NON_DETERMINISTIC_MOTION') === 0,
      `rel=${JSON.stringify(uinnerAnim?.bbox_reliability)} warnings=${JSON.stringify(uinnerAnim?.warnings)}`,
    );
    assert(
      "uinner3d (use→Kind eines 3D-<g>): 'reliable' + KEIN 3D-Flag",
      uinner3d?.bbox_reliability === 'reliable' &&
        warnCount(uinner3d, '3D_TRANSFORM_ANCESTOR') === 0,
      `rel=${JSON.stringify(uinner3d?.bbox_reliability)} warnings=${JSON.stringify(uinner3d?.warnings)}`,
    );
    assert(
      'uinnerAnim: bbox byte-stabil [130,10,20,20] (Klon statisch — die Container-Animation klont NICHT mit)',
      !!uinnerAnim?.bbox &&
        uinnerAnim.bbox.x === 130 &&
        uinnerAnim.bbox.y === 10 &&
        uinnerAnim.bbox.w === 20 &&
        uinnerAnim.bbox.h === 20,
      `bbox=${JSON.stringify(uinnerAnim?.bbox)}`,
    );
    assert(
      'Kontrolle: innerAnim/inner3d (Direkt-Kinder) bleiben via Walk ehrlich not_measurable',
      innerAnim?.bbox_reliability === 'not_measurable' &&
        warnCount(innerAnim, 'NON_DETERMINISTIC_MOTION') === 1 &&
        inner3d?.bbox_reliability === 'not_measurable' &&
        warnCount(inner3d, '3D_TRANSFORM_ANCESTOR') === 1,
      `innerAnim=${JSON.stringify(innerAnim?.warnings)} inner3d=${JSON.stringify(inner3d?.warnings)}`,
    );

    // ════ BEWEIS-PFLICHT 3 (KB3): Mess-Detektor — motionExcluded greift am
    //      use-Record; kein media-Falsch-Flag; kein Über-Ausschluss ════
    console.log('\n=== P3: KB3 — motionExcluded über die use-Grenze (MEASURE_WALK_FN) ===');
    const steps = await __measureAtViewports(SVG_KB3, [1920, 400]);
    assert(
      '__measureAtViewports liefert 2 Pässe',
      Array.isArray(steps) && steps.length === 2,
      `got ${JSON.stringify(Array.isArray(steps) ? steps.length : steps)}`,
    );
    const recsOf = (s) => (s && s.walk && s.walk.records) || {};
    const findRec = (s, authorId) =>
      Object.values(recsOf(s)).find((r) => r && r.authorId === authorId);
    const umA = findRec(steps?.[0], 'um');
    const umB = findRec(steps?.[1], 'um');
    const maA = findRec(steps?.[0], 'manchor');
    const maB = findRec(steps?.[1], 'manchor');
    assert('um-Record in beiden Pässen vorhanden', !!umA && !!umB);
    assert(
      'um: motionExcluded === true in BEIDEN Pässen (use-Graph-Lift im Mess-Walk)',
      umA?.motionExcluded === true && umB?.motionExcluded === true,
      `passA=${JSON.stringify(umA?.motionExcluded)} passB=${JSON.stringify(umB?.motionExcluded)}`,
    );
    assert(
      'manchor: motionExcluded === false in BEIDEN Pässen (kein Über-Ausschluss)',
      maA?.motionExcluded === false && maB?.motionExcluded === false,
      `passA=${JSON.stringify(maA?.motionExcluded)} passB=${JSON.stringify(maB?.motionExcluded)}`,
    );
    assert(
      'manchor: geom byte-identisch über die Pässe (statisch)',
      canon(maA?.geom) === canon(maB?.geom),
      `A=${canon(maA?.geom)} B=${canon(maB?.geom)}`,
    );

    console.log('\n=== P3-R2c: KB3 via Stylesheet-Selektor + R1-Negativ im Mess-Walk ===');
    const stepsCss = await __measureAtViewports(SVG_KB3_CSS, [1920, 400]);
    const umcssA = findRec(stepsCss?.[0], 'umcss');
    const umcssB = findRec(stepsCss?.[1], 'umcss');
    const ma2A = findRec(stepsCss?.[0], 'manchor2');
    const ma2B = findRec(stepsCss?.[1], 'manchor2');
    assert(
      'umcss (<style>-Selektor-Animation im Symbol): motionExcluded === true in BEIDEN Pässen',
      umcssA?.motionExcluded === true && umcssB?.motionExcluded === true,
      `passA=${JSON.stringify(umcssA?.motionExcluded)} passB=${JSON.stringify(umcssB?.motionExcluded)}`,
    );
    assert(
      'manchor2: motionExcluded === false in BEIDEN Pässen (kein Über-Ausschluss)',
      ma2A?.motionExcluded === false && ma2B?.motionExcluded === false,
      `passA=${JSON.stringify(ma2A?.motionExcluded)} passB=${JSON.stringify(ma2B?.motionExcluded)}`,
    );
    const stepsInner = await __measureAtViewports(SVG_INNER, [1920, 400]);
    const uiaA = findRec(stepsInner?.[0], 'uinnerAnim');
    const uiaB = findRec(stepsInner?.[1], 'uinnerAnim');
    const iaA = findRec(stepsInner?.[0], 'innerAnim');
    assert(
      'uinnerAnim (use→Kind eines animierten <g>): motionExcluded === false in BEIDEN Pässen (R1 — kein Über-Ausschluss via Nachfahren)',
      uiaA?.motionExcluded === false && uiaB?.motionExcluded === false,
      `passA=${JSON.stringify(uiaA?.motionExcluded)} passB=${JSON.stringify(uiaB?.motionExcluded)}`,
    );
    assert(
      'Kontrolle: innerAnim (Direkt-Kind) bleibt motionExcluded === true (self+ancestors-Loop trägt)',
      iaA?.motionExcluded === true,
      `got ${JSON.stringify(iaA?.motionExcluded)}`,
    );

    const mvd = await measureViewportDivergence(SVG_KB3);
    assert(
      'measureViewportDivergence: kein Fehler',
      !!mvd && !mvd.error,
      `got ${JSON.stringify(mvd)}`,
    );
    assert(
      'diverged: KEIN media-Falsch-Flag für um/use (motionExcluded greift)',
      (mvd?.diverged || []).every(
        (d) => d.authorId !== 'um' && d.tag !== 'use',
      ),
      `diverged=${JSON.stringify(mvd?.diverged)}`,
    );

    console.log('\n=== P3b: Dual-Source-Parity (Port-Spiegel unberührt) ===');
    const par = await __measureStaticMediaParityCheck();
    assert(
      'Parity: aggregiertes ok === true',
      par?.ok === true,
      `got ${JSON.stringify({ ok: par?.ok, scenes: (par?.scenes || []).map((s) => ({ name: s.name, ok: s.ok, error: s.error })) })}`,
    );
    assert(
      `Parity: alle Szenen ok (${(par?.scenes || []).length}/4+)`,
      Array.isArray(par?.scenes) &&
        par.scenes.length >= 4 &&
        par.scenes.every((s) => s.ok === true),
      `scenes=${JSON.stringify((par?.scenes || []).map((s) => ({ name: s.name, ok: s.ok })))}`,
    );
  } finally {
    await closeResolver();
  }

  // ── PIPELINE-PFAD (inspect → structured): MCP-Boundary + R9-Byte-Stabilität ──
  try {
    console.log('\n=== R9 + MCP-Boundary: 2× inspect byte-identisch (statisches 3D-Shadow) ===');
    const i1 = await inspect(SVG_R9);
    const sceneU3d = byId(i1.structured?.scene?.elements, 'u3d');
    assert(
      "inspect: u3d.bbox_reliability === 'not_measurable' (Verdikt erreicht den Konsumenten)",
      sceneU3d?.bbox_reliability === 'not_measurable',
      `got ${JSON.stringify(sceneU3d?.bbox_reliability)}`,
    );
    assert(
      'inspect: u3d trägt 3D_TRANSFORM_ANCESTOR',
      warnCount(sceneU3d, '3D_TRANSFORM_ANCESTOR') === 1,
      `warnings=${JSON.stringify(sceneU3d?.warnings)}`,
    );
    const c1 = canon(i1.structured);
    const c2 = canon((await inspect(SVG_R9)).structured);
    assert('R9: 2× inspect byte-identisch', c1 === c2, `len ${c1.length} vs ${c2.length}`);
  } finally {
    await shutdown();
  }

  console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error('Test-Harness-Fehler:', e);
  process.exit(1);
});
