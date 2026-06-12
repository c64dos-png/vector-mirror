/**
 * claims.js — Claims-Register: die EINE Quelle der Führungs-Wahrheit
 * (RELAIS-SPEC §0, Ein-Leib-Architektur internal design rule).
 *
 * Reiner Daten-Export, kein I/O, keine Logik-Importe. Aus diesem Register
 * speisen sich (a) die VOLLSTÄNDIGEN Tool-Descriptions (tools.js konsumiert
 * DESCRIPTIONS — Eigenheiten via EIGENHEITEN-Projektion, die übrigen 4 Blöcke
 * via BLOCKS; tools.js trägt KEINEN Description-Freitext mehr, P2/S1b),
 * (b) der instructions-Quickstart (server.js, via QUICKSTART-Projektion),
 * (c) das Glossar (Teil des Quickstarts), (d) der Protokoll-Selftest
 * (tests/relais_red/selftest_claims.mjs: S1 Wortidentität · S1b Vollstring-
 * Pin Description==Register-Projektion · S2 Deckung==1.0 · S3 Wahrheit).
 *
 * Form je Claim (Spec §0): id · text (der exakte ausgelieferte Satz,
 * wortidentisch) · targets (analyze|compare|bookmark|inspect|palette|
 * arrange|constraints|status|selftest|instructions) · probe (Pfad relativ
 * zum Projekt-Root ODER 'STATIC' für rein definitorische Sätze) · beleg
 * (Empirie-Anker — Herkunfts-Spur, nicht der Beweis).
 *
 * Claim-IDs erscheinen NICHT im ausgelieferten Text (Ballast-Audit 23);
 * der Selftest prüft Wortidentität per Substring.
 *
 * §5-VERDIKT (probe_mcp_k05.mjs, HEAD aa2ef1c): H1 Kanal-Schatten bestätigt —
 * Prosa ✓ / structured ✗ für analyze UND inspect. C-ANA-E1 nennt daher die
 * Kanal-Wahrheit explizit (Offenlegung NUR im Text-Kanal).
 */

export const CLAIMS = [
  // ── GLOSSAR (Spec §3, G1–G6) ──────────────────────────────────────────────
  {
    id: 'C-GLO-01',
    text: 'scene.elements zeigt maximal 7 Elemente, suppressed zählt den Rest; Constraints auf verdeckte Elemente werden trotzdem geprüft; einen Nachlade-Parameter gibt es nicht.',
    targets: ['analyze', 'instructions'],
    probe: 'tests/relais_red/probe_cap_suppressed.mjs',
    beleg: 'K-01/K-02, R9a #5/#8, DR-1 Probe A',
  },
  {
    id: 'C-GLO-02',
    text: 'canvas_validity=lossy heißt: der Sanitizer hat etwas entfernt oder ersetzt — auch render-neutrale Strips (etwa Kommentare) zählen; Verlust-Details stehen nur im Text-Kanal der Antwort.',
    targets: ['inspect', 'instructions'],
    probe: 'tests/relais_red/probe_lossy_textkanal.mjs',
    beleg: 'K-06/K-24, R9a #5, §5-Verdikt H1',
  },
  {
    id: 'C-GLO-03',
    text: 'PARTIAL = unchecked-Constraints oder vom Cap verdeckte Warnungen (meta.truncated_warnings, nur bei Trunkierung); sichtbare Warnungen allein ergeben PASS.',
    targets: ['analyze', 'instructions'],
    probe: 'tests/relais_red/probe_partial_meta.mjs',
    beleg: 'K-10 adjudiziert, K-26, N-4',
  },
  {
    id: 'C-GLO-04',
    text: 'analysisId und Bookmarks leben nur im laufenden Server-Prozess (in-memory) — Ein-Aufruf-Clients können compare/bookmark nicht nutzen.',
    targets: ['analyze', 'compare', 'bookmark', 'instructions'],
    probe: 'tests/relais_red/probe_mcp_session.mjs',
    beleg: 'K-13a, R9a §8 Hürde 2',
  },
  {
    id: 'C-GLO-05',
    // §P7 (Opus): die Diagonale nicht verschweigen — der Abstand ist euklidisch
    // über die AABB-Lücke (distance.js: sqrt(gapX²+gapY²) >= N*cellW).
    text: 'DISTANCE-FROM N verlangt eine Lücke ≥ N Zellbreiten — Abstand euklidisch über die AABB-Lücke (sqrt aus gapX²+gapY², auch diagonal); Zellbreite = Canvas-Breite ÷ Grid-Spalten (Spalten: scene.grid).',
    targets: ['instructions'],
    probe: 'tests/relais_red/probe_einheiten_distance.mjs',
    beleg: 'K-30 (3-Punkt-Formel), distance.js: sqrt(gapX²+gapY²) >= N*cellW',
  },
  {
    id: 'C-GLO-06',
    text: 'Farben erscheinen überall als W3C-Namen, nie als Hex; COLOR vergleicht Namen: #ff0000 besteht als red, #ff6347 nicht.',
    targets: ['analyze', 'palette', 'instructions'],
    probe: 'tests/relais_red/probe_farb_granularitaet.mjs',
    beleg: 'K-07/K-08a, H9-P3-Pin',
  },

  // ── analyze / inspect (geteilte Sanitizer-Wahrheit, §5-Verdikt H1) ───────
  {
    id: 'C-ANA-E1',
    text: 'Reservierte/kollidierende Autor-ids (etwa "title") ersetzt der Sanitizer durch Auto-IDs; die Original-id steht NUR im Text-Kanal — bei lossy immer auch content[0].text lesen.',
    targets: ['analyze', 'inspect', 'instructions'],
    probe: 'tests/relais_red/probe_mcp_k05.mjs',
    beleg: 'K-05/H9-B1, R9a §4, §5-Verdikt H1 (HEAD aa2ef1c)',
  },
  {
    // §P6 (Opus, MCP-Rand-Probe): analysisId ist KEIN Top-Level-Output-Key —
    // er wohnt unter iteration.analysisId. Block 3 der analyze-Description ist
    // damit Claim (Probe pinnt die echten Top-Level-Keys), nicht Freitext.
    id: 'C-ANA-OUT',
    text: 'Output: status PASS/FAIL/PARTIAL, corrections (fix), unchecked, diff; analysisId unter iteration.',
    targets: ['analyze'],
    probe: 'tests/relais_red/probe_partial_meta.mjs',
    beleg: 'Opus P6 2026-06-11 (MCP-Rand), schema.js analyzeOutput Top-Level',
  },

  // ── compare ───────────────────────────────────────────────────────────────
  {
    id: 'C-CMP-ERR',
    text: 'Ohne Baseline in diesem Prozess: isError:true und error {code: NO_BASELINE, hint} in structured, derselbe Hint im Text-Kanal — zuerst analyze ausführen.',
    targets: ['compare'],
    probe: 'tests/relais_red/probe_mcp_errorchannel.mjs',
    beleg: 'R9a #13/#14, §6 Fehler-Kanal, K-13bc',
  },
  {
    id: 'C-CMP-VOC',
    text: 'Diff-Vokabular deutsch und endlich: VERSCHOBEN, FARBÄNDERUNG, FORMÄNDERUNG, NEU, ENTFERNT.',
    targets: ['compare'],
    probe: 'tests/relais_red/probe_compare_diff.mjs',
    beleg: 'R9a #10, core/diff.js (5 Typen)',
  },
  {
    id: 'C-CMP-GRAN',
    text: 'Das Diff sieht Farben auf Namens-Ebene: Hex-Drift unterhalb der Namens-Grenze bleibt unsichtbar, Namens-Sprünge erscheinen als FARBÄNDERUNG.',
    targets: ['compare'],
    probe: 'tests/relais_red/probe_compare_diff.mjs',
    beleg: 'K-07/K-12-Umfeld, opus_guided S12',
  },

  // ── bookmark ──────────────────────────────────────────────────────────────
  {
    id: 'C-BKM-ERR',
    text: 'Unbekannte/verdrängte analysisId: isError:true und error {code: ANALYSIS_NOT_FOUND, hint}; maximal 10 Bookmarks, das älteste wird verdrängt (LRU).',
    targets: ['bookmark'],
    probe: 'tests/relais_red/probe_mcp_errorchannel.mjs',
    beleg: '§6 Fehler-Kanal, pipeline.js MAX_BOOKMARKS=10',
  },

  // ── inspect ───────────────────────────────────────────────────────────────
  {
    id: 'C-INS-CAP',
    text: 'Derselbe 7-Elemente-Cap wie analyze — inspect umgeht ihn nicht; suppressed zählt verdeckte Elemente.',
    targets: ['inspect'],
    probe: 'tests/relais_red/probe_cap_suppressed.mjs',
    beleg: 'K-02 (teuerste R8-Fehlbehauptung), DR-1 Probe A',
  },
  {
    id: 'C-INS-STRUCT',
    text: 'structuredContent trägt nur scene (plus meta bei Trunkierung) — kein status, keine corrections; canvas_validity und suppressed stehen in scene.',
    targets: ['inspect'],
    probe: 'tests/relais_red/probe_cap_suppressed.mjs',
    beleg: 'K-28',
  },

  // ── palette ───────────────────────────────────────────────────────────────
  {
    id: 'C-PAL-CAP',
    text: 'Maximal 7 Einträge in colors, ohne Zähler — weitere Elemente nennt nur die Text-Zeile (N weitere).',
    targets: ['palette'],
    probe: 'tests/relais_red/probe_cap_suppressed.mjs',
    beleg: 'R9a #6 (Probe-Pflicht eingelöst)',
  },

  // ── arrange ───────────────────────────────────────────────────────────────
  {
    id: 'C-ARR-SEQ',
    text: 'Constraints wirken sequentiell — jede sieht das Ergebnis der vorigen, die Reihenfolge ändert das Layout.',
    targets: ['arrange'],
    probe: 'tests/relais_red/probe_arrange.mjs',
    beleg: 'IST-Description (bleibt), pipeline.js arrange',
  },
  {
    id: 'C-ARR-TYP',
    text: 'FILL ist arrange-only (in analyze landet es als unchecked); COLOR hat hier keine Wirkung und wird ohne Warnung übersprungen.',
    targets: ['arrange'],
    probe: 'tests/relais_red/probe_arrange.mjs',
    beleg: 'K-16, fill.js (check ⇒ pass:null), color.js (kein arrange)',
  },
  {
    id: 'C-ARR-PROP',
    text: 'Attribute sind Rechen-Vorschläge ohne Canvas-Wächter — auch Positionen außerhalb des Canvas kommen ohne Warnung zurück; mit analyze verifizieren.',
    targets: ['arrange'],
    probe: 'tests/relais_red/probe_arrange.mjs',
    beleg: 'K-14-Analogie (Probe-Pflicht eingelöst)',
  },
  {
    id: 'C-ARR-P5',
    text: 'Liste unvollständig — nicht Umsetzbares landet als Klartext in warnings; arrange-fähige Typen zeigt vector_mirror_constraints (hasArrange).',
    targets: ['arrange'],
    probe: 'tests/relais_red/probe_arrange.mjs',
    beleg: 'DR-1 P5, pipeline.js arrange warnings[]',
  },

  // ── constraints ───────────────────────────────────────────────────────────
  {
    id: 'C-CON-VOC',
    text: 'Das Vokabular ist abschließend — was hier nicht steht, existiert nicht; RIGHT-OF/BELOW existieren nicht: LEFT-OF/ABOVE mit getauschten Operanden nutzen.',
    targets: ['constraints'],
    probe: 'tests/relais_red/probe_constraints_vokabular.mjs',
    beleg: 'K-17, P6-Negativrand',
  },
  {
    id: 'C-CON-UNK',
    text: 'Unbekannte Typen werden nie geraten: analyze liefert unchecked mit reasonCode CONSTRAINT_TYPE_UNKNOWN und Hint, bei nahen Tippfehlern mit Korrektur-Vorschlag.',
    targets: ['constraints'],
    probe: 'tests/relais_red/probe_constraints_vokabular.mjs',
    beleg: 'R9a #12 (Fehlerpfad A vorbildlich), arbitrate.js',
  },

  // ── status ────────────────────────────────────────────────────────────────
  {
    id: 'C-STA-CAL',
    text: 'calibration=PENDING: der Auto-Selftest vom Serverstart läuft noch oder scheiterte — nicht defekt; der Browser startet lazy beim ersten Mess-Aufruf.',
    targets: ['status'],
    probe: 'tests/relais_red/probe_status.mjs',
    beleg: 'server.js Fire-and-forget, pipeline.js markCalibrationPending',
  },
  {
    id: 'C-STA-LAST',
    text: 'lastAnalysis zeigt Baseline-Existenz nur für diesen Prozess.',
    targets: ['status'],
    probe: 'tests/relais_red/probe_status.mjs',
    beleg: 'K-13a',
  },

  // ── selftest ──────────────────────────────────────────────────────────────
  {
    id: 'C-SEL-ANTI',
    text: 'Misst die 5 Eichkörper gegen spec-abgeleitete expected-Werte, nie gegen gespeicherten eigenen Output — Anti-Zirkularität als Vertrauensanker.',
    targets: ['selftest'],
    probe: 'tests/relais_red/probe_selftest_antizirk.mjs',
    beleg: 'R9a #11, REGEL-2, pipeline.js __checkEk (PARTIAL-Match)',
  },

  // ── P5-Zeilen (Spec §1.3 — Unvollständigkeits-Ehrlichkeit) ───────────────
  {
    id: 'C-P5-MESS',
    text: 'Liste unvollständig — bei Unerwartetem canvas_validity prüfen, Verlust-Details im Text-Kanal lesen; Glossar: Server-Quickstart.',
    targets: ['analyze', 'compare', 'inspect', 'palette'],
    probe: 'STATIC',
    beleg: 'DR-1 P5 (rein definitorischer Diagnoseweg)',
  },
  {
    id: 'C-P5-STATE',
    text: 'Liste unvollständig — Session-Begriffe (analysisId, Bookmarks) erklärt das Glossar im Server-Quickstart.',
    targets: ['bookmark'],
    probe: 'STATIC',
    beleg: 'DR-1 P5 (rein definitorischer Diagnoseweg)',
  },
  {
    id: 'C-P5-META',
    text: 'Liste unvollständig — Feld-Bedeutungen erklärt das Glossar im Server-Quickstart; bei selftest-FAIL nennt failures die exakte Spec-Abweichung je Eichkörper.',
    targets: ['status', 'selftest'],
    probe: 'STATIC',
    beleg: 'DR-1 P5 + IST-Description selftest (bleibt)',
  },
  {
    // §P3 (Codex): constraints trug als einziges Tool keine P5-Zeile —
    // Spec-§1.3-Wortlaut; der Verhaltens-Teil (unbekannter Typ ⇒ unchecked
    // mit reasonCode+Hint) ist probe-gedeckt (keine STATIC-Quote-Belastung).
    id: 'C-P5-VOC',
    text: 'Liste unvollständig — unbekannter Typ ⇒ unchecked mit reasonCode + Hint; vollständiges Vokabular: vector_mirror_constraints.',
    targets: ['constraints'],
    probe: 'tests/relais_red/probe_constraints_vokabular.mjs',
    beleg: 'DR-1 P5, Spec §1.3, R9a #12 (Fehlerpfad A)',
  },

  // ── Quickstart (Spec §4) ──────────────────────────────────────────────────
  {
    id: 'C-QS-ORI',
    text: 'Vector Mirror ist ein deterministisches SVG-Mess-Auge: es rendert headless, misst Geometrie und Farben und prüft räumliche Constraints — es liefert nie ein Bild zurück (kein Render-Tool) und erfindet keine Werte.',
    targets: ['instructions'],
    probe: 'tests/relais_red/probe_mcp_instructions.mjs',
    beleg: 'VISION, R9a §3 (Render-Beweis fehlt = P6-Negativrand)',
  },
  {
    id: 'C-QS-WORKFLOW',
    text: 'vector_mirror_inspect (Layout sehen) → vector_mirror_constraints (Vokabular) → vector_mirror_analyze (prüfen) → Fixes laut corrections → analyze mit previousIssueCount bis PASS; Regressionen: vector_mirror_bookmark → vector_mirror_compare; Vertrauen: vector_mirror_selftest.',
    targets: ['instructions'],
    probe: 'tests/relais_red/probe_mcp_instructions.mjs',
    beleg: 'R9a §2 (Workflow-Kette rekonstruierbar), §6 Entwurf',
  },
  {
    id: 'C-QS-GRAMMAR',
    text: 'Constraint-Grammatik: "#subject TYP #reference [wert]" — Beispiel: "#logo CENTERED-IN #frame"; vollständige Typen-Liste: vector_mirror_constraints.',
    targets: ['instructions'],
    probe: 'tests/relais_red/probe_constraints_vokabular.mjs',
    beleg: 'R9a #2/#4 (Grammatik erstklassig dokumentiert)',
  },
  {
    id: 'C-QS-STOP',
    text: 'Fertig = status PASS und corrections == [] und unchecked == [] und canvas_validity == valid; PARTIAL akzeptieren ist eine dokumentierte Entscheidung, kein Default; canvas_validity lossy: verstanden+akzeptiert ist eine dokumentierte Entscheidung (Verlust-Detail im Text-Kanal prüfen), kein automatisches Unfertig.',
    targets: ['instructions'],
    probe: 'STATIC',
    beleg: 'DR-1 P8 + maintainer rule A2 (K-06-Policy offen)',
  },
];

// ── Hilfs-Index ──────────────────────────────────────────────────────────────
const byId = new Map(CLAIMS.map((c) => [c.id, c]));

/** Liefert den exakten Claim-Text (wirft bei unbekannter id — Projektions-
 *  Fehler sollen laut beim Import knallen, nie still leere Blöcke bauen). */
function t(id) {
  const c = byId.get(id);
  if (!c) throw new Error(`claims.js: unbekannte Claim-id '${id}'`);
  return c.text;
}

// ── PROJEKTION 1: Eigenheiten-Blöcke je Tool (Spec §1.1 Block 4) ────────────
// Reihung = P7 Erstkontakt-Salienz (Spec §1.2); Separator ' | ' ist die
// S2-Splitgrenze (Claim-Texte enthalten kein '|'); letzte Position = P5-Zeile.
const ORDER = {
  // Salienz-Auswahl (Spec §1.1: ≤6 + P5; Rest trägt der Quickstart): C-GLO-05
  // (Einheiten) lebt im Quickstart-Stolperstein, nicht im analyze-Block —
  // das 1300-Zeichen-Budget erzwingt die Auswahl, das Register bleibt voll.
  analyze: [
    'C-ANA-E1',
    'C-GLO-01',
    'C-GLO-03',
    'C-GLO-06',
    'C-GLO-04',
    'C-P5-MESS',
  ],
  compare: ['C-GLO-04', 'C-CMP-ERR', 'C-CMP-VOC', 'C-CMP-GRAN', 'C-P5-MESS'],
  bookmark: ['C-GLO-04', 'C-BKM-ERR', 'C-P5-STATE'],
  inspect: ['C-ANA-E1', 'C-INS-CAP', 'C-INS-STRUCT', 'C-GLO-02', 'C-P5-MESS'],
  palette: ['C-GLO-06', 'C-PAL-CAP', 'C-P5-MESS'],
  arrange: ['C-ARR-SEQ', 'C-ARR-TYP', 'C-ARR-PROP', 'C-ARR-P5'],
  constraints: ['C-CON-VOC', 'C-CON-UNK', 'C-P5-VOC'],
  status: ['C-STA-CAL', 'C-STA-LAST', 'C-P5-META'],
  selftest: ['C-SEL-ANTI', 'C-P5-META'],
};

export const EIGENHEITEN_MARKER = 'Eigenheiten (verifiziert): ';

export const EIGENHEITEN = Object.fromEntries(
  Object.entries(ORDER).map(([tool, ids]) => [
    tool,
    EIGENHEITEN_MARKER + ids.map(t).join(' | '),
  ]),
);

// ── PROJEKTION 1b: vollständige Descriptions (Spec §1.1, P2/S1b Ein-Leib) ───
// Die NICHT-Eigenheiten-Blöcke (1 Orientierung · 2 Input-Grammatik ·
// 3 Output-Kernfelder · 5 Next step) wohnen HIER im Register — tools.js
// konsumiert nur noch DESCRIPTIONS und trägt keinen Freitext mehr. Jede
// Freitext-Mutation außerhalb des Registers macht der Selftest S1b rot
// (Wortidentitäts-Pin Auslieferung == Register-Projektion). Block 3 von
// analyze IST ein Claim (C-ANA-OUT, probe-gepinnt — P6: analysisId wohnt
// unter iteration, nicht top-level).
const BLOCKS = {
  analyze: {
    orientierung:
      'Analyzes an SVG against spatial constraints, returns a Spotter-Report.',
    input:
      'Input: SVG + Constraints "#subject TYPE #reference [value]", z.B. "#logo CENTERED-IN #frame"; Typen: vector_mirror_constraints; previousIssueCount → Konvergenz.',
    output: t('C-ANA-OUT'),
    next: 'Next step: fix per corrections, then analyze until PASS.',
  },
  compare: {
    orientierung:
      'Compares an SVG with a stored baseline and reports what changed.',
    input:
      'Input: SVG + analysisId (UUID aus analyze) ODER Bookmark-Name; optionale constraints für Re-Check.',
    output: 'Output: analyzeOutput-Form mit diff.',
    next: 'Next step: review diff, adjust SVG, then analyze or compare again.',
  },
  bookmark: {
    orientierung:
      'Saves a previous analyze result as a named baseline for the Sniper-Loop: pin a state, edit the SVG, then compare against the name instead of the UUID.',
    input: 'Input: name (kein UUID-Format) + analysisId (UUID aus analyze).',
    output: 'Output: name, analysisId, stored, bookmarkCount.',
    next: 'Next step: compare(svg, [], name) against this baseline.',
  },
  inspect: {
    orientierung:
      'Inspects an SVG and returns element positions, sizes, colors and grid mapping without checking constraints.',
    input: 'Input: SVG string.',
    output:
      'Output: scene mit id, tag, Grid-Zelle (Ortssprache, z.B. C4), color je Element.',
    next: 'Next step: define constraints based on the layout, then call analyze.',
  },
  palette: {
    orientierung:
      'Extracts fill and stroke colors from all SVG elements — review the color scheme before applying COLOR constraints.',
    input: 'Input: SVG string.',
    output: 'Output: colors [{id, fill, stroke}].',
    next: 'Next step: use COLOR constraints in analyze to enforce specific colors.',
  },
  arrange: {
    orientierung:
      'Computes SVG attributes (x, y, width, height, cx, cy) from canvas dimensions, element definitions, and spatial constraints — layout from scratch, no browser.',
    input:
      'Input: canvas {width, height}, elements [{id, tag, r?, width?, height?, content?}], constraints (string[]).',
    output:
      'Output: attributes per element (ready to apply to SVG) + warnings.',
    next: 'Next step: use the returned attributes to construct or update the SVG, then call analyze to verify.',
  },
  constraints: {
    orientierung:
      'Lists all available constraint types with their syntax and capabilities.',
    input: 'Input: none.',
    output: 'Output: types [{type, syntax, hasArrange}].',
    next: 'Next step: use the constraint syntax in vector_mirror_analyze.',
  },
  status: {
    orientierung: 'Returns Vector Mirror server health.',
    input: 'Input: none.',
    output:
      'Output: version, browser (running/stopped), lastAnalysis, constraintTypes, breaker, calibration.',
    next: 'Next step: if browser is stopped, any analyze/inspect/palette call will auto-start it.',
  },
  selftest: {
    orientierung:
      'Runs the 5 calibration fixtures (EK-1 color, EK-2 grid, EK-3 constraint, EK-4 3D-suppression, EK-5 frozen animation) and verifies Vector Mirror against the spec-derived truth.',
    input:
      'Input: optional full (boolean) — adds an N=10 mini determinism check.',
    output: 'Output: status (PASS/FAIL), calibrated, total, failures.',
    next: 'Next step: PASS = trust the measurements; FAIL = fix per failures, then re-run.',
  },
};

/** Die EINE komponierte Auslieferungs-Form je Tool (5-Block-Reihenfolge,
 *  Budget je Description ≤1300 Zeichen — S1b wacht numerisch). */
export const DESCRIPTIONS = Object.fromEntries(
  Object.entries(BLOCKS).map(([tool, b]) => [
    tool,
    `${b.orientierung} ${b.input} ${b.output} ${EIGENHEITEN[tool]} ${b.next}`,
  ]),
);

// ── PROJEKTION 2: instructions-Quickstart (Spec §4, ≤2500 Z. / ≤35 Zeilen) ──
// Vollständig aus dem Register projiziert; G4–G6 erscheinen als Stolperstein-
// Zeilen (eine Wahrheit, ein Ort — die Glossar-Zeile verweist statt zu kopieren).
export const QUICKSTART = [
  'VECTOR MIRROR — QUICKSTART',
  t('C-QS-ORI'),
  `WORKFLOW: ${t('C-QS-WORKFLOW')}`,
  `GRAMMATIK: ${t('C-QS-GRAMMAR')}`,
  'STOLPERSTEINE (verifiziert):',
  `- ${t('C-ANA-E1')}`,
  `- ${t('C-GLO-06')}`,
  `- ${t('C-GLO-04')}`,
  `- ${t('C-GLO-05')}`,
  'GLOSSAR:',
  `- suppressed: ${t('C-GLO-01')}`,
  `- canvas_validity: ${t('C-GLO-02')}`,
  `- PARTIAL: ${t('C-GLO-03')}`,
  '- analysisId/Bookmarks, Farb-Granularität, Einheiten: siehe Stolpersteine 3, 2, 4.',
  `STOP-CONDITION: ${t('C-QS-STOP')}`,
].join('\n');
