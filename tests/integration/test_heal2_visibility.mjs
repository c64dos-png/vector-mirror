/**
 * test_heal2_visibility.mjs — HEILUNG 2: Komposition-bewusster Sichtbarkeits-Walk
 *
 * Real-Chromium-Harness (KEINE Mocks), kalibriert an
 * an internal ground-truth probe (Empirie-Referenz, byte-stabil).
 *
 * ROT/GRÜN-VERTRAG (Coder-Vertrag §4):
 *   ROT (heute Lüge → muss GRÜN werden):
 *     R1: <g display:none><rect id=r1> → r1 darf NICHT in elements erscheinen.
 *     R2: <g opacity=0><rect id=r2>   → r2 darf NICHT in elements erscheinen.
 *   GRÜN-Kontrollen:
 *     G-ctrl        : kein Hidden-Vorfahr → emittiert, reliable, opacity=1.
 *     G-contents    : display:contents-Vorfahr → durchlässig → emittiert.
 *     G-visoverride : visibility:visible-Kind über hidden-Vorfahr → emittiert.
 *     G-nestedop    : opacity 0.5×0.5 → emittiert, opacity≈0.25, reliable
 *                     (opacity ENTKOPPELT von bbox_reliability — KEIN approximate).
 *     G-double-none : doppelt geschachtelt display:none → NICHT emittiert.
 *   MOTION-GRENZE (Heilung 5, NICHT überschreiten):
 *     <g opacity:0> mit laufender Non-SMIL-CSS-Animation auf dem Blatt →
 *     momentane komponierte 0 wird NICHT gedroppt, sondern als
 *     not_measurable + NON_DETERMINISTIC_MOTION emittiert.
 *   DETERMINISMUS: 3× identische scene (kanonisch).
 *
 * checkVisibility-Quirk: KEIN Assert gegen native checkVisibility (lügt bei
 * SVG-Vorfahr-display:none) — nur der Produktiv-Walk wird geprüft.
 *
 * Run direkt: `node tests/integration/test_heal2_visibility.mjs`
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

// ── ROT/GRÜN-FIXTURE: alle Fälle in EINER SVG (1:1 zu _verify_heal2_ancestor) ──
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200">
  <g display="none">
    <rect id="r1" x="10" y="10" width="40" height="40" fill="red"/>
  </g>
  <g opacity="0">
    <rect id="r2" x="60" y="10" width="40" height="40" fill="green"/>
  </g>
  <g>
    <rect id="g_ctrl" x="160" y="10" width="40" height="40" fill="orange"/>
  </g>
  <g style="display:contents">
    <rect id="g_contents" x="210" y="10" width="40" height="40" fill="purple"/>
  </g>
  <g visibility="hidden">
    <rect id="g_visoverride" x="260" y="10" width="40" height="40" fill="teal" visibility="visible"/>
  </g>
  <g opacity="0.5">
    <g opacity="0.5">
      <rect id="g_nestedop" x="310" y="10" width="40" height="40" fill="magenta"/>
    </g>
  </g>
  <g display="none">
    <g>
      <rect id="g_double_none" x="360" y="10" width="40" height="40" fill="black"/>
    </g>
  </g>
</svg>`;

// ── MOTION-GRENZE: nicht-deterministische OPACITY-Animation am Blatt.
// Die @keyframes animieren OPACITY (0%→100%) → der eigene Faktor wird >0
// (factorMaxOpacity=1) → "kann sichtbar werden" → MUSS durchgereicht werden
// (not_measurable), NICHT gedroppt. Werte-basiertes Gate (permanentlyInvisible):
// nur wenn JEDER Faktor max 0 erreicht, wird geskippt. <style>/@keyframes überlebt
// den Sanitizer und erreicht den Renderer (empirisch verifiziert).
const SVG_MOTION = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">
  <style>
    @keyframes fade { 0% { opacity: 0; } 100% { opacity: 1; } }
    #m_anim { animation: fade 1.5s linear infinite; }
  </style>
  <rect id="m_anim" x="10" y="10" width="40" height="40" fill="red"/>
</svg>`;

// ── CODEX-REGRESSION R1 (F-AT-4-R): STATISCH unsichtbar (<g opacity:0>) + reine
// TRANSFORM-Transition am Kind (Geometrie-Motion, KEINE opacity-Animation). opacity
// permanent 0 → MUSS geskippt werden. (Frühere Track-Präsenz-Variante hätte es
// fälschlich emittiert.)
const SVG_CODEX_LEAK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <g opacity="0">
    <rect id="invis_trans" style="transition: transform 2s" transform="translate(5,5)" x="10" y="10" width="30" height="30" fill="red"/>
  </g>
  <rect id="codex_real" x="60" y="60" width="20" height="20" fill="blue"/>
</svg>`;

// ── CODEX-REGRESSION R2 (reproduziert _verify_codex_h2_r2.mjs): WERTE- statt
// TRACK-Präsenz. STATISCHER Vorfahr opacity:0 + Kind mit ECHTER opacity-Animation
// 0→1. Das Produkt bleibt wegen des statischen Vorfahr-0-Faktors IMMER 0
// (permanentlyInvisible: ein Ketten-Faktor erreicht max 0) → MUSS geskippt werden,
// obwohl der Kind-Faktor animiert. Track-Präsenz hätte es fälschlich emittiert.
const SVG_CODEX_R2_ABSORBED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <style>@keyframes fade { from { opacity: 0; } to { opacity: 1; } } .anim { animation: fade 2s linear infinite; }</style>
  <g opacity="0"><rect id="absorbed" class="anim" x="10" y="10" width="30" height="30" fill="red"/></g>
  <rect id="r2_real" x="60" y="60" width="20" height="20" fill="blue"/>
</svg>`;

// ── CODEX-REGRESSION R2a: @keyframes{0→0} (laufende Animation, aber kfMax 0) →
// permanent unsichtbar → MUSS geskippt werden (factorMaxOpacity=0 trotz aktiver Anim).
const SVG_CODEX_R2_KF00 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <style>@keyframes z { 0% { opacity: 0; } 100% { opacity: 0; } } .z { animation: z 2s linear infinite; }</style>
  <rect id="kf00" class="z" x="10" y="10" width="30" height="30" fill="red"/>
  <rect id="kf00_real" x="60" y="60" width="20" height="20" fill="blue"/>
</svg>`;

// ── CODEX-REGRESSION R2b: paused@0 (opacity:0, animation pausiert) → der aktuelle
// (statische) Frame ist 0 → permanent unsichtbar → MUSS geskippt werden
// (playState !== 'running' → animMax = statischer opacity-Wert 0).
const SVG_CODEX_R2_PAUSED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <style>@keyframes f { 0% { opacity: 0; } 100% { opacity: 1; } } .p { opacity: 0; animation: f 2s linear infinite; animation-play-state: paused; }</style>
  <rect id="paused0" class="p" x="10" y="10" width="30" height="30" fill="red"/>
  <rect id="paused_real" x="60" y="60" width="20" height="20" fill="blue"/>
</svg>`;

// ── REGRESSION-FLAGSHIPS (permanente Regressions-Wächter, Realfunde R4) ─────────
//
// F-AT-4-D Spiel-State-Stapel: drei gestapelte State-<g> (idle/run/jump), nur EINER
// aktiv. idle via display:none, jump via opacity:0 versteckt — die zwei kanonischen
// Spiel-Versteck-Mechanismen. Ein State-lesendes Gehirn (inspect → scene.elements)
// darf NUR den aktiven Sprite s_run sehen, NICHT s_idle/s_jump. Vor Heilung 2 wären
// alle drei emittiert worden (leaf-only sah display!='none' / opacity==1 am Blatt).
const SVG_STATE_STACK = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120" viewBox="0 0 300 120">
  <g id="idle" display="none">
    <rect id="s_idle" x="40" y="40" width="30" height="60" fill="gray"/>
  </g>
  <g id="run">
    <rect id="s_run" x="40" y="40" width="30" height="60" fill="lime"/>
  </g>
  <g id="jump" opacity="0">
    <rect id="s_jump" x="40" y="0" width="30" height="60" fill="gold"/>
  </g>
</svg>`;

// F-AT-4-K Vorfahr opacity:0.03: bei 3% ist das Element WIRKLICH gerendert (nur sehr
// schwach). Schwellenwert-frei → NICHT gedroppt (composedOp=0.03 ≠ 0); emittiert mit
// ehrlich gemessener komponierter opacity 0.03. prose.js:129 (el.opacity<0.3) hängt
// den "(fast unsichtbar)"-Hinweis an → ehrliche Teil-Transparenz statt solider Lüge.
const SVG_FAINT = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
  <g opacity="0.03">
    <rect id="faint" x="40" y="40" width="40" height="40" fill="red"/>
  </g>
</svg>`;

// ── N-1-GRENZE (dokumentierend, KEIN Test) ─────────────────────────────────────
// fill-opacity / stroke-opacity = 0 liegen AUSSERHALB des Heilung-2-Scopes: das ist
// eine ANDERE Achse (Paint-Kanal pro Element, vererbt NICHT als Render-Tree-Sicht-
// barkeit, komponiert NICHT als Element-opacity-Produkt). Registriert in
// COLLECT_R4 §6 (gated). H2 fordert KEIN Verhalten dafür — bewusst kein Wächter hier.

function byId(elements, id) {
  return elements.find((e) => e.id === id);
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
    const result = await resolve(page, SVG);
    assert(
      'resolve liefert kein error',
      !result.error,
      result.error ? `${result.error}: ${result.message}` : '',
    );
    const els = result.elements || [];
    const ids = els.map((e) => e.id);

    // ── ROT → GRÜN ──────────────────────────────────────────────────────────
    console.log('=== ROT→GRÜN: versteckte Blätter dürfen NICHT erscheinen ===');
    assert(
      'R1: <g display:none><rect id=r1> → r1 NICHT in elements',
      !ids.includes('r1'),
      `ids=${JSON.stringify(ids)}`,
    );
    assert(
      'R2: <g opacity:0><rect id=r2> → r2 NICHT in elements',
      !ids.includes('r2'),
      `ids=${JSON.stringify(ids)}`,
    );
    assert(
      'G-double-none: doppelt geschachtelt display:none → NICHT in elements',
      !ids.includes('g_double_none'),
      `ids=${JSON.stringify(ids)}`,
    );

    // ── GRÜN-KONTROLLEN ───────────────────────────────────────────────────────
    console.log('\n=== GRÜN-KONTROLLEN: sichtbare Blätter korrekt klassifiziert ===');
    const ctrl = byId(els, 'g_ctrl');
    assert('G-ctrl: emittiert', !!ctrl, `ids=${JSON.stringify(ids)}`);
    assert(
      'G-ctrl: reliable',
      ctrl && ctrl.bbox_reliability === 'reliable',
      ctrl && `got ${JSON.stringify(ctrl.bbox_reliability)}`,
    );
    assert(
      'G-ctrl: opacity === 1',
      ctrl && ctrl.opacity === 1,
      ctrl && `got ${JSON.stringify(ctrl.opacity)}`,
    );

    const contents = byId(els, 'g_contents');
    assert(
      'G-contents: display:contents-Vorfahr durchlässig → emittiert',
      !!contents,
      `ids=${JSON.stringify(ids)}`,
    );

    const visoverride = byId(els, 'g_visoverride');
    assert(
      'G-visoverride: visibility:visible-Kind → emittiert',
      !!visoverride,
      `ids=${JSON.stringify(ids)}`,
    );

    const nestedop = byId(els, 'g_nestedop');
    assert(
      'G-nestedop: opacity 0.5×0.5 → emittiert',
      !!nestedop,
      `ids=${JSON.stringify(ids)}`,
    );
    assert(
      'G-nestedop: komponierte opacity ≈ 0.25',
      nestedop && Math.abs(nestedop.opacity - 0.25) < 1e-9,
      nestedop && `got ${JSON.stringify(nestedop.opacity)}`,
    );
    assert(
      'G-nestedop: bbox_reliability === reliable (opacity ENTKOPPELT, kein approximate)',
      nestedop && nestedop.bbox_reliability === 'reliable',
      nestedop && `got ${JSON.stringify(nestedop.bbox_reliability)}`,
    );
    assert(
      'G-nestedop: KEINE OPACITY_GREY_ZONE-Warnung (Grauzone gestrichen)',
      nestedop && !(nestedop.warnings || []).includes('OPACITY_GREY_ZONE'),
      nestedop && `got ${JSON.stringify(nestedop.warnings)}`,
    );

    // ── MOTION-GRENZE (Heilung 5): nicht-determ. OPACITY-Animation ────────────
    console.log('\n=== MOTION-GRENZE: animierte opacity (momentan 0) NICHT droppen ===');
    const motionResult = await resolve(page, SVG_MOTION);
    assert(
      'motion: resolve liefert kein error',
      !motionResult.error,
      motionResult.error ? `${motionResult.error}: ${motionResult.message}` : '',
    );
    const mEls = motionResult.elements || [];
    const mAnim = byId(mEls, 'm_anim');
    assert(
      'motion: laufende opacity-Animation (momentan 0) → m_anim EMITTIERT (NICHT gedroppt)',
      !!mAnim,
      `ids=${JSON.stringify(mEls.map((e) => e.id))}`,
    );
    assert(
      'motion: bbox_reliability === not_measurable',
      mAnim && mAnim.bbox_reliability === 'not_measurable',
      mAnim && `got ${JSON.stringify(mAnim.bbox_reliability)}`,
    );
    assert(
      'motion: warnings includes NON_DETERMINISTIC_MOTION',
      mAnim && (mAnim.warnings || []).includes('NON_DETERMINISTIC_MOTION'),
      mAnim && `got ${JSON.stringify(mAnim.warnings)}`,
    );

    // ── CODEX-REGRESSION: statisch unsichtbar + Transform-Motion → GESKIPPT ────
    console.log('\n=== CODEX-REGRESSION: opacity:0 statisch + Transform-Motion → GESKIPPT ===');
    const codexResult = await resolve(page, SVG_CODEX_LEAK);
    assert(
      'codex: resolve liefert kein error',
      !codexResult.error,
      codexResult.error ? `${codexResult.error}: ${codexResult.message}` : '',
    );
    const codexIds = (codexResult.elements || []).map((e) => e.id);
    assert(
      'codex: invis_trans (opacity:0 statisch + Transform-Transition) NICHT in elements',
      !codexIds.includes('invis_trans'),
      `ids=${JSON.stringify(codexIds)}`,
    );
    assert(
      'codex: sichtbares Kontroll-Element codex_real IST in elements (kein Über-Skip)',
      codexIds.includes('codex_real'),
      `ids=${JSON.stringify(codexIds)}`,
    );

    // ── CODEX-REGRESSION R2 (WERTE- statt TRACK-Präsenz) ──────────────────────
    console.log('\n=== CODEX-REGRESSION R2: permanent-0-Faktor → GESKIPPT (trotz Anim) ===');
    // Helfer: SVG rendern, ID-Liste zurück.
    const idsOf = async (svg) =>
      ((await resolve(page, svg)).elements || []).map((e) => e.id);

    const r2Ids = await idsOf(SVG_CODEX_R2_ABSORBED);
    assert(
      'R2-absorbed: statischer Vorfahr opacity:0 + Kind-Anim 0→1 → absorbed GESKIPPT',
      !r2Ids.includes('absorbed'),
      `ids=${JSON.stringify(r2Ids)}`,
    );
    assert(
      'R2-absorbed: Kontroll-Element r2_real bleibt (kein Über-Skip)',
      r2Ids.includes('r2_real'),
      `ids=${JSON.stringify(r2Ids)}`,
    );

    const kf00Ids = await idsOf(SVG_CODEX_R2_KF00);
    assert(
      'R2a-kf00: @keyframes{0→0} (kfMax 0) → kf00 GESKIPPT (permanent unsichtbar)',
      !kf00Ids.includes('kf00'),
      `ids=${JSON.stringify(kf00Ids)}`,
    );
    assert(
      'R2a-kf00: Kontroll-Element kf00_real bleibt',
      kf00Ids.includes('kf00_real'),
      `ids=${JSON.stringify(kf00Ids)}`,
    );

    const pausedIds = await idsOf(SVG_CODEX_R2_PAUSED);
    assert(
      'R2b-paused0: paused@opacity:0 (Frame-Wert 0) → paused0 GESKIPPT',
      !pausedIds.includes('paused0'),
      `ids=${JSON.stringify(pausedIds)}`,
    );
    assert(
      'R2b-paused0: Kontroll-Element paused_real bleibt',
      pausedIds.includes('paused_real'),
      `ids=${JSON.stringify(pausedIds)}`,
    );

    // ── F-AT-4-K (Renderer-Ebene): exakte komponierte opacity 0.03 ───────────
    // Wert-Wächter dort, wo composedOp emittiert wird (das scene.elements-Projekt
    // surfacet opacity bewusst nicht — der Konsumenten-Beweis läuft unten via prose).
    console.log('\n=== F-AT-4-K (Renderer): Vorfahr opacity:0.03 → komponiert 0.03 ===');
    const faintRender = await resolve(page, SVG_FAINT);
    const faintRenderEl = byId(faintRender.elements || [], 'faint');
    assert(
      'faint(renderer): emittiert mit komponierter opacity ≈ 0.03 (1×0.03)',
      faintRenderEl && Math.abs(faintRenderEl.opacity - 0.03) < 1e-9,
      faintRenderEl
        ? `got ${JSON.stringify(faintRenderEl.opacity)}`
        : `ids=${JSON.stringify((faintRender.elements || []).map((e) => e.id))}`,
    );

    // ── DETERMINISMUS: 3× identische scene ────────────────────────────────────
    console.log('\n=== DETERMINISMUS: 3× byte-identische scene ===');
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const r = await resolve(page, SVG);
      runs.push(canon({ canvas: r.canvas, elements: r.elements }));
    }
    assert(
      'Determinismus: Lauf 1 === Lauf 2',
      runs[0] === runs[1],
      `r0!=r1`,
    );
    assert(
      'Determinismus: Lauf 2 === Lauf 3',
      runs[1] === runs[2],
      `r1!=r2`,
    );
  } finally {
    await closeResolver();
  }

  // ── REGRESSION-FLAGSHIPS (pipeline-Pfad: inspect → structured + prose) ─────────
  // closeResolver hat den Renderer-Sweep-Browser geschlossen; inspect() nutzt den
  // eigenen lazy Pipeline-Lifecycle (analog test_self3d_reliability DEFEKT-6-Block).
  try {
    // ── F-AT-4-D: Spiel-State-Stapel → nur der aktive Sprite ist sichtbar ──
    console.log('\n=== F-AT-4-D: Spiel-State-Stapel (nur aktiver Sprite sichtbar) ===');
    const eye = await inspect(SVG_STATE_STACK);
    const sceneIds = (eye.structured?.scene?.elements || []).map((e) => e.id);
    assert(
      'state-stack: s_run (aktiv) IST in scene.elements',
      sceneIds.includes('s_run'),
      `ids=${JSON.stringify(sceneIds)}`,
    );
    assert(
      'state-stack: s_idle (display:none) NICHT in scene.elements',
      !sceneIds.includes('s_idle'),
      `ids=${JSON.stringify(sceneIds)}`,
    );
    assert(
      'state-stack: s_jump (opacity:0) NICHT in scene.elements',
      !sceneIds.includes('s_jump'),
      `ids=${JSON.stringify(sceneIds)}`,
    );

    // ── F-AT-4-K: Vorfahr opacity:0.03 → emittiert + "(fast unsichtbar)"-Prosa ──
    console.log('\n=== F-AT-4-K: Vorfahr opacity:0.03 (ehrliche Teil-Transparenz) ===');
    const faintEye = await inspect(SVG_FAINT);
    const faintScene = faintEye.structured?.scene?.elements || [];
    const faintEl = byId(faintScene, 'faint');
    assert(
      'faint: opacity 0.03 → EMITTIERT (schwellenwert-frei, nicht gedroppt)',
      !!faintEl,
      `ids=${JSON.stringify(faintScene.map((e) => e.id))}`,
    );
    // Die KOMPONIERTE opacity (0.03) wird auf Grid-Element-Ebene getragen; die
    // scene.elements-Projektion (formatStructured) surfacet sie bewusst NICHT
    // (Felder: id/tag/cell/color/status/bbox_reliability). Der KOMPOSITIONS-Beweis
    // ist daher der prose-Hinweis: "(fast unsichtbar)" feuert NUR bei opacity<0.3
    // (prose.js:129). Das Blatt <rect> hat leaf-opacity 1 → ohne Vorfahr-Komposition
    // bliebe der Hinweis AUS. Sein Erscheinen belegt: 0.03 = 1×0.03 erreichte den
    // Konsumenten. (Der exakte komponierte Zahlenwert ist auf Renderer-Ebene bereits
    // durch G-nestedop opacity≈0.25 oben abgesichert.)
    assert(
      'faint: prose trägt "(fast unsichtbar)"-Hinweis (Komposition 0.03 erreicht Konsument)',
      typeof faintEye.prose === 'string' && faintEye.prose.includes('(fast unsichtbar)'),
      `prose=${JSON.stringify(faintEye.prose)}`,
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
