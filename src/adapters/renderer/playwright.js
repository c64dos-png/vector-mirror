/**
 * playwright.js - SVG Resolution with 4-Point Projection & Security
 * Migrated 1:1 from resolver.js (v1.6)
 * Vector Mirror v2.0
 *
 * Adapter module: Wraps external I/O (Playwright headless browser)
 *
 * §1.3 Schicht 1+3 (R2-F02): Mutex.runExclusive serialises the
 * setContent+evaluate page-bound critical section; Page-Recycling after
 * RECYCLE_AFTER renders bounds detached-DOM growth (Playwright Issue #16832).
 */

import { Mutex } from 'async-mutex';
import DOMPurify from 'isomorphic-dompurify';
import { chromium } from 'playwright';
import {
  isSpotterTag,
  SKIP_TAGS,
  SPOTTER_TAGS_LIST,
} from '../../core/element_vocabulary.js';
import { computeSvgHashPrefix } from '../../core/sanitizer/auto_ids.js';
// D1c (MD-LOOP): die use-Graph-Amplifikations-Analyse ist als gehärtete reine
// Komponente isoliert (core/use_graph.js, REGEL-4-rein, iterativ, never-throw,
// alle top-level svgs, Forwarder-Hop-bewusst). EHRLICHE Abdeckung (kein
// Over-Claiming): (1) der statische Estimate ist best-effort-Frühabweisung —
// jetzt forwarder-korrekt, aber weiter eine SCHÄTZUNG; (2) Last-Resort ist der
// setContent-5s-Timeout (echter Render hängt → LOAD_FAILED). Der post-render-
// Knoten-Cap (querySelectorAll('*') > 500) zählt QUELL-DOM-Knoten, NICHT die
// use-Shadow-Expansion (SVG2 §5.6: Instanzen sind nicht im Light-DOM) — er
// bounded die Quell-Größe, ist KEINE Schranke gegen die gerenderte Instanz-Zahl.
import {
  analyzeUseGraph,
  canonicalizeFragment,
  MAX_USE_REFERENCE_DEPTH,
  MAX_USE_TOTAL_EXPANSION,
} from '../../core/use_graph.js';

// ═══════════════════════════════════════════════════════════════════════════
// L-005-D1 — Lossless-or-loud Sanitizer (R1, ADR L-005 §DECISION D1).
//
// HEUTE (status quo) strippt `USE_PROFILES:{svg}` <use>/<symbol> + die
// SMIL-Timing-Attribute (begin/from/to/values/dur/...) STILL VOR dem Render
// (cure53/DOMPurify #1058) → der Spiegel misst Phantome (defs-Template am
// Origin statt der use-Instanz an transformierter Position) und meldet sie als
// reliable. C1/Q-001 = „Sehen & rendern (gehärtet)": die Tags überleben sanitize
// (erhalten-und-rendern), Security bleibt scharf (href #-lokal, kein script,
// kein ALLOW_UNKNOWN_PROTOCOLS), und was DOCH verloren geht wird LAUT gemeldet
// (`resolved.sanitize_loss`), nie still gelogen.
// ═══════════════════════════════════════════════════════════════════════════

// D1 Allowlist — use/symbol + SMIL-Elemente überleben sanitize.
const SANITIZE_ADD_TAGS = Object.freeze([
  'use',
  'symbol',
  'animate',
  'animateTransform',
  'animateMotion',
  'set',
  'mpath',
]);
// D1 Allowlist — die use/SMIL-Attribute (sonst einzeln gestrippt trotz ADD_TAGS).
const SANITIZE_ADD_ATTR = Object.freeze([
  'href',
  'xlink:href',
  'begin',
  'from',
  'to',
  'values',
  'keyTimes',
  'keyPoints',
  'dur',
  'attributeName',
  'repeatCount',
  'fill',
]);

// D1c — MAX_USE_REFERENCE_DEPTH + MAX_USE_TOTAL_EXPANSION sind jetzt SSOT in
// core/use_graph.js (importiert oben). Der Adapter nutzt sie nur für die
// Fehler-Texte; die DoS-Entscheidung trifft analyzeUseGraph (rejected-Flag).

// D1 Verlust-Diff — DOMPurify.removed trägt unter isomorphic-dompurify (jsdom-
// Wrapper) IMMER einen BODY-Hüllen-Eintrag, der KEIN semantischer SVG-Verlust
// ist. Diese Tags sind Artefakte des jsdom-Containers, kein Spotter-Verlust.
const SANITIZE_REMOVED_WRAPPER_TAGS = Object.freeze(
  new Set(['body', 'html', 'head', '#document', '#document-fragment']),
);

// D1 href-Härtung (CVE-2026-22610-Klasse) — externe use-Targets, die der
// uponSanitizeAttribute-Hook im LETZTEN sanitize-Call abgelehnt hat. SHARED
// GLOBAL, exakt wie DOMPurify.removed: JS ist single-threaded und
// DOMPurify.sanitize läuft synchron bis Ende (inkl. aller Hook-Aufrufe) BEVOR
// der nächste Call startet — daher race-frei, solange synchron im selben Tick
// nach dem sanitize gelesen (und VOR dem sanitize geleert) wird. Treibt — wie
// removed — AUSSCHLIESSLICH Reporting, NIE eine allow/deny-Entscheidung (die
// allow/deny-Wahrheit ist `data.keepAttr = false` IM Hook selbst).
let externalUseRejected = [];

// D1 href-Härtung — der uponSanitizeAttribute-Hook. href/xlink:href NUR als
// same-document `#fragment` zulassen; jedes externe/data:/javascript:-Target
// ABLEHNEN (Attribut entfernen) UND das Element als EXTERNAL_USE_NOT_RESOLVED
// flaggen (Q-001/Q3: externe use NIE auflösen — SSRF/billion-laughs). Wir
// fügen den Hook EINMAL beim Modul-Load hinzu (DOMPurify ist ein Singleton);
// `removeHook` mit dem benannten Handler garantiert Idempotenz auch bei einem
// Re-Import (ESM-Cache macht das praktisch unnötig, aber defensiv exakt).
// S3/D1-R6 — der fail-closed `%`/control-char-Riegel (b). LASTTRAGEND, NICHT
// optionale Politur (hardening): er schließt die GESAMTE Prozent-Achse
// hart, inklusive der gemischt-valide/invalide-Prozent-Bypass-Klasse, wo die
// Kanon (all-or-nothing decodeURIComponent) von Chromium (per-Sequenz-decode)
// divergiert — z.B. `#a%30%zzb`: Kanon → roher `a%30%zzb` (MISS), Chromium →
// `a0%zzb` (HIT) = Bypass. Da jedes `%`-haltige Fragment hier VOR dem Render
// gestrippt wird, sieht Chromium es nie. Kein legitimer ASCII-Sprite (`#icon-home`)
// nutzt `%`/Control-Char in der id → bricht nichts (Negativ-Kontrolle grün).
// Code-Point-Scan statt Regex (vermeidet noControlCharactersInRegex; identische
// Semantik, deterministisch): `%` (0x25) ODER irgendein Control-Char 0x00-0x1f.
function hasPercentOrControl(value) {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 0x25 || c <= 0x1f) return true;
  }
  return false;
}

function hardenHrefHook(node, data) {
  const attrName = data.attrName;
  if (attrName !== 'href' && attrName !== 'xlink:href') return;
  const rawValue = data.attrValue || '';
  const reject = () => {
    externalUseRejected.push({
      tag: (node.nodeName || '').toLowerCase(),
      attr: attrName,
      href: rawValue.trim(),
    });
    data.keepAttr = false;
    data.attrValue = '';
  };
  // (b) FAIL-CLOSED ZUERST (vor jedem `#`-Prefix-Test): jedes Fragment mit `%`
  // (jede Prozent-Sequenz, valide ODER malformed) oder Control-Char (0x00-0x1f)
  // → ablehnen. Schließt die Prozent-Achse hart, BEVOR ein `#`-Prefix sie
  // durchlässt (der r5-Kill „Hook akzeptiert '#'-Prefix per substring" bleibt tot).
  if (hasPercentOrControl(rawValue)) {
    reject();
    return;
  }
  // (a) Same-document `#fragment` ist die EINZIGE erlaubte Form, über die GETEILTE
  // Kanon-SSOT entschieden (Hook + Analyzer meinen dasselbe `#fragment`). Alles
  // andere (http(s):, file:, data:, javascript:, protokoll-relativ //, absolute/
  // relative Pfade, leeres/`#`-loses) → externes/unsicheres Target → ablehnen.
  const canon = canonicalizeFragment(rawValue.trim());
  if (canon !== null && canon.length > 0) return;
  reject();
}
DOMPurify.removeHook('uponSanitizeAttribute', hardenHrefHook);
DOMPurify.addHook('uponSanitizeAttribute', hardenHrefHook);

/**
 * D1 Verlust-Diff — liest DOMPurify.removed SYNCHRON im selben Tick nach einem
 * sanitize und mappt es (plus die hook-erfassten externen use-Targets) auf das
 * REPORTING-Feld `sanitize_loss`. Reine Funktion über die beiden shared globals;
 * trifft KEINE Security-Entscheidung (README-Caveat: removed ist kein
 * Security-Primitive). Wrapper-Artefakte (body/html — jsdom-Container) werden
 * gefiltert; nur echte SVG-Tag-/Attr-Verluste + abgelehnte externe Refs zählen.
 *
 * @param {Array} removed - Snapshot von DOMPurify.removed (selber Tick).
 * @param {Array<{tag:string,attr:string,href:string}>} externalRejected - Hook-Funde.
 * @returns {Array<{tag:string, reason:string, value?:string}>} sanitize_loss
 *   (leer = lossless). `value` trägt bei ATTR_STRIPPED den gestrippten Wert
 *   (z.B. die verlorene id) für den downstream Render-Zeit-Dangling-Check (T2).
 */
function buildSanitizeLoss(removed, externalRejected) {
  // Der href-Härtungs-Hook entfernt ein abgelehntes externes href, was DOMPurify
  // ZUSÄTZLICH als ATTR_STRIPPED:href in `removed` verbucht. Das wäre Doppel-
  // Reporting (ATTR_STRIPPED:href UND EXTERNAL_USE_NOT_RESOLVED für DIESELBE
  // Ablehnung). Wir unterdrücken den ATTR_STRIPPED-Eintrag für genau die
  // href/xlink:href-Attribute, die der Hook abgelehnt hat (gezählt pro
  // Owner-Tag), und melden NUR die semantisch präzise EXTERNAL_USE_NOT_RESOLVED.
  const rejectedHrefByTag = new Map();
  for (const ext of externalRejected) {
    const key = ext.tag || 'use';
    rejectedHrefByTag.set(key, (rejectedHrefByTag.get(key) || 0) + 1);
  }
  const loss = [];
  for (const r of removed) {
    // Tag-Verlust (gestripptes Element).
    if (r.element) {
      const tag = (r.element.nodeName || r.element.tagName || '').toLowerCase();
      if (!tag || SANITIZE_REMOVED_WRAPPER_TAGS.has(tag)) continue;
      loss.push({ tag, reason: 'TAG_STRIPPED' });
      continue;
    }
    // Attribut-Verlust (gestripptes Attribut auf einem überlebenden Element).
    if (r.attribute) {
      const attr = (r.attribute.name || '').toLowerCase();
      const owner = (
        r.from?.nodeName ||
        r.attribute.ownerElement?.nodeName ||
        ''
      ).toLowerCase();
      if (SANITIZE_REMOVED_WRAPPER_TAGS.has(owner)) continue;
      // Dedup: dieser href-Strip stammt vom href-Hook → wird unten als
      // EXTERNAL_USE_NOT_RESOLVED gemeldet, nicht doppelt als ATTR_STRIPPED.
      if (
        (attr === 'href' || attr === 'xlink:href') &&
        (rejectedHrefByTag.get(owner) || 0) > 0
      ) {
        rejectedHrefByTag.set(owner, rejectedHrefByTag.get(owner) - 1);
        continue;
      }
      // T2: den gestrippten Attribut-WERT mitführen (z.B. die verlorene id), damit
      // downstream bekannt ist, WELCHE Referenz divergieren wird (Render-Zeit-
      // Dangling-Check). Additiv-optional: nur gesetzt, wenn ein Wert vorliegt.
      const value =
        r.attribute.value != null ? String(r.attribute.value) : undefined;
      loss.push({
        tag: owner || `@${attr}`,
        reason: `ATTR_STRIPPED:${attr}`,
        ...(value !== undefined ? { value } : {}),
      });
    }
  }
  for (const ext of externalRejected) {
    loss.push({ tag: ext.tag || 'use', reason: 'EXTERNAL_USE_NOT_RESOLVED' });
  }
  return loss;
}

/**
 * D1 Sanitize-Wrapper — EINZIGER Eintrittspunkt für DOMPurify im Adapter.
 * Leert die shared-global Hook-Erfassung, ruft sanitize EINMAL mit der
 * D1-Allowlist und `RETURN_DOM` (gibt den geparsten DOM-Wrapper — dessen
 * `innerHTML` ist byte-identisch zur String-Rückgabe, verifiziert), liest
 * removed + Hook-Funde SYNCHRON im selben Tick (race-frei: synchron +
 * single-threaded) und analysiert den use-Graphen über die isolierte reine
 * Komponente core/use_graph.js (B1+B2+B7+Multi-svg+Deep-nest, never-throw).
 *
 * NEVER-THROW (B1): der DOMPurify(jsdom)-PARSER selbst kann bei extrem tiefem
 * Nicht-use-Nest (z.B. depth-5000 <g>) intern mit RangeError werfen — VOR
 * analyzeUseGraph. Wir fangen das hier und liefern `sanitizeFailed:true` →
 * resolve() macht daraus den dokumentierten SECURITY_VIOLATION (kein Crash,
 * kein uncaught). analyzeUseGraph selbst wirft per Vertrag nie.
 *
 * @param {string} svgString
 * @returns {{clean:string, sanitizeLoss:Array<{tag:string,reason:string}>,
 *   useGraph:object, sanitizeFailed:boolean}}
 */
function sanitizeSvg(svgString) {
  externalUseRejected = [];
  let dom;
  try {
    dom = DOMPurify.sanitize(svgString, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ADD_TAGS: [...SANITIZE_ADD_TAGS],
      ADD_ATTR: [...SANITIZE_ADD_ATTR],
      // SECURITY-Anker (CVE-2026-22610-Klasse): NIE unknown protocols, NIE script.
      // (Default-FORBID lässt script ohnehin nicht zu; explizit für Audit-Klarheit.)
      ALLOW_UNKNOWN_PROTOCOLS: false,
      FORBID_TAGS: ['script'],
      // RETURN_DOM: die strukturelle use-Graph-Analyse braucht den geparsten
      // DOM, nicht den String. innerHTML == String-Rückgabe.
      RETURN_DOM: true,
    });
  } catch {
    // B1: jsdom-Parser-Crash (z.B. depth-5000-Nest) → kontrolliertes Signal,
    // kein uncaught throw. Caller macht daraus SECURITY_VIOLATION.
    return {
      clean: '',
      sanitizeLoss: [{ tag: 'svg', reason: 'SANITIZE_PARSE_FAILED' }],
      useGraph: {
        maxDepth: Number.POSITIVE_INFINITY,
        totalExpansion: Number.POSITIVE_INFINITY,
        cyclic: false,
        rejected: true,
        reason: 'SANITIZE_PARSE_FAILED',
      },
      sanitizeFailed: true,
    };
  }
  // SYNCHRON im selben Tick lesen (shared globals, kein await dazwischen).
  const sanitizeLoss = buildSanitizeLoss(
    DOMPurify.removed,
    externalUseRejected,
  );
  // Isolierte, gehärtete, reine Komponente (REGEL-4): wirft NIE; bei jeder
  // Anomalie/Budget-Überschreitung → {rejected:true}.
  const useGraph = analyzeUseGraph(dom);
  return {
    clean: dom.innerHTML,
    sanitizeLoss,
    useGraph,
    sanitizeFailed: false,
  };
}

/**
 * D1 Startup-Self-Test — fängt #1152-Versionsdrift am Boot: ein bekanntes SVG
 * mit <use href="#…"> + <animate> MUSS die D1-Sanitize-Config überleben, und
 * ein externes href + <script> MUSS abgelehnt werden. Spiegelt den existierenden
 * Vokabular-Drift-Guard (Z. ~286-309): wenn die gepinnte DOMPurify-Version die
 * Allowlist nicht mehr ehrt, wirft das hier hart beim Modul-Load statt still
 * Phantome zu rendern. Idempotent, läuft EINMAL beim ersten Import.
 *
 * @throws {Error} wenn die Sanitize-Config die D1-Invarianten nicht hält.
 */
function runSanitizerSelfTest() {
  const probe = sanitizeSvg(
    '<svg xmlns="http://www.w3.org/2000/svg"><defs><rect id="s" width="10" height="10"/></defs>' +
      '<use href="#s"/><rect><animate attributeName="x" from="0" to="10" dur="1s"/></rect>' +
      '<use href="http://evil.example/x"/><script>void 0</script></svg>',
  );
  const c = probe.clean;
  const errors = [];
  if (!c.includes('<use')) errors.push('use stripped (ADD_TAGS broken)');
  if (!/href="#s"|xlink:href="#s"/.test(c))
    errors.push('same-document href dropped');
  if (!c.includes('<animate'))
    errors.push('animate stripped (ADD_TAGS broken)');
  if (!(c.includes('from="0"') && c.includes('to="10"')))
    errors.push('SMIL from/to stripped (ADD_ATTR broken)');
  if (/<script/i.test(c)) errors.push('script survived (SECURITY)');
  if (c.includes('http://evil'))
    errors.push('external href survived (SECURITY)');
  if (!probe.sanitizeLoss.some((l) => l.reason === 'EXTERNAL_USE_NOT_RESOLVED'))
    errors.push('external use not flagged EXTERNAL_USE_NOT_RESOLVED');
  if (errors.length > 0) {
    throw new Error(
      `L-005-D1 Sanitizer-Self-Test FAILED (DOMPurify-Versionsdrift? — Pin prüfen): ${errors.join('; ')}`,
    );
  }
}

// EINMAL beim Modul-Load: Config-Greift-Beweis (fail-fast statt still-Phantom).
runSanitizerSelfTest();

let browser = null;
// B6 — der explizite BrowserContext, auf dem die SSRF-Netzwerk-Denylist
// (context.route) installiert ist. EXPLIZIT (nicht der implizite Default-Context
// von browser.newPage()), weil context.route LIFECYCLE-INVARIANT ist: sie
// überlebt das Page-Recycling (RECYCLE_AFTER) — anders als page.route, die nur
// an der EINEN Page hing und nach dem Recycle (frische Page) verschwand (B6).
// activePage entsteht IMMER via activeContext.newPage() (Initial + Recycle),
// damit die Route strukturell unumgehbar gilt. Wird zusammen mit `browser`/
// `activePage` epoch-geguarded mutiert; das Schliessen des Browsers schliesst
// den Context mit (kein separates Cleanup nötig).
let activeContext = null;
let activePage = null;
let pageCallCount = 0;
let pageRecycleCount = 0;

// §1.7 P4 (Hexagonal-DI): aktive Failure-Signal-Bruecke. page.on('crash') und
// browser.on('disconnected') gehoeren in DIESEN Adapter (Playwright-Wissen),
// duerfen aber lib/breaker.js NICHT verschmutzen. Die Pipeline injiziert einen
// Callback (setDeadSignal); die Listener rufen NUR diesen Callback — kein
// breaker-Import hier. So bleibt der Hexagonal-Vertrag gewahrt.
//
// `browserDead` ist die adapter-interne Wahrheit: nach Crash/Disconnect liefert
// resolve() sofort LOAD_FAILED (Breaker zaehlt), statt passiv in den
// setContent-Timeout zu laufen. createResolver() setzt es auf false zurueck.
let deadSignal = null;
let browserDead = false;

// B4/B6 — Zähler der von der SSRF-Denylist abgebrochenen externen Requests.
// Monoton, prozessweit; treibt NUR Test-/Audit-Beleg (kein Reporting-Vertrag).
let externalRequestsBlocked = 0;

// B6 — DEFAULT-DENY-Schema-Liste für die SSRF-Denylist. NUR diese Schemata sind
// inline/kein-Netz und werden durchgelassen; ALLES andere (http/https/file/ftp/
// ws/wss + protokoll-relativ // — Letzteres erscheint im Request-URL bereits
// zum about:blank-Origin aufgelöst, daher implizit erfasst) wird abgebrochen.
// Default-deny statt Allowlist-Lücke: ein künftiges exotisches Fetch-Schema
// (resource://, chrome-extension://, …) ist automatisch geblockt, nicht
// versehentlich erlaubt. Der gerenderte Frame ist immer ein setContent-HTML
// (about:blank-Origin) — er BRAUCHT nie eine echte externe Navigation.
const ALLOWED_REQUEST_SCHEMES = /^(data:|blob:|about:)/i;

/**
 * B6 — installiert die SSRF-Netzwerk-Denylist auf einem BrowserContext (NICHT
 * einer Page). context.route ist lifecycle-invariant: sie überlebt jedes
 * Page-Recycling, weil sie am Context hängt, aus dem alle Pages entstehen.
 * Default-deny: nur data:/blob:/about: laufen durch, jeder andere Request
 * (http/https/file/ftp/ws/…) wird abgebrochen BEVOR er das Netz erreicht.
 * Deckt die GANZE CSS-/Ressourcen-SSRF-Fläche, die der href-Hook nicht sieht
 * (style/`fill=url()`/filter/mask/clip-path/stroke/`<image href>`/feImage/
 * `@import`), an EINEM lifecycle-invarianten Punkt.
 *
 * @param {import('playwright').BrowserContext} context
 * @returns {Promise<void>}
 */
async function installNetworkDenylist(context) {
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (!ALLOWED_REQUEST_SCHEMES.test(url)) {
      externalRequestsBlocked++;
      return route.abort();
    }
    return route.continue();
  });
}

// §1.7 EPOCH/GENERATIONS-MODELL (eine dominierende Mechanik statt verstreuter
// Punkt-Guards). INVARIANTE: NUR die aktuelle Generation darf Modul-State
// (browser/activePage) mutieren; ein superseded Launch schliesst seinen EIGENEN
// Browser OHNE State-Eingriff. createResolver captured `++launchEpoch` VOR dem
// chromium.launch und prueft NACH dem await `epoch === launchEpoch`. closeResolver
// und shutdown bumpen den Epoch → invalidieren alle in-flight Launches. Das deckt
// die KONSTRUKTIVEN Zuweisungen ab (die alte owned-Compare-and-Null-Luecke).
let launchEpoch = 0;

/**
 * §1.7 P4: injiziert den Cross-Layer-Callback, den die Crash/Disconnect-
 * Listener feuern. Pipeline ruft das in init() (DI-Verkabelung). Idempotent.
 * @param {(reason: string) => void | null} cb
 */
export function setDeadSignal(cb) {
  deadSignal = typeof cb === 'function' ? cb : null;
}

/** Test-only: adapter-interner Liveness-Status (browserDead-Flag). */
export function __isBrowserDead() {
  return browserDead;
}

/** Test-only (B4): Anzahl der von der SSRF-Denylist abgebrochenen externen
 *  http(s)-Requests seit Prozessstart. Beleg, dass externe Refs nie ans Netz
 *  gehen (no-fetch wird im Test ZUSÄTZLICH über page-Request-Events bewiesen). */
export function __getExternalRequestsBlocked() {
  return externalRequestsBlocked;
}

/** §1.7: invalidiert alle in-flight createResolver-Launches (bumpt launchEpoch).
 *  Wird von shutdown() (Pipeline) genutzt, damit ein spaet fertig werdender
 *  Launch nach shutdown KEINEN Browser/State wiederherstellt. Schliesst NICHT —
 *  der superseded Launch schliesst sich selbst. */
export function invalidateLaunches() {
  launchEpoch++;
}

/** Test-only: aktueller launchEpoch (Generations-Verifikation). */
export function __getLaunchEpoch() {
  return launchEpoch;
}

/** Plan §1.3 Schicht 3: Recycle the Playwright Page after N renders to
 *  bound detached-DOM growth (Playwright Issue #16832 / Browserless BP). */
export const RECYCLE_AFTER = 50;
let recycleAfter = RECYCLE_AFTER;

// ═══════════════════════════════════════════════════════════════════════════
// MESS-PRIMITIV (impl_plan.md §9, decision_and_buildplan.md)
//
// PHASE 0 (Entkopplung): Die Messung ist VOLLSTÄNDIG aus dem breaker-getimeten
// resolve()-Pfad entfernt. Der Mess-Primitiv (MEASURE_WALK_FN, runMediaGoldenDiff,
// die __measure*-Exporte) bleibt als EIGENSTÄNDIGE, direkt aufrufbare Funktion
// erhalten — für spätere Offline-Beobachtung (Phase 1) und den bounded Flip
// (spätere Phase) — wird aber NICHT mehr auto-getriggert in resolve(). Es gibt
// daher kein resolve()-Schatten-Flag mehr (das frühere MEASURE_MEDIA_SHADOW /
// MIRROR_MEASURE_MEDIA_SHADOW); die Mess-Exporte laufen, wenn sie direkt
// aufgerufen werden, ohne Flag-Gate.
// ═══════════════════════════════════════════════════════════════════════════

/** Test-only API: lower the recycle threshold to make Schicht-3
 *  triggerable inside bespoke tests without hammering through 50 renders. */
export function __setRecycleAfter(n) {
  recycleAfter = n;
}

/** Test-only API: read page-counter + recycle-count for stress-test
 *  Stop-Condition-Verification (§1.3). */
export function __getPageMetrics() {
  return { calls: pageCallCount, recycles: pageRecycleCount };
}

/** Plan §1.3 Schicht 1: serialise setContent+evaluate per Page.
 *  Race-Surface: Playwright's single Page mutates DOM between setContent
 *  and evaluate; parallel callers would interleave content. */
const pageMutex = new Mutex();

/**
 * Startet einen frischen Browser + Page. F-SVG-033: schliesst einen evtl.
 * bestehenden Browser VOR dem Relaunch (close-then-relaunch — halfOpen WILL
 * einen frischen). Invariante: hoechstens EIN Browser.
 *
 * §1.7 EPOCH-MODELL: `epoch = ++launchEpoch` VOR chromium.launch. Nach jedem
 * await wird geprueft, ob dieser Launch noch die aktuelle Generation ist
 * (`epoch === launchEpoch`). Ist er superseded (ein neuerer createResolver,
 * closeResolver oder shutdown hat den Epoch gebumpt), schliesst dieser Launch
 * seinen EIGENEN Browser und gibt `null` zurueck — er fasst KEINE Modul-Vars an.
 * Das deckt die KONSTRUKTIVEN Zuweisungen (browser=/activePage=) ab, die der
 * fruehere owned-Compare-and-Null-Guard NICHT schuetzte.
 *
 * @returns {Promise<import('playwright').Page|null>} Page der aktuellen
 *   Generation, oder `null` wenn dieser Launch superseded wurde.
 */
export async function createResolver() {
  // §1.7 ADR-1 (Epoch am ECHTEN Start): den Epoch als ALLERERSTE Aktion erfassen
  // — VOR `await owned.close()`. Sonst wuerde ein an owned.close() suspendierter
  // Launch seinen Epoch erst beim Resume ziehen und ein zwischenzeitliches
  // shutdown/closeResolver (das launchEpoch bumpt) NICHT bemerken → er koennte
  // nach shutdown einen Browser WIEDERBELEBEN (Resurrection). Mit Erfassung am
  // Start ist `epoch !== launchEpoch` genau dann wahr, wenn ein KONKURRENTES
  // close/shutdown/createResolver dazwischenkam — exakt der Fall, den wir fangen.
  const epoch = ++launchEpoch;

  // Bestehenden Browser schliessen (owned-Guard gegen konkurrente Mutation
  // waehrend des close-awaits).
  if (browser) {
    const owned = browser;
    try {
      await owned.close();
    } catch {
      // toter/abgestuerzter Browser: close kann werfen — egal, wir relaunchen.
    }
    if (browser === owned) {
      browser = null;
      activeContext = null; // Context starb mit dem Browser
      activePage = null;
    }
  }

  // §1.7 ADR-1 SUPERSEDED-Check #0 (nach owned.close): ein waehrend des
  // close-awaits gelaufenes shutdown/closeResolver/createResolver hat den Epoch
  // ueberholt. Dieser Launch raeumt sich selbst auf (er hat noch NICHTS
  // gelauncht) und startet KEINEN Browser → keine Resurrection.
  if (epoch !== launchEpoch) {
    return null;
  }

  const newBrowser = await chromium.launch({
    headless: true,
    // --no-sandbox: Required when running as root or in containers.
    // Acceptable because we only render DOMPurify-sanitized SVGs, never untrusted URLs.
    // See: playwright.dev/docs/docker ("trusted code" section)
    args: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  // SUPERSEDED-Check #1 (nach launch): ein neuerer Launch/close/shutdown hat den
  // Epoch ueberholt → dieser Browser ist veraltet. Selbst schliessen, kein
  // State-Eingriff, null signalisieren.
  if (epoch !== launchEpoch) {
    await newBrowser.close().catch(() => {});
    return null;
  }

  // B6 — EXPLIZITER BrowserContext + SSRF-Denylist DARAUF (nicht auf der Page).
  // browser.newPage() würde einen impliziten Default-Context pro Page erzeugen —
  // page.route hinge dann nur an dieser einen Page und verschwände beim Recycle
  // (genau die B6-Regression). Ein expliziter Context, aus dem ALLE Pages
  // (Initial + Recycle) entstehen, trägt die Route lifecycle-invariant.
  const newContext = await newBrowser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  await installNetworkDenylist(newContext);
  const newPage = await newContext.newPage();

  // SUPERSEDED-Check #2 (nach newContext/route/newPage — alle async): erneut
  // pruefen, da zwischenzeitlich ueberholt worden sein kann.
  if (epoch !== launchEpoch) {
    await newBrowser.close().catch(() => {});
    return null;
  }

  // GEWINNER der aktuellen Generation: jetzt (und NUR jetzt) Modul-State mutieren.
  browser = newBrowser;
  activeContext = newContext;
  activePage = newPage;
  pageCallCount = 0;
  pageRecycleCount = 0;
  browserDead = false; // frischer Browser ist lebendig

  // §1.7 P4: AKTIVE Failure-Quellen. Crash/Disconnect markieren den Browser
  // sofort als tot (resolve() liefert dann LOAD_FAILED → Breaker zaehlt) und
  // signalisieren der Pipeline via injiziertem Callback — KEIN breaker-Import
  // (Hexagonal). Closure faengt die AKTUELLE browser-Instanz, damit ein
  // disconnected-Event eines ALTEN (bereits ersetzten) Browsers nicht den
  // frischen faelschlich tot-markiert.
  const thisBrowser = newBrowser;
  newPage.on('crash', () => {
    if (browser === thisBrowser) browserDead = true;
    if (deadSignal) deadSignal('page-crash');
  });
  newBrowser.on('disconnected', () => {
    if (browser === thisBrowser) browserDead = true;
    if (deadSignal) deadSignal('browser-disconnected');
  });

  return newPage;
}

export async function closeResolver() {
  // §1.7 EPOCH-Bump: invalidiert ALLE in-flight createResolver-Launches. Ein
  // Launch, der nach diesem close fertig wird, sieht `epoch !== launchEpoch`,
  // schliesst sich selbst und fasst den Modul-State NICHT an. So kann ein spaet
  // fertig werdender Launch nach einem Cleanup keinen Browser wiederherstellen.
  launchEpoch++;

  // §1.7 Ownership-Guard (Compare-and-Null): eine SPAETE closeResolver (z.B.
  // fire-and-forget aus on('open')) darf NIEMALS einen Browser nullen/schliessen,
  // den ein zwischenzeitlich gelaufener createResolver gesetzt hat. `owned`
  // faengt die zu schliessende Referenz VOR dem await; nach dem await wird NUR
  // genullt, wenn das Modul-`browser` noch auf `owned` zeigt. (Der Epoch-Bump
  // deckt den konstruktiven Pfad; dieser Guard deckt den destruktiven — beide
  // Teil desselben Generations-Modells.)
  const owned = browser;
  if (owned) {
    try {
      await owned.close();
    } catch {
      // §1.7: ein bereits toter/abgestuerzter Browser kann beim close werfen.
      // closeResolver muss trotzdem idempotent bleiben (on('open')-Cleanup darf
      // nie selbst werfen → sonst Listener-Exception).
    }
  }
  if (browser === owned) {
    browser = null;
    activeContext = null; // Context starb mit dem Browser
    activePage = null;
    pageCallCount = 0;
    pageRecycleCount = 0;
    browserDead = false;
  }
}

const MAX_SVG_BYTES = 102400; // 100KB

export async function resolve(_pageInstance, svgString) {
  // 1. Security Check (Billion Laughs Prevention)
  // Pure validation — no shared state, parallel-safe, OUTSIDE the mutex.
  if (!svgString || typeof svgString !== 'string') {
    return {
      error: 'INVALID_INPUT',
      message: 'SVG-String ist leer oder ungültig',
    };
  }
  if (svgString.includes('<!ENTITY') || svgString.includes('<!DOCTYPE')) {
    return {
      error: 'SECURITY_VIOLATION',
      message:
        'XML Entities oder DOCTYPE sind aus Sicherheitsgründen nicht erlaubt',
    };
  }

  // 2. Size Check
  if (new TextEncoder().encode(svgString).length > MAX_SVG_BYTES) {
    return {
      error: 'SVG_TOO_LARGE',
      message: `SVG überschreitet ${MAX_SVG_BYTES / 1024}KB Limit`,
    };
  }

  // 3. Sanitization (pure, parallel-safe) — L-005-D1 lossless-or-loud.
  //    sanitizeSvg ehrt die D1-Allowlist (use/symbol/SMIL überleben), härtet
  //    href (#-lokal only, externe Targets abgelehnt+geflaggt, kein script,
  //    kein ALLOW_UNKNOWN_PROTOCOLS) und liest DOMPurify.removed + die
  //    Hook-Funde SYNCHRON im selben Tick → sanitizeLoss (NUR Reporting).
  const { clean, sanitizeLoss, useGraph, sanitizeFailed } =
    sanitizeSvg(svgString);

  // §1 D1c use-Graph-Cap (SSRF/billion-laughs-Härtung): die isolierte reine
  // Komponente analyzeUseGraph (core/use_graph.js) hat STRUKTURELL auf dem
  // geparsten DOM entschieden (Zyklus / Tiefe / Forwarder-bewusste Fan-out-
  // Expansion / Multi-svg / Deep-nest / Knoten-Budget) und liefert ihr Urteil als
  // `rejected`-Flag — sie wirft NIE. Auch ein jsdom-Parser-Crash (B1 deep-nest)
  // kommt hier als `sanitizeFailed` an. Wir machen aus jeder Ablehnung den
  // dokumentierten {error:SECURITY_VIOLATION} (never-throw-Vertrag). Jede
  // Ablehnung trägt sanitize_loss (B5: nie still, auch im Error-Pfad). EHRLICH:
  // dieser statische Estimate ist best-effort-Frühabweisung; die Last-Resort-
  // Schranke ist der setContent-5s-Timeout (echter Render hängt → LOAD_FAILED).
  // Der post-render-Knoten-Cap sieht KEINE use-Shadow-Expansion (siehe unten).
  if (sanitizeFailed || useGraph.rejected) {
    const reason = sanitizeFailed
      ? 'SVG-Parser-Limit überschritten (Nest-Tiefe)'
      : useGraph.maxDepth > MAX_USE_REFERENCE_DEPTH
        ? `use-Referenz-Tiefe ${useGraph.maxDepth} > ${MAX_USE_REFERENCE_DEPTH}`
        : useGraph.totalExpansion > MAX_USE_TOTAL_EXPANSION
          ? `use-Fan-out-Expansion > ${MAX_USE_TOTAL_EXPANSION} Instanzen`
          : (useGraph.reason ?? 'use-Graph-Budget überschritten');
    return {
      error: 'SECURITY_VIOLATION',
      message: `${reason} (billion-laughs/SSRF-Schutz)`,
      sanitize_loss: [
        ...sanitizeLoss,
        { tag: 'use', reason: 'USE_GRAPH_REJECTED' },
      ],
    };
  }

  // §1.3 Auto-ID: Hash-Praefix EINMAL pro Render-Call in NODE-LAND berechnen
  // (H-18: Browser-Kontext hat kein node:crypto). sanitizedSvg = `clean` ist
  // hier verfuegbar; via page.evaluate-arg in den Browser-Scope injizieren.
  // Pro Element OHNE explizite SVG-id wird die ID dort als _<8hex>_<tag><n>
  // gebildet (content-addressed, disjoint zwischen unverwandten SVGs).
  const autoIdHashPrefix = computeSvgHashPrefix(clean);

  // §1.3 LAYER-TRENNUNG (Sprint-β2 Patch2): SSOT-Element-Vokabular aus core/.
  // Browser-Sandbox hat kein Node-Modulsystem (H-10/PH-10), daher
  //   - SKIP_TAGS (Set) → Array via Spread
  //   - SPOTTER_TAGS_LIST (frozen Array, Bridge-Snapshot) → direkt nutzbar
  // als Args an page.evaluate übergeben. Im Browser-Scope dort wieder zu Set
  // rekonstruieren (O(1)-Lookup). Predicate-Funktion (isSpotterTag) kann
  // NICHT serialisiert werden (Function-Closure ↛ Browser-Sandbox), daher
  // wird das Set-Membership-Probing dort über das rekonstruierte Set
  // gemacht. SPOTTER_TAGS_LIST ist Object.frozen — V8-Mutation-Lock auf
  // Array IS effektiv (Property-Descriptor schützt length + Indizes), im
  // Gegensatz zu Set.
  const skipTagsArr = [...SKIP_TAGS];
  const spotterTagsArr = SPOTTER_TAGS_LIST;

  // §HEAL-R6 / T2 (F-AT-6-08 2/2): die PER-SANITIZE-GESTRIPPTEN ids in den Browser-
  // Scope reichen. Der Render-Zeit-Dangling-Check markiert ein referenzierendes
  // Element (url(#x) / use href=#x) NUR, wenn das fehlende Ziel auch in
  // sanitize_loss als gestrippte id erscheint (sanitize-induziertes Dangling =
  // unser F-AT-6-08-Fall) — NICHT bei beliebigen Autor-Tippfehlern (kein Fehlalarm).
  // Quelle: die ATTR_STRIPPED:id-Einträge tragen seit T2 den verlorenen id-Wert.
  const strippedIdsArr = [
    ...new Set(
      sanitizeLoss
        .filter((l) => l.reason === 'ATTR_STRIPPED:id' && l.value != null)
        .map((l) => String(l.value)),
    ),
  ];

  // Defensive Konsistenz-Probe (Node-Land): Sicher dass Predicate und
  // Snapshot-Array übereinstimmen — bei Vokabular-Refactor in core/ würde
  // ein Drift hier sofort auffliegen (Adapter-seitiger Sanity-Guard).
  if (
    spotterTagsArr.length === 0 ||
    !spotterTagsArr.every((t) => isSpotterTag(t))
  ) {
    return {
      error: 'INTERNAL_ERROR',
      message:
        'SPOTTER_TAGS_LIST und isSpotterTag-Predicate divergieren — Vokabular-Drift in core/',
    };
  }
  // §1.3 Patch3 (F-PATCH2-OPUS-001 + F-PATCH2-CODEX-001 konvergent HIGH):
  // Case-Invariante. Browser-Pfad nutzt `el.tagName.toLowerCase()` und
  // probt das im Browser rekonstruierte SPOTTER_SET case-sensitiv. Wenn
  // core/element_vocabulary.js wieder camelCase-Tokens einführen würde,
  // bekämen `textPath`/`foreignObject` stumm-gedropt — F-1 zurück. Dieser
  // Guard fängt jede künftige Case-Drift im Vokabular sofort an der
  // Adapter-Boundary ab (Build-/Runtime, kein Test-Reliance).
  if (!spotterTagsArr.every((t) => t === t.toLowerCase())) {
    return {
      error: 'INTERNAL_ERROR',
      message:
        'SPOTTER_TAGS_LIST nicht lowercase — Case-Drift in element_vocabulary.js (F-PATCH2-OPUS-001 Regression)',
    };
  }

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:white">${clean}</body></html>`;

  // klein (lossless-or-loud-Geist): Snapshot des SSRF-Block-Zählers VOR dem
  // Render. Bricht die Denylist während dieses Renders einen externen Request ab
  // (z.B. überlebendes `style:url(http://)`/`fill=url()` — inert/inertisiert, aber
  // referenziert eine nie-aufgelöste externe Ressource), zählt der Delta > 0 →
  // wir melden das ehrlich als EXTERNAL_RESOURCE_NOT_RESOLVED (kein stiller
  // Verlust). Der Mutex serialisiert Renders → der Delta ist diesem Call
  // eindeutig zuordenbar (kein konkurrenter In-Process-Render).
  const blockedBeforeRender = externalRequestsBlocked;

  // 4. Page-bound critical section: serialise setContent+evaluate.
  //    Recycle inside the same lock to avoid race on page replacement.
  //    pageInstance arg is kept for signature stability but ignored — the
  //    adapter now owns the page state internally (Plan-Schicht 1 hex-discipline).
  //    B5: jedes Resultat aus dieser kritischen Sektion (Erfolg ODER Error —
  //    LOAD_FAILED/NO_SVG_FOUND/EMPTY_SVG/NO_ELEMENTS) bekommt am Ende
  //    sanitize_loss angehängt (lossless-or-loud auch im nicht-renderbaren Fall).
  const rendered = await pageMutex.runExclusive(async () => {
    if (!activePage || !browser) {
      return {
        error: 'LOAD_FAILED',
        message: 'Renderer ist nicht initialisiert',
      };
    }

    // §1.7 P4: aktive Crash/Disconnect-Detection. Wenn ein crash/disconnected-
    // Listener gefeuert hat, ist der Browser tot — sofort LOAD_FAILED (Browser-
    // Fehler → Breaker zaehlt), statt in den setContent-Timeout zu laufen.
    if (browserDead || !browser.isConnected()) {
      return {
        error: 'LOAD_FAILED',
        message: 'SVG konnte nicht geladen werden',
      };
    }

    // Schicht 3: Recycle BEFORE consuming this call's count slot.
    // Counter increments after recycle, so a fresh page starts at 1 for
    // the upcoming render — clear "after N calls, recycle" semantics.
    //
    // §1.7 ADR-4 (Epoch/Owned-Guard fuer die konstruktive activePage-Neubindung):
    // `await browser.newPage()` ist async — ein konkurrentes closeResolver/
    // createResolver kann waehrenddessen `browser` austauschen (Epoch-Bump). Ohne
    // Guard wuerde die frische Page an einen SUPERSEDED Browser gebunden. Wir
    // captured `owned`+`epoch` VOR dem await und installieren die Page NUR, wenn
    // `browser === owned` UND der Epoch noch aktuell ist; sonst schliessen wir die
    // frische Page (kein Leak) und liefern LOAD_FAILED (ehrlich — der Renderer
    // wurde gerade ersetzt; der Breaker zaehlt, der naechste Call nutzt den neuen).
    if (pageCallCount >= recycleAfter) {
      const owned = browser;
      const ownedContext = activeContext;
      const epoch = launchEpoch;
      try {
        await activePage.close();
        // §1.7 F-SVG-040 (destruktive Haelfte des Epoch-Guards): waehrend des
        // `activePage.close()`-awaits kann ein konkurrenter createResolver/
        // halfOpen ein FRISCHES activePage (P2) installiert haben (Epoch-Bump).
        // Dann gehoert der State dem neuen Op — wir duerfen `activePage` NICHT
        // nullen (das wuerde P2 clobbern → geleakte Page) und NICHT auf dem
        // stale `owned` weiterrecyceln. Superseded → ehrlicher LOAD_FAILED, das
        // P2 bleibt unangetastet (close+null+reopen ist EIN epoch-geguardeter Block).
        if (browser !== owned || epoch !== launchEpoch) {
          return {
            error: 'LOAD_FAILED',
            message: 'SVG konnte nicht geladen werden',
          };
        }
        activePage = null; // clear BEFORE reopening so newPage-failure leaves null
        // B6 — die frische Page entsteht aus dem GEROUTETEN activeContext (nicht
        // owned.newPage()), damit sie die SSRF-Denylist ERBT. Das schliesst die
        // B6-Regression: nach dem Recycle blockt die Route weiter (context-, nicht
        // page-gebunden). Viewport sitzt am Context (newContext({viewport})) →
        // kein separates setViewportSize nötig.
        const freshPage = await ownedContext.newPage();
        if (browser !== owned || epoch !== launchEpoch) {
          // Browser wurde waehrend des newPage-awaits ersetzt/invalidiert →
          // frische Page gehoert einem supersededen Browser. Selbst schliessen,
          // KEINE State-Mutation gegen den neuen Browser.
          await freshPage.close().catch(() => {});
          return {
            error: 'LOAD_FAILED',
            message: 'SVG konnte nicht geladen werden',
          };
        }
        activePage = freshPage;
        pageCallCount = 0;
        pageRecycleCount++;
      } catch (e) {
        // nur nullen, wenn wir noch Eigentuemer des aktuellen Browsers sind
        // (sonst clobbert ein Recycling-Fehler eine konkurrente Neubindung).
        if (browser === owned) activePage = null;
        return {
          error: 'LOAD_FAILED',
          message: `Page-Recycling fehlgeschlagen: ${e.message}`,
        };
      }
    }
    pageCallCount++;

    // B7-(2) — Last-Resort-Runtime-Guard gegen use-Expansion. Der statische
    // analyzeUseGraph (depth/expansion/cycle/forwarder) ist best-effort-
    // Frühabweisung; die strategische Wurzel der Review-Lücken ist, dass statische
    // Vorhersage der Browser-Render-Semantik fragil ist. Die LETZTE Schranke ist
    // der echte Render: ein use-Bomb, der die statische Prüfung überlebt
    // (unbekannte Form), ist beim ECHTEN Rendern teuer → dieser setContent-Timeout
    // (5s) feuert und liefert LOAD_FAILED (empirisch: depth-6/fan-12 ≈ 3M Instanzen
    // → Timeout 5008ms). EHRLICHE GRENZE: der Timeout greift erst ab ~1,7M
    // Instanzen sicher; das Fenster ~100k–1,7M würde STILL bei 1-5s CPU/Request
    // rendern, FALLS der statische Estimate es verfehlte — deshalb ist der
    // forwarder-korrekte Estimate (jetzt ≤ MAX_USE_TOTAL_EXPANSION=100k) die
    // PRIMÄRE Schranke, der Timeout nur das Sicherheitsnetz für unbekannte Formen.
    // Der TOO_MANY_ELEMENTS-Guard (>500 querySelectorAll('*')) zählt QUELL-DOM-
    // Knoten (SVG2 §5.6: use-Instanzen sind NICHT im Light-DOM) → er bounded die
    // Quell-Größe, NICHT die gerenderte Instanz-Zahl. (Shadow-aware Cap = Folge,
    // nicht D1: requestAnimationFrame-Render-Kosten messen wäre der echte Cap.)
    try {
      await activePage.setContent(html, {
        waitUntil: 'domcontentloaded',
        timeout: 5000,
      });
    } catch {
      return {
        error: 'LOAD_FAILED',
        message: 'SVG konnte nicht geladen werden',
      };
    }

    // 5. In-Browser Extraction
    //    §1.3 LAYER-TRENNUNG (Patch2): Args werden als Object übergeben
    //    (Browser-Sandbox hat kein Node-Modulsystem, PH-10). hashPrefix kommt
    //    aus node:crypto (H-18); skipTagsArr + spotterTagsArr aus SSOT-
    //    Vokabular (core/element_vocabulary.js), in Node-Land in Arrays
    //    serialisiert, im Browser-Scope wieder zu Sets rekonstruiert. Pro
    //    Element OHNE explizite id wird die Auto-ID aus Praefix + tag-lokalem
    //    Counter gebaut (content-addressed). Tags ausserhalb des Spotter-Sets
    //    werden geskippt (F-CODEX-002-Fix + F-OPUS-MINI-001 Coverage durch
    //    Spotter-Set-Erweiterung auf 15 Tags inkl. a/switch/textPath/tspan/
    //    foreignObject).
    const result = await activePage.evaluate(
      (args) => {
        const { hashPrefix, skipTagsArr, spotterTagsArr, strippedIdsArr } = args;
        const svg = document.querySelector('svg');
        if (!svg)
          return {
            error: 'NO_SVG_FOUND',
            message: 'Kein SVG-Element gefunden',
          };

        // §S4/D2 t=0-FREEZE (empirisch bestätigt, gepinnter Chromium 147):
        // VOR jeder getBBox/getScreenCTM/getComputedStyle die SMIL-Timeline auf
        // den spec-t=0-Frame einfrieren — sonst misst der Walk einen
        // Scheduler-abhängigen, gelogenen Frame (F-TF-019-Klasse).
        //   1. pauseAnimations()  — suspendiert NUR die SMIL-Uhr (MDN).
        //   2. setCurrentTime(0)  — spec-t=0 (SVG Anim L2; race-frei unter
        //      waitUntil:'domcontentloaded').
        //   3. getBoundingClientRect() — erzwingt einen SYNCHRONEN Layout-Flush,
        //      damit der seek für den nachgelagerten getBBox-Walk SICHTBAR wird
        //      (Frame-vs-Clock-Kopplung, Residual #1 des Plans).
        //   4. getCurrentTime()===0-Assert — bricht LAUT (kein stiller gelogener
        //      Frame): die Uhr MUSS exakt bei 0 stehen, sonst TIMELINE_NOT_FROZEN.
        // pauseAnimations/setCurrentTime steuern NUR SMIL; CSS-@keyframes/
        // transition + WAAPI laufen weiter → die ehrliche Degradation davon
        // erfolgt im Walk (not_measurable + NON_DETERMINISTIC_MOTION).
        svg.pauseAnimations();
        svg.setCurrentTime(0);
        void svg.getBoundingClientRect();
        if (svg.getCurrentTime() !== 0)
          return {
            error: 'TIMELINE_NOT_FROZEN',
            message:
              'SMIL-Uhr ließ sich nicht auf t=0 einfrieren (getCurrentTime !== 0)',
          };

        const vb = svg.viewBox?.baseVal;
        const rect = svg.getBoundingClientRect();

        if (rect.width === 0 || rect.height === 0) {
          return {
            error: 'EMPTY_SVG',
            message: 'SVG hat keine sichtbaren Abmessungen',
          };
        }

        const canvas = {
          width: vb && vb.width > 0 ? vb.width : Math.round(rect.width),
          height: vb && vb.height > 0 ? vb.height : Math.round(rect.height),
          vbX: vb && vb.width > 0 ? vb.x : 0,
          vbY: vb && vb.height > 0 ? vb.y : 0,
          viewBox: svg.getAttribute('viewBox'),
        };

        // §HEAL-7/A (F-TF-002, Nenner-Integrität): viewBoxValidity-PRODUZENT.
        // Boden-Wahrheit bodenwahrheit_c03/f002: Chromium normalisiert eine
        // Müll-/negativ-/NaN-viewBox in baseVal STILL zu 0,0,0,0 und der
        // Canvas-Fallback (rect 300×150 bzw. CSS-Default) wurde als
        // canvas_validity:'valid' gemeldet — die zwei Nenner-Signale
        // 'degenerate'/'default_replaced' hatten 0 Produzenten (tote Signale).
        // Klassifikation am ROHEN Attribut (baseVal ist normalisiert = blind):
        //   'degenerate'       — viewBox-Attribut VORHANDEN, aber parse-fail
        //                        (≠4 Tokens / non-finite) ODER width/height
        //                        ≤ 0 (zero disabled rendering, negativ invalid).
        //                        Negative min-x/min-y sind SPEC-VALIDE.
        //   'default_replaced' — KEINE viewBox UND KEINE width/height-Attribute
        //                        UND der CSS-Replaced-Default 300×150 griff
        //                        nachweislich (rect-Gegenprobe = Anti-Über-Flag:
        //                        ein style-/CSS-dimensioniertes SVG ≠300×150
        //                        wird NICHT geflaggt).
        //   sonst              — Feld NICHT gesetzt (Negativ-Kontrolle; hält
        //                        bestehende resolve()-Byte-Kanons dimensions-
        //                        tragender Fixtures unverändert).
        // DOMINANZ-VERTRAG (geprüft gegen honesty.js#classifyCanvas Z.126ff):
        // der Konsument (pipeline.js#deriveCanvasValidity) klassifiziert mit
        // Pessimismus-Präzedenz lossy > degenerate > default_replaced > valid —
        // ein nicht-leerer sanitizeLoss DOMINIERT dieses Feld bewusst (DOMPurify
        // hat Semantik entfernt = stärkste Degradation). Hier NUR der Produzent,
        // KEINE Klassifikations-Logik (honesty.js bleibt unangetastet).
        const vbAttr = svg.getAttribute('viewBox');
        if (vbAttr !== null) {
          const tokens = vbAttr.trim().split(/[\s,]+/).filter(Boolean);
          const nums = tokens.map(Number);
          const vbDegenerate =
            tokens.length !== 4 ||
            nums.some((n) => !Number.isFinite(n)) ||
            nums[2] <= 0 ||
            nums[3] <= 0;
          if (vbDegenerate) canvas.viewBoxValidity = 'degenerate';
        } else if (
          !svg.getAttribute('width') &&
          !svg.getAttribute('height') &&
          Math.round(rect.width) === 300 &&
          Math.round(rect.height) === 150
        ) {
          canvas.viewBoxValidity = 'default_replaced';
        }

        // §1.3 LAYER-TRENNUNG (Patch2): SSOT aus core/element_vocabulary.js.
        // Sets werden in Node-Land in Arrays serialisiert, im Browser-Scope
        // rekonstruiert (Sandbox-Boundary, PH-10). Keine Inline-Liste mehr.
        // Browser-lokales SPOTTER_SET ist Mutations-isoliert vom Node-Land
        // (jeder evaluate-Call rekonstruiert frisch).
        const SKIP_TAGS = new Set(skipTagsArr);
        const SPOTTER_SET = new Set(spotterTagsArr);

        // §HEAL-R6 / T2 (F-AT-6-08 2/2): die per-sanitize gestrippten ids als Set
        // (Browser-lokal rekonstruiert, Sandbox-Boundary). Genutzt vom Render-Zeit-
        // Dangling-Check: ein referenzierendes Element wird NUR markiert, wenn die
        // fehlende id auch hier (= sanitize-induziert gestrippt) erscheint — kein
        // Über-Flag bei Autor-Tippfehlern.
        const STRIPPED_IDS = new Set(strippedIdsArr || []);
        // CLOBBER-ROBUSTER Existenz-Check (Security-Szene-BP: Built-ins cachen). Der
        // Input ist untrusted und genau Clobber-Namen (id="target"/"length") sind hier
        // im Spiel — ein `document.getElementById` könnte durch ein gleichnamiges
        // Element/Attribut geclobbert sein. Der gecachte Prototyp-Accessor umgeht das.
        const protoGetById = Document.prototype.getElementById;
        function elementExists(id) {
          try {
            return protoGetById.call(document, id) !== null;
          } catch (_) {
            return false;
          }
        }
        // §HEAL-R6 / T2 REFERENCE-DANGLING-ERKENNUNG. Sammelt alle id-Referenzen, die
        // der Renderer beim Rendern OHNEHIN auflöst — `url(#x)` (fill/stroke/marker/
        // filter/mask/clip-path) und `<use href="#x">`/xlink:href — und liefert true,
        // wenn IRGENDEINE davon sanitize-induziert dangelt: die referenzierte id ist
        // im sanitisierten DOM NICHT vorhanden UND erscheint in STRIPPED_IDS (= die
        // Sanitize hat genau diese id gestrippt). PRÄZISION: id muss in BEIDEN sein —
        // fehlend im DOM (echtes Dangling) UND gestrippt (sanitize-induziert, unser
        // F-AT-6-08-Fall), NICHT bei beliebigen Autor-Tippfehlern. SCOPE bewusst eng:
        // CSS-`#id`-Selektoren + aria sind AUSGESCHLOSSEN (= (b)-Wachstum). Reuse der
        // bestehenden url()-Extraktions-Form (`/url\(["']?#([^"')]+)["']?\)/`).
        function idFromUrlRef(v) {
          if (typeof v !== 'string') return null;
          const m = v.match(/url\(["']?#([^"')]+)["']?\)/);
          return m ? m[1] : null;
        }
        function idFromHref(v) {
          if (typeof v !== 'string') return null;
          const t = v.trim();
          return t.charCodeAt(0) === 35 && t.length > 1 ? t.slice(1) : null;
        }
        // Ein Treffer (gestrippte id, die im DOM fehlt) → REFERENCE_DANGLING.
        function isSanitizeDangling(id) {
          return id != null && STRIPPED_IDS.has(id) && !elementExists(id);
        }
        function referenceDangling(el, cs) {
          // (a) url(#x)-Paint/Operator-Refs — exakt die, die der Renderer auflöst.
          const urlRefs = [
            cs.fill,
            cs.stroke,
            cs.markerStart,
            cs.markerMid,
            cs.markerEnd,
            cs.marker,
            cs.filter,
            cs.mask,
            cs.maskImage,
            cs.clipPath,
          ];
          for (const v of urlRefs) {
            if (isSanitizeDangling(idFromUrlRef(v))) return true;
          }
          // (b) <use href="#x">/xlink:href — der Klon-Ref des Renderers.
          if (el.tagName && el.tagName.toLowerCase() === 'use') {
            const href =
              el.getAttribute('href') || el.getAttribute('xlink:href') || '';
            if (isSanitizeDangling(idFromHref(href))) return true;
          }
          return false;
        }

        // §1.2 3D-Detection Pre-Gate (FIX_PLAN §1.2, Empirie-Pre-Flight 2026-05-27):
        // Vor el.getCTM() müssen wir prüfen, ob ein 3D-Transform die Geometrie
        // verzerrt (matrix3d / perspective / transform-style:preserve-3d). Empirisch
        // (PREFLIGHT R-1) liefert getCTM() bei 3D IMMER eine syntaktisch gültige
        // 2D-Matrix (Browser kollabiert), nie null — Detection via CTM-Inspektion ist
        // unmöglich. R-2: Identitäts-matrix3d wird vom Browser zu matrix() kollabiert →
        // Detection MUSS auf getComputedStyle().transform laufen, nicht auf
        // getAttribute('style'); echte 3D-Transforms bleiben als 'matrix3d(' stehen,
        // identitäts-3D kollabiert weg (kein False-Positive). R-4: Walk-Bound =
        // parentElement === null (kein Halt am <svg>-Root; 3D auf BODY/HTML würde
        // semantisch ebenso wirken).
        //
        // C2-FIX (Honesty-Gate 2a): Der Walk startet beim ELEMENT SELBST, nicht erst
        // beim parentElement. Ein 3D-Transform DIREKT auf einem Element (rotateX/Y,
        // rotate3d, perspective, preserve-3d) verzerrt dessen getBBox()-Projektion
        // GENAUSO wie ein 3D-Vorfahre — getScreenCTM() kollabiert Z still zu einer
        // 2D-Affine (svgwg #302), die bbox lügt. Vorher prüfte isAncestor3D nur
        // `start.parentElement` aufwärts → Self-3D fiel durch auf den 'reliable'-Default
        // (Defekt 6). Die Klassifikation hängt an der ECHTEN 3D-Natur (computed
        // matrix3d/perspective/preserve-3d), NICHT am serialisierten transform-String
        // der hasTransform-Klausel.
        function isSelfOrAncestor3D(start) {
          let n = start;
          while (n) {
            const cs = getComputedStyle(n);
            const t = cs.transform || '';
            if (t.includes('matrix3d(')) return true;
            if (t.includes('perspective(')) return true;
            if (cs.transformStyle === 'preserve-3d') return true;
            n = n.parentElement;
          }
          return false;
        }

        // §HEAL2 — Kompositions-bewusster Sichtbarkeits-Walk. Container-<g>/<symbol>
        // (SKIP_TAGS) vererben Sichtbarkeit via Render-Tree, werden aber nie als
        // Element inspiziert. display + opacity vererben NICHT → leaf-only lügt.
        // display ABSORBIEREND (irgendein Vorfahr ==='none' → hidden); 'contents'
        // durchlässig (!= 'none'). Empirie: walk_fixes_leaf=true für display:none-
        // und opacity:0-Vorfahr.
        function anyAncestorDisplayNone(start) {
          let n = start.parentElement;            // Leaf-display via Leaf-Gate (Z.1049)
          while (n) {
            if (getComputedStyle(n).display === 'none') return true;
            n = n.parentElement;
          }
          return false;
        }
        function composedOpacity(start) {         // opacity vererbt NICHT → Produkt
          let p = 1; let n = start;
          while (n) {
            const o = parseFloat(getComputedStyle(n).opacity);
            p *= Number.isFinite(o) ? o : 1;
            n = n.parentElement;
          }
          return p;
        }
        // §HEAL2 (Codex-Leck-Fix R2) — WERTE-basierte Permanent-Unsichtbarkeit statt
        // TRACK-Präsenz. Ein Element ist permanent unsichtbar, wenn IRGENDEIN
        // Opacity-FAKTOR der self+Ahnen-Kette MAXIMAL 0 erreicht (ein statischer
        // Vorfahr-opacity:0 macht das Produkt unrettbar 0 — auch wenn ein Kind 0→1
        // animiert). Nur wenn JEDER Faktor irgendwann > 0 werden kann, ist die
        // momentane 0 nicht-deterministisch und MUSS durchgereicht werden.
        //
        // factorMaxOpacity: max. Opacity, die der EIGENE Faktor dieses Knotens über
        // alle Animations-Zustände erreichen kann. Keyframe-DEFINITIONEN + statische
        // opacity (NICHT der momentane Animationswert) → deterministisch, byte-stabil.
        // NUR eine laufende (running) Animation variiert den Wert; paused/finished/
        // idle → aktueller Frame-Wert (statisch). getAnimations() liefert KEINE
        // SMIL-Animationen (motion_source-Beleg) → SMIL-opacity bleibt korrekt als
        // statische t=0-opacity behandelt. isSelfOrAncestorNonSmilMotion
        // (Geometrie-Motion / bbox_reliability) bleibt UNANGETASTET.
        function factorMaxOpacity(el) {
          const s = parseFloat(getComputedStyle(el).opacity);
          const safeStatic = Number.isFinite(s) ? s : 1;
          const anims =
            typeof el.getAnimations === 'function' ? el.getAnimations() : [];
          let opacityAnimated = false;
          let animMax = 0;
          for (const a of anims) {
            const touches = a.transitionProperty === 'opacity';
            let kfMax = 0;
            let sawKf = false;
            try {
              const kfs =
                a.effect && a.effect.getKeyframes ? a.effect.getKeyframes() : [];
              for (const k of kfs) {
                if ('opacity' in k) {
                  sawKf = true;
                  const v = parseFloat(k.opacity);
                  if (Number.isFinite(v)) kfMax = Math.max(kfMax, v);
                }
              }
            } catch (_) {}
            if (touches || sawKf) {
              opacityAnimated = true;
              // NUR running variiert den Wert; sonst aktueller (statischer) Frame.
              animMax = Math.max(
                animMax,
                a.playState === 'running' ? kfMax : safeStatic,
              );
            }
          }
          return opacityAnimated ? animMax : safeStatic;
        }
        function permanentlyInvisible(start) {
          let n = start;
          while (n) {
            if (factorMaxOpacity(n) === 0) return true;
            n = n.parentElement;
          }
          return false;
        }

        // §HEAL F-AT-7-01 (I1, media-Honesty vw) — ein Element mit viewport-
        // relativer GEOMETRIE-Einheit (vw/vh/vmin/vmax) rendert real anders pro
        // Viewport (vw = 1% der Viewport-Breite) — OHNE jedes @media. Der statische
        // @media-Detektor erfasst das nicht → media_dependent:false + reliable =
        // stille Viewport-Lüge (probe-02: width:50vw → getBBox 160@vp320 /
        // 960@vp1920). KORREKTUR: die Viewport-Einheit ist im computed-style
        // VERLOREN (getComputedStyle löst 50vw → 960px@1920 auf), darum MUSS die
        // AUTHORED Form gescannt werden — Präsentations-Attribut + inline-`style`
        // (el.style, NICHT getComputedStyle). NUR vw/vh/vmin/vmax: immer viewport-
        // relativ → NULL Über-Flag. Bewusst VERTAGT (eigene Boden-Wahrheit, F-AT-
        // 7-01-Familie): `%` (Container- vs. Viewport-relativ, bedingt + nested-svg),
        // `<style>`-Regel-vw (nur authored gescannt), transform/font-size(vw)
        // (wirken auf screen-CTM/Text-Extent, NICHT getBBox). Element-lokal: berührt
        // mediaDependentElements/pushPart/collect NICHT → STATE-neutral by
        // construction; kein Set, kein Graph, kein Port-Spiegel (DEFAULT_CORPUS hat
        // kein vw/% → __measureStaticMediaParityCheck unberührt; Korpus-Invariante:
        // kein vw/%-id-Element im Parity-Korpus).
        function geomHasViewportUnit(el) {
          // Geometrie-tragende Properties, die getBBox direkt bestimmen.
          const GEOM_PROPS = [
            'width', 'height', 'x', 'y', 'cx', 'cy',
            'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2',
          ];
          // Zahl/Punkt unmittelbar gefolgt von einer viewport-relativen Längen-
          // Einheit (fängt auch calc(50vw …) als korrekt viewport-abhängig).
          const VP_UNIT = /[0-9.](vw|vh|vmin|vmax)\b/i;
          for (let i = 0; i < GEOM_PROPS.length; i++) {
            const p = GEOM_PROPS[i];
            const attr = el.getAttribute(p); // Präsentations-Attribut (authored)
            if (attr && VP_UNIT.test(attr)) return true;
            const inl = el.style && el.style.getPropertyValue(p); // inline (authored)
            if (inl && VP_UNIT.test(inl)) return true;
          }
          return false;
        }

        // §HEAL-R6 / T1 — Tinten-Faktor eines EINZELNEN Knotens (fill-opacity ODER
        // stroke-opacity), EXAKT gespiegelt an factorMaxOpacity. Anders als opacity
        // vererben fill-opacity/stroke-opacity NICHT (sie wirken nur auf das Element
        // selbst, das die Tinte malt) → KEIN Ancestor-Produkt, nur self. Die
        // Element-opacity-Kette steckt orthogonal in composedOpacity(el) (Spec:
        // fillAlpha = composedOpacity × fillFactor). Permanenz wie bei opacity:
        // eine running CSS/WAAPI-Animation variiert den Wert → max über die
        // Keyframe-DEFINITIONEN (Keyframe-max=0 → permanent 0); paused/idle/finished
        // ODER keine Animation → statischer computed-Wert @t=0. SMIL erscheint nicht
        // in getAnimations() (motion_source-Beleg) → SMIL-fill-opacity bleibt korrekt
        // als statischer t=0-Wert behandelt, was am eingefrorenen Snapshot exakt ist.
        //   cssProp  : camelCase computed-style-Key ('fillOpacity' | 'strokeOpacity')
        //   transProp: hyphenierter transition-property-Name ('fill-opacity' | ...)
        // Keyframe-Keys sind WAAPI-camelCase → identisch zu cssProp.
        function factorMaxPaint(el, cssProp, transProp) {
          const s = parseFloat(getComputedStyle(el)[cssProp]);
          const safeStatic = Number.isFinite(s) ? s : 1;
          const anims =
            typeof el.getAnimations === 'function' ? el.getAnimations() : [];
          let animated = false;
          let animMax = 0;
          for (const a of anims) {
            const touches = a.transitionProperty === transProp;
            let kfMax = 0;
            let sawKf = false;
            try {
              const kfs =
                a.effect && a.effect.getKeyframes ? a.effect.getKeyframes() : [];
              for (const k of kfs) {
                if (cssProp in k) {
                  sawKf = true;
                  const v = parseFloat(k[cssProp]);
                  if (Number.isFinite(v)) kfMax = Math.max(kfMax, v);
                }
              }
            } catch (_) {}
            if (touches || sawKf) {
              animated = true;
              animMax = Math.max(
                animMax,
                a.playState === 'running' ? kfMax : safeStatic,
              );
            }
          }
          return animated ? animMax : safeStatic;
        }
        // §HEAL-R6 / T1 Härtung #4 — „animiert dieser Knoten die Paint-Opacity?"
        // (gleiche getAnimations()-Logik wie factorMaxPaint, nur das bool). Genutzt im
        // Vererbungs-Walk: NUR ein ANIMIERENDER Vorfahr darf den am Blatt geerbten 0-
        // Wert „retten"; ein STATISCHER Vorfahr-Wert (z.B. svg-Default fill-opacity:1)
        // wird vom eigenen Blatt-Wert via Kaskade GESHADOWED und darf den nicht
        // überstimmen (sonst würde ein explizites Blatt-fill-opacity:0 fälschlich
        // durch den svg-Default-1 als sichtbar gewertet — der paintserver_fillop0-Bug).
        function nodeAnimatesPaint(el, cssProp, transProp) {
          const anims =
            typeof el.getAnimations === 'function' ? el.getAnimations() : [];
          for (const a of anims) {
            if (a.transitionProperty === transProp) return true;
            try {
              const kfs =
                a.effect && a.effect.getKeyframes ? a.effect.getKeyframes() : [];
              for (const k of kfs) if (cssProp in k) return true;
            } catch (_) {}
          }
          return false;
        }
        // VERERBUNGS-bewusste Permanenz: fill-opacity/stroke-opacity VERERBEN. Der am
        // Blatt computed Wert spiegelt bereits alle STATISCHEN Vererbungen wider →
        // factorMaxPaint(leaf) ist die korrekte t=0-Basis. Zu retten ist NUR der Fall:
        // Blatt erbt 0 von einem ANIMIERTEN Vorfahr (@keyframes 0→1) — am eingefrorenen
        // t=0 ist der computed Wert 0, aber der Kanal ist NICHT permanent tot. Daher:
        // Basis = factorMaxPaint(leaf); zusätzlich self→Vorfahren nach einem ANIMIERENDEN
        // Knoten mit max>0 walken (factorMaxPaint des animierenden Knotens) und das
        // Maximum nehmen. Statische Vorfahr-Werte fließen NICHT ein (Kaskade-Shadowing).
        function chainMaxPaint(start, cssProp, transProp) {
          let max = factorMaxPaint(start, cssProp, transProp);
          let n = start;
          while (n) {
            if (nodeAnimatesPaint(n, cssProp, transProp)) {
              const f = factorMaxPaint(n, cssProp, transProp);
              if (f > max) max = f;
            }
            n = n.parentElement;
          }
          return max;
        }

        // §S4/D2 R2-FIX — NICHT-SMIL-Motion via Ancestor-Walk, EXAKT gespiegelt
        // an isSelfOrAncestor3D. Grund (empirisch reproduzierter stiller Lügen-
        // Frame, F-TF-019-Klasse): die frühere Leaf-only-Erkennung las nur
        // getComputedStyle des emittierenden Blattes. Container <g>/<symbol>/
        // <marker> sind in SKIP_TAGS → sie treffen `continue` VOR jeder Style-
        // Inspektion, ABER ihr CSS-Transform komponiert via userM (getScreenCTM)
        // in die Kind-Geometrie. Eine @keyframes/transition auf einem <g>-
        // Ancestor bewegt das Kind Scheduler-abhängig (pauseAnimations pausiert
        // NUR SMIL, nicht CSS) → das Blatt würde fälschlich 'reliable' gemeldet.
        // Der 3D-Pfad beweist, dass der parentElement-Walk die korrekte Form ist
        // (er sieht die <g>-Ancestors unabhängig von SKIP_TAGS); der Motion-Pfad
        // ist hier symmetrisch und darf NICHT die Leaf-only-Ausnahme bleiben.
        //
        // PER-KNOTEN-MARKER (gehärtet gegen Über-Flaggen — statische SVGs dürfen
        // NICHT zu not_measurable degradieren):
        //   (a) CSS-Animation: animationName !== 'none' UND die EFFEKTIVE
        //       (max) animation-duration über die Komma-Liste > 0 UND
        //       play-state ist nicht 'paused' für ALLE Tracks. dur=0s ist
        //       statisch (kein Frame-Drift); play-state:paused läuft nicht.
        //   (b) CSS-Transition: transitionProperty !== 'none' UND die max
        //       transition-duration über die Komma-Liste > 0. '0s, 0s' ist
        //       statisch (frühere Naive-Form `!== '0s'` flaggte das fälschlich).
        function maxSecondsInList(durStr) {
          // CSS-time-Liste ("2s, 0s, 500ms") → größter Wert in Sekunden.
          if (!durStr) return 0;
          let max = 0;
          for (const tok of durStr.split(',')) {
            const s = tok.trim();
            let v = 0;
            if (s.endsWith('ms')) v = parseFloat(s) / 1000;
            else if (s.endsWith('s')) v = parseFloat(s);
            else v = parseFloat(s); // computed ist immer s/ms; defensiv
            if (Number.isFinite(v) && v > max) max = v;
          }
          return max;
        }
        function nodeHasNonSmilMotion(cs) {
          // (a) CSS-Animation, gehärtet: laufend (nicht paused) + dur > 0.
          if (cs.animationName && cs.animationName !== 'none') {
            const anyRunning = (cs.animationPlayState || 'running')
              .split(',')
              .some((p) => p.trim() !== 'paused');
            if (anyRunning && maxSecondsInList(cs.animationDuration) > 0)
              return true;
          }
          // (b) CSS-Transition, gehärtet: Property gesetzt + max-dur > 0.
          if (
            cs.transitionProperty &&
            cs.transitionProperty !== 'none' &&
            maxSecondsInList(cs.transitionDuration) > 0
          )
            return true;
          return false;
        }
        function isSelfOrAncestorNonSmilMotion(start) {
          let n = start;
          while (n) {
            if (nodeHasNonSmilMotion(getComputedStyle(n))) return true;
            n = n.parentElement;
          }
          return false;
        }

        // §D5 / R6-STATE ZUSTANDS-ABHÄNGIGKEIT (state_dependent). Das Auge flaggte
        // BEWEGUNG (NON_DETERMINISTIC_MOTION), aber NICHT INTERAKTION. Interaktiv-
        // abhängige SVGs (:hover/:focus/:focus-within/:focus-visible/:active/:target +
        // SMIL <set/animate begin|end mit Event-Token) wurden still als ganze Wahrheit
        // @default gemeldet = Blind-Trust-Lüge. KORREKTUR: ein reines Flag (KEIN
        // bbox_reliability-Degrade — bei State ist die t=0-Geometrie EXAKT wahr, Alt-
        // Zustände sind ZUSÄTZLICHE Wahrheiten, kein Drift der gemessenen). Orthogonal
        // zu Motion/3D. Topologie 1:1 vom Motion-Vorbild (Self-OR-Ancestor-Walk).
        //
        // LECK-FREIHEIT BY CONSTRUCTION (H4): es gibt KEINEN still-leckenden
        // Selektor-Rest mehr. Ein interaktiv-tragender Teil, dessen Selektor in qSA
        // wirft/unauflösbar ist (Column-Combinator `||`, Namespace `s|…`, Hex-Escapes,
        // jeder exotische Rest), durchläuft die 3-Stufen-Leiter (PRÄZISE → SALVAGE →
        // KONSERVATIVER FALLBACK flag-all) und endet NIE mit „nichts" — schlimmstenfalls
        // grob über-geflaggt + ehrlich via STATE_DETECTION_COARSE markiert. Daher hier
        // KEINE „Leck-Residual"-Liste mehr.
        //
        // VERBLEIBENDE, BEWUSST KONSERVATIVE ÜBER-FLAGS (KEINE Lecks, leck-frei):
        //   - ::part()/::slotted() + Custom-Elements: vom S3-Sanitizer gestrippt
        //     (kein <script>/Shadow-DOM) → strukturell unerreichbar (kein Selektor-Rest).
        //   - EINFACHE strukturelle Pseudo-Klassen OHNE Klammern (`:first-child`/
        //     `:last-child`/`:only-child`): werden mit-gestrippt → mildes Über-Flag
        //     (selten). Nur die FUNKTIONALEN strukturellen (`:is()`/`:not()`/
        //     `:nth-child()`) werden präzise BEHALTEN (E1).
        //   - Tiefe @scope-Body-Präzision bei komplexen .start-Preludes: scopeRoot ist
        //     Best-Effort (gestripptes rule.start) → ggf. leicht weiter gefasst
        //     (Über-Flag), nie Falsch-Tot.
        //
        // SMIL: syncbase (`a1.begin+2s`)/repeat()/wallclock()/load/none → per
        // classifyBeginToken AUTO/never (KEIN Über-Flag); eine Syncbase-Kette mit
        // echtem Interaktions-Wurzel-Event wird per SMIL-Timing-Graph-Fixpunkt (L1)
        // TRANSITIV verwurzelt (kein false-silent). Unbekannte Event-Token bleiben
        // konservativ 'event' (leck-frei).
        //
        // REIHENFOLGE LOAD-BEARING: focus-within|focus-visible VOR focus (sonst
        // zerschneidet das :focus-Alternativ das längere Suffix beim Regex-Match).
        const STATE_PSEUDO_RX =
          /:(?:focus-within|focus-visible|focus|active|hover|target)\b/i;
        // Set der interaktiven Pseudo-Klassen-NAMEN (lowercase, ohne führenden ':').
        // Wird gegen den entnommenen Namen geprüft (NICHT per Substring-Regex über
        // den ganzen Selektor — der sähe `:hover` auch in einem Attribut-String).
        const INTERACTIVE_PSEUDO_SET = new Set([
          'focus-within',
          'focus-visible',
          'focus',
          'active',
          'hover',
          'target',
        ]);
        const IDENT_CHAR_RX = /[A-Za-z0-9_-]/;

        // ── EIN robuster, quote/bracket/paren-bewusster Selektor-Tokenizer ────────
        // Ersetzt die früheren Flick-Routinen (stripInteractiveSafe/depth0Compounds/
        // das naive selectorText.split(',')). Eine KORREKTE Routine statt Flicken
        // (Triple-Review F1/F2/F5/G1). Behandelt:
        //   F1 — interaktiver Pseudo IN :has()/:is()/:not(): der GESAMTE funktionale
        //        :fn(...)-Block wird entfernt; sein interaktiver Inhalt zählt für die
        //        Trigger-Erkennung (rekursiv gegen STATE_PSEUDO_RX am ARG).
        //   F2 — Komma INNERHALB :not(.armed, :hover): split nur auf Tiefe 0 (paren/
        //        bracket/quote-bewusst) → der Selektor bleibt intakt.
        //   F5 — `:hover` als Attribut-STRING-Literal (`[data-k=":hover"]`): innerhalb
        //        `[...]` und innerhalb Quotes wird NICHTS als Pseudo interpretiert.
        //   G1 — `g > :hover` → das geleerte letzte Compound wird `*` (`g > *`), das
        //        Ergebnis endet NIE auf einem Combinator (matches würde sonst werfen).

        // (T1) Komma-Split NUR auf Tiefe 0 (F2). Tracke paren/bracket-Tiefe + Quote-
        // State (mit Backslash-Escape). Innerhalb Quotes/Brackets/Parens NICHT trennen.
        function splitTopLevelCommas(selectorText) {
          const parts = [];
          let cur = '';
          let paren = 0;
          let bracket = 0;
          let quote = ''; // '"' | "'" | ''
          const s = String(selectorText);
          for (let i = 0; i < s.length; i++) {
            const c = s[i];
            if (quote) {
              cur += c;
              if (c === '\\') {
                if (i + 1 < s.length) {
                  cur += s[i + 1];
                  i++;
                }
              } else if (c === quote) {
                quote = '';
              }
              continue;
            }
            if (c === '"' || c === "'") {
              quote = c;
              cur += c;
              continue;
            }
            if (c === '(') paren++;
            else if (c === ')') {
              if (paren > 0) paren--;
            } else if (c === '[') bracket++;
            else if (c === ']') {
              if (bracket > 0) bracket--;
            }
            if (c === ',' && paren === 0 && bracket === 0) {
              parts.push(cur);
              cur = '';
              continue;
            }
            cur += c;
          }
          parts.push(cur);
          return parts;
        }

        // (T2) Entferne ALLE einfachen Pseudo-KLASSEN (`:name`) UND ganze funktionale
        // Pseudo-Klassen (`:fn(...)` balanciert) aus EINEM Komma-Teil — quote/bracket-
        // bewusst. ::-Pseudo-ELEMENTE bleiben in Ruhe. Robuste, leck-freie
        // Vereinfachung: alle Pseudo-Klassen weg (nicht nur die interaktiven), weil
        // sie alle Zustands-/Strukturbedingungen sind, die der @t=0-Default nicht
        // einnimmt — die zurückbleibende Basis matcht das Element strukturell.
        // Liefert { stripped, hadInteractive }. hadInteractive ist true, wenn IN
        // DIESEM Teil mindestens eine entfernte Pseudo-Klasse interaktiv war (Name
        // im INTERACTIVE_PSEUDO_SET, oder — für funktionale — der ARG-Inhalt enthält
        // rekursiv einen interaktiven Pseudo, STATE_PSEUDO_RX).
        // CX5-Helfer: prüft den ARG einer funktionalen Pseudo-Klasse (inkl. äußerer
        // Klammern) rekursiv, BRACKET/QUOTE-bewusst, auf einen interaktiven Pseudo.
        // `[data-k=":hover"]` als Arg-Teil → stripPseudoClasses sieht `:hover` im
        // Attribut-Literal NICHT → false (kein Über-Flag). `#probe:hover` → true.
        function argHasInteractive(argWithParens) {
          const inner = String(argWithParens).replace(/^\(|\)$/g, '');
          for (const sub of splitTopLevelCommas(inner)) {
            if (stripPseudoClasses(sub).hadInteractive) return true;
          }
          return false;
        }
        // (stripInteractiveFromArg ist in Runde 5 entfallen: das selektive Strippen
        // einzelner Arg-Zweige ließ den nicht-interaktiven Komma-Zweig stehen
        // (`:has(:hover,#never)` → `:has(#never)`, count=0, kein throw → false-silent
        // Leck, F-A). Interaktiv-tragende funktionale Pseudos werden jetzt GANZ
        // entfernt — broadest match, leck-frei.)
        // ns-Präfix-Strip (A-ns try/catch-Sicherheit): an einem Compound-Anfang
        // (Start oder direkt nach Whitespace/Kombinator/`(`) ein optionales
        // `pfx|`/`|` droppen. NUR auf Tiefe 0 (außerhalb [...] und Quotes — `|=`
        // im Attribut-Selektor bleibt unangetastet). Liefert {skip, dropped}.
        function nsPrefixSkip(s, i) {
          // i zeigt auf den ersten Zeichen NACH einem Compound-Boundary.
          let j = i;
          // optionaler Präfix-Name [A-Za-z_-][\w-]* oder `*`
          if (s[j] === '*') {
            j++;
          } else {
            while (j < s.length && IDENT_CHAR_RX.test(s[j])) j++;
          }
          if (s[j] === '|' && s[j + 1] !== '=' && s[j + 1] !== '|') {
            // `pfx|` (oder `|`): alles bis EINSCHLIESSLICH `|` droppen.
            return { skip: j + 1 - i, dropped: true };
          }
          return { skip: 0, dropped: false };
        }
        function stripPseudoClasses(part) {
          let out = '';
          let hadInteractive = false;
          let bracket = 0;
          let quote = '';
          let atBoundary = true; // Start = Compound-Anfang
          const s = String(part);
          for (let i = 0; i < s.length; ) {
            const c = s[i];
            // ns-Präfix nur an einem Compound-Boundary, außerhalb [...]/Quote.
            if (atBoundary && bracket === 0 && !quote) {
              const r = nsPrefixSkip(s, i);
              if (r.dropped) {
                i += r.skip; // `pfx|` verwerfen
                atBoundary = false;
                continue;
              }
            }
            if (quote) {
              out += c;
              if (c === '\\') {
                if (i + 1 < s.length) {
                  out += s[i + 1];
                  i += 2;
                  continue;
                }
              } else if (c === quote) {
                quote = '';
              }
              i++;
              continue;
            }
            if (c === '"' || c === "'") {
              quote = c;
              out += c;
              i++;
              continue;
            }
            if (c === '[') {
              bracket++;
              out += c;
              i++;
              continue;
            }
            if (c === ']') {
              if (bracket > 0) bracket--;
              out += c;
              i++;
              continue;
            }
            // Innerhalb [...] NICHTS als Pseudo interpretieren (F5).
            if (c === ':' && bracket === 0) {
              // ::-Pseudo-ELEMENT NICHT anfassen.
              if (s[i + 1] === ':') {
                out += '::';
                i += 2;
                continue;
              }
              // Pseudo-Klassen-Namen lesen.
              let j = i + 1;
              while (j < s.length && IDENT_CHAR_RX.test(s[j])) j++;
              const name = s.slice(i + 1, j).toLowerCase();
              if (name) {
                if (s[j] === '(') {
                  // Funktionale Pseudo-Klasse: balancierte (...) finden (quote-bewusst).
                  let depth = 0;
                  let k = j;
                  let q = '';
                  for (; k < s.length; k++) {
                    const cc = s[k];
                    if (q) {
                      if (cc === '\\') k++;
                      else if (cc === q) q = '';
                      continue;
                    }
                    if (cc === '"' || cc === "'") q = cc;
                    else if (cc === '(') depth++;
                    else if (cc === ')') {
                      depth--;
                      if (depth === 0) {
                        k++;
                        break;
                      }
                    }
                  }
                  const arg = s.slice(j, k); // inkl. der Klammern
                  // interaktiv, wenn der Name selbst interaktiv ist (`:hover`) ODER
                  // der ARG-Inhalt rekursiv einen interaktiven Pseudo trägt
                  // (F1: `:has(#probe:hover)`). CX5-FIX: NICHT roh STATE_PSEUDO_RX.test
                  // über den ARG (das sähe `:hover` auch in `[data-k=":hover"]`) —
                  // stattdessen den ARG (ohne äußere Klammern) an Tiefe-0-Kommas
                  // splitten und JEDEN Teil durch den BRACKET/QUOTE-bewussten
                  // stripPseudoClasses prüfen → ein Attribut-Literal zählt NICHT.
                  const fnInteractive =
                    INTERACTIVE_PSEUDO_SET.has(name) || argHasInteractive(arg);
                  if (fnInteractive) {
                    hadInteractive = true;
                    // F-A-FIX (Runde 5): ein funktionales Pseudo, dessen Arg IRGENDWO
                    // einen interaktiven Pseudo trägt (`:has(:hover,#never)`,
                    // `:is(&:hover)`, `:not(:hover)`), wird GANZ entfernt — die
                    // einfache, leck-freie Regel (broadest match = Über-Flag). Das
                    // frühere stripInteractiveFromArg ließ den NICHT-interaktiven
                    // Komma-Zweig stehen (`:has(:hover,#never)` → `:has(#never)`,
                    // qSA valide aber count=0, KEIN throw → still NICHTS geflaggt =
                    // false-silent Leck). Ganz-Verwerfen kann nie still leeren:
                    //   #w:has(:hover,#never) #t → #w #t (matcht #t, ✓)
                    //   :is(&:hover).hit         → .hit  (global, leck-freier Über-Flag)
                    //   #t:not(:hover)           → #t    (matcht #t, ✓)
                    i = k; // ganze :fn(...) verwerfen
                    continue;
                  } else {
                    // E1-FIX: STRUKTURELLE funktionale Pseudo-Klasse (`:is(#r0)`,
                    // `:not(.x)`, `:nth-child(2)`) BEHALTEN — der Browser löst sie in
                    // qSA NATIV und PRÄZISE auf. Nicht mit-strippen (sonst würde
                    // `:is(#r0):hover` zu '*' → ALLE Elemente fälschlich geflaggt).
                    out += s.slice(i, k);
                    i = k;
                    continue;
                  }
                } else {
                  // Einfache Pseudo-Klasse: verwerfen.
                  if (INTERACTIVE_PSEUDO_SET.has(name)) hadInteractive = true;
                  i = j;
                  continue;
                }
              }
            }
            out += c;
            // Nach Whitespace/Kombinator/`(` (Tiefe 0) beginnt ein neues Compound →
            // dort darf erneut ein ns-Präfix auftreten.
            atBoundary =
              bracket === 0 &&
              (c === ' ' || c === '>' || c === '+' || c === '~' || c === '(');
            i++;
          }
          return { stripped: out, hadInteractive };
        }

        // §D5-WURZELUMBAU (Härtungs-Runde 2): T3 splitCompounds / T4 compoundOrStar /
        // T5 buildStateBases + der frühere Self-OR-Ancestor-el.matches-Walk sind
        // ERSATZLOS entfallen. Stattdessen wird pro interaktivem Komma-Teil EINMALIG
        // `svg.querySelectorAll(strippedSelector)` aufgerufen (T6 normalizeStripped +
        // pushPart, unten beim matchedStateElements-Set). Der Browser löst ~/+/>/
        // Nesting/Escape/:is() NATIV — die handgebaute matches-Basis konnte
        // Sibling-/Kombinator-Kontext prinzipiell nicht (matches testet 1 Element
        // gegen den GANZEN Selektor) und über-/unter-flaggte (Wurzel A + FP-E). Die
        // CSS-Vererbungs-Kaskade (B-LEAK) ist via Nachfahren-Expansion zum Match-
        // Zeitpunkt schon im Set. (T1 splitTopLevelCommas + T2 stripPseudoClasses
        // bleiben — live als korrekt belegt.)

        // (T6a) substituteAmpersand: CSS-Nesting (`& #t:hover` in einer verschachtelten
        // Regel) — W3C css-nesting-1 §3.2: `.foo{+.baz{}}` ≡ `:is(.foo)+.baz`. Jedes
        // NACKTE `&` → `:is(<parentSel>)`. E2-FIX: auf JEDER Klammertiefe ersetzen
        // (`:is(&:hover) .hit` → `:is(:is(#wrap):hover) .hit`) — die frühere
        // paren===0-Beschränkung ließ ein `&` in `:is(...)` als naked stehen → qSA
        // wirft/over-flaggt. Quotes/Brackets weiter überspringen; ESCAPED `\&`
        // (Backslash direkt davor, außerhalb Quote) NICHT ersetzen (Literal-&, Doku).
        // Rein string-basiert, kann NICHT werfen. (resolvedSelectorText existiert in
        // diesem Chromium NICHT → selbst desugaren.)
        function substituteAmpersand(sel, parentSel) {
          if (!parentSel || sel.indexOf('&') === -1) return sel;
          const repl = ':is(' + parentSel + ')';
          let out = '';
          let bracket = 0;
          let quote = '';
          const s = String(sel);
          for (let i = 0; i < s.length; i++) {
            const c = s[i];
            if (quote) {
              out += c;
              if (c === '\\') {
                if (i + 1 < s.length) {
                  out += s[i + 1];
                  i++;
                }
              } else if (c === quote) quote = '';
              continue;
            }
            if (c === '"' || c === "'") {
              quote = c;
              out += c;
              continue;
            }
            if (c === '\\') {
              // Escape außerhalb Quote: `\&` ist ein Literal-& → NICHT ersetzen.
              out += c;
              if (i + 1 < s.length) {
                out += s[i + 1];
                i++;
              }
              continue;
            }
            if (c === '[') bracket++;
            else if (c === ']') {
              if (bracket > 0) bracket--;
            }
            // `&` außerhalb Quote/Bracket auf JEDER Paren-Tiefe ersetzen (E2).
            if (c === '&' && bracket === 0) {
              out += repl;
              continue;
            }
            out += c;
          }
          return out;
        }

        // (T6b) normalizeStripped: macht einen gestrippten Selektor qSA-sicher.
        //   Column-Combinator `||` (CSS Selectors L4, in qSA NICHT implementiert →
        //     SyntaxError) → ein Leerzeichen (Descendant, gröber aber gültig) →
        //     Stufe 1 greift statt der Salvage/Fallback-Leiter.
        //   '' → '*' (geleert, z.B. `:hover` allein).
        //   führender Kombinator (`> rect`/`~ #t`/`+ #b`) → `* `-Präfix (qSA wirft
        //     sonst SyntaxError, live belegt).
        //   NACHFOLGENDER Kombinator (`g >` aus `g > :hover`) → ` *`-Suffix (das
        //     letzte Compound wurde leer gestrippt; ohne `*` endet der Selektor auf
        //     einem Kombinator → qSA wirft, live G1).
        //   doppelter Kombinator (`a > > b`, geleertes Mittel-Compound) → `* ` dazwischen.
        function normalizeStripped(s) {
          let out = String(s).replace(/\|\|/g, ' '); // Column-Combinator entschärfen
          out = out.replace(/\s+/g, ' ').trim();
          if (out === '') return '*';
          if (/^[>+~]/.test(out)) out = '* ' + out;
          if (/[>+~]$/.test(out)) out = out + ' *';
          out = out.replace(/([>+~])\s*([>+~])/g, '$1 * $2');
          return out;
        }

        // (T6c) extractSimpleSubSelectors: aus einem in qSA WERFENDEN Selektor die
        // auflösbaren EINFACHEN Sub-Selektoren ziehen (Salvage-Stufe 2). Tokenisiert
        // regex-basiert #id / .class / Tag-Token; ns-Präfix (`pfx|`) wird abgestreift.
        // KEINE Kombinator-/Pseudo-/Attribut-Semantik — nur einzeln-qSA-bare Atome,
        // damit Stufe 2 garantiert gültige (wenn auch gröbere) Selektoren liefert.
        function extractSimpleSubSelectors(sel) {
          const subs = new Set();
          const s = String(sel);
          // #id  und  .class  (CSS-Ident inkl. Escapes \X grob mitnehmen)
          for (const m of s.matchAll(/[#.](?:\\.|[\w-])+/g)) subs.add(m[0]);
          // Tag-Token: Wort am Compound-Anfang (Start oder nach Kombinator/Whitespace/
          // `(`/`,`), optional mit ns-Präfix `pfx|` → Präfix abstreifen, nur localName.
          for (const m of s.matchAll(
            /(?:^|[\s>+~(,])(?:[A-Za-z_-][\w-]*\|)?([A-Za-z][\w-]*)/g,
          )) {
            const tag = m[1];
            // Pseudo-/Funktions-Namen entstehen nie hier (`:`/`(` davor ist kein
            // Compound-Anfang in dieser Regex). Tag als reines Element-Atom aufnehmen.
            if (tag) subs.add(tag);
          }
          return [...subs];
        }

        // SMIL-begin/end-Klassifikation (D-FIX). Eine reine String-Taxonomie über
        // W3C SVG1.1 §19.2.8 (Animation timing). KEIN Über-Flag für AUTO-Token
        // (load/none/syncbase/repeat/clock), aber BLIND-TRUST-konform: unbekannte
        // Token → 'event' (Über-Flag leck-frei).
        // Echte INTERAKTIONS-Events (User-Trigger → echter Alt-Zustand):
        const INTERACTION_EVENTS = new Set([
          'click',
          'dblclick',
          'mousedown',
          'mouseup',
          'mouseover',
          'mousemove',
          'mouseout',
          'mouseenter',
          'mouseleave',
          'pointerdown',
          'pointerup',
          'pointerover',
          'pointermove',
          'pointerout',
          'pointerenter',
          'pointerleave',
          'pointercancel',
          'touchstart',
          'touchend',
          'touchmove',
          'touchcancel',
          'keydown',
          'keyup',
          'keypress',
          'focus',
          'blur',
          'focusin',
          'focusout',
          'activate',
          'domactivate',
        ]);
        // Auto-feuernde Events (KEIN User-Trigger → kein Interaktions-Alt-Zustand):
        const AUTO_EVENTS = new Set([
          'load',
          'unload',
          'abort',
          'error',
          'resize',
          'scroll',
          'zoom',
          'beginevent',
          'endevent',
          'repeatevent',
        ]);
        function isClockValue(t) {
          // Vollform hh:mm:ss(.f), Teilform mm:ss(.f), Timecount n(.f)(h|min|s|ms)?.
          return (
            /^\d+:[0-5]\d:[0-5]\d(\.\d+)?$/.test(t) ||
            /^[0-5]\d:[0-5]\d(\.\d+)?$/.test(t) ||
            /^\d+(\.\d+)?(h|min|s|ms)?$/.test(t)
          );
        }
        function classifyBeginToken(raw) {
          const t = String(raw == null ? '' : raw).trim();
          if (t === '') return 'auto'; // leeres begin = Default 0s = Auto-Start
          if (t === 'indefinite') return 'auto'; // nur per script/hyperlink → kein UI-State
          if (t === 'none') return 'never'; // script-only (post-DOMPurify tot)
          // führendes +/- (mit Leerraum) abstreifen → reiner Clock-Wert = Auto.
          const noSign = t.replace(/^[+-]\s*/, '').trim();
          if (isClockValue(noSign)) return 'auto';
          if (/^accesskey\(/i.test(t)) return 'event'; // Tastatur-Trigger = Interaktion
          // repeat(n) / id.repeat(n) → zeitlich (Auto).
          if (/^(?:[A-Za-z_][\w-]*\.)?repeat\(\s*\d+\s*\)/i.test(t)) return 'auto';
          // E4-FIX: wallclock(...) → zeitgesteuert (Auto), keine Interaktion.
          if (/^wallclock\(/i.test(t)) return 'auto';
          // syncbase `id.begin`/`id.end`/`id.beginEvent`/`id.endEvent` (+/- offset) →
          // zeitlich an eine andere Timeline gekoppelt (Auto). L1: ob die referenzierte
          // Timeline interaktions-verwurzelt ist, entscheidet der SMIL-Timing-Graph-
          // Fixpunkt (unten), NICHT diese lokale Token-Klassifikation.
          if (
            /^[A-Za-z_][\w-]*\.(?:begin|end|beginEvent|endEvent)(?:\s*[+-]\s*\S+)?$/i.test(
              t,
            )
          )
            return 'auto';
          // eventbase `id.event` (+/- offset) ODER bloßes `event`.
          const m = t.match(/^(?:[A-Za-z_][\w-]*\.)?([A-Za-z][\w-]*)(?:\s*[+-]\s*\S+)?$/);
          if (m) {
            const ev = m[1].toLowerCase();
            if (INTERACTION_EVENTS.has(ev)) return 'event';
            if (AUTO_EVENTS.has(ev)) return 'auto';
            return 'unknown'; // BLIND-TRUST: unbekanntes Event → behandeln wie event
          }
          return 'unknown';
        }
        // L1/F-D-Helfer: liefert bei JEDER `<id>.<token>`-Form (Syncbase
        // `X.begin`/`X.end`/`X.beginEvent`/`X.endEvent`, `.repeat(n)`/`.repeatEvent`,
        // ABER AUCH Eventbase `X.click`/`X.mouseover`) die referenzierte Timeline-id X,
        // sonst null. KONSERVATIV (F-D): jede `id.`-Kante wird verfolgt, damit der
        // Fixpunkt über `a1.repeat(1)` u.Ä. NICHT abreißt. Kein Rausch bei reinen
        // Zeit-Ketten — propagiert wird NUR, wenn die referenzierte id selbst
        // interaktions-verwurzelt ist (der Aufrufer prüft interactionRooted.has(X)).
        // `accessKey(x)` enthält keinen führenden `id.` → null (korrekt: kein Ref).
        function syncbaseRefOf(raw) {
          const t = String(raw == null ? '' : raw).trim();
          // führendes `id.` (id = CSS-/SMIL-Ident), gefolgt von einem Buchstaben
          // (Token-Anfang). Schließt `2s`/`0.5s` (kein id-Präfix) und `wallclock(...)`
          // / `accessKey(...)` (keine `ident.`-Form vor der Klammer) aus.
          const m = t.match(/^([A-Za-z_][\w-]*)\.[A-Za-z]/);
          return m ? m[1] : null;
        }
        // (Das frühere listHasEventToken ist durch den SMIL-Timing-Graph-Fixpunkt
        // ersetzt — die Wurzel-Erkennung läuft jetzt pro begin-Token via
        // classifyBeginToken + syncbaseRefOf transitiv, NICHT mehr pauschal pro Attr.)

        // §E4 PAINT-EXTENT-EHRLICHKEIT (F-AT-004, DoD-3). Ein gefiltertes Element
        // malt Tinte (Glow/Schatten/Blur, +52% Fläche) AUSSERHALB seiner geom-bbox.
        // getBBox() UND getBoundingClientRect() sind beide filter-blind (Filter
        // Effects L1 §8 — die geom-bbox ist die UNgefilterte Box) → KEINE
        // DOM-Geometrie-API liefert die Tinte. Die `<filter>`-REGION ist hingegen
        // eine W3C-GARANTIERTE harte obere Schranke der Tinte über ALLE Primitive
        // ("hard clipping region", Filter Effects L1 §8/§9.4): nichts wird außerhalb
        // gemalt. Sie ist REIN aus Attributen ableitbar (filterUnits + x/y/w/h) —
        // KEIN Pixel-/GPU-Scan (der bräche R9-Determinismus). Referenz rasterfrei:
        // librsvg bounds.rs BoundsBuilder, resvg/usvg filter.rs.

        // (1) BESITZER-Element des effektiven Filters finden — self-or-ancestor-Walk,
        // EXAKT gespiegelt an isSelfOrAncestor3D/isSelfOrAncestorNonSmilMotion. Ein
        // Filter auf einem Vorfahr-<g> (SKIP_TAGS, nie selbst inspiziert) clippt die
        // GESAMTE gemalte Ausgabe dieses Vorfahren auf SEINE Region (Filter Effects
        // L1 §8 — der Filter wird auf die Box des FILTER-TRAGENDEN Elements bezogen,
        // NICHT auf das Blatt). HIGH-#1-FIX (Codex/MD-LOOP): wir geben das BESITZER-
        // Element F zurück (nicht nur den Filter-String), damit der Aufrufer die
        // Region aus F.getBBox() + F's EIGENER CTM/userM rechnet — sonst wäre die
        // Schranke im falschen Koordinatenraum (Blatt-bbox) und grob zu klein
        // (Multi-Child-Gruppe: jedes Kind bekäme nur seine eigene Mini-Region statt
        // der großen Gruppen-Region → Tinte außerhalb visual_bbox = DoD-3-Lüge).
        // KOLLAPS-REGEL (Codex NO-GO #2): zähle ALLE Filter in der self+Vorfahren-
        // Kette. Liefert {owner, filter, count} — owner/filter vom ERSTEN Treffer
        // (Blatt zuerst, das ist die innerste Region), count = Anzahl filternder
        // Knoten gesamt. count===0 → null (kein Filter). count>1 → die Tinte wird
        // durch MEHRERE kumulative Regionen erweitert (self-Filter + Vorfahr-Filter),
        // die NICHT billig sicher zu EINER oberen Schranke komponierbar sind →
        // der Aufrufer hält die visual_bbox-ZAHL zurück (not_measurable). Das Flag
        // has_paint_overflow bleibt true (count>=1).
        function selfOrAncestorFilterOwner(start) {
          let n = start;
          let owner = null;
          let filter = null;
          let count = 0;
          while (n) {
            const f = getComputedStyle(n).filter;
            if (f && f !== 'none') {
              count++;
              if (owner === null) {
                owner = n;
                filter = f;
              }
            }
            n = n.parentElement;
          }
          return owner === null ? null : { owner, filter, count };
        }
        // §HEAL-R6 Variante 1 (F-AT-6-07, DoD-2-Schwanz). Räumliche Masken-Operatoren
        // (clip-path / mask / fill|stroke=pattern / filter) löschen Tinte, ohne dass
        // ein Skalar-Faktor (T1/T2) sie sieht. RASTER-FREI (R9): rein attributiv/CTM
        // @t=0, KEIN getImageData, KEIN Sub-Render. Drei-wertige Pessimismus-Leiter:
        //   B1 CTM-Determinante  → beweisbar tot (det===0) / unbestimmt (nicht-endlich)
        //   B3 Vorfahr-Viewport-Clip → beweisbar tot (Welt-bbox ∩ Root-VP leer, vpSafe)
        //   B4 Honest-Flag-Else  → räuml. Operator present, NICHT von B1/B3 entschieden
        //                          → 'indeterminate' (ehrlich unbestimmt, nie falsch-tot).
        //
        // (B3a) Ein Vorfahr trägt ein Viewport-Clip (overflow≠visible am direkten
        // Root-VP), das die Tinte HART auf das Root-Viewport-Rechteck beschneidet.
        // vpSafe ⇔ KEIN verschachteltes <svg>/<symbol> zwischen Element und Root und
        // KEIN overflow:visible-Vorfahr (sonst ist das Clip-Rechteck nicht das Root-
        // VP → unbestimmt). SVG-Default: das äußere <svg> clippt auf sein Viewport
        // (overflow:hidden), nested <svg>/<symbol> ebenso — aber deren Region ist
        // hier nicht billig beweisbar → vpSafe=false → 'indeterminate' statt false.
        function ancestorViewportClipState(start) {
          for (let a = start.parentElement; a && a !== svg; a = a.parentElement) {
            const at = a.tagName ? a.tagName.toLowerCase() : '';
            if (at === 'svg' || at === 'symbol') return 'nested'; // unbestimmt.
            const ov = getComputedStyle(a).overflow;
            if (ov === 'visible') return 'visible'; // Clip aufgehoben → unbestimmt.
          }
          // 🔴 Codex8-FIX: das ROOT-<svg> SELBST muss overflow tragen. overflow:visible
          // am Root → das Viewport-Clip ist aufgehoben → außen liegende Tinte IST
          // sichtbar → NIE dead. (Der frühere Walk stoppte bei a!==svg und prüfte den
          // Root nie → false-tot bei <svg overflow="visible">.)
          if (getComputedStyle(svg).overflow === 'visible') return 'visible';
          return 'root'; // direkt im Root-VP, Default overflow:hidden clippt.
        }
        // §HEAL-R6 V2 — B3-NESTED-FIX (separater, reproduzierter Gap). B3-root deckt
        // nur den Root-Viewport. Ein verschachteltes <svg> mit overflow:hidden (Default)
        // clippt seine Kinder HART auf sein eigenes Viewport-Rechteck (0,0,width,height
        // in seinem inneren Koordinatensystem). Ein Element-Welt-bbox, die mit DIESEM
        // Rechteck DISJUNKT ist → 0 sichtbare Pixel, aber V1 meldet es als sichtbar
        // (kein Feld = Lüge). FIX: Vorfahr-Viewport-Walk; Element-Welt-bbox ∩ nested-VP-
        // Region leer → 'indeterminate' (NIE bare-visible, NIE false — der nested-VP-
        // Schnitt ist nicht so beweisbar-exakt wie der Root-VP-Fall: getScreenCTM des
        // nested-<svg> projiziert dessen INNERES Rechteck, die Region-Wahl ist hier die
        // sichere obere Schranke, das Verdikt bleibt ehrlich unbestimmt). overflow:
        // visible am nested-<svg> → kein Clip → übersprungen. <symbol> → die Viewport-
        // Geometrie ist instanz-/<use>-abhängig (nicht lokal beweisbar) → übersprungen
        // (B3-root deckt den disjunkten Fall bereits via vpState='nested'→indeterminate).
        // Welt-bbox des ELEMENTS wird als (exmin..eymax) übergeben (ROOT-user-space).
        function nestedViewportClipsOut(start, exmin, eymin, exmax, eymax, sCTM, p) {
          for (let a = start.parentElement; a && a !== svg; a = a.parentElement) {
            const at = a.tagName ? a.tagName.toLowerCase() : '';
            if (at !== 'svg') continue; // nur nested-<svg> hat ein billig-lokales VP.
            if (getComputedStyle(a).overflow === 'visible') continue; // kein Clip.
            const aCTM = a.getScreenCTM ? a.getScreenCTM() : null;
            if (!aCTM) continue; // nicht projizierbar → konservativ überspringen.
            // Nested-VP-Dimensionen: animVal-Längen am eingefrorenen t=0 (R9). Das
            // innere Koordinatensystem startet bei (0,0) NACH der viewBox-Auflösung —
            // getScreenCTM(a) bildet genau dieses innere System auf den Bildschirm ab.
            let vw;
            let vh;
            try {
              vw = a.width.animVal.value;
              vh = a.height.animVal.value;
            } catch {
              continue;
            }
            if (!Number.isFinite(vw) || !Number.isFinite(vh) || vw <= 0 || vh <= 0)
              continue;
            // Inneres VP-Rechteck (0,0,vw,vh) → ROOT-user-space via sCTM⁻¹·aCTM.
            const m = sCTM.inverse().multiply(aCTM);
            const cs2 = [
              { x: 0, y: 0 },
              { x: vw, y: 0 },
              { x: 0, y: vh },
              { x: vw, y: vh },
            ].map((c) => {
              p.x = c.x;
              p.y = c.y;
              return p.matrixTransform(m);
            });
            const vxmin = Math.min(...cs2.map((c) => c.x));
            const vymin = Math.min(...cs2.map((c) => c.y));
            const vxmax = Math.max(...cs2.map((c) => c.x));
            const vymax = Math.max(...cs2.map((c) => c.y));
            const disjoint =
              exmax <= vxmin ||
              exmin >= vxmax ||
              eymax <= vymin ||
              eymin >= vymax;
            if (disjoint) return true; // außerhalb dieses nested-VP → geclippt.
          }
          return false;
        }
        // (V2) Pattern-Präsenz: fill/stroke=url(#…)→<pattern>. Ein Pattern-Paint-Server
        // bleibt in Phase 1 dauerhaft 'indeterminate' (Pattern-<image>/leerer Inhalt
        // engine-divergent, B2/Phase 2 aufgeschoben). Genutzt vom Per-Operator-Walk.
        function refsPattern(paint) {
          if (typeof paint !== 'string' || paint.indexOf('url(') !== 0)
            return false;
          const m = paint.match(/url\(["']?#([^"')]+)["']?\)/);
          if (!m) return false;
          const node = document.getElementById(m[1]);
          return !!node && node.tagName.toLowerCase() === 'pattern';
        }

        // ════════════════════════════════════════════════════════════════════════
        // §HEAL-R6 V2-PRÄZISION — Phase 1 ALIVE-Whitelist (additiv auf V1-B4).
        // Quelle: docs/internal/…spec.md „V2-PRÄSISION (additiv auf V1)". Prinzip:
        // sichtbare Tinte = Quell-Tinte × Überdeckung × Operator-Alpha-Gewinn → billig
        // entscheidbar gdw. EIN Faktor KONSTANT über die object-bbox (≡>0 sichtbar).
        // Pro present-Operator → 'dead'|'alive'|'indeterminate'. Phase 1 schaltet NUR
        // die 4 ALIVE-Prädikate scharf (KEINE DEAD-Regeln — die bleiben indeterminate).
        // Jedes ALIVE-Prädikat ist ein Spec-Theorem (konstanter Faktor ≡>0); JEDE
        // Unsicherheit → indeterminate (monoton pessimistisch, NIE falsch-sichtbar).
        // RASTER-FREI (R9): rein attributiv/animVal @t=0, KEIN getImageData/Sub-Render.

        // url(#id) → das referenzierte Element ODER null (kein url / nicht auflösbar).
        function resolveUrlRef(v) {
          if (typeof v !== 'string') return null;
          const m = v.match(/url\(["']?#([^"')]+)["']?\)/);
          if (!m) return null;
          return document.getElementById(m[1]);
        }
        // Farb-Alpha (4. rgba-Komponente) ODER 1 (rgb/unbekannt = opak). Spiegel des
        // Element-Loop-parseColorAlpha; hier eigenständig, da anderer Scope.
        function colorAlphaOf(v) {
          if (typeof v !== 'string') return 1;
          const m = v.match(
            /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+%?)\s*)?\)$/i,
          );
          if (!m || m[1] === undefined) return 1;
          const a = m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
          return Number.isFinite(a) ? a : 1;
        }
        // Schwarz/transparent-Solid (Luminanz 0 ODER α 0)? Eine Luminanz-Maske bildet
        // schwarze Tinte auf α=0 ab (§9.2). black/#000/rgb(0,0,0)/transparent/none.
        function isBlackOrTransparent(fill) {
          if (typeof fill !== 'string') return true; // unbekannt → konservativ dead.
          const f = fill.trim().toLowerCase();
          if (f === 'none') return true;
          if (colorAlphaOf(f) === 0) return true;
          if (f === 'black' || f === '#000' || f === '#000000') return true;
          const m = f.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
          if (m) {
            return (
              parseFloat(m[1]) === 0 &&
              parseFloat(m[2]) === 0 &&
              parseFloat(m[3]) === 0
            );
          }
          return false;
        }
        // Deckt b1 (Kind-bbox) b2 (Eltern-geom-bbox) VOLL ab? (b1 ⊇ b2, ε-Toleranz für
        // Float-Drift). „voll-bbox-deckend" = das Operator-Kind/clip-Shape umschließt
        // die gesamte object-bbox → der Operator-Faktor ist über die ganze bbox aktiv.
        function bboxCovers(b1, b2) {
          if (!b1 || !b2) return false;
          const E = 1e-6;
          return (
            b1.x <= b2.x + E &&
            b1.y <= b2.y + E &&
            b1.x + b1.width >= b2.x + b2.width - E &&
            b1.y + b1.height >= b2.y + b2.height - E
          );
        }
        function safeBBox(node) {
          try {
            return node.getBBox();
          } catch {
            return null;
          }
        }

        // ── FILTER-alive ────────────────────────────────────────────────────────
        // Über das bestehende resolveFilterElement (count===1, single url(#id), kein
        // href, animVal@t=0). Der Filter ist alive gdw. sein Wurzel-Primitiv (das
        // letzte Kind = Ergebnis der result-Kette) ∈ {feGaussianBlur, feOffset,
        // feMerge, feDropShadow} ist, mit in ∈ {SourceGraphic, SourceAlpha, leer},
        // UNVERZWEIGTER Baum. Diese 4 sind alpha-erhaltend mit konstantem Gewinn ≡>0
        // (Blur/Offset verschieben/streuen Tinte, Merge/DropShadow addieren sie). K1:
        // feSpecularLighting NIE (Sa=max(RGB) kann 0). K2: feMorphology NIE (Default
        // erode frisst Alpha). Jede andere Primitive / Verzweigung → indeterminate.
        function classifyFilterAlive(filterStr) {
          const filterEl = resolveFilterElement(filterStr);
          if (filterEl === 'not_measurable') return 'indeterminate';
          // 🔴 Codex7-Kohärenz: ein generativer Filter (feFlood/feImage/feTurbulence)
          // transformiert NICHT die Quell-Grafik — der SourceGraphic-Pfad unten gilt
          // nicht. Generativ-beweisbar-alive (reines feFlood-α>0, voll-Region) →
          // alive (das ist der gemalte Operator); generativ-aber-nicht-beweisbar →
          // indeterminate. So bleibt ein feFlood-alive in der Kette KONSISTENT alive
          // (statt vom „nicht in den 4"-Zweig fälschlich kontaminiert zu werden).
          const gen = filterGeneratesPaint(filterStr);
          if (gen === 'alive') return 'alive';
          if (gen === 'indeterminate') return 'indeterminate';
          const prims = Array.from(filterEl.children).filter((c) => {
            const t = c.tagName ? c.tagName.toLowerCase() : '';
            return t.indexOf('fe') === 0;
          });
          if (prims.length === 0) return 'indeterminate'; // leerer Filter (Ph.2 DEAD).
          // UNVERZWEIGT: jede Primitive (außer der Wurzel) muss ihr `result` an die
          // genau-EINE nächste Primitive weiterreichen. Billig-Approx: KEINE zwei
          // Primitiven mit gleichem expliziten `result`, und der Baum ist linear —
          // jede non-leaf-Primitive hat genau einen Konsumenten. Konservativ: jede
          // Primitive, die NICHT zu den 4 erlaubten gehört → indeterminate (sofort).
          const ALLOWED = new Set([
            'fegaussianblur',
            'feoffset',
            'femerge',
            'fedropshadow',
          ]);
          // K1/K2 + alle nicht-erlaubten: irgendeine nicht-ALLOWED-Primitive im Baum
          // → indeterminate (der Gewinn ist nicht beweisbar ≡>0). feMerge darf
          // feMergeNode-Kinder haben (gehören zur feMerge-Definition, kein eigenes fe*).
          for (const p of prims) {
            const t = p.tagName.toLowerCase();
            if (!ALLOWED.has(t)) return 'indeterminate';
          }
          // Quelle: JEDE Primitive mit explizitem `in` muss aus {SourceGraphic,
          // SourceAlpha, leer} ODER dem `result` einer Vorgänger-Primitive lesen.
          // Externe/unbekannte Quellen (BackgroundImage, FillPaint, fremder result) →
          // indeterminate. feMerge liest über feMergeNode.in.
          const knownSources = new Set(['SourceGraphic', 'SourceAlpha', '']);
          const results = new Set();
          for (const p of prims) {
            const t = p.tagName.toLowerCase();
            const inAttrs = [];
            if (t === 'femerge') {
              for (const mn of Array.from(p.children)) {
                if (mn.tagName && mn.tagName.toLowerCase() === 'femergenode')
                  inAttrs.push(mn.getAttribute('in') || '');
              }
            } else {
              inAttrs.push(p.getAttribute('in') || '');
              if (p.hasAttribute('in2')) inAttrs.push(p.getAttribute('in2'));
            }
            for (const ia of inAttrs) {
              const v = ia == null ? '' : ia;
              if (!knownSources.has(v) && !results.has(v)) return 'indeterminate';
            }
            const r = p.getAttribute('result');
            if (r) {
              if (results.has(r)) return 'indeterminate'; // dup result = verzweigt.
              results.add(r);
            }
          }
          return 'alive';
        }

        // ── FILTER-GENERATES-PAINT (🔴 Codex7-FIX, false-tot) ─────────────────────
        // Ein <filter> kann Tinte GENERIEREN, die NICHT von der Quell-Grafik abhängt:
        // feFlood (Vollfarbe §15.10), feImage (externes Bild), feTurbulence (Noise §15.24).
        // Ein Element fill=none stroke=none + so ein Filter MALT trotzdem — aber T1
        // (fill||stroke||marker) sieht 0 → meldet fälschlich paint_visible:false (Lüge).
        // Rückgabe für den self/Vorfahr-Filter-OWNER (count===1, sauber aufgelöst):
        //   'alive'         : REINER feFlood mit flood-opacity>0 ∧ flood-color-α>0 ∧
        //                     Default-/voll-deckender Region → beweisbar ≥1 Pixel.
        //   'indeterminate' : irgendeine generative Quelle present, aber nicht beweisbar-
        //                     alive (feImage/feTurbulence/feFlood-α0?/nicht-trivial) →
        //                     ehrlich unbestimmt (NIE false-tot).
        //   null            : KEINE generative Quelle → der Filter erzeugt nur aus der
        //                     (toten) Quell-Grafik → kein generierter Paint → T1 gilt.
        function filterGeneratesPaint(filterStr) {
          const filterEl = resolveFilterElement(filterStr);
          // not_measurable (count>1/href/CSS-Fn/…): wenn IRGENDEINE generative Primitive
          // im referenzierten Filter steckt, ehrlich indeterminate; sonst null.
          let node = filterEl;
          if (node === 'not_measurable') {
            // Versuch, das url(#id)→<filter> dennoch zu finden (nur für die Präsenz-
            // Prüfung; KEINE alive-Behauptung im not_measurable-Fall).
            node = resolveUrlRef(String(filterStr));
            if (!node || node.tagName.toLowerCase() !== 'filter') return null;
          }
          const prims = Array.from(node.children).filter((c) => {
            const t = c.tagName ? c.tagName.toLowerCase() : '';
            return t.indexOf('fe') === 0;
          });
          const GENERATIVE = new Set(['feflood', 'feimage', 'feturbulence']);
          const generative = prims.filter((p) =>
            GENERATIVE.has(p.tagName.toLowerCase()),
          );
          if (generative.length === 0) return null; // kein generierter Paint.
          // Beweisbar-alive NUR im saubersten Fall: EXAKT EINE Primitive, ein feFlood,
          // sauberer Single-url-Filter (filterEl≠not_measurable), flood-opacity>0 ∧
          // flood-color-α>0, Default-Region (kein x/y/width/height/filterUnits am
          // <filter>). Alles andere → indeterminate (NIE false-tot, aber auch NIE
          // falsch-alive — Region/Quelle nicht trivial-beweisbar).
          if (
            filterEl !== 'not_measurable' &&
            prims.length === 1 &&
            generative.length === 1 &&
            generative[0].tagName.toLowerCase() === 'feflood'
          ) {
            const fe = generative[0];
            const fcs = getComputedStyle(fe);
            const fo = parseFloat(fcs.floodOpacity);
            const floodOpacity = Number.isFinite(fo) ? fo : 1; // Default 1.
            const floodColor = fcs.floodColor || 'black'; // Default black α=1 (K4).
            const colorOk = colorAlphaOf(floodColor) > 0;
            const regionDefault =
              !node.hasAttribute('x') &&
              !node.hasAttribute('y') &&
              !node.hasAttribute('width') &&
              !node.hasAttribute('height') &&
              !node.hasAttribute('filterUnits');
            if (floodOpacity > 0 && colorOk && regionDefault) return 'alive';
          }
          return 'indeterminate'; // generativ present, nicht beweisbar-alive.
        }

        // ── MASK-alive ──────────────────────────────────────────────────────────
        // 🔴 GEHÄRTET (Fund1 maskUnits-Region + Fund3 mask-mode-Consumer). ROOT-PRINZIP:
        // alive NUR im trivial-beweisbaren Fall; JEDES Nicht-Default-/komplexe Attribut
        // → 'indeterminate'. Drei UNABHÄNGIGE Beweis-Säulen müssen ALLE halten:
        //   (1) mask-mode am VERBRAUCHER (§7.2, Init match-source) + mask-type am <mask>
        //       (§9.2, Init luminance) BEIDE = Luminanz (C/K3/Fund3). mask-mode:alpha am
        //       Consumer → der Luminanz-Beweis gilt nicht → indeterminate.
        //   (2) Masken-REGION (maskUnits + x/y/w/h) deckt die Element-geom-bbox beweisbar
        //       voll (Fund1). NUR der Default (objectBoundingBox, x=-10% y=-10% w=120%
        //       h=120% → IMMER deckend) ist trivial-beweisbar; jedes nicht-default
        //       Region-Attribut → indeterminate (leere/Teil-Region wäre 0px = false-alive).
        //   (3) maskContentUnits=Default (userSpaceOnUse) + ≥1 nicht-schwarzes opakes
        //       voll-bbox-deckendes Solid-Kind (keine <image>, kein url()-Paint).
        // consumerCs = computed-style des MASKE-TRAGENDEN Elements (mask-mode-Quelle).
        function classifyMaskAlive(maskRef, geomBBox, consumerCs) {
          const maskEl = resolveUrlRef(maskRef);
          if (!maskEl || maskEl.tagName.toLowerCase() !== 'mask')
            return 'indeterminate';
          // (1a) mask-mode am VERBRAUCHER (Fund3). Init = match-source; bei einer
          // <mask>-Referenz fällt match-source auf den mask-type des <mask> zurück.
          // Alles ≠ {match-source, luminance} (insb. alpha) → indeterminate.
          const maskMode = consumerCs ? consumerCs.maskMode || 'match-source' : 'match-source';
          if (maskMode !== 'match-source' && maskMode !== 'luminance')
            return 'indeterminate';
          // (1b) mask-type am <mask> (Präsentations-Attr ODER CSS). Init = luminance.
          const ms = getComputedStyle(maskEl);
          const maskType = maskEl.getAttribute('mask-type') || ms.maskType || 'luminance';
          if (maskType !== 'luminance') return 'indeterminate';
          // (2) Masken-REGION (Fund1). NUR der voll-default Fall ist trivial-deckend:
          //     maskUnits fehlend/objectBoundingBox UND x/y/width/height ALLE fehlend
          //     (→ spec-Default -10%/-10%/120%/120% objectBoundingBox = IMMER ⊇ bbox).
          //     Jedes gesetzte Region-Attribut ODER maskUnits=userSpaceOnUse →
          //     indeterminate (Deckung nicht billig-beweisbar; leere/Teil-Region wäre
          //     0px sichtbar = false-alive — die KERN-Leak).
          const maskUnits = maskEl.getAttribute('maskUnits');
          if (maskUnits && maskUnits !== 'objectBoundingBox') return 'indeterminate';
          if (
            maskEl.hasAttribute('x') ||
            maskEl.hasAttribute('y') ||
            maskEl.hasAttribute('width') ||
            maskEl.hasAttribute('height')
          )
            return 'indeterminate';
          // (3) maskContentUnits ≠ Default → Kind-bbox-Deckung nicht billig beweisbar.
          const mcu = maskEl.getAttribute('maskContentUnits') || 'userSpaceOnUse';
          if (mcu !== 'userSpaceOnUse') return 'indeterminate';
          for (const child of Array.from(maskEl.children)) {
            const ct = child.tagName ? child.tagName.toLowerCase() : '';
            if (ct === 'image') return 'indeterminate'; // Raster → nicht ableitbar.
            const ccs = getComputedStyle(child);
            const cFill = ccs.fill;
            if (cFill && cFill.indexOf('url(') === 0) continue; // Paint-Server → skip.
            // Kind-Tinte muss OPAK sein: fill-opacity UND opacity am Kind > 0 (sonst
            // weiße Farbe + α=0 = 0 Luminanz-Beitrag = false-alive, vgl. Fund3-Inhalt).
            const cFillOp = parseFloat(ccs.fillOpacity);
            const cOp = parseFloat(ccs.opacity);
            const fillOpOk = !Number.isFinite(cFillOp) || cFillOp > 0;
            const opOk = !Number.isFinite(cOp) || cOp > 0;
            if (
              cFill &&
              cFill !== 'none' &&
              !isBlackOrTransparent(cFill) &&
              fillOpOk &&
              opOk
            ) {
              const cBBox = safeBBox(child);
              if (cBBox && bboxCovers(cBBox, geomBBox)) return 'alive';
            }
          }
          return 'indeterminate';
        }

        // ── GRADIENT-alive ────────────────────────────────────────────────────────
        // ≥1 Stop mit stop-opacity>0 ∧ stop-color-α>0. PAINT-KANAL-gekoppelt: ein
        // Gradient malt nur den Kanal (fill ODER stroke), an dem er hängt — der Aufrufer
        // entscheidet die Kanal-Faltung. Hier: ist DIESER Gradient (paint-Wert) alive?
        // Nicht-trivialer gradientTransform / currentColor / CSS-var → indeterminate
        // (positionsabhängig bzw. nicht statisch auflösbar).
        function classifyGradientAlive(gradEl) {
          const t = gradEl.tagName ? gradEl.tagName.toLowerCase() : '';
          if (t !== 'lineargradient' && t !== 'radialgradient')
            return 'indeterminate';
          const gt =
            gradEl.getAttribute('gradientTransform') ||
            getComputedStyle(gradEl).transform;
          if (gt && gt !== 'none' && gt.trim() !== '') return 'indeterminate';
          // 🔴 ROOT-PRINZIP (Fund2-Note): JEDES nicht-triviale Gradient-Attribut →
          // indeterminate. spreadMethod≠pad / href-Vererbung (Stops/Attribute nicht-
          // lokal) → der einfache Stop-Beweis gilt nicht.
          const spread = gradEl.getAttribute('spreadMethod');
          if (spread && spread !== 'pad') return 'indeterminate';
          if (
            gradEl.hasAttribute('href') ||
            gradEl.hasAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
            gradEl.hasAttribute('xlink:href')
          )
            return 'indeterminate';
          // Stops aus href-Kette wären nicht-lokal → wenn keine eigenen Stops UND href
          // gesetzt → indeterminate (Vererbung ungelöst).
          const stops = Array.from(gradEl.children).filter(
            (c) => c.tagName && c.tagName.toLowerCase() === 'stop',
          );
          if (stops.length === 0) return 'indeterminate';
          for (const s of stops) {
            const scs = getComputedStyle(s);
            const so = parseFloat(scs.stopOpacity);
            const stopOpacity = Number.isFinite(so) ? so : 1;
            const sc = scs.stopColor || '';
            // currentColor/var() prüft die ROHE Quelle (Attribut + inline-style) —
            // getComputedStyle löst currentColor BEREITS zu rgb() auf (würde die
            // Erkennung umgehen). Beide Schreibweisen (Präsentations-Attr + CSS).
            const rawStopColor =
              (s.getAttribute('stop-color') || '') +
              ' ' +
              (s.getAttribute('style') || '');
            if (
              rawStopColor.indexOf('var(') !== -1 ||
              rawStopColor.toLowerCase().indexOf('currentcolor') !== -1
            )
              return 'indeterminate'; // nicht statisch auflösbar.
            if (stopOpacity > 0 && colorAlphaOf(sc) > 0) return 'alive';
          }
          return 'indeterminate'; // alle Stops α=0 ist Ph.2-DEAD → bleibt indeterminate.
        }

        // ── CLIP-alive [KERN-ASYMMETRIE D] ─────────────────────────────────────────
        // GEGENSATZ zu mask: fehlendes/none/ungültiges clip-Ziel → SICHTBAR (§5.1 'no
        // clipping', NIE dead). Alive zusätzlich gdw. eine basic-shape (CSS clip-path
        // ODER <clipPath>-Inhalt) die geom-bbox VOLL umschließt (inset(0)/umschließender
        // rect/circle). Komplexe Silhouette / clip-rule / nested / objectBoundingBox+
        // Transform → indeterminate. computed clipPath-String wird hier bewertet.
        function classifyClipAlive(clipStr, geomBBox) {
          const s = String(clipStr).trim();
          if (s === '' || s === 'none') return 'alive'; // §5.1 no clipping → sichtbar.
          // CSS basic-shape inset(0…) / circle/ellipse OHNE prozentuale/positionierte
          // Verkleinerung → konservativ NUR der trivial-deckende Fall.
          if (s.indexOf('url(') !== 0) {
            // inset(0) / inset(0px) / inset(0 0 0 0) → kein Einzug → voll-deckend.
            const im = s.match(/^inset\(([^)]*)\)/i);
            if (im) {
              const parts = im[1]
                .replace(/round[\s\S]*$/i, '')
                .trim()
                .split(/[\s,]+/)
                .filter((x) => x.length > 0);
              if (parts.length > 0 && parts.every((p) => parseFloat(p) === 0))
                return 'alive';
            }
            return 'indeterminate'; // circle()/polygon()/inset>0 → nicht billig deckend.
          }
          const clipEl = resolveUrlRef(s);
          if (!clipEl || clipEl.tagName.toLowerCase() !== 'clippath')
            return 'alive'; // ungültiges/fehlendes Ziel → §5.1 no clipping → sichtbar.
          // clipPathUnits Default = userSpaceOnUse; objectBoundingBox → indeterminate
          // (Transform-Komposition nicht billig beweisbar).
          const cpu = clipEl.getAttribute('clipPathUnits') || 'userSpaceOnUse';
          if (cpu !== 'userSpaceOnUse') return 'indeterminate';
          if (
            clipEl.getAttribute('transform') ||
            (clipEl.getAttribute('clip-rule') &&
              clipEl.getAttribute('clip-rule') !== 'nonzero')
          )
            return 'indeterminate';
          const shapes = Array.from(clipEl.children).filter((c) => {
            const ct = c.tagName ? c.tagName.toLowerCase() : '';
            return (
              ct === 'rect' ||
              ct === 'circle' ||
              ct === 'ellipse' ||
              ct === 'polygon' ||
              ct === 'path' ||
              ct === 'use'
            );
          });
          if (shapes.length === 0) return 'indeterminate'; // leerer clipPath = Ph.2.
          // nested clipPath am Kind (clip-path-Attr) / <use> → Silhouette nicht lokal.
          for (const sh of shapes) {
            const sct = sh.tagName.toLowerCase();
            if (sct === 'use') return 'indeterminate';
            if (sh.getAttribute('clip-path')) return 'indeterminate';
          }
          // EIN basic-shape-Kind, dessen geom-bbox die object-bbox VOLL umschließt →
          // die Tinte passiert ungeschnitten (konstanter Faktor 1 über die bbox). Bei
          // mehreren Kindern ist die Vereinigung ≥ jedes Einzelne → ≥1 deckendes Kind
          // genügt als untere Schranke für „voll passiert" NICHT (Silhouette dazwischen
          // könnte schneiden) → nur EIN deckendes rect/circle/ellipse zählt, und KEIN
          // weiteres Kind mit kleinerer/anderer Geometrie (das würde subtraktiv wirken
          // bei even-odd, additiv bei nonzero — bei nonzero ist Vereinigung sicher).
          // nonzero (oben erzwungen) → Vereinigung = OR → ein deckendes Kind genügt.
          for (const sh of shapes) {
            const sct = sh.tagName.toLowerCase();
            if (sct !== 'rect' && sct !== 'circle' && sct !== 'ellipse') continue;
            const shBBox = safeBBox(sh);
            // rect: bbox = Form exakt → Deckung beweist Umschließung. circle/ellipse:
            // bbox ⊋ Form (Ecken außerhalb) → bbox-Deckung beweist NICHT Form-Deckung
            // → nur rect ist hier ein sicheres Theorem; circle/ellipse → indeterminate.
            if (sct !== 'rect') continue;
            if (shBBox && bboxCovers(shBBox, geomBBox)) return 'alive';
          }
          return 'indeterminate';
        }

        // ── PER-OPERATOR-WALK + 3-wertige Faltung ─────────────────────────────────
        // Sammelt die classify aller present-Operatoren (self + Vorfahr-dessen-Region
        // die Kind-bbox VOLL deckt). Faltung: irgendein dead ⇒ dead; sonst irgendein
        // indeterminate ⇒ indeterminate; sonst alle alive ⇒ 'alive' (→ Aufrufer:
        // null/kein Eingriff). Kein present-Operator ⇒ null. Compositing-Reihenfolge
        // (filter → clip → mask → opacity) ist hier irrelevant: die Faltung ist
        // kommutativ-pessimistisch. Phase 1 erzeugt KEIN 'dead' (keine DEAD-Regeln).
        function classifySpatialMaskChain(start, geomBBox) {
          let sawIndeterminate = false;
          let sawAny = false;
          // FILTER count>1-Gate: das FILTER-alive-Prädikat verlangt count===1 (genau EIN
          // Filter entlang self+Vorfahren). Zwei kumulative Filter-Regionen sind nicht
          // billig zu EINER alive-Aussage komponierbar → jeder Filter im Walk wird zu
          // 'indeterminate' herabgestuft (spec FILTER-alive: „count===1").
          const filterHit = selfOrAncestorFilterOwner(start);
          const singleFilter = !!filterHit && filterHit.count === 1;
          for (let a = start; a && a !== svg; a = a.parentElement) {
            const cs = getComputedStyle(a);
            // Vorfahr (a !== start): sein Operator clippt die GESAMTE Ausgabe des
            // Vorfahren auf SEINE Region. Er deckt die Kind-Tinte nur dann VOLL, wenn
            // die Element-Welt-bbox in der Vorfahr-Operator-Region liegt — billig
            // beweisbar nur, wenn die Region die Element-geom-bbox umfasst. Konservativ:
            // ein Vorfahr-Operator, dessen Deckung der Kind-bbox nicht beweisbar ist,
            // wird wie present behandelt und KANN nur indeterminate/alive liefern
            // (Phase 1 hat keine DEAD-Regel), also ist Über-Konservativismus hier
            // immer indeterminate-Richtung = sicher (nie falsch-alive).
            const isSelf = a === start;
            // FILTER.
            const f = cs.filter;
            if (f && f !== 'none') {
              sawAny = true;
              // count>1 (kumulativ self+Vorfahren) → nie alive (spec: count===1).
              const c = singleFilter ? classifyFilterAlive(f) : 'indeterminate';
              if (c === 'indeterminate') sawIndeterminate = true;
              else if (c !== 'alive') return c; // (Phase 1: nie 'dead')
            }
            // CLIP.
            const cp = cs.clipPath;
            if (cp && cp !== 'none') {
              sawAny = true;
              // Vorfahr-clip auf die Kind-bbox: nur self-Deckung ist hier exakt
              // beweisbar (geomBBox ist die Element-bbox). Vorfahr → indeterminate,
              // außer der clip ist trivial 'no clipping' (none/ungültig → alive).
              const c = isSelf
                ? classifyClipAlive(cp, geomBBox)
                : (() => {
                    const probe = classifyClipAlive(cp, geomBBox);
                    // 'alive' am Vorfahr nur, wenn es 'no clipping' ist (geometrie-
                    // unabhängig). Ein geometrisch-deckender Vorfahr-clip deckt die
                    // KIND-bbox nicht beweisbar → indeterminate.
                    const s2 = String(cp).trim();
                    const noClip =
                      s2 === '' ||
                      s2 === 'none' ||
                      (s2.indexOf('url(') === 0 &&
                        (() => {
                          const ce = resolveUrlRef(s2);
                          return !ce || ce.tagName.toLowerCase() !== 'clippath';
                        })());
                    return noClip ? 'alive' : probe === 'indeterminate'
                      ? 'indeterminate'
                      : 'indeterminate';
                  })();
              if (c === 'indeterminate') sawIndeterminate = true;
              else if (c !== 'alive') return c;
            }
            // MASK.
            const mk = cs.mask || cs.maskImage;
            if (mk && mk !== 'none') {
              sawAny = true;
              // mask-Referenz aus dem mask-shorthand/maskImage extrahieren.
              const maskRef =
                (cs.maskImage && cs.maskImage !== 'none' && cs.maskImage) || mk;
              const c = isSelf
                ? classifyMaskAlive(maskRef, geomBBox, cs) // cs = Consumer (mask-mode).
                : 'indeterminate'; // Vorfahr-Maske deckt Kind-bbox nicht beweisbar.
              if (c === 'indeterminate') sawIndeterminate = true;
              else if (c !== 'alive') return c;
            }
            // PATTERN (paint-server fill/stroke) — dauerhaft 'indeterminate' (Phase 2,
            // engine-divergent). Self UND Vorfahr: ein Pattern present → indeterminate.
            if (refsPattern(cs.fill) || refsPattern(cs.stroke)) {
              sawAny = true;
              sawIndeterminate = true;
            }
            // GRADIENT (paint-server fill/stroke). PAINT-KANAL-gekoppelt: alive nur
            // wenn der Gradient der EINZIGE malende Kanal ist ODER alle malenden Kanäle
            // alive. NUR self: ein Vorfahr-Gradient malt das Vorfahr-Element, nicht das
            // Kind direkt — die Kind-Tinte ist davon unberührt (kein Operator auf dem
            // Kind), also NICHT als present für das Kind zählen (sonst falsch-indet).
            if (isSelf) {
              const gc = classifyPaintChannelGradients(a, cs);
              if (gc === 'indeterminate') {
                sawAny = true;
                sawIndeterminate = true;
              } else if (gc === 'alive') {
                sawAny = true; // alive-Gradient → kein Eingriff (folded zu alive).
              }
              // gc === null → kein Gradient-Paint → nichts.
            }
          }
          if (!sawAny) return null;
          return sawIndeterminate ? 'indeterminate' : 'alive';
        }

        // GRADIENT paint-Kanal-Faltung am Element: betrachtet fill UND stroke. Liefert
        // 'alive' (alle gradient-malenden Kanäle alive ∧ ≥1 Gradient present), null
        // (kein Gradient-Paint), 'indeterminate' (≥1 Gradient present, nicht alle alive
        // ODER Pattern/unbestimmt). Paint-Kanal-Kopplung: ein Kanal mit Solid-Tinte
        // genügt für sich; relevant ist nur, dass KEIN Gradient-Kanal indeterminate ist.
        function classifyPaintChannelGradients(el2, cs) {
          let sawGradient = false;
          let allAlive = true;
          for (const paint of [cs.fill, cs.stroke]) {
            if (typeof paint !== 'string' || paint.indexOf('url(') !== 0) continue;
            const node = resolveUrlRef(paint);
            if (!node) continue;
            const nt = node.tagName ? node.tagName.toLowerCase() : '';
            if (nt === 'lineargradient' || nt === 'radialgradient') {
              sawGradient = true;
              const c = classifyGradientAlive(node);
              if (c !== 'alive') allAlive = false;
            }
            // Pattern wird vom refsPattern-Pfad (B4-Fallback) als indeterminate
            // behandelt — hier NICHT als Gradient gezählt.
          }
          if (!sawGradient) return null;
          return allAlive ? 'alive' : 'indeterminate';
        }
        // ════════════════════════════════════════════════════════════════════════

        // (2a) computed filter-String → das EINDEUTIG referenzierte <filter>-Element,
        // ODER ein Sentinel. HIGH-#2-FIX (Codex/MD-LOOP): der computed `filter` darf
        // KEINE zusätzlichen Token tragen — 'url(#g) blur(20px)', mehrere url() oder
        // eine reine CSS-Funktion beschränken die Tinte NICHT auf die Einzel-url-
        // Region → eine numerische visual_bbox wäre zu klein. Rückgabe:
        //   <filter>-Element  → der filter ist GENAU EIN sauberes url(#id)→<filter>,
        //                       OHNE href-Vererbung UND OHNE lokale SMIL (voll-static).
        //   'not_measurable'  → Filter da, aber nicht sicher als EINE statische Region
        //                       beschränkbar (gemischt / mehrfach / reine CSS-Fn /
        //                       url ohne <filter>-Ziel / href-Vererbung / SMIL-animiert).
        function resolveFilterElement(filterStr) {
          const s = String(filterStr).trim();
          const urls = s.match(/url\([^)]*\)/g) || [];
          // Genau EIN url() UND nichts sonst (der Rest nach Entfernen des url() ist
          // leer) → eindeutig eine Filter-Region. Sonst konservativ unmessbar.
          if (urls.length !== 1) return 'not_measurable';
          const rest = s.replace(urls[0], '').trim();
          if (rest !== '') return 'not_measurable'; // z.B. url(#g) blur(20px)
          const m = urls[0].match(/url\(["']?#([^"')]+)["']?\)/);
          if (!m) return 'not_measurable';
          const node = document.getElementById(m[1]);
          if (!node || node.tagName.toLowerCase() !== 'filter')
            return 'not_measurable';
          // KOLLAPS-REGEL: ein <filter> mit href/xlink:href erbt Attribute (inkl.
          // evtl. x/y/width/height + Primitive) von einem referenzierten Basis-
          // Filter — die effektive Region ist hier NICHT lokal aufgelöst → keine
          // sichere Schranke → not_measurable (Vererbung ungelöst).
          if (
            node.hasAttribute('href') ||
            node.hasAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
            node.hasAttribute('xlink:href')
          )
            return 'not_measurable';
          // §E4 ROOT-FIX (Codex NO-GO #4): der frühere descendant-SMIL-Gate
          // (querySelector('animate,set,…')) ist ENTFERNT — er verfehlte extern
          // zielende SMIL (<animate xlink:href="#g" …> außerhalb des Filters) und
          // war Whack-a-Mole. filterRegionLocal liest stattdessen die EFFEKTIVE
          // Region per animVal (am eingefrorenen t=0 vom Browser aufgelöst, egal WIE
          // animiert) → animierte Filter werden KORREKT NUMERISCH statt unter-bound.
          // Damit ist die ganze Region-Dynamik-Klasse an der Wurzel geschlossen.
          return node;
        }
        // (2b-2d) Filter-Region im LOKALEN geom-bbox-Raum des Elements.
        // ROOT-FIX (Codex NO-GO #4): die Region wird aus dem aufgelösten SVG-DOM
        // gelesen (animVal), NICHT aus getAttribute() (= statische Basis). Am
        // eingefrorenen t=0 (pauseAnimations + setCurrentTime(0)) reflektiert
        // animVal den EFFEKTIVEN Wert — egal WIE animiert (descendant-SMIL,
        // extern-href-SMIL, künftige Vektoren). Damit ist die ganze Region-Dynamik-
        // Klasse geschlossen: animierte Filter werden KORREKT NUMERISCH (die wahre
        // t=0-Region, die die Tinte enthält), statt unter-bound. Verifiziert: animVal
        // liest extern-href-SMIL width=700% (Probe A/B), spec-Defaults bei fehlenden
        // Attributen (-10/120%), und für x="abc" den vom Browser tatsächlich
        // gerenderten Default (kein Under-Bound — animVal IST der Render-Wert).
        //   objectBoundingBox (funits=2): valueInSpecifiedUnits ist %-Wert (u=PCT)
        //     oder blanke Fraktion (u=NUMBER); rx=b.x + xFrac*b.width (analog y/h).
        //   userSpaceOnUse (funits=1): .value resolviert absolute Längen → user-units;
        //     PERCENTAGE löst gegen den Viewport — nur sicher bei vpSafe (MED-#4).
        // b = BESITZER.getBBox() (HIGH-#1). vpSafe wie gehabt.
        // Rückgabe: Array[4] (Ecken im LOKALEN Owner-Raum) ODER 'not_measurable'.
        function filterRegionLocal(filterEl, b, vpW, vpH, vpSafe) {
          const PCT =
            typeof SVGLength !== 'undefined'
              ? SVGLength.SVG_LENGTHTYPE_PERCENTAGE
              : 2;
          const OBB =
            typeof SVGUnitTypes !== 'undefined'
              ? SVGUnitTypes.SVG_UNIT_TYPE_OBJECTBOUNDINGBOX
              : 2;
          // animVal-Längen am eingefrorenen t=0. defensiv: fehlt die SVG-DOM-API
          // (z.B. exotischer Knoten) → not_measurable statt rateng.
          let ax;
          let ay;
          let aw;
          let ah;
          let funits;
          try {
            ax = filterEl.x.animVal;
            ay = filterEl.y.animVal;
            aw = filterEl.width.animVal;
            ah = filterEl.height.animVal;
            funits = filterEl.filterUnits.animVal;
          } catch {
            return 'not_measurable';
          }
          if (!ax || !ay || !aw || !ah) return 'not_measurable';

          let rx;
          let ry;
          let rw;
          let rh;
          if (funits !== OBB) {
            // userSpaceOnUse. PERCENTAGE-Längen lösen gegen den Viewport auf —
            // nur sicher als obere Schranke, wenn der Owner direkt im Root-Viewport
            // sitzt (vpSafe, MED-#4). Sonst Sentinel. Absolute Längen via .value
            // (→ user-units, viewport-unabhängig) sind immer sicher.
            const anyPct =
              ax.unitType === PCT ||
              ay.unitType === PCT ||
              aw.unitType === PCT ||
              ah.unitType === PCT;
            if (anyPct && !vpSafe) return 'not_measurable';
            const usVal = (av, vp) =>
              av.unitType === PCT ? (av.valueInSpecifiedUnits / 100) * vp : av.value;
            rx = usVal(ax, vpW);
            ry = usVal(ay, vpH);
            rw = usVal(aw, vpW);
            rh = usVal(ah, vpH);
          } else {
            // objectBoundingBox: Fraktion der geom-bbox. valueInSpecifiedUnits ist
            // der %-Wert (u=PCT → /100) ODER eine blanke Fraktion (u=NUMBER, z.B.
            // 1.2 = 120%). animVal hat fehlende Attribute bereits auf die spec-
            // Defaults (-10%/120%) aufgelöst — KEIN separater Default-Pfad nötig.
            const frac = (av) =>
              av.unitType === PCT
                ? av.valueInSpecifiedUnits / 100
                : av.valueInSpecifiedUnits;
            rx = b.x + frac(ax) * b.width;
            ry = b.y + frac(ay) * b.height;
            rw = frac(aw) * b.width;
            rh = frac(ah) * b.height;
          }
          if (
            !Number.isFinite(rx) ||
            !Number.isFinite(ry) ||
            !Number.isFinite(rw) ||
            !Number.isFinite(rh)
          )
            return 'not_measurable';
          return [
            { x: rx, y: ry },
            { x: rx + rw, y: ry },
            { x: rx, y: ry + rh },
            { x: rx + rw, y: ry + rh },
          ];
        }

        // §HEAL-R6 / T2 PAINT-EXTENT-AGGREGATOR (F-AT-6-02/03, HIGH, DoD-3). Der
        // §E4-Block oben deckt NUR <filter>-Overflow ab (selfOrAncestorFilterOwner).
        // ZWEI weitere Tinten-Quellen liegen außerhalb der reliable-bbox OHNE Flag:
        //   (a) STROKE: getBBox() ist stroke-blind (SVG-Spec; getBBox({stroke}) ist
        //       in Chromium nachweislich kaputt → NICHT nutzbar). Ein dicker stroke
        //       malt stroke-width/2 nach außen (mehr an Miter-Spitzen).
        //   (b) MARKER: marker-start/mid/end malen Grafik, deren Geometrie NICHT vom
        //       Träger stammt; bei zero-length-Trägern ist die geom-bbox 0×0 (R6-03).
        // EIN gemeinsamer ExtentSource-Vertrag {present, exceeds, corners|null}, den
        // filter/stroke/marker gleich erfüllen — EIN Union-Aggregator schreibt
        // visual_bbox/has_paint_overflow GENAU EINMAL (löst den visual_bbox-Clobber).
        // ALLES ANALYTISCH aus computed-style + Attributen (R9: kein Pixel-Scan/RNG/
        // Zeit). REGEL-4: reine DOM-Messung im evaluate-Closure → bleibt im Adapter.

        // (S1) STROKE-OUTSET-EXTENT. Der stroke ragt analytisch um `outset` über die
        // geom-bbox hinaus: stroke-width/2 für eine gerade Kontur, ×miterlimit an
        // spitzen Miter-Ecken (worst case). Liefert die vier EXPANDIERTEN Eckpunkte im
        // LOKALEN Element-User-Raum (Projektion via userM durch den Aufrufer), ODER
        // corners=null (not_measurable), wenn die analytische Schranke nicht sicher ist:
        //   vector-effect:non-scaling-stroke → die stroke-Breite skaliert NICHT mit
        //     dem userM-Transform → eine lokale Outset-Expansion projiziert FALSCH →
        //     corners=null (present bleibt true, das Flag meldet ehrlich).
        //   stroke-alignment≠center (SVG2) → asymmetrischer Versatz → keine symmetrische
        //     ±outset-Schranke → corners=null.
        // exceeds ist hier IMMER true, wenn der stroke malt (outset>0 ragt heraus).
        function strokeExtentSource(el, cs, b, strokePaints, strokeW) {
          if (!strokePaints || !Number.isFinite(strokeW) || strokeW <= 0)
            return { present: false, exceeds: false, corners: null };
          // vector-effect:non-scaling-stroke → Breite ist screen-fix, nicht user-fix
          // → die lokale Outset-Expansion ist im User-Raum nicht beweisbar korrekt.
          const ve = cs.vectorEffect || '';
          if (ve.indexOf('non-scaling-stroke') !== -1)
            return { present: true, exceeds: true, corners: null };
          // stroke-alignment≠center (noch nicht in Chromium computed; defensiv lesen):
          // verschiebt die Kontur asymmetrisch → symmetrische Schranke nicht garantiert.
          const sa = cs.strokeAlignment || cs['stroke-alignment'] || '';
          if (sa && sa !== 'center')
            return { present: true, exceeds: true, corners: null };
          const half = strokeW / 2;
          const linejoin = cs.strokeLinejoin || 'miter';
          const linecap = cs.strokeLinecap || 'butt';
          let factor;
          if (linejoin === 'miter') {
            const ml = parseFloat(cs.strokeMiterlimit);
            factor = Number.isFinite(ml) && ml >= 1 ? ml : 4; // SVG-Default 4.
          } else {
            // round/bevel join: keine Miter-Spitze. square/round-cap ragen an offenen
            // Enden um ≤half nach außen → Faktor 1 (half) deckt das (max(1,capExtra)).
            factor = Math.max(1, linecap === 'square' ? 1 : 1);
          }
          const outset = half * factor;
          if (!(outset > 0))
            return { present: false, exceeds: false, corners: null };
          return {
            present: true,
            exceeds: true,
            corners: [
              { x: b.x - outset, y: b.y - outset },
              { x: b.x + b.width + outset, y: b.y - outset },
              { x: b.x - outset, y: b.y + b.height + outset },
              { x: b.x + b.width + outset, y: b.y + b.height + outset },
            ],
          };
        }

        // (S2) MARKER-EXTENT. marker-start/mid/end (computed markerStart/Mid/End ODER
        // die marker-Shorthand) zeichnen Grafik an den Vertices des Trägers.
        // ANKER-BEWUSSTE, ROTATIONS-SICHERE SCHRANKE (Triple-Review #1 — die frühere
        // 0.5×hypot-Form UNTER-reportete bei nicht-zentriertem Anker = Blind-Trust-
        // Lüge): der Marker wird mit seinem Anker (refX,refY) AM Vertex platziert; sein
        // Inhalt belegt relativ zum Vertex x∈[-refX, mw-refX], y∈[-refY, mh-refY]
        // (×scale). Unter BELIEBIGER orient-Rotation um den Vertex ist der entfernteste
        // Punkt der Radius r = sqrt(max(refX, mw-refX)² + max(refY, mh-refY)²)×scale.
        // Diese Kugel um JEDEN Vertex deckt jede Rotation; die Vertices liegen ⊆ der
        // geom-bbox-Hülle (konservativ: wir expandieren die geom-bbox um r).
        //   scale = strokeWidth bei markerUnits=strokeWidth (Default), sonst 1
        //           (userSpaceOnUse).
        //   <viewBox> am marker → nicht-triviale content→viewport-Transform; die
        //     [0,mw]×[0,mh]-Belegungs-Annahme bricht (Inhalt kann skaliert/verschoben
        //     über die marker-box hinausragen) → corners=null (not_measurable).
        //   overflow:visible → Inhalt darf über die marker-box hinaus → corners=null.
        //   refX/refY/mw/mh nicht endlich auflösbar → corners=null (nie raten).
        // present=true sobald IRGENDEIN marker-* gesetzt ist (≠none); das FLAG meldet
        // den Overflow IMMER ehrlich, nur die ZAHL wird bei Unsicherheit zurückgehalten.
        function markerExtentSource(el, cs, b) {
          const refs = [
            cs.markerStart,
            cs.markerMid,
            cs.markerEnd,
            cs.marker, // marker-Shorthand (selten computed; defensiv).
          ].filter((v) => v && v !== 'none');
          if (refs.length === 0)
            return { present: false, exceeds: false, corners: null };
          // markerUnits Default = strokeWidth → der Marker skaliert mit der stroke-Breite.
          const strokeW = parseFloat(cs.strokeWidth);
          const sw = Number.isFinite(strokeW) && strokeW > 0 ? strokeW : 1;
          const num = (v) => {
            const n = parseFloat(v);
            return Number.isFinite(n) ? n : null;
          };
          let worstR = 0;
          let anyUnsure = false; // overflow:visible / viewBox / unauflösbar.
          let measurable = false;
          for (const ref of refs) {
            const m = String(ref).match(/url\(["']?#([^"')]+)["']?\)/);
            if (!m) {
              anyUnsure = true;
              continue;
            }
            const mk = document.getElementById(m[1]);
            if (!mk || mk.tagName.toLowerCase() !== 'marker') continue;
            const mkCs = getComputedStyle(mk);
            // <viewBox> → nicht-triviale Inhalts-Transform → Belegungs-Annahme bricht.
            if (mk.getAttribute('viewBox')) {
              anyUnsure = true;
              continue;
            }
            if ((mkCs.overflow || '') === 'visible') {
              anyUnsure = true;
              continue;
            }
            // mw/mh: Attribut bevorzugt, sonst animVal, sonst SVG-Default 3. refX/refY:
            // Default 0. ALLE müssen endlich sein, sonst not_measurable (nie raten).
            const mw =
              num(mk.getAttribute('markerWidth')) ??
              (mk.markerWidth && mk.markerWidth.animVal
                ? mk.markerWidth.animVal.value
                : 3);
            const mh =
              num(mk.getAttribute('markerHeight')) ??
              (mk.markerHeight && mk.markerHeight.animVal
                ? mk.markerHeight.animVal.value
                : 3);
            const refX = num(mk.getAttribute('refX')) ?? 0;
            const refY = num(mk.getAttribute('refY')) ?? 0;
            if (
              ![mw, mh, refX, refY].every((v) => Number.isFinite(v)) ||
              mw < 0 ||
              mh < 0
            ) {
              anyUnsure = true;
              continue;
            }
            const units = mk.getAttribute('markerUnits') || 'strokeWidth';
            const scale = units === 'userSpaceOnUse' ? 1 : sw;
            // anker-bewusster, rotations-sicherer Radius um den Vertex.
            const dx = Math.max(Math.abs(refX), Math.abs(mw - refX));
            const dy = Math.max(Math.abs(refY), Math.abs(mh - refY));
            const r = Math.hypot(dx, dy) * scale;
            if (Number.isFinite(r) && r > worstR) worstR = r;
            measurable = true;
          }
          // Irgendein unsicherer Marker ODER kein messbarer Marker mit r>0 → Flag ja,
          // Zahl nein. (anyUnsure dominiert: eine unsichere Quelle macht die ZAHL unsicher.)
          if (anyUnsure || !measurable || !(worstR > 0))
            return { present: true, exceeds: true, corners: null };
          const d = worstR;
          return {
            present: true,
            exceeds: true,
            corners: [
              { x: b.x - d, y: b.y - d },
              { x: b.x + b.width + d, y: b.y - d },
              { x: b.x - d, y: b.y + b.height + d },
              { x: b.x + b.width + d, y: b.y + b.height + d },
            ],
          };
        }

        // §1.3 Auto-ID Content-Addressed Hash-Namespace (D-004, ADR-025 §3):
        // Ersetzt den frueheren positional getStablePath-Fallback. Format ist
        // _<8hex>_<tag><n>; <8hex> kommt aus node:crypto VOR page.setContent
        // (Node-Land — H-18). Counter ist tag-lokal, monoton steigend, in der
        // Reihenfolge der querySelectorAll-Iteration — analog zur frueheren
        // Sibling-Zaehlung, jetzt aber namespaced via Hash-Praefix (disjoint
        // zwischen unverwandten SVGs). Elemente MIT expliziter SVG-id behalten
        // ihre id unveraendert (Stabilitaet fuer Mocks/Konsumenten).
        //
        // §1.3 LAYER-TRENNUNG (Patch2, F-CODEX-002 + F-OPUS-MINI-001): nextAutoId
        // akzeptiert NUR Tags im Spotter-Set (15 Tags: MDN-Renderable minus pure
        // Container; inkl. a/switch/textPath/tspan/foreignObject — F-OPUS-MINI-001
        // Verhaltens-Drift adressiert). Tags ausserhalb (z.B. `g`, `defs`, unbe-
        // kannte) liefern `null`. Aufrufer (Iterations-Schleife) behandelt das als
        // Skip (analog SKIP_TAGS) und gibt damit mechanisch das Format-Versprechen
        // der AUTO_ID_FORMAT_REGEX zurueck.
        //
        // Format-Vertrag siehe core/element_vocabulary.js AUTO_ID_FORMAT_REGEX —
        // dynamisch aus dem privaten Spotter-Set abgeleitet (keine zweite Hard-
        // coded-Liste). Predicate-Funktion isSpotterTag ist die kanonische API
        // in Node-Land; hier im Browser-Scope nutzen wir das rekonstruierte
        // SPOTTER_SET (Function-Serialisierung über page.evaluate ist nicht
        // möglich, daher Bridge via SPOTTER_TAGS_LIST-Snapshot).
        const autoIdCounters = new Map();
        function nextAutoId(tag) {
          if (!SPOTTER_SET.has(tag)) return null;
          const next = (autoIdCounters.get(tag) || 0) + 1;
          autoIdCounters.set(tag, next);
          return `_${hashPrefix}_${tag}${next}`;
        }

        const elements = [];
        // §H10 R11-01 EXISTENZ-REGISTER (Option B): css-unsichtbar geskippte
        // Elemente werden additiv erfasst (id+Achse) statt stumm verworfen —
        // die Emissions-Menge (elements) bleibt byte-stabil.
        const hidden = [];
        const all = svg.querySelectorAll('*');
        if (all.length > 500)
          return {
            error: 'TOO_MANY_ELEMENTS',
            message: `SVG hat ${all.length} Elemente (max 500)`,
          };

        // §D5 / R6-STATE: EINMALIG (NICHT pro Element) das matchedStateElements-Set
        // + die SMIL-Event-Ziele bauen. Liegt NACH dem t=0-Freeze (pauseAnimations +
        // setCurrentTime(0) @oben) — der Element-Walk startet ohnehin weit danach.
        // Reihenfolge-invariant (Set) → R9 byte-identisch.
        //
        // (1) matchedStateElements: pro interaktivem Komma-Teil einer (auch
        // verschachtelten / @scope / @import / @media) CSS-Regel → strippen →
        // `svg.querySelectorAll(stripped)` → jeder Treffer + dessen
        // `querySelectorAll('*')`-Nachfahren ins Set (CSS-Vererbungs-Kaskade, B-LEAK:
        // fill-loses Kind erbt). Der Browser löst ~/+/>/Nesting/Escape/:is() NATIV.
        //
        // LECK-FREIHEIT BY CONSTRUCTION (H4): ein interaktiv-tragender Teil, dessen
        // gestrippter Selektor in qSA WIRFT (exotischer Rest-Syntaxfehler), darf NIE
        // still 0 flaggen (= false-silent Leak). 3-Stufen-Leiter (s. pushPart):
        // (1) PRÄZISE qSA → (2) SALVAGE einfacher #id/.class/Tag-Sub-Selektoren →
        // (3) KONSERVATIVER FALLBACK flag-all (svg+Nachfahren) + STATE_DETECTION_COARSE.
        // coarseStateElements hält genau die via Stufe 3 grob geflaggten Elemente —
        // sie tragen zusätzlich die Warning (lossless-or-loud, kein getarntes Über-Flag).
        const matchedStateElements = new Set();
        const coarseStateElements = new Set();
        // §F-AT-6-09 / R6-MEDIA: dritte stille Achse — Viewport-Divergenz
        // (@media mit Viewport-Feature). EIGENES Set (NICHT in matchedStateElements
        // falten — Achsen getrennt). Reihenfolge-invariant (Set) → R9 byte-identisch.
        const mediaDependentElements = new Set();
        (function () {
          // §F-AT-6-09 VIEWPORT-WHITELIST (leck-frei): ein @media ist viewport-
          // abhängig (→ flag), AUSSER seine Bedingung besteht NUR aus Medientypen
          // (all/screen/print/speech) und/oder SAFE-NICHT-Viewport-Features. Jedes
          // Viewport-Feature ODER jedes nicht-als-SAFE-erkennbare Token (inkl.
          // calc()/unbekannt/neu) → flag (über-flaggen bei Unsicherheit). KEIN
          // matchMedia-Aufruf, KEIN matches-Gate — rein statisch @t=0.
          const SAFE_MEDIA_TOKENS = new Set([
            // Medientypen (lösen ALLEIN kein Flag aus)
            'all', 'screen', 'print', 'speech',
            // SAFE-NICHT-Viewport Features (keine Viewport-Abhängigkeit)
            'prefers-color-scheme', 'prefers-reduced-motion', 'prefers-reduced-data',
            'prefers-reduced-transparency', 'prefers-contrast', 'hover', 'any-hover',
            'pointer', 'any-pointer', 'forced-colors', 'scripting', 'color-gamut',
            'monochrome', 'color', 'color-index', 'grid', 'update', 'overflow-block',
            'overflow-inline', 'display-mode', 'inverted-colors', 'dynamic-range',
          ]);
          // Struktur-Schlüsselwörter der Media-Query-Grammatik, die selbst KEIN
          // Feature/Typ sind und daher nie ein Flag auslösen.
          const MEDIA_KEYWORDS = new Set(['and', 'or', 'not', 'only', 'min', 'max']);
          // Leitet aus mediaText/conditionText ab, ob die Bedingung ein Viewport-
          // Feature (oder ein nicht-SAFE-erkennbares Token) nennt. Token-basiert:
          // jeder Bezeichner (Feature-Name links eines ':' ODER ein nackter Typ/Boolean-
          // Feature) wird gegen SAFE_MEDIA_TOKENS geprüft. min-/max-Präfix wird auf das
          // Basis-Feature reduziert (min-width→width). Unbekanntes/calc/Funktions-Token
          // → true (über-flaggen).
          function mediaIsViewportDependent(mediaText) {
            const txt = String(mediaText || '').toLowerCase();
            if (!txt.trim()) return false; // leere Bedingung (z.B. @media {}) → kein Viewport
            // Alle Bezeichner-/Feature-Token extrahieren (Buchstaben, Ziffern, '-').
            // Werte (px-Zahlen, calc(), Quoten) werden separat geprüft: ein '(' direkt
            // nach einem Token (Funktion wie calc) ist ein unbekannter Wert → flag.
            // Strategie: jeden in '(...)' stehenden Feature-Ausdruck inspizieren PLUS
            // die nackten Medientypen außerhalb der Klammern.
            // 1) Feature-Ausdrücke in Klammern.
            const groups = txt.match(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g) || [];
            for (const g of groups) {
              const inner = g.slice(1, -1).trim();
              if (!inner) continue;
              // Funktions-Wert (calc()/min()/max()/clamp()/env()/var()/unbekannt) im
              // Ausdruck → konservativ flaggen (Wert nicht statisch klassifizierbar).
              if (/[a-z-]+\s*\(/.test(inner)) return true;
              // Feature-Name = Token links des ersten ':' (oder das ganze inner bei
              // Boolean-Feature wie (hover)). Range-Syntax `(width > 600px)` →
              // erstes Bezeichner-Token ist das Feature.
              const nameMatch = inner.match(/^[a-z][a-z-]*/);
              if (!nameMatch) return true; // beginnt nicht mit Bezeichner → unbekannt → flag
              let feature = nameMatch[0];
              // min-/max-Präfix abstreifen (min-width→width, max-aspect-ratio→aspect-ratio).
              if (feature.startsWith('min-')) feature = feature.slice(4);
              else if (feature.startsWith('max-')) feature = feature.slice(4);
              // device-*-Varianten sind ebenfalls Viewport (nicht SAFE).
              if (!SAFE_MEDIA_TOKENS.has(feature)) return true;
            }
            // 2) Nackte Token außerhalb von Klammern (Medientypen / Struktur-Keywords).
            //    Klammer-Inhalte entfernen, Reste tokenisieren.
            const bare = txt.replace(/\([^()]*\)/g, ' ');
            for (const tok of bare.match(/[a-z][a-z-]*/g) || []) {
              if (MEDIA_KEYWORDS.has(tok)) continue;
              if (!SAFE_MEDIA_TOKENS.has(tok)) return true; // unbekannter Typ → flag
            }
            return false;
          }
          // pushPart: mediaDependent steuert ZUSÄTZLICH zum hadInteractive-Gate, in
          // WELCHE Set(s) die Treffer wandern. Beide Achsen koexistieren (ein
          // #m:hover in einem Viewport-@media trägt BEIDES) → Ziel-Set-Liste.
          function pushPart(rawPart, parentSel, scopePrefix, mediaDependent = false) {
            // substituteAmpersand VOR stripPseudoClasses (erst &→:is(parent), dann
            // Pseudos strippen — sonst geht der Strukturkontext verloren).
            let eff = parentSel ? substituteAmpersand(rawPart, parentSel) : rawPart;
            // E3-FIX: @scope-Body an den scopeRoot binden — `@scope(#wrap){rect:hover}`
            // bedeutet `#wrap rect:hover` (Nachfahren von #wrap), NICHT ALLE rects.
            // Nur prefixen, wenn der Teil nicht ohnehin schon mit scopeRoot beginnt.
            if (scopePrefix && eff.trim()) {
              eff = `${scopePrefix} ${eff.trim()}`;
            }
            const { stripped, hadInteractive } = stripPseudoClasses(eff);
            // §F-AT-6-09: das hadInteractive-Gate ist jetzt durchlässig für den
            // media-Pfad — ein nicht-interaktiver Selektor in einem Viewport-@media
            // muss dennoch media_dependent flaggen. Ziel-Set-Liste: hadInteractive →
            // State-Set, mediaDependent → Media-Set; beide koexistieren (ein
            // #m:hover in einem Viewport-@media trägt BEIDES). Keiner → return.
            const targets = [];
            if (hadInteractive)
              targets.push({ set: matchedStateElements, coarse: coarseStateElements });
            if (mediaDependent)
              targets.push({ set: mediaDependentElements, coarse: mediaDependentElements });
            if (targets.length === 0) return; // F5/CX5: Attribut-Literal zählt NICHT
            const sel = normalizeStripped(stripped);
            if (!sel) return;
            // Helfer: einen Knoten + alle Nachfahren in JEDES Ziel-Set legen
            // (Achsen-parallel, identische Vererbungs-Kaskade).
            const addSubtree = (node) => {
              for (const t of targets) {
                t.set.add(node);
                for (const d of node.querySelectorAll('*')) t.set.add(d);
              }
            };
            // L2-FIX: qSA sucht NUR Nachfahren — der KONTEXTKNOTEN (das Wurzel-<svg>)
            // wird nie selbst getroffen. `#root:hover`/`:root:hover`/`svg:hover` ändert
            // via Vererbung die KIND-Tinte → svg selbst-Match prüfen (eigener try/catch).
            const matchRootSelf = (s) => {
              try {
                if (svg.matches(s)) {
                  addSubtree(svg);
                  return true;
                }
              } catch {}
              return false;
            };

            // ── STUFE 1: PRÄZISE ─────────────────────────────────────────────────
            try {
              const hits = svg.querySelectorAll(sel);
              for (const el of hits) addSubtree(el);
              matchRootSelf(sel);
              return; // präzise aufgelöst (auch 0 Treffer ist präzise: Selektor gültig)
            } catch {
              // werfender Selektor → Stufe 2.
            }

            // ── STUFE 2: SALVAGE (best-effort, weniger Rausch als flag-all) ───────
            // Aus dem werfenden `sel` die auflösbaren EINFACHEN Sub-Selektoren
            // extrahieren (#id, .class, Tag-Token), ns-Präfix abstreifen, JEDEN
            // einzeln in try/catch qSA. Union der Treffer (+ Nachfahren).
            let salvaged = false;
            for (const sub of extractSimpleSubSelectors(sel)) {
              try {
                const hits = svg.querySelectorAll(sub);
                for (const el of hits) {
                  addSubtree(el);
                  salvaged = true;
                }
                if (matchRootSelf(sub)) salvaged = true;
              } catch {}
            }
            if (salvaged) return;

            // ── STUFE 3: KONSERVATIVER FALLBACK (Garantie, NIE 0) ────────────────
            // Salvage ergab nichts → ein achsen-tragender Selektor darf NIEMALS
            // still 0 flaggen. flag-all: svg + alle Nachfahren in JEDES Ziel-Set +
            // dessen coarse-Set (lossless-or-loud; für State trägt das zusätzlich
            // STATE_DETECTION_COARSE — für Media ist coarse===set, kein Extra-Warn).
            const allNodes = [svg, ...svg.querySelectorAll('*')];
            for (const t of targets) {
              for (const n of allNodes) {
                t.set.add(n);
                t.coarse.add(n);
              }
            }
          }
          // collect(rules, parentSel, scopePrefix, mediaCtx): parentSel = effektiver
          // Selektor der umgebenden Style-Regel (CSS-Nesting, für `&`); scopePrefix =
          // der @scope-Root (Nachfahren-Bindung des @scope-Bodys), sonst null.
          // §F-AT-6-09: mediaCtx (sticky) = liegt diese Regel-Ebene innerhalb einer
          // VIEWPORT-abhängigen @media? Wird an ALLE pushPart/collect durchgereicht.
          function collect(rules, parentSel = null, scopePrefix = null, mediaCtx = false) {
            for (const rule of rules) {
              // @import (F3): CSSImportRule → rule.styleSheet rekursiv absteigen.
              // §F-AT-6-09: trägt der @import eine Media-Liste (`@import url() screen
              // and (max-width:..)`), die viewport-abhängig ist → der gesamte
              // importierte Sheet erbt mediaCtx=true (sonst mediaCtx erben). Externe
              // Imports sind i.d.R. netz-geblockt → werfen beim cssRules-Zugriff →
              // catch → kein Beitrag (data:-URIs lösen auf, s. F3-Test).
              if (rule.styleSheet) {
                let importMedia = mediaCtx;
                try {
                  if (rule.media && rule.media.length > 0)
                    importMedia =
                      mediaCtx || mediaIsViewportDependent(rule.media.mediaText);
                } catch {}
                try {
                  if (rule.styleSheet.cssRules)
                    collect(rule.styleSheet.cssRules, parentSel, scopePrefix, importMedia);
                } catch {} // cross-origin/Sandbox → ignorieren
                continue;
              }
              // @scope (F): CSSScopeRule trägt KEIN selectorText, aber .start/.end
              // (das Scope-Prelude) → diese zusätzlich tokenisieren, dann mit dem
              // scopeRoot als scopePrefix in den Body rekursieren (E3). type-Konstante
              // unzuverlässig → constructor.name ODER 'start' in rule.
              if (
                rule.constructor?.name === 'CSSScopeRule' ||
                (rule && typeof rule === 'object' && 'start' in rule && 'end' in rule)
              ) {
                // §F3-FIX (S2/F-AT-6-09): leeres/null rule.end (z.B. @scope ohne
                // to()-Limit) NICHT an pushPart geben — sonst pushPart('') →
                // normalizeStripped('') → '*' (Z.1641) → flag-all (#off außerhalb des
                // Scopes erbt fälschlich media_dependent = Über-Flag). rule.start scopt
                // den Body korrekt; ein nicht-leeres rule.end (echtes to()) wird normal
                // tokenisiert. normalizeStripped/1641 bleibt UNVERÄNDERT (der :hover-/
                // Leer-Pfad anderer Aufrufer ist intakt).
                for (const prelude of [
                  rule.start || '',
                  ...(rule.end && rule.end.trim() ? [rule.end] : []),
                ]) {
                  for (const part of splitTopLevelCommas(prelude))
                    pushPart(part, parentSel, scopePrefix, mediaCtx);
                }
                const scopeRoot =
                  stripPseudoClasses(rule.start || '').stripped.trim() || null;
                // Body an scopeRoot binden. parentSel zurücksetzen (im @scope-Body
                // ist `&` = scopeRoot, kein äußeres Style-Rule-`&` mehr). mediaCtx erben.
                if (rule.cssRules) collect(rule.cssRules, scopeRoot, scopeRoot, mediaCtx);
                continue;
              }
              // STYLE-RULE: erst die eigenen Komma-Teile (mit parentSel substituiert +
              // ggf. scopePrefix gebunden), dann IMMER (NICHT else-if) in rule.cssRules
              // absteigen — eine verschachtelte Regel (`#wrap{& #t:hover{}}`) wäre
              // sonst unsichtbar. mediaCtx an pushPart + die Kind-Rekursion durchreichen.
              if (rule.selectorText != null) {
                let eff = parentSel
                  ? substituteAmpersand(rule.selectorText, parentSel)
                  : rule.selectorText;
                // scopePrefix auf die volle Regel anwenden, damit der EFFEKTIVE
                // Selektor (als parentSel der Kinder) bereits scope-gebunden ist.
                if (scopePrefix && eff.trim()) eff = `${scopePrefix} ${eff.trim()}`;
                for (const part of splitTopLevelCommas(eff)) {
                  // eff ist bereits substituiert + scope-gebunden → null/null an pushPart.
                  pushPart(part, null, null, mediaCtx);
                }
                if (rule.cssRules) collect(rule.cssRules, eff, null, mediaCtx);
                continue;
              }
              // §F-AT-6-09 @media: CSSMediaRule → Viewport-Abhängigkeit aus
              // mediaText/conditionText per Whitelist ableiten. mediaCtx ODER neue
              // Viewport-Abhängigkeit (einmal viewport, immer viewport in diesem Ast).
              if (rule.constructor?.name === 'CSSMediaRule') {
                const cond =
                  (rule.media && rule.media.mediaText) || rule.conditionText || '';
                const mediaNow = mediaCtx || mediaIsViewportDependent(cond);
                if (rule.cssRules)
                  collect(rule.cssRules, parentSel, scopePrefix, mediaNow);
                continue;
              }
              // @supports/@layer (+ sonstige Conditional-Groups): setzen NICHTS neu —
              // mediaCtx (+ parentSel/scopePrefix) erben.
              if (rule.cssRules) collect(rule.cssRules, parentSel, scopePrefix, mediaCtx);
            }
          }
          // adoptedStyleSheets ist in der Sandbox i.d.R. leer (billige Defensive).
          const sheets = [
            ...document.styleSheets,
            ...(document.adoptedStyleSheets || []),
          ];
          for (const sheet of sheets) {
            let rules;
            try {
              rules = sheet.cssRules;
            } catch {
              continue; // B-CSSOM: cross-origin → SecurityError → Sheet überspringen
            }
            if (rules) collect(rules, null, null, false);
          }
        })();

        // (2) smilStateTargets: das ZIEL jedes INTERAKTIONS-VERWURZELTEN SMIL-Anim-
        // Elements. <set>/<animate*> sind NICHT im SPOTTER_SET → nie emittiert → das
        // Flag MUSS auf das ZIEL wandern (href#-Ziel ODER parentElement).
        //
        // L1 — SMIL-TIMING-ABHÄNGIGKEITSGRAPH + FIXPUNKT. Interaktions-Wurzeln über
        // VIER Achsen (Runde 5: begin war zu eng):
        //   (a)  begin- ODER end-Token = echtes Interaktions-Event (F-B: end="t.click").
        //   (a2) <a href="#animId"> = Hyperlink-Aktivierung startet das Anim (F-C, auch
        //        bei begin="indefinite").
        //   (b)  Fixpunkt über JEDE `id.`-Syncbase-Kante in begin ODER end (F-D: auch
        //        `.repeat(n)`), wenn die referenzierte id BEREITS verwurzelt ist.
        // Beispiel: A3(begin=trigger3.click) → B(begin=A3.begin) → C(begin=B.begin) →
        // alle drei interaktions-verwurzelt. Reine Zeit-Ketten (kein Wurzel-Event) →
        // KEIN Über-Flag (propagiert nur über verwurzelte Kanten).
        const smilStateTargets = new Set();
        const smilAnims = [...svg.querySelectorAll(
          'set,animate,animateTransform,animateMotion,animateColor',
        )];
        // F-B-FIX: Interaktion kommt NICHT nur über `begin`, sondern AUCH über `end`
        // (`begin="0s" end="t.click"`: @t=0 aktiv, Klick revertiert → zustands-
        // abhängig). timingTokensOf liefert begin- UND end-Tokens für die Wurzel- und
        // die Syncbase-Kanten-Erkennung (konservativ leck-frei: ein end-Event-Token
        // verwurzelt ebenso).
        function timingTokensOf(a) {
          const out = [];
          for (const attr of ['begin', 'end']) {
            for (const t of String(a.getAttribute(attr) || '').split(';')) {
              const tt = t.trim();
              if (tt) out.push(tt);
            }
          }
          return out;
        }
        const animById = new Map();
        for (const a of smilAnims) {
          const id = a.getAttribute('id');
          if (id) animById.set(id, a);
        }
        // (a) Direkte Wurzeln: ≥1 begin-ODER-end-Token ist ein ECHTES Interaktions-
        // Event (classify 'event', inkl. accessKey) ODER 'unknown' (BLIND-TRUST:
        // unbekannt → wie event, leck-frei).
        const interactionRooted = new Set();
        for (const a of smilAnims) {
          for (const tok of timingTokensOf(a)) {
            const cls = classifyBeginToken(tok);
            if (cls === 'event' || cls === 'unknown') {
              interactionRooted.add(a);
              break;
            }
          }
        }
        // (a2) F-C-FIX: ein `<a href="#animId">`/`xlink:href` aktiviert das Ziel-Anim
        // bei User-Klick (Hyperlink-Aktivierung = Interaktion) — auch bei
        // begin="indefinite". Zeigt ein <a> auf ein SMIL-Anim-Element → dieses Anim
        // ist interaktions-verwurzelt (Seed des Fixpunkts).
        for (const link of svg.querySelectorAll('a')) {
          const h = link.getAttribute('href') || link.getAttribute('xlink:href');
          if (!h || !h.startsWith('#')) continue;
          const target = animById.get(h.slice(1));
          if (target) interactionRooted.add(target);
        }
        // (b) Fixpunkt: ein Element wird interaktions-verwurzelt, wenn ein begin-ODER-
        // end-Token Syncbase (`X.begin`/`X.repeat(n)`/… — F-D: JEDE `id.`-Kante) auf
        // ein BEREITS verwurzeltes Element X zeigt. Terminiert monoton: |interaction-
        // Rooted| wächst streng, |smilAnims| endlich (DOM-Cap 500).
        {
          let added = true;
          while (added) {
            added = false;
            for (const a of smilAnims) {
              if (interactionRooted.has(a)) continue;
              for (const tok of timingTokensOf(a)) {
                const refId = syncbaseRefOf(tok);
                if (!refId) continue;
                const refAnim = animById.get(refId);
                if (refAnim && interactionRooted.has(refAnim)) {
                  interactionRooted.add(a);
                  added = true;
                  break;
                }
              }
            }
          }
        }
        // (c) Für jedes verwurzelte Anim-Element: dessen Ziel → smilStateTargets
        // (+ Nachfahren, falls Container).
        const allUses = [...svg.querySelectorAll('use')];
        function useRefOf(u) {
          const h = u.getAttribute('href') || u.getAttribute('xlink:href');
          if (h && h.startsWith('#')) return document.getElementById(h.slice(1));
          return null;
        }
        for (const a of smilAnims) {
          if (!interactionRooted.has(a)) continue;
          const href = a.getAttribute('href') || a.getAttribute('xlink:href');
          let target = null;
          if (href && href.startsWith('#'))
            target = document.getElementById(href.slice(1));
          if (!target) target = a.parentElement;
          if (!target) continue;
          smilStateTargets.add(target);
          for (const d of target.querySelectorAll('*')) smilStateTargets.add(d);
        }
        // F4/C — Fixpunkt-while über ALLE <use>: jede use, deren ref im Set ist ODER
        // (ref.contains ein Set-Element / das ref selbst ein Target enthält) → ins
        // Set, samt instanziierter Nachfahren. Das 3-Runden-Limit leckte bei
        // FORWARD-Reference (use VOR target in Dokument-Reihenfolge, live ab Tiefe 4).
        // Terminiert beweisbar: das Set wächst streng monoton, DOM-Cap 500.
        {
          // refInstantiatesFlagged(ref): true, wenn ref selbst im Set ist ODER ein
          // Nachfahr von ref im Set ist (ref ist ein Container, der ein geflaggtes
          // Element instanziiert). Beides → die <use> bringt einen Alt-Zustand sichtbar.
          const refInstantiatesFlagged = (ref) => {
            if (!ref) return false;
            if (smilStateTargets.has(ref)) return true;
            for (const d of ref.querySelectorAll('*'))
              if (smilStateTargets.has(d)) return true;
            return false;
          };
          let added = true;
          while (added) {
            added = false;
            for (const u of allUses) {
              if (smilStateTargets.has(u)) continue;
              if (refInstantiatesFlagged(useRefOf(u))) {
                smilStateTargets.add(u);
                for (const d of u.querySelectorAll('*')) smilStateTargets.add(d);
                added = true;
              }
            }
          }
        }

        // §F1/F2-FIX (S2/F-AT-6-09): use-href-Graph-Propagation, VERALLGEMEINERUNG
        // des obigen smil-Fixpunkts (3190-3213). SVG2 §5.6: eine <use>-Instanz erbt
        // dieselben @media am selben Viewport wie ihre Definition → die Instanz MUSS
        // dieselbe Achsen-Flagge tragen. mediaDependentElements walkt aber nur
        // CSS-Selector-Hits + DOM-Nachfahren, NICHT den use-href-Graph → eine use auf
        // eine media-getroffene <defs>-Def emittierte OHNE media_dependent (F1, stille
        // Lüge) bzw. ging bei media-bedingter Unsichtbarkeit der Def still verloren (F2).
        //
        // propagateUseGraph(set): monotones while über allUses (3168) mit useRefOf
        // (3169). Für jede <use>, deren href-Ziel im set ist ODER einen Nachfahren im
        // set hat → die <use> + ihre instanziierten Nachfahren ins SELBE set. DOM-Cap
        // (all.length≤500 oben verifiziert) + striktes monotones Set-Wachstum →
        // terminiert beweisbar (Zirkular-Schutz: bereits-im-set-Test überspringt).
        const propagateUseGraph = (set) => {
          const refInstantiatesInSet = (ref) => {
            if (!ref) return false;
            if (set.has(ref)) return true;
            for (const d of ref.querySelectorAll('*'))
              if (set.has(d)) return true;
            return false;
          };
          let added = true;
          while (added) {
            added = false;
            for (const u of allUses) {
              if (set.has(u)) continue;
              if (refInstantiatesInSet(useRefOf(u))) {
                set.add(u);
                for (const d of u.querySelectorAll('*')) set.add(d);
                added = true;
              }
            }
          }
        };
        // NUR für die MEDIA-Achse aufrufen. matchedStateElements ist eine separate
        // STATE-Achsen-Lücke (eigenes Finding, NICHT in diesem Pass). smilStateTargets
        // behält seinen bestehenden Inline-Fixpunkt (Scope-Sicherheit vor DRY).
        propagateUseGraph(mediaDependentElements);

        // §HEAL F-AT-7-01 (I2) — url(#)-REFERENZ-GRAPH-PROPAGATION, Schwester von
        // propagateUseGraph (Z.3287). SVG2: ein emittierbarer HOST, der via Paint-/
        // Geometrie-Property url(#def) referenziert (marker/pattern/mask/clip/filter/
        // gradient), ERBT die Viewport-Abhängigkeit des referenzierten Def-Subtrees.
        // Der @media-Detektor flaggt nur das (nicht-emittierbare) Def-KIND, NICHT den
        // Host → stille Lüge (Boden-Wahrheit: marker #m_rect fill rot@vp320 vs
        // schwarz@vp1920 = Mess-VP; Host #p emittiert ohne media_dependent). FIXPUNKT
        // über ALLE Elemente (nicht nur Hosts) → Tiefe-N transitiv (Def→Def→Host:
        // ein Def-Kind, das auf einen geflaggten Def referenziert, kommt selbst ins
        // Set, sodass die nächste Runde den Host erreicht). Unauflösbarer url(#) malt
        // nichts → NICHT viewport-abhängig (referenceDangling trägt das dangling-
        // Signal separat) → bewusst KEIN Über-Flag. Mutiert NUR mediaDependentElements
        // → STATE-neutral (matchedStateElements unberührt), EXAKT wie propagate-
        // UseGraph. MUSS byte-gleich in MEASURE_STATIC_MEDIA_FN gespiegelt sein, sonst
        // bricht __measureStaticMediaParityCheck (Drift = Lüge). Residual: use∘ref-
        // Kombi (<use> einer ref-geflaggten Host) — exotisch, F-AT-7-11.
        const propagateRefGraph = (set) => {
          const REF_PROPS = [
            'fill', 'stroke', 'clipPath', 'filter', 'mask', 'maskImage',
            'markerStart', 'markerMid', 'markerEnd',
          ];
          const refAll = svg.querySelectorAll('*');
          const refTargetsInSet = (el) => {
            const cs = getComputedStyle(el);
            for (let k = 0; k < REF_PROPS.length; k++) {
              const v = cs[REF_PROPS[k]];
              if (typeof v !== 'string' || v.indexOf('url(') === -1) continue;
              const rx = /url\(["']?#([^"')]+)["']?\)/g;
              let m;
              while ((m = rx.exec(v)) !== null) {
                const ref = document.getElementById(m[1]);
                if (!ref) continue; // dangling → malt nichts → nicht viewport-abh.
                if (set.has(ref)) return true;
                for (const d of ref.querySelectorAll('*'))
                  if (set.has(d)) return true;
              }
            }
            return false;
          };
          let added = true;
          while (added) {
            added = false;
            for (const el of refAll) {
              if (set.has(el)) continue;
              if (refTargetsInSet(el)) {
                set.add(el);
                added = true;
              }
            }
          }
        };
        propagateRefGraph(mediaDependentElements);

        // §HEAL-5 / F-AT-2-005 ZEIT-ACHSE (motion_dependent) — clock-rooted
        // SMIL-GEOMETRIE. Vierte stille Achse als KOMPLEMENT zu interactionRooted
        // (T3a): dort Event-Wurzeln, hier Zeit-Wurzeln. classifyBeginToken wird
        // BEWUSST NICHT wiederverwendet — seine 'auto'-Klasse konflatiert
        // 'indefinite' (Z.1781) mit ''/clock-Wert; naive Wiederverwendung
        // flaggte begin="indefinite" FALSCH (K6-Witness, Boden-Wahrheit 4c8a6ed).
        //
        // TOKEN-REGEL (MIKRO-PATCH R1, EMPIRISCH adjudiziert — Boden-Wahrheit
        // an internal session artifact
        // + empty_begin_gt.mjs, rohes Chromium OHNE Freeze, width@0 vs @700ms):
        // Blink startet die Animation NUR bei FEHLENDEM begin-Attribut (→
        // Default 0s) oder einem validen Offset-/Clock-Token. ALLE anderen
        // Formen sind UNRESOLVED und laufen NIE: 'nope' · 'click + nope' ·
        // 'a.begin + nope' · 'repeat(1)junk' · 'wallclock(' · 'click;' ·
        // ';click' · '' (leeres Attribut!) · ' ' · ';;' · '5sec' · '\t'.
        // Die frühere Annahme „parse-kaputt ⇒ normativ 0s" (Spec C-05) ist
        // damit WIDERLEGT — KEIN true-Fallthrough mehr:
        //   clock-rooted ⇔ begin-ATTRIBUT FEHLT GANZ
        //                  ∨ ≥1 Token parst als VALIDER Offset-/Clock-Wert.
        //   ALLES andere → false: leeres/whitespace-Attribut, leere Tokens,
        //   malformed, unbekannte Einheiten ('5sec') · indefinite · none ·
        //   Event/accessKey (state-Domäne, T3a trägt) · repeat(n)/Syncbase
        //   (Ketten — Residuum konservativ) · wallclock. Misch-Token
        // ('0s;click'): der Clock-Token wertet UNABHÄNGIG vom Event-Token —
        // beide Achsen-Flags koexistieren (K2).
        function clockRootedBeginToken(raw) {
          const t = String(raw == null ? '' : raw).trim();
          if (t === '') return false; // leerer Token: unresolved, läuft nie (GT)
          const noSign = t.replace(/^[+-]\s*/, '').trim();
          // NUR ein valider Offset-/Clock-Wert wurzelt zeitlich ("2s", "+0.5s",
          // "02:30") — jede andere Form (auch malformed) läuft in Blink nie.
          return noSign !== '' && isClockValue(noSign);
        }
        // GEOMETRIE-GATE (Spec-Tabelle): animateTransform/animateMotion IMMER
        // (Transform-/Pfad-Bewegung IST Geometrie); animate/set NUR auf einem
        // GEOMETRIE-Attribut (Paint-Kanäle wie fill/fill-opacity sind T1-Domäne
        // und dürfen NICHT zählen, Triple-F1/F2); animateColor NIE (reiner Paint).
        const SMIL_GEOM_ATTRS = new Set([
          'x', 'y', 'width', 'height', 'r', 'rx', 'ry',
          'cx', 'cy', 'x1', 'y1', 'x2', 'y2', 'points', 'd',
        ]);
        // §H10 P3 (Patch-Runde): PAINT-Attribut-Set — NUR diese Kanäle sind
        // beweisbar geometrie-neutral (reine Mal-Eigenschaften: Farbe/Tinte/
        // Deckkraft); clock-rooted SMIL darauf variiert die Tinte, NIE die bbox.
        // stroke-width: Judgment-Call PAINT — getBBox() (die Verdikt-Geometrie
        // dieses Systems) EXKLUDIERT den Stroke per Definition, eine
        // stroke-width-Animation lässt also jede bbox-Messung zeitinvariant;
        // der atmende Mal-Umfang ist Paint-Wahrheit (PAINT_TIME_VARIANT).
        const SMIL_PAINT_ATTRS = new Set([
          'fill', 'fill-opacity', 'opacity', 'stroke', 'stroke-opacity',
          'stroke-width', 'color', 'stop-color', 'stop-opacity',
          'flood-color', 'flood-opacity', 'lighting-color',
        ]);
        // §H10 P3 Routing-Trichotomie (statt der früheren Dichotomie „geometrisch
        // sonst Paint"): Geom-Attrs → Geom-Set · Paint-Attrs → Paint-Set ·
        // ALLES ÜBRIGE (class/style/visibility/href/filter/unbekannt) →
        // Geom-Set, KONSERVATIV-EHRLICH: eine animierte class/style KANN
        // Geometrie tragen (CSS width auf <rect> — bewiesener Leak: INSIDE-PASS
        // auf instabiler bbox) ⇒ volle Verdikt-Degradation (motion_dependent)
        // statt der Paint-Halbwahrheit paint_time_variant.
        function smilAnimSink(a) {
          const t = a.tagName.toLowerCase();
          if (t === 'animatetransform' || t === 'animatemotion')
            return smilTimeGeomTargets; // Transform-/Pfad-Bewegung IST Geometrie
          if (t === 'animatecolor') return smilTimePaintTargets; // reiner Paint
          const attr = String(a.getAttribute('attributeName') || '').trim();
          if (SMIL_GEOM_ATTRS.has(attr)) return smilTimeGeomTargets;
          if (SMIL_PAINT_ATTRS.has(attr)) return smilTimePaintTargets;
          return smilTimeGeomTargets; // Rest: Geometrie KANN variieren
        }
        // clock-rooted ⇔ begin-ATTRIBUT FEHLT GANZ (einzige Default-0s-Form in
        // Blink — leeres/whitespace-Attribut defaultet NICHT, GT empty_begin_gt)
        // ODER ≥1 Token wertet clock-rooted (Misch-Token-Unabhängigkeit via .some).
        function smilAnimIsClockRooted(a) {
          if (!a.hasAttribute('begin')) return true; // Attribut fehlt → 0s
          const toks = String(a.getAttribute('begin') || '')
            .split(';')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          return toks.some(clockRootedBeginToken);
        }
        // Ziel-Propagation EXAKT nach smilStateTargets-Muster (T3a, oben):
        // href#-Ziel ODER parentElement, + Nachfahren; danach use-Graph-Fixpunkt
        // (propagateUseGraph — die Verallgemeinerung desselben Musters): eine
        // <use>-Instanz einer zeit-varianten Definition ist selbst zeit-variant.
        // Mutiert NUR das eigene Set → STATE-/MEDIA-neutral; läuft NICHT in
        // MEASURE_STATIC_MEDIA_FN (Parity unberührt by construction).
        const smilTimeGeomTargets = new Set();
        // §H10 R11-06 PAINT-ZEIT-ACHSE: zweites Set über DIESELBE Maschinerie
        // (clock-rooted-Erkennung, Ziel-Propagation, use-Graph-Fixpunkt). Das
        // Geometrie-Gate delegierte Paint-SMIL an T1 — T1 ist getAnimations()-
        // basiert und dokumentiert SMIL-blind: clock-rooted SMIL auf Paint-
        // Kanälen (fill/opacity/…/animateColor) hatte KEINEN Eigentümer.
        // §H10 P3: hierher routen NUR noch die SMIL_PAINT_ATTRS (geometrie-
        // neutral bewiesen); alles Unklassifizierte fällt konservativ ins
        // Geom-Set (smilAnimSink, Achsen-Trennung: Geometrie-Zeit ≠ Paint-Zeit).
        const smilTimePaintTargets = new Set();
        for (const a of smilAnims) {
          if (!smilAnimIsClockRooted(a)) continue;
          const sink = smilAnimSink(a);
          // MIKRO-PATCH R2 (eng, konservativ): parentElement-Fallback NUR wenn
          // href/xlink:href FEHLT (SMIL-Default-Ziel). Ein VORHANDENES href,
          // das nicht '#id'-förmig oder nicht auflösbar ist ('#missing'),
          // zielt NICHT still auf den Parent — KEIN Ziel, KEIN Flag (sonst
          // Über-Flag auf Parent + alle Nachfahren).
          const hrefAttr =
            a.getAttribute('href') != null
              ? a.getAttribute('href')
              : a.getAttribute('xlink:href');
          let target = null;
          if (hrefAttr == null) target = a.parentElement;
          else if (hrefAttr.startsWith('#'))
            target = document.getElementById(hrefAttr.slice(1));
          if (!target) continue;
          sink.add(target);
          for (const d of target.querySelectorAll('*')) sink.add(d);
        }
        propagateUseGraph(smilTimeGeomTargets);
        propagateUseGraph(smilTimePaintTargets);

        // §HEAL-6 / F-AT-8-02 use-SHADOW-DETEKTION (D-024) — ERGEBNIS-
        // PROPAGATION, 4. Wiederholung des Propagations-Musters (T3a/I2/Heal-5).
        // Beide Self-or-Ancestor-Walks (isSelfOrAncestor3D Z.~1035,
        // isSelfOrAncestorNonSmilMotion Z.~1305) springen nie über die
        // use-Grenze (SVG2 §5.6: der Shadow-Subtree ist nicht im Light-DOM,
        // parentElement-Ketten enden im Licht-Baum) → eine use-Instanz eines
        // CSS/WAAPI-animierten oder 3D-transformierten Def-Subtrees blieb
        // 'reliable' OHNE Warnung — bei beweisbar instabiler Zahl (stille
        // Lüge; Boden-Wahrheit c5b3f9e: prozess-differierende reliable-Zahl
        // 121.33 vs 120). LÖSUNG: Detektor-Treffer des Def-LICHTBAUMS sammeln
        // und via propagateUseGraph-Fixpunkt (Z.3287, unverändert
        // wiederverwendet; DOM-Cap 500 via TOO_MANY_ELEMENTS-Guard Z.~2854 +
        // monotones Set-Wachstum → terminiert, use→use-Zyklus-sicher) auf die
        // Instanzen heben. NUR die MARKER-KNOTEN selbst in die Sets (Finishing
        // R1, Adversarial F1): eine Nachfahren-Aufnahme wäre ein ÜBER-FLAG —
        // <use href="#kind"> eines animierten/3D-Containers klont den
        // Container NICHT mit (SVG2 §5.6: geklont wird NUR der referenzierte
        // Subtree), die Instanz ist byte-stabil und MUSS reliable bleiben.
        // Nachfahren-Abdeckung kommt verlustfrei woanders her: Licht-DOM-
        // Nachfahren deckt der belassene Walk (OR-Term an den Call-Sites),
        // Def-interne Nachfahren deckt refInstantiatesInSet im Fixpunkt
        // (prüft ref UND ref-Nachfahren, Z.3288-3294). EMPIRIE (E1/E2,
        // an internal session artifact, je 2× stabil): getComputedStyle
        // am NICHT-gerenderten <symbol>-Kind liefert die RESOLVED matrix3d-/
        // matrix-Form (KEIN Keyword — 2D-rotate → 'matrix(…)' flaggt nie 3D)
        // und faithful animationName/PlayState/Duration auch für STYLESHEET-
        // Selektoren → die Scans nutzen EXAKT die Walk-Prädikate, kein
        // Keyword-Sonderpfad nötig. Für nicht-use-Pfade ist set.has(el) ⊆
        // Walk-Ergebnis (Marker-Knoten = Self-Treffer des Walks) → byte-
        // identisch by construction; NUR use-Instanzen kommen hinzu (OR-Terme
        // an den EINZIGEN Call-Sites unten). Mutiert NUR die eigenen Sets →
        // STATE-/MEDIA-/Heal-5-neutral; läuft NICHT in
        // MEASURE_STATIC_MEDIA_FN (Statik-Port-Parity unberührt by
        // construction; motionExcluded-Schwester separat im MEASURE_WALK_FN).
        const nonSmilMotionSet = new Set();
        const threeDSet = new Set();
        for (const n of all) {
          const ncs = getComputedStyle(n);
          if (nodeHasNonSmilMotion(ncs)) nonSmilMotionSet.add(n);
          const nt = ncs.transform || '';
          if (
            nt.includes('matrix3d(') ||
            nt.includes('perspective(') ||
            ncs.transformStyle === 'preserve-3d'
          )
            threeDSet.add(n);
        }
        propagateUseGraph(nonSmilMotionSet);
        propagateUseGraph(threeDSet);

        for (const el of all) {
          const tag = el.tagName.toLowerCase();
          if (SKIP_TAGS.has(tag)) continue;
          // §HEAL3 (ST-A): Phantom-Ausschluss — kategorisch, subtraktiv, schwellenwert-frei.
          // Kinder von Definitions-Containern malen NUR via Referenz-Instanz (SVG2 §5.6),
          // nie direkt. closest() matcht den QUALIFIZIERTEN Namen → clipPath MUSS camelCase
          // sein (NICHT clippath). pattern fehlt in SKIP_TAGS; clipPath/mask/marker sind
          // drin, ihre KINDER nicht — closest() deckt beide Lecks kategorisch ab.
          if (el.closest('defs,symbol,clipPath,mask,pattern,marker')) continue;

          const style = getComputedStyle(el);
          // §D5 G-FIX: state_dependent MUSS VOR die drei Invisibility-Skips berechnet
          // werden. Ein default display:none-Element, das per :hover/:target/SMIL-Event
          // SICHTBAR wird (Tooltip-Idiom), würde sonst still verschluckt = Kardinal-
          // false-silent (#h gar nicht emittiert, live). Reines Set-Lookup, kein matches.
          const state_dependent =
            smilStateTargets.has(el) || matchedStateElements.has(el);
          // §F-AT-6-09 / R6-MEDIA: dritte stille Achse — Viewport-Divergenz. Reines
          // Set-Lookup (kein matchMedia), orthogonal zu state_dependent (Achsen getrennt).
          // §HEAL F-AT-7-01 (I1): + element-lokaler vw/vh/vmin/vmax-Geometrie-OR
          // (authored-Scan, s. geomHasViewportUnit). Berührt das Set NICHT → STATE-
          // neutral + parity-frei by construction.
          const media_dependent =
            mediaDependentElements.has(el) || geomHasViewportUnit(el);
          // §HEAL-5 / Zeit-Achse: vierte stille Achse — zeit-variante GEOMETRIE
          // (clock-rooted SMIL). Reines Set-Lookup, orthogonal zu state/media
          // (Achsen getrennt; ein Misch-Token '0s;click' trägt BEIDE Flags, K2).
          // BEWUSST KEIN Einfluss auf den Invisibility-Skip unten (Emissions-
          // Menge byte-stabil — die t0-Wahrheit „unsichtbar" bleibt maßgeblich).
          const motion_dependent = smilTimeGeomTargets.has(el);
          // §H10 R11-06: fünfte stille Achse — zeit-variante PAINT-Eigenschaft
          // (clock-rooted SMIL auf fill/opacity/…). Reines Set-Lookup,
          // orthogonal zu motion_dependent (Geometrie-Zeit ≠ Paint-Zeit).
          // BEWUSST KEIN Einfluss auf den Invisibility-Skip (Emissions-Menge
          // byte-stabil — die t0-Wahrheit bleibt maßgeblich).
          const paint_time_variant = smilTimePaintTargets.has(el);
          // Leaf display:none / visibility:hidden / Vorfahr-display:none / permanent-0.
          const invisibleNow =
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            anyAncestorDisplayNone(el) ||
            permanentlyInvisible(el);
          // Unsichtbar UND NICHT zustands-abhängig → skippen (Emissions-Menge
          // byte-stabil) — aber NICHT mehr stumm (§H10 R11-01): die hier bereits
          // berechnete Wahrheit (Element existiert, css-unsichtbar @t0, Achse)
          // wandert ins Existenz-Register. KEIN nextAutoId-Aufruf (Zähler und
          // damit die Auto-ids der sichtbaren Elemente bleiben unberührt);
          // registriert wird nur, was der Emissions-Gate unten überhaupt
          // emittieren würde (Autor-id ODER Spotter-Tag).
          // Unsichtbar UND zustands-abhängig → NICHT skippen: fällt in den Hauptpfad
          // und wird ehrlich emittiert (echte 0×0-bbox bei display:none — getBBox()
          // ={0,0,0,0}, getScreenCTM()≠null, live; paint_visible:false; STATE_DEPENDENT).
          // §F-AT-6-09 additiv: ein NUR-bei-anderem-Viewport-sichtbares Element (@media
          // (min-width){#x{display:none}} matcht am Mess-Viewport → unsichtbar) darf
          // NICHT still verschluckt werden — es ist eine ZUSÄTZLICHE Viewport-Wahrheit.
          if (invisibleNow && !state_dependent && !media_dependent) {
            if (el.id || SPOTTER_SET.has(tag)) {
              hidden.push({
                id: el.id || null,
                tag,
                axis:
                  style.display === 'none' || anyAncestorDisplayNone(el)
                    ? 'display:none'
                    : style.visibility === 'hidden'
                      ? 'visibility:hidden'
                      : 'opacity:0',
              });
            }
            continue;
          }
          // composedOp = visuell wirksames Produkt (emittiertes opacity-Feld, §1c).
          const composedOp = composedOpacity(el);

          // §HEAL-R6 / T2 (F-AT-6-08 2/2): sanitize-induziertes Render-Zeit-Dangling.
          // EHRLICHES Signal über den bestehenden warnings[]-Pfad — KEINE Geometrie-
          // Degradierung (bbox_reliability bleibt unangetastet; die Geometrie des
          // referenzierenden Elements ist korrekt, nur seine referenz-abgeleitete
          // Eigenschaft Paint/Klon ist untreu). Pro Element EINMAL geprüft (style ist
          // der bereits hier vorliegende computed-style).
          const refDangling = referenceDangling(el, style);

          // §HEAL-R6 / T1 PAINT-PRESENCE (F-AT-6-01, CRIT, DoD-2). Der obige
          // Sichtbarkeits-Walk prüft opacity/display/visibility, NICHT fill-opacity/
          // stroke-opacity. Ein <rect fill="red" fill-opacity="0"> malt 0 Pixel, würde
          // aber als color:red, reliable, status:ok emittiert (die Lüge). KORREKTUR
          // rein statisch @t=0 (R9): die EFFEKTIVE Tinten-Alpha jedes Kanals ist
          // composedOpacity(el) × Kanal-Faktor (factorMaxPaint — permanenz-bewusst,
          // Keyframe-max=0 → permanent 0, EXAKT analog zur opacity-Blaupause). EXAKT-0,
          // KEIN epsilon (0<α<1 ist sichtbar = GEWOLLT, nur echte 0 ist Tinten-tot).
          //
          // BLIND-TRUST (Spec): bei painted===false NICHT still skippen, sondern das
          // Element EMITTIEREN mit paint_visible:false + Warning PAINT_NOT_VISIBLE.
          // Die Geometrie BLEIBT reliable (die bbox IST exakt — gemessen, nicht geraten).
          // Paint-Server (fill/stroke = url(#…) Gradient/Pattern) wird konservativ als
          // painted=true behandelt (lieber sichtbar als falsch-tot): die Tinte des
          // Servers ist nicht statisch aus computed-style ableitbar.
          // §HEAL-R6 / T1 Härtung #1 — COLOR-ALPHA. Die Sichtbarkeit hängt nicht nur an
          // fill-opacity, sondern auch an der ALPHA der aufgelösten Farbe selbst:
          // fill="transparent"/"rgba(...,0)"/currentColor→transparent malt 0 Pixel,
          // obwohl fill-opacity===1. getComputedStyle löst all das zu rgb()/rgba() auf
          // (transparent→rgba(0,0,0,0), currentColor→konkret). rgb(...) ohne Alpha =
          // opak = 1. parseColorAlpha liest die 4. Komponente robust; nicht-parsebar
          // (z.B. Paint-Server-String) → 1 (konservativ, nicht falsch-tot).
          const parseColorAlpha = (v) => {
            if (typeof v !== 'string') return 1;
            const m = v.match(
              /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+%?)\s*)?\)$/i,
            );
            if (!m) return 1; // rgb() ohne Alpha, url(...), oder unbekannt → opak.
            if (m[1] === undefined) return 1; // rgb()-Form ohne 4. Komponente.
            const a = m[1].endsWith('%')
              ? parseFloat(m[1]) / 100
              : parseFloat(m[1]);
            return Number.isFinite(a) ? a : 1;
          };
          const isPaintServer = (v) =>
            typeof v === 'string' && v.indexOf('url(') === 0;

          // §HEAL-R6 / T1 Härtung #2 — die Paint-Opacity (composedOpacity × paint-
          // opacity, permanenz-bewusst via chainMaxPaint) gated BEIDE Pfade (solid UND
          // Server). Die COLOR-Alpha gilt NUR für solide Farben — ein Paint-Server
          // liefert seine EIGENE Farbe (nicht statisch ableitbar) → konservativ als
          // farb-opak behandeln, aber die fill-opacity:0-Falle NICHT mehr kurzschließen.
          // fillPaintFactor/strokePaintFactor = der PERMANENZ-bewusste, VERERBUNGS-
          // bewusste Max-Faktor (chainMaxPaint, Härtung #4). DETERMINISTISCH (R9): bei
          // animiertem (auch geerbtem) Kanal der Keyframe-Max, NICHT der live mid-
          // animation computed Wert (CSS-Animationen laufen WEITER, nur SMIL ist
          // eingefroren — der rohe Live-Wert wäre frame-abhängig = R9-Bruch). Dient
          // zugleich als Diagnostik-Feld UND als Paint-Opacity-Gate.
          const fillPaintFactor = chainMaxPaint(el, 'fillOpacity', 'fill-opacity');
          const strokePaintFactor = chainMaxPaint(
            el,
            'strokeOpacity',
            'stroke-opacity',
          );
          const fillPaintOpacity = composedOp * fillPaintFactor;
          const strokePaintOpacity = composedOp * strokePaintFactor;
          const fillColorAlpha = isPaintServer(style.fill)
            ? 1
            : parseColorAlpha(style.fill);
          const strokeColorAlpha = isPaintServer(style.stroke)
            ? 1
            : parseColorAlpha(style.stroke);
          // EXAKT-0, kein epsilon. fill malt ⇔ fill≠'none' ∧ Paint-Opacity>0 ∧ Color-Alpha>0.
          const fillPaints =
            style.fill !== 'none' &&
            fillPaintOpacity > 0 &&
            fillColorAlpha > 0;
          // §HEAL-R6 / TEIL B — STROKE-DASHARRAY-UNSICHTBARKEIT (F-AT-6-06, DoD-2-Rest).
          // T1 prüft opacity/width/color-alpha, NICHT „dash rendert nichts". Ein
          // <path stroke-dasharray="0 1000" stroke-linecap="butt"> malt 0 sichtbare
          // Pixel (alle ON-Segmente 0-lang, butt-caps haben keine Ausdehnung).
          // SVG-Dash-Semantik: die Liste alterniert ON,OFF,ON,OFF…; ungerade Länge wird
          // verdoppelt → ON-Segmente an GERADEN Indizes. dashPaintsZero ⇔ ALLE
          // ON-Segmente exakt 0 UND linecap=butt. round/square caps zeichnen an
          // Null-Längen-Dashes PUNKTE/QUADRATE → SICHTBAR (NICHT tot). BLIND-TRUST:
          // bei mehrdeutigem/komplexem/fraktionalem dasharray (nicht sicher als 0
          // beweisbar) → KEINE Falsch-Tot-Behauptung, konservativ sichtbar lassen.
          const dashPaintsZero = (() => {
            const da = style.strokeDasharray;
            if (!da || da === 'none') return false; // kein dash → solider stroke.
            const cap = style.strokeLinecap || 'butt';
            if (cap !== 'butt') return false; // round/square → Punkte sichtbar.
            // computed strokeDasharray ist eine komma/space-getrennte px-Liste.
            const toks = da.split(/[\s,]+/).filter((t) => t.length > 0);
            if (toks.length === 0) return false;
            const nums = toks.map((t) => parseFloat(t));
            // Nicht-parsebar (NaN) → mehrdeutig → konservativ NICHT tot.
            if (nums.some((n) => !Number.isFinite(n))) return false;
            // negative Werte → invalid → der Browser ignoriert die ganze Liste
            // (solider stroke). Konservativ NICHT tot.
            if (nums.some((n) => n < 0)) return false;
            // SVG2-SONDERREGEL (Triple-Review #2): wenn die SUMME aller Werte 0 ist
            // (z.B. "0 0" — ALLE Werte 0, ON UND OFF), wird das dasharray IGNORIERT →
            // SOLIDE Linie → NICHT tot. Nur der gemischte Fall (ON=0, OFF>0, z.B.
            // "0 1000") bleibt korrekt tot. (sum===0 ⇔ alle Werte 0, da keine negativ.)
            const sum = nums.reduce((a, n) => a + n, 0);
            if (sum === 0) return false; // alle 0 → dasharray ignoriert → solide.
            // ungerade Länge → SVG verdoppelt die Liste (Phase erhalten).
            const seq = nums.length % 2 === 1 ? nums.concat(nums) : nums;
            // ON-Segmente an geraden Indizes. tot ⇔ ALLE ON-Segmente exakt 0.
            for (let i = 0; i < seq.length; i += 2) {
              if (seq[i] !== 0) return false; // ein ON-Segment > 0 → sichtbar.
            }
            return true; // alle ON-Segmente 0 (aber nicht alle OFF) + butt → 0 Pixel.
          })();
          // stroke malt ⇔ stroke≠'none' ∧ stroke-width≠0 ∧ Paint-Opacity>0 ∧ Color-Alpha>0
          // ∧ NICHT dash-tot (alle ON-Dashes 0 + butt-cap).
          const strokeW = parseFloat(getComputedStyle(el).strokeWidth);
          const strokePaints =
            style.stroke !== 'none' &&
            Number.isFinite(strokeW) &&
            strokeW !== 0 &&
            strokePaintOpacity > 0 &&
            strokeColorAlpha > 0 &&
            !dashPaintsZero;

          // §HEAL-R6 / T1 Härtung #3 — TAG-Anwendbarkeit. Das paint-DEAD-Urteil gilt
          // NUR für Tags, deren Sichtbarkeit WIRKLICH fill/stroke-getrieben ist (Formen
          // + Text). Für <image> (Raster — fill/stroke malen es nicht), Container
          // (<a>/<switch>/<g> — Sichtbarkeit = Kinder) und <use> (Instanz-Tinte in der
          // Referenz, hier nicht messbar) → KONSERVATIV painted=true (Blind-Trust:
          // nicht-fill-getrieben ≠ tot). So fällt der image-fill-opacity:0-False-Positive.
          const PAINT_DRIVEN_TAGS = new Set([
            'rect',
            'circle',
            'ellipse',
            'line',
            'polyline',
            'polygon',
            'path',
            'text',
            'tspan',
            'textpath',
          ]);
          // §HEAL-R6 / T2 MARKER ALS PAINT-KANAL (Triple-Review #3): ein Element mit
          // fill=none + stroke=none, aber marker-end=url(#m), malt sichtbare Tinte über
          // den Marker — fill/stroke sind NICHT die einzigen Paint-Kanäle. Sonst wäre
          // ein marker-only-Pfad fälschlich paint_visible:false. KONSERVATIV (Blind-
          // Trust: lieber sichtbar als falsch-tot): markerVisible ⇔ IRGENDEIN marker-*
          // löst zu einem existierenden <marker> auf, der renderbare Kinder hat. Die
          // Marker-Tinte selbst ist nicht statisch ableitbar (eigene fill/opacity) →
          // wir behaupten NIE Marker-tot, nur Marker-sichtbar (Über-Melden ⊂ Blind-Trust).
          const markerVisible = (() => {
            const refs = [
              style.markerStart,
              style.markerMid,
              style.markerEnd,
              style.marker,
            ].filter((v) => v && v !== 'none');
            for (const ref of refs) {
              const m = String(ref).match(/url\(["']?#([^"')]+)["']?\)/);
              if (!m) return true; // referenziert, nicht auflösbar → konservativ sichtbar.
              const mk = document.getElementById(m[1]);
              if (mk && mk.tagName.toLowerCase() === 'marker' && mk.children.length)
                return true;
            }
            return false;
          })();
          // §HEAL-R6 / T1: Basis-Tinten-Präsenz (Skalar-Kanäle). `let`, weil der EINE
          // räumliche maskDead-Schreiber (§HEAL-R6 Variante 1, B1/B3/B4, nach userM)
          // dieses Urteil zu false ODER 'indeterminate' graduieren darf — gespiegelt an
          // dashPaintsZero (ein zusätzlicher 0-Tinten-Zeuge im selben paintVisible-OR).
          let paintVisible = PAINT_DRIVEN_TAGS.has(tag)
            ? fillPaints || strokePaints || markerVisible
            : true;

          // 🔴 Codex7-FIX (false-tot) — FILTER-ERZEUGTER PAINT. Ein <filter> kann Tinte
          // GENERIEREN (feFlood/feImage/feTurbulence), die NICHT von fill/stroke/marker
          // abhängt. Ein paint-driven Element mit fill=none stroke=none (Basis-OR=false)
          // + so ein Filter MALT trotzdem → es ist NICHT tot. filterGeneratesPaint liest
          // den self/Vorfahr-Filter-Owner: 'alive' (reines feFlood-α>0, voll-Region) →
          // sichtbar (paintVisible=true, kein false-Feld); 'indeterminate' (generativ,
          // nicht beweisbar) → mindestens unbestimmt (NIE false-tot). NUR wenn die Basis
          // sonst false WÄRE (ein lebendiger fill/stroke bleibt unberührt). VOR dem
          // maskDead-Schreiber (die geometrische Pessimismus-Leiter darf das später
          // wieder zu false/indeterminate graduieren — B1 scale(0) dominiert korrekt).
          if (paintVisible === false) {
            const fHit = selfOrAncestorFilterOwner(el);
            if (fHit) {
              const gen = filterGeneratesPaint(fHit.filter);
              if (gen === 'alive') paintVisible = true;
              else if (gen === 'indeterminate') paintVisible = 'indeterminate';
            }
          }

          try {
            const localBBox = el.getBBox();

            // §HEAL-R6 / T2 MARKER-VOR-GATE (F-AT-6-03, DoD-3, R6-03-Wurzel). Die
            // Marker-Prüfung MUSS VOR das zero-bbox-Gate — sonst greift sie bei
            // zero-length-Trägern (x1==x2,y1==y2 mit marker-end: geom-bbox 0×0) NIE,
            // und die sichtbare Marker-Grafik verschwände still (NO_ELEMENTS). Marker
            // sitzen an den Vertices des Trägers, ihre Geometrie stammt NICHT vom
            // Träger selbst → eine 0×0-geom-bbox bedeutet NICHT 0 Tinte.
            const markerSrc = markerExtentSource(el, style, localBBox);
            // §HEAL-R6 / T2 GATE-VERSCHÄRFUNG (Spec): skip NUR, wenn geom UND stroke
            // UND marker leer sind. Vor-Gate-Nutzung von T1s strokePaints (stroke-
            // opacity:0 → kein stroke-overflow, keine Phantom-Kontur). Ein zero-length-
            // Träger mit sichtbarem Marker wird damit NICHT mehr geskippt.
            const geomEmpty = localBBox.width === 0 && localBBox.height === 0;
            // §H9 K-27a (S1-VOR-GATE): die S1-DISABLE-Klassifikation (§HEAL-ZA
            // unten) wird VOR dem geomEmpty-Gate berechnet — attributiv beweis-
            // bares Autor-0 (circle r=0, rect w=0&h=0, …) ist KEIN Phantom,
            // sondern Autor-Information und darf nicht spurlos verschwinden.
            // Siebte Durchlässigkeits-Klausel, exakt wie state/media/use-
            // Dangling; Emission läuft über die EXISTENTEN Schienen
            // (paint_visible:false + PAINT_NOT_VISIBLE, kein neues Feld).
            // Nicht-S1-geomEmpty (leeres <text>, <path d="">, kollabierte
            // Gruppenkinder) bleibt Status quo — dort fehlt der attributive
            // Autor-0-Beweis, Phantom-Risiko dominiert (F-AT-005/F-AT-2-006).
            // §P1-AUSNAHME (PS-Pick wörtlich: "dangling-Paint-0×0 bleibt
            // draussen"): ein 0×0-NICHT-use-Element mit dangelnder url(#)-Ref
            // bleibt geskippt — das Dangling existiert NUR im Strip-Fall, sein
            // Verlust ist via canvas_validity='lossy' bereits szenenweit laut
            // (Gate-Klausel unten: zaS1Dead && !refDangling).
            // M1: NUR computed-Lesart (getComputedStyle bzw. getBBox-Achse), NIE
            // .baseVal/Attribut — das Attribut lügt in BEIDE Richtungen (Attribut
            // 40 + CSS width:0px = falsch-lebendig A1a; Attribut 0 + CSS
            // width:40px = falsch-tot A1b). SMIL@frozen-t0 ist im computed-Wert
            // bereits reflektiert (A3: width 0→40 ⇒ "0px" @t0, empirisch).
            // M2: getComputedStyle liefert für FEHLENDE ellipse-Radien das
            // LITERAL 'auto' — eine ellipse OHNE rx malt via ry-Auflösung
            // (A4a: 1280 px), ist also NICHT 0! Je Tag substituieren: ellipse
            // rx↔ry (SVG2 shapes); rect/image/foreignObject auto⇒0 (SVG2-
            // Default; Chromium löst dort ohnehin zu px auf — defensiv).
            // parseFloat-NaN ist NIEMALS 0 (nicht-parsebar ⇒ konservativ
            // lebendig, kein Falsch-Tot).
            const zaZero = (v, autoSub) => {
              const n = parseFloat(v === 'auto' ? autoSub : v);
              return Number.isFinite(n) && n === 0;
            };
            // S1 DISABLE (SVG2 shapes/embedded: "a value of zero disables
            // rendering of the element" — killt ALLE Kanäle inkl. stroke/marker/
            // Filter, EINACHSIG genügt; Blink: SVGShapePainter::Paint →
            // IsShapeEmpty-Early-Return; GT: rect-w0+stroke und circle-r0+
            // stroke malen je 0 px, rect-w0+feFlood-Filter ebenfalls 0 px).
            // BEWUSST NICHT: <line> (zero-length bleibt laut via F-AT-7-02 —
            // round/square-caps malen Punkte) und nested-<svg> (SVG2 verlor
            // die 1.1-Disable-Klausel, w3c/svgwg#830).
            let zaS1Dead = false;
            if (tag === 'rect' || tag === 'foreignobject') {
              zaS1Dead = zaZero(style.width, '0') || zaZero(style.height, '0');
            } else if (tag === 'image') {
              // 🔴 R6-Patch: 'auto' NIEMALS zu 0 substituieren — SVG2 löst
              // image-auto zur INTRINSISCHEN Größe auf (GT: image OHNE
              // width-Attribut malt 1600 px). 'auto'⇒'auto' ⇒ parseFloat-NaN
              // ⇒ nie 0; NUR ein explizites computed "0px" flaggt.
              zaS1Dead =
                zaZero(style.width, 'auto') || zaZero(style.height, 'auto');
            } else if (tag === 'ellipse') {
              // 🔴 R7-Patch (Boden-Wahrheit 2026-06-10): BEIDE Radien literal
              // 'auto' ⇒ used value 0/0 ⇒ disabled (GT: 0 px, auch MIT
              // stroke). Sonst M2-Substitution rx↔ry (ein einzelnes auto
              // nimmt den anderen Radius — malt!).
              zaS1Dead =
                (style.rx === 'auto' && style.ry === 'auto') ||
                zaZero(style.rx, style.ry) ||
                zaZero(style.ry, style.rx);
            } else if (tag === 'circle') {
              zaS1Dead = zaZero(style.r, '0');
            }
            // §D5 G-FIX: das geomEmpty-Gate ist für state_dependent DURCHLÄSSIG —
            // ein default display:none-state-Element trägt eine echte 0×0-bbox
            // (geomEmpty=true), würde hier sonst erneut still verschluckt. Es fällt
            // mit der echten 0×0-bbox durch (crash-sicher: grid.js dereferenziert
            // el.bbox.x — NIEMALS bbox:null) und wird ehrlich emittiert.
            // §HEAL-R6 / T2 (F-AT-6-08 2/2): durchlässig für refDangling NUR bei
            // <use>-Instanzen. Ein dangelndes `<use href="#x">` klont NICHTS → seine
            // echte 0×0-bbox IST der kausale Fingerabdruck des Dangling (NO_ELEMENTS
            // statt ehrlicher Klon-Grafik). Es MUSS durchfallen, damit es unten mit
            // REFERENCE_DANGLING emittiert wird (lossless-or-loud).
            // §P1 0×0-PHANTOM-FIX: ein 0×0-NICHT-use-Element mit dangelnder url(#)-
            // Paint-Ref (z.B. `<rect width="0" height="0" fill="url(#stripped)"/>`)
            // rendert ohnehin NICHTS — seine Leere ist NICHT das Dangling-Symptom,
            // sondern Autor-Geometrie. Es wäre ein 0×0-Phantom (Phantom-Verdrängung
            // F-AT-005/F-AT-2-006) → skippen. Der Verlust bleibt szenenweit laut via
            // canvas_validity='lossy' (T1). Deshalb gilt die refDangling-Durchlässig-
            // keit nur, wenn das Element eine use-Instanz ist (tag === 'use').
            // §F-AT-6-09 additiv: media_dependent ebenso DURCHLÄSSIG — ein
            // media-bedingt-0×0/unsichtbares Element ist eine ZUSÄTZLICHE Viewport-
            // Wahrheit und muss ehrlich (echte 0×0-bbox) emittiert werden. Die
            // bestehenden refDangling-/state-Klauseln bleiben UNVERÄNDERT.
            if (
              geomEmpty &&
              !strokePaints &&
              !markerSrc.present &&
              !state_dependent &&
              !media_dependent &&
              !(refDangling && tag === 'use') &&
              // §H9 K-27a: S1-Autor-0 fällt durch — AUSSER es trägt eine
              // dangelnde Referenz (§P1-Ausnahme: dort bleibt der Skip, der
              // Verlust ist via canvas_validity='lossy' szenenweit laut).
              !(zaS1Dead && !refDangling)
            )
              continue;

            // §HEAL-ZA — ZeroPaintWitness (F-AT-7-05 + F-AT-7-12, Heal 3): 0 FLÄCHE
            // bei NICHT-0-Extent malt 0 Pixel, wurde aber als reliable + konkrete
            // Farbe + status:ok OHNE Flag emittiert (stille Lüge; Boden-Wahrheit:
            // probe-08-g6-zeroarea, SILENT_LIES_FOUND=[zw,zh,ze]). Organ-LÜCKE,
            // KEIN Gate-Bug: T1 oben prüft nur Paint-SKALARE; das geomEmpty-Gate
            // (AND, §D5 G-FIX — UNANGETASTET) skippt nur BEIDE-Achsen-0 — einachsig
            // degeneriert fällt zwischen beide Organe. Schwanz-A principle: attributiv
            // exakt ⇒ exakt paint_visible:false (NICHT 'indeterminate'). Emission +
            // Warning laufen über die EXISTENTEN Schienen (paint_visible-Feld +
            // PAINT_NOT_VISIBLE unten — kein Schema-Edit, kein Element verschwindet).
            // Die GEOMETRIE bleibt unberührt: bbox_reliability reliable, bbox exakt
            // (die FLÄCHE ist die Lüge, nicht der Extent). M3-Platzierung: NACH
            // getBBox, VOR der maskDead-Graduierung — false dominiert dort beid-
            // seitig ('indeterminate' überschreibt nur ===true; B1/scale(0) schreibt
            // idempotent false → KEINE Doppel-Warning, A5).
            {
              // S1 (rect/image/ellipse/circle/foreignObject) ist seit §H9 K-27a
              // VOR dem geomEmpty-Gate berechnet (zaS1Dead, M1/M2 dort) —
              // hier wiederverwendet, nicht neu gemessen.
              let zaDead = zaS1Dead;
              if (
                (tag === 'path' || tag === 'polygon' || tag === 'polyline') &&
                fillPaints &&
                !strokePaints &&
                !markerVisible
              ) {
                // S2 FILL-KANAL-TOD (konservativ): NUR wenn der fill der EINZIGE
                // Tinten-Kanal ist (M4 wörtlich: fillPaints && !strokePaints &&
                // !markerVisible; markerVisible bleibt vertex-blind = Residuum
                // F-AT-7-13, hier NICHT angefasst) UND die Fläche beweisbar
                // exakt 0 ist.
                // 🔴 R3-Patch: XOR statt OR — GENAU EINE 0-Achse. Beide-Achsen-0
                // ist geomEmpty-/STATE-/media-Domäne (display:none-state liefert
                // ein 0×0-bbox-ARTEFAKT bei echter Geometrie; ein echtes Autor-
                // 0×0 trägt Autor-Information und bleibt wie vor Heal 3) —
                // das bbox-Prädikat urteilt dort NICHT. path↔rect symmetrisch.
                zaDead =
                  (localBBox.width === 0) !== (localBBox.height === 0);
                if (!zaDead && tag !== 'path') {
                  // 🔴 R1-Patch: KOLLINEARITÄT statt signierter Shoelace. Die
                  // signierte Fläche Σ==0 beweist KEINE 0-Tinte: selbst-
                  // schneidende Bowtie-Polygone (z.B. 10,10 90,90 10,90 90,10)
                  // haben Σ exakt 0, malen aber real (GT: 3280 bzw. 1860 px —
                  // nonzero/evenodd füllen Teilflächen). Beweisbar 0 malt NUR
                  // die KOLLINEARE Punktmenge (inkl. 2-Punkt, F-AT-7-12):
                  // alle Kreuzprodukte (P_i−P_0)×(ref−P_0) EXAKT 0, KEINE
                  // Toleranz (M5: Float-Restfläche ⇒ kein Flag, leak-frei
                  // konservativ; Kurven-Fläche-0 von <path> bleibt bewusst
                  // ungeflaggt). animatedPoints = animVal @frozen-t0.
                  const zaPts = el.animatedPoints || el.points;
                  const zaN = zaPts ? zaPts.numberOfItems : 0;
                  if (zaN >= 2) {
                    const zaP0 = zaPts.getItem(0);
                    // Referenz-Richtung: erster Punkt ≠ P0 (Nullvektor-Schutz —
                    // identische Punkte spannen keine Richtung auf).
                    let zaRef = null;
                    for (let i = 1; i < zaN; i++) {
                      const p = zaPts.getItem(i);
                      if (p.x !== zaP0.x || p.y !== zaP0.y) {
                        zaRef = p;
                        break;
                      }
                    }
                    if (zaRef === null) {
                      zaDead = true; // ALLE Punkte identisch → Punkt → 0 Fläche.
                    } else {
                      let zaCollinear = true;
                      for (let i = 1; i < zaN; i++) {
                        const p = zaPts.getItem(i);
                        const zaCross =
                          (p.x - zaP0.x) * (zaRef.y - zaP0.y) -
                          (p.y - zaP0.y) * (zaRef.x - zaP0.x);
                        if (zaCross !== 0) {
                          zaCollinear = false;
                          break;
                        }
                      }
                      zaDead = zaCollinear;
                    }
                  }
                }
                // 🔴 R2-Patch: GENERATIV-FILTER-VETO (nur S2). Ein feFlood/
                // feImage/feTurbulence-Filter erzeugt Tinte UNABHÄNGIG vom
                // fill-Kanal (GT: 0-Extent-path + userSpaceOnUse-feFlood malt
                // 10000 px). Die existente Rettungsschiene (Codex7-Block oben)
                // läuft NUR bei T1-false — hier ist fillPaints=true ⇒ T1-true.
                // DIESELBE Erkennung konsultieren: generative Primitive present
                // (≠null: 'alive' ODER 'indeterminate') ⇒ KEIN ZA-false (0 ist
                // nicht beweisbar). NUR S2 — das S1-DISABLE killt auch den
                // Filter-Output (GT 0 px) und bleibt unkonditional. Lazy: der
                // Walk läuft nur, wenn das Flächen-Prädikat zuschlug.
                if (zaDead) {
                  const zaF = selfOrAncestorFilterOwner(el);
                  if (zaF && filterGeneratesPaint(zaF.filter) !== null) {
                    zaDead = false;
                  }
                }
              }
              // DER EINE Schreiber: beweisbar 0 gemalte Pixel ⇒ exakt false.
              // Überschreibt auch 'indeterminate' (ein S1-disabled Element
              // rendert NICHTS — auch keinen generativen Filter, dessen
              // objectBoundingBox-Region mit der 0-Achse kollabiert).
              if (zaDead) paintVisible = false;
            }

            // §1.2 3D-Detection: Pre-Gate vor CTM-Aufruf (Empirie R-1 — CTM nie null
            // bei 3D; Inspektion des CTM-Output ist unzureichend, Walk muss vorher laufen).
            // Treffer → bbox wird trotzdem (2D-projiziert) ausgeliefert, aber als
            // 'not_measurable' markiert + warnings.push('3D_TRANSFORM_ANCESTOR'),
            // damit Spotter keine Pixel-Deltas darauf berechnet.
            //
            // §1.4
            // 3-stellige Reliability-Klassifikation gemaess ADR-026 §6 + ADR-032 §Entscheidung.
            // Pessimismus-Prinzip: 'not_measurable' > 'approximate' > 'reliable'.
            //
            // Klassifikations-Regeln (jeweils begruendet):
            //   not_measurable:
            //     - isSelfOrAncestor3D(el): matrix3d/perspective/preserve-3d am Element
            //       SELBST ODER in einem Vorfahren → CTM-Projektion verliert Z-Komponente
            //       (ADR-026 §3 Tabelle; svgwg #302 — getScreenCTM kollabiert 3D still
            //       zu 2D-Affine, die bbox luegt). C2-FIX: Self-3D zaehlt wie Ancestor-3D.
            //   approximate:
            //     - 2D-CSS-transform vorhanden (style.transform !== 'none' und NICHT matrix3d):
            //       Browser kollabiert translate/rotate/scale auf matrix(a,b,c,d,e,f);
            //       Sub-Pixel-Drift via Float-Akkumulation ist dokumentiert (ADR-026 §1.2b
            //       chromium-normalisiert, kein cross-browser-Garantie). Auch trivial-
            //       identitaets-transforms (z.B. translate(0,0)) fallen hier rein —
            //       Konservative Klassifikation: jede CSS-transform-Manipulation triggert
            //       'approximate'. Konsumenten muessen das beim Pixel-Vergleich
            //       beruecksichtigen. Spec-Verfeinerung gegenueber BRIEFING Edit E
            //       (Andon-Cord #1 — Identitaets-Transform-Edge-Case Dokumentation; KEIN
            //       eigenstaendiger Scope-Bruch).
            //     §HEAL2: die frühere opacity-Grauzone (0.1<op<0.5 → approximate)
            //     ist GESTRICHEN. opacity verzerrt die bbox NICHT (anders als
            //     hasTransform-Float-Drift); opacity ist visuelle Salienz, NICHT
            //     Mess-Verlässlichkeit. Die komponierte, visuell wirksame opacity
            //     steht jetzt im `opacity`-Feld (Produkt über self+Ancestors) — der
            //     Konsument wendet seine EIGENE Schwelle an. Mehr Information, weniger
            //     Heuristik; bbox_reliability bleibt von opacity ENTKOPPELT.
            //   reliable:
            //     - alles andere (Default-Fall).
            // C2-FIX: Self-3D zaehlt wie Ancestor-3D (Walk startet beim Element selbst).
            // is3D dominiert die Klassifikation; die hasTransform-Klausel
            // (!matrix3d) wird nur im 2D-Zweig erreicht und ist dort korrekt — ein
            // genuiner 3D-Self-Transform hat is3D=true und nimmt nie den approximate-Pfad.
            // §HEAL-6 OR-Term: use-Shadow-3D via threeDSet (Ergebnis-
            // Propagation, s. Set-Scan oben) — der Walk bleibt unangetastet.
            const is3D = isSelfOrAncestor3D(el) || threeDSet.has(el);
            const hasTransform =
              style.transform !== 'none' &&
              !style.transform.includes('matrix3d(');

            // §S4/D2 Q5 (R2-FIX) — NICHT-DETERMINISTISCHE CSS-Motion ehrlich
            // degradieren (kein gelogener Frame). Der t=0-Freeze oben steuert
            // NUR SMIL; CSS-@keyframes/transition laufen WEITER und bewegen die
            // Geometrie zwischen Frames Scheduler-abhängig → die gemessene bbox
            // ist nicht reproduzierbar.
            // SELF-ODER-ANCESTOR-WALK (R2-FIX, symmetrisch zu is3D): die Motion
            // muss am Blatt ODER an irgendeinem Vorfahren erkannt werden, weil
            // Container-<g>/<symbol>/<marker> (SKIP_TAGS) ihren Transform via
            // userM in die Kind-Geometrie komponieren, aber selbst nie als
            // emittierendes Element inspiziert werden. Der Per-Knoten-Marker ist
            // gegen Über-Flaggen gehärtet (Komma-0s-Listen / animation-dur=0s /
            // play-state:paused = statisch → NICHT flaggen).
            // script/rAF wird hier NICHT erkannt — es ist durch S3 (FORBID
            // script) ELIMINIERT, nicht durch D2 gemessen (ehrlich benannt).
            // RESERVE (bewusst NICHT aktiv): el.getAnimations() würde Autor-WAAPI
            // erfassen, ist hier aber redundant — S3 strippt <script>, daher kann
            // kein Autor-JS WAAPI-Animationen erzeugen; der computed-style-Walk
            // ist die vollständige Quelle für CSS-Animation/Transition. Nicht als
            // allgemeine WAAPI-Erkennung überverkaufen.
            // §HEAL-6 OR-Term: use-Shadow-Motion via nonSmilMotionSet
            // (Ergebnis-Propagation, s. Set-Scan oben) — Walk unangetastet.
            const hasNonSmilMotion =
              isSelfOrAncestorNonSmilMotion(el) || nonSmilMotionSet.has(el);
            // §D5 / R6-STATE: state_dependent ist bereits oben (VOR den Invisibility-
            // Skips, G-FIX) berechnet — dieselbe const-Bindung wird hier (Feld) und im
            // Warning-Append genutzt. Reines Flag (orthogonal zu Motion/3D, KEIN
            // bbox_reliability-Degrade).

            let bbox_reliability;
            // Pessimismus-Reihenfolge: 3D ⊇ Non-Determinismus dominieren
            // 'approximate' dominieren 'reliable'. is3D behält Vorrang (eigene
            // 3D-Warnung); hasNonSmilMotion kollabiert ebenfalls auf
            // not_measurable, aber mit NON_DETERMINISTIC_MOTION-Warnung.
            if (is3D || hasNonSmilMotion) {
              bbox_reliability = 'not_measurable';
            } else if (hasTransform) {
              bbox_reliability = 'approximate';
            } else {
              bbox_reliability = 'reliable';
            }

            // C-01: 4-Point Projection — Sprint N2 PATH C (Koordinatenraum-Fix).
            // Statt el.getCTM() (element-user -> VIEWPORT, INKL. viewBox->viewport-
            // Skalierung + vbX/vbY-Offset -> bbox in Welt-px) projizieren wir mit der
            // Matrix element-user -> SVG-ROOT-USER-SPACE:
            //   userM = svg.getScreenCTM().inverse().multiply(el.getScreenCTM())
            // Beide screenCTMs teilen den svg->screen-Anteil (viewBox-Scale + vbX/vbY-
            // Origin); er kuerzt sich exakt heraus. Was bleibt: alle Element-/Ancestor-
            // Autor-Transforms (translate/scale/rotate/Scherung), als volle 2D-Affine —
            // daher korrekt auch bei Rotation/Scherung (anders als eine a/d/e/f-Kurzform).
            // getBBox() liefert bereits user-units; nur diese Matrix injizierte bisher
            // die viewBox-Skalierung. canvas.vbX/vbY bleibt der einzige Origin-Traeger
            // (grid.js subtrahiert ihn) -> Downstream unveraendert korrekt.
            //
            // Guard: getScreenCTM() kann null sein, wenn ein Element nicht gerendert
            // ist (display:none ist bereits oben gefiltert; defensiv hier dennoch, da
            // visibility:hidden / nicht-im-Render-Tree ebenfalls null liefern kann).
            // Beide null-Faelle -> skip (analog zum frueheren 'if (!ctm) continue').
            const svgScreenCTM = svg.getScreenCTM();
            const elScreenCTM = el.getScreenCTM();
            if (!svgScreenCTM || !elScreenCTM) continue;
            const userM = svgScreenCTM.inverse().multiply(elScreenCTM);

            const pt = svg.createSVGPoint();
            const corners = [
              { x: localBBox.x, y: localBBox.y },
              { x: localBBox.x + localBBox.width, y: localBBox.y },
              { x: localBBox.x, y: localBBox.y + localBBox.height },
              {
                x: localBBox.x + localBBox.width,
                y: localBBox.y + localBBox.height,
              },
            ].map((p) => {
              pt.x = p.x;
              pt.y = p.y;
              return pt.matrixTransform(userM);
            });

            const xmin = Math.min(...corners.map((p) => p.x));
            const ymin = Math.min(...corners.map((p) => p.y));
            const xmax = Math.max(...corners.map((p) => p.x));
            const ymax = Math.max(...corners.map((p) => p.y));

            // §HEAL-R6 Variante 1 (F-AT-6-07, DoD-2-Schwanz) — DER EINE maskDead-
            // SCHREIBER. Räumliche Masken-Operatoren löschen Tinte, die kein Skalar-
            // Faktor (T1/T2) sieht. RASTER-FREI (R9): rein attributiv/CTM @t=0, KEIN
            // getImageData, KEIN Sub-Render. Pessimismus-Leiter (Reihenfolge-Invariante
            // iii): beweisbar-tot ≻ unbestimmt ≻ default-sichtbar. Steht VOR der Filter-
            // Replacement-Logik unten (Reihenfolge-Invariante i: clip-dead dominiert, 0∩x=0).
            //
            // 🔴 Codex9-FIX — ANWENDBARKEITS-SPLIT. B1 (CTM-Determinante) UND B3 (Viewport-
            // Clip) sind REIN GEOMETRISCH (Transform/Position) und gelten für JEDES
            // transformierbare, geometrisch gemessene Element — auch <use>/<image>
            // (scale(0)-<use> ist genauso unsichtbar wie scale(0)-<rect>). Der V2-Per-
            // Operator-Walk (fill/stroke=mask/clip/filter/gradient) bleibt auf PAINT_
            // DRIVEN_TAGS (die fill/stroke-getriebene Tinte; <use>/<image> tragen ihre
            // Tinte in der Referenz/im Raster — dort nicht billig klassifizierbar).
            const isPaintDriven = PAINT_DRIVEN_TAGS.has(tag);
            const isTransformable =
              isPaintDriven || tag === 'use' || tag === 'image';
            let maskDead = null; // null | 'dead' | 'indeterminate'.
            if (isTransformable) {
              // B1 — CTM-Determinante. getBBox ist transform-blind; ein scale(0) (am
              // Element ODER an einem Vorfahren) kollabiert die userM-Affine auf eine
              // Linie/Punkt → 0 Fläche → 0 Tinte. det ist der EINZIGE Zeuge (das
              // geomEmpty-Gate sieht ihn NICHT). det===0 ∧ endlich → beweisbar tot;
              // nicht-endlich (NaN/∞ aus exotischer Matrix) → ehrlich unbestimmt.
              const det = userM.a * userM.d - userM.b * userM.c;
              if (Number.isFinite(det)) {
                if (det === 0) maskDead = 'dead';
              } else {
                maskDead = 'indeterminate';
              }
              // B3 — Vorfahr-Viewport-Clip. Welt-bbox (xmin..ymax, ROOT-user-space) ∩
              // Root-Viewport (vbX..vbX+width / vbY..vbY+height) LEER ⇒ jede Tinte fällt
              // außerhalb des clippenden Viewports → 0 sichtbare Pixel. NUR beweisbar,
              // wenn der Clip BEWEISBAR das Root-VP-Rechteck ist (vpSafe='root'); ein
              // nested-<svg>/<symbol> oder overflow:visible-Vorfahr hebt die Beweisbar-
              // keit auf → 'indeterminate' statt false. STRIKT nach B1 (B1-tot dominiert).
              if (maskDead === null) {
                const rootEmpty =
                  xmax <= canvas.vbX ||
                  xmin >= canvas.vbX + canvas.width ||
                  ymax <= canvas.vbY ||
                  ymin >= canvas.vbY + canvas.height;
                if (rootEmpty) {
                  const vpState = ancestorViewportClipState(el);
                  maskDead = vpState === 'root' ? 'dead' : 'indeterminate';
                }
              }
              // §HEAL-R6 V2 — B3-NESTED-FIX. B3-root oben sieht nur den Root-Viewport.
              // Ein Element INNERHALB des Root-VP, aber AUSSERHALB eines verschachtelten
              // <svg overflow:hidden>, wird von B3-root NICHT erfasst (rootEmpty=false)
              // → V1 meldete es als sichtbar (kein Feld = Lüge). nestedViewportClipsOut
              // testet die Element-Welt-bbox gegen jedes nested-<svg>-VP-Rechteck;
              // disjunkt → 'indeterminate' (NIE bare-visible, NIE false). STRIKT nach
              // B1/B3-root (beweisbar-tot dominiert). Vor dem Per-Operator-Walk (beide
              // 'indeterminate', Ordnung harmlos).
              if (maskDead === null) {
                if (
                  nestedViewportClipsOut(
                    el,
                    xmin,
                    ymin,
                    xmax,
                    ymax,
                    svgScreenCTM,
                    pt,
                  )
                ) {
                  maskDead = 'indeterminate';
                }
              }
              // §HEAL-R6 V2-PHASE-1 — PER-OPERATOR-WALK (ersetzt die V1-B4-Pauschale).
              // Statt JEDEN present-Operator pauschal zu 'indeterminate' zu flaggen
              // (Rauschen auf tinten-reichen SVGs), klassifiziert classifySpatialMask-
              // Chain jeden present-Operator (filter/clip/mask/gradient, self+Vorfahr)
              // 3-wertig und faltet: irgendein dead⇒dead; sonst irgendein indeterminate
              // ⇒indeterminate; sonst alle alive⇒'alive'. 'alive' (normaler Blur/Schatten
              // /Luminanz-Maske weiß/Gradient sichtbar/clip voll-deckend) heilt das
              // Rauschen → KEIN Eingriff (maskDead bleibt null, kein paint_visible-Feld).
              // Phase 1 erzeugt KEIN 'dead' (keine DEAD-Regeln) — jeder nicht-alive
              // Operator kontaminiert die Kette → 'indeterminate' (V1-Fallback, monoton
              // pessimistisch: NIE falsch-sichtbar). KEIN Sub-Render, KEIN Pixel (R9).
              // NUR PAINT_DRIVEN_TAGS (Codex9-Split): <use>/<image> tragen ihre Tinte in
              // der Referenz/im Raster — der fill/stroke-getriebene Walk gilt dort nicht.
              if (maskDead === null && isPaintDriven) {
                const chain = classifySpatialMaskChain(el, localBBox);
                // chain ∈ {null, 'alive', 'indeterminate'} (Phase 1 nie 'dead').
                // null/'alive' → kein Eingriff; 'indeterminate' → V1-Fallback.
                if (chain === 'indeterminate') maskDead = 'indeterminate';
              }
            }
            // EINE Faltung in paintVisible (Spiegel dashPaintsZero im selben OR):
            //   maskDead==='dead'          → paint_visible:false (beweisbar 0 Tinte).
            //   maskDead==='indeterminate' → paint_visible:'indeterminate' (NUR wenn der
            //     Basis-OR sonst sichtbar wäre — ein bereits tinten-toter Skalar-Kanal
            //     bleibt false, false dominiert; ehrlich-tot ≻ unbestimmt).
            if (maskDead === 'dead') {
              paintVisible = false;
            } else if (maskDead === 'indeterminate' && paintVisible === true) {
              paintVisible = 'indeterminate';
            }

            // §HEAL-R6 / T2 PAINT-EXTENT-AGGREGATOR (F-AT-004 + F-AT-6-02/03, DoD-3):
            // die geom-bbox oben (xmin..ymax) ist exakt (Geometrie), ABER blind für
            // Tinte außerhalb: <filter> (Glow/Schatten), stroke-Outset, Marker.
            // bbox_reliability BLEIBT 'reliable' (die Geometrie IST exakt; DoD-3:
            // reliable + Flag ist erlaubt). Die EHRLICHKEIT trägt has_paint_overflow
            // + visual_bbox. EIN Schreiber schreibt BEIDE Felder GENAU EINMAL (löst den
            // visual_bbox-Clobber: ein einziger Schreiber statt mehrerer).
            //
            // ExtentSource-Vertrag {present, exceeds, corners|null}:
            //   present  : trägt diese Quelle potenziell Tinte über die geom-bbox?
            //              present===true ⇒ has_paint_overflow=true (Flag unter-meldet NIE).
            //   corners  : Array[4] ROOT-user-space-Eckpunkte einer beweisbar sicheren
            //              oberen Schranke, ODER null (not_measurable → Zahl zurückhalten).
            //
            // FILTER IST REPLACEMENT, NICHT UNION-QUELLE (Triple-Review #4): ein <filter>
            // nimmt die GESAMTE gemalte Ausgabe (fill + stroke + Marker) als INPUT und
            // clippt sie HART auf die Filter-Region ("hard clipping region", Filter
            // Effects L1 §8). Die sichtbare Tinte ist damit ⊆ Region — auch bei einem
            // INWARD-Filter (Region < geom). Daher: Filter present + messbare Region →
            // extent = Filter-Region ALLEIN (KEIN Union mit geom/stroke/marker, das
            // würde inward-Filter über-reporten). Kein/unmessbarer Filter → Union(geom-
            // fill, stroke, marker). Im normalen Outward-Filter (Region ⊇ geom) ist
            // Region-allein == Union(geom, Region) → E4 byte-identisch (Schutz).
            let has_paint_overflow;
            let visual_bbox;
            let anyPresent = false; // ⇒ has_paint_overflow.

            // (E-1) FILTER-ExtentSource — der bestehende §E4-Block. KOLLAPS-REGEL (Codex
            // NO-GO #2): NUMERISCHE Region NUR im provably-sicheren sauberen Einzelfilter-
            // Fall; das Flag (anyPresent) wird gesetzt, sobald IRGENDEIN Filter da ist.
            //   (a) GENAU EIN Filter entlang self+Vorfahren (count===1).
            //   (b) GENAU EIN sauberes url(#id)→<filter> OHNE href/xlink:href.
            //   (c) KEIN verschachteltes <svg>/<symbol>-Viewport (Owner selbst + Grenze).
            //   (d) objectBoundingBox ODER voll-explizites userSpaceOnUse im Root-VP.
            // HIGH-#1: Region aus owner.getBBox() + owner-userM (Gruppen-Filter).
            const filterHit = selfOrAncestorFilterOwner(el);
            let filterRegionCorners = null; // ROOT-Ecken der Filter-Region ODER null.
            if (filterHit) {
              anyPresent = true; // (Flag) IRGENDEIN Filter → potenzielle Tinte.
              const owner = filterHit.owner;
              const singleFilter = filterHit.count === 1;
              const filterTarget = singleFilter
                ? resolveFilterElement(filterHit.filter)
                : 'not_measurable';
              const ownerScreenCTM = owner.getScreenCTM
                ? owner.getScreenCTM()
                : null;
              let vpSafe = true;
              const ownerTag = owner.tagName ? owner.tagName.toLowerCase() : '';
              if (owner !== svg && (ownerTag === 'svg' || ownerTag === 'symbol')) {
                vpSafe = false; // nested-<svg>-Owner (Round-2-Lücke a!==owner)
              }
              for (let a = owner; a && a !== svg; a = a.parentElement) {
                const at = a.tagName ? a.tagName.toLowerCase() : '';
                if (a !== owner && (at === 'svg' || at === 'symbol')) {
                  vpSafe = false;
                  break;
                }
              }
              let region = 'not_measurable';
              if (filterTarget !== 'not_measurable' && ownerScreenCTM && vpSafe) {
                let ownerBBox = null;
                try {
                  ownerBBox = owner.getBBox();
                } catch {
                  ownerBBox = null;
                }
                if (ownerBBox) {
                  region = filterRegionLocal(
                    filterTarget,
                    ownerBBox,
                    canvas.width,
                    canvas.height,
                    vpSafe,
                  );
                }
              }
              if (Array.isArray(region)) {
                const ownerM = svgScreenCTM.inverse().multiply(ownerScreenCTM);
                filterRegionCorners = region.map((p) => {
                  pt.x = p.x;
                  pt.y = p.y;
                  return pt.matrixTransform(ownerM);
                });
              }
            }

            // (E-2) STROKE-ExtentSource — analytischer Outset (stroke-width/2 ×Faktor)
            // in LOKALEN Element-Ecken, via userM nach ROOT projiziert. T1s strokePaints
            // ist das Vor-Gate (stroke-opacity:0 / dash-tot → kein Outset).
            const strokeSrc = strokeExtentSource(
              el,
              style,
              localBBox,
              strokePaints,
              strokeW,
            );

            // (E-∪) EIN Schreiber. Filter dominiert (Replacement-Semantik): liegt ein
            // Filter vor → der Output ist auf die Filter-Region geclippt; sonst Union
            // aus geom-fill + stroke + marker.
            if (anyPresent || strokeSrc.present || markerSrc.present) {
              has_paint_overflow = true; // Flag unter-meldet NIE.
              if (filterHit) {
                anyPresent = true;
                // Filter clippt ALLES auf seine Region. Messbar → Region allein;
                // unmessbar → Zahl zurückhalten (Flag bleibt true).
                if (filterRegionCorners) {
                  const vxmin = Math.min(...filterRegionCorners.map((p) => p.x));
                  const vymin = Math.min(...filterRegionCorners.map((p) => p.y));
                  const vxmax = Math.max(...filterRegionCorners.map((p) => p.x));
                  const vymax = Math.max(...filterRegionCorners.map((p) => p.y));
                  visual_bbox = {
                    x: vxmin,
                    y: vymin,
                    w: vxmax - vxmin,
                    h: vymax - vymin,
                  };
                } else {
                  visual_bbox = 'not_measurable';
                }
              } else {
                // KEIN Filter → Union(geom-fill, stroke, marker). Eine unmessbare
                // present-Quelle (corners===null) macht die ZAHL unsicher → Sentinel.
                const extentCorners = corners.slice();
                let anyUnmeasurable = false;
                if (strokeSrc.present) {
                  if (strokeSrc.corners) {
                    for (const p of strokeSrc.corners) {
                      pt.x = p.x;
                      pt.y = p.y;
                      extentCorners.push(pt.matrixTransform(userM));
                    }
                  } else {
                    anyUnmeasurable = true; // non-scaling-stroke o.ä.
                  }
                }
                if (markerSrc.present) {
                  if (markerSrc.corners) {
                    for (const p of markerSrc.corners) {
                      pt.x = p.x;
                      pt.y = p.y;
                      extentCorners.push(pt.matrixTransform(userM));
                    }
                  } else {
                    anyUnmeasurable = true; // overflow:visible / viewBox-Marker.
                  }
                }
                if (anyUnmeasurable) {
                  visual_bbox = 'not_measurable';
                } else {
                  const vxmin = Math.min(...extentCorners.map((p) => p.x));
                  const vymin = Math.min(...extentCorners.map((p) => p.y));
                  const vxmax = Math.max(...extentCorners.map((p) => p.x));
                  const vymax = Math.max(...extentCorners.map((p) => p.y));
                  visual_bbox = {
                    x: vxmin,
                    y: vymin,
                    w: vxmax - vxmin,
                    h: vymax - vymin,
                  };
                }
              }
            }

            // §D5 C1 CROSS-AXIS-KONSISTENZ: ein paint_visible:false-Element (z.B. ein
            // G-FIX-emittiertes display:none-state-Element) malt @t=0 NICHTS — ein
            // gleichzeitiges has_paint_overflow:true (stroke-outset) wäre ein
            // Widerspruch (unsichtbar kann nicht über-malen). Tinten-tot dominiert →
            // Overflow-Achse unterdrücken (Flag false, Zahl weg). Reine Konsistenz,
            // kein Achsen-Clobber (paint_visible bleibt die führende Wahrheit).
            if (paintVisible === false) {
              has_paint_overflow = undefined;
              visual_bbox = undefined;
            }

            // §1.3 LAYER-TRENNUNG (Patch2): Auto-ID-Allowlist-Gate. Wenn weder
            // el.id noch ein zulaessiger Spotter-Tag → Element ueberspringen
            // (Format-Versprechen mechanisch). Aequivalent zu einer dynamischen
            // Erweiterung von SKIP_TAGS um nicht-Spotter-Tags.
            const autoId = el.id || nextAutoId(tag);
            if (autoId === null) continue;
            const isUse = tag === 'use';
            // §F-AT-7-02 STILLE STROKE-FARB-LÜGE (Heilung) — die EINE `color`-
            // Projektion (grid.js) ist heute fill-only: ein nur-stroke-sichtbares
            // Element (z.B. <line stroke=red>, <circle fill=none stroke=red>) meldet
            // `color:transparent/black` + reliable + KEIN Flag, obwohl es sichtbar
            // ROT malt. Hier wird gemessen, OB der fill überhaupt eine sichtbare
            // Farbe BEITRÄGT — tag-bewusst UND sichtbarkeits-bewusst — und welche
            // Quelle die sichtbare Farbe trägt. KEIN Schema-Feld; das interne
            // visible_color_source-Feld treibt grid.js, die Warnings transportieren
            // das Signal über die bestehende warnings[]-Schiene (truncated_warnings/Prosa).
            //
            // SK1 — fillContributesVisibleColor: fill trägt NUR bei, wenn (a) der Tag
            // FÜLLBAR ist UND (b) der fill sichtbar malt (fillPaints deckt bereits
            // fill=none / fill-opacity:0 / paint-server-opacity:0 / color-alpha:0 ab —
            // KEIN !isPaintServer-Shortcut, ein url(#g) fill-opacity:0 hat fillPaints=
            // false und trägt damit korrekt NICHT bei). <line> ist NICHT füllbar
            // (Browser ignoriert fill auf <line> vollständig). <polyline> IST füllbar
            // (empirisch verifiziert: offene polyline füllt die Fläche zur impliziten
            // Schließkante — /tmp/pl_measure/probe-polyline-fill.mjs) → wie ein
            // Flächen-Element behandelt. <use> ist hier nicht messbar (Instanz-Tinte
            // in der Referenz) und wird unten via !isUse ausgenommen (bleibt indeterminate).
            const FILLABLE_TAGS = new Set([
              'rect',
              'circle',
              'ellipse',
              'polyline',
              'polygon',
              'path',
              'text',
              'tspan',
              'textpath',
            ]);
            const fillContributesVisibleColor =
              FILLABLE_TAGS.has(tag) && fillPaints;
            // SK2 — die Quelle der sichtbaren Farbe (nach strokePaints; <use> ausgenommen):
            //   colorFromStroke      ⇔ fill trägt NICHT bei ∧ stroke malt sichtbar
            //                          → die EINE sichtbare Farbe IST die stroke-Farbe.
            //   multiplePaintSources ⇔ fill UND stroke tragen beide sichtbar bei
            //                          → „eine Farbe" wäre ein Urteil, keine Messung;
            //                            das Auge meldet n>1 Quellen (Visions-Gate).
            // Disjunkt (fillContributesVisibleColor schließt sich aus); <use> nie beides.
            const colorFromStroke =
              !isUse && !fillContributesVisibleColor && strokePaints;
            const multiplePaintSources =
              !isUse && fillContributesVisibleColor && strokePaints;
            // SK3 — internes Renderer-Feld treibt grid.js (KEIN Schema-Feld, true-only-
            // Negativ-Kontrolle: ein gewöhnliches fill-Element trägt es NICHT).
            const visibleColorSource = colorFromStroke
              ? 'stroke'
              : multiplePaintSources
                ? 'multiple'
                : undefined;
            const pushed = {
              // §1.3 Auto-ID: explizite SVG-id bleibt unveraendert; ohne id
              // → content-addressed Auto-ID via Hash-Praefix + tag-Counter.
              id: autoId,
              tag: tag,
              bbox: { x: xmin, y: ymin, w: xmax - xmin, h: ymax - ymin },
              // §HEAL3b: use-Instanz-Farbe ist NICHT messbar (instanceRoot=undefined,
              // shadowRoot=null, elementFromPoint→<use> selbst; Beleg: _verify_heal3b_shadow_access.mjs).
              // getComputedStyle(useEl).fill liest den leeren <use>-Wrapper (→ 'black'-Lüge).
              // Raten aus use-fill/Licht-DOM-Blatt wäre eine NEUE Lüge (override/inherit). Ehrlich = indeterminate.
              fill: isUse ? 'indeterminate' : style.fill,
              stroke: isUse ? 'indeterminate' : style.stroke,
              opacity: composedOp,
              textContent:
                tag === 'text' || tag === 'tspan'
                  ? el.textContent?.trim()?.substring(0, 50)
                  : null,
              // §1.5 Block D: Parent-Kontext. Für tspan/textPath braucht der
              // §1.5-Fix den Eltern-<text>, weil tspans natives dx/dy RELATIV zur
              // Text-Position wirkt (R-C). Generisch für alle Elemente harmlos
              // (null, wenn kein Element-Parent oder Parent ohne id). Werte sind
              // Strings|null; elementSchema trägt parent_id/parent_tag .optional().
              parent_id: el.parentElement?.id || null,
              parent_tag: el.parentElement?.tagName?.toLowerCase() || null,
              // §1.5 Block H / Patch P1 (F-2): AUTOR-transform-Attribut surfacen,
              // damit der Transform-Fallback (buildTransformFix) es als `current`
              // erhält und prependTranslate den Autor-scale/rotate NICHT überschreibt.
              // Reines getAttribute (KEIN getComputedStyle) — beeinflusst weder
              // 3D-Detection noch bbox_reliability (die laufen auf style.transform).
              // undefined wenn kein Attribut → elementSchema.transform ist optional.
              transform: el.getAttribute('transform') || undefined,
              // §1.5 Block H / Patch P2: tspans existierendes dx-Attribut surfacen
              // (Skalar-Erstwert), damit der relative Shift RELATIV zum bestehenden
              // dx wirkt statt es zu überschreiben. Nur für tspan/textPath sinnvoll;
              // undefined sonst. emitter parst den ersten numerischen Token.
              ...(tag === 'tspan' || tag === 'textpath'
                ? { native_dx: el.getAttribute('dx') || undefined }
                : {}),
              bbox_reliability,
              // §E4: Paint-Extent-Ehrlichkeit (F-AT-004). Nur emittiert, wenn ein
              // Filter (self/Vorfahr) vorliegt — ein filterloses Element trägt
              // WEDER has_paint_overflow NOCH visual_bbox (Negativ-Kontrolle: der
              // Schnitt ist filter-spezifisch, kein Over-Flag). visual_bbox ist
              // entweder die {x,y,w,h}-Region-Hülle ODER das Literal 'not_measurable'.
              ...(has_paint_overflow !== undefined ? { has_paint_overflow } : {}),
              ...(visual_bbox !== undefined ? { visual_bbox } : {}),
              // §HEAL-R6 / T1 (F-AT-6-01): Tinten-Faktoren + Paint-Presence.
              // fill_paint_factor/stroke_paint_factor sind die effektiven self-Kanal-
              // Alpha-Faktoren @t=0 (Diagnostik). NIT (beide Reviewer): NUR emittieren
              // wenn < 1 (echte Modulation = Info) — bei ==1 weglassen (Output-Spam +
              // Golden-Regressions-Risiko). paint_visible (false | 'indeterminate')
              // bleibt das load-bearing Signal; ein normal gemaltes Element (paintVisible
              // ===true) trägt KEINS der drei Felder (Negativ-Kontrolle). Geometrie
              // bleibt reliable (Blind-Trust: nur die Tinten-Behauptung graduiert).
              ...(fillPaintFactor < 1
                ? { fill_paint_factor: fillPaintFactor }
                : {}),
              ...(strokePaintFactor < 1
                ? { stroke_paint_factor: strokePaintFactor }
                : {}),
              ...(paintVisible !== true ? { paint_visible: paintVisible } : {}),
              // §D5 / R6-STATE: true-only Negativ-Kontrolle — statische Elemente
              // (KEINE interaktiven Pseudos / SMIL-Event-Token) tragen das Feld NICHT.
              ...(state_dependent ? { state_dependent: true } : {}),
              // §F-AT-6-09 / R6-MEDIA: true-only — nur Elemente, die ein Viewport-
              // abhängiges @media trifft, tragen das Feld (sonst weggelassen).
              ...(media_dependent ? { media_dependent: true } : {}),
              // §HEAL-5 / Zeit-Achse: true-only — nur Ziele clock-rooted
              // SMIL-GEOMETRIE tragen das Feld (sonst weggelassen; statische,
              // Event-SMIL- und Paint-SMIL-Elemente bleiben byte-identisch).
              ...(motion_dependent ? { motion_dependent: true } : {}),
              // §H10 R11-06 / Paint-Zeit-Achse: true-only — nur Ziele clock-
              // rooted SMIL auf NICHT-Geometrie-Kanälen (fill/opacity/…)
              // tragen das Feld (sonst weggelassen; Negativ-Kontrolle:
              // statische + Geometrie-SMIL-Elemente byte-identisch).
              ...(paint_time_variant ? { paint_time_variant: true } : {}),
              // §F-AT-7-02 (SK3): internes Quellen-Feld der sichtbaren Farbe. KEIN
              // Schema-Feld (color bleibt z.string()) — es treibt nur die grid.js-
              // color-Projektion (stroke-Farbe statt fill bei 'stroke') + die Prosa-
              // Note. true-only-Negativ-Kontrolle: ein gewöhnliches fill-Element
              // (visibleColorSource===undefined) trägt es NICHT.
              ...(visibleColorSource
                ? { visible_color_source: visibleColorSource }
                : {}),
            };
            // §S4/D2 Q5: Warnungen entsprechend der not_measurable-Ursache(n).
            // 3D und Non-SMIL-Motion sind ORTHOGONAL — ein Element kann beides
            // tragen (z.B. CSS-Animation auf einem 3D-Vorfahr); dann beide
            // Warnungen ehrlich melden (Reihenfolge 3D vor Motion, stabil).
            if (is3D || hasNonSmilMotion) {
              const reasons = [];
              if (is3D) reasons.push('3D_TRANSFORM_ANCESTOR');
              if (hasNonSmilMotion) reasons.push('NON_DETERMINISTIC_MOTION');
              pushed.warnings = reasons;
            } else if (bbox_reliability === 'approximate') {
              // §1.4
              // §HEAL2: Opacity-Grauzone GESTRICHEN (opacity ≠ Geometrie; die
              // komponierte opacity steht im `opacity`-Feld, Konsumenten nutzen
              // ihre eigene Schwelle). approximate hängt nur noch an hasTransform.
              const reasons = [];
              if (hasTransform) reasons.push('CSS_TRANSFORM_2D_FLOAT_DRIFT');
              pushed.warnings = reasons;
            }
            // §HEAL3b: Farb-Unbestimmtheit ist ORTHOGONAL zu bbox_reliability (Geometrie
            // bleibt 'reliable'). Anhängen statt clobbern — ein <use> kann zugleich auf
            // einem 3D-/Motion-Vorfahr liegen.
            if (isUse) {
              pushed.warnings = pushed.warnings || [];
              pushed.warnings.push('USE_FILL_INDETERMINATE');
            }
            // §HEAL-R6 / T1 WARNING-INVARIANTE (Spec, kritisch): jedes neue
            // Mess-Signal trägt eine Warning, damit die BESTEHENDE truncated_warnings-
            // Schiene (structured.js) es auch über Listenplatz ≥7 transportiert —
            // KEIN neuer Transport-Kanal. ORTHOGONAL zu 3D/Motion/use → anhängen,
            // nicht clobbern (ein paint-totes Element kann zugleich transformiert sein).
            if (paintVisible === false) {
              pushed.warnings = pushed.warnings || [];
              pushed.warnings.push('PAINT_NOT_VISIBLE');
            }
            // §HEAL-R6 Variante 1 WARNING-INVARIANTE (B4): paint_visible:'indeterminate'
            // ist ein neues Mess-Signal (räumlicher Operator present, raster-frei NICHT
            // entscheidbar) und MUSS — wie PAINT_NOT_VISIBLE — eine Warning tragen, damit
            // die truncated_warnings-Schiene es transportiert UND die Prosa es ehrlich
            // markiert. ORTHOGONAL → anhängen, nicht clobbern. Disjunkt zu false
            // (paintVisible ist genau EIN Wert: false ⊻ 'indeterminate' ⊻ true).
            if (paintVisible === 'indeterminate') {
              pushed.warnings = pushed.warnings || [];
              pushed.warnings.push('PAINT_PRESENCE_INDETERMINATE');
            }
            // §HEAL-R6 / T2 WARNING-INVARIANTE (Triple-Review #5): has_paint_overflow
            // ist ein neues Mess-Signal und MUSS — wie PAINT_NOT_VISIBLE — eine Warning
            // tragen, sonst verschwindet ein Overflow-Element auf Listenplatz ≥8 still
            // (structured.js hoistet NUR warnings-tragende Elemente via slice(0,7) in
            // meta.truncated_warnings). ORTHOGONAL → anhängen, nicht clobbern.
            if (has_paint_overflow === true) {
              pushed.warnings = pushed.warnings || [];
              pushed.warnings.push('PAINT_OVERFLOW');
            }
            // §D5 / R6-STATE WARNING-INVARIANTE: state_dependent ist ein neues
            // Mess-Signal und MUSS — wie NON_DETERMINISTIC_MOTION/PAINT_* — eine
            // Warning tragen, damit die truncated_warnings-Schiene (structured.js)
            // es auch über Listenplatz ≥7 transportiert UND die Prosa es ehrlich
            // markiert. EIGENER if (NICHT der gegatete is3D/Motion-Block, der via
            // ZUWEISUNG clobbert) → Motion+State überleben BEIDE Warnings (Append).
            if (state_dependent) {
              pushed.warnings = pushed.warnings || [];
              pushed.warnings.push('STATE_DEPENDENT');
            }
            // §F-AT-6-09 / R6-MEDIA WARNING-INVARIANTE: media_dependent ist ein neues
            // Mess-Signal und MUSS — wie STATE_DEPENDENT — eine Warning tragen, damit
            // die truncated_warnings-Schiene (structured.js) es auch über Listenplatz
            // ≥7 transportiert UND die Prosa es ehrlich markiert. EIGENER if, ORTHOGONAL
            // zu STATE_DEPENDENT (ein Element kann beide Achsen tragen → Append).
            if (media_dependent) {
              pushed.warnings = pushed.warnings || [];
              pushed.warnings.push('MEDIA_DEPENDENT');
            }
            // §HEAL-5 WARNING-INVARIANTE: motion_dependent ist ein neues
            // Mess-Signal und MUSS — wie STATE_/MEDIA_DEPENDENT — eine Warning
            // tragen, damit die truncated_warnings-Schiene (structured.js) es
            // auch über Listenplatz ≥7 transportiert UND die Prosa es ehrlich
            // markiert. EIGENER if, ORTHOGONAL → anhängen, nicht clobbern
            // (animateTransform-Ziele behalten CSS_TRANSFORM_2D_FLOAT_DRIFT,
            // Misch-Token-Ziele behalten STATE_DEPENDENT — genau 1× je Warning).
            if (motion_dependent) {
              pushed.warnings = pushed.warnings || [];
              pushed.warnings.push('MOTION_DEPENDENT');
            }
            // §H10 R11-06 WARNING-INVARIANTE: paint_time_variant ist ein neues
            // Mess-Signal und MUSS — wie MOTION_DEPENDENT — eine Warning
            // tragen, damit die truncated_warnings-Schiene (structured.js) es
            // auch über Listenplatz ≥7 transportiert UND die Prosa es ehrlich
            // markiert. EIGENER if, ORTHOGONAL → anhängen, nicht clobbern
            // (ein Misch-Element kann Geometrie- UND Paint-Zeit tragen).
            if (paint_time_variant) {
              pushed.warnings = pushed.warnings || [];
              pushed.warnings.push('PAINT_TIME_VARIANT');
            }
            // §F-AT-7-02 WARNING-INVARIANTE (SK2): die sichtbare Farbe stammt aus dem
            // stroke (fill trägt nicht bei) — ein neues Mess-Signal, das wie
            // STATE_DEPENDENT/PAINT_* eine Warning tragen MUSS, damit die bestehende
            // truncated_warnings-Schiene (structured.js) es auch über Listenplatz ≥7
            // transportiert UND die Prosa es ehrlich markiert. EIGENER if, ORTHOGONAL
            // → anhängen, nicht clobbern (ein stroke-Farb-Element kann zugleich
            // transformiert/state-abhängig sein). Disjunkt zu MULTIPLE_PAINT_SOURCES.
            if (colorFromStroke) {
              pushed.warnings = pushed.warnings || [];
              pushed.warnings.push('COLOR_FROM_STROKE');
            }
            // §F-AT-7-02 WARNING-INVARIANTE (SK2): fill UND stroke malen beide sichtbar
            // — „eine Farbe" wäre ein Urteil, keine Messung (Visions-Gate: das Auge
            // misst n>1 Quellen, urteilt nicht, welche „die" Farbe ist). EIGENER if,
            // ORTHOGONAL → anhängen, nicht clobbern. Disjunkt zu COLOR_FROM_STROKE.
            if (multiplePaintSources) {
              pushed.warnings = pushed.warnings || [];
              pushed.warnings.push('MULTIPLE_PAINT_SOURCES');
            }
            // §D5 H4 LOSSLESS-OR-LOUD: dieses Element wurde via STUFE-3-Fallback
            // (flag-all bei werfendem/unauflösbarem interaktivem Selektor) GROB
            // geflaggt — das ehrlich melden (kein als-präzise-getarntes Über-Flag).
            // Reiner Append, kein Clobber. Disjunkt-additiv zu STATE_DEPENDENT.
            if (coarseStateElements.has(el)) {
              pushed.warnings = pushed.warnings || [];
              pushed.warnings.push('STATE_DETECTION_COARSE');
            }
            // §HEAL-R6 / T2 (F-AT-6-08 2/2) WARNING-INVARIANTE: REFERENCE_DANGLING ist
            // das element-genaue ehrliche Signal — eine vom Renderer aufgelöste
            // Referenz (url(#x) / use href=#x) zeigt auf eine sanitize-induziert
            // gestrippte id → die referenz-abgeleitete Eigenschaft (Paint/Klon) dieses
            // Elements ist untreu. Über den bestehenden warnings[]-Durchreich-Pfad
            // (grid.js spreadet el.warnings → structured.js truncated_warnings-Schiene).
            // ORTHOGONAL → anhängen, nicht clobbern (ein dangelndes Element kann zugleich
            // transformiert/paint-tot/state-abhängig sein). KEINE bbox_reliability-
            // Degradierung: die Geometrie ist korrekt, nur die Referenz dangelt.
            if (refDangling) {
              pushed.warnings = pushed.warnings || [];
              pushed.warnings.push('REFERENCE_DANGLING');
            }
            elements.push(pushed);
          } catch {}
        }

        if (elements.length === 0)
          return {
            error: 'NO_ELEMENTS',
            // §H10 R11-01: der All-hidden-Fall nennt die wahre Ursache (Existenz
            // + css-unsichtbar) statt nur in Richtung Wohlgeformtheit zu zeigen.
            message:
              hidden.length > 0
                ? `Keine sichtbaren Elemente gefunden — ${hidden.length} existieren, sind aber css-unsichtbar`
                : 'Keine sichtbaren Elemente gefunden',
          };

        // §H10 R11-01: Existenz-Register additiv (optional-by-default — leer ⇒
        // Feld fehlt, bestehende Outputs byte-identisch).
        return { canvas, elements, ...(hidden.length > 0 ? { hidden } : {}) };
      },
      { hashPrefix: autoIdHashPrefix, skipTagsArr, spotterTagsArr, strippedIdsArr },
    );

    // PHASE 0 (Entkopplung): Die Messung ist NICHT mehr in resolve() verdrahtet.
    // Der breaker-getimete Produktiv-Pfad endet hier schlicht mit `return result`.
    // Der Mess-Primitiv (runMediaGoldenDiff + __measure*-Exporte) bleibt
    // eigenständig aufrufbar (Phase 1: Offline-Beobachtung), wird aber NICHT mehr
    // auto-getriggert. Damit teilt die Messung NICHT mehr das 5s-Breaker-Budget.
    return result;
  });

  // §3 L-005-D1 Verlust-Diff (NUR Reporting, B5): bei tatsächlichem Strip wird
  // `sanitize_loss` nicht-leer, sonst leer ([]). Wird an JEDES Resultat aus dem
  // Render-Pfad gehängt — auch an die Error-Resultate (NO_SVG_FOUND/EMPTY_SVG/
  // NO_ELEMENTS/LOAD_FAILED). Sonst ginge der Verlust-/Security-Report bei einem
  // gestrippten-aber-nicht-renderbaren SVG STILL verloren — das widerspräche
  // „nie still gelogen" (lossless-or-loud). Der Gate-/classifyCanvas-Konsum ist
  // S8; hier nur das Feld ehrlich erzeugen + füllen.
  if (rendered && typeof rendered === 'object') {
    // klein: hat die SSRF-Denylist während DIESES Renders externe Ressourcen-
    // Requests abgebrochen (überlebendes inertes style:url(http://) o.ä.)?
    // Dann ehrlich melden — eine referenzierte externe Ressource wurde nie
    // aufgelöst (kein stiller Verlust). Mutex-serialisiert → Delta eindeutig.
    const externalBlockedHere = externalRequestsBlocked - blockedBeforeRender;
    rendered.sanitize_loss =
      externalBlockedHere > 0
        ? [
            ...sanitizeLoss,
            { tag: 'resource', reason: 'EXTERNAL_RESOURCE_NOT_RESOLVED' },
          ]
        : sanitizeLoss;
  }
  return rendered;
}

/**
 * §S4/D2 TEST-ONLY Geometrie-Sonde (NICHT im Produktiv-Pfad). Misst das
 * Center-x EINES Ziel-Elements im SVG-User-Space, NACHDEM die SMIL-Uhr auf
 * einen beliebigen seek-Zeitpunkt `t` (Sekunden) eingefroren wurde. Existiert
 * AUSSCHLIESSLICH für den Frame-vs-Clock-KOPPLUNGS-Beweis (Residual #1 des
 * Plans): der Produktiv-Pfad friert IMMER bei t=0; diese Sonde belegt, dass die
 * Uhr die GEMESSENE Geometrie bewegt (cx=30@t=0 vs cx≈100@t=1.0 für EK-5), nicht
 * nur getCurrentTime() ändert. KEIN Produktionsverhalten, KEINE Verwendung in
 * resolve/inspect/analyze. Reuse von Mutex + Sanitize (gleiche Page-Lifecycle).
 *
 * @param {string} svgString
 * @param {string} targetId  — id des zu messenden Elements (z.B. 'anim').
 * @param {number} t         — seek-Zeitpunkt in Sekunden (0, 1.0, ...).
 * @returns {Promise<{cx:number}|{error:string,message?:string}>}
 */
export async function __probeFrozenGeometryAt(svgString, targetId, t) {
  const { clean, sanitizeFailed } = sanitizeSvg(svgString);
  if (sanitizeFailed) return { error: 'SANITIZE_FAILED' };
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:white">${clean}</body></html>`;
  return pageMutex.runExclusive(async () => {
    if (!activePage || !browser || browserDead || !browser.isConnected()) {
      return { error: 'LOAD_FAILED', message: 'Renderer nicht initialisiert' };
    }
    try {
      await activePage.setContent(html, {
        waitUntil: 'domcontentloaded',
        timeout: 5000,
      });
    } catch {
      return { error: 'LOAD_FAILED' };
    }
    return activePage.evaluate(
      ({ id, seek }) => {
        const svg = document.querySelector('svg');
        if (!svg) return { error: 'NO_SVG_FOUND' };
        // Identische Freeze-Sequenz wie der Produktiv-Pfad, nur mit beliebigem t.
        svg.pauseAnimations();
        svg.setCurrentTime(seek);
        void svg.getBoundingClientRect();
        if (Math.abs(svg.getCurrentTime() - seek) > 1e-6)
          return { error: 'TIMELINE_NOT_FROZEN' };
        const el = svg.getElementById
          ? svg.getElementById(id)
          : document.getElementById(id);
        if (!el) return { error: 'TARGET_NOT_FOUND' };
        const b = el.getBBox();
        const svgCTM = svg.getScreenCTM();
        const elCTM = el.getScreenCTM();
        if (!svgCTM || !elCTM) return { error: 'NO_CTM' };
        const userM = svgCTM.inverse().multiply(elCTM);
        const pt = svg.createSVGPoint();
        const xs = [
          { x: b.x, y: b.y },
          { x: b.x + b.width, y: b.y },
          { x: b.x, y: b.y + b.height },
          { x: b.x + b.width, y: b.y + b.height },
        ].map((p) => {
          pt.x = p.x;
          pt.y = p.y;
          return pt.matrixTransform(userM).x;
        });
        const xmin = Math.min(...xs);
        const xmax = Math.max(...xs);
        return { cx: (xmin + xmax) / 2 };
      },
      { id: targetId, seek: t },
    );
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// GETEILTES MESS-PRIMITIV — INCREMENT-1 (impl_plan.md §3/§4/§7/§9, DIE FORM)
//
// MEASURE_WALK_FN ist der NEUE, EIGENE parametrisierte Mess-Walk als separate
// page.evaluate-Closure — er ist NICHT die Produktiv-Closure (Z.~872) und
// emittiert NICHTS in den Produktiv-Output. Er ist VOLLSTÄNDIG selbst-enthalten
// (Browser-Sandbox: keine Node-Closure, keine importierten Helfer) und liefert
// pro stabilem Element einen deterministischen, zeit-invarianten Record
// {geom, style, closure}.
//
// VERBINDLICHE EIGENSCHAFTEN (impl_plan.md):
//   K4  — Diff-Schlüssel IMMER index-basiert `_${hashPrefix}_n${i}` aus
//         svg.querySelectorAll('*')-Index (DOM-/document-order, viewport-
//         INVARIANT), VOR allen Visibility-Skips vergeben. Autor-el.id nur als
//         Zusatzfeld `authorId`, NIE als Schlüssel (doppelte Autor-IDs
//         kollidieren sonst).
//   K1  — Achse B (Stil) UND C (Closure) ZEIT-INVARIANT: NIE der momentane
//         animierte computed-Frame, sondern statische t=0-Properties + getAnimations-
//         MAX über die Keyframe-DEFINITIONEN (Spiegel der Produktiv-Keyframe-Max-
//         Logik factorMaxOpacity/factorMaxPaint/nodeAnimatesPaint, Z.1073-1159).
//         Sonst driftet jedes CSS/WAAPI-animierte Element über die Wall-Clock →
//         Diff(A,A) bricht.
//   §4  — Achse A: getBBox + userM-CTM (svgScreenCTM.inverse().multiply(elScreenCTM)),
//         4-Punkt-Projektion → ROOT-user-units (skalierungs-invariant). geom:null
//         ist ein gültiges Diff-Signal (Element nicht im Render-Tree).
//   §4/K5 Achse C: referenzierte defs via url(#id)-Auflösung als deterministischer
//         Fingerprint @t=0, rekursiv über den Def-Sub-Baum, visited-Set gegen
//         Zyklen (Gradient-href-Vererbungsketten). Increment-1-Reduktion siehe
//         „BEWUSST AUFGESCHOBEN" unten.
//   §7  — `await document.fonts.ready` VOR dem Walk (Text-bbox-Stabilität, schliesst
//         L1); t=0-Freeze (Kopie der Produktiv-Sequenz Z.897-905, NUR SMIL).
//
// SERIALISIERUNG: Records werden hier roh (Objekt) zurückgegeben; die stabile,
// sorted-keys-Kanonisierung + sha256 macht der Node-seitige Aufrufer
// (Determinismus erfordert nur, dass DIESE Werte byte-stabil sind).
const MEASURE_WALK_FN = async (args) => {
  const { hashPrefix } = args;
  const svg = document.querySelector('svg');
  if (!svg) return { error: 'NO_SVG_FOUND' };

  // §7 — fonts.ready VOR jedem getBBox-Walk (L1: fehlt im Status-quo-Pfad).
  // Verhindert Font-Fallback-Flackern der Text-bbox → byte-Stabilität.
  if (document.fonts && typeof document.fonts.ready?.then === 'function') {
    await document.fonts.ready;
  }

  // t=0-FREEZE — identische Sequenz wie der Produktiv-Pfad (Z.897-905). NUR SMIL
  // wird eingefroren (pauseAnimations/setCurrentTime steuern NUR die SMIL-Uhr);
  // CSS-@keyframes/WAAPI laufen weiter und werden ZEIT-INVARIANT über die
  // Keyframe-Max-Logik (K1) behandelt, NIE als momentaner Frame.
  svg.pauseAnimations();
  svg.setCurrentTime(0);
  void svg.getBoundingClientRect();
  if (svg.getCurrentTime() !== 0) return { error: 'TIMELINE_NOT_FROZEN' };

  // ── ZEIT-INVARIANTE Stil-Erhebung (K1, Spiegel von factorMax* Z.1073-1159) ──
  // Für jede animierbare numerische Property: statischer t=0-computed-Wert, ODER
  // — falls eine RUNNING CSS/WAAPI-Animation sie berührt — das MAX über die
  // Keyframe-DEFINITIONEN. getAnimations() liefert KEINE SMIL-Animationen
  // (motion_source-Beleg) → SMIL-Properties bleiben korrekt als t=0-Wert. paused/
  // finished/idle → aktueller (statischer) Frame.
  function animMaxNumeric(el, cssKey, transProp) {
    const cs = getComputedStyle(el);
    const staticV = parseFloat(cs[cssKey]);
    const safeStatic = Number.isFinite(staticV) ? staticV : null;
    const anims =
      typeof el.getAnimations === 'function' ? el.getAnimations() : [];
    let animated = false;
    let animMax = -Infinity;
    for (const a of anims) {
      const touches = a.transitionProperty === transProp;
      let kfMax = -Infinity;
      let sawKf = false;
      try {
        const kfs =
          a.effect && a.effect.getKeyframes ? a.effect.getKeyframes() : [];
        for (const k of kfs) {
          if (cssKey in k) {
            sawKf = true;
            const v = parseFloat(k[cssKey]);
            if (Number.isFinite(v)) kfMax = Math.max(kfMax, v);
          }
        }
      } catch (_) {}
      if (touches || sawKf) {
        animated = true;
        const cand =
          a.playState === 'running'
            ? Number.isFinite(kfMax)
              ? kfMax
              : safeStatic
            : safeStatic;
        if (cand != null) animMax = Math.max(animMax, cand);
      }
    }
    if (animated && Number.isFinite(animMax)) return animMax;
    return safeStatic;
  }

  // Für nicht-numerische, animierbare Properties (z.B. fill/stroke als Farbe):
  // statischer t=0-Wert PLUS — falls running animiert — die SORTIERTE Menge der
  // Keyframe-Werte (zeit-invariant: kein momentaner Frame, sondern die ganze
  // Definitions-Menge). So driftet ein CSS-color-@keyframes NICHT über die
  // Wall-Clock, bleibt aber als Divergenz-Signal erhalten.
  function animValueSet(el, cssKey, transProp) {
    const cs = getComputedStyle(el);
    const staticV = cs[cssKey];
    const anims =
      typeof el.getAnimations === 'function' ? el.getAnimations() : [];
    const set = new Set();
    if (staticV != null) set.add(String(staticV));
    let runningAnimated = false;
    for (const a of anims) {
      const touches = a.transitionProperty === transProp;
      const running = a.playState === 'running';
      let sawKf = false;
      let kfVals = [];
      try {
        const kfs =
          a.effect && a.effect.getKeyframes ? a.effect.getKeyframes() : [];
        for (const k of kfs) {
          if (cssKey in k) {
            sawKf = true;
            if (k[cssKey] != null) kfVals.push(String(k[cssKey]));
          }
        }
      } catch (_) {}
      if ((touches || sawKf) && running) {
        runningAnimated = true;
        for (const v of kfVals) set.add(v);
      }
    }
    // Deterministische, sortierte Repräsentation (Set-Iteration → sortiert).
    const arr = [...set].sort();
    return { value: staticV == null ? null : String(staticV), animated: runningAnimated, set: arr };
  }

  // url(#id) → referenziertes Element ODER null (Spiegel resolveUrlRef Z.1943).
  function resolveUrlRef(v) {
    if (typeof v !== 'string') return null;
    const m = v.match(/url\(["']?#([^"')]+)["']?\)/);
    if (!m) return null;
    return document.getElementById(m[1]);
  }

  // ── ACHSE C: Paint-Server-Closure (§4 + K5, deterministischer Fingerprint) ──
  // Referenzierte defs (fill/stroke/marker-*/filter/mask/clip-path) rekursiv als
  // strukturellen Fingerprint @t=0 serialisieren. visited-Set bricht Zyklen
  // (Gradient-href-Ketten). Tiefe terminiert über den DOM-Cap (≤500, Z.2806).
  // Paint-tragende + region-/units-Attribute (K5) + stop-computed-styles (@media
  // kann auf stops wirken). SMIL-animierte Paint-Server sind durch t=0-Freeze
  // eingefroren → deterministisch; CSS-animierte stop-Werte werden zeit-invariant
  // über die computed-Werte @t=0 erfasst (kein momentaner Frame).
  const CLOSURE_ATTRS = [
    'offset', 'stop-color', 'stop-opacity',
    'gradientTransform', 'gradientUnits', 'spreadMethod',
    'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'fx', 'fy', 'fr',
    'patternTransform', 'patternUnits', 'patternContentUnits',
    'x', 'y', 'width', 'height',
    'clipPathUnits', 'maskUnits', 'maskContentUnits',
    'filterUnits', 'primitiveUnits',
    // KB4: transform + geometriewirksame Def-Child-Props (rect/circle/… IN einem
    // marker/pattern/clipPath) hashen — ein rotierter/verschobener Def-Inhalt malt
    // andere Tinte, ohne dass href/Struktur sich ändert. d/points für path/polygon.
    'transform', 'd', 'points', 'rx', 'ry', 'pathLength',
    'href', 'xlink:href',
  ];
  function defNodeFingerprint(node) {
    const tag = node.tagName ? node.tagName.toLowerCase() : '?';
    const parts = [tag];
    for (const a of CLOSURE_ATTRS) {
      if (node.hasAttribute && node.hasAttribute(a)) {
        parts.push(a + '=' + node.getAttribute(a));
      }
    }
    // KRITISCH (Inc-3 Leck-Schluss): JEDER Def-Subtree-Knoten, der MALT (rect in
    // einem marker/pattern, path in einem clipPath/mask), trägt computed PAINT —
    // @media/Cascade kann ihn viewport-abhängig treiben, OHNE dass ein Attribut
    // ODER die Struktur sich ändert. Genau das ist das Marker-/Pattern-Leck
    // (audit_marker_leak.mjs / audit_pattern_leak.mjs): der statische Pfad sieht es
    // nicht, der GEMESSENE muss es im Closure-Hash tragen. ZEIT-INVARIANT (K1):
    // numerische via animMaxNumeric, Farben via animValueSet — NIE der momentane
    // animierte Frame (sonst bräche Diff(A,A)). Wir nehmen NUR die paint-tragenden
    // computed-Properties (kein geom/layout → vom Host-bbox bereits in Achse A).
    try {
      parts.push('@fill=' + JSON.stringify(animValueSet(node, 'fill', 'fill')));
      parts.push('@stroke=' + JSON.stringify(animValueSet(node, 'stroke', 'stroke')));
      parts.push('@opacity=' + animMaxNumeric(node, 'opacity', 'opacity'));
      parts.push('@fill-opacity=' + animMaxNumeric(node, 'fillOpacity', 'fill-opacity'));
      parts.push('@stroke-opacity=' + animMaxNumeric(node, 'strokeOpacity', 'stroke-opacity'));
      parts.push('@stroke-width=' + animMaxNumeric(node, 'strokeWidth', 'stroke-width'));
      parts.push('@visibility=' + JSON.stringify(animValueSet(node, 'visibility', 'visibility')));
      parts.push('@display=' + JSON.stringify(animValueSet(node, 'display', 'display')));
      // KB3: stop-color/stop-opacity ZEIT-INVARIANT (Closure-Achse). Ein CSS-
      // animiertes <stop> würde sonst über die Wall-Clock driften → Diff(A,A) bräche
      // für den Gradient-Closure-Hash. animValueSet (Farbe) / animMaxNumeric (Alpha)
      // liefern t=0 + Keyframe-Menge/-Max statt des momentanen Frames.
      parts.push('@stop-color=' + JSON.stringify(animValueSet(node, 'stopColor', 'stop-color')));
      parts.push('@stop-opacity=' + animMaxNumeric(node, 'stopOpacity', 'stop-opacity'));
    } catch (_) {}
    return parts.join('|');
  }
  // K5-EHRLICHKEIT (Inc-3): objectBoundingBox-Resize ist eine bekannte Rest-
  // Unschärfe der Closure-Achse. Ein Paint-Server mit *Units="objectBoundingBox"
  // (gradientUnits/patternContentUnits/clipPathUnits/maskContentUnits/
  // primitiveUnits — bei <linearGradient>/<radialGradient> ist objectBoundingBox
  // sogar der SVG-DEFAULT, wenn gradientUnits fehlt) skaliert RELATIV zur bbox des
  // referenzierenden Hosts. Ändert sich die Host-Geometrie über Viewports, malt
  // derselbe Gradient eine ANDERE Tinte — die Closure-Hash bleibt jedoch byte-
  // identisch (stops/Struktur unverändert). Achse A (Host-bbox) fängt das in der
  // REGEL ein; bei bbox-INVARIANTEM Host (z.B. Klassen-Tausch ohne Geometrie-
  // Wechsel) bleibt es eine Rest-Unschärfe. Wir flaggen es EHRLICH pro Element
  // (objectBoundingBox:true), statt es still grün zu lassen (NIE STILL LÜGEN).
  const OBB_UNIT_ATTRS = [
    'gradientUnits', 'patternContentUnits',
    'clipPathUnits', 'maskContentUnits', 'primitiveUnits',
  ];
  function usesObjectBoundingBox(node) {
    const tag = node.tagName ? node.tagName.toLowerCase() : '';
    // Gradienten: objectBoundingBox ist der Default → fehlendes gradientUnits zählt.
    if (tag === 'lineargradient' || tag === 'radialgradient') {
      const gu = node.getAttribute && node.getAttribute('gradientUnits');
      if (!gu || gu.trim().toLowerCase() === 'objectboundingbox') return true;
    }
    // pattern: patternUnits-Default ist objectBoundingBox (die Kachel-REGION).
    if (tag === 'pattern') {
      const pu = node.getAttribute && node.getAttribute('patternUnits');
      if (!pu || pu.trim().toLowerCase() === 'objectboundingbox') return true;
    }
    // clipPath/mask/filter: clipPathUnits/maskContentUnits/primitiveUnits explizit.
    for (const a of OBB_UNIT_ATTRS) {
      const v = node.getAttribute && node.getAttribute(a);
      if (v && v.trim().toLowerCase() === 'objectboundingbox') return true;
    }
    return false;
  }
  function paintClosureOf(refEls) {
    // refEls: Liste der url(#…)-Wurzeln dieses Elements (in stabiler Reihenfolge).
    const roots = [];
    for (const root of refEls) if (root) roots.push(root);
    if (roots.length === 0) return { closure: null, objectBoundingBox: false };
    const visited = new Set();
    const lines = [];
    const stack = [];
    let obb = false;
    // Wurzeln in DOM-Reihenfolge stabilisieren (gegen Reihenfolge-Drift).
    for (const r of roots) stack.push(r);
    // KB4: aus EINEM url(#id)-tragenden String den referenzierten Knoten enqueuen.
    const enqueueUrlRef = (v) => {
      if (typeof v !== 'string' || v.indexOf('url(') === -1) return;
      // mehrere url(#…) pro Wert möglich (z.B. filter-Listen) → alle erfassen.
      const rx = /url\(["']?#([^"')]+)["']?\)/g;
      let m;
      while ((m = rx.exec(v)) !== null) {
        const ref = document.getElementById(m[1]);
        if (ref && !visited.has(ref)) stack.push(ref);
      }
    };
    // KB4: computed paint-/operator-Properties eines Def-Knotens, die url(#…) tragen
    // können (ein Def-Kind kann SELBST auf einen weiteren Def referenzieren —
    // z.B. <rect fill="url(#g2)"> in einem <marker>, oder filter/mask/clip-path).
    const COMPUTED_REF_PROPS = [
      'fill', 'stroke', 'clipPath', 'filter', 'mask', 'maskImage',
      'markerStart', 'markerMid', 'markerEnd',
    ];
    while (stack.length > 0) {
      const n = stack.shift();
      if (!n || visited.has(n)) continue;
      visited.add(n);
      lines.push(defNodeFingerprint(n));
      if (usesObjectBoundingBox(n)) obb = true;
      // href/xlink:href-Vererbung explizit verfolgen (Gradient-Ketten).
      const href =
        (n.getAttribute && (n.getAttribute('href') || n.getAttribute('xlink:href'))) ||
        null;
      if (href && href.charCodeAt(0) === 35 && href.length > 1) {
        const inh = document.getElementById(href.slice(1));
        if (inh && !visited.has(inh)) stack.push(inh);
      }
      // KB4: JEDES Attribut des Def-Knotens auf url(#…) scannen + enqueuen (nicht
      // nur href/Kinder). Fängt verschachtelte Paint-Server-Referenzen (Gradient-
      // in-Marker, filter-auf-Def-Kind), die der Closure sonst entgehen würden.
      if (n.attributes) {
        for (const at of n.attributes) enqueueUrlRef(at.value);
      }
      // KB4: computed paint-/operator-Props ebenfalls (CSS-gesetzte url(#…)-Refs,
      // die nicht als Präsentations-Attribut stehen).
      try {
        const ncs = getComputedStyle(n);
        for (const p of COMPUTED_REF_PROPS) enqueueUrlRef(ncs[p]);
      } catch (_) {}
      // Sub-Baum in DOM-order.
      if (n.children) {
        for (const c of n.children) if (!visited.has(c)) stack.push(c);
      }
    }
    return { closure: lines.join('\n'), objectBoundingBox: obb };
  }

  // ── STABILE INDEX-KEYS (K4): VOR allen Skips über die VOLLE qSA('*')-Liste ──
  const all = svg.querySelectorAll('*');
  const SKIP_TAGS = new Set(['defs', 'symbol', 'clipPath', 'mask', 'pattern', 'marker', 'metadata', 'title', 'desc', 'style', 'linearGradient', 'radialGradient', 'filter', 'animate', 'animateTransform', 'animateMotion', 'set', 'mpath', 'stop']);
  const records = {};
  const svgScreenCTM = svg.getScreenCTM();

  // §HEAL-6 / KB3-SCHWESTER (F-AT-8-02): motionExcluded über die use-Grenze.
  // Der bestehende Per-Element-Marker unten (getAnimations running, self+
  // ancestors) sieht den Shadow-Inhalt einer <use> NIE (SVG2 §5.6: Shadow-
  // Subtree nicht im Light-DOM) → eine use-Instanz eines CSS/WAAPI-animierten
  // Def-Subtrees diffte als Wall-Clock-FALSCH-Diff in den Heal-4-Detektor.
  // LÖSUNG (Spiegel des Produktiv-Set-Scans + propagateUseGraph Z.~3287,
  // selbst-enthalten — dieser Walk läuft als EIGENER evaluate): NUR die
  // MARKER-KNOTEN mit RUNNING Nicht-SMIL-Animation sammeln (Finishing R1,
  // Adversarial F1: eine Nachfahren-Aufnahme wäre ein ÜBER-AUSSCHLUSS —
  // <use href="#kind"> eines animierten Containers klont den Container NICHT
  // mit, die Instanz misst byte-stabil und darf NICHT vom media-Diff
  // ausgeschlossen werden; Licht-DOM-Nachfahren deckt der bestehende
  // self+ancestors-Loop unten, Def-interne Nachfahren deckt
  // refInstantiatesInSet im Fixpunkt). Kriterium: getAnimations/playState —
  // zeit-invariant, E2-verifiziert auch am NICHT-gerenderten Def-Knoten
  // faithful (an internal session artifact). Dann über den use-href-
  // Graph-Fixpunkt heben (monotones Set-Wachstum → terminiert, use→use-
  // Zyklus-sicher). Für Light-DOM-Elemente ist set.has(el) ⊆ dem bestehenden
  // self+ancestors-Loop → byte-identisch by construction; NUR use-Instanzen
  // kommen hinzu. Läuft NICHT in MEASURE_STATIC_MEDIA_FN (Statik-Port) —
  // Parity unberührt.
  //
  // DRIFT-RISIKO (R3, dokumentiert — UNGELÖST by design): es existieren ZWEI
  // Implementierungen desselben Heilungs-Kriteriums — der Produktiv-Set-Scan
  // (computed-style nodeHasNonSmilMotion, Z.~3482) und dieser getAnimations-
  // Scan. Architektonisch erzwungen: beide laufen in GETRENNTEN
  // page.evaluate-Scopes (keine geteilte Closure, keine Serialisierung von
  // Sets über die Boundary). Driften die Prädikate auseinander, lügt eine
  // Seite still. WÄCHTER: die e2e-KB3-Asserts in
  // tests/integration/test_heal_use_shadow.mjs (um/umcss motionExcluded=true
  // beide Pässe · uinnerAnim motionExcluded=false · manchor/manchor2=false).
  const useShadowMotionSet = new Set();
  {
    const hasRunningAnim = (n) => {
      const anims =
        typeof n.getAnimations === 'function'
          ? n.getAnimations({ subtree: false })
          : [];
      for (const an of anims) if (an.playState === 'running') return true;
      return false;
    };
    for (let i = 0; i < all.length; i++) {
      const n = all[i];
      if (hasRunningAnim(n)) useShadowMotionSet.add(n);
    }
    const allUses = svg.querySelectorAll('use');
    const useRefOf = (u) => {
      const h = u.getAttribute('href') || u.getAttribute('xlink:href');
      if (h && h.startsWith('#')) return document.getElementById(h.slice(1));
      return null;
    };
    const refInstantiatesInSet = (ref) => {
      if (!ref) return false;
      if (useShadowMotionSet.has(ref)) return true;
      for (const d of ref.querySelectorAll('*'))
        if (useShadowMotionSet.has(d)) return true;
      return false;
    };
    let added = true;
    while (added) {
      added = false;
      for (const u of allUses) {
        if (useShadowMotionSet.has(u)) continue;
        if (refInstantiatesInSet(useRefOf(u))) {
          useShadowMotionSet.add(u);
          for (const d of u.querySelectorAll('*')) useShadowMotionSet.add(d);
          added = true;
        }
      }
    }
  }

  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    // K4 — Schlüssel IMMER aus dem DOM-Index, VOR jedem Skip/Visibility-Filter.
    const key = `_${hashPrefix}_n${i}`;
    const tag = el.tagName ? el.tagName.toLowerCase() : '?';

    // Nur „mess-relevante" (geometrisch malende) Elemente bekommen einen Record;
    // Definitions-Container + ihre Kinder werden übersprungen (sie malen nur via
    // Referenz, SVG2 §5.6 — exakt wie der Produktiv-Walk Z.3266/3272). Der
    // SCHLÜSSEL existiert dennoch index-stabil; der Skip betrifft nur, OB gemessen
    // wird. (Increment-1: invisibleNow-Elemente werden gemessen — ihre echte
    // 0×0/null-Geometrie IST das Diff-Signal, kein false-positive.)
    if (SKIP_TAGS.has(tag)) continue;
    if (el.closest('defs,symbol,clipPath,mask,pattern,marker')) continue;

    // ── ACHSE A: Geometrie (bbox + userM-CTM, ROOT-user-units) ──
    let geom = null;
    try {
      const localBBox = el.getBBox();
      const elScreenCTM = el.getScreenCTM();
      if (svgScreenCTM && elScreenCTM) {
        const userM = svgScreenCTM.inverse().multiply(elScreenCTM);
        const pt = svg.createSVGPoint();
        const corners = [
          { x: localBBox.x, y: localBBox.y },
          { x: localBBox.x + localBBox.width, y: localBBox.y },
          { x: localBBox.x, y: localBBox.y + localBBox.height },
          { x: localBBox.x + localBBox.width, y: localBBox.y + localBBox.height },
        ].map((p) => {
          pt.x = p.x;
          pt.y = p.y;
          return pt.matrixTransform(userM);
        });
        const xs = corners.map((p) => p.x);
        const ys = corners.map((p) => p.y);
        geom = [
          Math.min(...xs),
          Math.min(...ys),
          Math.max(...xs),
          Math.max(...ys),
        ];
      }
    } catch (_) {
      geom = null;
    }

    // ── ACHSE B: Computed-Style ZEIT-INVARIANT (K1) ──
    const cs = getComputedStyle(el);
    const style = {
      // numerische, animierbare Properties → t=0-Wert ODER Keyframe-MAX.
      opacity: animMaxNumeric(el, 'opacity', 'opacity'),
      'fill-opacity': animMaxNumeric(el, 'fillOpacity', 'fill-opacity'),
      'stroke-opacity': animMaxNumeric(el, 'strokeOpacity', 'stroke-opacity'),
      'stroke-width': animMaxNumeric(el, 'strokeWidth', 'stroke-width'),
      // nicht-numerische → t=0 + sortierte Keyframe-Wertemenge.
      fill: animValueSet(el, 'fill', 'fill'),
      stroke: animValueSet(el, 'stroke', 'stroke'),
      // KB3: clip-path/filter/mask/marker-*/visibility/display ZEIT-INVARIANT —
      // NICHT der momentane Frame. Eine CSS/WAAPI-@keyframes auf visibility/filter/…
      // würde sonst über die Wall-Clock driften und Diff(A,A) brechen (false-
      // discard eines CSS-animierten filter:blur()/visibility-SVG). animValueSet
      // liefert t=0 + die SORTIERTE Keyframe-Wertemenge der running-Animation →
      // zeit-invariant, aber als Divergenz-Signal erhalten (Spiegel fill/stroke).
      visibility: animValueSet(el, 'visibility', 'visibility'),
      display: animValueSet(el, 'display', 'display'),
      'clip-path': animValueSet(el, 'clipPath', 'clip-path'),
      filter: animValueSet(el, 'filter', 'filter'),
      // mask: getComputedStyle.mask kann leer sein → maskImage als Fallback
      // (zeit-invariant über beide Schlüssel; mask-Shorthand ist selten animiert).
      mask: animValueSet(el, 'mask', 'mask'),
      'mask-image': animValueSet(el, 'maskImage', 'mask-image'),
      'marker-start': animValueSet(el, 'markerStart', 'marker-start'),
      'marker-mid': animValueSet(el, 'markerMid', 'marker-mid'),
      'marker-end': animValueSet(el, 'markerEnd', 'marker-end'),
      // KB3 (Plan §7 NON_DETERMINISTIC_MOTION): laufende CSS/WAAPI-Motion am
      // Element ODER einem Vorfahr → vom media-Diff AUSSCHLIESSEN (sonst Wall-
      // Clock-Drift = false-positive). Hier nur ERHEBEN (zeit-invariant: Set-
      // Lookup über getAnimations playState); der golden-diff/Straddle wertet das
      // Feld aus und loggt MEDIA_DIFF_MOTION_EXCLUDED statt es als media zu werten.
    };
    // motionExcluded: hat das Element (oder ein Vorfahr) eine RUNNING Nicht-SMIL-
    // Animation auf einer paint-/transform-tragenden Property? Zeit-invariant
    // (playState, nicht der Frame). Spiegel isSelfOrAncestorNonSmilMotion (Z.1279).
    // §HEAL-6 / KB3: OR-Init aus useShadowMotionSet (use-Graph-Lift, s. oben) —
    // der self+ancestors-Loop darunter bleibt unangetastet.
    let motionExcluded = useShadowMotionSet.has(el);
    for (let a = el; a && a !== svg.parentNode; a = a.parentElement) {
      const anims =
        typeof a.getAnimations === 'function' ? a.getAnimations({ subtree: false }) : [];
      for (const an of anims) {
        if (an.playState === 'running') { motionExcluded = true; break; }
      }
      if (motionExcluded) break;
    }

    // ── ACHSE C: Paint-Server-Closure ──
    const refEls = [
      resolveUrlRef(cs.fill),
      resolveUrlRef(cs.stroke),
      resolveUrlRef(cs.clipPath),
      resolveUrlRef(cs.filter),
      resolveUrlRef(cs.mask),
      resolveUrlRef(cs.maskImage),
      resolveUrlRef(cs.markerStart),
      resolveUrlRef(cs.markerMid),
      resolveUrlRef(cs.markerEnd),
    ];
    const { closure, objectBoundingBox } = paintClosureOf(refEls);

    records[key] = {
      tag,
      authorId: el.id || null,
      geom,
      style,
      closure,
      // K5-EHRLICHKEIT: objectBoundingBox-Rest-Unschärfe pro Element (s.o.).
      objectBoundingBox,
      // KB3-EHRLICHKEIT: running-CSS/WAAPI-Motion → vom media-Diff ausschließen.
      motionExcluded,
    };
  }

  return { records };
};

// Lazy Numerik-Selbsttest (§7): EINMAL beim ersten Schatten-Pass — der Mess-Walk
// auf einem gepinnten Referenz-SVG liefert deterministisch erwartbare Werte
// (rect-Geometrie unter Translate + ein animierter Gradient @t=0). Drift
// (Chromium-/Font-Pin) → LAUT loggen, NIE den Produktiv-Return brechen (K8).
// Idempotent (läuft nur einmal pro Prozess). Liefert true bei OK / Skip.
let measureSelfTestDone = false;
// KB7: das ERGEBNIS des Selbsttests (true=OK, false=Drift/Fehler). Bei false darf
// der Schatten KEINE golden-diff-/Mess-Werte mehr liefern — nur einen Marker. Wird
// EINMAL gesetzt (zusammen mit measureSelfTestDone) und an JEDEM Schatten-Eintritt
// geprüft (resolve-Wiring + Test-Exporte). Default true (vor dem Lauf neutral; der
// erste Eintritt führt den Test aus und überschreibt). NIE STILL grün bei Drift.
let measureSelfTestOk = true;
// KB7: zentraler, idempotenter Selbsttest-Runner. Setzt measureSelfTestDone +
// measureSelfTestOk; NIE-THROW. Liefert den OK-Zustand zurück.
async function ensureMeasureSelfTest(page, autoIdHashPrefix) {
  if (measureSelfTestDone) return measureSelfTestOk;
  measureSelfTestDone = true;
  try {
    measureSelfTestOk = await runMeasureNumericSelfTest(page, autoIdHashPrefix);
  } catch (_) {
    // never-throw: ein Selbsttest-Crash zählt als FEHLER (Schatten deaktivieren).
    measureSelfTestOk = false;
  }
  return measureSelfTestOk;
}
const MEASURE_SELFTEST_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/>' +
  '<stop offset="1" stop-color="#00f">' +
  '<animate attributeName="stop-color" values="#00f;#0f0" dur="2s"/></stop>' +
  '</linearGradient></defs>' +
  '<rect id="r" x="10" y="20" width="30" height="40" fill="url(#g)" transform="translate(5,5)"/>' +
  '</svg>';

async function runMeasureNumericSelfTest(page, autoIdHashPrefix) {
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:white">${MEASURE_SELFTEST_SVG}</body></html>`;
  let out;
  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 5000 });
    out = await page.evaluate(MEASURE_WALK_FN, { hashPrefix: autoIdHashPrefix });
  } catch (e) {
    console.warn(
      `MIRROR_MEASURE_SELFTEST WARN: Selbsttest-Render warf (${e && e.message}) — Schatten weiter, Produktiv unberührt.`,
    );
    return false;
  }
  const errors = [];
  if (!out || out.error) {
    errors.push(`walk-error ${out && out.error}`);
  } else {
    const recs = out.records || {};
    // genau EIN gemessenes Element (der rect): defs/gradient/stop sind geskippt.
    const keys = Object.keys(recs);
    if (keys.length !== 1) errors.push(`expected 1 record, got ${keys.length}`);
    const r = recs[keys[0]];
    if (!r || r.tag !== 'rect') errors.push(`expected rect record`);
    else {
      // Geometrie: x=10,y=20,w=30,h=40 + translate(5,5) → [15,25,45,65] user-units.
      const g = r.geom;
      const near = (a, b) => Math.abs(a - b) < 1e-6;
      if (
        !g ||
        !near(g[0], 15) ||
        !near(g[1], 25) ||
        !near(g[2], 45) ||
        !near(g[3], 65)
      )
        errors.push(`geom mismatch: ${JSON.stringify(g)} (expected [15,25,45,65])`);
      // Closure: nicht-null, enthält den Gradient + beide stops + @t=0-stop-color.
      if (!r.closure || !r.closure.includes('lineargradient'))
        errors.push(`closure missing gradient: ${r.closure}`);
      if (!r.closure || !r.closure.includes('stop'))
        errors.push(`closure missing stops`);
    }
  }
  if (errors.length > 0) {
    console.warn(
      `MIRROR_MEASURE_SELFTEST FAILED (Chromium/Font-Drift? Pin prüfen): ${errors.join('; ')} — Mess-Werte sind verdächtig (Numerik-Drift).`,
    );
    return false;
  }
  return true;
}

/**
 * TEST-ONLY (Increment-1 Beweis): führt den NEUEN Mess-Walk im Produktiv-
 * Lifecycle (Mutex + Sanitize + setContent) am AKTUELLEN Viewport (Produktiv-
 * fix 1920×1080) aus und gibt die rohen Records zurück. KEIN 2. Viewport, KEIN
 * Straddle, KEIN golden-diff — das ist Increment-1-Scope (impl_plan.md §9).
 * PHASE 0: eigenständig aufrufbar (kein Flag-Gate); NICHT in resolve() getriggert.
 * Beim ERSTEN Aufruf läuft der lazy Numerik-Selbsttest (§7).
 * Reuse von Mutex + Sanitize (gleicher Page-Lifecycle wie resolve/__probe…).
 *
 * @param {string} svgString
 * @returns {Promise<{records:object}|{error:string}|null>}
 */
export async function __measureMediaShadow(svgString) {
  if (!svgString || typeof svgString !== 'string')
    return { error: 'INVALID_INPUT' };
  const { clean, sanitizeFailed } = sanitizeSvg(svgString);
  if (sanitizeFailed) return { error: 'SANITIZE_FAILED' };
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:white">${clean}</body></html>`;
  const autoIdHashPrefix = computeSvgHashPrefix(clean);
  return pageMutex.runExclusive(async () => {
    if (!activePage || !browser || browserDead || !browser.isConnected()) {
      return { error: 'LOAD_FAILED', message: 'Renderer nicht initialisiert' };
    }
    // §7 lazy Numerik-Selbsttest — EINMAL, fail-LAUT, NIE den Return brechen (K8).
    // Increment-1-Scope: liefert ROHE Records (kein golden-diff) → Selbsttest-Status
    // wird gesetzt, der Walk läuft dennoch (die Records sind der Diff(A,A)-Beweis).
    await ensureMeasureSelfTest(activePage, autoIdHashPrefix);
    try {
      await activePage.setContent(html, {
        waitUntil: 'domcontentloaded',
        timeout: 5000,
      });
    } catch {
      return { error: 'LOAD_FAILED' };
    }
    try {
      return await activePage.evaluate(MEASURE_WALK_FN, {
        hashPrefix: autoIdHashPrefix,
      });
    } catch (e) {
      return { error: 'MEASURE_FAILED', message: e && e.message };
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// GETEILTES MESS-PRIMITIV — INCREMENT-2 (impl_plan.md §1 Opt.B / §5 / §7 / §9)
//
// Der ZWEITE Viewport + Straddle. Baut auf INCREMENT-1 (MEASURE_WALK_FN, stabile
// Index-Keys, ZEIT-INVARIANTE Records) auf. PHASE 0: alles hinter dem eigenständig
// aufrufbaren Test-Export __measureMediaShadowStraddle — KEIN Produktiv-Wiring in
// resolve(), kein Flag-Gate.
//
// VERBINDLICHE EIGENSCHAFTEN (impl_plan.md §9):
//   K6 — collectViewportBreakpoints: NUR die width-Achse, NUR px-auflösbar; em/
//        rem/vw/vh/%/calc()/unbekanntes Feature → NICHT raten, sondern als
//        „unresolved" über-flaggen (MEDIA_BREAKPOINT_UNRESOLVED). deriveStraddles:
//        pro bp {bp-1, bp, bp+1} (floor/ceil/clamp, Integer) + Baseline 1920.
//   §1 Opt.B — EIN setContent, dann setViewportSize-Schleife + Re-evaluate auf
//        DEMSELBEN DOM (Re-Layout ohne Re-Parse). R1-Gegenmittel: pro Pass
//        `void getBoundingClientRect()`-Flush (wie Z.922) NACH setViewportSize
//        und VOR MEASURE_WALK_FN.
//   K2 — die Pass-Schleife läuft in try/finally; im finally `setViewportSize(
//        1920,1080)` + Flush — die Viewport-Invariante MUSS auch bei Throw
//        gewahrt sein (der Page-Viewport ist global; ein verstellter Viewport
//        würde den nächsten Produktiv-Render verfälschen).
//   K6-Gate — matchMedia-Branch-Divergenz: pro bp prüfen, dass VP−ε vs VP+ε
//        WIRKLICH unterschiedlich matchen; divergiert nicht → MEDIA_STRADDLE_
//        INEFFECTIVE laut loggen (kein false-green).
//   K7 — Sample-Budget (max N Breakpoints) + per-Pass-Timeout; Überschreitung →
//        HEAVY_DETECTION-Marker im Resultat (ehrlich, nicht still).

/** K7: max. Anzahl auflösbarer Breakpoints, die zu Straddle-Viewports werden
 *  (Mutex-Haltedauer-Schutz). Überschuss → HEAVY_DETECTION. */
const MEASURE_MAX_BREAKPOINTS = 8;
/** K7: per-Pass-Timeout (ms) für setViewportSize+evaluate eines Straddle-VP. */
const MEASURE_PASS_TIMEOUT_MS = 4000;
/** Produktiv-Viewport-Anker (Context-fix 1920×1080, Z.~534) — Baseline + Reset. */
const MEASURE_BASELINE_VP = 1920;
const MEASURE_VP_HEIGHT = 1080;

/**
 * §5.1 / K6: extrahiert aus EINEM mediaText die viewport-WIDTH-Breakpoints in px.
 * Reine Funktion (keine DOM/Browser-Abhängigkeit) — ein Source-of-Truth-Parser,
 * Node-seitig aufgerufen über die im Browser gesammelten mediaTexts.
 *
 * AUFLÖSBAR (→ px): nur die `width`-Achse mit px-Längen — `(min-width:600px)`,
 *   `(max-width:600px)`, Range `(width > 600px)`, `(400px <= width <= 800px)`,
 *   `(width:600px)`. min-/max-Präfix wird auf das Basis-Feature reduziert.
 * UNRESOLVED (K6, NIE raten): em/rem/vw/vh/%/ch/ex/vmin/vmax-Längen, calc()/var()/
 *   env()/clamp()/min()/max()-Funktionen, height/aspect-ratio/device-* (nicht
 *   width-Achse für diesen Beweis), unbekannte Token. Diese werden im Resultat
 *   als `unresolved`-Strings ausgewiesen → MEDIA_BREAKPOINT_UNRESOLVED-Brücke.
 *
 * @param {string} mediaText
 * @returns {{px:number[], unresolved:string[]}}
 */
export function collectViewportBreakpoints(mediaText) {
  const txt = String(mediaText || '').toLowerCase();
  const px = [];
  const unresolved = [];
  if (!txt.trim()) return { px, unresolved };
  // Jeden in '(...)' stehenden Feature-Ausdruck inspizieren (verschachtelte
  // Klammern für calc() o.ä. mit erfassen — wie der Späher Z.2894).
  const groups = txt.match(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g) || [];
  // px-Länge aus einem Token extrahieren ODER „unresolved" signalisieren.
  // Rückgabe: number (px) | 'UNRESOLVED' | null (kein Längen-Token).
  const lengthPx = (tok) => {
    const t = tok.trim();
    if (!t) return null;
    // Funktions-Wert (calc/var/env/min/max/clamp/unbekannt) → NIE raten.
    if (/[a-z-]+\s*\(/.test(t)) return 'UNRESOLVED';
    const m = t.match(/^([+-]?\d*\.?\d+)\s*([a-z%]*)$/);
    if (!m) return null; // kein numerischer Längen-Wert (z.B. Feature-Name)
    const num = parseFloat(m[1]);
    const unit = m[2];
    if (!Number.isFinite(num)) return 'UNRESOLVED';
    if (unit === 'px' || unit === '') return num; // unitless → px (CSS-Toleranz)
    return 'UNRESOLVED'; // em/rem/vw/vh/%/ch/… → K6: über-flaggen, nicht ×16
  };
  for (const g of groups) {
    const inner = g.slice(1, -1).trim();
    if (!inner) continue;
    // Funktions-Wert irgendwo im Ausdruck → der ganze Ausdruck ist nicht
    // statisch px-klassifizierbar (K6).
    if (/[a-z-]+\s*\(/.test(inner)) {
      unresolved.push(inner);
      continue;
    }
    // Range-Syntax: `(400px < width <= 800px)`, `(width > 600px)`, `(width:600px)`.
    // Strategie: das ECHTE Media-Feature-Token finden — ein Bezeichner an einer
    // Wort-Grenze, der NICHT der Einheiten-Suffix einer Zahl ist (`400px` →
    // `px` ist KEIN Feature). Längen-Einheiten kleben immer DIREKT an einer
    // Ziffer; ein Feature-Token steht frei. Wir entfernen daher zuerst alle
    // Zahl+Einheit-Tokens, dann ist das erste verbleibende Bezeichner-Token das
    // Feature.
    const featureScan = inner.replace(/[+-]?\d*\.?\d+[a-z%]*/g, ' ');
    // jedes verbleibende Bezeichner-Token IST ein Feature/Schlüsselwort.
    const featTokens = (featureScan.match(/[a-z][a-z-]*/g) || []).map((t) =>
      t.startsWith('min-') || t.startsWith('max-') ? t.slice(4) : t,
    );
    if (featTokens.length === 0) {
      // kein Feature-Bezeichner (nur Werte?) → nicht klassifizierbar → über-flaggen.
      unresolved.push(inner);
      continue;
    }
    // NUR die width-Achse ist für diesen Beweis auflösbar; jedes andere Feature
    // (height/device-width/aspect-ratio/orientation/…) → K6 über-flaggen.
    if (!featTokens.every((f) => f === 'width')) {
      unresolved.push(inner);
      continue;
    }
    // 2) Alle Wert-Token (alles außer dem Feature-Namen + Operatoren) prüfen.
    //    Operatoren/Trenner entfernen, dann jedes Stück als Länge klassifizieren.
    const valuePart = inner
      .replace(/\b(?:min-|max-)?width\b/g, ' ')
      .replace(/[<>=:]+/g, ' ');
    let sawUnresolved = false;
    let sawPx = false;
    for (const tok of valuePart.split(/\s+/)) {
      if (!tok.trim()) continue;
      const v = lengthPx(tok);
      if (v === 'UNRESOLVED') sawUnresolved = true;
      else if (typeof v === 'number') {
        px.push(v);
        sawPx = true;
      }
    }
    if (sawUnresolved && !sawPx) unresolved.push(inner);
  }
  return { px, unresolved };
}

/**
 * §5.2 / K6: leitet aus den px-Breakpoints die Integer-Straddle-Viewports ab.
 * Pro bp die Kandidaten {bp-1, bp, bp+1} (floor/ceil + clamp ≥1), PLUS die
 * Baseline 1920 (Produktiv-Anker). Dedupliziert + numerisch sortiert
 * (Reihenfolge-invariant → byte-stabile Pass-Reihenfolge).
 *
 * @param {number[]} bps
 * @returns {number[]} aufsteigend sortierte, eindeutige Integer-Viewport-Breiten.
 */
export function deriveStraddles(bps) {
  const set = new Set([MEASURE_BASELINE_VP]);
  for (const raw of bps || []) {
    const bp = Number(raw);
    if (!Number.isFinite(bp)) continue;
    const lo = Math.floor(bp);
    const hi = Math.ceil(bp);
    for (const c of [lo - 1, lo, hi, hi + 1]) {
      const v = Math.max(1, Math.trunc(c));
      set.add(v);
    }
  }
  return [...set].sort((a, b) => a - b);
}

// MEASURE_BREAKPOINTS_FN: EIGENER kleiner evaluate (impl_plan.md §6.2-Empfehlung),
// der NUR die mediaTexts aus dem DOM sammelt — er fasst den Produktiv-Output NIE
// an. Spiegel der Sheet-/@import-Iteration der Späher-IIFE (Z.3015-3112): über
// document.styleSheets absteigen, bei CSSMediaRule den mediaText, bei
// CSSImportRule mit Media-Liste den Import-mediaText UND rekursiv die importierten
// Regeln. Die px-Extraktion macht Node (collectViewportBreakpoints) — EIN Parser.
const MEASURE_BREAKPOINTS_FN = () => {
  const texts = [];
  function walk(rules) {
    for (const rule of rules) {
      // @import (CSSImportRule): Media-Liste + rekursiv absteigen (data:-URIs
      // lösen auf; externe sind netz-geblockt → cssRules wirft → catch).
      if (rule.styleSheet) {
        try {
          if (rule.media && rule.media.length > 0 && rule.media.mediaText)
            texts.push(rule.media.mediaText);
        } catch (_) {}
        try {
          if (rule.styleSheet.cssRules) walk(rule.styleSheet.cssRules);
        } catch (_) {}
        continue;
      }
      // @media (CSSMediaRule): mediaText/conditionText sammeln + rekursiv.
      if (rule.constructor && rule.constructor.name === 'CSSMediaRule') {
        const cond =
          (rule.media && rule.media.mediaText) || rule.conditionText || '';
        if (cond) texts.push(cond);
        if (rule.cssRules) walk(rule.cssRules);
        continue;
      }
      // @scope/@supports/@layer/Style-Rules: nur rekursiv (kein eigener @media).
      if (rule.cssRules) {
        try {
          walk(rule.cssRules);
        } catch (_) {}
      }
    }
  }
  const sheets = [
    ...document.styleSheets,
    ...(document.adoptedStyleSheets || []),
  ];
  for (const sheet of sheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch (_) {
      continue; // cross-origin → SecurityError → Sheet überspringen
    }
    if (rules) walk(rules);
  }
  return texts;
};

// MEASURE_MATCHMEDIA_FN: K6-Gate — prüft im Browser, ob ein gegebener mediaText
// am AKTUELLEN Viewport matcht. Der Straddle-Loop ruft das an VP−ε vs VP+ε auf;
// divergiert das Ergebnis NICHT, ist der Straddle WIRKUNGSLOS (beide Viewports
// fallen in denselben @media-Zweig) → MEDIA_STRADDLE_INEFFECTIVE.
const MEASURE_MATCHMEDIA_FN = (mediaText) => {
  try {
    return !!window.matchMedia(mediaText).matches;
  } catch (_) {
    return null; // ungültiger mediaText → kein verlässliches Divergenz-Signal
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// MESS-PRIMITIV / INCREMENT-3 — golden-diff (impl_plan.md §6.3, K3)
//
// MEASURE_STATIC_MEDIA_FN: EIGENER evaluate (K3), der die HEUTIGE statische
// media_dependent-Detektion des Produktiv-Pfades RE-AUSFÜHRT und ihr Ergebnis als
// qSA('*')-INDEX-Set zurückgibt — DIESELBEN stabilen Index-Keys wie MEASURE_WALK_FN
// (`_${hashPrefix}_n${i}`). So vergleicht der golden-diff like-with-like (gemessen
// vs. statisch) OHNE Zugriff auf result.elements (kein Produktiv-Output-Touch).
//
// Diese Funktion ist eine FAITHFUL-PORT der Produktiv-Statik-Detektion (Z.~1324-
// 1692 Helfer + Z.~2858-3113 IIFE + Z.~3261-3285 propagateUseGraph). Sie ist
// VOLLSTÄNDIG selbst-enthalten (Browser-Sandbox: keine Node-Closure). KORREKT-
// HEITS-GARANTIE: dieselben SAFE_MEDIA_TOKENS, dieselbe Whitelist-Logik
// (mediaIsViewportDependent), dieselbe Selektor-Stufenleiter (PRÄZISE → SALVAGE →
// FALLBACK), dieselbe use-href-Graph-Propagation, dieselben EMIT-Gates (KB1:
// SKIP_TAGS + closest(def-Container)). Der echte Paritäts-Selbsttest
// __measureStaticMediaParityCheck (KB2, weiter unten) assertet diese Port-Statik
// == den ECHTEN resolve()-media_dependent-Output über ein Korpus (Marker-Leck,
// Pattern-Leck, <g>/<stop>-@media-Szene). Drift wäre selbst eine Lüge → der golden-
// diff vergleicht dann gegen eine falsche Statik.
//
// Rückgabe: { indices:number[] } — sortierte qSA('*')-Indizes der statisch als
//   media_dependent erkannten + EMITTIERBAREN Elemente (KB1-gefiltert); { error }.
const MEASURE_STATIC_MEDIA_FN = () => {
  const svg = document.querySelector('svg');
  if (!svg) return { error: 'NO_SVG_FOUND' };

  // ── Selektor-Helfer (Port Z.~1324-1692) ──────────────────────────────────
  const STATE_PSEUDO_RX =
    /:(?:focus-within|focus-visible|focus|active|hover|target)\b/i;
  const INTERACTIVE_PSEUDO_SET = new Set([
    'focus-within', 'focus-visible', 'focus', 'active', 'hover', 'target',
  ]);
  const IDENT_CHAR_RX = /[A-Za-z0-9_-]/;

  function splitTopLevelCommas(selectorText) {
    const parts = [];
    let cur = '';
    let paren = 0;
    let bracket = 0;
    let quote = '';
    const s = String(selectorText);
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quote) {
        cur += c;
        if (c === '\\') {
          if (i + 1 < s.length) { cur += s[i + 1]; i++; }
        } else if (c === quote) quote = '';
        continue;
      }
      if (c === '"' || c === "'") { quote = c; cur += c; continue; }
      if (c === '(') paren++;
      else if (c === ')') { if (paren > 0) paren--; }
      else if (c === '[') bracket++;
      else if (c === ']') { if (bracket > 0) bracket--; }
      if (c === ',' && paren === 0 && bracket === 0) {
        parts.push(cur); cur = ''; continue;
      }
      cur += c;
    }
    parts.push(cur);
    return parts;
  }
  function argHasInteractive(argWithParens) {
    const inner = String(argWithParens).replace(/^\(|\)$/g, '');
    for (const sub of splitTopLevelCommas(inner)) {
      if (stripPseudoClasses(sub).hadInteractive) return true;
    }
    return false;
  }
  function nsPrefixSkip(s, i) {
    let j = i;
    if (s[j] === '*') j++;
    else while (j < s.length && IDENT_CHAR_RX.test(s[j])) j++;
    if (s[j] === '|' && s[j + 1] !== '=' && s[j + 1] !== '|') {
      return { skip: j + 1 - i, dropped: true };
    }
    return { skip: 0, dropped: false };
  }
  function stripPseudoClasses(part) {
    let out = '';
    let hadInteractive = false;
    let bracket = 0;
    let quote = '';
    let atBoundary = true;
    const s = String(part);
    for (let i = 0; i < s.length; ) {
      const c = s[i];
      if (atBoundary && bracket === 0 && !quote) {
        const r = nsPrefixSkip(s, i);
        if (r.dropped) { i += r.skip; atBoundary = false; continue; }
      }
      if (quote) {
        out += c;
        if (c === '\\') {
          if (i + 1 < s.length) { out += s[i + 1]; i += 2; continue; }
        } else if (c === quote) quote = '';
        i++;
        continue;
      }
      if (c === '"' || c === "'") { quote = c; out += c; i++; continue; }
      if (c === '[') { bracket++; out += c; i++; continue; }
      if (c === ']') { if (bracket > 0) bracket--; out += c; i++; continue; }
      if (c === ':' && bracket === 0) {
        if (s[i + 1] === ':') { out += '::'; i += 2; continue; }
        let j = i + 1;
        while (j < s.length && IDENT_CHAR_RX.test(s[j])) j++;
        const name = s.slice(i + 1, j).toLowerCase();
        if (name) {
          if (s[j] === '(') {
            let depth = 0;
            let k = j;
            let q = '';
            for (; k < s.length; k++) {
              const cc = s[k];
              if (q) {
                if (cc === '\\') { k++; continue; }
                if (cc === q) q = '';
                continue;
              }
              if (cc === '"' || cc === "'") q = cc;
              else if (cc === '(') depth++;
              else if (cc === ')') { depth--; if (depth === 0) { k++; break; } }
            }
            const arg = s.slice(j, k);
            const fnInteractive =
              INTERACTIVE_PSEUDO_SET.has(name) || argHasInteractive(arg);
            if (fnInteractive) { hadInteractive = true; i = k; continue; }
            out += s.slice(i, k); i = k; continue;
          }
          if (INTERACTIVE_PSEUDO_SET.has(name)) hadInteractive = true;
          i = j; continue;
        }
      }
      out += c;
      atBoundary =
        bracket === 0 &&
        (c === ' ' || c === '>' || c === '+' || c === '~' || c === '(');
      i++;
    }
    return { stripped: out, hadInteractive };
  }
  function substituteAmpersand(sel, parentSel) {
    if (!parentSel || sel.indexOf('&') === -1) return sel;
    const repl = ':is(' + parentSel + ')';
    let out = '';
    let bracket = 0;
    let quote = '';
    const s = String(sel);
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quote) {
        out += c;
        if (c === '\\') { if (i + 1 < s.length) { out += s[i + 1]; i++; } }
        else if (c === quote) quote = '';
        continue;
      }
      if (c === '"' || c === "'") { quote = c; out += c; continue; }
      if (c === '\\') {
        out += c;
        if (i + 1 < s.length) { out += s[i + 1]; i++; }
        continue;
      }
      if (c === '[') bracket++;
      else if (c === ']') { if (bracket > 0) bracket--; }
      if (c === '&' && bracket === 0) { out += repl; continue; }
      out += c;
    }
    return out;
  }
  function normalizeStripped(s) {
    let out = String(s).replace(/\|\|/g, ' ');
    out = out.replace(/\s+/g, ' ').trim();
    if (out === '') return '*';
    if (/^[>+~]/.test(out)) out = '* ' + out;
    if (/[>+~]$/.test(out)) out = out + ' *';
    out = out.replace(/([>+~])\s*([>+~])/g, '$1 * $2');
    return out;
  }
  function extractSimpleSubSelectors(sel) {
    const subs = new Set();
    const s = String(sel);
    for (const m of s.matchAll(/[#.](?:\\.|[\w-])+/g)) subs.add(m[0]);
    for (const m of s.matchAll(
      /(?:^|[\s>+~(,])(?:[A-Za-z_-][\w-]*\|)?([A-Za-z][\w-]*)/g,
    )) {
      if (m[1]) subs.add(m[1]);
    }
    return [...subs];
  }

  // ── Statik-Detektion (Port der IIFE Z.~2858-3113) — NUR die MEDIA-Achse ───
  const SAFE_MEDIA_TOKENS = new Set([
    'all', 'screen', 'print', 'speech',
    'prefers-color-scheme', 'prefers-reduced-motion', 'prefers-reduced-data',
    'prefers-reduced-transparency', 'prefers-contrast', 'hover', 'any-hover',
    'pointer', 'any-pointer', 'forced-colors', 'scripting', 'color-gamut',
    'monochrome', 'color', 'color-index', 'grid', 'update', 'overflow-block',
    'overflow-inline', 'display-mode', 'inverted-colors', 'dynamic-range',
  ]);
  const MEDIA_KEYWORDS = new Set(['and', 'or', 'not', 'only', 'min', 'max']);
  function mediaIsViewportDependent(mediaText) {
    const txt = String(mediaText || '').toLowerCase();
    if (!txt.trim()) return false;
    const groups = txt.match(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g) || [];
    for (const g of groups) {
      const inner = g.slice(1, -1).trim();
      if (!inner) continue;
      if (/[a-z-]+\s*\(/.test(inner)) return true;
      const nameMatch = inner.match(/^[a-z][a-z-]*/);
      if (!nameMatch) return true;
      let feature = nameMatch[0];
      if (feature.startsWith('min-')) feature = feature.slice(4);
      else if (feature.startsWith('max-')) feature = feature.slice(4);
      if (!SAFE_MEDIA_TOKENS.has(feature)) return true;
    }
    const bare = txt.replace(/\([^()]*\)/g, ' ');
    for (const tok of bare.match(/[a-z][a-z-]*/g) || []) {
      if (MEDIA_KEYWORDS.has(tok)) continue;
      if (!SAFE_MEDIA_TOKENS.has(tok)) return true;
    }
    return false;
  }

  const mediaDependentElements = new Set();
  function pushPart(rawPart, parentSel, scopePrefix, mediaDependent) {
    if (!mediaDependent) return; // NUR die Media-Achse (kein State/SMIL hier).
    let eff = parentSel ? substituteAmpersand(rawPart, parentSel) : rawPart;
    if (scopePrefix && eff.trim()) eff = `${scopePrefix} ${eff.trim()}`;
    const { stripped } = stripPseudoClasses(eff);
    const sel = normalizeStripped(stripped);
    if (!sel) return;
    const addSubtree = (node) => {
      mediaDependentElements.add(node);
      for (const d of node.querySelectorAll('*')) mediaDependentElements.add(d);
    };
    const matchRootSelf = (s) => {
      try { if (svg.matches(s)) { addSubtree(svg); return true; } } catch {}
      return false;
    };
    try {
      const hits = svg.querySelectorAll(sel);
      for (const el of hits) addSubtree(el);
      matchRootSelf(sel);
      return;
    } catch {}
    let salvaged = false;
    for (const sub of extractSimpleSubSelectors(sel)) {
      try {
        const hits = svg.querySelectorAll(sub);
        for (const el of hits) { addSubtree(el); salvaged = true; }
        if (matchRootSelf(sub)) salvaged = true;
      } catch {}
    }
    if (salvaged) return;
    const allNodes = [svg, ...svg.querySelectorAll('*')];
    for (const n of allNodes) mediaDependentElements.add(n);
  }
  function collect(rules, parentSel, scopePrefix, mediaCtx) {
    for (const rule of rules) {
      if (rule.styleSheet) {
        let importMedia = mediaCtx;
        try {
          if (rule.media && rule.media.length > 0)
            importMedia = mediaCtx || mediaIsViewportDependent(rule.media.mediaText);
        } catch {}
        try {
          if (rule.styleSheet.cssRules)
            collect(rule.styleSheet.cssRules, parentSel, scopePrefix, importMedia);
        } catch {}
        continue;
      }
      if (
        (rule.constructor && rule.constructor.name === 'CSSScopeRule') ||
        (rule && typeof rule === 'object' && 'start' in rule && 'end' in rule)
      ) {
        for (const prelude of [
          rule.start || '',
          ...(rule.end && rule.end.trim() ? [rule.end] : []),
        ]) {
          for (const part of splitTopLevelCommas(prelude))
            pushPart(part, parentSel, scopePrefix, mediaCtx);
        }
        const scopeRoot =
          stripPseudoClasses(rule.start || '').stripped.trim() || null;
        if (rule.cssRules) collect(rule.cssRules, scopeRoot, scopeRoot, mediaCtx);
        continue;
      }
      if (rule.selectorText != null) {
        let eff = parentSel
          ? substituteAmpersand(rule.selectorText, parentSel)
          : rule.selectorText;
        if (scopePrefix && eff.trim()) eff = `${scopePrefix} ${eff.trim()}`;
        for (const part of splitTopLevelCommas(eff))
          pushPart(part, null, null, mediaCtx);
        if (rule.cssRules) collect(rule.cssRules, eff, null, mediaCtx);
        continue;
      }
      if (rule.constructor && rule.constructor.name === 'CSSMediaRule') {
        const cond =
          (rule.media && rule.media.mediaText) || rule.conditionText || '';
        const mediaNow = mediaCtx || mediaIsViewportDependent(cond);
        if (rule.cssRules) collect(rule.cssRules, parentSel, scopePrefix, mediaNow);
        continue;
      }
      if (rule.cssRules) collect(rule.cssRules, parentSel, scopePrefix, mediaCtx);
    }
  }
  const sheets = [
    ...document.styleSheets,
    ...(document.adoptedStyleSheets || []),
  ];
  for (const sheet of sheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    if (rules) collect(rules, null, null, false);
  }

  // ── use-href-Graph-Propagation (Port Z.~3261-3285) ────────────────────────
  const allUses = [...svg.querySelectorAll('use')];
  function useRefOf(u) {
    const h = u.getAttribute('href') || u.getAttribute('xlink:href');
    if (h && h.charCodeAt(0) === 35) return document.getElementById(h.slice(1));
    return null;
  }
  const propagateUseGraph = (set) => {
    const refInstantiatesInSet = (ref) => {
      if (!ref) return false;
      if (set.has(ref)) return true;
      for (const d of ref.querySelectorAll('*')) if (set.has(d)) return true;
      return false;
    };
    let added = true;
    while (added) {
      added = false;
      for (const u of allUses) {
        if (set.has(u)) continue;
        if (refInstantiatesInSet(useRefOf(u))) {
          set.add(u);
          for (const d of u.querySelectorAll('*')) set.add(d);
          added = true;
        }
      }
    }
  };
  propagateUseGraph(mediaDependentElements);

  // ── url(#)-Referenz-Graph-Propagation (Port von §HEAL F-AT-7-01 I2, Produktiv
  // Z.~3313) ── BYTE-GLEICHER SPIEGEL: jede Abweichung zur Produktiv-propagate-
  // RefGraph bricht __measureStaticMediaParityCheck. Selbe REF_PROPS, selbe url(#)-
  // Regex, selber Fixpunkt über ALLE Elemente, selbe dangling-skip-Regel (kein
  // Über-Flag). Mutiert NUR mediaDependentElements (STATE-neutral).
  const propagateRefGraph = (set) => {
    const REF_PROPS = [
      'fill', 'stroke', 'clipPath', 'filter', 'mask', 'maskImage',
      'markerStart', 'markerMid', 'markerEnd',
    ];
    const refAll = svg.querySelectorAll('*');
    const refTargetsInSet = (el) => {
      const cs = getComputedStyle(el);
      for (let k = 0; k < REF_PROPS.length; k++) {
        const v = cs[REF_PROPS[k]];
        if (typeof v !== 'string' || v.indexOf('url(') === -1) continue;
        const rx = /url\(["']?#([^"')]+)["']?\)/g;
        let m;
        while ((m = rx.exec(v)) !== null) {
          const ref = document.getElementById(m[1]);
          if (!ref) continue; // dangling → malt nichts → nicht viewport-abh.
          if (set.has(ref)) return true;
          for (const d of ref.querySelectorAll('*'))
            if (set.has(d)) return true;
        }
      }
      return false;
    };
    let added = true;
    while (added) {
      added = false;
      for (const el of refAll) {
        if (set.has(el)) continue;
        if (refTargetsInSet(el)) {
          set.add(el);
          added = true;
        }
      }
    }
  };
  propagateRefGraph(mediaDependentElements);

  // ── KB1 LINCHPIN: auf die EMITTIERTE Produktiv-media_dependent-Menge filtern ──
  // Das rohe mediaDependentElements-Set enthält (via addSubtree/querySelectorAll
  // '*') AUCH nicht-emittierbare Knoten: SKIP_TAGS (defs/marker/clipPath/…/stop)
  // und Kinder von Definitions-Containern (rect IN einem <marker>/<pattern>). Der
  // Produktiv-Walk (Z.3287-3320) EMITTIERT media_dependent NUR für ein Element, das
  // BEIDE Container-Gates passiert — SKIP_TAGS (Z.3289) und el.closest('defs,
  // symbol,clipPath,mask,pattern,marker') (Z.3295). Die zwei Visibility-Gates
  // (Z.3320 invisibleNow, Z.3553 geomEmpty) sind für media_dependent BEWUSST
  // DURCHLÄSSIG (`&& !media_dependent` in beiden Bedingungen) → ein media-bedingt
  // unsichtbares/0×0-Element WIRD emittiert (zusätzliche Viewport-Wahrheit). Die
  // EMITTIERTE Menge ist daher EXAKT: media_dependent ∩ ¬SKIP_TAGS ∩ ¬closest(def).
  // Ohne diesen Filter loggte der golden-diff Def-Kinder (n2/n3) als STATIC_ONLY-
  // Rauschen — strukturell falsch. Def-Abhängigkeiten kommen über die Paint-Closure
  // (Achse C) zum HOST, NICHT als STATIC_ONLY auf dem nicht-emittierbaren Def-Knoten.
  // SKIP_TAGS: lowercase aus dem SSOT (element_vocabulary.js SKIP_TAGS) — exakt der
  // Browser-seitige `new Set(skipTagsArr)` des Produktiv-Walks (Z.953). Inline-
  // Kopie, weil dieser evaluate vollständig selbst-enthalten in der Sandbox läuft.
  const STATIC_SKIP_TAGS = new Set([
    'defs', 'title', 'desc', 'metadata', 'style', 'script', 'g', 'filter',
    'clippath', 'mask', 'symbol', 'marker', 'stop',
  ]);
  function isEmittableMediaDependent(el) {
    const tag = el.tagName ? el.tagName.toLowerCase() : '?';
    if (STATIC_SKIP_TAGS.has(tag)) return false;
    // closest() matcht den QUALIFIZIERTEN SVG-Namen (camelCase clipPath/…), EXAKT
    // wie der Produktiv-Walk Z.3295 — NICHT mit STATIC_SKIP_TAGS vermischen
    // (die testet lowercase tagName; closest() den Namespace-Namen).
    if (el.closest('defs,symbol,clipPath,mask,pattern,marker')) return false;
    return true;
  }

  // ── Auf qSA('*')-Index abbilden (DIESELBEN Keys wie MEASURE_WALK_FN) ──────
  const all = svg.querySelectorAll('*');
  const indices = [];
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (mediaDependentElements.has(el) && isEmittableMediaDependent(el))
      indices.push(i);
  }
  return { indices };
};

/**
 * TEST-ONLY (Increment-2 Beweis): der ZWEITE Viewport + Straddle. EIN setContent,
 * dann eine setViewportSize-Schleife über die abgeleiteten Straddle-Viewports
 * (§1 Opt.B); pro Pass ein getBoundingClientRect-Flush (R1-Gegenmittel) gefolgt
 * von MEASURE_WALK_FN (Increment-1). Liefert pro Viewport die rohen Records +
 * matchMedia-Divergenz-Telemetrie + Marker. KEIN golden-diff, KEIN Produktiv-
 * Eingriff (das ist Increment-3-Scope).
 *
 * K2: die Schleife läuft in try/finally; im finally wird der Viewport auf
 * 1920×1080 zurückgesetzt + geflusht — auch bei Throw mitten in der Schleife.
 * K7: Sample-Budget (MEASURE_MAX_BREAKPOINTS) + per-Pass-Timeout (Marker bei
 * Überschreitung). K6: matchMedia-Branch-Divergenz pro bp.
 *
 * PHASE 0: eigenständig aufrufbar (kein Flag-Gate); NICHT in resolve() getriggert.
 *
 * @param {string} svgString
 * @param {{forceThrowAtPass?:number}} [opts] — TEST-ONLY: erzwingt einen Throw im
 *   N-ten Pass (0-basiert), um den K2-finally-Reset zu beweisen. NIE in Produktion.
 * @returns {Promise<{
 *   viewports:number[],
 *   breakpointsPx:number[],
 *   unresolved:string[],
 *   straddleDivergence:Array<{bp:number,low:number,high:number,matchLow:(boolean|null),matchHigh:(boolean|null),diverges:boolean}>,
 *   records:Object<string,{records:Object}>,
 *   markers:string[],
 *   resetViewport:{width:number,height:number}
 * }|{error:string,message?:string}|null>}
 */
export async function __measureMediaShadowStraddle(svgString, opts = {}) {
  if (!svgString || typeof svgString !== 'string')
    return { error: 'INVALID_INPUT' };
  const forceThrowAtPass =
    Number.isInteger(opts.forceThrowAtPass) && opts.forceThrowAtPass >= 0
      ? opts.forceThrowAtPass
      : -1;
  const { clean, sanitizeFailed } = sanitizeSvg(svgString);
  if (sanitizeFailed) return { error: 'SANITIZE_FAILED' };
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:white">${clean}</body></html>`;
  const autoIdHashPrefix = computeSvgHashPrefix(clean);
  return pageMutex.runExclusive(async () => {
    if (!activePage || !browser || browserDead || !browser.isConnected()) {
      return { error: 'LOAD_FAILED', message: 'Renderer nicht initialisiert' };
    }
    // §7 lazy Numerik-Selbsttest — EINMAL, fail-LAUT, NIE den Return brechen (K8).
    // Increment-2-Scope: liefert ROHE Straddle-Records (kein golden-diff) → der Walk
    // läuft auch bei Selbsttest-Drift; der Status wird gesetzt.
    await ensureMeasureSelfTest(activePage, autoIdHashPrefix);
    try {
      await activePage.setContent(html, {
        waitUntil: 'domcontentloaded',
        timeout: 5000,
      });
    } catch {
      return { error: 'LOAD_FAILED' };
    }

    const markers = [];
    // ── §5: Breakpoints sammeln (EIGENER evaluate) → Node-Parser ──
    let mediaTexts = [];
    try {
      mediaTexts = await activePage.evaluate(MEASURE_BREAKPOINTS_FN);
    } catch (e) {
      return { error: 'BREAKPOINT_SCAN_FAILED', message: e && e.message };
    }
    const pxSet = new Set();
    const unresolved = [];
    for (const mt of mediaTexts) {
      const { px, unresolved: u } = collectViewportBreakpoints(mt);
      for (const p of px) pxSet.add(p);
      for (const x of u) unresolved.push(x);
    }
    if (unresolved.length > 0) markers.push('MEDIA_BREAKPOINT_UNRESOLVED');

    // K7: Sample-Budget — auf die ersten N (sortierten) Breakpoints begrenzen.
    let bps = [...pxSet].sort((a, b) => a - b);
    if (bps.length > MEASURE_MAX_BREAKPOINTS) {
      bps = bps.slice(0, MEASURE_MAX_BREAKPOINTS);
      markers.push('HEAVY_DETECTION');
    }
    const viewports = deriveStraddles(bps);

    // ── K6-Gate: matchMedia-Branch-Divergenz pro bp (VP−ε vs VP+ε) ──
    // Nur für die per-bp-Querys aus den mediaTexts, die diesen bp px-tragen.
    const straddleDivergence = [];
    // Map bp → Liste der mediaTexts, die diesen bp px-erzeugen (für matchMedia).
    const bpToTexts = new Map();
    for (const mt of mediaTexts) {
      const { px } = collectViewportBreakpoints(mt);
      for (const p of px) {
        if (!bpToTexts.has(p)) bpToTexts.set(p, []);
        bpToTexts.get(p).push(mt);
      }
    }

    const records = {};
    try {
      // (a) matchMedia-Divergenz-Probe pro bp: an bp-1 vs bp+1 messen.
      for (const bp of bps) {
        const low = Math.max(1, Math.trunc(bp) - 1);
        const high = Math.trunc(bp) + 1;
        const texts = bpToTexts.get(bp) || [];
        let matchLow = null;
        let matchHigh = null;
        let diverges = false;
        for (const mt of texts) {
          await activePage.setViewportSize({ width: low, height: MEASURE_VP_HEIGHT });
          void (await activePage.evaluate(() => {
            const s = document.querySelector('svg');
            if (s) void s.getBoundingClientRect();
          }));
          const ml = await activePage.evaluate(MEASURE_MATCHMEDIA_FN, mt);
          await activePage.setViewportSize({ width: high, height: MEASURE_VP_HEIGHT });
          void (await activePage.evaluate(() => {
            const s = document.querySelector('svg');
            if (s) void s.getBoundingClientRect();
          }));
          const mh = await activePage.evaluate(MEASURE_MATCHMEDIA_FN, mt);
          // erste verwertbare Probe als Repräsentant; Divergenz ODER-aggregiert.
          if (matchLow === null) matchLow = ml;
          if (matchHigh === null) matchHigh = mh;
          if (ml !== null && mh !== null && ml !== mh) diverges = true;
        }
        straddleDivergence.push({ bp, low, high, matchLow, matchHigh, diverges });
        if (texts.length > 0 && !diverges) {
          markers.push('MEDIA_STRADDLE_INEFFECTIVE');
        }
      }

      // (b) Mess-Pässe: pro Straddle-Viewport setViewportSize + Flush + Walk.
      let passIdx = 0;
      for (const vp of viewports) {
        await activePage.setViewportSize({ width: vp, height: MEASURE_VP_HEIGHT });
        // R1-Gegenmittel: SYNCHRONER Layout-Flush NACH setViewportSize, VOR Walk
        // (wie Produktiv Z.922). Re-Layout muss vollständig propagiert sein, sonst
        // liefert der Walk einen stale bbox.
        await activePage.evaluate(() => {
          const s = document.querySelector('svg');
          if (s) void s.getBoundingClientRect();
        });
        // TEST-ONLY K2-Beweis: erzwinge einen Throw mitten in der Schleife.
        if (passIdx === forceThrowAtPass) {
          throw new Error(`FORCED_THROW_AT_PASS_${passIdx}`);
        }
        // K7: per-Pass-Timeout — überschreitet ein Pass das Budget, ehrlich
        // markieren (kein stilles Hängen an der Mutex). Promise.race gegen Timeout.
        let timer;
        const timeout = new Promise((_, rej) => {
          timer = setTimeout(
            () => rej(new Error('PASS_TIMEOUT')),
            MEASURE_PASS_TIMEOUT_MS,
          );
        });
        try {
          const out = await Promise.race([
            activePage.evaluate(MEASURE_WALK_FN, { hashPrefix: autoIdHashPrefix }),
            timeout,
          ]);
          records[vp] = out;
        } catch (e) {
          if (e && e.message === 'PASS_TIMEOUT') {
            markers.push('HEAVY_DETECTION');
            records[vp] = { error: 'PASS_TIMEOUT' };
          } else {
            throw e;
          }
        } finally {
          clearTimeout(timer);
        }
        passIdx++;
      }
    } finally {
      // K2: Viewport-Invariante IMMER wiederherstellen (auch bei Throw) — der
      // Page-Viewport ist global; ein verstellter Viewport würde den nächsten
      // Produktiv-Render verfälschen. setViewportSize + Flush.
      try {
        await activePage.setViewportSize({
          width: MEASURE_BASELINE_VP,
          height: MEASURE_VP_HEIGHT,
        });
        await activePage.evaluate(() => {
          const s = document.querySelector('svg');
          if (s) void s.getBoundingClientRect();
        });
      } catch (_) {
        // never-throw aus dem finally: ein Reset-Fehler darf den ursprünglichen
        // Fehler/das Resultat nicht verschlucken; ehrlich markieren wäre hier
        // nutzlos (Page evtl. tot) → still lassen, der nächste Render re-initialisiert.
      }
    }

    return {
      viewports,
      breakpointsPx: bps,
      unresolved,
      straddleDivergence,
      records,
      // Marker dedupliziert (mehrfaches HEAVY_DETECTION/INEFFECTIVE → einmal).
      markers: [...new Set(markers)],
      resetViewport: { width: MEASURE_BASELINE_VP, height: MEASURE_VP_HEIGHT },
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// MESS-PRIMITIV / INCREMENT-3 — golden-diff + Produktiv-Wiring
// (impl_plan.md §6.2/§6.3/§9, Inc-3-Scope)
//
// runMediaGoldenDiff(page, html, autoIdHashPrefix): die KERN-Maschine. Sie läuft
// AUF DER ÜBERGEBENEN page und setzt voraus, dass der Aufrufer den Mutex hält
// (resolve-Eingriff ist bereits IN runExclusive; die Test-Exporte halten ihn
// selbst). Sie führt aus, in dieser Reihenfolge:
//   1. EIN setContent (frischer DOM @1920).
//   2. Breakpoint-Scan (MEASURE_BREAKPOINTS_FN) → Node-Parser (collectViewport
//      Breakpoints) → Straddle-Viewports (deriveStraddles), K7-Budget.
//   3. PRO Straddle-Viewport: setViewportSize + Flush + ZWEI MEASURE_WALK_FN-
//      Walks = Diff(A,A)-Gate am ECHTEN Straddle-Set. Drift → MIRROR_FLAKE_AA
//      LAUT + Schatten-Resultat für DIESES SVG verwerfen (Inc-2-Restrisiko-
//      Sicherung, PFLICHT). Der ERSTE der beiden Walks ist zugleich der Mess-
//      Record dieses Viewports.
//   4. Statik-Detektion (MEASURE_STATIC_MEDIA_FN) @1920 (DOM-invariant) → Index-Set.
//   5. golden-diff: MEASURED (≥1 Achse divergiert über die Straddle-Records) vs.
//      STATIC (Index-Set) → MEASURED_ONLY / STATIC_ONLY / AGREE.
//   6. console.warn-Marker MIRROR_GOLDEN_MEDIA_DIFF (KEIN Reporting-Vertrag).
// K2: try/finally — Viewport IMMER auf 1920×1080 zurück + Flush, auch bei Throw.
// NIE-THROW: jeder interne Fehler → Marker + null-Diff; der Aufrufer (resolve)
// ignoriert das Resultat vollständig (Output strikt unverändert).
//
// Rückgabe (NUR Telemetrie, NIE in resolve()-Return): {
//   measuredOnly, staticOnly, agree, measuredKeys, staticKeys, aaFlake,
//   objectBoundingBoxKeys, markers, viewports
// } | null.

/** KB9: ε_geom — geom-Komponenten vor dem Diff deterministisch auf 4 NK runden.
 *  Diff(A,A) same-viewport ist byte-stabil (bestätigt); dies härtet den CROSS-
 *  Viewport-Vergleich gegen CTM-Float-Jitter (responsive/Straddle), wo Re-Layout
 *  sub-εNK-Reste erzeugen kann, die KEINE echte media-Abhängigkeit sind. 4 NK =
 *  10^-4 user-units — weit unter jeder visuell/spotter-relevanten Schwelle, aber
 *  über dem Float-Rausch-Boden. -0 → 0 normalisieren (Vorzeichen-Jitter). */
const GEOM_EPS_DECIMALS = 4;
function roundGeom(g) {
  if (!Array.isArray(g)) return g;
  const f = 10 ** GEOM_EPS_DECIMALS;
  return g.map((v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return v;
    const r = Math.round(v * f) / f;
    return r === 0 ? 0 : r; // -0 → 0
  });
}

/** Kanonische, sortierte Serialisierung EINES Element-Records über die 3 Diff-
 *  Achsen (geom/style/closure). authorId/tag = Identität (kein Divergenz-Signal);
 *  objectBoundingBox/motionExcluded = EHRLICHE Flaggen (kein Divergenz-Signal).
 *  geom wird KB9-gerundet (ε_geom) — robust gegen Cross-Viewport-Float-Jitter. */
function canonRecordAxes(rec) {
  if (!rec || typeof rec !== 'object') return 'null';
  const sortDeep = (v) => {
    if (Array.isArray(v)) return v.map(sortDeep);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = sortDeep(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(
    sortDeep({ geom: roundGeom(rec.geom), style: rec.style, closure: rec.closure }),
  );
}

/**
 * KERN-Maschine (Inc-3). Läuft auf `page`; Aufrufer hält den Mutex. NIE-THROW.
 *
 * @param {import('playwright').Page} page
 * @param {string} html
 * @param {string} autoIdHashPrefix
 * @returns {Promise<object|null>}
 */
async function runMediaGoldenDiff(page, html, autoIdHashPrefix) {
  const markers = [];
  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 5000 });
  } catch {
    return null; // LOAD_FAILED im Schatten → still verwerfen (Produktiv unberührt).
  }

  // (2) Breakpoint-Scan → Straddle-Viewports.
  let mediaTexts = [];
  try {
    mediaTexts = await page.evaluate(MEASURE_BREAKPOINTS_FN);
  } catch (e) {
    markers.push('BREAKPOINT_SCAN_FAILED');
    return { measuredOnly: [], staticOnly: [], agree: [], measuredKeys: [], staticKeys: [], aaFlake: false, objectBoundingBoxKeys: [], markers, viewports: [] };
  }
  const pxSet = new Set();
  const unresolved = [];
  for (const mt of mediaTexts) {
    const { px, unresolved: u } = collectViewportBreakpoints(mt);
    for (const p of px) pxSet.add(p);
    for (const x of u) unresolved.push(x);
  }
  if (unresolved.length > 0) markers.push('MEDIA_BREAKPOINT_UNRESOLVED');
  let bps = [...pxSet].sort((a, b) => a - b);
  if (bps.length > MEASURE_MAX_BREAKPOINTS) {
    bps = bps.slice(0, MEASURE_MAX_BREAKPOINTS);
    markers.push('HEAVY_DETECTION');
  }
  const viewports = deriveStraddles(bps);

  // KB5 (K6-Gate ins Produktiv-golden-diff): matchMedia-Branch-Divergenz pro bp.
  // Die straddelnden Viewports MÜSSEN für mindestens einen mediaText, der diesen bp
  // px-erzeugt, UNTERSCHIEDLICH matchen — sonst fallen VP−ε und VP+ε in denselben
  // @media-Zweig, der „Straddle" ist WIRKUNGSLOS und ein gemessener Diff wäre nicht
  // diesem bp zuzuordnen → MEDIA_STRADDLE_INEFFECTIVE laut (kein false-green).
  // Spiegel des Test-Exports __measureMediaShadowStraddle (Z.~5444-5489).
  const flushFn = () => {
    const s = document.querySelector('svg');
    if (s) void s.getBoundingClientRect();
  };
  const bpToTexts = new Map();
  for (const mt of mediaTexts) {
    const { px } = collectViewportBreakpoints(mt);
    for (const p of px) {
      if (!bpToTexts.has(p)) bpToTexts.set(p, []);
      bpToTexts.get(p).push(mt);
    }
  }
  try {
    for (const bp of bps) {
      const low = Math.max(1, Math.trunc(bp) - 1);
      const high = Math.trunc(bp) + 1;
      const texts = bpToTexts.get(bp) || [];
      let diverges = false;
      for (const mt of texts) {
        await page.setViewportSize({ width: low, height: MEASURE_VP_HEIGHT });
        await page.evaluate(flushFn);
        const ml = await page.evaluate(MEASURE_MATCHMEDIA_FN, mt);
        await page.setViewportSize({ width: high, height: MEASURE_VP_HEIGHT });
        await page.evaluate(flushFn);
        const mh = await page.evaluate(MEASURE_MATCHMEDIA_FN, mt);
        if (ml !== null && mh !== null && ml !== mh) { diverges = true; break; }
      }
      if (texts.length > 0 && !diverges) markers.push('MEDIA_STRADDLE_INEFFECTIVE');
    }
  } catch (_) {
    // matchMedia-Probe ist Telemetrie; ein Fehler darf den golden-diff nicht brechen.
    markers.push('MEDIA_STRADDLE_PROBE_FAILED');
  }

  // (3) Pro Straddle-Viewport: Diff(A,A)-Gate (ZWEI Walks) am ECHTEN Set.
  const measuredRecords = {}; // vp -> records (erster Walk)
  let aaFlake = false;
  // KB6 (K7 ins Produktiv-golden-diff): per-Pass-Timeout (Promise.race) wie der
  // Test-Export — überschreitet ein einzelner Walk MEASURE_PASS_TIMEOUT_MS, wird
  // der Schatten verworfen/HEAVY_DETECTION markiert, statt die Mutex (und damit den
  // Produktiv-Return) unbegrenzt zu blockieren. NIE-THROW nach außen.
  const racePass = async (label, fn) => {
    let timer;
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error('PASS_TIMEOUT')), MEASURE_PASS_TIMEOUT_MS);
    });
    try {
      return await Promise.race([fn(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
  let passTimedOut = false;
  try {
    for (const vp of viewports) {
      await page.setViewportSize({ width: vp, height: MEASURE_VP_HEIGHT });
      await page.evaluate(flushFn);
      let a, b;
      try {
        a = await racePass(`walk-a@${vp}`, () =>
          page.evaluate(MEASURE_WALK_FN, { hashPrefix: autoIdHashPrefix }),
        );
        await page.evaluate(flushFn);
        b = await racePass(`walk-b@${vp}`, () =>
          page.evaluate(MEASURE_WALK_FN, { hashPrefix: autoIdHashPrefix }),
        );
      } catch (e) {
        if (e && e.message === 'PASS_TIMEOUT') {
          // Echtes Walk-Hang (Pass > MEASURE_PASS_TIMEOUT_MS): Schatten verwerfen
          // (kein irreführender Teil-Diff), HEAVY_DETECTION ehrlich markieren.
          passTimedOut = true;
          markers.push('HEAVY_DETECTION');
          break;
        }
        throw e;
      }
      // Diff(A,A): die ZWEI Walks am SELBEN Viewport MÜSSEN byte-identisch sein.
      const ra = (a && a.records) || {};
      const rb = (b && b.records) || {};
      const ka = Object.keys(ra).sort();
      const kb = Object.keys(rb).sort();
      let identical = ka.length === kb.length && ka.every((k, i) => k === kb[i]);
      if (identical) {
        for (const k of ka) {
          if (canonRecordAxes(ra[k]) !== canonRecordAxes(rb[k])) { identical = false; break; }
        }
      }
      if (!identical) {
        aaFlake = true;
        console.warn(
          `MIRROR_FLAKE_AA: Diff(A,A) am Straddle-Viewport ${vp}px NICHT byte-identisch — ` +
          `Schatten-Resultat für dieses SVG VERWORFEN (kein false-positive eingespeist).`,
        );
      }
      measuredRecords[vp] = ra;
    }
  } finally {
    // K2: Viewport-Invariante IMMER wiederherstellen (auch bei Throw).
    try {
      await page.setViewportSize({ width: MEASURE_BASELINE_VP, height: MEASURE_VP_HEIGHT });
      await page.evaluate(flushFn);
    } catch (_) {}
  }

  // PFLICHT-Sicherung: AA-Drift → Schatten-Resultat verwerfen (kein Diff einspeisen).
  if (aaFlake) {
    markers.push('MIRROR_FLAKE_AA');
    console.warn(
      'MIRROR_GOLDEN_MEDIA_DIFF: VERWORFEN (MIRROR_FLAKE_AA) — Diff(A,A) instabil, kein golden-diff.',
    );
    return { measuredOnly: [], staticOnly: [], agree: [], measuredKeys: [], staticKeys: [], aaFlake: true, objectBoundingBoxKeys: [], markers: [...new Set(markers)], viewports };
  }

  // KB6-Sicherung: Pass-Timeout → unvollständige Straddle-Records → Schatten
  // verwerfen (kein Teil-Diff, das fälschlich AGREE/MEASURED_ONLY behauptet).
  if (passTimedOut) {
    console.warn(
      'MIRROR_GOLDEN_MEDIA_DIFF: VERWORFEN (HEAVY_DETECTION/PASS_TIMEOUT) — ' +
        'unvollständige Mess-Pässe, kein golden-diff.',
    );
    return { measuredOnly: [], staticOnly: [], agree: [], measuredKeys: [], staticKeys: [], aaFlake: false, objectBoundingBoxKeys: [], markers: [...new Set(markers)], viewports };
  }

  // (4) Statik-Detektion @1920 (DOM-invariant) → Index-Set (gleiche Keys).
  let staticIndices = [];
  try {
    const st = await page.evaluate(MEASURE_STATIC_MEDIA_FN);
    if (st && Array.isArray(st.indices)) staticIndices = st.indices;
    else markers.push('STATIC_DETECTION_FAILED');
  } catch (_) {
    markers.push('STATIC_DETECTION_FAILED');
  }
  const staticKeys = new Set(staticIndices.map((i) => `_${autoIdHashPrefix}_n${i}`));

  // (5) golden-diff. MEASURED = Schlüssel, deren Record über die Straddle-
  // Viewports in ≥1 Achse divergiert. Vergleichsbasis: alle Schlüssel, die in
  // IRGENDEINEM Viewport-Record vorkommen (Index-stabil → identische Key-Menge).
  const allKeys = new Set();
  const obbKeys = new Set();
  const motionKeys = new Set();
  const useKeys = new Set();
  for (const vp of Object.keys(measuredRecords)) {
    for (const k of Object.keys(measuredRecords[vp])) {
      allKeys.add(k);
      const r = measuredRecords[vp][k];
      if (r && r.objectBoundingBox) obbKeys.add(k);
      // KB3: ein in IRGENDEINEM Pass motion-behaftetes Element → ausschließen.
      if (r && r.motionExcluded) motionKeys.add(k);
      // KB10: <use>-Instanz — der Shadow-Subtree ist NICHT in qSA('*') (SVG2 §5.6),
      // also misst der Walk nur den Light-DOM-<use>-Knoten. Ein media-abhängiger
      // Shadow-Inhalt entginge dem Geom/Style/Closure-Diff → über-flaggen statt
      // still grün (USE_INSTANCE_RESIDUAL).
      if (r && r.tag === 'use') useKeys.add(k);
    }
  }
  const vpList = Object.keys(measuredRecords);
  const measuredKeys = new Set();
  const motionExcludedDiverged = new Set();
  for (const k of allKeys) {
    let canon = null;
    let diverges = false;
    for (const vp of vpList) {
      const rec = measuredRecords[vp][k];
      const c = canonRecordAxes(rec); // fehlend → 'null' (Erscheinen/Verschwinden = Diff)
      if (canon === null) canon = c;
      else if (c !== canon) { diverges = true; break; }
    }
    if (diverges) {
      // KB3: divergiert ABER motion-behaftet → NICHT als media werten (Wall-Clock-
      // Drift wäre ein false-positive). Ehrlich als MEDIA_DIFF_MOTION_EXCLUDED loggen.
      if (motionKeys.has(k)) motionExcludedDiverged.add(k);
      else measuredKeys.add(k);
    }
  }

  // ── KB10 ÜBER-FLAGGEN (NIE STILL grün; divergenz-sicherer Marker, nicht nur
  //    Telemetrie): Fälle, in denen der Mess-Diff eine Viewport-Abhängigkeit NICHT
  //    beweisen KANN, werden konservativ als media-abhängig (measured) gewertet.
  const overFlagged = new Set();
  // (a) objectBoundingBox-Host bei bbox-INVARIANTER Geometrie: derselbe Gradient
  //     malt über Viewports andere Tinte, aber Closure-Hash + Host-bbox bleiben
  //     gleich → der Diff sähe es nicht. obbKeys, die NICHT ohnehin divergieren,
  //     über-flaggen (Achse A fängt den bbox-VARIANTEN Fall bereits).
  for (const k of obbKeys) if (!measuredKeys.has(k)) { measuredKeys.add(k); overFlagged.add(k); }
  // (b) <use>-Instanz: Shadow-Subtree unsichtbar für den Walk → über-flaggen.
  for (const k of useKeys) if (!measuredKeys.has(k)) { measuredKeys.add(k); overFlagged.add(k); }
  // (c) em/calc/vw/height/aspect-ratio UNRESOLVED: kein Straddle-Viewport ableitbar
  //     → der Diff kann KEINEN dieser Breakpoints beweisen. Die statisch geflaggten
  //     Kandidaten konservativ über-flaggen (statt sie als false STATIC_ONLY zu
  //     loggen) — MEDIA_BREAKPOINT_UNRESOLVED ist dann eine ECHTE Über-Flag-Brücke.
  if (unresolved.length > 0) {
    for (const k of staticKeys) if (!measuredKeys.has(k)) { measuredKeys.add(k); overFlagged.add(k); }
  }

  const measuredOnly = [];
  const staticOnly = [];
  const agree = [];
  for (const k of measuredKeys) {
    if (staticKeys.has(k)) agree.push(k);
    else measuredOnly.push(k);
  }
  for (const k of staticKeys) {
    if (!measuredKeys.has(k)) staticOnly.push(k);
  }
  measuredOnly.sort();
  staticOnly.sort();
  agree.sort();
  const objectBoundingBoxKeys = [...obbKeys].sort();
  const motionExcludedKeys = [...motionExcludedDiverged].sort();
  const useInstanceResidualKeys = [...useKeys].sort();
  const overFlaggedKeys = [...overFlagged].sort();

  // (6) EHRLICHE Telemetrie. console.warn-Marker (KEIN Reporting-Vertrag).
  // KB10: objectBoundingBox/USE/UNRESOLVED sind ÜBER-Flag-Marker (das betroffene
  // Element wurde konservativ als media gewertet) — nicht nur passive Telemetrie.
  if (objectBoundingBoxKeys.length > 0) {
    markers.push('OBJECT_BOUNDING_BOX_RESIDUAL');
  }
  if (useInstanceResidualKeys.length > 0) {
    markers.push('USE_INSTANCE_RESIDUAL');
  }
  if (motionExcludedKeys.length > 0) {
    markers.push('MEDIA_DIFF_MOTION_EXCLUDED');
  }
  const dedup = [...new Set(markers)];
  console.warn(
    'MIRROR_GOLDEN_MEDIA_DIFF ' +
      JSON.stringify({
        viewports,
        measured_only: measuredOnly,
        static_only: staticOnly,
        agree,
        object_bounding_box_residual: objectBoundingBoxKeys,
        use_instance_residual: useInstanceResidualKeys,
        over_flagged: overFlaggedKeys,
        motion_excluded: motionExcludedKeys,
        markers: dedup,
      }),
  );

  return {
    measuredOnly,
    staticOnly,
    agree,
    measuredKeys: [...measuredKeys].sort(),
    staticKeys: [...staticKeys].sort(),
    aaFlake: false,
    objectBoundingBoxKeys,
    useInstanceResidualKeys,
    overFlaggedKeys,
    motionExcludedKeys,
    markers: dedup,
    viewports,
  };
}

// MEASURE_STATIC_IDS_FN: bildet die KB1-gefilterten Statik-Indizes auf die EMIT-
// IDENTITÄT ab, die der Produktiv-Walk vergibt: `el.id` falls vorhanden, sonst
// null (Auto-ID-Knoten ohne Autor-ID — im Korpus tragen alle EMITTIERBAREN Hosts
// eine Autor-ID, daher ist die Abbildung eindeutig). Liefert die Menge der Autor-
// IDs der statisch als media_dependent EMITTIERBAREN Elemente. Selbst-enthalten.
const MEASURE_STATIC_IDS_FN = (indices) => {
  const svg = document.querySelector('svg');
  if (!svg) return { error: 'NO_SVG_FOUND' };
  const all = svg.querySelectorAll('*');
  const ids = [];
  const nullKeyed = [];
  for (const i of indices) {
    const el = all[i];
    if (!el) continue;
    if (el.id) ids.push(el.id);
    else nullKeyed.push(el.tagName ? el.tagName.toLowerCase() : '?');
  }
  return { ids: ids.sort(), nullKeyed };
};

/**
 * TEST-ONLY (KB2 — ECHTER Paritäts-Selbsttest): assertet, dass die Hand-Port-
 * Statik (MEASURE_STATIC_MEDIA_FN, KB1-gefiltert) EXAKT die media_dependent-Menge
 * liefert, die der ECHTE resolve()-Produktiv-Pfad emittiert — über ein Korpus
 * (Marker-Leck, Pattern-Leck, <g>/<stop>-@media-Szene). Die Wahrheit ist
 * resolve() (`elements[].media_dependent === true` → `elements[].id`). Die Port-
 * Statik wird im SELBEN Mutex auf demselben clean-SVG re-erhoben und ihre
 * EMITTIERBAREN Indizes auf die Autor-IDs abgebildet (MEASURE_STATIC_IDS_FN).
 * GRÜN ⇔ beide ID-Mengen identisch UND kein Def-Kind-Rauschen (nullKeyed leer für
 * Korpus-Szenen, deren EMITTIERBARE Hosts alle Autor-IDs tragen).
 *
 * PHASE 0: eigenständig aufrufbar (kein Flag-Gate). NIE-THROW pro Szene.
 *
 * @param {Array<{name:string, svg:string, ignoreNullKeyed?:boolean}>} [corpus]
 * @returns {Promise<{ok:boolean, scenes:Array<object>}|null>}
 */
export async function __measureStaticMediaParityCheck(corpus) {
  const VB = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"';
  const DEFAULT_CORPUS = [
    {
      name: 'marker-leak',
      // @media auf dem Marker-Inhalt (#m). Produktiv emittiert NUR den Host #p
      // (Def-Kinder #m_rect sind NICHT emittierbar) — Achse C bringt die Def-
      // Abhängigkeit zum Host. Statik MUSS exakt {#p} liefern, ohne #m/#m_rect.
      svg: `<svg ${VB}>
  <style>@media (max-width: 600px) { #m_rect { fill: red; } }</style>
  <defs><marker id="m" markerWidth="10" markerHeight="10"><rect id="m_rect" width="10" height="10"/></marker></defs>
  <path id="p" d="M 0 0 L 90 90" stroke="black" marker-start="url(#m)"/>
</svg>`,
    },
    {
      name: 'pattern-leak',
      // @media auf dem Pattern-Inhalt (#p_rect, Def-Kind). Produktiv emittiert NUR
      // den Host #phost. Statik MUSS {#phost} liefern, ohne #p_rect/#pat.
      // HINWEIS: Host-id bewusst NICHT "target" — DOMPurify strippt id="target"
      // (DOM-Clobbering-Vektor) → die Author-id verschwände, Produktiv (Auto-id)
      // und Port (Author-id) drifteten dann rein durch die id-Strippung, NICHT durch
      // die hier getestete Referenz-Propagation. "phost" überlebt die Sanitize.
      svg: `<svg ${VB}>
  <style>@media (max-width: 600px) { #p_rect { fill: red; } }</style>
  <defs><pattern id="pat" width="10" height="10" patternUnits="userSpaceOnUse"><rect id="p_rect" width="10" height="10"/></pattern></defs>
  <rect id="phost" width="100" height="100" fill="url(#pat)"/>
</svg>`,
    },
    {
      name: 'group-stop-media',
      // @media auf einer <g> (treibt das Kind #c via Kaskade) UND auf einem <stop>
      // (Def-Kind, NICHT emittierbar). Produktiv emittiert die EMITTIERBAREN Hosts
      // (#c) + #grad-host. Statik MUSS dieselbe Host-Menge liefern, KEINE Def-Kinder
      // (#s0/#s1) und KEINE <g>/<stop> (SKIP_TAGS).
      svg: `<svg ${VB}>
  <style>
    @media (min-width: 700px) { #grp circle { stroke: blue; } }
    @media (max-width: 500px) { #s1 { stop-color: lime; } }
  </style>
  <defs><linearGradient id="lg"><stop id="s0" offset="0" stop-color="#f00"/><stop id="s1" offset="1" stop-color="#00f"/></linearGradient></defs>
  <g id="grp"><circle id="c" cx="50" cy="50" r="20" fill="#888"/></g>
  <rect id="gradhost" x="0" y="0" width="40" height="40" fill="url(#lg)"/>
</svg>`,
    },
    {
      name: 'ref-depth2',
      // §HEAL F-AT-7-01 (I2) TIEFE-2-TRANSITIVITÄT (cold-Opus-Pflicht-Beweis):
      // @media auf einem Gradient-<stop> (#deep_stop). Der Pattern-Inhalt #pat_child
      // referenziert via fill=url(#grad) den Gradient; der emittierbare Host #host2
      // referenziert via fill=url(#pat) das Pattern. media_dependent MUSS transitiv
      // zwei Referenz-Hops propagieren: #deep_stop (@media-Hit) → #pat_child (refs
      // #grad-Subtree) → #host2 (refs #pat-Subtree). Produktiv emittiert NUR #host2
      // (alles andere ist Def/SKIP_TAGS). Statik MUSS exakt {#host2} liefern. Genau
      // hier kann der Port-Spiegel von propagateRefGraph driften, wenn der Fixpunkt
      // oder die Subtree-Suche abweicht → die Szene nagelt die Spiegel-Treue fest.
      svg: `<svg ${VB}>
  <style>@media (max-width: 600px) { #deep_stop { stop-color: red; } }</style>
  <defs>
    <linearGradient id="grad"><stop id="deep_stop" offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient>
    <pattern id="pat" width="10" height="10" patternUnits="userSpaceOnUse"><rect id="pat_child" width="10" height="10" fill="url(#grad)"/></pattern>
  </defs>
  <rect id="host2" width="100" height="100" fill="url(#pat)"/>
</svg>`,
    },
  ];
  const scenesIn =
    Array.isArray(corpus) && corpus.length > 0 ? corpus : DEFAULT_CORPUS;
  const scenes = [];
  let ok = true;
  for (const sc of scenesIn) {
    const scene = { name: sc.name, ok: false };
    try {
      // (1) WAHRHEIT: echter resolve()-Output → media_dependent-IDs.
      const real = await resolve(null, sc.svg);
      if (!real || !Array.isArray(real.elements)) {
        scene.error = `resolve-no-elements (${real && real.error})`;
        scenes.push(scene);
        ok = false;
        continue;
      }
      const realIds = real.elements
        .filter((e) => e && e.media_dependent === true && e.id)
        .map((e) => e.id)
        .sort();
      scene.realIds = realIds;

      // (2) PORT-STATIK: im SELBEN Lifecycle re-erheben + auf Autor-IDs abbilden.
      const { clean, sanitizeFailed } = sanitizeSvg(sc.svg);
      if (sanitizeFailed) {
        scene.error = 'SANITIZE_FAILED';
        scenes.push(scene);
        ok = false;
        continue;
      }
      const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:white">${clean}</body></html>`;
      const portRes = await pageMutex.runExclusive(async () => {
        if (!activePage || !browser || browserDead || !browser.isConnected())
          return { error: 'LOAD_FAILED' };
        try {
          await activePage.setContent(html, {
            waitUntil: 'domcontentloaded',
            timeout: 5000,
          });
        } catch {
          return { error: 'LOAD_FAILED' };
        }
        const st = await activePage.evaluate(MEASURE_STATIC_MEDIA_FN);
        if (!st || !Array.isArray(st.indices)) return { error: 'STATIC_FAILED' };
        const mapped = await activePage.evaluate(
          MEASURE_STATIC_IDS_FN,
          st.indices,
        );
        return { indices: st.indices, ...mapped };
      });
      if (portRes.error) {
        scene.error = portRes.error;
        scenes.push(scene);
        ok = false;
        continue;
      }
      scene.portIds = (portRes.ids || []).slice().sort();
      scene.nullKeyed = portRes.nullKeyed || [];

      // (3) Parität: ID-Mengen identisch + (KB1) kein Def-Kind-Rauschen.
      const a = realIds;
      const b = scene.portIds;
      const setsEqual =
        a.length === b.length && a.every((x, i) => x === b[i]);
      const noNoise = sc.ignoreNullKeyed || scene.nullKeyed.length === 0;
      scene.ok = setsEqual && noNoise;
      if (!scene.ok) {
        scene.measuredOnlyVsReal = b.filter((x) => !a.includes(x));
        scene.realOnlyVsPort = a.filter((x) => !b.includes(x));
        ok = false;
      }
    } catch (e) {
      scene.error = `THREW ${e && e.message}`;
      ok = false;
    }
    scenes.push(scene);
  }
  return { ok, scenes };
}

/**
 * TEST-ONLY (Inc-3 Beweis): führt den vollen golden-diff im Produktiv-Lifecycle
 * (Mutex + Sanitize + EIGENE page) aus und gibt das Telemetrie-Resultat zurück.
 * PHASE 0: eigenständig aufrufbar (kein Flag-Gate); NICHT in resolve() getriggert.
 * Beim ERSTEN Aufruf läuft der lazy Numerik-Selbsttest (§7). NIE-THROW.
 *
 * @param {string} svgString
 * @returns {Promise<object|{error:string}|null>}
 */
export async function __measureMediaGoldenDiff(svgString) {
  if (!svgString || typeof svgString !== 'string') return { error: 'INVALID_INPUT' };
  const { clean, sanitizeFailed } = sanitizeSvg(svgString);
  if (sanitizeFailed) return { error: 'SANITIZE_FAILED' };
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:white">${clean}</body></html>`;
  const autoIdHashPrefix = computeSvgHashPrefix(clean);
  return pageMutex.runExclusive(async () => {
    if (!activePage || !browser || browserDead || !browser.isConnected()) {
      return { error: 'LOAD_FAILED', message: 'Renderer nicht initialisiert' };
    }
    // KB7: Selbsttest-ERGEBNIS auswerten — bei Drift/Fehler KEINE golden-diff-Werte,
    // nur ein Marker-Resultat (kein Vergleich gegen driftende Numerik).
    const ok = await ensureMeasureSelfTest(activePage, autoIdHashPrefix);
    if (!ok) {
      console.warn(
        'MIRROR_GOLDEN_MEDIA_DIFF: DEAKTIVIERT (measureSelfTestOk=false) — Numerik-Drift.',
      );
      return {
        measuredOnly: [], staticOnly: [], agree: [], measuredKeys: [],
        staticKeys: [], aaFlake: false, objectBoundingBoxKeys: [],
        motionExcludedKeys: [], markers: ['MEASURE_SELFTEST_FAILED'], viewports: [],
        selfTestOk: false,
      };
    }
    try {
      return await runMediaGoldenDiff(activePage, html, autoIdHashPrefix);
    } catch (e) {
      return { error: 'GOLDEN_DIFF_FAILED', message: e && e.message };
    }
  });
}

/** TEST-ONLY (KB7-Beweis): liest/setzt den Selbsttest-Zustand. Mit `force`=false
 *  lässt sich ein Selbsttest-FEHLER erzwingen (measureSelfTestOk=false), um zu
 *  belegen, dass der Schatten dann KEINE golden-diff-Werte liefert. Reines
 *  Modul-State-Fenster für den Test; NIE in Produktion aufgerufen. */
export function __setMeasureSelfTestState(done, ok) {
  if (typeof done === 'boolean') measureSelfTestDone = done;
  if (typeof ok === 'boolean') measureSelfTestOk = ok;
  return { measureSelfTestDone, measureSelfTestOk };
}

/** TEST-ONLY: liest den aktuellen Page-Viewport (K2-Reset-Beweis). */
export async function __getCurrentViewport() {
  if (!activePage) return null;
  return pageMutex.runExclusive(async () => {
    if (!activePage) return null;
    const vp = activePage.viewportSize();
    return vp ? { width: vp.width, height: vp.height } : null;
  });
}

/**
 * TEST-ONLY (R1-Beweis): fährt EINE explizite Viewport-Folge auf DEMSELBEN DOM
 * (EIN setContent) und gibt pro Schritt den rohen MEASURE_WALK_FN-Record zurück.
 * Existiert AUSSCHLIESSLICH, um den Cross-Pass-Determinismus literal zu belegen:
 * `__measureAtViewports(svg, [1920, 800, 1920])` → records[0] (1920 VOR dem
 * 800-Re-Layout) MUSS byte-identisch zu records[2] (1920 NACH dem 800-Re-Layout)
 * sein. Identische R1-Gegenmittel (Flush nach setViewportSize) + K2-finally-Reset
 * wie __measureMediaShadowStraddle. PHASE 0: eigenständig aufrufbar (kein Flag-Gate).
 *
 * @param {string} svgString
 * @param {number[]} widths  — explizite Viewport-Breiten in Reihenfolge.
 * @returns {Promise<Array<{width:number, walk:object}>|{error:string}|null>}
 */
export async function __measureAtViewports(svgString, widths) {
  if (!svgString || typeof svgString !== 'string')
    return { error: 'INVALID_INPUT' };
  if (!Array.isArray(widths) || widths.length === 0)
    return { error: 'INVALID_WIDTHS' };
  const { clean, sanitizeFailed } = sanitizeSvg(svgString);
  if (sanitizeFailed) return { error: 'SANITIZE_FAILED' };
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:white">${clean}</body></html>`;
  const autoIdHashPrefix = computeSvgHashPrefix(clean);
  return pageMutex.runExclusive(async () => {
    if (!activePage || !browser || browserDead || !browser.isConnected()) {
      return { error: 'LOAD_FAILED', message: 'Renderer nicht initialisiert' };
    }
    try {
      await activePage.setContent(html, {
        waitUntil: 'domcontentloaded',
        timeout: 5000,
      });
    } catch {
      return { error: 'LOAD_FAILED' };
    }
    const steps = [];
    try {
      for (const w of widths) {
        const width = Math.max(1, Math.trunc(Number(w) || MEASURE_BASELINE_VP));
        await activePage.setViewportSize({ width, height: MEASURE_VP_HEIGHT });
        // R1-Gegenmittel: SYNCHRONER Layout-Flush NACH setViewportSize, VOR Walk.
        await activePage.evaluate(() => {
          const s = document.querySelector('svg');
          if (s) void s.getBoundingClientRect();
        });
        const walk = await activePage.evaluate(MEASURE_WALK_FN, {
          hashPrefix: autoIdHashPrefix,
        });
        steps.push({ width, walk });
      }
    } finally {
      // K2: Viewport-Invariante IMMER wiederherstellen.
      try {
        await activePage.setViewportSize({
          width: MEASURE_BASELINE_VP,
          height: MEASURE_VP_HEIGHT,
        });
        await activePage.evaluate(() => {
          const s = document.querySelector('svg');
          if (s) void s.getBoundingClientRect();
        });
      } catch (_) {}
    }
    return steps;
  });
}
// ═══════════════════════════════════════════════════════════════════════════
// §HEAL-4 (F-AT-7-10 + F-AT-7-11) — LEAN-PRODUKTIV-MESSUNG für analyze/inspect
// (an internal spec, ADR-001 STAND (4) „Korrigierte Flip-Form").
//
// measureViewportDivergence ist der EINZIGE Produktiv-Einstieg der Messung:
// ein lean 2-VP-Diff ([1920, 400] ∪ px-Breakpoint-Straddles) über die 3 Achsen
// des MEASURE_WALK_FN (geom/style/closure, KB9-gerundet via canonRecordAxes).
// Er liefert NUR Divergenz-Deskriptoren — die Flag-Projektion (media_dependent
// OR-only) macht pipeline.js. NIE in resolve() (breaker-getimter Pfad, Phase-0-
// Lehre: 330ms → 5153ms zerstört).
//
// VORBEDINGUNGEN (Spec, KEINE Optionen):
//   MK1 — jeder Pass hart gegen MEASURE_LEAN_PASS_TIMEOUT_MS (400ms) geract;
//         GESAMT-Deckel MEASURE_LEAN_TOTAL_BUDGET_MS über den ganzen Aufruf
//         (Beleg der Pflicht: heavy450 ≈ 13,6s/Pass ungebremst, P3).
//   MK3 — Timeout/Fehler/Selbsttest-Fail ⇒ { error } (NIE still); der Aufrufer
//         (pipeline.js) setzt den scene-level Marker MEDIA_MEASURE_UNAVAILABLE.
//         Bei Timeout wird die Mess-Page VERWORFEN (ein noch laufender evaluate
//         darf den nächsten Aufruf nicht vergiften); der nächste Aufruf baut
//         lazy eine frische Page.
//   MK5 — SEPARATE Page (activeContext.newPage()) + EIGENER measureMutex.
//         Der pageMutex/activePage wird NIE berührt (P3-Beleg: __measure* hielt
//         den pageMutex 27–51s = F-AT-7-04-Kontention live). Der Produktiv-
//         Render läuft dadurch parallel ungebremst weiter.
//
// DETERMINISMUS (R9): frozen-t0 + fonts.ready macht MEASURE_WALK_FN selbst;
// KB3-motionExcluded-Records werden vom Diff AUSGESCHLOSSEN (Wall-Clock-Drift
// wäre false-positive; NON_DETERMINISTIC_MOTION trägt diese Achse bereits).
// KEIN Date.now/Math.random im DIFF-Pfad — Date.now treibt NUR die Deadline
// (ändert den Ausfall-Marker, nie Mess-WERTE).
//
// SAMPLE-BUDGET (K7-Analog): max. MEASURE_LEAN_MAX_VIEWPORTS Pässe — Baseline
// 1920 + 400 sind IMMER dabei; Straddle-VPs füllen aufsteigend auf. Überzählige
// Breakpoints sind kein stilles Leck: px-@media-Treffer flaggt die STATIK
// bereits vollständig (Parity-Suite), die Messung ist additiv.
// ═══════════════════════════════════════════════════════════════════════════

/** §HEAL-4: zweiter fester Mess-Viewport (Boden-Wahrheits-Paar [1920, 400]). */
const MEASURE_LEAN_SECOND_VP = 400;
/** §HEAL-4 MK1: hartes per-Pass-Race (NICHT die geerbten 4000ms — Leck). */
const MEASURE_LEAN_PASS_TIMEOUT_MS = 400;
/** §HEAL-4 MK1: Gesamt-Mess-Deckel über den kompletten Aufruf. */
const MEASURE_LEAN_TOTAL_BUDGET_MS = 1500;
/** §HEAL-4 K7-Analog: max. Anzahl Mess-Viewports pro Aufruf. */
const MEASURE_LEAN_MAX_VIEWPORTS = 6;

/** §HEAL-4 MK5: EIGENER Mutex — serialisiert NUR Mess-Aufrufe untereinander. */
const measureMutex = new Mutex();
/** §HEAL-4 MK5-HÄRTUNG (Patch-Runde): EIGENER BrowserContext für die Messung.
 *  Pages im SELBEN Context teilen den Renderer-PROZESS — produktiv-Render-Churn
 *  (z.B. N=100-Determinismus-Lauf, Breaker-Pfad) kann einen Mess-Pass über die
 *  400ms-MK1-Deadline stallen → TRANSIENTER MEDIA_MEASURE_UNAVAILABLE-Marker =
 *  R9-Bruch (beobachtet: determinism 23/3 unter Prozess-Last; exklusiv 27/0).
 *  Ein eigener Context bekommt in Chromium einen EIGENEN Renderer-Prozess →
 *  Mess-Pässe sind vom produktiv-Mainthread entkoppelt. MK5 damit vollständig:
 *  eigene Page + eigener Mutex + eigener Prozess. Die SSRF-Denylist (B6) wird
 *  auf dem Mess-Context IDENTISCH installiert — gleiche Trust-Boundary. */
let measureContext = null;
/** §HEAL-4 MK5: eigene, langlebige Mess-Page (lazy aus measureContext). */
let measurePage = null;
/** Generationen-Bindung: Mess-Context/-Page gelten nur für DIESEN Browser. */
let measurePageBrowser = null;
/** §HEAL-4 PATCH R1 (Codex-Blocker, Async-Race): Generations-Token für die
 *  Mess-Page — exakt das launchEpoch-Muster (§1.7). PROBLEM vor dem Patch:
 *  das per Promise.race ABGEKOPPELTE acquire-Promise lief nach einem Timeout
 *  weiter und konnte `measurePage` SPÄTER, AUSSERHALB der Mutex-Sequenz setzen
 *  (Page-Leak / Page des Folgeaufrufs geclobbert / falsche Page geschlossen).
 *  INVARIANTE: nur die AKTUELLE Generation darf die globale Referenz setzen;
 *  jeder Acquire-START und jeder Discard bumpt das Token — ein late-resolve
 *  sieht `gen !== measureGeneration`, schliesst seine EIGENE Page/Context und
 *  fasst den Modul-State NICHT an. */
let measureGeneration = 0;

/** Lazy-Beschaffung der separaten Mess-Page im EIGENEN Context. Liefert null,
 *  wenn kein lebender Browser existiert oder die Generation während der awaits
 *  gewechselt hat (R1: ein nach Timeout abgekoppeltes acquire räumt sich
 *  selbst auf — eigene Page UND eigenen Context schliessen). */
async function acquireMeasurePage() {
  const gen = ++measureGeneration; // R1: dieser Acquire ist die neue Generation.
  if (
    measurePage &&
    !measurePage.isClosed() &&
    measurePageBrowser === browser
  ) {
    return measurePage;
  }
  const stalePage = measurePage;
  const staleCtx = measureContext;
  measurePage = null;
  measureContext = null;
  measurePageBrowser = null;
  if (stalePage && !stalePage.isClosed())
    await stalePage.close().catch(() => {});
  if (staleCtx) await staleCtx.close().catch(() => {});
  const owner = browser;
  if (!owner) return null;
  // MK5-Härtung: eigener Context (= eigener Renderer-Prozess) mit identischem
  // Viewport-Anker und identischer SSRF-Denylist (B6) wie der Produktiv-Context.
  const ctx = await owner.newContext({
    viewport: { width: MEASURE_BASELINE_VP, height: MEASURE_VP_HEIGHT },
  });
  // §HEAL-4 PATCH R7 (Codex-Re-Review): wirft installNetworkDenylist ODER
  // ctx.newPage (z.B. Browser stirbt genau jetzt), BEVOR measureContext gesetzt
  // ist, wäre der frische Context geleakt (keine Referenz mehr → kein discard
  // räumt ihn je). Lokales try/catch: eigenen Context schliessen, dann rethrow
  // — der Aufrufer-catch (measureViewportDivergence) macht daraus den lauten
  // MK3-Ausfall. NICHT fixture-testbar ohne Fault-Injection (der Throw-Punkt
  // liegt zwischen zwei adapter-internen awaits) — Pinning per Code-Review.
  let fresh;
  try {
    await installNetworkDenylist(ctx);
    fresh = await ctx.newPage();
  } catch (err) {
    await ctx.close().catch(() => {});
    throw err;
  }
  // R1 SUPERSEDED-Check (nach den awaits): Timeout-Abkopplung (discard bumpte
  // das Token), ein neuerer Acquire ODER Browser-Recovery → Page+Context
  // gehören niemandem mehr: selbst schliessen, globalen State NICHT anfassen.
  if (gen !== measureGeneration || owner !== browser) {
    await fresh.close().catch(() => {});
    await ctx.close().catch(() => {});
    return null;
  }
  measureContext = ctx;
  measurePage = fresh;
  measurePageBrowser = owner;
  return fresh;
}

/** §HEAL-4 MK3: Mess-Page + Mess-Context hart verwerfen (nach Timeout/Fehler).
 *  Ein noch laufender evaluate stirbt mit dem Context (eigener Renderer-
 *  Prozess wird abgeräumt — kein Zombie-Raster vergiftet Folgeaufrufe); der
 *  NÄCHSTE Aufruf beschafft lazy frisch. R1: bumpt das Generations-Token,
 *  damit ein abgekoppeltes in-flight acquire die globale Referenz NIE mehr
 *  setzt (es schliesst Page+Context selbst). Idempotent, never-throw. */
async function discardMeasurePage() {
  measureGeneration++; // R1: invalidiert alle in-flight acquires.
  const p = measurePage;
  const c = measureContext;
  measurePage = null;
  measureContext = null;
  measurePageBrowser = null;
  if (p) await p.close().catch(() => {});
  if (c) await c.close().catch(() => {});
}

/**
 * §HEAL-4 PRODUKTIV-EINSTIEG: lean Viewport-Divergenz-Messung.
 *
 * @param {string} svgString — roher SVG-String (wird hier eigenständig
 *   sanitized; identische Kanonik wie resolve(): sanitizeSvg + Hash-Präfix).
 * @returns {Promise<{viewports:number[], diverged:Array<{key:string, tag:string,
 *   authorId:(string|null), geomBase:(number[]|null)}>}|{error:string, detail?:string}>}
 *   diverged ist key-sortiert (deterministisch); geomBase = KB9-gerundete
 *   Baseline-Geometrie (root-user-units) für die pipeline-seitige Auto-ID-
 *   Projektion. { error } ⇒ Aufrufer MUSS laut markieren (MK3), nie still.
 */
export async function measureViewportDivergence(svgString) {
  if (!svgString || typeof svgString !== 'string')
    return { error: 'INVALID_INPUT' };
  const { clean, sanitizeFailed } = sanitizeSvg(svgString);
  if (sanitizeFailed) return { error: 'SANITIZE_FAILED' };
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:white">${clean}</body></html>`;
  const autoIdHashPrefix = computeSvgHashPrefix(clean);
  return measureMutex.runExclusive(async () => {
    // MK5-Härtung: nur der BROWSER ist die geteilte Ressource — der Mess-
    // Context ist eigenständig (acquireMeasurePage baut ihn lazy).
    if (!browser || browserDead || !browser.isConnected()) {
      return { error: 'LOAD_FAILED', detail: 'Renderer nicht initialisiert' };
    }
    // MK1: Gesamt-Deckel. Date.now treibt NUR die Deadline (Ausfall-Marker),
    // NIE einen Mess-Wert (Diff-Pfad bleibt rein deterministisch).
    const deadlineAt = Date.now() + MEASURE_LEAN_TOTAL_BUDGET_MS;
    const race = (promise, capMs, tag) => {
      const ms = Math.min(capMs, deadlineAt - Date.now());
      // verwaiste Rejection (z.B. evaluate nach page.close) NIE unhandled.
      promise.catch(() => {});
      if (ms <= 0) {
        const e = new Error(tag);
        e.measureTimeout = true;
        return Promise.reject(e);
      }
      let timer;
      return Promise.race([
        promise,
        new Promise((_, rej) => {
          timer = setTimeout(() => {
            const e = new Error(tag);
            e.measureTimeout = true;
            rej(e);
          }, ms);
        }),
      ]).finally(() => clearTimeout(timer));
    };
    try {
      const page = await race(
        acquireMeasurePage(),
        MEASURE_LEAN_TOTAL_BUDGET_MS,
        'PAGE_TIMEOUT',
      );
      if (!page) return { error: 'LOAD_FAILED', detail: 'keine Mess-Page' };
      // ADR-001 Muss-Korrektur 6 (Verfügbarkeits-SPOF, via MK3 abgesichert):
      // Numerik-Selbsttest EINMAL pro Prozess; Drift ⇒ Messung aus + LAUT
      // (kein gröbster Über-Flag — die Statik trägt, additiv ⇒ kein Re-Leak).
      const selfOk = await race(
        ensureMeasureSelfTest(page, autoIdHashPrefix),
        MEASURE_LEAN_TOTAL_BUDGET_MS,
        'SELFTEST_TIMEOUT',
      );
      if (!selfOk) return { error: 'MEASURE_SELFTEST_FAILED' };
      await race(
        page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 5000 }),
        MEASURE_LEAN_TOTAL_BUDGET_MS,
        'SETCONTENT_TIMEOUT',
      );

      // ── Viewport-Plan: [1920, 400] ∪ px-Breakpoint-Straddles (Spec-Tabelle) ──
      const mediaTexts = await race(
        page.evaluate(MEASURE_BREAKPOINTS_FN),
        MEASURE_LEAN_PASS_TIMEOUT_MS,
        'SCAN_TIMEOUT',
      );
      const pxSet = new Set();
      for (const mt of mediaTexts || []) {
        for (const p of collectViewportBreakpoints(mt).px) pxSet.add(p);
      }
      const vps = [MEASURE_BASELINE_VP, MEASURE_LEAN_SECOND_VP];
      for (const v of deriveStraddles([...pxSet])) {
        if (vps.length >= MEASURE_LEAN_MAX_VIEWPORTS) break;
        if (!vps.includes(v)) vps.push(v);
      }

      // ── Mess-Pässe: setViewportSize + Flush + Walk, je hart geract (MK1) ──
      const steps = [];
      for (const w of vps) {
        const pass = (async () => {
          await page.setViewportSize({ width: w, height: MEASURE_VP_HEIGHT });
          // R1-Gegenmittel: synchroner Layout-Flush VOR dem Walk.
          await page.evaluate(() => {
            const s = document.querySelector('svg');
            if (s) void s.getBoundingClientRect();
          });
          return page.evaluate(MEASURE_WALK_FN, {
            hashPrefix: autoIdHashPrefix,
          });
        })();
        const walk = await race(
          pass,
          MEASURE_LEAN_PASS_TIMEOUT_MS,
          'PASS_TIMEOUT',
        );
        if (!walk || walk.error) {
          return { error: 'WALK_FAILED', detail: walk && walk.error };
        }
        steps.push(walk.records || {});
      }
      // K2-Analog: Mess-Page-Viewport zurück auf Baseline (Start-Invariante des
      // nächsten Aufrufs). Ein Reset-Fehler ist KEIN Mess-Fehler (die Werte
      // dieses Aufrufs stehen bereits fest) — aber PATCH R4 (Codex-Blocker):
      // eine Page, deren Reset hängt/wirft, ist potenziell tot/busy und darf
      // NICHT als wiederverwendbare Mess-Page überleben → verwerfen; der
      // nächste Aufruf acquired lazy eine frische (Generations-Token R1).
      try {
        await race(
          page.setViewportSize({
            width: MEASURE_BASELINE_VP,
            height: MEASURE_VP_HEIGHT,
          }),
          MEASURE_LEAN_PASS_TIMEOUT_MS,
          'RESET_TIMEOUT',
        );
      } catch (_) {
        await discardMeasurePage();
      }

      // ── 3-Achsen-Diff: Baseline (Pass 0) vs jeder weitere Pass ──
      // canonRecordAxes = KB9-gerundete, sortierte Kanonik (geom/style/closure);
      // fehlender Record ⇒ 'null' ⇒ Erscheinen/Verschwinden ist ein Diff-Signal.
      const base = steps[0];
      const seen = new Set();
      const diverged = [];
      for (let i = 1; i < steps.length; i++) {
        const other = steps[i];
        const keys = new Set([...Object.keys(base), ...Object.keys(other)]);
        for (const k of keys) {
          if (seen.has(k)) continue;
          const a = base[k];
          const b = other[k];
          // KB3: running CSS/WAAPI-Motion → NIE als media werten (Drift-Schutz).
          if ((a && a.motionExcluded) || (b && b.motionExcluded)) continue;
          if (canonRecordAxes(a) !== canonRecordAxes(b)) {
            seen.add(k);
            const rec = a || b;
            diverged.push({
              key: k,
              tag: rec.tag,
              authorId: rec.authorId || null,
              geomBase: a && Array.isArray(a.geom) ? roundGeom(a.geom) : null,
            });
          }
        }
      }
      diverged.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
      return { viewports: vps, diverged };
    } catch (e) {
      // MK1/MK3: Timeout/Fehler ⇒ Page verwerfen (hängender evaluate stirbt mit
      // ihr) + LAUT signalisieren — der Aufrufer setzt den scene-Marker.
      await discardMeasurePage();
      return {
        error: e && e.measureTimeout ? 'MEASURE_TIMEOUT' : 'MEASURE_FAILED',
        detail: e && e.message,
      };
    }
  });
}
