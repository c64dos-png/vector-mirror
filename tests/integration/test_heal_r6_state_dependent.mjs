/**
 * test_heal_r6_state_dependent.mjs — §D5 / R6-STATE: Zustands-Abhängigkeit
 * (state_dependent), permanenter Regressions-Test (T3a / D5).
 *
 * Real-Chromium-Harness (KEINE Mocks), über die ECHTE Pipeline (analyze/inspect →
 * structured.scene.elements + prose). Schließt das Interaktions-Leck, das die
 * Motion-Achse (NON_DETERMINISTIC_MOTION) offen ließ.
 *
 * DIE LÜGE (vorher): das Auge flaggt BEWEGUNG, aber NICHT INTERAKTION. Interaktiv-
 * abhängige SVGs (:hover/:focus/:focus-within/:focus-visible/:active/:target + SMIL
 * <set/animate begin|end mit Event-Token) wurden still als ganze Wahrheit @default
 * gemeldet = Blind-Trust-Lüge. Der Alt-Zustand existiert + rendert ANDERS, das Auge
 * schwieg.
 *
 * DIE HEILUNG (rein statisch @t=0, R9, KEIN getImageData/RNG/Wall-Clock): ein reines
 * Flag state_dependent + Warning STATE_DEPENDENT, EXAKT nach dem Motion-Vorbild
 * (Self-OR-Ancestor-Walk). KEIN bbox_reliability-Degrade — bei State ist die t=0-
 * Geometrie EXAKT wahr, Alt-Zustände sind ZUSÄTZLICHE Wahrheiten (kein Drift der
 * gemessenen). Orthogonal zu Motion/3D.
 *
 * GUARDS (jeder by the maintainer in eigener Chromium reproduziert, jeder PFLICHT):
 *   B-LEAK:    `#g2:hover{fill}` → fill-loses Kind erbt → rendert bei Hover anders,
 *              ABER child.matches('#g2')===false → Self-OR-Ancestor-Walk Pflicht.
 *   B-CORRUPT: `#t:not(:hover)` → naiver Strip → `#t:not()` → matches WIRFT → still
 *              NICHT geflaggt → klammertiefen-bewusster Strip + try/catch Pflicht.
 *   B-MEDIA:   `@media all{#m:focus{...}}` → kein top-level cssRules-Eintrag →
 *              @media/@supports/@layer-Rekursion Pflicht.
 *   SMIL-Ziel: `<set>` ist NICHT im SPOTTER_SET → nextAutoId null → der <set> wird
 *              NIE emittiert → das Flag MUSS auf das Ziel (href# / parentElement).
 *
 * Run direkt: `node tests/integration/test_heal_r6_state_dependent.mjs`
 */
import { z } from 'zod';
import { inspect, analyze, shutdown } from '../../src/pipeline.js';
import { analyzeOutput } from '../../src/interface/schema.js';

// analyzeOutput ist die registrierte MCP-outputSchema als roher z.object-Shape
// (tools.js wrappt sie). Hier 1:1 als z.object validieren — das state_dependent-
// Boolean MUSS aus dem ECHTEN Renderer akzeptiert werden (kein Laufzeit-Reject).
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

// Ein Element gilt als „state-flag getragen", wenn BEIDE Signale da sind: das
// Feld state_dependent:true UND die Warning STATE_DEPENDENT (fail-loud — kein
// halb durchgereichtes Signal).
function isStateFlagged(el) {
  return !!el && el.state_dependent === true && hasWarn(el, 'STATE_DEPENDENT');
}

// Die Elemente einer analyze-Szene.
async function analyzeEls(svg) {
  const out = await analyze(svg, []);
  return out.structured?.scene?.elements ?? [];
}

// Erstes emittiertes Element (nützlich, wenn kein stabiler id-Anker existiert,
// z.B. ein auto-id'd Blatt unter einem Container).
function firstEl(els) {
  return (els || [])[0];
}

const VB = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120"';

// ── DIE 5 PROBE-KLASSEN (1:1 zu probe_g3_interaction.mjs) ──────────────────────
const SVG_HOVER_FILL = `<svg ${VB}>
  <style>#t{fill:red} #t:hover{fill:blue}</style>
  <circle id="t" cx="60" cy="60" r="40"/>
</svg>`;
// Combinator — der Trigger #wrap trägt :hover, das Subjekt #h ist default
// display:none (wird geskippt). Das emittierte Blatt ist das schwarze <rect>;
// es muss via Ancestor-Walk (#wrap-Compound) geflaggt werden.
const SVG_HOVER_DISPLAY = `<svg ${VB}>
  <style>#h{display:none} #wrap:hover #h{display:block}</style>
  <g id="wrap"><rect width="120" height="120" fill="black"/>
  <circle id="h" cx="60" cy="60" r="40" fill="white"/></g>
</svg>`;
const SVG_TARGET_FILL = `<svg ${VB}>
  <style>#t{fill:red} #t:target{fill:lime}</style>
  <circle id="t" cx="60" cy="60" r="40"/>
</svg>`;
const SVG_FOCUS_FILL = `<svg ${VB}>
  <style>#t{fill:red} #t:focus{fill:cyan}</style>
  <circle id="t" tabindex="0" cx="60" cy="60" r="40"/>
</svg>`;
const SVG_SET_ON_CLICK = `<svg ${VB}>
  <circle id="t" cx="60" cy="60" r="40" fill="red">
    <set attributeName="fill" to="green" begin="t.click"/>
  </circle>
</svg>`;

// ── GUARD-FIXTURES ─────────────────────────────────────────────────────────────
// B-LEAK: fill-loses Kind erbt; #g2:hover ändert das Kind-Rendering, aber
// child2.matches('#g2')===false → nur der Ancestor-Walk fängt es.
const SVG_BLEAK = `<svg ${VB}>
  <style>#g2{fill:red} #g2:hover{fill:blue}</style>
  <g id="g2"><circle id="child2" cx="60" cy="60" r="40"/></g>
</svg>`;
// B-CORRUPT: ein naiver globaler Strip macht `#t:not(:hover)` zu `#t:not()` →
// matches WIRFT. Der depth-safe Strip lässt :hover INNERHALB :not() stehen →
// `#t:not(:hover)` matcht den nicht-gehoverten t @t=0 → geflaggt, kein Crash.
const SVG_BCORRUPT = `<svg ${VB}>
  <style>#t:not(:hover){fill:red}</style>
  <circle id="t" cx="60" cy="60" r="40"/>
</svg>`;
// B-MEDIA: #m:focus liegt in einem @media-Block (kein top-level cssRules-Eintrag).
const SVG_BMEDIA = `<svg ${VB}>
  <style>@media all{#m:focus{fill:blue}}</style>
  <circle id="m" tabindex="0" cx="60" cy="60" r="40" fill="red"/>
</svg>`;
// SMIL-auf-Parent: <set begin="click"> ohne href → Flag wandert auf parentElement #t.
const SVG_SMIL_PARENT = `<svg ${VB}>
  <circle id="t" cx="60" cy="60" r="40" fill="red">
    <set attributeName="fill" to="green" begin="t.click"/>
  </circle>
</svg>`;

// ── NEGATIV-KONTROLLE + GEGENKONTROLLEN ────────────────────────────────────────
// Rein statisch — KEINE Pseudos / SMIL-Events → KEIN Feld, KEINE Warning.
const SVG_STATIC = `<svg ${VB}>
  <circle id="t" cx="60" cy="60" r="40" fill="red"/>
</svg>`;
// SMIL-CLOCK: <set begin="2s"> ist die MOTION-Achse (clock), KEIN Event → NICHT state.
const SVG_SMIL_CLOCK = `<svg ${VB}>
  <circle id="t" cx="60" cy="60" r="40" fill="red">
    <set attributeName="fill" to="green" begin="2s"/>
  </circle>
</svg>`;
// MOTION+STATE-Koexistenz: CSS-Animation (Motion) UND :hover-Regel (State) am
// selben Element → BEIDE Warnings (Append clobbert nicht).
const SVG_MOTION_PLUS_STATE = `<svg ${VB}>
  <style>
    @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
    #t { fill: red; animation: spin 2s linear infinite }
    #t:hover { fill: blue }
  </style>
  <rect id="t" x="20" y="20" width="80" height="80"/>
</svg>`;

// ══ 🔴 TRIPLE-REVIEW FIX-RUNDE: 5 ECHTE LECKS + 1 FALSE-POSITIVE ═══════════════
// F1 LECK: interaktiver Pseudo STECKT in :has() (analog :is()/:not()). Der
// depth-Strip ließ ihn drin → Basis matcht @t=0 nicht. Fix: ganzer :fn(...)-Block
// raus, sein interaktiver Inhalt zählt für die Trigger-Erkennung.
const SVG_F1_HAS = `<svg ${VB}>
  <style>#wrap:has(#probe:hover) #out{fill:blue}</style>
  <g id="wrap"><circle id="probe" cx="30" cy="30" r="10" fill="red"/>
  <circle id="out" cx="80" cy="80" r="20" fill="green"/></g>
</svg>`;
// F2 LECK: Komma INNERHALB :not(.armed, :hover) — naives split zerschnitt es →
// ungültige Basis → matches wirft → kein Flag. Fix: Komma-Split nur auf Tiefe 0.
const SVG_F2_NOT_COMMA = `<svg ${VB}>
  <style>#t:not(.armed, :hover){fill:red} #t{fill:green}</style>
  <circle id="t" cx="60" cy="60" r="40"/>
</svg>`;
// F3 LECK: @import (CSSImportRule) wurde nicht traversiert; @import überlebt
// sanitize. Fix: rule.styleSheet rekursiv absteigen.
const SVG_F3_IMPORT = `<svg ${VB}>
  <style>@import url("data:text/css,%23t%3Ahover%7Bfill%3Ablue%7D");</style>
  <circle id="t" cx="60" cy="60" r="40" fill="red"/>
</svg>`;
// F4 LECK: das SMIL-Ziel #shape liegt in <defs> (nie emittiert); sichtbar ist
// NUR die <use id="u">. Fix: jede <use>, deren ref === target (oder es enthält),
// wird geflaggt.
const SVG_F4_USE = `<svg ${VB}>
  <defs><rect id="shape" x="10" y="10" width="40" height="40" fill="red"/></defs>
  <use id="u" href="#shape"/>
  <set href="#shape" attributeName="width" to="80" begin="u.click"/>
</svg>`;
// F5 FALSE-POSITIVE: `:hover` als Attribut-STRING-Literal — der Parser darf es
// NICHT als Pseudo lesen/strippen. #t ist rein statisch → NICHT geflaggt.
const SVG_F5_ATTR_LITERAL = `<svg ${VB}>
  <style>[data-k=":hover"]{fill:blue}</style>
  <circle id="t" data-k="" cx="60" cy="60" r="40" fill="red"/>
</svg>`;
// G1 LECK: `g > :hover` → Strip ergibt trailing combinator (`g >`) → matches
// wirft. Fix: geleertes Compound → `*` (`g > *`), endet nie auf Combinator.
const SVG_G1_TRAILING_COMBINATOR = `<svg ${VB}>
  <style>g > :hover{fill:blue}</style>
  <g><rect id="t" x="20" y="20" width="80" height="80" fill="red"/></g>
</svg>`;

(async () => {
  try {
    // ── DIE 5 PROBE-KLASSEN ───────────────────────────────────────────────────
    console.log('=== Probe-Klasse 1: hover_fill (#t:hover{fill}) → #t state_dependent ===');
    let els = await analyzeEls(SVG_HOVER_FILL);
    let t = byId(els, 't');
    assert('hover_fill: #t in scene.elements', !!t,
      `ids=${JSON.stringify(els.map((e) => e.id))}`);
    assert('hover_fill: #t.state_dependent === true', t?.state_dependent === true,
      `got ${JSON.stringify(t?.state_dependent)}`);
    assert('hover_fill: #t trägt STATE_DEPENDENT', hasWarn(t, 'STATE_DEPENDENT'),
      `warnings=${JSON.stringify(t?.warnings)}`);
    assert('hover_fill: bbox_reliability bleibt reliable (KEIN Degrade)',
      t?.bbox_reliability === 'reliable', `got ${JSON.stringify(t?.bbox_reliability)}`);

    console.log('\n=== Probe-Klasse 2: hover_display (Combinator #wrap:hover #h) → das EXAKT betroffene #h geflaggt ===');
    els = await analyzeEls(SVG_HOVER_DISPLAY);
    // QSA-WURZELUMBAU (Härtungs-Runde 2): die Regel `#wrap:hover #h` betrifft das
    // SUBJEKT #h (nicht das Schwarz-<rect>). qSA('#wrap #h') trifft #h NATIV. #h ist
    // default display:none → der G-FIX zieht state_dependent VOR die Invisibility-
    // Skips → #h wird EMITTIERT (statt still verschluckt). Das schwarze <rect> wird
    // NICHT mehr fälschlich über-geflaggt (FP-E geheilt: kein #wrap-Compound-Über-Flag).
    const hdH = byId(els, 'h');
    assert('hover_display: #h in scene.elements (G-FIX emittiert das display:none-Subjekt)',
      !!hdH, `ids=${JSON.stringify(els.map((e) => e.id))}`);
    assert('hover_display: #h.state_dependent === true (qSA #wrap #h trifft #h nativ)',
      hdH?.state_dependent === true, `got ${JSON.stringify(hdH?.state_dependent)}`);
    assert('hover_display: #h trägt STATE_DEPENDENT', hasWarn(hdH, 'STATE_DEPENDENT'),
      `warnings=${JSON.stringify(hdH?.warnings)}`);
    // Negativ-Präzision: das schwarze <rect> (kein Subjekt der Regel) trägt das Flag NICHT.
    const hdRect = els.find((e) => e.tag === 'rect' && e.id !== 'h');
    assert('hover_display: schwarzes <rect> NICHT geflaggt (kein Über-Flag, FP-E geheilt)',
      hdRect && hdRect.state_dependent !== true,
      `rect=${JSON.stringify(hdRect)}`);

    console.log('\n=== Probe-Klasse 3: target_fill (#t:target) → #t state_dependent ===');
    els = await analyzeEls(SVG_TARGET_FILL);
    t = byId(els, 't');
    assert('target_fill: #t.state_dependent === true', t?.state_dependent === true,
      `got ${JSON.stringify(t?.state_dependent)}`);
    assert('target_fill: #t trägt STATE_DEPENDENT', hasWarn(t, 'STATE_DEPENDENT'),
      `warnings=${JSON.stringify(t?.warnings)}`);

    console.log('\n=== Probe-Klasse 4: focus_fill (#t:focus, tabindex) → #t state_dependent ===');
    els = await analyzeEls(SVG_FOCUS_FILL);
    t = byId(els, 't');
    assert('focus_fill: #t.state_dependent === true', t?.state_dependent === true,
      `got ${JSON.stringify(t?.state_dependent)}`);
    assert('focus_fill: #t trägt STATE_DEPENDENT', hasWarn(t, 'STATE_DEPENDENT'),
      `warnings=${JSON.stringify(t?.warnings)}`);

    console.log('\n=== Probe-Klasse 5: set_on_click (<set begin="t.click">) → #t (Parent) geflaggt ===');
    els = await analyzeEls(SVG_SET_ON_CLICK);
    t = byId(els, 't');
    assert('set_on_click: #t in scene.elements', !!t,
      `ids=${JSON.stringify(els.map((e) => e.id))}`);
    assert('set_on_click: #t.state_dependent === true (Flag auf Parent gewandert)',
      t?.state_dependent === true, `got ${JSON.stringify(t?.state_dependent)}`);
    assert('set_on_click: #t trägt STATE_DEPENDENT', hasWarn(t, 'STATE_DEPENDENT'),
      `warnings=${JSON.stringify(t?.warnings)}`);
    // Gegenprobe: das <set> selbst ist NICHT als eigenes Element emittiert.
    assert('set_on_click: <set> NICHT als eigenes scene-Element',
      !els.some((e) => e.tag === 'set'),
      `tags=${JSON.stringify(els.map((e) => e.tag))}`);

    // ── B-LEAK ────────────────────────────────────────────────────────────────
    console.log('\n=== B-LEAK: #g2:hover → fill-loses Kind child2 via Ancestor-Walk geflaggt ===');
    els = await analyzeEls(SVG_BLEAK);
    const child2 = byId(els, 'child2');
    assert('B-LEAK: child2 in scene.elements (das emittierte Blatt)', !!child2,
      `ids=${JSON.stringify(els.map((e) => e.id))}`);
    assert('B-LEAK: child2.state_dependent === true (Ancestor #g2 matcht, NICHT self)',
      child2?.state_dependent === true, `got ${JSON.stringify(child2?.state_dependent)}`);
    assert('B-LEAK: child2 trägt STATE_DEPENDENT', hasWarn(child2, 'STATE_DEPENDENT'),
      `warnings=${JSON.stringify(child2?.warnings)}`);

    // ── B-CORRUPT ─────────────────────────────────────────────────────────────
    console.log('\n=== B-CORRUPT: #t:not(:hover) → geflaggt UND kein Crash (depth-safe Strip) ===');
    let bcOut;
    let bcThrew = false;
    try {
      bcOut = await analyze(SVG_BCORRUPT, []);
    } catch (e) {
      bcThrew = true;
      bcOut = { error: String(e) };
    }
    assert('B-CORRUPT: analyze wirft NICHT (matches im try/catch)', !bcThrew,
      bcThrew ? JSON.stringify(bcOut?.error) : '');
    const bcEls = bcOut.structured?.scene?.elements ?? [];
    const bcT = byId(bcEls, 't');
    assert('B-CORRUPT: #t in scene.elements (NICHT still geskippt durch SyntaxError)',
      !!bcT, `ids=${JSON.stringify(bcEls.map((e) => e.id))}`);
    assert('B-CORRUPT: #t.state_dependent === true (:not(:hover) bleibt gültig)',
      bcT?.state_dependent === true, `got ${JSON.stringify(bcT?.state_dependent)}`);
    assert('B-CORRUPT: #t trägt STATE_DEPENDENT', hasWarn(bcT, 'STATE_DEPENDENT'),
      `warnings=${JSON.stringify(bcT?.warnings)}`);

    // ── B-MEDIA ───────────────────────────────────────────────────────────────
    console.log('\n=== B-MEDIA: @media all{#m:focus{...}} → #m geflaggt (Rekursion) ===');
    els = await analyzeEls(SVG_BMEDIA);
    const m = byId(els, 'm');
    assert('B-MEDIA: #m in scene.elements', !!m,
      `ids=${JSON.stringify(els.map((e) => e.id))}`);
    assert('B-MEDIA: #m.state_dependent === true (@media-Rekursion fand #m:focus)',
      m?.state_dependent === true, `got ${JSON.stringify(m?.state_dependent)}`);
    assert('B-MEDIA: #m trägt STATE_DEPENDENT', hasWarn(m, 'STATE_DEPENDENT'),
      `warnings=${JSON.stringify(m?.warnings)}`);

    // ── SMIL-auf-Parent ───────────────────────────────────────────────────────
    console.log('\n=== SMIL-auf-Parent: <set begin="t.click"> → #t (Parent), NICHT <set> ===');
    els = await analyzeEls(SVG_SMIL_PARENT);
    t = byId(els, 't');
    assert('SMIL-parent: #t.state_dependent === true', t?.state_dependent === true,
      `got ${JSON.stringify(t?.state_dependent)}`);
    assert('SMIL-parent: #t trägt STATE_DEPENDENT', hasWarn(t, 'STATE_DEPENDENT'),
      `warnings=${JSON.stringify(t?.warnings)}`);

    // ── NEGATIV-KONTROLLE (kein Über-Flag-Spam) ───────────────────────────────
    console.log('\n=== NEGATIV: rein statisches SVG → KEIN Feld, KEINE Warning ===');
    els = await analyzeEls(SVG_STATIC);
    t = byId(els, 't');
    assert('NEGATIV: #t in scene.elements', !!t,
      `ids=${JSON.stringify(els.map((e) => e.id))}`);
    assert('NEGATIV: #t trägt KEIN state_dependent-Feld',
      t && !('state_dependent' in t), `got ${JSON.stringify(t?.state_dependent)}`);
    assert('NEGATIV: #t trägt KEINE STATE_DEPENDENT-Warning',
      !hasWarn(t, 'STATE_DEPENDENT'), `warnings=${JSON.stringify(t?.warnings)}`);

    // ── MOTION+STATE-Koexistenz ───────────────────────────────────────────────
    console.log('\n=== MOTION+STATE: CSS-Animation UND :hover → BEIDE Warnings (Append clobbert nicht) ===');
    els = await analyzeEls(SVG_MOTION_PLUS_STATE);
    t = byId(els, 't');
    assert('MOTION+STATE: #t in scene.elements', !!t,
      `ids=${JSON.stringify(els.map((e) => e.id))}`);
    assert('MOTION+STATE: #t trägt NON_DETERMINISTIC_MOTION',
      hasWarn(t, 'NON_DETERMINISTIC_MOTION'), `warnings=${JSON.stringify(t?.warnings)}`);
    assert('MOTION+STATE: #t trägt STATE_DEPENDENT (zusätzlich, nicht geclobbert)',
      hasWarn(t, 'STATE_DEPENDENT'), `warnings=${JSON.stringify(t?.warnings)}`);
    assert('MOTION+STATE: #t.state_dependent === true', t?.state_dependent === true,
      `got ${JSON.stringify(t?.state_dependent)}`);

    // ── SMIL-CLOCK-Gegenkontrolle ─────────────────────────────────────────────
    console.log('\n=== SMIL-CLOCK: <set begin="2s"> → NICHT state_dependent (Motion-Achse) ===');
    els = await analyzeEls(SVG_SMIL_CLOCK);
    t = byId(els, 't');
    assert('SMIL-clock: #t in scene.elements', !!t,
      `ids=${JSON.stringify(els.map((e) => e.id))}`);
    assert('SMIL-clock: #t trägt KEIN state_dependent-Feld (2s ist clock, kein Event)',
      t && !('state_dependent' in t), `got ${JSON.stringify(t?.state_dependent)}`);
    assert('SMIL-clock: #t trägt KEINE STATE_DEPENDENT-Warning',
      !hasWarn(t, 'STATE_DEPENDENT'), `warnings=${JSON.stringify(t?.warnings)}`);

    // ══ 🔴 TRIPLE-REVIEW FIX-RUNDE: 5 LECKS + 1 FALSE-POSITIVE ═════════════════
    console.log('\n=== 🔴 F1: interaktiver Pseudo in :has() → #out geflaggt (ganzer :fn(...) raus) ===');
    els = await analyzeEls(SVG_F1_HAS);
    const f1Out = byId(els, 'out');
    assert('F1: #out in scene.elements', !!f1Out,
      `ids=${JSON.stringify(els.map((e) => e.id))}`);
    assert('F1: #out.state_dependent === true (:has(#probe:hover) erkannt)',
      f1Out?.state_dependent === true, `got ${JSON.stringify(f1Out?.state_dependent)}`);
    assert('F1: #out trägt STATE_DEPENDENT', hasWarn(f1Out, 'STATE_DEPENDENT'),
      `warnings=${JSON.stringify(f1Out?.warnings)}`);

    console.log('\n=== 🔴 F2: Komma in :not(.armed, :hover) → #t geflaggt, KEIN Crash ===');
    let f2Out;
    let f2Threw = false;
    try {
      f2Out = await analyze(SVG_F2_NOT_COMMA, []);
    } catch (e) {
      f2Threw = true;
      f2Out = { error: String(e) };
    }
    assert('F2: analyze wirft NICHT (Tiefe-0-Komma-Split intakt)', !f2Threw,
      f2Threw ? JSON.stringify(f2Out?.error) : '');
    const f2Els = f2Out.structured?.scene?.elements ?? [];
    const f2T = byId(f2Els, 't');
    assert('F2: #t in scene.elements', !!f2T,
      `ids=${JSON.stringify(f2Els.map((e) => e.id))}`);
    assert('F2: #t.state_dependent === true', f2T?.state_dependent === true,
      `got ${JSON.stringify(f2T?.state_dependent)}`);
    assert('F2: #t trägt STATE_DEPENDENT', hasWarn(f2T, 'STATE_DEPENDENT'),
      `warnings=${JSON.stringify(f2T?.warnings)}`);

    console.log('\n=== 🔴 F3: @import url(data:...:hover) → #t geflaggt (CSSImportRule traversiert) ===');
    els = await analyzeEls(SVG_F3_IMPORT);
    const f3T = byId(els, 't');
    assert('F3: #t in scene.elements', !!f3T,
      `ids=${JSON.stringify(els.map((e) => e.id))}`);
    assert('F3: #t.state_dependent === true (@import-Sheet abgestiegen)',
      f3T?.state_dependent === true, `got ${JSON.stringify(f3T?.state_dependent)}`);
    assert('F3: #t trägt STATE_DEPENDENT', hasWarn(f3T, 'STATE_DEPENDENT'),
      `warnings=${JSON.stringify(f3T?.warnings)}`);

    console.log('\n=== 🔴 F4: SMIL-Ziel in <defs> → die sichtbare <use id="u"> geflaggt ===');
    els = await analyzeEls(SVG_F4_USE);
    const f4U = byId(els, 'u');
    assert('F4: #u (die <use>) in scene.elements', !!f4U,
      `ids=${JSON.stringify(els.map((e) => e.id))}`);
    assert('F4: #u.state_dependent === true (ref #shape ist SMIL-Event-Ziel)',
      f4U?.state_dependent === true, `got ${JSON.stringify(f4U?.state_dependent)}`);
    assert('F4: #u trägt STATE_DEPENDENT', hasWarn(f4U, 'STATE_DEPENDENT'),
      `warnings=${JSON.stringify(f4U?.warnings)}`);

    console.log('\n=== 🔴 F5 FALSE-POSITIVE: `:hover` als Attribut-Literal → #t NICHT geflaggt ===');
    els = await analyzeEls(SVG_F5_ATTR_LITERAL);
    const f5T = byId(els, 't');
    assert('F5: #t in scene.elements', !!f5T,
      `ids=${JSON.stringify(els.map((e) => e.id))}`);
    assert('F5: #t trägt KEIN state_dependent-Feld (Attribut-Literal ist KEIN Pseudo)',
      f5T && !('state_dependent' in f5T), `got ${JSON.stringify(f5T?.state_dependent)}`);
    assert('F5: #t trägt KEINE STATE_DEPENDENT-Warning',
      !hasWarn(f5T, 'STATE_DEPENDENT'), `warnings=${JSON.stringify(f5T?.warnings)}`);

    console.log('\n=== 🔴 G1: `g > :hover` (trailing combinator) → #t geflaggt, KEIN Crash ===');
    let g1Out;
    let g1Threw = false;
    try {
      g1Out = await analyze(SVG_G1_TRAILING_COMBINATOR, []);
    } catch (e) {
      g1Threw = true;
      g1Out = { error: String(e) };
    }
    assert('G1: analyze wirft NICHT (geleertes Compound → *, kein trailing combinator)',
      !g1Threw, g1Threw ? JSON.stringify(g1Out?.error) : '');
    const g1Els = g1Out.structured?.scene?.elements ?? [];
    const g1T = byId(g1Els, 't');
    assert('G1: #t in scene.elements', !!g1T,
      `ids=${JSON.stringify(g1Els.map((e) => e.id))}`);
    assert('G1: #t.state_dependent === true (`g > *` matcht via Self/Ancestor)',
      g1T?.state_dependent === true, `got ${JSON.stringify(g1T?.state_dependent)}`);
    assert('G1: #t trägt STATE_DEPENDENT', hasWarn(g1T, 'STATE_DEPENDENT'),
      `warnings=${JSON.stringify(g1T?.warnings)}`);

    // ══ 🔴 HÄRTUNGS-RUNDE 2: querySelectorAll-Wurzelumbau (11 Lecks + 7 FPs) ════
    // Hilfs-Lookup: state_dependent eines emittierten Elements (true | false-Feld-frei
    // | NOT-EMITTED). isSD(els,id) → true nur bei state_dependent===true.
    const isSD = (e, id) => byId(e, id)?.state_dependent === true;
    const emitted = (e, id) => !!byId(e, id);

    console.log('\n=== 🔴 A1: #a:hover ~ #t (Sibling) → #t:true, #a:false (qSA nativ) ===');
    els = await analyzeEls(`<svg ${VB}><style>#a:hover ~ #t{fill:blue}</style>
      <rect id="a" x="0" y="0" width="20" height="20" fill="red"/>
      <rect id="t" x="40" y="0" width="20" height="20" fill="green"/></svg>`);
    assert('A1: #t.state_dependent===true', isSD(els, 't'),
      `got ${JSON.stringify(byId(els, 't')?.state_dependent)}`);
    assert('A1: #a NICHT geflaggt (Trigger, kein FP)', !isSD(els, 'a'),
      `got ${JSON.stringify(byId(els, 'a')?.state_dependent)}`);
    assert('A1: #t trägt STATE_DEPENDENT', hasWarn(byId(els, 't'), 'STATE_DEPENDENT'));

    console.log('\n=== 🔴 A2: #a:hover + #t (adjacent) → #t:true, #a:false ===');
    els = await analyzeEls(`<svg ${VB}><style>#a:hover + #t{fill:blue}</style>
      <rect id="a" x="0" y="0" width="20" height="20" fill="red"/>
      <rect id="t" x="40" y="0" width="20" height="20" fill="green"/></svg>`);
    assert('A2: #t.state_dependent===true', isSD(els, 't'),
      `got ${JSON.stringify(byId(els, 't')?.state_dependent)}`);
    assert('A2: #a NICHT geflaggt', !isSD(els, 'a'));

    console.log('\n=== 🔴 A3: #a:hover ~ #c #t2 (Kette) → nur #t2 ===');
    els = await analyzeEls(`<svg ${VB}><style>#a:hover ~ #c #t2{fill:blue}</style>
      <rect id="a" x="0" y="0" width="10" height="10" fill="red"/>
      <g id="c"><rect id="t2" x="40" y="0" width="10" height="10" fill="green"/></g></svg>`);
    assert('A3: #t2.state_dependent===true', isSD(els, 't2'),
      `got ${JSON.stringify(byId(els, 't2')?.state_dependent)}`);
    assert('A3: #a NICHT geflaggt', !isSD(els, 'a'));
    // #c ist ein <g> (SKIP_TAGS) → nie emittiert; falls doch je emittiert, NICHT geflaggt.
    assert('A3: #c NICHT geflaggt (Container, kein qSA-Subjekt)', !isSD(els, 'c'));

    console.log('\n=== 🔴 A-escape: .a\\>b:hover (class "a>b") → geflaggt, KEIN Crash ===');
    let aeThrew = false;
    let aeEls = [];
    try {
      aeEls =
        (await analyze(`<svg ${VB}><style>.a\\>b:hover{fill:blue}</style>
        <rect id="t" class="a>b" x="0" y="0" width="20" height="20" fill="red"/></svg>`, []))
          .structured?.scene?.elements ?? [];
    } catch (e) {
      aeThrew = true;
    }
    assert('A-escape: analyze wirft NICHT (qSA parst Escape nativ)', !aeThrew);
    assert('A-escape: #t.state_dependent===true', isSD(aeEls, 't'),
      `got ${JSON.stringify(byId(aeEls, 't')?.state_dependent)}`);

    console.log('\n=== 🔴 A-ns (DOKU-RESIDUAL): s|circle#t:hover → KEIN Crash (Flag darf fehlen) ===');
    let nsThrew = false;
    let nsEls = [];
    try {
      nsEls =
        (await analyze(`<svg ${VB}><style>s|circle#t:hover{fill:blue}</style>
        <circle id="t" cx="60" cy="60" r="40" fill="red"/></svg>`, []))
          .structured?.scene?.elements ?? [];
    } catch (e) {
      nsThrew = true;
    }
    assert('A-ns: analyze wirft NICHT (ns-Strip + try/catch crash-sicher)', !nsThrew);
    assert('A-ns: #t weiter emittiert (NIE falsch-tot)', emitted(nsEls, 't'),
      `ids=${JSON.stringify(nsEls.map((e) => e.id))}`);
    // Das Flag DARF fehlen (HTML-Parser verwirft die ns-Regel im CSSOM → unerreichbar).

    console.log('\n=== 🔴 B1: #wrap{& #t:hover{}} (Nesting) → #t:true (&→:is(#wrap), Abstieg) ===');
    els = await analyzeEls(`<svg ${VB}><style>#wrap{& #t:hover{fill:blue}}</style>
      <g id="wrap"><rect id="t" x="0" y="0" width="20" height="20" fill="red"/></g></svg>`);
    assert('B1: #t.state_dependent===true', isSD(els, 't'),
      `got ${JSON.stringify(byId(els, 't')?.state_dependent)}`);

    console.log('\n=== 🔴 B2: .box{&:hover{}} (Nesting self) → .box-Element:true ===');
    els = await analyzeEls(`<svg ${VB}><style>.box{&:hover{fill:blue}}</style>
      <rect id="t" class="box" x="0" y="0" width="20" height="20" fill="red"/></svg>`);
    assert('B2: .box-Element (#t).state_dependent===true', isSD(els, 't'),
      `got ${JSON.stringify(byId(els, 't')?.state_dependent)}`);

    console.log('\n=== 🔴 C: SMIL use-chain reverse-order Tiefe 5 → ALLE 5 geflaggt (Fixpunkt) ===');
    let cThrew = false;
    let cEls = [];
    try {
      cEls =
        (await analyze(`<svg ${VB}>
        <use id="F" href="#E"/><use id="E" href="#D"/><use id="D" href="#C"/>
        <use id="C" href="#B"/><use id="B" href="#rect_A"/>
        <defs><rect id="rect_A" x="0" y="0" width="10" height="10" fill="red">
          <set attributeName="width" to="20" begin="rect_A.click"/></rect></defs></svg>`, []))
          .structured?.scene?.elements ?? [];
    } catch (e) {
      cThrew = true;
    }
    assert('C: analyze wirft NICHT', !cThrew);
    for (const id of ['B', 'C', 'D', 'E', 'F']) {
      assert(`C: #${id} (use) state_dependent===true (Fixpunkt erreicht alle Tiefen)`,
        isSD(cEls, id), `got ${JSON.stringify(byId(cEls, id)?.state_dependent)}; ids=${JSON.stringify(cEls.map((e) => e.id))}`);
    }

    console.log('\n=== 🔴 D-Taxonomie: load/none/syncbase → false; event/accessKey → true ===');
    const dCase = async (begin) =>
      analyzeEls(`<svg ${VB}><circle id="t" cx="60" cy="60" r="40" fill="red">
        <set attributeName="fill" to="green" begin="${begin}"/></circle></svg>`);
    assert("D-load: begin='load' → #t NICHT geflaggt (Auto-Start)",
      !isSD(await dCase('load'), 't'));
    assert("D-none: begin='none' → #t NICHT geflaggt (script-only, post-Sanitize tot)",
      !isSD(await dCase('none'), 't'));
    assert("D-syncbase: begin='a.begin+2s' → #t NICHT geflaggt (zeitlich gekoppelt)",
      !isSD(await dCase('a.begin+2s'), 't'));
    assert("D-event: begin='t.click' → #t geflaggt (echtes Interaktions-Event)",
      isSD(await dCase('t.click'), 't'));
    assert("D-accessKey: begin='accessKey(x)' → #t geflaggt (Tastatur-Trigger)",
      isSD(await dCase('accessKey(x)'), 't'));

    console.log('\n=== 🔴 E1: :hover #h (mit #other daneben) → nur #h (kein *-All-Flag) ===');
    els = await analyzeEls(`<svg ${VB}><style>:hover #h{fill:blue}</style>
      <rect id="h" x="0" y="0" width="20" height="20" fill="red"/>
      <rect id="other" x="40" y="0" width="20" height="20" fill="green"/></svg>`);
    assert('E1: #h.state_dependent===true', isSD(els, 'h'),
      `got ${JSON.stringify(byId(els, 'h')?.state_dependent)}`);
    assert('E1: #other NICHT geflaggt (kein *-Über-Flag, FP-E geheilt)', !isSD(els, 'other'),
      `got ${JSON.stringify(byId(els, 'other')?.state_dependent)}`);

    console.log('\n=== 🔴 E2: #a:hover + #b → #b:true, #a:false (kein Präfix-Trigger-FP) ===');
    els = await analyzeEls(`<svg ${VB}><style>#a:hover + #b{fill:blue}</style>
      <rect id="a" x="0" y="0" width="20" height="20" fill="red"/>
      <rect id="b" x="40" y="0" width="20" height="20" fill="green"/></svg>`);
    assert('E2: #b.state_dependent===true', isSD(els, 'b'));
    assert('E2: #a NICHT geflaggt', !isSD(els, 'a'));

    console.log('\n=== 🔴 F: @scope (#wrap:hover){circle{}} → das circle in #wrap geflaggt ===');
    let fThrew = false;
    let fEls = [];
    try {
      fEls =
        (await analyze(`<svg ${VB}><style>@scope (#wrap:hover){circle{fill:blue}}</style>
        <g id="wrap"><circle id="t" cx="60" cy="60" r="40" fill="red"/></g></svg>`, []))
          .structured?.scene?.elements ?? [];
    } catch (e) {
      fThrew = true;
    }
    assert('F: analyze wirft NICHT', !fThrew);
    assert('F: #t (circle in #wrap).state_dependent===true (CSSScopeRule.start tokenisiert)',
      isSD(fEls, 't'), `got ${JSON.stringify(byId(fEls, 't')?.state_dependent)}; ids=${JSON.stringify(fEls.map((e) => e.id))}`);

    console.log('\n=== 🔴 G: #h{display:none} #t:hover~#h{display:block} → #h EMITTIERT (G-FIX), kein grid-Crash ===');
    let gThrew = false;
    let gEls = [];
    try {
      gEls =
        (await analyze(`<svg ${VB}><style>#h{display:none} #t:hover~#h{display:block}</style>
        <rect id="t" x="0" y="0" width="20" height="20" fill="red"/>
        <rect id="h" x="40" y="0" width="20" height="20" fill="green"/></svg>`, []))
          .structured?.scene?.elements ?? [];
    } catch (e) {
      gThrew = true;
    }
    assert('G: analyze wirft NICHT (KEIN bbox:null-grid-Crash)', !gThrew);
    const gH = byId(gEls, 'h');
    assert('G: #h EMITTIERT (G-FIX: state VOR Invisibility-Skips)', !!gH,
      `ids=${JSON.stringify(gEls.map((e) => e.id))}`);
    assert('G: #h.state_dependent===true', gH?.state_dependent === true,
      `got ${JSON.stringify(gH?.state_dependent)}`);
    assert('G: #h.paint_visible===false (display:none = 0 Tinte @t=0)',
      gH?.paint_visible === false, `got ${JSON.stringify(gH?.paint_visible)}`);
    assert('G: #h trägt STATE_DEPENDENT', hasWarn(gH, 'STATE_DEPENDENT'),
      `warnings=${JSON.stringify(gH?.warnings)}`);
    assert('G: #h trägt PAINT_NOT_VISIBLE', hasWarn(gH, 'PAINT_NOT_VISIBLE'),
      `warnings=${JSON.stringify(gH?.warnings)}`);
    assert('G: #h trägt eine cell (echte 0×0-bbox durchgereicht, kein null)',
      typeof gH?.cell === 'string', `cell=${JSON.stringify(gH?.cell)}`);

    console.log('\n=== 🔴 CX5: :is([data-k=":hover"]) → Attribut-Literal zählt NICHT ===');
    els = await analyzeEls(`<svg ${VB}><style>:is([data-k=":hover"]){fill:blue}</style>
      <circle id="t" data-k=":hover" cx="60" cy="60" r="40" fill="red"/></svg>`);
    assert('CX5: #t in scene.elements', emitted(els, 't'));
    assert('CX5: #t NICHT geflaggt (bracket-bewusster rekursiver Arg-Check)',
      !isSD(els, 't'), `got ${JSON.stringify(byId(els, 't')?.state_dependent)}`);
    assert('CX5: #t trägt KEINE STATE_DEPENDENT-Warning',
      !hasWarn(byId(els, 't'), 'STATE_DEPENDENT'));

    // ══ 🔴 HÄRTUNGS-RUNDE 3: SMIL-Syncbase-Graph + Root-Match + 4 FP-Min + C1 ════
    console.log('\n=== 🔴 L1: SMIL-Syncbase-Transitiv-Kette (click) → victimC:true ===');
    let l1 = await analyzeEls(`<svg ${VB}>
      <rect id="victimC" x="0" y="0" width="20" height="20" fill="red">
        <animateTransform id="C" attributeName="transform" type="translate" to="10 0" begin="B.begin"/></rect>
      <rect id="trigger3" x="40" y="0" width="20" height="20" fill="blue"/>
      <set id="A3" href="#trigger3" attributeName="fill" to="green" begin="trigger3.click"/>
      <set id="B" href="#trigger3" attributeName="fill" to="lime" begin="A3.begin"/></svg>`);
    assert('L1-click: #victimC.state_dependent===true (A3.click→B.begin→C.begin transitiv)',
      isSD(l1, 'victimC'), `got ${JSON.stringify(byId(l1, 'victimC')?.state_dependent)}; ids=${JSON.stringify(l1.map((e) => e.id))}`);
    assert('L1-click: #victimC trägt STATE_DEPENDENT', hasWarn(byId(l1, 'victimC'), 'STATE_DEPENDENT'));

    console.log('\n=== 🔴 L1: Syncbase-Kette (mouseover) → victim:true ===');
    l1 = await analyzeEls(`<svg ${VB}>
      <rect id="victim" x="0" y="0" width="20" height="20" fill="red">
        <animate id="C" attributeName="x" to="50" begin="B.begin"/></rect>
      <rect id="trig" x="40" y="0" width="20" height="20" fill="blue"/>
      <set id="A" href="#trig" attributeName="fill" to="green" begin="trig.mouseover"/>
      <set id="B" href="#trig" attributeName="fill" to="lime" begin="A.begin"/></svg>`);
    assert('L1-mouseover: #victim.state_dependent===true', isSD(l1, 'victim'),
      `got ${JSON.stringify(byId(l1, 'victim')?.state_dependent)}`);

    console.log('\n=== 🔴 L1: Syncbase via X.end (end-event-Variante) → victim2:true ===');
    l1 = await analyzeEls(`<svg ${VB}>
      <rect id="victim2" x="0" y="0" width="20" height="20" fill="red">
        <animate id="C2" attributeName="x" to="50" begin="A2.end"/></rect>
      <rect id="trig2" x="40" y="0" width="20" height="20" fill="blue"/>
      <set id="A2" href="#trig2" attributeName="fill" to="green" begin="trig2.click"/></svg>`);
    assert('L1-endevent: #victim2.state_dependent===true (A2.end, A2 ist click-verwurzelt)',
      isSD(l1, 'victim2'), `got ${JSON.stringify(byId(l1, 'victim2')?.state_dependent)}`);

    console.log('\n=== 🔴 L1 NEGATIV: Syncbase auf NICHT-interaktive Wurzel (load) → false ===');
    l1 = await analyzeEls(`<svg ${VB}>
      <rect id="v3" x="0" y="0" width="20" height="20" fill="red">
        <animate id="C3" attributeName="x" to="50" begin="A4.begin"/></rect>
      <set id="A4" href="#v3" attributeName="fill" to="green" begin="load"/></svg>`);
    assert('L1-neg: #v3 NICHT geflaggt (A4 ist load-verwurzelt = auto, keine Interaktion)',
      !isSD(l1, 'v3'), `got ${JSON.stringify(byId(l1, 'v3')?.state_dependent)}`);

    console.log('\n=== 🔴 L2: #root:hover{} (Root-svg-Selbst-Match) → #t:true ===');
    let l2 = await analyzeEls(`<svg id="root" ${VB}><style>#root:hover{fill:blue}</style>
      <circle id="t" cx="60" cy="60" r="40" fill="red"/></svg>`);
    assert('L2-root: #t.state_dependent===true (svg.matches(#root) + Nachfahren)',
      isSD(l2, 't'), `got ${JSON.stringify(byId(l2, 't')?.state_dependent)}`);
    l2 = await analyzeEls(`<svg id="root" ${VB}><style>svg:hover circle{fill:blue}</style>
      <circle id="t" cx="60" cy="60" r="40" fill="red"/></svg>`);
    assert('L2-svg: svg:hover circle → #t.state_dependent===true', isSD(l2, 't'),
      `got ${JSON.stringify(byId(l2, 't')?.state_dependent)}`);

    console.log('\n=== 🔴 E1: :is(#r0):hover → nur #r0 (kein *-Über-Flag) ===');
    els = await analyzeEls(`<svg ${VB}><style>:is(#r0):hover{fill:blue}</style>
      <rect id="r0" x="0" y="0" width="10" height="10" fill="red"/>
      <rect id="r1" x="20" y="0" width="10" height="10" fill="green"/>
      <rect id="r2" x="40" y="0" width="10" height="10" fill="blue"/></svg>`);
    assert('E1: #r0.state_dependent===true', isSD(els, 'r0'),
      `got ${JSON.stringify(byId(els, 'r0')?.state_dependent)}`);
    assert('E1: #r1 NICHT geflaggt (strukturelles :is(#r0) präzise behalten)', !isSD(els, 'r1'));
    assert('E1: #r2 NICHT geflaggt', !isSD(els, 'r2'));

    console.log('\n=== 🔴 E2: :is(&:hover) .hit (Nesting) → inneres .hit:true (Runde-5: ganzer :fn raus) ===');
    els = await analyzeEls(`<svg ${VB}><style>#wrap{ :is(&:hover) .hit{fill:blue} }</style>
      <g id="wrap"><rect id="inner" class="hit" x="0" y="0" width="10" height="10" fill="red"/></g>
      <rect id="outer" class="hit" x="40" y="0" width="10" height="10" fill="green"/></svg>`);
    // F-A (Runde 5): das interaktiv-tragende `:is(:is(#wrap):hover)` wird GANZ entfernt
    // (broadest match, leck-frei) → Basis `.hit` (global). #inner MUSS geflaggt sein;
    // #outer wird als bewusster, leck-freier ÜBER-Flag MIT-geflaggt (kein false-silent).
    // Das ist der explizit akzeptierte Trade: nie ein Leck, lieber ein Über-Flag.
    assert('E2: #inner.state_dependent===true (.hit-Basis matcht)', isSD(els, 'inner'),
      `got ${JSON.stringify(byId(els, 'inner')?.state_dependent)}; ids=${JSON.stringify(els.map((e) => e.id))}`);
    assert('E2: #outer ist bewusster leck-freier ÜBER-Flag (mit .hit-Basis erfasst)',
      isSD(els, 'outer'), `got ${JSON.stringify(byId(els, 'outer')?.state_dependent)}`);

    console.log('\n=== 🔴 E3: @scope (#wrap){rect:hover} → #t in wrap:true, #t2 außen:false ===');
    els = await analyzeEls(`<svg ${VB}><style>@scope (#wrap){ rect:hover{fill:blue} }</style>
      <g id="wrap"><rect id="t" x="0" y="0" width="10" height="10" fill="red"/></g>
      <rect id="t2" x="40" y="0" width="10" height="10" fill="green"/></svg>`);
    assert('E3: #t (rect in #wrap).state_dependent===true (Body an scopeRoot gebunden)',
      isSD(els, 't'), `got ${JSON.stringify(byId(els, 't')?.state_dependent)}; ids=${JSON.stringify(els.map((e) => e.id))}`);
    assert('E3: #t2 (rect außerhalb #wrap) NICHT geflaggt (scope-Bindung)', !isSD(els, 't2'),
      `got ${JSON.stringify(byId(els, 't2')?.state_dependent)}`);

    console.log('\n=== 🔴 E4: begin="wallclock(...)" → NICHT geflaggt (zeitgesteuert) ===');
    els = await analyzeEls(`<svg ${VB}><circle id="t" cx="60" cy="60" r="40" fill="red">
      <set attributeName="fill" to="green" begin="wallclock(2030-01-01T00:00)"/></circle></svg>`);
    assert('E4: #t NICHT geflaggt (wallclock = auto)', !isSD(els, 't'),
      `got ${JSON.stringify(byId(els, 't')?.state_dependent)}`);

    console.log('\n=== 🔴 C1: display:none+:hover-reveal+stroke → state:true, paint:false, KEIN overflow ===');
    els = await analyzeEls(`<svg ${VB}><style>#h{display:none} #t:hover~#h{display:block}</style>
      <rect id="t" x="0" y="0" width="20" height="20" fill="red"/>
      <rect id="h" x="40" y="40" width="20" height="20" fill="green" stroke="black" stroke-width="10"/></svg>`);
    const c1H = byId(els, 'h');
    assert('C1: #h EMITTIERT', !!c1H, `ids=${JSON.stringify(els.map((e) => e.id))}`);
    assert('C1: #h.state_dependent===true', c1H?.state_dependent === true,
      `got ${JSON.stringify(c1H?.state_dependent)}`);
    assert('C1: #h.paint_visible===false', c1H?.paint_visible === false,
      `got ${JSON.stringify(c1H?.paint_visible)}`);
    assert('C1: #h.has_paint_overflow NICHT true (Kreuz-Achsen-Konsistenz)',
      c1H?.has_paint_overflow !== true, `got ${JSON.stringify(c1H?.has_paint_overflow)}`);
    assert('C1: #h trägt KEINE PAINT_OVERFLOW-Warning',
      !hasWarn(c1H, 'PAINT_OVERFLOW'), `warnings=${JSON.stringify(c1H?.warnings)}`);

    // ══ 🔴 HÄRTUNGS-RUNDE 4: LECK-FREIHEIT BY CONSTRUCTION (3-Stufen-Leiter) ════
    // Ein interaktiv-tragender Selektor endet NIE mit „nichts" geflaggt. Nach Runde 5
    // (F-A: interaktiv-tragende funktionale Pseudos werden GANZ entfernt) strippt
    // `:nth-child(2 of :hover)` → '' → `*` → qSA(`*`) GELINGT (Stufe 1) → flag-all
    // (kein throw, daher kein COARSE — das ist korrekt: keine grobe Notlösung nötig,
    // der broadest match ist exakt das, was die Regel autorisiert). Die GARANTIE
    // „≥1 Element, NIE 0" bleibt die load-bearing Invariante; die STUFE-2/3-Leiter
    // (Salvage/Fallback + STATE_DETECTION_COARSE) ist die tiefere Defensive für
    // genuin werfende Rest-Selektoren (in diesem Chromium nach F-A kaum mehr via CSS
    // erreichbar — `||`/`s|`/`:nth(2 of)` verwirft der CSS-Parser VOR dem CSSOM).
    console.log('\n=== 🔴 H4-Leiter: interaktiver Selektor flaggt IMMER ≥1, NIE 0, kein Crash ===');
    let h4Threw = false;
    let h4Els = [];
    try {
      h4Els =
        (await analyze(`<svg ${VB}><style>:nth-child(2 of :hover){fill:red}</style>
        <g><rect id="a" x="0" y="0" width="10" height="10" fill="green"/>
        <rect id="t" x="20" y="0" width="10" height="10" fill="blue"/></g></svg>`, []))
          .structured?.scene?.elements ?? [];
    } catch (e) {
      h4Threw = true;
    }
    assert('H4-Leiter: analyze wirft NICHT (Leiter fängt jeden qSA-Throw)', !h4Threw);
    // GARANTIE (load-bearing): ≥1 Element geflaggt — NIE 0 bei interaktiv-tragendem Teil.
    const h4Flagged = h4Els.filter((e) => e.state_dependent === true);
    assert('H4-Leiter: ≥1 Element state_dependent (NIE 0 = kein false-silent Leck)',
      h4Flagged.length >= 1, `flagged=${h4Flagged.length}; ids=${JSON.stringify(h4Els.map((e) => e.id))}`);
    assert('H4-Leiter: #t (das eigentliche Ziel) ist geflaggt', isSD(h4Els, 't'),
      `got ${JSON.stringify(byId(h4Els, 't')?.state_dependent)}`);

    console.log('\n=== 🔴 H4-NEGATIV: statisches SVG → KEIN COARSE, KEIN state, kein Leiter-Trigger ===');
    const h4neg = await analyzeEls(`<svg ${VB}>
      <circle id="t" cx="60" cy="60" r="40" fill="red"/>
      <rect id="r" x="0" y="0" width="20" height="20" fill="blue"/></svg>`);
    for (const id of ['t', 'r']) {
      const e = byId(h4neg, id);
      assert(`H4-neg: #${id} trägt KEIN state_dependent-Feld`,
        e && !('state_dependent' in e), `got ${JSON.stringify(e?.state_dependent)}`);
      assert(`H4-neg: #${id} trägt KEINE STATE_DETECTION_COARSE-Warning`,
        !hasWarn(e, 'STATE_DETECTION_COARSE'), `warnings=${JSON.stringify(e?.warnings)}`);
      assert(`H4-neg: #${id} trägt KEINE STATE_DEPENDENT-Warning`,
        !hasWarn(e, 'STATE_DEPENDENT'), `warnings=${JSON.stringify(e?.warnings)}`);
    }

    console.log('\n=== 🔴 H4-DETERMINISMUS: werfender Selektor 2× inspect byte-identisch ===');
    const h4SVG = `<svg ${VB}><style>:nth-child(2 of :hover){fill:red}</style>
      <g><rect id="a" x="0" y="0" width="10" height="10" fill="green"/>
      <rect id="t" x="20" y="0" width="10" height="10" fill="blue"/></g></svg>`;
    const h4d1 = canon((await inspect(h4SVG)).structured);
    const h4d2 = canon((await inspect(h4SVG)).structured);
    assert('H4-det: Salvage/Fallback ist reihenfolge-invariant (Set + Doku-Ordnung)',
      h4d1 === h4d2, `d1!==d2 (len ${h4d1.length} vs ${h4d2.length})`);

    // ══ 🔴 HÄRTUNGS-RUNDE 5: CSS-:has-Komma-Zweig + SMIL end/Hyperlink/syncbase ══
    console.log('\n=== 🔴 F-A: :has(:hover,#never) #t → #t:true (ganzer :fn raus, kein leerer qSA-Leak) ===');
    let faThrew = false;
    let faEls = [];
    try {
      faEls =
        (await analyze(`<svg ${VB}><style>#w:has(:hover,#never) #t{fill:red}</style>
        <g id="w"><rect id="probe" x="0" y="0" width="10" height="10" fill="blue"/>
        <rect id="t" x="20" y="0" width="10" height="10" fill="green"/></g></svg>`, []))
          .structured?.scene?.elements ?? [];
    } catch (e) {
      faThrew = true;
    }
    assert('F-A: analyze wirft NICHT', !faThrew);
    assert('F-A: #t.state_dependent===true (`#w #t` statt leerem `#w:has(#never)`)',
      isSD(faEls, 't'), `got ${JSON.stringify(byId(faEls, 't')?.state_dependent)}; ids=${JSON.stringify(faEls.map((e) => e.id))}`);
    assert('F-A: #t trägt STATE_DEPENDENT', hasWarn(byId(faEls, 't'), 'STATE_DEPENDENT'));
    // Variante :is(:hover,#never).x → die ganze :is() raus → .x global, #t (class x) geflaggt.
    els = await analyzeEls(`<svg ${VB}><style>:is(:hover,#never).x{fill:red}</style>
      <rect id="t" class="x" x="0" y="0" width="10" height="10" fill="green"/></svg>`);
    assert('F-A-is: #t (class x).state_dependent===true', isSD(els, 't'),
      `got ${JSON.stringify(byId(els, 't')?.state_dependent)}`);

    console.log('\n=== 🔴 F-B: SMIL end="t.click" (begin=0s) → #t:true ===');
    els = await analyzeEls(`<svg ${VB}><rect id="t" x="0" y="0" width="20" height="20" fill="blue">
      <set attributeName="fill" to="red" begin="0s" end="t.click"/></rect></svg>`);
    assert('F-B: #t.state_dependent===true (end-Interaktion erkannt)', isSD(els, 't'),
      `got ${JSON.stringify(byId(els, 't')?.state_dependent)}`);
    assert('F-B: #t trägt STATE_DEPENDENT', hasWarn(byId(els, 't'), 'STATE_DEPENDENT'));

    console.log('\n=== 🔴 F-B NEGATIV: begin=indefinite end=indefinite → false ===');
    els = await analyzeEls(`<svg ${VB}><rect id="t" x="0" y="0" width="20" height="20" fill="blue">
      <set attributeName="fill" to="red" begin="indefinite" end="indefinite"/></rect></svg>`);
    assert('F-B-neg: #t NICHT geflaggt (kein Interaktions-/Syncbase-Token)', !isSD(els, 't'),
      `got ${JSON.stringify(byId(els, 't')?.state_dependent)}`);

    console.log('\n=== 🔴 F-C: <a href="#anim"> + begin=indefinite → #t:true (Hyperlink-Aktivierung) ===');
    els = await analyzeEls(`<svg ${VB}>
      <rect id="t" x="0" y="0" width="20" height="20" fill="blue">
        <set id="anim" begin="indefinite" attributeName="fill" to="red" fill="freeze"/></rect>
      <a href="#anim"><rect id="btn" x="40" y="0" width="20" height="20" fill="gray"/></a></svg>`);
    assert('F-C: #t.state_dependent===true (<a> aktiviert das indefinite-Anim)', isSD(els, 't'),
      `got ${JSON.stringify(byId(els, 't')?.state_dependent)}; ids=${JSON.stringify(els.map((e) => e.id))}`);
    assert('F-C: #t trägt STATE_DEPENDENT', hasWarn(byId(els, 't'), 'STATE_DEPENDENT'));

    console.log('\n=== 🔴 F-D: syncbase a1.repeat(1) mit a1=interaktiv → Ziel:true ===');
    els = await analyzeEls(`<svg ${VB}>
      <rect id="t" x="0" y="0" width="20" height="20" fill="blue">
        <animate id="C" attributeName="x" to="50" begin="a1.repeat(1)"/></rect>
      <rect id="trig" x="40" y="0" width="20" height="20" fill="gray"/>
      <set id="a1" href="#trig" attributeName="fill" to="red" begin="trig.click"/></svg>`);
    assert('F-D: #t.state_dependent===true (a1.repeat(1)-Kante propagiert)', isSD(els, 't'),
      `got ${JSON.stringify(byId(els, 't')?.state_dependent)}`);

    console.log('\n=== 🔴 F-D NEGATIV: reine Zeit-syncbase-Kette → false (kein Über-Flag) ===');
    els = await analyzeEls(`<svg ${VB}>
      <rect id="t" x="0" y="0" width="20" height="20" fill="blue">
        <animate id="C" attributeName="x" to="50" begin="a1.begin"/></rect>
      <set id="a1" href="#t" attributeName="fill" to="red" begin="2s"/></svg>`);
    assert('F-D-neg: #t NICHT geflaggt (a1 ist 2s-zeit-verwurzelt, keine Interaktion)',
      !isSD(els, 't'), `got ${JSON.stringify(byId(els, 't')?.state_dependent)}`);

    console.log('\n=== 🔴 H5-NEGATIV: rein statisches SVG → nichts geflaggt ===');
    els = await analyzeEls(`<svg ${VB}><circle id="t" cx="60" cy="60" r="40" fill="red"/>
      <rect id="r" x="0" y="0" width="20" height="20" fill="blue"/></svg>`);
    for (const id of ['t', 'r']) {
      const e = byId(els, id);
      assert(`H5-neg: #${id} trägt KEIN state_dependent-Feld`,
        e && !('state_dependent' in e), `got ${JSON.stringify(e?.state_dependent)}`);
      assert(`H5-neg: #${id} trägt KEINE STATE_DEPENDENT-Warning`,
        !hasWarn(e, 'STATE_DEPENDENT'), `warnings=${JSON.stringify(e?.warnings)}`);
    }

    console.log('\n=== 🔴 H5-DETERMINISMUS: SMIL-end/Hyperlink/syncbase 2× inspect byte-identisch ===');
    const h5SVG = `<svg ${VB}>
      <rect id="t" x="0" y="0" width="20" height="20" fill="blue">
        <set id="anim" begin="indefinite" attributeName="fill" to="red"/>
        <animate id="C" attributeName="x" to="50" begin="a1.repeat(1)"/></rect>
      <rect id="trig" x="40" y="0" width="20" height="20" fill="gray"/>
      <set id="a1" href="#trig" attributeName="fill" to="red" begin="trig.click" end="trig.mouseout"/>
      <a href="#anim"><rect id="btn" x="80" y="0" width="20" height="20" fill="gray"/></a></svg>`;
    const h5d1 = canon((await inspect(h5SVG)).structured);
    const h5d2 = canon((await inspect(h5SVG)).structured);
    assert('H5-det: SMIL-Wurzel-Fixpunkt reihenfolge-invariant (Set + Doku-Ordnung)',
      h5d1 === h5d2, `d1!==d2 (len ${h5d1.length} vs ${h5d2.length})`);

    // ── PROSA-EHRLICHKEIT ─────────────────────────────────────────────────────
    console.log('\n=== PROSA: state-dependent Szene ehrlich (NICHT „✓ Alles korrekt") ===');
    const proseLines = (p) => p.split('\n');
    const statusLine = (p) => proseLines(p).find((l) => l.startsWith('STATUS')) || '';
    const tLine = (p) => proseLines(p).find((l) => l.includes('#t')) || '';
    const pState = (await inspect(SVG_HOVER_FILL)).prose;
    assert('prose-state: STATUS NICHT „✓ Alles korrekt"',
      !statusLine(pState).includes('Alles korrekt'), `STATUS="${statusLine(pState)}"`);
    assert('prose-state: STATUS nennt „zustands-abhängig"',
      /zustands-abhängig/.test(statusLine(pState)), `STATUS="${statusLine(pState)}"`);
    assert('prose-state: #t-Zeile trägt STATE_DEPENDENT-Vermerk',
      tLine(pState).includes('STATE_DEPENDENT'), `line="${tLine(pState)}"`);
    assert('prose-state: #t-Zeile endet NICHT auf bare „✓"',
      !/✓\s*$/.test(tLine(pState)), `line="${tLine(pState)}"`);

    console.log('\n=== PROSA NEGATIV: rein statische Szene → „✓ Alles korrekt", kein Rauschen ===');
    const pStatic = (await inspect(SVG_STATIC)).prose;
    assert('prose-neg: STATUS === „✓ Alles korrekt"',
      statusLine(pStatic).includes('Alles korrekt'), `STATUS="${statusLine(pStatic)}"`);
    assert('prose-neg: KEINE „zustands-abhängig"/STATE_DEPENDENT-Erwähnung',
      !pStatic.includes('zustands-abhängig') && !pStatic.includes('STATE_DEPENDENT'),
      `prose=${JSON.stringify(pStatic)}`);

    // ── MCP-SCHEMA: ein state_dependent-Output validiert gegen die outputSchema ─
    console.log('\n=== MCP-SCHEMA: analyze-Output mit state_dependent validiert ===');
    const ana = await analyze(SVG_HOVER_FILL, []);
    const anaT = byId(ana.structured?.scene?.elements, 't');
    assert('schema-precond: analyze emittiert state_dependent:true',
      anaT?.state_dependent === true, `got ${JSON.stringify(anaT?.state_dependent)}`);
    const parsed = analyzeOutputSchema.safeParse(ana.structured);
    assert('schema: outputSchema akzeptiert das state_dependent-tragende Resultat',
      parsed.success, parsed.success ? '' : JSON.stringify(parsed.error?.issues?.slice(0, 3)));

    // ── DETERMINISMUS ─────────────────────────────────────────────────────────
    // Über inspect (wie test_heal_r6_invisibility): analyze hängt eine per-Aufruf-
    // analysisId (UUID) in iteration.meta — das ist eine Session-Kennung, KEINE
    // Szene-Daten, und by-design nicht-deterministisch. Der „structured byte-
    // identisch"-Vertrag bezieht sich auf die GEMESSENE Szene → inspect.structured.
    console.log('\n=== DETERMINISMUS: 2× inspect desselben state-SVG → byte-identisch ===');
    const d1 = canon((await inspect(SVG_HOVER_FILL)).structured);
    const d2 = canon((await inspect(SVG_HOVER_FILL)).structured);
    assert('determinismus state: 2× byte-identisch', d1 === d2,
      `d1!==d2 (len ${d1.length} vs ${d2.length})`);
    // Gegenprobe mit dem SMIL-Ziel-Pfad (Set-Targeting).
    const e1 = canon((await inspect(SVG_SET_ON_CLICK)).structured);
    const e2 = canon((await inspect(SVG_SET_ON_CLICK)).structured);
    assert('determinismus smil-state: 2× byte-identisch', e1 === e2,
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
