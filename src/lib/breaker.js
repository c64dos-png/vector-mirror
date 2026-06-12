/**
 * breaker.js — Circuit-Breaker via Opossum 9.x (P1-03, VM-SM-002)
 * Vector Mirror v2.5
 *
 * Schützt den Playwright-Browser vor "Permanent-Bricking" (VM-SM-002):
 * Browser-Crashes oder Hangs öffnen den Breaker, Recovery erfolgt nach
 * `resetTimeout` durch einen Liveness-Probe. User-Eingabefehler (ungültiges
 * SVG, Size-Limit, Security-Violation) zählen NICHT gegen den Breaker —
 * sie sind keine Browser-Fehler.
 *
 * Source-of-truth references:
 *   - FIX_PLAN_2026-04-18 §1.2 P1-03 (revidiert via RB-11)
 *   - RB-11 §6 Option A (Opossum 9.x adoptiert)
 *   - RB-12 — BP/SOTA-Validation 2026-04-26 (Library-Source-of-Truth)
 *   - ADR-030 (Eigenständigkeit) — Präzedenzfall in P1-03 dokumentiert
 *   - KATALOG VM-SM-002 (Permanent-Bricking)
 *   - Reproducer GEMINI-B2 (Browser-Crash-Recovery)
 *
 * Hexagonal-Vertrag: Lib module: keine Imports aus adapters/ oder interface/.
 * `resolve` wird per Dependency-Injection an `createRenderOnce` übergeben.
 *
 * Opossum-Issue #564 Pitfall (relevant für errorFilter):
 *   Wenn die Action einen Error WIRFT, dessen Code von errorFilter mit `true`
 *   markiert wird, RESOLVED Opossum die `fire()`-Promise mit dem Error-Objekt
 *   als Wert (statt zu rejecten). USER-Fehler dürfen daher NIE geworfen werden,
 *   nur als Return-Object durchgereicht. `renderOnce` hält diesen Vertrag.
 */

import CircuitBreaker from 'opossum';

/**
 * Error-Codes aus `playwright.resolve()`, die User-Input-Fehler darstellen.
 * Diese werden als reguläre Returns durchgereicht und zählen NICHT gegen
 * den Breaker (der Browser ist gesund — der Input ist das Problem).
 * @type {ReadonlySet<string>}
 */
export const USER_ERROR_CODES = Object.freeze(
  new Set([
    'INVALID_INPUT',
    'SECURITY_VIOLATION',
    'SVG_TOO_LARGE',
    'NO_SVG_FOUND',
    'EMPTY_SVG',
    'TOO_MANY_ELEMENTS',
    'NO_ELEMENTS',
  ]),
);

/**
 * Error-Codes, die einen Browser-Defekt anzeigen (page.setContent timeout,
 * page.evaluate-Crash). Diese werden als geworfene Fehler weitergereicht,
 * damit der Breaker sie zählen kann.
 * @type {ReadonlySet<string>}
 */
export const BROWSER_ERROR_CODES = Object.freeze(new Set(['LOAD_FAILED']));

/**
 * Erzeugt eine `renderOnce`-Funktion, die einen Browser-Wrapper für `resolve()`
 * darstellt: macht aus Browser-Fehler-Returns geworfene Errors mit `err.code`
 * + `err.kind = 'BROWSER'`. User-Fehler bleiben als Returns durchgereicht.
 *
 * Hexagonal-DI: `resolveFn` wird injiziert (`pipeline.js` importiert sowohl
 * `createRenderOnce` aus breaker.js als auch `resolve` aus playwright.js und
 * verkabelt sie). breaker.js bleibt frei von adapters/-Imports.
 *
 * @param {Function} resolveFn  z.B. `playwright.resolve` (page, svgString) → Result
 * @returns {Function}          (page, svgString) → Promise<Result>
 */
export function createRenderOnce(resolveFn) {
  if (typeof resolveFn !== 'function') {
    throw new TypeError('createRenderOnce: resolveFn muss Function sein');
  }
  return async function renderOnce(page, svgString) {
    if (!page) {
      const err = new Error('Playwright-Page nicht initialisiert');
      err.code = 'NO_PAGE';
      err.kind = 'BROWSER';
      throw err;
    }
    const result = await resolveFn(page, svgString);
    if (
      result &&
      typeof result === 'object' &&
      result.error &&
      BROWSER_ERROR_CODES.has(result.error)
    ) {
      const err = new Error(result.message || result.error);
      err.code = result.error;
      err.kind = 'BROWSER';
      throw err;
    }
    return result;
  };
}

/**
 * Default-Optionen gemäß FIX_PLAN P1-03 + 1xAPI 2026 BP-Defaults
 * (RB-12 §2.1 Quellenabgleich, identisch zu 1xAPI-Snippet).
 * Tests können via `createBreaker(action, { ... })` überschreiben (z.B.
 * `resetTimeout: 50` für schnelle State-Transitions).
 */
export const DEFAULT_BREAKER_OPTS = Object.freeze({
  timeout: 5000, // per-call abort
  errorThresholdPercentage: 50, // 50% Fail-Rate öffnet
  resetTimeout: 30000, // half-open nach 30s
  volumeThreshold: 5, // min 5 Fires vor Trip
  rollingCountTimeout: 10000, // 10s sliding window
  // §1.7 P5 Bulkhead: Singleton-Browser → capacity:1. Parallele Renders
  // konkurrieren sonst um dieselbe Page (pageMutex in playwright.js
  // serialisiert bereits setContent+evaluate; capacity:1 ist die
  // Breaker-Ebene-Defense-in-Depth). Der 2. konkurrente fire wird mit
  // ESEMLOCKED abgewiesen (fireResolve mappt das auf 'Concurrency-Limit
  // erreicht'). Opossum-Semaphore (circuit.js Semaphore(capacity)).
  capacity: 1,
  name: 'render', // Multi-Breaker-Observability
});

/**
 * Default `errorFilter`: USER-Fehler (Input-Probleme) zählen nicht.
 * Browser-Fehler (`kind === 'BROWSER'`) zählen.
 *
 * Opossum-Konvention (RB-12 §2.2): `errorFilter(err) === true` ⇒ Fehler
 * wird IGNORIERT (failure-stat nicht inkrementiert).
 *
 * VORSICHT (Issue #564): Diese Funktion wird nur ausgewertet, wenn die
 * Action einen Error WIRFT. Ein gefilterter Error führt dann dazu, dass
 * `fire()` mit dem Error-Objekt RESOLVED. Daher: USER-Codes dürfen niemals
 * geworfen werden — `renderOnce` hält diesen Vertrag.
 *
 * @param {Error & {code?: string, kind?: string}} err
 * @returns {boolean} true → ignorieren, false → zählen
 */
export function defaultErrorFilter(err) {
  if (!err) return false;
  if (err.kind === 'BROWSER') return false;
  if (err.code && USER_ERROR_CODES.has(err.code)) return true;
  return false;
}

/**
 * Erzeugt einen Circuit-Breaker für die übergebene Action.
 * Die Action wird i.d.R. via `createRenderOnce(resolveFn)` erzeugt.
 *
 * @param {Function} action  z.B. das Resultat von `createRenderOnce(resolve)`
 * @param {object}   [opts]  Override gegen DEFAULT_BREAKER_OPTS
 * @returns {CircuitBreaker}
 */
export function createBreaker(action, opts = {}) {
  if (typeof action !== 'function') {
    throw new TypeError('createBreaker: action muss Function sein');
  }
  const finalOpts = {
    ...DEFAULT_BREAKER_OPTS,
    errorFilter: defaultErrorFilter,
    ...opts,
  };
  return new CircuitBreaker(action, finalOpts);
}

/**
 * Re-Export von `CircuitBreaker.isOurError` für Pipeline-Integration:
 * unterscheidet CB-eigene Rejections (EOPENBREAKER, ETIMEDOUT, ESHUTDOWN,
 * ESEMLOCKED) von Action-Errors. Hilft, structuredContent-Codes korrekt zu
 * mappen (Browser-Defekt vs. Breaker-Schutz).
 *
 * @param {Error} err
 * @returns {boolean} true wenn Error vom Breaker selbst stammt
 */
export const isOurError = CircuitBreaker.isOurError;

/**
 * Liveness-Probe: Race zwischen `page.evaluate(() => 1)` und einem Timeout.
 * Wird in pipeline.init() nach createResolver() aufgerufen, um zu erkennen,
 * ob die Seite wirklich nutzbar ist (Crash-Detection vor erstem Render).
 *
 * Optional kann die Pipeline zusätzlich `breaker.healthCheck(() =>
 * livenessPing(page), 30000)` als Hintergrund-Watchdog verkabeln (Opossum
 * öffnet dann den Breaker bei Reject automatisch). RB-12 §2.4.
 *
 * @param {object} page
 * @param {number} [timeoutMs=1000]
 * @returns {Promise<boolean>}  true bei healthy, wirft sonst
 */
export async function livenessPing(page, timeoutMs = 1000) {
  if (!page) {
    const err = new Error('Playwright-Page nicht initialisiert');
    err.code = 'NO_PAGE';
    throw err;
  }
  let timer;
  const timeoutP = new Promise((_, rej) => {
    timer = setTimeout(() => {
      const err = new Error(`Liveness-Ping Timeout nach ${timeoutMs}ms`);
      err.code = 'LIVENESS_TIMEOUT';
      rej(err);
    }, timeoutMs);
  });
  try {
    const value = await Promise.race([page.evaluate(() => 1), timeoutP]);
    return value === 1;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Komprimiert breaker.stats für `vector_mirror_status` structured-Output.
 * Subset gewählt: 6 Counter + name + semaphoreRejections + latencyMean.
 * RB-12 §2.3 Quellenabgleich.
 *
 * @param {CircuitBreaker} breaker
 * @returns {{
 *   name: string,
 *   state: 'open'|'half-open'|'closed',
 *   fires: number, successes: number, failures: number,
 *   timeouts: number, rejects: number, fallbacks: number,
 *   semaphoreRejections: number, latencyMean: number
 * }}
 */
export function getBreakerStats(breaker) {
  if (!breaker) {
    throw new TypeError('getBreakerStats: breaker required');
  }
  let state = 'closed';
  if (breaker.opened) state = 'open';
  else if (breaker.halfOpen) state = 'half-open';
  const s = breaker.stats;
  return {
    name: breaker.name,
    state,
    fires: s.fires,
    successes: s.successes,
    failures: s.failures,
    timeouts: s.timeouts,
    rejects: s.rejects,
    fallbacks: s.fallbacks,
    semaphoreRejections: s.semaphoreRejections,
    latencyMean: s.latencyMean,
  };
}
