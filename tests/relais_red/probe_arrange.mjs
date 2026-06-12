/**
 * RELAIS-Probe (JS-API) — arrange-Eigenheiten.
 *
 * Claims: C-ARR-SEQ · C-ARR-TYP · C-ARR-PROP · C-ARR-P5 (claims.js).
 *   - SEQ:  vertauschte Constraint-Reihenfolge ⇒ anderes Layout (sequentiell).
 *   - TYP:  COLOR wird in arrange OHNE Warnung übersprungen; FILL füllt den
 *           Canvas; FILL in analyze ⇒ unchecked (arrange-only).
 *   - PROP: Position außerhalb des Canvas kommt OHNE Warnung zurück
 *           (kein Canvas-Wächter — Vorschläge, keine Verifikation).
 *   - P5:   nicht Umsetzbares (unbekannter Typ) landet als Klartext in warnings.
 *
 * arrange ist pure Mathematik (kein Browser) — nur der TYP-Teilbeleg
 * "FILL in analyze ⇒ unchecked" braucht die Pipeline.
 * Eigenständig, deterministisch, Exit 1 wenn rot.
 */
import * as M from '../../src/pipeline.js';

let failCount = 0;
function assert(name, cond, ist) {
  const verdict = cond ? 'PASS' : 'FAIL';
  if (!cond) failCount += 1;
  console.log(`ASSERT ${name}: ${verdict} — ist: ${ist}`);
}

const canvas = { width: 400, height: 200 };
const elements = () => [
  { id: 'a', tag: 'rect', width: 20, height: 20 },
  { id: 'b', tag: 'rect', width: 40, height: 40, x: 100, y: 100 },
];

// SEQ: ['ALIGNED-LEFT','LEFT-OF'] endet links VON b; vertauscht endet AUF b.x.
{
  const o1 = M.arrange(canvas, elements(), [
    '#a ALIGNED-LEFT #b',
    '#a LEFT-OF #b',
  ]);
  const o2 = M.arrange(canvas, elements(), [
    '#a LEFT-OF #b',
    '#a ALIGNED-LEFT #b',
  ]);
  const x1 = JSON.stringify(o1.structured.attributes.a);
  const x2 = JSON.stringify(o2.structured.attributes.a);
  console.log(`OBS seq: order1 a=${x1} | order2 a=${x2}`);
  assert('seq_reihenfolge_aendert_layout', x1 !== x2, `${x1} vs ${x2}`);
}

// TYP: COLOR still übersprungen (keine Warnung, kein Attribut); FILL füllt.
{
  const c = M.arrange(canvas, elements(), ['#a COLOR red']);
  console.log(
    `OBS color: warnings=${JSON.stringify(c.structured.warnings)}, attrs=${JSON.stringify(c.structured.attributes)}`,
  );
  assert(
    'color_ohne_wirkung_ohne_warnung',
    c.structured.warnings.length === 0 && !('a' in c.structured.attributes),
    JSON.stringify(c.structured),
  );
  const f = M.arrange(canvas, elements(), ['#a FILL canvas']);
  const fa = f.structured.attributes.a;
  console.log(`OBS fill: a=${JSON.stringify(fa)}`);
  assert(
    'fill_fuellt_canvas',
    fa?.x === 0 && fa?.y === 0 && fa?.width === 400 && fa?.height === 200,
    JSON.stringify(fa),
  );
}

// PROP: a (200×200) CENTERED-IN b (10×10) ⇒ x negativ, KEINE Warnung.
{
  const big = [
    { id: 'a', tag: 'rect', width: 200, height: 200 },
    { id: 'b', tag: 'rect', width: 10, height: 10, x: 0, y: 0 },
  ];
  const r = M.arrange({ width: 100, height: 100 }, big, ['#a CENTERED-IN #b']);
  const ax = r.structured.attributes.a;
  console.log(
    `OBS prop: a=${JSON.stringify(ax)}, warnings=${JSON.stringify(r.structured.warnings)}`,
  );
  // Positions-Vorschlag kommt je nach Tag/Patch als x ODER transform-translate;
  // beweiskräftig ist: negative Ziel-Position (außerhalb) + 0 Warnungen.
  const tx =
    typeof ax?.x === 'number'
      ? ax.x
      : Number((ax?.transform || '').match(/translate\((-?[\d.]+)/)?.[1]);
  assert(
    'ausserhalb_ohne_warnung',
    Number.isFinite(tx) && tx < 0 && r.structured.warnings.length === 0,
    JSON.stringify({ a: ax, warnings: r.structured.warnings }),
  );
}

// P5: unbekannter Typ ⇒ Klartext-Warnung.
{
  const r = M.arrange(canvas, elements(), ['#a FLIEGT-NACH #b']);
  console.log(
    `OBS unbekannt: warnings=${JSON.stringify(r.structured.warnings)}`,
  );
  assert(
    'unbekannter_typ_klartext_warnung',
    r.structured.warnings.length === 1 &&
      /FLIEGT-NACH/.test(r.structured.warnings[0]),
    JSON.stringify(r.structured.warnings),
  );
}

// TYP-Teilbeleg: FILL in analyze ⇒ unchecked (arrange-only, K-16).
try {
  await M.init();
  const VB =
    'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100"';
  const r = await M.analyze(
    `<svg ${VB}><rect id="a" x="10" y="10" width="60" height="40" fill="red"/></svg>`,
    ['#a FILL canvas'],
  );
  const u = r.structured?.unchecked?.[0];
  console.log(
    `OBS fill-in-analyze: status=${r.structured?.status}, unchecked=${JSON.stringify(u)}`,
  );
  assert(
    'fill_in_analyze_unchecked',
    r.structured?.status === 'PARTIAL' &&
      typeof u?.hint === 'string' &&
      u.hint.includes('arrange-only'),
    JSON.stringify(u),
  );
} finally {
  await M.shutdown();
}

if (failCount > 0) {
  console.log(`RELAIS-PROBE arrange: ROT (${failCount} FAIL)`);
  process.exit(1);
} else {
  console.log('RELAIS-PROBE arrange: GRUEN');
  process.exit(0);
}
