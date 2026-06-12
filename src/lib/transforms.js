/**
 * transforms.js — SVG transform-Token-Algebra (Hexagonal-rein, lib/-Schicht)
 * Vector Mirror v2.6 · Sprint §1.5 Transform-Fallback
 *
 * lib-Modul (REGEL-4 Hexagonal): pure Funktionen, KEINE Importe aus adapters/
 * oder interface/. Konsumenten: pipeline.js (arrange-Pfad) + structured.js
 * (Emitter §1.5 Transform-Fallback).
 *
 * Extraktion aus pipeline.js (§1.5 Block B): buildTransform + hasTranslateTransform
 * lebten im Orchestrator; der Emitter braucht sie für den Transform-Fallback.
 * Verschiebung in lib/ macht sie für beide Schichten importierbar, ohne dass der
 * Emitter den Orchestrator zieht (Hexagonal-Layering).
 *
 * ── Zwei Translate-Merge-Semantiken (R-A-Auflösung §1.5, bewusst getrennt) ──
 *   buildTransform   (REPLACE-IN-PLACE): translate ersetzt den bestehenden
 *     translate-Token an dessen Original-Position (bzw. Listenanfang, wenn keiner
 *     existiert). Korrekt für arrange(): dort sind dx/dy Deltas im LOKALEN,
 *     un-transformierten Element-Koordinatensystem (state.bbox ist die deklarierte
 *     Local-BBox, NICHT die CTM-projizierte). Der Autor-transform (scale/rotate)
 *     bleibt als Kontext erhalten — Erhalt der Autor-Intention.
 *     Empirie-Anker: test_arrange.js:428 'rotate(45) translate(5 6) scale(2)'
 *     → 'rotate(45) translate(140 280) scale(2)'.
 *
 *   prependTranslate (FRONT-PREPEND): translate steht IMMER am Listenanfang
 *     (zuletzt angewendet = wirkt in finaler Welt-Koordinate). Korrekt für den
 *     §1.5-Position-Fix: dort kommen dx/dy vom Spotter, berechnet auf der
 *     CTM-PROJIZIERTEN Welt-BBox. Die Gegenbewegung muss außen wrappen, damit sie
 *     unabhängig von einem Autor-scale()/rotate() in Welt-px wirkt (SOTA Präzision 1).
 *
 * Beide Funktionen entfernen vorhandene translate-Tokens VOR dem Insert →
 * Idempotenz (G-14): wiederholte Anwendung mit gleichem dx/dy ist Fixpunkt.
 */

/**
 * True, wenn der transform-String einen translate/translateX/translateY/
 * translateZ-Token trägt. Case-insensitiv; tolerant gegen null/undefined.
 */
export function hasTranslateTransform(transform) {
  return /\btranslate[XYZ]?\s*\(/i.test(transform ?? '');
}

/**
 * Zerlegt einen transform-String in Funktions-Tokens (z.B. ['rotate(45)',
 * 'scale(2)']). Liefert null, wenn kein Token erkennbar ist.
 */
function tokenize(transform) {
  const trimmed = transform?.trim();
  if (!trimmed) return [];
  return trimmed.match(/[a-zA-Z]+\s*\([^)]*\)/g);
}

/**
 * buildTransform (REPLACE-IN-PLACE) — siehe Modul-Doku.
 * Setzt translate(dx dy) an die Position des ersten bestehenden translate-Tokens
 * (oder an den Listenanfang, wenn keiner existiert) und entfernt alle übrigen
 * translate-Tokens. Erhält die relative Ordnung der Nicht-translate-Tokens.
 *
 * @param {string|undefined} existingTransform - bestehender transform-Attribut-Wert.
 * @param {number} dx - X-Verschiebung.
 * @param {number} dy - Y-Verschiebung.
 * @returns {string} neuer transform-String.
 */
export function buildTransform(existingTransform, dx, dy) {
  const translate = `translate(${dx} ${dy})`;
  const trimmed = existingTransform?.trim();
  if (!trimmed) return translate;

  const tokens = tokenize(trimmed);
  if (!tokens) return `${translate} ${trimmed}`;

  const nextTokens = [];
  let translateIndex = null;

  for (const token of tokens) {
    if (/^translate[XYZ]?\s*\(/i.test(token)) {
      if (translateIndex === null) translateIndex = nextTokens.length;
      continue;
    }
    nextTokens.push(token.trim());
  }

  const insertAt = translateIndex ?? 0;
  nextTokens.splice(insertAt, 0, translate);
  return nextTokens.join(' ').trim();
}

/**
 * prependTranslate (FRONT-PREPEND) — siehe Modul-Doku.
 * Stellt translate(dx dy) IMMER an den Listenanfang und entfernt alle
 * bestehenden translate-Tokens (Idempotenz). Erhält die relative Ordnung der
 * Nicht-translate-Tokens hinter dem neuen translate.
 *
 * Für den §1.5-Position-Fix: dx/dy sind Welt-px-Deltas, die außen wrappen
 * müssen, damit sie unabhängig von Autor-scale()/rotate() wirken.
 *
 * @param {string|undefined} existingTransform - bestehender transform-Attribut-Wert.
 * @param {number} dx - X-Verschiebung in Welt-px.
 * @param {number} dy - Y-Verschiebung in Welt-px.
 * @returns {string} neuer transform-String, beginnt mit 'translate('.
 */
export function prependTranslate(existingTransform, dx, dy) {
  const translate = `translate(${dx} ${dy})`;
  const tokens = tokenize(existingTransform);
  if (!tokens || tokens.length === 0) return translate;

  const kept = tokens
    .filter((token) => !/^translate[XYZ]?\s*\(/i.test(token))
    .map((token) => token.trim());

  return [translate, ...kept].join(' ').trim();
}
