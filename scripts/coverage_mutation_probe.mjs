#!/usr/bin/env node
/**
 * coverage_mutation_probe.mjs — DoD-6 Stichproben-Mutationsbeweis (Spec Bau-Teil 5,
 * Stop-Condition 3): jeder Forcing-Test ist HONEST-RED-fähig.
 *
 * Verfahren: pro Stichprobe wird eine /tmp-KOPIE des Repos gebaut (src/ + tests/
 * kopiert, node_modules symlinkt; das ORIGINAL bleibt unangetastet), die
 * Emissions-Stelle EINES gesampelten signal-Eintrags exakt-String-verifiziert
 * neutralisiert und der zugehörige Forcing-Test in der Kopie ausgeführt.
 * Erwartung je Stichprobe: Suite wird ROT (Exit != 0 UND >=1 fehlgeschlagen) —
 * d.h. der Test erzwingt das ERSCHEINEN des Signals, keine Absenz-Logik.
 *
 * Stichprobe (3 Klassen-divers: Warning · Error-Code · Schema-Enum-Signal):
 *   S1 MULTIPLE_PAINT_SOURCES        pw:4583  → tests/integration/test_coverage_forcing.mjs
 *   S2 EMPTY_SVG                     pw:925   → tests/integration/test_coverage_forcing.mjs
 *   S3 SIZE_FIX_UNSUPPORTED_FOR_TAG  structured.js:212,222 → tests/unit/test_structured.js
 *
 * OFFLINE-Lauf (nicht im Gate verdrahtet — Bau-/Audit-Werkzeug, Spec-konform):
 *   node scripts/coverage_mutation_probe.mjs
 * Exit 0 nur bei 3/3 KILLED.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const PROBEN = [
  {
    name: 'S1 MULTIPLE_PAINT_SOURCES (Warning, pw:4583)',
    file: 'src/adapters/renderer/playwright.js',
    von: "pushed.warnings.push('MULTIPLE_PAINT_SOURCES');",
    nach: '/* MUTIERT: MULTIPLE_PAINT_SOURCES-Emission neutralisiert */',
    erwartet: 1,
    test: 'tests/integration/test_coverage_forcing.mjs',
    timeoutMs: 120_000,
  },
  {
    name: 'S2 EMPTY_SVG (Error-Code, pw:925)',
    file: 'src/adapters/renderer/playwright.js',
    von: "error: 'EMPTY_SVG',",
    nach: "error: 'EMPTY_SVG_MUTIERT',",
    erwartet: 1,
    test: 'tests/integration/test_coverage_forcing.mjs',
    timeoutMs: 120_000,
  },
  {
    name: 'S3 SIZE_FIX_UNSUPPORTED_FOR_TAG (Schema-Enum-Signal, structured.js:212,222)',
    file: 'src/adapters/emitter/structured.js',
    von: "reason = 'SIZE_FIX_UNSUPPORTED_FOR_TAG';",
    nach: 'reason = undefined; /* MUTIERT */',
    erwartet: 2,
    test: 'tests/unit/test_structured.js',
    timeoutMs: 60_000,
  },
];

function bauKopie() {
  const dir = mkdtempSync(join(tmpdir(), 'cov_mut_'));
  cpSync(join(ROOT, 'src'), join(dir, 'src'), { recursive: true });
  cpSync(join(ROOT, 'tests'), join(dir, 'tests'), { recursive: true });
  cpSync(join(ROOT, 'package.json'), join(dir, 'package.json'));
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir');
  return dir;
}

let killed = 0;
for (const p of PROBEN) {
  console.log(`\n=== ${p.name} ===`);
  const dir = bauKopie();
  try {
    const f = join(dir, p.file);
    const txt = readFileSync(f, 'utf8');
    const teile = txt.split(p.von);
    const vorkommen = teile.length - 1;
    if (vorkommen !== p.erwartet) {
      console.log(`  FEHLER: Mutations-Muster ${vorkommen}x gefunden (erwartet ${p.erwartet}) — Probe ungültig`);
      continue;
    }
    writeFileSync(f, teile.join(p.nach));
    console.log(`  mutiert: ${p.file} (${vorkommen} Stelle${vorkommen > 1 ? 'n' : ''} neutralisiert), Original UNBERÜHRT`);

    const run = spawnSync('node', [join(dir, p.test)], {
      cwd: dir,
      timeout: p.timeoutMs,
      encoding: 'utf8',
    });
    const out = (run.stdout || '') + (run.stderr || '');
    const rotZeile = out.match(/Ergebnis: \d+ bestanden, [1-9]\d* fehlgeschlagen/);
    const fails = out.match(/^\s*FAIL: .*/gm) || [];
    if (run.status !== 0 && rotZeile) {
      killed++;
      console.log(`  KILLED ✓ — Forcing-Test rot: ${rotZeile[0]}`);
      for (const fl of fails.slice(0, 3)) console.log(`    ${fl.trim()}`);
    } else {
      console.log(`  ÜBERLEBT ✗ — exit=${run.status}, Forcing-Test hat die tote Emission NICHT bemerkt`);
      console.log(out.split('\n').slice(-6).join('\n'));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\nMUTATIONS-STICHPROBE: ${killed}/${PROBEN.length} getötet (Soll: ${PROBEN.length}/${PROBEN.length})`);
process.exit(killed === PROBEN.length ? 0 : 1);
