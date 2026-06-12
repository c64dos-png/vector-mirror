/**
 * RELAIS §5 BODEN-WAHRHEIT-PROBE — kommt die H9-Verlust-Prosa am MCP-Rand an?
 *
 * Spec: docs/internal/an internal spec §5. Entscheidet den E1-Claim-Wortlaut
 * (Sanitizer-Offenlegung) BEVOR er in eine Description darf (D7).
 *
 * Fixture = K-05 (tests/h9_red/test_h9_k05.mjs): <text id="title"> + <rect
 * id="ok_ref">. Via tools/call an analyze UND inspect gegen den ECHTEN
 * stdio-Server-Prozess (Client wiederverwendet: R9a mcp_client.mjs).
 *
 * Assertions je Tool (Spec §5 Pkt 2):
 *   (a) content[0].text enthält "title" (Prosa-Offenlegung)?
 *   (b) serialisiertes structuredContent enthält "title"?
 *   (c) canvas_validity-Wert?
 *   (d) isError gesetzt?
 *
 * Verdikt-Matrix (Spec §5 Pkt 3):
 *   Prosa ✓ / structured ✗ ⇒ H1 (Kanal-Schatten): E1 nennt die Kanal-Wahrheit.
 *   Prosa ✗               ⇒ Härtungs-Befund, E1 darf KEINE Offenlegung behaupten.
 *   Prosa ✓ / structured ✓ ⇒ H2: E1 einfach, beide Kanäle nennen.
 *
 * Eigenständig, kein Framework, deterministisch. Exit 1 wenn rot (= Probe
 * selbst kaputt); das VERDIKT ist auch bei Exit 0 explizit im Output.
 */
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from './_mcp_client.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// HEAD protokollieren (Spec §5: Stand-Differenz H2 ausschließbar machen).
let head = '<unbekannt>';
try {
  head = execSync('git rev-parse --short HEAD', { cwd: ROOT })
    .toString()
    .trim();
} catch {
  /* kein git verfügbar — Probe läuft trotzdem, Stand bleibt unbenannt. */
}
console.log(`HEAD: ${head}`);

// K-05-Fixture — wortidentisch zu tests/h9_red/test_h9_k05.mjs.
const SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100">',
  '  <rect id="ok_ref" x="10" y="10" width="80" height="40" fill="#3366cc"/>',
  '  <text id="title" x="20" y="80" font-size="16" fill="#000000">Hallo</text>',
  '</svg>',
].join('\n');

let failCount = 0;
function assert(name, cond, ist) {
  const verdict = cond ? 'PASS' : 'FAIL';
  if (!cond) failCount += 1;
  console.log(`ASSERT ${name}: ${verdict} — ist: ${ist}`);
}

function findCanvasValidity(structured) {
  return structured?.scene?.canvas_validity;
}

const session = createSession();
const verdicts = {};
try {
  await session.init();

  for (const tool of ['vector_mirror_analyze', 'vector_mirror_inspect']) {
    const args =
      tool === 'vector_mirror_analyze'
        ? { svg: SVG, constraints: [] }
        : { svg: SVG };
    const res = await session.call(tool, args);
    if (res.error) {
      assert(
        `${tool}_rpc_ok`,
        false,
        `RPC-Fehler: ${JSON.stringify(res.error)}`,
      );
      continue;
    }
    const result = res.result || {};
    const prose = result.content?.[0]?.text ?? '';
    const structured = result.structuredContent ?? null;
    const structuredJson = JSON.stringify(structured);

    const a = prose.includes('title');
    const b = structuredJson.includes('title');
    const c = findCanvasValidity(structured);
    const d = result.isError === true;

    verdicts[tool] = {
      prosa: a,
      structured: b,
      canvas_validity: c,
      isError: d,
    };

    console.log(`\n[${tool}]`);
    console.log(`OBS (a) prose enthält "title":      ${a}`);
    console.log(`OBS (b) structured enthält "title": ${b}`);
    console.log(`OBS (c) canvas_validity:            ${c}`);
    console.log(`OBS (d) isError:                    ${d}`);
    const proseLossLine = prose
      .split('\n')
      .find((l) => l.includes('Sanitizer'));
    console.log(`OBS Verlust-Zeile: ${proseLossLine ?? '<keine>'}`);

    // Probe-Gesundheit (keine Verdikts-Vorwegnahme): beide Kanäle existieren.
    assert(
      `${tool}_kanaele_vorhanden`,
      typeof prose === 'string' && prose.length > 0 && structured !== null,
      `prose=${prose.length} Z., structured=${structured === null ? 'null' : 'objekt'}`,
    );
  }

  // ── VERDIKT-MATRIX ──
  console.log('\n=== VERDIKT-MATRIX (Spec §5 Pkt 3) ===');
  for (const [tool, v] of Object.entries(verdicts)) {
    const verdict = v.prosa
      ? v.structured
        ? 'Prosa ✓ / structured ✓ ⇒ H2 (beide Kanäle, E1 einfach)'
        : 'Prosa ✓ / structured ✗ ⇒ H1 Kanal-Schatten (E1 nennt Kanal-Wahrheit: Offenlegung NUR im Text-Kanal)'
      : 'Prosa ✗ ⇒ HÄRTUNGS-BEFUND (F-neu): E1 darf KEINE Offenlegung behaupten — STOPP für E1';
    console.log(`${tool}: ${verdict}`);
  }
} finally {
  session.close();
}

if (failCount > 0) {
  console.log(
    `\nRELAIS §5-PROBE: ROT (${failCount} FAIL — Probe selbst defekt)`,
  );
  process.exit(1);
} else {
  console.log('\nRELAIS §5-PROBE: GRUEN (Verdikt siehe Matrix)');
  process.exit(0);
}
