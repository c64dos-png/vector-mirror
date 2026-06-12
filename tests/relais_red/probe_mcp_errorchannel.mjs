/**
 * RELAIS-Probe (MCP-Rand) — Fehler-Kanal §6: error{code,hint} + Prosa-Parity
 * + die VOLLSTÄNDIGE Fehler-Pfad-Matrix (P5, alle 7 D6-Pfade).
 *
 * Claims: C-CMP-ERR · C-BKM-ERR (claims.js). Spec §6/D6/D7.
 * Beweist gegen den ECHTEN stdio-Server:
 *   1. compare ohne Baseline ⇒ isError:true, structuredContent.error =
 *      {code: NO_BASELINE, hint}; hint wortidentisch in content[0].text.
 *   2. bookmark mit unbekannter analysisId ⇒ isError:true,
 *      structuredContent.error = {code: ANALYSIS_NOT_FOUND, hint}; Parity.
 *   3. Bookmark-LRU: 11 Bookmarks auf 1 Analyse ⇒ bookmarkCount kappt bei 10,
 *      das ÄLTESTE ist verdrängt (compare gegen Name 1 ⇒ NO_BASELINE),
 *      Name 2 funktioniert weiter (kein Über-Evicten).
 *   4. Render-Error-Hüllen (D6-Matrix Pfade 3–6): analyze/inspect/palette/
 *      compare mit leerem SVG ⇒ isError:true + error{code: INVALID_INPUT,
 *      hint} + Prosa-Parity am MCP-Rand. §P1: der hint trägt den
 *      Navigations-Zusatz (Ist + nächster Schritt, pipeline.js#
 *      renderErrorHint — nie nur Befund).
 *   5. §P5 MATRIX (alle 7 Pfade): je Pfad werden isError-Wert + error-Key-
 *      Präsenz + code dokumentiert (OBS MATRIX) und die WAHRHEITS-REGEL
 *      geprüft: error-Key ⇒ isError:true. Pfad 7 (arrange-Throw,
 *      ARRANGE_FAILED) ist am MCP-Rand mit Schema-validem Input EMPIRISCH
 *      NICHT erreichbar (pipeline.arrange wirft auf keinem zod-validen
 *      Input; der bekannte Werfer elements:null prallt an der SDK-Schema-
 *      Wand ab — empirisch: das SDK antwortet mit einem isError-RESULT,
 *      content-Text "MCP error -32602: Input validation error", OHNE
 *      structuredContent/error{} — SDK-eigener Pfad, Handler nie erreicht) —
 *      dokumentierte ehrliche Ausnahme: die Wahrheit wird auf HANDLER-Ebene
 *      gepinnt (arrangeTool.handler = exakt die MCP-Result-Form), Beleg
 *      zusätzlich in tests/integration/test_coverage_forcing.mjs.
 *      Carve-out by design (Spec §6): der lossy-Render-Fehler-Pfad trägt
 *      KEIN error{} und KEIN isError — sein Signal ist canvas_validity:
 *      'lossy' + Text-Kanal (nicht Teil dieser 7 Pfade).
 *
 * Eigenständig, deterministisch, Exit 1 wenn rot.
 */
import { createSession } from './_mcp_client.mjs';
import { arrangeTool } from '../../src/interface/tools.js';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100">' +
  '<rect id="r1" x="10" y="10" width="60" height="40" fill="red"/></svg>';
const PHANTOM_ID = '00000000-0000-4000-8000-000000000000';

let failCount = 0;
function assert(name, cond, ist) {
  const verdict = cond ? 'PASS' : 'FAIL';
  if (!cond) failCount += 1;
  console.log(`ASSERT ${name}: ${verdict} — ist: ${ist}`);
}

// §P5: Fehler-Pfad-Matrix — je Pfad isError-Wert + error-Key-Präsenz + code.
const matrix = [];
function recordPath(nr, name, r, note) {
  const errKey = !!r?.structuredContent?.error;
  matrix.push({
    nr,
    name,
    isError: r?.isError === true,
    errKey,
    code: r?.structuredContent?.error?.code ?? null,
    note: note ?? '',
  });
}

// §P1: der Render-Fehler-Navigations-Zusatz (eine Quelle:
// pipeline.js#renderErrorHint) — hier bewusst als LITERAL gepinnt (zweiter,
// unabhängiger Zeuge statt Import derselben Quelle).
const NAV_ZUSATZ = '— prüfe SVG-Wohlgeformtheit/viewBox; Details: content-Text';

const session = createSession();
try {
  await session.init();

  // 1. compare ohne Baseline (R9a #13/#14 — die bewiesene Wand, jetzt Bande).
  {
    const res = await session.call('vector_mirror_compare', {
      svg: SVG,
      constraints: [],
      analysisId: PHANTOM_ID,
    });
    const r = res.result || {};
    const err = r.structuredContent?.error;
    console.log(`OBS compare-no-baseline error: ${JSON.stringify(err)}`);
    assert('cmp_isError', r.isError === true, `isError=${r.isError}`);
    assert(
      'cmp_error_code_NO_BASELINE',
      err?.code === 'NO_BASELINE',
      `code=${JSON.stringify(err?.code)}`,
    );
    assert(
      'cmp_parity_hint_in_prosa',
      typeof err?.hint === 'string' &&
        (r.content?.[0]?.text || '').includes(err.hint),
      `prose=${JSON.stringify(r.content?.[0]?.text)}`,
    );
    recordPath(1, 'compare/no-baseline', r);
  }

  // 2. bookmark mit unbekannter analysisId.
  {
    const res = await session.call('vector_mirror_bookmark', {
      name: 'phantom-baseline',
      analysisId: PHANTOM_ID,
    });
    const r = res.result || {};
    const err = r.structuredContent?.error;
    console.log(`OBS bookmark-unknown error: ${JSON.stringify(err)}`);
    assert('bkm_isError', r.isError === true, `isError=${r.isError}`);
    assert(
      'bkm_error_code_ANALYSIS_NOT_FOUND',
      err?.code === 'ANALYSIS_NOT_FOUND',
      `code=${JSON.stringify(err?.code)}`,
    );
    assert(
      'bkm_parity_hint_in_prosa',
      typeof err?.hint === 'string' &&
        (r.content?.[0]?.text || '').includes(err.hint),
      `prose=${JSON.stringify(r.content?.[0]?.text)}`,
    );
    recordPath(2, 'bookmark/unknown-id', r);
  }

  // 3. LRU-Verdrängung (maximal 10, ältestes fliegt).
  {
    const ana = await session.call('vector_mirror_analyze', {
      svg: SVG,
      constraints: [],
    });
    const analysisId = ana.result?.structuredContent?.iteration?.analysisId;
    assert(
      'lru_analyze_id',
      typeof analysisId === 'string',
      `analysisId=${analysisId}`,
    );

    let lastCount = null;
    for (let i = 1; i <= 11; i++) {
      const b = await session.call('vector_mirror_bookmark', {
        name: `lru-probe-${String(i).padStart(2, '0')}`,
        analysisId,
      });
      lastCount = b.result?.structuredContent?.bookmarkCount;
    }
    console.log(`OBS bookmarkCount nach 11 Bookmarks: ${lastCount}`);
    assert('lru_cap_10', lastCount === 10, `bookmarkCount=${lastCount}`);

    const evicted = await session.call('vector_mirror_compare', {
      svg: SVG,
      constraints: [],
      analysisId: 'lru-probe-01',
    });
    assert(
      'lru_aeltestes_verdraengt',
      evicted.result?.isError === true &&
        evicted.result?.structuredContent?.error?.code === 'NO_BASELINE',
      `isError=${evicted.result?.isError}, code=${JSON.stringify(evicted.result?.structuredContent?.error?.code)}`,
    );

    const alive = await session.call('vector_mirror_compare', {
      svg: SVG,
      constraints: [],
      analysisId: 'lru-probe-02',
    });
    assert(
      'lru_zweites_lebt',
      alive.result?.isError !== true &&
        !!alive.result?.structuredContent?.iteration,
      `isError=${alive.result?.isError}`,
    );

    // 4. Render-Error-Hüllen (D6 Pfade 3–6): leeres SVG ⇒ INVALID_INPUT.
    const faelle = [
      [3, 'vector_mirror_analyze', { svg: '', constraints: [] }],
      [4, 'vector_mirror_inspect', { svg: '' }],
      [5, 'vector_mirror_palette', { svg: '' }],
      [
        6,
        'vector_mirror_compare',
        { svg: '', constraints: [], analysisId: 'lru-probe-02' },
      ],
    ];
    for (const [nr, tool, args] of faelle) {
      const res = await session.call(tool, args);
      const r = res.result || {};
      const err = r.structuredContent?.error;
      console.log(`OBS render-error ${tool}: ${JSON.stringify(err)}`);
      assert(
        `${tool}_render_isError`,
        r.isError === true,
        `isError=${r.isError}`,
      );
      assert(
        `${tool}_render_error_code`,
        err?.code === 'INVALID_INPUT',
        `code=${JSON.stringify(err?.code)}`,
      );
      assert(
        `${tool}_render_parity`,
        typeof err?.hint === 'string' &&
          (r.content?.[0]?.text || '').includes(err.hint),
        `prose=${JSON.stringify(r.content?.[0]?.text)}`,
      );
      // §P1 Flussbett: Render-Fehler-hint = Ist + nächster Schritt,
      // nie nur Befund (Navigations-Zusatz aus der EINEN pipeline-Quelle).
      assert(
        `${tool}_render_hint_navigiert`,
        typeof err?.hint === 'string' && err.hint.includes(NAV_ZUSATZ),
        `hint=${JSON.stringify(err?.hint)}`,
      );
      recordPath(nr, `${tool.replace('vector_mirror_', '')}/render-error`, r);
    }

    // 5. §P5 Pfad 7 (arrange-Throw, ARRANGE_FAILED):
    //    (a) MCP-Rand: der bekannte Werfer (elements:null) prallt an der
    //        SDK-Schema-Wand ab — empirisch antwortet das SDK mit einem
    //        isError-RESULT ("MCP error -32602: Input validation error"-Text,
    //        OHNE structuredContent/error{}); der Handler wird NIE erreicht.
    //        Mit Schema-validem Input wirft pipeline.arrange nicht
    //        (empirisch; dokumentierte ehrliche Ausnahme).
    //    (b) Handler-Ebene (= exakt die MCP-Result-Form): isError:true +
    //        error{ARRANGE_FAILED,hint} + Prosa-Parity.
    {
      const res = await session.call('vector_mirror_arrange', {
        canvas: { width: 100, height: 100 },
        elements: null,
        constraints: [],
      });
      const wall = res.result || {};
      const wallText = wall.content?.[0]?.text || '';
      console.log(
        `OBS arrange-throw MCP-Rand: isError=${wall.isError} structuredContent=${JSON.stringify(wall.structuredContent)} text=${JSON.stringify(wallText.slice(0, 60))}… (SDK-Schema-Wand vor Handler)`,
      );
      assert(
        'arrange_throw_mcp_schemawand',
        res.error === undefined &&
          wall.isError === true &&
          wall.structuredContent === undefined &&
          wallText.includes('MCP error -32602: Input validation error'),
        `rpcError=${JSON.stringify(res.error)}, isError=${wall.isError}, text=${JSON.stringify(wallText.slice(0, 80))}`,
      );

      const h = await arrangeTool.handler({
        canvas: { width: 100, height: 100 },
        elements: null,
        constraints: [],
      });
      const err = h.structuredContent?.error;
      console.log(`OBS arrange-throw Handler: ${JSON.stringify(err)}`);
      assert(
        'arrange_throw_handler_isError_und_code',
        h.isError === true && err?.code === 'ARRANGE_FAILED',
        `isError=${h.isError}, code=${JSON.stringify(err?.code)}`,
      );
      assert(
        'arrange_throw_handler_parity',
        typeof err?.hint === 'string' &&
          (h.content?.[0]?.text || '').includes(err.hint),
        `prose=${JSON.stringify(h.content?.[0]?.text)}`,
      );
      recordPath(
        7,
        'arrange/throw',
        { isError: h.isError, structuredContent: h.structuredContent },
        'MCP-Rand: SDK-Schema-Wand (isError-Result, -32602-Text, ohne error{}; Handler unerreicht) — Werte von Handler-Ebene',
      );
    }

    // §P5 MATRIX + WAHRHEITS-REGEL: error-Key ⇒ isError:true (alle 7 Pfade).
    matrix.sort((a, b) => a.nr - b.nr);
    for (const row of matrix) {
      console.log(
        `OBS MATRIX P${row.nr} ${row.name}: isError=${row.isError} errorKey=${row.errKey} code=${JSON.stringify(row.code)}${row.note ? ` — ${row.note}` : ''}`,
      );
    }
    const regelBruch = matrix.filter((m) => m.errKey && m.isError !== true);
    assert(
      'matrix_7_pfade_dokumentiert',
      matrix.length === 7,
      `${matrix.length} Pfade`,
    );
    assert(
      'matrix_wahrheitsregel_errorKey_impliziert_isError',
      regelBruch.length === 0,
      regelBruch.length === 0
        ? '0 Brüche'
        : JSON.stringify(regelBruch.map((m) => `P${m.nr} ${m.name}`)),
    );
  }
} finally {
  session.close();
}

if (failCount > 0) {
  console.log(`RELAIS-PROBE errorchannel: ROT (${failCount} FAIL)`);
  process.exit(1);
} else {
  console.log('RELAIS-PROBE errorchannel: GRUEN');
  process.exit(0);
}
