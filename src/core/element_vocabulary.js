/**
 * element_vocabulary.js — SSOT für Element-Vokabular (Sprint-β2 §1.3 LAYER-TRENNUNG)
 * Vector Mirror v2.6
 *
 * Core module (REGEL-4 Hexagonal): lebt in core/, darf aus core/ + node:* importieren,
 *   wird von adapters/* und tests/* konsumiert; importiert NICHT aus adapters/ oder interface/.
 *
 * Layer-Trennung (Patch2, Mini-Review-Konvergenz Opus+Codex):
 *   - DOMAIN-Layer:  isSpotterTag(tag) Predicate + AUTO_ID_FORMAT_REGEX (hier).
 *   - FORMAT-Layer:  formatAutoId/extractAutoIds/computeSvgHashPrefix in auto_ids.js
 *                    (pure Format-Helper, keine Domain-Listen).
 *
 * Begründung Predicate-API (F-PATCH-CODEX-001 + F-OPUS-MINI-002 konvergent):
 *   `Object.freeze(new Set(...))` ist auf V8 SCHEIN-Defensive — interne Set-Slots
 *   sind nicht via Property-Descriptor geschützt, `set.add(...)` läuft trotzdem
 *   durch. Konsequenz: das Set in Modul-Scope PRIVAT halten, nur als Predicate
 *   nach aussen geben → keine externe Mutation möglich (V8-mechanisch).
 *
 * Tag-Wahl SPOTTER-Set (15 Tags, MDN-Renderable minus pure Container):
 *   - Wurzel-Quelle: MDN <https://developer.mozilla.org/en-US/docs/Web/SVG/Element>
 *     "Renderable elements" — Elemente, die grafische Ausgabe erzeugen können.
 *   - Pure Container ausgenommen: <g>, <svg>, <symbol> (haben keine eigene Geometrie,
 *     ihre Geometrie ist die ihrer Kinder; in SKIP_TAGS).
 *   - Inkludiert: a, circle, ellipse, foreignObject, image, line, path, polygon,
 *     polyline, rect, switch, text, textPath, tspan, use.
 *   - Adressiert F-OPUS-MINI-001 (Verhaltens-Drift): vor Patch1 lieferte
 *     getStablePath() für ALLE non-SKIP-Tags eine ID, der Spotter sah <a>,
 *     <switch>, <textPath>, <tspan>. Patch1 mit 10er-Liste droppte diese stumm.
 *   - <foreignObject> Defensive: DOMPurify USE_PROFILES.svg strippt aktuell,
 *     aber Profile-Erweiterung ist zukünftige Möglichkeit — Predicate ist
 *     dann ohne Code-Änderung korrekt.
 *
 * Wurzel-Fix für F-CODEX-002 (Tag-Allowlist nicht erzwungen) + SC-4-Drift
 * (Format-Regex nicht ausführbar grep-bar): 4 Reviewer (Validator + Opus
 * + Gemini + Codex) konvergent fanden 4 widersprüchliche Tag-Listen verstreut
 * im Code. Die Synthese identifizierte als Wurzel: "Kein Single-Source-of-
 * Truth für Element-Vokabular".
 *
 * Pattern-Vorlage: fabric.js
 * `parser/constants.ts` (zentrale Constants, alle Konsumenten importieren).
 *
 * Quellen für die übrigen Sets:
 *   - SKIP_TAGS: Spotter-Negativ-Liste — semantisch nicht-geometrisch oder
 *     Container/Definitions/Style/Script. Disjunkt-Konstellation: SKIP_TAGS
 *     und das (private) Spotter-Set überlappen nicht.
 *   - DELTA_ATTRIBUTABLE_TAGS: Untermenge des Spotter-Sets, für die der
 *     Emitter (structured.js) eine delta-zu-Attribut-Mapping kennt
 *     (Subset-Drift-Test via isSpotterTag-Predicate).
 *
 * Format-Vertrag (AUTO_ID_FORMAT_REGEX):
 *   Aus _SPOTTER_SET dynamisch abgeleitet — Drift ist mechanisch ausgeschlossen,
 *   weil die Regex bei Vokabular-Änderung automatisch folgt.
 */

/**
 * Privates Spotter-Set (15 Tags). NICHT exportiert — nur über isSpotterTag()
 * und AUTO_ID_FORMAT_REGEX zugänglich. Damit ist externe Mutation
 * V8-mechanisch ausgeschlossen (Predicate hat keine .add/.delete-Surface).
 *
 * Case-Konvention (Patch3, F-PATCH2-OPUS-001 + F-PATCH2-CODEX-001 konvergent
 * HIGH): ALLE Tokens lowercase. Begründung — Browser-DOM-API liefert über
 * `el.tagName.toLowerCase()` einheitlich lowercase (HTML-Konvention; im
 * SVG-Namespace ist tagName zwar case-preserving, aber Renderer-Adapter
 * normalisiert defensiv). Vorherige Patch2-Schreibweise (`foreignObject`,
 * `textPath` camelCase) erzeugte Asymmetrie zum Browser-Pfad, weshalb diese
 * beiden Tags im Renderer stumm gedropt wurden. Lowercase-everywhere ist
 * die kanonische Single-Boundary-Normalisierung (kein Lookup-Table,
 * SKIP_TAGS war ohnehin schon lowercase — Symmetrie hergestellt).
 *
 * Reihenfolge: alphabetisch (Determinismus für die abgeleitete Regex-Alternation).
 */
const _SPOTTER_SET = new Set([
  'a',
  'circle',
  'ellipse',
  'foreignobject',
  'image',
  'line',
  'path',
  'polygon',
  'polyline',
  'rect',
  'switch',
  'text',
  'textpath',
  'tspan',
  'use',
]);

/**
 * Predicate: ist `tag` ein Spotter-Tag (geometrisch messbar via getBBox,
 * kein purer Container)? O(1) Set-Lookup auf privates Set.
 *
 * Konsumenten (playwright.js Browser-Scope, Tests): nutzen diesen Predicate
 * statt eines Set-Exports — das verhindert die V8-Set-Mutation-Lücke
 * (F-PATCH-CODEX-001 + F-OPUS-MINI-002).
 *
 * Hinweis Browser-Bridge (playwright.js): Predicate-Funktionen können nicht
 * über page.evaluate() seriali­siert werden. Adapter berechnet stattdessen
 * EINMAL `[..._SPOTTER_SET]` indirekt via `isSpotterTag`-Probing über eine
 * bekannte Tag-Liste ODER importiert eine separate Liste vom Renderer-
 * Adapter-Lifecycle. ABER: hier in core/ exportieren wir bewusst nur den
 * Predicate. Renderer-Bridge-Strategie ist Adapter-Sache (siehe playwright.js).
 *
 * Case-Defensive (Patch3): Input wird via `String(tag).toLowerCase()`
 * normalisiert. Damit liefert der Predicate für `textPath`, `textpath`
 * und `TEXTPATH` einheitlich `true`. Non-String Inputs (null, undefined,
 * Zahlen) werden via `String(...)` zu ihrer String-Repräsentation
 * koerciert (`"null"`, `"undefined"`, `"123"`) und matchen damit das Set
 * NICHT — funktional false ohne Exception. Bewusste Wahl: defensiv
 * statt strikt, weil der Browser-Pfad in einer Promise-Chain läuft und
 * unerwartete TypeError-Throws schwer zu lokalisieren wären.
 *
 * @param {string} tag - SVG-Element-Tag in beliebiger Schreibweise;
 *   Predicate normalisiert intern via toLowerCase().
 * @returns {boolean} true wenn Spotter sehen soll, false sonst.
 */
export function isSpotterTag(tag) {
  return _SPOTTER_SET.has(String(tag).toLowerCase());
}

/**
 * Frozen Snapshot-Array des Spotter-Sets, AUSSCHLIESSLICH für die Renderer-
 * Adapter-Bridge (playwright.js → page.evaluate). Sets sind nicht JSON-
 * serialisierbar, Predicate-Funktionen nicht über page.evaluate übertragbar
 * (Browser-Sandbox-Boundary, H-10/PH-10). Daher diese Array-API: Adapter
 * serialisiert sie als Arg-Pass, der Browser-Scope rekonstruiert ein eigenes
 * Set über `new Set(arr)` (mutation-isoliert vom Node-Land).
 *
 * Object.freeze auf einem Array IST effektiv: push/pop/splice werfen im
 * strict-mode bzw. werden silent verworfen. Im Gegensatz zu Set ist das
 * V8-Mutations-Lock hier real (Property-Descriptor sperrt length + Indizes).
 *
 * Reihenfolge: dieselbe wie _SPOTTER_SET (alphabetisch). Tests dürfen sich
 * NICHT auf eine bestimmte Reihenfolge verlassen — die Liste ist semantisch
 * ein Set, der Array-Wrapper ist Serialisierungs-Trick.
 *
 * Case-Garantie (Patch3): Liste ist via `[..._SPOTTER_SET]` direkt aus dem
 * lowercase-Set abgeleitet — jedes Element ist lowercase. Drift-Guard in
 * playwright.js verifiziert das zusätzlich Build-/Runtime (Case-Invariante).
 *
 * Konsumenten-Hinweis: Code, der über die Tag-Mitgliedschaft entscheiden
 * muss, soll `isSpotterTag(tag)` benutzen, NICHT diese Liste iterieren.
 * Die Liste ist nur das Bridge-Snapshot zur Browser-Sandbox.
 */
export const SPOTTER_TAGS_LIST = Object.freeze([..._SPOTTER_SET]);

/**
 * Skip-Tags: Renderer-seitige Negativ-Liste (playwright.js iteriert
 * darüber hinweg). Container (`g`, `svg`, `symbol`), Definitions (`defs`,
 * `marker`), Style/Script/Metadata sowie Mask/Clip/Filter — keiner davon
 * trägt eigene Geometrie, die der Spotter messen soll.
 *
 * Bleibt als Set-Export, weil die Browser-Bridge die Liste iteriert
 * (`new Set(skipTagsArr)` im Browser-Scope, Mutation in core ist nicht
 * Trust-Boundary). pattern/svg/marker/symbol sind hier nicht alle drin —
 * sie werden durch `!isSpotterTag(tag)` ohnehin dynamisch geskippt; SKIP_TAGS
 * ist die EXPLIZITE Liste der Tags, die playwright.js per Fast-Path früh
 * verwirft (vor jeder Style/BBox-Inspektion).
 *
 * §HEAL3 (ST-A) Doku-Schuld (HEAL §7-4): `pattern` fehlt hier BEWUSST und
 * BLEIBT es — SKIP_TAGS unterdrückt nur die Container SELBST, nicht deren
 * KINDER (das <rect> IN einem <defs>/<symbol>/<clipPath>/<pattern>), die als
 * Phantome durchrutschen würden. Der kategorische closest()-Schnitt in
 * playwright.js (`el.closest('defs,symbol,clipPath,mask,pattern,marker')`)
 * deckt BEIDE Lecks zugleich: die fehlende Container-Mitgliedschaft (pattern)
 * UND die Container-Kinder. Daher KEINE Erweiterung von SKIP_TAGS nötig —
 * das wäre eine zweite, falsche Vergleichs-Ebene (SKIP_TAGS testet gegen
 * tagName.toLowerCase() → lowercase `clippath`; closest() matcht den
 * qualifizierten SVG-Namen → camelCase `clipPath`). NICHT vermischen.
 */
export const SKIP_TAGS = Object.freeze(
  new Set([
    'defs',
    'title',
    'desc',
    'metadata',
    'style',
    'script',
    'g',
    'filter',
    'clippath',
    'mask',
    'symbol',
    'marker',
    'stop',
  ]),
);

/**
 * Delta-attributable Tags: Untermenge des Spotter-Sets, für die der
 * Emitter (structured.js `deltaToAttribute`) eine dx/dy/dw/dh→Attribut-
 * Mapping vorhält. Subset-Invariante zum Spotter-Set (Drift-Test in
 * test_element_vocabulary.js prüft `every tag => isSpotterTag(tag)`).
 *
 * Bleibt als Set-Export, weil der Drift-Test iteriert.
 */
export const DELTA_ATTRIBUTABLE_TAGS = Object.freeze(
  new Set(['circle', 'rect', 'text', 'ellipse', 'line', 'image']),
);

/**
 * Predicate: trägt `tag` eine native dx/dy/dw/dh→Attribut-Mapping (= ist er in
 * DELTA_ATTRIBUTABLE_TAGS)? Single-Point-of-Truth für die §1.5-Verzweigung in
 * structured.js buildFix: JA → bestehender Attribut-Pfad (x/y/cx/cy/r/...),
 * NEIN → Transform-Fallback (translate) bzw. SIZE_FIX_UNSUPPORTED_FOR_TAG.
 *
 * Symmetrisch zu isSpotterTag: normalisiert Input via String(tag).toLowerCase()
 * (Browser-Pfad liefert lowercase; defensive Koerzierung für null/undefined/
 * Zahlen → false ohne Throw).
 *
 * @param {string} tag - SVG-Element-Tag in beliebiger Schreibweise.
 * @returns {boolean} true wenn der Tag eine native Delta-Attribut-Mapping hat.
 */
export function isTagDeltaAttributable(tag) {
  return DELTA_ATTRIBUTABLE_TAGS.has(String(tag).toLowerCase());
}

/**
 * Auto-ID-Format-Regex — aus _SPOTTER_SET DYNAMISCH abgeleitet.
 *
 * Format-Vertrag (D-004, ADR-025 §3): `_<8hex>_<tag><n>` mit
 *   <tag> ∈ Spotter-Set, <8hex> = lowercase hex (sha256-Prefix),
 *   <n>   = monoton steigender, tag-lokaler Counter (1-basiert).
 *
 * Drift-Garantie: wenn _SPOTTER_SET sich ändert, folgt die Regex
 * AUTOMATISCH — keine zweite, hardcoded Liste pflegen.
 *
 * Case-Konvention (Patch3, F-PATCH2-OPUS-001 + F-PATCH2-CODEX-001): kanonische
 * Auto-ID-Schreibweise ist lowercase. Begründung — _SPOTTER_SET ist
 * lowercase, Renderer (playwright.js) baut Auto-IDs aus tag-lowercase +
 * hash-prefix-lowercase + zähler. Damit ist die Auto-ID kanonisch
 * lowercase, und die Format-Regex ist deterministisch case-sensitive
 * (kein `i`-Flag mehr). Das `i`-Flag aus Patch2 war kompensatorisch zur
 * camelCase-Set-Asymmetrie; mit lowercase-everywhere ist die Asymmetrie
 * eliminiert. Konsequenz: `_deadbeef_foreignObject1` matcht nicht mehr —
 * solche IDs sind per Vertrag nicht produzierbar (Renderer normalisiert).
 */
export const AUTO_ID_FORMAT_REGEX = new RegExp(
  `^_[0-9a-f]{8}_(${[..._SPOTTER_SET].join('|')})\\d+$`,
);
