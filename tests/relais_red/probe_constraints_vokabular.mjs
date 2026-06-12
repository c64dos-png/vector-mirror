/**
 * RELAIS-Probe (JS-API) — Constraint-Vokabular: abschließend + Grammatik.
 *
 * Claims: C-CON-VOC · C-CON-UNK · C-QS-GRAMMAR (claims.js). Belegt K-17 + R9a #12:
 *   - RIGHT-OF/BELOW existieren NICHT in der Typen-Liste; LEFT-OF/ABOVE existieren.
 *   - Gegenrichtung via getauschte Operanden: a links von b ⇒ "#a LEFT-OF #b"
 *     PASS und "#b LEFT-OF #a" FAIL.
 *   - RIGHT-OF in analyze ⇒ unchecked CONSTRAINT_TYPE_UNKNOWN (nie geraten).
 *   - Tippfehler (CENTRD-IN) ⇒ unchecked mit Korrektur-Vorschlag CENTERED-IN.
 *   - Grammatik: jede syntax beginnt mit "#subject"; CENTERED-IN existiert
 *     (das Quickstart-Beispiel ist ein lebender Typ).
 *
 * Eigenständig, deterministisch, Exit 1 wenn rot.
 */
import * as M from '../../src/pipeline.js';

const VB =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100" width="400" height="100"';
const SVG =
  `<svg ${VB}>` +
  '<rect id="a" x="10" y="10" width="40" height="30" fill="red"/>' +
  '<rect id="b" x="200" y="10" width="40" height="30" fill="blue"/></svg>';

let failCount = 0;
function assert(name, cond, ist) {
  const verdict = cond ? 'PASS' : 'FAIL';
  if (!cond) failCount += 1;
  console.log(`ASSERT ${name}: ${verdict} — ist: ${ist}`);
}

// Typen-Liste (pure, kein Browser).
{
  const t = M.getConstraintTypes();
  const types = (t.structured?.types || []).map((x) => x.type);
  console.log(`OBS Typen: ${JSON.stringify(types)}`);
  assert(
    'right_of_existiert_nicht',
    !types.includes('RIGHT-OF'),
    JSON.stringify(types),
  );
  assert(
    'below_existiert_nicht',
    !types.includes('BELOW'),
    JSON.stringify(types),
  );
  assert(
    'gegenstuecke_existieren',
    types.includes('LEFT-OF') && types.includes('ABOVE'),
    JSON.stringify(types),
  );
  assert(
    'grammatik_subject_first',
    (t.structured?.types || []).every((x) => x.syntax.startsWith('#subject ')),
    JSON.stringify((t.structured?.types || []).map((x) => x.syntax)),
  );
  assert(
    'beispiel_typ_lebt',
    types.includes('CENTERED-IN'),
    JSON.stringify(types),
  );
  const fill = (t.structured?.types || []).find((x) => x.type === 'FILL');
  const color = (t.structured?.types || []).find((x) => x.type === 'COLOR');
  assert(
    'hasArrange_markiert_teilmenge',
    fill?.hasArrange === true && color?.hasArrange === false,
    `FILL=${fill?.hasArrange}, COLOR=${color?.hasArrange}`,
  );
}

try {
  await M.init();

  // Gegenrichtung via Operanden-Tausch.
  const links = await M.analyze(SVG, ['#a LEFT-OF #b']);
  const falsch = await M.analyze(SVG, ['#b LEFT-OF #a']);
  console.log(
    `OBS LEFT-OF: a-vor-b=${links.structured?.status}, b-vor-a=${falsch.structured?.status}`,
  );
  assert(
    'left_of_pass',
    links.structured?.status === 'PASS',
    links.structured?.status,
  );
  assert(
    'operanden_getauscht_fail',
    falsch.structured?.status === 'FAIL',
    falsch.structured?.status,
  );

  // RIGHT-OF ⇒ unchecked CONSTRAINT_TYPE_UNKNOWN.
  const ro = await M.analyze(SVG, ['#b RIGHT-OF #a']);
  const u1 = ro.structured?.unchecked?.[0];
  console.log(`OBS RIGHT-OF: ${JSON.stringify(u1)}`);
  assert(
    'right_of_unchecked_unknown',
    u1?.reasonCode === 'CONSTRAINT_TYPE_UNKNOWN' &&
      typeof u1?.hint === 'string',
    JSON.stringify(u1),
  );

  // Tippfehler ⇒ Korrektur-Vorschlag.
  const typo = await M.analyze(SVG, ['#a CENTRD-IN #b']);
  const u2 = typo.structured?.unchecked?.[0];
  console.log(`OBS Tippfehler: ${JSON.stringify(u2)}`);
  assert(
    'tippfehler_vorschlag',
    u2?.reasonCode === 'CONSTRAINT_TYPE_UNKNOWN' &&
      (u2?.suggestedCorrection || '').includes('CENTERED-IN'),
    JSON.stringify(u2),
  );
} finally {
  await M.shutdown();
}

if (failCount > 0) {
  console.log(`RELAIS-PROBE constraints_vokabular: ROT (${failCount} FAIL)`);
  process.exit(1);
} else {
  console.log('RELAIS-PROBE constraints_vokabular: GRUEN');
  process.exit(0);
}
