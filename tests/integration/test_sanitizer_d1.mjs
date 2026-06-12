/**
 * test_sanitizer_d1.mjs — L-005-D1 Lossless-or-loud Sanitizer (🔴 CRIT, browser-bound)
 *
 * Real-Chromium-Harness (KEINE Mocks). Belegt den D1-Eingriff aus ADR L-005:
 * der Spiegel SIEHT künftig use/SMIL (C1 „Sehen & rendern (gehärtet)") statt
 * das gestrippte Template als Phantom zu melden — und was DOCH verloren geht,
 * wird LAUT (`sanitize_loss`), nie still gelogen. Security gehärtet
 * (CVE-2026-22610-Klasse: href #-lokal, kein script, kein ALLOW_UNKNOWN_PROTOCOLS,
 * externe Targets abgelehnt, use-Graph-Cap STRUKTURELL auf dem geparsten DOM,
 * SSRF-Netzwerk-Denylist auf CONTEXT-Ebene — lifecycle-invariant).
 *
 * In package.json: `npm run test:sanitizer`.
 *
 * Beweis-Ebenen:
 *   (a) USE-INSTANZ an transformierter Position (200,200), kein Origin-Phantom.
 *   (b) SMIL: <animate> überlebt sanitize.
 *   (c) EXTERNAL-HREF abgelehnt + EXTERNAL_USE_NOT_RESOLVED (dedupe).
 *   (d) SCRIPT/XSS (script/onload/javascript:/data:) geblockt.
 *   (e) B1+B2 use-GRAPH-CAP auf dem geparsten DOM — Bypass-Vektoren, die OHNE Fix
 *       GRÜN-falsch wären: self-closing-<use id href>-Kette-50, self-closing-Zyklus,
 *       single-quoted-Tiefe>Cap, Fan-out depth-5/fan-40 — ALLE SECURITY_VIOLATION.
 *   (e2) B7 naked-<use>-Ziel Fan-out (Ziel = g aus lauter bare <use>, früher
 *       totalExpansion 9 bei real ~2M) → SECURITY_VIOLATION (multiplikativ gezählt).
 *   (f) B4+B6 SSRF — ALLE Vektoren (style/fill/stroke/filter/mask/clip-path/
 *       image-href/feImage) gegen einen ECHTEN lokalen HTTP-Server: 0 Treffer.
 *   (f2) B6 no-fetch SURVIVES Page-Recycle (RECYCLE_AFTER klein → ≥2 Recycles,
 *       Server bleibt bei 0 Treffern — context.route lifecycle-invariant).
 *   (g) B5 lossless-or-loud im Error-Pfad (nur <script> → NO_ELEMENTS MIT Loss).
 *   (h) sanitize_loss-Vertrag: leer ([]) bei lossless.
 *
 * Run direkt: `node tests/integration/test_sanitizer_d1.mjs`
 */
import http from 'node:http';
import DOMPurify from 'isomorphic-dompurify';
import {
  __getExternalRequestsBlocked,
  __getPageMetrics,
  __setRecycleAfter,
  closeResolver,
  createResolver,
  resolve,
} from '../../src/adapters/renderer/playwright.js';
import {
  analyzeUseGraph,
  canonicalizeFragment,
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

// ── S3/D1-R6-Härtung #3: affirmative POST-sanitize-Sonde ────────────────────
// Spiegelt die PRODUKTIONS-Sanitize EXAKT (gleiche ADD_TAGS/ATTR + gleicher Hook:
// fail-closed `%`/Control-Char ZUERST, dann Kanon-`#fragment`) und liefert den
// bereinigten DOM. Damit lässt sich AFFIRMATIV beweisen, dass die `%`-Bombe AT
// SANITIZE entschärft wurde (kein lebendes `<use>` mit auflösbarem `%`-href mehr),
// nicht bloß „kein Timeout". KEINE Produktions-Logik berührt — reine Test-Replik
// über die exportierten reinen Funktionen canonicalizeFragment/analyzeUseGraph.
const _ADD_TAGS = [
  'use',
  'symbol',
  'animate',
  'animateTransform',
  'animateMotion',
  'set',
  'mpath',
];
const _ADD_ATTR = [
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
// WICHTIG (Test-Integrität): isomorphic-dompurify ist ein SINGLETON, den
// playwright.js beim Modul-Load (oben importiert) mit seinem PRODUKTIONS-href-Hook
// `hardenHrefHook` bestückt hat. Diese Sonde rührt den Hook-State NICHT an (KEIN
// removeAllHooks) — sie ruft `DOMPurify.sanitize` mit der prod-äquivalenten Config
// und der bereits installierte Produktions-Hook feuert automatisch. So ist die
// Sanitize hier BIT-genau die Produktions-Sanitize, und spätere resolve()-Calls
// bleiben unberührt (kein Clobber). Verifiziert: `%`-/Control-hrefs werden zu ""
// gestrippt, legitime `#frag` überleben.
function sanitizeLikeProd(svg) {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: _ADD_TAGS,
    ADD_ATTR: _ADD_ATTR,
    RETURN_DOM: true,
  });
}
// Zählt lebende `<use>`, deren href NACH sanitize noch ein `#`-Fragment ist und
// auf eine vorhandene id auflöst (== eine echte Render-Zeit-Kante). 0 = entschärft.
function liveResolvableUseEdges(dom) {
  const byId = new Set([...dom.querySelectorAll('[id]')].map((e) => e.id));
  let edges = 0;
  let percentHrefs = 0;
  for (const u of dom.querySelectorAll('use')) {
    const raw = u.getAttribute('href') || u.getAttribute('xlink:href') || '';
    if (raw.includes('%')) percentHrefs += 1;
    const canon = canonicalizeFragment(raw);
    if (canon !== null && byId.has(canon)) edges += 1;
  }
  return { edges, percentHrefs };
}

const mk = (inner, vb = '0 0 200 200') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${inner}</svg>`;

// ── Kern-Fixtures ───────────────────────────────────────────────────────────
const USE_SVG = mk(
  '<defs><rect id="s" width="30" height="30" fill="red"/></defs><use href="#s" x="200" y="200"/>',
  '0 0 400 400',
);
const SMIL_SVG = mk(
  '<rect id="r" x="10" y="10" width="40" height="40" fill="blue"><animate attributeName="x" from="10" to="100" dur="2s"/></rect>',
);
const EXTERNAL_USE_SVG = mk(
  '<use href="http://evil.example/sprite.svg#icon"/><rect width="20" height="20" fill="green"/>',
  '0 0 100 100',
);
const CLEAN_SVG = mk(
  '<rect width="20" height="20" fill="black"/>',
  '0 0 50 50',
);

const XSS_VECTORS = [
  [
    'inline-script',
    mk(
      '<script>document.title="PWNED"</script><rect width="10" height="10" fill="red"/>',
      '0 0 50 50',
    ),
  ],
  [
    'onload-attr',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50" onload="document.title='PWNED'"><rect width="10" height="10" fill="red"/></svg>`,
  ],
  [
    'anchor-js-href',
    mk(
      `<a href="javascript:document.title='PWNED'"><rect width="10" height="10" fill="red"/></a>`,
      '0 0 50 50',
    ),
  ],
  [
    'use-data-uri',
    mk(
      '<use href="data:image/svg+xml,&lt;svg/&gt;"/><rect width="10" height="10" fill="red"/>',
      '0 0 50 50',
    ),
  ],
];

// ── B1/B2/B7: DoS-Bypass-Vektoren (OHNE Fix GRÜN-falsch) ────────────────────
let _chain = '<defs><rect id="c0" width="2" height="2"/>';
for (let i = 1; i <= 50; i++) _chain += `<use id="c${i}" href="#c${i - 1}"/>`;
_chain += '</defs><use href="#c50"/>';
const SELFCLOSE_CHAIN = mk(_chain); // self-closing → alte Regex las Tiefe 1

// HEILUNG 1 / SVG2 §5.6: ein erkannter Zyklus ist KEIN DoS. Eine REINE self-
// closing-Zyklus-SVG (kein sichtbarer Inhalt) rendert nichts → ehrlich leer
// (error=NO_ELEMENTS), NICHT mehr SECURITY_VIOLATION. Die frühere Blendung kam
// vom alten Zyklus-Reject (jetzt entschärft); die Budget-Caps bleiben die
// alleinige DoS-Schranke und fangen die echten Bomben (Kette/Fan-out) weiter.
const SELFCLOSE_CYCLE = mk(
  '<use id="a" href="#b"/><use id="b" href="#a"/><use href="#a"/>',
); // reiner self-closing-Zyklus → ehrlich leer (NO_ELEMENTS)

// F-AT-3-C (positiver Heilungs-Beleg): legaler self-closing-Zyklus MIT
// sichtbarem <rect id="real"> → der zyklische <use> trägt nichts bei, das rect
// MUSS rendern. Vor Heilung 1 blendete der Zyklus-Reject die GANZE Szene.
const SELFCLOSE_CYCLE_VISIBLE = mk(
  '<rect id="real" x="10" y="10" width="20" height="20" fill="red"/>' +
    '<use id="a" href="#b"/><use id="b" href="#a"/><use href="#a"/>',
);

let _sq = "<defs><rect id='c0' width='2' height='2'/>";
for (let i = 1; i <= 7; i++)
  _sq += `<g id='c${i}'><use href='#c${i - 1}'/></g>`;
_sq += "</defs><use href='#c7'/>";
const SINGLEQUOTE_DEEP = mk(_sq); // single-quoted → alte Regex double-quote-blind

// B2: depth-5 (== Cap, von Tiefe erlaubt) × fan-40 → nur Expansion-Guard fängt es.
let _fan = '<defs><rect id="f0" width="1" height="1"/>';
for (let lvl = 1; lvl <= 4; lvl++) {
  _fan += `<g id="f${lvl}">`;
  for (let k = 0; k < 40; k++) _fan += `<use href="#f${lvl - 1}"/>`;
  _fan += '</g>';
}
_fan += '</defs><use href="#f4"/>';
const FANOUT_DEPTH5 = mk(_fan);

// B7: naked-<use>-Ziel-Bombe — Ziele sind g aus lauter bare <use> (frühere
// walk()-Variante akkumulierte 0 → totalExpansion 9 bei real ~8^7 ≈ 2M).
let _naked = '<defs><rect id="b0" width="1" height="1"/>';
for (let i = 1; i <= 7; i++) {
  _naked += `<g id="b${i}">`;
  for (let k = 0; k < 8; k++) _naked += `<use href="#b${i - 1}"/>`;
  _naked += '</g>';
}
_naked += '</defs><use href="#b7"/>';
const NAKED_USE_BOMB = mk(_naked);

// benigne Komposition: root→o4→…→o0 = Tiefe 5 (== Cap), Fan-2 → klein. Nicht abgelehnt.
let _ok = '<defs><rect id="o0" width="4" height="4"/>';
for (let i = 1; i <= 4; i++)
  _ok += `<g id="o${i}"><use href="#o${i - 1}"/><use href="#o${i - 1}" x="5"/></g>`;
_ok += '</defs><use href="#o4"/>';
const BENIGN_DEPTH5 = mk(_ok);

// D1c/B2 (3. Triple): Bombe im ZWEITEN top-level <svg> — der frühere
// querySelector('svg') (erstes svg) las sie nicht. Jetzt: ALLE top-level svgs.
let _multiBomb = '<defs><rect id="d0" width="1" height="1"/>';
for (let l = 1; l <= 4; l++) {
  _multiBomb += `<g id="d${l}">`;
  for (let k = 0; k < 40; k++) _multiBomb += `<use href="#d${l - 1}"/>`;
  _multiBomb += '</g>';
}
_multiBomb += '</defs><use href="#d4"/>';
const MULTI_SVG_BOMB =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5"/></svg>` +
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${_multiBomb}</svg>`;

// D1c/B1 (3. Triple): extrem tiefer Nicht-use-<g>-Nest. Der rekursive Analyzer
// warf RangeError (ungefangen). Jetzt iterativ + Parser-Crash-gefangen →
// kontrollierter SECURITY_VIOLATION, NIE ein uncaught throw aus resolve().
let _deep = '';
for (let i = 0; i < 5000; i++) _deep += '<g>';
_deep += '<rect width="1" height="1"/>';
for (let i = 0; i < 5000; i++) _deep += '</g>';
const DEEP_NEST = mk(_deep);

// D1c/4.Triple: ECHTE naked-<use>-FORWARDER-Bomben (use→use→…), depth ≤ Cap →
// nur die EXPANSION fängt sie. Der g-Masking-NAKED_USE_BOMB oben deckte sie NICHT
// ab (use→g-Ziele werden ohnehin korrekt gezählt). CASE Y (Forwarder-Fan, ~122k)
// + CASE X (N Forwarder → LEAF-Group, ~140k). RED-ohne-chaseForwarders-Fix.
function _caseYForwarder(FAN) {
  let s = '<defs><g id="leaf"><rect width="1" height="1"/></g>';
  s += '<use id="fwd0" href="#leaf"/>';
  s += '<g id="g1">';
  for (let j = 0; j < FAN; j++) s += '<use href="#fwd0"/>';
  s += '</g><use id="fwd1" href="#g1"/><g id="g2">';
  for (let j = 0; j < FAN; j++) s += '<use href="#fwd1"/>';
  s += '</g></defs><use href="#g2"/>';
  return mk(s);
}
function _caseXForwarder(N, LEAF) {
  let s = '<defs><g id="leaf">';
  for (let i = 0; i < LEAF; i++) s += '<rect width="1" height="1"/>';
  s += '</g><use id="fwd" href="#leaf"/><g id="root">';
  for (let i = 0; i < N; i++) s += '<use href="#fwd"/>';
  s += '</g></defs><use href="#root"/>';
  return mk(s);
}
const CASE_Y_FORWARDER = _caseYForwarder(350);
const CASE_X_FORWARDER = _caseXForwarder(400, 350);
// benigner Einzel-Forwarder (legit Indirektion) — darf NICHT abgelehnt werden.
const BENIGN_FORWARDER = mk(
  '<defs><rect id="leaf" width="20" height="20" fill="red"/><use id="fwd" href="#leaf"/></defs><use href="#fwd" x="30" y="30"/>',
);

const STRIPPED_ONLY = mk('<script>void 0</script>'); // B5: nach Strip NO_ELEMENTS

// ── S3/D1-R6: ENCODING-Amplifikation (billion-laughs via prozent-kodiertem href) ─
// WURZEL (R6): Orakel-Divergenz — Chromium dekodiert `<use href>` per URL-Fragment-
// percent-decode → getElementById(decoded); der frühere Analyzer verglich den ROHEN
// `href.slice(1)` gegen dekodierte id-Keys → 0 Kanten → rejected:false → Chromium
// expandierte die Bombe trotzdem (Live-Bypass, encoded 2^20 → analyzer 0/0/false).
// FIX (zwei Schichten): (1) geteilte Kanon-SSOT canonicalizeFragment im Analyzer
// (Parität encoded==raw, in test_use_graph.js isoliert belegt); (2) der LASTTRAGENDE
// fail-closed-Hook (b): JEDES `%`-/Control-Char-Fragment wird VOR dem Render
// gestrippt. Effekt end-to-end: jede `%`-kodierte use-Bombe wird VOR setContent
// ENTSCHÄRFT (href entfernt → keine Instanziierung → KEIN Timeout), und LAUT als
// EXTERNAL_USE_NOT_RESOLVED gemeldet (lossless-or-loud).
const encFrag = (s) =>
  s.replace(/./g, (ch) => `%${ch.charCodeAt(0).toString(16).padStart(2, '0')}`);
let _encChain = '<defs><rect id="c0" width="2" height="2"/>';
for (let i = 1; i <= 20; i++)
  _encChain += `<use id="c${i}" href="#${encFrag(`c${i - 1}`)}"/>`;
_encChain += `</defs><use href="#${encFrag('c20')}"/>`;
const ENCODED_BOMB = mk(_encChain); // depth-20-Kette, jedes href prozent-kodiert

// ENCODED Fan-out (depth-5/fan-40) — byte-äquivalent zum FANOUT_DEPTH5, aber jedes
// href prozent-kodiert. Ohne Schicht (1)+(2) wäre das der harte Bypass.
let _encFan = '<defs><rect id="f0" width="1" height="1"/>';
for (let lvl = 1; lvl <= 4; lvl++) {
  _encFan += `<g id="f${lvl}">`;
  for (let k = 0; k < 40; k++)
    _encFan += `<use href="#${encFrag(`f${lvl - 1}`)}"/>`;
  _encFan += '</g>';
}
_encFan += `</defs><use href="#${encFrag('f4')}"/>`;
const ENCODED_FANOUT = mk(_encFan);

// GEMISCHT-PROZENT-BYPASS (hardening, PFLICHT): `#a%30%zzb` mit Ziel
// `id="a0%zzb"`. decodeURIComponent ist all-or-nothing → wirft an `%zz` → Kanon-
// Fallback liefert den GANZEN rohen String `a%30%zzb` (MISS). Chromium dekodiert
// PER SEQUENZ: `%30`→`0`, `%zz` literal → `a0%zzb` (HIT) = Bombe expandiert. NUR
// der fail-closed-Hook (b) schließt das (`%`-haltig → gestrippt VOR Render). R6-
// Probe-Boden-Wahrheit: Chromium bbox HIT auf `a0%zzb`. Hier: viele solche Refs
// auf ein großes Ziel — ohne (b) Bypass, mit (b) entschärft + gemeldet.
let _mixedTarget = '<g id="a0%zzb">';
for (let i = 0; i < 3000; i++) _mixedTarget += '<rect width="1" height="1"/>';
_mixedTarget += '</g>';
let _mixedFan = '<g>';
for (let i = 0; i < 60; i++) _mixedFan += '<use href="#a%30%zzb"/>';
_mixedFan += '</g>';
const MIXED_PERCENT_BYPASS = mk(`<defs>${_mixedTarget}</defs>${_mixedFan}`);

// Negativ-Kontrolle: legitimer ASCII-Sprite `#icon-home` (kein `%`, kein Control-
// Char) MUSS unverändert überleben und als use-Instanz rendern.
const LEGIT_SPRITE = mk(
  '<defs><rect id="icon-home" width="30" height="30" fill="green"/></defs>' +
    '<use href="#icon-home" x="40" y="40"/>',
  '0 0 100 100',
);

// SMIL-LOCK: ein animiertes href (<animate attributeName=href> / <set href>) darf
// die statische Render-Zeit-Kante NICHT verändern — DOMPurify muss das animierte
// href-Ziel zuverlässig strippen (statische Kante == Render-Zeit-Kante).
const SMIL_HREF_ANIM = mk(
  '<defs><rect id="t" width="5" height="5"/></defs>' +
    '<use href="#t"><animate attributeName="href" to="#bomb" dur="1s"/>' +
    '<set attributeName="href" to="#bomb"/></use>' +
    '<g id="bomb"><rect width="1" height="1"/></g>',
  '0 0 50 50',
);

(async () => {
  await createResolver();

  // ── (a) USE-Instanz ───────────────────────────────────────────────────────
  console.log('\n=== (a) USE-Instanz an transformierter Position ===');
  {
    const r = await resolve(null, USE_SVG);
    assert('use: kein Error', !r.error, r.error || '');
    const useEl = r.elements?.find((e) => e.tag === 'use');
    assert(
      'use: eigene use-Instanz',
      !!useEl,
      JSON.stringify(r.elements?.map((e) => e.tag)),
    );
    assert(
      'use: Instanz an (200,200)',
      useEl &&
        Math.abs(useEl.bbox.x - 200) < 1 &&
        Math.abs(useEl.bbox.y - 200) < 1,
      useEl ? JSON.stringify(useEl.bbox) : 'fehlt',
    );
    assert(
      'use: sanitize_loss leer',
      Array.isArray(r.sanitize_loss) && r.sanitize_loss.length === 0,
      JSON.stringify(r.sanitize_loss),
    );
  }

  // ── (b) SMIL ──────────────────────────────────────────────────────────────
  console.log('\n=== (b) SMIL animate überlebt sanitize ===');
  {
    const r = await resolve(null, SMIL_SVG);
    assert('smil: kein Error', !r.error, r.error || '');
    assert(
      'smil: Träger-rect gerendert',
      r.elements?.some((e) => e.id === 'r'),
    );
    assert(
      'smil: sanitize_loss leer',
      Array.isArray(r.sanitize_loss) && r.sanitize_loss.length === 0,
      JSON.stringify(r.sanitize_loss),
    );
  }

  // ── (c) EXTERNAL href ─────────────────────────────────────────────────────
  console.log('\n=== (c) EXTERNAL href abgelehnt (dedupe) ===');
  {
    const r = await resolve(null, EXTERNAL_USE_SVG);
    assert('external: kein Error', !r.error, r.error || '');
    assert(
      'external: EXTERNAL_USE_NOT_RESOLVED',
      r.sanitize_loss?.some((l) => l.reason === 'EXTERNAL_USE_NOT_RESOLVED'),
      JSON.stringify(r.sanitize_loss),
    );
    assert(
      'external: kein doppeltes ATTR_STRIPPED:href',
      !r.sanitize_loss?.some((l) => l.reason === 'ATTR_STRIPPED:href'),
      JSON.stringify(r.sanitize_loss),
    );
    assert(
      'external: kein http-Target im Inventar',
      !r.elements?.some((e) => JSON.stringify(e).includes('evil.example')),
    );
  }

  // ── (d) XSS ───────────────────────────────────────────────────────────────
  console.log('\n=== (d) XSS-Vektoren geblockt ===');
  for (const [name, svg] of XSS_VECTORS) {
    const r = await resolve(null, svg);
    const reported = r.sanitize_loss?.some(
      (l) =>
        l.reason === 'TAG_STRIPPED' ||
        l.reason.startsWith('ATTR_STRIPPED') ||
        l.reason === 'EXTERNAL_USE_NOT_RESOLVED',
    );
    assert(
      `xss[${name}]: gestrippt + gemeldet`,
      reported,
      JSON.stringify(r.sanitize_loss),
    );
    const leaks = r.elements?.some(
      (e) =>
        e.tag === 'script' ||
        JSON.stringify(e).toLowerCase().includes('javascript:') ||
        JSON.stringify(e).toLowerCase().includes('onload'),
    );
    assert(`xss[${name}]: kein Leak`, !leaks);
  }

  // ── (e) B1+B2 use-Graph-Cap (DOM-Graph) ───────────────────────────────────
  console.log(
    '\n=== (e) B1+B2 use-Graph-Cap (DOM-Graph, kein Regex-Bypass) ===',
  );
  // ECHTE DoS-Vektoren — bleiben SECURITY_VIOLATION (Tiefe>5 bzw. Budget). NUR
  // der Zyklus-Fall wandert raus (Heilung 1 / SVG2 §5.6: Zyklus ist kein DoS).
  const dosCases = [
    ['B1 self-closing-chain-50', SELFCLOSE_CHAIN],
    ['B1 single-quoted-depth-7', SINGLEQUOTE_DEEP],
    ['B2 fan-out depth-5/fan-40', FANOUT_DEPTH5],
  ];
  for (const [name, svg] of dosCases) {
    const r = await resolve(null, svg);
    assert(
      `${name} → SECURITY_VIOLATION`,
      r.error === 'SECURITY_VIOLATION',
      `error=${r.error} msg=${r.message}`,
    );
    assert(
      `${name} → USE_GRAPH_REJECTED im Loss`,
      r.sanitize_loss?.some((l) => l.reason === 'USE_GRAPH_REJECTED'),
      JSON.stringify(r.sanitize_loss),
    );
  }

  // HEILUNG 1 / SVG2 §5.6: reiner self-closing-Zyklus (kein sichtbarer Inhalt)
  // rendert ehrlich nichts → NO_ELEMENTS, NICHT mehr SECURITY_VIOLATION. Die
  // frühere Blendung kam vom Zyklus-Reject (jetzt entschärft).
  {
    const r = await resolve(null, SELFCLOSE_CYCLE);
    assert(
      'B1 self-closing-cycle (rein) → NO_ELEMENTS (ehrlich leer, kein DoS)',
      r.error === 'NO_ELEMENTS',
      `error=${r.error} msg=${r.message}`,
    );
    assert(
      'B1 self-closing-cycle (rein) → NICHT mehr SECURITY_VIOLATION',
      r.error !== 'SECURITY_VIOLATION',
      `error=${r.error}`,
    );
    assert(
      'B1 self-closing-cycle (rein) → kein USE_GRAPH_REJECTED im Loss',
      !r.sanitize_loss?.some((l) => l.reason === 'USE_GRAPH_REJECTED'),
      JSON.stringify(r.sanitize_loss),
    );
  }

  // F-AT-3-C positiver Heilungs-Beleg: legaler self-closing-Zyklus MIT sichtbarem
  // <rect id="real"> → der zyklische <use> trägt nichts bei, das rect MUSS
  // rendern. Vor Heilung 1 blendete der Zyklus-Reject die GANZE Szene.
  {
    const r = await resolve(null, SELFCLOSE_CYCLE_VISIBLE);
    assert(
      'F-AT-3-C: Zyklus+sichtbar → KEIN error (Szene rendert, nicht geblendet)',
      !r.error,
      `error=${r.error} msg=${r.message}`,
    );
    assert(
      'F-AT-3-C: Zyklus+sichtbar → #real rendert (zyklischer use trägt nichts bei)',
      r.elements?.some((e) => e.id === 'real'),
      JSON.stringify(r.elements?.map((e) => ({ tag: e.tag, id: e.id }))),
    );
  }

  // B2 muss vom EXPANSION-Guard (nicht Tiefe) kommen — beweist Fan-out-Abdeckung.
  {
    const r = await resolve(null, FANOUT_DEPTH5);
    assert(
      'B2 fan-out: vom Fan-out-Expansion-Guard (nicht Tiefe)',
      /Fan-out-Expansion/.test(r.message || ''),
      r.message,
    );
  }

  // ── (e2) B7 naked-<use>-Fan-out ───────────────────────────────────────────
  console.log(
    '\n=== (e2) B7 naked-<use>-Ziel Fan-out (multiplikativ gezählt) ===',
  );
  {
    const r = await resolve(null, NAKED_USE_BOMB);
    assert(
      'B7 naked-use-bomb → SECURITY_VIOLATION',
      r.error === 'SECURITY_VIOLATION',
      `error=${r.error} msg=${r.message}`,
    );
  }
  {
    const r = await resolve(null, BENIGN_DEPTH5);
    assert(
      'benign depth-5/fan-2 NICHT abgelehnt',
      !r.error,
      `error=${r.error} msg=${r.message}`,
    );
  }

  // ── (e3) D1c/B2 MULTI-SVG — Bombe im zweiten svg (end-to-end via resolve) ──
  console.log('\n=== (e3) D1c/B2 Multi-svg (Bombe im 2. svg) ===');
  {
    const r = await resolve(null, MULTI_SVG_BOMB);
    assert(
      'multi-svg-bomb (2. svg) → SECURITY_VIOLATION (alle top-level svgs gezählt)',
      r.error === 'SECURITY_VIOLATION',
      `error=${r.error} msg=${r.message}`,
    );
  }

  // ── (e4) D1c/B1 DEEP-NEST — never-throw (kontrollierter Error, kein Crash) ──
  console.log('\n=== (e4) D1c/B1 Deep-Nest depth-5000 (never-throw) ===');
  {
    let threw = false;
    let r;
    try {
      r = await resolve(null, DEEP_NEST);
    } catch {
      threw = true;
    }
    assert('deep-nest: resolve() wirft NIE (kein uncaught RangeError)', !threw);
    assert(
      'deep-nest: kontrollierter SECURITY_VIOLATION',
      r && r.error === 'SECURITY_VIOLATION',
      `error=${r?.error} msg=${r?.message}`,
    );
    assert(
      'deep-nest: Error-Resultat trägt sanitize_loss (B5)',
      r && Array.isArray(r.sanitize_loss) && r.sanitize_loss.length > 0,
      JSON.stringify(r?.sanitize_loss),
    );
  }

  // ── (e5) D1c/4.Triple naked-<use>-FORWARDER Fan-out (end-to-end) ──────────
  console.log(
    '\n=== (e5) D1c/4.Triple naked-<use>-Forwarder Fan-out (CASE Y/X) ===',
  );
  {
    const ry = await resolve(null, CASE_Y_FORWARDER);
    assert(
      'CASE Y forwarder (~122k) → SECURITY_VIOLATION',
      ry.error === 'SECURITY_VIOLATION',
      `error=${ry.error} msg=${ry.message}`,
    );
    const rx = await resolve(null, CASE_X_FORWARDER);
    assert(
      'CASE X forwarder (~140k) → SECURITY_VIOLATION',
      rx.error === 'SECURITY_VIOLATION',
      `error=${rx.error} msg=${rx.message}`,
    );
    const ok = await resolve(null, BENIGN_FORWARDER);
    assert(
      'benign Einzel-Forwarder NICHT abgelehnt (kein over-block)',
      !ok.error,
      `error=${ok.error} msg=${ok.message}`,
    );
  }

  // ── (e6) S3/D1-R6 ENCODING-Amplifikation — fail-closed VOR Render ─────────
  // ARCHITEKTUR-BEFUND (verbindlich dokumentiert): der fail-closed-Hook (b) läuft
  // INNERHALB von sanitize, also VOR analyzeUseGraph. Für JEDE `%`-kodierte Bombe
  // strippt er das href → die Bombe wird ENTSCHÄRFT (nie instanziiert) BEVOR der
  // Analyzer oder gar setContent sie sieht. Das ist die STÄRKERE Eigenschaft als
  // ein analyzer-SECURITY_VIOLATION (die Bombe existiert render-seitig gar nicht
  // mehr). Belegt: kein Timeout (schnell), KEIN LOAD_FAILED, LAUT gemeldet
  // (EXTERNAL_USE_NOT_RESOLVED). Die ISOLIERTE Analyzer-Parität (canon schließt die
  // Divergenz, falls Hook-(b) je entfiele) ist in test_use_graph.js bewiesen.
  console.log(
    '\n=== (e6) S3/D1-R6 ENCODING-Bombe — fail-closed/entschärft VOR Render ===',
  );
  {
    const t0 = Date.now();
    const r = await resolve(null, ENCODED_BOMB);
    const ms = Date.now() - t0;
    // RED ohne Fix: encoded href überlebt Hook (alter Hook: nur `#`-Prefix-Test) →
    // Analyzer unterzählt (roher slice) → rejected:false → Chromium expandiert →
    // setContent-Timeout 5s → LOAD_FAILED. MIT Fix: href gestrippt, schnell, no-error.
    assert(
      'enc-bomb: KEIN LOAD_FAILED-Timeout (Schicht 1 greift, nicht der Backstop)',
      r.error !== 'LOAD_FAILED',
      `error=${r.error} ms=${ms}`,
    );
    assert(
      'enc-bomb: schnell entschärft (< 4000ms, kein 5s-setContent-Timeout)',
      ms < 4000,
      `ms=${ms}`,
    );
    assert(
      'enc-bomb: `%`-href LAUT gemeldet (EXTERNAL_USE_NOT_RESOLVED, lossless-or-loud)',
      r.sanitize_loss?.some((l) => l.reason === 'EXTERNAL_USE_NOT_RESOLVED'),
      JSON.stringify(r.sanitize_loss?.slice(0, 2)),
    );
    const rf = await resolve(null, ENCODED_FANOUT);
    assert(
      'enc-fanout: ebenfalls entschärft, KEIN LOAD_FAILED-Timeout',
      rf.error !== 'LOAD_FAILED',
      `error=${rf.error}`,
    );
    // AFFIRMATIV (R6-Härtung #3): die Bombe ist AT SANITIZE nicht-existent, nicht
    // bloß „kein Timeout". POST-sanitize-DOM: NULL lebende `<use>` mit auflösbarer
    // `%`-Kette, UND der Analyzer auf dem bereinigten DOM meldet KEINE Riesen-
    // Expansion (nichts mehr da → klein, NICHT „rejected via 100k-exp").
    const cleanFan = sanitizeLikeProd(ENCODED_FANOUT);
    const liveFan = liveResolvableUseEdges(cleanFan);
    assert(
      'enc-fanout AFFIRMATIV: 0 lebende auflösbare use-Kanten nach sanitize (Bombe entfernt)',
      liveFan.edges === 0,
      `edges=${liveFan.edges} percentHrefs=${liveFan.percentHrefs}`,
    );
    const agFan = analyzeUseGraph(cleanFan);
    assert(
      'enc-fanout AFFIRMATIV: Analyzer auf POST-sanitize-DOM = klein/nicht-rejected (nichts zu expandieren)',
      agFan.rejected === false &&
        agFan.totalExpansion <= MAX_USE_TOTAL_EXPANSION,
      JSON.stringify(agFan),
    );
  }

  // ── (e7) GEMISCHT-PROZENT-BYPASS (hardening, PFLICHT) ───────────────
  // Der Vektor, wo die Kanon (all-or-nothing decode) von Chromium (per-Sequenz)
  // DIVERGIERT: `#a%30%zzb` → Kanon „a%30%zzb" (MISS), Chromium „a0%zzb" (HIT).
  // NUR der fail-closed-Hook (b) schließt ihn (`%`-haltig → gestrippt VOR Render).
  console.log(
    '\n=== (e7) GEMISCHT-PROZENT-BYPASS (#a%30%zzb) — nur Hook (b) schließt ihn ===',
  );
  {
    const t0 = Date.now();
    const r = await resolve(null, MIXED_PERCENT_BYPASS);
    const ms = Date.now() - t0;
    // RED ohne Hook (b): href überlebt → Chromium HIT auf „a0%zzb" → 60×3001 ≈
    // 180k Instanzen → setContent-Timeout → LOAD_FAILED (Bypass via Render).
    assert(
      'mixed-%: KEIN LOAD_FAILED-Timeout (Hook (b) strippt `%`-Fragment VOR Render)',
      r.error !== 'LOAD_FAILED',
      `error=${r.error} ms=${ms}`,
    );
    assert('mixed-%: schnell entschärft (< 4000ms)', ms < 4000, `ms=${ms}`);
    assert(
      'mixed-%: `%`-href LAUT gemeldet (EXTERNAL_USE_NOT_RESOLVED)',
      r.sanitize_loss?.some((l) => l.reason === 'EXTERNAL_USE_NOT_RESOLVED'),
      JSON.stringify(r.sanitize_loss),
    );
    // AFFIRMATIV (R6-Härtung #3): genau der DIVERGENZ-Vektor (#a%30%zzb, wo Kanon
    // MISS aber Chromium HIT auf "a0%zzb"). Beweis, dass Hook (b) ihn AT SANITIZE
    // entfernt: 0 lebende auflösbare use-Kanten + Analyzer auf POST-sanitize klein.
    const cleanMix = sanitizeLikeProd(MIXED_PERCENT_BYPASS);
    const liveMix = liveResolvableUseEdges(cleanMix);
    assert(
      'mixed-% AFFIRMATIV: 0 lebende `%`-use-Kanten nach sanitize (Divergenz-Vektor entfernt)',
      liveMix.edges === 0 && liveMix.percentHrefs === 0,
      `edges=${liveMix.edges} percentHrefs=${liveMix.percentHrefs}`,
    );
    const agMix = analyzeUseGraph(cleanMix);
    assert(
      'mixed-% AFFIRMATIV: Analyzer auf POST-sanitize = nicht-rejected (Bombe render-seitig weg)',
      agMix.rejected === false,
      JSON.stringify(agMix),
    );
    // Negativ-Kontrolle: legitimer ASCII-Sprite überlebt unverändert.
    const ok = await resolve(null, LEGIT_SPRITE);
    assert(
      'legit #icon-home: kein Error (Hook (b) bricht legitime Sprites NICHT)',
      !ok.error,
      `error=${ok.error}`,
    );
    assert(
      'legit #icon-home: use-Instanz gerendert (kein over-block)',
      !!ok.elements?.find((e) => e.tag === 'use'),
      JSON.stringify(ok.elements?.map((e) => e.tag)),
    );
    assert(
      'legit #icon-home: kein EXTERNAL_USE-Loss (sauber durchgelassen)',
      !ok.sanitize_loss?.some((l) => l.reason === 'EXTERNAL_USE_NOT_RESOLVED'),
      JSON.stringify(ok.sanitize_loss),
    );
    // R6-Härtung #3: CONTROL-PREFIX-href `#\x01c0` (0x01 ≤ 0x1f). Chromium-Probe:
    // Chromium STRIPPT den Control-Char und löst auf `c0` auf (HIT) — also eine
    // echte Bypass-Fläche, die der Kanon-`#`-Test allein NICHT abfinge. Der
    // fail-closed-Hook (b) `hasPercentOrControl` lehnt ihn ab (gestrippt VOR Render).
    const CTRL_PREFIX = mk(
      '<defs><rect id="c0" width="10" height="10" fill="red"/></defs>' +
        '<use href="#c0" x="5" y="5"/>',
      '0 0 50 50',
    );
    const rc = await resolve(null, CTRL_PREFIX);
    assert(
      'control-prefix #\\x01c0: kein LOAD_FAILED (Hook (b) strippt Control-Char-href)',
      rc.error !== 'LOAD_FAILED',
      `error=${rc.error}`,
    );
    assert(
      'control-prefix #\\x01c0: gestrippt + LAUT gemeldet (EXTERNAL_USE_NOT_RESOLVED)',
      rc.sanitize_loss?.some((l) => l.reason === 'EXTERNAL_USE_NOT_RESOLVED'),
      JSON.stringify(rc.sanitize_loss),
    );
    // AFFIRMATIV: POST-sanitize kein lebendes use mit Control-Char-href-Kante.
    const cleanCtrl = sanitizeLikeProd(CTRL_PREFIX);
    const liveCtrl = liveResolvableUseEdges(cleanCtrl);
    assert(
      'control-prefix AFFIRMATIV: 0 lebende auflösbare use-Kanten nach sanitize',
      liveCtrl.edges === 0,
      `edges=${liveCtrl.edges}`,
    );
  }

  // ── (e8) SMIL-LOCK — animiertes href ändert die statische Kante NICHT ─────
  console.log(
    '\n=== (e8) SMIL-LOCK: <animate/<set attributeName=href> gestrippt ===',
  );
  {
    const r = await resolve(null, SMIL_HREF_ANIM);
    // Die statische Kante ist <use href="#t"> (klein) → kein Error. Das animierte
    // href-Ziel (#bomb) darf die Render-Zeit-Kante nicht verändern: DOMPurify
    // strippt das `to`/`values`-href der SMIL-Animation NICHT als href-Attribut
    // (attributeName=href ist Daten, kein href-Attribut am Element) → context.route
    // backstoppt jeden externen, und das statische `#t` bleibt die einzige Kante.
    assert(
      'smil-lock: kein Error (statische #t-Kante klein, animiertes #bomb nicht aktiv)',
      !r.error,
      `error=${r.error} msg=${r.message}`,
    );
    // Beleg, dass das Render die STATISCHE Kante nutzt (use-Instanz von #t, 5×5).
    assert(
      'smil-lock: statische use-Instanz gerendert (Render-Zeit == statische Kante)',
      !!r.elements?.find((e) => e.tag === 'use'),
      JSON.stringify(r.elements?.map((e) => e.tag)),
    );
  }

  // ── (f) B4+B6 SSRF — ALLE Vektoren, echter Server, 0 Treffer ──────────────
  console.log(
    '\n=== (f) B4+B6 SSRF-Denylist (alle Vektoren, echter Server) ===',
  );
  {
    const hits = [];
    const server = http.createServer((req, res) => {
      hits.push(req.url);
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end('x');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    // ALLE Ressourcen-SSRF-Flächen, die DOMPurify durchlässt + der href-Hook nicht sieht.
    const ssrfSvg = mk(
      `<defs>` +
        `<filter id="flt"><feImage href="${base}/feimage.png"/></filter>` +
        `<mask id="msk"><image href="${base}/mask.png" width="10" height="10"/></mask>` +
        `<clipPath id="clp"><rect width="10" height="10"/></clipPath>` +
        `</defs>` +
        `<rect width="50" height="50" style="fill:url(${base}/css-fill.png)"/>` +
        `<rect x="20" width="20" height="20" fill="url(${base}/attr-fill.png)"/>` +
        `<rect x="40" width="20" height="20" stroke="url(${base}/stroke.png)" stroke-width="3"/>` +
        `<rect x="60" width="20" height="20" filter="url(#flt)"/>` +
        `<rect x="80" width="20" height="20" mask="url(#msk)"/>` +
        `<image href="${base}/image-href.png" width="10" height="10"/>` +
        `<use href="${base}/sprite.svg#i"/>`,
      '0 0 200 200',
    );
    const before = __getExternalRequestsBlocked();
    await resolve(null, ssrfSvg);
    await new Promise((r) => setTimeout(r, 400));
    const after = __getExternalRequestsBlocked();
    server.close();
    assert(
      'ssrf: lokaler Server 0 Requests (no-fetch BEWIESEN, alle Vektoren)',
      hits.length === 0,
      `hits=${JSON.stringify(hits)}`,
    );
    assert(
      'ssrf: Denylist hat externe Requests abgebrochen',
      after - before >= 1,
      `blocked=${after - before}`,
    );
  }

  // ── (f2) B6 no-fetch SURVIVES Page-Recycle ────────────────────────────────
  console.log(
    '\n=== (f2) B6 no-fetch ÜBERLEBT Page-Recycle (context.route) ===',
  );
  {
    const hits = [];
    const server = http.createServer((req, res) => {
      hits.push(req.url);
      res.writeHead(200);
      res.end('x');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    // frischer Resolver mit kleinem RECYCLE_AFTER → erzwingt Recycles im Lauf.
    await closeResolver();
    __setRecycleAfter(2);
    await createResolver();
    for (let i = 0; i < 6; i++) {
      await resolve(
        null,
        mk(
          `<rect width="50" height="50" style="fill:url(${base}/recycle${i}.png)"/><image href="${base}/ri${i}.png" width="9" height="9"/>`,
          '0 0 100 100',
        ),
      );
    }
    await new Promise((r) => setTimeout(r, 400));
    const metrics = __getPageMetrics();
    server.close();
    assert(
      'recycle: ≥2 Recycles gefeuert (Test trifft Recycle-Pfad)',
      metrics.recycles >= 2,
      `recycles=${metrics.recycles}`,
    );
    assert(
      'recycle: Server 0 Requests NACH Recycle (B6-Regression geschlossen)',
      hits.length === 0,
      `hits=${JSON.stringify(hits)}`,
    );
    // Resolver für die restlichen Cases mit Default-RecycleAfter neu aufsetzen.
    await closeResolver();
    __setRecycleAfter(50);
    await createResolver();
  }

  // ── (f3) MEDIUM-Folge: SMIL <set>/<animate> mit externem href → kein Fetch ──
  // hardenHrefHook prüft nur STATISCHES href; SMIL kann href dynamisch animieren.
  // Beleg: context.route fängt JEDEN externen Request (auch SMIL-getrieben) — 0
  // Server-Treffer. (billion-laughs-via-SMIL liefe denselben use-Render-Pfad, den
  // der Forwarder-Expansion-Fix abdeckt.)
  console.log('\n=== (f3) SMIL externes href (set/animate) → kein Fetch ===');
  {
    const hits = [];
    const server = http.createServer((req, res) => {
      hits.push(req.url);
      res.writeHead(200);
      res.end('x');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    await resolve(
      null,
      mk(
        `<rect width="10" height="10"><set attributeName="href" to="${base}/smil-set.svg"/></rect>` +
          `<use href="#t"><animate attributeName="href" values="${base}/a.svg;${base}/b.svg" dur="1s"/></use>` +
          `<defs><rect id="t" width="5" height="5"/></defs>`,
        '0 0 50 50',
      ),
    );
    await new Promise((r) => setTimeout(r, 400));
    server.close();
    assert(
      'smil-external: Server 0 Requests (context.route backstopped SMIL-href)',
      hits.length === 0,
      `hits=${JSON.stringify(hits)}`,
    );
  }

  // ── (g) B5 Error-Pfad-Loss ─────────────────────────────────────────────────
  console.log('\n=== (g) B5 Error-Pfad trägt sanitize_loss ===');
  {
    const r = await resolve(null, STRIPPED_ONLY);
    assert(
      'B5: gestripptes-unrenderbares SVG → NO_ELEMENTS',
      r.error === 'NO_ELEMENTS',
      `error=${r.error}`,
    );
    assert(
      'B5: Error-Resultat trägt nicht-leeren Loss',
      Array.isArray(r.sanitize_loss) && r.sanitize_loss.length > 0,
      JSON.stringify(r.sanitize_loss),
    );
  }

  // ── (h) lossless ──────────────────────────────────────────────────────────
  console.log('\n=== (h) sanitize_loss leer bei lossless ===');
  {
    const r = await resolve(null, CLEAN_SVG);
    assert('clean: kein Error', !r.error, r.error || '');
    assert(
      'clean: sanitize_loss === []',
      Array.isArray(r.sanitize_loss) && r.sanitize_loss.length === 0,
      JSON.stringify(r.sanitize_loss),
    );
  }

  // ── (i) F-TF-018 honest-red-GUARD: <set> überlebt die PRODUKTIONS-Sanitize ──
  // DoD-7-Härtung. Das VERHALTEN (E0 80ca196) ist gefixt: `'set'` steht in der
  // PRODUKTIONS-Allow-List SANITIZE_ADD_TAGS (src/adapters/renderer/playwright.js),
  // überlebt die DOMPurify-Sanitize und sein t=0-Wert wird gemessen. ABER bis hier
  // gab es KEINEN GUARD über den ECHTEN Produktions-Pfad: würde jemand `'set'` aus
  // SANITIZE_ADD_TAGS entfernen, ginge KEIN Test rot — die Lüge (statische Basis
  // x=10 statt t=0-set-Wert x=120) würde STILL wiederbelebt. Dieser Guard schließt
  // genau das.
  //
  // WICHTIG (Schärfe-Wurzel): er fährt resolve() aus playwright.js — den ECHTEN
  // Produktions-Renderer mit SANITIZE_ADD_TAGS — NICHT die Test-Replik
  // sanitizeLikeProd/_ADD_TAGS oben. Ein Entfernen von `'set'` aus der PRODUKTION
  // wird daher GEFANGEN (die Test-Replik wäre dafür blind).
  //
  // Mechanik: frozen clock t=0 + `<set ... begin="0s">` → das <set> ist bei t=0
  // AKTIV → das gemessene/gegridete x reflektiert den `to`-Wert (120), NICHT die
  // statische Basis x=10. Würde DOMPurify das <set> strippen (kein `'set'` in
  // ADD_TAGS), bliebe nur die statische Basis → gemessenes x=10.
  //
  // ASSERT-SCHÄRFE (warum scharf): die POSITIV-Kontrolle (mit <set>) verlangt
  // bbox.x ≈ 120; die NEGATIV-Kontrolle (IDENTISCHES Element OHNE <set>) belegt
  // bbox.x ≈ 10. Beide Werte sind am eingefrorenen t=0 exakt + deterministisch
  // (empirisch: 120 bzw. 10). Da 120 und 10 ~110 user-units auseinanderliegen und
  // der Toleranz-Radius < 1 ist, UNTERSCHEIDET das Assert beweisbar zwischen
  // set-Wert und Basis — der Guard ist NICHT zahnlos. Beweislast (lokal, nicht
  // committet): `'set'` aus SANITIZE_ADD_TAGS entfernt → diese POSITIV-Kontrolle
  // wird rot (gemessen x=10 statt 120); `'set'` wieder eingefügt → grün.
  console.log(
    '\n=== (i) F-TF-018 honest-red: <set> überlebt PROD-Sanitize (t=0-Wert gemessen) ===',
  );
  {
    const PROBE_WITH_SET = mk(
      '<rect id="probe" x="10" y="10" width="20" height="20" fill="red">' +
        '<set attributeName="x" to="120" begin="0s"/></rect>',
    );
    const PROBE_NO_SET = mk(
      '<rect id="probe" x="10" y="10" width="20" height="20" fill="red"/>',
    );

    // POSITIV-Kontrolle: <set> überlebt die PRODUKTIONS-Sanitize → t=0-x == 120.
    const rs = await resolve(null, PROBE_WITH_SET);
    assert('set-guard: kein Error (PROD-Render)', !rs.error, rs.error || '');
    const probeSet = rs.elements?.find((e) => e.id === 'probe');
    assert(
      'set-guard: #probe gerendert',
      !!probeSet,
      JSON.stringify(rs.elements?.map((e) => ({ tag: e.tag, id: e.id }))),
    );
    assert(
      'set-guard POSITIV: t=0-x spiegelt <set>-Wert (bbox.x ≈ 120, NICHT Basis 10)',
      probeSet && Math.abs(probeSet.bbox.x - 120) < 1,
      probeSet ? JSON.stringify(probeSet.bbox) : 'fehlt',
    );
    // Vollständigkeit: <set> ist legitim (kein Verlust) → lossless.
    assert(
      'set-guard: sanitize_loss leer (<set> ist erlaubt, kein Strip)',
      Array.isArray(rs.sanitize_loss) && rs.sanitize_loss.length === 0,
      JSON.stringify(rs.sanitize_loss),
    );

    // NEGATIV-Kontrolle: IDENTISCHES Element OHNE <set> → t=0-x == Basis 10.
    // Beweist, dass das Assert zwischen set-Wert (120) und Basis (10)
    // UNTERSCHEIDET (sonst wäre der Guard zahnlos).
    const rb = await resolve(null, PROBE_NO_SET);
    assert('set-guard: kein Error (NEGATIV-Kontrolle)', !rb.error, rb.error || '');
    const probeBase = rb.elements?.find((e) => e.id === 'probe');
    assert(
      'set-guard NEGATIV: ohne <set> spiegelt x die Basis (bbox.x ≈ 10, NICHT 120)',
      probeBase && Math.abs(probeBase.bbox.x - 10) < 1,
      probeBase ? JSON.stringify(probeBase.bbox) : 'fehlt',
    );
    // Diskriminanz explizit: set-Wert und Basis liegen weit auseinander (≈ 110 uu)
    // → der < 1-Toleranz-Radius trennt sie beweisbar. Würde DOMPurify das <set>
    // strippen, kollabierte probeSet.bbox.x auf 10 == probeBase.bbox.x → die
    // POSITIV-Kontrolle würde rot. Das ist der honest-red-Beweis (F-TF-018).
    assert(
      'set-guard DISKRIMINANZ: |set-x − base-x| groß (Assert trennt scharf)',
      probeSet &&
        probeBase &&
        Math.abs(probeSet.bbox.x - probeBase.bbox.x) > 100,
      probeSet && probeBase
        ? `set-x=${probeSet.bbox.x} base-x=${probeBase.bbox.x}`
        : 'fehlt',
    );
  }

  await closeResolver();

  console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error('Test-Lauf-Fehler:', e);
  process.exit(1);
});
