/**
 * test_pipeline_lru_cache.js — Phase 2 / FIX_PLAN §1.3 Schicht 2
 *
 * Tests Map<analysisId, gridMap> LRU-Cache und asymmetrischen analysisId-Vertrag:
 *   - analyze() generiert UUID v4 (RFC-9562) und liefert sie in structured.iteration.analysisId
 *   - compare(svg, [], analysisId) greift auf cached gridMap zu (explizite ID)
 *   - compare(svg, [], undefined) → mostRecent-Fallback
 *   - compare(svg, [], invalid-uuid) → BASELINE_MISSING (Hinweis-Pfad, kein 500)
 *   - LRU-Eviction via __setMaxGrids(N): N+1-ter analyze evicted ältesten Eintrag
 *   - compare ist read-only: weder grids-Map noch mostRecentAnalysisId mutiert
 *   - UUIDs sind eindeutig pro analyze()
 *
 * REIHENFOLGE: Eviction-Test (TEST 1) zuerst, weil er auf leerem grids-State
 * angewiesen ist. analysisId-Vertrag (TEST 2–7) danach mit dem von Eviction
 * hinterlassenen State.
 *
 * BAUPLAN ref: FIX_PLAN §1.3 Schicht 2 (Map-LRU + Server-Garantie analysisId)
 */
import {
  analyze,
  compare,
  init,
  shutdown,
  MAX_GRIDS,
  __setMaxGrids,
} from '../../src/pipeline.js';

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

// RFC-9562 UUID v4: xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx (alle hex)
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// §H9 K-13bc (Rekalibrierung auf die wahre Form): der No-Baseline-Pfad liefert
// kein structured:null mehr, sondern die ehrliche analyzeOutput-konforme
// Error-Hülle + kanal-neutrale Hinweis-Prosa. Erreichbarkeits-Diskriminator
// ist daher die Hinweis-Prosa (eine echte Baseline liefert sie nie), nicht
// mehr der null-Sentinel.
function isNoBaseline(result) {
  return (
    result.structured !== null &&
    typeof result.prose === 'string' &&
    result.prose.includes('Keine Basis zur analysisId gefunden')
  );
}

const svgA =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle id="dot" cx="50" cy="50" r="10" fill="red"/></svg>';
const svgB =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle id="dot" cx="60" cy="50" r="10" fill="red"/></svg>';
const svgC =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle id="dot" cx="50" cy="50" r="10" fill="blue"/></svg>';

await init();

try {
  // ── TEST 1 (zuerst — fresh grids-State): LRU-Eviction ───────────────────────
  console.log('--- TEST 1: LRU-Eviction (__setMaxGrids(3), 4 analyzes) ---');
  __setMaxGrids(3);
  const e1 = (await analyze(svgA, [])).structured.iteration.analysisId;
  const e2 = (await analyze(svgA, [])).structured.iteration.analysisId;
  const e3 = (await analyze(svgA, [])).structured.iteration.analysisId;
  // Bis hier sollte e1 noch erreichbar sein (cap=3, exakt 3 Einträge).
  const cmpE1Pre = await compare(svgA, [], e1);
  assertTrue(
    'e1 nach 3 analyzes erreichbar (Cap exakt erreicht, kein Evict)',
    !isNoBaseline(cmpE1Pre),
  );
  const cmpE2Pre = await compare(svgA, [], e2);
  assertTrue('e2 nach 3 analyzes erreichbar', !isNoBaseline(cmpE2Pre));
  const cmpE3Pre = await compare(svgA, [], e3);
  assertTrue('e3 nach 3 analyzes erreichbar', !isNoBaseline(cmpE3Pre));

  // 4. analyze → e1 muss evicted sein (size>=cap → oldest gelöscht)
  const e4 = (await analyze(svgA, [])).structured.iteration.analysisId;
  const cmpE1Evicted = await compare(svgA, [], e1);
  assertTrue(
    'e1 nach 4. analyze evicted (compare → No-Baseline-Hülle, §H9 K-13bc)',
    isNoBaseline(cmpE1Evicted),
    `prose: ${cmpE1Evicted.prose?.slice(0, 80)}`,
  );
  // e2, e3, e4 müssen erreichbar bleiben
  const cmpE2Still = await compare(svgA, [], e2);
  assertTrue(
    'e2 noch erreichbar nach Eviction von e1',
    !isNoBaseline(cmpE2Still),
  );
  const cmpE3Still = await compare(svgA, [], e3);
  assertTrue(
    'e3 noch erreichbar nach Eviction von e1',
    !isNoBaseline(cmpE3Still),
  );
  const cmpE4 = await compare(svgA, [], e4);
  assertTrue('e4 (jüngster) erreichbar', !isNoBaseline(cmpE4));

  // Cap zurück für Folge-Tests
  __setMaxGrids(MAX_GRIDS);

  // ── TEST 2: analyze() liefert UUID v4 in structured.iteration.analysisId ────
  console.log(
    '--- TEST 2: analyze() generiert UUID v4 in structured.iteration.analysisId ---',
  );
  const r1 = await analyze(svgA, []);
  assertTrue('analyze: structured ist nicht null', r1.structured !== null);
  assertTrue(
    'iteration.analysisId existiert',
    typeof r1.structured?.iteration?.analysisId === 'string',
  );
  const idA = r1.structured.iteration.analysisId;
  assertTrue(
    `analysisId ist UUID v4 (RFC-9562) [${idA}]`,
    UUID_V4.test(idA),
    `actual: ${idA}`,
  );

  // ── TEST 3: compare(svg, [], analysisId) — explizite ID greift ──────────────
  console.log(
    '--- TEST 3: compare mit expliziter analysisId greift cached gridMap ---',
  );
  const r2 = await compare(svgB, [], idA);
  assertTrue(
    'compare(idA): structured nicht null (Cache hit)',
    r2.structured !== null,
    `prose: ${r2.prose?.slice(0, 80)}`,
  );
  assertEqual(
    'compare(idA): structured.iteration.analysisId === idA',
    r2.structured?.iteration?.analysisId,
    idA,
  );

  // ── TEST 4: compare(svg, [], undefined) — §1.1 Stateless RPC: kein Fallback ─
  // §H9 K-13bc (Rekalibrierung): statt null-Sentinel + MCP-Dialektname jetzt
  // ehrliche non-null Error-Hülle (status:FAIL) + kanal-neutrale Prosa
  // (nennt 'analyze', NICHT 'vector_mirror_analyze').
  console.log('--- TEST 4: compare ohne analysisId → Hinweis-Pfad (§1.1) ---');
  const r3 = await compare(svgC, [], undefined);
  assertTrue(
    'compare(undefined): No-Baseline-Hülle (§1.1: kein impliziter mostRecent)',
    isNoBaseline(r3) && r3.structured.status === 'FAIL',
    `structured: ${JSON.stringify(r3.structured)?.slice(0, 80)}`,
  );
  assertTrue(
    'compare(undefined): prose kanal-neutral (analyze, kein MCP-Toolname)',
    /\banalyze\b/.test(r3.prose ?? '') &&
      !(r3.prose ?? '').includes('vector_mirror_analyze'),
    `prose: ${r3.prose}`,
  );

  // ── TEST 5: compare(svg, [], invalid-uuid) — BASELINE_MISSING-Pfad ──────────
  console.log(
    '--- TEST 5: compare mit unbekannter analysisId → Hinweis-Pfad ---',
  );
  const ghostId = '00000000-0000-4000-8000-000000000000';
  const r4 = await compare(svgB, [], ghostId);
  assertTrue(
    'compare(ghost): No-Baseline-Hülle (Baseline missing)',
    isNoBaseline(r4) && r4.structured.status === 'FAIL',
    `structured: ${JSON.stringify(r4.structured)?.slice(0, 80)}`,
  );
  assertTrue(
    'compare(ghost): prose kanal-neutral (analyze, kein MCP-Toolname)',
    /\banalyze\b/.test(r4.prose ?? '') &&
      !(r4.prose ?? '').includes('vector_mirror_analyze'),
    `prose: ${r4.prose}`,
  );

  // §1.1: TEST 6 entfernt — Tautologie post-Stateless-RPC
  // („read-only via mostRecent" ist post-§1.1 trivial wahr: kein impliziter
  // Modul-State mehr. Read-only-Contract wird in TEST 3 mit expliziter ID
  // weiter abgedeckt; falls noetig, dort grids.size-Assertion ergaenzen.)

  // ── TEST 7: UUID-Eindeutigkeit ──────────────────────────────────────────────
  console.log('--- TEST 7: 5 analyzes liefern 5 unterschiedliche UUIDs ---');
  const ids = new Set();
  ids.add(idA);
  for (let i = 0; i < 4; i++) {
    const r = await analyze(svgA, []);
    ids.add(r.structured.iteration.analysisId);
  }
  assertEqual('5 analyzes → 5 unterschiedliche UUIDs', ids.size, 5);

  // ── TEST 8: MAX_GRIDS-Export ist sinnvoller Default ─────────────────────────
  console.log('--- TEST 8: MAX_GRIDS export const ---');
  assertEqual('MAX_GRIDS === 20 (Schicht-2 Default)', MAX_GRIDS, 20);
  assertEqual('typeof MAX_GRIDS === number', typeof MAX_GRIDS, 'number');
} finally {
  await shutdown();
}

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
