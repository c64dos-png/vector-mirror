// H10-RED R11-04 — Invertierte Grid-Zell-Ranges bei Sub-Pixel-Elementen auf Grid-Grenzen.
//
// BEWIESEN (2 Laeufe, an internal ground-truth probe):
//   0.3px-Rects bei (50.1,50.1)/(25,25)/(75,75)/(50,10) in 100x100-viewBox (4x4-Grid)
//   liefern cell "C3-B2"/"B2-A1"/"D4-C3"/"C1-B1" — Range-ENDE VOR Range-START,
//   bei bbox_reliability=reliable und ohne warnings. Deterministisch (3/3 identisch).
//
// WAHRHEITS-PIN (implementierungsunabhaengig):
//   Eine cell-Range in A1-Notation ("B2-C3") ist eine Bereichsangabe. Fuer JEDES
//   Element MUSS gelten: START <= END — sowohl in der Spalten- als auch in der
//   Zeilen-Ordnung. Welche konkrete Zelle ein Grenz-/Sub-Pixel-Element bekommt
//   (z.B. "B2", "C3" oder "B2-C3"), wird NICHT gepinnt — nur die Wohlordnung.
//   Kontroll-Pin: heute bereits wohlgeordnete Normal-Elemente bleiben wohlgeordnet.
//
// Fixtures EXAKT aus probe_R11-04.mjs uebernommen (gleiche Koordinaten, gleiches SVG-Template).

import * as M from '../../src/pipeline.js';

// ---------- Eigener A1-Notation-Parser (kein Import aus src) ----------
const COLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function parseA1(cell) {
  if (typeof cell !== 'string') return null;
  const m = /^([A-Z])(\d+)(?:-([A-Z])(\d+))?$/.exec(cell.trim());
  if (!m) return null;
  const start = { col: COLS.indexOf(m[1]), row: parseInt(m[2], 10) };
  const end = m[3] ? { col: COLS.indexOf(m[3]), row: parseInt(m[4], 10) } : { ...start };
  return { start, end };
}

function isWellOrdered(parsed) {
  return parsed.start.col <= parsed.end.col && parsed.start.row <= parsed.end.row;
}

// ---------- Fixture exakt wie in der Probe ----------
function svgWithRect(x, y, w, h) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect id="p" x="${x}" y="${y}" width="${w}" height="${h}" fill="#ff0000"/></svg>`;
}

// o2s 4 Boundary-Punkte (0.3px-Rect) + 2 Kontrollen (normale Geometrie) — exakt aus probe_R11-04.mjs
const CASES = [
  { name: 'boundary_50.1_50.1_0.3px', x: 50.1, y: 50.1, w: 0.3, h: 0.3, kontrolle: false },
  { name: 'boundary_25_25_0.3px',     x: 25,   y: 25,   w: 0.3, h: 0.3, kontrolle: false },
  { name: 'boundary_75_75_0.3px',     x: 75,   y: 75,   w: 0.3, h: 0.3, kontrolle: false },
  { name: 'boundary_50_10_0.3px',     x: 50,   y: 10,   w: 0.3, h: 0.3, kontrolle: false },
  { name: 'kontrolle_a_30_30_40x40',  x: 30,   y: 30,   w: 40,  h: 40,  kontrolle: true  },
  { name: 'kontrolle_b_10_10_5x5',    x: 10,   y: 10,   w: 5,   h: 5,   kontrolle: true  },
];

let failCount = 0;
function assertPrint(name, ok, ist) {
  console.log(`ASSERT ${name}: ${ok ? 'PASS' : 'FAIL'} — ist: ${ist}`);
  if (!ok) failCount += 1;
}

await M.init();
try {
  for (const c of CASES) {
    let cell;
    let reliability;
    let elementGefunden = false;
    let threw = null;
    try {
      const r = await M.inspect(svgWithRect(c.x, c.y, c.w, c.h));
      const el = (r.structured?.scene?.elements || []).find((e) => e.id === 'p');
      if (el) {
        elementGefunden = true;
        cell = el.cell;
        reliability = el.bbox_reliability;
      }
    } catch (e) {
      threw = e.message;
    }

    const assertName = `cell_wohlgeordnet_${c.name}`;

    if (threw !== null) {
      assertPrint(assertName, false, `inspect THREW: ${threw}`);
      continue;
    }
    if (!elementGefunden) {
      // Sichtbares Rect innerhalb der viewBox MUSS in scene.elements erscheinen —
      // eine Mess-Pipeline, die es verschluckt, verletzt die Wahrheit ebenfalls.
      assertPrint(assertName, false, 'element #p fehlt in scene.elements');
      continue;
    }
    if (cell === null || cell === undefined || cell === '') {
      if (c.kontrolle) {
        // Kontroll-Pin: Normal-Element hat heute eine wohlgeordnete cell — die muss bleiben.
        assertPrint(assertName, false, `cell fehlt (${JSON.stringify(cell)}) bei Normal-Element`);
      } else {
        // Keine Range behauptet → Wohlordnungs-Invariante trivial erfuellt.
        assertPrint(assertName, true, `cell=${JSON.stringify(cell)} (keine Range behauptet — Invariante trivial erfuellt)`);
      }
      continue;
    }

    const parsed = parseA1(cell);
    if (!parsed) {
      assertPrint(assertName, false, `cell="${cell}" nicht als A1-Notation parsebar (bbox_reliability=${reliability})`);
      continue;
    }
    const ok = isWellOrdered(parsed);
    assertPrint(
      assertName,
      ok,
      `cell="${cell}" bbox_reliability=${reliability} — ${ok ? 'START<=END' : 'END VOR START (Spalte/Zeile invertiert)'}`,
    );
  }

  // P5-WAHRHEITS-PIN (Patch-Runde, O2-Mutationskiller): der <1px-GRENZKREUZER
  // x=24.9, w=0.3 ueberspannt bei 25er-Zellen (100x100, 4x4-Grid) die Grenze
  // x=25 — [24.9, 25.2) schneidet Spalte A UND B. Die Wohlordnungs-Pins oben
  // liesse ein Symptom-Fix ueberleben, der die alte "-1px"-Mathematik nur
  // normalisiert (END:=max(START,ALT-END) → einzelne Zelle "A1", wohlgeordnet,
  // aber UNWAHR). Gepinnt wird die WAHRHEIT: BEIDE Zellen, exakt "A1-B1".
  // Empirisch verifiziert am O1-Stand (2-mal, 2026-06-11): cell="A1-B1".
  {
    let ist = null;
    let threw = null;
    try {
      const r = await M.inspect(svgWithRect(24.9, 10, 0.3, 0.3));
      const el = (r.structured?.scene?.elements || []).find((e) => e.id === 'p');
      ist = el ? el.cell : '(element #p fehlt)';
    } catch (e) {
      threw = e.message;
    }
    assertPrint(
      'grenzkreuzer_24.9_w0.3_meldet_beide_zellen_A1-B1',
      threw === null && ist === 'A1-B1',
      threw !== null ? `inspect THREW: ${threw}` : `cell=${JSON.stringify(ist)} (erwartet "A1-B1")`,
    );
  }
} finally {
  await M.shutdown();
}

if (failCount > 0) {
  console.log(`H10-RED R11-04: ROT (${failCount} FAIL)`);
  process.exit(1);
} else {
  console.log('H10-RED R11-04: GRUEN');
  process.exit(0);
}
