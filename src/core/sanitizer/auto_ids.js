/**
 * auto_ids.js — §1.3 Auto-ID Content-Addressed Hash-Namespace
 * Vector Mirror v2.0 (Sprint-β2 §1.3 LAYER-TRENNUNG, Patch2)
 *
 * Core module: NO imports from adapters/ or interface/ (REGEL-4 Hexagonal).
 * NO external deps — node:crypto is built-in (REGEL-7 Eigenstaendigkeit).
 *
 * Layer-Trennung (Patch2, Mini-Review-Konvergenz Opus+Codex):
 *   Dieses Modul ist PURE FORMAT-Layer. Es kennt das Auto-ID-Format
 *   `_<8hex>_<tag><n>` und erzeugt Strings nach diesem Format — aber es
 *   kennt KEINE Tag-Allowlist und entscheidet NICHT, welche Tags gültig
 *   sind. Domain-Vertrag (Spotter-Set + Format-Regex) lebt in
 *   `../element_vocabulary.js`. Aufrufer entscheidet vorab, welche Tags
 *   überhaupt eine Auto-ID erhalten (Renderer-Adapter ruft isSpotterTag
 *   aus element_vocabulary.js).
 *
 *   Konsequenz: formatAutoId/extractAutoIds sind NICHT "total" über
 *   beliebige Tags (F-PATCH-CODEX-002) — sie sind als pure Format-Helper
 *   konzipiert. Das ist BEABSICHTIGT: die Allowlist gehört in den
 *   Domain-Layer, nicht in den Format-Layer. Würde extractAutoIds selbst
 *   filtern, wäre `element_vocabulary.js` doppelt importiert (Layer-
 *   Vermischung). Die Verantwortung "nur Spotter-Tags reinreichen"
 *   liegt beim Caller (siehe playwright.js nextAutoId-Gate).
 *
 * Adressiert D-004 (ADR-025 §3 Auto-ID-Versprechen, 0 Treffer im Code) und
 * FIX_PLAN §1.3 (Beschluss B-4-modified, 8 hex statt 6 hex).
 *
 * Format: _<8hex>_<tag><n>
 *   <8hex>  = sha256(sanitizedSvg) als hex, truncated auf 8 chars (32 bit)
 *   <tag>   = lowercase Element-Tag (rect, circle, path, ...)
 *   <n>     = monoton steigender, tag-lokaler Counter (1, 2, 3, ...)
 *
 * Birthday-Bound (FIX_PLAN §1.3 Tabelle):
 *   8 hex (32 bit) → P(Kollision) bei N=1000 ≈ 0.012 %, 50%-Punkt N ≈ 77163.
 *
 * Hash-Berechnung MUSS in Node-Land VOR page.setContent passieren (H-18 §1.3).
 * Der Browser-Kontext hat kein node:crypto — daher ist diese Funktion PURE
 * und arbeitet auf dem bereits-sanitized SVG-String (sanitizedSvg) plus
 * einer in-Browser-extrahierten DOM-Element-Liste (tag-Liste reicht).
 */
import { createHash } from 'node:crypto';

/**
 * Berechnet den 8-hex SHA-256-Praefix fuer den uebergebenen sanitizedSvg.
 * Pure: gleiche Eingabe → gleiche Ausgabe (Determinismus-Garantie).
 *
 * @param {string} sanitizedSvg - DOMPurified SVG-String (Node-Land).
 * @returns {string} 8-stelliger lowercase hex-Praefix.
 */
export function computeSvgHashPrefix(sanitizedSvg) {
  if (typeof sanitizedSvg !== 'string') {
    throw new TypeError('computeSvgHashPrefix erwartet einen String');
  }
  return createHash('sha256').update(sanitizedSvg).digest('hex').slice(0, 8);
}

/**
 * Generiert die Auto-ID fuer ein einzelnes Element.
 * Format: _<8hex>_<tag><n>
 *
 * @param {string} hashPrefix - 8-hex Praefix (siehe computeSvgHashPrefix).
 * @param {string} tag - lowercase Element-Tag (z.B. 'rect').
 * @param {number} n - tag-lokaler Counter (1-basiert).
 * @returns {string} Auto-ID.
 */
export function formatAutoId(hashPrefix, tag, n) {
  return `_${hashPrefix}_${tag}${n}`;
}

/**
 * Pure Generator-Funktion fuer Auto-IDs ueber eine Tag-Sequenz.
 *
 * Eingabe ist die geordnete Tag-Sequenz der DOM-Elemente OHNE explizite
 * SVG-id (Reihenfolge wie sie im SVG-DOM erscheinen). Der Counter ist
 * tag-lokal und monoton steigend, sodass _<hash>_rect1, _<hash>_rect2,
 * _<hash>_circle1, _<hash>_rect3 entstehen — analog der bisherigen
 * positional-stable DOM-Path-Logik, aber content-addressed via Hash-Praefix.
 *
 * Aufrufer-Vertrag (playwright.js):
 *   - sanitizedSvg ist im Node-Land VOR page.setContent verfuegbar.
 *   - tagSequence wird in der Browser-Iteration aufgebaut (gleiche Reihenfolge
 *     wie elements.push()), nur fuer Elemente ohne explizite id.
 *   - Rueckgabe: Array von Auto-IDs in derselben Reihenfolge wie tagSequence.
 *
 * @param {string} sanitizedSvg - DOMPurified SVG-String.
 * @param {ReadonlyArray<string>} tagSequence - Geordnete Tag-Liste der
 *   Elemente ohne explizite id (z.B. ['rect', 'rect', 'circle']).
 * @returns {string[]} Auto-IDs in derselben Reihenfolge.
 */
export function extractAutoIds(sanitizedSvg, tagSequence) {
  if (!Array.isArray(tagSequence)) {
    throw new TypeError('extractAutoIds erwartet ein Array als tagSequence');
  }
  const hashPrefix = computeSvgHashPrefix(sanitizedSvg);
  const counters = new Map();
  const out = new Array(tagSequence.length);
  for (let i = 0; i < tagSequence.length; i++) {
    const tag = tagSequence[i];
    const next = (counters.get(tag) || 0) + 1;
    counters.set(tag, next);
    out[i] = formatAutoId(hashPrefix, tag, next);
  }
  return out;
}
