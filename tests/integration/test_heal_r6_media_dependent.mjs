/**
 * test_heal_r6_media_dependent.mjs — §F-AT-6-09 / R6-MEDIA: Viewport-Abhängigkeit
 * (media_dependent), permanenter Regressions-Test (dritte stille Achse).
 *
 * Real-Chromium-Harness (KEINE Mocks), über die ECHTE Pipeline (analyze/inspect →
 * structured.scene.elements + prose). Schließt das dritte stille Leck, das nach der
 * Motion- (NON_DETERMINISTIC_MOTION) und der State-Achse (STATE_DEPENDENT) offen blieb.
 *
 * DIE LÜGE (vorher): das Auge flaggt BEWEGUNG und INTERAKTION, aber NICHT VIEWPORT.
 * Ein Element, dessen Stil von einem Viewport-abhängigen @media (width/height/
 * orientation/aspect-ratio/resolution/device-*) getroffen wird, rendert bei einem
 * ANDEREN Viewport ANDERS — das Auge meldete still die @Mess-Viewport-Wahrheit als
 * ganze Wahrheit = Blind-Trust-Lüge.
 *
 * DIE HEILUNG (rein statisch @t=0, R9, KEIN matchMedia, KEIN Multi-Viewport-Render):
 * ein reines Flag media_dependent + Warning MEDIA_DEPENDENT, leck-frei über die
 * Whitelist „sicher-NICHT-Viewport" (Medientypen all/screen/print/speech + SAFE-
 * Features prefers-color-scheme/hover/pointer/etc.). JEDES Viewport-Feature ODER jedes
 * nicht-als-SAFE-erkennbare Token (inkl. calc()/unbekannt) → flag (über-flaggen). BEIDE
 * Divergenz-Richtungen (Stil fällt weg ODER kommt hinzu) erfasst — KEIN matches-Gate.
 * KEIN bbox_reliability-Degrade (t=0-Geometrie EXAKT wahr). Orthogonal zu State/Motion.
 *
 * GATE-DURCHLÄSSIGKEIT (leck-frei): ein NUR-bei-anderem-Viewport-sichtbares Element
 * (z.B. @media (min-width){#x{display:none}} matcht am Mess-Viewport → display:none)
 * darf NICHT still verschluckt werden — es fällt mit echter 0×0-bbox durch und wird
 * ehrlich mit media_dependent:true emittiert (analog zum State-Tooltip-Idiom).
 *
 * Run direkt: `node tests/integration/test_heal_r6_media_dependent.mjs`
 */
import { z } from 'zod';
import { analyze, inspect, shutdown } from '../../src/pipeline.js';
import { analyzeOutput } from '../../src/interface/schema.js';

// analyzeOutput ist die registrierte MCP-outputSchema als roher z.object-Shape —
// das media_dependent-Boolean MUSS aus dem ECHTEN Renderer akzeptiert werden.
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

// Ein Element gilt als „media-flag getragen", wenn BEIDE Signale da sind: das Feld
// media_dependent:true UND die Warning MEDIA_DEPENDENT (fail-loud — kein halb
// durchgereichtes Signal).
function isMediaFlagged(el) {
  return !!el && el.media_dependent === true && hasWarn(el, 'MEDIA_DEPENDENT');
}

async function analyzeEls(svg) {
  const out = await analyze(svg, []);
  return out.structured?.scene?.elements ?? [];
}

const VB =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120"';

// ── VIEWPORT-FÄLLE (media_dependent:true erwartet) ─────────────────────────────
const SVG_MVIEWPORT = `<svg ${VB}>
  <style>@media (max-width:600px){#m{fill:red}}</style>
  <rect id="m" width="10" height="10" fill="blue"/>
</svg>`;
const SVG_ORIENTATION = `<svg ${VB}>
  <style>@media (orientation:portrait){#m{fill:red}}</style>
  <rect id="m" width="10" height="10" fill="blue"/>
</svg>`;
// calc()/unbekannter Wert → konservativ flaggen (Wert nicht statisch klassifizierbar).
const SVG_CALC = `<svg ${VB}>
  <style>@media (max-width:calc(50rem + 2px)){#m{fill:red}}</style>
  <rect id="m" width="10" height="10" fill="blue"/>
</svg>`;
// gemischt: screen (SAFE) UND min-width (Viewport) → enthält Viewport → flag.
const SVG_MIXED = `<svg ${VB}>
  <style>@media screen and (min-width:400px){#m{fill:red}}</style>
  <rect id="m" width="10" height="10" fill="blue"/>
</svg>`;
// height + aspect-ratio + resolution: weitere Viewport-Features → flag.
const SVG_HEIGHT = `<svg ${VB}>
  <style>@media (min-height:300px){#m{fill:red}}</style>
  <rect id="m" width="10" height="10" fill="blue"/>
</svg>`;
const SVG_ASPECT = `<svg ${VB}>
  <style>@media (min-aspect-ratio:1/1){#m{fill:red}}</style>
  <rect id="m" width="10" height="10" fill="blue"/>
</svg>`;

// ── NICHT-VIEWPORT-FÄLLE (media_dependent NICHT gesetzt) ───────────────────────
const SVG_PRINT = `<svg ${VB}>
  <style>@media print{#p{fill:red}}</style>
  <rect id="p" width="10" height="10" fill="blue"/>
</svg>`;
const SVG_ALL = `<svg ${VB}>
  <style>@media all{#a{fill:red}}</style>
  <rect id="a" width="10" height="10" fill="blue"/>
</svg>`;
const SVG_PCS = `<svg ${VB}>
  <style>@media (prefers-color-scheme:dark){#d{fill:red}}</style>
  <rect id="d" width="10" height="10" fill="blue"/>
</svg>`;
const SVG_HOVER_FEATURE = `<svg ${VB}>
  <style>@media (hover:hover){#h{fill:red}}</style>
  <rect id="h" width="10" height="10" fill="blue"/>
</svg>`;
const SVG_CLEAN = `<svg ${VB}>
  <rect id="c" width="10" height="10" fill="blue"/>
  <circle id="c2" cx="60" cy="60" r="20" fill="green"/>
</svg>`;

// ── ACHSEN-TRENNUNG ────────────────────────────────────────────────────────────
// @media all{#f:hover} → all ist SAFE (NICHT-Viewport) ABER :hover ist State →
// state_dependent:true, media_dependent NICHT.
const SVG_STATE_NOT_MEDIA = `<svg ${VB}>
  <style>@media all{#f:hover{fill:blue}}</style>
  <rect id="f" tabindex="0" width="10" height="10" fill="red"/>
</svg>`;
// Koexistenz: @media (max-width:600px){#k:hover} → Viewport-@media UND :hover →
// BEIDE Achsen tragen (media_dependent UND state_dependent).
const SVG_BOTH_AXES = `<svg ${VB}>
  <style>@media (max-width:600px){#k:hover{fill:blue}}</style>
  <rect id="k" tabindex="0" width="10" height="10" fill="red"/>
</svg>`;

// ── GATE-FÄLLE (leck-frei: media-bedingt-unsichtbar/0×0 NICHT still skippen) ────
// g1: min-width:1px matcht IMMER (deterministisch) → #x ist am Mess-Viewport
// display:none. VOR dem Gate-Fix würde der Invisibility-Skip #x still verschlucken;
// NACH dem Fix wird #x DENNOCH emittiert (echte 0×0-bbox) mit media_dependent:true.
const SVG_G1_MEDIA_DISPLAY_NONE = `<svg ${VB}>
  <style>@media (min-width:1px){#x{display:none}}</style>
  <rect id="x" width="40" height="40" fill="green"/>
</svg>`;
// g2: min-width:1px matcht IMMER → #z wird am Mess-Viewport auf 0×0 gesetzt
// (width/height:0). VOR dem Fix würde das geomEmpty-Gate #z verschlucken; NACH dem
// Fix fällt #z mit echter 0×0-bbox durch mit media_dependent:true.
const SVG_G2_MEDIA_ZERO = `<svg ${VB}>
  <style>@media (min-width:1px){#z{width:0px;height:0px}}</style>
  <rect id="z" x="20" y="20" width="40" height="40" fill="green"/>
</svg>`;

// ── USE-HREF-GRAPH × MEDIA (F1/F2/ADV#1): @media trifft die DEF, nicht die <use> ──
// F1: @media (max-width:600px){#shape{fill:red}} trifft die Definition #shape im
// <defs>. Die <use id="u">-INSTANZ rendert bei anderem Viewport anders (erbt
// dieselbe @media am selben Viewport, SVG2 §5.6) → use MUSS media_dependent tragen.
// VOR Fix: mediaDependentElements walkt nur CSS-Selector-Hits + DOM-Nachfahren, NIE
// den use-href-Graph → die use-Instanz emittiert OHNE media_dependent (stille Lüge).
const SVG_F1_USE_VIA_MEDIA = `<svg ${VB}>
  <style>@media (max-width:600px){#shape{fill:red}}</style>
  <defs><rect id="shape" width="40" height="40" fill="blue"/></defs>
  <use id="u" href="#shape"/>
</svg>`;
// F2: @media (min-width:1000px){#shape{display:none}} — am Mess-Viewport (1000px
// NICHT erfüllt) sichtbar. Die <use>-Instanz ist viewport-abhängig (bei ≥1000px
// verschwände sie). VOR Fix: use ohne media_dependent → falls je ein Gate die
// Instanz unsichtbar setzte, ginge sie still verloren (NO_ELEMENTS-Wurzel). ASSERT
// die Instanz EMITTIERT mit media_dependent:true (Gate durchlässig für media).
const SVG_F2_USE_GATE = `<svg ${VB}>
  <style>@media (min-width:1000px){#shape{display:none}}</style>
  <defs><rect id="shape" width="40" height="40" fill="blue"/></defs>
  <use id="u" href="#shape"/>
</svg>`;
// ADV#1: verschachtelt (use→use→media-def). outer (#outer) referenziert #mid; #mid
// enthält eine <use> auf die media-getroffene Def #shape (Tiefe 2). Der Fixpunkt
// muss MEHRRUNDIG propagieren: Runde 1 flaggt #mid's innere use, Runde 2 flaggt
// #outer (dessen ref #mid nun ein geflaggtes Element enthält).
const SVG_ADV1_NESTED_D2 = `<svg ${VB}>
  <style>@media (max-width:600px){#shape{fill:red}}</style>
  <defs>
    <rect id="shape" width="40" height="40" fill="blue"/>
    <g id="mid"><use href="#shape"/></g>
  </defs>
  <use id="outer" href="#mid"/>
</svg>`;
// ADV#1 Tiefe-3-Variante: outer3→mid3→inner3→media-def. Drei Fixpunkt-Runden.
const SVG_ADV1_NESTED_D3 = `<svg ${VB}>
  <style>@media (max-width:600px){#shape{fill:red}}</style>
  <defs>
    <rect id="shape" width="40" height="40" fill="blue"/>
    <g id="inner3"><use href="#shape"/></g>
    <g id="mid3"><use href="#inner3"/></g>
  </defs>
  <use id="outer3" href="#mid3"/>
</svg>`;

// ── F3 @scope × @media (ÜBER-FLAG): leeres rule.end darf NICHT flag-all auslösen ──
// @media (max-width){@scope(#wrap){#x{fill:red}}} — der @scope hat KEIN to() →
// rule.end ist leer. VOR Fix: leeres rule.end → pushPart('') → normalizeStripped('')
// → '*' → flag-all → #off (AUSSERHALB #wrap) bekommt fälschlich media_dependent.
// NACH Fix: leeres rule.end erreicht pushPart nie → nur #x (im Scope) ist geflaggt.
const SVG_F3_SCOPE_EMPTY_END = `<svg ${VB}>
  <style>@media (max-width:600px){@scope(#wrap){#x{fill:red}}}</style>
  <a id="wrap"><rect id="x" width="40" height="40" fill="blue"/></a>
  <rect id="off" width="10" height="10" fill="green"/>
</svg>`;

(async () => {
  try {
    // ── VIEWPORT-FÄLLE: media_dependent:true + Warning ──────────────────────────
    console.log(
      '=== M-viewport (@media (max-width:600px)) → #m media_dependent ===',
    );
    let els = await analyzeEls(SVG_MVIEWPORT);
    let m = byId(els, 'm');
    assert(
      'M-viewport: #m in scene.elements',
      !!m,
      `ids=${JSON.stringify(els.map((e) => e.id))}`,
    );
    assert(
      'M-viewport: #m.media_dependent === true',
      m?.media_dependent === true,
      `got ${JSON.stringify(m?.media_dependent)}`,
    );
    assert(
      'M-viewport: #m trägt MEDIA_DEPENDENT',
      hasWarn(m, 'MEDIA_DEPENDENT'),
      `warnings=${JSON.stringify(m?.warnings)}`,
    );
    assert(
      'M-viewport: bbox_reliability bleibt reliable (KEIN Degrade)',
      m?.bbox_reliability === 'reliable',
      `got ${JSON.stringify(m?.bbox_reliability)}`,
    );
    assert(
      'M-viewport: state_dependent NICHT gesetzt (Achsen-Trennung)',
      m && !('state_dependent' in m),
      `got ${JSON.stringify(m?.state_dependent)}`,
    );

    console.log(
      '\n=== M-orientation (@media (orientation:portrait)) → flag ===',
    );
    m = byId(await analyzeEls(SVG_ORIENTATION), 'm');
    assert(
      'M-orientation: #m media-flagged',
      isMediaFlagged(m),
      `media_dependent=${JSON.stringify(m?.media_dependent)} warns=${JSON.stringify(m?.warnings)}`,
    );

    console.log(
      '\n=== M-calc (@media (max-width:calc(...))) → flag (über) ===',
    );
    m = byId(await analyzeEls(SVG_CALC), 'm');
    assert(
      'M-calc: #m media-flagged (unbekannter/calc-Wert → konservativ)',
      isMediaFlagged(m),
      `media_dependent=${JSON.stringify(m?.media_dependent)} warns=${JSON.stringify(m?.warnings)}`,
    );

    console.log(
      '\n=== M-mixed (@media screen and (min-width:400px)) → flag ===',
    );
    m = byId(await analyzeEls(SVG_MIXED), 'm');
    assert(
      'M-mixed: #m media-flagged (enthält min-width → Viewport)',
      isMediaFlagged(m),
      `media_dependent=${JSON.stringify(m?.media_dependent)} warns=${JSON.stringify(m?.warnings)}`,
    );

    console.log('\n=== M-height / M-aspect-ratio → flag ===');
    m = byId(await analyzeEls(SVG_HEIGHT), 'm');
    assert(
      'M-height: #m media-flagged',
      isMediaFlagged(m),
      `media_dependent=${JSON.stringify(m?.media_dependent)}`,
    );
    m = byId(await analyzeEls(SVG_ASPECT), 'm');
    assert(
      'M-aspect-ratio: #m media-flagged',
      isMediaFlagged(m),
      `media_dependent=${JSON.stringify(m?.media_dependent)}`,
    );

    // ── NICHT-VIEWPORT-FÄLLE: media_dependent NICHT gesetzt (FP-Vermeidung) ──────
    console.log(
      '\n=== NICHT-Viewport: print / all / prefers-color-scheme / hover-feature → KEIN flag ===',
    );
    for (const [label, svg, id] of [
      ['print', SVG_PRINT, 'p'],
      ['all', SVG_ALL, 'a'],
      ['prefers-color-scheme', SVG_PCS, 'd'],
      ['hover-feature', SVG_HOVER_FEATURE, 'h'],
    ]) {
      const e = byId(await analyzeEls(svg), id);
      assert(`NICHT-${label}: #${id} in scene.elements`, !!e, `label=${label}`);
      assert(
        `NICHT-${label}: #${id} trägt KEIN media_dependent-Feld`,
        e && !('media_dependent' in e),
        `got ${JSON.stringify(e?.media_dependent)}`,
      );
      assert(
        `NICHT-${label}: #${id} trägt KEINE MEDIA_DEPENDENT-Warning`,
        !hasWarn(e, 'MEDIA_DEPENDENT'),
        `warnings=${JSON.stringify(e?.warnings)}`,
      );
    }

    console.log(
      '\n=== NEGATIV: sauberes SVG ohne @media → nichts geflaggt ===',
    );
    els = await analyzeEls(SVG_CLEAN);
    for (const id of ['c', 'c2']) {
      const e = byId(els, id);
      assert(
        `clean: #${id} trägt KEIN media_dependent-Feld`,
        e && !('media_dependent' in e),
        `got ${JSON.stringify(e?.media_dependent)}`,
      );
      assert(
        `clean: #${id} trägt KEINE MEDIA_DEPENDENT-Warning`,
        !hasWarn(e, 'MEDIA_DEPENDENT'),
        `warnings=${JSON.stringify(e?.warnings)}`,
      );
    }

    // ── ACHSEN-TRENNUNG ─────────────────────────────────────────────────────────
    console.log(
      '\n=== STATE-bleibt: @media all{#f:hover} → state_dependent, NICHT media ===',
    );
    const f = byId(await analyzeEls(SVG_STATE_NOT_MEDIA), 'f');
    assert(
      'state-not-media: #f.state_dependent === true',
      f?.state_dependent === true,
      `got ${JSON.stringify(f?.state_dependent)}`,
    );
    assert(
      'state-not-media: #f trägt STATE_DEPENDENT',
      hasWarn(f, 'STATE_DEPENDENT'),
      `warnings=${JSON.stringify(f?.warnings)}`,
    );
    assert(
      'state-not-media: #f trägt KEIN media_dependent (all = NICHT-Viewport)',
      f && !('media_dependent' in f),
      `got ${JSON.stringify(f?.media_dependent)}`,
    );
    assert(
      'state-not-media: #f trägt KEINE MEDIA_DEPENDENT-Warning',
      !hasWarn(f, 'MEDIA_DEPENDENT'),
      `warnings=${JSON.stringify(f?.warnings)}`,
    );

    console.log(
      '\n=== KOEXISTENZ: @media (max-width:600px){#k:hover} → BEIDE Achsen ===',
    );
    const k = byId(await analyzeEls(SVG_BOTH_AXES), 'k');
    assert(
      'both-axes: #k.media_dependent === true',
      k?.media_dependent === true,
      `got ${JSON.stringify(k?.media_dependent)}`,
    );
    assert(
      'both-axes: #k.state_dependent === true',
      k?.state_dependent === true,
      `got ${JSON.stringify(k?.state_dependent)}`,
    );
    assert(
      'both-axes: #k trägt BEIDE Warnings (Append, kein Clobber)',
      hasWarn(k, 'MEDIA_DEPENDENT') && hasWarn(k, 'STATE_DEPENDENT'),
      `warnings=${JSON.stringify(k?.warnings)}`,
    );

    // ── GATE-FÄLLE: media-bedingt-unsichtbar/0×0 NICHT still skippen ─────────────
    console.log(
      '\n=== g1: @media (min-width:1px){#x{display:none}} → #x DENNOCH emittiert ===',
    );
    els = await analyzeEls(SVG_G1_MEDIA_DISPLAY_NONE);
    const x = byId(els, 'x');
    assert(
      'g1: #x in scene.elements (Invisibility-Gate durchlässig für media)',
      !!x,
      `ids=${JSON.stringify(els.map((e) => e.id))}`,
    );
    assert(
      'g1: #x.media_dependent === true',
      x?.media_dependent === true,
      `got ${JSON.stringify(x?.media_dependent)}`,
    );
    assert(
      'g1: #x trägt MEDIA_DEPENDENT',
      hasWarn(x, 'MEDIA_DEPENDENT'),
      `warnings=${JSON.stringify(x?.warnings)}`,
    );

    console.log(
      '\n=== g2: @media (min-width:1px){#z{width:0;height:0}} → #z DENNOCH emittiert ===',
    );
    els = await analyzeEls(SVG_G2_MEDIA_ZERO);
    const zEl = byId(els, 'z');
    assert(
      'g2: #z in scene.elements (geomEmpty-Gate durchlässig für media)',
      !!zEl,
      `ids=${JSON.stringify(els.map((e) => e.id))}`,
    );
    assert(
      'g2: #z.media_dependent === true',
      zEl?.media_dependent === true,
      `got ${JSON.stringify(zEl?.media_dependent)}`,
    );
    assert(
      'g2: #z trägt MEDIA_DEPENDENT',
      hasWarn(zEl, 'MEDIA_DEPENDENT'),
      `warnings=${JSON.stringify(zEl?.warnings)}`,
    );

    // ── USE-HREF-GRAPH × MEDIA (F1): use-Instanz einer media-getroffenen Def ─────
    console.log(
      '\n=== F1: @media{#shape} + <use href=#shape> → use media_dependent ===',
    );
    els = await analyzeEls(SVG_F1_USE_VIA_MEDIA);
    const f1u = byId(els, 'u');
    assert(
      'F1: #u (use-Instanz) in scene.elements',
      !!f1u,
      `ids=${JSON.stringify(els.map((e) => e.id))}`,
    );
    assert(
      'F1: #u.media_dependent === true (erbt @media der Def via use-href-Graph)',
      f1u?.media_dependent === true,
      `got ${JSON.stringify(f1u?.media_dependent)}`,
    );
    assert(
      'F1: #u trägt MEDIA_DEPENDENT',
      hasWarn(f1u, 'MEDIA_DEPENDENT'),
      `warnings=${JSON.stringify(f1u?.warnings)}`,
    );

    // ── USE-GATE × MEDIA (F2): media-bedingt-unsichtbare Def → use NICHT still ───
    console.log(
      '\n=== F2: @media (min-width:1000px){#shape{display:none}} + use → use EMITTIERT ===',
    );
    els = await analyzeEls(SVG_F2_USE_GATE);
    const f2u = byId(els, 'u');
    assert(
      'F2: #u (use-Instanz) EMITTIERT (nicht NO_ELEMENTS / still verloren)',
      !!f2u,
      `ids=${JSON.stringify(els.map((e) => e.id))}`,
    );
    assert(
      'F2: #u.media_dependent === true',
      f2u?.media_dependent === true,
      `got ${JSON.stringify(f2u?.media_dependent)}`,
    );
    assert(
      'F2: #u trägt MEDIA_DEPENDENT',
      hasWarn(f2u, 'MEDIA_DEPENDENT'),
      `warnings=${JSON.stringify(f2u?.warnings)}`,
    );

    // ── ADV#1: verschachtelter use→use→media-def (Fixpunkt-Mehrrunden) ───────────
    console.log(
      '\n=== ADV#1 Tiefe-2: use→use→media-def → outer media_dependent ===',
    );
    const adv2 = byId(await analyzeEls(SVG_ADV1_NESTED_D2), 'outer');
    assert(
      'ADV#1 D2: #outer media-flagged (Fixpunkt propagiert über 2 use-Kanten)',
      isMediaFlagged(adv2),
      `media_dependent=${JSON.stringify(adv2?.media_dependent)} warns=${JSON.stringify(adv2?.warnings)}`,
    );
    console.log(
      '\n=== ADV#1 Tiefe-3: use→use→use→media-def → outer3 media_dependent ===',
    );
    const adv3 = byId(await analyzeEls(SVG_ADV1_NESTED_D3), 'outer3');
    assert(
      'ADV#1 D3: #outer3 media-flagged (Fixpunkt propagiert über 3 use-Kanten)',
      isMediaFlagged(adv3),
      `media_dependent=${JSON.stringify(adv3?.media_dependent)} warns=${JSON.stringify(adv3?.warnings)}`,
    );

    // ── F3 @scope × @media (ÜBER-FLAG): leeres rule.end → KEIN flag-all ──────────
    console.log(
      '\n=== F3: @media{@scope(#wrap){#x}} → #x geflaggt, #off NICHT (kein flag-all) ===',
    );
    els = await analyzeEls(SVG_F3_SCOPE_EMPTY_END);
    const f3x = byId(els, 'x');
    const f3off = byId(els, 'off');
    assert(
      'F3: #x (im @scope) media-flagged',
      isMediaFlagged(f3x),
      `media_dependent=${JSON.stringify(f3x?.media_dependent)} warns=${JSON.stringify(f3x?.warnings)}`,
    );
    assert(
      'F3: #off (AUSSERHALB @scope) trägt KEIN media_dependent (kein leeres-rule.end-flag-all)',
      f3off && !('media_dependent' in f3off),
      `got ${JSON.stringify(f3off?.media_dependent)}`,
    );
    assert(
      'F3: #off trägt KEINE MEDIA_DEPENDENT-Warning',
      !hasWarn(f3off, 'MEDIA_DEPENDENT'),
      `warnings=${JSON.stringify(f3off?.warnings)}`,
    );

    // ── MCP-SCHEMA: ein media_dependent-Output validiert gegen die outputSchema ──
    console.log(
      '\n=== MCP-SCHEMA: analyze-Output mit media_dependent validiert ===',
    );
    const ana = await analyze(SVG_MVIEWPORT, []);
    const anaM = byId(ana.structured?.scene?.elements, 'm');
    assert(
      'schema-precond: analyze emittiert media_dependent:true',
      anaM?.media_dependent === true,
      `got ${JSON.stringify(anaM?.media_dependent)}`,
    );
    const parsed = analyzeOutputSchema.safeParse(ana.structured);
    assert(
      'schema: outputSchema akzeptiert das media_dependent-tragende Resultat',
      parsed.success,
      parsed.success ? '' : JSON.stringify(parsed.error?.issues?.slice(0, 3)),
    );

    // ── PROSA-EHRLICHKEIT ───────────────────────────────────────────────────────
    console.log(
      '\n=== PROSA: media-dependent Szene ehrlich (NICHT „✓ Alles korrekt") ===',
    );
    const proseLines = (p) => p.split('\n');
    const statusLine = (p) =>
      proseLines(p).find((l) => l.startsWith('STATUS')) || '';
    const mLine = (p) => proseLines(p).find((l) => l.includes('#m')) || '';
    const pMedia = (await inspect(SVG_MVIEWPORT)).prose;
    assert(
      'prose-media: STATUS NICHT „✓ Alles korrekt"',
      !statusLine(pMedia).includes('Alles korrekt'),
      `STATUS="${statusLine(pMedia)}"`,
    );
    assert(
      'prose-media: STATUS nennt „viewport-abhängig"',
      /viewport-abhängig/.test(statusLine(pMedia)),
      `STATUS="${statusLine(pMedia)}"`,
    );
    assert(
      'prose-media: #m-Zeile trägt MEDIA_DEPENDENT-Vermerk',
      mLine(pMedia).includes('MEDIA_DEPENDENT'),
      `line="${mLine(pMedia)}"`,
    );

    console.log(
      '\n=== PROSA NEGATIV: sauberes SVG → „✓ Alles korrekt", kein Rauschen ===',
    );
    const pClean = (await inspect(SVG_CLEAN)).prose;
    assert(
      'prose-neg: STATUS === „✓ Alles korrekt"',
      statusLine(pClean).includes('Alles korrekt'),
      `STATUS="${statusLine(pClean)}"`,
    );
    assert(
      'prose-neg: KEINE „viewport-abhängig"/MEDIA_DEPENDENT-Erwähnung',
      !pClean.includes('viewport-abhängig') &&
        !pClean.includes('MEDIA_DEPENDENT'),
      `prose=${JSON.stringify(pClean)}`,
    );

    // ── R9: DETERMINISMUS (2× inspect desselben media-SVG → byte-identisch) ──────
    console.log(
      '\n=== R9: 2× inspect desselben media-SVG → byte-identisch ===',
    );
    const d1 = canon((await inspect(SVG_MVIEWPORT)).structured);
    const d2 = canon((await inspect(SVG_MVIEWPORT)).structured);
    assert(
      'R9 media: 2× byte-identisch',
      d1 === d2,
      `d1!==d2 (len ${d1.length} vs ${d2.length})`,
    );
    // Gegenprobe mit dem Gate-Pfad (display:none am Mess-Viewport).
    const g1a = canon((await inspect(SVG_G1_MEDIA_DISPLAY_NONE)).structured);
    const g1b = canon((await inspect(SVG_G1_MEDIA_DISPLAY_NONE)).structured);
    assert(
      'R9 media-gate: 2× byte-identisch',
      g1a === g1b,
      `g1a!==g1b (len ${g1a.length} vs ${g1b.length})`,
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
