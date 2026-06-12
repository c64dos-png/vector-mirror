/**
 * test_error_response_conformance.js — §P2 Konformitäts-Wächter.
 *
 * STRUKTURELLER WÄCHTER gegen required-Feld-Drift in den Error-Response-Bauern
 * von tools.js. Jeder Tool-Handler hat einen Error-Pfad, der eine schema-konforme
 * structuredContent-Hülle liefern MUSS (sonst scheitert die MCP-SDK-safeParse
 * still — genau die Lücke aus F-AT-6-08/P2: inspectErrorResponse lieferte scene
 * OHNE das in inspectOutput REQUIRED-Feld scene.suppressed).
 *
 * Die Builder sind in tools.js NICHT exportiert. Statt die Export-Fläche zu
 * verbreitern, treiben wir jeden Tool-Handler über seinen ECHTEN Error-Pfad und
 * prüfen die zurückgelieferte structuredContent gegen das registrierte
 * outputSchema (z.object(<outputSchema>).safeParse(...).success === true). So
 * bricht künftige required-Feld-Drift NICHT mehr still, sondern hier laut.
 *
 * Error-Trigger je Builder (deterministisch):
 *   analyze/compare/inspect/palette → leeres SVG (resolve liefert keine
 *     sichtbaren Elemente → result.structured === null → *ErrorResponse).
 *   arrange → elements:null erzwingt TypeError im arrange()-Kern → catch →
 *     arrangeErrorResponse.
 *   bookmark → unbekannte (gültige) UUID → grids.get(...)===undefined →
 *     result.structured===null → bookmarkErrorResponse.
 *
 * Run direkt: `node tests/unit/test_error_response_conformance.js`
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  analyzeTool,
  arrangeTool,
  bookmarkTool,
  compareTool,
  inspectTool,
  paletteTool,
} from '../../src/interface/tools.js';
import {
  analyzeOutput,
  arrangeOutput,
  bookmarkOutput,
  inspectOutput,
  paletteOutput,
} from '../../src/interface/schema.js';
import { shutdown } from '../../src/pipeline.js';

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

// Leeres (valides) SVG: rendert keine sichtbaren Elemente → Error-Pfad der
// resolve-getriebenen Tools (analyze/compare/inspect/palette).
const EMPTY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';

// Jeder Eintrag: ruft den ECHTEN Error-Pfad des Handlers, prüft Konformität
// der structuredContent gegen sein outputSchema.
const CASES = [
  {
    name: 'analyze',
    schema: analyzeOutput,
    invoke: () => analyzeTool.handler({ svg: EMPTY_SVG, constraints: [] }),
  },
  {
    name: 'compare',
    // compare nutzt analyzeErrorResponse → analyzeOutput.
    schema: analyzeOutput,
    invoke: () => compareTool.handler({ svg: EMPTY_SVG, constraints: [] }),
  },
  {
    name: 'inspect',
    schema: inspectOutput,
    invoke: () => inspectTool.handler({ svg: EMPTY_SVG }),
  },
  {
    name: 'palette',
    schema: paletteOutput,
    invoke: () => paletteTool.handler({ svg: EMPTY_SVG }),
  },
  {
    name: 'arrange',
    schema: arrangeOutput,
    // elements:null → TypeError im arrange-Kern → catch → arrangeErrorResponse.
    invoke: () =>
      arrangeTool.handler({
        canvas: { width: 100, height: 100 },
        elements: null,
        constraints: [],
      }),
  },
  {
    name: 'bookmark',
    schema: bookmarkOutput,
    // gültige, aber unbekannte UUID → grids.get(...)===undefined → Error-Pfad.
    invoke: () =>
      bookmarkTool.handler({ name: 'conformance', analysisId: randomUUID() }),
  },
];

(async () => {
  try {
    console.log(
      '=== Error-Response-Konformität: jeder Builder liefert schema-valide structuredContent ===',
    );
    for (const c of CASES) {
      const resp = await c.invoke();
      // Vertrag: Error-Pfad → isError true + structuredContent vorhanden.
      assert(
        `${c.name}: Error-Pfad getroffen (isError===true)`,
        resp.isError === true,
        `isError=${JSON.stringify(resp.isError)}`,
      );
      const parsed = z.object(c.schema).safeParse(resp.structuredContent);
      assert(
        `${c.name}: structuredContent ist outputSchema-konform`,
        parsed.success === true,
        parsed.success
          ? ''
          : `issues=${JSON.stringify(parsed.error.issues)} sc=${JSON.stringify(
              resp.structuredContent,
            )}`,
      );
    }
  } finally {
    await shutdown();
  }

  console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error('Test-Lauf-Fehler:', e);
  process.exit(1);
});
