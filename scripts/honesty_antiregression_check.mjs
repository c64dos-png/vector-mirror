#!/usr/bin/env node
/**
 * honesty_antiregression_check.mjs — DoD-8/E7b Dauer-Gate W1+W2
 * (Spec: docs/internal/an internal spec, Bau-Teil 1; Baseline-Witness HEAD bf240bd)
 *
 * W1 Reliability-Pin (bidirektional): die geheilte Honesty-Architektur (REGEL-4:
 * honesty.js ist die importfreie SSOT der Reliability-Semantik) darf nicht still
 * zurueckwachsen. Drei Allowlists, je Datei+Muster-ZAEHLUNG (nie Zeilennummern):
 *   (a) Wert-Zuweisungen an bbox_reliability ausserhalb honesty.js
 *   (b) Vergleichs-/Entscheidungs-Stellen ausserhalb honesty.js
 *   (c) honesty-API-Caller (gateCorrections / countTruncation)
 * Zuwachs UND Schwund sind ROT (Muster knownRed, tests/baseline.json):
 *
 * GRENZEN (ehrlich deklariert, Audit 2026-06-11): Der Pin ist SEMANTIK-BLIND —
 * er zaehlt Stellen, nicht Werte (eine boeswillige Wert-Vertauschung INNERHALB
 * einer gepinnten Zuweisung faengt erst die Verhaltens-Suite). Er waechst nur
 * ueber das bbox_reliability-Feld und die zwei gepinnten honesty-APIs — neue
 * Honesty-Logik fuer ANDERE Felder/Funktionen oder lowercase-Feld-Signale deckt
 * die ZWEITE LINIE: coverage_check (Signal-Vokabular + Nenner-Pflege-Pflicht)
 * plus die Honest-Red-Verhaltens-Suiten. Pin-Erweiterungs-Kandidat: classifyCanvas-
 * Caller (dod8_e7b_spec Restnotiz).
 * eine neue Inline-Stelle = Regression; eine verschwundene Pin-Stelle = die
 * Allowlist luegt (heimlich geheilt/verschoben) und MUSS gepflegt werden.
 *
 * W2 Einstiegs-Wache: Datei-NAMEN ^(START_HERE|HAND_OFF|PROJEKTMAPPE) ausserhalb
 * archive/ == 0 (E1: INDEX.md ist der EINE Einstieg). Bewusst NAME-basiert:
 * 594 Alt-Text-Referenzen in Doku/Archiv wuerden jeden Content-grep fluten.
 *
 * MESS-DISZIPLIN (Witness-kompatibel, an internal session artifact):
 *   - binaer-sicher: Dateien mit NUL-Byte werden uebersprungen (nie als Text geparst)
 *   - Kommentarzeilen (trim beginnt mit // oder * oder /*) zaehlen NICHT
 *   - Feld-Anker `bbox_reliability` bzw. API-Name + '(' — NIE Wert-Literal allein
 *     (19 'not_measurable'-Literale gehoeren zu visual_bbox, waeren Falsch-Treffer)
 *
 * Exit 0 + Zeile "HONESTY-ANTIREGRESSION: GRUEN (...)" <=> alle Pins exakt.
 * Exit 1 + Klartext je Abweichung sonst.
 *
 * Run: node scripts/honesty_antiregression_check.mjs
 * Test-Override (NUR fuer Rot-Beweise, analog gate.mjs GATE_BASELINE):
 *   HONESTY_CHECK_ROOT=<dir>  scannt einen alternativen Projekt-Root.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.HONESTY_CHECK_ROOT || join(__dirname, '..');

// ── PIN-KONSTANTEN (Allowlist, bidirektional; Aenderung = maintainer/spec decision) ──
//
// (a) Wert-Zuweisungen an bbox_reliability ausserhalb honesty.js.
//     playwright.js: EXAKT 3 — der EINE Klassifikations-Trichter (Zeilen-Bereich
//     4013-4024 am Witness-Stand; gepinnt wird die ZAHL, nie die Zeile):
//     is3D|Motion -> 'not_measurable' / hasTransform -> 'approximate' / sonst
//     -> 'reliable'. REGEL-4-Bestand: der Renderer-Adapter MISST und klassifiziert
//     am Mess-Ort; die Entscheidungs-SEMANTIK (was folgt daraus) wohnt in honesty.js.
//     Jede 4. Zuweisung irgendwo = neue Inline-Produktion = ROT.
const PIN_ASSIGNMENTS = {
  'src/adapters/renderer/playwright.js': 3,
};

// (b) Vergleichs-/Entscheidungs-Stellen auf Reliability ausserhalb honesty.js.
//     schema.js: 1   — Boundary-Backstop (superRefine-Spiegel von honesty.js#
//                      assertEmissionGated; bewusst EIGENES Praedikat, s. honesty.js
//                      PRAEDIKAT-DISZIPLIN-Kommentar — REGEL-4-Bestand am Rand).
//     playwright.js: 1 — Produzenten-Warning im Trichter (=== 'approximate' fuer
//                      CSS_TRANSFORM_2D_FLOAT_DRIFT; klassifiziert nicht, warnt nur).
//     pipeline.js: 1 — __checkEk-Erwartungs-Vergleich ('bbox_reliability' als
//                      Key-Anker im Spec-Abgleich; liest, entscheidet nicht ueber
//                      Emission). Alles andere MUSS ueber die honesty.js-API laufen.
const PIN_DECISIONS = {
  'src/interface/schema.js': 1,
  'src/adapters/renderer/playwright.js': 1,
  'src/pipeline.js': 1,
};

// (c) Produktiv-Caller der honesty.js-API (Verdrahtungs-Topologie der Heilung):
//     pipeline.js#gateCorrections: 1 — DIE Pessimismus-Entscheidung am Emissions-
//                      Rand, EINMAL (E1/REGEL-8 fail-closed).
//     structured.js#countTruncation: 2 — ehrlicher Trunkierungs-Zaehler (scene-
//                      Emission, zwei Emissions-Pfade). Schwund hier = Gate abgeklemmt.
const PIN_API_CALLERS = {
  gateCorrections: { 'src/pipeline.js': 1 },
  countTruncation: { 'src/adapters/emitter/structured.js': 2 },
};

// W2: Einstiegs-Dateinamen ausserhalb archive/ (E1: INDEX.md = der eine Einstieg).
const ENTRY_NAME_RE = /^(START_HERE|HAND_OFF|PROJEKTMAPPE)/;

// ── Muster (Feld-/API-Anker, nie Wert-Literal allein) ────────────────────────
const ASSIGN_RES = [
  // direkte Zuweisung (auch Member-LValue); (?![=>]) schliesst ===/==/=> aus.
  // (?<!['"`]) schliesst Prosa-Treffer aus, in denen der Feld-Anker INNERHALB
  // eines String-/Template-Literals steht (z.B. schema.js-Fehlermeldung
  // `bbox_reliability='${reliability}' — …` — Meldung, keine Zuweisung).
  /(?<!['"`])bbox_reliability\s*=(?![=>])/,
  // Objekt-Property mit Reliability-Wert-Literal direkt (heute 0; faengt
  // kuenftige Inline-Produktion via Objekt-Literal)
  /bbox_reliability\s*:\s*['"](?:reliable|approximate|not_measurable)['"]/,
];
const DECISION_RES = [
  // Identifikator endend auf ...reliability im Vergleich mit String-Literal
  /[Rr]eliability\s*[!=]==?\s*['"]/,
  // Literal-first-Form ('reliable' === x) — Reliability-Werte als LHS
  /['"](?:reliable|approximate|not_measurable)['"]\s*[!=]==?/,
  // Feld-Anker als Entscheidungs-Key (z.B. __checkEk-Erwartungs-Abgleich)
  /['"]bbox_reliability['"]/,
];
const API_RES = {
  gateCorrections: /gateCorrections\s*\(/,
  countTruncation: /countTruncation\s*\(/,
};

// ── binaer-sicherer Walk + Kommentar-Filter (Witness-Methode) ────────────────
function walk(dir, acc = [], excludeDirs = new Set(['node_modules', 'archive', '.git'])) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (excludeDirs.has(e.name)) continue;
      walk(p, acc, excludeDirs);
    } else if (e.isFile()) {
      acc.push(p);
    }
  }
  return acc;
}

function readTextSafe(p) {
  const buf = readFileSync(p);
  if (buf.includes(0)) return null; // NUL-Byte => binaer => nie als Text scannen
  return buf.toString('utf8');
}

function isCommentLine(trimmed) {
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function relPosix(abs) {
  return relative(ROOT, abs).split('\\').join('/');
}

// ── W1-Messung: src/ scannen, je Kategorie Datei->Zaehler ────────────────────
const srcFiles = walk(join(ROOT, 'src')).filter((f) => /\.(js|mjs)$/.test(f));

const measured = {
  assignments: {}, // rel -> count
  decisions: {},
  api: { gateCorrections: {}, countTruncation: {} },
};
const hits = { assignments: [], decisions: [], api: [] }; // Diagnose (file:line code)

for (const abs of srcFiles) {
  const rel = relPosix(abs);
  if (rel === 'src/core/honesty.js') continue; // SSOT-Heimat: ausserhalb des Pins
  const txt = readTextSafe(abs);
  if (txt === null) continue;
  const lines = txt.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '' || isCommentLine(t)) continue;
    if (ASSIGN_RES.some((re) => re.test(lines[i]))) {
      measured.assignments[rel] = (measured.assignments[rel] || 0) + 1;
      hits.assignments.push(`${rel}:${i + 1}  ${t.slice(0, 120)}`);
    }
    if (DECISION_RES.some((re) => re.test(lines[i]))) {
      measured.decisions[rel] = (measured.decisions[rel] || 0) + 1;
      hits.decisions.push(`${rel}:${i + 1}  ${t.slice(0, 120)}`);
    }
    for (const [api, re] of Object.entries(API_RES)) {
      if (re.test(lines[i])) {
        measured.api[api][rel] = (measured.api[api][rel] || 0) + 1;
        hits.api.push(`${rel}:${i + 1}  [${api}] ${t.slice(0, 120)}`);
      }
    }
  }
}

// ── Bidirektionaler Pin-Abgleich ─────────────────────────────────────────────
const errors = [];

function comparePin(label, pin, got, growMsg) {
  for (const file of new Set([...Object.keys(pin), ...Object.keys(got)])) {
    const want = pin[file] || 0;
    const have = got[file] || 0;
    if (have > want) {
      errors.push(
        `✗ ${label}: ${growMsg(file)} (${file}: ${have} > Pin ${want})`,
      );
    } else if (have < want) {
      errors.push(
        `✗ ${label}: Pin-SCHWUND in ${file} — erwartet ${want}, gefunden ${have}. ` +
          `Stelle heimlich geheilt/verschoben? Allowlist pflegen (maintainer/spec decision), nie still.`,
      );
    }
  }
}

comparePin(
  'W1a Zuweisungen',
  PIN_ASSIGNMENTS,
  measured.assignments,
  (f) =>
    `Neue Inline-Reliability-Stelle in ${f} — gehoert nach honesty.js oder als REGEL-4-Bestand in den Pin (maintainer/spec decision)`,
);
comparePin(
  'W1b Vergleiche',
  PIN_DECISIONS,
  measured.decisions,
  (f) =>
    `Neue Inline-Reliability-Stelle in ${f} — gehoert nach honesty.js oder als REGEL-4-Bestand in den Pin (maintainer/spec decision)`,
);
for (const api of Object.keys(PIN_API_CALLERS)) {
  comparePin(
    `W1c Caller ${api}`,
    PIN_API_CALLERS[api],
    measured.api[api],
    (f) =>
      `Neuer/verlagerter honesty.js#${api}-Caller in ${f} — Verdrahtungs-Topologie geaendert; Pin nur per Spec-Entscheid erweitern`,
  );
}

// ── W2 Einstiegs-Wache: Datei-NAMEN ausserhalb archive/ ──────────────────────
const allFiles = walk(ROOT);
const entryHits = allFiles
  .map((abs) => relPosix(abs))
  .filter((rel) => ENTRY_NAME_RE.test(rel.split('/').pop()));
for (const rel of entryHits) {
  errors.push(
    `✗ W2 Einstiegs-Wache: ${rel} ausserhalb archive/ — INDEX.md ist der EINE Einstieg (E1). Nach archive/ verschieben.`,
  );
}

// ── Report ───────────────────────────────────────────────────────────────────
const sum = (m) => Object.values(m).reduce((a, b) => a + b, 0);
console.log('=== HONESTY-ANTIREGRESSION (DoD-8/E7b W1+W2) ===');
console.log(`Korpus: ${srcFiles.length} src-Dateien (honesty.js exkludiert), binaer-sicher, Kommentarzeilen exkludiert`);
console.log(`W1a Wert-Zuweisungen   : ${JSON.stringify(measured.assignments)}  | Pin ${JSON.stringify(PIN_ASSIGNMENTS)}`);
console.log(`W1b Vergleichs-Stellen : ${JSON.stringify(measured.decisions)}  | Pin ${JSON.stringify(PIN_DECISIONS)}`);
console.log(`W1c API-Caller         : ${JSON.stringify(measured.api)}  | Pin ${JSON.stringify(PIN_API_CALLERS)}`);
console.log(`W2  Einstiegs-Dateien  : ${entryHits.length} ausserhalb archive/ | Pin 0`);

if (errors.length > 0) {
  console.log('\nABWEICHUNGEN:');
  for (const e of errors) console.log(`  ${e}`);
  console.log('\nTreffer-Detail (Diagnose):');
  for (const h of [...hits.assignments, ...hits.decisions, ...hits.api]) console.log(`    ${h}`);
  console.log(
    `\nHONESTY-ANTIREGRESSION: ROT (${errors.length} Abweichung(en) — Pin bidirektional, Zuwachs UND Schwund blockieren)`,
  );
  process.exit(1);
}

console.log(
  `\nHONESTY-ANTIREGRESSION: GRUEN (W1a=${sum(measured.assignments)} W1b=${sum(measured.decisions)} W1c=${sum(measured.api.gateCorrections) + sum(measured.api.countTruncation)} W2=0 — alle Pins exakt)`,
);
process.exit(0);
