/**
 * _validate.mjs — §1.2 ajv batch-validator (R2-F01)
 *
 * Reads MANIFEST.json + each <tool>/<kind>.output.json, extracts the
 * structuredContent field (MCP outputSchema target), and validates against
 * the JSON-Schema dump from MCP `tools/list`. Exit 1 on any violation.
 *
 * Run: node tests/fixtures/samples/_validate.mjs
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const manifest = JSON.parse(readFileSync(join(HERE, 'MANIFEST.json'), 'utf8'));

// Capture tools/list as JSON-Schema source (server-truth dump).
// §HEAL-7/E (Codex Hermetik) Inspector-Aufloesung:
//   (1) LOKAL, wenn node_modules den Inspector traegt (kein Netz noetig).
//   (2) Sonst npx — HART TIMEOUT-GEBUNDEN: ohne Netz haengt der npx-Registry-
//       Fetch sonst unbegrenzt (Gate-Haenger). Timeout/Fehler ⇒ ROT mit
//       Klartext "Netz für _validate nötig" statt Haenger. Vendoring des
//       Inspectors = Folge-Record, falls Offline-Gate-Laeufe gebraucht werden.
const localInspector = join(ROOT, 'node_modules', '.bin', 'mcp-inspector');
const inspectorCmd = existsSync(localInspector)
  ? localInspector
  : 'npx --yes @modelcontextprotocol/inspector';
let dump;
try {
  dump = execSync(
    `${inspectorCmd} --cli node ${join(ROOT, 'src/interface/server.js')} --method tools/list`,
    {
      encoding: 'utf8',
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    },
  );
} catch (e) {
  const wasTimeout = e.signal === 'SIGTERM' || e.code === 'ETIMEDOUT';
  console.log(
    `  FAIL: tools/list-Dump nicht beschaffbar (${wasTimeout ? 'Timeout 120s' : String(e.message || e).split('\n')[0]}) — ` +
      'Netz für _validate nötig: @modelcontextprotocol/inspector ist nicht lokal aufgeloest ' +
      `(${localInspector} fehlt) und der npx-Fetch schlug fehl/hing. Vendoring: Folge-Record.`,
  );
  console.log('\najv: 0 pass, 1 fail');
  process.exit(1);
}
const tools = JSON.parse(dump).tools;
const schemaByTool = Object.fromEntries(
  tools.map((t) => [t.name, t.outputSchema]),
);

// FIX_PLAN §1.3 Schicht 2: ajv-formats aktiviert UUID-Format-Enforcement.
// Ohne diesen Aufruf ignoriert ajv `format: "uuid"` im iterationSchema —
// der Korpus-Validator wäre Theater (struktur-PASS bei nicht-UUID-Strings).
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
let pass = 0,
  fail = 0;

for (const s of manifest.samples) {
  const outputDoc = JSON.parse(readFileSync(join(HERE, s.outputPath), 'utf8'));
  const structured = outputDoc.structuredContent;
  const schema = schemaByTool[s.tool];
  if (!schema) {
    console.log(`  FAIL: ${s.id} — no outputSchema for ${s.tool}`);
    fail++;
    continue;
  }
  if (structured === undefined) {
    console.log(
      `  SKIP: ${s.id} — no structuredContent (isError without payload)`,
    );
    continue;
  }
  const validate = ajv.compile(schema);
  if (validate(structured)) {
    console.log(`  PASS: ${s.id} (${s.schema})`);
    pass++;
  } else {
    console.log(`  FAIL: ${s.id} (${s.schema})`);
    for (const err of validate.errors) {
      console.log(`        ${err.instancePath || '/'} ${err.message}`);
    }
    fail++;
  }
}

console.log(`\najv: ${pass} pass, ${fail} fail`);
// §HEAL-7/E Gate-Hermetik: der Lauf-Report gehoert NICHT in den getrackten
// Korpus — jeder Gate-Lauf modifizierte tests/fixtures/samples/_validate.report.json
// (dirty tree NACH dem Gate = Hermetik-Bruch). Untracked + .gitignore-gedeckt:
// an internal session artifact (ignoriert via .gitignore 'an internal session artifact').
const reportDir = join(ROOT, 'sessions', 'agents');
mkdirSync(reportDir, { recursive: true });
writeFileSync(
  join(reportDir, '_validate.report.json'),
  JSON.stringify(
    {
      pass,
      fail,
      headHash: manifest.headHash,
      ranAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
if (fail > 0) process.exit(1);
