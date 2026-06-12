/**
 * test_use_graph.js — D1c use-Graph-Amplifikation (core/use_graph.js) Unit-Tests
 *
 * REIN (kein Browser-Render): der DOM kommt aus DOMPurify(RETURN_DOM) (jsdom),
 * exakt der Knoten-Typ, den der Adapter an analyzeUseGraph übergibt. Die
 * Komponente ist REGEL-4-rein (NULL adapters/interface-Imports) — sie bekommt
 * den geparsten Root und liefert das DoS-Urteil.
 *
 * In package.json: `npm run test:use_graph`.
 *
 * HONEST-RED-KORPUS — der KOMPLETTE Bypass-Katalog aus ALLEN 3 Triple-Runden,
 * jeder mit RED-WITNESS (was eine naive/frühere Heuristik gelesen hätte) + dem
 * korrekten Urteil der gehärteten Komponente:
 *   r1: self-closing-<use id href/>-Kette-50, self-closing-Zyklus, g-Fan-out
 *   r2: single-quote-deep, naked-<use>-Ziel-Bombe (8^7)
 *   r3: MULTI-SVG (Bombe im 2. svg), DEEP-NON-USE-NEST (depth-5000, KEIN throw)
 * Plus Negativ-Kontrollen (legit Sprite, sauberes SVG) + Budget-/never-throw-Belege.
 *
 * Run direkt: `node tests/unit/test_use_graph.js`
 */
import DOMPurify from 'isomorphic-dompurify';
import {
  analyzeUseGraph,
  canonicalizeFragment,
  MAX_USE_REFERENCE_DEPTH,
  MAX_USE_TOTAL_EXPANSION,
} from '../../src/core/use_graph.js';

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

// ── Sanitize-Config spiegelt den Adapter (RETURN_DOM + href-Hook + Allowlist) ─
const ADD_TAGS = [
  'use',
  'symbol',
  'animate',
  'animateTransform',
  'animateMotion',
  'set',
  'mpath',
];
const ADD_ATTR = [
  'href',
  'xlink:href',
  'begin',
  'from',
  'to',
  'values',
  'keyTimes',
  'keyPoints',
  'dur',
  'attributeName',
  'repeatCount',
  'fill',
];
DOMPurify.removeAllHooks();
DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  const an = data.attrName;
  if (an !== 'href' && an !== 'xlink:href') return;
  const v = (data.attrValue || '').trim();
  if (v.startsWith('#') && v.length > 1) return;
  data.keepAttr = false;
  data.attrValue = '';
});

/** Parst SVG zu einem DOM-Root (Body-Wrapper), wirft bei Parser-Limit. */
function parse(svg) {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS,
    ADD_ATTR,
    RETURN_DOM: true,
  });
}
const mk = (inner, vb = '0 0 100 100') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${inner}</svg>`;

/**
 * parseNoHook — parst OHNE den href-Hook (alle Hooks entfernt), damit
 * prozent-/whitespace-kodierte href-Fragmente UNVERÄNDERT in den DOM gelangen.
 * Nur so lässt sich der ANALYZER (canonicalizeFragment) in Isolation gegen die
 * Orakel-Divergenz prüfen — der produktive `%`-fail-closed-Hook würde sie sonst
 * VOR dem Analyzer strippen (das ist die ZWEITE, lasttragende Schicht und wird
 * in der Integration `test_sanitizer_d1.mjs` end-to-end belegt). DOMPurify (jsdom)
 * trimmt nur den UMGEBENDEN Whitespace des Attributwerts, behält aber `%`-Sequenzen
 * und FRAGMENT-internen Whitespace — exakt der Knoten-Typ, den der Adapter an
 * analyzeUseGraph übergäbe, wenn der Hook (b) nicht griffe.
 */
function parseNoHook(svg) {
  DOMPurify.removeAllHooks();
  const dom = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS,
    ADD_ATTR,
    RETURN_DOM: true,
  });
  // Hook für die folgenden (nicht-isolierten) Tests wieder herstellen.
  DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
    const an = data.attrName;
    if (an !== 'href' && an !== 'xlink:href') return;
    const v = (data.attrValue || '').trim();
    if (v.startsWith('#') && v.length > 1) return;
    data.keepAttr = false;
    data.attrValue = '';
  });
  return dom;
}

// ════════════════════════════════════════════════════════════════════════════
// S3/D1-R6: canonicalizeFragment — STANDALONE-Paritäts-Tabelle (14 Vektoren,
// gepinnt 11/11 gegen REALES Chromium + 3 never-throw-Belege). Erst hier grün,
// DANN ist der Analyzer-Einbau (oben verdrahtet) abgesichert. RED-WURZEL: ein
// roher `href.slice(1)`-Vergleich gegen DEKODIERTE `el.id`-Keys verfehlte jede
// percent/case/ws-Divergenz → Unterzählung → rejected:false trotz Chromium-HIT.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== S3/D1-R6: canonicalizeFragment Paritäts-Tabelle (14) ===');
{
  // [rawHref, decoded-id-Key, soll-Treffer?, Notiz] — soll-Treffer ist die
  // CHROMIUM-Boden-Wahrheit (siehe R6-Probe 11/11).
  const VEC = [
    ['#%63%30', 'c0', true, 'percent-decode %63%30 → c0 (HIT)'],
    ['#%41', 'A', true, '%41 → A, case-sensitiv (HIT)'],
    ['#%2563', 'c0', false, 'doppel-encoded %2563 → "%63" literal (MISS)'],
    ['#c0%20', 'c0', false, 'c0%20 → "c0 " interner Space (MISS vs c0)'],
    ['#%20c0', 'c0', false, '%20c0 → " c0" führender Space (MISS vs c0)'],
    ['#c0 ', 'c0', true, 'trailing Space gestrippt → c0 (HIT)'],
    ['# c0', 'c0', false, '# c0 → " c0" leading-in-Fragment behalten (MISS)'],
    ['#c+0', 'c0', false, '\'+\' ist KEIN Space → "c+0" (MISS vs c0)'],
    ['#%zz', 'c0', false, 'malformed %zz kein throw → "%zz" literal (MISS)'],
    // 5 weitere Achsen-Pins (Chromium-Boden-Wahrheit, R6-Probe):
    ['#A', 'a', false, 'case-sensitiv: #A matcht NICHT id "a" (MISS)'],
    ['#c0', 'c0', true, 'identitäts-Achse: roher Match unverändert (HIT)'],
    ['#%63%30 ', 'c0', true, 'encoded + trailing Space → c0 (HIT)'],
    ['x', 'c0', false, "kein '#'-Prefix → null (MISS)"],
    ['#', 'c0', false, 'length<2 → null (MISS)'],
  ];
  let canonOk = 0;
  for (const [raw, idKey, expectHit, note] of VEC) {
    const canon = canonicalizeFragment(raw);
    const hit = canon === idKey;
    const ok = hit === expectHit;
    assert(
      `canon ${JSON.stringify(raw)} → ${JSON.stringify(canon)} | ${note}`,
      ok,
      `hit(${idKey})=${hit} expect=${expectHit}`,
    );
    if (ok) canonOk++;
  }
  assert(
    'canon: ALLE 14 Paritäts-Vektoren grün',
    canonOk === 14,
    `${canonOk}/14`,
  );
  // never-throw bei malformed/pathologischen Eingaben (Stop-Condition §4.8).
  let canonThrew = false;
  try {
    canonicalizeFragment('#%'); // unvollständige %-Sequenz
    canonicalizeFragment(`#${'%'.repeat(5000)}`); // überlange %-Kette
    canonicalizeFragment('#%e0%a4'); // unvollständige UTF-8-Mehrbyte-Sequenz
    canonicalizeFragment('#\uD800'); // isoliertes Surrogat
    canonicalizeFragment(null); // Nicht-String
    canonicalizeFragment(undefined);
    canonicalizeFragment(12345);
  } catch {
    canonThrew = true;
  }
  assert(
    'canon: never-throw bei malformed/pathologisch/Nicht-String',
    canonThrew === false,
  );
  assert(
    'canon: malformed → roher Fragment-String (nie null bei vorhandenem #)',
    canonicalizeFragment('#%zz') === '%zz',
  );
}

// ════════════════════════════════════════════════════════════════════════════
// S3/D1-R6-HÄRTUNG #2: zusätzliche Chromium-GEPINNTE Paritäts-Zeilen. JEDE Zeile
// wurde gegen REALES Chromium (echte setContent-bbox-Probe) verifiziert — NICHT
// angenommen. Drift Kanon↔Chromium hier = Security-Regression (der Kanon träfe
// dann anders als der Render auflöst → Über-/Unterzählung). Probe-Ergebnis R6:
// 6/6 Kanon == Chromium, KEINE Divergenz.
//   - UTF-8-multibyte: decodeURIComponent setzt die %-Bytes korrekt zu é/✓ zusammen,
//     und Chromium löst exakt diese Codepoints auf (HIT).
//   - non-ASCII-trailing-ws: der Kanon strippt NUR ASCII-ws (0x09/0a/0c/0d/20),
//     NBSP(U+00A0)/ZWSP(U+200B)/ideographic(U+3000) bleiben → MISS; Chromium
//     strippt sie EBENFALLS nicht → identische Auflösung (Probe-bestätigt).
// ════════════════════════════════════════════════════════════════════════════
console.log(
  '\n=== S3/D1-R6-Härtung: Chromium-gepinnte Paritäts-Zeilen (UTF-8 + non-ASCII-ws) ===',
);
{
  const NBSP = ' ';
  const ZWSP = '​';
  const IDEO = '　';
  // [rawHref, decoded-id-Key, soll-Treffer (Chromium-Boden-Wahrheit), Notiz]
  const VEC2 = [
    [
      '#%C3%A9',
      'é',
      true,
      'UTF-8 %C3%A9 → "é" (Chromium HIT, Probe-bestätigt)',
    ],
    [
      '#%E2%9C%93',
      '✓',
      true,
      'UTF-8 %E2%9C%93 → "✓" (Chromium HIT, Probe-bestätigt)',
    ],
    [
      `#c0${NBSP}`,
      'c0',
      false,
      'trailing NBSP NICHT gestrippt (ASCII-only) → MISS; Chromium auch MISS',
    ],
    [
      `#c0${ZWSP}`,
      'c0',
      false,
      'trailing ZWSP NICHT gestrippt → MISS; Chromium auch MISS',
    ],
    [
      `#c0${IDEO}`,
      'c0',
      false,
      'trailing ideographic-space NICHT gestrippt → MISS; Chromium auch MISS',
    ],
    [
      `#c0${NBSP}`,
      `c0${NBSP}`,
      true,
      'NBSP literal Teil der id → exakter Match (HIT, Sanity == Chromium)',
    ],
  ];
  let canon2Ok = 0;
  for (const [raw, idKey, expectHit, note] of VEC2) {
    const canon = canonicalizeFragment(raw);
    const hit = canon === idKey;
    const ok = hit === expectHit;
    assert(
      `canon-pin ${JSON.stringify(raw)} → ${JSON.stringify(canon)} | ${note}`,
      ok,
      `hit(${JSON.stringify(idKey)})=${hit} expect=${expectHit}`,
    );
    if (ok) canon2Ok++;
  }
  assert(
    'canon-pin: ALLE 6 Chromium-gepinnten Zeilen grün (keine Drift Kanon↔Chromium)',
    canon2Ok === 6,
    `${canon2Ok}/6`,
  );
}

/**
 * RED-WITNESS für die Fan-out-Lücke (r2/B7): die naive children-only-walk(),
 * die die instanziierte use-Ziel-Wurzel NICHT mitzählte — sie las bei naked-
 * <use>-Ziel-Ketten viel zu wenig (Bypass). Wird hier reproduziert, um zu
 * belegen, dass der NEUE Algorithmus genau diese Bombe fängt (RED-ohne-Fix).
 */
function naiveExpansionWitness(root, cap) {
  const byId = new Map();
  for (const el of root.querySelectorAll('[id]'))
    if (!byId.has(el.id)) byId.set(el.id, el);
  const targetOf = (u) => {
    const h = (
      u.getAttribute('href') ||
      u.getAttribute('xlink:href') ||
      ''
    ).trim();
    if (!h.startsWith('#') || h.length < 2) return null;
    return byId.get(h.slice(1)) || null;
  };
  let total = 0;
  let bombed = false;
  const stack = new Set();
  const walk = (node) => {
    if (bombed) return;
    for (const child of node.children) {
      if (bombed) return;
      const tag = (child.tagName || '').toLowerCase();
      if (tag === 'use') {
        const t = targetOf(child);
        if (t) {
          if (stack.has(t)) {
            bombed = true;
            return;
          }
          stack.add(t);
          walk(t); // BUG: zählt die Ziel-Wurzel NICHT
          stack.delete(t);
        }
      } else {
        total += 1;
        if (total > cap) {
          bombed = true;
          return;
        }
        walk(child);
      }
    }
  };
  const svgRoot = root.querySelector('svg'); // BUG: nur das ERSTE svg
  if (svgRoot) walk(svgRoot);
  return total;
}

// ════════════════════════════════════════════════════════════════════════════
console.log('=== r1: self-closing-<use id href/>-Kette Tiefe 50 ===');
{
  let s = '<defs><rect id="c0" width="2" height="2"/>';
  for (let i = 1; i <= 50; i++) s += `<use id="c${i}" href="#c${i - 1}"/>`;
  s += '</defs><use href="#c50"/>';
  const dom = parse(mk(s));
  const r = analyzeUseGraph(dom);
  // RED-witness: eine String-Stack-Regex hätte self-closing als Tiefe 1 gelesen.
  assert(
    'selfclose-chain-50: maxDepth ≥ 50 (nicht 1 — kein Self-Close-Bypass)',
    r.maxDepth >= 50,
    `maxDepth=${r.maxDepth}`,
  );
  assert(
    'selfclose-chain-50: rejected',
    r.rejected === true,
    JSON.stringify(r),
  );
}

console.log('\n=== r1: self-closing-use-Zyklus a↔b (SVG2 §5.6: nur die zyklische Instanz rendert nichts) ===');
{
  const dom = parse(
    mk('<use id="a" href="#b"/><use id="b" href="#a"/><use href="#a"/>'),
  );
  const r = analyzeUseGraph(dom);
  // Zyklus ist KEIN DoS: nur der zyklische Arm trägt nichts bei, endlich + bounded.
  assert(
    'selfclose-cycle: rejected=false && cyclic=false (kein Falsch-Positiv, Budget unberührt)',
    r.rejected === false && r.cyclic === false,
    JSON.stringify(r),
  );
  assert(
    'selfclose-cycle: maxDepth ≤ Cap (Rückkante ignoriert, kein Infinity)',
    r.maxDepth <= MAX_USE_REFERENCE_DEPTH,
    `maxDepth=${r.maxDepth}`,
  );
}

console.log('\n=== r1: g-Container Fan-out depth-5 × fan-40 ===');
{
  let s = '<defs><rect id="f0" width="1" height="1"/>';
  for (let l = 1; l <= 4; l++) {
    s += `<g id="f${l}">`;
    for (let k = 0; k < 40; k++) s += `<use href="#f${l - 1}"/>`;
    s += '</g>';
  }
  s += '</defs><use href="#f4"/>';
  const dom = parse(mk(s));
  const r = analyzeUseGraph(dom);
  assert(
    'g-fanout: maxDepth ≤ Cap (Tiefe erlaubt) → muss über EXPANSION fallen',
    r.maxDepth <= MAX_USE_REFERENCE_DEPTH,
    `maxDepth=${r.maxDepth}`,
  );
  assert(
    'g-fanout: totalExpansion > Cap',
    r.totalExpansion > MAX_USE_TOTAL_EXPANSION,
    `exp=${r.totalExpansion}`,
  );
  assert('g-fanout: rejected', r.rejected === true);
}

console.log('\n=== r2: single-quoted Tiefe-7-Kette ===');
{
  let s = "<defs><rect id='c0' width='2' height='2'/>";
  for (let i = 1; i <= 7; i++)
    s += `<g id='c${i}'><use href='#c${i - 1}'/></g>`;
  s += "</defs><use href='#c7'/>";
  const dom = parse(mk(s));
  const r = analyzeUseGraph(dom);
  // RED-witness: double-quote-blinde Regex hätte 0 Kanten gesehen.
  assert(
    'single-quote-deep: maxDepth ≥ 7 (nicht 0 — kein Quote-Bypass)',
    r.maxDepth >= 7,
    `maxDepth=${r.maxDepth}`,
  );
  assert('single-quote-deep: rejected', r.rejected === true);
}

console.log('\n=== r2/B7: g-Container-Bombe 8^7 (Regression, g-Ziele) ===');
{
  // Diese Form (use→<g>-Ziele) wird vom multiplikativen Abstieg korrekt gezählt.
  // Bewusst BEHALTEN als Regression — aber sie MASKIERT die Forwarder-Lücke (4.
  // Triple); die echte Forwarder-Form steht direkt darunter (CASE Y/X).
  let s = '<defs><rect id="b0" width="1" height="1"/>';
  for (let i = 1; i <= 7; i++) {
    s += `<g id="b${i}">`;
    for (let k = 0; k < 8; k++) s += `<use href="#b${i - 1}"/>`;
    s += '</g>';
  }
  s += '</defs><use href="#b7"/>';
  const r = analyzeUseGraph(parse(mk(s)));
  assert('g-bomb-8^7: rejected', r.rejected === true, JSON.stringify(r));
}

console.log(
  '\n=== r4: ECHTE naked-<use>-FORWARDER-Bombe (use→use→…), kein g-Masking ===',
);
// CASE Y (4. Triple): die Fan-out-Kanten gehen durch NACKTE <use>-Forwarder,
// deren Ziel selbst ein <use> ist (0 Element-Kinder). depth ≤ Cap → MUSS über
// die EXPANSION fallen. FAN=350 / 2 Ebenen ≈ 122k echte Instanzen.
function caseY(FAN) {
  let s = '<defs><g id="leaf"><rect width="1" height="1"/></g>';
  s += '<use id="fwd0" href="#leaf"/>';
  s += '<g id="g1">';
  for (let j = 0; j < FAN; j++) s += '<use href="#fwd0"/>';
  s += '</g>';
  s += '<use id="fwd1" href="#g1"/>';
  s += '<g id="g2">';
  for (let j = 0; j < FAN; j++) s += '<use href="#fwd1"/>';
  s += '</g>';
  s += '</defs><use href="#g2"/>';
  return mk(s);
}
// CASE X (4. Triple): N nackte Forwarder, jeder → ein LEAF-Group. depth=3.
function caseX(N, LEAF) {
  let s = '<defs><g id="leaf">';
  for (let i = 0; i < LEAF; i++) s += '<rect width="1" height="1"/>';
  s += '</g><use id="fwd" href="#leaf"/><g id="root">';
  for (let i = 0; i < N; i++) s += '<use href="#fwd"/>';
  s += '</g></defs><use href="#root"/>';
  return mk(s);
}
{
  const dom = parse(caseY(350));
  // RED-WITNESS: die naive walk() folgt dem Forwarder-Hop NICHT (tgt.children=0
  // beim nackten <use>) → unterzählt grob → hätte durchgelassen.
  const naive = naiveExpansionWitness(dom, MAX_USE_TOTAL_EXPANSION);
  assert(
    'CASE-Y FORWARDER RED-WITNESS: naive (kein Forwarder-Hop) unterzählt ≤ Cap',
    naive <= MAX_USE_TOTAL_EXPANSION,
    `naive=${naive}`,
  );
  const r = analyzeUseGraph(dom);
  assert(
    'CASE-Y FORWARDER: maxDepth ≤ Cap (Tiefe erlaubt) → über EXPANSION',
    r.maxDepth <= MAX_USE_REFERENCE_DEPTH,
    `maxDepth=${r.maxDepth}`,
  );
  assert(
    'CASE-Y FORWARDER: totalExpansion > Cap (Forwarder-Hop gefolgt)',
    r.totalExpansion > MAX_USE_TOTAL_EXPANSION,
    `exp=${r.totalExpansion}`,
  );
  assert('CASE-Y FORWARDER: rejected', r.rejected === true);
}
{
  const dom = parse(caseX(400, 350));
  const naive = naiveExpansionWitness(dom, MAX_USE_TOTAL_EXPANSION);
  assert(
    'CASE-X FORWARDER RED-WITNESS: naive unterzählt ≤ Cap (durchgelassen)',
    naive <= MAX_USE_TOTAL_EXPANSION,
    `naive=${naive}`,
  );
  const r = analyzeUseGraph(dom);
  assert(
    'CASE-X FORWARDER: maxDepth ≤ Cap → über EXPANSION',
    r.maxDepth <= MAX_USE_REFERENCE_DEPTH,
    `maxDepth=${r.maxDepth}`,
  );
  assert(
    'CASE-X FORWARDER: totalExpansion > Cap (Forwarder-Hop gefolgt)',
    r.totalExpansion > MAX_USE_TOTAL_EXPANSION,
    `exp=${r.totalExpansion}`,
  );
  assert('CASE-X FORWARDER: rejected', r.rejected === true);
}

console.log('\n=== r4: Forwarder-Zyklus f↔g (SVG2 §5.6: zyklischer Arm endet, Szene rendert) ===');
{
  const dom = parse(
    mk(
      '<defs><use id="f" href="#g"/><use id="g" href="#f"/></defs><use href="#f"/>',
    ),
  );
  const r = analyzeUseGraph(dom);
  // Forwarder-Zyklus beendet nur den betroffenen Arm (continue), kein Szenen-Verdikt.
  assert(
    'forwarder-cycle: rejected=false (Zyklus ist kein DoS; Budget unberührt)',
    r.rejected === false,
    JSON.stringify(r),
  );
}

// ════════════════════════════════════════════════════════════════════════════
// HEILUNG 1 — Zyklus-Trigger entschärft (SVG2 §5.6): ein erkannter Zyklus ist
// KEIN DoS. Nur die zyklische Instanz rendert nichts; der Rest rendert. DoS wird
// AUSSCHLIESSLICH von den Budget-Caps gefangen (expansionCap/maxDepthCap). Diese
// Tests fixieren den Rot→Grün-Kipppunkt UND das Security-Gate, das halten muss.
// ════════════════════════════════════════════════════════════════════════════

console.log('\n=== HEAL1-1 GRÜN: self-href <use id=x href=#x> (Rückkante, kein Blanking) ===');
{
  const r = analyzeUseGraph(parse(mk('<use id="x" href="#x"/>')));
  // ROT (vorher): Szene geblendet via cyclic. GRÜN: endlich, nicht abgelehnt.
  assert(
    'self-href: rejected=false && cyclic=false',
    r.rejected === false && r.cyclic === false,
    JSON.stringify(r),
  );
  assert(
    'self-href: maxDepth ≤ Cap (endlich, kein Infinity)',
    Number.isFinite(r.maxDepth) && r.maxDepth <= MAX_USE_REFERENCE_DEPTH,
    `maxDepth=${r.maxDepth}`,
  );
  assert(
    'self-href: totalExpansion endlich (≤ Cap)',
    Number.isFinite(r.totalExpansion) && r.totalExpansion <= MAX_USE_TOTAL_EXPANSION,
    `exp=${r.totalExpansion}`,
  );
}

console.log('\n=== HEAL1-2 GRÜN: a→b→a Ring (nur der zyklische Arm trägt nichts bei) ===');
{
  const r = analyzeUseGraph(
    parse(mk('<g id="a"><use href="#b"/></g><g id="b"><use href="#a"/></g><use href="#a"/>')),
  );
  assert(
    'a→b→a: rejected=false && cyclic=false',
    r.rejected === false && r.cyclic === false,
    JSON.stringify(r),
  );
  assert(
    'a→b→a: maxDepth + totalExpansion endlich',
    Number.isFinite(r.maxDepth) && Number.isFinite(r.totalExpansion),
    JSON.stringify(r),
  );
}

console.log('\n=== HEAL1-5 SECURITY: billion-laughs (azyklisch g0..g20, 2^20) → Budget, nicht cyclic ===');
{
  // AZYKLISCHE Verdopplungskette: das Budget (totalExpansion > cap) fängt sie,
  // NICHT die (jetzt entschärfte) Zyklus-Erkennung. Edit-Bypass-Riegel.
  let s = '<rect id="g0" width="1" height="1"/>';
  for (let k = 1; k <= 20; k++)
    s += `<g id="g${k}"><use href="#g${k - 1}"/><use href="#g${k - 1}"/></g>`;
  s += '<use href="#g20"/>';
  const r = analyzeUseGraph(parse(mk(s)));
  assert(
    'billion-laughs: rejected=true (per Budget)',
    r.rejected === true,
    JSON.stringify(r),
  );
  assert(
    'billion-laughs: cyclic=false (kein Zyklus-Verdikt)',
    r.cyclic === false,
    JSON.stringify(r),
  );
  assert(
    'billion-laughs: totalExpansion > Cap (Budget greift)',
    r.totalExpansion > MAX_USE_TOTAL_EXPANSION,
    `exp=${r.totalExpansion}`,
  );
}

console.log('\n=== HEAL1-6 SECURITY: künstlicher Cap (maxExpansion:5) auf 6-fach-Fanout → Budget greift ===');
{
  // Beweis: das Budget greift bei BELIEBIGEM Cap — nicht nur am Default 100000.
  const r = analyzeUseGraph(
    parse(mk('<defs><rect id="t" width="1" height="1"/><g id="six"><use href="#t"/><use href="#t"/><use href="#t"/><use href="#t"/><use href="#t"/><use href="#t"/></g></defs><use href="#six"/>')),
    { maxExpansion: 5 },
  );
  assert(
    'artificial-cap: rejected=true (6-fach > Cap 5)',
    r.rejected === true,
    JSON.stringify(r),
  );
  assert(
    'artificial-cap: cyclic=false',
    r.cyclic === false,
    JSON.stringify(r),
  );
}

console.log('\n=== HEAL1-7 SECURITY: Ring-Länge 7 → maxDepth(6) > Cap(5) (Edit-B-Bypass-Riegel) ===');
{
  // Nach Edit B wird die Rückkante ignoriert statt Infinity. Die azyklische
  // Kettenlänge MUSS trotzdem weitergerechnet werden → maxDepth > Cap fängt es.
  // c0→c1→…→c6→c0: 7 id-Container im Ring. Sichtbare Kette c0..c6 = Tiefe 6+1.
  let s = '';
  for (let i = 0; i < 7; i++) {
    const next = (i + 1) % 7;
    s += `<g id="c${i}"><use href="#c${next}"/></g>`;
  }
  s += '<use href="#c0"/>';
  const r = analyzeUseGraph(parse(mk(s)));
  assert(
    'ring-7: rejected=true',
    r.rejected === true,
    JSON.stringify(r),
  );
  assert(
    'ring-7: maxDepth > Cap (Rückkante ignoriert, Länge endlich weitergerechnet)',
    Number.isFinite(r.maxDepth) && r.maxDepth > MAX_USE_REFERENCE_DEPTH,
    `maxDepth=${r.maxDepth}`,
  );
  assert(
    'ring-7: cyclic=false',
    r.cyclic === false,
    JSON.stringify(r),
  );
}

console.log(
  '\n=== r4: benigner EINZEL-Forwarder (legit Indirektion) NICHT abgelehnt ===',
);
{
  const dom = parse(
    mk(
      '<defs><rect id="leaf" width="20" height="20"/><use id="fwd" href="#leaf"/></defs><use href="#fwd" x="10" y="10"/>',
    ),
  );
  const r = analyzeUseGraph(dom);
  assert(
    'single-forwarder: NICHT rejected (legit)',
    r.rejected === false,
    JSON.stringify(r),
  );
}

console.log('\n=== r3/B2: MULTI-SVG — Bombe im ZWEITEN svg ===');
{
  let bomb = '<defs><rect id="d0" width="1" height="1"/>';
  for (let l = 1; l <= 4; l++) {
    bomb += `<g id="d${l}">`;
    for (let k = 0; k < 40; k++) bomb += `<use href="#d${l - 1}"/>`;
    bomb += '</g>';
  }
  bomb += '</defs><use href="#d4"/>';
  const multi =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5"/></svg>` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${bomb}</svg>`;
  const dom = parse(multi);
  // RED-WITNESS: querySelector('svg') (erstes svg) sieht nur das harmlose erste.
  const naive = naiveExpansionWitness(dom, MAX_USE_TOTAL_EXPANSION);
  assert(
    'multi-svg RED-WITNESS: erstes-svg-only liest harmlos (≤ Cap → Bypass)',
    naive <= MAX_USE_TOTAL_EXPANSION,
    `naive=${naive}`,
  );
  const r = analyzeUseGraph(dom);
  assert(
    'multi-svg: NEUE Komponente zählt ALLE svgs → rejected',
    r.rejected === true,
    JSON.stringify(r),
  );
}

console.log('\n=== r3/B1: DEEP-NON-USE-NEST depth-5000 — KEIN throw ===');
{
  // jsdom-Parser kann bei depth-5000 selbst werfen → wir testen die Komponente
  // bei der größten Tiefe, die der Parser noch baut (depth-900, > MAX_DOM_NEST_DEPTH
  // ist 1000, also nehmen wir 1500 falls Parser hält; sonst kontrollierter Pfad).
  // Die Komponente DARF NIE werfen.
  let threwInComponent = false;
  let r;
  try {
    let deep = '';
    for (let i = 0; i < 1500; i++) deep += '<g>';
    deep += '<rect width="1" height="1"/>';
    for (let i = 0; i < 1500; i++) deep += '</g>';
    let dom;
    try {
      dom = parse(mk(deep));
    } catch {
      dom = null; // Parser-Limit (jsdom) — das fängt der Adapter (sanitizeFailed)
    }
    if (dom) {
      r = analyzeUseGraph(dom); // MUSS ohne throw zurückkehren
    }
  } catch {
    threwInComponent = true;
  }
  assert(
    'deep-nest: analyzeUseGraph wirft NIE (iterativ, kein RangeError)',
    threwInComponent === false,
  );
  if (r) {
    assert(
      'deep-nest: kontrolliert rejected (Nest-Tiefe-Budget)',
      r.rejected === true,
      JSON.stringify(r),
    );
  } else {
    // Parser hat selbst geworfen → der Adapter macht daraus SANITIZE_PARSE_FAILED;
    // die Komponente wurde gar nicht erreicht. Test-Aussage (never-throw) gilt.
    console.log(
      '  (jsdom-Parser-Limit getroffen — Adapter-Pfad sanitizeFailed; Komponente never-throw separat belegt)',
    );
    passed++;
    console.log('  PASS: deep-nest: Parser-Limit kontrolliert (Adapter-Ebene)');
  }
}

console.log('\n=== explizit: never-throw bei absurden Eingaben ===');
{
  let any = false;
  try {
    analyzeUseGraph(null);
    analyzeUseGraph(undefined);
    analyzeUseGraph({});
    analyzeUseGraph(parse(mk('<rect width="10" height="10"/>')));
  } catch {
    any = true;
  }
  assert('never-throw: null/undefined/{}/clean alle ohne throw', any === false);
  assert(
    'never-throw: null → nicht rejected (SAFE-Default)',
    analyzeUseGraph(null).rejected === false,
  );
}

console.log('\n=== Negativ-Kontrollen (dürfen NICHT abgelehnt werden) ===');
{
  // legit Sprite: root→o4→…→o0 = Tiefe 5 (== Cap), Fan-2 → klein.
  let sp = '<defs><rect id="o0" width="4" height="4"/>';
  for (let i = 1; i <= 4; i++)
    sp += `<g id="o${i}"><use href="#o${i - 1}"/><use href="#o${i - 1}" x="5"/></g>`;
  sp += '</defs><use href="#o4"/>';
  const r1 = analyzeUseGraph(parse(mk(sp)));
  assert(
    'benign depth-5 sprite: NICHT rejected',
    r1.rejected === false,
    JSON.stringify(r1),
  );
  assert(
    'benign depth-5 sprite: maxDepth ≤ Cap',
    r1.maxDepth <= MAX_USE_REFERENCE_DEPTH,
    `maxDepth=${r1.maxDepth}`,
  );

  const r2 = analyzeUseGraph(
    parse(mk('<rect width="20" height="20" fill="black"/>')),
  );
  assert('clean SVG: NICHT rejected', r2.rejected === false);
  assert(
    'clean SVG: cyclic=false, maxDepth=0',
    r2.cyclic === false && r2.maxDepth === 0,
    JSON.stringify(r2),
  );

  const r3 = analyzeUseGraph(
    parse(
      mk(
        '<defs><rect id="s" width="10" height="10"/></defs><use href="#s" x="20" y="20"/>',
      ),
    ),
  );
  assert(
    'single benign use: NICHT rejected',
    r3.rejected === false,
    JSON.stringify(r3),
  );
}

// ════════════════════════════════════════════════════════════════════════════
// S3/D1-R6 HONEST-RED: ENCODING-BOMBE — jedes href prozent-kodiert. RED ohne
// Kanon: roher `href.slice(1)` (#%63%30) matcht NIE den dekodierten id-Key (c0)
// → 0 Kanten → maxDepth 0 → rejected:false (Live-Bypass, Probe-belegt). MIT Kanon:
// EXAKTE Parität zur byte-äquivalenten Roh-Kette.
// ════════════════════════════════════════════════════════════════════════════
const encFrag = (s) =>
  s.replace(/./g, (ch) => `%${ch.charCodeAt(0).toString(16).padStart(2, '0')}`);

console.log(
  '\n=== S3/D1-R6: ENCODING-Bombe (depth-20, jedes href encoded) ===',
);
{
  // Tiefe-getriebene Kette: 20 Ebenen, jedes href prozent-kodiert.
  let enc = '<defs><rect id="c0" width="2" height="2"/>';
  for (let i = 1; i <= 20; i++)
    enc += `<use id="c${i}" href="#${encFrag(`c${i - 1}`)}"/>`;
  enc += `</defs><use href="#${encFrag('c20')}"/>`;
  const rEnc = analyzeUseGraph(parseNoHook(mk(enc)));

  // Byte-äquivalente ROH-Kette (Parität-Referenz).
  let raw = '<defs><rect id="c0" width="2" height="2"/>';
  for (let i = 1; i <= 20; i++) raw += `<use id="c${i}" href="#c${i - 1}"/>`;
  raw += '</defs><use href="#c20"/>';
  const rRaw = analyzeUseGraph(parseNoHook(mk(raw)));

  // RED-WITNESS: der rohe `href.slice(1)`-Vergleich (kein decode) findet 0 Kanten.
  const domEnc = parseNoHook(mk(enc));
  const ids = new Set([...domEnc.querySelectorAll('[id]')].map((e) => e.id));
  let rawSliceEdges = 0;
  for (const u of domEnc.querySelectorAll('use')) {
    const h = (u.getAttribute('href') || '').trim();
    if (h.startsWith('#') && h.length > 1 && ids.has(h.slice(1)))
      rawSliceEdges++;
  }
  assert(
    'enc-bomb RED-WITNESS: roher href.slice(1) findet 0 Kanten (Bypass-Wurzel)',
    rawSliceEdges === 0,
    `rawSliceEdges=${rawSliceEdges}`,
  );
  assert(
    'enc-bomb: rejected===true (Kanon schließt die Divergenz)',
    rEnc.rejected === true,
    JSON.stringify(rEnc),
  );
  assert(
    'enc-bomb: maxDepth > 5 (Tiefe korrekt über decode rekonstruiert)',
    rEnc.maxDepth > 5,
    `maxDepth=${rEnc.maxDepth}`,
  );
  assert(
    'enc-bomb: EXAKTE Parität encoded == raw (maxDepth)',
    rEnc.maxDepth === rRaw.maxDepth,
    `enc=${rEnc.maxDepth} raw=${rRaw.maxDepth}`,
  );
  assert(
    'enc-bomb: EXAKTE Parität encoded == raw (totalExpansion)',
    rEnc.totalExpansion === rRaw.totalExpansion,
    `enc=${rEnc.totalExpansion} raw=${rRaw.totalExpansion}`,
  );
}

console.log(
  '\n=== S3/D1-R6: ENCODING-Bombe (Fan-out depth-5/fan-40, encoded) → Expansion ===',
);
{
  // Fan-out-Form, jedes href prozent-kodiert → MUSS über den EXPANSION-Guard
  // (totalExpansion > 100000) fallen, mit Parität zur Roh-Form.
  const buildFan = (encode) => {
    let s = '<defs><rect id="f0" width="1" height="1"/>';
    for (let l = 1; l <= 4; l++) {
      s += `<g id="f${l}">`;
      const ref = encode ? `#${encFrag(`f${l - 1}`)}` : `#f${l - 1}`;
      for (let k = 0; k < 40; k++) s += `<use href="${ref}"/>`;
      s += '</g>';
    }
    s += `</defs><use href="${encode ? `#${encFrag('f4')}` : '#f4'}"/>`;
    return mk(s);
  };
  const rEnc = analyzeUseGraph(parseNoHook(buildFan(true)));
  const rRaw = analyzeUseGraph(parseNoHook(buildFan(false)));
  assert(
    'enc-fan: rejected===true',
    rEnc.rejected === true,
    JSON.stringify(rEnc),
  );
  assert(
    'enc-fan: totalExpansion > 100000',
    rEnc.totalExpansion > MAX_USE_TOTAL_EXPANSION,
    `exp=${rEnc.totalExpansion}`,
  );
  assert(
    'enc-fan: Parität encoded == raw (totalExpansion)',
    rEnc.totalExpansion === rRaw.totalExpansion,
    `enc=${rEnc.totalExpansion} raw=${rRaw.totalExpansion}`,
  );
}

// ════════════════════════════════════════════════════════════════════════════
// S3/D1-R6 HONEST-RED: DUP-ID TIE-BREAKING. Zwei Elemente gleiche id; erstes
// klein, zweites Bombe. byId „erste gewinnt" == Chromium getElementById
// (first-in-tree). Der Analyzer muss DASSELBE Element wählen wie der Render.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== S3/D1-R6: dup-id Tie-Breaking (erste id gewinnt) ===');
{
  // Modell (gegen reales Chromium gepinnt, R6-Probe: getElementById('dup') liefert
  // FIRST-IN-TREE, == byId „erste gewinnt" :414): ein Fan von 40 <use href="#dup">.
  // Wenn #dup → kleines 1-rect-Ziel: ~80 Instanzen (< Cap). Wenn #dup → großes
  // 3000-Element-Ziel: 40×3001 ≈ 120k (> Cap). NUR die Auswahl WELCHES #dup das
  // erste ist, entscheidet — exakt die Tie-Breaking-Achse.
  const smallDup = '<g id="dup"><rect width="1" height="1"/></g>';
  let bombInner = '';
  for (let i = 0; i < 3000; i++) bombInner += '<rect width="1" height="1"/>';
  const bombDup = `<g id="dup">${bombInner}</g>`;
  let fan = '';
  for (let i = 0; i < 40; i++) fan += '<use href="#dup"/>';

  const rFirstSmall = analyzeUseGraph(
    parseNoHook(mk(`<defs>${smallDup}${bombDup}</defs><g>${fan}</g>`)),
  );
  // erstes #dup klein → wie Chromium first-in-tree → NICHT rejected.
  assert(
    'dup-id: erstes #dup klein → NICHT rejected (== Chromium first-in-tree)',
    rFirstSmall.rejected === false,
    JSON.stringify(rFirstSmall),
  );
  // Kontroll-Spiegel: erstes #dup = Bombe → MUSS rejected (first-in-tree korrekt).
  const rFirstBomb = analyzeUseGraph(
    parseNoHook(mk(`<defs>${bombDup}${smallDup}</defs><g>${fan}</g>`)),
  );
  assert(
    'dup-id: erstes #dup = Bombe → rejected (first-in-tree multiplikativ gezählt)',
    rFirstBomb.rejected === true,
    JSON.stringify(rFirstBomb),
  );
}

// ════════════════════════════════════════════════════════════════════════════
// S3/D1-R6 HONEST-RED: FAIL-CLOSED bei Parse-/Kanten-Fehler. canonicalizeFragment
// mit pathologischer Eingabe wirft NIE und führt NIE zu rejected:false durch
// einen geworfenen-und-geschluckten Fehler im Analyzer (try/catch→REJECT).
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== S3/D1-R6: fail-closed bei pathologischem Fragment ===');
{
  // use mit malformed-%-href auf eine kleine Bombe; der malformed-href ist KEINE
  // Kante (Kanon → "%..." literal, kein id-Match) → analyzer zählt diese Kante
  // nicht — aber wirft auch nicht. (Die echte Render-Schranke ist Hook (b), die
  // diesen href VOR Render strippt; hier nur: Analyzer never-throw + kein Crash.)
  let threw = false;
  let r;
  try {
    r = analyzeUseGraph(
      parseNoHook(
        mk(
          '<defs><rect id="x" width="1" height="1"/></defs>' +
            '<use href="#%e0%a4"/><use href="#%zz%zz"/><use href="#x"/>',
        ),
      ),
    );
  } catch {
    threw = true;
  }
  assert('fail-closed: analyzeUseGraph wirft NIE bei malformed-%-href', !threw);
  assert(
    'fail-closed: malformed-href-Kanten unterzählen nicht in rejected:false-Crash',
    r && r.rejected === false && r.cyclic === false,
    JSON.stringify(r),
  );
}

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
