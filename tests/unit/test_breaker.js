/**
 * test_breaker.js — Circuit-Breaker (P1-03 acceptance)
 * Vector Mirror v2.5
 *
 * Validates `src/lib/breaker.js` against:
 *   - FIX_PLAN_2026-04-18 §1.2 P1-03 acceptance criteria
 *   - RB-12 BP/SOTA-Validation (Opossum 9.x canonical)
 *   - VM-SM-002 Permanent-Bricking (BROWSER-Errors trip; USER-Errors don't)
 *   - Reproducer GEMINI-B2 (Browser-Crash-Recovery)
 *
 * Pure Node, no Playwright dependency — Page-Mock + Mock-resolveFn.
 */
import {
  USER_ERROR_CODES,
  BROWSER_ERROR_CODES,
  DEFAULT_BREAKER_OPTS,
  createRenderOnce,
  defaultErrorFilter,
  createBreaker,
  isOurError,
  livenessPing,
  getBreakerStats,
} from '../../src/lib/breaker.js';

let passed = 0,
  failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}`);
    failed++;
  }
}

async function assertThrows(label, fn, codeMatcher) {
  try {
    await fn();
    console.log(`  FAIL: ${label} — expected throw, got resolve`);
    failed++;
  } catch (err) {
    if (
      typeof codeMatcher === 'string'
        ? err.code === codeMatcher
        : codeMatcher(err)
    ) {
      console.log(`  PASS: ${label}`);
      passed++;
    } else {
      console.log(
        `  FAIL: ${label} — code mismatch: got ${err.code} / ${err.message}`,
      );
      failed++;
    }
  }
}

// =============================================================================
// Error-Code Sets
// =============================================================================
console.log('--- USER_ERROR_CODES + BROWSER_ERROR_CODES ---');

assert(
  'USER_ERROR_CODES is frozen Set',
  Object.isFrozen(USER_ERROR_CODES) && USER_ERROR_CODES instanceof Set,
);
assert(
  'USER_ERROR_CODES has all 7 expected codes',
  USER_ERROR_CODES.size === 7 &&
    USER_ERROR_CODES.has('INVALID_INPUT') &&
    USER_ERROR_CODES.has('SECURITY_VIOLATION') &&
    USER_ERROR_CODES.has('SVG_TOO_LARGE') &&
    USER_ERROR_CODES.has('NO_SVG_FOUND') &&
    USER_ERROR_CODES.has('EMPTY_SVG') &&
    USER_ERROR_CODES.has('TOO_MANY_ELEMENTS') &&
    USER_ERROR_CODES.has('NO_ELEMENTS'),
);
assert(
  'BROWSER_ERROR_CODES is frozen Set with LOAD_FAILED',
  Object.isFrozen(BROWSER_ERROR_CODES) &&
    BROWSER_ERROR_CODES.size === 1 &&
    BROWSER_ERROR_CODES.has('LOAD_FAILED'),
);
assert(
  'USER and BROWSER sets are disjoint',
  [...USER_ERROR_CODES].every((c) => !BROWSER_ERROR_CODES.has(c)),
);

// =============================================================================
// DEFAULT_BREAKER_OPTS — BP 2026 alignment (RB-12 §2.1)
// =============================================================================
console.log('--- DEFAULT_BREAKER_OPTS ---');

assert('DEFAULT_BREAKER_OPTS frozen', Object.isFrozen(DEFAULT_BREAKER_OPTS));
assert('timeout = 5000 (1xAPI 2026 BP)', DEFAULT_BREAKER_OPTS.timeout === 5000);
assert(
  'errorThresholdPercentage = 50',
  DEFAULT_BREAKER_OPTS.errorThresholdPercentage === 50,
);
assert('resetTimeout = 30000', DEFAULT_BREAKER_OPTS.resetTimeout === 30000);
assert(
  'volumeThreshold = 5 (override Opossum default 0)',
  DEFAULT_BREAKER_OPTS.volumeThreshold === 5,
);
assert(
  'rollingCountTimeout = 10000',
  DEFAULT_BREAKER_OPTS.rollingCountTimeout === 10000,
);
assert('name = "render"', DEFAULT_BREAKER_OPTS.name === 'render');

// =============================================================================
// createRenderOnce — Dependency Injection
// =============================================================================
console.log('--- createRenderOnce: DI guard ---');

let didThrow = false;
try {
  createRenderOnce(null);
} catch (e) {
  didThrow = e instanceof TypeError;
}
assert('createRenderOnce(null) throws TypeError', didThrow);

didThrow = false;
try {
  createRenderOnce('not a function');
} catch (e) {
  didThrow = e instanceof TypeError;
}
assert('createRenderOnce(string) throws TypeError', didThrow);

assert(
  'createRenderOnce(fn) returns function',
  typeof createRenderOnce(async () => ({})) === 'function',
);

// =============================================================================
// renderOnce wrapper semantics (the heart of P1-03)
// =============================================================================
console.log('--- renderOnce: page guard ---');

const successResolve = async (_page, _svg) => ({ ok: true, value: 42 });
const renderOnceSuccess = createRenderOnce(successResolve);

await assertThrows(
  'renderOnce(null page) throws NO_PAGE',
  () => renderOnceSuccess(null, '<svg/>'),
  'NO_PAGE',
);
await assertThrows(
  'renderOnce(null page) error has kind=BROWSER',
  () => renderOnceSuccess(null, '<svg/>'),
  (e) => e.kind === 'BROWSER',
);

console.log('--- renderOnce: success pass-through ---');
const fakePage = { evaluate: async () => 1 };
const successResult = await renderOnceSuccess(fakePage, '<svg/>');
assert(
  'renderOnce returns resolveFn result on success',
  successResult.ok === true && successResult.value === 42,
);

console.log('--- renderOnce: BROWSER errors throw ---');
const browserResolve = async () => ({
  error: 'LOAD_FAILED',
  message: 'page crashed',
});
const renderOnceBrowser = createRenderOnce(browserResolve);

await assertThrows(
  'LOAD_FAILED return → throws with code=LOAD_FAILED',
  () => renderOnceBrowser(fakePage, '<svg/>'),
  'LOAD_FAILED',
);
await assertThrows(
  'LOAD_FAILED → err.kind = BROWSER',
  () => renderOnceBrowser(fakePage, '<svg/>'),
  (e) => e.kind === 'BROWSER',
);
await assertThrows(
  'LOAD_FAILED → err.message preserved',
  () => renderOnceBrowser(fakePage, '<svg/>'),
  (e) => e.message === 'page crashed',
);

console.log(
  '--- renderOnce: USER errors pass through as returns (Issue #564 mitigation) ---',
);
const userResolve = async () => ({
  error: 'INVALID_INPUT',
  message: 'bad svg',
});
const renderOnceUser = createRenderOnce(userResolve);
const userResult = await renderOnceUser(fakePage, '<bad/>');
assert(
  'USER error returned (NOT thrown)',
  userResult &&
    userResult.error === 'INVALID_INPUT' &&
    userResult.message === 'bad svg',
);

const tooLargeResolve = async () => ({
  error: 'SVG_TOO_LARGE',
  message: 'over limit',
});
const renderOnceTooLarge = createRenderOnce(tooLargeResolve);
const tooLargeResult = await renderOnceTooLarge(fakePage, '<svg/>');
assert(
  'SVG_TOO_LARGE returned (NOT thrown)',
  tooLargeResult.error === 'SVG_TOO_LARGE',
);

// =============================================================================
// defaultErrorFilter
// =============================================================================
console.log('--- defaultErrorFilter ---');

assert('null err → false (count)', defaultErrorFilter(null) === false);
assert(
  'undefined err → false (count)',
  defaultErrorFilter(undefined) === false,
);
assert(
  'BROWSER err → false (count)',
  defaultErrorFilter({ kind: 'BROWSER', code: 'LOAD_FAILED' }) === false,
);
assert(
  'USER err → true (ignore)',
  defaultErrorFilter({ code: 'INVALID_INPUT' }) === true,
);
assert(
  'SVG_TOO_LARGE → true (ignore)',
  defaultErrorFilter({ code: 'SVG_TOO_LARGE' }) === true,
);
assert(
  'SECURITY_VIOLATION → true (ignore)',
  defaultErrorFilter({ code: 'SECURITY_VIOLATION' }) === true,
);
assert(
  'unknown code → false (count)',
  defaultErrorFilter({ code: 'WAT' }) === false,
);
assert(
  'no code → false (count)',
  defaultErrorFilter(new Error('plain')) === false,
);
assert(
  'BROWSER beats USER code (kind has priority)',
  defaultErrorFilter({ kind: 'BROWSER', code: 'INVALID_INPUT' }) === false,
);

// =============================================================================
// createBreaker — DI guard + defaults
// =============================================================================
console.log('--- createBreaker: guards ---');

didThrow = false;
try {
  createBreaker(null);
} catch (e) {
  didThrow = e instanceof TypeError;
}
assert('createBreaker(null) throws TypeError', didThrow);

didThrow = false;
try {
  createBreaker('nope');
} catch (e) {
  didThrow = e instanceof TypeError;
}
assert('createBreaker(string) throws TypeError', didThrow);

console.log('--- createBreaker: instance + defaults ---');
const renderOnceOK = createRenderOnce(successResolve);
const b = createBreaker(renderOnceOK);
assert('breaker has fire method', typeof b.fire === 'function');
assert('breaker has stats getter', typeof b.stats === 'object');
assert('breaker.name = render (default)', b.name === 'render');
assert(
  'breaker initially closed',
  b.closed === true && b.opened === false && b.halfOpen === false,
);

const bOverride = createBreaker(renderOnceOK, {
  name: 'custom',
  resetTimeout: 50,
  volumeThreshold: 2,
});
assert('opts override merges over defaults', bOverride.name === 'custom');

// =============================================================================
// isOurError re-export
// =============================================================================
console.log('--- isOurError ---');

assert('isOurError is function', typeof isOurError === 'function');
assert(
  'isOurError(plain Error) → false',
  isOurError(new Error('user error')) === false,
);
// CB-rejection test deferred to integration block where we trip the breaker.

// =============================================================================
// livenessPing
// =============================================================================
console.log('--- livenessPing ---');

await assertThrows(
  'livenessPing(null) → NO_PAGE',
  () => livenessPing(null),
  'NO_PAGE',
);

const healthyPage = { evaluate: async (fn) => fn() };
const ok = await livenessPing(healthyPage, 200);
assert('healthy page → true', ok === true);

const slowPage = { evaluate: () => new Promise(() => {}) }; // never resolves
await assertThrows(
  'hung page → LIVENESS_TIMEOUT',
  () => livenessPing(slowPage, 50),
  'LIVENESS_TIMEOUT',
);

const wrongValuePage = { evaluate: async () => 999 };
const wrong = await livenessPing(wrongValuePage, 200);
assert('non-1 return value → false', wrong === false);

// =============================================================================
// getBreakerStats
// =============================================================================
console.log('--- getBreakerStats ---');

didThrow = false;
try {
  getBreakerStats(null);
} catch (e) {
  didThrow = e instanceof TypeError;
}
assert('getBreakerStats(null) throws TypeError', didThrow);

const fresh = createBreaker(createRenderOnce(successResolve), {
  name: 'stats-test',
});
const stats = getBreakerStats(fresh);
assert('stats has name', stats.name === 'stats-test');
assert('stats.state = closed initially', stats.state === 'closed');
assert(
  'stats has all 9 BP-2026 fields',
  'fires' in stats &&
    'successes' in stats &&
    'failures' in stats &&
    'timeouts' in stats &&
    'rejects' in stats &&
    'fallbacks' in stats &&
    'semaphoreRejections' in stats &&
    'latencyMean' in stats,
);
assert(
  'fresh breaker stats all zero',
  stats.fires === 0 && stats.successes === 0 && stats.failures === 0,
);

// =============================================================================
// Integration: USER errors NEVER trip the breaker (errorFilter works)
// =============================================================================
console.log('--- Integration: USER errors do NOT trip ---');

let userCallCount = 0;
const flakyUserResolve = async () => {
  userCallCount++;
  return { error: 'INVALID_INPUT', message: 'always bad' };
};
const userBreaker = createBreaker(createRenderOnce(flakyUserResolve), {
  name: 'user-test',
  volumeThreshold: 2,
  resetTimeout: 50,
  rollingCountTimeout: 1000,
});

for (let i = 0; i < 10; i++) {
  await userBreaker.fire(fakePage, '<svg/>');
}
assert(
  'all 10 USER calls executed (breaker stayed closed)',
  userCallCount === 10,
);
assert(
  'breaker still closed after 10 USER errors',
  userBreaker.closed === true,
);
const userStats = getBreakerStats(userBreaker);
assert('failures NOT incremented for USER errors', userStats.failures === 0);

// =============================================================================
// Integration: BROWSER errors trip the breaker (VM-SM-002 fix, GEMINI-B2)
// =============================================================================
console.log('--- Integration: BROWSER errors trip the breaker ---');

let browserCallCount = 0;
const flakyBrowserResolve = async () => {
  browserCallCount++;
  return { error: 'LOAD_FAILED', message: 'browser crashed' };
};
const browserBreaker = createBreaker(createRenderOnce(flakyBrowserResolve), {
  name: 'browser-test',
  volumeThreshold: 2,
  errorThresholdPercentage: 50,
  resetTimeout: 50,
  rollingCountTimeout: 5000,
  timeout: 1000,
});

const browserResults = [];
for (let i = 0; i < 5; i++) {
  try {
    await browserBreaker.fire(fakePage, '<svg/>');
  } catch (e) {
    browserResults.push(e);
  }
}
assert(
  'breaker tripped (open) after threshold of BROWSER fails',
  browserBreaker.opened === true,
);
const callsBeforeTrip = browserCallCount;
assert(
  'action calls stopped once tripped (callCount < 5)',
  callsBeforeTrip < 5,
);

// Last error should be a CB-rejection (EOPENBREAKER)
const lastErr = browserResults[browserResults.length - 1];
assert(
  'CB-rejection identifiable via isOurError',
  isOurError(lastErr) === true,
);
assert('CB-rejection code = EOPENBREAKER', lastErr.code === 'EOPENBREAKER');

// =============================================================================
// Integration: Recovery via half-open + success closes the circuit
// =============================================================================
console.log(
  '--- Integration: half-open recovery (GEMINI-B2 reproducer inverted) ---',
);

// Wait for resetTimeout (50ms); use 80ms to be safe
await new Promise((r) => setTimeout(r, 80));

// Now swap the action to a healthy one for the half-open probe.
// Since opossum binds the action at construction, we need a switching action.
let phase = 'broken';
const switchingResolve = async () => {
  if (phase === 'broken') return { error: 'LOAD_FAILED', message: 'still bad' };
  return { ok: true };
};
const recoBreaker = createBreaker(createRenderOnce(switchingResolve), {
  name: 'reco-test',
  volumeThreshold: 2,
  errorThresholdPercentage: 50,
  resetTimeout: 50,
  rollingCountTimeout: 5000,
  timeout: 1000,
});

// Trip it
for (let i = 0; i < 5; i++) {
  try {
    await recoBreaker.fire(fakePage, '<svg/>');
  } catch {}
}
assert('reco breaker tripped open', recoBreaker.opened === true);

// Heal the dependency
phase = 'healthy';
await new Promise((r) => setTimeout(r, 80));

// Next fire is the half-open probe
const recoResult = await recoBreaker.fire(fakePage, '<svg/>');
assert('half-open probe succeeded', recoResult.ok === true);
assert('breaker closed after successful probe', recoBreaker.closed === true);

// =============================================================================
// Integration: shutdown sealed
// =============================================================================
console.log('--- Integration: shutdown ---');

const shutBreaker = createBreaker(createRenderOnce(successResolve), {
  name: 'shut-test',
});
shutBreaker.shutdown();
assert('shutdown breaker isShutdown=true', shutBreaker.isShutdown === true);

let shutdownErr;
try {
  await shutBreaker.fire(fakePage, '<svg/>');
} catch (e) {
  shutdownErr = e;
}
assert(
  'fire after shutdown rejects with ESHUTDOWN',
  shutdownErr && shutdownErr.code === 'ESHUTDOWN',
);
assert(
  'ESHUTDOWN is CB-internal (isOurError)',
  isOurError(shutdownErr) === true,
);

// =============================================================================
// §1.7 capacity:1 (Bulkhead, P5) — DEFAULT_BREAKER_OPTS
// =============================================================================
console.log('--- §1.7 P5: capacity:1 (Bulkhead, Singleton-Browser) ---');

assert(
  'DEFAULT_BREAKER_OPTS.capacity = 1 (Bulkhead)',
  DEFAULT_BREAKER_OPTS.capacity === 1,
);

// Concurrency: capacity:1 serialisiert — der 2. parallele fire wird abgewiesen
// (semaphoreLocked / ESEMLOCKED), solange der 1. noch laeuft.
let release;
const gate = new Promise((r) => {
  release = r;
});
const slowAction = createRenderOnce(async () => {
  await gate;
  return { ok: true };
});
const capBreaker = createBreaker(slowAction, {
  name: 'cap-test',
  volumeThreshold: 100,
  timeout: 2000, // generous; both fires complete after release
});
const f1 = capBreaker.fire(fakePage, '<svg/>'); // belegt den einzigen Slot
f1.catch(() => {}); // kein unhandled-rejection falls timeout
await new Promise((r) => setTimeout(r, 10));
let semLocked = false;
const f2 = capBreaker.fire(fakePage, '<svg/>'); // 2. parallel -> ESEMLOCKED@cap:1
const f2res = f2.then(
  () => null,
  (e) => {
    semLocked = isOurError(e) && e.code === 'ESEMLOCKED';
    return null;
  },
);
// Falls capacity:1 greift, ist f2 SOFORT rejected (ESEMLOCKED). Falls nicht
// (capacity nicht gesetzt), laeuft f2 konkurrent und wartet auf gate.
await new Promise((r) => setTimeout(r, 20));
release(); // gate oeffnen -> f1 (und ggf. f2) resolven
await Promise.allSettled([f1, f2res]);
assert('capacity:1 -> paralleler fire => ESEMLOCKED (Bulkhead)', semLocked);

// =============================================================================
// §1.7 HONEST-RED: naive halfOpen-Restart (im Handler, UNGEGATED) reopent
// permanent — der gegate restartPromise-Pfad recovert. Beweist die
// load-bearing Architektur-Entscheidung (Opossum awaitet halfOpen NICHT).
// =============================================================================
console.log(
  '--- §1.7 P1: halfOpen-Restart MUSS gegated sein (restartPromise) ---',
);

/**
 * Baut einen Breaker, dessen Action gegen einen "Browser" rendert, der nach
 * kill() tot ist (LOAD_FAILED). Modelliert das Browser-Recovery-Szenario:
 * der Restart braucht Zeit (async); die halfOpen-Probe feuert SYNCHRON beim
 * halfOpen-Emit — Opossum awaitet den Handler NICHT.
 *
 * @param {'none'|'naive'|'gated'} mode
 *   'none'  = KEIN halfOpen-Restart (= aktueller Code VOR §1.7) -> permanent.
 *   'naive' = Restart fire-and-forget im Handler, UNGEGATED (Anti-Pattern).
 *   'gated' = restartPromise; Action awaitet es VOR Render (P1, korrekt).
 */
function buildRecoveryBreaker(mode) {
  let browserAlive = true; // wird durch kill() auf false gesetzt
  let restartPromise = null;

  // Restart "ersetzt" den toten Browser durch einen frischen (async, 60ms).
  const restart = () =>
    new Promise((res) => {
      setTimeout(() => {
        browserAlive = true;
        res();
      }, 60);
    });

  const action = createRenderOnce(async () => {
    if (mode === 'gated' && restartPromise) {
      await restartPromise; // GATE: warte bis Restart fertig (P1)
    }
    if (!browserAlive) return { error: 'LOAD_FAILED', message: 'browser dead' };
    return { ok: true };
  });

  const breaker = createBreaker(action, {
    name: `reco-${mode}`,
    volumeThreshold: 2,
    errorThresholdPercentage: 50,
    resetTimeout: 80,
    rollingCountTimeout: 5000,
    timeout: 1000,
  });

  if (mode === 'naive') {
    // ANTI: Restart fire-and-forget im halfOpen-Handler (ungeawaitet).
    // Opossum feuert die Probe SOFORT (synchron) -> browserAlive noch false
    // -> reopen. Der Restart wirkt erst NACH dem Probe-Fail.
    breaker.on('halfOpen', () => {
      restart();
    });
  } else if (mode === 'gated') {
    breaker.on('halfOpen', () => {
      restartPromise = restart().finally(() => {
        restartPromise = null;
      });
    });
  }
  // mode 'none': KEIN halfOpen-Restart — der tote Browser bleibt tot.

  return {
    breaker,
    kill: () => {
      browserAlive = false;
    },
  };
}

// --- 'none' (aktueller Code VOR §1.7): permanent gebrickt (HONEST-RED) ---
{
  const { breaker, kill } = buildRecoveryBreaker('none');
  kill();
  for (let i = 0; i < 4; i++) {
    try {
      await breaker.fire(fakePage, '<svg/>');
    } catch {}
  }
  assert('none: Breaker open nach Browser-Tod', breaker.opened === true);

  // Beliebig viele resetTimeout-Zyklen: ohne Restart-Handler bleibt der
  // Browser tot, jede Probe failt, der Breaker reopent endlos.
  let recovered = false;
  for (let cycle = 0; cycle < 5; cycle++) {
    await new Promise((r) => setTimeout(r, 120)); // > resetTimeout (80ms)
    try {
      const out = await breaker.fire(fakePage, '<svg/>');
      if (out?.ok) {
        recovered = true;
        break;
      }
    } catch {}
  }
  assert(
    'HONEST-RED: OHNE on(halfOpen)-Restart brickt der Breaker PERMANENT',
    recovered === false && breaker.closed === false,
  );
  breaker.shutdown();
}

// --- 'naive' (Restart im Handler, ungegated): Probe-Race -> reopen ---
// Opossum awaitet den Handler NICHT; die erste Probe nach jedem halfOpen
// feuert bevor der 60ms-Restart fertig ist -> sie failt -> reopen. Die
// load-bearing Erkenntnis aus an internal spec p4.
{
  const { breaker, kill } = buildRecoveryBreaker('naive');
  kill();
  for (let i = 0; i < 4; i++) {
    try {
      await breaker.fire(fakePage, '<svg/>');
    } catch {}
  }
  assert('naive: Breaker open nach Browser-Tod', breaker.opened === true);

  // Die ERSTE Probe direkt nach halfOpen muss failen (Restart noch nicht fertig).
  // Wir warten exakt einen resetTimeout (+kurz) und feuern sofort.
  await new Promise((r) => setTimeout(r, 90)); // ~resetTimeout(80) -> halfOpen
  let firstProbe;
  try {
    firstProbe = await breaker.fire(fakePage, '<svg/>'); // Probe feuert sofort
  } catch (e) {
    firstProbe = { thrown: e.code };
  }
  assert(
    'HONEST-RED: ungegate halfOpen-Probe failt (Restart-Race, Opossum awaitet Handler nicht)',
    !firstProbe?.ok, // entweder LOAD_FAILED-Return ODER reopened
  );
  breaker.shutdown();
}

// --- GATED (restartPromise): muss RECOVERN (post-fix-Architektur) ---
{
  const { breaker, kill } = buildRecoveryBreaker('gated');
  kill();
  for (let i = 0; i < 4; i++) {
    try {
      await breaker.fire(fakePage, '<svg/>');
    } catch {}
  }
  assert('gated: Breaker open nach Browser-Tod', breaker.opened === true);

  let gatedRecovered = false;
  for (let cycle = 0; cycle < 6; cycle++) {
    await new Promise((r) => setTimeout(r, 120));
    try {
      const out = await breaker.fire(fakePage, '<svg/>');
      if (out && out.ok) {
        gatedRecovered = true;
        break;
      }
    } catch {}
  }
  assert(
    'GATED: restartPromise-gegate halfOpen-Probe recovert (Breaker schliesst)',
    gatedRecovered === true,
  );
  assert('gated: Breaker closed nach Recovery', breaker.closed === true);
  breaker.shutdown();
}

// =============================================================================
// §1.7 P3: consecutiveReopens -> resetTimeout exponentiell (Opossum-mutierbar)
// Empirisch (an internal spec p3-probe): breaker.options.resetTimeout ist zur
// Laufzeit mutierbar; die Mutation greift fuer den NAECHSTEN open-Zyklus
// (_startTimer liest options.resetTimeout frisch). Hier: Mutation in on('open')
// verdoppelt messbar den open->halfOpen-Abstand.
// =============================================================================
console.log('--- §1.7 P3: resetTimeout zur Laufzeit mutierbar (Backoff) ---');

{
  const failAction = createRenderOnce(async () => ({
    error: 'LOAD_FAILED',
    message: 'always dead',
  }));
  const backoffBreaker = createBreaker(failAction, {
    name: 'backoff-test',
    volumeThreshold: 2,
    errorThresholdPercentage: 50,
    resetTimeout: 100,
    rollingCountTimeout: 5000,
    timeout: 1000,
  });

  const openAt = [];
  const halfOpenAt = [];
  backoffBreaker.on('open', () => {
    openAt.push(Date.now());
    backoffBreaker.options.resetTimeout *= 2; // verdoppeln (P3 Backoff)
  });
  backoffBreaker.on('halfOpen', () => {
    halfOpenAt.push(Date.now());
  });

  // Trip -> open #1 (Timer mit 100ms, danach options->200)
  for (let i = 0; i < 4; i++) {
    try {
      await backoffBreaker.fire(fakePage, '<svg/>');
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 160)); // halfOpen #1 (~100ms)
  // halfOpen-Probe failt (immer dead) -> reopen #2 (Timer jetzt 200ms)
  try {
    await backoffBreaker.fire(fakePage, '<svg/>');
  } catch {}
  await new Promise((r) => setTimeout(r, 320)); // halfOpen #2 (~200ms)

  const d1 = halfOpenAt[0] - openAt[0];
  const d2 = halfOpenAt[1] - openAt[1];
  assert(
    `P3: resetTimeout-Mutation greift fuer naechsten Zyklus (d1=${d1}ms d2=${d2}ms, d2>1.5*d1)`,
    Number.isFinite(d1) && Number.isFinite(d2) && d2 > d1 * 1.5,
  );
  backoffBreaker.shutdown();
}

// =============================================================================
// §1.7 INVARIANTE 1 (HIGH): restart-Timeout MUSS die State-Machine treiben.
// Modelliert die fireResolve-Gate-Semantik deterministisch: ein Restart, der
// den Bound ueberschreitet, darf die Recovery NICHT stallen — das Gate koppelt
// den haengenden restartPromise ab UND faellt zu breaker.fire DURCH, die ehrlich
// scheitert (NO_PAGE/LOAD_FAILED, kind=BROWSER) → reopen → Backoff/
// consecutiveReopens rueckt vor; ein spaeterer erfolgreicher Restart recovert.
// HONEST-RED: ohne Durchfall-Fix bliebe der Breaker half-open + Gate dauerhaft
// blockiert (kein reopen, kein Backoff, Recovery gestallt).
// =============================================================================
console.log(
  '--- §1.7 Invariante 1: restart-Timeout treibt die State-Machine ---',
);

{
  // Browser-Modell: page ist null solange kein Restart fertig ist.
  // §1.7 EPOCH-Diskriminierung: JEDER Restart erzeugt eine DISTINKTE Page-
  // Instanz (NICHT eine Konstante — eine Konstante maskiert Cross-Generation-
  // Ueberschreibung). Reference-Guard `restartPromise === myRestart` schuetzt
  // die `pageRef = p`-Zuweisung; ein spaet fertig werdendes (superseded) L1
  // darf pageRef NICHT mit seiner stale Instanz ueberschreiben.
  let pageRef = null;
  let restartPromise = null;
  let restartGen = 0;
  const BOUND_MS = 60; // Gate-Bound (analog RESTART_TIMEOUT_MS, hier kurz)

  // Restart-Verhalten steuerbar: 'hang' (ueberschreitet Bound), 'ok' (schnell).
  let restartMode = 'hang';
  const startRestart = () => {
    const gen = ++restartGen;
    const myRestart = (async () => {
      if (restartMode === 'hang') {
        await new Promise((r) => setTimeout(r, BOUND_MS * 5)); // > Bound
      } else {
        await new Promise((r) => setTimeout(r, 10)); // < Bound
      }
      // DISTINKTE Page-Instanz pro Restart-Generation.
      const p = { id: `page-gen${gen}`, gen };
      // Reference-Guard: nur der AKTUELLE Restart darf pageRef setzen.
      if (restartPromise === myRestart) pageRef = p;
    })().finally(() => {
      if (restartPromise === myRestart) restartPromise = null;
    });
    restartPromise = myRestart;
    myRestart.catch(() => {});
  };

  // Action rendert gegen pageRef (null → renderOnce wirft NO_PAGE/BROWSER).
  const action = createRenderOnce(async (p) => {
    if (!p) return { error: 'LOAD_FAILED', message: 'browser dead' };
    return { ok: true, pageId: p.id, pageGen: p.gen };
  });

  const breaker = createBreaker(action, {
    name: 'inv1-test',
    volumeThreshold: 2,
    errorThresholdPercentage: 50,
    resetTimeout: 80,
    rollingCountTimeout: 5000,
    timeout: 1000,
  });

  let reopens = 0;
  const openAt = [];
  breaker.on('open', () => {
    reopens++;
    openAt.push(Date.now());
    pageRef = null; // CLEANUP
  });
  breaker.on('halfOpen', () => {
    startRestart(); // RESTART (haengt in Mode 'hang')
  });

  // Repliziert fireResolve-Gate inkl. Invariante-1-Durchfall.
  async function gatedFire() {
    if (restartPromise) {
      const pending = restartPromise;
      let timer;
      const bound = new Promise((_, rej) => {
        timer = setTimeout(() => {
          const e = new Error('Browser-Restart Timeout');
          e.code = 'LOAD_FAILED';
          rej(e);
        }, BOUND_MS);
      });
      try {
        await Promise.race([pending, bound]);
      } catch {
        if (restartPromise === pending) restartPromise = null; // ABKOPPELN
        pending.catch(() => {});
        // KEIN early return — DURCHFALLEN zur fire (Invariante 1).
      } finally {
        clearTimeout(timer);
      }
    }
    try {
      return await breaker.fire(pageRef, '<svg/>');
    } catch (e) {
      return { thrown: e.code };
    }
  }

  // Trip the breaker (Browser tot).
  pageRef = null;
  for (let i = 0; i < 4; i++) await gatedFire();
  assert('inv1: Breaker open nach Browser-Tod', breaker.opened === true);
  const reopensAfterTrip = reopens;

  // halfOpen #1: Restart HAENGT (> Bound). Gate-Timeout → Abkoppeln →
  // Durchfall zur fire (pageRef noch null) → BROWSER-Fail → reopen.
  await new Promise((r) => setTimeout(r, 100)); // > resetTimeout(80) → halfOpen
  const probe1 = await gatedFire();
  // Nach dem Durchfall MUSS der Breaker wieder open sein (State-Machine getrieben).
  assert(
    'INVARIANTE 1: restart-Timeout → Durchfall → Breaker reopent (nicht gestallt)',
    breaker.opened === true && !probe1?.ok,
  );
  assert(
    'INVARIANTE 1: consecutiveReopens/State rueckt vor (reopen-Count gestiegen)',
    reopens > reopensAfterTrip,
  );
  // Das haengende restartPromise wurde abgekoppelt → Gate nicht mehr blockiert.
  assert(
    'INVARIANTE 1: haengendes restartPromise abgekoppelt (Gate frei)',
    restartPromise === null,
  );

  // Jetzt heilt die Abhaengigkeit: naechster Restart ist schnell (< Bound).
  restartMode = 'ok';
  let recovered = false;
  let recoveredGen = null;
  for (let cycle = 0; cycle < 8; cycle++) {
    await new Promise((r) => setTimeout(r, 120));
    const out = await gatedFire();
    if (out?.ok) {
      recovered = true;
      recoveredGen = out.pageGen;
      break;
    }
  }
  assert(
    'INVARIANTE 1: spaeterer erfolgreicher Restart recovert (breaker.closed)',
    recovered === true && breaker.closed === true,
  );
  // §1.7 EPOCH-Diskriminierung: die recoverte Page gehoert der NEUESTEN
  // Generation (das haengende L1 hat pageRef NICHT mit einer aelteren Instanz
  // ueberschrieben). Mit DISTINKTEN Page-Instanzen wuerde ein stale Overwrite
  // hier eine kleinere gen liefern als die aktuelle restartGen.
  assert(
    `INVARIANTE 1: recoverte Page ist neueste Generation (gen=${recoveredGen}, kein stale L1-Overwrite)`,
    recovered && recoveredGen === restartGen,
  );
  breaker.shutdown();
}

// =============================================================================
console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);
