/**
 * test_mcp_roundtrip.mjs — FIX_PLAN §1.3 Schicht 2 / Task #7
 *
 * E2E-Roundtrip ueber echtes MCP/stdio: ein einziger Server-Prozess, mehrere
 * tools/call-Aufrufe in derselben Session. Testet damit Server-State (grids-Map),
 * den `npx inspector --cli` per Single-Shot-Spawn nicht abdecken kann.
 *
 * Erwartungen (aus User-Brief):
 *   1. tools/list → 9 Tools (§1.4: +vector_mirror_bookmark; §1.9: +vector_mirror_selftest),
 *      compare.inputSchema verlangt analysisId als Pflichtfeld (Disjunktion: UUID ODER Bookmark-Name)
 *   2. analyze → structuredContent.iteration.analysisId ist UUID v4
 *   3. compare(extracted-ID) → strukturiertes Ergebnis, kein -32602-Reject, isError=false
 *   4. Alle 9 Tools ohne -32602/Schema-Reject
 *   5. §1.4 Bookmark-Roundtrip: analyze → bookmark(name, id) → compare(svg, [], name)
 *      → compare löst Name zur Quell-UUID auf (iteration.analysisId === analyze-UUID)
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let passed = 0,
  failed = 0;
function assertEqual(label, actual, expected) {
  if (actual === expected) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(
      `  FAIL: ${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
    );
    failed++;
  }
}
function assertTrue(label, cond, detail = '') {
  if (cond) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SVG_A =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle id="dot" cx="50" cy="50" r="10" fill="red"/></svg>';
const SVG_B =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle id="dot" cx="60" cy="50" r="10" fill="red"/></svg>';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['src/interface/server.js'],
});
const client = new Client({ name: 'lru-roundtrip', version: '1.0.0' });
await client.connect(transport);

try {
  // ── ERWARTUNG 1: tools/list ─────────────────────────────────────────────────
  console.log(
    '--- ERWARTUNG 1: tools/list (9 Tools, compare-Disjunktions-Vertrag) ---',
  );
  const list = await client.listTools();
  // §1.4: vector_mirror_bookmark additiv → 8 Tools. §1.9: +vector_mirror_selftest → 9.
  assertEqual('9 Tools registriert', list.tools.length, 9);
  const names = list.tools.map((t) => t.name).sort();
  assertEqual(
    'Tool-Namen kanonisch (analyze/arrange/bookmark/compare/constraints/inspect/palette/selftest/status)',
    JSON.stringify(names),
    JSON.stringify([
      'vector_mirror_analyze',
      'vector_mirror_arrange',
      'vector_mirror_bookmark',
      'vector_mirror_compare',
      'vector_mirror_constraints',
      'vector_mirror_inspect',
      'vector_mirror_palette',
      'vector_mirror_selftest',
      'vector_mirror_status',
    ]),
  );

  const compareTool = list.tools.find(
    (t) => t.name === 'vector_mirror_compare',
  );
  const cmpReq = compareTool.inputSchema.required ?? [];
  assertTrue(
    'compare.inputSchema.required enthaelt "svg" und "analysisId" (§1.1 Stateless RPC)',
    JSON.stringify([...cmpReq].sort()) ===
      JSON.stringify(['analysisId', 'svg']),
    `got ${JSON.stringify(cmpReq)}`,
  );
  assertTrue(
    'compare.inputSchema.properties.analysisId existiert',
    !!compareTool.inputSchema.properties.analysisId,
  );
  // §1.4: compareInput.analysisId akzeptiert jetzt UUID ODER Bookmark-Name
  // (Disjunktion, .min(1)). Das JSON-Schema trägt daher KEIN format:"uuid" mehr —
  // es bleibt ein einfacher String. Die §1.1-Invariante (Pflichtfeld) bleibt
  // separat über das required-Array geprüft (oben + unten).
  assertEqual(
    'compare.analysisId.type === "string" (Disjunktion: UUID|Name, kein format:uuid)',
    compareTool.inputSchema.properties.analysisId.type,
    'string',
  );
  assertTrue(
    'compare.analysisId trägt KEIN format:"uuid" mehr (§1.4 Disjunktion)',
    compareTool.inputSchema.properties.analysisId.format === undefined,
    `got format=${JSON.stringify(compareTool.inputSchema.properties.analysisId.format)}`,
  );
  assertTrue(
    'analysisId IST in compare.inputSchema.required (§1.1 Stateless RPC: Pflichtfeld)',
    cmpReq.includes('analysisId'),
    `got ${JSON.stringify(cmpReq)}`,
  );

  const analyzeTool = list.tools.find(
    (t) => t.name === 'vector_mirror_analyze',
  );
  const iterReq = analyzeTool.outputSchema.properties.iteration.required ?? [];
  assertTrue(
    'analyze.outputSchema.iteration.required enthaelt analysisId (Server-Garantie)',
    iterReq.includes('analysisId'),
    `got ${JSON.stringify(iterReq)}`,
  );
  // §H9 P2 (Wahrheits-Rekalibrierung dieses Pins): die Error-Hülle trägt
  // analysisId:null statt einer ERFUNDENEN frischen UUID → iterationSchema ist
  // .nullable() und der Dump rendert anyOf:[{string,format:uuid},{null}].
  // Die Server-Garantie bleibt zweiteilig gepinnt: (a) Pflichtfeld (required,
  // oben), (b) der String-Zweig erzwingt weiterhin format:"uuid" und die
  // EINZIGE Alternative ist das ehrliche null — kein freier String möglich.
  const idDump =
    analyzeTool.outputSchema.properties.iteration.properties.analysisId;
  const idBranches = idDump.anyOf ?? [idDump];
  assertTrue(
    'analyze.outputSchema.iteration.analysisId: format:"uuid" auf dem String-Zweig + null als einzige Alternative (§H9 P2)',
    idBranches.some((b) => b.type === 'string' && b.format === 'uuid') &&
      idBranches.every(
        (b) => (b.type === 'string' && b.format === 'uuid') || b.type === 'null',
      ),
    `got ${JSON.stringify(idDump)}`,
  );

  // ── ERWARTUNG 2: analyze → analysisId ───────────────────────────────────────
  console.log(
    '--- ERWARTUNG 2: analyze liefert UUID v4 in iteration.analysisId ---',
  );
  const r1 = await client.callTool({
    name: 'vector_mirror_analyze',
    arguments: { svg: SVG_A },
  });
  assertEqual('analyze: isError === false', r1.isError ?? false, false);
  const idA = r1.structuredContent?.iteration?.analysisId;
  assertTrue('analyze: analysisId vorhanden', typeof idA === 'string');
  assertTrue(`analyze: analysisId UUID v4 [${idA}]`, UUID_V4.test(idA ?? ''));

  // ── ERWARTUNG 3: compare(extracted-ID) → strukturiertes Ergebnis ────────────
  console.log('--- ERWARTUNG 3: compare(extracted-ID) ohne -32602 ---');
  const r2 = await client.callTool({
    name: 'vector_mirror_compare',
    arguments: { svg: SVG_B, analysisId: idA },
  });
  assertEqual('compare: isError === false', r2.isError ?? false, false);
  assertTrue('compare: structuredContent vorhanden', !!r2.structuredContent);
  assertEqual(
    'compare: iteration.analysisId === idA (Cache hit, ID weitergereicht)',
    r2.structuredContent?.iteration?.analysisId,
    idA,
  );

  // §1.1: compare ohne analysisId → Schema-Reject am Interface (-32602 / isError)
  let r3Threw = null;
  let r3 = null;
  try {
    r3 = await client.callTool({
      name: 'vector_mirror_compare',
      arguments: { svg: SVG_B },
    });
  } catch (e) {
    r3Threw = e;
  }
  // Akzeptiere beide MCP-SDK-Verhalten: synchroner McpError ODER isError:true
  assertTrue(
    'compare ohne ID: Schema-Reject (-32602 oder isError:true) — §1.1 Pflichtfeld',
    r3Threw !== null || r3?.isError === true,
    r3Threw
      ? `threw: ${r3Threw?.code ?? r3Threw?.message}`
      : `isError: ${r3?.isError}`,
  );

  // ── ERWARTUNG 4: Alle 9 Tools ohne Errors ───────────────────────────────────
  console.log('--- ERWARTUNG 4: Alle 9 Tools roundtrip-fest ---');

  // analyze (already done as r1)
  assertEqual(
    'analyze: bereits in Erwartung 2 verifiziert',
    r1.isError ?? false,
    false,
  );

  // compare (already done as r2)
  assertEqual(
    'compare: bereits in Erwartung 3 verifiziert',
    r2.isError ?? false,
    false,
  );

  // inspect
  const rIns = await client.callTool({
    name: 'vector_mirror_inspect',
    arguments: { svg: SVG_A },
  });
  assertEqual('inspect: isError === false', rIns.isError ?? false, false);
  assertTrue('inspect: scene vorhanden', !!rIns.structuredContent?.scene);

  // palette
  const rPal = await client.callTool({
    name: 'vector_mirror_palette',
    arguments: { svg: SVG_A },
  });
  assertEqual('palette: isError === false', rPal.isError ?? false, false);
  assertTrue(
    'palette: colors-Array vorhanden',
    Array.isArray(rPal.structuredContent?.colors),
  );

  // arrange
  const rArr = await client.callTool({
    name: 'vector_mirror_arrange',
    arguments: {
      canvas: { width: 400, height: 300 },
      elements: [
        { id: 'bg', tag: 'rect', width: 400, height: 300 },
        { id: 'sun', tag: 'circle', r: 30 },
      ],
      constraints: ['#sun CENTERED-IN #bg'],
    },
  });
  assertEqual('arrange: isError === false', rArr.isError ?? false, false);
  assertTrue(
    'arrange: attributes vorhanden',
    !!rArr.structuredContent?.attributes,
  );

  // constraints
  const rCt = await client.callTool({
    name: 'vector_mirror_constraints',
    arguments: {},
  });
  assertEqual('constraints: isError === false', rCt.isError ?? false, false);
  assertEqual(
    'constraints: 11 types',
    rCt.structuredContent?.types?.length,
    11,
  );

  // status
  const rSt = await client.callTool({
    name: 'vector_mirror_status',
    arguments: {},
  });
  assertEqual('status: isError === false', rSt.isError ?? false, false);
  assertEqual(
    'status: lastAnalysis === true (nach analyze)',
    rSt.structuredContent?.lastAnalysis,
    true,
  );
  assertEqual(
    'status: browser === running',
    rSt.structuredContent?.browser,
    'running',
  );

  // selftest (§1.9): 9. Tool — läuft die 5 Eichkörper, PASS + 5/5 kalibriert.
  const rSelf = await client.callTool({
    name: 'vector_mirror_selftest',
    arguments: {},
  });
  assertEqual('selftest: isError === false', rSelf.isError ?? false, false);
  assertEqual(
    'selftest: status === PASS (5 Eichkörper kalibriert)',
    rSelf.structuredContent?.status,
    'PASS',
  );
  assertEqual(
    'selftest: calibrated === 5',
    rSelf.structuredContent?.calibrated,
    5,
  );

  // ── ERWARTUNG 5: §1.4 Bookmark-Roundtrip über echtes MCP/stdio ──────────────
  // analyze → bookmark(name, id) → compare(svg, [], name). Verifiziert die
  // Named-Baseline-Capability + die Quell-UUID-Auflösung (KORR-2) end-to-end:
  // compare gegen den NAMEN liefert iteration.analysisId === die analyze-UUID
  // (nicht den Namen) und gleicher Input → 0 Diff.
  console.log(
    '--- ERWARTUNG 5: §1.4 Bookmark-Roundtrip (analyze→bookmark→compare(name)) ---',
  );
  const rBaseline = await client.callTool({
    name: 'vector_mirror_analyze',
    arguments: { svg: SVG_A },
  });
  assertEqual(
    'bookmark-rt: baseline analyze isError === false',
    rBaseline.isError ?? false,
    false,
  );
  const baselineId = rBaseline.structuredContent?.iteration?.analysisId;
  assertTrue(
    `bookmark-rt: baseline analysisId ist UUID v4 [${baselineId}]`,
    UUID_V4.test(baselineId ?? ''),
  );

  const rBm = await client.callTool({
    name: 'vector_mirror_bookmark',
    arguments: { name: 'e2e_baseline', analysisId: baselineId },
  });
  assertEqual(
    'bookmark-rt: bookmark isError === false',
    rBm.isError ?? false,
    false,
  );
  assertEqual(
    'bookmark-rt: stored === true',
    rBm.structuredContent?.stored,
    true,
  );
  assertEqual(
    'bookmark-rt: name === "e2e_baseline"',
    rBm.structuredContent?.name,
    'e2e_baseline',
  );
  assertEqual(
    'bookmark-rt: structuredContent.analysisId === Quell-UUID (kein Name)',
    rBm.structuredContent?.analysisId,
    baselineId,
  );

  const rCmpName = await client.callTool({
    name: 'vector_mirror_compare',
    arguments: { svg: SVG_A, analysisId: 'e2e_baseline' },
  });
  assertEqual(
    'bookmark-rt: compare(name) isError === false',
    rCmpName.isError ?? false,
    false,
  );
  assertTrue(
    'bookmark-rt: compare(name) structuredContent vorhanden',
    !!rCmpName.structuredContent,
  );
  assertEqual(
    'bookmark-rt: compare(name) iteration.analysisId === Quell-UUID (Name→UUID aufgelöst)',
    rCmpName.structuredContent?.iteration?.analysisId,
    baselineId,
  );
  assertEqual(
    'bookmark-rt: gleicher Input → 0 Diff (Named-Baseline korrekt)',
    rCmpName.structuredContent?.diff?.length,
    0,
  );
} finally {
  await client.close();
}

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
