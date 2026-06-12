/**
 * H10-RED R11-07 — PASS bei bbox_reliability='not_measurable'.
 *
 * BEFUND (probe_R11-07, run1 == run2, 2-Lauf-bewiesen):
 *   Ein Subjekt, dessen BBox die Pipeline SELBST als 'not_measurable'
 *   deklariert (cssFar: CSS-@keyframes-Animation, warnings
 *   ["NON_DETERMINISTIC_MOTION"]; transform3d: matrix3d,
 *   warnings ["3D_TRANSFORM_ANCESTOR"]), wird unter einem
 *   INSIDE-Constraint mit status='PASS' und unchecked=[] gewertet —
 *   das Verdikt behauptet "geprüft und erfüllt" über eine Geometrie,
 *   die es nach eigener Aussage nicht messen kann.
 *
 * WAHRHEITS-PIN (pinnt die Wahrheit, NICHT die Implementierung):
 *   WENN die Pipeline ein Subjekt als bbox_reliability='not_measurable'
 *   ausweist, DANN darf ein Constraint auf diesem Subjekt NICHT als
 *   blank bestandenes PASS enden (status='PASS' bei leerem unchecked).
 *   Jede ehrliche Form besteht:
 *     - Constraint in unchecked[] (es gibt genau EIN Constraint pro
 *       Aufruf → unchecked.length > 0 referenziert zwingend dieses),
 *     - status FAIL mit Grund, status PARTIAL,
 *     - oder die Implementierung misst künftig wirklich (dann ist
 *       bbox_reliability nicht mehr 'not_measurable' → Pin vacuous-PASS).
 *   KONTROLL-PIN: ein reliables, statisches Subjekt mit erfülltem
 *   INSIDE bleibt PASS — der Pin erzwingt also keine Pauschal-Skepsis.
 *
 * Form: eigenständig, kein Framework, deterministisch, kein src-Eingriff.
 * Exit 1 wenn rot.
 */
import * as M from '../../src/pipeline.js';

// ── Fixtures EXAKT aus probe_R11-07.mjs ────────────────────────────────
const cssFar = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="120" viewBox="0 0 220 120">
  <style>
    @keyframes escape { from { transform: translateX(0px); } to { transform: translateX(150px); } }
    #cssmove { animation: escape 1s linear infinite; }
  </style>
  <rect id="frame" x="10" y="10" width="90" height="70" fill="none" stroke="#111"/>
  <rect id="cssmove" x="20" y="30" width="24" height="24" fill="#aa00aa"/>
</svg>`;

const transform3d = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="120" viewBox="0 0 220 120">
  <rect id="frame" x="10" y="10" width="90" height="70" fill="none" stroke="#111"/>
  <rect id="three" x="20" y="30" width="24" height="24" fill="#00aa00"
    style="transform: matrix3d(1,0,0,0.001, 0,1,0,0, 0,0,1,0, 0,0,0,1); transform-origin: 0 0;"/>
</svg>`;

// Kontrolle: identische Geometrie wie cssFar, aber statisch & reliabel —
// #solid (20,30,24x24) liegt vollständig in #frame (10,10,90x70).
const kontrolle = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="120" viewBox="0 0 220 120">
  <rect id="frame" x="10" y="10" width="90" height="70" fill="none" stroke="#111"/>
  <rect id="solid" x="20" y="30" width="24" height="24" fill="#aa00aa"/>
</svg>`;

let fails = 0;
function assert(name, cond, ist) {
  const status = cond ? 'PASS' : 'FAIL';
  if (!cond) fails++;
  console.log(`ASSERT ${name}: ${status} — ist: ${ist}`);
}

/** Ein analyze-Lauf mit genau EINEM Constraint, reduziert auf die Pin-Fakten. */
async function lauf(svg, id, constraint) {
  const an = await M.analyze(svg, [constraint]);
  const s = an?.structured;
  const el = (s?.scene?.elements || []).find((e) => e.id === id);
  return {
    status: s?.status,
    reliability: el?.bbox_reliability,
    warnings: el?.warnings ?? [],
    unchecked: Array.isArray(s?.unchecked) ? s.unchecked : [],
    corrections: Array.isArray(s?.corrections) ? s.corrections : [],
    gefunden: el != null && s != null,
  };
}

/**
 * DER PIN: 'not_measurable' + blank bestandenes PASS ist ein
 * Selbst-Widerspruch. Ehrlich (PASS des Pins) ist alles andere:
 * messbar geworden, status != 'PASS', oder unchecked nicht leer.
 */
function pinVerletzt(r) {
  return (
    r.reliability === 'not_measurable' &&
    r.status === 'PASS' &&
    r.unchecked.length === 0
  );
}

function istZeile(r) {
  return (
    `status=${r.status}, bbox_reliability=${r.reliability}, ` +
    `unchecked=${JSON.stringify(r.unchecked)}, corrections=${JSON.stringify(r.corrections)}, ` +
    `warnings=${JSON.stringify(r.warnings)}`
  );
}

try {
  await M.init();

  // ── Fall 1: CSS-Animation (NON_DETERMINISTIC_MOTION) ────────────────
  const r1 = await lauf(cssFar, 'cssmove', '#cssmove INSIDE #frame');
  assert(
    'cssFar_subjekt_analysierbar',
    r1.gefunden,
    r1.gefunden ? `#cssmove im structured.scene gefunden (${istZeile(r1)})` : 'analyze lieferte kein Subjekt #cssmove',
  );
  assert(
    'pin_cssFar_kein_blankes_PASS_bei_not_measurable',
    !pinVerletzt(r1),
    pinVerletzt(r1)
      ? `VERLETZT — Pipeline erklärt #cssmove selbst für nicht messbar und wertet den INSIDE-Constraint trotzdem als bestanden: ${istZeile(r1)}`
      : `ehrliche Form: ${istZeile(r1)}`,
  );

  // ── Fall 2: 3D-Transform (3D_TRANSFORM_ANCESTOR) ────────────────────
  const r2 = await lauf(transform3d, 'three', '#three INSIDE #frame');
  assert(
    'transform3d_subjekt_analysierbar',
    r2.gefunden,
    r2.gefunden ? `#three im structured.scene gefunden (${istZeile(r2)})` : 'analyze lieferte kein Subjekt #three',
  );
  assert(
    'pin_transform3d_kein_blankes_PASS_bei_not_measurable',
    !pinVerletzt(r2),
    pinVerletzt(r2)
      ? `VERLETZT — Pipeline erklärt #three selbst für nicht messbar und wertet den INSIDE-Constraint trotzdem als bestanden: ${istZeile(r2)}`
      : `ehrliche Form: ${istZeile(r2)}`,
  );

  // ── KONTROLL-PIN: reliables Subjekt + erfüllter INSIDE bleibt PASS ──
  // Verhindert die billige Flucht "alles wird unchecked/FAIL".
  const rc = await lauf(kontrolle, 'solid', '#solid INSIDE #frame');
  assert(
    'kontrolle_reliable_inside_bleibt_PASS',
    rc.status === 'PASS' && rc.unchecked.length === 0 && rc.reliability !== 'not_measurable',
    istZeile(rc),
  );
} catch (err) {
  fails++;
  console.log(`ASSERT testlauf_ohne_exception: FAIL — ist: ${err?.message || err}`);
} finally {
  await M.shutdown();
}

if (fails > 0) {
  console.log(`H10-RED R11-07: ROT (${fails} FAIL)`);
  process.exit(1);
} else {
  console.log('H10-RED R11-07: GRUEN');
}
