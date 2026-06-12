// H10-RED R11-13 — Prosa-Kanal-Luege bei kaputtem Canvas.
//
// BEWIESEN (2 Laeufe identisch, an internal ground-truth probe
// probe_R11-13.run{1,2}.txt):
//   (a) SVG ohne width/height/viewBox  -> structured canvas_validity="default_replaced"
//   (b) SVG mit viewBox="0 0 0 100"    -> structured canvas_validity="degenerate"
//   BEIDE liefern (analyze UND inspect) Prosa-Zeile 1 = "STATUS: ✓ Alles korrekt"
//   und die Prosa erwaehnt den canvas_validity-Wert nirgends (probe: 'prose
//   erwaehnt canvas_validity-Wert=false'). Der structured-Kanal ist ehrlich,
//   der Prosa-Kanal luegt.
//
// WAHRHEITS-PIN (implementierungsunabhaengig, konditional):
//   WENN der structured-Kanal selbst canvas_validity != 'valid' deklariert,
//   DANN darf die Prosa NICHT uneingeschraenkt "Alles korrekt" melden.
//   Akzeptiert wird JEDE Form von Hinweis in der Prosa: entweder kein
//   "Alles korrekt" (eingeschraenkter Status), ODER "Alles korrekt" plus
//   irgendein Problem-Hinweis irgendwo in der Prosa (⚠/Hinweis/Warnung/
//   degenerate/default_replaced/ersetzt/Verlust/... — generöses Vokabular).
//   Es wird NICHT gepinnt, WIE die Prosa formuliert, WO der Hinweis steht
//   oder welcher canvas_validity-Wert vergeben wird. Deklariert eine
//   korrekte Implementierung 'valid' (oder gar kein Feld), greift der Pin
//   nicht — jede korrekte Implementierung besteht.
//   Kontroll-Pins (heute gruen — duerfen nicht kippen):
//     - valid-Canvas (explizit 100x100) darf weiter "Alles korrekt" sagen.
//     - lossy-Canvas (Sanitizer-Verlust) traegt bereits seine Warnzeile und
//       luegt nicht.
//
// Fixtures EXAKT aus probe_R11-13.mjs (Faelle a/b/Kontrolle) und
// probe_R11-08.mjs (lossy-Quelle: script+foreignObject) uebernommen.

import * as M from '../../src/pipeline.js';

// ---------- Fixtures exakt wie in den Proben ----------
const SVG_OHNE_DIMS = `<svg xmlns="http://www.w3.org/2000/svg"><rect id="r" x="10" y="10" width="30" height="30" fill="red"/></svg>`;
const SVG_DEGENERATE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 100"><rect id="r" x="10" y="10" width="30" height="30" fill="red"/></svg>`;
const SVG_VALID = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect id="r" x="10" y="10" width="30" height="30" fill="red"/></svg>`;
// aus probe_R11-08.mjs (dort 2-Lauf-bewiesen: canvas_validity="lossy" + ⚠-Warnzeile):
const SVG_LOSSY = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
  <script>window.x=1</script>
  <foreignObject x="60" y="60" width="30" height="30"><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>
  <rect id="r" x="10" y="10" width="30" height="30" fill="red"/>
</svg>`;

// ---------- Hinweis-Erkennung: generös (jede Form von Hinweis zaehlt) ----------
// Bewusst NUR Problem-Vokabular — neutrale Szene-Beschreibung ("SZENE: 300×150,
// 1 Elemente (viewBox: ...)") ist KEIN Hinweis und matcht nicht.
const HINT_RE =
  /⚠|hinweis|warnung|warn|achtung|vorsicht|degener|default[_ ]?replaced|canvas[_-]?validity|ersetzt|ersatz|angenommen|unterstellt|unmessbar|nicht messbar|not_measurable|ung[üue]+ltig|invalid|kaputt|defekt|verlust|lossy|sanitiz|entfernt|gestrippt|stripped|fehlt|fehlen|fehlende/iu;

/**
 * Wahrheits-Pin: liegt die Prosa, wenn structured cv != 'valid' meldet?
 * @returns {{ok: boolean, ist: string}}
 */
function pruefeProsaEhrlich(cv, prose) {
  const p = typeof prose === 'string' ? prose : '';
  const zeile1 = p.split('\n')[0];
  const allesKorrekt = p.includes('Alles korrekt');
  if (cv === undefined || cv === null) {
    return {
      ok: true,
      ist: `canvas_validity nicht deklariert — Divergenz nicht belegbar (zeile1=${JSON.stringify(zeile1)})`,
    };
  }
  if (cv === 'valid') {
    return {
      ok: true,
      ist: `canvas_validity="valid" — "Alles korrekt" zulaessig (zeile1=${JSON.stringify(zeile1)})`,
    };
  }
  if (!allesKorrekt) {
    return {
      ok: true,
      ist: `canvas_validity=${JSON.stringify(cv)}, Prosa ohne "Alles korrekt" — eingeschraenkt gemeldet (zeile1=${JSON.stringify(zeile1)})`,
    };
  }
  const hinted = HINT_RE.test(p);
  return {
    ok: hinted,
    ist: `canvas_validity=${JSON.stringify(cv)}, Prosa sagt "Alles korrekt", Problem-Hinweis irgendwo in Prosa=${hinted} (zeile1=${JSON.stringify(zeile1)})`,
  };
}

let failCount = 0;
function assertPrint(name, ok, ist) {
  console.log(`ASSERT ${name}: ${ok ? 'PASS' : 'FAIL'} — ist: ${ist}`);
  if (!ok) failCount += 1;
}

async function rufe(fnName, svg) {
  // analyze mit leerer Constraint-Liste — exakt wie probe_R11-13.mjs.
  const r = fnName === 'analyze' ? await M.analyze(svg, []) : await M.inspect(svg);
  return {
    cv: r.structured?.scene?.canvas_validity,
    prose: r.prose || '',
  };
}

await M.init();
try {
  // --- Haupt-Pin: kaputter Canvas darf in der Prosa nicht uneingeschraenkt "Alles korrekt" melden ---
  const kaputt = [
    ['ohne_dims', SVG_OHNE_DIMS],
    ['degenerate_viewbox', SVG_DEGENERATE],
  ];
  for (const [label, svg] of kaputt) {
    for (const fn of ['analyze', 'inspect']) {
      try {
        const { cv, prose } = await rufe(fn, svg);
        const { ok, ist } = pruefeProsaEhrlich(cv, prose);
        assertPrint(`prosa_ehrlich_${fn}_${label}`, ok, ist);
      } catch (e) {
        assertPrint(`prosa_ehrlich_${fn}_${label}`, false, `${fn} THREW: ${e.message}`);
      }
    }
  }

  // --- Kontroll-Pin 1: valid-Canvas darf weiter "Alles korrekt" sagen (heute gruen) ---
  for (const fn of ['analyze', 'inspect']) {
    try {
      const { cv, prose } = await rufe(fn, SVG_VALID);
      const ok = prose.includes('Alles korrekt');
      assertPrint(
        `kontrolle_valid_${fn}_alles_korrekt`,
        ok,
        `canvas_validity=${JSON.stringify(cv)}, zeile1=${JSON.stringify(prose.split('\n')[0])}`,
      );
    } catch (e) {
      assertPrint(`kontrolle_valid_${fn}_alles_korrekt`, false, `${fn} THREW: ${e.message}`);
    }
  }

  // --- Kontroll-Pin 2: lossy-Canvas luegt nicht und traegt seine Warnzeile (heute gruen) ---
  try {
    const { cv, prose } = await rufe('inspect', SVG_LOSSY);
    const ehrlich = pruefeProsaEhrlich(cv, prose);
    // Bei deklariertem nicht-validem Canvas (heute: 'lossy') muss irgendein
    // Hinweis in der Prosa stehen — jede Form akzeptiert (HINT_RE generös).
    const hinted = cv && cv !== 'valid' ? HINT_RE.test(prose) : true;
    assertPrint(
      'kontrolle_lossy_inspect_warnzeile',
      ehrlich.ok && hinted,
      `${ehrlich.ist} | Hinweis vorhanden=${hinted}`,
    );
  } catch (e) {
    assertPrint('kontrolle_lossy_inspect_warnzeile', false, `inspect THREW: ${e.message}`);
  }
} finally {
  await M.shutdown();
}

if (failCount > 0) {
  console.log(`H10-RED R11-13: ROT (${failCount} FAIL)`);
  process.exit(1);
} else {
  console.log('H10-RED R11-13: GRUEN');
  process.exit(0);
}
