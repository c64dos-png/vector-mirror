/**
 * test_heal3_phantom.mjs — HEILUNG 3 §HEAL3-A: Phantom-Ausschluss (defs/symbol-Vorlagen)
 *
 * Real-Chromium-Harness (KEINE Mocks), kalibriert an
 * an internal ground-truth probe (Empirie-Referenz, byte-stabil
 * closest_separates=true).
 *
 * KERN-VERTRAG (Coder-Vertrag §HEAL3-A): EINE Zeile in playwright.js nach
 * Z.1126 — `if (el.closest('defs,symbol,clipPath,mask,pattern,marker')) continue;`
 * Kinder von Definitions-Containern malen NUR via Referenz-Instanz (SVG2 §5.6),
 * nie direkt → sie dürfen NIE als Phantom-Element emittiert werden. Die leere-
 * Leinwand→NO_ELEMENTS-Mechanik ist AUTOMATISCH (bestehende Bedingung
 * `if (elements.length === 0)` → {error:'NO_ELEMENTS'}); keine Sonderlogik.
 *
 * ROT/GRÜN-VERTRAG (Coder-Vertrag §Rot/Grün), 6 Fälle:
 *   F-AT-4-E  <defs><rect id=tmpl/></defs>        → GRÜN: NO_ELEMENTS
 *             (ROT heute: Phantom #tmpl emittiert).
 *   F-AT-4-F  <symbol id=s><circle fill=gold/></symbol> → GRÜN: NO_ELEMENTS.
 *   F-AT-4-G  nur <defs>, kein use                → GRÜN: NO_ELEMENTS (ehrlich leer).
 *   Positiv-Kontrolle  <defs><rect id=tmpl/></defs>
 *             + <use href=#tmpl transform="translate(80,80)"/>
 *             → GRÜN: genau 1 Element (das <use>), bbox-Ecke ≈ (80,80) 40×40,
 *               Phantom #tmpl verworfen, KEIN NO_ELEMENTS. (use-FARBE bleibt die
 *               bekannte Lüge `black` → §HEAL3-B/3b; dieser Test prüft Geometrie
 *               + Präsenz, NICHT Farbe.)
 *   CASE-FALLE-Regression  <clipPath id=c><rect/></clipPath> ohne sichtbares
 *             Element → MUSS NO_ELEMENTS. closest() matcht den QUALIFIZIERTEN
 *             Namen → `clipPath` MUSS camelCase sein; `clippath` (lowercase)
 *             matcht NICHTS → stiller No-Op → dieser Test fällt RT bei lowercase.
 *   pattern-Leck-Regression  <pattern id=p><rect/></pattern> ohne sichtbares
 *             Element → MUSS NO_ELEMENTS. pattern ist das einzige Container-Leck,
 *             das SKIP_TAGS nicht fängt (pattern fehlt dort bewusst).
 *
 * Run direkt: `node tests/integration/test_heal3_phantom.mjs`
 */
import {
  closeResolver,
  createResolver,
  resolve,
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

// ── FIXTURES ────────────────────────────────────────────────────────────────

// F-AT-4-E: reines Template-Kind im <defs>, kein use → nichts Gemaltes.
const SVG_DEFS_ONLY = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
  <defs><rect id="tmpl" x="0" y="0" width="40" height="40" fill="red"/></defs>
</svg>`;

// F-AT-4-F: Template-Kind in <symbol>, kein use → nichts Gemaltes.
const SVG_SYMBOL_ONLY = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
  <symbol id="s" viewBox="0 0 60 60"><circle id="c" cx="30" cy="30" r="20" fill="gold"/></symbol>
</svg>`;

// F-AT-4-G: nur <defs> (leere Leinwand, ehrlich leer) → NO_ELEMENTS.
const SVG_EMPTY_CANVAS = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
  <defs><rect id="ghost" x="0" y="0" width="40" height="40" fill="green"/></defs>
</svg>`;

// Positiv-Kontrolle: Phantom #tmpl im <defs> + EINE Instanz via <use> @ (80,80).
// Das <use> steht im Light-DOM, ist KEIN Definitions-Kind → MUSS erhalten bleiben.
const SVG_POSITIVE = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
  <defs><rect id="tmpl" x="0" y="0" width="40" height="40" fill="red"/></defs>
  <use id="u1" href="#tmpl" transform="translate(80,80)"/>
</svg>`;

// CASE-FALLE-Regression: clipPath-Kind, kein sichtbares Element → NO_ELEMENTS.
// Fällt RT, falls der closest()-Selektor `clippath` (lowercase) statt `clipPath` nutzt.
const SVG_CLIPPATH_CHILD = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
  <clipPath id="c"><rect id="clip_rect" x="0" y="0" width="40" height="40"/></clipPath>
</svg>`;

// pattern-Leck-Regression: pattern-Kind, kein sichtbares Element → NO_ELEMENTS.
// pattern fehlt in SKIP_TAGS → nur der closest()-Schnitt fängt dieses Leck.
const SVG_PATTERN_CHILD = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
  <pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse"><rect id="pat_rect" x="0" y="0" width="40" height="40" fill="red"/></pattern>
</svg>`;

function byId(elements, id) {
  return elements.find((e) => e.id === id);
}

(async () => {
  let page;
  try {
    page = await createResolver();
  } catch (e) {
    console.error('Renderer-Init fehlgeschlagen:', e.message);
    process.exit(1);
  }

  try {
    // ── F-AT-4-E: defs-Kind → NO_ELEMENTS (kein Phantom) ─────────────────────
    console.log('=== F-AT-4-E: <defs><rect> → NO_ELEMENTS (Phantom verworfen) ===');
    const rDefs = await resolve(page, SVG_DEFS_ONLY);
    assert(
      'F-AT-4-E: defs-only → error === NO_ELEMENTS',
      rDefs.error === 'NO_ELEMENTS',
      `got ${JSON.stringify({ error: rDefs.error, ids: (rDefs.elements || []).map((e) => e.id) })}`,
    );
    assert(
      'F-AT-4-E: KEIN Phantom #tmpl emittiert',
      !(rDefs.elements || []).some((e) => e.id === 'tmpl'),
      `ids=${JSON.stringify((rDefs.elements || []).map((e) => e.id))}`,
    );

    // ── F-AT-4-F: symbol-Kind → NO_ELEMENTS ──────────────────────────────────
    console.log('\n=== F-AT-4-F: <symbol><circle> → NO_ELEMENTS ===');
    const rSym = await resolve(page, SVG_SYMBOL_ONLY);
    assert(
      'F-AT-4-F: symbol-only → error === NO_ELEMENTS',
      rSym.error === 'NO_ELEMENTS',
      `got ${JSON.stringify({ error: rSym.error, ids: (rSym.elements || []).map((e) => e.id) })}`,
    );
    assert(
      'F-AT-4-F: KEIN Phantom #c (symbol-Kind) emittiert',
      !(rSym.elements || []).some((e) => e.id === 'c'),
      `ids=${JSON.stringify((rSym.elements || []).map((e) => e.id))}`,
    );

    // ── F-AT-4-G: leere Leinwand → NO_ELEMENTS (automatisch, ehrlich leer) ────
    console.log('\n=== F-AT-4-G: nur <defs> (leere Leinwand) → NO_ELEMENTS ===');
    const rEmpty = await resolve(page, SVG_EMPTY_CANVAS);
    assert(
      'F-AT-4-G: leere Leinwand → error === NO_ELEMENTS (automatisch)',
      rEmpty.error === 'NO_ELEMENTS',
      `got ${JSON.stringify({ error: rEmpty.error, ids: (rEmpty.elements || []).map((e) => e.id) })}`,
    );

    // ── Positiv-Kontrolle: use erhalten, bbox @ (80,80) 40×40, KEIN NO_ELEMENTS ─
    console.log('\n=== Positiv-Kontrolle: <defs>+<use> → genau das <use> (kein Über-Skip) ===');
    const rPos = await resolve(page, SVG_POSITIVE);
    assert(
      'Positiv: resolve liefert KEIN error (NICHT NO_ELEMENTS)',
      !rPos.error,
      rPos.error ? `${rPos.error}: ${rPos.message}` : '',
    );
    const posEls = rPos.elements || [];
    const posIds = posEls.map((e) => e.id);
    assert(
      'Positiv: genau 1 Element',
      posEls.length === 1,
      `ids=${JSON.stringify(posIds)} (len=${posEls.length})`,
    );
    assert(
      'Positiv: das eine Element ist das <use> (id u1, tag use) — NICHT mit-ausgeschlossen',
      posEls.length === 1 && posEls[0].id === 'u1' && posEls[0].tag === 'use',
      `got ${JSON.stringify(posEls.map((e) => ({ id: e.id, tag: e.tag })))}`,
    );
    assert(
      'Positiv: Phantom #tmpl (defs-Kind) verworfen',
      !posIds.includes('tmpl'),
      `ids=${JSON.stringify(posIds)}`,
    );
    const useEl = byId(posEls, 'u1');
    assert(
      'Positiv: bbox-Ecke ≈ (80,80) (transform translate(80,80))',
      useEl &&
        Math.abs(useEl.bbox.x - 80) < 1 &&
        Math.abs(useEl.bbox.y - 80) < 1,
      useEl ? `got bbox=${JSON.stringify(useEl.bbox)}` : `ids=${JSON.stringify(posIds)}`,
    );
    assert(
      'Positiv: bbox 40×40 (Template-Geometrie über die Instanz)',
      useEl &&
        Math.abs(useEl.bbox.w - 40) < 1 &&
        Math.abs(useEl.bbox.h - 40) < 1,
      useEl ? `got bbox=${JSON.stringify(useEl.bbox)}` : `ids=${JSON.stringify(posIds)}`,
    );

    // ── CASE-FALLE-Regression: clipPath-Kind → NO_ELEMENTS (camelCase-Wächter) ─
    console.log('\n=== CASE-FALLE: <clipPath><rect> → NO_ELEMENTS (fällt RT bei lowercase) ===');
    const rClip = await resolve(page, SVG_CLIPPATH_CHILD);
    assert(
      'CASE-FALLE: clipPath-Kind → error === NO_ELEMENTS',
      rClip.error === 'NO_ELEMENTS',
      `got ${JSON.stringify({ error: rClip.error, ids: (rClip.elements || []).map((e) => e.id) })}`,
    );
    assert(
      'CASE-FALLE: KEIN Phantom #clip_rect (clipPath-Kind) emittiert',
      !(rClip.elements || []).some((e) => e.id === 'clip_rect'),
      `ids=${JSON.stringify((rClip.elements || []).map((e) => e.id))}`,
    );
    // CASE-FALLE Browser-Wächter: closest('clipPath') MUSS das clipPath-Element
    // treffen (sonst rutscht das Kind durch → die obige NO_ELEMENTS-Antwort wäre
    // dann von einem ANDEREN Gate getragen, nicht vom closest()-Schnitt). Dieser
    // Sub-Test bindet die Erwartung direkt an den camelCase-Selektor.
    // EHRLICHE NOTIZ (empirisch in DIESEM Codebase verifiziert): der Renderer lädt
    // das SVG in ein HTML-Dokument (`<!DOCTYPE html>…<body>${svg}</body>`,
    // playwright.js Z.709/1398). In HTML-Dokumenten ist der CSS-Typ-Selektor
    // ASCII-case-INSENSITIV → `closest('clippath')` (lowercase) trifft das
    // clipPath-Element EBENFALLS. Die im Vertrag beschriebene „stille-No-Op"-
    // Falle gilt nur im XML/SVG-Namespace-Kontext (case-sensitiv). camelPath bleibt
    // dennoch die korrekte, kontext-robuste Schreibweise (trifft in BEIDEN Kontexten).
    const caseProbe = await page.evaluate(() => {
      const el = document.getElementById('clip_rect');
      if (!el) return { exists: false };
      return {
        exists: true,
        camel_hits: el.closest('clipPath') !== null,
        camel_tag: el.closest('clipPath')?.tagName ?? null,
        lower_hits: el.closest('clippath') !== null,
        document_is_html: document.contentType === 'text/html',
      };
    });
    assert(
      'CASE-FALLE: closest(camelCase clipPath) trifft das clipPath-Element',
      caseProbe.exists && caseProbe.camel_hits === true && caseProbe.camel_tag === 'clipPath',
      `got ${JSON.stringify(caseProbe)}`,
    );
    console.log(
      `  NOTE: Render-Kontext document.contentType=${
        caseProbe.document_is_html ? 'text/html' : 'non-html'
      } → closest('clippath') lowercase hits=${caseProbe.lower_hits} ` +
        `(im HTML-Kontext case-insensitiv; camelCase ist die kontext-robuste Wahl).`,
    );

    // ── pattern-Leck-Regression: pattern-Kind → NO_ELEMENTS ───────────────────
    console.log('\n=== pattern-Leck: <pattern><rect> → NO_ELEMENTS (SKIP_TAGS-Lücke) ===');
    const rPat = await resolve(page, SVG_PATTERN_CHILD);
    assert(
      'pattern-Leck: pattern-Kind → error === NO_ELEMENTS',
      rPat.error === 'NO_ELEMENTS',
      `got ${JSON.stringify({ error: rPat.error, ids: (rPat.elements || []).map((e) => e.id) })}`,
    );
    assert(
      'pattern-Leck: KEIN Phantom #pat_rect (pattern-Kind) emittiert',
      !(rPat.elements || []).some((e) => e.id === 'pat_rect'),
      `ids=${JSON.stringify((rPat.elements || []).map((e) => e.id))}`,
    );

    // ── DETERMINISMUS: 3× identische defs-only-Antwort ────────────────────────
    console.log('\n=== DETERMINISMUS: 3× identische NO_ELEMENTS (defs-only) ===');
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const r = await resolve(page, SVG_DEFS_ONLY);
      runs.push(r.error);
    }
    assert(
      'Determinismus: 3× NO_ELEMENTS',
      runs[0] === 'NO_ELEMENTS' && runs[1] === 'NO_ELEMENTS' && runs[2] === 'NO_ELEMENTS',
      `got ${JSON.stringify(runs)}`,
    );
  } finally {
    await closeResolver();
  }

  console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error('Test-Lauf-Fehler:', e);
  process.exit(1);
});
