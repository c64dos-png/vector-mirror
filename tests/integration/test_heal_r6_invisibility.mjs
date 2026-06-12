/**
 * test_heal_r6_invisibility.mjs — HEAL-R6 Variante 1: 3-wertiger paint_visible-
 * Vertrag (F-AT-6-07, DoD-2-Schwanz, Invisibility-Root)
 *
 * Real-Chromium-Harness (KEINE Mocks), über die ECHTE Pipeline
 * (inspect/analyze → structured.scene.elements + prose). Schließt den
 * Unsichtbarkeits-SCHWANZ, den T1/T2 (Skalar-Modulatoren) offen ließen.
 *
 * DIE LÜGE (vor Variante 1): clip-path-auf-leere-Region + mask=schwarz + scale(0)
 * + Vorfahr-Viewport-Clip → 0 sichtbare Pixel, aber als reliable+sichtbar gemeldet.
 * Der paintVisible-OR hatte KEINEN räumlichen Masken-Term.
 *
 * DIE HEILUNG (raster-frei, KEIN Pixel-Scan, R9 @t=0): EIN maskDead-Schreiber im
 * paintVisible-OR mit 3-wertigem Vertrag (false | 'indeterminate' | absent),
 * Pessimismus-Leiter B1 ≻ B3 ≻ B4:
 *   B1 CTM-Determinante:  det(userM)===0 ∧ endlich → false; nicht-endlich → indet.
 *   B3 Vorfahr-Viewport-Clip: Welt-bbox ∩ Root-VP leer ∧ vpSafe → false;
 *                             nested/overflow:visible → 'indeterminate'.
 *   B4 Honest-Flag-Else:  {clip-path|mask|pattern|filter} present, von B1/B3 NICHT
 *                         entschieden → 'indeterminate' + PAINT_PRESENCE_INDETERMINATE.
 *
 * VERTRAG:
 *   scale(0) (self & Vorfahr)          → paint_visible:false + PAINT_NOT_VISIBLE.
 *   einachsiger Kollaps scale(0,1)     → false (det=0, 0 Fläche).
 *   Vorfahr-overflow:hidden außerhalb  → false (Welt-bbox ∩ Root-VP leer).
 *   clip-leere-Region                  → 'indeterminate' + PAINT_PRESENCE_INDETERMINATE.
 *   mask-schwarz                       → 'indeterminate' (od. false; raster-frei
 *                                        nicht entscheidbar → ehrlich unbestimmt).
 *   clip-NICHT-leere-Region            → 'indeterminate' (NICHT false — nie falsch-tot).
 *   filter present                     → 'indeterminate' (B4).
 *   bbox_reliability bleibt reliable (NUR die Tinten-Behauptung graduiert).
 *   NEGATIV-KONTROLLE: normales rect / scale(1) → KEIN paint_visible-Feld.
 *   PROSA: indeterminate-Element ehrlich „Sichtbarkeit unbestimmt", NICHT lebendig;
 *          sichtbare Szene unverändert „✓ Alles korrekt".
 *   MCP-SCHEMA: ein inspect, das 'indeterminate' emittiert, validiert gegen die
 *          registrierte outputSchema (Union false|'indeterminate' akzeptiert).
 *   DETERMINISMUS: 2× byte-identisch.
 *
 * Run direkt: `node tests/integration/test_heal_r6_invisibility.mjs`
 *
 * ── V2-PRÄZISION (Phase 1 ALIVE-Whitelist, additiv auf V1) ────────────────────
 * Die V1-B4-Pauschale flaggte JEDEN present-Operator (filter/mask/pattern/gradient/
 * clip) zu 'indeterminate' — auch einen normalen Blur/Schatten (Rauschen auf tinten-
 * reichen SVGs). V2 ersetzt sie durch einen Per-Operator-classify ('dead'|'alive'|
 * 'indeterminate'); ALLE alive ⇒ KEIN Eingriff (kein Feld = Rausch-Heilung). NUR 4
 * ALIVE-Prädikate scharf (KEINE DEAD-Regeln in Phase 1):
 *   FILTER-alive:   feGaussianBlur/feOffset/feMerge/feDropShadow, in∈{SourceGraphic,
 *                   SourceAlpha,leer}, unverzweigt, count===1 (K1 feSpecular NIE,
 *                   K2 feMorphology NIE).
 *   MASK-alive:     Luminanz-Maske (mask-type+mask-mode), ≥1 nicht-schwarzes opakes
 *                   voll-bbox-deckendes Solid-Kind.
 *   GRADIENT-alive: ≥1 Stop stop-opacity>0 ∧ color-α>0, paint-kanal-gekoppelt, kein
 *                   gradientTransform/currentColor/var.
 *   CLIP-alive [D]: fehlend/none/ungültig → SICHTBAR (NIE dead) + basic-shape die die
 *                   geom-bbox voll umschließt (inset(0)/voll-rect).
 * KETTE: ein nicht-alive Operator kontaminiert → 'indeterminate' (monoton pessimistisch,
 * NIE falsch-sichtbar). B3-NESTED-FIX: Element außerhalb nested-<svg overflow:hidden>
 * → 'indeterminate' (war undefined = Lüge).
 */
import { z } from 'zod';
import { inspect, analyze, shutdown } from '../../src/pipeline.js';
import { analyzeOutput } from '../../src/interface/schema.js';

// analyzeOutput ist die registrierte MCP-outputSchema als roher z.object-Shape
// (tools.js wrappt sie). Hier 1:1 als z.object validieren — die paint_visible-Union
// MUSS sowohl false als auch 'indeterminate' aus dem ECHTEN Renderer akzeptieren.
const analyzeOutputSchema = z.object(analyzeOutput);

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

// V2 ALIVE = der Renderer setzt KEIN paint_visible-Feld (kein Eingriff = Rausch-
// Heilung) UND KEINE PAINT_PRESENCE_INDETERMINATE/PAINT_NOT_VISIBLE-Warning.
function isAlive(el) {
  return (
    !!el &&
    !('paint_visible' in el) &&
    !hasWarn(el, 'PAINT_PRESENCE_INDETERMINATE') &&
    !hasWarn(el, 'PAINT_NOT_VISIBLE')
  );
}

// Hilfs-Inspektion: liefert das #g-Element ODER undefined.
async function inspectG(svg) {
  const out = await inspect(svg);
  return byId(out.structured?.scene?.elements, 'g');
}

const VB = 'width="100" height="100" viewBox="0 0 100 100"';

// ── B1: CTM-Determinante (scale(0) ist transform-blind für getBBox) ────────────
// scale(0) am Element selbst → det(userM)=0 → 0 Fläche → 0 Tinte.
const SVG_SCALE0_SELF = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <rect id="g" x="10" y="10" width="50" height="50" fill="red" transform="scale(0)"/>
</svg>`;
// scale(0) an einem Vorfahr-<g> → der Kollaps komponiert in userM → ebenfalls tot.
const SVG_SCALE0_ANCESTOR = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <g transform="scale(0)"><rect id="g" x="10" y="10" width="50" height="50" fill="red"/></g>
</svg>`;
// einachsiger Kollaps scale(0,1): det = 0*1 − 0*0 = 0 → 0 Fläche → tot.
const SVG_SCALE0_X = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <rect id="g" x="10" y="10" width="30" height="30" fill="red" transform="scale(0,1)"/>
</svg>`;

// ── B3: Vorfahr-Viewport-Clip (Element ganz außerhalb des Root-Viewports) ──────
// rect bei (500,500) liegt komplett außerhalb 0..100 → Welt-bbox ∩ Root-VP leer,
// direkt im Root-VP (vpSafe='root') → der Default-overflow:hidden des äußeren <svg>
// clippt es weg → 0 sichtbare Pixel → false.
const SVG_VP_CLIP_OUTSIDE = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <rect id="g" x="500" y="500" width="50" height="50" fill="red"/>
</svg>`;
// KONTROLLE: ganz INNERHALB → nicht tot (kein paint_visible).
const SVG_VP_CLIP_INSIDE = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <rect id="g" x="10" y="10" width="50" height="50" fill="red"/>
</svg>`;

// ── B4: räumliche Masken-Operatoren present, raster-frei NICHT entscheidbar ────
// clip-path auf leere 0×0-Region: die Tinte IST geclippt, aber raster-frei nicht
// als 0/≠0 beweisbar → ehrlich 'indeterminate' (B2 aufgeschoben).
const SVG_CLIP_EMPTY = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><clipPath id="cp"><rect x="0" y="0" width="0" height="0"/></clipPath></defs>
  <rect id="g" x="10" y="10" width="50" height="50" fill="red" clip-path="url(#cp)"/>
</svg>`;
// mask=schwarz (luminance 0 → α 0): 0 sichtbare Pixel, raster-frei nicht beweisbar.
const SVG_MASK_BLACK = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><mask id="m"><rect x="0" y="0" width="100" height="100" fill="black"/></mask></defs>
  <rect id="g" x="10" y="10" width="50" height="50" fill="red" mask="url(#m)"/>
</svg>`;
// clip auf TEIL-Region (kleines rect, deckt die geom-bbox NICHT voll): der Operator
// schneidet positionsabhängig → NICHT false (nie falsch-tot), ehrlich 'indeterminate'.
const SVG_CLIP_NONEMPTY = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><clipPath id="cp"><rect x="25" y="25" width="10" height="10"/></clipPath></defs>
  <rect id="g" x="10" y="10" width="50" height="50" fill="red" clip-path="url(#cp)"/>
</svg>`;
// fill=pattern: Paint-Server-Pattern → räumlicher Operator → 'indeterminate' (B4).
const SVG_PATTERN_FILL = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><pattern id="p" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="5" cy="5" r="3" fill="red"/></pattern></defs>
  <rect id="g" x="10" y="10" width="50" height="50" fill="url(#p)"/>
</svg>`;

// ── NEGATIV-KONTROLLEN (False-Positive-Schutz, Blast-Radius (a)) ───────────────
const SVG_NORMAL = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <rect id="g" x="10" y="10" width="50" height="50" fill="red"/>
</svg>`;
const SVG_SCALE1 = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <rect id="g" x="10" y="10" width="50" height="50" fill="red" transform="scale(1)"/>
</svg>`;
// rotate(45): det=1 → KEINE Falsch-Tot-Behauptung (Determinante ≠ 0).
const SVG_ROTATE = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <rect id="g" x="20" y="20" width="40" height="40" fill="red" transform="rotate(45 40 40)"/>
</svg>`;

// ══ V2-PRÄZISION FIXTURES ══════════════════════════════════════════════════════
// ── FILTER-alive (kein Feld = Rausch-Heilung) ─────────────────────────────────
const SVG_FILTER_BLUR = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="f"><feGaussianBlur in="SourceGraphic" stdDeviation="2"/></filter></defs>
  <rect id="g" x="20" y="20" width="40" height="40" fill="red" filter="url(#f)"/>
</svg>`;
const SVG_FILTER_OFFSET = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="f"><feOffset in="SourceGraphic" dx="3" dy="3"/></filter></defs>
  <rect id="g" x="20" y="20" width="40" height="40" fill="red" filter="url(#f)"/>
</svg>`;
const SVG_FILTER_DROPSHADOW = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="f"><feDropShadow dx="2" dy="2" stdDeviation="1"/></filter></defs>
  <rect id="g" x="20" y="20" width="40" height="40" fill="red" filter="url(#f)"/>
</svg>`;
const SVG_FILTER_MERGE = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="f"><feGaussianBlur in="SourceGraphic" stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
  <rect id="g" x="20" y="20" width="40" height="40" fill="red" filter="url(#f)"/>
</svg>`;
// K1: feSpecularLighting NIE alive (§9.19 Sa=max(RGB) kann 0).
const SVG_FILTER_SPECULAR = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="f"><feSpecularLighting in="SourceGraphic" surfaceScale="1"><fePointLight x="10" y="10" z="10"/></feSpecularLighting></filter></defs>
  <rect id="g" x="20" y="20" width="40" height="40" fill="red" filter="url(#f)"/>
</svg>`;
// K2: feMorphology NIE alive (Default erode §9.17 frisst Alpha).
const SVG_FILTER_MORPH = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="f"><feMorphology in="SourceGraphic" radius="2"/></filter></defs>
  <rect id="g" x="20" y="20" width="40" height="40" fill="red" filter="url(#f)"/>
</svg>`;
// feComposite in/out → indeterminate (nicht in den 4 ALIVE-Primitiven).
const SVG_FILTER_COMPOSITE = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="f"><feComposite in="SourceGraphic" in2="SourceAlpha" operator="in"/></filter></defs>
  <rect id="g" x="20" y="20" width="40" height="40" fill="red" filter="url(#f)"/>
</svg>`;
// count>1 (self + Vorfahr) → indeterminate (FILTER-alive verlangt count===1).
const SVG_FILTER_COUNT2 = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="f"><feGaussianBlur in="SourceGraphic" stdDeviation="2"/></filter></defs>
  <g filter="url(#f)"><rect id="g" x="20" y="20" width="40" height="40" fill="red" filter="url(#f)"/></g>
</svg>`;
// Vorfahr-<g>-Filter (count===1, alive) → kein Feld (alive klassifiziert am Vorfahr).
const SVG_FILTER_ANCESTOR = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="f"><feGaussianBlur in="SourceGraphic" stdDeviation="2"/></filter></defs>
  <g filter="url(#f)"><rect id="g" x="20" y="20" width="40" height="40" fill="red"/></g>
</svg>`;

// ── MASK-alive ────────────────────────────────────────────────────────────────
// weiße Luminanz-Maske, voll-bbox-deckend → alive (kein Feld).
const SVG_MASK_WHITE = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><mask id="m"><rect x="0" y="0" width="100" height="100" fill="white"/></mask></defs>
  <rect id="g" x="20" y="20" width="40" height="40" fill="red" mask="url(#m)"/>
</svg>`;
// C/K3: mask-type:alpha (≠ luminance) → indeterminate (α-Kanal nicht ableitbar).
const SVG_MASK_ALPHA_TYPE = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><mask id="m" mask-type="alpha"><rect x="0" y="0" width="100" height="100" fill="white"/></mask></defs>
  <rect id="g" x="20" y="20" width="40" height="40" fill="red" mask="url(#m)"/>
</svg>`;
// weiße Maske aber NUR Teildeckung → indeterminate (nicht voll-bbox-deckend).
const SVG_MASK_PARTIAL = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><mask id="m"><rect x="25" y="25" width="10" height="10" fill="white"/></mask></defs>
  <rect id="g" x="20" y="20" width="40" height="40" fill="red" mask="url(#m)"/>
</svg>`;

// ── GRADIENT-alive ────────────────────────────────────────────────────────────
const SVG_GRAD_ALIVE = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><linearGradient id="lg"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs>
  <rect id="g" x="20" y="20" width="40" height="40" fill="url(#lg)"/>
</svg>`;
// alle Stops transparent → indeterminate (Phase-2-DEAD, hier ehrlich unbestimmt).
const SVG_GRAD_TRANSPARENT = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><linearGradient id="lg"><stop offset="0" stop-color="red" stop-opacity="0"/><stop offset="1" stop-color="blue" stop-opacity="0"/></linearGradient></defs>
  <rect id="g" x="20" y="20" width="40" height="40" fill="url(#lg)"/>
</svg>`;
// gradientTransform → indeterminate (positionsabhängig).
const SVG_GRAD_TRANSFORM = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><linearGradient id="lg" gradientTransform="rotate(45)"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs>
  <rect id="g" x="20" y="20" width="40" height="40" fill="url(#lg)"/>
</svg>`;
// currentColor-Stop → indeterminate (nicht statisch auflösbar — RAW-Quelle geprüft).
const SVG_GRAD_CURRENTCOLOR = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><linearGradient id="lg"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="blue"/></linearGradient></defs>
  <rect id="g" x="20" y="20" width="40" height="40" fill="url(#lg)" color="green"/>
</svg>`;
// alive-Gradient (fill) + solider stroke → beide Kanäle malend, kein indet → kein Feld.
const SVG_GRAD_PLUS_STROKE = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><linearGradient id="lg"><stop offset="0" stop-color="red"/></linearGradient></defs>
  <rect id="g" x="20" y="20" width="40" height="40" fill="url(#lg)" stroke="black" stroke-width="2"/>
</svg>`;
// alive-Gradient (fill) + Pattern-stroke → Pattern kontaminiert → indeterminate.
const SVG_GRAD_PLUS_PATTERN = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><linearGradient id="lg"><stop offset="0" stop-color="red"/></linearGradient>
  <pattern id="p" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="5" cy="5" r="3" fill="red"/></pattern></defs>
  <rect id="g" x="20" y="20" width="40" height="40" fill="url(#lg)" stroke="url(#p)" stroke-width="2"/>
</svg>`;

// ── CLIP-alive [ASYMMETRIE D] ─────────────────────────────────────────────────
// voll-deckender clipPath-rect → alive (Tinte passiert ungeschnitten).
const SVG_CLIP_FULL = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><clipPath id="cp"><rect x="0" y="0" width="100" height="100"/></clipPath></defs>
  <rect id="g" x="10" y="10" width="50" height="50" fill="red" clip-path="url(#cp)"/>
</svg>`;
// D: fehlendes clip-Ziel (url ohne Element) → SICHTBAR (§5.1 no clipping, NIE dead).
const SVG_CLIP_MISSING = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <rect id="g" x="10" y="10" width="50" height="50" fill="red" clip-path="url(#nonexistent)"/>
</svg>`;
// CSS inset(0) basic-shape → alive (kein Einzug → voll-deckend).
const SVG_CLIP_INSET0 = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <rect id="g" x="10" y="10" width="50" height="50" fill="red" style="clip-path: inset(0)"/>
</svg>`;
// circle-clipPath: bbox-Deckung ≠ Form-Deckung → indeterminate (kein sicheres Theorem).
const SVG_CLIP_CIRCLE = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><clipPath id="cp"><circle cx="35" cy="35" r="80"/></clipPath></defs>
  <rect id="g" x="10" y="10" width="50" height="50" fill="red" clip-path="url(#cp)"/>
</svg>`;
// clipPathUnits=objectBoundingBox → indeterminate (Transform nicht billig beweisbar).
const SVG_CLIP_OBB = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><clipPath id="cp" clipPathUnits="objectBoundingBox"><rect x="0" y="0" width="1" height="1"/></clipPath></defs>
  <rect id="g" x="10" y="10" width="50" height="50" fill="red" clip-path="url(#cp)"/>
</svg>`;

// ── KETTEN-KONTAMINATION + DEAD-DOMINANZ ──────────────────────────────────────
// alive-Filter + indeterminate-Clip → die Kette kontaminiert → 'indeterminate'.
const SVG_CHAIN_MIXED = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="f"><feGaussianBlur in="SourceGraphic" stdDeviation="2"/></filter>
  <clipPath id="cp"><circle cx="35" cy="35" r="80"/></clipPath></defs>
  <rect id="g" x="10" y="10" width="50" height="50" fill="red" filter="url(#f)" clip-path="url(#cp)"/>
</svg>`;
// ALLE alive (Filter + voll-Clip + weiße Maske) → kein Feld (Rausch-Heilung).
const SVG_CHAIN_ALL_ALIVE = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="f"><feGaussianBlur in="SourceGraphic" stdDeviation="2"/></filter>
  <clipPath id="cp"><rect x="0" y="0" width="100" height="100"/></clipPath>
  <mask id="m"><rect x="0" y="0" width="100" height="100" fill="white"/></mask></defs>
  <rect id="g" x="10" y="10" width="50" height="50" fill="red" filter="url(#f)" clip-path="url(#cp)" mask="url(#m)"/>
</svg>`;
// scale(0) UNTER alive-Clip → B1-dead dominiert (false, NICHT alive — Pessimismus-Leiter).
const SVG_SCALE0_WITH_CLIP = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><clipPath id="cp"><rect x="0" y="0" width="100" height="100"/></clipPath></defs>
  <rect id="g" x="10" y="10" width="50" height="50" fill="red" transform="scale(0)" clip-path="url(#cp)"/>
</svg>`;

// ── B3-NESTED-FIX ─────────────────────────────────────────────────────────────
// Element AUSSERHALB eines verschachtelten <svg overflow:hidden> → 'indeterminate'
// (war undefined = Lüge). rect bei (50,50) liegt außerhalb des nested-VP (0..30).
const SVG_NESTED_OUTSIDE = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <svg x="0" y="0" width="30" height="30" overflow="hidden"><rect id="g" x="50" y="50" width="20" height="20" fill="red"/></svg>
</svg>`;
// KONTROLLE: Element INNERHALB des nested-VP → KEIN Feld (sichtbar).
const SVG_NESTED_INSIDE = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <svg x="0" y="0" width="60" height="60" overflow="hidden"><rect id="g" x="10" y="10" width="20" height="20" fill="red"/></svg>
</svg>`;

// ══ 🔴 REVIEW-RUNDE-2: 5 ECHTE LEAKS (3 false-sichtbar + 2 false-tot) ═══════════
// ROOT-PRINZIP: ALIVE konservativer — feuert NUR auf den trivial-beweisbaren Fall.
// ── Fund1 (CARDINAL false-sichtbar): mask-REGION ignoriert ────────────────────
// maskUnits=userSpaceOnUse width=0 → leere Region → 0px, aber Inhalt weiß-voll-deckend.
const SVG_MASK_EMPTY_REGION = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="0" height="0"><rect x="0" y="0" width="100" height="100" fill="white"/></mask></defs>
  <rect id="g" x="20" y="20" width="40" height="40" fill="red" mask="url(#m)"/>
</svg>`;
// ── Fund3 (false-sichtbar): mask-mode am CONSUMER (C-Korrektur vervollständigt) ─
// mask-mode:alpha am Verbraucher + weiß-aber-fill-opacity:0 → der Luminanz-Beweis gilt nicht.
const SVG_MASK_MODE_ALPHA = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><mask id="m"><rect x="0" y="0" width="100" height="100" fill="white" fill-opacity="0"/></mask></defs>
  <rect id="g" x="20" y="20" width="40" height="40" fill="red" style="mask:url(#m); mask-mode:alpha"/>
</svg>`;
// ── Codex9 (CARDINAL false-sichtbar): B1 CTM-det auf <use>/<image> ────────────
const SVG_USE_SCALE0 = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><rect id="r" x="0" y="0" width="40" height="40" fill="red"/></defs>
  <use id="g" href="#r" x="20" y="20" transform="scale(0)"/>
</svg>`;
const SVG_IMAGE_SCALE0 = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <image id="g" href="data:image/png;base64,iVBORw0KGgo=" x="10" y="10" width="40" height="40" transform="scale(0)"/>
</svg>`;
// KONTROLLE: <use> scale(1) → KEIN Feld (kein false-Eingriff).
const SVG_USE_SCALE1 = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><rect id="r" x="0" y="0" width="40" height="40" fill="red"/></defs>
  <use id="g" href="#r" x="20" y="20"/>
</svg>`;
// ── Codex7 (CARDINAL false-tot): Filter-erzeugt-Paint (feFlood) ───────────────
// fill=none stroke=none + feFlood flood-opacity>0 → MALT trotzdem → NICHT false.
const SVG_FILTER_FEFLOOD = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="f"><feFlood flood-color="green" flood-opacity="1"/></filter></defs>
  <rect id="g" x="20" y="20" width="40" height="40" fill="none" stroke="none" filter="url(#f)"/>
</svg>`;
// feImage generativ (nicht beweisbar) → indeterminate (nicht alive, nicht false).
const SVG_FILTER_FEIMAGE = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="f"><feImage href="data:image/png;base64,iVBORw0KGgo="/></filter></defs>
  <rect id="g" x="20" y="20" width="40" height="40" fill="none" stroke="none" filter="url(#f)"/>
</svg>`;
// KONTROLLE Codex7: feFlood flood-opacity=0 + fill=none → KEIN generierter Paint →
// false bleibt KORREKT (T1: 0 Tinte, kein generativer Gegenbeweis-Paint).
const SVG_FILTER_FEFLOOD_TRANSPARENT = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="f"><feFlood flood-color="green" flood-opacity="0"/></filter></defs>
  <rect id="g" x="20" y="20" width="40" height="40" fill="none" stroke="none" filter="url(#f)"/>
</svg>`;
// ── Codex8 (false-tot): overflow:visible am Root → außen liegende Tinte sichtbar ─
const SVG_OVERFLOW_VISIBLE_OUTSIDE = `<svg xmlns="http://www.w3.org/2000/svg" ${VB} overflow="visible">
  <rect id="g" x="500" y="500" width="50" height="50" fill="red"/>
</svg>`;
// ── KONSERVATIVE NEGATIV-KONTROLLEN (kein false-alive) ────────────────────────
// einfache Default-Maske (objectBoundingBox-Region, mask-mode luminance, weiß-voll)
// → BLEIBT alive (Härtung hat den trivialen Fall NICHT kaputtgemacht).
const SVG_MASK_DEFAULT_WHITE = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><mask id="m"><rect x="0" y="0" width="100" height="100" fill="white"/></mask></defs>
  <rect id="g" x="20" y="20" width="40" height="40" fill="red" mask="url(#m)"/>
</svg>`;
// Maske mit gesetzter Default-äquivalenter Region (x/y/w/h explizit) → indeterminate
// (ROOT-PRINZIP: jedes gesetzte Region-Attribut → konservativ unbestimmt).
const SVG_MASK_EXPLICIT_REGION = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><mask id="m" x="-10%" y="-10%" width="120%" height="120%"><rect x="0" y="0" width="100" height="100" fill="white"/></mask></defs>
  <rect id="g" x="20" y="20" width="40" height="40" fill="red" mask="url(#m)"/>
</svg>`;
// Gradient mit spreadMethod=reflect → indeterminate (nicht-triviales Attribut).
const SVG_GRAD_SPREAD = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><linearGradient id="lg" spreadMethod="reflect"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs>
  <rect id="g" x="20" y="20" width="40" height="40" fill="url(#lg)"/>
</svg>`;

(async () => {
  try {
    // ── B1 — CTM-Determinante ────────────────────────────────────────────────
    console.log('=== B1: scale(0) self → paint_visible:false + PAINT_NOT_VISIBLE ===');
    const s0 = await inspect(SVG_SCALE0_SELF);
    const s0El = byId(s0.structured?.scene?.elements, 'g');
    assert('B1-self: #g in scene.elements (NICHT still zu NO_ELEMENTS geskippt)', !!s0El,
      `ids=${JSON.stringify((s0.structured?.scene?.elements || []).map((e) => e.id))}`);
    assert('B1-self: paint_visible === false', s0El?.paint_visible === false,
      `got ${JSON.stringify(s0El?.paint_visible)}`);
    assert('B1-self: trägt PAINT_NOT_VISIBLE', hasWarn(s0El, 'PAINT_NOT_VISIBLE'),
      `warnings=${JSON.stringify(s0El?.warnings)}`);

    console.log('\n=== B1: scale(0) Vorfahr-<g> → paint_visible:false ===');
    const s0a = await inspect(SVG_SCALE0_ANCESTOR);
    const s0aEl = byId(s0a.structured?.scene?.elements, 'g');
    assert('B1-anc: #g in scene.elements', !!s0aEl,
      `ids=${JSON.stringify((s0a.structured?.scene?.elements || []).map((e) => e.id))}`);
    assert('B1-anc: paint_visible === false', s0aEl?.paint_visible === false,
      `got ${JSON.stringify(s0aEl?.paint_visible)}`);
    assert('B1-anc: bbox_reliability bleibt reliable (Geometrie exakt)',
      s0aEl?.bbox_reliability === 'reliable', `got ${JSON.stringify(s0aEl?.bbox_reliability)}`);

    console.log('\n=== B1: einachsiger Kollaps scale(0,1) → paint_visible:false (det=0) ===');
    const s0x = await inspect(SVG_SCALE0_X);
    const s0xEl = byId(s0x.structured?.scene?.elements, 'g');
    assert('B1-1d: #g in scene.elements', !!s0xEl);
    assert('B1-1d: paint_visible === false (eine Achse kollabiert → 0 Fläche)',
      s0xEl?.paint_visible === false, `got ${JSON.stringify(s0xEl?.paint_visible)}`);

    // ── B3 — Vorfahr-Viewport-Clip ───────────────────────────────────────────
    console.log('\n=== B3: Element außerhalb Root-VP (overflow:hidden) → paint_visible:false ===');
    const vc = await inspect(SVG_VP_CLIP_OUTSIDE);
    const vcEl = byId(vc.structured?.scene?.elements, 'g');
    assert('B3: #g in scene.elements', !!vcEl,
      `ids=${JSON.stringify((vc.structured?.scene?.elements || []).map((e) => e.id))}`);
    assert('B3: paint_visible === false (Welt-bbox ∩ Root-VP leer, vpSafe)',
      vcEl?.paint_visible === false, `got ${JSON.stringify(vcEl?.paint_visible)}`);
    assert('B3: trägt PAINT_NOT_VISIBLE', hasWarn(vcEl, 'PAINT_NOT_VISIBLE'),
      `warnings=${JSON.stringify(vcEl?.warnings)}`);

    console.log('\n=== B3 KONTROLLE: Element innerhalb Root-VP → KEIN paint_visible ===');
    const vi = await inspect(SVG_VP_CLIP_INSIDE);
    const viEl = byId(vi.structured?.scene?.elements, 'g');
    assert('B3-ctrl: #g in scene.elements', !!viEl);
    assert('B3-ctrl: KEIN paint_visible-Feld (innerhalb → sichtbar)',
      viEl && !('paint_visible' in viEl), `got ${JSON.stringify(viEl?.paint_visible)}`);

    // ── B4 — Honest-Flag-Else (räumlicher Operator → 'indeterminate') ─────────
    console.log("\n=== B4: clip-leere-Region → paint_visible:'indeterminate' + Warning ===");
    const ce = await inspect(SVG_CLIP_EMPTY);
    const ceEl = byId(ce.structured?.scene?.elements, 'g');
    assert('B4-clip0: #g in scene.elements', !!ceEl,
      `ids=${JSON.stringify((ce.structured?.scene?.elements || []).map((e) => e.id))}`);
    assert("B4-clip0: paint_visible === 'indeterminate'",
      ceEl?.paint_visible === 'indeterminate', `got ${JSON.stringify(ceEl?.paint_visible)}`);
    assert('B4-clip0: trägt PAINT_PRESENCE_INDETERMINATE',
      hasWarn(ceEl, 'PAINT_PRESENCE_INDETERMINATE'), `warnings=${JSON.stringify(ceEl?.warnings)}`);
    assert('B4-clip0: NICHT als tot markiert (kein PAINT_NOT_VISIBLE)',
      !hasWarn(ceEl, 'PAINT_NOT_VISIBLE'), `warnings=${JSON.stringify(ceEl?.warnings)}`);
    assert('B4-clip0: bbox_reliability bleibt reliable',
      ceEl?.bbox_reliability === 'reliable', `got ${JSON.stringify(ceEl?.bbox_reliability)}`);

    console.log("\n=== B4: mask=schwarz → false ODER 'indeterminate' (raster-frei) ===");
    const mb = await inspect(SVG_MASK_BLACK);
    const mbEl = byId(mb.structured?.scene?.elements, 'g');
    assert('B4-mask: #g in scene.elements', !!mbEl);
    assert("B4-mask: paint_visible false ODER 'indeterminate' (nie reliable+sichtbar)",
      mbEl?.paint_visible === false || mbEl?.paint_visible === 'indeterminate',
      `got ${JSON.stringify(mbEl?.paint_visible)}`);

    console.log("\n=== B4: clip-TEIL-Region (deckt bbox nicht voll) → 'indeterminate' (NICHT false) ===");
    const cn = await inspect(SVG_CLIP_NONEMPTY);
    const cnEl = byId(cn.structured?.scene?.elements, 'g');
    assert('B4-clipNE: #g in scene.elements', !!cnEl);
    assert("B4-clipNE: paint_visible === 'indeterminate' (Teildeckung, Tinte positionsabhängig)",
      cnEl?.paint_visible === 'indeterminate', `got ${JSON.stringify(cnEl?.paint_visible)}`);
    assert('B4-clipNE: NICHT false (nie falsch-tot — clip kann Tinte durchlassen)',
      cnEl?.paint_visible !== false, `got ${JSON.stringify(cnEl?.paint_visible)}`);

    console.log("\n=== B4: fill=pattern → 'indeterminate' (Paint-Server-Pattern) ===");
    const pf = await inspect(SVG_PATTERN_FILL);
    const pfEl = byId(pf.structured?.scene?.elements, 'g');
    assert('B4-pattern: #g in scene.elements', !!pfEl);
    assert("B4-pattern: paint_visible === 'indeterminate'",
      pfEl?.paint_visible === 'indeterminate', `got ${JSON.stringify(pfEl?.paint_visible)}`);

    // ── NEGATIV-KONTROLLEN ───────────────────────────────────────────────────
    console.log('\n=== NEGATIV: normales sichtbares <rect fill=red> → KEIN paint_visible ===');
    const nm = await inspect(SVG_NORMAL);
    const nmEl = byId(nm.structured?.scene?.elements, 'g');
    assert('neg-normal: #g in scene.elements', !!nmEl);
    assert('neg-normal: KEIN paint_visible-Feld',
      nmEl && !('paint_visible' in nmEl), `got ${JSON.stringify(nmEl?.paint_visible)}`);
    assert('neg-normal: KEINE PAINT_NOT_VISIBLE/PAINT_PRESENCE_INDETERMINATE-Warning',
      !hasWarn(nmEl, 'PAINT_NOT_VISIBLE') && !hasWarn(nmEl, 'PAINT_PRESENCE_INDETERMINATE'),
      `warnings=${JSON.stringify(nmEl?.warnings)}`);
    assert('neg-normal: bbox_reliability === reliable',
      nmEl?.bbox_reliability === 'reliable', `got ${JSON.stringify(nmEl?.bbox_reliability)}`);

    console.log('\n=== NEGATIV: scale(1) → nicht tot (det=1) ===');
    const s1 = await inspect(SVG_SCALE1);
    const s1El = byId(s1.structured?.scene?.elements, 'g');
    assert('neg-scale1: #g in scene.elements', !!s1El);
    assert('neg-scale1: KEIN paint_visible-Feld (det=1)',
      s1El && !('paint_visible' in s1El), `got ${JSON.stringify(s1El?.paint_visible)}`);

    console.log('\n=== NEGATIV: rotate(45) → nicht tot (det=1, keine Flächen-Kollaps) ===');
    const ro = await inspect(SVG_ROTATE);
    const roEl = byId(ro.structured?.scene?.elements, 'g');
    assert('neg-rotate: #g in scene.elements', !!roEl);
    assert('neg-rotate: KEIN paint_visible-Feld (Rotation ist flächen-erhaltend)',
      roEl && !('paint_visible' in roEl), `got ${JSON.stringify(roEl?.paint_visible)}`);

    // ════ V2-PRÄZISION: Phase-1-ALIVE-Whitelist + K1-K4/C/D + B3-nested ════════
    // ── FILTER-alive (kein Feld = Rausch-Heilung) ─────────────────────────────
    console.log('\n=== V2 FILTER-alive: normaler Blur → KEIN Feld (Rausch geheilt) ===');
    assert('v2-blur: feGaussianBlur(SourceGraphic) → alive (kein Feld)',
      isAlive(await inspectG(SVG_FILTER_BLUR)));
    assert('v2-offset: feOffset(SourceGraphic) → alive',
      isAlive(await inspectG(SVG_FILTER_OFFSET)));
    assert('v2-dropshadow: feDropShadow → alive',
      isAlive(await inspectG(SVG_FILTER_DROPSHADOW)));
    assert('v2-merge: feGaussianBlur+feMerge (unverzweigt) → alive',
      isAlive(await inspectG(SVG_FILTER_MERGE)));
    assert('v2-anc-filter: Vorfahr-<g>-Blur (count===1) → alive',
      isAlive(await inspectG(SVG_FILTER_ANCESTOR)));

    console.log('\n=== V2 FILTER K1/K2 + nicht-whitelisted → BLEIBT indeterminate ===');
    const specEl = await inspectG(SVG_FILTER_SPECULAR);
    assert('K1: feSpecularLighting NIE alive → indeterminate',
      specEl?.paint_visible === 'indeterminate', `got ${JSON.stringify(specEl?.paint_visible)}`);
    const morphEl = await inspectG(SVG_FILTER_MORPH);
    assert('K2: feMorphology(default erode) NIE alive → indeterminate',
      morphEl?.paint_visible === 'indeterminate', `got ${JSON.stringify(morphEl?.paint_visible)}`);
    assert('v2-composite: feComposite in → indeterminate (nicht in den 4)',
      (await inspectG(SVG_FILTER_COMPOSITE))?.paint_visible === 'indeterminate');
    assert('v2-count2: count>1 (self+Vorfahr) → indeterminate (verlangt count===1)',
      (await inspectG(SVG_FILTER_COUNT2))?.paint_visible === 'indeterminate');

    // ── MASK-alive (C/K3) ─────────────────────────────────────────────────────
    console.log('\n=== V2 MASK-alive: weiße voll-deckende Luminanz-Maske → KEIN Feld ===');
    assert('v2-mask-white: weiße voll-bbox-Maske → alive',
      isAlive(await inspectG(SVG_MASK_WHITE)));
    assert('v2-mask-black: schwarze Maske → indeterminate (BLEIBT)',
      (await inspectG(SVG_MASK_BLACK))?.paint_visible === 'indeterminate');
    assert('C/K3: mask-type=alpha (≠ luminance) → indeterminate',
      (await inspectG(SVG_MASK_ALPHA_TYPE))?.paint_visible === 'indeterminate');
    assert('v2-mask-partial: nur Teildeckung → indeterminate',
      (await inspectG(SVG_MASK_PARTIAL))?.paint_visible === 'indeterminate');

    // ── GRADIENT-alive ────────────────────────────────────────────────────────
    console.log('\n=== V2 GRADIENT-alive: sichtbarer Stop → KEIN Feld ===');
    assert('v2-grad: ≥1 Stop opacity>0 ∧ α>0 → alive',
      isAlive(await inspectG(SVG_GRAD_ALIVE)));
    assert('v2-grad-transparent: alle Stops α=0 → indeterminate (BLEIBT)',
      (await inspectG(SVG_GRAD_TRANSPARENT))?.paint_visible === 'indeterminate');
    assert('v2-grad-transform: gradientTransform → indeterminate',
      (await inspectG(SVG_GRAD_TRANSFORM))?.paint_visible === 'indeterminate');
    assert('v2-grad-currentColor: currentColor-Stop → indeterminate (RAW-Quelle)',
      (await inspectG(SVG_GRAD_CURRENTCOLOR))?.paint_visible === 'indeterminate');
    assert('v2-grad+stroke: alive-Gradient + solider stroke → alive (kein indet-Kanal)',
      isAlive(await inspectG(SVG_GRAD_PLUS_STROKE)));
    assert('v2-grad+pattern: Pattern-stroke kontaminiert → indeterminate',
      (await inspectG(SVG_GRAD_PLUS_PATTERN))?.paint_visible === 'indeterminate');

    // ── CLIP-alive [ASYMMETRIE D] ─────────────────────────────────────────────
    console.log('\n=== V2 CLIP-alive [D]: voll-deckend/fehlend → KEIN Feld ===');
    assert('v2-clip-full: voll-deckender clipPath-rect → alive',
      isAlive(await inspectG(SVG_CLIP_FULL)));
    assert('D: fehlendes clip-Ziel → SICHTBAR/alive (NIE dead, Gegensatz zu mask)',
      isAlive(await inspectG(SVG_CLIP_MISSING)));
    assert('v2-clip-inset0: CSS inset(0) → alive',
      isAlive(await inspectG(SVG_CLIP_INSET0)));
    assert('v2-clip-circle: bbox-Deckung ≠ Form-Deckung → indeterminate',
      (await inspectG(SVG_CLIP_CIRCLE))?.paint_visible === 'indeterminate');
    assert('v2-clip-obb: clipPathUnits=objectBoundingBox → indeterminate',
      (await inspectG(SVG_CLIP_OBB))?.paint_visible === 'indeterminate');

    // ── KETTEN-KONTAMINATION + DEAD-DOMINANZ ──────────────────────────────────
    console.log('\n=== V2 KETTE: ein nicht-alive Operator kontaminiert ===');
    assert('v2-chain-mixed: alive-Filter + indet-Clip → indeterminate (kontaminiert)',
      (await inspectG(SVG_CHAIN_MIXED))?.paint_visible === 'indeterminate');
    assert('v2-chain-all-alive: Filter+voll-Clip+weiße Maske ALLE alive → kein Feld',
      isAlive(await inspectG(SVG_CHAIN_ALL_ALIVE)));
    assert('v2-dead-dominanz: scale(0) UNTER alive-Clip → false (B1 dominiert, NICHT alive)',
      (await inspectG(SVG_SCALE0_WITH_CLIP))?.paint_visible === false,
      `got ${JSON.stringify((await inspectG(SVG_SCALE0_WITH_CLIP))?.paint_visible)}`);

    // ── B3-NESTED-FIX ─────────────────────────────────────────────────────────
    console.log('\n=== V2 B3-NESTED: außerhalb nested-<svg overflow:hidden> → indeterminate (war undefined) ===');
    const noEl = await inspectG(SVG_NESTED_OUTSIDE);
    assert('B3-nested: #g in scene.elements', !!noEl,
      `got ${JSON.stringify(noEl)}`);
    assert("B3-nested: paint_visible === 'indeterminate' (NIE undefined/false)",
      noEl?.paint_visible === 'indeterminate', `got ${JSON.stringify(noEl?.paint_visible)}`);
    assert('B3-nested: trägt PAINT_PRESENCE_INDETERMINATE',
      hasWarn(noEl, 'PAINT_PRESENCE_INDETERMINATE'), `warnings=${JSON.stringify(noEl?.warnings)}`);
    assert('B3-nested: NICHT false (nested-VP-Schnitt nicht so exakt wie Root-VP)',
      noEl?.paint_visible !== false, `got ${JSON.stringify(noEl?.paint_visible)}`);
    const niEl = await inspectG(SVG_NESTED_INSIDE);
    assert('B3-nested-ctrl: Element INNERHALB nested-VP → KEIN Feld (sichtbar)',
      isAlive(niEl), `got ${JSON.stringify(niEl?.paint_visible)}`);

    // ════ 🔴 REVIEW-RUNDE-2: 5 LEAKS + konservative Negativ-Kontrollen ═════════
    console.log('\n=== 🔴 Fund1 (false-sichtbar): leere mask-Region → indeterminate (war alive) ===');
    const f1 = await inspectG(SVG_MASK_EMPTY_REGION);
    assert('Fund1: leere mask-Region (maskUnits userSpaceOnUse w=0) → NICHT alive',
      !isAlive(f1), `got ${JSON.stringify(f1?.paint_visible)}`);
    assert("Fund1: paint_visible === 'indeterminate' (Region nicht beweisbar deckend)",
      f1?.paint_visible === 'indeterminate', `got ${JSON.stringify(f1?.paint_visible)}`);

    console.log('\n=== 🔴 Fund3 (false-sichtbar): mask-mode:alpha am Consumer → indeterminate ===');
    const f3 = await inspectG(SVG_MASK_MODE_ALPHA);
    assert('Fund3: mask-mode:alpha + weiß-aber-α0-Inhalt → NICHT alive',
      !isAlive(f3), `got ${JSON.stringify(f3?.paint_visible)}`);
    assert("Fund3: paint_visible === 'indeterminate' (Luminanz-Beweis gilt nicht)",
      f3?.paint_visible === 'indeterminate', `got ${JSON.stringify(f3?.paint_visible)}`);

    console.log('\n=== 🔴 Codex9 (false-sichtbar): <use>/<image> scale(0) → false (B1 erweitert) ===');
    const c9u = await inspectG(SVG_USE_SCALE0);
    assert('Codex9-use: #g(use) in scene.elements (nicht still geskippt)', !!c9u);
    assert('Codex9-use: <use transform="scale(0)"> → paint_visible:false',
      c9u?.paint_visible === false, `got ${JSON.stringify(c9u?.paint_visible)}`);
    assert('Codex9-use: trägt PAINT_NOT_VISIBLE',
      hasWarn(c9u, 'PAINT_NOT_VISIBLE'), `warnings=${JSON.stringify(c9u?.warnings)}`);
    const c9i = await inspectG(SVG_IMAGE_SCALE0);
    assert('Codex9-image: <image transform="scale(0)"> → paint_visible:false',
      c9i?.paint_visible === false, `got ${JSON.stringify(c9i?.paint_visible)}`);
    const c9c = await inspectG(SVG_USE_SCALE1);
    assert('Codex9-ctrl: <use> scale(1) → KEIN Feld (kein false-Eingriff)',
      isAlive(c9c), `got ${JSON.stringify(c9c?.paint_visible)}`);

    console.log('\n=== 🔴 Codex7 (false-tot): Filter-erzeugt-Paint feFlood → NICHT false ===');
    const c7 = await inspectG(SVG_FILTER_FEFLOOD);
    assert('Codex7: fill=none stroke=none + feFlood(α>0) → NICHT false (malt generiert)',
      c7?.paint_visible !== false, `got ${JSON.stringify(c7?.paint_visible)}`);
    assert('Codex7: reines feFlood-α>0 voll-Region → alive (kein Feld)',
      isAlive(c7), `got ${JSON.stringify(c7?.paint_visible)}`);
    const c7img = await inspectG(SVG_FILTER_FEIMAGE);
    assert("Codex7-feImage: generativ-nicht-beweisbar → 'indeterminate' (nicht alive/false)",
      c7img?.paint_visible === 'indeterminate', `got ${JSON.stringify(c7img?.paint_visible)}`);
    // feFlood flood-opacity=0: generativer Filter present, aber Paint nicht beweisbar-
    // alive. „false" zu behaupten wäre eine Phase-2-DEAD-Regel (feFlood-0, bewusst
    // aufgeschoben) → Phase 1 meldet ehrlich 'indeterminate' (NIE falsch-tot, NIE
    // falsch-alive). Das ist konsistent mit „KEINE DEAD-Regeln in Phase 1".
    const c7t = await inspectG(SVG_FILTER_FEFLOOD_TRANSPARENT);
    assert("Codex7-ctrl: feFlood flood-opacity=0 → 'indeterminate' (Phase-1: keine DEAD-Regel)",
      c7t?.paint_visible === 'indeterminate', `got ${JSON.stringify(c7t?.paint_visible)}`);
    assert('Codex7-ctrl: NICHT alive (generativ present, nicht beweisbar)',
      !isAlive(c7t), `got ${JSON.stringify(c7t?.paint_visible)}`);

    console.log('\n=== 🔴 Codex8 (false-tot): overflow:visible am Root außen → NICHT false ===');
    const c8 = await inspectG(SVG_OVERFLOW_VISIBLE_OUTSIDE);
    assert('Codex8: <svg overflow="visible"> + außen → NICHT false (kein Viewport-Clip)',
      c8?.paint_visible !== false, `got ${JSON.stringify(c8?.paint_visible)}`);
    assert("Codex8: paint_visible === 'indeterminate' (Clip aufgehoben → unbestimmt)",
      c8?.paint_visible === 'indeterminate', `got ${JSON.stringify(c8?.paint_visible)}`);

    console.log('\n=== 🔴 KONSERVATIV: Härtung bricht den trivialen ALIVE-Fall NICHT ===');
    assert('konserv-mask-default: Default-Maske weiß-voll → BLEIBT alive (kein Feld)',
      isAlive(await inspectG(SVG_MASK_DEFAULT_WHITE)));
    assert('konserv-mask-explicit: jedes gesetzte Region-Attribut → indeterminate',
      (await inspectG(SVG_MASK_EXPLICIT_REGION))?.paint_visible === 'indeterminate',
      `got ${JSON.stringify((await inspectG(SVG_MASK_EXPLICIT_REGION))?.paint_visible)}`);
    assert('konserv-grad-spread: spreadMethod=reflect → indeterminate (nicht-trivial)',
      (await inspectG(SVG_GRAD_SPREAD))?.paint_visible === 'indeterminate',
      `got ${JSON.stringify((await inspectG(SVG_GRAD_SPREAD))?.paint_visible)}`);
    assert('konserv-fund2: Gradient mit ≥1 sichtbarem Stop → BLEIBT alive (Fund2-Note)',
      isAlive(await inspectG(SVG_GRAD_ALIVE)));

    // ── PROSA-EHRLICHKEIT (indeterminate ehrlich, sichtbar unverändert) ───────
    console.log('\n=== PROSA: indeterminate-Element ehrlich Sichtbarkeit-unbestimmt ===');
    const proseLines = (p) => p.split('\n');
    const statusLine = (p) => proseLines(p).find((l) => l.startsWith('STATUS')) || '';
    const gLine = (p) => proseLines(p).find((l) => l.includes('#g')) || '';
    const pIns = (await inspect(SVG_CLIP_EMPTY)).prose;
    assert('prose-indet: STATUS NICHT „✓ Alles korrekt"',
      !statusLine(pIns).includes('Alles korrekt'), `STATUS="${statusLine(pIns)}"`);
    assert('prose-indet: STATUS nennt „Sichtbarkeit unbestimmt"',
      /Sichtbarkeit unbestimmt/.test(statusLine(pIns)), `STATUS="${statusLine(pIns)}"`);
    assert('prose-indet: #g-Zeile trägt PAINT_PRESENCE_INDETERMINATE',
      gLine(pIns).includes('PAINT_PRESENCE_INDETERMINATE'), `line="${gLine(pIns)}"`);
    assert('prose-indet: #g-Zeile NICHT als „unsichtbar" markiert (NICHT tot)',
      !gLine(pIns).includes('unsichtbar (PAINT_NOT_VISIBLE)'), `line="${gLine(pIns)}"`);
    assert('prose-indet: #g-Zeile endet NICHT auf bare „✓"',
      !/✓\s*$/.test(gLine(pIns)), `line="${gLine(pIns)}"`);

    console.log('\n=== PROSA NEGATIV: rein sichtbare Szene → „✓ Alles korrekt" ===');
    const pVis = (await inspect(SVG_NORMAL)).prose;
    assert('prose-neg: STATUS === „✓ Alles korrekt"',
      statusLine(pVis).includes('Alles korrekt'), `STATUS="${statusLine(pVis)}"`);

    console.log('\n=== PROSA V2: ALIVE-Filter-Szene (normaler Blur) → KEIN indeterminate-Rauschen ===');
    // Der Blur trägt einen ORTHOGONALEN T2-Tinten-Überlauf (Filter-Region ragt über die
    // geom-bbox — unverändert von V2). V2-Beweis: KEIN PAINT_PRESENCE_INDETERMINATE
    // mehr (die V1-B4-Pauschale hätte hier fälschlich „Sichtbarkeit unbestimmt" gemeldet).
    const pBlur = (await inspect(SVG_FILTER_BLUR)).prose;
    assert('prose-v2-alive: KEINE „Sichtbarkeit unbestimmt"-Erwähnung (Rausch geheilt)',
      !pBlur.includes('PAINT_PRESENCE_INDETERMINATE') &&
        !pBlur.includes('Sichtbarkeit unbestimmt'),
      `prose=${JSON.stringify(pBlur)}`);
    // Eine VOLL-alive-Szene OHNE Filter (alive-Gradient) → „✓ Alles korrekt" (kein
    // T2-Überlauf bei Gradient-fill ohne stroke) → reiner Rausch-Heilungs-Nachweis.
    const pGrad = (await inspect(SVG_GRAD_ALIVE)).prose;
    assert('prose-v2-grad: STATUS === „✓ Alles korrekt" (alive-Gradient, kein Rauschen)',
      statusLine(pGrad).includes('Alles korrekt'), `STATUS="${statusLine(pGrad)}"`);
    assert('prose-neg: KEINE indeterminate-Erwähnung',
      !pVis.includes('PAINT_PRESENCE_INDETERMINATE') && !pVis.includes('unbestimmt'),
      `prose=${JSON.stringify(pVis)}`);

    // ── MCP-SCHEMA: ein 'indeterminate'-Output validiert gegen die outputSchema ─
    console.log("\n=== MCP-SCHEMA: analyze-Output mit 'indeterminate' validiert ===");
    const ana = await analyze(SVG_CLIP_EMPTY, []);
    const anaEl = byId(ana.structured?.scene?.elements, 'g');
    assert("schema-precond: analyze emittiert paint_visible:'indeterminate'",
      anaEl?.paint_visible === 'indeterminate', `got ${JSON.stringify(anaEl?.paint_visible)}`);
    const parsed = analyzeOutputSchema.safeParse(ana.structured);
    assert("schema: outputSchema akzeptiert das 'indeterminate'-tragende Resultat",
      parsed.success, parsed.success ? '' : JSON.stringify(parsed.error?.issues?.slice(0, 3)));
    // Gegenprobe: ein scale(0)-false-Output validiert ebenso.
    const anaF = await analyze(SVG_SCALE0_SELF, []);
    const parsedF = analyzeOutputSchema.safeParse(anaF.structured);
    assert('schema: outputSchema akzeptiert auch das false-tragende Resultat',
      parsedF.success, parsedF.success ? '' : JSON.stringify(parsedF.error?.issues?.slice(0, 3)));

    // ── DETERMINISMUS ────────────────────────────────────────────────────────
    console.log('\n=== DETERMINISMUS: 2× byte-identisch (indeterminate + false) ===');
    const d1 = canon((await inspect(SVG_CLIP_EMPTY)).structured);
    const d2 = canon((await inspect(SVG_CLIP_EMPTY)).structured);
    assert('determinismus indeterminate: 2× byte-identisch', d1 === d2,
      `d1!==d2 (len ${d1.length} vs ${d2.length})`);
    const e1 = canon((await inspect(SVG_SCALE0_SELF)).structured);
    const e2 = canon((await inspect(SVG_SCALE0_SELF)).structured);
    assert('determinismus false: 2× byte-identisch', e1 === e2,
      `e1!==e2 (len ${e1.length} vs ${e2.length})`);
  } finally {
    await shutdown();
  }

  console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error('Test-Lauf-Fehler:', e);
  process.exit(1);
});
