// H10-RED R11-21 — Parser frisst Garbage: parseConstraints erzeugt aus Nicht-Grammatik-Strings
// stille Pseudo-Constraints (type:"IS"/"NO") und verschluckt Extra-Tokens byte-identisch.
//
// WAHRHEITS-PIN (implementierungs-agnostisch):
//   Ein Constraint-String, der NICHT der Grammatik "#subject TYPE [#reference] [wert]"
//   entspricht, darf NICHT still zu einem Pseudo-Constraint werden. Akzeptierte ehrliche
//   Verhalten (jede korrekte Implementierung besteht):
//     (1) parseConstraints wirft (Throw),
//     (2) Parse-Ergebnis traegt explizites Fehler-/Ignorier-Signal (Marker-Typ wie
//         CONSTRAINT_PARSE_ERROR, error/invalid/ignored/warnings-Feld) oder ist leer
//         (kein Pseudo-Constraint fabriziert),
//     (3) analyze meldet den Parse-Fehler ehrlich (unchecked/CONSTRAINT_PARSE_ERROR,
//         PARSE/SYNTAX/GRAMMAR/INVALID/IGNORIERT-Signal in structured/prose).
//   VERBOTEN ist einzig die stille Fehlinterpretation (z.B. type:"IS" aus "THIS IS NOT
//   VALID") ohne jedes Signal auf irgendeiner Ebene.
//   KONTROLL-PIN: gueltige Strings parsen unveraendert (Feld-Vergleich gegen heutige
//   Form fuer 3 gueltige Beispiele; additive Felder erlaubt).
//
// Fixtures: exakt aus an internal ground-truth probe
// (2-Lauf-bewiesen: run1 == run2).

import * as M from '../../src/pipeline.js';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect id="a" x="10" y="10" width="20" height="20" fill="red"/><rect id="b" x="60" y="60" width="20" height="20" fill="blue"/></svg>`;

// Signal-Woerter fuer ehrliche Parse-Fehler-Meldung. Bewusst so gewaehlt, dass heutige
// Ausgaben (SUBJECT_NOT_FOUND, PARTIAL, SPECIFICATION, canvas_validity:"valid") NICHT
// matchen, jede ehrliche Meldung (CONSTRAINT_PARSE_ERROR, "Syntax", "ignoriert",
// "invalid", "malformed", "rejected") aber schon.
const SIGNAL_RE = /PARSE|SYNTAX|GRAMMAR|UNPARS|MALFORM|INVALID|IGNOR|REJECT/i;
// Fuer den Extra-Token-Fall zusaetzlich: jede Erwaehnung des Tokens selbst zaehlt.
const EXTRA_SIGNAL_RE =
  /PARSE|SYNTAX|GRAMMAR|UNPARS|MALFORM|INVALID|IGNOR|REJECT|EXTRA|TOKEN/i;

const fails = [];
function report(name, pass, ist) {
  console.log(`ASSERT ${name}: ${pass ? 'PASS' : 'FAIL'} — ist: ${ist}`);
  if (!pass) fails.push(name);
}

function looksLikeConstraint(e) {
  return e && typeof e === 'object' && typeof e.type === 'string' && e.subject != null;
}

// Traegt ein Parse-Eintrag ein explizites Fehler-/Ignorier-Signal?
function honestMarker(e) {
  if (!e || typeof e !== 'object') return false;
  if (SIGNAL_RE.test(String(e.type ?? ''))) return true;
  for (const k of [
    'error', 'parseError', 'parse_error', 'invalid', 'ignored', 'rejected',
    'warning', 'warnings', 'issue', 'issues', 'problems',
  ]) {
    const v = e[k];
    if (Array.isArray(v) ? v.length > 0 : Boolean(v)) return true;
  }
  return SIGNAL_RE.test(String(e.reasonCode ?? e.reason ?? ''));
}

// Meldet analyze irgendwo ein Parse-Fehler-/Ignorier-Signal?
function analyzeSignal(r, re) {
  if (!r) return false;
  const blob =
    JSON.stringify(r.structured ?? {}) + ' ' + String(r.prose ?? '') + ' ' +
    String(r.error ?? '') + ' ' + String(r.message ?? '');
  return re.test(blob);
}

function uncheckedCodes(r) {
  return (r?.structured?.unchecked ?? []).map((u) => u.reasonCode);
}

// --- Kontroll-Pin: 3 gueltige Beispiele parsen unveraendert (heutige Form) ---
function checkValid(name, str, expected) {
  let p;
  try {
    p = M.parseConstraints([str]);
  } catch (e) {
    report(name, false, `parseConstraints wirft bei gueltigem String '${str}': ${e.message}`);
    return;
  }
  const e0 = Array.isArray(p) ? p[0] : undefined;
  const mismatches = [];
  if (!Array.isArray(p) || p.length !== 1) {
    mismatches.push(`length=${Array.isArray(p) ? p.length : typeof p} erwartet 1`);
  } else {
    for (const [k, v] of Object.entries(expected)) {
      if (e0?.[k] !== v) mismatches.push(`${k}=${JSON.stringify(e0?.[k])} erwartet ${JSON.stringify(v)}`);
    }
    if (honestMarker(e0)) mismatches.push(`gueltiger String als Fehler markiert: ${JSON.stringify(e0)}`);
  }
  report(
    name,
    mismatches.length === 0,
    mismatches.length === 0
      ? `'${str}' → ${JSON.stringify(e0)} (heutige Form erhalten)`
      : `'${str}' → ${JSON.stringify(p)} | ${mismatches.join('; ')}`,
  );
}

// --- Garbage-Pin: Nicht-Grammatik-String darf kein stiller Pseudo-Constraint werden ---
async function checkGarbage(name, str) {
  let parsed;
  try {
    parsed = M.parseConstraints([str]);
  } catch (e) {
    report(name, true, `parseConstraints wirft ehrlich: ${e.message}`);
    return;
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  if (entries.length === 0) {
    report(name, true, 'kein Pseudo-Constraint fabriziert (leeres Parse-Ergebnis)');
    return;
  }
  const pseudo = entries.filter((e) => looksLikeConstraint(e) && !honestMarker(e));
  if (pseudo.length === 0) {
    report(name, true, `Parse-Ergebnis traegt Fehler-Signal: ${JSON.stringify(entries)}`);
    return;
  }
  // Parse-Ebene still — letzte ehrliche Chance: analyze (unchecked/CONSTRAINT_PARSE_ERROR o.ae.)
  let r = null;
  let thrown = null;
  try {
    r = await M.analyze(SVG, [str]);
  } catch (e) {
    thrown = e;
  }
  if (thrown) {
    const honest = SIGNAL_RE.test(String(thrown.message ?? '') + String(thrown.code ?? ''));
    report(
      name,
      honest,
      honest
        ? `analyze wirft ehrlich: ${thrown.message}`
        : `parse fabriziert ${JSON.stringify(pseudo)} und analyze wirft ohne Parse-Signal: ${thrown.message}`,
    );
    return;
  }
  const sig = analyzeSignal(r, SIGNAL_RE);
  report(
    name,
    sig,
    sig
      ? `analyze meldet Parse-Fehler-Signal (unchecked=${JSON.stringify(uncheckedCodes(r))})`
      : `STILLE FEHLINTERPRETATION: parse('${str}') → ${JSON.stringify(pseudo)}; analyze status=${r?.structured?.status}, unchecked=${JSON.stringify(uncheckedCodes(r))} — kein PARSE/INVALID/IGNORIERT-Signal auf keiner Ebene`,
  );
}

// --- Extra-Token-Pin: '#a DISTANCE-FROM #b 3 extra' darf nicht still identisch parsen ---
async function checkExtraToken() {
  const name = 'extra_token_nicht_still_verschluckt';
  const withExtra = '#a DISTANCE-FROM #b 3 extra';
  const clean = '#a DISTANCE-FROM #b 3';
  let p1;
  let p2;
  try {
    p2 = M.parseConstraints([clean]);
  } catch (e) {
    report(name, false, `Kontroll-String '${clean}' wirft unerwartet: ${e.message}`);
    return;
  }
  try {
    p1 = M.parseConstraints([withExtra]);
  } catch (e) {
    report(name, true, `parseConstraints wirft ehrlich bei Extra-Token: ${e.message}`);
    return;
  }
  const s1 = JSON.stringify(p1);
  const s2 = JSON.stringify(p2);
  if (s1 !== s2) {
    report(name, true, `Parse-Ergebnis unterscheidet sich (Signal vorhanden): mit='${s1}' ohne='${s2}'`);
    return;
  }
  // Byte-identisch — letzte ehrliche Chance: analyze meldet das Extra-Token
  let r = null;
  let thrown = null;
  try {
    r = await M.analyze(SVG, [withExtra]);
  } catch (e) {
    thrown = e;
  }
  if (thrown) {
    const honest = EXTRA_SIGNAL_RE.test(String(thrown.message ?? '') + String(thrown.code ?? ''));
    report(
      name,
      honest,
      honest
        ? `analyze wirft ehrlich: ${thrown.message}`
        : `Extra-Token still verschluckt und analyze wirft ohne Signal: ${thrown.message}`,
    );
    return;
  }
  const sig = analyzeSignal(r, EXTRA_SIGNAL_RE);
  report(
    name,
    sig,
    sig
      ? 'analyze meldet Signal zum Extra-Token'
      : `STILL VERSCHLUCKT: parse('${withExtra}') byte-identisch zu parse('${clean}') = ${s1}; analyze status=${r?.structured?.status} ohne extra/token/parse-Signal`,
  );
}

// --- Hauptlauf ---
await M.init();
try {
  checkValid('valid_distance_from_unveraendert', '#a DISTANCE-FROM #b 3', {
    type: 'DISTANCE-FROM',
    subject: 'a',
    reference: 'b',
    value: 3,
  });
  checkValid('valid_centered_in_unveraendert', '#a CENTERED-IN #b', {
    type: 'CENTERED-IN',
    subject: 'a',
    reference: 'b',
  });
  checkValid('valid_color_unveraendert', '#a COLOR red', {
    type: 'COLOR',
    subject: 'a',
    value: 'red',
  });
  // P2-Kontroll-Pin (Patch-Runde): FEHLENDER Wert behaelt den Grammatik-Default 1.
  checkValid('valid_distance_ohne_wert_default_1', '#a DISTANCE-FROM #b', {
    type: 'DISTANCE-FROM',
    subject: 'a',
    reference: 'b',
    value: 1,
  });
  await checkGarbage('garbage_this_is_not_valid_kein_pseudo_constraint', 'THIS IS NOT VALID');
  await checkGarbage('garbage_no_hashes_kein_pseudo_constraint', 'garbage no hashes');
  // P2-VERSTAERKUNG (Patch-Runde): parseFloat-Teilinterpretation darf KEINEN
  // stillen Pseudo-Wert fabrizieren — bewiesen: '0x10'→0 ergab ein FALSCHES
  // PASS (Distanz ≥ 0 ist immer wahr), '3px'→3 verschluckte die Einheit,
  // 'Infinity' lief als non-finiter Wert durch. Jede ehrliche Implementierung
  // verweigert/markiert diese Tokens (gleiche Akzeptanz-Formen wie oben).
  await checkGarbage('wert_0x10_nicht_teilinterpretiert', '#a DISTANCE-FROM #b 0x10');
  await checkGarbage('wert_3px_nicht_teilinterpretiert', '#a DISTANCE-FROM #b 3px');
  await checkGarbage('wert_infinity_nicht_akzeptiert', '#a DISTANCE-FROM #b Infinity');
  await checkExtraToken();
} finally {
  await M.shutdown();
}

const rot = fails.length > 0;
console.log(rot ? `H10-RED R11-21: ROT (${fails.length} FAIL)` : 'H10-RED R11-21: GRUEN');
process.exit(rot ? 1 : 0);
