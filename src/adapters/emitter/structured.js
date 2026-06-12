/**
 * structured.js — Structured Content Emitter (JSON)
 * Vector Mirror v2.5 (P1-04 migrated)
 *
 * Adapter module: formats gridMap + arbitrated into MCP `structuredContent`.
 *
 * P1-04 changes:
 *   - Consumes the tri-state shape: `arbitrated.{passing, failing, unchecked, diff, totals}`.
 *   - status ∈ {'PASS', 'FAIL', 'PARTIAL'} — 'PARTIAL' when unchecked>0 ∧ failing===0.
 *   - `iteration.total_issues` = failing + unchecked.
 *   - Surfaces `unchecked` entries with reasonCode/hint/suggestedCorrection.
 *
 * Tag-Mapping (BAUPLAN 10.6):
 *   dx -> circle:cx, rect:x, text:x
 *   dy -> circle:cy, rect:y, text:y
 *   dw -> circle:r(/2), rect:width
 *   dh -> circle:r(/2), rect:height
 * §1.5 Transform-Fallback (Sprint §1.5): Für Tags OHNE native dx/dy/dw/dh-
 *   Mapping (path/polygon/polyline/a/switch/textpath/use/foreignobject) emittiert
 *   der Emitter NICHT mehr den toxischen Literal-Durchstich (alter Nullish-
 *   Coalescing-Fallback auf den Roh-Delta-Key → ungültiges <path dx=...>), sondern:
 *     - Position (dx|dy): EINEN aggregierten transform-Fix (front-prepended
 *       translate via prependTranslate).
 *     - Größe (dw|dh): KEINEN Fix, sondern reason='SIZE_FIX_UNSUPPORTED_FOR_TAG'.
 *   tspan ist Sonderfall: nutzt sein natives dx/dy als RELATIVEN Shift (SVG 1.1
 *   §10.5), NICHT transform und NICHT absolute Koordinaten.
 *
 * DEPENDS: core/element_vocabulary.js (isTagDeltaAttributable), lib/transforms.js
 *   (prependTranslate) — beide Hexagonal-rein.
 */
import { isTagDeltaAttributable } from '../../core/element_vocabulary.js';
import { countTruncation } from '../../core/honesty.js';
import { prependTranslate } from '../../lib/transforms.js';

/**
 * Maps a delta key (dx/dy/dw/dh) to the SVG attribute for a given tag.
 * BAUPLAN 10.6: Tag-Mapping table.
 *
 * §1.5: Nur noch für DELTA_ATTRIBUTABLE_TAGS aufgerufen (whitelist-Pfad). Der
 * toxische Roh-Delta-Key-Fallback (Nullish-Coalescing) ist ELIMINIERT — Non-Whitelist-Tags laufen NIE
 * mehr durch diese Funktion (buildFix verzweigt vorher auf isTagDeltaAttributable).
 * Gibt undefined zurück, falls ein Tag/deltaKey ohne Mapping doch hier landet
 * (defensiv: buildFix behandelt undefined als "kein Fix", kein Literal-Durchstich).
 */
function deltaToAttribute(tag, deltaKey) {
  const map = {
    circle: { dx: 'cx', dy: 'cy', dw: 'r', dh: 'r' },
    rect: { dx: 'x', dy: 'y', dw: 'width', dh: 'height' },
    text: { dx: 'x', dy: 'y' },
    ellipse: { dx: 'cx', dy: 'cy', dw: 'rx', dh: 'ry' },
    line: { dx: 'x1', dy: 'y1' },
    image: { dx: 'x', dy: 'y', dw: 'width', dh: 'height' },
  };
  return map[tag]?.[deltaKey];
}

/**
 * Builds a fix object from a correction delta + element.
 * OBL-011: Attribut-Extraktion + fix-Objekt.
 */
function buildFix(el, deltaKey, deltaValue) {
  if (deltaValue === undefined || deltaValue === 0) return null;
  const attr = deltaToAttribute(el.tag, deltaKey);
  // §1.5: Defensive — buildFix wird nur noch für whitelist-Tags aufgerufen
  // (isTagDeltaAttributable-Gate in buildElementFixes). Falls doch ein Tag ohne
  // Mapping hier landet, KEIN Literal-Durchstich mehr (alter Roh-Key-Bug).
  if (attr === undefined) return null;
  const bbox = el.bbox || { x: 0, y: 0, w: 0, h: 0 };

  let current = 0;
  let targetDelta = deltaValue;

  if (deltaKey === 'dx') {
    if (attr === 'cx') current = el.cx ?? bbox.x + bbox.w / 2;
    else current = bbox.x;
  } else if (deltaKey === 'dy') {
    if (attr === 'cy') current = el.cy ?? bbox.y + bbox.h / 2;
    else current = bbox.y;
  } else if (deltaKey === 'dw') {
    if (attr === 'r' || attr === 'rx') {
      current = bbox.w / 2;
      targetDelta = deltaValue / 2;
    } else {
      current = bbox.w;
    }
  } else if (deltaKey === 'dh') {
    if (attr === 'r' || attr === 'ry') {
      current = bbox.h / 2;
      targetDelta = deltaValue / 2;
    } else {
      current = bbox.h;
    }
  }

  current = Math.round(current);
  const target = current + Math.round(targetDelta);
  return { attribute: attr, current: String(current), target: String(target) };
}

/**
 * §1.5 Transform-Fallback (R-A/R-B): Aggregiert dx UND dy zu EINEM transform-Fix
 * für Tags ohne native Positions-Attribute (path/polygon/polyline/a/switch/use/...).
 *
 * Das translate wird FRONT-PREPENDED (prependTranslate): dx/dy sind Welt-px-Deltas
 * vom Spotter (CTM-projizierte BBox), die außen wrappen müssen, damit sie unabhängig
 * von einem Autor-scale()/rotate() in Welt-Koordinaten wirken (SOTA Präzision 1).
 *
 * current = bestehender transform-Wert (oder '' wenn keiner), target = der neue
 * transform-String. EIN Fix-Objekt für beide Achsen (R-B: NICHT pro-Achse).
 *
 * @returns {{attribute:'transform', current:string, target:string, warning:string}|null}
 *   null, wenn weder dx noch dy einen Effekt haben.
 */
function buildTransformFix(el, dx, dy) {
  const dxNum = dx ?? 0;
  const dyNum = dy ?? 0;
  if (dxNum === 0 && dyNum === 0) return null;
  const existing = el.transform ?? '';
  return {
    attribute: 'transform',
    current: existing,
    target: prependTranslate(existing, Math.round(dxNum), Math.round(dyNum)),
    // praezision_2 (low-effort): statischer Hinweis — eine CSS transform-Property
    // (inline/extern) würde dieses Attribut überstimmen. KEINE Kaskaden-Analyse.
    warning: 'CSS transform property may override this attribute',
  };
}

/**
 * Parst den ersten numerischen Token eines SVG dx/dy-Attribut-Werts (das eine
 * Längen-LISTE sein kann, z.B. "4 2 1"). Liefert die Skalar-Basis für den
 * relativen tspan-Shift; 0, wenn kein/ungültiger Wert.
 */
function parseNativeShift(raw) {
  if (raw == null) return 0;
  const m = String(raw)
    .trim()
    .match(/-?\d+(?:\.\d+)?/);
  if (!m) return 0;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : 0;
}

/**
 * §1.5 tspan-Sonderfall (R-C / praezision_4 + Patch P2): tspan trägt native dx/dy,
 * aber als RELATIVEN Shift (SVG 1.1 §10.5) — KEIN transform und KEINE absolute
 * Koordinate. Der Fix modelliert den Shift RELATIV zum bestehenden dx-Attribut
 * (Patch P2): current = Autor-dx (Skalar-Erstwert, 0 wenn keiner), target =
 * current + delta. So ÜBERSCHREIBT der Fix das Autor-dx nicht, sondern verschiebt
 * relativ dazu. Hat tspan kein dx → current='0' (Default, korrekt).
 *
 * Eigene Achsen-fixes (dx → attribute 'dx', dy → attribute 'dy'), weil das Schema
 * single-attribute ist; pro-Achse ist hier korrekt (dx/dy sind native tspan-Attribute).
 *
 * @param {string} deltaKey - 'dx' | 'dy'.
 * @param {number} deltaValue - Spotter-Delta.
 * @param {string|number|undefined} nativeBaseRaw - bestehender dx-Attribut-Wert (nur dx-Achse).
 * @returns {{attribute:'dx'|'dy', current:string, target:string}|null}
 */
function buildTspanShiftFix(deltaKey, deltaValue, nativeBaseRaw) {
  if (deltaValue === undefined || deltaValue === 0) return null;
  const attr = deltaKey === 'dx' ? 'dx' : deltaKey === 'dy' ? 'dy' : null;
  if (attr === null) return null;
  // Patch P2: native_dx surfaced nur für die dx-Achse (Renderer liest dx-Attribut).
  // dy-Achse bleibt Relativbasis 0 (kein dy-Attribut surfaced; konservativ korrekt).
  const base = attr === 'dx' ? parseNativeShift(nativeBaseRaw) : 0;
  return {
    attribute: attr,
    current: String(Math.round(base)),
    target: String(Math.round(base + deltaValue)),
  };
}

/**
 * §1.5 Orchestrierung (R-A..R-E): berechnet für ein failing-Element alle fixes
 * UND einen optionalen unsupported-reason. 4-Weg-Verzweigung:
 *   1. whitelist (isTagDeltaAttributable): bestehender Pfad, pro-Achse buildFix.
 *   2. tspan: native dx/dy als relativer Shift (buildTspanShiftFix), pro-Achse.
 *   3. non-whitelist + dx|dy: EIN aggregierter transform-Fix (buildTransformFix).
 *   4. non-whitelist + dw|dh: KEIN Fix, reason='SIZE_FIX_UNSUPPORTED_FOR_TAG'.
 *
 * @returns {{fixes:Array, reason:(string|undefined)}}
 *   fixes: 0..n Fix-Objekte (Reihenfolge dx,dy,dw,dh). reason: gesetzt, wenn ein
 *   dw/dh-Delta auf einem Tag ohne Size-Mapping vorlag (Größen-Fix nicht möglich).
 */
function buildElementFixes(el, issue) {
  const tag = String(el.tag).toLowerCase();
  const fixes = [];
  let reason;

  if (isTagDeltaAttributable(tag)) {
    // Pfad 1: native Attribut-Mapping (circle/rect/text/ellipse/line/image).
    for (const key of ['dx', 'dy', 'dw', 'dh']) {
      if (issue[key] !== undefined) {
        const f = buildFix(el, key, issue[key]);
        if (f) fixes.push(f);
      }
    }
    return { fixes, reason };
  }

  if (tag === 'tspan') {
    // Pfad 2: tspan native relativer Shift (R-C). Größen-Deltas sind für tspan
    // nicht modellierbar → wie andere Non-Whitelist-Tags als unsupported melden.
    for (const key of ['dx', 'dy']) {
      if (issue[key] !== undefined) {
        const f = buildTspanShiftFix(key, issue[key], el.native_dx);
        if (f) fixes.push(f);
      }
    }
    if (issue.dw !== undefined || issue.dh !== undefined) {
      reason = 'SIZE_FIX_UNSUPPORTED_FOR_TAG';
    }
    return { fixes, reason };
  }

  // Pfad 3+4: non-whitelist (path/polygon/polyline/a/switch/textpath/use/foreignobject).
  const transformFix = buildTransformFix(el, issue.dx, issue.dy);
  if (transformFix) fixes.push(transformFix);
  if (issue.dw !== undefined || issue.dh !== undefined) {
    // Pfad 4: Größen-Fix ohne Mapping → unsupported statt erfundenem scale().
    reason = 'SIZE_FIX_UNSUPPORTED_FOR_TAG';
  }
  return { fixes, reason };
}

/**
 * Computes convergence from previous and current issue counts.
 * BAUPLAN 10.5: Stateless — client provides previousIssueCount.
 *
 * §1.6 KONVERGENZ-EHRLICHKEIT (Epistemischer Vertrag): currentIssueCount MUSS
 * totalIssues = failing + unchecked sein — niemals failingCount allein. Sonst
 * meldet der Übergang "1 Failing → 1 Unchecked" IMPROVING (failing sinkt 1→0),
 * obwohl die Wahrheit "Pipeline blind" lautet (Constraint nicht mehr auswertbar).
 * Das wäre eine Fortschritts-Lüge an den LLM. Vergleichswert (previousIssueCount)
 * und aktueller Wert müssen dieselbe Metrik (totalIssues) sein, damit der
 * Closed-Loop wahrheitsgemäß bleibt. Die Klassifikations-Logik selbst ist
 * metrik-agnostisch und bleibt unangetastet (DNA bewahren).
 */
function computeConvergence(previousIssueCount, currentIssueCount) {
  if (currentIssueCount === 0) return 'SOLVED';
  if (previousIssueCount === undefined || previousIssueCount === null) {
    // §H9 K-12: ohne Historie KEINE Trend-Behauptung — STAGNATING/DIVERGING
    // sind Verlaufs-Urteile über zwei Messpunkte; bei der ersten Messung gibt
    // es nur einen. BASELINE ist das ehrliche Vokabular für "erste Messung,
    // N Issues, kein Trend behauptbar" (Schema-Enum additiv nachgezogen,
    // schema.js). SOLVED bei 0 Issues bleibt: Zustands-, keine Trend-Aussage.
    return 'BASELINE';
  }
  if (currentIssueCount < previousIssueCount) return 'IMPROVING';
  if (currentIssueCount === previousIssueCount) return 'STAGNATING';
  return 'DIVERGING';
}

/**
 * Derives the tri-state document status.
 *   PASS    — kein Fehler, alles geprueft
 *   FAIL    — mind. 1 failing
 *   PARTIAL — kein failing, aber unchecked > 0 (LLM darf nicht "alles ok" annehmen)
 */
function deriveStatus(failingCount, uncheckedCount) {
  if (failingCount > 0) return 'FAIL';
  if (uncheckedCount > 0) return 'PARTIAL';
  return 'PASS';
}

/**
 * Formats gridMap + arbitrated into structured JSON (MCP structuredContent).
 * BAUPLAN 10.4: Full schema with status, iteration, scene, corrections, diff, unchecked.
 */
export function formatStructured(gridMap, arbitrated, opts = {}) {
  const { canvas, elements } = gridMap;
  const failing = arbitrated.failing || [];
  const unchecked = arbitrated.unchecked || [];
  const diffEntries = arbitrated.diff || [];

  // §E1 fail-closed-Vertrag (REGEL-8): jedes failing-issue MUSS am Emissions-
  // Rand durch honesty.js#gateCorrections gelaufen sein (Caller-Pflicht,
  // pipeline.js analyze/compare). Fehlt das _gated-Vertragsfeld, ist die
  // Reliability-Entscheidung NICHT getroffen → Wurf, statt ungegated zu
  // emittieren. So ist eine ungegatete Delta-Emission mechanisch unmoeglich.
  for (const issue of failing) {
    if (issue._gated === undefined) {
      throw new Error(
        'formatStructured: ungegatetes failing-issue (kein _gated) — ' +
          'gateCorrections am Emissions-Rand fehlt (REGEL-8 fail-closed).',
      );
    }
  }

  const failingCount = failing.length;
  const uncheckedCount = unchecked.length;
  const totalIssues = failingCount + uncheckedCount;

  const prevCount = opts.previousIssueCount;
  const sequence = prevCount !== undefined && prevCount !== null ? 2 : 1;
  // §1.6: Konvergenz auf totalIssues (failing + unchecked), NICHT failingCount.
  // Failing→Unchecked ist nie IMPROVING — der Constraint wurde nur unsichtbar,
  // nicht gelöst. previousIssueCount ist (im Closed-Loop) ebenfalls ein
  // totalIssues-Wert → Vergleich ist metrik-konsistent und lügt nicht.
  const convergence = computeConvergence(prevCount, totalIssues);
  // §1.3 Schicht 2: analysisId vom Caller (analyze→neu, compare→referenced).
  // Pflicht-Feld im Output-Schema. Kein Fallback hier — Caller muss liefern.
  const { analysisId } = opts;

  // §1.4
  // VOR dem slice(0,7)-Cap: alle warning-tragenden Elemente auf Position >=7
  // in truncated_warnings hoisten. So bleibt das Reliability-Signal sichtbar,
  // auch wenn das Element selbst aus scene.elements wegen Token-Limit
  // (BAUPLAN OBL-008) verschwindet. REGEL-3 ueberstimmt BAUPLAN-Konvention.
  // Position ist 0-basierte Original-Position vor dem Slicing.
  const SCENE_MAX_ELEMENTS = 7;
  const truncatedWarnings = [];
  for (let i = SCENE_MAX_ELEMENTS; i < elements.length; i++) {
    const el = elements[i];
    if (el && Array.isArray(el.warnings) && el.warnings.length > 0) {
      truncatedWarnings.push({
        element_id: el.id,
        warnings: el.warnings,
        position: i,
      });
    }
  }

  const sceneElements = elements.slice(0, SCENE_MAX_ELEMENTS).map((el) => {
    const failingIssue = failing.find((i) => i.id === el.id);
    const uncheckedIssue = unchecked.find((i) => i.id === el.id);
    const diffIssue = diffEntries.find((i) => i.id === el.id);
    let status = 'ok';
    if (failingIssue) status = 'fail';
    else if (uncheckedIssue || diffIssue) status = 'warn';
    return {
      id: el.id,
      tag: el.tag,
      cell: el.span || el.cell,
      color: el.color,
      status,
      // §1.2b L-002b: Reliability-Propagation auf MCP-Caller-Ebene
      // (Datenkette Renderer -> grid.mappedElements -> hier -> MCP structuredContent).
      // grid.js reicht bereits durch — wir reichen weiter, damit der Caller das
      // 3D-Signal sieht (REGEL-3 Spotter-Anti-Luege).
      bbox_reliability: el.bbox_reliability,
      // §1.5 Block D: Parent-Kontext für tspan/textPath durchreichen (R-C).
      // Nur emittieren, wenn vorhanden (Common-Case: Top-Level-Elemente ohne
      // relevanten Parent tragen das Feld nicht → Output-Volumen + Schema-
      // Optional-Vertrag konsistent). Datenkette: playwright.js → grid.js →
      // hier. ACHTUNG: grid.js muss parent_id/parent_tag ebenfalls durchreichen
      // (analog bbox_reliability), sonst ist el.parent_id hier undefined.
      ...(el.parent_id != null ? { parent_id: el.parent_id } : {}),
      ...(el.parent_tag != null ? { parent_tag: el.parent_tag } : {}),
      ...(el.warnings ? { warnings: el.warnings } : {}),
      // §E4 Paint-Extent-Ehrlichkeit (F-AT-004, DoD-3): visual_bbox/has_paint_overflow
      // bis zur MCP-Caller-Boundary durchreichen (analog bbox_reliability/warnings).
      // Datenkette: playwright.js → grid.js → hier. Nur emittiert, wenn vorhanden
      // (filterlose Elemente tragen die Felder NICHT — Negativ-Kontrolle).
      ...(el.has_paint_overflow != null
        ? { has_paint_overflow: el.has_paint_overflow }
        : {}),
      ...(el.visual_bbox != null ? { visual_bbox: el.visual_bbox } : {}),
      // §HEAL-R6 / T1 Paint-Presence (F-AT-6-01, DoD-2): bis zur MCP-Caller-Boundary
      // durchreichen (analog bbox_reliability/visual_bbox). Datenkette:
      // playwright.js → grid.js → hier. paint_visible nur bei painted===false.
      ...(el.fill_paint_factor != null
        ? { fill_paint_factor: el.fill_paint_factor }
        : {}),
      ...(el.stroke_paint_factor != null
        ? { stroke_paint_factor: el.stroke_paint_factor }
        : {}),
      ...(el.paint_visible != null ? { paint_visible: el.paint_visible } : {}),
      // §D5 / R6-STATE (state_dependent): bis zur MCP-Caller-Boundary durchreichen
      // (analog paint_visible). Datenkette: playwright.js → grid.js → hier. Ohne
      // diese Zeile lügt der analyze-Pfad still weiter.
      ...(el.state_dependent != null
        ? { state_dependent: el.state_dependent }
        : {}),
      // §F-AT-6-09 / R6-MEDIA (media_dependent): bis zur MCP-Caller-Boundary
      // durchreichen (analog state_dependent). Datenkette: playwright.js → grid.js →
      // hier. Ohne diese Zeile lügt der analyze-Pfad still weiter.
      ...(el.media_dependent != null
        ? { media_dependent: el.media_dependent }
        : {}),
      // §HEAL-5 / Zeit-Achse (motion_dependent): bis zur MCP-Caller-Boundary
      // durchreichen (exakt nach media_dependent-Vorlage). Datenkette:
      // playwright.js → grid.js → hier. Ohne diese Zeile lügt der analyze-Pfad
      // still weiter.
      ...(el.motion_dependent != null
        ? { motion_dependent: el.motion_dependent }
        : {}),
      // §H10 R11-06 / Paint-Zeit-Achse (paint_time_variant): bis zur MCP-
      // Caller-Boundary durchreichen (exakt nach motion_dependent-Vorlage).
      ...(el.paint_time_variant != null
        ? { paint_time_variant: el.paint_time_variant }
        : {}),
    };
  });

  // §E1 WELLE-β-002/D-006/D-015: die Reliability-Entscheidung ist EINMAL am
  // Emissions-Rand getroffen (honesty.js#gateCorrections, Caller pipeline.js)
  // und sitzt als _gated-Vertragsfeld auf jedem issue. Das gegatete issue ist
  // bei _gated===false bereits um dx/dy/dw/dh BEREINIGT — hier nur noch lesen,
  // keine zweite Reliability-Map (D-015 echt 3→1). detail-Prosa + constraint-
  // Verweis bleiben (Caller weiss, dass ein Bruch vorliegt, ohne irrefuehrende
  // dx/dy zu bekommen).
  const corrections = failing.map((issue) => {
    const el = elements.find((e) => e.id === issue.id);
    const correction = {
      element: `#${issue.id || 'unknown'}`,
      tag: el?.tag,
      constraint: issue.constraintType || 'UNKNOWN',
      reference: issue.reference ? `#${issue.reference}` : null,
    };
    // β-002 Gate (SSOT): _gated ist allowDeltas(reliability) — bei
    // not_measurable/approximate/unbekannter id false → keine dx/dy/dw/dh/fix.
    const allowDeltas = issue._gated;
    if (allowDeltas) {
      if (issue.dx !== undefined) correction.dx = issue.dx;
      if (issue.dy !== undefined) correction.dy = issue.dy;
      if (issue.dw !== undefined) correction.dw = issue.dw;
      if (issue.dh !== undefined) correction.dh = issue.dh;
    }

    if (el && allowDeltas) {
      // §1.5: 4-Weg-Verzweigung (whitelist | tspan | transform | size-unsupported).
      // buildElementFixes kapselt die Logik; hier nur noch Shape-Mapping auf das
      // bestehende fix/fixes-Contract + optionaler unsupported-reason.
      const { fixes, reason } = buildElementFixes(el, issue);
      if (fixes.length === 1) {
        correction.fix = fixes[0];
      } else if (fixes.length > 1) {
        correction.fix = fixes[0];
        correction.fixes = fixes;
      }
      if (reason !== undefined) {
        correction.reason = reason;
      }
    }
    return correction;
  });

  const diffSummary = diffEntries.map((d) => {
    const entry = { type: d.type, id: d.id || 'unknown' };
    if (d.from) entry.from = d.from;
    if (d.to) entry.to = d.to;
    return entry;
  });

  const uncheckedSummary = unchecked.map((u) => {
    const out = {
      element: u.id !== undefined ? `#${u.id}` : null,
      constraint: u.constraintType || 'UNKNOWN',
      reasonCategory: u.reasonCategory,
      reasonCode: u.reasonCode,
      hint: u.hint,
    };
    if (u.suggestedCorrection) out.suggestedCorrection = u.suggestedCorrection;
    return out;
  });

  // §1.4
  // Wenn truncated_warnings nicht-leer ist, KANN status nicht PASS sein —
  // der Caller wuerde sonst "alles ok" annehmen, obwohl warning-tragende
  // Elemente unsichtbar wegen slice(0,7)-Cap sind. PARTIAL signalisiert:
  // "kein Fehler im sichtbaren Bereich, aber nicht alles ueberprueft/gezeigt".
  // FAIL bleibt erhalten (failing > 0 trumpt truncated_warnings).
  let derivedStatus = deriveStatus(failingCount, uncheckedCount);
  if (derivedStatus === 'PASS' && truncatedWarnings.length > 0) {
    derivedStatus = 'PARTIAL';
  }
  const out = {
    status: derivedStatus,
    iteration: {
      sequence,
      previous_issues: prevCount ?? 0,
      // §1.6: current_issues = totalIssues (failing + unchecked), damit die
      // Iterations-Metrik mit dem Konvergenz-Verdikt konsistent ist und der
      // Closed-Loop (Caller speist current_issues als previousIssueCount zurück)
      // dieselbe Metrik vergleicht. total_issues/returned_issues bleiben gleich.
      current_issues: totalIssues,
      total_issues: totalIssues,
      returned_issues: totalIssues, // structured ships everything; no cap here
      // §E1 D-008: ehrlicher ELEMENT-Trunkierungs-Zaehler. Der issue-Cap
      // existiert nicht (structured ships all issues), aber scene.elements wird
      // bei >SCENE_MAX_ELEMENTS via slice(0,7) gekuerzt — suppressed zaehlt die
      // dadurch verborgenen Elemente (war hartkodiert 0 = Luege bei >7).
      // Symmetrisch zum truncated_warnings-Hoist. ≤7 → 0 (byte-stabil).
      suppressed: countTruncation(elements, SCENE_MAX_ELEMENTS).suppressed,
      convergence,
      analysisId,
    },
    scene: {
      width: canvas.width,
      height: canvas.height,
      grid: `${gridMap.grid.cellsX}x${gridMap.grid.cellsY}`,
      elements: sceneElements,
      // §HEAL-R6 / T1 "das Kabel" (F-AT-6-08): das classifyCanvas-Verdikt aus dem
      // Caller (pipeline.js). Anti-LECK-3: der Caller speist es aus
      // resolved.sanitize_loss DIREKT, NIE aus gridMap.canvas (das das Feld nicht
      // trägt → wäre immer 'valid' → neue stille Lüge). Nur emittieren, wenn der
      // Caller es liefert (optional-by-default → kein Schema-Bruch).
      ...(opts.canvasValidity !== undefined
        ? { canvas_validity: opts.canvasValidity }
        : {}),
      // §H10 R11-01: Existenz-Register — css-unsichtbar geskippte Elemente
      // (id+Achse) sind NICHT Teil der Emissions-Menge, dürfen aber nicht
      // verschwinden. Selbes additive optional-Muster wie canvas_validity.
      ...(Array.isArray(gridMap.hidden) && gridMap.hidden.length > 0
        ? { hidden_elements: gridMap.hidden }
        : {}),
    },
    corrections,
    unchecked: uncheckedSummary,
    diff: diffSummary,
  };
  // §1.4
  // einen Eintrag hat. Optional-by-default haelt das Schema-Optional-Vertrag
  // konsistent und reduziert Output-Volumen im Common-Case (<=7 Elemente).
  if (truncatedWarnings.length > 0) {
    out.meta = { truncated_warnings: truncatedWarnings };
  }
  return out;
}

/**
 * Formats gridMap for inspect output (no constraints, no diff).
 *
 * §HEAL-R6 / T1 "das Kabel" (F-AT-6-08): opts.canvasValidity ist das
 * classifyCanvas-Verdikt aus dem Caller (pipeline.js, aus resolved.sanitize_loss
 * DIREKT — Anti-LECK-3). Optional — fehlt es, bleibt scene.canvas_validity weg.
 */
export function formatInspectStructured(gridMap, opts = {}) {
  const { canvas, elements } = gridMap;
  // §1.4
  // formatStructured — inspectOutput konsumiert dasselbe elementSchema +
  // metaSchema und braucht denselben REGEL-3-Hoist (β-003).
  const SCENE_MAX_ELEMENTS = 7;
  const truncatedWarnings = [];
  for (let i = SCENE_MAX_ELEMENTS; i < elements.length; i++) {
    const el = elements[i];
    if (el && Array.isArray(el.warnings) && el.warnings.length > 0) {
      truncatedWarnings.push({
        element_id: el.id,
        warnings: el.warnings,
        position: i,
      });
    }
  }
  const out = {
    scene: {
      width: canvas.width,
      height: canvas.height,
      grid: `${gridMap.grid.cellsX}x${gridMap.grid.cellsY}`,
      // §E1 D-008 (F-TF-008): ehrlicher ELEMENT-Trunkierungs-Zaehler, symmetrisch
      // zum analyze-Vorbild (formatStructured, iteration.suppressed). inspect hat
      // KEINEN iteration-Block, daher sitzt der Zaehler hier im scene-Block — er
      // beschreibt scene.elements, die unten via slice(0,7) gekuerzt werden.
      // UNKONDITIONAL emittiert (≤7 → 0 = byte-stabil); behebt die stille
      // Mess-Luege (maschineller Konsument verlor >7 Elemente ohne Zaehler).
      suppressed: countTruncation(elements, SCENE_MAX_ELEMENTS).suppressed,
      elements: elements.slice(0, SCENE_MAX_ELEMENTS).map((el) => ({
        id: el.id,
        tag: el.tag,
        cell: el.span || el.cell,
        color: el.color,
        status: 'ok',
        // §1.2b L-002b: Reliability-Propagation auch im inspect-Output, weil
        // inspectOutput dasselbe elementSchema (Pflicht-Promotion L-003) konsumiert.
        // Ohne diese Zeile lehnt MCP-Inspector ab (E2E SC-7).
        bbox_reliability: el.bbox_reliability,
        ...(el.warnings ? { warnings: el.warnings } : {}),
        // §E4 Paint-Extent-Ehrlichkeit (F-AT-004, DoD-3): auch im inspect-Output
        // durchreichen (dasselbe elementSchema). Datenkette: playwright.js → grid.js
        // → hier. Nur wenn vorhanden (filterlose Elemente tragen die Felder NICHT).
        ...(el.has_paint_overflow != null
          ? { has_paint_overflow: el.has_paint_overflow }
          : {}),
        ...(el.visual_bbox != null ? { visual_bbox: el.visual_bbox } : {}),
        // §HEAL-R6 / T1 Paint-Presence (F-AT-6-01, DoD-2): auch im inspect-Output
        // durchreichen (dasselbe elementSchema). Ohne diese Zeilen lügt der inspect-
        // Pfad still weiter (paint_visible verschwände). Datenkette: playwright.js →
        // grid.js → hier. Nur wenn vorhanden (paint_visible nur bei painted===false).
        ...(el.fill_paint_factor != null
          ? { fill_paint_factor: el.fill_paint_factor }
          : {}),
        ...(el.stroke_paint_factor != null
          ? { stroke_paint_factor: el.stroke_paint_factor }
          : {}),
        ...(el.paint_visible != null ? { paint_visible: el.paint_visible } : {}),
        // §D5 / R6-STATE (state_dependent): auch im inspect-Output durchreichen
        // (dasselbe elementSchema). Ohne diese Zeile lügt der inspect-Pfad still
        // weiter. Datenkette: playwright.js → grid.js → hier.
        ...(el.state_dependent != null
          ? { state_dependent: el.state_dependent }
          : {}),
        // §F-AT-6-09 / R6-MEDIA (media_dependent): auch im inspect-Output
        // durchreichen (dasselbe elementSchema). Datenkette: playwright.js →
        // grid.js → hier.
        ...(el.media_dependent != null
          ? { media_dependent: el.media_dependent }
          : {}),
        // §HEAL-5 / Zeit-Achse (motion_dependent): auch im inspect-Output
        // durchreichen (dasselbe elementSchema; exakt nach media_dependent-
        // Vorlage). Datenkette: playwright.js → grid.js → hier.
        ...(el.motion_dependent != null
          ? { motion_dependent: el.motion_dependent }
          : {}),
        // §H10 R11-06 / Paint-Zeit-Achse (paint_time_variant): auch im
        // inspect-Output durchreichen (exakt nach motion_dependent-Vorlage).
        ...(el.paint_time_variant != null
          ? { paint_time_variant: el.paint_time_variant }
          : {}),
      })),
      // §HEAL-R6 / T1 "das Kabel" (F-AT-6-08): classifyCanvas-Verdikt aus dem
      // Caller (pipeline.js, aus resolved.sanitize_loss DIREKT — Anti-LECK-3).
      // Selbes additive optional-Muster wie formatStructured.
      ...(opts.canvasValidity !== undefined
        ? { canvas_validity: opts.canvasValidity }
        : {}),
      // §H10 R11-01: Existenz-Register auch im inspect-Output (Kanal-Parität,
      // selbes additive optional-Muster wie formatStructured).
      ...(Array.isArray(gridMap.hidden) && gridMap.hidden.length > 0
        ? { hidden_elements: gridMap.hidden }
        : {}),
    },
  };
  if (truncatedWarnings.length > 0) {
    out.meta = { truncated_warnings: truncatedWarnings };
  }
  return out;
}

/**
 * Formats palette output.
 */
export function formatPaletteStructured(elements) {
  return {
    colors: elements.slice(0, 7).map((el) => ({
      id: el.id,
      // §F-AT-7-02 (SK4): die Palette führt den ECHTEN parsed fill, NICHT el.color.
      // Seit der stroke-Farb-Heilung kann el.color bei einem stroke-only-Element die
      // STROKE-Farbe sein (visible_color_source='stroke') — el.color hier zu nutzen
      // erzeugte eine neue Lüge (stroke-only → palette.fill:rot, obwohl der fill
      // 'none'/transparent ist). grid.js bewahrt den parsed fill separat in
      // fill_color; Fallback auf el.color nur, falls fill_color fehlt (Nicht-Grid-
      // Aufrufer) — dort ist el.color weiterhin fill-derived (kein visible_color_source).
      fill: el.fill_color != null ? el.fill_color : el.color,
      stroke: el.stroke && el.stroke !== 'transparent' ? el.stroke : null,
    })),
  };
}
