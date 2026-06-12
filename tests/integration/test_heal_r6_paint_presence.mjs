/**
 * test_heal_r6_paint_presence.mjs — HEAL-R6 / T1: Paint-Presence (F-AT-6-01, CRIT, DoD-2)
 *
 * Real-Chromium-Harness (KEINE Mocks), über die ECHTE Pipeline
 * (inspect → structured.scene.elements).
 *
 * DIE LÜGE (vor T1): der Sichtbarkeits-Walk in playwright.js prüfte opacity/display/
 * visibility, NICHT fill-opacity/stroke-opacity. Ein <rect fill="red" fill-opacity="0">
 * malt 0 Pixel, wurde aber als color:red, bbox_reliability:reliable, status:ok OHNE
 * jedes Tinten-tot-Signal emittiert (Belegt: probe_fill_opacity.mjs LIE...:true).
 *
 * DIE HEILUNG (T1, rein statisch @t=0, R9): fillAlpha = composedOpacity × fillOpacity,
 * strokeAlpha analog (factorMaxPaint — permanenz-bewusst, Keyframe-max=0 → permanent 0).
 * painted = (fill≠none ∧ fillAlpha≠0) ∨ (stroke≠none ∧ strokeAlpha≠0 ∧ stroke-width≠0).
 * EXAKT-0, kein epsilon. Paint-Server (url(#…)) konservativ painted=true.
 * BLIND-TRUST: painted===false → Element EMITTIEREN mit paint_visible:false + Warning
 * PAINT_NOT_VISIBLE. bbox_reliability BLEIBT reliable (Geometrie IST exakt).
 *
 * VERTRAG:
 *   fill-opacity:0 (stroke=none)  → paint_visible:false + PAINT_NOT_VISIBLE-Warning,
 *                                   bbox_reliability:reliable.
 *   stroke-opacity:0 (fill=none)  → paint_visible:false (kein malender Kanal).
 *   fill=none + stroke vorhanden  → paint_visible NICHT false (stroke malt).
 *   stroke-width:0 (stroke gesetzt, fill=none) → paint_visible:false (kein Extent).
 *   opacity:0 am Element selbst    → bereits oben geskippt (permanentlyInvisible),
 *                                   NICHT als paint_visible-Fall (Element fehlt).
 *   NEGATIV-KONTROLLE: normales sichtbares <rect fill=red> → KEIN paint_visible-Feld,
 *                                   KEINE PAINT_NOT_VISIBLE-Warning, reliable.
 *   PAINT-SERVER (sauber): fill=url(#grad) volle Opacity → konservativ painted=true
 *                 (Server-Tinte nicht statisch ableitbar). ABER fill=url(#g)+fill-
 *                 opacity:0 → tot (Härtung #2: Paint-Opacity gated auch den Server).
 *   epsilon-GRENZE: fill-opacity:0.01 → sichtbar (kein paint_visible:false).
 *   ANIMIERT-tot: fill-opacity 0→0-Keyframe → paint_visible:false (Keyframe-max=0).
 *   DETERMINISMUS: 2× byte-identisch.
 *
 * Run direkt: `node tests/integration/test_heal_r6_paint_presence.mjs`
 */
import { inspect, analyze, shutdown } from '../../src/pipeline.js';

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

const VB = 'width="100" height="100" viewBox="0 0 100 100"';

// fill-opacity:0, kein stroke → 0 Pixel.
const SVG_FILL_OPACITY_0 = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <rect id="ghost" x="10" y="10" width="50" height="50" fill="red" fill-opacity="0" stroke="none"/>
</svg>`;

// stroke-opacity:0 + fill=none → 0 Pixel (kein malender Kanal).
const SVG_STROKE_OPACITY_0 = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <rect id="ghost" x="10" y="10" width="50" height="50" fill="none" stroke="blue" stroke-width="4" stroke-opacity="0"/>
</svg>`;

// fill=none, sichtbarer stroke → stroke malt → NICHT paint_visible:false.
const SVG_FILL_NONE_STROKE = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <rect id="r" x="10" y="10" width="50" height="50" fill="none" stroke="blue" stroke-width="4"/>
</svg>`;

// stroke gesetzt aber stroke-width:0, fill=none → kein Extent, 0 Pixel.
const SVG_STROKE_WIDTH_0 = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <rect id="ghost" x="10" y="10" width="50" height="50" fill="none" stroke="blue" stroke-width="0"/>
</svg>`;

// NEGATIV-KONTROLLE: normales sichtbares Element → unverändert.
const SVG_NORMAL = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <rect id="r" x="10" y="10" width="50" height="50" fill="red"/>
</svg>`;

// PAINT-SERVER (sauberer Gradient, volle Opacity): Server-Tinte nicht statisch
// ableitbar → konservativ painted=true (lieber sichtbar als falsch-tot). Der
// fill-opacity:0-Server-Fall ist Härtung #2 (SVG_PAINTSERVER_FILLOP0) — dort tot.
const SVG_PAINT_SERVER = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><linearGradient id="grad"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs>
  <rect id="r" x="10" y="10" width="50" height="50" fill="url(#grad)"/>
</svg>`;

// epsilon-GRENZE: fill-opacity:0.01 → sichtbar (EXAKT-0, kein epsilon).
const SVG_EPSILON = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <rect id="r" x="10" y="10" width="50" height="50" fill="red" fill-opacity="0.01"/>
</svg>`;

// ANIMIERT-tot: CSS-@keyframes fill-opacity 0→0 (max=0) → permanent tot.
const SVG_ANIM_DEAD = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <style>@keyframes f { from { fill-opacity: 0; } to { fill-opacity: 0; } }
  #ghost { animation: f 2s infinite; }</style>
  <rect id="ghost" x="10" y="10" width="50" height="50" fill="red"/>
</svg>`;

// ── HÄRTUNG #1 (COLOR-ALPHA): fill="transparent"/"rgba(...,0)"/currentColor→transp ─
// fill-opacity===1, aber die FARB-Alpha ist 0 → 0 Pixel.
const SVG_TRANSPARENT_FILL = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <rect id="ghost" x="10" y="10" width="50" height="50" fill="transparent"/>
</svg>`;
const SVG_RGBA0_FILL = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <rect id="ghost" x="10" y="10" width="50" height="50" fill="rgba(255,0,0,0)"/>
</svg>`;
const SVG_CURRENTCOLOR_TRANSP = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <rect id="ghost" x="10" y="10" width="50" height="50" style="color:transparent;fill:currentColor"/>
</svg>`;

// ── HÄRTUNG #2 (Paint-Server + fill-opacity:0): die Paint-Opacity gated AUCH den
// Server — url(#g) darf fill-opacity:0 NICHT mehr kurzschließen → 0 Pixel.
const SVG_PAINTSERVER_FILLOP0 = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs>
  <rect id="ghost" x="10" y="10" width="50" height="50" fill="url(#g)" fill-opacity="0"/>
</svg>`;

// ── HÄRTUNG #3 (Tag-Anwendbarkeit): <image fill-opacity:0> ist RASTER, nicht
// fill-getrieben → NICHT paint_visible:false (False-Positive-Schutz). 1×1-GIF.
const PX_GIF =
  'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
const SVG_IMAGE_FILLOP0 = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <image id="img" x="10" y="10" width="50" height="50" href="${PX_GIF}" fill-opacity="0"/>
</svg>`;

// ── HÄRTUNG #4 (Vererbung + Animation): Blatt erbt fill-opacity von animiertem
// <g>-Vorfahr (@keyframes 0→1). Am eingefrorenen t=0 ist computed fill-opacity 0,
// aber der Kanal ist NICHT permanent tot → NICHT paint_visible:false.
const SVG_INHERIT_ANIM = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <style>@keyframes f { from { fill-opacity: 0; } to { fill-opacity: 1; } }
  #grp { animation: f 2s infinite; }</style>
  <g id="grp"><rect id="leaf" x="10" y="10" width="50" height="50" fill="red"/></g>
</svg>`;

// ── HÄRTUNG #4 KONTROLLE (Shadowing): Blatt erbt fill-opacity:0 von einem
// STATISCHEN <g> (keine Animation) → permanent tot (die Anim-Rettung greift NICHT,
// ein statischer Vorfahr-Wert darf den nicht „retten"). Beweist: kein Blanket-
// Konservatismus, sondern echte Animations-Diskriminanz.
const SVG_INHERIT_STATIC0 = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <g style="fill-opacity:0"><rect id="leaf" x="10" y="10" width="50" height="50" fill="red"/></g>
</svg>`;

// ── KONTROLLE (solide rgba-Teiltransparenz): rgba(...,0.5) → sichtbar (kein dead).
const SVG_RGBA05_SOLID = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <rect id="r" x="10" y="10" width="50" height="50" fill="rgba(255,0,0,0.5)"/>
</svg>`;

function hasWarn(el, w) {
  return Array.isArray(el?.warnings) && el.warnings.includes(w);
}

(async () => {
  try {
    // ── fill-opacity:0 → paint_visible:false + Warning, reliable bleibt ──────────
    console.log('=== fill-opacity:0 (stroke=none) → paint_visible:false + PAINT_NOT_VISIBLE ===');
    const fo = await inspect(SVG_FILL_OPACITY_0);
    const foEl = byId(fo.structured?.scene?.elements, 'ghost');
    assert('fill-op-0: #ghost in scene.elements', !!foEl,
      `ids=${JSON.stringify((fo.structured?.scene?.elements || []).map((e) => e.id))}`);
    assert('fill-op-0: paint_visible === false', foEl?.paint_visible === false,
      `got ${JSON.stringify(foEl?.paint_visible)}`);
    assert('fill-op-0: trägt PAINT_NOT_VISIBLE-Warning', hasWarn(foEl, 'PAINT_NOT_VISIBLE'),
      `warnings=${JSON.stringify(foEl?.warnings)}`);
    assert('fill-op-0: bbox_reliability bleibt reliable (Geometrie exakt, Blind-Trust)',
      foEl?.bbox_reliability === 'reliable', `got ${JSON.stringify(foEl?.bbox_reliability)}`);
    assert('fill-op-0: fill_paint_factor === 0 (Diagnostik)', foEl?.fill_paint_factor === 0,
      `got ${JSON.stringify(foEl?.fill_paint_factor)}`);

    // ── stroke-opacity:0 (fill=none) → paint_visible:false ──────────────────────
    console.log('\n=== stroke-opacity:0 (fill=none) → paint_visible:false ===');
    const so = await inspect(SVG_STROKE_OPACITY_0);
    const soEl = byId(so.structured?.scene?.elements, 'ghost');
    assert('stroke-op-0: #ghost in scene.elements', !!soEl,
      `ids=${JSON.stringify((so.structured?.scene?.elements || []).map((e) => e.id))}`);
    assert('stroke-op-0: paint_visible === false', soEl?.paint_visible === false,
      `got ${JSON.stringify(soEl?.paint_visible)}`);
    assert('stroke-op-0: trägt PAINT_NOT_VISIBLE-Warning', hasWarn(soEl, 'PAINT_NOT_VISIBLE'),
      `warnings=${JSON.stringify(soEl?.warnings)}`);
    assert('stroke-op-0: stroke_paint_factor === 0', soEl?.stroke_paint_factor === 0,
      `got ${JSON.stringify(soEl?.stroke_paint_factor)}`);

    // ── fill=none + sichtbarer stroke → stroke malt → NICHT tot ─────────────────
    console.log('\n=== fill=none + sichtbarer stroke → paint_visible NICHT false ===');
    const fns = await inspect(SVG_FILL_NONE_STROKE);
    const fnsEl = byId(fns.structured?.scene?.elements, 'r');
    assert('fill-none-stroke: #r in scene.elements', !!fnsEl);
    assert('fill-none-stroke: paint_visible NICHT false (stroke malt)',
      fnsEl?.paint_visible !== false, `got ${JSON.stringify(fnsEl?.paint_visible)}`);
    assert('fill-none-stroke: KEINE PAINT_NOT_VISIBLE-Warning', !hasWarn(fnsEl, 'PAINT_NOT_VISIBLE'),
      `warnings=${JSON.stringify(fnsEl?.warnings)}`);

    // ── stroke-width:0 (fill=none) → kein Extent → paint_visible:false ──────────
    console.log('\n=== stroke-width:0 (stroke gesetzt, fill=none) → paint_visible:false ===');
    const sw = await inspect(SVG_STROKE_WIDTH_0);
    const swEl = byId(sw.structured?.scene?.elements, 'ghost');
    assert('stroke-w-0: #ghost in scene.elements', !!swEl,
      `ids=${JSON.stringify((sw.structured?.scene?.elements || []).map((e) => e.id))}`);
    assert('stroke-w-0: paint_visible === false (stroke-width:0 → kein Extent)',
      swEl?.paint_visible === false, `got ${JSON.stringify(swEl?.paint_visible)}`);
    assert('stroke-w-0: trägt PAINT_NOT_VISIBLE-Warning', hasWarn(swEl, 'PAINT_NOT_VISIBLE'),
      `warnings=${JSON.stringify(swEl?.warnings)}`);

    // ── NEGATIV-KONTROLLE: normales sichtbares Element → unverändert ────────────
    console.log('\n=== NEGATIV-KONTROLLE: normales sichtbares <rect fill=red> → unverändert ===');
    const nm = await inspect(SVG_NORMAL);
    const nmEl = byId(nm.structured?.scene?.elements, 'r');
    assert('normal: #r in scene.elements', !!nmEl);
    assert('normal: KEIN paint_visible-Feld (Negativ-Kontrolle)',
      nmEl && !('paint_visible' in nmEl), `got ${JSON.stringify(nmEl?.paint_visible)}`);
    assert('normal: KEINE PAINT_NOT_VISIBLE-Warning', !hasWarn(nmEl, 'PAINT_NOT_VISIBLE'),
      `warnings=${JSON.stringify(nmEl?.warnings)}`);
    assert('normal: bbox_reliability === reliable', nmEl?.bbox_reliability === 'reliable',
      `got ${JSON.stringify(nmEl?.bbox_reliability)}`);
    // NIT (beide Reviewer): factor==1 → Feld WEGLASSEN (kein Output-Spam).
    assert('normal: KEIN fill_paint_factor-Feld (==1 → omitted, NIT)',
      nmEl && !('fill_paint_factor' in nmEl),
      `got ${JSON.stringify(nmEl?.fill_paint_factor)}`);
    assert('normal: KEIN stroke_paint_factor-Feld (==1 → omitted, NIT)',
      nmEl && !('stroke_paint_factor' in nmEl),
      `got ${JSON.stringify(nmEl?.stroke_paint_factor)}`);

    // ── PAINT-SERVER (sauber, volle Opacity) → konservativ NICHT tot ─────────────
    console.log('\n=== PAINT-SERVER: fill=url(#grad) (volle Opacity) → konservativ painted=true ===');
    const ps = await inspect(SVG_PAINT_SERVER);
    const psEl = byId(ps.structured?.scene?.elements, 'r');
    assert('paint-server: #r in scene.elements', !!psEl);
    assert('paint-server: paint_visible NICHT false (Server-Tinte konservativ)',
      psEl?.paint_visible !== false, `got ${JSON.stringify(psEl?.paint_visible)}`);
    assert('paint-server: KEINE PAINT_NOT_VISIBLE-Warning', !hasWarn(psEl, 'PAINT_NOT_VISIBLE'),
      `warnings=${JSON.stringify(psEl?.warnings)}`);

    // ── epsilon-GRENZE: fill-opacity:0.01 → sichtbar (EXAKT-0, kein epsilon) ─────
    console.log('\n=== epsilon-GRENZE: fill-opacity:0.01 → sichtbar (kein paint_visible) ===');
    const ep = await inspect(SVG_EPSILON);
    const epEl = byId(ep.structured?.scene?.elements, 'r');
    assert('epsilon: #r in scene.elements', !!epEl);
    assert('epsilon: paint_visible NICHT false (0.01≠0, EXAKT-0-Schwelle)',
      epEl?.paint_visible !== false, `got ${JSON.stringify(epEl?.paint_visible)}`);
    assert('epsilon: fill_paint_factor ≈ 0.01 (>0)', (epEl?.fill_paint_factor ?? 0) > 0,
      `got ${JSON.stringify(epEl?.fill_paint_factor)}`);

    // ── ANIMIERT-tot: fill-opacity 0→0-Keyframe → paint_visible:false ───────────
    console.log('\n=== ANIMIERT-tot: @keyframes fill-opacity 0→0 (max=0) → paint_visible:false ===');
    const ad = await inspect(SVG_ANIM_DEAD);
    const adEl = byId(ad.structured?.scene?.elements, 'ghost');
    assert('anim-dead: #ghost in scene.elements', !!adEl,
      `ids=${JSON.stringify((ad.structured?.scene?.elements || []).map((e) => e.id))}`);
    assert('anim-dead: paint_visible === false (Keyframe-max=0 → permanent tot)',
      adEl?.paint_visible === false, `got ${JSON.stringify(adEl?.paint_visible)}`);
    assert('anim-dead: trägt PAINT_NOT_VISIBLE-Warning', hasWarn(adEl, 'PAINT_NOT_VISIBLE'),
      `warnings=${JSON.stringify(adEl?.warnings)}`);

    // ── HÄRTUNG #1 (COLOR-ALPHA): transparent / rgba0 / currentColor→transparent ─
    console.log('\n=== HÄRTUNG #1 COLOR-ALPHA: fill=transparent/rgba0/currentColor-transp → paint_visible:false ===');
    for (const [label, svg] of [
      ['transparent', SVG_TRANSPARENT_FILL],
      ['rgba(...,0)', SVG_RGBA0_FILL],
      ['currentColor→transparent', SVG_CURRENTCOLOR_TRANSP],
    ]) {
      const res = await inspect(svg);
      const el = byId(res.structured?.scene?.elements, 'ghost');
      assert(`color-alpha [${label}]: #ghost in scene.elements`, !!el,
        `ids=${JSON.stringify((res.structured?.scene?.elements || []).map((e) => e.id))}`);
      assert(`color-alpha [${label}]: paint_visible === false (Farb-Alpha 0)`,
        el?.paint_visible === false, `got ${JSON.stringify(el?.paint_visible)}`);
      assert(`color-alpha [${label}]: trägt PAINT_NOT_VISIBLE`, hasWarn(el, 'PAINT_NOT_VISIBLE'),
        `warnings=${JSON.stringify(el?.warnings)}`);
      assert(`color-alpha [${label}]: bbox_reliability bleibt reliable`,
        el?.bbox_reliability === 'reliable', `got ${JSON.stringify(el?.bbox_reliability)}`);
    }

    // ── HÄRTUNG #2 (Paint-Server + fill-opacity:0): Server NICHT kurzschließen ────
    console.log('\n=== HÄRTUNG #2: fill=url(#g) fill-opacity:0 → paint_visible:false (Server nicht kurzgeschlossen) ===');
    const psf = await inspect(SVG_PAINTSERVER_FILLOP0);
    const psfEl = byId(psf.structured?.scene?.elements, 'ghost');
    assert('server-fillop0: #ghost in scene.elements', !!psfEl,
      `ids=${JSON.stringify((psf.structured?.scene?.elements || []).map((e) => e.id))}`);
    assert('server-fillop0: paint_visible === false (Paint-Opacity gated auch Server)',
      psfEl?.paint_visible === false, `got ${JSON.stringify(psfEl?.paint_visible)}`);
    assert('server-fillop0: trägt PAINT_NOT_VISIBLE', hasWarn(psfEl, 'PAINT_NOT_VISIBLE'),
      `warnings=${JSON.stringify(psfEl?.warnings)}`);
    // Regress-Schutz: Paint-Server OHNE fill-opacity:0 bleibt sichtbar (Härtung #2
    // darf den SVG_PAINT_SERVER-Fall mit fill-opacity:0 kippen, aber NICHT den
    // sauberen Gradient — der wurde oben bereits geprüft).

    // ── HÄRTUNG #3 (Tag): <image fill-opacity:0> → NICHT paint_visible:false ──────
    console.log('\n=== HÄRTUNG #3 TAG: <image fill-opacity:0> (Raster) → NICHT paint_visible:false ===');
    const imgRes = await inspect(SVG_IMAGE_FILLOP0);
    const imgEl = byId(imgRes.structured?.scene?.elements, 'img');
    assert('image-fillop0: #img in scene.elements', !!imgEl,
      `ids=${JSON.stringify((imgRes.structured?.scene?.elements || []).map((e) => e.id))}`);
    assert('image-fillop0: paint_visible NICHT false (Raster, nicht fill-getrieben)',
      imgEl?.paint_visible !== false, `got ${JSON.stringify(imgEl?.paint_visible)}`);
    assert('image-fillop0: KEINE PAINT_NOT_VISIBLE-Warning', !hasWarn(imgEl, 'PAINT_NOT_VISIBLE'),
      `warnings=${JSON.stringify(imgEl?.warnings)}`);

    // ── HÄRTUNG #4 (Vererbung+Anim): Blatt erbt animierte fill-opacity 0→1 ───────
    console.log('\n=== HÄRTUNG #4: Blatt erbt fill-opacity von animiertem <g> (0→1) → NICHT tot ===');
    const ia = await inspect(SVG_INHERIT_ANIM);
    const iaEl = byId(ia.structured?.scene?.elements, 'leaf');
    assert('inherit-anim: #leaf in scene.elements', !!iaEl,
      `ids=${JSON.stringify((ia.structured?.scene?.elements || []).map((e) => e.id))}`);
    assert('inherit-anim: paint_visible NICHT false (animierter Vorfahr rettet den Kanal)',
      iaEl?.paint_visible !== false, `got ${JSON.stringify(iaEl?.paint_visible)}`);
    assert('inherit-anim: KEINE PAINT_NOT_VISIBLE-Warning', !hasWarn(iaEl, 'PAINT_NOT_VISIBLE'),
      `warnings=${JSON.stringify(iaEl?.warnings)}`);

    // ── HÄRTUNG #4 KONTROLLE (Shadowing): statischer <g fill-opacity:0> → tot ─────
    console.log('\n=== HÄRTUNG #4 KONTROLLE: Blatt erbt fill-opacity:0 von STATISCHEM <g> → paint_visible:false ===');
    const is0 = await inspect(SVG_INHERIT_STATIC0);
    const is0El = byId(is0.structured?.scene?.elements, 'leaf');
    assert('inherit-static0: #leaf in scene.elements', !!is0El,
      `ids=${JSON.stringify((is0.structured?.scene?.elements || []).map((e) => e.id))}`);
    assert('inherit-static0: paint_visible === false (statischer Vorfahr rettet NICHT — Anim-Diskriminanz)',
      is0El?.paint_visible === false, `got ${JSON.stringify(is0El?.paint_visible)}`);
    assert('inherit-static0: trägt PAINT_NOT_VISIBLE', hasWarn(is0El, 'PAINT_NOT_VISIBLE'),
      `warnings=${JSON.stringify(is0El?.warnings)}`);

    // ── KONTROLLE: solide rgba(...,0.5) → sichtbar ───────────────────────────────
    console.log('\n=== KONTROLLE: fill=rgba(255,0,0,0.5) → sichtbar (Color-Alpha 0.5 > 0) ===');
    const r05 = await inspect(SVG_RGBA05_SOLID);
    const r05El = byId(r05.structured?.scene?.elements, 'r');
    assert('rgba05: paint_visible NICHT false (0.5 > 0)', r05El?.paint_visible !== false,
      `got ${JSON.stringify(r05El?.paint_visible)}`);

    // ── PROSA-EHRLICHKEIT (F-AT-6-01, DoD-2): der LLM-zugewandte Haupt-Kanal ─────
    // Vor T1-Prosa: "STATUS: ✓ Alles korrekt" + "rect#ghost: …, red ✓" (Lüge).
    // Nach Fix: STATUS trägt einen Hinweis (NICHT "✓ Alles korrekt"); die
    // ghost-Zeile trägt PAINT_NOT_VISIBLE + ⚠ statt bare ✓. inspect UND analyze
    // teilen formatReport → beide Pfade geprüft.
    const PROSE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
      <rect id="real" x="10" y="10" width="30" height="30" fill="green"/>
      <rect id="ghost" x="50" y="50" width="40" height="40" fill="red" fill-opacity="0" stroke="none"/>
    </svg>`;
    function ghostLine(prose) {
      return prose.split('\n').find((l) => l.includes('#ghost')) || '';
    }
    function realLine(prose) {
      return prose.split('\n').find((l) => l.includes('#real')) || '';
    }
    function statusLine(prose) {
      return prose.split('\n').find((l) => l.startsWith('STATUS:')) || '';
    }

    console.log('\n=== PROSA inspect: paint-totes #ghost ehrlich, #real unverändert ===');
    const pIns = (await inspect(PROSE_SVG)).prose;
    assert('prose-inspect: STATUS NICHT "✓ Alles korrekt"',
      !statusLine(pIns).includes('Alles korrekt'), `STATUS="${statusLine(pIns)}"`);
    assert('prose-inspect: STATUS trägt Hinweis/unsichtbar-Zähler',
      /Hinweis/.test(statusLine(pIns)) && /unsichtbar/.test(statusLine(pIns)),
      `STATUS="${statusLine(pIns)}"`);
    assert('prose-inspect: #ghost-Zeile trägt PAINT_NOT_VISIBLE',
      ghostLine(pIns).includes('PAINT_NOT_VISIBLE'), `line="${ghostLine(pIns)}"`);
    assert('prose-inspect: #ghost-Zeile endet NICHT auf bare "✓"',
      !/✓\s*$/.test(ghostLine(pIns)), `line="${ghostLine(pIns)}"`);
    assert('prose-inspect: #ghost-Zeile trägt ⚠ (degradiertes Status-Glyph)',
      ghostLine(pIns).includes('⚠'), `line="${ghostLine(pIns)}"`);
    assert('prose-inspect: #real-Zeile UNVERÄNDERT (endet auf ✓, kein PAINT-Vermerk)',
      /✓\s*$/.test(realLine(pIns)) && !realLine(pIns).includes('PAINT_NOT_VISIBLE'),
      `line="${realLine(pIns)}"`);

    console.log('\n=== PROSA analyze (gleiches formatReport): identisch ehrlich ===');
    const pAna = (await analyze(PROSE_SVG, [])).prose;
    assert('prose-analyze: STATUS NICHT "✓ Alles korrekt"',
      !statusLine(pAna).includes('Alles korrekt'), `STATUS="${statusLine(pAna)}"`);
    assert('prose-analyze: #ghost-Zeile trägt PAINT_NOT_VISIBLE',
      ghostLine(pAna).includes('PAINT_NOT_VISIBLE'), `line="${ghostLine(pAna)}"`);
    assert('prose-analyze: #ghost-Zeile endet NICHT auf bare "✓"',
      !/✓\s*$/.test(ghostLine(pAna)), `line="${ghostLine(pAna)}"`);

    console.log('\n=== PROSA NEGATIV-KONTROLLE: rein sichtbare Szene → "✓ Alles korrekt" ===');
    const pVis = (await inspect(SVG_NORMAL)).prose;
    assert('prose-negativ: STATUS === "✓ Alles korrekt" (unverändert)',
      statusLine(pVis).includes('Alles korrekt'), `STATUS="${statusLine(pVis)}"`);
    assert('prose-negativ: KEINE PAINT_NOT_VISIBLE-Erwähnung',
      !pVis.includes('PAINT_NOT_VISIBLE'), `prose=${JSON.stringify(pVis)}`);
    assert('prose-negativ: #r-Zeile endet auf ✓',
      /✓\s*$/.test(realLine(pVis) || pVis.split('\n').find((l) => l.includes('#r')) || ''),
      `prose=${JSON.stringify(pVis)}`);

    // ── DETERMINISMUS: 2× byte-identisch ────────────────────────────────────────
    console.log('\n=== DETERMINISMUS: 2× fill-opacity:0 structured byte-identisch ===');
    const d1 = canon((await inspect(SVG_FILL_OPACITY_0)).structured);
    const d2 = canon((await inspect(SVG_FILL_OPACITY_0)).structured);
    assert('determinismus: 2× byte-identisch', d1 === d2,
      `d1!==d2 (len ${d1.length} vs ${d2.length})`);
  } finally {
    await shutdown();
  }

  console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error('Test-Lauf-Fehler:', e);
  process.exit(1);
});
