// H10-RED R11-28: Prosa-Doppel-Attribution der INSIDE-Korrektur
// Bodenwahrheit: an internal ground-truth probe (+ run1/run2 identisch)
//
// WAHRHEITS-PIN (implementierungs-agnostisch, relational — Heal-7-B-Kanon):
//   Die Korrektur-Markierung (dx/dy-Anheftung) darf in der Prosa NUR an Element-Zeilen
//   erscheinen, deren Element in structured.corrections steht (Attribution per
//   Objekt-Identitaet, nicht per Naehe/Namens-String). Eine Element-Zeile eines
//   Elements OHNE Korrektur traegt KEINE dx/dy-Markierung.
//   Der Pin ist relational: stuende #container je legitim in corrections, waere
//   eine Markierung an seiner Zeile erlaubt — jede korrekte Implementierung besteht.
//   Kontroll-Pin: die Element-Zeile des korrigierten Elements (#child) traegt die
//   Markierung WEITERHIN (schuetzt gegen "Fix" durch Komplett-Entfernen der Marker
//   und beweist, dass die Marker-Erkennung dieses Tests greift).
//   Die Konstraint-Beschreibungszeile ("Ragt aus #container heraus. Korrektur: ...")
//   ist KEINE Element-Zeile von #container und bleibt legitim.
//
// Heute (2-Lauf-bewiesen): corrections=[{element:"#child",dx:-70,dy:-70,...}] —
// nur #child. Prosa haengt "[dx=-70px, dy=-70px] ✗" an die child-Zeile UND an
// "├─ rect#container: ..." => ROT.

import * as M from '../../src/pipeline.js';

// EXAKTE Fixtures der Probe R11-28:
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect id="container" x="10" y="10" width="60" height="60" fill="none" stroke="#333"/><rect id="child" x="120" y="120" width="20" height="20" fill="#cc0000"/></svg>`;
const constraints = ['#child INSIDE #container'];

let failCount = 0;
function assert(name, ok, ist) {
  console.log(`ASSERT ${name}: ${ok ? 'PASS' : 'FAIL'} — ist: ${ist}`);
  if (!ok) failCount += 1;
}

// Element-Zeile: Subjekt der Zeile ist "tag#id:" bzw. "#id:" (nach optionalen
// Baum-/Listenzeichen). Beschreibungs-/Verdiktzeilen ("Ragt aus #container heraus...")
// nennen Elemente nur als Referenz mitten im Satz und matchen hier NICHT.
function elementOfLine(line) {
  const m = line.match(/^[\s│├└─|*+\-]*(?:[A-Za-z][\w:\-]*)?#([A-Za-z_][\w\-]*)\s*:/);
  return m ? m[1] : null;
}

// Korrektur-Markierung an einer Zeile: angeheftete dx=/dy=-Korrekturwerte.
const MARKER_RE = /\bd[xy]\s*=\s*[-+]?\d/i;

await M.init();
try {
  const r = await M.analyze(svg, constraints);
  const s = r.structured || {};
  const prose = String(r.prose || '');
  const lines = prose.split('\n');

  // Korrigierte Elemente aus structured.corrections (normalisiert: "#child" -> "child")
  const corrections = Array.isArray(s.corrections) ? s.corrections : [];
  const corrIds = new Set(
    corrections.map((c) => String(c?.element ?? '').replace(/^#/, '')).filter(Boolean)
  );

  // Fixture-Sanitaet 1: Constraint ist verletzt (child liegt vollstaendig ausserhalb)
  assert('fixture_constraint_verletzt', s.status === 'FAIL', `status=${s.status}`);

  // Fixture-Sanitaet 2: corrections existieren und nennen #child
  assert(
    'corrections_nennen_child',
    corrIds.has('child'),
    `corrections.elemente=[${[...corrIds].join(',')}] (roh: ${JSON.stringify(corrections.map((c) => c?.element))})`
  );

  // KERN-PIN (heute ROT): Markierung NUR an Element-Zeilen, deren Element in corrections steht.
  const offenders = [];
  for (const line of lines) {
    const id = elementOfLine(line);
    if (!id) continue;
    if (MARKER_RE.test(line) && !corrIds.has(id)) {
      offenders.push(`#${id} ohne correction, aber markiert: "${line.trim()}"`);
    }
  }
  assert(
    'markierung_nur_an_zeilen_korrigierter_elemente',
    offenders.length === 0,
    offenders.length ? offenders.join(' || ') : 'keine Fremd-Markierung'
  );

  // KONTROLL-PIN (heute GRUEN): die child-Zeile traegt die Markierung weiterhin.
  const childLines = lines.filter((l) => elementOfLine(l) === 'child');
  assert(
    'kontrolle_child_zeile_traegt_markierung_weiterhin',
    childLines.some((l) => MARKER_RE.test(l)),
    childLines.length ? childLines.map((l) => `"${l.trim()}"`).join(' || ') : 'keine child-Element-Zeile gefunden'
  );
} catch (e) {
  assert('lauf_ohne_exception', false, `THREW: ${e.message}`);
} finally {
  await M.shutdown();
}

if (failCount > 0) {
  console.log(`H10-RED R11-28: ROT (${failCount} FAIL)`);
  process.exitCode = 1;
} else {
  console.log('H10-RED R11-28: GRUEN');
}
