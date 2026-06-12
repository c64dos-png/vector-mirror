/**
 * test_breaker_recovery.mjs — §1.7 Breaker-Recovery (ENV-REAL Chromium)
 * Vector Mirror v2.5
 *
 * Beweist den AUTO-RECOVERY-Pfad mit einem ECHTEN Chromium-Browser:
 *   1. frische init() -> erfolgreicher analyze
 *   2. SIGKILL der (delta-scoped) Chromium-PIDs -> Browser tot
 *   3. analyze-Aufrufe schlagen fehl -> Breaker oeffnet
 *   4. nach resetTimeout: halfOpen -> restartPromise startet frischen Browser
 *      -> die gegated Probe rendert gegen den NEUEN Browser -> Breaker schliesst
 *   5. uebernaechster Call erfolgreich (AUTO-RECOVERY, kein Permanent-Brick)
 *   6. Proc-Count delta-scoped == 0 nach shutdown (F-SVG-033, kein Orphan-Leak)
 *   7. kein Hang (restartPromise bounded; gesamter Lauf < Wall-Timeout)
 *
 * Honest-Red-Kontext: VOR §1.7-Fix brickt der Breaker permanent (kein
 * on('open')/on('halfOpen')-Restart) -> Schritt 5 wuerde NIE erfolgreich.
 * Dieser Test ist der env-reale Recovery-Beleg.
 *
 * GUARDRAIL: pgrep+SIGKILL ist STRIKT delta-scoped (PIDs, die zwischen
 * before/after init NEU sind). Globaler pkill ist verboten (shared env).
 *
 * Test-only Breaker-Tuning via VMC_TEST_RESET_TIMEOUT (siehe pipeline.js
 * __setBreakerOpts) haelt den Lauf schnell (resetTimeout 600ms statt 30s).
 */
import { execSync } from 'node:child_process';
import * as pipeline from '../../src/pipeline.js';
import {
  createResolver,
  closeResolver,
  resolve,
} from '../../src/adapters/renderer/playwright.js';

let fails = 0;
function check(label, cond, detail = '') {
  const ok = !!cond;
  console.log(`${ok ? '  PASS' : '  FAIL'}: ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails++;
  return ok;
}

// Matche NUR echte Chromium-Binaries (Pfad zum chrome-headless-shell/chrome
// Executable), NICHT beliebige Kommandozeilen, die das Wort enthalten (z.B.
// dieser node-Test, pgrep/ps-Wrapper). Sonst zaehlt der Detektor seine eigenen
// Shell-Subprozesse als "Orphans" (false positive).
const CHROMIUM_BIN_RX =
  /ms-playwright.*chrome-headless-shell\b|\/chrome-headless-shell /;

// §HEAL-7/I (Opus-Audit, false-RED-Klasse): der Detektor war HOST-GLOBAL
// (pgrep -af ueber ALLE Prozesse der Maschine) — jede FREMDE Playwright-
// Session, die zwischen before/after-Snapshot startete, erschien im Delta und
// roetete das Verdikt (Honest-Red-Beleg: an internal session artifact
// rot_I_orphan_detector.log, delta=1 durch Fremd-Prozess-Mock). Jetzt:
// PROZESSBAUM-SCOPING — gezaehlt wird NUR, was (a) ein Chromium-Binary ist UND
// (b) bei einer Sichtung DESCENDANT dieses Test-Prozesses war (PPID-Kette:
// node-Test → playwright-launch → chrome-headless-shell → Helper).
// REPARENTING-FALLE: ein echtes Orphan verliert nach dem Tod seines Parents
// die PPID-Kette (re-parent auf init/subreaper) und waere im after-Snapshot
// unsichtbar. Darum merkt sich der Detektor einmal als EIGEN gesichtete PIDs
// (seenOwn) und zaehlt sie weiter, solange sie LEBEN; tote PIDs werden
// vergessen (PID-Reuse-Schutz). Fremde Prozesse betreten seenOwn NIE — sie
// sind zu keinem Zeitpunkt Descendants. Reine Scoping-Logik in
// ownChromiumPids() (mock-testbar, Logik-Probe unten im Suite-Lauf).
function readProcTable() {
  return execSync('ps -eo pid=,ppid=,args=', { encoding: 'utf8' })
    .split('\n')
    .map((line) => {
      const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
      return m ? { pid: Number(m[1]), ppid: Number(m[2]), args: m[3] } : null;
    })
    .filter(Boolean);
}

/**
 * Reine Scoping-Logik (mock-testbar): liefert die lebenden EIGENEN
 * Chromium-PIDs. MUTIERT `seenOwn` (Sichtungs-Gedaechtnis des Aufrufers).
 * @param {Array<{pid:number, ppid:number, args:string}>} table - Prozess-Tabelle
 * @param {number} rootPid - Wurzel der eigenen PPID-Kette (Test-Prozess)
 * @param {Set<number>} seenOwn - einmal als eigen gesichtete PIDs (persistiert)
 * @returns {number[]} lebende eigene Chromium-PIDs (sortiert)
 */
function ownChromiumPids(table, rootPid, seenOwn) {
  const childrenOf = new Map();
  for (const p of table) {
    if (!childrenOf.has(p.ppid)) childrenOf.set(p.ppid, []);
    childrenOf.get(p.ppid).push(p.pid);
  }
  // Transitive Kind-Menge der eigenen PPID-Kette.
  const desc = new Set();
  const stack = [rootPid];
  while (stack.length > 0) {
    const cur = stack.pop();
    for (const c of childrenOf.get(cur) || []) {
      if (!desc.has(c)) {
        desc.add(c);
        stack.push(c);
      }
    }
  }
  for (const p of table) {
    if (desc.has(p.pid) && CHROMIUM_BIN_RX.test(p.args)) seenOwn.add(p.pid);
  }
  // Tote vergessen (PID-Reuse-Schutz); lebende einmal-eigene weiter zaehlen
  // (faengt re-parentete eigene Orphans, ignoriert Fremde fuer immer).
  const live = new Set(table.map((p) => p.pid));
  for (const pid of [...seenOwn]) if (!live.has(pid)) seenOwn.delete(pid);
  return [...seenOwn].sort((a, b) => a - b);
}

const seenOwnChromium = new Set();
function chromiumPids() {
  try {
    return ownChromiumPids(readProcTable(), process.pid, seenOwnChromium);
  } catch {
    return [];
  }
}

const GOOD_SVG =
  '<svg viewBox="0 0 100 100"><rect id="r" x="0" y="0" width="10" height="10" fill="red"/></svg>';

async function run() {
  console.log('\n=== §1.7 BREAKER RECOVERY (ENV-REAL) ===');

  // Tuning: schnelle State-Transitions (resetTimeout 600ms, volumeThreshold 3).
  pipeline.__setBreakerOpts({
    resetTimeout: 600,
    volumeThreshold: 3,
    rollingCountTimeout: 5000,
    timeout: 4000,
  });

  const before = new Set(chromiumPids());

  // 1. Frische init + erfolgreicher analyze
  await pipeline.init();
  const afterInit = chromiumPids();
  const ownPids = afterInit.filter((pid) => !before.has(pid));
  console.log(`  [proc] own chromium pids after init: ${ownPids.length}`);
  check('init startet >=1 eigenen Chromium-Proc', ownPids.length >= 1);

  const r1 = await pipeline.analyze(GOOD_SVG);
  check(
    'analyze #1 erfolgreich (Browser lebt)',
    !!r1.structured && !r1.prose.startsWith('Fehler:'),
    r1.prose.slice(0, 50),
  );

  // 2. SIGKILL der eigenen Chromium-PIDs (delta-scoped, sicher)
  console.log(`  [kill] SIGKILL ${ownPids.length} eigene PIDs (delta-scoped)`);
  for (const pid of ownPids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 400)); // disconnected-Listener feuert

  // 3. analyze-Aufrufe nach Tod -> Breaker zaehlt -> oeffnet
  const tStart = Date.now();
  const errors = [];
  for (let i = 0; i < 6; i++) {
    const out = await pipeline.analyze(GOOD_SVG);
    errors.push(out.prose.startsWith('Fehler:') ? out.prose : 'OK');
  }
  const stOpen = pipeline.getStatus().structured.breaker;
  check(
    'Breaker oeffnet nach Browser-Tod',
    stOpen?.state === 'open',
    `state=${stOpen?.state} fires=${stOpen?.fires} failures=${stOpen?.failures}`,
  );

  // 4+5. AUTO-RECOVERY: warte ueber resetTimeout, dann analyze (= gegate Probe).
  //      halfOpen -> restartPromise (createResolver) -> Probe rendert gegen
  //      NEUEN Browser -> close. Polling bis closed ODER Recovery-Budget (30s).
  let recovered = false;
  let recoveryMs = 0;
  const RECOVERY_BUDGET_MS = 30000;
  const recoStart = Date.now();
  while (Date.now() - recoStart < RECOVERY_BUDGET_MS) {
    await new Promise((r) => setTimeout(r, 300));
    const out = await pipeline.analyze(GOOD_SVG);
    if (!out.prose.startsWith('Fehler:') && out.structured) {
      recovered = true;
      recoveryMs = Date.now() - tStart;
      break;
    }
  }
  check(
    'AUTO-RECOVERY: analyze erfolgreich nach Browser-Tod (kein Permanent-Brick)',
    recovered,
    `nach ${recoveryMs}ms`,
  );
  check(
    'Recovery innerhalb 30s (Stop-Cond)',
    recovered && recoveryMs <= 30000,
    `${recoveryMs}ms`,
  );
  const stClosed = pipeline.getStatus().structured.breaker;
  check(
    'Breaker wieder geschlossen nach Recovery',
    stClosed?.state === 'closed',
    `state=${stClosed?.state}`,
  );

  // 6. shutdown + Orphan-Leak-Check (F-SVG-033)
  await pipeline.shutdown();
  await new Promise((r) => setTimeout(r, 800)); // Reaping abwarten
  const afterShutdown = new Set(chromiumPids());
  const leaked = [...afterShutdown].filter((pid) => !before.has(pid));
  check(
    'F-SVG-033: 0 NEUE Chromium-Orphans nach open->recovery->shutdown',
    leaked.length === 0,
    `leaked=${leaked.length} (${leaked.slice(0, 4).join(',')})`,
  );

  // 7. kein Hang: Gesamtlauf gut unter dem Wall-Timeout (siehe runner).
  const totalMs = Date.now() - tStart;
  check('kein Hang: Lauf < 35s', totalMs < 35000, `${totalMs}ms`);

  // ── INVARIANTE 2: close-vs-relaunch Ownership-Guard ──────────────────────
  // Eine SPAETE closeResolver darf NIEMALS den Browser nullen, den ein
  // zwischenzeitlich gelaufener createResolver gestartet hat.
  //
  // TEIL A (DISKRIMINIEREND, deterministisch, pure-logic): modelliert die EXAKTE
  // Adapter-Semantik (closeResolver/createResolver Compare-and-Null). Der
  // Worst-Case: der langsame close von closeResolver (captured OLD) ueberlappt
  // eine Relaunch, die VOR dem close-Settle fertig wird (NEW gesetzt). OHNE
  // Ownership-Guard nullt der spaete close NEW (final=NULL); MIT Guard bleibt
  // NEW. Dieser Test FAELLT ohne den Guard (Honest-Red, im Worklog belegt).
  console.log('\n--- INVARIANTE 2 (A): Ownership-Guard diskriminierend ---');
  {
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    const makeAdapter = (guarded) => {
      let browser = null;
      let activePage = null;
      const fakeClose = async (b, ms) => {
        await delay(ms);
        b.alive = false;
      };
      return {
        async createResolver(id, launchMs) {
          if (browser) {
            const owned = browser;
            await fakeClose(owned, 0);
            if (!guarded || browser === owned) {
              browser = null;
              activePage = null;
            }
          }
          await delay(launchMs);
          browser = { id, alive: true };
          activePage = { id };
        },
        async closeResolver(closeMs) {
          const owned = browser;
          if (owned) await fakeClose(owned, closeMs);
          if (!guarded || browser === owned) {
            browser = null;
            activePage = null;
          }
        },
        get browser() {
          return browser;
        },
      };
    };
    const scenario = async (guarded) => {
      const a = makeAdapter(guarded);
      await a.createResolver('OLD', 5);
      const lateClose = a.closeResolver(300); // captured OLD, slow close
      await delay(20);
      const relaunch = a.createResolver('NEW', 5); // NEW vor close-settle
      await relaunch;
      await lateClose;
      return a.browser ? a.browser.id : 'NULL';
    };
    const buggy = await scenario(false);
    const fixed = await scenario(true);
    check(
      'INVARIANTE 2(A): OHNE Guard nullt der spaete close den NEUEN Browser (Honest-Red)',
      buggy === 'NULL',
      `buggy-final=${buggy}`,
    );
    check(
      'INVARIANTE 2(A): MIT Ownership-Guard ueberlebt der NEUE Browser',
      fixed === 'NEW',
      `fixed-final=${fixed}`,
    );
  }

  // TEIL B (ENV-REAL Smoke): der echte Adapter ueberlebt eine konkurrente
  // close+relaunch-Sequenz ohne Leak und ohne falschen LOAD_FAILED. (Das
  // ENV-Race-Fenster ist eng, weil beide Pfade auf owned.close() serialisieren
  // — daher ist Teil A der diskriminierende Beleg; Teil B ist der reale Smoke.)
  console.log('\n--- INVARIANTE 2 (B): ENV-REAL close+relaunch Smoke ---');
  const inv2Before = new Set(chromiumPids());
  const oldPage = await createResolver();
  const oldBrowser = oldPage.context().browser();
  const realClose = oldBrowser.close.bind(oldBrowser);
  oldBrowser.close = async () => {
    await new Promise((r) => setTimeout(r, 200));
    return realClose();
  };
  const lateClose = closeResolver(); // fire-and-forget (langsam wg. Patch)
  await new Promise((r) => setTimeout(r, 30));
  const newPage = await createResolver(); // relaunch
  await lateClose;
  await new Promise((r) => setTimeout(r, 100));
  const r2 = await resolve(newPage, GOOD_SVG);
  check(
    'INVARIANTE 2(B): NEUER Browser ueberlebt konkurrente close (resolve ok)',
    !r2.error && Array.isArray(r2.elements),
    r2.error || `elements=${r2.elements?.length}`,
  );
  await closeResolver();
  await new Promise((r) => setTimeout(r, 800));
  const inv2After = new Set(chromiumPids());
  const inv2Leaked = [...inv2After].filter((pid) => !inv2Before.has(pid));
  check(
    'INVARIANTE 2(B): kein Orphan durch close+relaunch (leaked=0)',
    inv2Leaked.length === 0,
    `leaked=${inv2Leaked.length} (${inv2Leaked.slice(0, 4).join(',')})`,
  );

  // ── INVARIANTE 3 (EPOCH-MODELL, diskriminierend): konstruktive Zuweisungen ──
  // Der fruehere owned-Punkt-Guard schuetzte nur den CLOSE-Pfad. Ein spaet fertig
  // werdender superseded Launch (L1) ueberschrieb die KONSTRUKTIVEN Zuweisungen
  // (browser/activePage/page) der erfolgreichen Recovery (L2). Diese Tests
  // modellieren die EXAKTE Adapter+Pipeline-Epoch-Semantik mit DISTINKTEN
  // Browser-Instanzen pro createResolver (NICHT eine Konstante — genau das
  // maskierte den Bug im alten Test). Jeweils Honest-Red: OHNE Epoch-Guard rot.
  console.log('\n--- INVARIANTE 3 (EPOCH): konstruktive Mutation guarded ---');
  {
    // Modell der adapter+pipeline Lifecycle mit Epoch (epochGuard schaltbar).
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    function makeSystem(epochGuard) {
      // Adapter-State
      let browser = null;
      let activePage = null;
      let launchEpoch = 0;
      const launched = []; // alle je gestarteten Browser (Leak-Tracking)

      async function createResolver(launchMs, id) {
        // idempotent owned-close (schnell)
        if (browser) {
          const owned = browser;
          owned.closed = true;
          if (browser === owned) {
            browser = null;
            activePage = null;
          }
        }
        const epoch = ++launchEpoch;
        await delay(launchMs);
        const nb = { id, closed: false };
        launched.push(nb);
        // SUPERSEDED-Check (konstruktiver Pfad)
        if (epochGuard && epoch !== launchEpoch) {
          nb.closed = true; // self-close, KEIN State-Eingriff
          return null;
        }
        browser = nb;
        activePage = { id: id + '-page', browser: nb };
        return activePage;
      }
      async function closeResolver(closeMs) {
        launchEpoch++; // invalidiert in-flight Launches
        const owned = browser;
        if (owned) {
          await delay(closeMs);
          owned.closed = true;
        }
        if (browser === owned) {
          browser = null;
          activePage = null;
        }
      }
      function invalidateLaunches() {
        launchEpoch++;
      }
      return {
        createResolver,
        closeResolver,
        invalidateLaunches,
        get browser() {
          return browser;
        },
        get page() {
          return activePage;
        },
        leakedOpen: () =>
          launched.filter((b) => !b.closed && b !== browser).length,
      };
    }

    // (a) L1 haengt → (Gate-)Timeout → L2 erfolgreich → L1 spaet fertig.
    //     Endzustand MUSS L2 sein; L1 geschlossen (leaked=0); page = L2-page.
    {
      const sys = makeSystem(true);
      // Pipeline-State (reference-guard auf restartPromise)
      let page = null;
      let restartPromise = null;

      // halfOpen-Restart L1 (haengt 200ms)
      const start = (launchMs, id) => {
        const myRestart = (async () => {
          const p = await sys.createResolver(launchMs, id);
          if (p && restartPromise === myRestart) page = p;
        })().finally(() => {
          if (restartPromise === myRestart) restartPromise = null;
        });
        restartPromise = myRestart;
        myRestart.catch(() => {});
        return myRestart;
      };

      const L1 = start(200, 'L1');
      await delay(30);
      // Gate-Timeout: detach L1 (reference-guarded)
      if (restartPromise === L1) restartPromise = null;
      // halfOpen #2 → L2 (schnell, healthy)
      const L2 = start(15, 'L2');
      await L2;
      const afterL2 = { browser: sys.browser?.id, page: page?.id };
      await L1; // L1 spaet fertig — DARF nichts ueberschreiben
      check(
        'INV3(a): L1-Timeout → L2-Recovery → spaetes L1 ueberschreibt NICHT (browser=L2)',
        sys.browser?.id === 'L2' && afterL2.browser === 'L2',
        `final browser=${sys.browser?.id}`,
      );
      check(
        'INV3(a): pipeline page bleibt L2-page (kein stale L1-page)',
        page?.id === 'L2-page',
        `page=${page?.id}`,
      );
      check(
        'INV3(a): L1s Browser self-closed (leaked=0)',
        sys.leakedOpen() === 0,
        `leakedOpen=${sys.leakedOpen()}`,
      );
    }

    // (b) zwei konkurrente createResolver → nur der LETZTE gewinnt, der andere
    //     schliesst sich selbst (leaked=0).
    {
      const sys = makeSystem(true);
      const c1 = sys.createResolver(200, 'C1'); // langsam
      await delay(20);
      const c2 = sys.createResolver(15, 'C2'); // schnell (letzter Epoch)
      await Promise.all([c1, c2]);
      check(
        'INV3(b): konkurrente createResolver → letzter (C2) gewinnt',
        sys.browser?.id === 'C2',
        `browser=${sys.browser?.id}`,
      );
      check(
        'INV3(b): der unterlegene C1 self-closed (leaked=0)',
        sys.leakedOpen() === 0,
        `leakedOpen=${sys.leakedOpen()}`,
      );
    }

    // (c) shutdown waehrend in-flight Restart → KEIN Browser/page-Recreate danach.
    {
      const sys = makeSystem(true);
      let page = null;
      let restartPromise = null;
      const myRestart = (async () => {
        const p = await sys.createResolver(200, 'R'); // haengt
        if (p && restartPromise === myRestart) page = p;
      })().finally(() => {
        if (restartPromise === myRestart) restartPromise = null;
      });
      restartPromise = myRestart;
      myRestart.catch(() => {});

      await delay(30);
      // shutdown: invalidateLaunches + detach + close
      sys.invalidateLaunches();
      restartPromise = null;
      await sys.closeResolver(0);
      page = null;
      await myRestart; // der in-flight Launch faellt fertig — DARF nicht recreaten
      check(
        'INV3(c): shutdown waehrend Restart → kein Browser-Recreate (browser=null)',
        sys.browser === null,
        `browser=${sys.browser?.id ?? 'null'}`,
      );
      check(
        'INV3(c): kein stale page nach shutdown (page=null)',
        page === null,
        `page=${page?.id ?? 'null'}`,
      );
      check(
        'INV3(c): in-flight Launch self-closed (leaked=0)',
        sys.leakedOpen() === 0,
        `leakedOpen=${sys.leakedOpen()}`,
      );
    }
  }

  // ── INVARIANTE 3 (D, ENV-REAL): zwei konkurrente echte createResolver ─────
  // Beweist das Epoch-Modell mit ECHTEM Chromium: zwei ueberlappende
  // createResolver-Aufrufe → genau EIN Browser ueberlebt (der letzte Epoch),
  // der andere self-closed → leaked=0. Endzustand: resolve() ok gegen den
  // ueberlebenden Browser.
  console.log('\n--- INVARIANTE 3 (D): ENV-REAL konkurrente Launches ---');
  const inv3Before = new Set(chromiumPids());
  // erste Page einrichten, dann ueberlappende Relaunches feuern.
  const p1Promise = createResolver();
  await new Promise((r) => setTimeout(r, 20));
  const p2Promise = createResolver(); // ueberlappt → hoeherer Epoch
  const [p1, p2] = await Promise.all([p1Promise, p2Promise]);
  // Genau einer der beiden ist die aktive Page; der unterlegene Launch hat
  // null geliefert (superseded) ODER seinen Browser selbst geschlossen.
  const winner = p2 || p1; // p2 ist der spaetere Epoch (Gewinner-Kandidat)
  const r3 = await resolve(winner, GOOD_SVG);
  check(
    'INVARIANTE 3(D): ueberlebende Page rendert (genau ein Gewinner-Browser)',
    !r3.error && Array.isArray(r3.elements),
    r3.error || `elements=${r3.elements?.length} | p1=${p1 ? 'page' : 'null'} p2=${p2 ? 'page' : 'null'}`,
  );
  await closeResolver();
  await new Promise((r) => setTimeout(r, 900));
  const inv3After = new Set(chromiumPids());
  const inv3Leaked = [...inv3After].filter((pid) => !inv3Before.has(pid));
  check(
    'INVARIANTE 3(D): konkurrente Launches hinterlassen 0 Orphans (leaked=0)',
    inv3Leaked.length === 0,
    `leaked=${inv3Leaked.length} (${inv3Leaked.slice(0, 4).join(',')})`,
  );

  // ── INVARIANTE 4 (ADR-1/3/4): die drei verbleibenden Schreib-Races ────────
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // ADR-1: Epoch am ECHTEN Start. createResolver suspendiert an owned.close →
  // shutdown dazwischen → resume → KEINE Resurrection. epochTiming schaltbar.
  console.log('\n--- INVARIANTE 4 (ADR-1): Epoch am Start, keine Resurrection ---');
  {
    function makeAdapter(epochTiming) {
      let browser = null;
      let activePage = null;
      let launchEpoch = 0;
      const launched = [];
      async function createResolver(closeMs, launchMs, id) {
        let epoch;
        if (epochTiming === 'first') epoch = ++launchEpoch;
        if (browser) {
          const owned = browser;
          await delay(closeMs);
          owned.closed = true;
          if (browser === owned) {
            browser = null;
            activePage = null;
          }
        }
        if (epochTiming === 'first' && epoch !== launchEpoch) return null;
        if (epochTiming === 'late') epoch = ++launchEpoch;
        await delay(launchMs);
        const nb = { id, closed: false };
        launched.push(nb);
        if (epoch !== launchEpoch) {
          nb.closed = true;
          return null;
        }
        browser = nb;
        activePage = { id: id + '-page' };
        return activePage;
      }
      async function closeResolver() {
        launchEpoch++;
        const owned = browser;
        if (owned) owned.closed = true;
        if (browser === owned) {
          browser = null;
          activePage = null;
        }
      }
      return {
        createResolver,
        closeResolver,
        invalidateLaunches: () => {
          launchEpoch++;
        },
        get browser() {
          return browser ? browser.id : 'null';
        },
        leaked: () => launched.filter((b) => !b.closed && b.id !== browser?.id).length,
      };
    }
    async function scenario(epochTiming) {
      const a = makeAdapter(epochTiming);
      await a.createResolver(0, 5, 'SEED');
      const cr = a.createResolver(100, 5, 'L1'); // suspendiert an owned.close
      await delay(20);
      a.invalidateLaunches(); // shutdown DURING owned.close
      await a.closeResolver();
      await cr; // resume — buggy(late) resurrects
      return { browser: a.browser, leaked: a.leaked() };
    }
    const buggy = await scenario('late');
    const fixed = await scenario('first');
    check(
      'INV4(ADR-1): OHNE Epoch-am-Start resurrected ein Browser nach shutdown (Honest-Red)',
      buggy.browser === 'L1',
      `buggy-browser=${buggy.browser}`,
    );
    check(
      'INV4(ADR-1): MIT Epoch-am-Start keine Resurrection (browser=null)',
      fixed.browser === 'null',
      `fixed-browser=${fixed.browser}`,
    );
  }

  // ADR-3: zwei konkurrente init() → genau EIN kohaerenter page, kein
  // Doppel-Launch/Clobber. guardOn schaltbar (initPromise-Serialisierung).
  console.log('\n--- INVARIANTE 4 (ADR-3): init()-Serialisierung ---');
  {
    function makeInit(serialize) {
      let page = null;
      let initPromise = null;
      let launches = 0;
      async function createResolver() {
        launches++;
        await delay(20);
        return { id: 'page' + launches };
      }
      async function init() {
        if (page) return;
        if (serialize && initPromise) return initPromise;
        const thisInit = (async () => {
          const p = await createResolver();
          if (!serialize || initPromise === thisInit) page = p;
        })();
        if (serialize) initPromise = thisInit;
        try {
          await thisInit;
        } finally {
          if (initPromise === thisInit) initPromise = null;
        }
      }
      return {
        init,
        get page() {
          return page;
        },
        get launches() {
          return launches;
        },
      };
    }
    async function scenario(serialize) {
      const s = makeInit(serialize);
      await Promise.all([s.init(), s.init(), s.init()]); // 3 konkurrente init()
      return { launches: s.launches, page: s.page?.id };
    }
    const buggy = await scenario(false);
    const fixed = await scenario(true);
    check(
      'INV4(ADR-3): OHNE Serialisierung mehrfacher Launch (Honest-Red)',
      buggy.launches > 1,
      `buggy-launches=${buggy.launches}`,
    );
    check(
      'INV4(ADR-3): MIT Serialisierung genau EIN Launch, kohaerenter page',
      fixed.launches === 1 && !!fixed.page,
      `fixed-launches=${fixed.launches} page=${fixed.page}`,
    );
  }

  // ADR-3 (ENV-REAL Smoke): zwei konkurrente echte pipeline.init() → genau ein
  // Browser, leaked=0. (analyze ruft init() — wir feuern direkt init parallel.)
  console.log('\n--- INVARIANTE 4 (ADR-3 D): ENV-REAL konkurrente init() ---');
  await pipeline.shutdown(); // sauberer Ausgangszustand
  await delay(300);
  const initBefore = new Set(chromiumPids());
  await Promise.all([pipeline.init(), pipeline.init(), pipeline.init()]);
  const rInit = await pipeline.analyze(GOOD_SVG);
  check(
    'INV4(ADR-3 D): konkurrente init() → funktionsfaehiger Renderer (analyze ok)',
    !!rInit.structured && !rInit.prose.startsWith('Fehler:'),
    rInit.prose.slice(0, 40),
  );
  await pipeline.shutdown();
  await delay(800);
  const initAfter = new Set(chromiumPids());
  const initLeaked = [...initAfter].filter((pid) => !initBefore.has(pid));
  check(
    'INV4(ADR-3 D): konkurrente init() hinterlassen 0 Orphans (leaked=0)',
    initLeaked.length === 0,
    `leaked=${initLeaked.length} (${initLeaked.slice(0, 4).join(',')})`,
  );

  // ADR-4: recycle waehrend closeResolver → keine Page auf supersededem Browser.
  console.log('\n--- INVARIANTE 4 (ADR-4): recycle-Guard ---');
  {
    function makeAdapter(guardOn) {
      let browser = { id: 'B1' };
      let activePage = { id: 'P1', browser };
      let launchEpoch = 0;
      const pagesMade = [];
      async function recycle(newPageMs) {
        const owned = browser;
        const epoch = launchEpoch;
        activePage = null;
        const fresh = { id: 'P-fresh', browser: owned, closed: false };
        await delay(newPageMs); // newPage await — hier swap moeglich
        pagesMade.push(fresh);
        if (guardOn && (browser !== owned || epoch !== launchEpoch)) {
          fresh.closed = true; // superseded → frische Page schliessen
          return { error: 'LOAD_FAILED' };
        }
        activePage = fresh;
        return { ok: true };
      }
      async function swapBrowser() {
        launchEpoch++;
        browser = { id: 'B2' };
        activePage = { id: 'P2', browser };
      }
      return {
        recycle,
        swapBrowser,
        get activePageBrowser() {
          return activePage?.browser?.id;
        },
        leakedPages: () => pagesMade.filter((p) => !p.closed && p !== activePage).length,
      };
    }
    async function scenario(guardOn) {
      const a = makeAdapter(guardOn);
      const rec = a.recycle(100); // recycle laeuft (newPage 100ms)
      await delay(20);
      await a.swapBrowser(); // konkurrenter createResolver/closeResolver swap
      await rec;
      return { boundBrowser: a.activePageBrowser, leaked: a.leakedPages() };
    }
    const buggy = await scenario(false);
    const fixed = await scenario(true);
    check(
      'INV4(ADR-4): OHNE Guard bindet recycle Page an supersededen Browser (Honest-Red)',
      buggy.boundBrowser === 'B1',
      `buggy-boundBrowser=${buggy.boundBrowser}`,
    );
    check(
      'INV4(ADR-4): MIT Guard keine Page auf supersededem Browser (bleibt B2)',
      fixed.boundBrowser === 'B2' && fixed.leaked === 0,
      `fixed-boundBrowser=${fixed.boundBrowser} leaked=${fixed.leaked}`,
    );
  }

  // F-SVG-040: DESTRUKTIVE Haelfte des recycle-Guards. recycle suspendiert an
  // `activePage.close()` → konkurrenter createResolver/halfOpen installiert
  // frisches activePage P2 → recycle resume. MIT Guard: P2 bleibt erhalten (kein
  // Clobber), kein Leak. OHNE Guard: das destruktive `activePage = null` nullt P2
  // → P2 verwaist (geleakt). Distinkte Instanzen.
  console.log('\n--- INVARIANTE 4 (F-SVG-040): recycle destruktiver Guard ---');
  {
    function makeAdapter(guardDestructive) {
      let browser = { id: 'B1' };
      let activePage = { id: 'P1', browser, closed: false };
      let launchEpoch = 0;
      async function recycle(closeMs) {
        const owned = browser;
        const epoch = launchEpoch;
        const closingPage = activePage;
        await delay(closeMs); // activePage.close()-await — hier Swap moeglich
        closingPage.closed = true;
        // DESTRUKTIVE Haelfte: superseded-Check VOR dem Nullen.
        if (guardDestructive && (browser !== owned || epoch !== launchEpoch)) {
          return { error: 'LOAD_FAILED', superseded: true };
        }
        activePage = null; // OHNE Guard: clobbert ein konkurrent installiertes P2
        const fresh = { id: 'P-recycled', browser: owned, closed: false };
        if (browser !== owned || epoch !== launchEpoch) {
          fresh.closed = true;
          return { error: 'LOAD_FAILED' };
        }
        activePage = fresh;
        return { ok: true };
      }
      let p2 = null;
      function installP2() {
        launchEpoch++;
        browser = { id: 'B2' };
        p2 = { id: 'P2', browser, closed: false };
        activePage = p2;
      }
      return {
        recycle,
        installP2,
        get activePageId() {
          return activePage ? activePage.id : 'NULL';
        },
        p2Leaked: () => p2 && activePage !== p2, // P2 nicht mehr referenziert
      };
    }
    async function scenario(guardDestructive) {
      const a = makeAdapter(guardDestructive);
      const rec = a.recycle(100); // suspendiert an activePage.close (100ms)
      await delay(20);
      a.installP2(); // konkurrenter Op installiert P2 waehrend close-await
      const res = await rec;
      return {
        activePageId: a.activePageId,
        p2Leaked: a.p2Leaked(),
        superseded: !!res.superseded,
      };
    }
    const buggy = await scenario(false);
    const fixed = await scenario(true);
    check(
      'INV4(F-SVG-040): OHNE destruktiven Guard wird P2 geclobbert/geleakt (Honest-Red)',
      buggy.activePageId === 'NULL' && buggy.p2Leaked === true,
      `buggy-activePage=${buggy.activePageId} p2Leaked=${buggy.p2Leaked}`,
    );
    check(
      'INV4(F-SVG-040): MIT destruktivem Guard bleibt P2 erhalten (kein Clobber)',
      fixed.activePageId === 'P2' && fixed.p2Leaked === false && fixed.superseded,
      `fixed-activePage=${fixed.activePageId} p2Leaked=${fixed.p2Leaked} superseded=${fixed.superseded}`,
    );
  }

  // ── §HEAL-7/I: Orphan-Detektor-Logik-Probe (PPID-Scope, Mock-Tabelle) ──────
  // Beweist die Scoping-Logik DISKRIMINIEREND ohne Host-Abhaengigkeit:
  // (a) ein FREMDER chrome-headless-shell (PPID-Kette nicht am Test-Root)
  //     wird ignoriert (die false-RED-Klasse des Opus-Befunds),
  // (b) eigene Kind-PIDs (PPID-Kette) werden weiter gefangen,
  // (c) ein re-parenteter EIGENER Orphan (ppid → init nach Parent-Tod) bleibt
  //     via seenOwn gezaehlt, solange er lebt,
  // (d) tote eigene PIDs werden vergessen (PID-Reuse-Schutz),
  // (e) Fremde betreten seenOwn auch ueber wiederholte Sichtungen NIE.
  console.log('\n--- §HEAL-7/I: Orphan-Detektor PPID-Scoping (Logik-Probe) ---');
  {
    const ROOT_PID = 4000;
    const FOREIGN_BIN =
      '/home/fremd/.cache/ms-playwright/chrome-headless-shell-123/chrome-headless-shell --headless';
    const OWN_BIN =
      '/root/.cache/ms-playwright/chrome-headless-shell-999/chrome-headless-shell --headless';
    const row = (pid, ppid, args) => ({ pid, ppid, args });

    // (a) fremder Prozessname wird ignoriert (nicht in eigener PPID-Kette).
    const seenA = new Set();
    const tForeign = [
      row(1, 0, '/sbin/init'),
      row(ROOT_PID, 1, 'node tests/integration/test_breaker_recovery.mjs'),
      row(7777, 1, FOREIGN_BIN),
    ];
    check(
      'I(a): fremder chrome-headless-shell (PPID-Kette fremd) wird IGNORIERT',
      ownChromiumPids(tForeign, ROOT_PID, seenA).length === 0,
      `got ${JSON.stringify(ownChromiumPids(tForeign, ROOT_PID, seenA))}`,
    );

    // (b) eigene Kind-Kette (Browser + Helper) wird gefangen.
    const seenB = new Set();
    const tOwn = [
      row(1, 0, '/sbin/init'),
      row(ROOT_PID, 1, 'node tests/integration/test_breaker_recovery.mjs'),
      row(4100, ROOT_PID, OWN_BIN),
      row(4101, 4100, `${OWN_BIN} --type=gpu-process`),
      row(7777, 1, FOREIGN_BIN), // fremd, gleichzeitig present
    ];
    check(
      'I(b): eigene Kind-PIDs (PPID-Kette) werden gefangen, Fremde nicht',
      JSON.stringify(ownChromiumPids(tOwn, ROOT_PID, seenB)) ===
        JSON.stringify([4100, 4101]),
      `got ${JSON.stringify(ownChromiumPids(tOwn, ROOT_PID, seenB))}`,
    );

    // (c) Reparenting: Parent 4100 tot, Helfer 4101 lebt mit ppid=1 weiter —
    //     bleibt via seenOwn gezaehlt (echter eigener Orphan-Leak).
    const tReparented = [
      row(1, 0, '/sbin/init'),
      row(ROOT_PID, 1, 'node tests/integration/test_breaker_recovery.mjs'),
      row(4101, 1, `${OWN_BIN} --type=gpu-process`),
      row(7777, 1, FOREIGN_BIN),
    ];
    check(
      'I(c): re-parenteter EIGENER Orphan bleibt gezaehlt (seenOwn-Gedaechtnis)',
      JSON.stringify(ownChromiumPids(tReparented, ROOT_PID, seenB)) ===
        JSON.stringify([4101]),
      `got ${JSON.stringify(ownChromiumPids(tReparented, ROOT_PID, seenB))}`,
    );

    // (d) tot ⇒ vergessen (PID-Reuse-Schutz): 4101 verschwindet aus der Tabelle.
    const tAllDead = [
      row(1, 0, '/sbin/init'),
      row(ROOT_PID, 1, 'node tests/integration/test_breaker_recovery.mjs'),
      row(7777, 1, FOREIGN_BIN),
    ];
    check(
      'I(d): tote eigene PIDs werden vergessen (leak=0 nach echtem Reap)',
      ownChromiumPids(tAllDead, ROOT_PID, seenB).length === 0 &&
        !seenB.has(4101),
      `got ${JSON.stringify([...seenB])}`,
    );

    // (e) Fremde betreten seenOwn NIE (auch nach wiederholten Sichtungen).
    check(
      'I(e): fremder Prozess betritt seenOwn NIE (kein Drift ueber Zeit)',
      !seenA.has(7777) && !seenB.has(7777),
      `seenA=${JSON.stringify([...seenA])} seenB=${JSON.stringify([...seenB])}`,
    );
  }

  process.exit(fails === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error('UNCAUGHT:', e);
  process.exit(1);
});
