/**
 * _generate.mjs — §1.2 Sample-Korpus-Generator (R2-F01)
 *
 * Captures real MCP tool responses for ajv batch-validate + mcp-inspector roundtrip.
 *
 * Korpus = 7 happy + 4 error = 11 samples.
 * N = Anzahl *ErrorResponse-Helper in src/interface/tools.js (analyze/inspect/palette/arrange).
 * Tools ohne Error-Helper: status, constraints (no failure path).
 * compare-Pair: in-process analyze(svg1) → analysisId aus structuredContent extrahieren →
 *   compare(svg2, analysisId) — demonstriert FIX_PLAN §1.3 Schicht-2 asymmetrischen Vertrag
 *   (analysisId optional in compareInput, REQUIRED + UUID v4 in iterationSchema).
 *
 * Output per sample:
 *   <tool>/<happy|error>.input.{svg|json}   → tool input
 *   <tool>/<happy|error>.output.json        → full MCP response (content + structuredContent + isError?)
 * Plus tests/fixtures/samples/MANIFEST.json with headHash + per-sample metadata.
 *
 * Run: node tests/fixtures/samples/_generate.mjs
 * NOT in tests/unit/ — helper process, not assertion code.
 */

import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  analyzeTool,
  compareTool,
  inspectTool,
  paletteTool,
  constraintsTool,
  statusTool,
  arrangeTool,
} from '../../../src/interface/tools.js';
import { init, shutdown } from '../../../src/pipeline.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const HEAD = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
const NOW = new Date().toISOString();

const SVG_HAPPY =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">' +
  '<rect id="bg" x="0" y="0" width="100" height="100" fill="lightblue"/>' +
  '<circle id="sun" cx="50" cy="50" r="20" fill="gold"/>' +
  '</svg>';
const SVG_HAPPY_V2 =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">' +
  '<rect id="bg" x="0" y="0" width="100" height="100" fill="lightblue"/>' +
  '<circle id="sun" cx="60" cy="50" r="20" fill="gold"/>' +
  '</svg>';
const SVG_BAD = '<not-svg>broken</not-svg>';

const samples = [];

function persist({ tool, kind, input, inputExt, response }) {
  const base = join(HERE, tool, `${kind}.input.${inputExt}`);
  const outPath = join(HERE, tool, `${kind}.output.json`);
  if (inputExt === 'svg') {
    writeFileSync(base, input, 'utf8');
  } else {
    writeFileSync(base, JSON.stringify(input, null, 2), 'utf8');
  }
  writeFileSync(outPath, JSON.stringify(response, null, 2), 'utf8');
  samples.push({
    id: `${tool}-${kind}`,
    tool: `vector_mirror_${tool}`,
    kind,
    sourceType: 'pipeline-capture',
    inputPath: `${tool}/${kind}.input.${inputExt}`,
    outputPath: `${tool}/${kind}.output.json`,
    schema: schemaForTool(tool),
    isError: response.isError === true,
    capturedAt: NOW,
    headHash: HEAD,
  });
}

function schemaForTool(tool) {
  if (tool === 'analyze' || tool === 'compare') return 'analyzeOutput';
  if (tool === 'inspect') return 'inspectOutput';
  if (tool === 'palette') return 'paletteOutput';
  if (tool === 'constraints') return 'constraintsOutput';
  if (tool === 'status') return 'statusOutput';
  if (tool === 'arrange') return 'arrangeOutput';
  throw new Error(`unknown tool ${tool}`);
}

await init();

try {
  // ── analyze (happy + error) ─────────────────────────────────
  const analyzeHappyResponse = await analyzeTool.handler({
    svg: SVG_HAPPY,
    constraints: ['#sun CENTERED-IN #bg'],
  });
  persist({
    tool: 'analyze',
    kind: 'happy',
    input: SVG_HAPPY,
    inputExt: 'svg',
    response: analyzeHappyResponse,
  });
  persist({
    tool: 'analyze',
    kind: 'error',
    input: SVG_BAD,
    inputExt: 'svg',
    response: await analyzeTool.handler({ svg: SVG_BAD }),
  });

  // ── compare (happy only) — Schicht 2: explizite analysisId aus analyze-Capture ──
  // compare/error wäre redundant: analyzeErrorResponse wird bereits durch analyze/error abgedeckt.
  const capturedAnalysisId =
    analyzeHappyResponse.structuredContent?.iteration?.analysisId;
  if (!capturedAnalysisId) {
    throw new Error(
      'Schicht-2-Vertrag verletzt: analyze.happy lieferte keine analysisId (Server-Garantie).',
    );
  }
  const compareInputArgs = {
    svg: SVG_HAPPY_V2,
    analysisId: capturedAnalysisId,
  };
  persist({
    tool: 'compare',
    kind: 'happy',
    input: compareInputArgs,
    inputExt: 'json',
    response: await compareTool.handler(compareInputArgs),
  });

  // ── inspect (happy + error) ─────────────────────────────────
  persist({
    tool: 'inspect',
    kind: 'happy',
    input: SVG_HAPPY,
    inputExt: 'svg',
    response: await inspectTool.handler({ svg: SVG_HAPPY }),
  });
  persist({
    tool: 'inspect',
    kind: 'error',
    input: SVG_BAD,
    inputExt: 'svg',
    response: await inspectTool.handler({ svg: SVG_BAD }),
  });

  // ── palette (happy + error) ─────────────────────────────────
  persist({
    tool: 'palette',
    kind: 'happy',
    input: SVG_HAPPY,
    inputExt: 'svg',
    response: await paletteTool.handler({ svg: SVG_HAPPY }),
  });
  persist({
    tool: 'palette',
    kind: 'error',
    input: SVG_BAD,
    inputExt: 'svg',
    response: await paletteTool.handler({ svg: SVG_BAD }),
  });

  // ── arrange (happy + error) ─────────────────────────────────
  const arrangeInputHappy = {
    canvas: { width: 100, height: 100 },
    elements: [
      { id: 'bg', tag: 'rect', width: 100, height: 100 },
      { id: 'sun', tag: 'circle', r: 20 },
    ],
    constraints: ['#sun CENTERED-IN #bg'],
  };
  persist({
    tool: 'arrange',
    kind: 'happy',
    input: arrangeInputHappy,
    inputExt: 'json',
    response: await arrangeTool.handler(arrangeInputHappy),
  });
  // arrangeErrorResponse fires when arrange() throws — feed unknown constraint type
  const arrangeInputError = {
    canvas: { width: 100, height: 100 },
    elements: [{ id: 'x', tag: 'rect', width: 50, height: 50 }],
    constraints: ['#x UNKNOWN-CONSTRAINT-TYPE #x'],
  };
  persist({
    tool: 'arrange',
    kind: 'error',
    input: arrangeInputError,
    inputExt: 'json',
    response: await arrangeTool.handler(arrangeInputError),
  });

  // ── constraints (happy only — no error helper) ──────────────
  persist({
    tool: 'constraints',
    kind: 'happy',
    input: {},
    inputExt: 'json',
    response: await constraintsTool.handler({}),
  });

  // ── status (happy only — no error helper) ───────────────────
  persist({
    tool: 'status',
    kind: 'happy',
    input: {},
    inputExt: 'json',
    response: await statusTool.handler({}),
  });

  // ── MANIFEST ────────────────────────────────────────────────
  const manifest = {
    generator: 'tests/fixtures/samples/_generate.mjs',
    purpose:
      'FIX_PLAN §1.2 R2-F01 ajv batch-validate + mcp-inspector roundtrip corpus',
    headHash: HEAD,
    capturedAt: NOW,
    totalSamples: samples.length,
    happyCount: samples.filter((s) => s.kind === 'happy').length,
    errorCount: samples.filter((s) => s.kind === 'error').length,
    samples,
  };
  writeFileSync(
    join(HERE, 'MANIFEST.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );
  console.log(
    `Persisted ${samples.length} samples (${manifest.happyCount} happy + ${manifest.errorCount} error) at HEAD ${HEAD.slice(0, 7)}`,
  );
} finally {
  await shutdown();
}
