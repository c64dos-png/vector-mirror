/**
 * test_schema_adr_sync.js — CI-Drift-Gate ADR ↔ Schema
 *
 * Zweck:
 *   Verhindert das Wiederauftreten von Audit-Welle-β WELLE-β-001 — bbox_reliability
 *   Schema-Drift gegenueber ADR-026 §6 (Reliability-Trichter) und
 *   ADR-032 §Entscheidung (Schema-Erweiterung).
 *
 *   Beide ADRs versprechen 3 Werte: 'reliable' | 'approximate' | 'not_measurable'.
 *   Das Schema (src/interface/schema.js elementSchema.bbox_reliability) MUSS diese
 *   Werte als z.enum-Optionen anbieten. Bei zukuenftigem Refactor wuerde ein Wert-
 *   Drift (z.B. Umbenennung, Wegfall) hier sofort scheitern (CI-rot),
 *   bevor er als Spec-Bruch in die MCP-Caller-Boundary durchrutscht.
 *
 * Mechanik:
 *   - Liest ADR-026 + ADR-032 als Markdown, extrahiert die Stage-Liste via Regex.
 *   - Importiert elementSchema aus src/interface/schema.js.
 *   - Extrahiert die enum-Werte via Zod-Introspection (._def.shape().bbox_reliability._def.values).
 *   - Assertiert Mengen-Identitaet: ADR-Set === Schema-Set.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { elementSchema } from '../../src/interface/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');

let passCount = 0;
let failCount = 0;
function assert(label, cond, extra = '') {
  if (cond) {
    console.log(`  PASS: ${label}`);
    passCount++;
  } else {
    console.error(`  FAIL: ${label}${extra ? ` — ${extra}` : ''}`);
    failCount++;
  }
}

// Erwarteter Wertebereich aus ADR-026 §6 + ADR-032 §Entscheidung.
const EXPECTED_VALUES = new Set(['reliable', 'approximate', 'not_measurable']);

// ── Test 1: ADR-026 enthaelt alle 3 Werte ────────────────────
console.log('--- ADR-Sync: ADR-026 Reliability-Trichter ---');
{
  const adr026Path = path.join(ROOT, 'docs', 'ADR-026_rendering_fidelity_scope.md');
  const text = fs.readFileSync(adr026Path, 'utf-8');
  const found = new Set();
  for (const v of EXPECTED_VALUES) {
    // Mindestens 1 Vorkommen in der Datei (eingebettet in Backticks oder Quotes).
    const re = new RegExp(`['"\`]${v}['"\`]`);
    if (re.test(text)) found.add(v);
  }
  for (const v of EXPECTED_VALUES) {
    assert(
      `ADR-026 nennt '${v}'`,
      found.has(v),
      found.has(v) ? '' : 'fehlt in docs/ADR-026_rendering_fidelity_scope.md',
    );
  }
}

// ── Test 2: ADR-032 enthaelt alle 3 Werte ────────────────────
console.log('--- ADR-Sync: ADR-032 Qualitative Confidence ---');
{
  const adr032Path = path.join(ROOT, 'docs', 'ADR-032_qualitative_confidence.md');
  const text = fs.readFileSync(adr032Path, 'utf-8');
  const found = new Set();
  for (const v of EXPECTED_VALUES) {
    const re = new RegExp(`['"\`]${v}['"\`]`);
    if (re.test(text)) found.add(v);
  }
  for (const v of EXPECTED_VALUES) {
    assert(
      `ADR-032 nennt '${v}'`,
      found.has(v),
      found.has(v) ? '' : 'fehlt in docs/ADR-032_qualitative_confidence.md',
    );
  }
}

// ── Test 3: elementSchema.bbox_reliability hat genau die 3 Werte ────────────
console.log('--- ADR-Sync: elementSchema.bbox_reliability enum ---');
{
  // Zod-v3-Introspection: ZodObject._def.shape() gibt das shape-Object zurueck,
  // ZodEnum._def.values ist das Array der zulaessigen Werte.
  const shape =
    typeof elementSchema._def.shape === 'function'
      ? elementSchema._def.shape()
      : elementSchema._def.shape;
  assert(
    'elementSchema._def.shape vorhanden',
    !!shape,
    !shape ? 'Zod-Introspection-API hat sich geaendert' : '',
  );
  const reliabilityField = shape?.bbox_reliability;
  assert(
    'shape.bbox_reliability vorhanden',
    !!reliabilityField,
    !reliabilityField ? 'Feld nicht im elementSchema' : '',
  );
  const values =
    reliabilityField?._def?.values ?? reliabilityField?._def?.entries ?? [];
  const schemaSet = new Set(Array.isArray(values) ? values : Object.keys(values));
  assert(
    `Schema-Enum-Werte (got: ${JSON.stringify([...schemaSet])})`,
    schemaSet.size === EXPECTED_VALUES.size,
    `expected ${EXPECTED_VALUES.size} values, got ${schemaSet.size}`,
  );
  for (const v of EXPECTED_VALUES) {
    assert(
      `Schema kennt '${v}'`,
      schemaSet.has(v),
      schemaSet.has(v) ? '' : `'${v}' fehlt — ADR-026/032 Spec-Bruch`,
    );
  }
  for (const v of schemaSet) {
    assert(
      `Schema-Wert '${v}' ist in ADR-Set`,
      EXPECTED_VALUES.has(v),
      EXPECTED_VALUES.has(v)
        ? ''
        : `'${v}' ist Schema-only — ADR-026/032 muss erweitert werden`,
    );
  }
}

console.log(`\nErgebnis: ${passCount} bestanden, ${failCount} fehlgeschlagen`);
process.exit(failCount === 0 ? 0 : 1);
