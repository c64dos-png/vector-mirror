// H10-RED R11-11: arrange-Geister-Referenz + Self-Reference — stiller Erfolg ohne ehrliches Signal.
//
// Bodenwahrheit (2-Lauf-bewiesen, probe_R11-11.run1/.run2 identisch, 2026-06-11):
//   (a) '#frame CENTERED-IN #canvas' + '#logo CENTERED-IN #frame':
//       warnings=["Referenz #canvas nicht gefunden"], frame unplatziert —
//       trotzdem attributes={"logo":{"transform":"translate(20 20)"}} und prose
//       "ARRANGE: 1 Element platziert" OHNE jedes Warn-Signal zur #logo/#frame-Kette.
//   (b1) arrange '#a CENTERED-IN #a' → attributes={"a":{}}, warnings=[] (stiller Leer-Erfolg).
//   (b2) analyze '#a CENTERED-IN #a' → status=PASS, corrections=[], unchecked=[],
//        keine Warn-Zeile in der Prosa.
//
// PIN (a) — WAHRHEIT, nicht Implementierung: WENN die Pipeline selbst meldet, dass die
//   Referenz #canvas fehlt, UND #frame deshalb unplatziert bleibt, DANN darf fuer das
//   davon abhaengige #logo KEINE Korrektur ausgegeben werden ohne Warn-Signal am Ergebnis.
//   Jede korrekte Implementierung besteht: #canvas aufloesen (Praemisse entfaellt),
//   #logo ueberspringen, Fehler werfen, oder Korrektur MIT Warn-Signal zur Kette.
// PIN (b) — Self-Reference '#a CENTERED-IN #a' muss ein ehrliches Signal tragen
//   (Warning / unchecked / Fehler) statt stillem Leer-Erfolg. Jede korrekte
//   Implementierung besteht: werfen, warnen, als unchecked listen oder status!=PASS.
//
// Fixtures: EXAKT aus an internal ground-truth probe

import * as M from '../../src/pipeline.js';

let failCount = 0;

function assertTruth(name, pass, ist) {
  if (!pass) failCount += 1;
  console.log(`ASSERT ${name}: ${pass ? 'PASS' : 'FAIL'} — ist: ${ist}`);
}

const hasPlacement = (attrs) =>
  !!attrs &&
  ['transform', 'x', 'y', 'cx', 'cy', 'width', 'height', 'r'].some(
    (k) => attrs[k] !== undefined && attrs[k] !== null && String(attrs[k]).length > 0,
  );

await M.init();
try {
  // ---------------------------------------------------------------- (a) Geister-Referenz-Kette
  {
    const canvas = { width: 200, height: 200 };
    const elements = [
      { id: 'frame', tag: 'rect', x: 0, y: 0, width: 60, height: 60 },
      { id: 'logo', tag: 'rect', x: 0, y: 0, width: 20, height: 20 },
    ];
    let pass;
    let ist;
    try {
      const r = M.arrange(canvas, elements, [
        '#frame CENTERED-IN #canvas',
        '#logo CENTERED-IN #frame',
      ]);
      const attrs = r?.structured?.attributes ?? {};
      const warnings = (r?.structured?.warnings ?? []).map(String);

      // Praemisse 1: Pipeline meldet die Referenz #canvas selbst als fehlend/unaufgeloest.
      const canvasRefReportedMissing = warnings.some(
        (w) => /canvas/i.test(w) && /nicht gefunden|not found|fehl|unbekannt|unresolved|missing/i.test(w),
      );
      // Praemisse 2: #frame blieb dadurch unplatziert.
      const frameUnplaced = !hasPlacement(attrs.frame);
      // Beobachtung: #logo erhielt dennoch eine Korrektur.
      const logoCorrected = hasPlacement(attrs.logo);
      // Ehrliches Warn-Signal am Ergebnis zur betroffenen Kette (#frame/#logo) —
      // grosszuegig: Erwaehnung von frame/logo ODER irgendein zusaetzliches Warn-Signal
      // ueber die blosse #canvas-Meldung hinaus (in diesem Minimal-Fixture kann ein
      // zweites Warning nur die Kette betreffen).
      const chainWarnSignal =
        warnings.some((w) => /frame|logo/i.test(w)) || warnings.length >= 2;

      const violation =
        canvasRefReportedMissing && frameUnplaced && logoCorrected && !chainWarnSignal;
      pass = !violation;
      ist =
        `canvasRefGemeldetFehlend=${canvasRefReportedMissing}, frameUnplatziert=${frameUnplaced}, ` +
        `logoKorrektur=${JSON.stringify(attrs.logo ?? null)}, warnings=${JSON.stringify(warnings)}, ` +
        `kettenWarnSignal=${chainWarnSignal}`;
    } catch (e) {
      // Ein Fehler statt stiller Korrektur ist ein ehrliches Signal → erfuellt den PIN.
      pass = true;
      ist = `arrange wirft ehrlich: ${e.message}`;
    }
    assertTruth('a_geister_referenz_keine_stille_korrektur', pass, ist);
  }

  // ---------------------------------------------------------------- (b1) Self-Reference in arrange
  {
    let pass;
    let ist;
    try {
      const r = M.arrange(
        { width: 100, height: 100 },
        [{ id: 'a', tag: 'rect', x: 10, y: 10, width: 20, height: 20 }],
        ['#a CENTERED-IN #a'],
      );
      const warnings = (r?.structured?.warnings ?? []).map(String);
      // Ehrliches Signal: mindestens EIN Warning am Ergebnis (oder Wurf, s. catch).
      const signal = warnings.length > 0;
      pass = signal;
      ist =
        `attributes=${JSON.stringify(r?.structured?.attributes ?? null)}, ` +
        `warnings=${JSON.stringify(warnings)} (stiller Leer-Erfolg=${!signal})`;
    } catch (e) {
      pass = true;
      ist = `arrange wirft ehrlich: ${e.message}`;
    }
    assertTruth('b1_selfref_arrange_ehrliches_signal', pass, ist);
  }

  // ---------------------------------------------------------------- (b2) Self-Reference in analyze
  {
    let pass;
    let ist;
    try {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect id="a" x="10" y="10" width="20" height="20" fill="red"/></svg>`;
      const r = await M.analyze(svg, ['#a CENTERED-IN #a']);
      const s = r?.structured ?? {};
      const prose = String(r?.prose ?? '');
      const statusSignal = s.status !== 'PASS';
      const uncheckedSignal = Array.isArray(s.unchecked) && s.unchecked.length > 0;
      const warningsSignal = Array.isArray(s.warnings) && s.warnings.length > 0;
      const proseSignal = /warn|selbst|self|zirkul|circular|referenz/i.test(prose);
      const signal = statusSignal || uncheckedSignal || warningsSignal || proseSignal;
      pass = signal;
      ist =
        `status=${s.status}, corrections=${JSON.stringify(s.corrections ?? null)}, ` +
        `unchecked=${JSON.stringify(s.unchecked ?? null)}, warnings=${JSON.stringify(s.warnings ?? null)}, ` +
        `prosaSignal=${proseSignal} (stiller PASS=${!signal})`;
    } catch (e) {
      pass = true;
      ist = `analyze wirft ehrlich: ${e.message}`;
    }
    assertTruth('b2_selfref_analyze_ehrliches_signal', pass, ist);
  }
} finally {
  await M.shutdown();
}

if (failCount > 0) {
  console.log(`H10-RED R11-11: ROT (${failCount} FAIL)`);
  process.exit(1);
} else {
  console.log('H10-RED R11-11: GRUEN');
}
