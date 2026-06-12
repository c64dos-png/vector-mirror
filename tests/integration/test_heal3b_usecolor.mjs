/**
 * test_heal3b_usecolor.mjs — HEILUNG 3b §HEAL3b: use-Instanz-Farb-Ehrlichkeit (F-AT-4-J)
 *
 * Real-Chromium-Harness über die ECHTE Pipeline (P.inspect / P.palette), KEINE
 * Mocks. Kalibriert am Beweis-Artefakt an internal ground-truth probe
 * (Mechanismus-Refutation: any_dom_mechanism_works=false → kein DOM-Weg erreicht
 * die gerenderte <use>-Instanz-Farbe) und an an internal ground-truth probe (Pixel-
 * Boden-Wahrheit der drei Fixtures fixed/inherit/override).
 *
 * KERN-VERTRAG (Coder-Vertrag §3b / §3b-P): die gerenderte fill/stroke einer
 * <use>-Instanz ist ohne verbotene Simulation/Pixel-Scan NICHT messbar. Das Auge
 * meldet ehrlich `indeterminate` (NICHT die `black`-Lüge, NICHT geraten) +
 * Warnung 'USE_FILL_INDETERMINATE'. Geometrie (bbox/cell) + Präsenz + Opacity
 * bleiben unverändert ehrlich (bbox_reliability bleibt 'reliable').
 *
 * ROT/GRÜN-VERTRAG (Coder-Vertrag §Rot/Grün), 7 Fälle:
 *   F-AT-4-J-fixed     Symbol-rect fill=red, <use> ohne fill → color===indeterminate
 *                      (NICHT 'black'), Warnung da.
 *   F-AT-4-J-inherit   Symbol-rect ohne fill + <use fill=lime> → color===indeterminate
 *                      (NICHT 'lime', obwohl lime hier zufällig stimmte — Anti-Raten).
 *   F-AT-4-J-override  Symbol-rect fill=red + <use fill=lime> → color===indeterminate
 *                      (NICHT 'lime' = naive-Fix-Lüge, NICHT 'red'). Der Anti-Rate-Beweis.
 *   stroke-Unbestimmtheit  Symbol-rect fill=none stroke=blue + <use> →
 *                      stroke===indeterminate (NICHT 'transparent'/null), Warnung da.
 *   Geometrie-Erhalt   fixed-Fall: genau 1 Element (das use), NICHT NO_ELEMENTS,
 *                      cell ist die deterministische transformierte Instanz-Position,
 *                      bbox_reliability==='reliable' (Farb-Unbestimmtheit orthogonal).
 *   Nicht-use-Regression  <rect fill=gold> Top-Level → color==='gold', warnings
 *                      enthält NICHT 'USE_FILL_INDETERMINATE'. Schnitt ist use-spezifisch.
 *   Determinismus      2× identisches Ergebnis (getrennte Prozesse).
 *
 * Run direkt: `node tests/integration/test_heal3b_usecolor.mjs`
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as P from '../../src/pipeline.js';
// §3b-C: COLOR-Constraint-Auswertung. loader.js registriert alle Constraints
// (Side-Effect), checkConstraint dispatcht über die Registry.
import '../../src/core/constraints/loader.js';
import { checkConstraint } from '../../src/core/constraints/registry.js';

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

// ── FIXTURES (kalibriert an an internal ground-truth probe) ─────────────────────

// F-AT-4-J-fixed: Symbol-rect FEST fill=red, <use> ohne fill. Pixel rendert ROT.
const SVG_FIXED =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">' +
  '<defs><symbol id="badge" viewBox="0 0 20 20">' +
  '<rect id="tmpl" x="0" y="0" width="20" height="20" fill="red"/>' +
  '</symbol></defs>' +
  '<use id="inst" href="#badge" x="40" y="40" width="20" height="20"/>' +
  '</svg>';

// F-AT-4-J-inherit: Symbol-rect OHNE fill + <use fill=lime>. Pixel rendert GRÜN
// (Form erbt use-fill). 'lime' wäre hier ZUFÄLLIG richtig → Anti-Raten testet,
// dass das Auge trotzdem indeterminate meldet.
const SVG_INHERIT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">' +
  '<defs><symbol id="badge2" viewBox="0 0 20 20">' +
  '<rect id="tmpl2" x="0" y="0" width="20" height="20"/>' +
  '</symbol></defs>' +
  '<use id="inst2" href="#badge2" x="40" y="40" width="20" height="20" fill="lime"/>' +
  '</svg>';

// F-AT-4-J-override: Symbol-rect FEST fill=red + <use fill=lime>. SVG: Form hat
// eigenen fill → use-fill IGNORIERT → Pixel rendert ROT. 'lime' (use-fill-Raten)
// UND 'red' (Pixel) sind beide falsch zu melden → indeterminate. Anti-Rate-Beweis.
const SVG_OVERRIDE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">' +
  '<defs><symbol id="badge3" viewBox="0 0 20 20">' +
  '<rect id="tmpl3" x="0" y="0" width="20" height="20" fill="red"/>' +
  '</symbol></defs>' +
  '<use id="inst3" href="#badge3" x="40" y="40" width="20" height="20" fill="lime"/>' +
  '</svg>';

// stroke-Unbestimmtheit: Symbol-rect fill=none stroke=blue + <use>. Der Rand der
// Instanz ist genauso unmessbar wie der fill → stroke===indeterminate.
const SVG_STROKE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">' +
  '<defs><symbol id="s" viewBox="0 0 20 20">' +
  '<rect id="sr" x="0" y="0" width="20" height="20" fill="none" stroke="blue" stroke-width="2"/>' +
  '</symbol></defs>' +
  '<use id="instS" href="#s" x="40" y="40" width="20" height="20"/>' +
  '</svg>';

// Nicht-use-Regression: Top-Level-<rect> mit echtem fill=gold (sichtbar, messbar).
// Beweist: der §HEAL3b-Schnitt ist use-spezifisch und lügt NICHT bei echten Formen.
const SVG_RECT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">' +
  '<rect id="r" x="10" y="10" width="30" height="30" fill="gold"/>' +
  '</svg>';

// use-in-Container (R2-revert: Kern-Fix wirkt auch verschachtelt): Spotter-<a>
// umschließt eine RENDERNDE use-Instanz. Das Prädikat ist `tag === 'use'` →
// NUR das <use> selbst meldet indeterminate + Warnung; das <a> trägt seine
// EIGENE (out-of-scope) Container-Farbe und wird NICHT geflaggt (kein Over-Flag).
const DEFS_BADGE =
  '<defs><symbol id="badge" viewBox="0 0 20 20">' +
  '<rect width="20" height="20" fill="red"/>' +
  '</symbol></defs>';
const SVG_NESTED =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">' +
  DEFS_BADGE +
  '<a id="link"><use id="inst" href="#badge" x="40" y="40" width="20" height="20"/></a>' +
  '</svg>';

// KEIN-OVER-FLAG-Invariante — die 4 von BEIDEN Engines (Codex+Gemini) in Runde 2
// reproduzierten R1-Over-Flag-Fälle als Dauer-Regression. In JEDEM: NUR ein echtes
// <use> (falls überhaupt emittiert) trägt die Warnung; KEIN Container/Blatt; jedes
// deterministisch messbare Element behält seine echte Farbe.

// (a) display:none-use: die unsichtbare use-Instanz wird gar nicht emittiert;
//     der sichtbare Anker + rect behalten ihre messbare Farbe (green).
const SVG_DISPNONE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">' +
  DEFS_BADGE +
  '<a id="link" fill="green"><use href="#badge" display="none"/>' +
  '<rect id="r" x="10" y="10" width="30" height="30" fill="green"/></a>' +
  '</svg>';

// (b) Blatt-mit-use-Kind: ein Blatt-<rect> mit einem use-Kind. Das messbare rect
//     darf NICHT über sein use-Kind geflaggt werden — color bleibt green.
const SVG_LEAFUSE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">' +
  DEFS_BADGE +
  '<rect id="r1" x="10" y="10" width="30" height="30" fill="green"><use href="#badge"/></rect>' +
  '</svg>';

// (c) metadata-use: use in nicht-renderndem <metadata>. Anker + rect messbar (green).
const SVG_METADATA =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">' +
  DEFS_BADGE +
  '<a id="link" fill="green"><metadata><use href="#badge"/></metadata>' +
  '<rect id="r" x="10" y="10" width="30" height="30" fill="green"/></a>' +
  '</svg>';

// (d) filter-use: use in nicht-renderndem <filter>. Anker nicht geflaggt; rect = red.
const SVG_FILTER =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">' +
  '<a id="link"><filter id="f1"><use href="#r"/></filter>' +
  '<rect id="r" x="10" y="10" width="30" height="30" fill="red"/></a>' +
  '</svg>';

function sceneEls(structured) {
  return structured && structured.scene ? structured.scene.elements || [] : [];
}
function byId(els, id) {
  return els.find((e) => e.id === id);
}

// ── DETERMINISMUS-Kind: kanonische Signatur aller beweis-tragenden Felder ───
// Getrennter Prozess (frische Chromium-Instanz). Druckt GENAU EINE Zeile
// CHILD_RESULT=<kanonisches JSON>. Der Elternlauf vergleicht zwei solche Zeilen
// byte-für-byte → echter Cross-Prozess-Determinismus, nicht nur Re-Use eines
// gecachten Page-States.
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') {
    const keys = Object.keys(v).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

if (process.argv.includes('--child')) {
  try {
    const f = byId(sceneEls((await P.inspect(SVG_FIXED)).structured), 'inst');
    const h = byId(sceneEls((await P.inspect(SVG_INHERIT)).structured), 'inst2');
    const o = byId(sceneEls((await P.inspect(SVG_OVERRIDE)).structured), 'inst3');
    const palS = await P.palette(SVG_STROKE);
    const sCol = (palS.structured?.colors || []).find((c) => c.id === 'instS');
    const sWarn = byId(sceneEls((await P.inspect(SVG_STROKE)).structured), 'instS');
    const r = byId(sceneEls((await P.inspect(SVG_RECT)).structured), 'r');
    const nestedEls = sceneEls((await P.inspect(SVG_NESTED)).structured);
    const nL = byId(nestedEls, 'link');
    const nU = byId(nestedEls, 'inst');
    const dispEls = sceneEls((await P.inspect(SVG_DISPNONE)).structured);
    const leafEls = sceneEls((await P.inspect(SVG_LEAFUSE)).structured);
    const metaEls = sceneEls((await P.inspect(SVG_METADATA)).structured);
    const filtEls = sceneEls((await P.inspect(SVG_FILTER)).structured);
    // Kanonische Über-Flag-Signatur: ids+warnings jedes emittierten Elements,
    // so dass jedes versehentliche Container/Blatt-Flag im Cross-Prozess-Diff sichtbar wird.
    const flagSig = (els) =>
      els.map((e) => ({ id: e.id, tag: e.tag, color: e.color, warnings: e.warnings ?? null }));
    const sig = {
      fixed: { color: f?.color, warnings: f?.warnings, cell: f?.cell, reliability: f?.bbox_reliability },
      inherit: { color: h?.color, warnings: h?.warnings },
      override: { color: o?.color, warnings: o?.warnings },
      stroke: { stroke: sCol?.stroke, warnings: sWarn?.warnings },
      rect: { color: r?.color, warnings: r?.warnings ?? null },
      nested_link: { color: nL?.color, warnings: nL?.warnings ?? null },
      nested_use: { color: nU?.color, warnings: nU?.warnings },
      dispnone: flagSig(dispEls),
      leafuse: flagSig(leafEls),
      metadata: flagSig(metaEls),
      filter: flagSig(filtEls),
    };
    console.log('CHILD_RESULT=' + canon(sig));
  } finally {
    await P.shutdown();
  }
  process.exit(0);
}

(async () => {
  try {
    // ── F-AT-4-J-fixed: use color === indeterminate, Warnung da ──────────────
    console.log('=== F-AT-4-J-fixed: Symbol fill=red, <use> ohne fill → color indeterminate ===');
    const insFixed = await P.inspect(SVG_FIXED);
    const elsFixed = sceneEls(insFixed.structured);
    const useFixed = byId(elsFixed, 'inst');
    assert(
      'fixed: <use inst> wird gefunden (NICHT gedroppt)',
      !!useFixed,
      `ids=${JSON.stringify(elsFixed.map((e) => `${e.tag}#${e.id}`))}`,
    );
    assert(
      "fixed: color === 'indeterminate' (NICHT die 'black'-Lüge)",
      useFixed && useFixed.color === 'indeterminate',
      useFixed ? `got color=${JSON.stringify(useFixed.color)}` : 'use fehlt',
    );
    assert(
      "fixed: color ist NICHT 'black'",
      useFixed && useFixed.color !== 'black',
      useFixed ? `got color=${JSON.stringify(useFixed.color)}` : 'use fehlt',
    );
    assert(
      "fixed: warnings enthält 'USE_FILL_INDETERMINATE'",
      useFixed &&
        Array.isArray(useFixed.warnings) &&
        useFixed.warnings.includes('USE_FILL_INDETERMINATE'),
      useFixed ? `got warnings=${JSON.stringify(useFixed.warnings)}` : 'use fehlt',
    );

    // ── F-AT-4-J-inherit: color indeterminate, NICHT 'lime' (Anti-Raten) ─────
    console.log('\n=== F-AT-4-J-inherit: Symbol ohne fill + <use fill=lime> → indeterminate (NICHT lime) ===');
    const insInherit = await P.inspect(SVG_INHERIT);
    const useInherit = byId(sceneEls(insInherit.structured), 'inst2');
    assert(
      "inherit: color === 'indeterminate' (NICHT 'lime', obwohl lime zufällig stimmte — Anti-Raten)",
      useInherit && useInherit.color === 'indeterminate',
      useInherit ? `got color=${JSON.stringify(useInherit.color)}` : 'use fehlt',
    );
    assert(
      "inherit: color ist NICHT 'lime' (kein Raten aus use-fill)",
      useInherit && useInherit.color !== 'lime',
      useInherit ? `got color=${JSON.stringify(useInherit.color)}` : 'use fehlt',
    );
    assert(
      "inherit: warnings enthält 'USE_FILL_INDETERMINATE'",
      useInherit &&
        Array.isArray(useInherit.warnings) &&
        useInherit.warnings.includes('USE_FILL_INDETERMINATE'),
      useInherit ? `got warnings=${JSON.stringify(useInherit.warnings)}` : 'use fehlt',
    );

    // ── F-AT-4-J-override: color indeterminate, NICHT 'lime', NICHT 'red' ────
    console.log('\n=== F-AT-4-J-override: Symbol fill=red + <use fill=lime> → indeterminate (Anti-Rate-Beweis) ===');
    const insOverride = await P.inspect(SVG_OVERRIDE);
    const useOverride = byId(sceneEls(insOverride.structured), 'inst3');
    assert(
      "override: color === 'indeterminate' (Anti-Rate-Beweis)",
      useOverride && useOverride.color === 'indeterminate',
      useOverride ? `got color=${JSON.stringify(useOverride.color)}` : 'use fehlt',
    );
    assert(
      "override: color ist NICHT 'lime' (naive-Fix-Lüge: use-fill geraten)",
      useOverride && useOverride.color !== 'lime',
      useOverride ? `got color=${JSON.stringify(useOverride.color)}` : 'use fehlt',
    );
    assert(
      "override: color ist NICHT 'red' (Pixel-Wahrheit, aber nicht ehrlich messbar)",
      useOverride && useOverride.color !== 'red',
      useOverride ? `got color=${JSON.stringify(useOverride.color)}` : 'use fehlt',
    );
    assert(
      "override: warnings enthält 'USE_FILL_INDETERMINATE'",
      useOverride &&
        Array.isArray(useOverride.warnings) &&
        useOverride.warnings.includes('USE_FILL_INDETERMINATE'),
      useOverride ? `got warnings=${JSON.stringify(useOverride.warnings)}` : 'use fehlt',
    );

    // ── stroke-Unbestimmtheit: use stroke === indeterminate (via P.palette) ──
    console.log('\n=== stroke-Unbestimmtheit: Symbol stroke=blue + <use> → stroke indeterminate ===');
    const palStroke = await P.palette(SVG_STROKE);
    const colorsStroke =
      palStroke.structured && palStroke.structured.colors
        ? palStroke.structured.colors
        : [];
    const palUseStroke = colorsStroke.find((c) => c.id === 'instS');
    assert(
      'stroke: <use instS> wird in der Palette gefunden',
      !!palUseStroke,
      `ids=${JSON.stringify(colorsStroke.map((c) => c.id))}`,
    );
    assert(
      "stroke: stroke === 'indeterminate' (NICHT 'transparent'/null)",
      palUseStroke && palUseStroke.stroke === 'indeterminate',
      palUseStroke ? `got stroke=${JSON.stringify(palUseStroke.stroke)}` : 'use fehlt',
    );
    assert(
      'stroke: stroke ist NICHT null',
      palUseStroke && palUseStroke.stroke !== null,
      palUseStroke ? `got stroke=${JSON.stringify(palUseStroke.stroke)}` : 'use fehlt',
    );
    // Warnung am selben Element (über inspect, da palette keine warnings führt).
    const useStrokeWarn = byId(sceneEls((await P.inspect(SVG_STROKE)).structured), 'instS');
    assert(
      "stroke: warnings enthält 'USE_FILL_INDETERMINATE'",
      useStrokeWarn &&
        Array.isArray(useStrokeWarn.warnings) &&
        useStrokeWarn.warnings.includes('USE_FILL_INDETERMINATE'),
      useStrokeWarn ? `got warnings=${JSON.stringify(useStrokeWarn.warnings)}` : 'use fehlt',
    );

    // ── Geometrie-Erhalt (Positiv-Kontrolle): bbox/cell + reliability bleiben ─
    console.log('\n=== Geometrie-Erhalt: fixed-Fall → genau 1 Element, cell @ Instanz-Position, reliable ===');
    assert(
      'Geometrie: NICHT NO_ELEMENTS (structured nicht null)',
      insFixed.structured !== null,
      `prose=${JSON.stringify(insFixed.prose)}`,
    );
    assert(
      'Geometrie: genau 1 Element (das <use>, Phantom #tmpl verworfen)',
      elsFixed.length === 1,
      `ids=${JSON.stringify(elsFixed.map((e) => `${e.tag}#${e.id}`))} (len=${elsFixed.length})`,
    );
    assert(
      'Geometrie: das eine Element ist das <use> (id inst, tag use)',
      elsFixed.length === 1 && useFixed && useFixed.tag === 'use' && useFixed.id === 'inst',
      `got ${JSON.stringify(elsFixed.map((e) => ({ id: e.id, tag: e.tag })))}`,
    );
    // cell = deterministische transformierte Instanz-Position. use x=40 y=40
    // w=20 h=20 auf 200×100-Canvas → span 'A2-B3' (empirisch byte-stabil,
    // analog heal3-Positiv-Kontrolle bbox-Ecke ≈ (40,40)). Geometrie ist NICHT
    // von der Farb-Unbestimmtheit betroffen.
    assert(
      "Geometrie: cell === 'A2-B3' (transformierte Instanz-Position @ (40,40) 20×20)",
      useFixed && useFixed.cell === 'A2-B3',
      useFixed ? `got cell=${JSON.stringify(useFixed.cell)}` : 'use fehlt',
    );
    assert(
      "Geometrie: bbox_reliability === 'reliable' (Farb-Unbestimmtheit ist orthogonal)",
      useFixed && useFixed.bbox_reliability === 'reliable',
      useFixed ? `got bbox_reliability=${JSON.stringify(useFixed.bbox_reliability)}` : 'use fehlt',
    );

    // ── Nicht-use-Regression: <rect fill=gold> → 'gold', KEINE use-Warnung ───
    console.log('\n=== Nicht-use-Regression: <rect fill=gold> → color gold, KEINE USE_FILL_INDETERMINATE ===');
    const insRect = await P.inspect(SVG_RECT);
    const rectEl = byId(sceneEls(insRect.structured), 'r');
    assert(
      'Regression: <rect r> wird gefunden',
      !!rectEl,
      `ids=${JSON.stringify(sceneEls(insRect.structured).map((e) => `${e.tag}#${e.id}`))}`,
    );
    assert(
      "Regression: color === 'gold' (echte Form bleibt messbar)",
      rectEl && rectEl.color === 'gold',
      rectEl ? `got color=${JSON.stringify(rectEl.color)}` : 'rect fehlt',
    );
    assert(
      "Regression: warnings enthält NICHT 'USE_FILL_INDETERMINATE' (Schnitt ist use-spezifisch)",
      rectEl &&
        !(Array.isArray(rectEl.warnings) && rectEl.warnings.includes('USE_FILL_INDETERMINATE')),
      rectEl ? `got warnings=${JSON.stringify(rectEl.warnings ?? null)}` : 'rect fehlt',
    );

    // ── use-in-Container (R2): Kern-Fix wirkt verschachtelt, OHNE Over-Flag ──
    console.log('\n=== use-in-Container: <a><use/></a> → NUR use#inst geflaggt, a#link NICHT (kein Over-Flag) ===');
    const insNested = await P.inspect(SVG_NESTED);
    const elsNested = sceneEls(insNested.structured);
    const nLink = byId(elsNested, 'link');
    const nUse = byId(elsNested, 'inst');
    assert(
      'nested: use#inst wird gefunden',
      !!nUse,
      `ids=${JSON.stringify(elsNested.map((e) => `${e.tag}#${e.id}`))}`,
    );
    assert(
      "nested: use#inst color === 'indeterminate' (Kern-Fix wirkt auch verschachtelt)",
      nUse && nUse.color === 'indeterminate',
      nUse ? `got color=${JSON.stringify(nUse.color)}` : 'use#inst fehlt',
    );
    assert(
      "nested: use#inst warnings enthält 'USE_FILL_INDETERMINATE'",
      nUse &&
        Array.isArray(nUse.warnings) &&
        nUse.warnings.includes('USE_FILL_INDETERMINATE'),
      nUse ? `got warnings=${JSON.stringify(nUse.warnings ?? null)}` : 'use#inst fehlt',
    );
    assert(
      "nested: a#link trägt NICHT 'USE_FILL_INDETERMINATE' (Container-Farbe out-of-scope, KEIN Over-Flag)",
      nLink &&
        !(Array.isArray(nLink.warnings) && nLink.warnings.includes('USE_FILL_INDETERMINATE')),
      nLink ? `got warnings=${JSON.stringify(nLink.warnings ?? null)}` : 'a#link fehlt',
    );

    // ── KEIN-OVER-FLAG-Invariante: die 4 reproduzierten Engine-Fälle ─────────
    // Generischer Wächter: KEIN Nicht-use-Element darf 'USE_FILL_INDETERMINATE'
    // tragen, und ein per id erwartetes messbares Element behält seine echte Farbe.
    async function noOverFlag(label, svg, expects) {
      const els = sceneEls((await P.inspect(svg)).structured);
      const offenders = els.filter(
        (e) =>
          e.tag !== 'use' &&
          Array.isArray(e.warnings) &&
          e.warnings.includes('USE_FILL_INDETERMINATE'),
      );
      assert(
        `${label}: KEIN Nicht-use-Element trägt 'USE_FILL_INDETERMINATE'`,
        offenders.length === 0,
        `offenders=${JSON.stringify(offenders.map((e) => `${e.tag}#${e.id}`))} ` +
          `(alle ids=${JSON.stringify(els.map((e) => `${e.tag}#${e.id}`))})`,
      );
      for (const [id, color] of Object.entries(expects)) {
        const el = byId(els, id);
        assert(
          `${label}: #${id} behält messbare Farbe '${color}'`,
          el && el.color === color,
          el ? `got color=${JSON.stringify(el.color)}` : `#${id} fehlt (ids=${JSON.stringify(els.map((e) => `${e.tag}#${e.id}`))})`,
        );
      }
    }

    console.log('\n=== KEIN-OVER-FLAG-Invariante: 4 reproduzierte Engine-Fälle (Codex+Gemini) als Dauer-Regression ===');
    await noOverFlag('display:none-use', SVG_DISPNONE, { link: 'green', r: 'green' });
    await noOverFlag('Blatt-mit-use-Kind', SVG_LEAFUSE, { r1: 'green' });
    await noOverFlag('metadata-use', SVG_METADATA, { link: 'green', r: 'green' });
    await noOverFlag('filter-use', SVG_FILTER, { r: 'red' });

    // ── §3b-C: COLOR-Constraint gegen indeterminate → UNCHECKED, nie FAIL ─────
    // Blind-Trust-Schutz (Codex-R3): pass:false meldete eine FALSCHE Verletzung →
    // SCHÄDLICHE Korrektur auf eine womöglich schon korrekte use-Instanz-Farbe.
    // Unmessbar muss UNCHECKED (pass:null) sein, nicht FAIL.
    console.log('\n=== §3b-C Unit: COLOR gegen indeterminate → pass:null + MEASUREMENT_AMBIGUOUS ===');
    const cIndet = checkConstraint(
      'COLOR',
      { id: 'inst', tag: 'use', color: 'indeterminate' },
      null,
      { value: 'red' },
    );
    assert(
      "§3b-C: indeterminate → pass === null (UNCHECKED, NICHT false=FAIL)",
      cIndet.pass === null,
      `got ${JSON.stringify(cIndet)}`,
    );
    assert(
      "§3b-C: indeterminate → reasonCode === 'MEASUREMENT_AMBIGUOUS'",
      cIndet.reasonCode === 'MEASUREMENT_AMBIGUOUS',
      `got reasonCode=${JSON.stringify(cIndet.reasonCode)}`,
    );
    // Regress: echte Farben bleiben unangetastet (pass/fail wie vor 3b).
    const cMatch = checkConstraint(
      'COLOR',
      { id: 'r', tag: 'rect', color: 'red' },
      null,
      { value: 'red' },
    );
    assert(
      '§3b-C Regress: echte Farbe red vs red → pass === true',
      cMatch.pass === true,
      `got ${JSON.stringify(cMatch)}`,
    );
    const cFail = checkConstraint(
      'COLOR',
      { id: 'r', tag: 'rect', color: 'blue' },
      null,
      { value: 'red' },
    );
    assert(
      '§3b-C Regress: echter Fehl blue vs red → pass === false (echter Fail bleibt Fail)',
      cFail.pass === false,
      `got ${JSON.stringify(cFail)}`,
    );

    // ── §3b-C E2E (echte Pipeline P.analyze): use + COLOR → unchecked, NICHT failing ─
    console.log('\n=== §3b-C E2E: P.analyze(<use>, "#inst COLOR red") → unchecked, NICHT failing (keine schädliche Korrektur) ===');
    const e2e = await P.analyze(SVG_FIXED, ['#inst COLOR red']);
    const e2eStruct = e2e.structured;
    assert(
      'E2E: structured nicht null',
      e2eStruct !== null,
      `prose=${JSON.stringify(e2e.prose)}`,
    );
    const uncheckedInst =
      e2eStruct &&
      (e2eStruct.unchecked || []).find(
        (u) => u.element === '#inst' && u.constraint === 'COLOR',
      );
    assert(
      "E2E: #inst COLOR landet in unchecked mit reasonCode MEASUREMENT_AMBIGUOUS",
      uncheckedInst && uncheckedInst.reasonCode === 'MEASUREMENT_AMBIGUOUS',
      `got unchecked=${JSON.stringify(e2eStruct ? e2eStruct.unchecked : null)}`,
    );
    assert(
      'E2E: #inst COLOR NICHT in corrections (failing) — keine falsche Verletzung, keine schädliche Korrektur',
      e2eStruct &&
        !(e2eStruct.corrections || []).some((c) => c.element === '#inst'),
      `got corrections=${JSON.stringify(e2eStruct ? e2eStruct.corrections : null)}`,
    );
    assert(
      "E2E: status === 'PARTIAL' (unchecked>0 ∧ failing===0, NICHT FAIL)",
      e2eStruct && e2eStruct.status === 'PARTIAL',
      `got status=${JSON.stringify(e2eStruct ? e2eStruct.status : null)}`,
    );

    // ── Determinismus: 2× identisches Ergebnis (GETRENNTE Prozesse) ──────────
    console.log('\n=== Determinismus: 2× identisches Ergebnis (getrennte Prozesse) ===');
    const self = fileURLToPath(import.meta.url);
    function childRun() {
      const out = execFileSync(
        process.execPath,
        [self, '--child'],
        { encoding: 'utf8' },
      );
      const line = out.trim().split('\n').filter((l) => l.startsWith('CHILD_RESULT=')).pop();
      return line ? line.slice('CHILD_RESULT='.length) : null;
    }
    const run1 = childRun();
    const run2 = childRun();
    assert(
      'Determinismus: beide Kind-Prozesse liefern ein Ergebnis',
      run1 !== null && run2 !== null,
      `run1=${JSON.stringify(run1)} run2=${JSON.stringify(run2)}`,
    );
    assert(
      'Determinismus: 2× byte-identisches Ergebnis',
      run1 !== null && run1 === run2,
      `run1=${run1}\n           run2=${run2}`,
    );
  } finally {
    await P.shutdown();
  }

  console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error('Test-Lauf-Fehler:', e);
  process.exit(1);
});
