/**
 * H9 HONEST-RED — K-05: stille id-Mutation.
 *
 * BEFUND: Ein SVG mit <text id="title"> + <rect id="ok_ref"> durchlaeuft
 * analyze(). Die Autor-id "title" wird durch eine Auto-ID (_<8hex>_text1)
 * ersetzt — und NIRGENDS im Output (weder prose noch structured) wird
 * genannt, WELCHE Autor-id betroffen war.
 *
 * WAHRHEITS-PIN (implementierungs-agnostisch):
 *   Eine aktive Veraenderung des Autor-Markups darf nicht anonym bleiben.
 *   Der Output muss die konkret betroffene Autor-id "title" irgendwo nennen
 *   (prose ODER structured). Jede korrekte Implementierung besteht:
 *     (a) sie laesst die Autor-id unangetastet → "title" erscheint als
 *         Element-id im structured-Kanal, ODER
 *     (b) sie ersetzt die id UND legt offen, dass "title" betroffen war
 *         → "title" erscheint als Disclosure in prose/structured.
 *   In beiden Faellen enthaelt der serialisierte Gesamt-Output den String
 *   "title". HEUTE enthaelt er ihn nicht → ROT.
 *
 * Eigenstaendig, kein Framework, deterministisch. Exit-Code 1 wenn rot.
 */

import * as M from '../../src/pipeline.js';

const SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100">',
  '  <rect id="ok_ref" x="10" y="10" width="80" height="40" fill="#3366cc"/>',
  '  <text id="title" x="20" y="80" font-size="16" fill="#000000">Hallo</text>',
  '</svg>',
].join('\n');

let failCount = 0;

function assert(name, cond, ist) {
  const verdict = cond ? 'PASS' : 'FAIL';
  if (!cond) failCount += 1;
  console.log(`ASSERT ${name}: ${verdict} — ist: ${ist}`);
}

try {
  await M.init();
  const r = await M.analyze(SVG, []);

  // Sanity-Pin: analyze liefert auf gueltigem SVG beide Kanaele (API-Vertrag).
  const hasChannels =
    r != null && typeof r.prose === 'string' && r.structured != null;
  assert(
    'k05_kanaele_vorhanden',
    hasChannels,
    `prose=${typeof r?.prose}, structured=${r?.structured == null ? 'null' : typeof r.structured}`,
  );

  const structuredJson = JSON.stringify(r?.structured ?? null);
  const combined = `${r?.prose ?? ''}\n${structuredJson}`;

  // Beobachtung (Diagnose, keine Assertion): welche Element-ids traegt der
  // structured-Kanal tatsaechlich? Belegt die stille Mutation im RED-Lauf.
  const elements = r?.structured?.scene?.elements ?? r?.structured?.elements ?? [];
  const observedIds = Array.isArray(elements)
    ? elements.map((e) => `${e.tag}#${e.id}`).join(', ')
    : '<keine elements-Liste>';
  console.log(`DIAG beobachtete Element-ids: ${observedIds}`);

  // WAHRHEITS-PIN K-05: die betroffene Autor-id "title" muss irgendwo im
  // Output genannt werden — als ueberlebende Element-id ODER als Disclosure.
  const titleNamed = combined.includes('title');
  assert(
    'k05_betroffene_autor_id_genannt',
    titleNamed,
    titleNamed
      ? '"title" erscheint im Output'
      : `"title" erscheint NIRGENDS in prose+structured (ids heute: ${observedIds})`,
  );
} finally {
  await M.shutdown();
}

if (failCount > 0) {
  console.log(`H9-RED K-05: ROT (${failCount} FAIL)`);
  process.exit(1);
} else {
  console.log('H9-RED K-05: GRUEN');
  process.exit(0);
}
