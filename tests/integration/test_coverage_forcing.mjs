/**
 * test_coverage_forcing.mjs — DoD-6 Forcing-Tests (Spec Bau-Teil 3): erzwingt das
 * ERSCHEINEN der bisher ungetesteten / nur-stub-getesteten Nenner-Signale mit
 * ECHTEN Auslöser-Inputs durch die echte Pipeline (analyze()) bzw. den echten
 * Adapter (resolve()) — KEIN Stub (test_breaker-Klasse), kein Fake.
 *
 * HONEST-RED-FÄHIGKEIT (Beweis-Pflicht 2): jeder Assert prüft die PRÄSENZ des
 * Signals. Stirbt die Emissions-Stelle im Code (Mutations-Stichprobe via
 * scripts/coverage_mutation_probe.mjs), wird der jeweilige Assert rot — keine
 * Absenz-Logik, keine exit-only-Wahrheit.
 *
 * Empirisch verifizierte Auslöser (Probe-Lauf 2026-06-10, ephemer /tmp):
 *   MULTIPLE_PAINT_SOURCES   fill+stroke beide sichtbar           (pw:4583)
 *   STATE_DETECTION_COARSE   @namespace + [ns|attr]:hover → qSA wirft,
 *                            Salvage leer ⇒ Stufe-3-flag-all      (pw:4591)
 *   EMPTY_SVG                width=0 height=0                     (pw:925)
 *   SVG_TOO_LARGE            >100KB (MAX_SVG_BYTES=102400)        (pw:642)
 *   TOO_MANY_ELEMENTS        >500 Quell-DOM-Knoten                (pw:2857)
 *   INVALID_INPUT            leerer String                        (pw:627)
 *   NO_SVG_FOUND             Markup ohne <svg>                    (pw:891)
 *   LOAD_FAILED              resolve() bei nicht-initialisiertem Renderer
 *                            (pw:766ff — echter Code-Pfad, kein Stub; via
 *                            analyze() nicht erzwingbar: auto-init. Der
 *                            setContent-Timeout-Pfad pw:869 bleibt defensive
 *                            Tiefe, empirisch nicht billig erzwingbar — use-Bombs
 *                            fängt die statische Schranke als SECURITY_VIOLATION.)
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatReport } from '../../src/adapters/emitter/prose.js';
import { resolve } from '../../src/adapters/renderer/playwright.js';
import { arrangeTool } from '../../src/interface/tools.js';
import { analyze, bookmark, BOOKMARK_UNKNOWN_HINT, compare, init, NO_BASELINE_HINT, shutdown } from '../../src/pipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const VB = 'viewBox="0 0 120 120" width="120" height="120"';
const VALID_SVG = `<svg ${VB}><rect id="t" x="10" y="10" width="60" height="60" fill="red"/></svg>`;

let passed = 0;
let failed = 0;
function ok(cond, label, detail) {
  if (cond) {
    passed++;
    console.log(`  PASS: ${label}`);
  } else {
    failed++;
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const els = (r) => r.structured?.scene?.elements ?? [];
const byId = (list, id) => list.find((e) => e.id === id);
const hasWarn = (e, w) => Array.isArray(e?.warnings) && e.warnings.includes(w);

async function main() {
  // ── LOAD_FAILED (pw:766ff) — VOR init(): Renderer nicht initialisiert ───────
  // Erzwingt ERSCHEINEN: resolve() liefert error:'LOAD_FAILED' auf dem echten
  // Guard-Pfad. Stirbt die Emission, ist r.error undefined/anders → rot.
  console.log('=== F-LOAD_FAILED: resolve() vor init ⇒ LOAD_FAILED erscheint ===');
  {
    const r = await resolve(null, VALID_SVG);
    ok(r?.error === 'LOAD_FAILED', 'LOAD_FAILED erscheint (Renderer nicht initialisiert)', `got ${JSON.stringify(r?.error)}`);
    ok(typeof r?.message === 'string' && r.message.includes('nicht initialisiert'), 'LOAD_FAILED trägt ehrliche message', JSON.stringify(r?.message));
  }

  await init();
  try {
    // ── MULTIPLE_PAINT_SOURCES (pw:4583) — fill UND stroke malen sichtbar ─────
    console.log('\n=== F-MULTIPLE_PAINT_SOURCES: fill+stroke sichtbar ⇒ Warning erscheint ===');
    {
      const r = await analyze(`<svg ${VB}><rect id="t" x="10" y="10" width="60" height="60" fill="red" stroke="blue" stroke-width="6"/></svg>`, []);
      const t = byId(els(r), 't');
      ok(!!t, 'Element #t EMITTIERT', `ids=${JSON.stringify(els(r).map((e) => e.id))}`);
      ok(hasWarn(t, 'MULTIPLE_PAINT_SOURCES'), 'MULTIPLE_PAINT_SOURCES erscheint (n>1 Tinten-Quellen gemessen, kein Urteil)', `warnings=${JSON.stringify(t?.warnings)}`);
      // Negativ-Kontrolle (Anti-Über-Flag): reines fill-Element trägt die Warning NICHT.
      const r2 = await analyze(VALID_SVG, []);
      ok(!hasWarn(byId(els(r2), 't'), 'MULTIPLE_PAINT_SOURCES'), 'Negativ: fill-only trägt KEINE MULTIPLE_PAINT_SOURCES', `warnings=${JSON.stringify(byId(els(r2), 't')?.warnings)}`);
    }

    // ── STATE_DETECTION_COARSE (pw:4591) — Stufe-3-Fallback POSITIV ───────────
    // Auslöser (Code gelesen + empirisch bestätigt): interaktiv-tragender
    // Selektor, dessen gestrippte Form in querySelectorAll WIRFT ([m|k] —
    // Namespace-Attribut-Selektor, CSS-parsebar via @namespace, qSA-unsupported)
    // UND ohne salvagebare #id/.class/Tag-Sub-Selektoren ⇒ flag-all + COARSE.
    console.log('\n=== F-STATE_DETECTION_COARSE: werfender [ns|attr]:hover ⇒ COARSE erscheint ===');
    {
      const r = await analyze(`<svg ${VB}><style>@namespace m url(http://x.test/m); [m|k]:hover{fill:blue}</style><rect id="t" x="10" y="10" width="60" height="60" fill="red"/></svg>`, []);
      const t = byId(els(r), 't');
      ok(!!t, 'Element #t EMITTIERT', `ids=${JSON.stringify(els(r).map((e) => e.id))}`);
      ok(hasWarn(t, 'STATE_DETECTION_COARSE'), 'STATE_DETECTION_COARSE erscheint (grobes flag-all ehrlich gemeldet)', `warnings=${JSON.stringify(t?.warnings)}`);
      ok(t?.state_dependent === true && hasWarn(t, 'STATE_DEPENDENT'), 'Stufe-3 flaggt zugleich state_dependent (NIE-0-Garantie)', `sd=${JSON.stringify(t?.state_dependent)} warnings=${JSON.stringify(t?.warnings)}`);
    }

    // ── Die 6 Error-Codes ECHT via analyze() + Code-Ebene via resolve() ───────
    // analyze() konsumiert resolved.error → 'Fehler: <message>'-Prosa (pl:buildErrorResult);
    // der CODE selbst erscheint am Adapter-Rand. Beide Ebenen gepinnt: stirbt die
    // Emission ODER die ehrliche Fehler-Prosa, wird einer der Asserts rot.
    console.log('\n=== F-EMPTY_SVG: width=0 height=0 ⇒ EMPTY_SVG erscheint ===');
    {
      const svg = `<svg width="0" height="0"><rect x="0" y="0" width="10" height="10" fill="red"/></svg>`;
      const a = await analyze(svg, []);
      const d = await resolve(null, svg);
      ok(d?.error === 'EMPTY_SVG', 'EMPTY_SVG erscheint (resolve-Code)', `got ${JSON.stringify(d?.error)}`);
      ok(typeof a?.prose === 'string' && a.prose.includes('Fehler:') && a.prose.includes('keine sichtbaren Abmessungen'), 'analyze() meldet den EMPTY_SVG-Pfad laut (Prosa)', JSON.stringify(a?.prose));
    }

    console.log('\n=== F-SVG_TOO_LARGE: >100KB ⇒ SVG_TOO_LARGE erscheint ===');
    {
      const svg = `<svg ${VB}><rect x="1" y="1" width="9" height="9" fill="red"/><desc>${'x'.repeat(103000)}</desc></svg>`;
      const a = await analyze(svg, []);
      const d = await resolve(null, svg);
      ok(d?.error === 'SVG_TOO_LARGE', 'SVG_TOO_LARGE erscheint (resolve-Code)', `got ${JSON.stringify(d?.error)}`);
      ok(typeof a?.prose === 'string' && a.prose.includes('Fehler:') && a.prose.includes('100KB'), 'analyze() meldet den SVG_TOO_LARGE-Pfad laut (Prosa)', JSON.stringify(a?.prose));
    }

    console.log('\n=== F-TOO_MANY_ELEMENTS: 510 Quell-Knoten ⇒ TOO_MANY_ELEMENTS erscheint ===');
    {
      const rects = Array.from({ length: 510 }, (_, i) => `<rect x="${i % 50}" y="${Math.floor(i / 50)}" width="1" height="1" fill="red"/>`).join('');
      const svg = `<svg ${VB}>${rects}</svg>`;
      const a = await analyze(svg, []);
      const d = await resolve(null, svg);
      ok(d?.error === 'TOO_MANY_ELEMENTS', 'TOO_MANY_ELEMENTS erscheint (resolve-Code)', `got ${JSON.stringify(d?.error)}`);
      ok(typeof a?.prose === 'string' && a.prose.includes('Fehler:') && a.prose.includes('max 500'), 'analyze() meldet den TOO_MANY_ELEMENTS-Pfad laut (Prosa)', JSON.stringify(a?.prose));
    }

    console.log('\n=== F-INVALID_INPUT: leerer String ⇒ INVALID_INPUT erscheint ===');
    {
      const a = await analyze('', []);
      const d = await resolve(null, '');
      ok(d?.error === 'INVALID_INPUT', 'INVALID_INPUT erscheint (resolve-Code)', `got ${JSON.stringify(d?.error)}`);
      ok(typeof a?.prose === 'string' && a.prose.includes('Fehler:') && a.prose.includes('leer oder ungültig'), 'analyze() meldet den INVALID_INPUT-Pfad laut (Prosa)', JSON.stringify(a?.prose));
    }

    console.log('\n=== F-NO_SVG_FOUND: Markup ohne <svg> ⇒ NO_SVG_FOUND erscheint ===');
    {
      const input = '<div>kein svg hier</div>';
      const a = await analyze(input, []);
      const d = await resolve(null, input);
      ok(d?.error === 'NO_SVG_FOUND', 'NO_SVG_FOUND erscheint (resolve-Code)', `got ${JSON.stringify(d?.error)}`);
      ok(typeof a?.prose === 'string' && a.prose.includes('Fehler:') && a.prose.includes('Kein SVG-Element gefunden'), 'analyze() meldet den NO_SVG_FOUND-Pfad laut (Prosa)', JSON.stringify(a?.prose));
    }

    // ── §HEAL-7/A — canvas_validity:'degenerate' (F-TF-002): Müll-viewBox ──────
    // Boden-Wahrheit an internal ground-truth probe: ein
    // unparsebares/negativ-NaN-viewBox lieferte canvas_validity:'valid' auf
    // einem fabrizierten 300×150-Canvas (tote Nenner-Signale). Forcing: der
    // Renderer-Produzent (playwright.js) setzt viewBoxValidity, classifyCanvas
    // klassifiziert — das Signal MUSS e2e am structured erscheinen.
    console.log("\n=== F-canvas_validity:'degenerate': Müll-viewBox ⇒ 'degenerate' erscheint ===");
    {
      const rGarbage = await analyze(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="abc def"><rect id="b" x="10" y="10" width="50" height="30" fill="blue"/></svg>`, []);
      ok(rGarbage.structured?.scene?.canvas_validity === 'degenerate', "Parse-Müll-viewBox ('abc def') ⇒ canvas_validity 'degenerate'", `got ${JSON.stringify(rGarbage.structured?.scene?.canvas_validity)}`);
      const rNegNaN = await analyze(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 -5 NaN"><rect id="b" x="10" y="10" width="50" height="30" fill="blue"/></svg>`, []);
      ok(rNegNaN.structured?.scene?.canvas_validity === 'degenerate', "negativ/NaN-viewBox ('0 0 -5 NaN') ⇒ canvas_validity 'degenerate'", `got ${JSON.stringify(rNegNaN.structured?.scene?.canvas_validity)}`);
      const rZero = await analyze(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 0"><rect id="b" x="10" y="10" width="50" height="30" fill="blue"/></svg>`, []);
      ok(rZero.structured?.scene?.canvas_validity === 'degenerate', "zero-viewBox ('0 0 0 0') ⇒ canvas_validity 'degenerate'", `got ${JSON.stringify(rZero.structured?.scene?.canvas_validity)}`);
      // Negativ-Kontrolle (Anti-Über-Flag): valides viewBox bleibt 'valid';
      // negative min-x/min-y sind SPEC-VALIDE (nur w/h müssen >0 sein).
      const rValid = await analyze(VALID_SVG, []);
      ok(rValid.structured?.scene?.canvas_validity === 'valid', "Negativ: valides viewBox bleibt 'valid'", `got ${JSON.stringify(rValid.structured?.scene?.canvas_validity)}`);
      const rNegMin = await analyze(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-40 -5 100 100"><rect id="b" x="10" y="10" width="50" height="30" fill="blue"/></svg>`, []);
      ok(rNegMin.structured?.scene?.canvas_validity === 'valid', "Negativ: viewBox mit negativem min-x/min-y bleibt 'valid'", `got ${JSON.stringify(rNegMin.structured?.scene?.canvas_validity)}`);
    }

    // ── §HEAL-7/A — canvas_validity:'default_replaced' (F-TF-002 Fall C) ───────
    console.log("\n=== F-canvas_validity:'default_replaced': dimensionsloses SVG ⇒ 'default_replaced' erscheint ===");
    {
      const r = await analyze(`<svg xmlns="http://www.w3.org/2000/svg"><rect id="b" x="10" y="10" width="50" height="30" fill="blue"/></svg>`, []);
      ok(r.structured?.scene?.canvas_validity === 'default_replaced', "keine viewBox + keine width/height ⇒ canvas_validity 'default_replaced'", `got ${JSON.stringify(r.structured?.scene?.canvas_validity)}`);
      ok(r.structured?.scene?.width === 300 && r.structured?.scene?.height === 150, 'CSS-Default-Canvas 300×150 (Boden-Wahrheit f002 gt_C)', `got ${r.structured?.scene?.width}×${r.structured?.scene?.height}`);
      // Negativ-Kontrolle: width/height-Attribute OHNE viewBox sind Autor-Intent ⇒ 'valid'.
      const rWh = await analyze(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect id="b" x="10" y="10" width="50" height="30" fill="blue"/></svg>`, []);
      ok(rWh.structured?.scene?.canvas_validity === 'valid', "Negativ: width/height-Attribute ohne viewBox bleiben 'valid'", `got ${JSON.stringify(rWh.structured?.scene?.canvas_validity)}`);
    }

    // ── §HEAL-7/B — Duplikat-ID-Ehrlichkeit (F-TF-003): MEASUREMENT_AMBIGUOUS ──
    // Boden-Wahrheit f003: 2× id='x' ⇒ first-match-Messung, Korrektur dy=2470
    // an BEIDE Namensvettern geheftet, 0 Warnungen. Forcing: ambiges subject/
    // ref (count>1) ⇒ pass:null + MEASUREMENT_AMBIGUOUS + 0 corrections.
    console.log('\n=== F-MEASUREMENT_AMBIGUOUS (dup-id): Messung verweigert, 0 corrections ===');
    {
      const DUP = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100" width="300" height="100">' +
        '<rect id="anchor" x="10" y="10" width="20" height="20" fill="green"/>' +
        '<rect id="x" x="10" y="60" width="20" height="20" fill="blue"/>' +
        '<rect id="x" x="200" y="60" width="20" height="20" fill="red"/>' +
        '</svg>';
      const r = await analyze(DUP, ['#x DISTANCE-FROM #anchor 50']);
      const s = r.structured;
      ok((s?.corrections || []).length === 0, 'dup-SUBJECT: KEINE corrections (Messung verweigert, keine Korrektur)', `corrections=${JSON.stringify(s?.corrections)}`);
      const u = (s?.unchecked || [])[0];
      ok(u?.reasonCode === 'MEASUREMENT_AMBIGUOUS', 'dup-SUBJECT: reasonCode MEASUREMENT_AMBIGUOUS erscheint (D-004: echte Ambiguität)', `unchecked=${JSON.stringify(s?.unchecked)}`);
      ok(typeof u?.hint === 'string' && u.hint.includes("id 'x' ist 2-fach") && u.hint.includes('Messung verweigert'), 'dup-SUBJECT: detail nennt N-fach + Verweigerung', JSON.stringify(u?.hint));
      ok(s?.status === 'PARTIAL', 'dup-SUBJECT: status PARTIAL (ungeprüft, kein erfundenes FAIL/PASS)', `got ${JSON.stringify(s?.status)}`);
      // Prosa: kein Pixel-Hinweis an irgendeinem Namensvetter.
      const xLines = (r.prose || '').split('\n').filter((l) => l.includes('#x'));
      ok(xLines.length >= 2 && xLines.every((l) => !/d[xywh]=/.test(l) && !l.includes('✗')), 'dup-SUBJECT: Prosa heftet KEINE Korrektur/✗ an Namensvettern', JSON.stringify(xLines));
      // Ambige REFERENZ ⇒ ebenfalls verweigern.
      const r2 = await analyze(DUP, ['#anchor DISTANCE-FROM #x 50']);
      ok((r2.structured?.corrections || []).length === 0 && r2.structured?.unchecked?.[0]?.reasonCode === 'MEASUREMENT_AMBIGUOUS', 'dup-REFERENCE: ebenfalls MEASUREMENT_AMBIGUOUS + 0 corrections', JSON.stringify({ c: r2.structured?.corrections, u: r2.structured?.unchecked }));
      // Negativ-Kontrolle: eindeutige ids bleiben voll messbar (echtes FAIL + Korrektur).
      const UNIQ = DUP.replace('id="x" x="200"', 'id="y" x="200"');
      const r3 = await analyze(UNIQ, ['#x DISTANCE-FROM #anchor 50']);
      ok(r3.structured?.status === 'FAIL' && (r3.structured?.corrections || []).length === 1, 'Negativ: eindeutige id ⇒ Messung + Korrektur unverändert', JSON.stringify({ st: r3.structured?.status, c: r3.structured?.corrections?.length }));
    }

    // ── §H10 R11-01 Existenz-Register: hidden_elements + SUBJECT_HIDDEN ───────
    console.log('\n=== F-SUBJECT_HIDDEN / hidden_elements: css-verstecktes Element erscheint im Register ===');
    {
      const HID = `<svg ${VB}><rect id="v" x="10" y="10" width="20" height="20" fill="red"/>` +
        '<rect id="h" x="60" y="60" width="20" height="20" fill="blue" display="none"/></svg>';
      const r = await analyze(HID, ['#h INSIDE #v']);
      const hiddenList = r.structured?.scene?.hidden_elements;
      ok(Array.isArray(hiddenList) && hiddenList.some((e) => e.id === 'h' && e.axis === 'display:none'), 'hidden_elements erscheint (id+Achse, Emissions-Menge byte-stabil)', JSON.stringify(hiddenList));
      const u = (r.structured?.unchecked || [])[0];
      ok(u?.reasonCode === 'SUBJECT_HIDDEN', 'SUBJECT_HIDDEN erscheint (MODEL, statt SPECIFICATION-Schuld SUBJECT_NOT_FOUND)', JSON.stringify(r.structured?.unchecked));
      ok((r.prose || '').includes('css-unsichtbar'), 'Prosa-Parität: css-unsichtbar-Zeile erscheint', JSON.stringify((r.prose || '').split('\n').filter((l) => l.includes('css-unsichtbar'))));
      // Negativ-Kontrolle (Anti-Über-Flag): ohne Hidden-Elemente fehlt das Feld.
      const r2 = await analyze(VALID_SVG, []);
      ok(r2.structured?.scene?.hidden_elements === undefined, 'Negativ: ohne Hidden-Elemente KEIN hidden_elements-Feld (optional-by-default)', JSON.stringify(r2.structured?.scene?.hidden_elements));
      // §H10 P1 (Symmetrie): css-versteckte REFERENZ ⇒ REFERENCE_HIDDEN (MODEL),
      // nicht die Existenz-Lüge REFERENCE_NOT_FOUND (empirisch bewiesen vorher).
      const rRef = await analyze(HID, ['#v INSIDE #h']);
      const uRef = (rRef.structured?.unchecked || [])[0];
      ok(uRef?.reasonCode === 'REFERENCE_HIDDEN', 'REFERENCE_HIDDEN erscheint (Symmetrie: versteckte Referenz ≠ nicht existent)', JSON.stringify(rRef.structured?.unchecked));
      ok(typeof uRef?.hint === 'string' && uRef.hint.includes('display:none') && uRef.hint.includes('Sichtbarkeit herstellen'), 'REFERENCE_HIDDEN-hint trägt Achse + Navigation', JSON.stringify(uRef?.hint));
      // Negativ-Kontrolle: wirklich fehlende Referenz bleibt REFERENCE_NOT_FOUND.
      const rMiss = await analyze(VALID_SVG, ['#t INSIDE #phantom']);
      ok(rMiss.structured?.unchecked?.[0]?.reasonCode === 'REFERENCE_NOT_FOUND', 'Negativ: nicht-existente Referenz bleibt REFERENCE_NOT_FOUND', JSON.stringify(rMiss.structured?.unchecked));
    }

    // ── §H10 R11-06 Paint-Zeit-Achse: paint_time_variant + PAINT_TIME_VARIANT ─
    console.log('\n=== F-PAINT_TIME_VARIANT: SMIL-opacity-Blinker ⇒ Flag+Warning+COLOR-Degradation ===');
    {
      const BLINK = `<svg ${VB}><rect id="frame" x="5" y="5" width="90" height="90" fill="none" stroke="#111"/>` +
        '<rect id="blink" x="20" y="20" width="24" height="24" fill="blue"><animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite"/></rect></svg>';
      const r = await analyze(BLINK, ['#blink COLOR blue', '#blink INSIDE #frame']);
      const blink = byId(els(r), 'blink');
      ok(blink?.paint_time_variant === true, 'paint_time_variant erscheint (true-only-Flag)', JSON.stringify(blink));
      ok(hasWarn(blink, 'PAINT_TIME_VARIANT'), 'PAINT_TIME_VARIANT-Warning erscheint (Warning-Invariante)', JSON.stringify(blink?.warnings));
      const codes = (r.structured?.unchecked || []).map((u) => `${u.constraint}:${u.reasonCode}`);
      ok(codes.includes('COLOR:SUBJECT_TIME_VARIANT'), 'COLOR-Verdikt degradiert (SUBJECT_TIME_VARIANT, paint-Rider)', JSON.stringify(r.structured?.unchecked));
      ok(r.structured?.status === 'PARTIAL' && codes.length === 1, 'INSIDE bleibt PASS (Geometrie zeitinvariant — messbare Wahrheit bleibt Aussage)', JSON.stringify({ status: r.structured?.status, codes }));
      // Negativ-Kontrolle: Geometrie-SMIL bleibt MOTION_DEPENDENT, ohne Paint-Flag.
      const GEOM = `<svg ${VB}><rect id="geo" x="20" y="20" width="24" height="24" fill="red"><animate attributeName="x" values="20;90" dur="1s" repeatCount="indefinite"/></rect></svg>`;
      const r2 = await analyze(GEOM, []);
      const geo = byId(els(r2), 'geo');
      ok(geo?.motion_dependent === true && geo?.paint_time_variant === undefined, 'Negativ: Geometrie-SMIL traegt motion_dependent, KEIN paint_time_variant', JSON.stringify(geo));
      // §H10 P3 Taxonomie-Pins: class routet KONSERVATIV ins Geom-Set (eine
      // animierte class KANN Geometrie tragen — CSS width auf <rect>, bewiesener
      // Leak: INSIDE-PASS auf instabiler bbox wäre die Halbwahrheit) …
      const CLS = `<svg ${VB}><style>.big{width:90px}</style><rect id="cls" x="20" y="20" width="24" height="24" fill="red"><set attributeName="class" to="big" begin="0s"/></rect></svg>`;
      const r3 = await analyze(CLS, []);
      const cls = byId(els(r3), 'cls');
      ok(cls?.motion_dependent === true && cls?.paint_time_variant === undefined, 'class-SMIL routet ins Geom-Set (motion_dependent, KEIN paint_time_variant)', JSON.stringify(cls));
      // … stroke-width bleibt Paint (Judgment-Call am Set dokumentiert:
      // getBBox exkludiert den Stroke — die Verdikt-Geometrie ist zeitinvariant).
      const SW = `<svg ${VB}><rect id="sw" x="20" y="20" width="24" height="24" fill="none" stroke="red" stroke-width="2"><animate attributeName="stroke-width" values="2;10;2" dur="1s" repeatCount="indefinite"/></rect></svg>`;
      const r4 = await analyze(SW, []);
      const sw = byId(els(r4), 'sw');
      ok(sw?.paint_time_variant === true && sw?.motion_dependent === undefined, 'stroke-width-SMIL bleibt Paint (paint_time_variant, KEIN motion_dependent)', JSON.stringify(sw));
    }

    // ── §H10 R11-07 dritte Wache-Klasse: SUBJECT_NOT_MEASURABLE ───────────────
    console.log('\n=== F-SUBJECT_NOT_MEASURABLE: not_measurable-Subjekt ⇒ kein blankes PASS ===');
    {
      const M3D = `<svg ${VB}><rect id="frame" x="5" y="5" width="90" height="90" fill="none" stroke="#111"/>` +
        '<rect id="three" x="20" y="20" width="24" height="24" fill="green" style="transform: matrix3d(1,0,0,0.001, 0,1,0,0, 0,0,1,0, 0,0,0,1); transform-origin: 0 0;"/></svg>';
      const r = await analyze(M3D, ['#three INSIDE #frame']);
      const u = (r.structured?.unchecked || [])[0];
      ok(u?.reasonCode === 'SUBJECT_NOT_MEASURABLE', 'SUBJECT_NOT_MEASURABLE erscheint (Verdikt-Wache, MODEL)', JSON.stringify(r.structured?.unchecked));
      ok(r.structured?.status === 'PARTIAL', 'status PARTIAL (kein gruenes Verdikt ueber misstrauter bbox)', JSON.stringify(r.structured?.status));
      ok(typeof u?.hint === 'string' && u.hint.includes('not_measurable'), 'hint nennt Ursache (not_measurable + Warnung)', JSON.stringify(u?.hint));
    }

    // ── §6 RELAIS Fehler-Kanal — die 3 neuen error{code,hint}-Codes ───────────
    // (an internal spec §6; Nenner: NO_BASELINE / ANALYSIS_NOT_FOUND /
    // ARRANGE_FAILED). Forcing = ERSCHEINEN des Codes an der Quelle +
    // Prosa-Parity (prose enthält error.hint wortidentisch). MCP-Rand-Beleg
    // zusätzlich: tests/relais_red/probe_mcp_errorchannel.mjs.
    console.log('\n=== F-NO_BASELINE: compare ohne Baseline ⇒ error{code,hint} erscheint ===');
    {
      const r = await compare(VALID_SVG, [], '00000000-0000-4000-8000-000000000000');
      ok(r.structured?.error?.code === 'NO_BASELINE', 'NO_BASELINE erscheint (structured.error.code)', `got ${JSON.stringify(r.structured?.error)}`);
      ok(r.structured?.error?.hint === NO_BASELINE_HINT && r.prose.includes(r.structured?.error?.hint), 'Parity: prose enthält error.hint wortidentisch (eine Quelle: NO_BASELINE_HINT)', JSON.stringify(r.prose));
    }

    console.log('\n=== F-ANALYSIS_NOT_FOUND: bookmark mit unbekannter analysisId ⇒ error{code,hint} erscheint ===');
    {
      const r = bookmark('phantom-baseline', '00000000-0000-4000-8000-000000000000');
      ok(r.error?.code === 'ANALYSIS_NOT_FOUND', 'ANALYSIS_NOT_FOUND erscheint (result.error.code)', `got ${JSON.stringify(r.error)}`);
      ok(r.error?.hint === BOOKMARK_UNKNOWN_HINT && r.prose.includes(r.error.hint), 'Parity: prose enthält error.hint wortidentisch (eine Quelle: BOOKMARK_UNKNOWN_HINT)', JSON.stringify(r.prose));
    }

    console.log('\n=== F-ARRANGE_FAILED: arrange-Handler-Throw ⇒ error{code,hint} erscheint ===');
    {
      // elements:null wirft in pipeline.arrange (for..of) — der Handler-Catch
      // (tools.js) ist der echte isError-Pfad; via MCP-Schema kaum erreichbar,
      // im Code existent (A3: real, im Code verifiziert).
      const r = await arrangeTool.handler({ canvas: { width: 100, height: 100 }, elements: null, constraints: [] });
      ok(r.isError === true && r.structuredContent?.error?.code === 'ARRANGE_FAILED', 'ARRANGE_FAILED erscheint (structuredContent.error.code, isError:true)', `got ${JSON.stringify(r.structuredContent?.error)}`);
      ok(typeof r.structuredContent?.error?.hint === 'string' && r.content?.[0]?.text.includes(r.structuredContent.error.hint), 'Parity: prose enthält error.hint wortidentisch', JSON.stringify(r.content?.[0]?.text));
    }
  } finally {
    await shutdown();
  }

  // ── §HEAL-7/B Beweis-Pflicht 2 — prose-Attribution per OBJEKT-IDENTITÄT ──────
  // Zweite Verteidigungslinie (browserfrei, formatReport direkt): selbst WENN
  // ein failing-issue mit Duplikat-id den Formatter erreicht (Pipeline-Wache
  // umgangen), erscheint der Korrektur-Hinweis + ✗ NUR am GEMESSENEN Element
  // (= erstes Objekt der id, .find()-Semantik von checkAllConstraints) — nie
  // am ungemessenen Namensvetter.
  console.log('\n=== F-prose-Attribution: Korrektur NUR am gemessenen Element (Objekt-Identität) ===');
  {
    const gridMap = {
      canvas: { width: 300, height: 100, viewBox: '0 0 300 100' },
      elements: [
        { id: 'x', tag: 'rect', cell: 'A3', direction: 'NW', color: 'blue', opacity: 1 },
        { id: 'x', tag: 'rect', cell: 'E3', direction: 'NW', color: 'red', opacity: 1 },
      ],
    };
    const arbitrated = {
      failing: [{ id: 'x', constraintType: 'DISTANCE-FROM', detail: 'Zu nah dran (30px statt 2500px)', dy: 2470, _gated: true }],
      unchecked: [],
      diff: [],
    };
    const prose = formatReport(gridMap, arbitrated, { canvasValidity: 'valid' });
    const lines = prose.split('\n').filter((l) => l.includes('rect#x'));
    ok(lines.length === 2, 'beide Namensvettern erscheinen im Element-Baum', JSON.stringify(lines));
    ok(/dy=2470px/.test(lines[0] || '') && /✗/.test(lines[0] || ''), 'GEMESSENES Element (1. Objekt der id) trägt Korrektur + ✗', JSON.stringify(lines[0]));
    ok(!/d[xywh]=/.test(lines[1] || '') && !/✗/.test(lines[1] || ''), 'ungemessener Namensvetter trägt KEINE Korrektur, KEIN ✗', JSON.stringify(lines[1]));
  }

  // ── §HEAL-7/D — forcing_test-ROOT-WACHE (Codex Still-Loch) ──────────────────
  // coverage_check.mjs MUSS einen forcing_test außerhalb der Gate-Wurzeln
  // tests/{unit,integration,e2e,audit} (top-level) ROT melden — die Datei
  // existiert + trägt das Token, würde aber NIE gefahren (gate.mjs-Discovery
  // ist nicht-rekursiv auf genau diesen 4 Wurzeln). Probe: manipulierte
  // Nenner-Kopie in os.tmpdir() (COVERAGE_NENNER-Override, hermetisch —
  // kein Repo-Write); der umgebogene Eintrag zeigt auf src/core/arbitrate.js
  // (existiert, enthält 'MEASUREMENT_AMBIGUOUS' ⇒ NUR die Root-Wache kann röten).
  console.log('\n=== F-Root-Wache (D): forcing_test außerhalb tests/{unit,integration,e2e,audit} ⇒ ROT ===');
  {
    const nenner = readFileSync(join(ROOT, 'tests', 'coverage_nenner.yaml'), 'utf8');
    const mutiert = nenner.replace(
      /(- signal: MEASUREMENT_AMBIGUOUS[\s\S]*?forcing_test:) [^\n]+/,
      '$1 src/core/arbitrate.js',
    );
    ok(mutiert !== nenner, 'Probe-Vorbereitung: Nenner-Kopie mutiert (forcing_test → src/core/arbitrate.js)');
    const tmp = mkdtempSync(join(tmpdir(), 'heal7-rootwache-'));
    const tmpNenner = join(tmp, 'nenner.yaml');
    writeFileSync(tmpNenner, mutiert);
    const run = spawnSync('node', [join(ROOT, 'scripts', 'coverage_check.mjs')], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, COVERAGE_NENNER: tmpNenner },
    });
    const out = `${run.stdout || ''}${run.stderr || ''}`;
    ok(run.status !== 0, 'Root-Wache: coverage_check exit != 0 bei forcing_test außerhalb der Wurzeln', `exit=${run.status}`);
    ok(out.includes('Test würde nie gefahren'), "Root-Wache: Klartext 'Test würde nie gefahren' erscheint", out.split('\n').filter((l) => l.includes('✗')).join(' | ').slice(0, 300));
  }

  // ── LOAD_FAILED-Zweitbeleg: auch NACH shutdown() erscheint der Code ─────────
  console.log('\n=== F-LOAD_FAILED-2: resolve() nach shutdown ⇒ LOAD_FAILED erscheint ===');
  {
    const r = await resolve(null, VALID_SVG);
    ok(r?.error === 'LOAD_FAILED', 'LOAD_FAILED erscheint erneut (Renderer abgebaut)', `got ${JSON.stringify(r?.error)}`);
  }

  console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('THREW', e && e.stack ? e.stack : e);
  console.log(`\nErgebnis: ${passed} bestanden, ${failed + 1} fehlgeschlagen`);
  process.exit(1);
});
