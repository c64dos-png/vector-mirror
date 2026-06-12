/**
 * test_heal_r6_sanitize_loss_delivery.mjs — HEAL-R6 / T1 "das Kabel"
 * (F-AT-6-08 Sanitize-Verlust-Lieferung + F-AT-6-05 Error-Pfad-Ehrlichkeit)
 *
 * Real-Chromium-Harness (KEINE Mocks), über die ECHTE Pipeline
 * (analyze → structured.scene.canvas_validity + prose).
 *
 * DIE LÜGE (vor T1): der Adapter erkennt den Verlust schon laut
 * (buildSanitizeLoss → resolved.sanitize_loss = [{tag,reason:'ATTR_STRIPPED:id'}…]),
 * aber der Kanal ist DOWNSTREAM gekappt: classifyCanvas (core/honesty.js) hat 0
 * produktive Aufrufer; sanitize_loss kommt in KEINEM Emitter und NICHT in
 * pipeline.js vor. Der DOMPurify-Clobbering-Schutz strippt id=target/length still,
 * referenzierende Elemente messen dann gegen verlorene Semantik — die
 * LLM-sichtbare Ausgabe meldet "alles korrekt" (eine stille Lüge).
 *
 * ANTI-LECK-3 (KRITISCH): mapToGridMap (core/grid.js) reicht sanitize_loss NICHT
 * an gridMap.canvas durch. classifyCanvas MUSS aus resolved.sanitize_loss DIREKT
 * gespeist werden (pipeline.js, wo resolved vorliegt), NIE aus gridMap.canvas
 * (→ immer undefined → immer 'valid' → eine NEUE stille Lüge).
 *
 * VERTRAG (vier Fälle):
 *   A (Szene laut): clobbering-id-SVG das normal rendert → die LLM-sichtbare
 *     Ausgabe trägt structured.scene.canvas_validity === 'lossy' UND die Prosa
 *     enthält einen lauten Verlust-Hinweis.
 *   B (Error-Pfad / F-AT-6-05): clobbering-id-SVG das gestrippt wird und KEINE
 *     messbaren Elemente übriglässt → Error-Resultat → das Resultat trägt
 *     scene.canvas_validity:'lossy' (NICHT structured:null), Prosa laut.
 *   C (Negativ-Kontrolle / Anti-LECK-3): sauberes SVG ohne Strip →
 *     canvas_validity === 'valid' (das Flag trackt ECHTEN Verlust, nicht hartkodiert).
 *   D (R9-Determinismus): dasselbe lossy-SVG 2× → byte-identisches canvas_validity
 *     + identische sanitize_loss-Reihenfolge.
 *   INVARIANTE: canvas_validity==='lossy' ⇒ sanitize_loss non-empty (kein
 *     lossy-ohne-Verlust).
 *
 * Run direkt: `node tests/integration/test_heal_r6_sanitize_loss_delivery.mjs`
 */
import { analyze, shutdown } from '../../src/pipeline.js';
import { resolve, createResolver, closeResolver } from '../../src/adapters/renderer/playwright.js';

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

// A (laut): clobbering-id (target/length), rendert normal → sanitize_loss non-empty.
const SVG_LOUD = `<svg xmlns="http://www.w3.org/2000/svg"><rect id="target" width="10" height="10" fill="red"/><circle id="length" r="5" fill="blue"/></svg>`;

// B (Error-Pfad): clobbering-id (length) + 0-Größe → NO_ELEMENTS, sanitize_loss non-empty.
const SVG_LOUD_NOELEM = `<svg xmlns="http://www.w3.org/2000/svg"><rect id="length" width="0" height="0" fill="red"/></svg>`;

// C (Negativ-Kontrolle): sauberes SVG, KEIN Strip → sanitize_loss leer.
const SVG_CLEAN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect id="box" x="10" y="10" width="30" height="30" fill="green"/></svg>`;

function statusLine(prose) {
  return (prose || '').split('\n').find((l) => l.startsWith('STATUS:')) || '';
}
// Ein "lauter Verlust-Hinweis" in der Prosa: erwähnt Sanitizer/Semantik/lossy.
function hasLossNote(prose) {
  if (!prose) return false;
  return /Sanitizer|sanitize|Semantik entfernt|lossy/i.test(prose);
}

(async () => {
  try {
    // ── A: Szene laut ──────────────────────────────────────────────────────────
    console.log('=== A: clobbering-id rendert normal → structured.scene.canvas_validity === "lossy" + laute Prosa ===');
    const a = await analyze(SVG_LOUD, []);
    assert('A: structured nicht null (rendert normal)', a.structured != null,
      `structured=${JSON.stringify(a.structured)}`);
    assert('A: scene.canvas_validity === "lossy"',
      a.structured?.scene?.canvas_validity === 'lossy',
      `got ${JSON.stringify(a.structured?.scene?.canvas_validity)}`);
    assert('A: STATUS NICHT "✓ Alles korrekt" (stille Lüge geheilt)',
      !statusLine(a.prose).includes('Alles korrekt'),
      `STATUS="${statusLine(a.prose)}"`);
    assert('A: Prosa trägt lauten Verlust-Hinweis',
      hasLossNote(a.prose),
      `prose=${JSON.stringify(a.prose)}`);

    // ── B: Error-Pfad / F-AT-6-05 ───────────────────────────────────────────────
    console.log('\n=== B: gestrippt + KEINE messbaren Elemente → Error → scene.canvas_validity:"lossy" (NICHT structured:null) ===');
    const b = await analyze(SVG_LOUD_NOELEM, []);
    assert('B: structured NICHT null (Error-Pfad trägt minimales structured)',
      b.structured != null,
      `structured=${JSON.stringify(b.structured)}`);
    assert('B: scene.canvas_validity === "lossy" (Error-Pfad-Ehrlichkeit)',
      b.structured?.scene?.canvas_validity === 'lossy',
      `got ${JSON.stringify(b.structured?.scene?.canvas_validity)}`);
    assert('B: Prosa trägt lauten Verlust-Hinweis',
      hasLossNote(b.prose),
      `prose=${JSON.stringify(b.prose)}`);

    // ── C: Negativ-Kontrolle / Anti-LECK-3 ──────────────────────────────────────
    console.log('\n=== C: sauberes SVG ohne Strip → canvas_validity === "valid" (Flag trackt ECHTEN Verlust) ===');
    const c = await analyze(SVG_CLEAN, []);
    assert('C: structured nicht null', c.structured != null,
      `structured=${JSON.stringify(c.structured)}`);
    assert('C: scene.canvas_validity === "valid"',
      c.structured?.scene?.canvas_validity === 'valid',
      `got ${JSON.stringify(c.structured?.scene?.canvas_validity)}`);
    assert('C: Prosa trägt KEINEN Verlust-Hinweis (kein hartkodiertes lossy)',
      !hasLossNote(c.prose),
      `prose=${JSON.stringify(c.prose)}`);

    // ── D: R9-Determinismus (Pipeline-Pfad) ─────────────────────────────────────
    // WICHTIG: alle Pipeline-Aufrufe (analyze) laufen VOR den Adapter-Direkt-
    // Proben unten — letztere reißen via closeResolver() den geteilten Singleton-
    // Browser ab, den die Pipeline nutzt. Reihenfolge: Pipeline zuerst, Adapter
    // (eigener Lifecycle) zuletzt, direkt vor shutdown().
    console.log('\n=== D: dasselbe lossy-SVG 2× → byte-identisches canvas_validity + structured ===');
    const d1 = await analyze(SVG_LOUD, []);
    const d2 = await analyze(SVG_LOUD, []);
    assert('D: 2× scene.canvas_validity identisch',
      d1.structured?.scene?.canvas_validity === d2.structured?.scene?.canvas_validity &&
        d1.structured?.scene?.canvas_validity === 'lossy',
      `d1=${d1.structured?.scene?.canvas_validity}, d2=${d2.structured?.scene?.canvas_validity}`);
    // Vollständiges structured ohne den volatilen analysisId-Block: byte-identisch.
    const strip = (s) => {
      if (!s) return s;
      const clone = JSON.parse(JSON.stringify(s));
      if (clone.iteration) delete clone.iteration.analysisId;
      return clone;
    };
    assert('D: structured (ohne analysisId) 2× byte-identisch',
      canon(strip(d1.structured)) === canon(strip(d2.structured)),
      `len ${canon(strip(d1.structured)).length} vs ${canon(strip(d2.structured)).length}`);

    // ── INVARIANTE + D-Reihenfolge: Adapter-Direktproben (eigener Lifecycle) ─────
    // closeResolver() reißt den Singleton-Browser ab → DESHALB ganz am Ende, nach
    // allen Pipeline-Aufrufen. createResolver/resolve/closeResolver EINMAL, ein
    // Page-Handle für alle Proben.
    console.log('\n=== INVARIANTE: canvas_validity==="lossy" ⇒ resolved.sanitize_loss non-empty (Adapter-Direkt) ===');
    const probePage = await createResolver();
    const rLoud = await resolve(probePage, SVG_LOUD);
    const rClean = await resolve(probePage, SVG_CLEAN);
    // D-Reihenfolge: 2× resolve byte-identische sanitize_loss-Reihenfolge.
    const s1 = canon((await resolve(probePage, SVG_LOUD)).sanitize_loss);
    const s2 = canon((await resolve(probePage, SVG_LOUD)).sanitize_loss);
    await closeResolver();
    assert('INV: A-SVG resolved.sanitize_loss non-empty',
      Array.isArray(rLoud.sanitize_loss) && rLoud.sanitize_loss.length > 0,
      `got ${JSON.stringify(rLoud.sanitize_loss)}`);
    assert('INV: C-SVG resolved.sanitize_loss leer (kein Verlust)',
      Array.isArray(rClean.sanitize_loss) && rClean.sanitize_loss.length === 0,
      `got ${JSON.stringify(rClean.sanitize_loss)}`);
    // Kopplung: A ist lossy UND hat Verlust; C ist valid UND hat keinen Verlust.
    assert('INV: lossy(A) ⇔ Verlust(A) und valid(C) ⇔ kein-Verlust(C)',
      a.structured?.scene?.canvas_validity === 'lossy' &&
        rLoud.sanitize_loss.length > 0 &&
        c.structured?.scene?.canvas_validity === 'valid' &&
        rClean.sanitize_loss.length === 0,
      `A=${a.structured?.scene?.canvas_validity}/${rLoud.sanitize_loss?.length}, C=${c.structured?.scene?.canvas_validity}/${rClean.sanitize_loss?.length}`);
    assert('D: 2× resolved.sanitize_loss byte-identisch (Reihenfolge stabil)',
      s1 === s2, `s1=${s1}, s2=${s2}`);
  } finally {
    await shutdown();
  }

  console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error('Test-Lauf-Fehler:', e);
  process.exit(1);
});
