/**
 * arbitrate.js — Tri-State Validator (P1-04, VM-LC-001)
 * Vector Mirror v2.5
 *
 * Splits constraint results into three buckets — `passing`, `failing`,
 * `unchecked` — and passes the scene `diff` through severity-sorted.
 * No silent cap: max=3 capping has moved to the presentation layer
 * (`adapters/emitter/prose.js`); structured output ships the full set.
 *
 * Tri-state semantics:
 *   pass === true   → passing[]    (constraint evaluated, satisfied)
 *   pass === false  → failing[]    (constraint evaluated, violated, with deltas)
 *   pass === null   → unchecked[]  (could not evaluate, with reasonCode)
 *
 * Each `unchecked` entry carries a structured reason so the LLM (or a
 * downstream emitter) can act on it instead of seeing a phantom "PASS":
 *   - reasonCategory: "SPECIFICATION" | "MODEL"
 *   - reasonCode:     enum (see REASON_CODES)
 *   - hint:           human-readable line
 *   - suggestedCorrection?: string (only when we can offer one)
 *
 * Source-of-truth references:
 *   - FIX_PLAN_2026-04-18 §1.2 P1-04
 *   - KATALOG VM-LC-001 (Silent-PASS bei pass:null)
 *   - KATALOG VM-LC-003 (max=3-Kappung verletzt ADR-024)
 *   - RB-01 §6.1, RB-03 §6.1
 *
 * Core module: NO imports from adapters/ or interface/.
 */

/**
 * Severity ordering for diff entries (lower = more important).
 * `failing` issues are pinned at severity 0; diff types follow.
 */
const DIFF_PRIO = {
  VERSCHOBEN: 1,
  FARBÄNDERUNG: 2,
  NEU: 3,
  ENTFERNT: 4,
};

/**
 * Allowed reasonCode values for unchecked entries.
 * @type {readonly string[]}
 */
export const REASON_CODES = Object.freeze([
  'CONSTRAINT_TYPE_UNKNOWN', // unbekannter / falsch geschriebener Typ
  'SUBJECT_NOT_FOUND', // subjekt-id existiert nicht im scene
  'REFERENCE_NOT_FOUND', // referenz-id existiert nicht im scene
  'REFERENCE_DEGENERATE', // referenz-bbox 0×0 oder ungueltig
  'MEASUREMENT_AMBIGUOUS', // kein klares messverfahren (z.b. fill auf <g>)
  'INVALID_MEASUREMENT', // mess-vorgabe selbst ungueltig (z.b. negativer ziel-abstand) (D-003)
  'SEMANTIC_SUSPICIOUS', // syntaktisch ok, aber semantisch verdaechtig
  'SCOPE_MISMATCH', // constraint passt nicht zu element-typ
  // §HEAL-5 Verdikt-Wache (pipeline.js#classifySubjectHonesty, F-AT-2-005):
  'SUBJECT_NOT_PAINTED', // subjekt malt 0 pixel (paint_visible:false) — pass:true degradiert
  'SUBJECT_TIME_VARIANT', // subjekt-geometrie zeit-variant (motion_dependent) — geprueft @t0
  // §H10 R11-07 dritte Wache-Klasse (pipeline.js#classifySubjectHonesty):
  'SUBJECT_NOT_MEASURABLE', // subjekt-bbox not_measurable (3d/non-smil-motion) — kein gruenes verdikt ueber misstrauter zahl
  // §H10 R11-21 Parse-Verweigerung (pipeline.js#parseConstraints/checkAllConstraints):
  'CONSTRAINT_UNPARSEABLE', // constraint-string nicht (vollstaendig) gegen die grammatik parsebar — verweigert statt interpretiert
  // §H10 R11-01 Existenz-Register (pipeline.js#checkAllConstraints):
  'SUBJECT_HIDDEN', // subjekt-id existiert im markup, ist aber css-unsichtbar @t0 — nicht gemessen
  'REFERENCE_HIDDEN', // referenz-id existiert im markup, ist aber css-unsichtbar @t0 — symmetrie zu SUBJECT_HIDDEN (P1)
]);

/**
 * Constraint types currently registered in `core/constraints/loader.js`.
 * Used as the dictionary for typo-suggestions in unchecked entries.
 * Mirrors ADR-029 Tier-A (11 types). When loader.js gains new types,
 * extend this list.
 */
const KNOWN_CONSTRAINT_TYPES = Object.freeze([
  'ALIGNED-LEFT',
  'ALIGNED-TOP',
  'CENTERED-IN',
  'COLOR',
  'DISTANCE-FROM',
  'FILL',
  'INSIDE',
  'NO-OVERLAP',
  'LEFT-OF',
  'ABOVE',
  'SAME-SIZE',
]);

/**
 * Levenshtein edit distance — small helper, used for typo suggestions.
 * O(m·n) time, O(min(m,n)) space.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * Returns the closest known constraint type within Levenshtein ≤ 2,
 * or `undefined` if no candidate is close enough.
 *
 * @param {string} type
 * @returns {string|undefined}
 */
function closestKnownType(type) {
  if (!type) return undefined;
  let best;
  let bestDist = 3; // strictly less than this wins; ≤2 by FIX_PLAN
  for (const known of KNOWN_CONSTRAINT_TYPES) {
    const d = levenshtein(type.toUpperCase(), known);
    if (d < bestDist) {
      bestDist = d;
      best = known;
    }
  }
  return best;
}

/**
 * Builds an `unchecked` entry. If the constraint result already carries
 * a reasonCode (provided by registry / P1-08), passes it through; otherwise
 * applies a heuristic fallback so existing producers keep working.
 *
 * @param {object} cr  raw constraint result (`pass: null` shape)
 * @returns {{
 *   id?: string,
 *   constraintType?: string,
 *   reasonCategory: 'SPECIFICATION'|'MODEL',
 *   reasonCode: string,
 *   hint: string,
 *   suggestedCorrection?: string,
 *   detail?: string
 * }}
 */
function buildUnchecked(cr) {
  const entry = {};
  if (cr.id !== undefined) entry.id = cr.id;
  if (cr.constraintType !== undefined) entry.constraintType = cr.constraintType;
  if (cr.detail !== undefined) entry.detail = cr.detail;

  // Honor upstream reasonCode (registry / P1-08) if present and valid.
  if (cr.reasonCode && REASON_CODES.includes(cr.reasonCode)) {
    entry.reasonCategory =
      cr.reasonCategory === 'MODEL' ? 'MODEL' : 'SPECIFICATION';
    entry.reasonCode = cr.reasonCode;
    entry.hint = cr.hint || cr.detail || 'Constraint nicht ausgewertet.';
    if (cr.suggestedCorrection)
      entry.suggestedCorrection = cr.suggestedCorrection;
    return entry;
  }

  // Fallback heuristic: attempt typo-detection on constraintType.
  if (
    cr.constraintType &&
    !KNOWN_CONSTRAINT_TYPES.includes(cr.constraintType)
  ) {
    const suggestion = closestKnownType(cr.constraintType);
    entry.reasonCategory = 'SPECIFICATION';
    entry.reasonCode = 'CONSTRAINT_TYPE_UNKNOWN';
    entry.hint = `Constraint-Typ '${cr.constraintType}' ist nicht registriert.`;
    if (suggestion) entry.suggestedCorrection = suggestion;
    return entry;
  }

  // Generic catch-all: known type but check returned pass:null.
  entry.reasonCategory = 'MODEL';
  entry.reasonCode = 'MEASUREMENT_AMBIGUOUS';
  entry.hint = cr.detail || 'Constraint-Auswertung nicht moeglich.';
  return entry;
}

/**
 * Tri-state validation pass over constraint results + scene diff.
 *
 * @param {Array<{pass: boolean|null, [k:string]: any}>} constraintResults
 * @param {Array<{type: string, [k:string]: any}>} diff
 * @returns {{
 *   passing:   Array<{id?: string, constraintType?: string}>,
 *   failing:   Array<{type: 'CONSTRAINT_FAIL', severity: 0, [k:string]: any}>,
 *   unchecked: Array<{reasonCategory: string, reasonCode: string, hint: string, [k:string]: any}>,
 *   diff:      Array<{type: string, severity: number, [k:string]: any}>,
 *   totals:    {
 *     total: number,
 *     passing_count: number,
 *     failing_count: number,
 *     unchecked_count: number,
 *     diff_count: number
 *   }
 * }}
 */
/**
 * Copies any defined `keys` from `src` onto `dst`. Helper to keep
 * arbitrate() free of long if-chains.
 */
function copyDefined(src, dst, keys) {
  for (const k of keys) if (src[k] !== undefined) dst[k] = src[k];
  return dst;
}

const PASSING_KEYS = ['id', 'constraintType'];
const FAILING_KEYS = [
  'detail',
  'id',
  'constraintType',
  'reference',
  'dx',
  'dy',
  'dw',
  'dh',
];

export function arbitrate(constraintResults, diff) {
  const passing = [];
  const failing = [];
  const unchecked = [];

  for (const cr of constraintResults) {
    if (cr.pass === true) {
      passing.push(copyDefined(cr, {}, PASSING_KEYS));
    } else if (cr.pass === false) {
      failing.push(
        copyDefined(cr, { type: 'CONSTRAINT_FAIL', severity: 0 }, FAILING_KEYS),
      );
    } else {
      unchecked.push(buildUnchecked(cr));
    }
  }

  const diffSorted = diff
    .map((d) => ({ ...d, severity: DIFF_PRIO[d.type] ?? 5 }))
    .sort((a, b) => a.severity - b.severity);

  const passing_count = passing.length;
  const failing_count = failing.length;
  const unchecked_count = unchecked.length;
  const diff_count = diffSorted.length;

  return {
    passing,
    failing,
    unchecked,
    diff: diffSorted,
    totals: {
      total: failing_count + unchecked_count + diff_count,
      passing_count,
      failing_count,
      unchecked_count,
      diff_count,
    },
  };
}
