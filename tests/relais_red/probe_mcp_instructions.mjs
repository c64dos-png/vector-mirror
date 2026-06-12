/**
 * RELAIS-Probe (MCP-Rand) — instructions-Auslieferung + Quickstart-Wahrheit.
 *
 * Claims: C-QS-ORI · C-QS-WORKFLOW (claims.js). Spec §4/D7.
 * Beweist gegen den ECHTEN stdio-Server (Client: R9a mcp_client.mjs):
 *   1. initialize-Antwort trägt instructions WORTIDENTISCH == QUICKSTART
 *      (Register-Projektion erreicht den Konsumenten).
 *   2. tools/list: exakt die 9 Tools; KEIN render-/screenshot-Tool
 *      (C-QS-ORI Negativrand: „liefert nie ein Bild zurück").
 *   3. Jeder im Quickstart genannte vector_mirror_*-Name existiert in
 *      tools/list (C-QS-WORKFLOW nennt nur lebende Tools).
 *
 * Eigenständig, deterministisch, Exit 1 wenn rot.
 */

import { createSession } from './_mcp_client.mjs';
import { QUICKSTART } from '../../src/interface/claims.js';

let failCount = 0;
function assert(name, cond, ist) {
  const verdict = cond ? 'PASS' : 'FAIL';
  if (!cond) failCount += 1;
  console.log(`ASSERT ${name}: ${verdict} — ist: ${ist}`);
}

const session = createSession();
try {
  const initRes = await session.init();
  const instructions = initRes.result?.instructions;

  assert(
    'instructions_wortidentisch',
    instructions === QUICKSTART,
    instructions === QUICKSTART
      ? `wortidentisch (${QUICKSTART.length} Zeichen)`
      : `weicht ab: typ=${typeof instructions}, laenge=${instructions?.length}`,
  );
  assert(
    'quickstart_budget',
    QUICKSTART.length <= 2500 && QUICKSTART.split('\n').length <= 35,
    `${QUICKSTART.length} Zeichen, ${QUICKSTART.split('\n').length} Zeilen (Budget 2500/35)`,
  );

  const listRes = await session.rpc('tools/list', {});
  const names = (listRes.result?.tools || []).map((t) => t.name);
  console.log(`OBS tools/list: ${names.length} Tools`);

  assert(
    'neun_tools',
    names.length === 9,
    `${names.length} Tools: ${names.join(', ')}`,
  );
  assert(
    'kein_render_tool',
    !names.some((n) => /render|screenshot|png|image/i.test(n)),
    `Tool-Namen: ${names.join(', ')}`,
  );

  // C-QS-WORKFLOW: jeder genannte Tool-Name existiert.
  const mentioned = [
    ...new Set(QUICKSTART.match(/vector_mirror_[a-z]+/g) || []),
  ];
  const missing = mentioned.filter((n) => !names.includes(n));
  assert(
    'quickstart_nennt_nur_lebende_tools',
    mentioned.length >= 6 && missing.length === 0,
    `genannt: ${mentioned.length}, fehlend: ${JSON.stringify(missing)}`,
  );
} finally {
  session.close();
}

if (failCount > 0) {
  console.log(`RELAIS-PROBE instructions: ROT (${failCount} FAIL)`);
  process.exit(1);
} else {
  console.log('RELAIS-PROBE instructions: GRUEN');
  process.exit(0);
}
