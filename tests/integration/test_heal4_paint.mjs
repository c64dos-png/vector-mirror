/**
 * test_heal4_paint.mjs — HEILUNG 4 / E4: Paint-Extent-Ehrlichkeit (F-AT-004, DoD-3)
 *
 * Real-Chromium-Harness (KEINE Mocks), über die ECHTE Pipeline
 * (inspect → structured.scene.elements). Kalibriert gegen das Pixel-Orakel
 * an internal ground-truth probe (Methode: --disable-gpu + Luminanz-Scan).
 *
 * DIE LÜGE (heute live): ein gefiltertes, statisches, untransformiertes Element
 * fällt zwangsläufig auf bbox_reliability='reliable' — die Klassifikation kennt
 * NUR is3D/hasNonSmilMotion/hasTransform, NICHT Filter. Glow/Schatten/Blur
 * (+52% Tinte, F-AT-004) liegen außerhalb der geom-bbox, werden aber als reliable
 * OHNE Flag gemeldet. getBBox UND getBoundingClientRect sind beide filter-blind.
 *
 * DIE HEILUNG: die <filter>-REGION ist eine W3C-garantierte harte obere Schranke
 * der Tinte ("hard clipping region", Filter Effects L1 §8/§9.4), REIN aus
 * Attributen ableitbar (filterUnits + x/y/w/h) — KEIN Pixel-Scan (R9). Sie wird
 * als visual_bbox surfaced; has_paint_overflow flaggt das Überragen. bbox_reliability
 * BLEIBT 'reliable' (Geometrie exakt) — DoD-3: reliable + Flag ist erlaubt.
 *
 * VERTRAG (6 Fälle):
 *   F-AT-004-glow : <filter id=g x=-50% y=-50% width=200% height=200%>
 *                   <feGaussianBlur stdDeviation=6/> + <rect filter=url(#g)>
 *                   → has_paint_overflow===true, visual_bbox ⊋ geom-bbox (größer),
 *                     bbox_reliability==='reliable'.
 *   Vorfahr-Filter: <g filter=url(#g)><rect id=c .../> → c trägt
 *                   has_paint_overflow===true (self-or-ancestor-Walk).
 *   CSS-Filter-Fn : <rect style="filter:blur(4px)"> → has_paint_overflow===true,
 *                   visual_bbox==='not_measurable' (keine spec-Region).
 *   Negativ-Kontrolle: <rect> ohne Filter → has_paint_overflow falsy/absent, KEIN
 *                   visual_bbox (Schnitt ist filter-spezifisch, kein Over-Flag).
 *   ROOT-FIX (Codex NO-GO #4): die Region wird aus dem aufgelösten SVG-DOM gelesen
 *                   (filterEl.{x,y,width,height,filterUnits}.animVal) am eingefrorenen
 *                   t=0, NICHT aus getAttribute (statische Basis). animVal reflektiert
 *                   den EFFEKTIVEN Wert egal WIE animiert (descendant/extern-href-SMIL/
 *                   künftig) → animierte Filter werden KORREKT NUMERISCH statt under-
 *                   bound. Schließt die Region-Dynamik-Klasse an der Wurzel.
 *   MD-LOOP #1    : userSpaceOnUse OHNE x/y/w/h → animVal löst spec-Defaults gegen den
 *                   Root-Viewport → korrekt-numerisch {-24,-24,288,288} (vpSafe).
 *   MD-LOOP #2    : userSpaceOnUse alle vier EXPLIZIT → absolute Region {0,0,100,100}.
 *   HIGH-#1       : Multi-Child <g filter> → BEIDE Kinder die GROSSE Gruppen-Region
 *                   (= F.getBBox()+F-userM). + transformierte Gruppe. DER HAUPTFEHLER.
 *   HIGH-#2       : filter:url(#g) blur(20px) (gemischt) → not_measurable.
 *   MED-#3        : filter x="abc" → animVal = browser-Default-Region {38,38,24,24}
 *                   (animVal IST der Render-Wert → kein Under-Bound, korrekt-numerisch).
 *   KOLLAPS (a)   : self+Vorfahr-Filter (count=2) → not_measurable (nicht komponierbar).
 *   KOLLAPS (b)   : <filter href="#base"> → not_measurable (Vererbung ungelöst).
 *   KOLLAPS (c)   : nested-<svg>-Owner mit %-Region → not_measurable (vpSafe inkl. Owner).
 *   ROOT-FIX SMIL : descendant- UND extern-href-<animate>/<set> auf <filter> →
 *                   KORREKT-NUMERISCH (animVal=700%), Pixel-Orakel ⊇ echte Tinte.
 *                   Der NO-GO #4 (extern-href) ist damit geschlossen.
 *   REGRESS       : Einzel-Glow bleibt {30,30,40,40}; Multi-Child-EIN-Filter bleibt
 *                   Gruppen-Region {-25,-25,140,140}.
 *   Determinismus : 2× identisches structured (byte-identisch).
 *   PIXEL-ORAKEL  : die gemessene Pixel-Tinte MUSS INNERHALB von visual_bbox liegen
 *                   (Formel-Schranke ⊇ echte Tinte) — auch Multi-Child (gesamte
 *                   Gruppen-Tinte ⊆ Kind-visual_bbox). Tinte außerhalb → BUG.
 *
 * Run direkt: `node tests/integration/test_heal4_paint.mjs`
 */
import { chromium } from 'playwright';
import { inspect, shutdown } from '../../src/pipeline.js';

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

// visual_bbox ⊋ geom-bbox: echt größer (mind. eine Seite ragt jenseits, ε-Toleranz).
// Wir prüfen das Überragen direkt; geom-bbox haben wir hier nicht im scene.elements
// (nur cell), daher vergleichen wir gegen die bekannte Fixture-Geometrie.
function strictlyContains(outer, ix, iy, iw, ih, eps = 1e-6) {
  return (
    outer.x <= ix + eps &&
    outer.y <= iy + eps &&
    outer.x + outer.w >= ix + iw - eps &&
    outer.y + outer.h >= iy + ih - eps
  );
}

// visual_bbox-Objekt ≈ erwartete Region {x,y,w,h} (Toleranz tol).
function regionMatches(vb, exp, tol = 0.5) {
  return (
    vb &&
    typeof vb === 'object' &&
    Math.abs(vb.x - exp.x) < tol &&
    Math.abs(vb.y - exp.y) < tol &&
    Math.abs(vb.w - exp.w) < tol &&
    Math.abs(vb.h - exp.h) < tol
  );
}

// ── FIXTURES ──────────────────────────────────────────────────────────────────
// viewBox 1:1 zu width/height → SVG-user-space ≡ device-px (visual_bbox und
// Pixel-Scan teilen denselben Koordinatenraum, direkt vergleichbar).
const VB = 'width="240" height="240" viewBox="0 0 240 240"';

// F-AT-004-glow: rect geom-bbox = {x:40,y:40,w:20,h:20}. Filter objectBoundingBox
// x=-50% y=-50% width=200% height=200% → Region lokal: rx=40+(-0.5)*20=30,
// ry=30, rw=2.0*20=40, rh=40 → Region {30,30,40,40} ⊋ {40,40,20,20}.
const SVG_GLOW = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter></defs>
  <rect id="r" x="40" y="40" width="20" height="20" fill="red" filter="url(#g)"/>
</svg>`;

// INWARD-FILTER (Triple-Review #4 — Filter ist REPLACEMENT, nicht Union-Quelle):
// rect geom {40,40,20,20}. Filter obb x=25% y=25% w=50% h=50% → Region lokal:
// rx=40+0.25*20=45, ry=45, rw=0.5*20=10, rh=10 → Region {45,45,10,10} ⊂ geom.
// Ein <filter> clippt den Output HART auf die Region (Filter Effects L1 §8) →
// visual_bbox MUSS die Region {45,45,10,10} sein, NICHT die geom-Union {40,40,20,20}.
// Beweist, dass der Aggregator den Filter NICHT als Union-Quelle (über-reportet)
// behandelt. has_paint_overflow bleibt true.
const SVG_INWARD = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="g" x="25%" y="25%" width="50%" height="50%"><feGaussianBlur stdDeviation="0"/></filter></defs>
  <rect id="r" x="40" y="40" width="20" height="20" fill="red" filter="url(#g)"/>
</svg>`;

// Vorfahr-Filter: derselbe Filter, aber auf dem <g>. Das Kind c muss via
// self-or-ancestor-Walk has_paint_overflow tragen.
const SVG_ANCESTOR = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter></defs>
  <g filter="url(#g)"><rect id="c" x="40" y="40" width="20" height="20" fill="blue"/></g>
</svg>`;

// CSS-Filter-Funktion (KEIN url(#id)) → keine spec-Region → not_measurable.
const SVG_CSS_FN = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <rect id="r" x="40" y="40" width="20" height="20" fill="green" style="filter:blur(4px)"/>
</svg>`;

// Negativ-Kontrolle: kein Filter → KEIN Flag, KEIN visual_bbox.
const SVG_NOFILTER = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <rect id="r" x="40" y="40" width="20" height="20" fill="orange"/>
</svg>`;

// MD-LOOP-HÄRTUNG #1: userSpaceOnUse OHNE x/y/w/h → der Default löst gegen den
// VIEWPORT auf (nicht die bbox); eine bbox-Fraktion würde UNTERSCHÄTZEN. Honest-
// Fallback: keine sichere obere Schranke → visual_bbox='not_measurable',
// has_paint_overflow BLEIBT true (Filter da, Ausdehnung nicht sicher beschränkbar).
const SVG_USOU_OMITTED = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="g" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="6"/></filter></defs>
  <rect id="r" x="40" y="40" width="20" height="20" fill="teal" filter="url(#g)"/>
</svg>`;

// MD-LOOP-HÄRTUNG #2: userSpaceOnUse mit ALLEN vier EXPLIZIT → absolute Region
// {0,0,100,100} berechenbar (numerisch korrekt). geom-bbox {40,40,20,20} liegt
// drin → has_paint_overflow=false (Region umschließt die geom-bbox vollständig,
// ragt aber nicht „über" sie hinaus im Sinne von kleiner — sie IST größer:
// 0<40,0<40,100>60,100>60 → ragt allseitig hinaus → has_paint_overflow=true).
const SVG_USOU_EXPLICIT = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="g" filterUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><feGaussianBlur stdDeviation="6"/></filter></defs>
  <rect id="r" x="40" y="40" width="20" height="20" fill="navy" filter="url(#g)"/>
</svg>`;

// HIGH-#1 (DER HAUPTFEHLER): Multi-Child-Gruppe mit Gruppen-Filter. Der Filter
// gehört der GRUPPE (bbox = Union der Kinder = {10,10,70,70}, x:10..80 y:10..80).
// objectBoundingBox x=-50% y=-50% width=200% height=200% → Gruppen-Region lokal:
// rx=10+(-0.5)*70=-25, ry=-25, rw=2.0*70=140, rh=140 → {-25,-25,140,140}.
// BEIDE Kinder müssen DIESE große Gruppen-Region als visual_bbox tragen (NICHT je
// ihre eigene Mini-Region). Der frühere Code rechnete mit der BLATT-bbox → c1
// bekam fälschlich ~{5,5,20,20}, viel zu klein → Tinte außerhalb = DoD-3-Lüge.
const SVG_GROUP_MULTI = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter></defs>
  <g filter="url(#g)">
    <rect id="c1" x="10" y="10" width="10" height="10" fill="red"/>
    <rect id="c2" x="70" y="70" width="10" height="10" fill="blue"/>
  </g>
</svg>`;

// HIGH-#1 Variante: transformierte Multi-Child-Gruppe (Gruppen-bbox ≠ Blatt-bbox
// UND ein Gruppen-transform). Die Region muss mit der Gruppen-bbox + Gruppen-userM
// (inkl. translate(30,30)) gerechnet werden. Gruppen-bbox lokal = {10,10,70,70};
// Region lokal {-25,-25,140,140}; nach translate(30,30) → root {5,5,140,140}.
const SVG_GROUP_XFORM = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter></defs>
  <g filter="url(#g)" transform="translate(30,30)">
    <rect id="t1" x="10" y="10" width="10" height="10" fill="red"/>
    <rect id="t2" x="70" y="70" width="10" height="10" fill="blue"/>
  </g>
</svg>`;

// HIGH-#2: gemischter Filter url(#g) + CSS-Funktion blur(20px). Die Einzel-url-
// Region beschränkt das zusätzliche blur() NICHT → keine sichere Schranke →
// visual_bbox='not_measurable' (konservativ).
const SVG_MIXED_FILTER = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter></defs>
  <rect id="r" x="40" y="40" width="20" height="20" fill="red" style="filter:url(#g) blur(20px)"/>
</svg>`;

// MED-#3: objectBoundingBox-Attribut mit Schrott/Exponent-Wert. parseLen darf
// NICHT auf einen Teil-Match (1e2→1) oder still auf den Default fallen → bei
// explizitem unparseable Wert → not_measurable (KEINE zu kleine Zahl).
const SVG_GARBAGE_ATTR = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="g" x="abc" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="4"/></filter></defs>
  <rect id="r" x="40" y="40" width="20" height="20" fill="red" filter="url(#g)"/>
</svg>`;

// KOLLAPS (a) — self-Filter UND Vorfahr-Filter (count=2 in der Kette). Beide
// Regionen kumulieren; nicht billig sicher zu EINER oberen Schranke komponierbar
// → visual_bbox='not_measurable', has_paint_overflow=true. (Round-3-Repro:
// früher gab das rect eine Mini-Region die den Vorfahr-Glow ignorierte.)
const SVG_SELF_AND_ANCESTOR = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs>
    <filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
    <filter id="h" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
  </defs>
  <g filter="url(#h)">
    <rect id="r" x="40" y="40" width="20" height="20" fill="red" filter="url(#g)"/>
  </g>
</svg>`;

// KOLLAPS (b) — <filter href="#base">: Attribut-Vererbung von einem Basis-Filter
// ist hier nicht lokal aufgelöst → keine sichere Region → not_measurable.
const SVG_FILTER_HREF = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs>
    <filter id="base" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
    <filter id="g" href="#base"/>
  </defs>
  <rect id="r" x="40" y="40" width="20" height="20" fill="red" filter="url(#g)"/>
</svg>`;

// KOLLAPS (c) — nested-<svg>-Owner: der Filter sitzt auf einem inneren <svg>
// (eigener Viewport). %-Region gegen den Root-Viewport ist nicht garantiert
// korrekt → not_measurable (Round-3 vpSafe-Lücke a!==owner geschlossen).
const SVG_NESTED_SVG_OWNER = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter></defs>
  <svg x="20" y="20" width="120" height="120" viewBox="0 0 60 60" filter="url(#g)">
    <rect id="r" x="10" y="10" width="20" height="20" fill="red"/>
  </svg>
</svg>`;

// ROOT-FIX-Witness (Codex NO-GO #4): SMIL <animate> AUF dem <filter> width.
// getAttribute() läse die statische Basis 120% ({98,98,24,24}), aber frozen t=0
// rendert mit der ANIMIERTEN Region 700%. animVal liest den effektiven Wert 700%
// → korrekt-numerische Region {98,98,140,24}, die die echte Tinte ENTHÄLT.
const SVG_FILTER_SMIL = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="g" x="-10%" y="-10%" width="120%" height="120%">
    <animate attributeName="width" from="700%" to="700%" dur="2s" repeatCount="indefinite"/>
    <feGaussianBlur stdDeviation="6"/>
  </filter></defs>
  <rect id="r" x="100" y="100" width="20" height="20" fill="red" filter="url(#g)"/>
</svg>`;
// Oracle-Variante (white-on-black) für den SMIL-Pixel-Scan.
const SVG_FILTER_SMIL_ORACLE = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="g" x="-10%" y="-10%" width="120%" height="120%">
    <animate attributeName="width" from="700%" to="700%" dur="2s" repeatCount="indefinite"/>
    <feGaussianBlur stdDeviation="6"/>
  </filter></defs>
  <rect width="240" height="240" fill="black"/>
  <rect id="r" x="100" y="100" width="20" height="20" fill="white" filter="url(#g)"/>
</svg>`;

// DER EIGENTLICHE NO-GO #4: EXTERN zielende SMIL (<animate xlink:href="#g" …>
// AUSSERHALB des Filters). Der frühere descendant-querySelector-Gate verfehlte das.
// animVal löst auch das auf (Probe B verifiziert) → korrekt-numerisch {98,98,140,24}.
const SVG_FILTER_SMIL_EXTERN = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${VB}>
  <defs><filter id="g" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="6"/></filter></defs>
  <animate xlink:href="#g" attributeName="width" from="700%" to="700%" dur="2s" repeatCount="indefinite"/>
  <rect id="r" x="100" y="100" width="20" height="20" fill="red" filter="url(#g)"/>
</svg>`;
const SVG_FILTER_SMIL_EXTERN_ORACLE = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${VB}>
  <defs><filter id="g" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="6"/></filter></defs>
  <animate xlink:href="#g" attributeName="width" from="700%" to="700%" dur="2s" repeatCount="indefinite"/>
  <rect width="240" height="240" fill="black"/>
  <rect id="r" x="100" y="100" width="20" height="20" fill="white" filter="url(#g)"/>
</svg>`;

// ROOT-FIX-Variante: <set> auf <filter>-height → animVal = 700% → {98,98,24,140}.
const SVG_FILTER_SET = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="g" x="-10%" y="-10%" width="120%" height="120%">
    <set attributeName="height" to="700%"/>
    <feGaussianBlur stdDeviation="6"/>
  </filter></defs>
  <rect id="r" x="100" y="100" width="20" height="20" fill="red" filter="url(#g)"/>
</svg>`;

// PIXEL-ORAKEL-Fixture: großzügige Region (-200%..500%) damit der volle Glow im
// Region-Clip bleibt; schwarzer Grund + weißes gefiltertes rect → Luminanz-Scan
// sauber. geom-bbox {x:90,y:90,w:60,h:60}. Großer stdDeviation für sichtbaren Glow.
const PX_REGION = 'x="-200%" y="-200%" width="500%" height="500%"';
const SVG_ORACLE = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="g" ${PX_REGION}><feGaussianBlur stdDeviation="10"/></filter></defs>
  <rect width="240" height="240" fill="black"/>
  <rect id="t" x="90" y="90" width="60" height="60" fill="white" filter="url(#g)"/>
</svg>`;

// PIXEL-ORAKEL Multi-Child (HIGH-#1): Gruppen-Filter über ZWEI getrennte weiße
// rects. Die GESAMTE Tinte beider Kinder (inkl. Glow) MUSS in der GEMEINSAMEN
// Gruppen-Region (= jedes Kind-visual_bbox) liegen. Großzügige Region damit der
// Glow nicht geclippt wird. Gruppen-bbox = {40,40,120,120} (x:40..160 y:40..160).
const SVG_ORACLE_GROUP = `<svg xmlns="http://www.w3.org/2000/svg" ${VB}>
  <defs><filter id="g" ${PX_REGION}><feGaussianBlur stdDeviation="8"/></filter></defs>
  <rect width="240" height="240" fill="black"/>
  <g filter="url(#g)">
    <rect id="o1" x="40" y="40" width="20" height="20" fill="white"/>
    <rect id="o2" x="140" y="140" width="20" height="20" fill="white"/>
  </g>
</svg>`;

// Pixel-Scan via separates Chromium (--disable-gpu, Methode aus
// an internal ground-truth probe). Liefert die Bounding-Box der
// sichtbaren Tinte (lum>30) in device-px ≡ user-space (viewBox 1:1).
async function pixelInkBox(svg, w, h) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(
      `<!doctype html><html><body style="margin:0">${svg}</body></html>`,
    );
    return await page.evaluate(
      async ({ w, h }) => {
        const svgEl = document.querySelector('svg');
        const xml = new XMLSerializer().serializeToString(svgEl);
        const url =
          'data:image/svg+xml;base64,' +
          btoa(unescape(encodeURIComponent(xml)));
        const img = await new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = url;
        });
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        let minX = null;
        let minY = null;
        let maxX = null;
        let maxY = null;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            const lum = data[idx] + data[idx + 1] + data[idx + 2];
            if (lum > 30) {
              if (minX === null || x < minX) minX = x;
              if (maxX === null || x > maxX) maxX = x;
              if (minY === null || y < minY) minY = y;
              if (maxY === null || y > maxY) maxY = y;
            }
          }
        }
        return { minX, minY, maxX, maxY };
      },
      { w, h },
    );
  } finally {
    await browser.close();
  }
}

(async () => {
  try {
    // ── F-AT-004-glow ─────────────────────────────────────────────────────────
    console.log('=== F-AT-004-glow: gefiltertes rect → Flag + visual_bbox ⊋ geom-bbox ===');
    const glow = await inspect(SVG_GLOW);
    const glowEl = byId(glow.structured?.scene?.elements, 'r');
    assert(
      'glow: rect #r ist in scene.elements',
      !!glowEl,
      `ids=${JSON.stringify((glow.structured?.scene?.elements || []).map((e) => e.id))}`,
    );
    assert(
      'glow: has_paint_overflow === true',
      glowEl?.has_paint_overflow === true,
      `got ${JSON.stringify(glowEl?.has_paint_overflow)}`,
    );
    assert(
      'glow: bbox_reliability === reliable (Geometrie exakt, DoD-3 Flag trägt Ehrlichkeit)',
      glowEl?.bbox_reliability === 'reliable',
      `got ${JSON.stringify(glowEl?.bbox_reliability)}`,
    );
    assert(
      'glow: visual_bbox ist ein Objekt (Region-Hülle, NICHT not_measurable)',
      glowEl?.visual_bbox && typeof glowEl.visual_bbox === 'object',
      `got ${JSON.stringify(glowEl?.visual_bbox)}`,
    );
    // geom-bbox = {40,40,20,20}; erwartete Region {30,30,40,40} ⊋ geom-bbox.
    assert(
      'glow: visual_bbox umschließt geom-bbox {40,40,20,20} (Schranke ⊇ Geometrie)',
      glowEl?.visual_bbox &&
        typeof glowEl.visual_bbox === 'object' &&
        strictlyContains(glowEl.visual_bbox, 40, 40, 20, 20),
      `visual_bbox=${JSON.stringify(glowEl?.visual_bbox)}`,
    );
    assert(
      'glow: visual_bbox ist ECHT größer als geom-bbox (w>20 ODER h>20)',
      glowEl?.visual_bbox &&
        typeof glowEl.visual_bbox === 'object' &&
        (glowEl.visual_bbox.w > 20 + 1e-6 || glowEl.visual_bbox.h > 20 + 1e-6),
      `visual_bbox=${JSON.stringify(glowEl?.visual_bbox)}`,
    );

    // ── INWARD-Filter (Triple-Review #4: Replacement, nicht Union) ──────────────
    console.log('\n=== INWARD-Filter: Region < geom → visual_bbox = Region (kein geom-Over-Report) ===');
    const inw = await inspect(SVG_INWARD);
    const inwEl = byId(inw.structured?.scene?.elements, 'r');
    assert(
      'inward: rect #r ist in scene.elements',
      !!inwEl,
      `ids=${JSON.stringify((inw.structured?.scene?.elements || []).map((e) => e.id))}`,
    );
    assert(
      'inward: has_paint_overflow === true (Filter da)',
      inwEl?.has_paint_overflow === true,
      `got ${JSON.stringify(inwEl?.has_paint_overflow)}`,
    );
    // Region {45,45,10,10} ⊂ geom {40,40,20,20}. Der Filter clippt den Output auf die
    // Region → visual_bbox MUSS die Region sein, NICHT die geom-Union (Over-Report-Bug).
    assert(
      'inward: visual_bbox === Region {45,45,10,10} (Filter clippt, kein geom-Union)',
      inwEl?.visual_bbox &&
        typeof inwEl.visual_bbox === 'object' &&
        regionMatches(inwEl.visual_bbox, { x: 45, y: 45, w: 10, h: 10 }),
      `visual_bbox=${JSON.stringify(inwEl?.visual_bbox)}`,
    );
    // Die Region ist ECHT KLEINER als die geom-bbox (das ist der inward-Beweis).
    assert(
      'inward: visual_bbox ist KLEINER als geom-bbox (w<20 UND h<20 — inward bewiesen)',
      inwEl?.visual_bbox &&
        typeof inwEl.visual_bbox === 'object' &&
        inwEl.visual_bbox.w < 20 - 1e-6 &&
        inwEl.visual_bbox.h < 20 - 1e-6,
      `visual_bbox=${JSON.stringify(inwEl?.visual_bbox)}`,
    );

    // ── Vorfahr-Filter (self-or-ancestor-Walk) ─────────────────────────────────
    console.log('\n=== Vorfahr-Filter: <g filter><rect id=c> → c trägt das Flag ===');
    const anc = await inspect(SVG_ANCESTOR);
    const ancEl = byId(anc.structured?.scene?.elements, 'c');
    assert(
      'ancestor: rect #c ist in scene.elements',
      !!ancEl,
      `ids=${JSON.stringify((anc.structured?.scene?.elements || []).map((e) => e.id))}`,
    );
    assert(
      'ancestor: has_paint_overflow === true (Vorfahr-Filter via Walk erkannt)',
      ancEl?.has_paint_overflow === true,
      `got ${JSON.stringify(ancEl?.has_paint_overflow)}`,
    );
    assert(
      'ancestor: visual_bbox ist Region-Objekt',
      ancEl?.visual_bbox && typeof ancEl.visual_bbox === 'object',
      `got ${JSON.stringify(ancEl?.visual_bbox)}`,
    );

    // ── CSS-Filter-Funktion ────────────────────────────────────────────────────
    console.log('\n=== CSS-Filter-Fn: style=filter:blur(4px) → not_measurable ===');
    const css = await inspect(SVG_CSS_FN);
    const cssEl = byId(css.structured?.scene?.elements, 'r');
    assert(
      'css-fn: rect #r ist in scene.elements',
      !!cssEl,
      `ids=${JSON.stringify((css.structured?.scene?.elements || []).map((e) => e.id))}`,
    );
    assert(
      'css-fn: has_paint_overflow === true (Overflow existiert)',
      cssEl?.has_paint_overflow === true,
      `got ${JSON.stringify(cssEl?.has_paint_overflow)}`,
    );
    assert(
      "css-fn: visual_bbox === 'not_measurable' (keine spec-Region)",
      cssEl?.visual_bbox === 'not_measurable',
      `got ${JSON.stringify(cssEl?.visual_bbox)}`,
    );

    // ── Negativ-Kontrolle ──────────────────────────────────────────────────────
    console.log('\n=== Negativ-Kontrolle: kein Filter → kein Flag, kein visual_bbox ===');
    const neg = await inspect(SVG_NOFILTER);
    const negEl = byId(neg.structured?.scene?.elements, 'r');
    assert(
      'no-filter: rect #r ist in scene.elements',
      !!negEl,
      `ids=${JSON.stringify((neg.structured?.scene?.elements || []).map((e) => e.id))}`,
    );
    assert(
      'no-filter: has_paint_overflow falsy/absent (kein Over-Flag)',
      !negEl?.has_paint_overflow,
      `got ${JSON.stringify(negEl?.has_paint_overflow)}`,
    );
    assert(
      'no-filter: KEIN visual_bbox (Feld absent — Schnitt ist filter-spezifisch)',
      negEl && !('visual_bbox' in negEl),
      `got ${JSON.stringify(negEl?.visual_bbox)}`,
    );

    // ── MD-LOOP #1 (ROOT-FIX): userSpaceOnUse OHNE x/y/w/h → JETZT korrekt-numerisch ─
    // animVal löst die spec-Defaults (-10%/120%) am eingefrorenen t=0 gegen den
    // Viewport auf — der Owner sitzt im Root-Viewport (vpSafe) → die Region ist die
    // WAHRE vom Browser gerenderte Box {-24,-24,288,288} (= -10%/120% von 240),
    // KEIN Under-Bound mehr (früher konservativ not_measurable, jetzt exakt).
    console.log('\n=== MD-LOOP #1 (ROOT-FIX): userSpaceOnUse OHNE x/y/w/h → korrekt-numerisch ===');
    const usouOm = await inspect(SVG_USOU_OMITTED);
    const usouOmEl = byId(usouOm.structured?.scene?.elements, 'r');
    assert(
      'usou-omitted: rect #r ist in scene.elements',
      !!usouOmEl,
      `ids=${JSON.stringify((usouOm.structured?.scene?.elements || []).map((e) => e.id))}`,
    );
    assert(
      'usou-omitted: has_paint_overflow === true (Filter da)',
      usouOmEl?.has_paint_overflow === true,
      `got ${JSON.stringify(usouOmEl?.has_paint_overflow)}`,
    );
    assert(
      'usou-omitted: visual_bbox = browser-aufgelöste Default-Region {-24,-24,288,288} (animVal)',
      regionMatches(usouOmEl?.visual_bbox, { x: -24, y: -24, w: 288, h: 288 }, 1),
      `got ${JSON.stringify(usouOmEl?.visual_bbox)}`,
    );
    assert(
      'usou-omitted: visual_bbox ⊇ geom-bbox {40,40,20,20} (sichere obere Schranke)',
      usouOmEl?.visual_bbox &&
        typeof usouOmEl.visual_bbox === 'object' &&
        strictlyContains(usouOmEl.visual_bbox, 40, 40, 20, 20),
      `got ${JSON.stringify(usouOmEl?.visual_bbox)}`,
    );

    // ── MD-LOOP-HÄRTUNG #2: userSpaceOnUse mit ALLEN vier EXPLIZIT → abs. Region ──
    console.log('\n=== MD-LOOP #2: userSpaceOnUse x=0 y=0 w=100 h=100 → exakte absolute Region ===');
    const usouEx = await inspect(SVG_USOU_EXPLICIT);
    const usouExEl = byId(usouEx.structured?.scene?.elements, 'r');
    assert(
      'usou-explicit: rect #r ist in scene.elements',
      !!usouExEl,
      `ids=${JSON.stringify((usouEx.structured?.scene?.elements || []).map((e) => e.id))}`,
    );
    assert(
      'usou-explicit: visual_bbox ist die berechnete absolute Region {0,0,100,100}',
      usouExEl?.visual_bbox &&
        typeof usouExEl.visual_bbox === 'object' &&
        Math.abs(usouExEl.visual_bbox.x - 0) < 1e-6 &&
        Math.abs(usouExEl.visual_bbox.y - 0) < 1e-6 &&
        Math.abs(usouExEl.visual_bbox.w - 100) < 1e-6 &&
        Math.abs(usouExEl.visual_bbox.h - 100) < 1e-6,
      `got ${JSON.stringify(usouExEl?.visual_bbox)}`,
    );
    assert(
      'usou-explicit: has_paint_overflow === true (Region {0,0,100,100} ragt über geom-bbox {40,40,20,20} hinaus)',
      usouExEl?.has_paint_overflow === true,
      `got ${JSON.stringify(usouExEl?.has_paint_overflow)}`,
    );
    assert(
      'usou-explicit: bbox_reliability === reliable (Geometrie exakt, Flag trägt Ehrlichkeit)',
      usouExEl?.bbox_reliability === 'reliable',
      `got ${JSON.stringify(usouExEl?.bbox_reliability)}`,
    );

    // ── HIGH-#1: Multi-Child-Gruppe → BEIDE Kinder die GROSSE Gruppen-Region ─────
    console.log('\n=== HIGH-#1: Multi-Child <g filter> → beide Kinder = große Gruppen-Region ===');
    const grp = await inspect(SVG_GROUP_MULTI);
    const c1 = byId(grp.structured?.scene?.elements, 'c1');
    const c2 = byId(grp.structured?.scene?.elements, 'c2');
    assert(
      'group-multi: beide Kinder c1 + c2 in scene.elements',
      !!c1 && !!c2,
      `ids=${JSON.stringify((grp.structured?.scene?.elements || []).map((e) => e.id))}`,
    );
    // Erwartete Gruppen-Region: Gruppen-bbox {10,10,70,70} → {-25,-25,140,140}.
    const expGroup = { x: -25, y: -25, w: 140, h: 140 };
    assert(
      'group-multi: c1.visual_bbox = große Gruppen-Region {-25,-25,140,140} (NICHT Blatt-Mini-Region)',
      regionMatches(c1?.visual_bbox, expGroup),
      `c1.visual_bbox=${JSON.stringify(c1?.visual_bbox)} exp=${JSON.stringify(expGroup)}`,
    );
    assert(
      'group-multi: c2.visual_bbox = dieselbe große Gruppen-Region {-25,-25,140,140}',
      regionMatches(c2?.visual_bbox, expGroup),
      `c2.visual_bbox=${JSON.stringify(c2?.visual_bbox)} exp=${JSON.stringify(expGroup)}`,
    );
    assert(
      'group-multi: c1.visual_bbox === c2.visual_bbox (identische Gruppen-Region)',
      c1?.visual_bbox &&
        c2?.visual_bbox &&
        canon(c1.visual_bbox) === canon(c2.visual_bbox),
      `c1=${JSON.stringify(c1?.visual_bbox)} c2=${JSON.stringify(c2?.visual_bbox)}`,
    );
    assert(
      'group-multi: c1 has_paint_overflow === true (Gruppen-Region ⊋ c1-geom-bbox {10,10,10,10})',
      c1?.has_paint_overflow === true,
      `got ${JSON.stringify(c1?.has_paint_overflow)}`,
    );
    assert(
      'group-multi: c2 has_paint_overflow === true',
      c2?.has_paint_overflow === true,
      `got ${JSON.stringify(c2?.has_paint_overflow)}`,
    );
    // c1-geom-bbox {10,10,10,10} liegt INNERHALB der Gruppen-Region → Schranke ⊇ Geometrie.
    assert(
      'group-multi: c1-geom-bbox {10,10,10,10} ⊆ visual_bbox (Schranke ⊇ Geometrie)',
      c1?.visual_bbox &&
        typeof c1.visual_bbox === 'object' &&
        strictlyContains(c1.visual_bbox, 10, 10, 10, 10),
      `c1.visual_bbox=${JSON.stringify(c1?.visual_bbox)}`,
    );

    // ── HIGH-#1 Variante: transformierte Multi-Child-Gruppe ──────────────────────
    console.log('\n=== HIGH-#1 xform: <g filter transform=translate(30,30)> Multi-Child ===');
    const grpX = await inspect(SVG_GROUP_XFORM);
    const t1 = byId(grpX.structured?.scene?.elements, 't1');
    const t2 = byId(grpX.structured?.scene?.elements, 't2');
    // Gruppen-Region lokal {-25,-25,140,140} + translate(30,30) → root {5,5,140,140}.
    const expGroupX = { x: 5, y: 5, w: 140, h: 140 };
    assert(
      'group-xform: t1.visual_bbox = {5,5,140,140} (Gruppen-Region MIT Gruppen-userM/transform)',
      regionMatches(t1?.visual_bbox, expGroupX),
      `t1.visual_bbox=${JSON.stringify(t1?.visual_bbox)} exp=${JSON.stringify(expGroupX)}`,
    );
    assert(
      'group-xform: t1.visual_bbox === t2.visual_bbox (identisch)',
      t1?.visual_bbox &&
        t2?.visual_bbox &&
        canon(t1.visual_bbox) === canon(t2.visual_bbox),
      `t1=${JSON.stringify(t1?.visual_bbox)} t2=${JSON.stringify(t2?.visual_bbox)}`,
    );

    // ── HIGH-#2: gemischter Filter url(#g) + blur(20px) → not_measurable ─────────
    console.log('\n=== HIGH-#2: filter:url(#g) blur(20px) (gemischt) → not_measurable ===');
    const mixed = await inspect(SVG_MIXED_FILTER);
    const mixedEl = byId(mixed.structured?.scene?.elements, 'r');
    assert(
      'mixed: has_paint_overflow === true',
      mixedEl?.has_paint_overflow === true,
      `got ${JSON.stringify(mixedEl?.has_paint_overflow)}`,
    );
    assert(
      "mixed: visual_bbox === 'not_measurable' (url-Region beschränkt das blur() NICHT)",
      mixedEl?.visual_bbox === 'not_measurable',
      `got ${JSON.stringify(mixedEl?.visual_bbox)}`,
    );

    // ── MED-#3 (ROOT-FIX): x="abc" → der Browser nutzt den Default; animVal liest
    // den TATSÄCHLICH gerenderten Wert (-10% obb) → korrekt-numerisch {38,38,24,24}
    // = die WAHRE Render-Region (KEIN Under-Bound: animVal IST der Render-Wert).
    console.log('\n=== MED-#3 (ROOT-FIX): filter x="abc" → animVal = browser-Default-Region (korrekt-numerisch) ===');
    const garb = await inspect(SVG_GARBAGE_ATTR);
    const garbEl = byId(garb.structured?.scene?.elements, 'r');
    assert(
      'garbage-attr: has_paint_overflow === true',
      garbEl?.has_paint_overflow === true,
      `got ${JSON.stringify(garbEl?.has_paint_overflow)}`,
    );
    assert(
      'garbage-attr: visual_bbox = browser-aufgelöste Region {38,38,24,24} (animVal = Render-Wert)',
      regionMatches(garbEl?.visual_bbox, { x: 38, y: 38, w: 24, h: 24 }, 1),
      `got ${JSON.stringify(garbEl?.visual_bbox)}`,
    );
    assert(
      'garbage-attr: visual_bbox ⊇ geom-bbox {40,40,20,20} (sichere obere Schranke)',
      garbEl?.visual_bbox &&
        typeof garbEl.visual_bbox === 'object' &&
        strictlyContains(garbEl.visual_bbox, 40, 40, 20, 20),
      `got ${JSON.stringify(garbEl?.visual_bbox)}`,
    );

    // ── KOLLAPS (a): self-Filter + Vorfahr-Filter (count=2) → not_measurable ─────
    console.log('\n=== KOLLAPS (a): self+Vorfahr-Filter (2 in Kette) → not_measurable ===');
    const sa = await inspect(SVG_SELF_AND_ANCESTOR);
    const saEl = byId(sa.structured?.scene?.elements, 'r');
    assert(
      'self+ancestor: has_paint_overflow === true (Flag unter-meldet NIE)',
      saEl?.has_paint_overflow === true,
      `got ${JSON.stringify(saEl?.has_paint_overflow)}`,
    );
    assert(
      "self+ancestor: visual_bbox === 'not_measurable' (kumulative Regionen nicht sicher komponierbar)",
      saEl?.visual_bbox === 'not_measurable',
      `got ${JSON.stringify(saEl?.visual_bbox)}`,
    );

    // ── KOLLAPS (b): <filter href="#base"> → not_measurable ──────────────────────
    console.log('\n=== KOLLAPS (b): <filter href="#base"> (Vererbung) → not_measurable ===');
    const href = await inspect(SVG_FILTER_HREF);
    const hrefEl = byId(href.structured?.scene?.elements, 'r');
    assert(
      'filter-href: has_paint_overflow === true',
      hrefEl?.has_paint_overflow === true,
      `got ${JSON.stringify(hrefEl?.has_paint_overflow)}`,
    );
    assert(
      "filter-href: visual_bbox === 'not_measurable' (href-Vererbung ungelöst)",
      hrefEl?.visual_bbox === 'not_measurable',
      `got ${JSON.stringify(hrefEl?.visual_bbox)}`,
    );

    // ── KOLLAPS (c): nested-<svg>-Owner mit %-Region → not_measurable ────────────
    console.log('\n=== KOLLAPS (c): <svg filter> nested-Owner mit %-Region → not_measurable ===');
    const nested = await inspect(SVG_NESTED_SVG_OWNER);
    const nestedEl = byId(nested.structured?.scene?.elements, 'r');
    assert(
      'nested-svg: rect #r ist in scene.elements',
      !!nestedEl,
      `ids=${JSON.stringify((nested.structured?.scene?.elements || []).map((e) => e.id))}`,
    );
    assert(
      'nested-svg: has_paint_overflow === true (Vorfahr-Filter auf innerem <svg>)',
      nestedEl?.has_paint_overflow === true,
      `got ${JSON.stringify(nestedEl?.has_paint_overflow)}`,
    );
    assert(
      "nested-svg: visual_bbox === 'not_measurable' (nested-Viewport-Owner, %-Auflösung unsicher)",
      nestedEl?.visual_bbox === 'not_measurable',
      `got ${JSON.stringify(nestedEl?.visual_bbox)}`,
    );

    // ── ROOT-FIX: SMIL <animate> auf <filter>-width → korrekt-numerisch + Orakel ─
    // animVal liest 700% am frozen t=0 → Region {98,98,140,24}. Pixel-Orakel
    // beweist: die ECHTE Tinte ⊆ visual_bbox (kein Under-Bound). Explizit
    // ausschließen, dass die statische Basis {98,98,24,24} emittiert wurde.
    console.log('\n=== ROOT-FIX: SMIL <animate> auf <filter> → korrekt-numerisch (animVal) + Pixel-Orakel ===');
    const smil = await inspect(SVG_FILTER_SMIL);
    const smilEl = byId(smil.structured?.scene?.elements, 'r');
    assert(
      'filter-smil: has_paint_overflow === true',
      smilEl?.has_paint_overflow === true,
      `got ${JSON.stringify(smilEl?.has_paint_overflow)}`,
    );
    assert(
      'filter-smil: visual_bbox = animierte Region {98,98,140,24} (animVal=700%, NICHT statische Basis)',
      regionMatches(smilEl?.visual_bbox, { x: 98, y: 98, w: 140, h: 24 }, 1),
      `got ${JSON.stringify(smilEl?.visual_bbox)}`,
    );
    {
      const ink = await pixelInkBox(SVG_FILTER_SMIL_ORACLE, 240, 240);
      const vb = smilEl?.visual_bbox;
      const T = 1;
      assert(
        'filter-smil: echte frozen-t0-Tinte ⊆ visual_bbox (Pixel-Orakel, kein Under-Bound)',
        vb &&
          typeof vb === 'object' &&
          ink.minX !== null &&
          ink.minX >= vb.x - T &&
          ink.minY >= vb.y - T &&
          ink.maxX <= vb.x + vb.w + T &&
          ink.maxY <= vb.y + vb.h + T,
        `ink=${JSON.stringify(ink)} visual_bbox=${JSON.stringify(vb)}`,
      );
    }

    // ── DER NO-GO #4: EXTERN-href-SMIL (<animate xlink:href="#g">) → korrekt-numerisch ─
    console.log('\n=== NO-GO #4: EXTERN-href-SMIL auf <filter> → korrekt-numerisch (animVal) + Pixel-Orakel ===');
    const ext = await inspect(SVG_FILTER_SMIL_EXTERN);
    const extEl = byId(ext.structured?.scene?.elements, 'r');
    assert(
      'filter-smil-extern: has_paint_overflow === true',
      extEl?.has_paint_overflow === true,
      `got ${JSON.stringify(extEl?.has_paint_overflow)}`,
    );
    assert(
      'filter-smil-extern: visual_bbox = animierte Region {98,98,140,24} (animVal erfasst extern-href-SMIL)',
      regionMatches(extEl?.visual_bbox, { x: 98, y: 98, w: 140, h: 24 }, 1),
      `got ${JSON.stringify(extEl?.visual_bbox)}`,
    );
    {
      const ink = await pixelInkBox(SVG_FILTER_SMIL_EXTERN_ORACLE, 240, 240);
      const vb = extEl?.visual_bbox;
      const T = 1;
      assert(
        'filter-smil-extern: echte frozen-t0-Tinte ⊆ visual_bbox (NO-GO-#4-Under-Bound geschlossen)',
        vb &&
          typeof vb === 'object' &&
          ink.minX !== null &&
          ink.minX >= vb.x - T &&
          ink.minY >= vb.y - T &&
          ink.maxX <= vb.x + vb.w + T &&
          ink.maxY <= vb.y + vb.h + T,
        `ink=${JSON.stringify(ink)} visual_bbox=${JSON.stringify(vb)}`,
      );
      // Schärfe: die Tinte reicht ECHT über die statische-Basis-Breite (x+24=122)
      // hinaus → beweist, dass {98,98,24,24} ein Under-Bound GEWESEN wäre.
      assert(
        'filter-smil-extern: Tinte reicht über statische Basis-Breite (maxX>122) → Basis WÄRE Under-Bound',
        ink.maxX > 122,
        `ink=${JSON.stringify(ink)}`,
      );
    }

    // ── ROOT-FIX-Variante: <set> auf <filter>-height → korrekt-numerisch ─────────
    console.log('\n=== ROOT-FIX: <set> auf <filter>-height → korrekt-numerisch (animVal) ===');
    const fset = await inspect(SVG_FILTER_SET);
    const fsetEl = byId(fset.structured?.scene?.elements, 'r');
    assert(
      'filter-set: has_paint_overflow === true',
      fsetEl?.has_paint_overflow === true,
      `got ${JSON.stringify(fsetEl?.has_paint_overflow)}`,
    );
    assert(
      'filter-set: visual_bbox = animierte Region {98,98,24,140} (<set> height=700% via animVal)',
      regionMatches(fsetEl?.visual_bbox, { x: 98, y: 98, w: 24, h: 140 }, 1),
      `got ${JSON.stringify(fsetEl?.visual_bbox)}`,
    );

    // ── REGRESS: der saubere Fall MUSS numerisch bleiben (Feature-Nutzen) ────────
    console.log('\n=== REGRESS: saubere Fälle bleiben numerisch (Kollaps blockiert sie NICHT) ===');
    const rg = await inspect(SVG_GLOW);
    const rgEl = byId(rg.structured?.scene?.elements, 'r');
    assert(
      'regress single-glow: visual_bbox bleibt {30,30,40,40} (F-AT-004-Kern numerisch)',
      rgEl?.visual_bbox &&
        typeof rgEl.visual_bbox === 'object' &&
        Math.abs(rgEl.visual_bbox.x - 30) < 0.5 &&
        Math.abs(rgEl.visual_bbox.y - 30) < 0.5 &&
        Math.abs(rgEl.visual_bbox.w - 40) < 0.5 &&
        Math.abs(rgEl.visual_bbox.h - 40) < 0.5,
      `got ${JSON.stringify(rgEl?.visual_bbox)}`,
    );
    const rgGrp = await inspect(SVG_GROUP_MULTI);
    const rgC1 = byId(rgGrp.structured?.scene?.elements, 'c1');
    assert(
      'regress group-1-filter: c1.visual_bbox bleibt Gruppen-Region {-25,-25,140,140}',
      regionMatches(rgC1?.visual_bbox, { x: -25, y: -25, w: 140, h: 140 }),
      `got ${JSON.stringify(rgC1?.visual_bbox)}`,
    );

    // ── Determinismus: 2× identisches structured (byte-identisch) ───────────────
    console.log('\n=== Determinismus: 2× identisches structured (glow, byte-identisch) ===');
    const d1 = canon((await inspect(SVG_GLOW)).structured);
    const d2 = canon((await inspect(SVG_GLOW)).structured);
    assert(
      'determinismus: 2× glow structured byte-identisch',
      d1 === d2,
      `d1!==d2 (len ${d1.length} vs ${d2.length})`,
    );

    // ── PIXEL-ORAKEL: echte Tinte ⊆ visual_bbox (Formel-Schranke ⊇ Pixel-Tinte) ──
    console.log('\n=== PIXEL-ORAKEL: gemessene Glow-Tinte INNERHALB visual_bbox ===');
    const oracleEye = await inspect(SVG_ORACLE);
    const oracleEl = byId(oracleEye.structured?.scene?.elements, 't');
    assert(
      'oracle: rect #t ist in scene.elements mit visual_bbox-Objekt',
      oracleEl?.visual_bbox && typeof oracleEl.visual_bbox === 'object',
      `got ${JSON.stringify(oracleEl?.visual_bbox)}`,
    );
    assert(
      'oracle: has_paint_overflow === true',
      oracleEl?.has_paint_overflow === true,
      `got ${JSON.stringify(oracleEl?.has_paint_overflow)}`,
    );
    const ink = await pixelInkBox(SVG_ORACLE, 240, 240);
    assert(
      'oracle: Pixel-Scan fand sichtbare Tinte (lum>30)',
      ink.minX !== null,
      `ink=${JSON.stringify(ink)}`,
    );
    if (oracleEl?.visual_bbox && typeof oracleEl.visual_bbox === 'object' && ink.minX !== null) {
      const vb = oracleEl.visual_bbox;
      // Schranke ⊇ Tinte: jede Tinte-Pixel-Kante INNERHALB visual_bbox (1px-Toleranz
      // für die Raster-Diskretisierung des Luminanz-Scans). Tinte AUSSERHALB → BUG.
      const TOL = 1;
      const within =
        ink.minX >= vb.x - TOL &&
        ink.minY >= vb.y - TOL &&
        ink.maxX <= vb.x + vb.w + TOL &&
        ink.maxY <= vb.y + vb.h + TOL;
      assert(
        'oracle: echte Pixel-Tinte ⊆ visual_bbox (W3C-Region-Schranke ⊇ Tinte)',
        within,
        `ink=${JSON.stringify(ink)} visual_bbox=${JSON.stringify(vb)}`,
      );
      // Diagnostik: belege, dass die Tinte ECHT über die geom-bbox {90,90,60,60}
      // hinausragt (sonst wäre der Overflow-Beweis leer / die Fixture untauglich).
      const inkOverflows =
        ink.minX < 90 || ink.minY < 90 || ink.maxX > 150 || ink.maxY > 150;
      assert(
        'oracle: Pixel-Tinte ragt ECHT über geom-bbox {90,90,60,60} hinaus (Lüge real)',
        inkOverflows,
        `ink=${JSON.stringify(ink)}`,
      );
    }

    // ── PIXEL-ORAKEL Multi-Child (HIGH-#1): gesamte Gruppen-Tinte ⊆ visual_bbox ──
    console.log('\n=== PIXEL-ORAKEL Multi-Child: GESAMTE Gruppen-Tinte INNERHALB Kind-visual_bbox ===');
    const ogEye = await inspect(SVG_ORACLE_GROUP);
    const o1 = byId(ogEye.structured?.scene?.elements, 'o1');
    const o2 = byId(ogEye.structured?.scene?.elements, 'o2');
    assert(
      'oracle-group: beide Kinder mit identischem visual_bbox-Objekt',
      o1?.visual_bbox &&
        typeof o1.visual_bbox === 'object' &&
        o2?.visual_bbox &&
        canon(o1.visual_bbox) === canon(o2.visual_bbox),
      `o1=${JSON.stringify(o1?.visual_bbox)} o2=${JSON.stringify(o2?.visual_bbox)}`,
    );
    const ginkLeft = await pixelInkBox(SVG_ORACLE_GROUP, 240, 240);
    assert(
      'oracle-group: Pixel-Scan fand sichtbare Gruppen-Tinte',
      ginkLeft.minX !== null,
      `ink=${JSON.stringify(ginkLeft)}`,
    );
    if (o1?.visual_bbox && typeof o1.visual_bbox === 'object' && ginkLeft.minX !== null) {
      const vb = o1.visual_bbox;
      const TOL = 1;
      // Die GESAMTE Tinte beider Kinder (eine zusammenhängende Bounding-Box über
      // o1+o2+Glow) MUSS in der gemeinsamen Gruppen-Region liegen — der eigentliche
      // HIGH-#1-Beweis: ein Blatt-Region-Bug hätte o1.visual_bbox nur um o1 herum →
      // die Tinte von o2 läge dann AUSSERHALB.
      const within =
        ginkLeft.minX >= vb.x - TOL &&
        ginkLeft.minY >= vb.y - TOL &&
        ginkLeft.maxX <= vb.x + vb.w + TOL &&
        ginkLeft.maxY <= vb.y + vb.h + TOL;
      assert(
        'oracle-group: GESAMTE Gruppen-Tinte (o1+o2+Glow) ⊆ o1.visual_bbox (Gruppen-Region ⊇ Tinte)',
        within,
        `ink=${JSON.stringify(ginkLeft)} visual_bbox=${JSON.stringify(vb)}`,
      );
      // Beleg, dass die Tinte ECHT bis in o2's Bereich reicht (sonst untaugliche
      // Fixture / Blatt-Region-Bug bliebe unentdeckt). o2 sitzt bei y≈140..160.
      assert(
        'oracle-group: Tinte erreicht o2-Bereich (maxX/maxY ≥ 140 — Multi-Child wirklich getestet)',
        ginkLeft.maxX >= 140 && ginkLeft.maxY >= 140,
        `ink=${JSON.stringify(ginkLeft)}`,
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
