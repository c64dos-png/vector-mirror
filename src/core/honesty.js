/**
 * honesty.js - Honesty-Gate (core-Invariante, Schritt 1: Fundament)
 * Vector Mirror v2.0
 *
 * Die deterministische (REGEL-9, LLM-frei) und hexagonal-REINE (REGEL-4:
 * KEINE Imports aus adapters/ oder interface/ — diese Datei hat bewusst
 * NULL Imports) Klassifikations-/Assertions-Bibliothek, die SPAETER vor
 * jeder Emission laeuft. Schritt 1 liefert nur die Bibliothek + Unit-Tests;
 * es gibt JETZT noch keinen Caller (Verdrahtung = Schritt 3/4).
 *
 * Vier reine Funktionen. Pessimismus-Propagation (Spotter-Anti-Luege):
 * im Zweifel wird Sicherheit verweigert, nicht behauptet.
 *
 * Quell-Verankerung (byte-genauer Port der heutigen Semantik):
 *   - allowDeltas        == adapters/emitter/structured.js:359
 *   - assertEmissionGated == interface/schema.js:316-345 (superRefine, Live-Form)
 *   - countTruncation     ersetzt spaeter das harte structured.js:426 suppressed:0
 *
 * Determinismus: keine Date, kein Math.random, kein I/O, kein LLM.
 */

/**
 * allowDeltas — das SSOT-Gate. Byte-genauer Port der heutigen Semantik aus
 * structured.js:359 (`const allowDeltas = elReliability === 'reliable';`).
 *
 * NUR `reliability → bool`. Die "default-reliable-bei-fehlender-id"-Logik
 * (Lookup-Concern) bleibt beim spaeteren Caller — sie ist hier bewusst NICHT
 * enthalten. 'approximate' / 'not_measurable' / alles andere → false
 * (Pessimismus). Strikt case-sensitiv, exakt wie der Tripel-Gleich-Vergleich.
 *
 * @param {string} reliability - z.B. 'reliable' | 'approximate' | 'not_measurable'
 * @returns {boolean} true gdw. reliability strikt === 'reliable'
 */
export function allowDeltas(reliability) {
  return reliability === 'reliable';
}

/**
 * bboxTrustedForVerdict — §H10 R11-07: darf eine bbox ein GRÜNES Verdikt
 * tragen? Wohnt in der SSOT-Datei der Reliability-Semantik (REGEL-4, W1b-Pin),
 * ist aber bewusst ein ANDERES Prädikat als allowDeltas (PRAEDIKAT-DISZIPLIN,
 * s.o.): allowDeltas verweigert Pixel-Korrekturen schon bei 'approximate'
 * (eine VORSCHREIBUNG braucht die exakte Zahl); das VERDIKT bleibt bei
 * 'approximate' tragfähig (die Zahl ist annähernd wahr — Anti-Über-Gaten).
 * NUR 'not_measurable' (3D-Transform / Non-SMIL-Motion: die Zahl selbst ist
 * erklärt nicht reproduzierbar) trägt weder Korrektur noch grünes Verdikt.
 *
 * @param {string} reliability - z.B. 'reliable' | 'approximate' | 'not_measurable'
 * @returns {boolean} false gdw. reliability strikt === 'not_measurable'
 */
export function bboxTrustedForVerdict(reliability) {
  return reliability !== 'not_measurable';
}

/**
 * gateCorrections — die EINE Pessimismus-Entscheidung pro failing-issue, am
 * Emissions-Rand, EINMAL. Reiner (REGEL-4, importfrei) Port der heute in
 * structured.js:358-365 verstreuten Inline-Logik in EINE Wahrheits-Quelle.
 *
 * Annotiert jedes issue mit `_gated = allowDeltas(reliabilityOf(issue.id) ?? '?')`.
 * `reliabilityOf` ist eine reine Caller-Closure (id → reliability|undefined); der
 * '?'-Default bei fehlendem Treffer macht `allowDeltas` zum Default-deny
 * (Spotter-Anti-Luege: unbekannte id → keine Pixel-Korrektur).
 *
 * Bei `_gated === false` liefert die Funktion ein um dx/dy/dw/dh BEREINIGTES
 * Derivat — UND eine um die Korrektur-VORSCHREIBUNG bereinigte `detail`-Prosa
 * (sanitizeCorrectionDetail). Der Spotter-Anti-Luege-Schutz deckt damit BEIDE
 * Kanaele, durch die ein Delta entkommen kann: das strukturierte Objekt-Feld
 * (dx/dy/dw/dh) UND den detail-STRING (`. Korrektur: dx=..`, `Δw=..`,
 * `Kürzester Fluchtweg: ..`), den die Constraint-Produzenten in denselben
 * String einbetten. EIN Gate, vollstaendig. Bei `_gated === true` bleibt das
 * issue (bis auf das additive `_gated`-Vertragsfeld) BYTE-IDENTISCH — die
 * Sanitisierung laeuft NUR im deny-Zweig.
 *
 * PRAEDIKAT-DISZIPLIN (REGEL-9, bewusst NICHT zusammenfuehren): dieses Live-Gate
 * nutzt `allowDeltas` (=== 'reliable', 4 Keys dx/dy/dw/dh, deny-unknown).
 * `assertEmissionGated` (test-only Backstop, schema.js-Spiegel) nutzt ein
 * ANDERES Praedikat (dx/dy-only, allow-unknown). Die beiden DECKEN SICH NICHT
 * und duerfen es nicht — ein Merge wuerde entweder das Live-Gate aufweichen
 * (dw/dh-Leak) oder den Backstop ueber-streng machen (unknown-id-Fehlalarm).
 *
 * @param {Array<{id?: string}>} failing - die failing-Liste (arbitrated.failing).
 * @param {(id: string) => (string|undefined)} reliabilityOf - reine Lookup-Closure.
 * @returns {Array} annotierte (und bei deny bereinigte) issue-Derivate.
 */
export function gateCorrections(failing, reliabilityOf) {
  if (!Array.isArray(failing)) return [];
  return failing.map((issue) => {
    const _gated = allowDeltas(reliabilityOf(issue.id) ?? '?');
    if (_gated) return { ...issue, _gated };
    const { dx, dy, dw, dh, ...rest } = issue;
    if (typeof rest.detail === 'string') {
      rest.detail = sanitizeCorrectionDetail(rest.detail);
    }
    return { ...rest, _gated };
  });
}

/**
 * sanitizeCorrectionDetail — entfernt die VORGESCHRIEBENE Pixel-Korrektur aus
 * dem detail-String eines failing-issue, behaelt aber die WAS/WIEVIEL-MESSUNG
 * (VISION Prinzip 3: das Auge misst die Luecke, verschreibt sie nicht). Nur im
 * deny-Zweig von gateCorrections aufgerufen (reliable bleibt byte-identisch).
 *
 * Exhaustiver Port der 3 Produzenten-Formen (grep-belegt, src/core/constraints):
 *   - `<WAS>. Korrektur: <deltas>`         (centered-in, LEFT-OF, ABOVE,
 *                                            ALIGNED-LEFT/TOP, INSIDE)
 *   - `<WAS>. Kürzester Fluchtweg: <delta>` (NO-OVERLAP)
 *   - `Grösse weicht ab (Δw=..px, Δh=..px)` (SAME-SIZE)
 * In allen Faellen wird die delta-tragende Vorschreibungs-Klausel abgeschnitten,
 * die reine Beschreibung des Bruchs bleibt. distance.js (`Zu nah dran (..px statt
 * ..px, Defizit ~..px)`) traegt KEINE Vorschreibung → bleibt unangetastet
 * (ehrliche Distanz-Messung, kein Leak).
 *
 * @param {string} detail
 * @returns {string}
 */
function sanitizeCorrectionDetail(detail) {
  // Form 1+2: alles ab der Vorschreibungs-Klausel (Korrektur:/Fluchtweg:) inkl.
  // des vorausgehenden Satz-Trenners abschneiden.
  let out = detail.replace(/\.\s*(Korrektur|Kürzester Fluchtweg):.*$/u, '.');
  // Form 3: den ` (Δw=..px, Δh=..px)`-Paren entfernen (SAME-SIZE).
  out = out.replace(/\s*\(Δ[wh]=[^)]*\)/u, '');
  return out;
}

/**
 * classifyCanvas — Canvas-Validitaet aus zwei orthogonalen Renderer-Signalen.
 *
 * Pessimismus-Praezedenz (am-staerksten-degradiert gewinnt). Reihenfolge:
 *   1. nicht-leerer sanitizeLoss            → 'lossy'            (DOMPurify hat
 *                                              Semantik entfernt; dominiert alles)
 *   2. viewBoxValidity === 'degenerate'     → 'degenerate'      (NaN/zero/negativ)
 *   3. viewBoxValidity === 'default_replaced' → 'default_replaced' (300x150 legitim)
 *   4. sonst                                → 'valid'
 *
 * Die Eingabe-Felder erzeugt der Renderer (Schritt 2); hier nur die reine
 * Klassifikation synthetischer Eingaben.
 *
 * @param {{viewBoxValidity?: string, sanitizeLoss?: Array}} resolved
 * @returns {'valid'|'default_replaced'|'degenerate'|'lossy'}
 */
export function classifyCanvas({ viewBoxValidity, sanitizeLoss } = {}) {
  if (Array.isArray(sanitizeLoss) && sanitizeLoss.length > 0) return 'lossy';
  if (viewBoxValidity === 'degenerate') return 'degenerate';
  if (viewBoxValidity === 'default_replaced') return 'default_replaced';
  return 'valid';
}

/**
 * assertEmissionGated — Live-Form der superRefine-Invariante aus
 * schema.js:316-345. Reine Pruefung: liefert die Liste der Verstoesse (entscheidet
 * NICHT ueber die Fail-closed-Reaktion — das tut der Caller in Schritt 3).
 *
 * Ein Verstoss liegt vor, wenn eine correction ein dx oder dy traegt, deren
 * Ziel-Element bbox_reliability ∈ {'not_measurable','approximate'} hat.
 * Map-Lookup-Muster wie schema.js:319-321; '#'-Praefix-Strip wie schema.js:326;
 * Lookup-Fehlschlag (reliability === undefined) ist KEIN Verstoss (schema.js:332).
 *
 * @param {{scene?: {elements?: Array}, corrections?: Array}} structured
 * @returns {Array<{index: number, element: string, reliability: string, message: string}>}
 */
export function assertEmissionGated(structured) {
  const violations = [];
  if (!structured?.scene) return violations;
  const elements = structured.scene.elements;
  if (!Array.isArray(elements)) return violations;
  const corrections = structured.corrections;
  if (!Array.isArray(corrections)) return violations;

  const reliabilityById = new Map();
  for (const el of elements) {
    reliabilityById.set(el.id, el.bbox_reliability);
  }

  for (let i = 0; i < corrections.length; i++) {
    const c = corrections[i];
    if (!c || typeof c.element !== 'string') continue;
    const id = c.element.replace(/^#/, '');
    const reliability = reliabilityById.get(id);
    // Lookup-Fehlschlag: separater REGEL-3-Bruch (β-003), hier kein Verstoss.
    if (reliability === undefined) continue;
    if (reliability === 'not_measurable' || reliability === 'approximate') {
      const hasDx = c.dx !== undefined;
      const hasDy = c.dy !== undefined;
      if (hasDx || hasDy) {
        violations.push({
          index: i,
          element: c.element,
          reliability,
          message:
            `REGEL-3: corrections[${i}].element='${c.element}' verweist auf scene.elements mit ` +
            `bbox_reliability='${reliability}' — dx/dy duerfen nicht emittiert werden (Spotter-Anti-Luege).`,
        });
      }
    }
  }
  return violations;
}

/**
 * countTruncation — ehrlicher Trunkierungs-Zaehler. Ersetzt spaeter das harte
 * structured.js:426 `suppressed: 0`.
 *
 * @param {Array} items - die vollstaendige (ungekuerzte) Liste
 * @param {number} cap  - die Obergrenze sichtbarer Eintraege
 * @returns {{total: number, returned: number, suppressed: number}}
 */
export function countTruncation(items, cap) {
  const total = items.length;
  const returned = Math.min(cap, total);
  const suppressed = Math.max(0, total - cap);
  return { total, returned, suppressed };
}
