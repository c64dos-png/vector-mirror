/**
 * test_heal_r6_paint_extent.mjs — HEAL-R6 / T2: Paint-Extent + dash-Presence
 * (F-AT-6-02/03 stroke/Marker-Overflow, DoD-3 · F-AT-6-06 dash-Unsichtbarkeit, DoD-2-Rest)
 *
 * Real-Chromium-Harness (KEINE Mocks), über die ECHTE Pipeline
 * (inspect → structured.scene.elements). Ergänzt test_heal4_paint.mjs (Filter, E4,
 * MUSS 65/0 bleiben) um die ZWEI weiteren Tinten-Quellen außerhalb der reliable-bbox.
 *
 * TEIL A — Paint-EXTENT (F-AT-6-02/03, DoD-3):
 *   Heute (vor T2): has_paint_overflow/visual_bbox hingen NUR am <filter>. stroke-Tinte
 *   (getBBox ist stroke-blind) + Marker liegen außerhalb der reliable-bbox OHNE Flag.
 *   T2: EIN ExtentSource-Vertrag {present, exceeds, corners|null}, den filter/stroke/
 *   marker gleich erfüllen; EIN Union-Aggregator schreibt visual_bbox/has_paint_overflow
 *   GENAU EINMAL. Analytisch (R9: kein Pixel-Scan): strokeOutset=stroke-width/2×factor,
 *   markerExtent=0.5×hypot(mW,mH)×strokeWidth. Marker-Prüfung VOR dem zero-bbox-Gate
 *   (zero-length-Träger sonst still verschluckt = R6-03-Wurzel).
 *
 * TEIL B — dash-Unsichtbarkeit (F-AT-6-06, DoD-2-Rest):
 *   stroke-dasharray="0 1000" + linecap=butt → 0 sichtbare Pixel → paint_visible:false
 *   (wenn fill auch tot). round/square caps bei dash=0 → Punkte → SICHTBAR (nicht tot).
 *   Mehrdeutiges dasharray → KEINE Falsch-Tot-Behauptung (Blind-Trust: nie falsch-tot).
 *
 * Run direkt: `node tests/integration/test_heal_r6_paint_extent.mjs`
 */
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

// visual_bbox umschließt die geom-bbox (Schranke ⊇ Geometrie).
function contains(outer, ix, iy, iw, ih, eps = 1e-6) {
  return (
    outer &&
    typeof outer === 'object' &&
    outer.x <= ix + eps &&
    outer.y <= iy + eps &&
    outer.x + outer.w >= ix + iw - eps &&
    outer.y + outer.h >= iy + ih - eps
  );
}

const VB = 'width="100" height="100" viewBox="0 0 100 100"';

// ── TEIL A — STROKE-OVERFLOW ──────────────────────────────────────────────────
// Dicke vertikale Linie x=50, y10..90, stroke-width 40. getBBox ist stroke-blind
// (geom-w=0), aber die Tinte malt x∈[30,70]. → has_paint_overflow + visual_bbox.
const SVG_STROKE = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <line id="ln" x1="50" y1="10" x2="50" y2="90" stroke="white" stroke-width="40"/>
</svg>`;

// non-scaling-stroke: vector-effect ist NICHT in der DOMPurify-SVG-Allowlist (auch
// nicht in SANITIZE_ADD_ATTR) → der Sanitizer STRIPPT es VOR dem Render. Der Mirror
// misst also einen normalen (skalierenden) stroke — und der analytische Outset IST
// für diesen tatsächlich gerenderten stroke korrekt (SELBST-KONSISTENT: das, was
// gemessen wird, deckt sich mit der Schranke; KEINE Honesty-Verletzung). Der
// strokeExtentSource-Guard (vector-effect → corners=null) bleibt als Defense-in-Depth
// bestehen, falls die Allowlist je erweitert wird. Hier prüfen wir die REALE Pipeline-
// Wahrheit: numerische visual_bbox (vector-effect gestrippt).
const SVG_NONSCALING = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <line id="ln" x1="50" y1="10" x2="50" y2="90" stroke="white" stroke-width="40" vector-effect="non-scaling-stroke"/>
</svg>`;

// ── TEIL A — MARKER (zero-length-Träger, R6-03-Wurzel) ────────────────────────
// Zero-length-Linie (x1==x2,y1==y2) mit marker-end: geom-bbox 0×0. Marker malt
// sichtbare Tinte. VOR T2: NO_ELEMENTS (still verschluckt). NACH: Element + Flag.
// marker overflow:visible → visual_bbox='not_measurable'.
const SVG_MARKER_ZEROLEN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50">
  <defs><marker id="m" markerWidth="30" markerHeight="30" refX="0" refY="5" overflow="visible">
  <circle cx="0" cy="5" r="15" fill="red"/></marker></defs>
  <line id="a" x1="50" y1="25" x2="50" y2="25" stroke="black" stroke-width="2" marker-end="url(#m)"/>
</svg>`;

// Marker OHNE overflow:visible → numerische visual_bbox (Diagonal-Schranke).
const SVG_MARKER_MEASURABLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50">
  <defs><marker id="m" markerWidth="10" markerHeight="10" refX="5" refY="5">
  <circle cx="5" cy="5" r="4" fill="red"/></marker></defs>
  <line id="b" x1="20" y1="25" x2="80" y2="25" stroke="black" stroke-width="2" marker-end="url(#m)"/>
</svg>`;

// ── TEIL A — NEGATIV-KONTROLLEN ───────────────────────────────────────────────
// fill-only, KEIN stroke, KEIN marker → KEIN Overflow-Flag (Schnitt ist quell-
// spezifisch, kein Over-Flag).
const SVG_FILL_ONLY = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <rect id="r" x="20" y="20" width="40" height="40" fill="red"/>
</svg>`;

// stroke-width:0 → kein Outset → KEIN Overflow (T1 markiert paint_visible:false).
const SVG_STROKEW0 = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <rect id="r" x="20" y="20" width="40" height="40" fill="none" stroke="blue" stroke-width="0"/>
</svg>`;

// ── TEIL B — DASH-UNSICHTBARKEIT ──────────────────────────────────────────────
// dasharray "0 1000" + butt + fill=none → 0 Pixel → paint_visible:false.
const SVG_DASH_DEAD = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <path id="p" d="M10 50 L90 50" fill="none" stroke="black" stroke-width="8" stroke-linecap="butt" stroke-dasharray="0 1000"/>
</svg>`;

// dasharray "0 1000" + ROUND cap → Punkte → SICHTBAR (NICHT tot).
const SVG_DASH_ROUND = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <path id="p" d="M10 50 L90 50" fill="none" stroke="black" stroke-width="8" stroke-linecap="round" stroke-dasharray="0 1000"/>
</svg>`;

// dasharray "0 1000" + butt, ABER fill=red lebt → stroke-tot, fill trägt → NICHT tot.
const SVG_DASH_DEAD_FILL_ALIVE = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <rect id="r" x="10" y="10" width="50" height="50" fill="red" stroke="black" stroke-width="8" stroke-linecap="butt" stroke-dasharray="0 1000"/>
</svg>`;

// NEGATIV-KONTROLLE: sichtbares dash "4 4" → NICHT tot.
const SVG_DASH_VISIBLE = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <path id="p" d="M10 50 L90 50" fill="none" stroke="black" stroke-width="8" stroke-linecap="butt" stroke-dasharray="4 4"/>
</svg>`;

// ── TRIPLE-REVIEW-HÄRTUNGEN (5 reproduzierte Bugs) ────────────────────────────
// #1 GAU: anker-NICHT-zentrierter Marker (refX=0) → die alte 0.5×hypot-Schranke
// UNTER-reportete. Vertex (60,50), userSpaceOnUse mw=mh=10 refX=refY=0 → Tinte
// x∈[60,70] y∈[50,60]. visual_bbox MUSS das enthalten (anker-bewusster Radius).
const SVG_MARKER_REFX0 = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><marker id="m" markerWidth="10" markerHeight="10" refX="0" refY="0" markerUnits="userSpaceOnUse">
  <rect x="0" y="0" width="10" height="10" fill="red"/></marker></defs>
  <path id="p" d="M50 50 H60" fill="none" stroke="black" stroke-width="2" marker-end="url(#m)"/>
</svg>`;

// #1 extrem: refX=-1000 → Anker weit links → Inhalt weit rechts vom Vertex. Die
// Schranke MUSS ⊇ Tinte sein ODER not_measurable (NIE under-report).
const SVG_MARKER_REFX_EXTREME = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><marker id="m" markerWidth="10" markerHeight="10" refX="-1000" refY="0" markerUnits="userSpaceOnUse">
  <rect x="0" y="0" width="10" height="10" fill="red"/></marker></defs>
  <path id="p" d="M50 50 H60" fill="none" stroke="black" stroke-width="2" marker-end="url(#m)"/>
</svg>`;

// #1 viewBox am marker → nicht-triviale Inhalts-Transform → not_measurable.
const SVG_MARKER_VIEWBOX = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><marker id="m" markerWidth="10" markerHeight="10" refX="5" refY="5" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="40" fill="red"/></marker></defs>
  <path id="p" d="M20 50 L80 50" fill="none" stroke="black" stroke-width="2" marker-end="url(#m)"/>
</svg>`;

// #2 dasharray "0 0" (ALLE Werte 0) → SVG2 ignoriert das dasharray → SOLIDE → NICHT tot.
const SVG_DASH_00 = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <path id="p" d="M10 50 L90 50" fill="none" stroke="black" stroke-width="8" stroke-linecap="butt" stroke-dasharray="0 0"/>
</svg>`;

// #3 marker-only (fill=none stroke=none + marker-end) → sichtbar via Marker → NICHT tot.
const SVG_MARKER_ONLY = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><marker id="m" markerWidth="10" markerHeight="10" refX="5" refY="5">
  <circle cx="5" cy="5" r="4" fill="red"/></marker></defs>
  <path id="p" d="M20 50 L80 50" fill="none" stroke="none" marker-end="url(#m)"/>
</svg>`;

// #4 INWARD-Filter (Region < geom). rect geom {40,40,20,20}, Filter obb x=25% y=25%
// w=50% h=50% → Region {45,45,10,10}. Output auf Region geclippt → visual_bbox=Region
// (NICHT geom-Union). Beweist: Filter ist Replacement, nicht Union-Quelle.
const SVG_FILTER_INWARD = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="g" x="25%" y="25%" width="50%" height="50%"><feGaussianBlur stdDeviation="0"/></filter></defs>
  <rect id="r" x="40" y="40" width="20" height="20" fill="red" filter="url(#g)"/>
</svg>`;

(async () => {
  try {
    // ── TEIL A: STROKE-OVERFLOW ───────────────────────────────────────────────
    console.log('=== TEIL A: dicker stroke → has_paint_overflow + visual_bbox (getBBox stroke-blind) ===');
    const st = await inspect(SVG_STROKE);
    const stEl = byId(st.structured?.scene?.elements, 'ln');
    assert('stroke: #ln in scene.elements', !!stEl);
    assert('stroke: has_paint_overflow === true', stEl?.has_paint_overflow === true,
      `got ${JSON.stringify(stEl?.has_paint_overflow)}`);
    assert('stroke: visual_bbox ist Objekt (analytischer Outset)',
      stEl?.visual_bbox && typeof stEl.visual_bbox === 'object',
      `got ${JSON.stringify(stEl?.visual_bbox)}`);
    // Ink ist x∈[30,70]; die Schranke MUSS das enthalten (konservativ ⊇).
    assert('stroke: visual_bbox ⊇ Tinte x∈[30,70]',
      contains(stEl?.visual_bbox, 30, 10, 40, 80),
      `visual_bbox=${JSON.stringify(stEl?.visual_bbox)}`);
    assert('stroke: bbox_reliability bleibt reliable (Geometrie exakt, DoD-3)',
      stEl?.bbox_reliability === 'reliable', `got ${JSON.stringify(stEl?.bbox_reliability)}`);

    console.log('\n=== TEIL A: non-scaling-stroke (Sanitizer strippt vector-effect) → numerisch, selbst-konsistent ===');
    const ns = await inspect(SVG_NONSCALING);
    const nsEl = byId(ns.structured?.scene?.elements, 'ln');
    assert('nonscaling: has_paint_overflow === true', nsEl?.has_paint_overflow === true,
      `got ${JSON.stringify(nsEl?.has_paint_overflow)}`);
    // vector-effect ist gestrippt → der gerenderte stroke skaliert → numerischer Outset
    // ist korrekt für die REALE Render-Tinte (selbst-konsistent, keine Lüge).
    assert('nonscaling: visual_bbox numerisch (vector-effect gestrippt → skalierender stroke)',
      nsEl?.visual_bbox && typeof nsEl.visual_bbox === 'object',
      `got ${JSON.stringify(nsEl?.visual_bbox)}`);
    assert('nonscaling: visual_bbox ⊇ Tinte x∈[30,70] (korrekte Schranke)',
      contains(nsEl?.visual_bbox, 30, 10, 40, 80),
      `visual_bbox=${JSON.stringify(nsEl?.visual_bbox)}`);

    // ── TEIL A: MARKER (zero-length, R6-03-Wurzel) ────────────────────────────
    console.log('\n=== TEIL A: zero-length-Träger + Marker → Element EMITTIERT (nicht NO_ELEMENTS) ===');
    const mz = await inspect(SVG_MARKER_ZEROLEN);
    const mzEl = byId(mz.structured?.scene?.elements, 'a');
    assert('marker-zerolen: structured NICHT null (Element überlebt das Gate)',
      mz.structured !== null, `structured=${JSON.stringify(mz.structured)}`);
    assert('marker-zerolen: #a in scene.elements (Marker hält zero-length-Träger am Leben)',
      !!mzEl, `ids=${JSON.stringify((mz.structured?.scene?.elements || []).map((e) => e.id))}`);
    assert('marker-zerolen: has_paint_overflow === true', mzEl?.has_paint_overflow === true,
      `got ${JSON.stringify(mzEl?.has_paint_overflow)}`);
    assert('marker-zerolen: visual_bbox=not_measurable (marker overflow:visible)',
      mzEl?.visual_bbox === 'not_measurable', `got ${JSON.stringify(mzEl?.visual_bbox)}`);

    console.log('\n=== TEIL A: Marker ohne overflow:visible → numerische visual_bbox ===');
    const mm = await inspect(SVG_MARKER_MEASURABLE);
    const mmEl = byId(mm.structured?.scene?.elements, 'b');
    assert('marker-measurable: has_paint_overflow === true', mmEl?.has_paint_overflow === true,
      `got ${JSON.stringify(mmEl?.has_paint_overflow)}`);
    assert('marker-measurable: visual_bbox ist Objekt (Diagonal-Schranke)',
      mmEl?.visual_bbox && typeof mmEl.visual_bbox === 'object',
      `got ${JSON.stringify(mmEl?.visual_bbox)}`);
    // halfDiag = 0.5×hypot(10,10)×strokeWidth(2) ≈ 14.14. Träger x∈[20,80].
    assert('marker-measurable: visual_bbox ⊇ Träger x∈[20,80]',
      contains(mmEl?.visual_bbox, 20, 25, 60, 0),
      `visual_bbox=${JSON.stringify(mmEl?.visual_bbox)}`);

    // ── TEIL A: NEGATIV-KONTROLLEN ────────────────────────────────────────────
    console.log('\n=== TEIL A NEGATIV: fill-only (kein stroke/marker) → KEIN Overflow-Flag ===');
    const fo = await inspect(SVG_FILL_ONLY);
    const foEl = byId(fo.structured?.scene?.elements, 'r');
    assert('fill-only: #r in scene.elements', !!foEl);
    assert('fill-only: KEIN has_paint_overflow-Feld (Negativ-Kontrolle)',
      foEl && !('has_paint_overflow' in foEl), `got ${JSON.stringify(foEl?.has_paint_overflow)}`);
    assert('fill-only: KEIN visual_bbox-Feld', foEl && !('visual_bbox' in foEl),
      `got ${JSON.stringify(foEl?.visual_bbox)}`);

    console.log('\n=== TEIL A NEGATIV: stroke-width:0 → kein Outset, KEIN Overflow ===');
    const sw0 = await inspect(SVG_STROKEW0);
    const sw0El = byId(sw0.structured?.scene?.elements, 'r');
    assert('strokew0: #r in scene.elements', !!sw0El);
    assert('strokew0: KEIN has_paint_overflow (stroke-width:0 → kein Extent)',
      sw0El && !('has_paint_overflow' in sw0El), `got ${JSON.stringify(sw0El?.has_paint_overflow)}`);
    assert('strokew0: paint_visible === false (T1: kein malender Kanal)',
      sw0El?.paint_visible === false, `got ${JSON.stringify(sw0El?.paint_visible)}`);

    // ── TEIL B: DASH-UNSICHTBARKEIT ───────────────────────────────────────────
    console.log('\n=== TEIL B: dasharray "0 1000" + butt + fill=none → paint_visible:false ===');
    const dd = await inspect(SVG_DASH_DEAD);
    const ddEl = byId(dd.structured?.scene?.elements, 'p');
    assert('dash-dead: #p in scene.elements', !!ddEl,
      `ids=${JSON.stringify((dd.structured?.scene?.elements || []).map((e) => e.id))}`);
    assert('dash-dead: paint_visible === false (alle ON-Dashes 0 + butt → 0 Pixel)',
      ddEl?.paint_visible === false, `got ${JSON.stringify(ddEl?.paint_visible)}`);
    assert('dash-dead: trägt PAINT_NOT_VISIBLE-Warning', hasWarn(ddEl, 'PAINT_NOT_VISIBLE'),
      `warnings=${JSON.stringify(ddEl?.warnings)}`);
    assert('dash-dead: KEIN has_paint_overflow (dash-tot → kein Phantom-Outset)',
      ddEl && !('has_paint_overflow' in ddEl), `got ${JSON.stringify(ddEl?.has_paint_overflow)}`);

    console.log('\n=== TEIL B: dasharray "0 1000" + ROUND cap → Punkte → SICHTBAR (nicht tot) ===');
    const dr = await inspect(SVG_DASH_ROUND);
    const drEl = byId(dr.structured?.scene?.elements, 'p');
    assert('dash-round: paint_visible NICHT false (round-cap → Punkte sichtbar)',
      drEl?.paint_visible !== false, `got ${JSON.stringify(drEl?.paint_visible)}`);
    assert('dash-round: KEINE PAINT_NOT_VISIBLE-Warning', !hasWarn(drEl, 'PAINT_NOT_VISIBLE'),
      `warnings=${JSON.stringify(drEl?.warnings)}`);

    console.log('\n=== TEIL B: dash-tot stroke ABER fill=red lebt → NICHT paint_visible:false ===');
    const dfa = await inspect(SVG_DASH_DEAD_FILL_ALIVE);
    const dfaEl = byId(dfa.structured?.scene?.elements, 'r');
    assert('dash-fill-alive: paint_visible NICHT false (fill trägt die Tinte)',
      dfaEl?.paint_visible !== false, `got ${JSON.stringify(dfaEl?.paint_visible)}`);

    console.log('\n=== TEIL B NEGATIV: sichtbares dash "4 4" → NICHT tot ===');
    const dv = await inspect(SVG_DASH_VISIBLE);
    const dvEl = byId(dv.structured?.scene?.elements, 'p');
    assert('dash-visible: paint_visible NICHT false (ON-Segmente > 0 → sichtbar)',
      dvEl?.paint_visible !== false, `got ${JSON.stringify(dvEl?.paint_visible)}`);
    assert('dash-visible: has_paint_overflow === true (sichtbarer stroke → Outset)',
      dvEl?.has_paint_overflow === true, `got ${JSON.stringify(dvEl?.has_paint_overflow)}`);

    // ── PROSA-EHRLICHKEIT (BEIDE KANÄLE): Overflow im LLM-Kanal sichtbar ────────
    console.log('\n=== PROSA: Tinten-Überlauf im Prosa-Kanal ehrlich (nicht "✓ Alles korrekt") ===');
    const pr = await inspect(SVG_STROKE);
    const statusLine = pr.prose.split('\n').find((l) => l.startsWith('STATUS:')) || '';
    const lnLine = pr.prose.split('\n').find((l) => l.includes('#ln')) || '';
    assert('prose: STATUS NICHT "✓ Alles korrekt" (Overflow ist ein Hinweis)',
      !statusLine.includes('Alles korrekt'), `STATUS="${statusLine}"`);
    assert('prose: STATUS nennt Tinten-Überlauf', /Tinten-Überlauf/.test(statusLine),
      `STATUS="${statusLine}"`);
    assert('prose: #ln-Zeile trägt has_paint_overflow-Vermerk',
      lnLine.includes('has_paint_overflow'), `line="${lnLine}"`);
    assert('prose: #ln-Zeile endet NICHT auf bare "✓" (degradiert zu ⚠)',
      !/✓\s*$/.test(lnLine) && lnLine.includes('⚠'), `line="${lnLine}"`);

    // ── TRIPLE-REVIEW #1: anker-bewusster, rotations-sicherer Marker-Radius ─────
    console.log('\n=== TR#1: Marker refX=0 (nicht-zentriert) → visual_bbox ⊇ reale Tinte (kein Under-Report) ===');
    const r0 = await inspect(SVG_MARKER_REFX0);
    const r0El = byId(r0.structured?.scene?.elements, 'p');
    assert('marker-refX0: has_paint_overflow === true', r0El?.has_paint_overflow === true,
      `got ${JSON.stringify(r0El?.has_paint_overflow)}`);
    // Vertex (60,50), Tinte x∈[60,70] y∈[50,60]. Schranke MUSS das ⊇ (oder not_measurable).
    assert('marker-refX0: visual_bbox ⊇ Tinte x∈[60,70] y∈[50,60] ODER not_measurable',
      r0El?.visual_bbox === 'not_measurable' || contains(r0El?.visual_bbox, 60, 50, 10, 10),
      `visual_bbox=${JSON.stringify(r0El?.visual_bbox)}`);

    console.log('\n=== TR#1: Marker refX=-1000 (extrem) → ⊇ Tinte x∈[1060,1070] ODER not_measurable ===');
    const rx = await inspect(SVG_MARKER_REFX_EXTREME);
    const rxEl = byId(rx.structured?.scene?.elements, 'p');
    assert('marker-extreme: has_paint_overflow === true', rxEl?.has_paint_overflow === true,
      `got ${JSON.stringify(rxEl?.has_paint_overflow)}`);
    assert('marker-extreme: visual_bbox ⊇ Tinte x∈[1060,1070] ODER not_measurable (NIE under-report)',
      rxEl?.visual_bbox === 'not_measurable' || contains(rxEl?.visual_bbox, 1060, 50, 10, 10),
      `visual_bbox=${JSON.stringify(rxEl?.visual_bbox)}`);

    console.log('\n=== TR#1: Marker mit viewBox → not_measurable (Inhalts-Transform nicht-trivial) ===');
    const mvb = await inspect(SVG_MARKER_VIEWBOX);
    const mvbEl = byId(mvb.structured?.scene?.elements, 'p');
    assert('marker-viewbox: has_paint_overflow === true', mvbEl?.has_paint_overflow === true,
      `got ${JSON.stringify(mvbEl?.has_paint_overflow)}`);
    assert('marker-viewbox: visual_bbox === not_measurable',
      mvbEl?.visual_bbox === 'not_measurable', `got ${JSON.stringify(mvbEl?.visual_bbox)}`);

    // ── TRIPLE-REVIEW #2: dasharray "0 0" → SOLIDE (NICHT tot) ──────────────────
    console.log('\n=== TR#2: dasharray "0 0" (alle Werte 0) → SVG2 ignoriert → solide → NICHT tot ===');
    const d00 = await inspect(SVG_DASH_00);
    const d00El = byId(d00.structured?.scene?.elements, 'p');
    assert('dash-00: paint_visible NICHT false (alle dash-Werte 0 → dasharray ignoriert → solide)',
      d00El?.paint_visible !== false, `got ${JSON.stringify(d00El?.paint_visible)}`);
    assert('dash-00: KEINE PAINT_NOT_VISIBLE-Warning', !hasWarn(d00El, 'PAINT_NOT_VISIBLE'),
      `warnings=${JSON.stringify(d00El?.warnings)}`);

    // ── TRIPLE-REVIEW #3: marker-only Paint ────────────────────────────────────
    console.log('\n=== TR#3: marker-only (fill=none stroke=none + marker) → sichtbar, NICHT tot ===');
    const mo = await inspect(SVG_MARKER_ONLY);
    const moEl = byId(mo.structured?.scene?.elements, 'p');
    assert('marker-only: #p emittiert (Marker hält das Element am Leben)', !!moEl,
      `ids=${JSON.stringify((mo.structured?.scene?.elements || []).map((e) => e.id))}`);
    assert('marker-only: paint_visible NICHT false (Marker ist ein Paint-Kanal)',
      moEl?.paint_visible !== false, `got ${JSON.stringify(moEl?.paint_visible)}`);
    assert('marker-only: KEINE PAINT_NOT_VISIBLE-Warning', !hasWarn(moEl, 'PAINT_NOT_VISIBLE'),
      `warnings=${JSON.stringify(moEl?.warnings)}`);
    assert('marker-only: has_paint_overflow === true (Marker malt außerhalb)',
      moEl?.has_paint_overflow === true, `got ${JSON.stringify(moEl?.has_paint_overflow)}`);

    // ── TRIPLE-REVIEW #4: INWARD-Filter (Replacement, nicht Union) ──────────────
    console.log('\n=== TR#4: inward-Filter (Region < geom) → visual_bbox = Region (NICHT geom-Union) ===');
    const fi = await inspect(SVG_FILTER_INWARD);
    const fiEl = byId(fi.structured?.scene?.elements, 'r');
    assert('inward-filter: has_paint_overflow === true', fiEl?.has_paint_overflow === true,
      `got ${JSON.stringify(fiEl?.has_paint_overflow)}`);
    assert('inward-filter: visual_bbox === Region {45,45,10,10} (Filter clippt, kein geom-Over-Report)',
      fiEl?.visual_bbox &&
        typeof fiEl.visual_bbox === 'object' &&
        Math.abs(fiEl.visual_bbox.x - 45) < 0.5 &&
        Math.abs(fiEl.visual_bbox.y - 45) < 0.5 &&
        Math.abs(fiEl.visual_bbox.w - 10) < 0.5 &&
        Math.abs(fiEl.visual_bbox.h - 10) < 0.5,
      `visual_bbox=${JSON.stringify(fiEl?.visual_bbox)}`);

    // ── TRIPLE-REVIEW #5: WARNING-INVARIANTE (Transport über Pos ≥8) ────────────
    console.log('\n=== TR#5: has_paint_overflow trägt PAINT_OVERFLOW-Warning → Transport via truncated_warnings ===');
    let manyInner = '';
    for (let i = 0; i < 8; i++)
      manyInner += `<rect id="r${i}" x="${i * 5}" y="0" width="3" height="3" fill="green"/>`;
    manyInner += `<rect id="ov" x="50" y="50" width="20" height="20" fill="none" stroke="blue" stroke-width="10"/>`;
    const SVG_MANY = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>${manyInner}</svg>`;
    const many = await inspect(SVG_MANY);
    const tw = many.structured?.meta?.truncated_warnings || [];
    assert('warning-invariante: PAINT_OVERFLOW erreicht meta.truncated_warnings (Pos ≥8 nicht still verloren)',
      tw.some((t) => Array.isArray(t.warnings) && t.warnings.includes('PAINT_OVERFLOW')),
      `truncated_warnings=${JSON.stringify(tw)}`);
    // Direkt-Kontrolle: ein Overflow-Element auf Pos <7 trägt die Warning am Element.
    const stWarn = byId((await inspect(SVG_STROKE)).structured?.scene?.elements, 'ln');
    assert('warning-invariante: Overflow-Element (Pos <7) trägt PAINT_OVERFLOW am Element',
      hasWarn(stWarn, 'PAINT_OVERFLOW'), `warnings=${JSON.stringify(stWarn?.warnings)}`);

    // ── DETERMINISMUS (R9): analytische Outsets 2× byte-identisch ──────────────
    console.log('\n=== DETERMINISMUS: stroke/marker/dash 2× byte-identisch (R9, kein Pixel/RNG/Zeit) ===');
    for (const [label, svg] of [
      ['stroke', SVG_STROKE],
      ['marker', SVG_MARKER_MEASURABLE],
      ['dash', SVG_DASH_DEAD],
    ]) {
      const a = canon((await inspect(svg)).structured);
      const b = canon((await inspect(svg)).structured);
      assert(`determinismus [${label}]: 2× byte-identisch`, a === b,
        `a!==b (len ${a.length} vs ${b.length})`);
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
