#!/usr/bin/env node
/**
 * doc_budget.mjs — DoD-8 Doku-Budget Drift-Sensor (§G-KORR K5)
 *
 * Misst das Verhaeltnis live-Markdown:Source-Code und prueft es gegen einen
 * deklarierten Cap. HARD-Mode (Default seit DoD-8/E7b W3) exitet 1 bei
 * Quotient > Cap; WARN-Mode (MODE=warn) druckt + misst, exitet aber immer 0.
 *
 * KORPUS-DEFINITION (reproduzierbar, OS-unabhaengig via Node-fs, kein Shell-Glob):
 *   Nenner (Source): src/**.{js,mjs}
 *   Zaehler (live-Doku): **.md AUSSER node_modules/ und archive/
 *   Info (separat): docs/**.yaml (nicht im Verdikt)
 *
 * CAP: MD_SRC_MAX = 8.0x auf live-MD:src (deklariert seit 185984c; 6.58x beim
 *   E7b-W3-Flip). Der Cap-WERT ist normativ = maintainer decision. Sensor-Modus
 *   bei Bedarf: MODE=warn node scripts/doc_budget.mjs
 *
 * Run: node scripts/doc_budget.mjs   (oder: npm run gate:docs)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── config toggle (1 Zeile): 'warn' = Drift-Sensor (Exit 0); 'hard' = blockierend.
// DoD-8/E7b W3: Default 'warn'→'hard' (maintainer decision, Spec an internal spec
// Bau-Teil 2; VISION verlangt Stop-Condition; Stand beim Flip: 6.58x bei Cap 8.0).
const MODE_DEFAULT = 'hard';
const MD_SRC_MAX = 8.0; // live-MD:src Cap (normative (maintainer))

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MODE = (process.env.MODE || MODE_DEFAULT).toLowerCase();

const EXCLUDED_DIRS = new Set(['node_modules', 'archive', '.git']);

function walk(dir, predicate, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      walk(full, predicate, acc);
    } else if (entry.isFile() && predicate(full)) {
      acc.push(full);
    }
  }
  return acc;
}

function countLines(files) {
  let lines = 0;
  for (const f of files) {
    try {
      const content = readFileSync(f, 'utf8');
      // Zeilen wie wc -l: Anzahl Newlines. Datei ohne abschliessendes \n zaehlt
      // ihre letzte (nicht-leere) Zeile mit.
      let n = 0;
      for (let i = 0; i < content.length; i++) if (content.charCodeAt(i) === 10) n++;
      if (content.length > 0 && content[content.length - 1] !== '\n') n++;
      lines += n;
    } catch {
      /* unlesbar -> ignorieren */
    }
  }
  return lines;
}

const srcFiles = walk(join(ROOT, 'src'), (f) => {
  const e = extname(f);
  return e === '.js' || e === '.mjs';
});
const mdFiles = walk(ROOT, (f) => extname(f) === '.md');
const yamlFiles = walk(join(ROOT, 'docs'), (f) => {
  const e = extname(f);
  return e === '.yaml' || e === '.yml';
});

const srcLines = countLines(srcFiles);
const mdLines = countLines(mdFiles);
const yamlLines = countLines(yamlFiles);

const ratio = srcLines > 0 ? mdLines / srcLines : Infinity;
const yamlRatio = srcLines > 0 ? yamlLines / srcLines : Infinity;
const over = ratio > MD_SRC_MAX;

console.log('=== DOC-BUDGET (DoD-8 §G-KORR K5) ===');
console.log(
  `live-MD:src = ${ratio.toFixed(2)}x  (${mdLines} md-Zeilen / ${srcLines} src-Zeilen, ${mdFiles.length} md / ${srcFiles.length} src Dateien)`,
);
console.log(`Cap         = ${MD_SRC_MAX.toFixed(1)}x  | Mode = ${MODE}`);
console.log(`yaml:src    = ${yamlRatio.toFixed(2)}x  (info, nicht im Verdikt)`);

if (over) {
  console.log(
    `[${MODE === 'hard' ? 'FAIL' : 'WARN'}] live-MD:src ${ratio.toFixed(2)}x > Cap ${MD_SRC_MAX.toFixed(1)}x`,
  );
} else {
  console.log(
    `[OK] live-MD:src ${ratio.toFixed(2)}x <= Cap ${MD_SRC_MAX.toFixed(1)}x`,
  );
}

if (MODE === 'hard' && over) {
  process.exit(1);
}
process.exit(0);
