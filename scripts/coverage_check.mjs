#!/usr/bin/env node
/**
 * coverage_check.mjs — DoD-6 Coverage==1.0-Mechanismus (Abdeckung BERECHNET,
 * nicht behauptet). Spec: docs/internal/an internal spec.
 * Finishing-Runde R1–R5 (Codex-Schärfungen): der Wächter darf nicht selbst lügen.
 *
 * Nenner-SSOT: tests/coverage_nenner.yaml (5 Kategorien: signal | grenze |
 * werkzeug | reserviert | defensiv). Geprüft wird:
 *
 *   (→) jede kategorie:signal hat einen EXISTIERENDEN forcing_test, der das
 *       forcing_token (Default: der signal-String) ENTHÄLT — Umbenennungs-/
 *       Entleerungs-Drift wird rot (R2).
 *   (←) binär-sicherer Code-Vokabular-Scan über src/ — jedes im Code
 *       emittierbare Signal ∉ Nenner ⇒ ROT mit Klartext. Scan-Muster (R4):
 *       (a) Signal-Kanal-push: (warnings|reasons|markers).push(…) mit 1..n
 *           UPPER_SNAKE-String-Argumenten (Receiver-gefiltert — Daten-Pushes
 *           wie sanitize_loss-Payload/Diff-Typen sind KEIN Signal-Kanal, s. NOTE)
 *       (b) warnings-Array-Literale `warnings: ['X', …]` / `warnings = ['X']`
 *       (c) error-Code-ZEILEN: jede Zeile mit `error:` / `error =` liefert ALLE
 *           UPPER_SNAKE-Literale (deckt error:'X', .error='X', error="X" und
 *           Ternaries wie `e.measureTimeout ? 'MEASURE_TIMEOUT' : 'MEASURE_FAILED'`)
 *       (d) Frozen-Kataloge (REASON_CODES, USER_ERROR_CODES)
 *       (e) selbst-benannte Const-Literale (const X = 'X')
 *       (f) schema-Enum-Werte der Ehrlichkeits-Felder (paint_visible/
 *           bbox_reliability/canvas_validity/visual_bbox, Nicht-Default-Werte)
 *           + UPPER_SNAKE-Schema-Enums. Einwort-Verdikt-Zustands-Enums
 *           (PASS/FAIL/IMPROVING/…) sind keine Blindstellen-Signale →
 *           dokumentiert ausgeschlossen (Underscore-Filter).
 *   (W) KATEGORIE-WANDEL-WACHE (R3): werkzeug/defensiv/reserviert-Signale, die
 *       der Scan in einer Datei findet, die NICHT in der deklarierten `quelle`
 *       steht ⇒ ROT („Kategorie-Drift") — Datei-Granularität, Zeilen-Drift toleriert.
 *   (R) reserviert-Asserts: 0 Emissions-Stellen außerhalb des REASON_CODES-Katalogs.
 *
 * BINÄR-SICHERHEIT: Node readFileSync('utf8') (NUL-tolerant, D-029-Klasse kann
 * den Scan nicht stumm abbrechen); Kommentare string-bewusst gestrippt, Zeilen
 * erhalten (echte file:line im Klartext).
 *
 * SUMMARY-EHRLICHKEIT (R1): `COVERAGE: 1.0 (N/N)` erscheint NUR bei 0 Fehlern;
 * sonst `COVERAGE: ROT (N Fehler — Zahl erst nach Behebung)`.
 *
 * SCAN-GRENZE (R5, gespiegelt im Nenner-Header): der Scan deckt
 * Literal-Emissionen (Projekt-Konvention: UPPER_SNAKE-Literale auf den
 * Signal-Kanälen); dynamisch komponierte Codes/Alias-Indirektion deckt die
 * zweite Verteidigungslinie: Nenner-Pflege-Pflicht bei jedem neuen
 * REGISTER-Blindstellen-Eintrag.
 *
 * Test-Override (NUR für den ROT-Selbstbeweis, Beweis-Pflicht 1):
 *   COVERAGE_NENNER=<pfad>  alternative Nenner-Datei (z.B. manipulierte /tmp-Kopie).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const NENNER_PATH = process.env.COVERAGE_NENNER || join(ROOT, 'tests', 'coverage_nenner.yaml');

const KATEGORIEN = new Set(['signal', 'grenze', 'werkzeug', 'reserviert', 'defensiv']);
const errors = [];

// ── 1. Nenner parsen (strikter Mini-Parser für das dokumentierte Flach-Format) ─
function parseNenner(text) {
  const eintraege = [];
  let cur = null;
  let lineNo = 0;
  for (const raw of text.split('\n')) {
    lineNo++;
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const entryStart = line.match(/^  - signal:\s*(.+)$/);
    if (entryStart) {
      cur = { signal: entryStart[1].trim(), __line: lineNo };
      eintraege.push(cur);
      continue;
    }
    const kv = line.match(/^    ([a-z_]+):\s*(.+)$/);
    if (kv && cur) {
      let v = kv[2].trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      cur[kv[1]] = v;
      continue;
    }
    if (/^(version:|eintraege:)/.test(line.trim())) continue;
    errors.push(`NENNER-FORMAT: unparsebare Zeile ${lineNo}: ${JSON.stringify(line)}`);
  }
  return eintraege;
}

let nennerText;
try {
  nennerText = readFileSync(NENNER_PATH, 'utf8');
} catch (e) {
  console.error(`COVERAGE-FATAL: Nenner nicht lesbar (${NENNER_PATH}): ${e.message}`);
  console.log('COVERAGE: ROT (1 Fehler — Zahl erst nach Behebung)');
  process.exit(1);
}
const eintraege = parseNenner(nennerText);

// Schema-Pflichten je Kategorie (Spec Nenner-Schema).
for (const e of eintraege) {
  const where = `${e.signal} (Z.${e.__line})`;
  if (!e.achse || !e.quelle || !e.kategorie) errors.push(`NENNER-SCHEMA: ${where}: achse/quelle/kategorie PFLICHT`);
  if (!KATEGORIEN.has(e.kategorie)) errors.push(`NENNER-SCHEMA: ${where}: unbekannte kategorie '${e.kategorie}'`);
  if (e.kategorie === 'signal' && !e.forcing_test) errors.push(`NENNER-SCHEMA: ${where}: kategorie signal ⇒ forcing_test PFLICHT`);
  if (e.kategorie === 'grenze' && !e.doku_ref) errors.push(`NENNER-SCHEMA: ${where}: kategorie grenze ⇒ doku_ref PFLICHT`);
  if (e.kategorie === 'werkzeug' && !e.grund) errors.push(`NENNER-SCHEMA: ${where}: kategorie werkzeug ⇒ grund PFLICHT`);
  if (e.kategorie === 'defensiv' && (!e.code_witness || !e.grund)) errors.push(`NENNER-SCHEMA: ${where}: kategorie defensiv ⇒ code_witness+grund PFLICHT`);
  if (e.kategorie === 'reserviert' && !e.katalog) errors.push(`NENNER-SCHEMA: ${where}: kategorie reserviert ⇒ katalog PFLICHT`);
}
{
  const seen = new Set();
  for (const e of eintraege) {
    if (seen.has(e.signal)) errors.push(`NENNER-SCHEMA: Duplikat-Eintrag '${e.signal}'`);
    seen.add(e.signal);
  }
}

// ── 2. Richtung → (R2): forcing_test existiert UND enthält das forcing_token ──
// §HEAL-7/D (Codex Still-Loch) Root-Wache: das Gate discovert AUSSCHLIESSLICH
// tests/{unit,integration,e2e,audit} TOP-LEVEL (gate.mjs TEST_DIRS; die
// W5-Discovery-Ehrlichkeit hält die Wurzeln unterverzeichnisfrei). Ein
// forcing_test außerhalb dieser Wurzeln kann existieren UND das Token tragen —
// würde aber NIE gefahren: der Coverage-Beweis wäre Theater. Daher ROT VOR dem
// Existenz-/Token-Check.
const FORCING_ROOT_RX = /^tests\/(unit|integration|e2e|audit)\/[^/]+$/;
const signale = eintraege.filter((e) => e.kategorie === 'signal');
let gedeckt = 0;
for (const e of signale) {
  if (!e.forcing_test) continue; // Schema-Fehler oben bereits gemeldet
  if (!FORCING_ROOT_RX.test(e.forcing_test)) {
    errors.push(`RICHTUNG→ ROT: Signal '${e.signal}' forcing_test '${e.forcing_test}' liegt außerhalb der Gate-Wurzeln tests/{unit,integration,e2e,audit} (top-level) — Test würde nie gefahren; Test einordnen + Nenner pflegen`);
    continue;
  }
  const f = join(ROOT, e.forcing_test);
  if (!existsSync(f)) {
    errors.push(`RICHTUNG→ ROT: Signal '${e.signal}' ohne existierenden forcing_test (${e.forcing_test}) — Test bauen + Nenner pflegen`);
    continue;
  }
  const token = e.forcing_token || e.signal;
  const inhalt = readFileSync(f, 'utf8'); // binär-sicher (NUL-tolerant)
  if (!inhalt.includes(token)) {
    errors.push(`RICHTUNG→ ROT: forcing_test ${e.forcing_test} enthält Token '${token}' für Signal '${e.signal}' NICHT (Umbenennungs-/Entleerungs-Drift) — Test/Nenner pflegen`);
    continue;
  }
  gedeckt++;
}

// ── 3. Richtung ←: binär-sicherer Vokabular-Scan über src/ ────────────────────
function walk(dir) {
  let out = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) out = out.concat(walk(p));
    else if (/\.(js|mjs)$/.test(d.name)) out.push(p);
  }
  return out;
}

// String-bewusstes Kommentar-Strippen; Zeilen bleiben erhalten (echte file:line).
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let mode = null; // null | '\'' | '"' | '`' | '//' | '/*'
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (mode === null) {
      if (c === '/' && c2 === '/') { mode = '//'; i += 2; continue; }
      if (c === '/' && c2 === '*') { mode = '/*'; i += 2; continue; }
      if (c === "'" || c === '"' || c === '`') mode = c;
      out += c;
      i++;
      continue;
    }
    if (mode === '//') {
      if (c === '\n') { mode = null; out += c; }
      i++;
      continue;
    }
    if (mode === '/*') {
      if (c === '*' && c2 === '/') { mode = null; i += 2; continue; }
      if (c === '\n') out += c;
      i++;
      continue;
    }
    // in String-Literal
    if (c === '\\') { out += c + (c2 ?? ''); i += 2; continue; }
    if (c === mode) mode = null;
    out += c;
    i++;
  }
  return out;
}

const hasLetter = (s) => /[A-Z]/.test(s);
const UPPER_LIT_RX = /['"]([0-9A-Z][A-Z0-9_]{2,})['"]/g;
const vokabular = new Map(); // token -> [{fileRel, line}, …] ALLE Fundstellen (R3)

function addToken(token, file, line) {
  const fileRel = relative(ROOT, file);
  if (!vokabular.has(token)) vokabular.set(token, []);
  vokabular.get(token).push({ fileRel, line });
}

const srcFiles = walk(join(ROOT, 'src'));
const strippedByFile = new Map();
for (const f of srcFiles) {
  const stripped = stripComments(readFileSync(f, 'utf8')); // NUL-tolerant
  strippedByFile.set(f, stripped);
  const lines = stripped.split('\n');
  lines.forEach((ln, idx) => {
    let m;
    // (a) Signal-Kanal-push: 1..n UPPER-String-Args (auch digit-führend wie 3D_…)
    const rePush = /(?:warnings|reasons|markers)\s*\.push\(([^)]*)\)/g;
    while ((m = rePush.exec(ln))) {
      for (const lit of m[1].matchAll(UPPER_LIT_RX)) if (hasLetter(lit[1])) addToken(lit[1], f, idx + 1);
    }
    // (b) warnings-Array-Literale
    const reWArr = /warnings\s*[:=]\s*\[([^\]]*)\]/g;
    while ((m = reWArr.exec(ln))) {
      for (const lit of m[1].matchAll(UPPER_LIT_RX)) if (hasLetter(lit[1])) addToken(lit[1], f, idx + 1);
    }
    // (c) error-Code-Zeile: ALLE UPPER-Literale der Zeile (deckt :, =, ", Ternary)
    if (/\berror\s*[:=]/.test(ln)) {
      for (const lit of ln.matchAll(UPPER_LIT_RX)) if (hasLetter(lit[1])) addToken(lit[1], f, idx + 1);
    }
    // (e) selbst-benannte Const-Literale: const X = 'X'
    const reConst = /const\s+([0-9A-Z][A-Z0-9_]{2,})\s*=\s*['"]([0-9A-Z][A-Z0-9_]{2,})['"]/g;
    while ((m = reConst.exec(ln))) if (m[1] === m[2] && hasLetter(m[1])) addToken(m[1], f, idx + 1);
  });
}

// (d) Frozen-Kataloge: REASON_CODES (arbitrate.js) + USER_ERROR_CODES (breaker.js)
function extractFrozenList(file, anchorRx) {
  const txt = strippedByFile.get(file) || '';
  const m = txt.match(anchorRx);
  if (!m) return null;
  const upto = txt.slice(m.index);
  const close = upto.indexOf(']');
  if (close < 0) return null;
  const block = upto.slice(0, close);
  const lineBase = txt.slice(0, m.index).split('\n').length;
  const out = [];
  let mm;
  const re = /['"]([0-9A-Z][A-Z0-9_]{2,})['"]/g;
  while ((mm = re.exec(block))) {
    const line = lineBase + block.slice(0, mm.index).split('\n').length - 1;
    out.push({ token: mm[1], line });
  }
  return out;
}
const arbitrateFile = join(ROOT, 'src', 'core', 'arbitrate.js');
const breakerFile = join(ROOT, 'src', 'lib', 'breaker.js');
const reasonCodes = extractFrozenList(arbitrateFile, /REASON_CODES\s*=\s*Object\.freeze\(\[/);
if (!reasonCodes || reasonCodes.length === 0) errors.push('SCAN-FATAL: REASON_CODES-Katalog in arbitrate.js nicht extrahierbar');
else for (const r of reasonCodes) addToken(r.token, arbitrateFile, r.line);
const userErrCodes = extractFrozenList(breakerFile, /USER_ERROR_CODES\s*=\s*Object\.freeze\(\s*new Set\(\[/);
if (!userErrCodes || userErrCodes.length === 0) errors.push('SCAN-FATAL: USER_ERROR_CODES-Katalog in breaker.js nicht extrahierbar');
else for (const r of userErrCodes) addToken(r.token, breakerFile, r.line);

// (f) schema-Enum-Werte der Ehrlichkeits-Felder + UPPER_SNAKE-Schema-Enums
const schemaFile = join(ROOT, 'src', 'interface', 'schema.js');
const schemaTxt = strippedByFile.get(schemaFile) || '';
const HONESTY_FIELD_DEFAULTS = { canvas_validity: 'valid', bbox_reliability: 'reliable' };
{
  let m;
  const reFieldEnum = /([a-z_]+):\s*z[\s\S]{0,200}?\.enum\(\[([^\]]*)\]/g;
  while ((m = reFieldEnum.exec(schemaTxt))) {
    const field = m[1];
    if (!(field in HONESTY_FIELD_DEFAULTS)) continue;
    const line = schemaTxt.slice(0, m.index).split('\n').length;
    for (const vm of m[2].matchAll(/['"]([a-z_]+)['"]/g)) {
      if (vm[1] !== HONESTY_FIELD_DEFAULTS[field]) addToken(`${field}:${vm[1]}`, schemaFile, line);
    }
  }
  const pv = schemaTxt.match(/paint_visible:\s*z[\s\S]{0,200}?\.union\(\[([\s\S]{0,200}?)\]\)/);
  if (pv) {
    const line = schemaTxt.slice(0, pv.index).split('\n').length;
    if (/z\.literal\(false\)/.test(pv[1])) addToken('paint_visible:false', schemaFile, line);
    for (const lm of pv[1].matchAll(/z\.literal\(['"]([a-z_]+)['"]\)/g)) addToken(`paint_visible:${lm[1]}`, schemaFile, line);
  } else {
    errors.push('SCAN-FATAL: paint_visible-Union in schema.js nicht extrahierbar');
  }
  const vb = schemaTxt.match(/visual_bbox:\s*z[\s\S]{0,400}?z\.literal\(['"]([a-z_]+)['"]\)/);
  if (vb) {
    const line = schemaTxt.slice(0, vb.index).split('\n').length;
    addToken(`visual_bbox:${vb[1]}`, schemaFile, line);
  }
  const reEnum = /\.enum\(\[([^\]]*)\]/g;
  while ((m = reEnum.exec(schemaTxt))) {
    const line = schemaTxt.slice(0, m.index).split('\n').length;
    for (const vm of m[1].matchAll(/['"]([0-9A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)['"]/g)) addToken(vm[1], schemaFile, line);
  }
}

// Vergleich Scan vs Nenner: jedes gefundene Signal ∉ Nenner ⇒ ROT mit Klartext.
const nennerNamen = new Set(eintraege.map((e) => e.signal));
let unbekannt = 0;
for (const [token, sites] of vokabular) {
  if (!nennerNamen.has(token)) {
    unbekannt++;
    errors.push(`RICHTUNG← ROT: neues Signal '${token}' (${sites[0].fileRel}:${sites[0].line}) ∉ Nenner — tests/coverage_nenner.yaml pflegen + Forcing-Test benennen`);
  }
}

// ── 3b. KATEGORIE-WANDEL-WACHE (R3): werkzeug/defensiv/reserviert ortsfest ────
// Datei-Granularität: jede Scan-Fundstelle eines solchen Signals muss in einer
// der in `quelle` deklarierten src-Dateien liegen — sonst Kategorie-Drift-Alarm.
for (const e of eintraege) {
  if (!['werkzeug', 'defensiv', 'reserviert'].includes(e.kategorie)) continue;
  const erlaubt = new Set((String(e.quelle).match(/src\/[A-Za-z0-9_./-]+\.(?:js|mjs)/g)) || []);
  if (erlaubt.size === 0) {
    errors.push(`NENNER-SCHEMA: ${e.signal}: kategorie ${e.kategorie} ⇒ quelle muss >=1 src-Datei nennen (Kategorie-Wandel-Wache braucht den Anker)`);
    continue;
  }
  for (const s of vokabular.get(e.signal) || []) {
    if (!erlaubt.has(s.fileRel)) {
      errors.push(`KATEGORIE-DRIFT ROT: '${e.signal}' (${e.kategorie}) emittiert in ${s.fileRel}:${s.line}, deklariert war ${[...erlaubt].join(' + ')} — Nenner pflegen (ggf. Kategorie auf signal heben + Forcing-Test)`);
    }
  }
}

// ── 4. reserviert-Asserts: 0 Emissions-Stellen außerhalb des Katalogs ─────────
const reserviert = eintraege.filter((e) => e.kategorie === 'reserviert');
const reasonCatalogTokens = new Map((reasonCodes || []).map((r) => [r.token, r.line]));
for (const e of reserviert) {
  const emissionen = [];
  for (const f of srcFiles) {
    const lines = (strippedByFile.get(f) || '').split('\n');
    lines.forEach((ln, idx) => {
      if (!ln.includes(`'${e.signal}'`) && !ln.includes(`"${e.signal}"`)) return;
      // Deklarations-Stelle im REASON_CODES-Katalog ist KEINE Emission.
      if (f === arbitrateFile && reasonCatalogTokens.get(e.signal) === idx + 1) return;
      emissionen.push(`${relative(ROOT, f)}:${idx + 1}`);
    });
  }
  if (emissionen.length > 0) {
    errors.push(`RESERVIERT ROT: '${e.signal}' wurde emittierbar ohne Nenner-Pflege (${emissionen.join(', ')}) — Kategorie auf signal heben + Forcing-Test bauen`);
  }
}

// ── 5. Report + Summary (R1: die 1.0 erscheint NUR bei 0 Fehlern) ─────────────
const counts = {};
for (const e of eintraege) counts[e.kategorie] = (counts[e.kategorie] || 0) + 1;
console.log(`[coverage] Nenner: ${eintraege.length} Einträge (${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' · ')}) aus ${relative(ROOT, NENNER_PATH)}`);
console.log(`[coverage] Scan: ${srcFiles.length} Dateien src/*.{js,mjs} (binär-sicher, kommentar-gestrippt)`);
console.log(`[coverage] Richtung →: ${gedeckt}/${signale.length} Signal-Klassen mit existierendem, token-haltigem Forcing-Test`);
console.log(`[coverage] Richtung ←: ${vokabular.size} gescannte Vokabeln, ${unbekannt} ∉ Nenner`);
console.log(`[coverage] Wache: Kategorie-Wandel (werkzeug/defensiv/reserviert ortsfest) ${errors.some((x) => x.startsWith('KATEGORIE-DRIFT')) ? 'ROT' : 'OK'} · reserviert-Emissionen ${errors.some((x) => x.startsWith('RESERVIERT')) ? 'ROT' : 'OK'}`);
console.log('[coverage] NOTE: Scan deckt Literal-Emissionen (Projekt-Konvention: Signale werden als UPPER_SNAKE-Literal emittiert); dynamisch komponierte Codes/Alias-Indirektion deckt die zweite Verteidigungslinie: Nenner-Pflege-Pflicht bei jedem neuen REGISTER-Blindstellen-Eintrag.');

for (const err of errors) console.log(`  ✗ ${err}`);

if (errors.length === 0 && gedeckt === signale.length && signale.length > 0) {
  console.log(`COVERAGE: 1.0 (${gedeckt}/${signale.length})`);
  console.log('[coverage] GRUEN — Abdeckung berechnet: 1.0, beide Richtungen + Wachen geschlossen.');
  process.exit(0);
} else {
  console.log(`COVERAGE: ROT (${errors.length || 1} Fehler — Zahl erst nach Behebung)`);
  console.log('[coverage] ROT — siehe Klartext-Zeilen oben.');
  process.exit(1);
}
