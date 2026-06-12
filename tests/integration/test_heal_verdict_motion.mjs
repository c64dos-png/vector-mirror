/**
 * test_heal_verdict_motion.mjs — Heal 5 „Verdikt-Ehrlichkeit + motion_dependent"
 * (F-AT-2-005 präzisiert; Spec: docs/internal/an internal spec)
 *
 * Real-Chromium-Harness (KEINE Mocks), Stil nach test_heal_zeroarea.
 *
 * DIE ZWEI LÜGEN (vorher, Boden-Wahrheit 4c8a6ed):
 *   L-A  Das Constraint-Verdikt liest die Element-Ehrlichkeit nie: DISTANCE-FROM
 *        über einem paint-toten Subjekt (fill-opacity:0, paint_visible:false im
 *        SELBEN Payload) liefert clean-PASS / 0 issues (P3-Probe).
 *   L-B  Clock-rooted SMIL-GEOMETRIE (animate/set width|x|… · animateTransform ·
 *        animateMotion) trägt NULL Signal: state_dependent deckt nur Event-SMIL,
 *        NON_DETERMINISTIC_MOTION nur Non-SMIL, T1 nur Paint (P4-Probe:
 *        Constraint @t1s real verletzt, Auge stempelt clean-PASS/reliable).
 *
 * DIE HEILUNG:
 *   (1) schema.js: motion_dependent (true-only, z.literal(true).optional()).
 *   (2) playwright.js: eigener clockRooted-Klassifikator (NICHT classifyBeginToken —
 *       der konflatiert 'indefinite'→'auto', K6-Falsch-Flag) + Geometrie-Gate +
 *       Ziel-Propagation (smilStateTargets-Muster) ⇒ motion_dependent:true +
 *       Warning MOTION_DEPENDENT genau 1×; Durchreichung grid/structured/prose
 *       exakt nach media_dependent-Vorlage.
 *   (3) pipeline.js: Verdikt-Wache classifySubjectHonesty in checkAllConstraints —
 *       HART paint_visible===false: pass:true → pass:null SUBJECT_NOT_PAINTED;
 *       WEICH-AKTIV motion_dependent===true: pass:true → pass:null
 *       SUBJECT_TIME_VARIANT; Messwert unverändert im detail; pass:false bleibt
 *       fail. WEICH-VORBEREITET-DEAKTIVIERT: paint 'indeterminate' / state /
 *       media (0 Falsch-Vorbehalte, Kanon-Stabilität — Residuum).
 *
 * NEGATIV-VERTRAG (byte-identisch zu HEAD dc840d0, Literale unten):
 *   begin='indefinite' · begin='load' (Grauzone, Verdikt: konservativ NICHT
 *   flaggen) · begin='none' · reines Event-SMIL (state-Domäne) · Syncbase-Kette
 *   auf clock-Basis (Residuum konservativ) · reine Paint-SMIL (T1) ·
 *   CSS-Transition (bleibt NON_DETERMINISTIC_MOTION, kein Doppel-Flag) ·
 *   statisches rect · gesundes Subjekt + Constraint (analyze-PASS byte-identisch).
 *
 * Run direkt: `node tests/integration/test_heal_verdict_motion.mjs`
 */
import {
  objectFromShape,
  safeParseAsync,
} from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { analyzeOutput, elementSchema } from '../../src/interface/schema.js';
import { analyze, inspect, shutdown } from '../../src/pipeline.js';

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
const deUuid = (s) =>
  s.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    '<UUID>',
  );

function byId(elements, id) {
  return (elements || []).find((e) => e.id === id);
}

function warnCount(el, w) {
  return (el?.warnings || []).filter((x) => x === w).length;
}

// Motion-geflaggt ⇔ BEIDE Signale (fail-loud, analog isZeroFlagged/isMediaFlagged):
// motion_dependent === true (true-only) UND Warning MOTION_DEPENDENT GENAU EINMAL.
function isMotionFlagged(el) {
  return (
    !!el && el.motion_dependent === true && warnCount(el, 'MOTION_DEPENDENT') === 1
  );
}
// Motion-still ⇔ KEIN Feld UND KEINE Warning (Negativ-Vertrag).
function isMotionSilent(el) {
  return (
    !!el &&
    !('motion_dependent' in el) &&
    warnCount(el, 'MOTION_DEPENDENT') === 0
  );
}

const wrap = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 100" width="220" height="100">${inner}</svg>`;
const wrap100 = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">${inner}</svg>`;

// ── P3 (L-A, Boden-Wahrheit probe-p3-constraint-paintvisible.mjs): paint-totes
// Subjekt, Constraint geometrisch erfüllt (gap ≈63.6px ≥ 25px @4x4/100px). ─────
const SVG_P3 = wrap100(
  `<rect id="anchor" x="5" y="5" width="10" height="10" fill="gray"/>` +
    `<rect id="ghost" x="60" y="60" width="30" height="30" fill="red" fill-opacity="0"/>`,
);
const C_P3 = ['#ghost DISTANCE-FROM #anchor 1'];

// ── P4 (L-B, Boden-Wahrheit probe-p4-anim-peak-t0.mjs): SMIL width 10→200,
// clock-rooted (default begin) — @t0 dist≈132.4 ≥ 55, @t1s real verletzt. ──────
const SVG_P4 = wrap(
  `<rect id="anchor" x="150" y="5" width="10" height="10" fill="gray"/>` +
    `<rect id="grow" x="10" y="40" width="10" height="20" fill="blue">` +
    `<animate attributeName="width" from="10" to="200" dur="2s" repeatCount="indefinite"/>` +
    `</rect>`,
);
const C_P4 = ['#grow DISTANCE-FROM #anchor 1'];

// ── Breite L-B (K1/K4/K5/K3-Klassen, witness/probe-detection-edges.mjs) ───────
const SVG_K1 = wrap(
  `<rect id="t" x="10" y="40" width="10" height="20" fill="blue">` +
    `<animate attributeName="width" from="10" to="200" begin="2s" dur="2s" repeatCount="indefinite"/></rect>`,
);
const SVG_K2 = wrap(
  `<rect id="t" x="10" y="40" width="10" height="20" fill="blue">` +
    `<animate attributeName="width" from="10" to="200" begin="0s;click" dur="2s" repeatCount="indefinite"/></rect>`,
);
const SVG_K3 = wrap(
  `<rect id="t" x="10" y="40" width="10" height="20" fill="blue">` +
    `<animateTransform attributeName="transform" type="rotate" from="0 15 50" to="360 15 50" dur="2s" repeatCount="indefinite"/></rect>`,
);
const SVG_K4 = wrap(
  `<rect id="t" x="10" y="40" width="10" height="20" fill="blue">` +
    `<animateMotion path="M0,0 L150,0" dur="2s" repeatCount="indefinite"/></rect>`,
);
const SVG_K5 = wrap(
  `<rect id="t" x="10" y="40" width="10" height="20" fill="blue">` +
    `<set attributeName="width" to="200" begin="1s"/></rect>`,
);

// ── Negativ-Fixtures (byte-identisch zu HEAD — Literale unten) ────────────────
const SVG_N_INDEFINITE = wrap(
  `<rect id="t" x="10" y="40" width="10" height="20" fill="blue">` +
    `<animate attributeName="width" from="10" to="200" begin="indefinite" dur="2s"/></rect>`,
);
const SVG_N_LOAD = wrap(
  `<rect id="t" x="10" y="40" width="10" height="20" fill="blue">` +
    `<animate attributeName="width" from="10" to="200" begin="load" dur="2s"/></rect>`,
);
const SVG_N_NONE = wrap(
  `<rect id="t" x="10" y="40" width="10" height="20" fill="blue">` +
    `<animate attributeName="width" from="10" to="200" begin="none" dur="2s"/></rect>`,
);
const SVG_N_EVENT = wrap(
  `<rect id="t" x="10" y="40" width="10" height="20" fill="blue">` +
    `<animate attributeName="width" from="10" to="200" begin="click" dur="2s"/></rect>`,
);
const SVG_N_SYNCBASE = wrap(
  `<rect id="t" x="10" y="40" width="10" height="20" fill="blue">` +
    `<animate id="dep" attributeName="x" to="50" begin="a1.begin" dur="2s"/></rect>` +
    `<rect id="u" x="60" y="40" width="10" height="20" fill="green">` +
    `<set id="a1" attributeName="fill" to="lime" begin="2s"/></rect>`,
);
const SVG_N_PAINT = wrap(
  `<rect id="t" x="10" y="40" width="10" height="20" fill="blue">` +
    `<animate attributeName="fill-opacity" from="1" to="0.3" dur="2s" repeatCount="indefinite"/></rect>`,
);
const SVG_N_CSS = wrap(
  `<style>#t{transition: width 2s}</style>` +
    `<rect id="t" x="10" y="40" width="10" height="20" fill="blue"/>`,
);
const SVG_N_STATIC = wrap(
  `<rect id="t" x="10" y="40" width="10" height="20" fill="blue"/>`,
);

// ── MIKRO-PATCH R3a: MALFORMED-/LEER-begin-NEGATIV (Boden-Wahrheit
// an internal session artifact +
// empty_begin_gt.mjs — rohes Chromium ohne Freeze: invalide/leere begin-Werte
// sind in Blink UNRESOLVED und laufen NIE; NUR fehlendes begin-Attribut
// defaultet auf 0s). Je Fall: KEIN motion_dependent, Output byte-identisch
// zur un-motion-geflagten Form. Referenz-Kanon je Fixture: CANON_STATE, wenn
// die EXISTENTE T3a-state-Achse das Event-/unknown-Token flaggt (unverändertes
// Verhalten, nicht Gegenstand des Patches); sonst CANON_PLAIN. ────────────────
const malformedBegin = (begin) =>
  wrap(
    `<rect id="t" x="10" y="40" width="10" height="20" fill="blue">` +
      `<animate attributeName="width" from="10" to="200" begin="${begin}" dur="2s"/></rect>`,
  );
// ── MIKRO-PATCH R3b: href VORHANDEN, aber nicht auflösbar ('#missing') →
// KEIN parentElement-Fallback (R2: Fallback NUR bei FEHLENDEM href), KEIN Flag.
const SVG_HREF_MISSING = wrap(
  `<rect id="t" x="10" y="40" width="10" height="20" fill="blue">` +
    `<animate href="#missing" attributeName="width" from="10" to="200" dur="2s"/></rect>`,
);

// ── Verdikt-Negativ-Fixtures ──────────────────────────────────────────────────
// V4: gesundes (gemaltes, statisches) Subjekt + erfüllte Constraint → PASS,
// byte-identisch zu HEAD (ANALYZE_HEALTHY_HEAD unten).
const SVG_HEALTHY = wrap(
  `<rect id="anchor" x="150" y="5" width="10" height="10" fill="gray"/>` +
    `<rect id="subj" x="10" y="40" width="10" height="20" fill="blue"/>`,
);
const C_HEALTHY = ['#subj DISTANCE-FROM #anchor 1'];
// V5: paint-totes Subjekt + VERLETZTE Constraint (gap ≈7.07px < 25px) → der
// geometrische Bruch ist WAHR → bleibt fail (gateCorrections unberührt).
const SVG_V5 = wrap100(
  `<rect id="anchor" x="5" y="5" width="10" height="10" fill="gray"/>` +
    `<rect id="ghost" x="20" y="20" width="30" height="30" fill="red" fill-opacity="0"/>`,
);
const C_V5 = ['#ghost DISTANCE-FROM #anchor 1'];
// HART-vor-WEICH: Subjekt paint-tot UND zeit-variant → SUBJECT_NOT_PAINTED.
const SVG_HART = wrap(
  `<rect id="anchor" x="150" y="5" width="10" height="10" fill="gray"/>` +
    `<rect id="grow" x="10" y="40" width="10" height="20" fill="blue" fill-opacity="0">` +
    `<animate attributeName="width" from="10" to="200" dur="2s" repeatCount="indefinite"/>` +
    `</rect>`,
);
// WEICH-DEAKTIVIERT (state): Event-SMIL auf GEOMETRIE → state_dependent:true,
// KEIN motion; Constraint erfüllt → bleibt clean PASS (kein Vorbehalt).
const SVG_SOFT_STATE = wrap(
  `<rect id="anchor" x="150" y="5" width="10" height="10" fill="gray"/>` +
    `<rect id="trig" x="200" y="80" width="10" height="10" fill="silver"/>` +
    `<rect id="subj" x="10" y="40" width="10" height="20" fill="blue">` +
    `<set attributeName="width" to="80" begin="trig.click"/></rect>`,
);
const C_SOFT_STATE = ['#subj DISTANCE-FROM #anchor 1'];
// WEICH-DEAKTIVIERT (paint 'indeterminate'): clip-path, der die geom-bbox nur
// TEILWEISE überdeckt → Operator-Walk: nicht beweisbar-alive ⇒ 'indeterminate';
// Constraint erfüllt → bleibt clean PASS.
const SVG_SOFT_INDET = wrap(
  `<defs><clipPath id="cp"><rect x="0" y="30" width="15" height="40"/></clipPath></defs>` +
    `<rect id="anchor" x="150" y="5" width="10" height="10" fill="gray"/>` +
    `<rect id="subj" x="10" y="40" width="10" height="20" fill="blue" clip-path="url(#cp)"/>`,
);
const C_SOFT_INDET = ['#subj DISTANCE-FROM #anchor 1'];

// ── HEAD-Kanons (dc840d0, VOR dem Bau erzeugt — /tmp/heal5_head_dumps.mjs) ────
const INSPECT_HEAD = {
  n_indefinite:
    '{"scene":{"canvas_validity":"valid","elements":[{"bbox_reliability":"reliable","cell":"A2-A3","color":"blue","id":"t","status":"ok","tag":"rect"}],"grid":"4x4","height":100,"suppressed":0,"width":220}}',
  n_load:
    '{"scene":{"canvas_validity":"valid","elements":[{"bbox_reliability":"reliable","cell":"A2-A3","color":"blue","id":"t","status":"ok","tag":"rect"}],"grid":"4x4","height":100,"suppressed":0,"width":220}}',
  n_none:
    '{"scene":{"canvas_validity":"valid","elements":[{"bbox_reliability":"reliable","cell":"A2-A3","color":"blue","id":"t","status":"ok","tag":"rect"}],"grid":"4x4","height":100,"suppressed":0,"width":220}}',
  n_event:
    '{"scene":{"canvas_validity":"valid","elements":[{"bbox_reliability":"reliable","cell":"A2-A3","color":"blue","id":"t","state_dependent":true,"status":"ok","tag":"rect","warnings":["STATE_DEPENDENT"]}],"grid":"4x4","height":100,"suppressed":0,"width":220}}',
  // §H10 R11-06 (gewollte Wahrheits-Korrektur): clock-rooted SMIL auf Paint-
  // Kanälen (set fill begin="2s" auf #u bzw. animate fill-opacity ohne begin
  // auf #t) trägt jetzt das ehrliche Paint-Zeit-Signal (paint_time_variant +
  // PAINT_TIME_VARIANT) — die frühere "T1-Domäne"-Prämisse war falsch (T1 ist
  // getAnimations()-basiert und SMIL-blind; Boden-Wahrheit probe_R11-06).
  // motion_dependent bleibt für beide korrekt ABWESEND (Geometrie-Zeit-Achse).
  n_syncbase:
    '{"scene":{"canvas_validity":"valid","elements":[{"bbox_reliability":"reliable","cell":"A2-A3","color":"blue","id":"t","status":"ok","tag":"rect"},{"bbox_reliability":"reliable","cell":"B2-B3","color":"green","id":"u","paint_time_variant":true,"status":"ok","tag":"rect","warnings":["PAINT_TIME_VARIANT"]}],"grid":"4x4","height":100,"suppressed":0,"width":220}}',
  n_paint:
    '{"scene":{"canvas_validity":"valid","elements":[{"bbox_reliability":"reliable","cell":"A2-A3","color":"blue","id":"t","paint_time_variant":true,"status":"ok","tag":"rect","warnings":["PAINT_TIME_VARIANT"]}],"grid":"4x4","height":100,"suppressed":0,"width":220}}',
  n_css:
    '{"scene":{"canvas_validity":"valid","elements":[{"bbox_reliability":"not_measurable","cell":"A2-A3","color":"blue","id":"t","status":"ok","tag":"rect","warnings":["NON_DETERMINISTIC_MOTION"]}],"grid":"4x4","height":100,"suppressed":0,"width":220}}',
  n_static:
    '{"scene":{"canvas_validity":"valid","elements":[{"bbox_reliability":"reliable","cell":"A2-A3","color":"blue","id":"t","status":"ok","tag":"rect"}],"grid":"4x4","height":100,"suppressed":0,"width":220}}',
};
// Referenz-Kanons für den Malformed-Block (R3a): die un-motion-geflagten
// Formen sind byte-identisch zu den bestehenden HEAD-Literalen.
const CANON_PLAIN = INSPECT_HEAD.n_indefinite; // ungeflagte Einzel-rect-Form
const CANON_STATE = INSPECT_HEAD.n_event; // T3a-state-geflagte Form (unverändert)
const ANALYZE_HEALTHY_HEAD =
  '{"corrections":[],"diff":[],"iteration":{"analysisId":"<UUID>","convergence":"SOLVED","current_issues":0,"previous_issues":0,"returned_issues":0,"sequence":1,"suppressed":0,"total_issues":0},"scene":{"canvas_validity":"valid","elements":[{"bbox_reliability":"reliable","cell":"C1","color":"gray","id":"anchor","parent_tag":"svg","status":"ok","tag":"rect"},{"bbox_reliability":"reliable","cell":"A2-A3","color":"blue","id":"subj","parent_tag":"svg","status":"ok","tag":"rect"}],"grid":"4x4","height":100,"width":220},"status":"PASS","unchecked":[]}';

(async () => {
  try {
    // ════ P3 (Beweis-Pflicht 1, L-A): Verdikt ≠ clean-PASS über paint-totem Subjekt ════
    console.log('=== P3 (L-A): paint-totes Subjekt ⇒ SUBJECT_NOT_PAINTED, PARTIAL ===');
    {
      const r = (await analyze(SVG_P3, C_P3)).structured;
      const ghost = byId(r.scene?.elements, 'ghost');
      assert(
        'P3: #ghost trägt paint_visible:false + PAINT_NOT_VISIBLE (Element-Schiene unverändert)',
        ghost?.paint_visible === false && warnCount(ghost, 'PAINT_NOT_VISIBLE') === 1,
        `paint_visible=${JSON.stringify(ghost?.paint_visible)} warnings=${JSON.stringify(ghost?.warnings)}`,
      );
      assert(
        'P3: status === PARTIAL (NICHT clean-PASS — die Verdikt-Lüge ist tot)',
        r.status === 'PARTIAL',
        `status=${r.status}`,
      );
      assert(
        'P3: corrections leer (kein erfundener Fehler — Degradation, kein Wert-Eingriff)',
        Array.isArray(r.corrections) && r.corrections.length === 0,
        `corrections=${JSON.stringify(r.corrections)}`,
      );
      assert(
        'P3: GENAU 1 unchecked-Eintrag',
        Array.isArray(r.unchecked) && r.unchecked.length === 1,
        `unchecked=${JSON.stringify(r.unchecked)}`,
      );
      const u = r.unchecked?.[0];
      assert(
        "P3: reasonCode === 'SUBJECT_NOT_PAINTED'",
        u?.reasonCode === 'SUBJECT_NOT_PAINTED',
        `unchecked[0]=${JSON.stringify(u)}`,
      );
      assert(
        "P3: element '#ghost' + constraint 'DISTANCE-FROM' + reasonCategory MODEL",
        u?.element === '#ghost' &&
          u?.constraint === 'DISTANCE-FROM' &&
          u?.reasonCategory === 'MODEL',
        `unchecked[0]=${JSON.stringify(u)}`,
      );
      assert(
        "P3: Messwert unverändert im hint (bbox x=60 … w=30) + '— Subjekt malt 0 Pixel'",
        typeof u?.hint === 'string' &&
          u.hint.includes('x=60') &&
          u.hint.includes('w=30') &&
          u.hint.includes('— Subjekt malt 0 Pixel'),
        `hint=${JSON.stringify(u?.hint)}`,
      );
      assert(
        'P3: total_issues === 1 (unchecked zählt, deriveStatus-Vertrag)',
        r.iteration?.total_issues === 1,
        `total_issues=${r.iteration?.total_issues}`,
      );
    }

    // ════ P4 (Beweis-Pflicht 1, L-B): Flag + Warning + SUBJECT_TIME_VARIANT ════
    console.log('\n=== P4 (L-B): SMIL-Zeit-Geometrie ⇒ motion_dependent + SUBJECT_TIME_VARIANT ===');
    {
      const r = (await analyze(SVG_P4, C_P4)).structured;
      const grow = byId(r.scene?.elements, 'grow');
      assert(
        'P4: #grow motion_dependent === true + MOTION_DEPENDENT GENAU 1×',
        isMotionFlagged(grow),
        `motion_dependent=${JSON.stringify(grow?.motion_dependent)} warnings=${JSON.stringify(grow?.warnings)}`,
      );
      assert(
        "P4: bbox_reliability bleibt 'reliable' (t0-Messung ist EXAKT — kein Degrade)",
        grow?.bbox_reliability === 'reliable',
        `got ${JSON.stringify(grow?.bbox_reliability)}`,
      );
      assert(
        'P4: kein state_dependent-Falsch-Flag (Achsen getrennt)',
        grow && !('state_dependent' in grow),
        `got ${JSON.stringify(grow?.state_dependent)}`,
      );
      assert(
        'P4: status === PARTIAL + GENAU 1 unchecked',
        r.status === 'PARTIAL' && r.unchecked?.length === 1,
        `status=${r.status} unchecked=${JSON.stringify(r.unchecked)}`,
      );
      const u = r.unchecked?.[0];
      assert(
        "P4: reasonCode === 'SUBJECT_TIME_VARIANT' auf '#grow'",
        u?.reasonCode === 'SUBJECT_TIME_VARIANT' && u?.element === '#grow',
        `unchecked[0]=${JSON.stringify(u)}`,
      );
      assert(
        "P4: Messwert im hint + 'geprüft @t0, Subjekt-Geometrie zeit-variant'",
        typeof u?.hint === 'string' &&
          u.hint.includes('x=10') &&
          u.hint.includes('geprüft @t0, Subjekt-Geometrie zeit-variant'),
        `hint=${JSON.stringify(u?.hint)}`,
      );
      assert(
        'P4: corrections leer (kein erfundener Fehler)',
        Array.isArray(r.corrections) && r.corrections.length === 0,
        `corrections=${JSON.stringify(r.corrections)}`,
      );
      // SILENT_LIE-Prädikat der Boden-Wahrheits-Probe (ohne GT-Browser: die
      // GT-Konjunkte gt_geometry_time_dependent ∧ gt_constraint_violated_at_t1
      // sind in 4c8a6ed bewiesen TRUE) — die Auge-Konjunkte müssen jetzt kippen:
      const cleanPass =
        r.status === 'PASS' &&
        r.iteration?.total_issues === 0 &&
        r.corrections?.length === 0 &&
        r.unchecked?.length === 0;
      const anyTimeSignal = !!(
        grow &&
        (grow.motion_dependent === true ||
          (grow.warnings || []).length > 0 ||
          grow.bbox_reliability !== 'reliable')
      );
      assert(
        'P4: SILENT_LIE_anim_peak === false (kein clean-PASS ohne Zeit-Signal mehr)',
        !(cleanPass && !anyTimeSignal),
        `cleanPass=${cleanPass} anyTimeSignal=${anyTimeSignal}`,
      );
    }

    // ════ Breite L-B (Beweis-Pflicht 2): K1/K4/K5-Klassen + animateTransform ════
    console.log('\n=== Breite L-B: animate(2s) · animateMotion · <set> · animateTransform ===');
    for (const [label, svg] of [
      ["K1 animate width begin='2s' (clock-offset>0)", SVG_K1],
      ['K4 animateMotion (default begin)', SVG_K4],
      ["K5 <set width> begin='1s'", SVG_K5],
    ]) {
      const scene = (await inspect(svg)).structured?.scene;
      const t = byId(scene?.elements, 't');
      assert(
        `${label}: motion_dependent:true + MOTION_DEPENDENT genau 1×`,
        isMotionFlagged(t),
        `el=${JSON.stringify(t)}`,
      );
      assert(
        `${label}: bbox_reliability bleibt 'reliable'`,
        t?.bbox_reliability === 'reliable',
        `got ${JSON.stringify(t?.bbox_reliability)}`,
      );
    }
    {
      const scene = (await inspect(SVG_K3)).structured?.scene;
      const t = byId(scene?.elements, 't');
      assert(
        'K3 animateTransform: motion_dependent:true + MOTION_DEPENDENT genau 1×',
        isMotionFlagged(t),
        `el=${JSON.stringify(t)}`,
      );
      assert(
        "K3 animateTransform: behält 'approximate' + CSS_TRANSFORM_2D_FLOAT_DRIFT (kein Verlust)",
        t?.bbox_reliability === 'approximate' &&
          warnCount(t, 'CSS_TRANSFORM_2D_FLOAT_DRIFT') === 1,
        `reliability=${JSON.stringify(t?.bbox_reliability)} warnings=${JSON.stringify(t?.warnings)}`,
      );
    }

    // ════ Misch-Token (Beweis-Pflicht 3, K2): '0s;click' ⇒ BEIDE Flags ════
    console.log("\n=== K2 Misch-Token '0s;click': BEIDE Achsen, STATE unverändert ===");
    {
      const scene = (await inspect(SVG_K2)).structured?.scene;
      const t = byId(scene?.elements, 't');
      assert(
        'K2: state_dependent === true + STATE_DEPENDENT genau 1× (STATE-Verhalten unverändert)',
        t?.state_dependent === true && warnCount(t, 'STATE_DEPENDENT') === 1,
        `el=${JSON.stringify(t)}`,
      );
      assert(
        'K2: motion_dependent === true + MOTION_DEPENDENT genau 1× (Clock-Token wertet unabhängig)',
        isMotionFlagged(t),
        `el=${JSON.stringify(t)}`,
      );
    }

    // ════ Falsch-Flag-Negativ (Beweis-Pflicht 3): byte-identisch zu HEAD ════
    console.log('\n=== NEGATIV: kein Falsch-Flag — inspect byte-identisch zu HEAD ===');
    for (const [key, label, svg] of [
      ['n_indefinite', "begin='indefinite' (K6 — classifyBeginToken-Konflat darf NICHT durchschlagen)", SVG_N_INDEFINITE],
      ['n_load', "begin='load' — GRAUZONEN-VERDIKT: AUTO_EVENT, konservativ NICHT geflaggt (dokumentiert)", SVG_N_LOAD],
      ['n_none', "begin='none' (script-only, post-Sanitize tot)", SVG_N_NONE],
      ['n_event', "begin='click' Geometrie — state-Domäne, KEIN motion", SVG_N_EVENT],
      ['n_syncbase', "Syncbase-Kette 'a1.begin' auf clock-Basis (Residuum: konservativ still)", SVG_N_SYNCBASE],
      ['n_paint', 'reine Paint-SMIL fill-opacity (T1-Domäne)', SVG_N_PAINT],
      ['n_css', 'CSS-Transition (bleibt NON_DETERMINISTIC_MOTION, kein Doppel-Flag)', SVG_N_CSS],
      ['n_static', 'statisches rect', SVG_N_STATIC],
    ]) {
      const structured = (await inspect(svg)).structured;
      const got = canon(structured);
      assert(
        `${label}: inspect byte-identisch zu HEAD`,
        got === INSPECT_HEAD[key],
        `got=${got}`,
      );
      const t = byId(structured?.scene?.elements, 't');
      assert(
        `${label}: kein motion_dependent, keine MOTION_DEPENDENT-Warning`,
        isMotionSilent(t),
        `el=${JSON.stringify(t)}`,
      );
    }

    // ════ MIKRO-PATCH R3a: malformed/leeres begin ⇒ NIE clock-rooted ════
    // Boden-Wahrheit (mgr/malformed_begin_gt.mjs + empty_begin_gt.mjs): Blink
    // lässt invalide/leere begin-Werte UNRESOLVED (laufen nie) — nur das ganz
    // FEHLENDE Attribut defaultet auf 0s. KEIN true-Fallthrough im Klassifikator.
    console.log('\n=== R3a: malformed/leeres begin ⇒ KEIN motion_dependent, byte-identisch ===');
    for (const [label, svg, refCanon] of [
      ["begin='click + nope' (Event + Müll-Offset)", malformedBegin('click + nope'), CANON_STATE],
      ["begin='repeat(1)junk' (repeat mit Anhang)", malformedBegin('repeat(1)junk'), CANON_PLAIN],
      ["begin='wallclock(' (abgebrochene Funktion)", malformedBegin('wallclock('), CANON_PLAIN],
      ["begin='click;' (Event + leerer Token)", malformedBegin('click;'), CANON_STATE],
      ["begin='5sec' (unbekannte Einheit — T3a-unknown flaggt state, NICHT motion)", malformedBegin('5sec'), CANON_STATE],
      ["begin='' (leeres Attribut — defaultet in Blink NICHT)", malformedBegin(''), CANON_PLAIN],
    ]) {
      const structured = (await inspect(svg)).structured;
      const got = canon(structured);
      assert(
        `${label}: inspect byte-identisch zur un-motion-geflagten Form`,
        got === refCanon,
        `got=${got}`,
      );
      const t = byId(structured?.scene?.elements, 't');
      assert(
        `${label}: kein motion_dependent, keine MOTION_DEPENDENT-Warning`,
        isMotionSilent(t),
        `el=${JSON.stringify(t)}`,
      );
    }

    // ════ MIKRO-PATCH R3b: href='#missing' ⇒ KEIN Parent-Fallback, KEIN Flag ════
    console.log("\n=== R3b: href='#missing' ⇒ kein parentElement-Fallback, kein Flag ===");
    {
      const structured = (await inspect(SVG_HREF_MISSING)).structured;
      const got = canon(structured);
      assert(
        "href='#missing': inspect byte-identisch zur ungeflagten Form",
        got === CANON_PLAIN,
        `got=${got}`,
      );
      const t = byId(structured?.scene?.elements, 't');
      assert(
        "href='#missing': kein motion_dependent auf #t (Parent) oder sonstwo",
        isMotionSilent(t),
        `el=${JSON.stringify(t)}`,
      );
    }

    // ════ Verdikt-Negativ (Beweis-Pflicht 4) ════
    console.log('\n=== V4: gesundes Subjekt + Constraint ⇒ PASS byte-identisch zu HEAD ===');
    {
      const r = (await analyze(SVG_HEALTHY, C_HEALTHY)).structured;
      const got = deUuid(canon(r));
      assert(
        'V4: analyze-PASS byte-identisch zu HEAD (analysisId normalisiert)',
        got === ANALYZE_HEALTHY_HEAD,
        `got=${got}`,
      );
    }

    console.log('\n=== V5: pass:false über paint-totem Subjekt BLEIBT fail ===');
    {
      const r = (await analyze(SVG_V5, C_V5)).structured;
      const ghost = byId(r.scene?.elements, 'ghost');
      assert(
        'V5: #ghost paint_visible === false (paint-tot)',
        ghost?.paint_visible === false,
        `got ${JSON.stringify(ghost?.paint_visible)}`,
      );
      assert(
        'V5: status === FAIL (geometrischer Bruch ist WAHR — keine Degradation)',
        r.status === 'FAIL',
        `status=${r.status}`,
      );
      assert(
        'V5: GENAU 1 correction (gateCorrections-Pfad unberührt) + 0 unchecked',
        r.corrections?.length === 1 && r.unchecked?.length === 0,
        `corrections=${JSON.stringify(r.corrections)} unchecked=${JSON.stringify(r.unchecked)}`,
      );
    }

    console.log('\n=== HART vor WEICH: paint-tot ∧ zeit-variant ⇒ SUBJECT_NOT_PAINTED ===');
    {
      const r = (await analyze(SVG_HART, C_P4)).structured;
      const grow = byId(r.scene?.elements, 'grow');
      assert(
        'HART: #grow trägt BEIDE Element-Signale (paint_visible:false ∧ motion_dependent:true)',
        grow?.paint_visible === false && grow?.motion_dependent === true,
        `el=${JSON.stringify(grow)}`,
      );
      assert(
        "HART: Verdikt-reasonCode === 'SUBJECT_NOT_PAINTED' (HART dominiert WEICH)",
        r.unchecked?.length === 1 &&
          r.unchecked[0]?.reasonCode === 'SUBJECT_NOT_PAINTED',
        `unchecked=${JSON.stringify(r.unchecked)}`,
      );
    }

    console.log('\n=== WEICH-VORBEREITET-DEAKTIVIERT: state / paint-indeterminate ⇒ clean PASS ===');
    {
      const r = (await analyze(SVG_SOFT_STATE, C_SOFT_STATE)).structured;
      const subj = byId(r.scene?.elements, 'subj');
      assert(
        'SOFT-state: #subj state_dependent === true (Fixture exerziert die Klasse)',
        subj?.state_dependent === true,
        `el=${JSON.stringify(subj)}`,
      );
      assert(
        'SOFT-state: KEIN motion_dependent (Event-SMIL ist NICHT clock-rooted)',
        isMotionSilent(subj),
        `el=${JSON.stringify(subj)}`,
      );
      assert(
        'SOFT-state: Verdikt bleibt clean PASS (state-Vorbehalt DEAKTIVIERT — 0 Falsch-Vorbehalte)',
        r.status === 'PASS' && r.unchecked?.length === 0 && r.corrections?.length === 0,
        `status=${r.status} unchecked=${JSON.stringify(r.unchecked)}`,
      );
    }
    {
      const r = (await analyze(SVG_SOFT_INDET, C_SOFT_INDET)).structured;
      const subj = byId(r.scene?.elements, 'subj');
      assert(
        "SOFT-indet: #subj paint_visible === 'indeterminate' (Fixture exerziert die Klasse)",
        subj?.paint_visible === 'indeterminate',
        `el=${JSON.stringify(subj)}`,
      );
      assert(
        'SOFT-indet: Verdikt bleibt clean PASS (indeterminate-Vorbehalt DEAKTIVIERT)',
        r.status === 'PASS' && r.unchecked?.length === 0 && r.corrections?.length === 0,
        `status=${r.status} unchecked=${JSON.stringify(r.unchecked)}`,
      );
    }

    // ════ R9: 2× inspect byte-identisch (Positiv + Misch + Negativ) ════
    console.log('\n=== R9: 2× inspect byte-identisch ===');
    for (const [label, svg] of [
      ['R9 positiv (P4 SMIL-Geometrie)', SVG_P4],
      ["R9 Misch-Token ('0s;click')", SVG_K2],
      ['R9 negativ (CSS-Transition)', SVG_N_CSS],
    ]) {
      const s1 = canon((await inspect(svg)).structured);
      const s2 = canon((await inspect(svg)).structured);
      assert(`${label}: 2× inspect byte-identisch`, s1 === s2, `len ${s1.length} vs ${s2.length}`);
    }

    // ════ MCP-Boundary (Beweis-Pflicht 6): motion_dependent überlebt zod ════
    console.log('\n=== MCP-Boundary: motion_dependent überlebt elementSchema + SDK-zod (kein Strip) ===');
    {
      const baseEl = {
        id: 't',
        tag: 'rect',
        cell: 'A1',
        color: 'blue',
        status: 'ok',
        bbox_reliability: 'reliable',
      };
      const elWithNew = { ...baseEl, motion_dependent: true };
      const a = elementSchema.safeParse(elWithNew);
      assert(
        'Boundary A: elementSchema.safeParse(motion_dependent:true) → success',
        a.success === true,
        a.success ? '' : String(a.error),
      );
      assert(
        'Boundary A: Feld ÜBERLEBT die parse (kein unknownKeys-Strip — Edit #1 wirkt)',
        a.success && a.data.motion_dependent === true,
        a.success ? `data=${JSON.stringify(a.data)}` : 'parse failed',
      );
      // SDK-Pfad exakt wie mcp.js#validateToolOutput (objectFromShape + safeParseAsync).
      const sdkObj = objectFromShape(analyzeOutput);
      const structuredContent = {
        status: 'PASS',
        iteration: {
          sequence: 1,
          previous_issues: 0,
          current_issues: 0,
          total_issues: 0,
          returned_issues: 0,
          suppressed: 0,
          convergence: 'SOLVED',
          analysisId: '11111111-2222-4333-8444-555555555555',
        },
        scene: { width: 220, height: 100, grid: '4x4', elements: [elWithNew] },
        corrections: [],
        unchecked: [],
        diff: [],
      };
      const b = await safeParseAsync(sdkObj, structuredContent);
      assert(
        'Boundary B: SDK-Validierung (objectFromShape+safeParseAsync) → success (kein -32602)',
        b.success === true,
        b.success ? '' : String(b.error).slice(0, 300),
      );
      assert(
        'Boundary B: Feld überlebt AUCH in parsed data (zukunftssicher gegen SDK-parsed-send)',
        b.success && b.data.scene.elements[0].motion_dependent === true,
        b.success ? `el=${JSON.stringify(b.data.scene.elements[0])}` : 'parse failed',
      );
      // Verdikt-Schiene: SUBJECT_TIME_VARIANT-unchecked validiert (z.string()-reasonCode).
      const c = await safeParseAsync(sdkObj, {
        ...structuredContent,
        status: 'PARTIAL',
        unchecked: [
          {
            element: '#t',
            constraint: 'DISTANCE-FROM',
            reasonCategory: 'MODEL',
            reasonCode: 'SUBJECT_TIME_VARIANT',
            hint: 'geometrisch erfüllt @t0 (bbox x=10 y=40 w=10 h=20) — geprüft @t0, Subjekt-Geometrie zeit-variant',
          },
        ],
      });
      assert(
        'Boundary C: unchecked mit SUBJECT_TIME_VARIANT validiert (uncheckedEntrySchema.reasonCode z.string())',
        c.success === true,
        c.success ? '' : String(c.error).slice(0, 300),
      );
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
