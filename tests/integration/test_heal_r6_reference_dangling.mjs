/**
 * test_heal_r6_reference_dangling.mjs — HEAL-R6 / T2 "die Element-Lampe"
 * (F-AT-6-08, Teilschritt 2/2): Render-Zeit-Dangling-Erkennung.
 *
 * Real-Chromium-Harness (KEINE Mocks), über die ECHTE Pipeline (analyze) UND den
 * Adapter direkt (resolve), um sowohl das Element-Warning als auch den
 * sanitize_loss-Eintrag mit id-Wert zu belegen.
 *
 * DIE REST-LÜCKE (nach T1): das Szenen-Flag canvas_validity='lossy' sagt nicht,
 * WELCHES Element divergiert. Wird id=target gestrippt, misst die Gradient-
 * Definition korrekt — aber ein `<use href="#target">` klont nichts und ein
 * `fill="url(#target)"` fällt auf die Ersatzfarbe zurück. Das REFERENZIERENDE
 * Element misst noch korrekt, seine referenz-abgeleitete Eigenschaft (Paint/Klon)
 * ist aber untreu. T2 markiert genau dieses Element element-genau mit
 * 'REFERENCE_DANGLING' (über den bestehenden warnings[]-Durchreich-Pfad), ohne die
 * Geometrie (bbox_reliability) zu degradieren.
 *
 * PRÄZISION (kein Fehlalarm): markiert NUR, wenn die fehlende id auch in
 * sanitize_loss als gestrippt erscheint (sanitize-induziertes Dangling), NICHT bei
 * beliebigen Autor-Tippfehlern.
 *
 * VERTRAG (drei Fälle):
 *   E (Paint-Dangling): id=target gestrippt → fill="url(#target)" dangelt → das
 *     rect-Element trägt warnings mit 'REFERENCE_DANGLING'; sanitize_loss-Eintrag
 *     trägt den id-Wert "target".
 *   F (use-Dangling): id=length gestrippt → <use href="#length"> dangelt → das
 *     use-Element trägt 'REFERENCE_DANGLING'.
 *   G (Negativ): gültige url(#grad) (grad existiert, wird nicht gestrippt) → KEIN
 *     'REFERENCE_DANGLING' (kein Über-Flag, keine Tautologie).
 *
 * Run direkt: `node tests/integration/test_heal_r6_reference_dangling.mjs`
 */
import { analyze, shutdown } from '../../src/pipeline.js';
import {
  resolve,
  createResolver,
  closeResolver,
} from '../../src/adapters/renderer/playwright.js';

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

// E (Paint-Dangling): id=target (clobber-Name) wird gestrippt → fill="url(#target)"
// auf dem rect dangelt (die Gradient-Definition verliert ihre id).
const SVG_PAINT_DANGLING = `<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="target"><stop offset="0" stop-color="red"/></linearGradient></defs><rect x="0" y="0" width="20" height="20" fill="url(#target)"/></svg>`;

// F (use-Dangling): id=length (clobber-Name) wird gestrippt → <use href="#length">
// klont nichts.
const SVG_USE_DANGLING = `<svg xmlns="http://www.w3.org/2000/svg"><rect id="length" width="10" height="10"/><use href="#length" x="20"/></svg>`;

// G (Negativ): grad ist KEIN clobber-Name → bleibt erhalten → url(#grad) auflösbar.
const SVG_VALID_REF = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="grad"><stop offset="0" stop-color="red"/></linearGradient></defs><rect x="10" y="10" width="30" height="30" fill="url(#grad)"/></svg>`;

// A-Phantom (S1-Regression): id=target (clobber-Name) wird gestrippt → fill="url(#target)"
// auf einem 0×0-Autor-rect dangelt. Ein 0×0-Element ist UNSICHTBAR → die dangelnde
// Referenz ist gegenstandslos → das Element gehört NICHT in die Szene (Phantom-
// Verdrängung F-AT-005/F-AT-2-006). Der Szenen-Verlust bleibt szenenweit laut
// (canvas_validity='lossy'), nur das einzelne 0×0-Phantom verschwindet.
const SVG_DANGLING_ZERO_PHANTOM = `<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="target"><stop offset="0" stop-color="red"/></linearGradient></defs><rect id="r" width="0" height="0" fill="url(#target)"/><rect id="vis" width="5" height="5" fill="green"/></svg>`;

// Sammelt ALLE warnings über scene.elements + meta.truncated_warnings (Hoist-Kanal).
function allElementWarnings(structured) {
  const out = [];
  for (const el of structured?.scene?.elements || []) {
    if (Array.isArray(el.warnings))
      out.push({ id: el.id, tag: el.tag, warnings: el.warnings });
  }
  for (const tw of structured?.meta?.truncated_warnings || []) {
    out.push({ id: tw.element_id, warnings: tw.warnings });
  }
  return out;
}
function hasDangling(structured, predicate) {
  return allElementWarnings(structured).some(
    (e) =>
      Array.isArray(e.warnings) &&
      e.warnings.includes('REFERENCE_DANGLING') &&
      (predicate ? predicate(e) : true),
  );
}

(async () => {
  try {
    // ── E: Paint-Dangling (über Adapter-resolve, dann Pipeline) ─────────────────
    console.log(
      '=== E: id=target gestrippt → fill="url(#target)" dangelt → rect trägt REFERENCE_DANGLING + sanitize_loss.value="target" ===',
    );
    const e = await analyze(SVG_PAINT_DANGLING, []);
    assert(
      'E: structured nicht null (rendert normal)',
      e.structured != null,
      `structured=${JSON.stringify(e.structured)}`,
    );
    assert(
      'E: ein rect-Element trägt warnings mit REFERENCE_DANGLING',
      hasDangling(e.structured, (x) => x.tag === undefined || x.tag === 'rect'),
      `warnings=${JSON.stringify(allElementWarnings(e.structured))}`,
    );

    // ── F: use-Dangling ─────────────────────────────────────────────────────────
    console.log(
      '\n=== F: id=length gestrippt → <use href="#length"> dangelt → use-Element trägt REFERENCE_DANGLING ===',
    );
    const f = await analyze(SVG_USE_DANGLING, []);
    assert(
      'F: structured nicht null',
      f.structured != null,
      `structured=${JSON.stringify(f.structured)}`,
    );
    assert(
      'F: ein use-Element trägt warnings mit REFERENCE_DANGLING',
      hasDangling(f.structured, (x) => x.tag === undefined || x.tag === 'use'),
      `warnings=${JSON.stringify(allElementWarnings(f.structured))}`,
    );

    // ── G: Negativ-Kontrolle (gültige Referenz) ─────────────────────────────────
    console.log(
      '\n=== G: gültige url(#grad) (grad existiert, nicht gestrippt) → KEIN REFERENCE_DANGLING ===',
    );
    const g = await analyze(SVG_VALID_REF, []);
    assert(
      'G: structured nicht null',
      g.structured != null,
      `structured=${JSON.stringify(g.structured)}`,
    );
    assert(
      'G: KEIN Element trägt REFERENCE_DANGLING (kein Über-Flag)',
      !hasDangling(g.structured),
      `warnings=${JSON.stringify(allElementWarnings(g.structured))}`,
    );

    // ── A-Phantom (S1-Regression): 0×0-Autor-rect mit dangelnder Referenz ───────
    // Ein 0×0-Element ist UNSICHTBAR → die dangelnde Referenz ist gegenstandslos →
    // es gehört NICHT in die Szene. Vor dem Fix wurde es als 0×0-Phantom mit
    // warnings:[REFERENCE_DANGLING] emittiert (re-öffnet Phantom-Verdrängung).
    // Der Verlust bleibt szenenweit laut (canvas_validity='lossy').
    console.log(
      '\n=== A-Phantom: 0×0-rect mit dangling url(#target) → NICHT in Szene; sichtbares rect bleibt; canvas_validity=lossy ===',
    );
    const aP = await analyze(SVG_DANGLING_ZERO_PHANTOM, []);
    assert(
      'A-Phantom: structured nicht null',
      aP.structured != null,
      `structured=${JSON.stringify(aP.structured)}`,
    );
    const aPids = (aP.structured?.scene?.elements || []).map((x) => x.id);
    assert(
      'A-Phantom: Szene enthält das sichtbare rect (id=vis)',
      aPids.includes('vis'),
      `ids=${JSON.stringify(aPids)}`,
    );
    assert(
      'A-Phantom: Szene enthält KEIN 0×0-Phantom (id=r)',
      !aPids.includes('r'),
      `ids=${JSON.stringify(aPids)}`,
    );
    assert(
      'A-Phantom: KEIN Element trägt REFERENCE_DANGLING (das 0×0 ist weg)',
      !hasDangling(aP.structured),
      `warnings=${JSON.stringify(allElementWarnings(aP.structured))}`,
    );
    assert(
      'A-Phantom: canvas_validity===lossy (Verlust bleibt szenenweit laut)',
      aP.structured?.scene?.canvas_validity === 'lossy',
      `canvas_validity=${JSON.stringify(aP.structured?.scene?.canvas_validity)}`,
    );

    // ── A-use-bleibt (Regressionswächter): dangling <use> WEITER laut ───────────
    // Identisch zu F oben, aber als expliziter Regressionswächter benannt: das
    // Gate darf für use-Instanzen WEITER durchlässig bleiben.
    console.log(
      '\n=== A-use-bleibt: dangling <use href="#length"> → use-Element WEITER mit REFERENCE_DANGLING ===',
    );
    const aU = await analyze(SVG_USE_DANGLING, []);
    assert(
      'A-use-bleibt: use-Element trägt WEITER REFERENCE_DANGLING',
      hasDangling(aU.structured, (x) => x.tag === undefined || x.tag === 'use'),
      `warnings=${JSON.stringify(allElementWarnings(aU.structured))}`,
    );

    // ── A-sichtbar-bleibt: sichtbares dangling-rect WEITER laut ─────────────────
    // Identisch zu E oben, aber als expliziter Regressionswächter benannt: ein
    // sichtbares (20×20) Element mit dangelnder Referenz bleibt mit
    // REFERENCE_DANGLING emittiert (nur das 0×0-Phantom verschwindet).
    console.log(
      '\n=== A-sichtbar-bleibt: sichtbares rect(20×20) mit dangling url(#target) → WEITER mit REFERENCE_DANGLING ===',
    );
    const aV = await analyze(SVG_PAINT_DANGLING, []);
    assert(
      'A-sichtbar-bleibt: sichtbares rect trägt WEITER REFERENCE_DANGLING',
      hasDangling(aV.structured, (x) => x.tag === undefined || x.tag === 'rect'),
      `warnings=${JSON.stringify(allElementWarnings(aV.structured))}`,
    );

    // ── R9-Determinismus: dangling-SVG 2× byte-identisch ────────────────────────
    console.log(
      '\n=== R9: dangling-SVG 2× byte-identisches structured (Marker-Reihenfolge stabil) ===',
    );
    const r1 = await analyze(SVG_PAINT_DANGLING, []);
    const r2 = await analyze(SVG_PAINT_DANGLING, []);
    const strip = (s) => {
      if (!s) return s;
      const clone = JSON.parse(JSON.stringify(s));
      if (clone.iteration) delete clone.iteration.analysisId;
      return clone;
    };
    assert(
      'R9: structured (ohne analysisId) 2× byte-identisch',
      canon(strip(r1.structured)) === canon(strip(r2.structured)),
      `len ${canon(strip(r1.structured)).length} vs ${canon(strip(r2.structured)).length}`,
    );

    // ── Adapter-Direktproben (eigener Lifecycle, ganz am Ende) ──────────────────
    // closeResolver() reißt den geteilten Singleton-Browser ab → DESHALB nach allen
    // Pipeline-Aufrufen.
    console.log(
      '\n=== Adapter-Direkt: sanitize_loss trägt id-Wert; Determinismus der Marker-Reihenfolge ===',
    );
    const probePage = await createResolver();
    const rE = await resolve(probePage, SVG_PAINT_DANGLING);
    const rF = await resolve(probePage, SVG_USE_DANGLING);
    const rG = await resolve(probePage, SVG_VALID_REF);
    // R9: 2× resolve byte-identische sanitize_loss-Reihenfolge.
    const sl1 = canon((await resolve(probePage, SVG_PAINT_DANGLING)).sanitize_loss);
    const sl2 = canon((await resolve(probePage, SVG_PAINT_DANGLING)).sanitize_loss);
    await closeResolver();

    assert(
      'E (Adapter): sanitize_loss-Eintrag trägt id-Wert "target"',
      Array.isArray(rE.sanitize_loss) &&
        rE.sanitize_loss.some(
          (l) => l.reason === 'ATTR_STRIPPED:id' && l.value === 'target',
        ),
      `got ${JSON.stringify(rE.sanitize_loss)}`,
    );
    assert(
      'E (Adapter): rect-Element trägt REFERENCE_DANGLING',
      Array.isArray(rE.elements) &&
        rE.elements.some(
          (el) =>
            el.tag === 'rect' &&
            Array.isArray(el.warnings) &&
            el.warnings.includes('REFERENCE_DANGLING'),
        ),
      `got ${JSON.stringify(rE.elements?.map((x) => ({ tag: x.tag, warnings: x.warnings })))}`,
    );
    assert(
      'F (Adapter): sanitize_loss-Eintrag trägt id-Wert "length"',
      Array.isArray(rF.sanitize_loss) &&
        rF.sanitize_loss.some(
          (l) => l.reason === 'ATTR_STRIPPED:id' && l.value === 'length',
        ),
      `got ${JSON.stringify(rF.sanitize_loss)}`,
    );
    assert(
      'F (Adapter): use-Element trägt REFERENCE_DANGLING',
      Array.isArray(rF.elements) &&
        rF.elements.some(
          (el) =>
            el.tag === 'use' &&
            Array.isArray(el.warnings) &&
            el.warnings.includes('REFERENCE_DANGLING'),
        ),
      `got ${JSON.stringify(rF.elements?.map((x) => ({ tag: x.tag, warnings: x.warnings })))}`,
    );
    assert(
      'G (Adapter): KEIN Element trägt REFERENCE_DANGLING (kein Über-Flag)',
      Array.isArray(rG.elements) &&
        !rG.elements.some(
          (el) =>
            Array.isArray(el.warnings) &&
            el.warnings.includes('REFERENCE_DANGLING'),
        ),
      `got ${JSON.stringify(rG.elements?.map((x) => ({ tag: x.tag, warnings: x.warnings })))}`,
    );
    assert(
      'R9 (Adapter): 2× resolved.sanitize_loss byte-identisch (Reihenfolge stabil)',
      sl1 === sl2,
      `sl1=${sl1}, sl2=${sl2}`,
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
