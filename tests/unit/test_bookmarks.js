/**
 * test_bookmarks.js — FIX_PLAN §1.4 Globale Bookmarks (B-3, O1)
 *
 * Tests den Named-Baseline-Workflow für den Sniper-Loop:
 *   analyze(v1) → bookmark("name", id) → edit → compare(v2, [], "name").
 *
 * Vertrags-Kern (an internal spec KORR-1/KORR-2):
 *   - bookmark(name, analysisId) referenziert EXPLIZITE analysisId (kein 'most-recent').
 *   - compare(name) löst zur QUELL-UUID auf → iteration.analysisId bleibt UUID,
 *     NIE der Name (§1.3-Server-Garantie gehalten).
 *   - LRU-Eviction via __setMaxBookmarks(N): N+1-ter bookmark evicted ältesten Namen.
 *   - Unknown analysisId → structured===null + Hinweis-prose (REGEL-8 Error-Pfad).
 *   - bookmark-Output: stored===true, bookmarkCount korrekt.
 *
 * REIHENFOLGE: LRU-Eviction (TEST 2) braucht frischen bookmarks-State, läuft
 * daher als isolierter Block mit eigenem Cap-Reset. Roundtrip (TEST 1) zuerst.
 *
 * Muster: tests/unit/test_pipeline_lru_cache.js (real browser, init→…→shutdown).
 */
import {
  analyze,
  bookmark,
  compare,
  init,
  shutdown,
  MAX_BOOKMARKS,
  __setMaxBookmarks,
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

// §H9 K-13bc (Rekalibrierung auf die wahre Form): compare ohne auflösbare
// Basis liefert kein structured:null mehr, sondern die ehrliche
// analyzeOutput-konforme Error-Hülle + No-Baseline-Hinweis-Prosa.
// Erreichbarkeits-Diskriminator ist die Hinweis-Prosa, nicht der null-Sentinel.
// (bookmark() selbst behält seinen dokumentierten null-Sentinel — TEST 3.)
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
  // ── TEST 1: Roundtrip-Äquivalenz (analyze → bookmark → compare(name)) ────────
  console.log(
    '--- TEST 1: Roundtrip — compare(name) === compare(UUID) (Quell-UUID-Auflösung) ---',
  );
  const idA = (await analyze(svgA, [])).structured.iteration.analysisId;

  // bookmark-Output-Vertrag
  const bm = bookmark('baseline', idA);
  assertTrue('bookmark: structured nicht null', bm.structured !== null);
  assertEqual('bookmark: stored === true', bm.structured?.stored, true);
  assertEqual('bookmark: name === "baseline"', bm.structured?.name, 'baseline');
  assertEqual(
    'bookmark: analysisId === idA (Quell-UUID)',
    bm.structured?.analysisId,
    idA,
  );
  assertEqual('bookmark: bookmarkCount === 1', bm.structured?.bookmarkCount, 1);

  // compare(name) löst auf und liefert die QUELL-UUID, nicht den Namen.
  const cmpName = await compare(svgB, [], 'baseline');
  assertTrue(
    'compare("baseline"): structured nicht null (Bookmark aufgelöst)',
    cmpName.structured !== null,
    `prose: ${cmpName.prose?.slice(0, 80)}`,
  );
  assertEqual(
    'compare("baseline"): iteration.analysisId === idA (Quell-UUID, NICHT Name)',
    cmpName.structured?.iteration?.analysisId,
    idA,
  );

  // Äquivalenz: compare(name) vs compare(UUID) → identische diff-Länge.
  const cmpUuid = await compare(svgB, [], idA);
  assertTrue(
    'compare(idA): structured nicht null',
    cmpUuid.structured !== null,
  );
  assertEqual(
    'Äquivalenz: diff.length(name) === diff.length(UUID)',
    cmpName.structured?.diff?.length,
    cmpUuid.structured?.diff?.length,
  );

  // ── TEST 2: LRU-Eviction (__setMaxBookmarks(3), 4 Bookmarks) ────────────────
  console.log(
    '--- TEST 2: LRU-Eviction (__setMaxBookmarks(3), 4 verschiedene analysisIds) ---',
  );
  __setMaxBookmarks(3);
  // 4 verschiedene analysisIds erzeugen.
  const id1 = (await analyze(svgA, [])).structured.iteration.analysisId;
  const id2 = (await analyze(svgB, [])).structured.iteration.analysisId;
  const id3 = (await analyze(svgC, [])).structured.iteration.analysisId;
  const id4 = (await analyze(svgA, [])).structured.iteration.analysisId;

  bookmark('bm1', id1);
  bookmark('bm2', id2);
  bookmark('bm3', id3);
  // Cap exakt erreicht (3) — bm1 noch auflösbar.
  const pre1 = await compare(svgB, [], 'bm1');
  assertTrue(
    'bm1 nach 3 Bookmarks auflösbar (Cap exakt)',
    !isNoBaseline(pre1),
  );

  // 4. Bookmark → bm1 (ältester) muss evicted sein.
  bookmark('bm4', id4);
  const evicted = await compare(svgB, [], 'bm1');
  assertTrue(
    'bm1 nach 4. Bookmark evicted (compare → No-Baseline-Hülle, §H9 K-13bc)',
    isNoBaseline(evicted),
    `prose: ${evicted.prose?.slice(0, 80)}`,
  );
  // bm2, bm3, bm4 müssen erreichbar bleiben.
  const still2 = await compare(svgB, [], 'bm2');
  assertTrue(
    'bm2 noch erreichbar nach Eviction von bm1',
    !isNoBaseline(still2),
  );
  const still3 = await compare(svgB, [], 'bm3');
  assertTrue(
    'bm3 noch erreichbar nach Eviction von bm1',
    !isNoBaseline(still3),
  );
  const still4 = await compare(svgB, [], 'bm4');
  assertTrue('bm4 (jüngster) erreichbar', !isNoBaseline(still4));

  // Cap zurück für Folge-Tests.
  __setMaxBookmarks(MAX_BOOKMARKS);

  // ── TEST 3: Unknown analysisId → Hinweis-Pfad ──────────────────────────────
  console.log(
    '--- TEST 3: bookmark mit unbekannter analysisId → null + Hinweis ---',
  );
  const ghostId = '00000000-0000-4000-8000-000000000000';
  const unknown = bookmark('x', ghostId);
  assertEqual(
    'bookmark(unknown id): structured ist null',
    unknown.structured,
    null,
  );
  assertTrue(
    'bookmark(unknown id): prose enthält Hinweis (vector_mirror_analyze)',
    /vector_mirror_analyze/i.test(unknown.prose ?? ''),
    `prose: ${unknown.prose}`,
  );

  // ── TEST 4: MAX_BOOKMARKS-Export ist sinnvoller Default ─────────────────────
  console.log('--- TEST 4: MAX_BOOKMARKS export const ---');
  assertEqual('MAX_BOOKMARKS === 10 (§1.4 Default)', MAX_BOOKMARKS, 10);
  assertEqual(
    'typeof MAX_BOOKMARKS === number',
    typeof MAX_BOOKMARKS,
    'number',
  );
} finally {
  await shutdown();
}

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
