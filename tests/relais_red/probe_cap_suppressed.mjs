/**
 * RELAIS-Probe (JS-API) — Anzeige-Cap 7 / suppressed / Cap-Geltung überall.
 *
 * Claims: C-GLO-01 · C-INS-CAP · C-INS-STRUCT · C-PAL-CAP (claims.js).
 * Beweist (DR-1 Probe A erweitert):
 *   - analyze: 9 Elemente ⇒ scene.elements==7, iteration.suppressed==2;
 *     Constraint auf VERDECKTEM Element (#e9) wird trotzdem geprüft (Korrektur
 *     erscheint) — der Cap ist Anzeige-, nicht Mess-Grenze.
 *   - inspect: identischer Cap (umgeht ihn NICHT), scene.suppressed==2;
 *     structured trägt NUR scene (kein status/corrections); kein
 *     Nachlade-Parameter im Input-Schema (P6-Negativrand).
 *   - palette: 7 Einträge ohne Zähler; Text-Zeile nennt "(2 weitere)".
 *
 * Eigenständig, deterministisch, Exit 1 wenn rot.
 */
import { inspectTool, paletteTool } from '../../src/interface/tools.js';
import * as M from '../../src/pipeline.js';

// 9 Elemente; #e9 liegt RECHTS von #e1 ⇒ "#e9 LEFT-OF #e1" bricht beweisbar.
const rects = Array.from({ length: 9 }, (_, i) => {
  const id = `e${i + 1}`;
  return `<rect id="${id}" x="${10 + i * 80}" y="10" width="50" height="30" fill="royalblue"/>`;
}).join('');
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 100" width="800" height="100">${rects}</svg>`;

let failCount = 0;
function assert(name, cond, ist) {
  const verdict = cond ? 'PASS' : 'FAIL';
  if (!cond) failCount += 1;
  console.log(`ASSERT ${name}: ${verdict} — ist: ${ist}`);
}

try {
  await M.init();

  // analyze: Cap + Mess-Geltung jenseits des Caps.
  const a = await M.analyze(SVG, ['#e9 LEFT-OF #e1']);
  const aScene = a.structured?.scene;
  console.log(
    `OBS analyze: elements=${aScene?.elements?.length}, suppressed=${a.structured?.iteration?.suppressed}, corrections=${a.structured?.corrections?.length}`,
  );
  assert(
    'analyze_cap_7',
    aScene?.elements?.length === 7,
    `${aScene?.elements?.length}`,
  );
  assert(
    'analyze_suppressed_2',
    a.structured?.iteration?.suppressed === 2,
    `${a.structured?.iteration?.suppressed}`,
  );
  assert(
    'analyze_verdecktes_element_geprueft',
    (a.structured?.corrections || []).some((c) => c.element === '#e9'),
    `corrections=${JSON.stringify(a.structured?.corrections?.map((c) => c.element))}`,
  );

  // inspect: identischer Cap; structured NUR scene.
  const i = await M.inspect(SVG);
  const iKeys = Object.keys(i.structured || {}).sort();
  console.log(
    `OBS inspect: keys=${JSON.stringify(iKeys)}, suppressed=${i.structured?.scene?.suppressed}`,
  );
  assert(
    'inspect_cap_7',
    i.structured?.scene?.elements?.length === 7,
    `${i.structured?.scene?.elements?.length}`,
  );
  assert(
    'inspect_suppressed_2',
    i.structured?.scene?.suppressed === 2,
    `${i.structured?.scene?.suppressed}`,
  );
  assert(
    'inspect_structured_nur_scene',
    iKeys.join(',') === 'scene',
    `keys=${JSON.stringify(iKeys)} (meta nur bei Warn-Trunkierung — hier keine)`,
  );
  assert(
    'inspect_kein_nachlade_parameter',
    Object.keys(inspectTool.config.inputSchema).join(',') === 'svg',
    `inputSchema-Keys=${JSON.stringify(Object.keys(inspectTool.config.inputSchema))}`,
  );
  assert(
    'palette_kein_nachlade_parameter',
    Object.keys(paletteTool.config.inputSchema).join(',') === 'svg',
    `inputSchema-Keys=${JSON.stringify(Object.keys(paletteTool.config.inputSchema))}`,
  );

  // palette: 7 Einträge, ohne Zähler, Text-Zeile nennt den Rest.
  const p = await M.palette(SVG);
  const colors = p.structured?.colors || [];
  console.log(`OBS palette: colors=${colors.length}`);
  assert('palette_cap_7', colors.length === 7, `${colors.length}`);
  assert(
    'palette_ohne_zaehler',
    !('suppressed' in (p.structured || {})) &&
      colors.every((c) => !('suppressed' in c)),
    `structured-Keys=${JSON.stringify(Object.keys(p.structured || {}))}`,
  );
  assert(
    'palette_textzeile_weitere',
    (p.prose || '').includes('(2 weitere)'),
    JSON.stringify((p.prose || '').split('\n').pop()),
  );
} finally {
  await M.shutdown();
}

if (failCount > 0) {
  console.log(`RELAIS-PROBE cap_suppressed: ROT (${failCount} FAIL)`);
  process.exit(1);
} else {
  console.log('RELAIS-PROBE cap_suppressed: GRUEN');
  process.exit(0);
}
