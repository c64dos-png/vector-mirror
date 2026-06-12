/**
 * pipeline.js - Orchestrator for Vector Mirror v2.0
 * Migrated from index.js (v1.6) + parseConstraints from mirror.js
 *
 * Connects: Renderer -> Grid -> Constraints -> Diff -> Arbitrate -> Emitter
 * Phase 2: analyze/compare return { prose, structured }, new: inspect, palette, meta
 * DEPENDS: adapters/renderer/playwright, core/grid, core/constraints, core/diff,
 *          core/arbitrate, adapters/emitter/prose, adapters/emitter/structured
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Mutex } from 'async-mutex';
import {
  formatArrangeReport,
  formatErrorWithLoss,
  formatReport,
} from './adapters/emitter/prose.js';
import {
  formatInspectStructured,
  formatPaletteStructured,
  formatStructured,
} from './adapters/emitter/structured.js';
import {
  __probeFrozenGeometryAt,
  closeResolver,
  createResolver,
  invalidateLaunches,
  measureViewportDivergence,
  resolve,
  setDeadSignal,
} from './adapters/renderer/playwright.js';
import { arbitrate } from './core/arbitrate.js';
import {
  arrangeConstraint,
  checkConstraint,
  isRegistered,
  listConstraints,
  requiresReference,
} from './core/constraints/registry.js';
import {
  bboxTrustedForVerdict,
  classifyCanvas,
  gateCorrections,
} from './core/honesty.js';
import './core/constraints/loader.js'; // Side-effect: registers all constraints
import { computeDiff } from './core/diff.js';
import { mapToGridMap } from './core/grid.js';
import {
  createBreaker,
  createRenderOnce,
  getBreakerStats,
  isOurError,
  livenessPing,
} from './lib/breaker.js';
import { buildTransform, hasTranslateTransform } from './lib/transforms.js';

let page = null;
let renderBreaker = null;

// §1.7 ADR-3: init()-Serialisierung. Zwei konkurrente Erst-Requests (beide
// sehen `!page`) wuerden sonst je ein createResolver feuern und `page`
// gegenseitig clobbern (einer evtl. mit null/superseded). `initPromise` teilt
// EINEN in-flight init ueber alle konkurrenten Aufrufer → genau ein Launch,
// kein Clobber, kein Doppel-Browser. Nach Settle wird es genullt, sodass ein
// Re-Init nach shutdown frisch laufen kann (dominierende Loesung statt
// verstreuter Assignment-Guards).
let initPromise = null;

// §1.7 Breaker-Recovery State (browser-gebunden).
// restartPromise (P1, LOAD-BEARING): on('halfOpen') startet den Browser-Restart
// und legt ihn HIER ab; fireResolve awaitet ihn (gegated, bounded) VOR dem
// Render. Opossum 9 awaitet den halfOpen-Handler NICHT — ohne dieses Gate
// feuert die Probe gegen einen noch nicht fertig gestarteten Browser und
// reopent (an internal spec p4). Bounded via Promise.race-Timeout → ehrlicher
// Fehler statt Hang (Blind-Trust, REGEL-8).
let restartPromise = null;

// consecutiveReopens (P3): Reopen-Loop-Schutz. on('open')++ , on('close')=0.
// Bei >2 aufeinanderfolgenden Reopens wird breaker.options.resetTimeout
// exponentiell verdoppelt (Cap 300000ms = 5min). Empirisch (an internal spec
// p3-probe): Opossum 9.0.0 liest options.resetTimeout im _startTimer FRISCH
// → Laufzeit-Mutation greift fuer den NAECHSTEN open-Zyklus. Daher reicht die
// dynamische Mutation; KEINE Breaker-Rekonstruktion / kein externer Timer noetig.
let consecutiveReopens = 0;

// §1.7 Restart-Timeout-Bound (Blind-Trust): chromium.launch hat KEIN
// Default-Timeout-Reject. Laeuft der Restart in diesen Bound, rejected das Gate
// → fireResolve liefert einen ehrlichen LOAD_FAILED-Pfad statt zu haengen.
const RESTART_TIMEOUT_MS = 15000;

// §1.7 P5 Komposition (Bulkhead + Queue): capacity:1 macht den Opossum-
// Semaphore reject-on-full (circuit.js nutzt semaphore.test(), NICHT die
// queuing-take()) — der 2. KONKURRENTE fire wuerde sonst hart mit ESEMLOCKED
// abgewiesen. Der Singleton-Browser braucht aber Serialisierung, nicht
// Rejection legitimer Aufrufer: dieser Pipeline-Mutex QUEUET konkurrente
// fireResolve-Aufrufe, sodass der Breaker IMMER genau einen fire zur Zeit
// sieht. Effekt: capacity:1 bleibt als Defense-in-Depth (P5 erfuellt) aktiv,
// trippt aber unter normaler Last nicht; parallele analyze()-Aufrufe laufen
// korrekt serialisiert durch (kein Cross-Page-Wettlauf, alle liefern Output).
// Aequivalent/komplementaer zum pageMutex im Adapter (der setContent+evaluate
// serialisiert) — hier eine Ebene hoeher, VOR dem Breaker-Gate.
const fireMutex = new Mutex();

// §1.7 Backoff-Basis + Cap. Test-only via __setBreakerOpts ueberschreibbar.
const BACKOFF_BASE_MS = 30000;
const BACKOFF_CAP_MS = 300000; // 5 min

// §1.7 Test-only: Breaker-Optionen fuer schnelle State-Transitions im
// Integrations-/Recovery-Test (analog __setRecycleAfter/__setMaxGrids). Wird
// VOR init() gesetzt; init() reicht sie an createBreaker durch.
let breakerOptsOverride = null;
export function __setBreakerOpts(opts) {
  breakerOptsOverride = opts && typeof opts === 'object' ? opts : null;
}
/** Test-only: aktueller resetTimeout + consecutiveReopens (Backoff-Verifikation). */
export function __getRecoveryState() {
  return {
    consecutiveReopens,
    resetTimeout: renderBreaker ? renderBreaker.options.resetTimeout : null,
    restartPending: restartPromise !== null,
  };
}

// §1.1 Stateless RPC: Map<analysisId, gridMap> haelt alle Snapshots. Kein
// impliziter „letzter" Modul-State — compare benoetigt explizite analysisId.
// Insertion-order LRU: Map.keys().next().value = oldest entry; eviction bei size >= maxGrids.
const grids = new Map();

/** Plan §1.3 Schicht 2: Bound die Anzahl gespeicherter Grid-States.
 *  Konsistenz mit RECYCLE_AFTER aus playwright.js. */
export const MAX_GRIDS = 20;
let maxGrids = MAX_GRIDS;

/** Test-only API: lower the cap to make Eviction-Logik isoliert prüfbar
 *  (analog __setRecycleAfter in renderer/playwright.js). */
export function __setMaxGrids(n) {
  maxGrids = n;
}

// §1.4 Globale Bookmarks (B-3, O1): benannte langlebige Snapshots für Sniper-Loop.
// Eigener Namespace, getrennt von grids (UUID-keyed, kurzlebig). Speichert
// {gridMap, analysisId} damit compare-Output die UUID-Server-Garantie (§1.3) hält.
const bookmarks = new Map();
export const MAX_BOOKMARKS = 10;
let maxBookmarks = MAX_BOOKMARKS;
export function __setMaxBookmarks(n) {
  maxBookmarks = n;
}

// §1.9 Eichkörper-Selftest: letzter Kalibrierungs-Stand (Modul-State). Wird von
// runSelftest() gesetzt und von getStatus() gelesen (status.calibration). Bleibt
// null bis der erste Selftest läuft; der Server-Start-Auto-Selftest (fire-and-
// forget nach connect) setzt 'PENDING' VOR dem Lauf, dann PASS/FAIL danach.
// REGEL-3: rein deskriptiver Mess-Stand, kein LLM-Content.
let lastCalibration = null;

/**
 * Initializes the persistent browser instance and circuit-breaker.
 *
 * P1-03 (VM-SM-002): Nach createResolver() wird ein Liveness-Ping ausgefuehrt
 * (Crash-Detection vor erstem Render) und der Breaker um createRenderOnce(resolve)
 * verkabelt. Die DI-Verkabelung haelt den Hexagonal-Vertrag von lib/breaker.js
 * (keine adapters/-Imports dort).
 */
export async function init() {
  // §1.7 ADR-3: konkurrente init() teilen EINEN in-flight Launch (kein Race auf
  // `page`). Laeuft bereits ein init, awaiten alle Aufrufer dasselbe Promise.
  if (page && renderBreaker) return;
  if (initPromise) return initPromise;

  // thisInit (reference-guard, analog halfOpen myRestart): nur DIESER init darf
  // page/renderBreaker setzen. Ein konkurrentes shutdown nullt initPromise →
  // `initPromise === thisInit` ist dann false → die Zuweisungen unterbleiben,
  // KEINE Pipeline-State-Resurrection nach shutdown.
  const thisInit = (async () => {
    if (!page) {
      let p;
      try {
        p = await createResolver();
      } catch (err) {
        throw new Error(`Browser-Start fehlgeschlagen: ${err.message}`);
      }
      // §1.7 ADR-3: createResolver kann `null` liefern (adapter-seitig
      // superseded — z.B. konkurrentes shutdown bumpte den Epoch). Dann ist KEIN
      // Browser gestartet → ehrlicher Fehler statt livenessPing(null).
      if (!p) {
        throw new Error('Browser-Start superseded (kein Renderer verfuegbar)');
      }
      // nur setzen wenn DIESER init noch aktuell ist (kein shutdown dazwischen).
      if (initPromise !== thisInit) {
        // superseded durch shutdown: die frische Page gehoert einem Browser, den
        // closeResolver/invalidateLaunches bereits invalidiert hat → nicht
        // installieren (Adapter-Epoch raeumt den Browser; hier kein State-Set).
        return;
      }
      try {
        await livenessPing(p);
      } catch (err) {
        throw new Error(`Browser-Start fehlgeschlagen: ${err.message}`);
      }
      if (initPromise !== thisInit) return;
      page = p;
    }
    if (!renderBreaker && initPromise === thisInit) {
      renderBreaker = createBreaker(
        createRenderOnce(resolve),
        breakerOptsOverride || {},
      );
      wireRecovery(renderBreaker);
    }
  })();
  initPromise = thisInit;

  try {
    await thisInit;
  } finally {
    // nur den eigenen Eintrag aufraeumen (ein konkurrentes shutdown koennte
    // initPromise bereits genullt/ersetzt haben).
    if (initPromise === thisInit) initPromise = null;
  }
}

/**
 * §1.7 Breaker-Recovery-Verkabelung (einmalig pro Breaker-Instanz, in init()
 * nach createBreaker). Komponiert die kohaerente Kette aus an internal spec §3:
 *
 *   on('open')     → CLEANUP: closeResolver() (schliesst Browser+Page, nullt
 *                    Vars). Plus consecutiveReopens++ und (bei >2) exponentieller
 *                    resetTimeout-Backoff (P3, Opossum-options-Mutation).
 *   on('halfOpen') → RESTART: restartPromise = createResolver() (idempotent,
 *                    F-SVG-033) + livenessPing. KEIN await im Handler noetig
 *                    (Opossum awaitet ihn nicht); das Promise ist der Sync-Punkt.
 *   on('close')    → consecutiveReopens = 0 (Reset bei erfolgreicher Recovery).
 *
 * fireResolve() awaitet restartPromise (bounded) VOR renderBreaker.fire → die
 * erste echte fire nach halfOpen IST die Probe, gegated bis der Browser steht.
 *
 * P4-DI: setDeadSignal verkabelt die adapter-seitigen crash/disconnected-
 * Listener mit einem aktiven Failure-Pfad — OHNE dass lib/breaker.js oder die
 * Pipeline einen Playwright-Listener direkt halten (Hexagonal). Das Dead-Signal
 * markiert den Browser bereits adapter-intern als tot (resolve→LOAD_FAILED);
 * dieser Callback dient der Observability/Reaktivitaet (kein Breaker-Import).
 */
function wireRecovery(breaker) {
  // Backoff-Basis = der konfigurierte resetTimeout des Breakers (haelt das
  // Test-Override konsistent), gedeckelt durch BACKOFF_BASE_MS-Default.
  const baseResetTimeout = breaker.options.resetTimeout || BACKOFF_BASE_MS;

  breaker.on('open', () => {
    consecutiveReopens++;
    // CLEANUP: toten Browser schliessen (primaere Schliessung). closeResolver
    // ist idempotent + wirft nicht (on('open') darf nie eine Exception werfen).
    // Fire-and-forget: der Listener ist synchron; das await im Promise laeuft
    // im Hintergrund, die nachfolgende createResolver-Idempotenz ist der
    // Sicherheitsgurt falls dieser cleanup noch nicht fertig ist.
    closeResolver().catch(() => {});
    page = null;

    // P3 Backoff: ab dem 3. Reopen resetTimeout exponentiell verdoppeln (Cap
    // 5min). Opossum liest options.resetTimeout frisch beim naechsten Timer.
    if (consecutiveReopens > 2) {
      const exp = consecutiveReopens - 2; // 1,2,3,...
      const next = Math.min(baseResetTimeout * 2 ** exp, BACKOFF_CAP_MS);
      breaker.options.resetTimeout = next;
    }
  });

  breaker.on('halfOpen', () => {
    // RESTART: frischen Browser starten und in restartPromise legen. KEIN await
    // hier (Opossum awaitet den Handler nicht); fireResolve gated darauf.
    //
    // §1.7 EPOCH-MODELL (Pipeline-Seite): die Zuweisung `page = p` und das
    // `restartPromise = null` im finally sind reference-guarded gegen `myRestart`
    // — nur der AKTUELLE Restart darf `page` setzen oder den restartPromise
    // loeschen. So kann ein spaet fertig werdendes (superseded) L1 weder `page`
    // ueberschreiben noch einen neueren restartPromise (L2) abraeumen. Liefert
    // createResolver `null` (adapter-seitig superseded), wird `page` NICHT
    // angefasst (und livenessPing NICHT auf null gerufen).
    const myRestart = (async () => {
      const p = await createResolver(); // idempotent (F-SVG-033) | null=superseded
      if (p && restartPromise === myRestart) {
        page = p;
        await livenessPing(page);
      }
    })().finally(() => {
      if (restartPromise === myRestart) restartPromise = null;
    });
    restartPromise = myRestart;
    // unhandled-rejection vermeiden: das Gate in fireResolve faengt den Fehler;
    // hier zusaetzlich ein no-op-catch, falls KEIN fire die Probe konsumiert.
    myRestart.catch(() => {});
  });

  breaker.on('close', () => {
    consecutiveReopens = 0;
    breaker.options.resetTimeout = baseResetTimeout; // Backoff zuruecksetzen
  });

  // P4-DI: aktives Crash/Disconnect-Signal. Reiner Observability-Hook — der
  // Adapter markiert den Browser bereits selbst tot (browserDead → LOAD_FAILED);
  // der Breaker zaehlt das ueber den naechsten fire. Kein direkter Breaker-Call
  // noetig (haelt die Hexagonal-Boundary; aktives breaker.open() waere ein
  // Cross-Layer-Vertragsbruch-Risiko).
  setDeadSignal(() => {
    // Bewusst minimal: das Dead-Flag im Adapter ist die Wahrheit. Ein hartes
    // breaker.open() hier wuerde den volumeThreshold-Pfad umgehen und ist
    // nicht noetig — der naechste fire liefert LOAD_FAILED und zaehlt.
  });
}

/**
 * Shuts down the browser instance and seals the circuit-breaker.
 * Nach shutdown() rejected `breaker.fire()` mit ESHUTDOWN — das verhindert
 * Renders gegen eine geschlossene Page.
 */
export async function shutdown() {
  if (renderBreaker) {
    renderBreaker.shutdown();
    renderBreaker = null;
  }
  // §1.7: P4-DI-Callback abkoppeln, damit ein spaeter feuerndes disconnected-
  // Event (durch das close unten) nicht in einen toten Pipeline-State signalt.
  setDeadSignal(null);
  // §1.7 EPOCH-MODELL: alle in-flight createResolver-Launches invalidieren, damit
  // ein nach shutdown fertig werdender Launch KEINEN Browser/Page wiederherstellt
  // (er sieht epoch !== launchEpoch → schliesst sich selbst, kein State-Eingriff).
  // closeResolver() bumpt den Epoch ebenfalls; invalidateLaunches() VOR dem
  // restartPromise-Detach macht die Reihenfolge explizit und deckt den Fall ab,
  // dass kein closeResolver-Pfad mehr laeuft.
  invalidateLaunches();
  // §1.7 ADR-3: einen in-flight init invalidieren — `initPromise = null` macht
  // dessen `initPromise === thisInit`-Guard false → er installiert weder page
  // noch renderBreaker nach diesem shutdown (keine Pipeline-Resurrection). Der
  // Adapter-Epoch (invalidateLaunches) raeumt den dabei gestarteten Browser.
  initPromise = null;
  // §1.7: laufenden Restart abwarten/verwerfen — ein noch nicht resolvtes
  // restartPromise darf keine Page gegen den gerade geschlossenen Browser
  // halten. closeResolver ist idempotent; restartPromise wird verworfen.
  restartPromise = null;
  consecutiveReopens = 0;
  await closeResolver();
  page = null;
  grids.clear();
  bookmarks.clear();
}

/**
 * Internes Helper: ruft den Breaker auf und mappt sowohl
 * Breaker-eigene Fehler (EOPENBREAKER/ETIMEDOUT/ESHUTDOWN/ESEMLOCKED) als auch
 * geworfene Browser-Fehler in die `{ error, message }`-Form, die alle Aufrufer
 * bereits mit `if (resolved.error) return ...` behandeln.
 *
 * USER-Fehler (INVALID_INPUT, SVG_TOO_LARGE, ...) werden von `renderOnce`
 * NICHT geworfen, sondern als regulaerer Return durchgereicht — sie kommen
 * unveraendert hier zurueck (siehe breaker.js Issue #564 Pitfall).
 */
async function fireResolve(svgString) {
  // §1.7 P5: konkurrente fireResolve-Aufrufe SERIALISIEREN (fireMutex queuet),
  // damit der capacity:1-Breaker immer genau einen fire sieht und legitime
  // parallele Aufrufer NICHT mit ESEMLOCKED abgewiesen werden (opossum
  // semaphore.test() ist reject-on-full, kein queue). Der Probe-Gate +
  // Breaker-fire laufen atomar pro Aufruf innerhalb des Locks.
  return fireMutex.runExclusive(async () => {
    // §1.7 P1 Probe-Gate (LOAD-BEARING): laeuft gerade ein halfOpen-Browser-
    // Restart, MUSS er fertig sein, BEVOR die Probe-fire rendert — sonst probt
    // Opossum gegen einen halb gestarteten Browser und reopent (an internal spec p4).
    // Bounded via Promise.race-Timeout: ein haengender chromium.launch fuehrt
    // zu einem EHRLICHEN Fehler (LOAD_FAILED), NICHT zu einem Hang (Blind-
    // Trust, REGEL-8). Bei Restart-Fehler bleibt der Browser tot → fire liefert
    // LOAD_FAILED → Breaker bleibt/wird open → EOPENBREAKER (ehrlich).
    if (restartPromise) {
      const pending = restartPromise;
      let timer;
      const bound = new Promise((_, rej) => {
        timer = setTimeout(() => {
          const e = new Error('Browser-Restart Timeout');
          e.code = 'LOAD_FAILED';
          rej(e);
        }, RESTART_TIMEOUT_MS);
      });
      try {
        await Promise.race([pending, bound]);
      } catch {
        // §1.7 Invariante 1 (HIGH): ein Restart, der den Bound ueberschreitet,
        // darf die Recovery NICHT stallen. Das haengende restartPromise wird
        // ABGEKOPPELT (nur falls es noch DAS hier gewartete ist — ein
        // zwischenzeitlich neu gesetztes nicht ueberschreiben), sodass das Gate
        // kuenftige fires nicht weiter blockiert. KEIN early return — wir fallen
        // zu renderBreaker.fire DURCH: die fire trifft eine noch-nicht-fertige
        // (null/stale) page → renderOnce wirft NO_PAGE/LOAD_FAILED (kind=BROWSER)
        // → der Breaker ZAEHLT die fehlgeschlagene Probe → reopen → on('open')
        // rueckt consecutiveReopens/Backoff vor und startet einen frischen
        // Restart. Ein spaeterer erfolgreicher Restart recovert dann ehrlich.
        // Das haengende `pending` laeuft im Hintergrund weiter aus (sein
        // .finally nullt restartPromise; createResolver-Idempotenz raeumt einen
        // evtl. doch noch startenden Browser beim naechsten Restart ab).
        if (restartPromise === pending) restartPromise = null;
        pending.catch(() => {}); // kein unhandled-rejection auf das abgekoppelte
      } finally {
        clearTimeout(timer);
      }
    }

    try {
      return await renderBreaker.fire(page, svgString);
    } catch (err) {
      if (isOurError(err)) {
        const code = err.code || 'BREAKER_ERROR';
        const message =
          code === 'EOPENBREAKER'
            ? 'Browser-Renderer temporaer nicht verfuegbar (Circuit open)'
            : code === 'ETIMEDOUT'
              ? `Render-Timeout ueberschritten: ${err.message}`
              : code === 'ESHUTDOWN'
                ? 'Renderer ist abgeschaltet'
                : code === 'ESEMLOCKED'
                  ? 'Concurrency-Limit erreicht'
                  : err.message;
        return { error: code, message };
      }
      // Browser-Fehler aus renderOnce (kind === 'BROWSER')
      return { error: err.code || 'LOAD_FAILED', message: err.message };
    }
  });
}

/**
 * Parses constraint strings into structured objects.
 * Migrated from mirror.js:6-22 (ADR C-5: lives in pipeline, not registry)
 *
 * §H10 R11-21 PARSE-VERWEIGERUNG (O1): ein Constraint-String, der nicht
 * VOLLSTAENDIG konsumiert gegen die Grammatik `#subjekt TYP [#referenz] [wert]`
 * parst, wird nicht interpretiert, sondern sichtbar verweigert — er liefert
 * einen CONSTRAINT_UNPARSEABLE-Marker (raw + problem) statt eines fabrizierten
 * Pseudo-Constraints. Vier frühere Stille-Mechanismen fallen damit:
 *   1. kein stiller Total-Drop mehr (1:1-Bilanz Input-Strings ↔ Eintraege),
 *   2. kein „Alles-ist-ein-Typ" mehr (TYP-Token = GROSSBUCHSTABEN/Bindestrich;
 *      Garbage-Prosa wie 'garbage no hashes' wird nicht uminterpretiert —
 *      unbekannte, aber typ-foermige Tokens wie CENTRD-IN parsen weiter und
 *      behalten den CONSTRAINT_TYPE_UNKNOWN+Vorschlag-Pfad),
 *   3. keine verschluckten Rest-Tokens mehr ('… 3 extra'),
 *   4. keine Wert-Fabrikation mehr (nicht-numerischer DISTANCE-Wert →
 *      Verweigerung; fehlender Wert behaelt den Grammatik-Default 1).
 * Grammatikkonforme Strings parsen byte-identisch zur bisherigen Form.
 */
const CONSTRAINT_GRAMMAR_HINT = "Grammatik: '#subjekt TYP [#referenz] [wert]'";
// Echo-Hygiene (§H9-Vorbild prose.js#sanitizeValueEcho): der Roh-String ist
// Fremdtext — Whitespace ist durch split bereits kollabiert, Anführungszeichen
// neutralisieren, Länge kappen. Ein gekürztes Echo ist ehrlich markiert (…).
function constraintEcho(parts) {
  const flat = parts.join(' ').replace(/"/g, "'");
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
}

export function parseConstraints(strings) {
  if (!Array.isArray(strings)) return [];
  return strings.map((str) => {
    const parts = String(str).trim().split(/\s+/);
    if (parts[0]?.toUpperCase() === 'CONSTRAINT') parts.shift();
    const refuse = (problem) => ({
      type: 'CONSTRAINT_UNPARSEABLE',
      raw: constraintEcho(parts),
      problem,
    });
    const cleanId = (s) => s?.replace(/^#/, '') || null;
    const subject = cleanId(parts[0]);
    if (!subject) return refuse('kein Subjekt-Token');
    const type = parts[1];
    if (type === undefined) return refuse('kein Typ-Token');
    if (!/^[A-Z][A-Z-]*$/.test(type))
      return refuse(
        `'${parts[1]}' ist kein Typ-Token (GROSSBUCHSTABEN/Bindestrich)`,
      );
    // Totale Konsumption: DISTANCE-FROM konsumiert 4 Tokens, alle anderen
    // Formen maximal 3 — jedes weitere Token macht den String unparsebar.
    const maxTokens = type === 'DISTANCE-FROM' ? 4 : 3;
    if (parts.length > maxTokens)
      return refuse(
        `Rest-Token nicht konsumiert: '${parts.slice(maxTokens).join(' ')}'`,
      );
    if (type === 'DISTANCE-FROM') {
      // §H10 P2 (Patch-Runde): STRIKTER Numerik-Token, symmetrisch zum
      // TYP-Regex oben. parseFloat teilinterpretierte '0x10'→0 (bewiesenes
      // Falsch-PASS: Distanz ≥ 0 ist immer wahr), '3px'→3, '1.2.3'→1.2 und
      // akzeptierte non-finites ('Infinity'). Akzeptiert wird NUR der
      // vollständige finite Dezimal-Match; alles andere läuft sichtbar in
      // die bestehende Verweigerungs-Schiene. FEHLENDER Wert behält den
      // Grammatik-Default 1 (Kontroll-Pin R11-21).
      if (parts[3] !== undefined && !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(parts[3]))
        return refuse(`DISTANCE-FROM-Wert '${parts[3]}' ist nicht numerisch`);
      return {
        type,
        subject,
        reference: cleanId(parts[2]),
        value: parts[3] === undefined ? 1 : parseFloat(parts[3]),
      };
    }
    if (type === 'COLOR') {
      return {
        type,
        subject,
        reference: null,
        value: parts[2]?.toLowerCase(),
      };
    }
    if (type === 'FILL') {
      return { type, subject, reference: null };
    }
    return { type, subject, reference: cleanId(parts[2]) };
  });
}

/**
 * §H10 R11-21: EINE Wortlaut-Quelle für die Verweigerungs-Meldung
 * (checkAllConstraints-detail + arrange-warning — Kanal-Parität).
 */
function unparseableDetail(c) {
  return `Constraint nicht parsebar: "${c.raw}" — ${c.problem}`;
}

/**
 * §HEAL-5 (F-AT-2-005): Subjekt-Ehrlichkeits-Klassifikator für die VERDIKT-Wache
 * in checkAllConstraints. Das System trägt zwei Ehrlichkeits-Ebenen — Element
 * (Flags, vollständig bis MCP durchgereicht) und Verdikt (pass/reasonCode) —
 * und die einzige generische Kopplung war FAILING-seitig (gateCorrections).
 * Für PASS-Verdikte existierte KEINE Schiene (Verdikt-Vertrag aus der
 * v1.6-Vor-Flag-Ära): clean-PASS über einem 0-Pixel- oder zeit-varianten
 * Subjekt = stille Lüge (Boden-Wahrheit 4c8a6ed, P3/P4).
 *
 * Klassen (Spec heal_verdict_motion Edit #3):
 *   HART        — subj.paint_visible === false (bewiesen 0 Tinte, exaktes false,
 *                 NICHT 'indeterminate') → SUBJECT_NOT_PAINTED.
 *   WEICH-AKTIV — subj.motion_dependent === true (clock-rooted SMIL-GEOMETRIE,
 *                 t0-Messung exakt, an anderem t anders) → SUBJECT_TIME_VARIANT.
 *   WEICH-VORBEREITET, DEAKTIVIERT — paint_visible 'indeterminate' ·
 *                 state_dependent · media_dependent: der Klassifikator KENNT
 *                 sie, aktiviert sie NICHT (0 Falsch-Vorbehalte, Kanon-
 *                 Stabilität — registriertes Residuum; Aktivierung wäre
 *                 Kanon-Drift ohne bewiesenen Bedarf).
 *
 * Liefert { reasonCode, rider } oder null (kein Vorbehalt). HART dominiert
 * WEICH (ein paint-totes UND zeit-variantes Subjekt → SUBJECT_NOT_PAINTED).
 */
// §H10 R11-06: Paint-Domäne der Constraint-Typen — NUR diese Verdikte hängen
// an der Paint-Wahrheit des Subjekts; Geometrie-Constraints auf einem rein
// paint-zeit-varianten Subjekt bleiben messbar wahr (INSIDE auf Blinker: die
// Geometrie IST zeitinvariant — eine messbare Wahrheit wird nicht verweigert).
// §H10 P4: NUR COLOR — FILL ist arrange-only (fill.js#check ⇒ immer pass:null,
// pass===true ist unerreichbar; eine FILL-Zelle hier wäre toter Ballast).
const PAINT_DOMAIN_CONSTRAINTS = new Set(['COLOR']);

function classifySubjectHonesty(subj, constraintType) {
  if (!subj) return null;
  if (subj.paint_visible === false) {
    return { reasonCode: 'SUBJECT_NOT_PAINTED', rider: 'Subjekt malt 0 Pixel' };
  }
  // §H10 R11-07 (O-A): dritte Wache-Klasse — eine bbox, der das System SELBST
  // misstraut (not_measurable: 3D-Transform / Non-SMIL-Motion), darf kein
  // grünes Verdikt tragen. Die Entscheidungs-Semantik wohnt in honesty.js
  // (REGEL-4/W1b-Pin: bboxTrustedForVerdict — Schwester von allowDeltas, das
  // failing-seitig längst jede Pixel-Korrektur verweigert). EIN Prinzip: was
  // keine Korrektur tragen darf, trägt auch kein PASS. Präzedenz: HART paint
  // > not_measurable > time_variant. 'approximate' bleibt bewusst PASS-fähig
  // (Anti-Über-Gaten: die Zahl ist annähernd wahr).
  if (!bboxTrustedForVerdict(subj.bbox_reliability)) {
    const causes = Array.isArray(subj.warnings)
      ? subj.warnings.filter((w) =>
          ['3D_TRANSFORM_ANCESTOR', 'NON_DETERMINISTIC_MOTION'].includes(w),
        )
      : [];
    return {
      reasonCode: 'SUBJECT_NOT_MEASURABLE',
      rider: `Subjekt-bbox not_measurable${causes.length ? ` (${causes.join(', ')})` : ''}`,
    };
  }
  if (subj.motion_dependent === true) {
    return {
      reasonCode: 'SUBJECT_TIME_VARIANT',
      rider: 'geprüft @t0, Subjekt-Geometrie zeit-variant',
    };
  }
  // §H10 R11-06 (Option A): Paint-Zeit-Achse — ein paint-zeit-variantes
  // Subjekt (clock-rooted SMIL auf fill/opacity/…) degradiert NUR Paint-
  // Domänen-Verdikte (COLOR): die @t0-Farbe ist exakt, aber an anderem t
  // anders — ein clean PASS wäre die stille Blinker-Lüge. reasonCode
  // SUBJECT_TIME_VARIANT WIEDERVERWENDET (gleiche Zeit-Achsen-Klasse),
  // Rider paint-spezifisch.
  if (
    subj.paint_time_variant === true &&
    PAINT_DOMAIN_CONSTRAINTS.has(constraintType)
  ) {
    return {
      reasonCode: 'SUBJECT_TIME_VARIANT',
      rider: 'geprüft @t0, Subjekt-Paint zeit-variant (SMIL auf Paint-Kanal)',
    };
  }
  return null;
}

/**
 * Checks all constraints against gridMap using the Registry.
 * ADR-022: ctx = { grid, value? }
 * Returns enriched results with constraintType + reference for structured output.
 */
export function checkAllConstraints(constraints, gridMap) {
  // §HEAL-7/B (F-TF-003): id-Häufigkeit EINMAL über die Szene zählen (Muster
  // §HEAL-4 measureMediaStep R3, pl:816ff — Duplikat-IDs sind nicht
  // attribuierbar, kein Raten).
  const idCount = new Map();
  for (const e of gridMap.elements) {
    idCount.set(e.id, (idCount.get(e.id) || 0) + 1);
  }
  return constraints.map((c) => {
    // §H10 R11-21 PARSE-VERWEIGERUNG (O1, Muster der Duplikat-ID-Wache unten):
    // ein nicht (vollständig) parsebarer String wird nicht gemessen, sondern
    // sichtbar verweigert — pass:null auf der existierenden unchecked-Schiene,
    // reasonCode am Ursprung (D-004). hint trägt die Navigation (Grammatik).
    if (c.type === 'CONSTRAINT_UNPARSEABLE') {
      return {
        pass: null,
        reasonCode: 'CONSTRAINT_UNPARSEABLE',
        reasonCategory: 'SPECIFICATION',
        detail: unparseableDetail(c),
        hint: `${unparseableDetail(c)}. ${CONSTRAINT_GRAMMAR_HINT}`,
      };
    }
    // §HEAL-7/B DUPLIKAT-ID-EHRLICHKEIT (F-TF-003, Boden-Wahrheit f003): bei
    // ambigem subject/ref (id N-fach in der Szene) maß .find() bisher STILL
    // den ERSTEN Namensvetter und emittierte eine Korrektur, die die Prosa an
    // ALLE Namensvettern heftete — ein Verdikt über ein nie eindeutig
    // benanntes Element. Messung VERWEIGERN statt raten: pass:null +
    // MEASUREMENT_AMBIGUOUS (existiert in REASON_CODES; per D-004-Historie ist
    // ECHTE Ambiguität sein korrekter Einsatz) + N-fach-Detail. KEINE
    // corrections (pass:null → arbitrate.buildUnchecked → unchecked[], der
    // corrections-Producer konsumiert nur failing). VOR dem subj-find: bei
    // count>1 wäre jeder find-Treffer bereits eine first-match-Lüge.
    const ambigId = [c.subject, c.reference].find(
      (id) => id != null && (idCount.get(id) || 0) > 1,
    );
    if (ambigId !== undefined) {
      const n = idCount.get(ambigId);
      return {
        pass: null,
        reasonCode: 'MEASUREMENT_AMBIGUOUS',
        reasonCategory: 'SPECIFICATION',
        detail: `id '${ambigId}' ist ${n}-fach — Messung verweigert, keine Korrektur`,
        constraintType: c.type,
        id: c.subject,
        reference: c.reference,
      };
    }
    const subj = gridMap.elements.find((e) => e.id === c.subject);
    const ref = c.reference
      ? gridMap.elements.find((e) => e.id === c.reference)
      : null;
    // D-004: praeziser reasonCode am Ursprung. Frueher fiel ein fehlendes
    // subject/reference in arbitrate.js#buildUnchecked auf den generischen
    // MEASUREMENT_AMBIGUOUS-Default zurueck (Default Z.171) — eine ungenaue
    // Diagnose, obwohl die exakten Codes laengst in REASON_CODES definiert
    // (aber unbenutzt) waren. Wir setzen sie hier, wo der Unterschied
    // subject-fehlt vs. reference-fehlt eindeutig bekannt ist. Beides sind
    // SPECIFICATION-Probleme: der Aufruf referenziert eine id, die im Scene
    // nicht existiert. constraintType/id/reference werden mitgegeben, damit der
    // unchecked-Eintrag identifizierbar bleibt (die spaetere Enrichment Z.473-475
    // wird durch das fruehe return uebersprungen).
    if (!subj) {
      // §H10 R11-01 (Option B): Existenz-Register konsultieren, BEVOR die
      // SPECIFICATION-Schuld vergeben wird. Existiert die id im Markup, wurde
      // aber css-unsichtbar geskippt, ist der Aufruf KORREKT — das Auge misst
      // @t0 nur nichts: eigener Code SUBJECT_HIDDEN, reasonCategory MODEL
      // (D-004-Muster: reasonCode am Ursprung).
      const hid = Array.isArray(gridMap.hidden)
        ? gridMap.hidden.find((h) => h.id === c.subject)
        : undefined;
      if (hid)
        return {
          pass: null,
          reasonCode: 'SUBJECT_HIDDEN',
          reasonCategory: 'MODEL',
          detail: `#${c.subject} existiert (${hid.axis}) — unsichtbar @t0, nicht gemessen`,
          hint: `#${c.subject} existiert (${hid.axis}) — unsichtbar @t0, nicht gemessen; Sichtbarkeit herstellen oder Constraint entfernen`,
          constraintType: c.type,
          id: c.subject,
          reference: c.reference,
        };
      return {
        pass: null,
        reasonCode: 'SUBJECT_NOT_FOUND',
        reasonCategory: 'SPECIFICATION',
        detail: `#${c.subject} nicht gefunden`,
        constraintType: c.type,
        id: c.subject,
        reference: c.reference,
      };
    }
    // §H10 R11-11 IDENTITÄTS-WACHE (O2): Subjekt === Referenz ⇒ das Verdikt
    // wäre geometrie-UNABHÄNGIG (Tautologie bzw. konstantes false) — ein
    // leeres Echo, kein Messergebnis. Messung verweigern statt raten
    // (§HEAL-7/B-Muster): pass:null + SEMANTIC_SUSPICIOUS (deklariert in
    // REASON_CODES, hier der erste ehrliche Einsatz) → unchecked → PARTIAL.
    if (c.reference != null && c.reference === c.subject)
      return {
        pass: null,
        reasonCode: 'SEMANTIC_SUSPICIOUS',
        reasonCategory: 'SPECIFICATION',
        detail: `Selbst-Referenz: Subjekt und Referenz sind dasselbe Element (#${c.subject}) — Verdikt wäre geometrie-unabhängig, Messung verweigert`,
        hint: `Selbst-Referenz: Subjekt und Referenz sind dasselbe Element (#${c.subject}) — Referenz auf ein anderes Element wählen`,
        constraintType: c.type,
        id: c.subject,
        reference: c.reference,
      };
    // HIGH-Fix (E6 Re-Review): REGEL-8 fail-closed. Eine referenz-PFLICHTIGE
    // Constraint (DISTANCE-FROM, CENTERED-IN, INSIDE, NO-OVERLAP, ALIGNED-*,
    // LEFT-OF, ABOVE, SAME-SIZE) OHNE aufloesbaren ref darf NIE in
    // checkConstraint fallen — distance.js & Co. dereferenzieren `ref.bbox` und
    // werfen sonst „Cannot read properties of null". Die vorige Wache
    // `if (c.reference && !ref)` griff NUR bei truthy c.reference und liess den
    // Fall „ref fehlt ganz" (c.reference null/''/nur '#' → parseConstraints
    // liefert reference:null) durchrutschen → Crash.
    //
    // `requiresReference(c.type)` ist registry-getrieben (Default fail-closed
    // true; nur COLOR/FILL markieren false). Damit ist die Menge nicht im
    // pipeline-Code hartkodiert, sondern lebt beim jeweiligen Constraint.
    //
    // FINDING-1-Fix (E6 Re-Review-2): der Guard feuert NUR fuer REGISTRIERTE
    // Typen (`isRegistered`). Sonst maskierte der fail-closed-Default
    // (requiresReference(unbekannt)=true) bei Tippfehlern/Phantasie-Typen die
    // echte Diagnose: `#a CENTRD-IN` lieferte „benoetigt Referenz" statt
    // CONSTRAINT_TYPE_UNKNOWN + Vorschlag. Unbekannte Typen fliessen weiter zu
    // checkConstraint (das fuer unbekannte Typen pass:null OHNE Deref liefert →
    // kein Crash) → arbitrate.buildUnchecked vergibt CONSTRAINT_TYPE_UNKNOWN.
    //
    // Zwei ehrliche Diagnosen fuer bekannte ref-pflichtige Typen: c.reference
    // gesetzt aber nicht auflösbar (zeigt auf nicht-existentes Element) vs. ganz
    // fehlend.
    if (isRegistered(c.type) && requiresReference(c.type) && !ref) {
      // §H10 P1 (Patch-Runde, 3/3 Linsen): SYMMETRIE des Existenz-Registers —
      // gridMap.hidden wird auch für die REFERENZ konsultiert, BEVOR die
      // SPECIFICATION-Schuld vergeben wird. Eine css-versteckte Referenz
      // (#v INSIDE #h, #h display:none) lief sonst in REFERENCE_NOT_FOUND
      // (Existenz-Lüge, empirisch bewiesen): eigener Code REFERENCE_HIDDEN,
      // reasonCategory MODEL — exakt die SUBJECT_HIDDEN-Schiene von oben.
      const hidRef =
        c.reference && Array.isArray(gridMap.hidden)
          ? gridMap.hidden.find((h) => h.id === c.reference)
          : undefined;
      if (hidRef)
        return {
          pass: null,
          reasonCode: 'REFERENCE_HIDDEN',
          reasonCategory: 'MODEL',
          detail: `#${c.reference} existiert (${hidRef.axis}) — unsichtbar @t0, nicht gemessen`,
          hint: `#${c.reference} existiert (${hidRef.axis}) — unsichtbar @t0, nicht gemessen; Sichtbarkeit herstellen oder Constraint entfernen`,
          constraintType: c.type,
          id: c.subject,
          reference: c.reference,
        };
      return {
        pass: null,
        reasonCode: 'REFERENCE_NOT_FOUND',
        reasonCategory: 'SPECIFICATION',
        detail: c.reference
          ? `#${c.reference} nicht gefunden`
          : `${c.type} benoetigt eine Referenz — keine angegeben`,
        constraintType: c.type,
        id: c.subject,
        reference: c.reference,
      };
    }

    const ctx = { grid: gridMap.grid };
    if (c.value !== undefined) ctx.value = c.value;
    const result = checkConstraint(c.type, subj, ref, ctx);
    result.constraintType = c.type;
    result.reference = c.reference;
    result.id = c.subject;
    // §HEAL-5 VERDIKT-WACHE (Post-Check, D-003/D-004-Muster: reasonCode am
    // Ursprung — subj ist hier das VOLLE gridMap.elements-Objekt, die Flags
    // liegen bereits vor). NUR pass:true wird degradiert (pass:null →
    // arbitrate.buildUnchecked honoriert den Upstream-reasonCode → unchecked[]
    // → deriveStatus → PARTIAL). pass:false bleibt fail — der geometrische
    // Bruch ist WAHR (gateCorrections-Pfad unberührt). Der MESSWERT bleibt
    // unverändert im detail (VISION P3: Vorbehalt ehrlich tragen, nie
    // Wert-Eingriff): die Handler liefern bei pass:true detail:null → die
    // gemessene t0-bbox des Subjekts IST der Messwert des Verdikts.
    if (result.pass === true) {
      // §H10 R11-06: der Constraint-Typ wird mitgegeben — die Paint-Zeit-
      // Klasse degradiert nur Paint-Domänen-Verdikte (COLOR).
      const honesty = classifySubjectHonesty(subj, c.type);
      if (honesty) {
        const messwert =
          result.detail != null
            ? result.detail
            : subj.bbox
              ? `geometrisch erfüllt @t0 (bbox x=${subj.bbox.x} y=${subj.bbox.y} w=${subj.bbox.w} h=${subj.bbox.h})`
              : 'geometrisch erfüllt @t0';
        return {
          pass: null,
          reasonCode: honesty.reasonCode,
          reasonCategory: 'MODEL',
          detail: `${messwert} — ${honesty.rider}`,
          constraintType: c.type,
          reference: c.reference,
          id: c.subject,
        };
      }
    }
    return result;
  });
}

/**
 * §E1 Wahrheits-Gate am Emissions-Rand: baut die reliabilityById-Map EINMAL aus
 * gridMap.elements (D-015 echt 3→1: war 1× structured-Map + 1× prose-find +
 * 1× structured-inline) und schleust arbitrated.failing durch
 * honesty.js#gateCorrections. Liefert die gegatete failing-Liste (jedes issue
 * traegt _gated; bei deny um dx/dy/dw/dh + detail-Vorschreibung bereinigt). Der
 * Caller setzt sie als `arbitrated.failing` (R3-Symmetrie) → BEIDE Formatter
 * konsumieren GENAU EINE gegatete Quelle, kein ungegateter Seitenkanal. EINE
 * Entscheidung pro issue, EINMAL, am einzigen Ort, der Reliability+Emission koppelt.
 */
function gateFailing(gridMap, arbitrated) {
  const reliabilityById = new Map(
    gridMap.elements.map((el) => [el.id, el.bbox_reliability]),
  );
  return gateCorrections(arbitrated.failing || [], (id) =>
    reliabilityById.get(id),
  );
}

/**
 * §HEAL-R6 / T1 "das Kabel" (F-AT-6-08, R9-Determinismus): stabilisiert
 * resolved.sanitize_loss VOR der Emission — lexikografisch nach (tag, reason)
 * sortiert UND dedupliziert. Der Adapter liefert die Liste in DOM-removed-
 * Reihenfolge; zwei strukturell identische Verluste (gleiches tag+reason) sind
 * für den Konsumenten ununterscheidbar. Sortieren + Dedup macht das Verdikt
 * byte-stabil (gleiches lossy-SVG 2× → identische Reihenfolge) und kompakt.
 * Reine Funktion (kein I/O, kein Date/Random). Liefert IMMER ein Array (auch []).
 *
 * @param {Array<{tag:string, reason:string, value?:string}>|undefined} loss
 * @returns {Array<{tag:string, reason:string, value?:string}>}
 */
function stabilizeSanitizeLoss(loss) {
  if (!Array.isArray(loss)) return [];
  const seen = new Set();
  const out = [];
  for (const l of loss) {
    if (!l || typeof l !== 'object') continue;
    const tag = String(l.tag ?? '');
    const reason = String(l.reason ?? '');
    // §H9 K-05: `value` (der gestrippte Attribut-WERT, z.B. die verlorene
    // Autor-id — vom Adapter seit T2 erfasst) bleibt ERHALTEN statt gedroppt,
    // sonst kann die Prosa nie nennen, WELCHE id betroffen war (stille
    // Mutation). Dedup-/Sort-Schlüssel um value erweitert (Determinismus
    // bleibt; zwei Strips desselben Attributs mit verschiedenen Werten sind
    // verschiedene Wahrheiten).
    const value = l.value !== undefined ? String(l.value) : undefined;
    const key = `${tag}\u0000${reason}\u0000${value ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ tag, reason, ...(value !== undefined ? { value } : {}) });
  }
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  out.sort(
    (a, b) =>
      cmp(a.tag, b.tag) ||
      cmp(a.reason, b.reason) ||
      cmp(a.value ?? '', b.value ?? ''),
  );
  return out;
}

/**
 * §HEAL-R6 / T1: das classifyCanvas-Verdikt aus resolved.sanitize_loss DIREKT
 * (Anti-LECK-3 — NIE aus gridMap.canvas, das sanitize_loss nicht trägt → wäre
 * immer 'valid' → neue stille Lüge). viewBoxValidity LIEFERT der Renderer seit
 * §HEAL-7/A (F-TF-002) am canvas-Objekt: 'degenerate' (viewBox vorhanden, aber
 * parse-fail/NaN/zero/negativ) · 'default_replaced' (keine viewBox + keine
 * width/height → CSS-Default 300×150 griff) · sonst nicht gesetzt.
 * DOMINANZ (honesty.js#classifyCanvas-Vertrag, Z.113ff): lossy > degenerate >
 * default_replaced > valid — ein nicht-leerer sanitizeLoss überstimmt das
 * viewBoxValidity-Signal bewusst (Pessimismus-Präzedenz). canvas-Argument ist
 * resolved.canvas (kann im Error-Pfad fehlen → optional-chaining).
 *
 * @param {{canvas?: {viewBoxValidity?: string}}} resolved
 * @param {Array} sanitizeLoss - bereits stabilisierte Verlust-Liste.
 * @returns {'valid'|'default_replaced'|'degenerate'|'lossy'}
 */
function deriveCanvasValidity(resolved, sanitizeLoss) {
  return classifyCanvas({
    viewBoxValidity: resolved.canvas?.viewBoxValidity,
    sanitizeLoss,
  });
}

/**
 * §HEAL-R6 / T1 Error-Pfad-Ehrlichkeit (F-AT-6-05): im resolved.error-Fall baut
 * analyze/compare/inspect heute `structured:null` — ein gestrippter-aber-nicht-
 * renderbarer Canvas verliert damit das laute lossy-Signal STILL (tools.js
 * substituiert dann eine neutrale Schema-Error-Response ohne canvas_validity).
 * Diese Helper liefert das ehrliche Error-Resultat: trägt resolved.sanitize_loss
 * einen Verlust (canvas_validity==='lossy'), dann ein SCHEMA-KONFORMES structured
 * mit scene.canvas_validity:'lossy' + die laute Prosa-Zeile; sonst Verhalten
 * UNVERÄNDERT (prose:`Fehler: …`, structured:null → tools.js-Error-Response).
 *
 * SCHEMA-KONFORMITÄT (KRITISCH): tools.js deklariert outputSchema (analyzeOutput
 * / inspectOutput) und die MCP-SDK VALIDIERT structuredContent dagegen (-32602-
 * Reject). Ein non-null structured MUSS daher die jeweilige Pflicht-Form tragen
 * (analyze: status/iteration/scene/corrections/unchecked/diff; inspect:
 * scene.suppressed/elements). Wir bauen die NEUTRALE Error-Form (analyze:
 * analyzeErrorStructured — §H9 P2 DIESELBE Quelle, die tools.js#
 * analyzeErrorResponse konsumiert; inspect: Spiegel von tools.js#
 * inspectErrorResponse) und hängen NUR das additive
 * scene.canvas_validity:'lossy' an. canvas_validity stammt aus
 * resolved.sanitize_loss DIREKT (Anti-LECK-3); gridMap existiert hier nicht.
 *
 * @param {{error:string, message:string, sanitize_loss?:Array, canvas?:object}} resolved
 * @param {'analyze'|'inspect'} kind - bestimmt die Schema-konforme Hülle.
 * @returns {{prose:string, structured:(object|null)}}
 */
function buildErrorResult(resolved, kind = 'analyze') {
  const sanitizeLoss = stabilizeSanitizeLoss(resolved.sanitize_loss);
  const canvasValidity = deriveCanvasValidity(resolved, sanitizeLoss);
  if (canvasValidity !== 'lossy') {
    // §6 RELAIS Fehler-Kanal: code+hint entstehen HIER (an der pipeline-
    // Quelle, aus resolved.error/message — dem existierenden Wahrheits-Ort).
    // tools.js bettet sie additiv in die Schema-Error-Hülle (error{code,hint},
    // NUR bei isError:true). §P1: der hint trägt den Navigations-Zusatz
    // (renderErrorHint, eine Quelle — Ist + nächster Schritt statt nur Befund);
    // die Prosa trägt denselben hint wortidentisch (Parity per Konstruktion).
    const hint = renderErrorHint(resolved.message);
    return {
      prose: `Fehler: ${hint}`,
      structured: null,
      error: { code: resolved.error, hint },
    };
  }
  // §H9 K-03/K-24/K-05: echte Verlust-Ursachen auch im Error-Pfad.
  const prose = formatErrorWithLoss(resolved.message, sanitizeLoss);
  if (kind === 'inspect') {
    // Spiegel von tools.js#inspectErrorResponse (inspectOutput-konform) + additiv
    // scene.canvas_validity:'lossy'.
    return {
      prose,
      structured: {
        scene: {
          width: 0,
          height: 0,
          grid: '0x0',
          elements: [],
          suppressed: 0,
          canvas_validity: canvasValidity,
        },
      },
    };
  }
  // Spiegel von tools.js#analyzeErrorResponse (analyzeOutput-konform) + additiv
  // scene.canvas_validity:'lossy'. (Hülle aus analyzeErrorStructured — §H9
  // K-13bc: EINE Quelle, wiederverwendet vom compare-No-Baseline-Pfad.)
  const structured = analyzeErrorStructured();
  structured.scene.canvas_validity = canvasValidity;
  return { prose, structured };
}

/**
 * §H9 K-13bc: kanal-neutrale No-Baseline-Hinweis-Prosa — EINE Quelle.
 * 'analyze' ist der gemeinsame Operationsname BEIDER Kanäle (JS-Export
 * analyze, MCP vector_mirror_analyze); der MCP-Dialektname gehört nicht in
 * die kanal-agnostische Kernschicht. Exportiert, damit tools.js den
 * Nutzungsfehler EXAKT erkennt (die isError-Projektion am MCP-Rand bleibt
 * wahr — kein Heuristik-Sniffing auf der Hüllen-Form).
 */
export const NO_BASELINE_HINT =
  'Hinweis: Keine Basis zur analysisId gefunden — führe zuerst analyze aus und übergib dessen analysisId.';

/**
 * §6 RELAIS Fehler-Kanal: kanal-neutrale Bookmark-Fehler-Prosa — EINE Quelle
 * (Muster NO_BASELINE_HINT; Wortlaut byte-identisch zur bisherigen Inline-
 * Prosa in bookmark()). Exportiert, damit Proben die Parity prüfen können.
 */
export const BOOKMARK_UNKNOWN_HINT =
  'Hinweis: analysisId nicht gefunden — zuerst vector_mirror_analyze aufrufen.';

/**
 * §6 RELAIS / P1 (Flussbett, internal design rule): Render-Fehler-hint = Ist-Zustand
 * + nächster Schritt, nie nur Befund. Die EINE Quelle für ALLE Render-Error-
 * hints (buildErrorResult non-lossy-Zweig + palette); die Prosa rendert
 * denselben hint wortidentisch (`Fehler: ${hint}`) — Parity per Konstruktion,
 * gepinnt am MCP-Rand (tests/relais_red/probe_mcp_errorchannel.mjs).
 */
export function renderErrorHint(message) {
  return `${message} — prüfe SVG-Wohlgeformtheit/viewBox; Details: content-Text`;
}

/**
 * §H9 K-13bc/P2: die analyzeOutput-konforme Error-Hülle als EINE Quelle —
 * konsumiert von buildErrorResult (lossy-Zweig), compare (No-Baseline-Pfad)
 * UND tools.js#analyzeErrorResponse (MCP-Rand-Spiegel; exportiert, damit der
 * Spiegel keine zweite Hüllen-Kopie trägt). status:'FAIL' + leere scene =
 * die etablierte Error-Result-Form des Projekts.
 *
 * §H9 P2 WAHRE FORM: im Fehlerfall gibt es KEINE Messung — die Hülle darf
 * daher weder einen Lösungs-Zustand behaupten (das frühere convergence:
 * 'SOLVED' widersprach isError:true) noch eine Korrelations-ID erfinden (die
 * frühere randomUUID referenzierte bewusst KEIN Grid — eine als echt
 * präsentierte Phantom-ID). Beide Felder tragen jetzt null („keine Aussage" /
 * „keine Analyse gespeichert"); iterationSchema ist nullable nachgezogen.
 *
 * @returns {object} analyzeOutput-konformes Error-structured.
 */
export function analyzeErrorStructured() {
  return {
    status: 'FAIL',
    iteration: {
      sequence: 1,
      previous_issues: 0,
      current_issues: 0,
      total_issues: 0,
      returned_issues: 0,
      suppressed: 0,
      convergence: null,
      analysisId: null,
    },
    scene: { width: 0, height: 0, grid: '0x0', elements: [] },
    corrections: [],
    unchecked: [],
    diff: [],
  };
}

// ═════════════════════════════════════════════════════════════════════════
// §HEAL-4 (F-AT-7-10 + F-AT-7-11) — additiver Viewport-Mess-Detektor
// (docs/internal/an internal spec, ADR-001 STAND (4)).
//
// Der Mess-Schritt läuft NUR in analyze() und inspect(), NACH fireResolve und
// VOR mapToGridMap/Formatierung — NIE in resolve() (breaker-getimter Pfad;
// Phase-0-Lehre: Mess-Verdrahtung in resolve() zerstörte 330ms → 5153ms).
// compare()/palette() bleiben unberührt (Spec-Scope).
//
// ADDITIV OR-ONLY (F-AT-7-14, use-Shadow-Blindfleck der Messung pixel-bewiesen):
// die Messung darf media_dependent NUR HINZUFÜGEN, NIE ein statisches true
// wegnehmen — die Statik bleibt load-bearing. Transport über die EXISTENTEN
// Schienen (grid.js media_dependent-Durchreichung + warnings[]-Pfad inkl.
// truncated_warnings + prose.js mediaNote) — KEIN neuer Kanal, KEIN Schema-Feld.
// ═════════════════════════════════════════════════════════════════════════

/** §HEAL-4 MK3: scene-level Ausfall-Marker (laut, nie still). */
const MEDIA_MEASURE_UNAVAILABLE = 'MEDIA_MEASURE_UNAVAILABLE';

/**
 * §HEAL-4 Mess-Schritt: misst die Viewport-Divergenz (lean 2-VP-Diff, separate
 * Page/eigener Mutex — MK5) und projiziert divergente Elemente OR-only auf
 * resolved.elements (media_dependent:true + MEDIA_DEPENDENT genau 1×).
 *
 * PROJEKTION (2 disjunkte Stufen, deterministisch, konservativ):
 *   1. authorId GESETZT — die Autor-id IST die emittierte Element-id (resolve()
 *      behält explizite ids unverändert, §1.3). PATCH R3 (Codex-Blocker):
 *      DUPLIKAT-Autor-IDs sind nicht attribuierbar (eine last-wins-Map nähme
 *      still das letzte = Falsch-Flag-Richtung, F-TF-003-Klasse) ⇒ skip.
 *      PATCH R2 (Codex-Blocker): authorId gesetzt aber NICHT emittiert (z.B.
 *      divergentes invisibleNow-Element) ⇒ skip, KEIN Geometrie-Fallback —
 *      sonst erbt ein geometrie-deckungsgleiches FREMDES Element das Flag
 *      (Falsch-Flag-Richtung, Suite-Beleg R5c).
 *   2. authorId NULL (Auto-ID-Fall): EINDEUTIGER (tag, geom@1920)-Match
 *      gegen resolved.elements — resolve() misst am IDENTISCHEN Viewport 1920
 *      mit derselben 4-Punkt-userM-Projektion, die Werte sind deckungsgleich
 *      (Toleranz 0.01 ≫ KB9-Rundung 1e-4). Ambig (0 oder >1 Kandidaten) ⇒
 *      NICHT raten (kein Über-Flag) — die Statik trägt; ehrliches Residuum.
 *
 * MK3: JEDER Mess-Ausfall (Timeout/Fehler/Selbsttest) ⇒ { unavailable: true } —
 * der Aufrufer setzt den scene-Marker; die statischen Flags sind zu diesem
 * Zeitpunkt bereits vollständig im resolved (additiv ⇒ kein Re-Leak). Wirft NIE.
 *
 * @param {string} svgString
 * @param {{elements?: Array}} resolved — wird IN PLACE additiv erweitert.
 * @returns {Promise<{unavailable: boolean}>}
 */
async function measureMediaStep(svgString, resolved) {
  let measured;
  try {
    measured = await measureViewportDivergence(svgString);
  } catch (_) {
    return { unavailable: true };
  }
  if (!measured || measured.error) return { unavailable: true };
  const els = Array.isArray(resolved.elements) ? resolved.elements : [];
  // R3: ID-Häufigkeit — Duplikat-Autor-IDs sind nicht attribuierbar (kein Raten).
  const idCount = new Map();
  for (const e of els) idCount.set(e.id, (idCount.get(e.id) || 0) + 1);
  // R8 (Codex-Re-Review): Duplikat-Zählung SYMMETRISCH auch über die Mess-
  // DESCRIPTOREN — ein nicht-emittierter id-Zwilling im Mess-DOM (z.B. zwei
  // divergente Elemente mit identischer Autor-ID, nur eines emittiert) würde
  // sonst auf das emittierte gleichnamige Element attribuiert (Falsch-Flag-
  // Kante). NICHT fixture-testbar ohne Fault-Injection in den Walk (beide
  // Zwillinge müssten divergieren UND genau einer emittiert sein — der R5d-
  // Pfad deckt die emittierte Seite, diese Zählung die Descriptor-Seite).
  // EHRLICHES REST-RESIDUUM: divergiert NUR der nicht-emittierte Zwilling,
  // sieht diese Zählung ihn allein (count==1) und attribuiert auf den
  // emittierten Namensvetter — abgesichert nur, wenn auch der emittierte
  // selbst divergiert; vollständige Schließung bräuchte die authorId-Zählung
  // über ALLE Walk-Records (bewusst nicht: Descriptor-Vertrag bleibt lean).
  const descIdCount = new Map();
  for (const d of measured.diverged || []) {
    if (d.authorId)
      descIdCount.set(d.authorId, (descIdCount.get(d.authorId) || 0) + 1);
  }
  const elById = new Map(els.map((e) => [e.id, e]));
  for (const d of measured.diverged || []) {
    let el;
    if (d.authorId) {
      // R3+R8: mehrdeutige Autor-ID (emittiert ODER descriptor-seitig) ⇒
      // konservativ skip (kein last-wins-Flag, kein Zwillings-Raten).
      if (
        (idCount.get(d.authorId) || 0) > 1 ||
        (descIdCount.get(d.authorId) || 0) > 1
      )
        continue;
      el = elById.get(d.authorId);
      // R2: gesetzte, aber nicht emittierte authorId ⇒ konservativ skip —
      // NIE in den Geometrie-Fallback fallen (Falsch-Flag auf Fremd-Element).
      if (!el) continue;
    } else if (Array.isArray(d.geomBase)) {
      const [x0, y0, x1, y1] = d.geomBase;
      const close = (a, b) =>
        Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 0.01;
      const cands = els.filter(
        (e) =>
          e.tag === d.tag &&
          e.bbox &&
          close(e.bbox.x, x0) &&
          close(e.bbox.y, y0) &&
          close(e.bbox.w, x1 - x0) &&
          close(e.bbox.h, y1 - y0),
      );
      if (cands.length === 1) el = cands[0];
    }
    // Auto-ID-Fall ohne EINDEUTIGEN Geometrie-Match (0 oder >1 Kandidaten)
    // → Statik trägt, kein Raten (Suite-Pinning R5a).
    if (!el) continue;
    if (el.media_dependent !== true) {
      el.media_dependent = true; // OR-only: NUR hinzufügen, nie wegnehmen.
      if (!Array.isArray(el.warnings)) el.warnings = [];
      // WARNING-INVARIANTE (Spiegel des Produktiv-Walks): GENAU 1× — statisch
      // geflaggte Elemente tragen die Warning bereits und landen nie hier.
      if (!el.warnings.includes('MEDIA_DEPENDENT')) {
        el.warnings.push('MEDIA_DEPENDENT');
      }
    }
  }
  return { unavailable: false };
}

/**
 * §HEAL-4 MK3: hängt den lauten Ausfall-Marker an ein fertig formatiertes
 * Resultat — scene-level im structured + WARNUNG-Zeile in der Prosa. Seit
 * §HEAL-7/C ist scene.media_measure in BEIDEN registrierten outputSchemas
 * (schema.js analyzeOutput/inspectOutput) deklariert: der Marker überlebt den
 * MCP-Boundary-Parse (vorher strippte zod-unknownKeys ihn STILL — der Prosa-
 * Kanal war die einzige Schiene). Reine Funktion über das Resultat.
 */
function withMeasureUnavailable(prose, structured) {
  if (structured?.scene && typeof structured.scene === 'object') {
    structured.scene.media_measure = MEDIA_MEASURE_UNAVAILABLE;
  }
  return {
    prose: `${prose}\nWARNUNG: ${MEDIA_MEASURE_UNAVAILABLE} — 2-Viewport-Messung ausgefallen (Timeout/Fehler/Selbsttest); statische Viewport-Erkennung trägt.`,
    structured,
  };
}

/**
 * Full analysis: resolve SVG, map to grid, check constraints, diff, report.
 * Returns { prose: string, structured: object } for dual response (MCP OBL-009).
 */
export async function analyze(
  svgString,
  constraintStrings = [],
  previousIssueCount,
) {
  // §H9 N-1: Fassaden-Guard — spiegelt den bereits deklarierten MCP-Vertrag
  // (schema.js: previousIssueCount z.number().int().nonnegative().optional())
  // an der Programm-Fassade. Ohne Guard wird Müll ({t:0.5}, 'banane', -3.7)
  // zu sequence=2 + fabriziertem DIVERGING-Verdikt (Fortschritts-Lüge).
  // Fail-fast VOR jeder Messung; legale Abwesenheit (undefined/null) und
  // valide Integer bleiben byte-identisch.
  if (
    previousIssueCount !== undefined &&
    previousIssueCount !== null &&
    !(Number.isInteger(previousIssueCount) && previousIssueCount >= 0)
  ) {
    // §H9 P5: JSON.stringify kann SELBST werfen (zirkuläres Objekt, BigInt) —
    // die Diagnose darf den hilfreichen TypeError nie verdrängen. Fallback
    // String(x): Navigation garantiert, egal welcher Müll ankommt.
    let ist;
    if (typeof previousIssueCount === 'number') {
      ist = String(previousIssueCount);
    } else {
      try {
        ist = JSON.stringify(previousIssueCount) ?? String(previousIssueCount);
      } catch {
        ist = String(previousIssueCount);
      }
    }
    throw new TypeError(
      `analyze: previousIssueCount muss nichtnegativer Integer (oder undefined/null) sein, erhalten: ${ist}`,
    );
  }
  if (!page) await init();

  const resolved = await fireResolve(svgString);
  // §HEAL-R6 / T1 (F-AT-6-05): Error-Pfad trägt das laute lossy-Signal, wenn
  // resolved.sanitize_loss einen Verlust meldet (sonst Verhalten unverändert).
  if (resolved.error) return buildErrorResult(resolved);

  // §HEAL-R6 / T1 "das Kabel" (F-AT-6-08): das classifyCanvas-Verdikt aus
  // resolved.sanitize_loss DIREKT (Anti-LECK-3 — NIE aus gridMap.canvas).
  // sanitize_loss VOR der Emission stabil sortiert + dedupliziert (R9).
  const sanitizeLoss = stabilizeSanitizeLoss(resolved.sanitize_loss);
  const canvasValidity = deriveCanvasValidity(resolved, sanitizeLoss);

  // §HEAL-4: additiver Viewport-Mess-Schritt — NACH fireResolve (eigenes
  // Budget, NICHT breaker-getimt), VOR mapToGridMap (die existenten Schienen
  // reichen die OR-only-Flags durch). Ausfall ⇒ lauter scene-Marker (MK3).
  const mediaMeasure = await measureMediaStep(svgString, resolved);

  // §1.1 Stateless RPC: kein impliziter Cross-Call-Grid. analyze startet ohne
  // Vorgaenger; ID-Continuity ist explizit Caller-Aufgabe (analysisId in compare).
  const gridMap = mapToGridMap(resolved, null);
  const constraints = parseConstraints(constraintStrings);
  const constraintResults = checkAllConstraints(constraints, gridMap);

  const arbitrated = arbitrate(constraintResults, []);

  // Schicht 2: Server-generated analysisId (crypto.randomUUID, Node-native, kein Dep).
  const analysisId = randomUUID();

  // §E1: EINE Pessimismus-Entscheidung pro issue, VOR den Formattern. BEIDE
  // Formatter bekommen DIESELBE gegatete arbitrated (failing := gegatet) —
  // symmetrisch, EINE Wahrheitsquelle, kein ungegateter Seitenkanal (R3).
  const gated = { ...arbitrated, failing: gateFailing(gridMap, arbitrated) };
  // §H9 K-03/K-24/K-05: die R9-stabilisierte Verlust-Liste in die Prosa-opts —
  // die ⚠-Zeile nennt die ECHTEN Ursachen statt des Hardcodes "(id/name)".
  const prose = formatReport(gridMap, gated, { canvasValidity, sanitizeLoss });
  const structured = formatStructured(gridMap, gated, {
    previousIssueCount,
    analysisId,
    canvasValidity,
  });

  // Eviction: oldest-key (Map.keys().next().value) BEFORE insert wenn Cap erreicht.
  if (grids.size >= maxGrids) {
    const oldest = grids.keys().next().value;
    grids.delete(oldest);
  }
  grids.set(analysisId, gridMap);

  // §HEAL-4 MK3: Mess-Ausfall LAUT melden (scene-Marker + Prosa-WARNUNG) —
  // nie still; das statische Ergebnis oben ist davon unberührt (additiv).
  if (mediaMeasure.unavailable)
    return withMeasureUnavailable(prose, structured);
  return { prose, structured };
}

/**
 * Compare: resolve new SVG, diff against a stored analyze-state, report changes.
 *
 * @param {string} svgString
 * @param {string[]} [constraintStrings]
 * @param {string} analysisId - REQUIRED; explizite ID aus vorherigem analyze.
 *   §1.1 Stateless RPC: kein impliziter Default; Schema (compareInput) erzwingt
 *   das Pflichtfeld am Interface-Layer.
 *   Fehlt das Grid zur uebergebenen analysisId (z.B. evicted) → Hinweis-Pfad.
 *
 * Read-only contract: compare mutiert die grids-Map NICHT. Fuer chained compares
 * muss der Caller analyze erneut aufrufen, um eine neue analysisId zu erhalten.
 *
 * Returns { prose: string, structured: (object|null) } for dual response —
 * §H9 K-13bc: structured ist auch im No-Baseline-Fall non-null (ehrliche
 * analyzeOutput-konforme Error-Hülle, status:'FAIL'); null NUR im
 * resolve-Error-Pfad ohne Sanitize-Verlust (buildErrorResult-Sentinel,
 * den tools.js in eine Error-Response übersetzt).
 */
export async function compare(svgString, constraintStrings = [], analysisId) {
  if (!page) await init();

  // §1.4 Disjunktion: analysisId kann eine UUID (grids) ODER ein Bookmark-Name
  // (bookmarks) sein. Keyspaces sind disjunkt (bookmarkInput verbietet UUID-Form).
  // Bookmark löst zur Quell-UUID auf (KORR-2): formatStructured bekommt IMMER die
  // UUID, NIE den Namen — hält die §1.3-Server-Garantie (iteration.analysisId=UUID).
  let previousGrid = null;
  let baselineId = null;
  if (analysisId) {
    if (grids.has(analysisId)) {
      previousGrid = grids.get(analysisId);
      baselineId = analysisId;
    } else if (bookmarks.has(analysisId)) {
      const b = bookmarks.get(analysisId);
      previousGrid = b.gridMap;
      baselineId = b.analysisId;
    }
  }
  if (!previousGrid) {
    // §H9 K-13bc: ehrliches non-null Fehler-Objekt statt Schema-Bruch via
    // null — WIEDERVERWENDUNG der bestehenden Error-Hülle (analyzeOutput-
    // konform, Präzedenz: buildErrorResult lossy-Zweig) + kanal-neutrale
    // Hinweis-Prosa (NO_BASELINE_HINT, eine Quelle).
    // §6 RELAIS: derselbe Hint zusätzlich maschinenlesbar als additives
    // error{code,hint} IN der Hülle (R9a #13/#14 — der Schema-geführte
    // Konsument sah eine Wand; jetzt trägt structured die Navigation).
    // Parity per Konstruktion: prose === error.hint === NO_BASELINE_HINT.
    return {
      prose: NO_BASELINE_HINT,
      structured: {
        ...analyzeErrorStructured(),
        error: { code: 'NO_BASELINE', hint: NO_BASELINE_HINT },
      },
    };
  }

  const resolved = await fireResolve(svgString);
  // §HEAL-R6 / T1 (F-AT-6-05): Error-Pfad trägt das laute lossy-Signal.
  if (resolved.error) return buildErrorResult(resolved);

  // §HEAL-R6 / T1 "das Kabel" (F-AT-6-08): canvas_validity aus
  // resolved.sanitize_loss DIREKT (Anti-LECK-3), R9-stabilisiert.
  const sanitizeLoss = stabilizeSanitizeLoss(resolved.sanitize_loss);
  const canvasValidity = deriveCanvasValidity(resolved, sanitizeLoss);

  const gridMap = mapToGridMap(resolved, previousGrid);
  const constraints = parseConstraints(constraintStrings);
  const constraintResults =
    constraints.length > 0 ? checkAllConstraints(constraints, gridMap) : [];

  const diff = computeDiff(previousGrid, gridMap);
  const arbitrated = arbitrate(constraintResults, diff);

  // §E1: EINE Pessimismus-Entscheidung pro issue, VOR den Formattern. BEIDE
  // Formatter konsumieren DIESELBE gegatete arbitrated (R3-Symmetrie).
  const gated = { ...arbitrated, failing: gateFailing(gridMap, arbitrated) };
  // §H9 K-03/K-24/K-05: echte Verlust-Ursachen in die ⚠-Zeile (wie analyze).
  const prose = formatReport(gridMap, gated, { canvasValidity, sanitizeLoss });
  // analysisId in Output: die aufgelöste Quell-UUID (baselineId), NIE der Name.
  // §1.4 KORR-2: hält die §1.3-Server-Garantie (iteration.analysisId ist UUID).
  const structured = formatStructured(gridMap, gated, {
    analysisId: baselineId,
    canvasValidity,
  });

  // §1.1 Stateless RPC: compare ist read-only, mutiert grids/bookmarks nicht.
  return { prose, structured };
}

/**
 * §1.4 Bookmark: speichert eine bestehende analyze-GridMap unter einem Namen
 * als langlebige Baseline für den Sniper-Loop (analyze → bookmark → edit →
 * compare(name)). Referenziert eine EXPLIZITE analysisId (stateless-konsistent
 * zu §1.1; kein 'most-recent'). LRU-Eviction bei Cap (insertion-order, re-set =
 * newest). Speichert {gridMap, analysisId} damit compare(name) zur Quell-UUID
 * auflösen kann (KORR-2 — hält §1.3-Server-Garantie).
 *
 * @param {string} name - Bookmark-Name (kein UUID-Format, Schema erzwingt es).
 * @param {string} analysisId - UUID einer bestehenden analyze-GridMap.
 * Returns { prose, structured }. structured===null wenn analysisId unbekannt.
 */
export function bookmark(name, analysisId) {
  const gridMap = grids.get(analysisId);
  if (!gridMap) {
    // §6 RELAIS: code+hint an der pipeline-Quelle (BOOKMARK_UNKNOWN_HINT,
    // eine Quelle — Prosa byte-identisch zu vorher); tools.js bettet sie in
    // die bookmarkOutput-Error-Hülle (error{code,hint}, NUR bei isError).
    return {
      prose: BOOKMARK_UNKNOWN_HINT,
      structured: null,
      error: { code: 'ANALYSIS_NOT_FOUND', hint: BOOKMARK_UNKNOWN_HINT },
    };
  }

  // LRU: re-set eines bestehenden Namens macht ihn zum jüngsten Eintrag.
  bookmarks.delete(name);
  if (bookmarks.size >= maxBookmarks) {
    const oldest = bookmarks.keys().next().value;
    bookmarks.delete(oldest);
  }
  bookmarks.set(name, { gridMap, analysisId });

  return {
    prose: `Bookmark '${name}' gespeichert (${bookmarks.size}/${maxBookmarks}).`,
    structured: {
      name,
      analysisId,
      stored: true,
      bookmarkCount: bookmarks.size,
    },
  };
}

/**
 * Inspect: resolve SVG and return grid map without constraints.
 * Returns { prose: string, structured: object }.
 */
export async function inspect(svgString) {
  if (!page) await init();

  const resolved = await fireResolve(svgString);
  // §HEAL-R6 / T1 (F-AT-6-05): Error-Pfad trägt das laute lossy-Signal
  // (inspectOutput-konforme Error-Hülle, daher kind='inspect').
  if (resolved.error) return buildErrorResult(resolved, 'inspect');

  // §HEAL-R6 / T1 "das Kabel" (F-AT-6-08): canvas_validity aus
  // resolved.sanitize_loss DIREKT (Anti-LECK-3), R9-stabilisiert.
  const sanitizeLoss = stabilizeSanitizeLoss(resolved.sanitize_loss);
  const canvasValidity = deriveCanvasValidity(resolved, sanitizeLoss);

  // §HEAL-4: additiver Viewport-Mess-Schritt — identische Verdrahtung wie in
  // analyze() (NACH fireResolve, VOR mapToGridMap; Ausfall ⇒ MK3-Marker).
  const mediaMeasure = await measureMediaStep(svgString, resolved);

  // §1.1 Stateless RPC: inspect ist eine isolierte Probe ohne Cross-Call-Grid.
  const gridMap = mapToGridMap(resolved, null);
  const arbitrated = arbitrate([], []);

  // §E1 Identitaetsfall: inspect hat keine constraints → failing===[] →
  // gateCorrections([], …)===[]. Die gegatete (leere) Liste geht als
  // arbitrated.failing rein (R3-Symmetrie); fail-closed-Vertrag trivial erfuellt.
  const gated = { ...arbitrated, failing: gateFailing(gridMap, arbitrated) };
  // §H9 K-03/K-24/K-05: echte Verlust-Ursachen in die ⚠-Zeile (wie analyze).
  const prose = formatReport(gridMap, gated, { canvasValidity, sanitizeLoss });
  const structured = formatInspectStructured(gridMap, { canvasValidity });

  // §HEAL-4 MK3: Mess-Ausfall LAUT melden (scene-Marker + Prosa-WARNUNG).
  if (mediaMeasure.unavailable)
    return withMeasureUnavailable(prose, structured);
  return { prose, structured };
}

/**
 * Palette: resolve SVG and return color information.
 * Returns { prose: string, structured: object }.
 */
export async function palette(svgString) {
  if (!page) await init();

  const resolved = await fireResolve(svgString);
  if (resolved.error) {
    // §6 RELAIS: code+hint aus resolved (pipeline-Quelle, Muster
    // buildErrorResult); §P1 Navigations-Zusatz via renderErrorHint (eine
    // Quelle), Prosa trägt den hint wortidentisch (Parity per Konstruktion).
    const hint = renderErrorHint(resolved.message);
    return {
      prose: `Fehler: ${hint}`,
      structured: null,
      error: { code: resolved.error, hint },
    };
  }

  // §1.1 Stateless RPC: palette ist eine isolierte Probe ohne Cross-Call-Grid.
  const gridMap = mapToGridMap(resolved, null);

  const lines = [`PALETTE: ${gridMap.elements.length} Elemente`];
  for (const el of gridMap.elements.slice(0, 7)) {
    const stroke =
      el.stroke && el.stroke !== 'transparent' ? ` [Rand: ${el.stroke}]` : '';
    lines.push(`  ${el.tag}#${el.id}: ${el.color}${stroke}`);
  }
  if (gridMap.elements.length > 7)
    lines.push(`  (${gridMap.elements.length - 7} weitere)`);

  return {
    prose: lines.join('\n'),
    structured: formatPaletteStructured(gridMap.elements),
  };
}

/**
 * Meta: list available constraint types with syntax.
 * Returns { prose: string, structured: object }.
 */
export function getConstraintTypes() {
  const types = listConstraints();
  const syntaxMap = {
    'CENTERED-IN': '#subject CENTERED-IN #reference',
    'NO-OVERLAP': '#subject NO-OVERLAP #reference',
    INSIDE: '#subject INSIDE #reference',
    'ALIGNED-LEFT': '#subject ALIGNED-LEFT #reference',
    'ALIGNED-TOP': '#subject ALIGNED-TOP #reference',
    'LEFT-OF': '#subject LEFT-OF #reference',
    ABOVE: '#subject ABOVE #reference',
    'SAME-SIZE': '#subject SAME-SIZE #reference',
    'DISTANCE-FROM': '#subject DISTANCE-FROM #reference N',
    COLOR: '#subject COLOR farbname',
    FILL: '#subject FILL canvas',
  };

  const lines = [`CONSTRAINTS: ${types.length} Typen verfuegbar`];
  for (const t of types) {
    const syntax = syntaxMap[t.type] || `#subject ${t.type} #reference`;
    const arrange = t.hasArrange ? ' [+arrange]' : '';
    lines.push(`  ${t.type}: ${syntax}${arrange}`);
  }

  return {
    prose: lines.join('\n'),
    structured: {
      types: types.map((t) => ({
        type: t.type,
        syntax: syntaxMap[t.type] || `#subject ${t.type} #reference`,
        hasArrange: t.hasArrange,
      })),
    },
  };
}

/**
 * Meta: server status.
 * Returns { prose: string, structured: object }.
 */
export function getStatus() {
  const types = listConstraints();
  const browserRunning = page !== null;
  const breakerStats = renderBreaker ? getBreakerStats(renderBreaker) : null;
  const breakerSummary = breakerStats
    ? ` | Breaker: ${breakerStats.state} (fires=${breakerStats.fires}, fails=${breakerStats.failures})`
    : '';

  // §1.9: Kalibrierungs-Stand surfacen (PENDING bis Auto-Selftest fertig).
  const calibSummary = lastCalibration
    ? ` | Kalibrierung: ${lastCalibration.status} (${lastCalibration.calibrated}/${lastCalibration.total})`
    : '';

  return {
    prose: `Vector Mirror v2.0.0 | Browser: ${browserRunning ? 'running' : 'stopped'} | Letzter Stand: ${grids.size > 0 ? 'ja' : 'nein'} | ${types.length} Constraint-Typen${breakerSummary}${calibSummary}`,
    structured: {
      version: '2.0.0',
      browser: browserRunning ? 'running' : 'stopped',
      lastAnalysis: grids.size > 0,
      constraintTypes: types.length,
      breaker: breakerStats,
      // §1.9: nullable/optional — kein Bruch bestehender E2E-Roundtrip-Asserts.
      calibration: lastCalibration,
    },
  };
}

function cloneArrangeState(state) {
  return new Map(
    Array.from(state.entries(), ([id, entry]) => [
      id,
      {
        ...entry,
        bbox: { ...entry.bbox },
      },
    ]),
  );
}

/**
 * Arrange: compute SVG attributes from canvas + elements + constraints (pure math).
 * Inverse of the analysis pipeline — no browser needed.
 * Sequential constraint processing: each constraint sees the updated state from the previous one.
 * Returns { prose: string, structured: object }.
 */
export function arrange(canvas, elements, constraintStrings) {
  const constraints = parseConstraints(constraintStrings);
  const warnings = [];

  // Build mutable state map with initial BBox from element properties
  const state = new Map();
  for (const el of elements) {
    if (state.has(el.id)) {
      warnings.push(
        `Element-ID #${el.id} ist mehrfach vorhanden; spaeterer Eintrag wird ignoriert`,
      );
      continue;
    }
    const w = el.width ?? (el.r ? el.r * 2 : 0);
    const h = el.height ?? (el.r ? el.r * 2 : 0);
    state.set(el.id, {
      id: el.id,
      tag: el.tag,
      bbox: { x: el.x ?? 0, y: el.y ?? 0, w, h },
      content: el.content ?? null,
    });
  }
  const originalState = cloneArrangeState(state);

  // Result map accumulates all attribute patches per element
  const results = new Map();

  // §H10 R11-11 (a) ABHÄNGIGKEITS-FLAG (O2): flaches Set der Subjekte, deren
  // Platzierungs-Constraint verweigert wurde und die daher an der AUSGANGSLAGE
  // stehen. Spätere Constraints, die so ein Subjekt referenzieren, rechnen WIE
  // HEUTE (die Messung gegen die Ausgangslage ist wahr) — tragen aber das
  // ehrliche Flag auf der warnings-Schiene (Flag statt Wert-Eingriff). Eine
  // spätere erfolgreiche Platzierung löscht den Eintrag (Aussage bleibt wahr).
  const unplacedRefused = new Set();

  // Process constraints sequentially — order matters
  for (const c of constraints) {
    // §H10 R11-21: Parse-Verweigerung auf der arrange-eigenen warnings-Schiene
    // (gleicher Wortlaut wie der analyze-Pfad — eine Quelle: unparseableDetail).
    if (c.type === 'CONSTRAINT_UNPARSEABLE') {
      warnings.push(`${unparseableDetail(c)}. ${CONSTRAINT_GRAMMAR_HINT}`);
      continue;
    }
    const subjState = state.get(c.subject);
    if (!subjState) {
      warnings.push(`Element #${c.subject} nicht gefunden`);
      continue;
    }

    // §H10 R11-11 (b) IDENTITÄTS-WACHE (O2): Subjekt === Referenz ⇒ der Patch
    // wäre die eigene Ist-Lage (leeres Echo) — verweigern statt „platzieren"
    // (kein attributes-Eintrag), symmetrisch zur checkAllConstraints-Wache.
    if (c.reference != null && c.reference === c.subject) {
      warnings.push(
        `Selbst-Referenz: Subjekt und Referenz sind dasselbe Element (#${c.subject}) — ${c.type} wirkungslos, verweigert`,
      );
      unplacedRefused.add(c.subject);
      continue;
    }

    const refState = c.reference ? state.get(c.reference) : null;
    if (c.reference && !refState) {
      warnings.push(`Referenz #${c.reference} nicht gefunden`);
      unplacedRefused.add(c.subject);
      continue;
    }
    // Guard: constraints requiring a reference but missing one (e.g. '#a DISTANCE-FROM' without ref)
    // FINDING-2-Fix (E6 Re-Review-2): EINE Wahrheit — registry-getriebenes
    // requiresReference() statt zweiter hartkodierter noRefTypes-Liste. Verhalten
    // fuer COLOR/FILL (requiresReference:false) UNVERAENDERT; unbekannte Typen
    // bleiben fail-closed ref-pflichtig (requiresReference(unbekannt)=true) wie
    // zuvor. Ein kuenftiger custom ref-freier Constraint wird hier NICHT mehr
    // faelschlich blockiert (er markiert requiresReference:false bei der
    // Registrierung — analyze- und arrange-Pfad teilen dieselbe SSOT).
    if (!refState && requiresReference(c.type)) {
      warnings.push(`${c.type} benoetigt eine Referenz`);
      unplacedRefused.add(c.subject);
      continue;
    }

    // §H10 R11-11 (a): die Referenz steht (verweigert) an der Ausgangslage —
    // Wert unangetastet rechnen, Vorbehalt aussprechen (ehrliches Flag).
    if (c.reference && unplacedRefused.has(c.reference)) {
      warnings.push(
        `#${c.subject} ${c.type} #${c.reference}: Referenz #${c.reference} wurde nicht platziert (eigene Constraint verweigert) — Platzierung basiert auf der Ausgangslage`,
      );
    }

    const ctx = { canvas };
    if (c.value !== undefined) ctx.value = c.value;

    const patch = arrangeConstraint(c.type, subjState, refState, ctx);
    if (patch === null) {
      if (c.type !== 'COLOR') {
        warnings.push(`${c.type} hat keine arrange-Funktion`);
        unplacedRefused.add(c.subject);
      }
      continue;
    }

    // Merge patch into results
    if (!results.has(c.subject)) results.set(c.subject, {});
    const current = results.get(c.subject);
    Object.assign(current, patch);
    // §H10 R11-11 (a): erfolgreich platziert ⇒ Flag-Aussage wäre falsch.
    unplacedRefused.delete(c.subject);

    // Update BBox in state so next constraint sees new position/size
    if (patch.x !== undefined) subjState.bbox.x = patch.x;
    if (patch.y !== undefined) subjState.bbox.y = patch.y;
    if (patch.cx !== undefined)
      subjState.bbox.x = patch.cx - subjState.bbox.w / 2;
    if (patch.cy !== undefined)
      subjState.bbox.y = patch.cy - subjState.bbox.h / 2;
    if (patch.width !== undefined) subjState.bbox.w = patch.width;
    if (patch.height !== undefined) subjState.bbox.h = patch.height;
    if (patch.r !== undefined) {
      subjState.bbox.w = patch.r * 2;
      subjState.bbox.h = patch.r * 2;
    }
  }

  // Enrich: convert constraint outputs to valid SVG attributes per tag
  const attributes = {};
  for (const [id, attrs] of results) {
    const el = elements.find((e) => e.id === id);
    if (!el) continue;

    const stateEntry = state.get(id);
    const originalEntry = originalState.get(id);
    const enriched = {};
    const hadPositionPatch =
      attrs.x !== undefined ||
      attrs.y !== undefined ||
      attrs.cx !== undefined ||
      attrs.cy !== undefined;

    if (attrs.r !== undefined) {
      enriched.r = attrs.r;
    }
    if (
      el.tag === 'circle' &&
      (attrs.width !== undefined || attrs.height !== undefined)
    ) {
      enriched.r = Math.min(stateEntry.bbox.w, stateEntry.bbox.h) / 2;
    } else {
      if (attrs.width !== undefined) enriched.width = attrs.width;
      if (attrs.height !== undefined) enriched.height = attrs.height;
    }

    if (hadPositionPatch) {
      const dx =
        Math.round((stateEntry.bbox.x - originalEntry.bbox.x) * 10) / 10;
      const dy =
        Math.round((stateEntry.bbox.y - originalEntry.bbox.y) * 10) / 10;
      if (dx !== 0 || dy !== 0 || hasTranslateTransform(el.transform)) {
        enriched.transform = buildTransform(el.transform, dx, dy);
      }
    }

    if (enriched.transform === undefined) {
      if (attrs.x !== undefined) enriched.x = attrs.x;
      if (attrs.y !== undefined) enriched.y = attrs.y;
    }
    attributes[id] = enriched;
  }

  const prose = formatArrangeReport(attributes, warnings);
  return { prose, structured: { attributes, warnings } };
}

// =============================================================================
// §1.9 EICHKÖRPER-SELFTEST (Kalibrierung, anti-zirkulär REGEL-2)
// =============================================================================
//
// Der Selftest ist ein ehrliches MESSWERK (REGEL-3/9): er MISST nur, ändert
// keine Grid/Spotter/Sniper-Logik. Er lädt die 5 golden Eichkörper (EK-1..5),
// ruft das jeweilige Tool und PARTIAL-matcht das Ergebnis gegen die UNABHÄNGIG
// aus den Spec-Formeln abgeleiteten expected-Felder (EK-*.expected.json). Der
// PARTIAL-Match (nur anti-zirk-Felder) ist Pflicht: ein voller bytewise-Vergleich
// gegen expected.json wäre zirkulär (man kopiert Tool-Output rein). Die expected-
// Werte sind die SPEC-WAHRHEIT (Grid/Farbe/Reliability-Formeln), nicht Tool-Output.

const __selftestDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'tests',
  'fixtures',
  'golden',
);

function __loadEk(name) {
  const svg = readFileSync(join(__selftestDir, `${name}.svg`), 'utf8');
  const expected = JSON.parse(
    readFileSync(join(__selftestDir, `${name}.expected.json`), 'utf8'),
  );
  return { svg, expected };
}

/** Findet ein scene.elements-Element per id. */
function __findEl(scene, id) {
  return (scene?.elements || []).find((e) => e.id === id);
}

/**
 * §1.9 PARTIAL-Match eines EK gegen seine anti-zirk-expected-Felder. Liefert
 * eine Liste von Mismatch-Strings (leer === PASS). Asserted NUR die im
 * expected.json hinterlegten Spec-Felder (grid, cell, color, status,
 * total_issues, convergence, reliability, warnings, suppression), NIE den
 * vollen Output (Anti-Zirkularität).
 */
async function __checkEk(name) {
  const { svg, expected } = __loadEk(name);
  const mism = [];
  const tool = expected.tool;
  const cons = expected.constraints || [];

  if (tool === 'palette') {
    const r = await palette(svg);
    const got = r.structured?.colors || [];
    for (const want of expected.expected.colors) {
      const g = got.find((c) => c.id === want.id);
      if (!g) mism.push(`${name}: color id '${want.id}' fehlt`);
      else if (g.fill !== want.fill)
        mism.push(
          `${name}: ${want.id}.fill '${g.fill}' !== spec '${want.fill}'`,
        );
    }
  } else if (tool === 'inspect') {
    const r = await inspect(svg);
    const scene = r.structured?.scene;
    const exp = expected.expected.scene;
    if (exp.grid !== undefined && scene?.grid !== exp.grid)
      mism.push(`${name}: grid '${scene?.grid}' !== spec '${exp.grid}'`);
    if (exp.width !== undefined && scene?.width !== exp.width)
      mism.push(`${name}: width ${scene?.width} !== spec ${exp.width}`);
    if (exp.height !== undefined && scene?.height !== exp.height)
      mism.push(`${name}: height ${scene?.height} !== spec ${exp.height}`);
    const want = exp.elements || exp.elements_contains || [];
    for (const w of want) {
      const g = __findEl(scene, w.id);
      if (!g) {
        mism.push(`${name}: element '${w.id}' fehlt in scene`);
        continue;
      }
      for (const key of ['tag', 'cell', 'color', 'bbox_reliability']) {
        if (w[key] !== undefined && g[key] !== w[key])
          mism.push(`${name}: ${w.id}.${key} '${g[key]}' !== spec '${w[key]}'`);
      }
      if (w.warnings !== undefined) {
        const gw = JSON.stringify(g.warnings || []);
        const ww = JSON.stringify(w.warnings);
        if (gw !== ww)
          mism.push(`${name}: ${w.id}.warnings ${gw} !== spec ${ww}`);
      }
    }
  } else if (tool === 'analyze') {
    const r = await analyze(svg, cons);
    const s = r.structured;
    const exp = expected.expected;
    if (exp.status !== undefined && s?.status !== exp.status)
      mism.push(`${name}: status '${s?.status}' !== spec '${exp.status}'`);
    if (exp.iteration) {
      for (const key of Object.keys(exp.iteration)) {
        if (s?.iteration?.[key] !== exp.iteration[key])
          mism.push(
            `${name}: iteration.${key} ${s?.iteration?.[key]} !== spec ${exp.iteration[key]}`,
          );
      }
    }
    for (const want of exp.corrections_contains || []) {
      const hit = (s?.corrections || []).some(
        (c) => c.element === want.element && c.constraint === want.constraint,
      );
      if (!hit)
        mism.push(
          `${name}: correction ${want.element}:${want.constraint} fehlt`,
        );
    }
  }

  // §S4/D2 Frozen-Clock-Assert (REGEL-2 + Residual #1 Mitigation): NUR für den
  // Zeit-EK (EK-5). Belegt die Frame-vs-Clock-KOPPLUNG mit einem GEOMETRIE-
  // Doppelbeleg — nicht nur getCurrentTime()===0 (das wäre F-TF-019-Klasse:
  // belegt die Uhr, nicht dass getBBox den t=0-Frame sieht). #anim cx from=30
  // to=170 dur=2s: Center-x MUSS bei t=0 ≈ 30 UND bei t=1.0 ≈ 100 (30+(170-30)
  // *0.5) sein. WICHTIG (REGEL-2): die expected-WERTE bleiben bit-identisch;
  // weicht hier etwas ab → echter seek/Reflow-Bug = Honest-Red, NICHT die
  // expected.json nachziehen.
  if (expected.frozen_clock_assert) {
    const g0 = await __probeFrozenGeometryAt(svg, 'anim', 0);
    const g1 = await __probeFrozenGeometryAt(svg, 'anim', 1.0);
    if (g0.error)
      mism.push(`${name}: frozen_clock t=0-Probe-Fehler ${g0.error}`);
    else if (Math.abs(g0.cx - 30) >= 1.0)
      mism.push(
        `${name}: frozen_clock cx@t0 ${g0.cx?.toFixed?.(3)} !== 30 (±1.0) — Clock NICHT bei t=0 eingefroren`,
      );
    if (g1.error)
      mism.push(`${name}: frozen_clock t=1.0-Probe-Fehler ${g1.error}`);
    else if (Math.abs(g1.cx - 100) >= 2.0)
      mism.push(
        `${name}: frozen_clock cx@t1.0 ${g1.cx?.toFixed?.(3)} !== 100 (±2.0) — seek bewegt die Geometrie NICHT (Frame-vs-Clock-Entkopplung)`,
      );
    if (!g0.error && !g1.error && Math.abs(g1.cx - g0.cx - 70) >= 3.0)
      mism.push(
        `${name}: frozen_clock KOPPLUNG-Delta ${(g1.cx - g0.cx)?.toFixed?.(3)} !== 70 (±3.0)`,
      );
  }

  // §1.9 EK-4 Suppression (REGEL-3 Spotter-Anti-Lüge): analyze-correction für
  // ein not_measurable-Element DARF KEINE Pixel-Deltas/fix tragen.
  if (expected.expected.analyze_suppression) {
    const sup = expected.expected.analyze_suppression;
    const r = await analyze(svg, sup.constraints);
    const corr = (r.structured?.corrections || []).find(
      (c) => c.element === sup.element,
    );
    if (!corr) {
      mism.push(`${name}: suppression-correction ${sup.element} fehlt`);
    } else {
      for (const key of sup.forbidden_keys) {
        if (corr[key] !== undefined)
          mism.push(
            `${name}: suppression-Bruch — ${sup.element}.${key} ist gesetzt (REGEL-3)`,
          );
      }
    }
  }

  return mism;
}

const __EK_NAMES = [
  'EK-1_color',
  'EK-2_position',
  'EK-3_constraint',
  'EK-4_3d',
  'EK-5_animation',
];

/**
 * §1.9 Eichkörper-Selftest: läuft die 5 EK-Fixtures, PARTIAL-matcht jede gegen
 * ihre anti-zirk-expected-Felder (Spec-Wahrheit). full=true → zusätzlich ein
 * N=10-Mini-Determinismus-Check (gleicher EK 10× via inspect, gestrippte
 * Bytewise-Gleichheit der scene). Server-Start-tauglich (schnell, ein Browser).
 *
 * Setzt den Modul-State lastCalibration (status.calibration lesbar). Returns
 * { status:'PASS'|'FAIL', calibrated, total, failures, structured, prose }.
 */
export async function runSelftest(full = false) {
  if (!page) await init();

  const failures = [];
  let calibrated = 0;
  for (const name of __EK_NAMES) {
    let mism;
    try {
      mism = await __checkEk(name);
    } catch (err) {
      mism = [`${name}: Ausnahme — ${err.message}`];
    }
    if (mism.length === 0) calibrated++;
    else for (const m of mism) failures.push({ ek: name, reason: m });
  }

  // full=true: schneller N=10-Determinismus-Mini-Check (inspect EK-2, gestrippt).
  if (full) {
    const { svg } = __loadEk('EK-2_position');
    const seen = new Set();
    for (let i = 0; i < 10; i++) {
      const r = await inspect(svg);
      seen.add(JSON.stringify(r.structured?.scene));
    }
    if (seen.size !== 1) {
      failures.push({
        ek: 'EK-2_position',
        reason: `full-Determinismus: ${seen.size}/10 unique (erwartet 1)`,
      });
    }
  }

  const status = failures.length === 0 ? 'PASS' : 'FAIL';
  const total = __EK_NAMES.length;
  lastCalibration = {
    status,
    calibrated,
    total,
    timestamp: new Date().toISOString(),
  };

  const prose =
    status === 'PASS'
      ? `Selftest PASS: ${calibrated}/${total} Eichkörper kalibriert (anti-zirk Spec-Match).`
      : `Selftest FAIL: ${calibrated}/${total} kalibriert, ${failures.length} Abweichung(en):\n` +
        failures.map((f) => `  - ${f.ek}: ${f.reason}`).join('\n');

  return {
    status,
    calibrated,
    total,
    failures,
    prose,
    structured: { status, calibrated, total, failures },
  };
}

/**
 * §1.9 Server-Start-Hook: markiert die Kalibrierung als PENDING, BEVOR der
 * fire-and-forget runSelftest() nach connect läuft (status.calibration zeigt
 * dann PENDING bis der Selftest fertig ist). Idempotent.
 */
export function markCalibrationPending() {
  lastCalibration = {
    status: 'PENDING',
    calibrated: 0,
    total: __EK_NAMES.length,
    timestamp: new Date().toISOString(),
  };
}
