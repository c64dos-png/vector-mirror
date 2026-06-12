/**
 * registry.js - Constraint Registry (Plug-In Pattern)
 * ADR-020: Map<type, {check, arrange}>
 * ADR-022: Context-Object Pattern (ctx = { grid, value? })
 * Vector Mirror v2.0
 */

const handlers = new Map();

/**
 * Registers a constraint handler.
 *
 * `requiresReference` (default true) markiert, ob `check()`/`arrange()` ein
 * Referenz-Element (`ref`) DEREFERENZIEREN — z.B. `ref.bbox`. Der Default ist
 * fail-closed (true): ein neu registrierter, unmarkierter Constraint gilt als
 * referenz-pflichtig, damit eine fehlende Referenz NIE still in einen
 * null-Deref-Crash laeuft (REGEL-8). Nur Constraints, die ohne Referenz
 * arbeiten (COLOR, FILL), setzen `requiresReference: false` explizit.
 *
 * @param {string} type - Constraint type (e.g. 'CENTERED-IN')
 * @param {{ check: Function, arrange?: Function, requiresReference?: boolean }} handler
 */
export function registerConstraint(
  type,
  { check, arrange, requiresReference },
) {
  handlers.set(type, {
    check,
    arrange,
    requiresReference: requiresReference !== false,
  });
}

/**
 * Ob ein Constraint-Typ ueberhaupt registriert (bekannt) ist.
 *
 * Trennt die zwei Diagnosen sauber: ein UNBEKANNTER Typ (Tippfehler/Phantasie)
 * darf NICHT vom ref-Guard maskiert werden — er fliesst weiter zu
 * checkConstraint → CONSTRAINT_TYPE_UNKNOWN (+ Levenshtein-Vorschlag). Nur fuer
 * BEKANNTE, ref-pflichtige Typen ohne ref greift der fail-closed REFERENCE_NOT_FOUND.
 *
 * @param {string} type
 * @returns {boolean}
 */
export function isRegistered(type) {
  return handlers.has(type);
}

/**
 * Ob ein Constraint-Typ ein Referenz-Element braucht (siehe registerConstraint).
 * Fail-closed: unbekannte Typen gelten als referenz-pflichtig (true), damit ein
 * fehlender ref nie in einen Deref-Crash faellt.
 *
 * @param {string} type
 * @returns {boolean}
 */
export function requiresReference(type) {
  const h = handlers.get(type);
  return h ? h.requiresReference : true;
}

/**
 * Checks a single constraint.
 * @param {string} type
 * @param {object} subj - Subject element from gridMap
 * @param {object|null} ref - Reference element from gridMap
 * @param {object} ctx - { grid, value? }
 * @returns {{ pass: boolean|null, detail?: string, dx?: number, dy?: number }}
 */
export function checkConstraint(type, subj, ref, ctx) {
  const h = handlers.get(type);
  if (!h) return { pass: null, detail: `Unbekannter Constraint: ${type}` };
  return h.check(subj, ref, ctx);
}

/**
 * Arranges a single constraint (inverse of check).
 * @param {string} type
 * @param {object} subj - Subject element { bbox }
 * @param {object|null} ref - Reference element { bbox }
 * @param {object} ctx - { canvas, value? }
 * @returns {object|null} Attribute patch or null if no arrange handler
 */
export function arrangeConstraint(type, subj, ref, ctx) {
  const h = handlers.get(type);
  if (!h?.arrange) return null;
  return h.arrange(subj, ref, ctx);
}

/**
 * Lists all registered constraint types.
 */
export function listConstraints() {
  return [...handlers.entries()].map(([type, h]) => ({
    type,
    hasArrange: !!h.arrange,
  }));
}
