/**
 * H9-RED K-13bc — compare-Vertragsbruch ohne Basis.
 *
 * BEFUND: In einem FRISCHEN Prozess liefert compare(svg, [], <nie erzeugte
 * analysisId>) heute { structured: null } (Schema-Bruch: kein ehrliches
 * Fehler-Objekt, status=undefined) und eine prose, die als Handlungsanweisung
 * den MCP-Tool-Namen "vector_mirror_analyze" nennt — der falsche Kanal fuer
 * die JS-API (dort heisst der Schritt analyze()).
 *
 * WAHRHEITS-PIN (implementierungsagnostisch):
 *   (a) structured ist ein NON-NULL Objekt — eine ehrliche Fehler-Form
 *       (beliebiger Gestalt) statt Schema-Bruch via null.
 *   (b) prose ist ein String und nennt NICHT "vector_mirror_analyze"
 *       (MCP-Name gehoert nicht in den JS-API-Kanal).
 *   (c) §H9 P2 (VERSTAERKUNG, additiv): die Fehler-Huelle darf sich nicht
 *       selbst widersprechen — KEINE convergence:'SOLVED'-Behauptung im
 *       Fehlerfall (es gab keine Messung, nichts ist "geloest").
 *   (d) §H9 P2 (VERSTAERKUNG, additiv): die Fehler-Huelle darf KEINE frische
 *       analysisId als echt praesentieren — eine valide UUID, die kein Grid
 *       referenziert, ist eine erfundene Korrelations-ID (null/absent/
 *       Nicht-UUID-Sentinel sind ehrliche Formen).
 * Jede korrekte Implementierung (egal welche ehrliche Fehler-Form, egal
 * welcher Wortlaut ohne den MCP-Namen) besteht alle Assertions.
 *
 * Eigenstaendig, kein Framework, deterministisch (compare kehrt VOR jedem
 * Render zurueck — kein Pixel-Pfad beteiligt). Exit 1 wenn rot.
 */
import * as M from '../../src/pipeline.js';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<rect id="r1" x="10" y="10" width="30" height="30" fill="#3366cc"/></svg>';

// Valide UUID-v4-Form, in diesem frischen Prozess nie von analyze() erzeugt.
const PHANTOM_ID = '00000000-0000-4000-8000-000000000000';

let fails = 0;
function assert(name, cond, ist) {
  const ok = cond === true;
  if (!ok) fails++;
  console.log(`ASSERT ${name}: ${ok ? 'PASS' : 'FAIL'} — ist: ${ist}`);
}

let r;
let callError = null;
try {
  await M.init();
  r = await M.compare(SVG, [], PHANTOM_ID);
} catch (err) {
  callError = err;
} finally {
  await M.shutdown();
}

if (callError) {
  // Vertrag ist {prose, structured} — eine Exception erfuellt keinen der Pins.
  assert(
    'structured_non_null_objekt',
    false,
    `compare warf Exception: ${callError.message}`,
  );
  assert(
    'prose_ohne_mcp_toolname',
    false,
    `compare warf Exception: ${callError.message}`,
  );
  assert(
    'fehlerhuelle_behauptet_nicht_SOLVED',
    false,
    `compare warf Exception: ${callError.message}`,
  );
  assert(
    'fehlerhuelle_ohne_erfundene_analysisId',
    false,
    `compare warf Exception: ${callError.message}`,
  );
} else {
  const s = r === null || r === undefined ? undefined : r.structured;
  const status =
    s !== null && typeof s === 'object' ? String(s.status) : 'undefined';

  // PIN (a): ehrliche Fehler-Form statt Schema-Bruch — structured non-null Objekt.
  assert(
    'structured_non_null_objekt',
    s !== null && typeof s === 'object',
    `structured=${s === null ? 'null' : typeof s}, status=${status}`,
  );

  // PIN (b): JS-prose nennt nicht den MCP-Tool-Namen als Handlungsanweisung.
  const prose = r === null || r === undefined ? undefined : r.prose;
  assert(
    'prose_ohne_mcp_toolname',
    typeof prose === 'string' && !prose.includes('vector_mirror_analyze'),
    typeof prose === 'string' ? `prose=${JSON.stringify(prose)}` : `prose=${typeof prose}`,
  );

  // PIN (c) §H9 P2: kein Selbst-Widerspruch — die Fehler-Huelle behauptet
  // NIE 'SOLVED' (egal wo der convergence-Traeger liegt; heutige Form:
  // iteration.convergence).
  const it = s !== null && typeof s === 'object' ? s.iteration : undefined;
  const conv = it && typeof it === 'object' ? it.convergence : undefined;
  assert(
    'fehlerhuelle_behauptet_nicht_SOLVED',
    conv !== 'SOLVED',
    `iteration.convergence=${JSON.stringify(conv)}`,
  );

  // PIN (d) §H9 P2: keine erfundene Korrelations-ID — eine valide UUID in der
  // Fehler-Huelle referenziert KEIN Grid (compare lief gegen eine nie
  // erzeugte Basis) und waere als echt praesentierter Phantom-Verweis.
  const UUID_V4 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const aid = it && typeof it === 'object' ? it.analysisId : undefined;
  assert(
    'fehlerhuelle_ohne_erfundene_analysisId',
    !(typeof aid === 'string' && UUID_V4.test(aid)),
    `iteration.analysisId=${JSON.stringify(aid)}`,
  );
}

if (fails > 0) {
  console.log(`H9-RED K-13bc: ROT (${fails} FAIL)`);
  process.exit(1);
} else {
  console.log('H9-RED K-13bc: GRUEN');
  process.exit(0);
}
