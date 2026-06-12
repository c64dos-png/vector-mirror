/**
 * test_heal_viewport_measure.mjs — HEAL-4 additiver Viewport-Mess-Detektor
 * (F-AT-7-10 + F-AT-7-11, 5 stille Lügen). Spec:
 * docs/internal/an internal spec (Beweis-Pflichten 1–5 + 7).
 *
 * Real-Chromium-Harness (KEINE Mocks), Stil nach test_heal_zeroarea.mjs.
 *
 * DIE LÜGE (vorher, Boden-Wahrheit an internal ground-truth probe):
 * 5 Klassen viewport-divergenter Elemente (outer-svg-@container · %-in-nested-
 * svg-50vw · <style>-Regel-vw · transform:translateX(10vw) · font-size:5vw)
 * rendern bei vp1920 vs vp400 NACHWEISLICH verschieden, das Auge meldet sie
 * still+reliable OHNE media_dependent/MEDIA_DEPENDENT (HEAD-Beleg:
 * an internal session artifact — alle 6
 * Ziel-Elemente media_dependent:false @94dbdd1).
 *
 * DIE HEILUNG (additiv OR-only, ADR-001 STAND (4) „Korrigierte Flip-Form"):
 * lean-2-VP-Mess-Diff ([1920,400] ∪ px-Breakpoint-Straddles) in analyze() +
 * inspect() NACH fireResolve — NIE in resolve() (breaker-getimter Pfad).
 * Divergenz (Achsen geom/style/closure) ⇒ media_dependent:true NUR HINZUFÜGEN
 * + MEDIA_DEPENDENT genau 1× über die EXISTENTEN Schienen. Vorbedingungen:
 * MK1 (400ms-Race je Pass + Gesamt-Deckel) · MK3 (Ausfall ⇒ laut:
 * scene.media_measure='MEDIA_MEASURE_UNAVAILABLE' + Prosa-WARNUNG; Statik
 * trägt) · MK5 (separate Page + eigener Mutex — NIE pageMutex).
 *
 * BYTE-VERTRÄGE (HEAD-Dumps VOR dem Bau gezogen, eingebettet als Literale —
 * git stash verboten): 3 Negativ-Kontrollen + widerlegte Sub-Varianten bleiben
 * byte-identisch (inspect-Kanon); resolve() byte-identisch für ALLE Fixtures
 * (sha256-Kanon; voller Dump für L3/N1/F1). f1_use_via_media (F-AT-7-14):
 * Statik-Flag bleibt, Messung nimmt nichts weg (use-Shadow-Blindfleck).
 *
 * PLATTFORM-PIN (ehrlich): die eingebetteten HEAD-Kanons (insb. L5-Text-bbox)
 * sind an das gepinnte Chromium+Font-Pack dieser Maschine gebunden (ADR-001
 * „Plattform-Determinismus"). Drift ⇒ Honest Red, NICHT Literale nachziehen
 * ohne Beleg.
 *
 * Run direkt: `node tests/integration/test_heal_viewport_measure.mjs`
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  closeResolver,
  createResolver,
  measureViewportDivergence,
  resolve,
} from '../../src/adapters/renderer/playwright.js';
import { analyzeOutput, inspectOutput } from '../../src/interface/schema.js';
import { analyze, inspect, shutdown } from '../../src/pipeline.js';

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

// Kanonischer Stringify: Schlüssel rekursiv sortiert → byte-stabiler Vergleich
// (Spiegel test_heal_zeroarea.mjs#canon; identisch zum HEAD-Dump-Erzeuger).
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
const sha = (s) => createHash('sha256').update(s).digest('hex');
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2
    ? s[(s.length - 1) / 2]
    : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
async function timed(fn) {
  const t0 = process.hrtime.bigint();
  const out = await fn();
  return { out, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
}
const byId = (els, id) => (els || []).find((e) => e.id === id);
const warnCount = (el, w) => (el?.warnings || []).filter((x) => x === w).length;
// Geflaggt ⇔ BEIDE Signale (analog isZeroFlagged): media_dependent EXAKT true
// UND Warning MEDIA_DEPENDENT GENAU EINMAL (keine Doppel-Warning, OR-only).
const isMediaFlagged = (el) =>
  !!el && el.media_dependent === true && warnCount(el, 'MEDIA_DEPENDENT') === 1;

// ── FIXTURES ──────────────────────────────────────────────────────────────────
// L1–L5: die 5 bestätigten Lügen (beweisstrecke/p1 VERBATIM).
// N1–N3: 3 Negativ-Kontrollen (p1 VERBATIM). N3 ist ZUGLEICH die widerlegte
//        Sub-Variante „%-outer-Default" (intent.md IST-NICHT — selbe Fixture).
// W1/W2: widerlegte Sub-Varianten „g-Container" + „nested-svg-Container"
//        (bodenwahrheit probe-h1 VERBATIM).
// F1:    r6_f1_use_via_media (p2 VERBATIM) — use-Shadow-Gegenprobe F-AT-7-14.
const XML = 'xmlns="http://www.w3.org/2000/svg"';
const RECT = '<rect id="a" x="10" y="10" width="50" height="30" fill="red"/>';
const VB =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120"';
const FIX = {
  L1: `<svg id="root" ${XML} style="width:50vw;height:200px" viewBox="0 0 800 200"><style>#root{container-type:inline-size;container-name:c}@container c (max-width:600px){#a{fill:blue}}</style>${RECT}</svg>`,
  L2: `<svg ${XML} width="800" height="200"><svg id="n" width="50vw" height="120"><rect id="a" x="10" y="10" width="50%" height="30" fill="red"/></svg></svg>`,
  L3: `<svg ${XML} width="200" height="200"><style>#a{width:50vw}#b{width:50vw}</style><rect id="a" x="10" y="10" height="50" fill="purple"/><rect id="b" x="10" y="80" width="100" height="50" fill="green"/></svg>`,
  L4: `<svg ${XML} width="800" height="200"><rect id="rx" x="10" y="10" width="50" height="30" style="transform:translateX(10vw)" fill="red"/></svg>`,
  L5: `<svg ${XML} width="800" height="200"><text id="tx" x="10" y="100" style="font-size:5vw" fill="black">Hallo Welt</text></svg>`,
  N1: `<svg id="root" ${XML} style="width:800px;height:200px" viewBox="0 0 800 200"><style>#root{container-type:inline-size;container-name:c}@container c (max-width:600px){#a{fill:blue}}</style>${RECT}</svg>`,
  N2: `<svg id="root" ${XML} width="800" height="200"><rect id="a" x="10" y="10" width="50%" height="30" fill="red"/></svg>`,
  N3: `<svg id="root" ${XML}><rect id="a" x="10" y="10" width="50%" height="30" fill="red"/></svg>`,
  W1: `<svg id="root" ${XML} style="width:50vw;height:200px" viewBox="0 0 800 200"><style>#wrap{container-type:inline-size;container-name:g}@container g (max-width:600px){#a{fill:blue}}</style><g id="wrap">${RECT}</g></svg>`,
  W2: `<svg ${XML} width="800" height="200"><style>#n{container-type:inline-size;container-name:n}@container n (max-width:600px){#a{fill:blue}}</style><svg id="n" width="50vw" height="200">${RECT}</svg></svg>`,
  F1: `<svg ${VB}>
  <style>@media (max-width:600px){#shape{fill:red}}</style>
  <defs><rect id="shape" width="40" height="40" fill="blue"/></defs>
  <use id="u" href="#shape"/>
</svg>`,
};
// Lügen-Ziele (bodenwahrheit): WELCHES Element divergiert pixel-bewiesen.
const LIE_TARGETS = [
  ['L1', 'outer-svg-@container style=50vw (fill rot→blau)', ['a']],
  ['L2', '%-Geometrie in nested-<svg width=50vw> (bbox 480→100)', ['a']],
  ['L3', '<style>-Regel-vw (bbox 960→200)', ['a', 'b']],
  ['L4', 'transform:translateX(10vw) (Screen-Position)', ['rx']],
  ['L5', 'font-size:5vw-Text (Extent 414×107→86×22)', ['tx']],
];

// heavy-Filter-SVG (beweisstrecke/p3 Bauform — F-AT-7-04-Klasse), VERSCHÄRFT um
// eine feGaussianBlur-Primitive-KETTE (chain): die SEPARATE Mess-Page (MK5)
// reproduziert die P3-Kosten des alten pageMutex-Pfads (≈13,6s/Pass) NICHT
// zuverlässig — der Mess-Walk lag dort bei ≈350–450ms/Pass, ein GRENZFALL am
// 400ms-MK1-Race (empirisch 2/5 fresh-Prozesse quiet-success = flakiger
// Marker-Beweis). chain=40 hebt die deterministische Walk-/Closure-Last pro
// Pass ÜBER das Race (empirisch 5/5 Marker, resolve() weiter erfolgreich;
// Element-Total 495 < 500-Cap). Statik-/resolve()-Verhalten bleibt p3-Klasse.
function heavyFilters(nElems, blur, octaves, chain = 0) {
  const W = 4000;
  const H = 4000;
  let prim = '';
  for (let i = 0; i < chain; i++) prim += '<feGaussianBlur stdDeviation="2"/>';
  const defs = `<filter id="big" x="-50%" y="-50%" width="200%" height="200%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="${octaves}" result="n"/><feGaussianBlur stdDeviation="${blur}"/><feDisplacementMap in2="n" scale="80"/>${prim}</filter>`;
  let body = '';
  for (let i = 0; i < nElems; i++)
    body += `<circle id="c${i}" cx="${(i * 137) % W}" cy="${(i * 89) % H}" r="${200 + (i % 50)}" fill="rgb(${i % 255},0,0)" filter="url(#big)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${body}</svg>`;
}
// plain300 (p3 VERBATIM): 300 Elemente OHNE Filter — Performance-Klasse.
function plain300() {
  const W = 4000;
  const H = 4000;
  let body = '';
  for (let i = 0; i < 300; i++)
    body += `<rect id="r${i}" x="${(i * 137) % W}" y="${(i * 89) % H}" width="${50 + (i % 40)}" height="${30 + (i % 25)}" fill="rgb(0,${i % 255},0)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
}

// ── HEAD-REFERENZEN (Commit 94dbdd1, VOR dem Bau erzeugt — Byte-Verträge) ────
// §HEAL-7/A RE-PIN (Beleg-gedeckt, KEIN stilles Nachziehen): N3 ist das
// dimensionslose Fixture (keine viewBox, keine width/height ⇒ CSS-Default
// 300×150). Der alte HEAD-Kanon trug canvas_validity:'valid' — per
// Boden-Wahrheit F-TF-002 (bodenwahrheit_c03_2026-06-11/f002, Fall C) die
// dokumentierte LÜGE (fabrizierter Default-Canvas als valid gemeldet). Seit
// §HEAL-7/A produziert der Renderer viewBoxValidity:'default_replaced' ⇒
// inspectCanon.N3 (canvas_validity) + resolveSha.N3/resolveCanon (canvas-
// Objekt traegt das neue Feld) wurden mit an internal session artifact
// n3_repin_werte.log neu gepinnt (2× byte-stabil belegt). Alle anderen
// Fixtures tragen viewBox/width/height ⇒ Kanons byte-identisch zu 94dbdd1.
const HEAD = {
  // inspect()-Kanon (canon(structured)) der Negativ-/Kontroll-Fixtures @HEAD 94dbdd1.
  inspectCanon: {
    N1: `{"scene":{"canvas_validity":"valid","elements":[{"bbox_reliability":"reliable","cell":"A1-B1","color":"red","id":"a","status":"ok","tag":"rect"}],"grid":"16x4","height":200,"suppressed":0,"width":800}}`,
    N2: `{"scene":{"canvas_validity":"valid","elements":[{"bbox_reliability":"reliable","cell":"A1-I1","color":"red","id":"a","status":"ok","tag":"rect"}],"grid":"16x4","height":200,"suppressed":0,"width":800}}`,
    N3: `{"scene":{"canvas_validity":"default_replaced","elements":[{"bbox_reliability":"reliable","cell":"A1-D2","color":"red","id":"a","status":"ok","tag":"rect"}],"grid":"6x4","height":150,"suppressed":0,"width":300}}`,
    W1: `{"scene":{"canvas_validity":"valid","elements":[{"bbox_reliability":"reliable","cell":"A1-B1","color":"red","id":"a","status":"ok","tag":"rect"}],"grid":"16x4","height":200,"suppressed":0,"width":800}}`,
    W2: `{"scene":{"canvas_validity":"valid","elements":[{"bbox_reliability":"reliable","cell":"A1-B1","color":"black","id":"n","media_dependent":true,"status":"ok","tag":"svg","warnings":["MEDIA_DEPENDENT"]},{"bbox_reliability":"reliable","cell":"A1-B1","color":"red","id":"a","status":"ok","tag":"rect"}],"grid":"16x4","height":200,"suppressed":0,"width":800}}`,
    F1: `{"scene":{"canvas_validity":"valid","elements":[{"bbox_reliability":"reliable","cell":"A1-B2","color":"indeterminate","id":"u","media_dependent":true,"status":"ok","tag":"use","warnings":["USE_FILL_INDETERMINATE","MEDIA_DEPENDENT"]}],"grid":"4x4","height":120,"suppressed":0,"width":120}}`,
  },
  // resolve()-Kanon (voller Dump) für die 3 Byte-Beweis-Fixtures @HEAD.
  resolveCanon: {
    L3: `{"canvas":{"height":200,"vbX":0,"vbY":0,"viewBox":null,"width":200},"elements":[{"bbox":{"h":50,"w":960,"x":10,"y":10},"bbox_reliability":"reliable","fill":"rgb(128, 0, 128)","id":"a","opacity":1,"parent_id":null,"parent_tag":"svg","stroke":"none","tag":"rect","textContent":null,"transform":undefined},{"bbox":{"h":50,"w":960,"x":10,"y":80},"bbox_reliability":"reliable","fill":"rgb(0, 128, 0)","id":"b","opacity":1,"parent_id":null,"parent_tag":"svg","stroke":"none","tag":"rect","textContent":null,"transform":undefined}],"sanitize_loss":[]}`,
    N1: `{"canvas":{"height":200,"vbX":0,"vbY":0,"viewBox":"0 0 800 200","width":800},"elements":[{"bbox":{"h":30,"w":50,"x":10,"y":10},"bbox_reliability":"reliable","fill":"rgb(255, 0, 0)","id":"a","opacity":1,"parent_id":"root","parent_tag":"svg","stroke":"none","tag":"rect","textContent":null,"transform":undefined}],"sanitize_loss":[]}`,
    F1: `{"canvas":{"height":120,"vbX":0,"vbY":0,"viewBox":"0 0 120 120","width":120},"elements":[{"bbox":{"h":40,"w":40,"x":0,"y":0},"bbox_reliability":"reliable","fill":"indeterminate","id":"u","media_dependent":true,"opacity":1,"parent_id":null,"parent_tag":"svg","stroke":"indeterminate","tag":"use","textContent":null,"transform":undefined,"warnings":["USE_FILL_INDETERMINATE","MEDIA_DEPENDENT"]}],"sanitize_loss":[]}`,
  },
  // sha256(canon(resolve())) ALLER Fixtures @HEAD (kompakt; voller Dump oben für 3).
  resolveSha: {
    L1: '142300babebe3d4540519ef8d30aac4b683833db0fbe264d55d319f5275e2bca',
    L2: 'f7122b4de03a57ca41654aa7e0b2308b2ba0fbb88b6950b5dca3cec7d157de7e',
    L3: '97a7592a397732f0a93c166b07c390c544b000987db29086d8aa731576169f0d',
    L4: '0220572020514a11c6ede36f4017ed94d40ce79faddb77f2ba579d815e96e1b2',
    L5: 'f834236a2e058bcd0fd88e2f8d48ecbc8be194b6275ce86338e4e294003e7b18',
    N1: '142300babebe3d4540519ef8d30aac4b683833db0fbe264d55d319f5275e2bca',
    N2: '7e986ae663a87f2bb549853e7c56122a4faa58b6c4a4169ad7e3923536e078e3',
    // §HEAL-7/A Re-Pin (s.o.): canvas trägt jetzt viewBoxValidity:'default_replaced'.
    N3: '9bae529ff1728c32006df4a9276160aa39588ed8dfd4ffe770645af75d9515e8',
    W1: 'e85bd3395b9455078b82d94daa8f0e5e4578c251a9b74e9c506d8d1cd1c3a594',
    W2: 'fc5d6e42e1c09c6da1e9bc768b1c978f6d7978eb66d97504a0e1ca2e120cd112',
    F1: '4f8e8f32cbfca42db21c4dabb3be1dd88bbfffccaa77b922afcb3ead46b9f588',
  },
  // Performance-Baseline @HEAD (Median aus 3, warm; coder_head_dumps.json).
  analyzeL3MedianMs: 59.1,
  analyzePlain300MedianMs: 173.5,
};

// Beweis-Pflicht 7 — grobe Schwellen mit Toleranz: HEAD-Median + Spec-Delta
// (+60ms leicht / +450ms plain300) + Last-Toleranz (~80/175ms, Jitter dieser
// Maschine). KEINE Mikro-Benchmarks — nur das Budget-Versprechen der Spec.
const LIGHT_MS_MAX = 200; // 59.1 + 60 + ~80
const PLAIN300_MS_MAX = 800; // 173.5 + 450 + ~175
const HEAVY_MS_MAX = 12000; // bounded: resolve (Breaker ≤5s) + Mess-Deckel ≤1.5s + Reserve

(async () => {
  // ════ TEIL A — resolve()-BYTE-BEWEIS (Beweis-Pflicht 5b, Sweep-Browser) ════
  // Der Mess-Schritt liegt NICHT in resolve(): JEDES Fixture muss byte-identisch
  // zum HEAD-Dump bleiben (sha256-Kanon; L3/N1/F1 zusätzlich Voll-Dump) UND 2×
  // in-Lauf stabil sein.
  let page;
  try {
    page = await createResolver();
  } catch (e) {
    console.error('Renderer-Init fehlgeschlagen:', e.message);
    process.exit(1);
  }
  try {
    console.log(
      '=== A: resolve() byte-identisch zu HEAD (alle Fixtures, 2×) ===',
    );
    for (const [k, svg] of Object.entries(FIX)) {
      const r1 = canon(await resolve(page, svg));
      const r2 = canon(await resolve(page, svg));
      assert(`resolve ${k}: 2× byte-identisch (in-Lauf)`, r1 === r2);
      assert(
        `resolve ${k}: sha256 == HEAD (Mess-Schritt NICHT in resolve)`,
        sha(r1) === HEAD.resolveSha[k],
        `got ${sha(r1).slice(0, 12)}… want ${HEAD.resolveSha[k].slice(0, 12)}…`,
      );
      if (HEAD.resolveCanon[k]) {
        assert(
          `resolve ${k}: Voll-Kanon == HEAD-Dump`,
          r1 === HEAD.resolveCanon[k],
          `len ${r1.length} vs ${HEAD.resolveCanon[k].length}`,
        );
      }
    }
  } finally {
    await closeResolver();
  }

  // ════ TEIL B — PIPELINE (analyze/inspect, eigener lazy Lifecycle) ════
  try {
    // ── Beweis-Pflicht 1: die 5 Lügen ⇒ media_dependent:true + GENAU 1× Warning ──
    console.log(
      '\n=== B1: 5 Lügen via analyze() ⇒ Flag + MEDIA_DEPENDENT genau 1× ===',
    );
    for (const [k, label, targets] of LIE_TARGETS) {
      const s = (await analyze(FIX[k], [])).structured;
      const els = s?.scene?.elements || [];
      for (const t of targets) {
        const el = byId(els, t);
        assert(
          `${k} ${label}: #${t} emittiert`,
          !!el,
          `ids=${JSON.stringify(els.map((e) => e.id))}`,
        );
        assert(
          `${k}: #${t} media_dependent === true (gemessen, OR-only)`,
          el?.media_dependent === true,
          `got ${JSON.stringify(el?.media_dependent)}`,
        );
        assert(
          `${k}: #${t} MEDIA_DEPENDENT genau 1×`,
          warnCount(el, 'MEDIA_DEPENDENT') === 1,
          `warnings=${JSON.stringify(el?.warnings)}`,
        );
      }
      // Doppel-Warning-Wache über ALLE emittierten Elemente des Fixtures.
      assert(
        `${k}: KEIN Element trägt MEDIA_DEPENDENT mehrfach`,
        els.every((e) => warnCount(e, 'MEDIA_DEPENDENT') <= 1),
        JSON.stringify(els.map((e) => [e.id, e.warnings])),
      );
      // Ausfalls-Wache: bei einem leichten Fixture darf die Messung NIE ausfallen.
      assert(
        `${k}: kein MEDIA_MEASURE_UNAVAILABLE (leichtes Fixture)`,
        s?.scene?.media_measure === undefined,
        `got ${JSON.stringify(s?.scene?.media_measure)}`,
      );
    }
    // Schienen-Querprobe: dieselbe Wahrheit erreicht den inspect-Pfad (L3).
    const l3i = (await inspect(FIX.L3)).structured?.scene?.elements || [];
    assert(
      'L3 via inspect: #a geflaggt (beide Schienen)',
      isMediaFlagged(byId(l3i, 'a')),
    );
    assert(
      'L3 via inspect: #b geflaggt (beide Schienen)',
      isMediaFlagged(byId(l3i, 'b')),
    );

    // ── Beweis-Pflicht 2: Negativ-Kontrollen + widerlegte Sub-Varianten ──
    console.log(
      '\n=== B2: Negativ byte-identisch zu HEAD (3 Kontrollen + 3 widerlegte) ===',
    );
    const NEG = [
      ['N1', 'Negativ-Kontrolle @container fixed-800'],
      ['N2', 'Negativ-Kontrolle %-outer fixed-800'],
      [
        'N3',
        'Negativ-Kontrolle + widerlegte Sub-Variante %-outer-Default (no dims)',
      ],
      ['W1', 'widerlegte Sub-Variante g-Container (container-type auf <g>)'],
      ['W2', 'widerlegte Sub-Variante nested-svg-Container'],
    ];
    for (const [k, label] of NEG) {
      const r = await inspect(FIX[k]);
      const c = canon(r.structured);
      assert(
        `${k} ${label}: inspect byte-identisch zu HEAD`,
        c === HEAD.inspectCanon[k],
        `got(len ${c.length}) ${c.slice(0, 160)}…`,
      );
      const a = byId(r.structured?.scene?.elements, 'a');
      assert(
        `${k}: #a bleibt ungeflaggt (kein Über-Flag)`,
        !!a &&
          a.media_dependent === undefined &&
          warnCount(a, 'MEDIA_DEPENDENT') === 0,
        `got md=${JSON.stringify(a?.media_dependent)} warnings=${JSON.stringify(a?.warnings)}`,
      );
    }

    // ── Beweis-Pflicht 4: use-Shadow-Gegenprobe F-AT-7-14 (Statik trägt) ──
    console.log(
      '\n=== B3: f1_use_via_media — Statik-Flag bleibt, Messung nimmt nichts weg ===',
    );
    const f1 = await inspect(FIX.F1);
    const u = byId(f1.structured?.scene?.elements, 'u');
    assert(
      'F1: #u media_dependent === true + MEDIA_DEPENDENT genau 1× (Statik trägt)',
      isMediaFlagged(u),
      `got md=${JSON.stringify(u?.media_dependent)} warnings=${JSON.stringify(u?.warnings)}`,
    );
    const f1c = canon(f1.structured);
    assert(
      'F1: inspect byte-identisch zu HEAD (additiv ⇒ kein Re-Leak)',
      f1c === HEAD.inspectCanon.F1,
      `got(len ${f1c.length}) ${f1c.slice(0, 160)}…`,
    );

    // ── Beweis-Pflicht 5a: R9 — 2× inspect byte-identisch (Positiv + Negativ) ──
    console.log('\n=== B4: R9 — 2× inspect byte-identisch ===');
    const p1 = canon((await inspect(FIX.L3)).structured);
    const p2 = canon((await inspect(FIX.L3)).structured);
    assert(
      'R9 positiv (L3, MIT Mess-Flags): 2× inspect byte-identisch',
      p1 === p2,
      `len ${p1.length} vs ${p2.length}`,
    );
    const n1 = canon((await inspect(FIX.N1)).structured);
    const n2 = canon((await inspect(FIX.N1)).structured);
    assert(
      'R9 negativ (N1): 2× inspect byte-identisch',
      n1 === n2,
      `len ${n1.length} vs ${n2.length}`,
    );

    // ── Beweis-Pflicht 7: Performance (grobe Schwellen mit Toleranz) ──
    console.log(
      '\n=== B5: Performance — leicht ≤ +60ms · plain300 ≤ +450ms (＋Toleranz) ===',
    );
    const lightRuns = [];
    for (let i = 0; i < 3; i++)
      lightRuns.push((await timed(() => analyze(FIX.L3, []))).ms);
    const lightMed = median(lightRuns);
    assert(
      `leicht (L3): analyze-Median ${lightMed.toFixed(1)}ms ≤ ${LIGHT_MS_MAX}ms (HEAD ${HEAD.analyzeL3MedianMs}ms + 60 + Toleranz)`,
      lightMed <= LIGHT_MS_MAX,
      `runs=${JSON.stringify(lightRuns.map((x) => +x.toFixed(1)))}`,
    );
    const PLAIN = plain300();
    await analyze(PLAIN, []); // Warmup (Page-/JIT-Kosten nicht dem Budget anlasten)
    const plainRuns = [];
    for (let i = 0; i < 3; i++)
      plainRuns.push((await timed(() => analyze(PLAIN, []))).ms);
    const plainMed = median(plainRuns);
    assert(
      `plain300: analyze-Median ${plainMed.toFixed(1)}ms ≤ ${PLAIN300_MS_MAX}ms (HEAD ${HEAD.analyzePlain300MedianMs}ms + 450 + Toleranz)`,
      plainMed <= PLAIN300_MS_MAX,
      `runs=${JSON.stringify(plainRuns.map((x) => +x.toFixed(1)))}`,
    );

    // ── PATCH-RUNDE R5 (Codex R2/R3 + Adversarial A6-iii): Projektions-Härtung ──
    // Bauform /tmp/heal4_adv/a4_ambiguity.mjs (stroke-width:1vw = Achse B,
    // getBBox bleibt identisch → die PROJEKTION muss entscheiden, nicht die
    // Geometrie-Divergenz). Rot-/Pinning-Status je Fixture im Label.
    console.log('\n=== B7: Projektions-Härtung (Ambiguität · R2 · R3) ===');
    // (a) PINNING Ambiguitäts-Guard: 2 ID-lose, geometrie-IDENTISCHE rects,
    //     NUR das 2. vw-gebunden → KEINES flaggen (first-match-Mutation stirbt).
    const PRJ_AMBIG = `<svg ${XML} width="800" height="200"><style>rect:nth-of-type(2){stroke:black;stroke-width:1vw}</style><rect x="10" y="10" width="50" height="30" fill="red"/><rect x="10" y="10" width="50" height="30" fill="red"/></svg>`;
    // (b) PINNING Fallback-Existenz: disjunkte Geometrie → EXAKT das
    //     vw-gebundene (auto-id …_rect2) wird über den geom-Fallback geflaggt.
    const PRJ_CTRL = `<svg ${XML} width="800" height="200"><style>rect:nth-of-type(2){stroke:black;stroke-width:1vw}</style><rect x="10" y="10" width="50" height="30" fill="red"/><rect x="10" y="100" width="50" height="30" fill="red"/></svg>`;
    // (c) ROT-VOR-PATCH (R2): authored-id auf NICHT-emittiertem Element —
    //     #h visibility:hidden + CSS-Regel-vw (statisch unsichtbar für I1,
    //     L3-Klasse) divergiert; geometrie-deckungsgleicher SICHTBARER Zwilling
    //     #v darf NIE das Flag erben (vor Patch: Falsch-Flag via geom-Fallback
    //     trotz gesetzter authorId). #h bleibt unemittiert = ehrliches Residuum
    //     (Statik trägt nichts, Messung attribuiert konservativ nicht).
    const PRJ_HIDDEN = `<svg ${XML} width="2000" height="200"><style>#h{width:50vw}</style><rect id="h" x="10" y="10" height="50" style="visibility:hidden" fill="red"/><rect id="v" x="10" y="10" width="960" height="50" fill="blue"/></svg>`;
    // (d) ROT-VOR-PATCH (R3): IDENTISCHE Autor-ID 2×, das ERSTE vw-gebunden —
    //     last-wins-Map flaggte vor Patch das FALSCHE (zweite) Element;
    //     konservativ-Erwartung: bei Duplikat-ID KEIN Flag (kein Raten,
    //     F-TF-003-Klasse).
    const PRJ_DUP = `<svg ${XML} width="2000" height="200"><style>rect:nth-of-type(1){width:50vw}</style><rect id="dup" x="10" y="10" height="40" fill="red"/><rect id="dup" x="10" y="70" width="100" height="40" fill="blue"/></svg>`;

    const prjAmbig = (await analyze(PRJ_AMBIG, [])).structured;
    const ambigEls = prjAmbig?.scene?.elements || [];
    assert(
      'R5a AMBIG: beide Zwillinge emittiert',
      ambigEls.length === 2,
      `els=${JSON.stringify(ambigEls.map((e) => e.id))}`,
    );
    assert(
      'R5a AMBIG: KEIN Element geflaggt (Ambiguitäts-Guard, kein Raten)',
      ambigEls.every(
        (e) =>
          e.media_dependent === undefined &&
          warnCount(e, 'MEDIA_DEPENDENT') === 0,
      ),
      JSON.stringify(
        ambigEls.map((e) => [e.id, e.media_dependent, e.warnings]),
      ),
    );
    assert(
      'R5a AMBIG: kein Ausfall-Marker (Messung lief, Projektion verzichtete)',
      prjAmbig?.scene?.media_measure === undefined,
      `got ${JSON.stringify(prjAmbig?.scene?.media_measure)}`,
    );

    const prjCtrl = (await analyze(PRJ_CTRL, [])).structured;
    const ctrlEls = prjCtrl?.scene?.elements || [];
    const ctrlR1 = ctrlEls.find((e) => e.id.endsWith('_rect1'));
    const ctrlR2 = ctrlEls.find((e) => e.id.endsWith('_rect2'));
    assert(
      'R5b KONTROLLE: vw-gebundenes …_rect2 geflaggt (geom-Fallback greift)',
      isMediaFlagged(ctrlR2),
      `got md=${JSON.stringify(ctrlR2?.media_dependent)} warn=${JSON.stringify(ctrlR2?.warnings)}`,
    );
    assert(
      'R5b KONTROLLE: statisches …_rect1 bleibt ungeflaggt',
      !!ctrlR1 &&
        ctrlR1.media_dependent === undefined &&
        warnCount(ctrlR1, 'MEDIA_DEPENDENT') === 0,
      JSON.stringify([ctrlR1?.id, ctrlR1?.media_dependent, ctrlR1?.warnings]),
    );

    const prjHidden = (await analyze(PRJ_HIDDEN, [])).structured;
    const hiddenEls = prjHidden?.scene?.elements || [];
    const vEl = byId(hiddenEls, 'v');
    assert('R5c R2: #v emittiert', !!vEl);
    assert(
      'R5c R2: #v bleibt UNGEFLAGGT (kein geom-Fallback bei gesetzter, nicht emittierter authorId)',
      !!vEl &&
        vEl.media_dependent === undefined &&
        warnCount(vEl, 'MEDIA_DEPENDENT') === 0,
      `got md=${JSON.stringify(vEl?.media_dependent)} warn=${JSON.stringify(vEl?.warnings)}`,
    );
    assert(
      'R5c R2: #h nicht emittiert (dokumentiertes Residuum — Statik trägt nichts, kein Raten)',
      !byId(hiddenEls, 'h'),
      `ids=${JSON.stringify(hiddenEls.map((e) => e.id))}`,
    );

    const prjDup = (await analyze(PRJ_DUP, [])).structured;
    const dupEls = prjDup?.scene?.elements || [];
    assert(
      'R5d R3: beide Duplikat-ID-Elemente emittiert',
      dupEls.filter((e) => e.id === 'dup').length === 2,
      `ids=${JSON.stringify(dupEls.map((e) => e.id))}`,
    );
    assert(
      'R5d R3: KEIN Element geflaggt (Duplikat-Autor-ID ⇒ konservativ, kein last-wins)',
      dupEls.every(
        (e) =>
          e.media_dependent === undefined &&
          warnCount(e, 'MEDIA_DEPENDENT') === 0,
      ),
      JSON.stringify(
        dupEls.map((e) => [e.id, e.cell, e.media_dependent, e.warnings]),
      ),
    );

    // ── Beweis-Pflicht 3: Ausfall-Ehrlichkeit (heavy ⇒ bounded + LAUT) ──
    // ZULETZT (heavy belastet Browser/Breaker — Reihenfolge schützt die
    // Performance-Messungen oben). ≈13,6s/Mess-Pass ungebremst ⇒ MK1-Race
    // MUSS greifen ⇒ MK3: scene.media_measure + Prosa-WARNUNG; Statik intakt.
    console.log(
      '\n=== B6: heavy450 — bounded + MEDIA_MEASURE_UNAVAILABLE, Statik intakt ===',
    );
    const HEAVY = heavyFilters(450, 100, 8, 40);
    const h = await timed(() => analyze(HEAVY, []));
    const hs = h.out?.structured;
    assert(
      `heavy: bounded (${h.ms.toFixed(0)}ms ≤ ${HEAVY_MS_MAX}ms, kein Hang/Crash)`,
      hs !== undefined && h.ms <= HEAVY_MS_MAX,
    );
    assert(
      'heavy: Statik-Ergebnis intakt (structured non-null, Elemente emittiert)',
      !!hs && Array.isArray(hs.scene?.elements) && hs.scene.elements.length > 0,
      `structured=${hs === null ? 'null' : typeof hs} elements=${hs?.scene?.elements?.length}`,
    );
    assert(
      "heavy: scene.media_measure === 'MEDIA_MEASURE_UNAVAILABLE' (MK3, nie still)",
      hs?.scene?.media_measure === 'MEDIA_MEASURE_UNAVAILABLE',
      `got ${JSON.stringify(hs?.scene?.media_measure)}`,
    );
    assert(
      'heavy: Prosa trägt MEDIA_MEASURE_UNAVAILABLE (laut auch im Text-Kanal)',
      typeof h.out?.prose === 'string' &&
        h.out.prose.includes('MEDIA_MEASURE_UNAVAILABLE'),
      `prose-tail=${JSON.stringify((h.out?.prose || '').slice(-160))}`,
    );
    // §HEAL-7/C (Codex MCP-Wahrheitsgrenze): MCP-Boundary-Beweis. Die SDK
    // validiert structuredContent EXAKT gegen z.object(outputSchema)
    // (mcp.js:200 safeParseAsync) und der tools/list-JSON-Schema-Dump trägt
    // additionalProperties:false — ein NICHT deklariertes scene.media_measure
    // wird vom zod-strip-Parse entfernt bzw. von ajv (-32602-Klasse) verworfen.
    // Der Marker MUSS den Parse der registrierten Schema-Form ÜBERLEBEN.
    {
      const mcp = z.object(analyzeOutput).safeParse(hs);
      assert(
        'MCP (analyzeOutput): structured passiert den Boundary-Parse (kein -32602)',
        mcp.success,
        mcp.success ? '' : JSON.stringify(mcp.error?.issues?.slice(0, 3)),
      );
      assert(
        "MCP (analyzeOutput): scene.media_measure ÜBERLEBT den Parse (kein Strip)",
        mcp.success &&
          mcp.data?.scene?.media_measure === 'MEDIA_MEASURE_UNAVAILABLE',
        `got ${JSON.stringify(mcp.success ? mcp.data?.scene?.media_measure : undefined)}`,
      );
    }

    // ── PATCH-RUNDE R6 (Adversarial A6-ii): Ausfall-Marker auch via inspect() ──
    // Der inspect-Pfad teilt withMeasureUnavailable — bis zur Patch-Runde aber
    // UNASSERTED (Suite-Lücke). Gleiches HEAVY, direkt nach analyze (2. heavy-
    // Render; Breaker-Budget hält empirisch für 2 aufeinanderfolgende Calls).
    console.log(
      '\n=== B8: R6 — heavy via inspect() ⇒ Marker + Prosa-WARNUNG ===',
    );
    const hi = await timed(() => inspect(HEAVY));
    const his = hi.out?.structured;
    assert(
      `R6 inspect-heavy: bounded (${hi.ms.toFixed(0)}ms ≤ ${HEAVY_MS_MAX}ms) + Statik intakt`,
      !!his &&
        Array.isArray(his.scene?.elements) &&
        his.scene.elements.length > 0 &&
        hi.ms <= HEAVY_MS_MAX,
      `structured=${his === null ? 'null' : typeof his} elements=${his?.scene?.elements?.length}`,
    );
    assert(
      "R6 inspect-heavy: scene.media_measure === 'MEDIA_MEASURE_UNAVAILABLE'",
      his?.scene?.media_measure === 'MEDIA_MEASURE_UNAVAILABLE',
      `got ${JSON.stringify(his?.scene?.media_measure)}`,
    );
    assert(
      'R6 inspect-heavy: Prosa trägt MEDIA_MEASURE_UNAVAILABLE',
      typeof hi.out?.prose === 'string' &&
        hi.out.prose.includes('MEDIA_MEASURE_UNAVAILABLE'),
      `prose-tail=${JSON.stringify((hi.out?.prose || '').slice(-160))}`,
    );
    // §HEAL-7/C: MCP-Boundary-Beweis auch für den inspect-Pfad (inspectOutput).
    {
      const mcp = z.object(inspectOutput).safeParse(his);
      assert(
        'MCP (inspectOutput): structured passiert den Boundary-Parse (kein -32602)',
        mcp.success,
        mcp.success ? '' : JSON.stringify(mcp.error?.issues?.slice(0, 3)),
      );
      assert(
        "MCP (inspectOutput): scene.media_measure ÜBERLEBT den Parse (kein Strip)",
        mcp.success &&
          mcp.data?.scene?.media_measure === 'MEDIA_MEASURE_UNAVAILABLE',
        `got ${JSON.stringify(mcp.success ? mcp.data?.scene?.media_measure : undefined)}`,
      );
    }

    // ── PATCH-RUNDE R1/R4-Pinning: Recovery nach verworfener Mess-Page ──
    // Beide heavy-Aufrufe oben haben die Mess-Page nach Timeout VERWORFEN
    // (discard bumpt das R1-Generations-Token) — der nächste Mess-Aufruf MUSS
    // lazy eine FRISCHE Page beschaffen und korrekt messen (kein toter-Page-
    // Zustand, kein late-resolve-Clobber überlebt den Discard). DIREKT am
    // Adapter geprobt (measureViewportDivergence), NICHT via analyze(): der
    // breaker-getimte PRODUKTIV-resolve() ist nach 2 heavy-Renders transient
    // gestört (VORBESTEHEND, F-AT-7-04-Klasse — P3 @HEAD zeigt dasselbe Muster
    // ohne Mess-Schritt) und würde den Mess-Page-Pin nur konfundieren.
    console.log(
      '\n=== B9: Recovery — frische Mess-Page nach heavy-Discard ===',
    );
    const recMeasure = await measureViewportDivergence(FIX.L3);
    const recIds = (recMeasure?.diverged || []).map((d) => d.authorId).sort();
    assert(
      'Recovery: Messung läuft auf frischer Page (kein error nach Discard)',
      !!recMeasure && !recMeasure.error,
      `got ${JSON.stringify({ error: recMeasure?.error, detail: recMeasure?.detail })}`,
    );
    assert(
      'Recovery: L3-Divergenz korrekt gemessen (authorIds a+b, frische Page misst echt)',
      recIds.length === 2 && recIds[0] === 'a' && recIds[1] === 'b',
      `diverged=${JSON.stringify(recIds)}`,
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
