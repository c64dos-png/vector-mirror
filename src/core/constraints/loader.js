/**
 * loader.js - Side-Effect Imports for all Constraints + REGEL-3 Validation-Wrapper
 * ADR-020: New constraint = 1 file + 1 import here
 * Vector Mirror v2.0
 *
 *
 *   Zusaetzlich zum side-effect-Registrieren exportiert loader.js jetzt
 *   `validatedCheckConstraint(type, subj, ref, ctx)`. Diese Funktion
 *   delegiert an registry.checkConstraint und prueft das Resultat gegen
 *   constraintCheckSchema (REGEL-3 Output-Boundary-Gate, WELLE-β-004).
 *
 *   pipeline.js bleibt UNVERAENDERT — Edit C ist additive API. Die
 *   Drift-Verhinderung greift via test_regel3_invariants.js (Edit H),
 *   das validatedCheckConstraint generativ ueber alle registrierten
 *   Constraints aufruft. Damit faengt jeder neue Constraint, der REGEL-3
 *   bricht (kein dx/dy bei fail), schon im Unit-Test (Fail-Fast).
 *
 *   Warum nicht registry.js direkt patchen: registry.js liegt ausserhalb
 *   der 8 Patch-Files (H-9). Andon-Cord-#3-Vermeidung — andere Constraints
 *   (CENTERED-IN, NO-OVERLAP, etc.) bleiben unangetastet im Pipeline-Pfad,
 *   keine Pre-Existing-Drift wird stillschweigend "nebenbei" gefixed.
 */
import './centered-in.js';
import './no-overlap.js';
import './inside.js';
import './aligned.js';
import './positional.js';
import './distance.js';
import './same-size.js';
import './color.js';
import './fill.js';

import { constraintCheckSchema } from './_schema.js';
import { checkConstraint } from './registry.js';

/**
 * REGEL-3 Output-Boundary-Gate.
 *
 * Aufruf delegiert an checkConstraint, validiert das Resultat gegen
 * constraintCheckSchema und wirft bei Verletzung einen Error mit
 * Constraint-Typ + Detail. Bei `pass === null` (Unbekannter Constraint)
 * wird das Resultat ohne Validation zurueckgegeben — `null` ist eine
 * gueltige "kein Verdict moeglich"-Antwort und faellt aus REGEL-3 raus.
 *
 * @param {string} type   Constraint-Typ (z.B. 'CENTERED-IN', 'DISTANCE-FROM')
 * @param {object} subj   Subject-Element aus gridMap
 * @param {object|null} ref  Reference-Element aus gridMap
 * @param {object} ctx    Kontext { grid, value? }
 * @returns {{ pass: boolean|null, detail: string|null, dx?: number, dy?: number, dw?: number, dh?: number }}
 * @throws  Error wenn Constraint REGEL-3 verletzt (fail ohne dx/dy)
 */
export function validatedCheckConstraint(type, subj, ref, ctx) {
  const result = checkConstraint(type, subj, ref, ctx);
  // pass === null → "Unbekannter Constraint" (registry.js Z.29).
  // Das ist KEIN REGEL-3-Bruch, sondern eine Lookup-Failure — durchreichen.
  if (result.pass === null) return result;
  const parsed = constraintCheckSchema.safeParse(result);
  if (!parsed.success) {
    const reason = parsed.error.issues.map((i) => i.message).join('; ');
    throw new Error(
      `[REGEL-3] Constraint '${type}' verletzt Output-Boundary-Vertrag: ${reason}`,
    );
  }
  return result;
}
