/**
 * selftest_claims.mjs — Protokoll-Selftest der Relais-Schicht (RELAIS-SPEC §2).
 *
 * Behauptungs-Deckung == Verifikations-Deckung: die DR-1-Wurzel (der eine
 * unverprobte Satz war der eine falsche) wird strukturell unmöglich.
 *
 * Vier Prüf-Schichten:
 *   S1 WORTIDENTITÄT — jeder Register-`text` ist Substring der LIVE
 *      exportierten Auslieferung (tools.js-Description je Tool-Target,
 *      QUICKSTART für instructions). Register und Auslieferung können
 *      nicht auseinanderdriften.
 *   S1b VOLLSTRING-PIN (P2) — die KOMPLETTE Description jedes der 9 Tools
 *      ist wortidentisch zur Register-Projektion (claims.js DESCRIPTIONS);
 *      damit sind auch Orientierung/Input/Output/Next-step gebunden — jede
 *      Freitext-Mutation in tools.js wird rot. instructions: Wortidentität
 *      Auslieferung==QUICKSTART pinnt die MCP-Rand-Probe
 *      probe_mcp_instructions.mjs (S3, ===-Vergleich); hier zusätzlich der
 *      numerische Budget-Anker (Description ≤1300 Z., Quickstart ≤2500/≤35).
 *   S2 DECKUNG — jeder Satz der Eigenheiten-Blöcke (zwischen
 *      EIGENHEITEN_MARKER und ' Next step:', Split ' | ') und jeder
 *      Stolperstein-Satz des Quickstarts ist im Register; |ungedeckt| == 0.
 *   S3 WAHRHEIT — alle Proben (unique probe-Pfade der Claims, ≠STATIC)
 *      laufen gegen das lebende System; |rote Proben| == 0.
 *
 * Numerik-Wachen (Spec §2/§7.3): Claims 25–35 · STATIC ≤ 20 % · Claims ohne
 * Probe (STATIC ausgenommen) == 0 · MCP-Rand-Proben ≥ 4 · Laufzeit ≤ 120 s.
 *
 * Determinismus: alle 'OBS '-Zeilen sind lauf-stabil (Doppellauf:
 *   node selftest_claims.mjs | grep '^OBS' zweimal diffen ⇒ leer).
 * Die RICHTUNG des Pins (Spec §2.4): Beschreibung↔System-Kongruenz, nicht
 * Systemverhalten — ändert eine maintainer decision z.B. den Cap, wird der
 * Cap-Claim rot und zwingt die Description nach; er blockiert die
 * Verhaltensänderung nicht.
 *
 * Run: node tests/relais_red/selftest_claims.mjs   (Exit 1 wenn rot)
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLAIMS,
  DESCRIPTIONS,
  EIGENHEITEN_MARKER,
  QUICKSTART,
} from '../../src/interface/claims.js';
import { tools } from '../../src/interface/tools.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const started = Date.now();

let failCount = 0;
function red(layer, msg) {
  failCount += 1;
  console.log(`FAIL [${layer}] ${msg}`);
}

const descByTarget = Object.fromEntries(
  tools.map((t) => [
    t.name.replace('vector_mirror_', ''),
    t.config.description,
  ]),
);

// ── Numerik-Wachen ───────────────────────────────────────────────────────────
{
  const n = CLAIMS.length;
  const statics = CLAIMS.filter((c) => c.probe === 'STATIC').length;
  const probeFiles = [
    ...new Set(CLAIMS.filter((c) => c.probe !== 'STATIC').map((c) => c.probe)),
  ];
  const mcpProbes = probeFiles.filter((p) => p.includes('probe_mcp_'));
  console.log(
    `OBS Claims=${n} STATIC=${statics} (${((100 * statics) / n).toFixed(1)}%) Proben=${probeFiles.length} MCP-Rand=${mcpProbes.length}`,
  );
  if (n < 25 || n > 35) red('NUM', `Claims=${n} außerhalb 25–35`);
  if (statics / n > 0.2)
    red('NUM', `STATIC-Anteil ${((100 * statics) / n).toFixed(1)}% > 20%`);
  if (mcpProbes.length < 4)
    red('NUM', `MCP-Rand-Proben ${mcpProbes.length} < 4`);
  for (const c of CLAIMS) {
    if (c.probe !== 'STATIC' && !existsSync(join(ROOT, c.probe)))
      red('NUM', `${c.id}: Probe fehlt (${c.probe})`);
    if (c.text.includes('|'))
      red('NUM', `${c.id}: '|' im Claim-Text bricht die S2-Splitgrenze`);
  }
}

// ── S1 WORTIDENTITÄT ─────────────────────────────────────────────────────────
for (const c of CLAIMS) {
  for (const target of c.targets) {
    const haystack =
      target === 'instructions' ? QUICKSTART : descByTarget[target];
    if (typeof haystack !== 'string') {
      red('S1', `${c.id}: unbekanntes Target '${target}'`);
      continue;
    }
    if (!haystack.includes(c.text)) {
      red('S1', `${c.id}: text NICHT wortidentisch in '${target}'`);
    }
  }
}
console.log(
  `OBS S1 geprüfte (claim,target)-Paare: ${CLAIMS.reduce((s, c) => s + c.targets.length, 0)}`,
);

// ── S1b VOLLSTRING-PIN (P2): Auslieferung == Register-Projektion ────────────
// Bindet die NICHT-Eigenheiten-Blöcke (Orientierung/Input/Output/Next-step):
// jede Freitext-Mutation in tools.js (inlined String, vergessener Import,
// abweichende Komposition) wird rot. Richtung wie S1 (Spec §2.4): gepinnt ist
// Beschreibung↔Register-Kongruenz, nicht das Systemverhalten.
{
  let s1bTools = 0;
  for (const [target, desc] of Object.entries(descByTarget)) {
    s1bTools += 1;
    const want = DESCRIPTIONS[target];
    if (typeof want !== 'string') {
      red('S1b', `${target}: keine Register-Projektion (DESCRIPTIONS fehlt)`);
      continue;
    }
    if (desc !== want) {
      let i = 0;
      while (i < Math.min(desc.length, want.length) && desc[i] === want[i])
        i += 1;
      red(
        'S1b',
        `${target}: Description NICHT wortidentisch zur Register-Projektion (Divergenz ab Zeichen ${i}: "…${desc.slice(Math.max(0, i - 20), i + 20)}…")`,
      );
    }
    if (desc.length > 1300)
      red('S1b', `${target}: Description ${desc.length} Zeichen > 1300 (D1)`);
  }
  const fehlend = Object.keys(DESCRIPTIONS).filter(
    (t2) => !(t2 in descByTarget),
  );
  if (fehlend.length > 0)
    red(
      'S1b',
      `Register-Projektion ohne registriertes Tool: ${fehlend.join(', ')}`,
    );
  if (
    QUICKSTART.length === 0 ||
    QUICKSTART.length > 2500 ||
    QUICKSTART.split('\n').length > 35
  )
    red(
      'S1b',
      `QUICKSTART verletzt Budget (${QUICKSTART.length} Z., ${QUICKSTART.split('\n').length} Zeilen; Cap 2500/35)`,
    );
  console.log(
    `OBS S1b Vollstring-Pins: ${s1bTools}/9 Descriptions wortidentisch geprüft + QUICKSTART-Budget (${QUICKSTART.length} Z., ${QUICKSTART.split('\n').length} Zeilen)`,
  );
}

// ── S2 DECKUNG (|ungedeckte Sätze| == 0) ────────────────────────────────────
let s2Saetze = 0;
const registerTexte = new Map(CLAIMS.map((c) => [c.text, c]));
for (const [target, desc] of Object.entries(descByTarget)) {
  const start = desc.indexOf(EIGENHEITEN_MARKER);
  if (start < 0) {
    red('S2', `${target}: Eigenheiten-Block fehlt (Marker nicht gefunden)`);
    continue;
  }
  const endIdx = desc.indexOf(' Next step:', start);
  const block = desc.slice(
    start + EIGENHEITEN_MARKER.length,
    endIdx > 0 ? endIdx : undefined,
  );
  for (const satz of block
    .split(' | ')
    .map((s) => s.trim())
    .filter(Boolean)) {
    s2Saetze += 1;
    const claim = registerTexte.get(satz);
    if (!claim)
      red(
        'S2',
        `${target}: ungedeckter Eigenheiten-Satz: "${satz.slice(0, 60)}…"`,
      );
    else if (!claim.targets.includes(target))
      red(
        'S2',
        `${target}: Satz gehört zu ${claim.id}, dessen targets ${JSON.stringify(claim.targets)} '${target}' nicht nennen`,
      );
  }
}
// Stolperstein-Sätze des Quickstarts (Abschnitt STOLPERSTEINE → GLOSSAR).
{
  const lines = QUICKSTART.split('\n');
  const von = lines.findIndex((l) => l.startsWith('STOLPERSTEINE'));
  const bis = lines.findIndex((l) => l.startsWith('GLOSSAR'));
  if (von < 0 || bis < 0 || bis <= von + 1)
    red('S2', 'Quickstart: STOLPERSTEINE-Abschnitt fehlt/leer');
  const stolpersteine = lines
    .slice(von + 1, bis)
    .map((l) => l.replace(/^- /, '').trim());
  for (const satz of stolpersteine) {
    s2Saetze += 1;
    const claim = registerTexte.get(satz);
    if (!claim)
      red('S2', `Quickstart-Stolperstein ungedeckt: "${satz.slice(0, 60)}…"`);
    else if (!claim.targets.includes('instructions'))
      red(
        'S2',
        `Quickstart-Stolperstein ${claim.id}: targets nennen 'instructions' nicht`,
      );
  }
  if (stolpersteine.length !== 4)
    red('S2', `Stolpersteine=${stolpersteine.length}, erwartet 4`);
}
console.log(`OBS S2 geprüfte Sätze: ${s2Saetze}`);

// ── S3 WAHRHEIT (alle Proben grün; Pool=3 — Budget ≤120 s inkl. Browser) ────
const probeFiles = [
  ...new Set(CLAIMS.filter((c) => c.probe !== 'STATIC').map((c) => c.probe)),
].sort();

function runProbe(rel) {
  return new Promise((resolve) => {
    const child = spawn('node', [join(ROOT, rel)], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (out += d.toString()));
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* weg */
      }
      resolve({ rel, exit: null, out: `${out}\n[TIMEOUT 90s]` });
    }, 90_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ rel, exit: code, out });
    });
  });
}

const results = [];
{
  const queue = [...probeFiles];
  const POOL = 3;
  await Promise.all(
    Array.from({ length: POOL }, async () => {
      while (queue.length > 0) {
        const rel = queue.shift();
        results.push(await runProbe(rel));
      }
    }),
  );
}
results.sort((a, b) => a.rel.localeCompare(b.rel));
for (const r of results) {
  // Exakt das assert()-Format der Proben ("ASSERT <name>: FAIL — ist: …") —
  // ein 'FAIL' im ist-Echo (z.B. ein erwarteter status=FAIL) zählt NICHT.
  const fails = (r.out.match(/^ASSERT [^:\n]+: FAIL — /gm) || []).length;
  console.log(`OBS S3 ${r.rel}: exit=${r.exit} fails=${fails}`);
  if (r.exit !== 0) {
    red('S3', `${r.rel} rot (exit ${r.exit})`);
    console.log(
      r.out
        .split('\n')
        .filter((l) => l.includes('FAIL') || l.includes('TIMEOUT'))
        .map((l) => `    ${l}`)
        .join('\n'),
    );
  }
}

// ── VERDIKT ──────────────────────────────────────────────────────────────────
const wallS = (Date.now() - started) / 1000;
console.log(`Laufzeit: ${wallS.toFixed(1)}s (Budget 120s)`);
if (wallS > 120) red('NUM', `Laufzeit ${wallS.toFixed(1)}s > 120s (D4)`);

if (failCount > 0) {
  console.log(`CLAIMS-SELFTEST: ROT (${failCount} FAIL)`);
  process.exit(1);
} else {
  console.log(
    `CLAIMS-SELFTEST: GRUEN — S1 Wortidentität, S1b Vollstring-Pin 9/9, S2 Deckung==1.0 (${s2Saetze} Sätze), S3 ${probeFiles.length}/${probeFiles.length} Proben`,
  );
  process.exit(0);
}
