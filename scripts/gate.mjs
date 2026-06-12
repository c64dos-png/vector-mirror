#!/usr/bin/env node
/**
 * gate.mjs — DoD-8 Test-/Honesty-Regressions-Gate (Aggregator-Runner, §G-KORR)
 *
 * SSOT fuer den vollen Wahrheits-Lauf. Faehrt ALLE tests/{unit,integration,e2e,audit}
 * + Doku-Budget-Report in EINEM Befehl. Verdikt-Kern (adjudiziert, 3-Modell-Triple):
 *
 *   PASS  <=>  (Exit == erwartet) ^ (Erfolgs-Signatur PRAESENT) ^ (keine Fehler-Signatur)
 *
 * Positiv-Beweis statt Absenz: eine Suite gilt NUR als gruen, wenn ihr klassen-
 * spezifisches Erfolgs-Muster TATSAECHLICH im stdout steht (faengt Crash-vor-Zaehler,
 * Empty/Silent-Pass). Nie OR, nie exit-only-ohne-Positiv-Beweis (Ausnahme: 2 explizit
 * als class:exit-only markierte Suiten mit verifiziert-zuverlaessigem process.exit).
 *
 * VERDIKT-KLASSEN (K1):
 *   german-summary (Default): /Ergebnis: \d+ bestanden, 0 fehlgeschlagen/ PRAESENT + exit 0
 *   selftest:                 /Kalibrierung: PASS/ PRAESENT + exit 0
 *   calibration:              /Results: \d+ passed, 0 failed/ PRAESENT + exit 0
 *   exit-only:                exit 0 (process.exit verifiziert zuverlaessig)
 * knownRed (K2):              verankerte Signatur + exakter Exit + exakte Fail-Label,
 *                             bidirektional (heilt ODER waechst -> FAIL).
 *
 * K3 HARD-TIMEOUT + Child-Kill pro Suite -> Timeout = FAIL (Hang nie gruen).
 * K4 TIER: --tier=full (Default) = EINZIGER DoD-8-Verdikt-Lauf. --tier=fast = Smoke.
 *          Flakiness (browser, capacity:1) -> Shutdown-Wait + <=1 Retry NUR fuer
 *          flaky-markierte, NIE fuer knownRed/normale.
 * K5 Doku-Budget: scripts/doc_budget.mjs BLOCKIEREND (seit E7b W3: MODE hard).
 *
 * Run:   node scripts/gate.mjs            (full, Default)
 *        node scripts/gate.mjs --tier=fast
 *        node scripts/gate.mjs --json
 *
 * Test-Override (NUR fuer den E4-Selbstbeweis; nicht im Normalbetrieb):
 *   GATE_INCLUDE_GLOB / GATE_BASELINE / GATE_EXTRA_FILE  (siehe unten).
 *
 * CI-TRIGGER (VERTAGT — kein git-Remote): sobald `git remote -v` etwas zeigt, eine
 *   .github/workflows/gate.yml mit:
 *     npm ci && npx playwright install --with-deps && npm test
 *   ruft EXAKT diesen Runner (eine Wahrheit, kein Duplikat).
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── CLI ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const tierArg = (argv.find((a) => a.startsWith('--tier=')) || '--tier=full').split('=')[1];
const TIER = tierArg === 'fast' ? 'fast' : 'full';
const JSON_OUT = argv.includes('--json');

// ── Timeouts (ms) pro Klasse (K3) ────────────────────────────────────────────
const TIMEOUTS = {
  unit: 60_000,
  audit: 120_000,
  'integration-browser': 120_000,
  determinism: 180_000,
  e2e: 90_000,
  'report-only': 60_000,
};
const DEFAULT_TIMEOUT = 90_000;

// ── Baseline laden (K2). Override via GATE_BASELINE fuer E4-Selbstbeweis. ─────
const BASELINE_PATH = process.env.GATE_BASELINE || join(ROOT, 'tests', 'baseline.json');
let baseline = { knownRed: {}, specialLaunch: {} };
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
} catch (e) {
  console.error(`[gate] FATAL: baseline nicht lesbar (${BASELINE_PATH}): ${e.message}`);
  process.exit(2);
}
const knownRed = baseline.knownRed || {};
const specialLaunch = baseline.specialLaunch || {};

// ── Suiten-Discovery ─────────────────────────────────────────────────────────
function listFiles(dir, exts) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && exts.some((e) => d.name.endsWith(e)))
    .map((d) => join(dir, d.name))
    .sort();
}

const TEST_DIRS = {
  unit: { dir: join(ROOT, 'tests', 'unit'), exts: ['.js'] },
  integration: { dir: join(ROOT, 'tests', 'integration'), exts: ['.mjs'] },
  e2e: { dir: join(ROOT, 'tests', 'e2e'), exts: ['.mjs'] },
  audit: { dir: join(ROOT, 'tests', 'audit'), exts: ['.mjs'] },
};

// Klassen-/Flag-Zuordnung per Datei-Basename (relative POSIX-Pfade).
function relPosix(abs) {
  return relative(ROOT, abs).split('\\').join('/');
}

// ── DoD-8/E7b W5 Discovery-Ehrlichkeit: 0 Unterverzeichnisse in den Test-
// Wurzeln. listFiles() ist bewusst NICHT-rekursiv — ein Unterverzeichnis
// hiesse: Suiten dort blieben STILL ungefahren (latente Uebersprung-Luecke,
// Spec an internal spec Bau-Teil 4). Harter Stop VOR dem Lauf (billig), damit
// ein gruenes Verdikt nie auf unvollstaendiger Discovery beruht.
{
  const subdirs = Object.values(TEST_DIRS).flatMap(({ dir }) =>
    existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => relPosix(join(dir, d.name)))
      : [],
  );
  if (subdirs.length > 0) {
    console.error(
      `[gate] FATAL (W5 Discovery-Ehrlichkeit): Unterverzeichnis(se) in Test-Wurzeln: ${subdirs.join(', ')} — ` +
        `Discovery ist nicht-rekursiv; Suiten dort wuerden STILL uebersprungen. Flach in tests/{unit,integration,e2e,audit} einordnen (oder Discovery bewusst erweitern).`,
    );
    process.exit(1);
  }
}

// Suiten, die als class:exit-only gelten (zuverlaessiges process.exit, KEINE
// german-summary-Zeile). VERIFIZIERT: beide rufen process.exit(fails?1:0).
const EXIT_ONLY = new Set([
  'tests/integration/test_breaker_recovery.mjs',
  'tests/audit/gemini_red_audit_reproducers.mjs',
]);

// Flaky-markiert (browser, capacity:1): genau diese duerfen <=1 Retry.
const FLAKY = new Set(['tests/integration/test_breaker_recovery.mjs']);

// Browser-schwere Suiten (seriell, nie parallel; Determinismus zuletzt).
const BROWSER_HEAVY = new Set([
  'tests/integration/test_determinism.mjs',
  'tests/integration/test_sanitizer_d1.mjs',
  'tests/unit/test_use_graph.js',
  'tests/integration/test_breaker_recovery.mjs',
  'tests/integration/test_heal3b_usecolor.mjs',
  'tests/integration/test_heal_r6_invisibility.mjs',
  'tests/integration/test_heal_r6_state_dependent.mjs',
  'tests/e2e/test_mcp_roundtrip.mjs',
  'tests/integration/test_frozen_clock_d2.mjs',
  'tests/integration/test_heal4_paint.mjs',
  'tests/integration/test_media_static_parity.mjs',
]);

function classify(rel) {
  if (rel === 'tests/audit/selftest.mjs') return 'selftest';
  if (rel === 'tests/audit/red_audit_calibration.mjs') return 'calibration';
  if (rel === 'tests/integration/test_determinism.mjs') return 'determinism';
  if (knownRed[rel]) return 'knownRed';
  if (specialLaunch[rel]?.class === 'report-only') return 'report-only';
  if (EXIT_ONLY.has(rel)) return 'exit-only';
  if (rel.startsWith('tests/unit/')) return 'unit';
  if (rel.startsWith('tests/e2e/')) return 'e2e';
  if (BROWSER_HEAVY.has(rel)) return 'integration-browser';
  if (rel.startsWith('tests/integration/')) return 'integration-browser';
  if (rel.startsWith('tests/audit/')) return 'unit'; // pure audit -> german-summary
  return 'unit';
}

// Erfolgs-Signatur (Positiv-Muster) je Verdikt-Klasse.
function successPattern(klass) {
  switch (klass) {
    case 'selftest':
      return /Kalibrierung: PASS/;
    case 'calibration':
      return /Results: \d+ passed, 0 failed/;
    case 'determinism':
    case 'unit':
    case 'e2e':
    case 'integration-browser':
      return /Ergebnis: \d+ bestanden, 0 fehlgeschlagen/;
    default:
      return null; // exit-only: kein Positiv-Muster verlangt
  }
}

// Fehler-Signaturen (duerfen NICHT praesent sein in einer gruenen Suite).
function failureMatch(stdout, klass) {
  // Wachsendes Rot in german-summary (>=1 fehlgeschlagen).
  if (/Ergebnis: \d+ bestanden, [1-9]\d* fehlgeschlagen/.test(stdout)) return 'german-fail-count';
  if (/Results: \d+ passed, [1-9]\d* failed/.test(stdout)) return 'results-fail-count';
  if (/Kalibrierung: FAIL/.test(stdout)) return 'selftest-fail';
  // Empty/Silent-Pass: "0 bestanden, 0 fehlgeschlagen" ist KEIN Erfolg (kein echter Lauf).
  if (/Ergebnis: 0 bestanden, 0 fehlgeschlagen/.test(stdout)) return 'empty-pass';
  if (/Results: 0 passed, 0 failed/.test(stdout)) return 'empty-pass';
  return null;
}

// ── Suite-Ausfuehrung mit Hard-Timeout + Child-Kill (K3) ─────────────────────
function runSuite(absFile, rel, klass, timeoutMs) {
  const special = specialLaunch[rel];
  const nodeArgs = special?.nodeArgs ? [...special.nodeArgs] : [];
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('node', [...nodeArgs, absFile], {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let killedByTimeout = false;
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (out += d.toString()));

    const timer = setTimeout(() => {
      killedByTimeout = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }, timeoutMs);

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        exit: code,
        signal,
        stdout: out,
        ms: Date.now() - started,
        timedOut: killedByTimeout,
        timeoutMs,
      });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        exit: null,
        signal: null,
        stdout: out + '\n[spawn-error] ' + err.message,
        ms: Date.now() - started,
        timedOut: false,
        spawnError: true,
      });
    });
  });
}

// ── Verdikt-Adapter (das Herz: Positiv-Beweis) ───────────────────────────────
function verdict(rel, klass, run) {
  // K3: Timeout/Hang -> immer FAIL.
  if (run.timedOut) return { status: 'FAIL', reason: `TIMEOUT (>${((run.timeoutMs || TIMEOUTS[klass] || DEFAULT_TIMEOUT) / 1000).toFixed(0)}s, Child gekillt)` };
  if (run.spawnError) return { status: 'FAIL', reason: 'spawn-error' };

  // K2: knownRed — bidirektional verankert.
  if (klass === 'knownRed') {
    const spec = knownRed[rel];
    const sigPresent = run.stdout.includes(spec.expectStdoutContains);
    const exitOk = run.exit === spec.expectExit;
    const labelOk = !spec.expectFailLabelContains || run.stdout.includes(spec.expectFailLabelContains);
    // Zaehle echte Fail-Marken: NUR Zeilen, die mit "  ✗ " beginnen (check()-Format).
    // Ein ✗ irgendwo IN einer Detail-/Prose-Zeile (z.B. prose-snippet) zaehlt NICHT.
    const failMarks = (run.stdout.match(/^\s*✗\s/gm) || []).length;
    const marksOk = spec.maxFailMarks == null || failMarks <= spec.maxFailMarks;
    if (exitOk && sigPresent && labelOk && marksOk) {
      return { status: 'BASELINE-RED', reason: `erwartetes Rot exakt (exit ${run.exit}, ${failMarks} ✗, Signatur+Label gepinnt)` };
    }
    // Heimlich geheilt ODER gewachsen -> FAIL (Baseline-Update noetig).
    let why = [];
    if (!exitOk) why.push(`exit ${run.exit}!=${spec.expectExit}`);
    if (!sigPresent) why.push('Signatur fehlt (heimlich geheilt?)');
    if (!labelOk) why.push('Fail-Label weicht ab');
    if (!marksOk) why.push(`Rot gewachsen (${failMarks} ✗ > ${spec.maxFailMarks})`);
    return { status: 'FAIL', reason: `BASELINE-DRIFT: ${why.join(', ')} — Allowlist pflegen` };
  }

  // report-only: nie exit-bestimmend; nur Bericht.
  if (klass === 'report-only') {
    const ok = run.exit === 0 && /Ergebnis: \d+ bestanden, 0 fehlgeschlagen/.test(run.stdout);
    return { status: 'REPORT', reason: ok ? 'ok (informativ)' : `informativ (exit ${run.exit}${run.exit === 2 ? ', braucht --expose-gc' : ''})` };
  }

  // Fehler-Signatur darf NICHT praesent sein (Positiv-Beweis-Komplement).
  const failSig = failureMatch(run.stdout, klass);
  if (failSig) return { status: 'FAIL', reason: `Fehler-Signatur praesent: ${failSig}` };

  // exit-only: exit 0 + keine Fehler-Signatur (Positiv-Muster nicht verlangt).
  if (klass === 'exit-only') {
    if (run.exit === 0) return { status: 'PASS', reason: 'exit 0 (class:exit-only, zuverlaessiger process.exit)' };
    return { status: 'FAIL', reason: `exit ${run.exit} (erwartet 0)` };
  }

  // Alle anderen: Exit 0 ^ Erfolgs-Signatur PRAESENT.
  const pat = successPattern(klass);
  if (run.exit !== 0) return { status: 'FAIL', reason: `exit ${run.exit} (erwartet 0)` };
  if (pat && !pat.test(run.stdout)) {
    return { status: 'FAIL', reason: `Erfolgs-Signatur FEHLT (${pat}) — Crash-vor-Zaehler/Silent-Pass?` };
  }
  return { status: 'PASS', reason: `exit 0 + Erfolgs-Signatur praesent` };
}

// ── Discovery + Tier-Filter ──────────────────────────────────────────────────
let allFiles = [
  ...listFiles(TEST_DIRS.unit.dir, TEST_DIRS.unit.exts),
  ...listFiles(TEST_DIRS.integration.dir, TEST_DIRS.integration.exts),
  ...listFiles(TEST_DIRS.e2e.dir, TEST_DIRS.e2e.exts),
  ...listFiles(TEST_DIRS.audit.dir, TEST_DIRS.audit.exts),
];

// E4-Selbstbeweis: zusaetzliche Datei einschleusen (z.B. mutierte /tmp-Kopie).
if (process.env.GATE_EXTRA_FILE) allFiles.push(process.env.GATE_EXTRA_FILE);
// E4-Selbstbeweis: Discovery auf eine Teilmenge einschraenken (Substring-Filter).
if (process.env.GATE_INCLUDE_GLOB) {
  const needle = process.env.GATE_INCLUDE_GLOB;
  allFiles = allFiles.filter((f) => relPosix(f).includes(needle) || f.includes(needle));
}

// Reihenfolge: leichte zuerst, browser-schwere danach, Determinismus ZULETZT (K4).
function orderKey(rel) {
  if (rel.endsWith('test_determinism.mjs')) return 3;
  if (BROWSER_HEAVY.has(rel)) return 2;
  if (rel.startsWith('tests/integration/') || rel.startsWith('tests/e2e/')) return 1;
  return 0;
}

const suites = allFiles
  .map((abs) => {
    const rel = process.env.GATE_EXTRA_FILE === abs ? abs : relPosix(abs);
    const klass = classify(rel);
    return { abs, rel, klass };
  })
  .filter((s) => {
    if (TIER === 'full') return true;
    // fast/smoke: nur pure unit (.js unter tests/unit) + selftest — kein browser-determinism.
    return s.rel.startsWith('tests/unit/') && !BROWSER_HEAVY.has(s.rel) && s.klass === 'unit';
  })
  .sort((a, b) => orderKey(a.rel) - orderKey(b.rel) || a.rel.localeCompare(b.rel));

// ── Lauf ─────────────────────────────────────────────────────────────────────
const cooldown = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`\n=== DoD-8 GATE — tier=${TIER} | ${suites.length} Suiten | baseline=${relPosix(BASELINE_PATH)} ===\n`);

const results = [];
const wallStart = Date.now();

// GATE_TIMEOUT_MS: optionaler globaler Per-Suite-Timeout-Override (Tuning + E4-Hang-Probe).
const TIMEOUT_OVERRIDE = process.env.GATE_TIMEOUT_MS ? Number(process.env.GATE_TIMEOUT_MS) : null;

for (const s of suites) {
  const timeoutMs = TIMEOUT_OVERRIDE || TIMEOUTS[s.klass] || DEFAULT_TIMEOUT;
  const maxAttempts = FLAKY.has(s.rel) ? 2 : 1; // K4: <=1 Retry NUR flaky-markiert.
  let run;
  let v;
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt++;
    run = await runSuite(s.abs, s.rel, s.klass, timeoutMs);
    v = verdict(s.rel, s.klass, run);
    if (v.status !== 'FAIL' || attempt >= maxAttempts) break;
    // Flaky-Retry: Browser-Shutdown-Cooldown vor dem 2. Versuch.
    await cooldown(1500);
  }
  // Cooldown nach browser-schweren Suiten (capacity:1 Entlastung).
  if (BROWSER_HEAVY.has(s.rel)) await cooldown(500);

  results.push({ ...s, ...v, ms: run.ms, exit: run.exit, attempts: attempt });
  const tag =
    v.status === 'PASS' ? 'PASS' : v.status === 'BASELINE-RED' ? 'BASELINE-RED' : v.status === 'REPORT' ? 'REPORT' : 'FAIL';
  const retryNote = attempt > 1 ? ` [retry x${attempt}]` : '';
  console.log(`  [${tag.padEnd(12)}] ${s.rel}  (${(run.ms / 1000).toFixed(1)}s, ${s.klass})${retryNote}`);
  if (v.status === 'FAIL') console.log(`      -> ${v.reason}`);
  else if (v.status === 'BASELINE-RED') console.log(`      -> ${v.reason}`);
}

const wallMs = Date.now() - wallStart;

// ── DoD-6 Coverage-Check (BLOCKIEREND): Abdeckung BERECHNET, nicht behauptet ──
// scripts/coverage_check.mjs prüft beide Richtungen gegen tests/coverage_nenner.yaml
// (Spec docs/internal/an internal spec). Fließt als regulärer Result-Eintrag
// in counts/blockingFails ein (Muster bestehender Einträge); Summary-Zeile unten.
let coverageLine = '';
{
  const run = await new Promise((resolve) => {
    const c = spawn('node', [join(ROOT, 'scripts', 'coverage_check.mjs')], { cwd: ROOT, env: process.env });
    let o = '';
    c.stdout.on('data', (d) => (o += d.toString()));
    c.stderr.on('data', (d) => (o += d.toString()));
    c.on('close', (code) => resolve({ exit: code, stdout: o }));
    c.on('error', (err) => resolve({ exit: null, stdout: '[spawn-error] ' + err.message }));
  });
  const m = run.stdout.match(/COVERAGE: [^\n]+/);
  coverageLine = m ? m[0] : 'COVERAGE: nicht ermittelbar (Check-Crash?)';
  const ok = run.exit === 0 && /COVERAGE: 1\.0 /.test(run.stdout);
  const rotZeilen = run.stdout.split('\n').filter((l) => l.includes('✗')).slice(0, 6);
  results.push({
    rel: 'scripts/coverage_check.mjs',
    klass: 'coverage',
    status: ok ? 'PASS' : 'FAIL',
    reason: ok ? `${coverageLine} — beide Richtungen + reserviert geschlossen` : `Coverage-Gate rot (exit ${run.exit}): ${rotZeilen.join(' | ') || coverageLine}`,
    ms: 0,
    exit: run.exit,
    attempts: 1,
  });
  console.log(`  [${(ok ? 'PASS' : 'FAIL').padEnd(12)}] scripts/coverage_check.mjs  (${coverageLine}, coverage)`);
  if (!ok) for (const z of rotZeilen) console.log(`      -> ${z.trim()}`);
}

// ── DoD-8/E7b W1+W2: Honesty-Antiregressions-Wache (BLOCKIEREND) ─────────────
// scripts/honesty_antiregression_check.mjs pinnt die geheilte Reliability-
// Topologie bidirektional (Zuwachs UND Schwund = ROT) + Einstiegs-Datei-Namen
// ausserhalb archive/ == 0. Spec: docs/internal/an internal spec Bau-Teil 1.
// Positiv-Beweis: exit 0 ^ GRUEN-Signatur PRAESENT (nie exit-only).
{
  const rel = 'scripts/honesty_antiregression_check.mjs';
  const run = await runSuite(join(ROOT, 'scripts', 'honesty_antiregression_check.mjs'), rel, 'guard', 30_000);
  const ok = !run.timedOut && run.exit === 0 && /HONESTY-ANTIREGRESSION: GRUEN/.test(run.stdout);
  const rotZeilen = run.stdout.split('\n').filter((l) => l.includes('✗')).slice(0, 6);
  results.push({
    rel,
    klass: 'guard',
    status: ok ? 'PASS' : 'FAIL',
    reason: ok
      ? 'alle Pins exakt (W1a/W1b/W1c Reliability-Topologie, W2 Einstiegs-Wache)'
      : `Antiregressions-Wache rot (exit ${run.exit}${run.timedOut ? ', TIMEOUT' : ''}): ${rotZeilen.join(' | ') || 'GRUEN-Signatur fehlt'}`,
    ms: run.ms,
    exit: run.exit,
    attempts: 1,
  });
  console.log(`  [${(ok ? 'PASS' : 'FAIL').padEnd(12)}] ${rel}  (${(run.ms / 1000).toFixed(1)}s, guard)`);
  if (!ok) for (const z of rotZeilen) console.log(`      -> ${z.trim()}`);
}

// ── DoD-8/E7b W4 (D-026 geschlossen): Sample-Korpus-Schema-Validierung ───────
// tests/fixtures/samples/_validate.mjs validiert den re-capturten 11er-Korpus
// (ajv + tools/list-Schema-Dump via mcp-inspector) — BLOCKIEREND, nur tier=full
// (spawnt npx-Subprozess; fast bleibt Smoke). Positiv-Beweis: exit 0 ^
// /ajv: \d+ pass, 0 fail/ PRAESENT (Empty-Pass durch leeren Korpus unmoeglich:
// '0 pass, 0 fail' wuerde matchen — deshalb zusaetzlich pass>=1 verlangt).
if (TIER === 'full') {
  const rel = 'tests/fixtures/samples/_validate.mjs';
  const run = await runSuite(join(ROOT, 'tests', 'fixtures', 'samples', '_validate.mjs'), rel, 'guard', 180_000);
  const m = run.stdout.match(/ajv: (\d+) pass, (\d+) fail/);
  const ok = !run.timedOut && run.exit === 0 && m !== null && Number(m[1]) >= 1 && Number(m[2]) === 0;
  const failZeilen = run.stdout.split('\n').filter((l) => l.includes('FAIL:')).slice(0, 6);
  results.push({
    rel,
    klass: 'guard',
    status: ok ? 'PASS' : 'FAIL',
    reason: ok
      ? `ajv: ${m[1]} pass, 0 fail (Korpus-Schema-Vertrag)`
      : `Korpus-Validierung rot (exit ${run.exit}${run.timedOut ? ', TIMEOUT' : ''}): ${failZeilen.join(' | ') || (m ? m[0] : 'ajv-Summary fehlt')}`,
    ms: run.ms,
    exit: run.exit,
    attempts: 1,
  });
  console.log(`  [${(ok ? 'PASS' : 'FAIL').padEnd(12)}] ${rel}  (${(run.ms / 1000).toFixed(1)}s, guard)`);
  if (!ok) for (const z of failZeilen) console.log(`      -> ${z.trim()}`);
}

// ── RELAIS §4 Pkt 4: Claims-Selftest-Wache (BLOCKIEREND, nur tier=full) ──────
// tests/relais_red/selftest_claims.mjs pinnt Beschreibung↔System-Kongruenz
// (S1 Wortidentitaet, S1b Vollstring-Pin 9/9, S2 Deckung==1.0, S3 Proben gegen
// das lebende System; Spec docs/internal/an internal spec §2+§4 Pkt 4). Spawnt
// MCP-/Browser-Proben (Pool=3, Eigen-Budget 120s) — full only, wie W4.
// Positiv-Beweis: exit 0 ^ /CLAIMS-SELFTEST: GRUEN/ PRAESENT (nie exit-only).
if (TIER === 'full') {
  const rel = 'tests/relais_red/selftest_claims.mjs';
  const run = await runSuite(join(ROOT, 'tests', 'relais_red', 'selftest_claims.mjs'), rel, 'guard', 150_000);
  const ok = !run.timedOut && run.exit === 0 && /CLAIMS-SELFTEST: GRUEN/.test(run.stdout);
  const rotZeilen = run.stdout.split('\n').filter((l) => l.startsWith('FAIL ')).slice(0, 6);
  results.push({
    rel,
    klass: 'guard',
    status: ok ? 'PASS' : 'FAIL',
    reason: ok
      ? 'Behauptungs-Deckung == Verifikations-Deckung (S1/S1b/S2/S3 gruen)'
      : `Claims-Selftest rot (exit ${run.exit}${run.timedOut ? ', TIMEOUT' : ''}): ${rotZeilen.join(' | ') || 'GRUEN-Signatur fehlt'}`,
    ms: run.ms,
    exit: run.exit,
    attempts: 1,
  });
  console.log(`  [${(ok ? 'PASS' : 'FAIL').padEnd(12)}] ${rel}  (${(run.ms / 1000).toFixed(1)}s, guard)`);
  if (!ok) for (const z of rotZeilen) console.log(`      -> ${z.trim()}`);
}

// ── Doku-Budget (K5 — seit DoD-8/E7b W3 BLOCKIEREND: doc_budget MODE_DEFAULT
//    'hard', Exit 1 bei live-MD:src > Cap 8.0; Spec an internal spec Bau-Teil 2) ──
let docBudgetLine = '';
if (TIER === 'full') {
  const run = await new Promise((resolve) => {
    const dc = spawn('node', [join(ROOT, 'scripts', 'doc_budget.mjs')], { cwd: ROOT });
    let o = '';
    dc.stdout.on('data', (d) => (o += d.toString()));
    dc.stderr.on('data', (d) => (o += d.toString()));
    dc.on('close', (code) => resolve({ exit: code, stdout: o }));
    dc.on('error', (err) => resolve({ exit: null, stdout: '[spawn-error] ' + err.message }));
  });
  const m = run.stdout.match(/live-MD:src = [^\n]+/);
  docBudgetLine = m ? m[0] : run.stdout.trim().split('\n').pop();
  const ok = run.exit === 0 && /\[OK\] live-MD:src/.test(run.stdout);
  results.push({
    rel: 'scripts/doc_budget.mjs',
    klass: 'doc-budget',
    status: ok ? 'PASS' : 'FAIL',
    reason: ok ? `${docBudgetLine} <= Cap (hard)` : `Doku-Budget rot (exit ${run.exit}): ${docBudgetLine}`,
    ms: 0,
    exit: run.exit,
    attempts: 1,
  });
  console.log(`  [${(ok ? 'PASS' : 'FAIL').padEnd(12)}] scripts/doc_budget.mjs  (${docBudgetLine}, doc-budget)`);
}

// ── Aggregat-Report ──────────────────────────────────────────────────────────
const counts = { PASS: 0, FAIL: 0, 'BASELINE-RED': 0, REPORT: 0 };
for (const r of results) counts[r.status]++;
const blockingFails = results.filter((r) => r.status === 'FAIL');

console.log('\n--- ZUSAMMENFASSUNG ---');
console.log(
  `PASS=${counts.PASS}  BASELINE-RED=${counts['BASELINE-RED']}  REPORT=${counts.REPORT}  FAIL=${counts.FAIL}`,
);
if (coverageLine) console.log(coverageLine);
if (docBudgetLine) console.log(`DOC-BUDGET: ${docBudgetLine}`);
console.log(`Gesamt-Wall-Clock: ${(wallMs / 1000).toFixed(1)}s`);

if (blockingFails.length > 0) {
  console.log('\nFAILS:');
  for (const r of blockingFails) console.log(`  ✗ ${r.rel} — ${r.reason}`);
}

const gateGreen = counts.FAIL === 0;
console.log(
  `\n=== GATE ${gateGreen ? 'GRUEN' : 'ROT'} === (Exit ${gateGreen ? 0 : 1}; gruen nur wenn alle blockierenden PASS oder exakt-BASELINE-RED)\n`,
);

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      { tier: TIER, green: gateGreen, counts, wallMs, docBudget: docBudgetLine, results: results.map(({ abs, ...r }) => r) },
      null,
      2,
    ),
  );
}

process.exit(gateGreen ? 0 : 1);
