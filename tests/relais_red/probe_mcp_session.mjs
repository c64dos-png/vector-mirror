/**
 * RELAIS-Probe (MCP-Rand) — Prozess-Lokalität von analysisId/Bookmarks.
 *
 * Claim: C-GLO-04 (claims.js). Spec §3 G4 / D7.
 * Beweist mit ZWEI echten Server-Prozessen:
 *   1. Prozess A: analyze ⇒ analysisId.
 *   2. Prozess A wird beendet; Prozess B (frisch): compare mit derselben
 *      analysisId ⇒ isError:true + NO_BASELINE — die Baseline lebte NUR im
 *      Prozess A (in-memory). Ein-Aufruf-Clients können compare nie nutzen.
 *   Gegenkontrolle: compare im SELBEN Prozess A funktioniert.
 *
 * Eigenständig, deterministisch, Exit 1 wenn rot.
 */
import { createSession } from './_mcp_client.mjs';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100">' +
  '<rect id="r1" x="10" y="10" width="60" height="40" fill="red"/></svg>';

let failCount = 0;
function assert(name, cond, ist) {
  const verdict = cond ? 'PASS' : 'FAIL';
  if (!cond) failCount += 1;
  console.log(`ASSERT ${name}: ${verdict} — ist: ${ist}`);
}

let analysisId = null;

// Prozess A
{
  const a = createSession();
  try {
    await a.init();
    const ana = await a.call('vector_mirror_analyze', {
      svg: SVG,
      constraints: [],
    });
    analysisId = ana.result?.structuredContent?.iteration?.analysisId;
    assert(
      'prozessA_analysisId',
      typeof analysisId === 'string',
      `analysisId=${analysisId}`,
    );

    const same = await a.call('vector_mirror_compare', {
      svg: SVG,
      constraints: [],
      analysisId,
    });
    assert(
      'prozessA_compare_funktioniert',
      same.result?.isError !== true &&
        !!same.result?.structuredContent?.iteration,
      `isError=${same.result?.isError}`,
    );
  } finally {
    a.close();
  }
}

// Prozess B (frisch) — dieselbe analysisId ist hier wertlos (in-memory).
{
  const b = createSession();
  try {
    await b.init();
    const res = await b.call('vector_mirror_compare', {
      svg: SVG,
      constraints: [],
      analysisId,
    });
    const r = res.result || {};
    console.log(
      `OBS prozessB compare: isError=${r.isError}, code=${JSON.stringify(r.structuredContent?.error?.code)}`,
    );
    assert(
      'prozessB_baseline_weg',
      r.isError === true && r.structuredContent?.error?.code === 'NO_BASELINE',
      `isError=${r.isError}, error=${JSON.stringify(r.structuredContent?.error)}`,
    );
  } finally {
    b.close();
  }
}

if (failCount > 0) {
  console.log(`RELAIS-PROBE session: ROT (${failCount} FAIL)`);
  process.exit(1);
} else {
  console.log('RELAIS-PROBE session: GRUEN');
  process.exit(0);
}
