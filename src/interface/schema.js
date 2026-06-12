/**
 * schema.js - Zod Schemas for MCP Tool Input/Output
 * Vector Mirror v2.0 Phase 2
 *
 * Interface module: Defines all tool schemas (transport-agnostic)
 * BAUPLAN ref: Sektion 5 (Tools) + Sektion 7.2 (SDK-Pattern) + Sektion 10.4 (structuredContent)
 * DEPENDS: zod
 */
import { z } from 'zod';

// ── INPUT SCHEMAS ──────────────────────────────────────────

export const analyzeInput = {
  svg: z.string().describe('Vollstaendiger SVG-String'),
  constraints: z
    .array(z.string())
    .optional()
    .describe(
      'Regeln im Format: "#subject TYPE #reference [value]". Typen: CENTERED-IN, NO-OVERLAP, INSIDE, ALIGNED-LEFT, ALIGNED-TOP, LEFT-OF, ABOVE, DISTANCE-FROM, SAME-SIZE, COLOR',
    ),
  previousIssueCount: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      'Anzahl Fehler des vorherigen Aufrufs (fuer Konvergenz-Tracking)',
    ),
};

export const compareInput = {
  svg: z.string().describe('Vollstaendiger SVG-String (neuer Zustand)'),
  constraints: z
    .array(z.string())
    .optional()
    .describe('Optionale Constraints fuer Re-Check'),
  // §1.1 Stateless RPC: analysisId ist Pflichtfeld (Caller-Pflicht).
  // §1.4 Disjunktion: akzeptiert jetzt UUID (grids) ODER Bookmark-Name
  // (bookmarks). z.string().min(1) bleibt permissiv (KEIN ZodEffects →
  // JSON-Schema-clean). Disambiguierung WRITE-seitig: bookmarkInput.name
  // verbietet UUID-Form → Keyspaces disjunkt. §1.1-Invariante (kein
  // .optional()) bleibt — Pflichtfeld.
  analysisId: z
    .string()
    .min(1)
    .describe(
      'analysisId (UUID aus analyze) ODER Bookmark-Name (aus vector_mirror_bookmark). Server löst UUID→grids, Name→bookmarks auf. Pflichtfeld (§1.1).',
    ),
};

// §1.4 Globale Bookmarks (B-3): Input für vector_mirror_bookmark.
// name verbietet UUID-Form via Negative-Lookahead — garantiert Keyspace-
// Disjunktion zum grids-Keyspace (UUIDs). Empirie-belegt: ein UUID v4 mit
// Hex-Letter-Start (a-f) würde sonst BEIDE Muster treffen (Restambiguität);
// der Lookahead schließt das strukturell aus (alle 5 Hex-Gruppen 8-4-4-4-12).
export const bookmarkInput = {
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^(?![0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$)[A-Za-z][A-Za-z0-9_.-]{0,63}$/,
      'Name: Buchstabe-Start, [A-Za-z0-9_.-], kein UUID-Format',
    )
    .describe('Bookmark-Name (kein UUID-Format; Keyspace disjunkt von grids).'),
  analysisId: z
    .string()
    .uuid()
    .describe('analysisId aus vector_mirror_analyze'),
};

export const inspectInput = {
  svg: z.string().describe('Vollstaendiger SVG-String'),
};

export const paletteInput = {
  svg: z.string().describe('Vollstaendiger SVG-String'),
};

const arrangeElementSchema = z.object({
  id: z.string(),
  tag: z.string(),
  r: z.number().nonnegative().finite().optional(),
  width: z.number().nonnegative().finite().optional(),
  height: z.number().nonnegative().finite().optional(),
  content: z.string().optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  transform: z.string().optional(),
});

export const arrangeInput = {
  canvas: z
    .object({
      width: z.number().positive().finite(),
      height: z.number().positive().finite(),
    })
    .describe('Canvas-Dimensionen'),
  elements: z
    .array(arrangeElementSchema)
    .refine(
      (elements) =>
        new Set(elements.map((element) => element.id)).size === elements.length,
      {
        message: 'Element-IDs muessen eindeutig sein',
      },
    )
    .describe('Elemente mit ID, Tag und optionalen Dimensionen'),
  constraints: z
    .array(z.string())
    .describe(
      'Constraints im Format "#subject TYPE #reference". Reihenfolge ist semantisch relevant.',
    ),
};

export const constraintsInput = {};

export const statusInput = {};

// §1.9 Eichkörper-Selftest: optionaler full-Flag (true → zusätzlich N=10-Mini-
// Determinismus-Check pro Lauf). Default false (Kalibrierung allein).
export const selftestInput = {
  full: z
    .boolean()
    .optional()
    .describe(
      'true → zusätzlich N=10-Mini-Determinismus-Check (langsamer). Default: nur Kalibrierung.',
    ),
};

// ── OUTPUT SCHEMAS (structuredContent) ────────────────────

// §6 RELAIS Fehler-Kanal (an internal spec §6, R9a #13/#14): additiver,
// optionaler Top-Level-Schlüssel `error: {code, hint}` — NUR präsent, wenn
// die Antwort isError:true trägt (gleiches additive-optional-Muster wie
// canvas_validity). code = Ursachen-Name (bestehendes Vokabular: Renderer-
// Error-Codes bzw. NO_BASELINE/ANALYSIS_NOT_FOUND/ARRANGE_FAILED aus der
// pipeline-Quelle); hint = der Navigations-Satz, wortidentisch in der Prosa
// (Parity-Pin: tests/relais_red). BEWUSST KEIN severity/level/weight-Feld
// (maintainer gate §7.2 Severity-Form). Plain zod, kein ZodEffects.
const errorEnvelopeSchema = z
  .object({
    code: z.string(),
    hint: z.string(),
  })
  .optional();

// §1.5 Block E (R-E): fixSchema.attribute ist von z.string() auf z.enum gehärtet.
// Die Enum-Liste ist gegen die TATSÄCHLICHE buildFix/buildElementFixes-Wertemenge
// kalibriert (NICHT FIX_PLANs spekulative x2/y2):
//   - whitelist-Pfad (deltaToAttribute map-Werte): cx,cy,r,rx,ry,x,y,x1,y1,width,height
//   - Transform-Fallback (path/polygon/...): transform
//   - tspan native relativer Shift (R-C): dx,dy  (NUR für tspan valide)
// BEWUSST AUSGESCHLOSSEN: dw,dh (werden NIE als attribute emittiert — Größen-Fix
// auf Non-Whitelist-Tags wird zu reason='SIZE_FIX_UNSUPPORTED_FOR_TAG', C3/C5).
// Damit ist <path dw=...>/<path dh=...> schemamechanisch unmöglich (C5). dx/dy
// bleiben enum-zulässig (tspan), aber der Producer (structured.js) emittiert sie
// für path/polygon NIE — dort läuft alles über 'transform'.
const FIX_ATTRIBUTE_ENUM = [
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'y1',
  'width',
  'height',
  'transform',
  'dx',
  'dy',
];

const fixSchema = z.object({
  attribute: z.enum(FIX_ATTRIBUTE_ENUM),
  current: z.string(),
  target: z.string(),
  // §1.5: low-effort known-limitation-Hinweis am transform-Fix (praezision_2,
  // CSS-Override). Optional — nur der Transform-Fallback setzt ihn.
  warning: z.string().optional(),
});

const correctionSchema = z.object({
  element: z.string(),
  tag: z.string().optional(),
  constraint: z.string(),
  reference: z.string().nullable(),
  dx: z.number().int().optional(),
  dy: z.number().int().optional(),
  dw: z.number().int().optional(),
  dh: z.number().int().optional(),
  fix: fixSchema.optional(),
  fixes: z.array(fixSchema).optional(),
  // §1.5 (praezision_3): Größen-Fix auf Tags ohne Size-Mapping (path/polygon/...)
  // ist nicht via Attribut darstellbar → reason statt erfundenem scale(). Optional.
  reason: z.enum(['SIZE_FIX_UNSUPPORTED_FOR_TAG']).optional(),
});

// §1.2b L-004 / R-β-2: elementSchema wird exportiert, damit test_schema.js
// den Schema-Vertrag direkt testen kann (statt nur indirekt via analyzeOutput).
// API-Erweiterung ist additiv — bestehende Konsumenten (analyzeOutput, inspectOutput,
// die z.array(elementSchema) bauen) bleiben unverändert.
export const elementSchema = z.object({
  id: z.string(),
  tag: z.string(),
  cell: z.string(),
  color: z.string(),
  status: z.enum(['ok', 'fail', 'warn']),
  // §1.2 3D-Detection Pre-Gate (FIX_PLAN §1.2 + ADR-026 §3):
  // 'not_measurable' wenn ein Vorfahre matrix3d(...)/perspective(...)/preserve-3d trägt
  // (Spotter darf darauf keine Pixel-Deltas berechnen). 'reliable' bei reiner 2D-Kette.
  // §1.2b L-003 (Sprint-β1, Pflicht-Promotion): Datenkette grid.js (mappedElements)
  // + structured.js (sceneElements) propagieren das Feld vollständig vom Renderer
  // durch — REGEL-3 Spotter-Anti-Lüge ist jetzt auch auf MCP-Caller-Ebene erfüllt.
  // bbox_reliability ist daher Pflicht; warnings bleibt .optional() (nur bei
  // 3D-Treffer populiert).
  // §1.4
  // (ADR-026 §6 Reliability-Trichter + ADR-032 §Entscheidung). 'approximate'
  // signalisiert: Element ist messbar, aber bekannte Naeherung (z.B. 2D-CSS-
  // transform mit Float-Drift, dominant-baseline-Text mit Glyph-Ascent,
  // opacity-Grauzone). Spotter MUSS approximate-Elemente wie reliable
  // behandeln im Pass-Pfad, aber bei fail KEINE Pixel-Korrektur emittieren
  // (superRefine + structured.js Gate adressieren das). Pessimismus-Prinzip:
  // 'not_measurable' > 'approximate' > 'reliable'.
  bbox_reliability: z.enum(['reliable', 'approximate', 'not_measurable']),
  // §1.5 Block E (befund_3): Parent-Kontext für tspan/textPath. Der §1.5-tspan-Fix
  // nutzt natives dx/dy RELATIV zur Eltern-<text>-Position (R-C) — der Caller braucht
  // parent_id/parent_tag, um zu wissen, woran der tspan hängt. .optional(), weil nur
  // verschachtelte Elemente (tspan, textPath) sie tragen; Top-Level-Elemente nicht.
  parent_id: z.string().optional(),
  parent_tag: z.string().optional(),
  // §1.5 Block H / Patch P1 (F-2): Autor-transform-Attribut. Vom Renderer surfaced,
  // damit der Transform-Fallback (buildTransformFix) den Autor-scale/rotate erhält.
  // .optional() — nur Elemente mit transform-Attribut tragen es.
  transform: z.string().optional(),
  warnings: z.array(z.string()).optional(),
  // §E4 Paint-Extent-Ehrlichkeit (F-AT-004, DoD-3): ein gefiltertes Element malt
  // Tinte (Glow/Schatten/Blur) AUSSERHALB seiner geom-bbox. bbox_reliability bleibt
  // 'reliable' (die Geometrie IST exakt) — die Ehrlichkeit trägt diese zwei Felder.
  //   has_paint_overflow: true, wenn die W3C-Filter-Region über die geom-bbox
  //     hinausragt (url(#id)→<filter>) ODER der Overflow existiert, aber unmessbar
  //     ist (CSS-Filter-Funktion ohne Region). .optional() — filterlose Elemente
  //     tragen es NICHT (Negativ-Kontrolle: kein Over-Flag).
  has_paint_overflow: z.boolean().optional(),
  //   visual_bbox: die Filter-Region als AABB-Hülle im user-space ({x,y,w,h}) ODER
  //     das Literal 'not_measurable' (CSS-Filter-Funktion → spec-seitig keine
  //     Region). .nullable().optional() — KEIN Enum-Bruch (additiv). Union aus
  //     bbox-Form und String-Literal.
  visual_bbox: z
    .union([
      z.object({
        x: z.number().finite(),
        y: z.number().finite(),
        w: z.number().finite(),
        h: z.number().finite(),
      }),
      z.literal('not_measurable'),
    ])
    .nullable()
    .optional(),
  // §HEAL-R6 / T1 Paint-Presence (F-AT-6-01, CRIT, DoD-2): der Sichtbarkeits-Walk
  // prüfte fill-opacity/stroke-opacity NICHT — ein fill-opacity:0-Element (0 Pixel)
  // wurde als reliable+sichtbar emittiert (die Lüge). Drei additive Felder tragen
  // jetzt die Tinten-Wahrheit (additiv → bestehende Konsumenten unverändert):
  //   fill_paint_factor / stroke_paint_factor: die effektiven, permanenz-bewussten
  //     Kanal-Alpha-Faktoren (composedOpacity-frei; Element-opacity steckt im
  //     opacity-Feld). Diagnostik für den Konsumenten.
  //   paint_visible: 3-wertiger Tinten-Vertrag (§HEAL-R6 Variante 1, F-AT-6-07).
  //     false          — KEIN Kanal malt ODER ein RÄUMLICHER Operator löscht die
  //                      Tinte beweisbar (CTM-det=0 / Vorfahr-Viewport-Clip-leer).
  //     'indeterminate'— ein nicht-aufzählbarer räumlicher Operator (clip-path/mask/
  //                      pattern/filter, oder nicht-endliche CTM) ist present, aber
  //                      die Tinten-Präsenz ist raster-frei NICHT entscheidbar →
  //                      ehrlich unbestimmt statt falsch-reliable (Blind-Trust). Trägt
  //                      die Warning PAINT_PRESENCE_INDETERMINATE.
  //     absent         — normal sichtbar (Negativ-Kontrolle: Feld fehlt).
  //     bbox_reliability bleibt 'reliable' (die Geometrie IST exakt; NUR die Tinten-
  //     Behauptung wird graduiert). Die SDK registriert diese als MCP-outputSchema
  //     (tools.js) — ohne die Union verwirft sie 'indeterminate' zur LAUFZEIT (KRIT).
  fill_paint_factor: z.number().optional(),
  stroke_paint_factor: z.number().optional(),
  paint_visible: z
    .union([z.literal(false), z.literal('indeterminate')])
    .optional(),
  // §D5 / R6-STATE Zustands-Abhängigkeit (state_dependent): reines Flag — ein
  // interaktiver Pseudo-Selektor (:hover/:focus/:focus-within/:focus-visible/
  // :active/:target) self-oder-Vorfahr ODER ein SMIL <set/animate begin|end mit
  // Event-Token zielt auf das Element. Die t=0-Geometrie bleibt EXAKT wahr (KEIN
  // bbox_reliability-Degrade) — Alt-Zustände sind ZUSÄTZLICHE Wahrheiten. Plain
  // zod (KEIN ZodEffects) → automatisch in beiden registrierten outputSchemas,
  // kein Laufzeit-Reject. true-only (statische Elemente tragen das Feld NICHT).
  state_dependent: z.boolean().optional(),
  // §F-AT-6-09 / R6-MEDIA + §HEAL-4 Viewport-Abhängigkeit (media_dependent):
  // reines true-only-Flag — das Element ist VIEWPORT-DIVERGENT, erkannt über
  // EINE von ZWEI ODER-verknüpften Quellen (Semantik-Weitung Heal 4, additiv):
  //   (a) STATISCH: ein Selektor INNERHALB einer @media-(Conditional-Group-)
  //       Regel trifft das Element UND deren Bedingung nennt ein VIEWPORT-
  //       Feature (width/height/orientation/aspect-ratio/resolution/device-*),
  //       ODER element-lokale vw/vh/vmin/vmax-Geometrie (authored-Scan, I1).
  //       Rein statisch @t=0, KEIN matches-Gate — beide Divergenz-Richtungen.
  //   (b) GEMESSEN (§HEAL-4, an internal spec): der lean
  //       2-Viewport-Mess-Diff ([1920,400] ∪ px-Breakpoint-Straddles) in
  //       analyze()/inspect() belegt reale Divergenz auf einer der 3 Achsen
  //       (Geometrie in root-user-units / computed paint / Paint-Server-
  //       Closure) — fängt auch @container, %-in-nested-svg, <style>-Regel-vw,
  //       transform-vw und font-size-vw, die (a) nicht sieht.
  //   Die Verknüpfung ist STRIKT ADDITIV (OR-only): Messung fügt nur hinzu,
  //   nimmt nie ein statisches true weg (F-AT-7-14 use-Shadow-Blindfleck —
  //   die Statik bleibt load-bearing). Mess-Ausfall ist LAUT (scene-level
  //   MEDIA_MEASURE_UNAVAILABLE im Prosa-Kanal), nie still.
  //   Die t=0-Geometrie bleibt EXAKT wahr (KEIN bbox_reliability-Degrade).
  //   Orthogonal zu state_dependent/Motion (drei stille Achsen). Plain zod
  //   (KEIN ZodEffects) → kein Laufzeit-Reject. true-only.
  media_dependent: z.boolean().optional(),
  // §HEAL-5 / F-AT-2-005 Zeit-Achse (motion_dependent): reines true-only-Flag —
  // die Subjekt-Geometrie ist ZEIT-VARIANT (clock-rooted SMIL-GEOMETRIE:
  // animate/set auf einem Geometrie-Attribut · animateTransform · animateMotion,
  // deren begin-ATTRIBUT GANZ FEHLT (Blink-Default 0s) ODER ≥1 validen
  // Offset-/Clock-Token trägt; leere/malformed begin-Werte laufen in Blink NIE
  // — Boden-Wahrheit mgr/malformed_begin_gt.mjs + empty_begin_gt.mjs, Mikro-
  // Patch R1). Die t0-Messung bleibt EXAKT — an anderem t anders
  // (KEIN bbox_reliability-Degrade; T3a/Heal-4-Präzedenz: Alt-Zeitpunkte sind
  // ZUSÄTZLICHE Wahrheiten). Vierte stille Achse, orthogonal zu state_dependent/
  // media_dependent/paint_visible. z.literal(true) kodiert true-only AM VERTRAG
  // (Spec-Tabelle Edit #1; Emission ist ohnehin true-only-Spread). Plain zod
  // (KEIN ZodEffects) → automatisch in beiden registrierten outputSchemas, kein
  // Laufzeit-Reject. EDIT #1 ZUERST (R6-Präzedenz, empirisch erzwungen: zod
  // unknownKeys='strip' strippt unbekannte Felder STILL — Witness S, 4c8a6ed).
  motion_dependent: z.literal(true).optional(),
  // §H10 R11-06 Paint-Zeit-Achse (paint_time_variant): reines true-only-Flag —
  // eine PAINT-/Darstellungs-Eigenschaft des Elements ist zeit-variant
  // (clock-rooted SMIL auf NICHT-Geometrie-Kanal: fill/stroke/opacity/… bzw.
  // animateColor). Die t0-Messung (Farbe/Opacity @t0) bleibt EXAKT — an
  // anderem t anders. Fünfte Achse, orthogonal zu motion_dependent
  // (Geometrie-Zeit ≠ Paint-Zeit). Selbes true-only-Literal-Muster.
  paint_time_variant: z.literal(true).optional(),
});

const diffEntrySchema = z.object({
  type: z.string(),
  id: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
});

const iterationSchema = z.object({
  sequence: z.number().int(),
  previous_issues: z.number().int(),
  current_issues: z.number().int(),
  total_issues: z.number().int(),
  returned_issues: z.number().int(),
  suppressed: z.number().int(),
  // §H9 K-12: BASELINE = erste Messung mit Issues (sequence=1, keine
  // Historie) — die Trend-Wörter STAGNATING/DIVERGING sind echten
  // Vergleichen (previousIssueCount vorhanden) vorbehalten. Additiv.
  // §H9 P2: .nullable() — die Error-Hülle (analyzeErrorStructured) trägt
  // convergence:null („keine Aussage": im Fehlerfall gibt es keine Messung,
  // das frühere 'SOLVED' widersprach isError:true). Erfolgs-Pfade emittieren
  // weiterhin IMMER einen Enum-Wert (computeConvergence). Additiv-nullable,
  // kein ZodEffects (Muster: breakerStatsSchema/calibrationSchema).
  convergence: z
    .enum(['IMPROVING', 'STAGNATING', 'DIVERGING', 'SOLVED', 'BASELINE'])
    .nullable(),
  // §1.3 Schicht 2: Server-Garantie — auf JEDEM Erfolgs-Pfad emittiert
  // (UUID v4 via crypto.randomUUID). §H9 P2 (Wahrheits-Rekalibrierung der
  // Garantie): die Error-Hülle trägt analysisId:null statt einer ERFUNDENEN
  // frischen UUID, die kein Grid referenziert — das Feld bleibt Pflicht
  // (nullable ≠ optional), null ist das ehrliche „keine Analyse gespeichert".
  analysisId: z.string().uuid().nullable(),
});

const uncheckedEntrySchema = z.object({
  element: z.string().nullable(),
  constraint: z.string(),
  reasonCategory: z.string(),
  reasonCode: z.string(),
  hint: z.string(),
  suggestedCorrection: z.string().optional(),
});

// §1.4
// Kanal fuer Warnings auf Elementen, die das slice(0,7)-Cap aus BAUPLAN
// OBL-008 verbergen wuerde. structured.js (Edit F) befuellt das, wenn
// elements.length > 7 UND warning-tragende Elemente auf Position >7 stehen.
// Caller sieht damit das Reliability-Signal auch jenseits des Scene-Cap
// (REGEL-3 Spotter-Anti-Luege ueberstimmt BAUPLAN-Token-Limit).
const truncatedWarningEntrySchema = z.object({
  element_id: z.string(),
  warnings: z.array(z.string()),
  position: z.number().int().nonnegative(),
});

// §1.4
// Schluessel im Output. Aktuell traegt er nur truncated_warnings; weitere
// Hoist-Kanaele (z.B. truncated_corrections) koennten hier additiv ergaenzt
// werden ohne Schema-Breaking-Change.
const metaSchema = z
  .object({
    truncated_warnings: z.array(truncatedWarningEntrySchema).optional(),
  })
  .optional();

// §H10 R11-01: EINE Schema-Quelle für das Existenz-Register (analyze + inspect).
// Plain zod, optional-by-default (Feld fehlt, wenn nichts geskippt wurde).
const hiddenElementsSchema = z
  .array(
    z.object({
      id: z.string().nullable(),
      tag: z.string(),
      axis: z.enum(['display:none', 'visibility:hidden', 'opacity:0']),
    }),
  )
  .optional();

export const analyzeOutput = {
  status: z.enum(['PASS', 'FAIL', 'PARTIAL']),
  iteration: iterationSchema,
  scene: z.object({
    width: z.number(),
    height: z.number(),
    grid: z.string(),
    elements: z.array(elementSchema),
    // §HEAL-R6 / T1 "das Kabel" (F-AT-6-08): Canvas-Validität aus dem
    // honesty.js#classifyCanvas-Verdikt. 'lossy' ⇒ DOMPurify hat Semantik
    // entfernt (resolved.sanitize_loss non-empty) → referenzierende Messung
    // kann von der Quelle abweichen. OPTIONAL (kein required → keine
    // Fixture-Brüche); die Garantie sichern Tests, nicht required. Plain zod
    // (KEIN ZodEffects) → automatisch in den registrierten outputSchemas, kein
    // Laufzeit-Reject. Selbes additives Muster wie inspectOutput.scene.suppressed.
    canvas_validity: z
      .enum(['valid', 'default_replaced', 'degenerate', 'lossy'])
      .optional(),
    // §H10 R11-01: Existenz-Register — css-unsichtbar geskippte Elemente
    // (id+Achse), NICHT Teil von scene.elements (Emissions-Menge byte-stabil).
    // Optional-by-default (Muster canvas_validity); id null bei Auto-id-losen.
    hidden_elements: hiddenElementsSchema,
    // §HEAL-7/C (Codex MCP-Wahrheitsgrenze): scene-level Mess-Ausfall-Marker
    // (§HEAL-4 MK3, pipeline.js#withMeasureUnavailable). OHNE Deklaration
    // strippte der zod-Boundary-Parse (SDK mcp.js: safeParseAsync gegen
    // z.object(outputSchema), unknownKeys='strip') das Feld STILL und der
    // tools/list-JSON-Schema-Dump (additionalProperties:false) verwarf es
    // ajv-seitig (-32602-Klasse) — der laute Ausfall war an der MCP-Grenze
    // unsichtbar (nur der Prosa-Kanal trug ihn). z.literal: genau EIN Wert;
    // optional (Normalfall: Feld absent). Plain zod, kein ZodEffects.
    media_measure: z.literal('MEDIA_MEASURE_UNAVAILABLE').optional(),
  }),
  corrections: z.array(correctionSchema),
  unchecked: z.array(uncheckedEntrySchema),
  diff: z.array(diffEntrySchema),
  meta: metaSchema,
  // §6 RELAIS: isError-Pfade von analyze/compare (Render-Fehler ohne Verlust,
  // compare-No-Baseline) tragen error{code,hint} — sonst absent.
  error: errorEnvelopeSchema,
};

export const inspectOutput = {
  scene: z.object({
    width: z.number(),
    height: z.number(),
    grid: z.string(),
    elements: z.array(elementSchema),
    // §E1 D-008 (F-TF-008): ehrlicher ELEMENT-Trunkierungs-Zaehler, required
    // (wie analyze iterationSchema.suppressed). inspect hat KEINEN iteration-
    // Block, daher gehoert der Zaehler in scene (er beschreibt scene.elements,
    // die bei >SCENE_MAX_ELEMENTS via slice(0,7) gekuerzt werden). ≤7 → 0.
    suppressed: z.number().int(),
    // §HEAL-R6 / T1 "das Kabel" (F-AT-6-08): Canvas-Validität (classifyCanvas).
    // Selbes additive optional-Muster wie analyzeOutput.scene.canvas_validity —
    // inspect speist es ebenfalls aus resolved.sanitize_loss (Anti-LECK-3).
    canvas_validity: z
      .enum(['valid', 'default_replaced', 'degenerate', 'lossy'])
      .optional(),
    // §H10 R11-01: Existenz-Register auch im inspect-Pfad (Kanal-Parität).
    hidden_elements: hiddenElementsSchema,
    // §HEAL-7/C: Mess-Ausfall-Marker auch im inspect-Pfad (withMeasureUnavailable
    // läuft in analyze() UND inspect()) — selbes Muster wie analyzeOutput.scene.
    media_measure: z.literal('MEDIA_MEASURE_UNAVAILABLE').optional(),
  }),
  meta: metaSchema,
  // §6 RELAIS: isError-Pfad von inspect (Render-Fehler ohne Verlust).
  error: errorEnvelopeSchema,
};

// §1.4
// Validator-Variante des analyzeOutput-Shapes mit REGEL-3-Postcondition:
//   Wenn corrections[i].element === scene.elements[j].id (modulo '#'-Praefix)
//   UND scene.elements[j].bbox_reliability ∈ {'not_measurable','approximate'}
//   → corrections[i] DARF KEINE dx/dy enthalten.
// Wird NICHT als outputSchema im MCP-Server-Pfad verwendet (MCP-SDK's
// normalizeObjectSchema kann mit ZodEffects nicht umgehen), sondern dient
// als Drift-Verhinderungs-Gate fuer test_regel3_invariants.js (Edit H) und
// als Compound-Schema fuer Property-Based-Tests. Der tatsaechliche Defekt-
// Fix fuer β-002 sitzt in structured.js (Edit F) — dort wird das dx/dy
// proaktiv unterdrueckt, BEVOR es das Schema erreichen kann. Das hier ist
// der Mechanismus, der diese Unterdrueckung mechanisch UEBERPRUEFT.
export const analyzeOutputCompound = z
  .object(analyzeOutput)
  .superRefine((data, ctx) => {
    if (!data.scene || !Array.isArray(data.scene.elements)) return;
    if (!Array.isArray(data.corrections)) return;
    const reliabilityById = new Map();
    for (const el of data.scene.elements) {
      reliabilityById.set(el.id, el.bbox_reliability);
    }
    for (let i = 0; i < data.corrections.length; i++) {
      const c = data.corrections[i];
      if (!c || typeof c.element !== 'string') continue;
      const id = c.element.replace(/^#/, '');
      const reliability = reliabilityById.get(id);
      // Element-Lookup-Fehlschlag (z.B. correction.element zeigt auf nicht-
      // gelistete Scene-Element-ID wegen slice(0,7)-Cap): das ist ein
      // separater REGEL-3-Bruch (β-003), wird in structured.js Edit F
      // angegangen. Hier kein addIssue — sonst doppelte Meldung.
      if (reliability === undefined) continue;
      if (reliability === 'not_measurable' || reliability === 'approximate') {
        const hasDx = c.dx !== undefined;
        const hasDy = c.dy !== undefined;
        if (hasDx || hasDy) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['corrections', i],
            message:
              `REGEL-3: corrections[${i}].element='${c.element}' verweist auf scene.elements mit ` +
              `bbox_reliability='${reliability}' — dx/dy duerfen nicht emittiert werden (Spotter-Anti-Luege).`,
          });
        }
      }
    }
  });

export const paletteOutput = {
  colors: z.array(
    z.object({
      id: z.string(),
      fill: z.string(),
      stroke: z.string().nullable(),
    }),
  ),
  // §6 RELAIS: isError-Pfad von palette (Render-Fehler).
  error: errorEnvelopeSchema,
};

const constraintTypeSchema = z.object({
  type: z.string(),
  syntax: z.string(),
  hasArrange: z.boolean(),
});

export const constraintsOutput = {
  types: z.array(constraintTypeSchema),
};

export const arrangeOutput = {
  attributes: z.record(
    z.string(),
    z.record(z.string(), z.union([z.number(), z.string()])),
  ),
  warnings: z.array(z.string()),
  // §6 RELAIS: isError-Pfad von arrange (Handler-Catch, ARRANGE_FAILED).
  error: errorEnvelopeSchema,
};

// §1.4 Globale Bookmarks (B-3): Output für vector_mirror_bookmark.
// analysisId bleibt UUID (Quell-ID; KORR-2 — kein Name im Output).
export const bookmarkOutput = {
  name: z.string(),
  analysisId: z.string().uuid(),
  stored: z.boolean(),
  bookmarkCount: z.number().int().nonnegative(),
  // §6 RELAIS: isError-Pfad von bookmark (unbekannte/verdrängte analysisId).
  error: errorEnvelopeSchema,
};

const breakerStatsSchema = z
  .object({
    name: z.string(),
    state: z.enum(['closed', 'open', 'half-open']),
    fires: z.number().int(),
    successes: z.number().int(),
    failures: z.number().int(),
    timeouts: z.number().int(),
    rejects: z.number().int(),
    fallbacks: z.number().int(),
    semaphoreRejections: z.number().int(),
    latencyMean: z.number(),
  })
  .nullable();

// §1.9 Eichkörper-Selftest: Kalibrierungs-Stand im status-Output. nullable +
// optional → kein Bruch bestehender E2E-Roundtrip-Asserts (Feld fehlt/null bis
// der erste Selftest lief). PENDING = Auto-Selftest läuft noch (fire-and-forget
// nach connect). MCP-SDK-tauglich (kein ZodEffects).
const calibrationSchema = z
  .object({
    status: z.enum(['PASS', 'FAIL', 'PENDING']),
    calibrated: z.number().int(),
    total: z.number().int(),
    timestamp: z.string(),
  })
  .nullable()
  .optional();

export const statusOutput = {
  version: z.string(),
  browser: z.enum(['running', 'stopped']),
  lastAnalysis: z.boolean(),
  constraintTypes: z.number().int(),
  breaker: breakerStatsSchema,
  calibration: calibrationSchema,
};

// §1.9 Eichkörper-Selftest: Output-Schema für vector_mirror_selftest. Trägt das
// Kalibrierungs-Verdikt + die Abweichungs-Liste (anti-zirk Spec-Mismatches).
export const selftestOutput = {
  status: z.enum(['PASS', 'FAIL']),
  calibrated: z.number().int(),
  total: z.number().int(),
  failures: z.array(
    z.object({
      ek: z.string(),
      reason: z.string(),
    }),
  ),
};
