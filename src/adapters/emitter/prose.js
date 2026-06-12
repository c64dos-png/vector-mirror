/**
 * prose.js — Spotter Report Formatter (Text)
 * Vector Mirror v2.5 (P1-04 migrated)
 *
 * Adapter module: presentation-layer formatting.
 * P1-04 changes:
 *   - Consumes tri-state shape: `arbitrated.{failing, unchecked, diff, totals}`.
 *     §E1: `arbitrated.failing` ist die EINE (gegatete) Wahrheitsquelle — der
 *     Caller (pipeline.js) reicht die honesty.js#gateCorrections-Liste dort
 *     rein (symmetrisch zu formatStructured). Kein separater 3.-Arg-Kanal mehr;
 *     so leakt KEIN Pixel-Delta (Objekt-Feld NOCH detail-STRING) und der
 *     fail-closed-Assert (REGEL-8) bewacht die konsumierte Liste lueckenlos.
 *   - Caps applied HERE (top-3 failing, top-3 unchecked, top-2 diff). Total
 *     suppressed-count printed; full set lives in structured output.
 */

const FAILING_CAP = 3;
const UNCHECKED_CAP = 3;
const DIFF_CAP = 2;
const SANITIZE_LOSS_CAP = 3;
// §H9 P1: Längen-Deckel für das Wert-Echo in der Verlust-Zeile (Fremdtext).
const SANITIZE_LOSS_VALUE_CAP = 40;

/**
 * §H9 P1 Echo-Hygiene: der gestrippte Attribut-WERT ist FREMDTEXT (Autor-/
 * Angreifer-kontrolliert) und darf die Report-Grammatik nicht fälschen. EIN
 * Schritt, EIN Prinzip — das Echo bleibt ein Zitat, nie Struktur:
 *   Whitespace (inkl. \n\r\t) zu einzelnen Spaces kollabieren (keine geforgte
 *   ✗-/STATUS-Zeile), doppelte Anführungszeichen neutralisieren (die
 *   `="…"`-Echo-Grammatik bleibt eindeutig), Länge kappen (keine 2000-Zeichen-
 *   Bombe). Wahrheit bleibt: ein gekürztes Echo ist ehrlich markiert (…).
 */
function sanitizeValueEcho(value) {
  const flat = String(value).replace(/\s+/g, ' ').replace(/"/g, "'");
  return flat.length > SANITIZE_LOSS_VALUE_CAP
    ? `${flat.slice(0, SANITIZE_LOSS_VALUE_CAP)}…`
    : flat;
}

/**
 * §H9 K-03/K-24/K-05: EINE Wahrheits-Quelle für die Verlust-Warnzeile
 * (formatReport + formatErrorWithLoss — der frühere Wortlaut war physisch
 * dupliziert UND behauptete hartkodiert "(id/name)" als Ursache, die der
 * Emitter gar nicht kennen konnte). Die Zeile nennt die ECHTEN, vom Caller
 * R9-stabilisierten Ursachen aus sanitizeLoss (tag + reason; bei gestripptem
 * Attribut den konkreten Wert mit, z.B. die verlorene Autor-id). Cap klein
 * (Top 3 + Rest-Zähler). Fehlt die Liste, wird KEINE Ursache geraten —
 * lieber ehrlich generisch als plausibel lügen.
 *
 * @param {Array<{tag:string, reason:string, value?:string}>} [sanitizeLoss]
 * @returns {string} die ⚠-Warnzeile.
 */
function sanitizeLossLine(sanitizeLoss) {
  const loss = Array.isArray(sanitizeLoss) ? sanitizeLoss : [];
  const tokens = loss
    .slice(0, SANITIZE_LOSS_CAP)
    .map((l) =>
      l.value !== undefined
        ? `${l.tag} (${l.reason}="${sanitizeValueEcho(l.value)}")`
        : `${l.tag} (${l.reason})`,
    );
  const rest = loss.length - tokens.length;
  const head =
    tokens.length > 0
      ? `Sanitizer hat entfernt: ${tokens.join(' · ')}${rest > 0 ? ` · +${rest} weitere` : ''}`
      : 'Sanitizer hat Inhalt entfernt';
  return (
    `⚠ Hinweis: ${head} — ` +
    'Messung referenzierender Elemente kann von der Quelle abweichen (canvas_validity=lossy)'
  );
}

export function formatReport(gridMap, arbitrated, opts = {}) {
  const lines = [];

  // §HEAL-R6 / T1 "das Kabel" (F-AT-6-08): die Canvas-Validität aus dem Caller
  // (pipeline.js, aus resolved.sanitize_loss DIREKT via classifyCanvas —
  // Anti-LECK-3). 'lossy' ⇒ DOMPurify hat Inhalt entfernt; die
  // Messung referenzierender Elemente kann von der Quelle abweichen. Wie
  // paintDead/overflow ist das ein HINWEIS, der NIE unter "✓ Alles korrekt"
  // verschwinden darf — reine Durchreichung des Caller-Verdikts, KEINE Mess-Logik.
  // §H10 R11-13: das Verdikt ist VIERWERTIG (valid|default_replaced|degenerate|
  // lossy) — JEDER nicht-valide Wert zählt als Hinweis (Kanal-Parität zu
  // structured.scene.canvas_validity), nicht nur lossy.
  const canvasValidity = opts.canvasValidity;
  const canvasLossy = canvasValidity === 'lossy';

  // §E1 R3 (Symmetrie + REGEL-8 dicht): prose hat — wie formatStructured — GENAU
  // EINE failing-Wahrheitsquelle: `arbitrated.failing`. Der Caller (pipeline.js)
  // reicht dort die GEGATETE Liste (honesty.js#gateCorrections) rein; es gibt
  // keinen zweiten (ungegateten) Kanal und keinen klobigen 3.-Arg-Vertrag mehr.
  // Der fail-closed-Assert (REGEL-8) bewacht damit die NATUERLICHE Aufruf-Form:
  // jedes konsumierte failing-issue MUSS _gated tragen, sonst Wurf — eine
  // ungegatete Emission ist mechanisch unmoeglich (kein `|| []`-Kollaps mehr,
  // der den Assert umgeht). Gegatete Derivate sind um dx/dy/dw/dh UND um die
  // Korrektur-Vorschreibung im detail-String bereinigt → kein Leak in beiden
  // Kanaelen (FAILING-Top-Liste + Element-Baum).
  const failing = arbitrated.failing || [];
  for (const issue of failing) {
    if (issue._gated === undefined) {
      throw new Error(
        'formatReport: ungegatetes failing-issue (kein _gated) — ' +
          'gateCorrections am Emissions-Rand fehlt (REGEL-8 fail-closed).',
      );
    }
  }
  const unchecked = arbitrated.unchecked || [];
  const diff = arbitrated.diff || [];

  const failingCount = failing.length;
  const uncheckedCount = unchecked.length;
  const diffCount = diff.length;

  // \u00A7HEAL-R6 / T1 PROSA-EHRLICHKEIT (F-AT-6-01, DoD-2): die Tinten-tot-Existenz
  // (paint_visible:false / PAINT_NOT_VISIBLE) ist im structured-Kanal bereits
  // ehrlich gemeldet \u2014 der PROSA-Kanal l\u00FCgt aber weiter ("red \u2713 / Alles korrekt").
  // KEINE neue Mess-Logik: das Signal kommt fertig aus gridMap.elements (Renderer
  // \u2192 grid.js-Durchreichung). KEIN erfundener Constraint-Fehler \u2014 nur die
  // Existenz unsichtbarer Tinte sichtbar machen, konsistent zur Hinweis-Mechanik.
  const { canvas, elements } = gridMap;
  const paintDeadCount = elements.filter(isPaintDead).length;
  // §HEAL-R6 Variante 1 PROSA-EHRLICHKEIT (F-AT-6-07, DoD-2-Schwanz): ein
  // paint_visible:'indeterminate'-Element (räumlicher Operator present, Tinten-
  // Präsenz raster-frei NICHT entscheidbar) darf NIE unter "✓ Alles korrekt"
  // verschwinden — sonst lügt die Prosa weiter. Symmetrisch zu paintDeadCount,
  // reine Durchreichung (gridMap.elements). Disjunkt zu isPaintDead.
  const paintIndeterminateCount = elements.filter(isPaintIndeterminate).length;
  // \u00A7HEAL-R6 / T2 PROSA-EHRLICHKEIT (F-AT-6-02/03, DoD-3): has_paint_overflow ist
  // im structured-Kanal ehrlich (Tinte \u2014 Filter/stroke/Marker \u2014 ragt \u00FCber die als
  // reliable gemeldete geom-bbox hinaus), der PROSA-Kanal verschwieg es aber
  // ("\u2713 Alles korrekt"). KEINE neue Mess-Logik: das Signal kommt fertig aus
  // gridMap.elements (Renderer \u2192 grid.js). Symmetrisch zur paintDead-Mechanik: ein
  // Overflow z\u00E4hlt als Hinweis und darf NIE unter "\u2713 Alles korrekt" verschwinden.
  const paintOverflowCount = elements.filter(isPaintOverflow).length;
  // \u00A7D5 / R6-STATE PROSA-EHRLICHKEIT: ein zustands-abh\u00E4ngiges Element (interaktiver
  // Alt-Zustand existiert) darf NIE unter \u201E\u2713 Alles korrekt" verschwinden \u2014 sonst
  // l\u00FCgt die Prosa weiter. Symmetrisch zu paintOverflowCount, reine Durchreichung.
  const stateDependentCount = elements.filter(isStateDependent).length;
  // §F-AT-6-09 / R6-MEDIA PROSA-EHRLICHKEIT: ein viewport-abhängiges Element (ein
  // anderer Viewport rendert es anders) darf NIE unter „✓ Alles korrekt" verschwinden
  // — sonst lügt die Prosa weiter. Symmetrisch zu stateDependentCount, reine Durchreichung.
  const mediaDependentCount = elements.filter(isMediaDependent).length;
  // §HEAL-5 / Zeit-Achse PROSA-EHRLICHKEIT: ein zeit-variantes Element (die
  // Geometrie ist an anderem t anders) darf NIE unter „✓ Alles korrekt"
  // verschwinden — sonst lügt die Prosa weiter. Symmetrisch zu
  // mediaDependentCount, reine Durchreichung.
  const motionDependentCount = elements.filter(isMotionDependent).length;
  // §H10 R11-06 / Paint-Zeit-Achse PROSA-EHRLICHKEIT: ein paint-zeit-variantes
  // Element (Farbe/Opacity an anderem t anders) darf NIE unter „✓ Alles
  // korrekt" verschwinden. Symmetrisch zu motionDependentCount, reine
  // Durchreichung.
  const paintTimeVariantCount = elements.filter(isPaintTimeVariant).length;
  // \u00A7F-AT-7-02 PROSA-EHRLICHKEIT (SK5): ein stroke-Farb-Element (sichtbare Farbe aus
  // dem stroke) bzw. ein Mehrfach-Quellen-Element darf NIE unter \u201E\u2713 Alles korrekt"
  // verschwinden \u2014 sonst l\u00FCgt die Prosa weiter (\u201Etransparent \u2713"). Symmetrisch zu
  // stateDependentCount/mediaDependentCount, reine Durchreichung (gridMap.elements).
  const colorFromStrokeCount = elements.filter(isColorFromStroke).length;
  const multiplePaintSourcesCount =
    elements.filter(isMultiplePaintSources).length;

  // 1. STATUS \u2014 paintDead + paintOverflow z\u00E4hlen als Hinweis (d\u00FCrfen NIE unter
  // "\u2713 Alles korrekt" verschwinden). Folgt der bestehenden Hinweis-Logik (wie diffCount).
  // \u00A7HEAL-R6 / T1: ein lossy-Canvas z\u00E4hlt als zus\u00E4tzlicher Hinweis (1) und darf
  // \u2014 wie paintDead/overflow \u2014 NIE unter "\u2713 Alles korrekt" oder die reine
  // "ungepr\u00FCft"-Zeile verschwinden. \u00A7H10 R11-13: gleiche Mechanik f\u00FCr ALLE
  // nicht-validen canvas_validity-Werte (degenerate/default_replaced) \u2014 was
  // structured flaggt, flaggt die Prosa (Parit\u00E4t, kein Schwere-Urteil).
  // canvasNoteCount ist 0|1.
  const canvasNoteCount =
    canvasValidity !== undefined && canvasValidity !== 'valid' ? 1 : 0;
  if (
    failingCount === 0 &&
    uncheckedCount === 0 &&
    diffCount === 0 &&
    paintDeadCount === 0 &&
    paintIndeterminateCount === 0 &&
    paintOverflowCount === 0 &&
    stateDependentCount === 0 &&
    mediaDependentCount === 0 &&
    motionDependentCount === 0 &&
    paintTimeVariantCount === 0 &&
    colorFromStrokeCount === 0 &&
    multiplePaintSourcesCount === 0 &&
    canvasNoteCount === 0
  ) {
    lines.push('STATUS: \u2713 Alles korrekt');
  } else if (
    failingCount === 0 &&
    uncheckedCount > 0 &&
    diffCount === 0 &&
    paintDeadCount === 0 &&
    paintIndeterminateCount === 0 &&
    paintOverflowCount === 0 &&
    stateDependentCount === 0 &&
    mediaDependentCount === 0 &&
    motionDependentCount === 0 &&
    paintTimeVariantCount === 0 &&
    colorFromStrokeCount === 0 &&
    multiplePaintSourcesCount === 0 &&
    canvasNoteCount === 0
  ) {
    lines.push(
      `STATUS: ${uncheckedCount} ungepr\u00FCft (Spotter blind, siehe structured)`,
    );
  } else {
    const parts = [];
    if (failingCount > 0) parts.push(`${failingCount} Fehler`);
    if (uncheckedCount > 0) parts.push(`${uncheckedCount} ungepr\u00FCft`);
    // Tinten-tot + Overflow + Diff + Sanitize-Verlust sind alle "Hinweise" (keine
    // Spotter-Korrektur) \u2192 in EINEN Hinweis-Z\u00E4hler falten, damit die Zeile nicht
    // mehrere Hinweis-Begriffe tr\u00E4gt. paintDead/paintOverflow/lossy bekommen
    // zus\u00E4tzlich einen sprechenden Suffix-Vermerk.
    const hinweisCount =
      diffCount +
      paintDeadCount +
      paintIndeterminateCount +
      paintOverflowCount +
      stateDependentCount +
      mediaDependentCount +
      motionDependentCount +
      paintTimeVariantCount +
      colorFromStrokeCount +
      multiplePaintSourcesCount +
      canvasNoteCount;
    if (hinweisCount > 0)
      parts.push(`${hinweisCount} Hinweis${hinweisCount > 1 ? 'e' : ''}`);
    const noteParts = [];
    if (paintDeadCount > 0) noteParts.push(`${paintDeadCount} unsichtbar`);
    if (paintIndeterminateCount > 0)
      noteParts.push(`${paintIndeterminateCount} Sichtbarkeit unbestimmt`);
    if (paintOverflowCount > 0)
      noteParts.push(`${paintOverflowCount} Tinten-\u00DCberlauf`);
    if (stateDependentCount > 0)
      noteParts.push(`${stateDependentCount} zustands-abh\u00E4ngig`);
    if (mediaDependentCount > 0)
      noteParts.push(`${mediaDependentCount} viewport-abh\u00E4ngig`);
    if (motionDependentCount > 0)
      noteParts.push(`${motionDependentCount} zeit-variant`);
    if (paintTimeVariantCount > 0)
      noteParts.push(`${paintTimeVariantCount} paint-zeit-variant`);
    if (colorFromStrokeCount > 0)
      noteParts.push(`${colorFromStrokeCount} Farbe aus Rand`);
    if (multiplePaintSourcesCount > 0)
      noteParts.push(`${multiplePaintSourcesCount} mehrere Farbquellen`);
    // §H10 R11-13: je nicht-valider canvas_validity-Wert ein sprechendes Token
    // (Kanal-Parität: was structured flaggt, flaggt die Prosa). Unbekannte
    // künftige Enum-Werte passieren NIE still (generisches Echo).
    if (canvasNoteCount > 0) {
      if (canvasLossy) noteParts.push('Sanitize-Verlust');
      else if (canvasValidity === 'degenerate')
        noteParts.push('Canvas degeneriert');
      else if (canvasValidity === 'default_replaced')
        noteParts.push(`Canvas-Default ${canvas.width}×${canvas.height}`);
      else noteParts.push(`Canvas ${canvasValidity}`);
    }
    const suffix =
      failingCount > 0 || uncheckedCount > 0
        ? ' (Spotter-Korrektur aktiv)'
        : noteParts.length > 0
          ? ` (${noteParts.join(', ')}, siehe structured)`
          : '';
    lines.push(`STATUS: ${parts.join(', ')}${suffix}`);
  }

  // \u00A7HEAL-R6 / T1: die laute Verlust-Zeile. Direkt nach STATUS, damit sie der
  // LLM nie \u00FCbersieht. \u00A7H9 K-03/K-24/K-05: sie nennt die ECHTEN Ursachen aus
  // opts.sanitizeLoss (eine Wahrheits-Quelle: sanitizeLossLine) statt der
  // fr\u00FCheren hartkodierten Behauptung "(id/name)". Erscheint NUR bei lossy
  // (Negativ-Kontrolle: valid \u2192 keine Zeile).
  // §H10 R11-13: degenerate/default_replaced tragen ihre eigene Wahrheits-Zeile
  // (gemessener Sachverhalt + canvas_validity-Zeiger auf structured) — gleiche
  // Mechanik, Hinweis statt Tadel (CSS-Default ist spec-konform).
  if (canvasLossy) {
    lines.push(sanitizeLossLine(opts.sanitizeLoss));
  } else if (canvasValidity === 'degenerate') {
    lines.push(
      '⚠ Hinweis: viewBox degeneriert (nicht parsebar oder Breite/Höhe ≤0) — ' +
        'gemeldete Koordinaten beziehen sich auf einen Renderer-Fallback (canvas_validity=degenerate)',
    );
  } else if (canvasValidity === 'default_replaced') {
    lines.push(
      `⚠ Hinweis: SVG ohne width/height/viewBox — CSS-Default ${canvas.width}×${canvas.height} ` +
        'ersetzt die fehlende Deklaration (canvas_validity=default_replaced)',
    );
  } else if (canvasNoteCount > 0) {
    lines.push(
      `⚠ Hinweis: Canvas nicht valide (canvas_validity=${canvasValidity}, siehe structured)`,
    );
  }

  // 2a. FAILING (Top 3)
  const shownFailing = failing.slice(0, FAILING_CAP);
  for (const issue of shownFailing) {
    lines.push(
      `\u2717 ${issue.detail || `${issue.constraintType || 'CONSTRAINT'} #${issue.id || '?'}`}`,
    );
  }

  // 2b. UNCHECKED (Top 3) — visible reason, optional suggestion
  const shownUnchecked = unchecked.slice(0, UNCHECKED_CAP);
  for (const u of shownUnchecked) {
    const tail = u.suggestedCorrection
      ? ` (vielleicht: ${u.suggestedCorrection})`
      : '';
    const ref = u.id !== undefined ? `#${u.id}: ` : '';
    lines.push(`? ${ref}${u.hint}${tail}`);
  }

  // 2c. DIFF (Top 2) — szene-aenderungen
  const shownDiff = diff.slice(0, DIFF_CAP);
  for (const d of shownDiff) {
    switch (d.type) {
      case 'VERSCHOBEN':
        lines.push(`\u25B3 #${d.id}: ${d.from} \u2192 ${d.to}`);
        break;
      case 'FARB\u00C4NDERUNG':
        lines.push(`\u25B3 #${d.id}: Farbe ${d.from} \u2192 ${d.to}`);
        break;
      case 'FORM\u00C4NDERUNG':
        lines.push(`\u25B3 #${d.id}: ${d.from} \u2192 ${d.to} (Form)`);
        break;
      case 'NEU':
        lines.push(`+ #${d.id}: neu in ${d.cell} (${d.color})`);
        break;
      case 'ENTFERNT':
        lines.push(`- #${d.id}: entfernt (war in ${d.cell})`);
        break;
    }
  }

  // 3. Suppression-Hinweis: nur wenn wir oben gekuerzt haben
  const suppressed =
    failingCount -
    shownFailing.length +
    (uncheckedCount - shownUnchecked.length) +
    (diffCount - shownDiff.length);
  if (suppressed > 0) lines.push(`  (${suppressed} weitere siehe structured)`);

  // 4. SZENE
  lines.push('');
  const vbInfo = canvas.viewBox ? ` (viewBox: ${canvas.viewBox})` : '';
  lines.push(
    `SZENE: ${canvas.width}\u00D7${canvas.height}, ${elements.length} Elemente${vbInfo}`,
  );

  // \u00A7H10 R11-01: Existenz-Register \u2014 css-unsichtbare Elemente sind nicht Teil
  // der Szene (Emissions-Menge byte-stabil), d\u00FCrfen aber nicht verschwiegen
  // werden (Kanal-Parit\u00E4t zu scene.hidden_elements; Stil der suppressed-Zeile).
  const hiddenCount = Array.isArray(gridMap.hidden) ? gridMap.hidden.length : 0;
  if (hiddenCount > 0)
    lines.push(
      `  (${hiddenCount} Element${hiddenCount > 1 ? 'e' : ''} css-unsichtbar \u2014 siehe structured)`,
    );

  // §HEAL-7/B (F-TF-003): Verdikt-/Korrektur-Attribution per OBJEKT-IDENTITÄT.
  // checkAllConstraints misst per .find() das ERSTE Element einer id — ein
  // failing-issue gehört daher GENAU diesem Objekt. Der reine id-String-
  // Vergleich heftete Korrektur + ✗ auch an UNGEMESSENE Namensvettern
  // (Boden-Wahrheit f003: beide rect#x trugen [dy=2470px] ✗). firstById
  // spiegelt die Mess-Semantik: nur das gemessene Objekt trägt Korrektur/✗.
  // Zweite Verteidigungslinie — die Pipeline-Wache (MEASUREMENT_AMBIGUOUS)
  // lässt ambige ids gar nicht erst in failing. unchecked (⚠) bleibt bewusst
  // id-basiert: eine VERWEIGERTE Messung impliziert ALLE Namensvettern (kein
  // Objekt wurde gemessen, der Vorbehalt gilt dem Namen).
  const firstById = new Map();
  for (const e of elements) {
    if (!firstById.has(e.id)) firstById.set(e.id, e);
  }
  const isMeasuredCarrier = (el) => firstById.get(el.id) === el;

  // 5. ELEMENT-BAUM (Top 7)
  const maxShow = Math.min(elements.length, 7);
  for (let i = 0; i < maxShow; i++) {
    const el = elements[i];
    const prefix = i < maxShow - 1 ? '\u251C\u2500' : '\u2514\u2500';
    // \u00A7HEAL-R6 / T1: Tinten-tot ist ORTHOGONAL zum Constraint-Verdikt. getStatus
    // bleibt die Constraint-Wahrheit (\u2717 fail / \u26A0 unchecked / \u2713 ok); ein bare \u2713
    // wird bei Tinten-Tot zu \u26A0 degradiert (kein falsches "korrekt"), ein echtes \u2717
    // bleibt \u2717 (Constraint-Fehler dominiert). Der sprechende Vermerk h\u00E4ngt IMMER
    // an, wenn paint-tot \u2014 so verschwindet die Unsichtbarkeit in KEINEM Fall.
    const paintDead = isPaintDead(el);
    // \u00A7HEAL-R6 Variante 1: Tinten-Unbestimmtheit ist ORTHOGONAL zum Constraint-
    // Verdikt UND zu paintDead. STRIKT getrennt: ein indeterminate-Element ist NICHT
    // tot (KEINE "unsichtbar"-Behauptung), aber auch NICHT als korrekt-sichtbar zu
    // melden \u2014 ehrlich unbestimmt. Wie paintDead degradiert es ein bare \u2713 zu \u26A0.
    const paintIndeterminate = isPaintIndeterminate(el);
    // \u00A7HEAL-R6 / T2: Tinten-\u00DCberlauf ist ORTHOGONAL zum Constraint-Verdikt UND zu
    // paintDead (ein Element kann beides ODER nur eines tragen). Wie paintDead
    // degradiert ein bare \u2713 zu \u26A0 (kein falsches "korrekt"), ein echtes \u2717 bleibt \u2717.
    const paintOverflow = isPaintOverflow(el);
    // \u00A7D5 / R6-STATE: Zustands-Abh\u00E4ngigkeit ist ORTHOGONAL zum Constraint-Verdikt
    // UND zu paintDead/overflow. Wie diese degradiert sie ein bare \u2713 zu \u26A0 (kein
    // falsches \u201Ekorrekt"), ein echtes \u2717 bleibt \u2717. KEINE \u201Eunsichtbar"-Behauptung.
    const stateDependent = isStateDependent(el);
    // §F-AT-6-09 / R6-MEDIA: Viewport-Abhängigkeit ist ORTHOGONAL zum Constraint-
    // Verdikt UND zu paintDead/overflow/state. Wie diese degradiert sie ein bare
    // Häkchen zu ⚠ (kein falsches "korrekt"), ein echtes ✗ bleibt ✗.
    const mediaDependent = isMediaDependent(el);
    // \u00A7HEAL-5 / Zeit-Achse: Zeit-Varianz ist ORTHOGONAL zum Constraint-Verdikt
    // UND zu paintDead/overflow/state/media. Wie diese degradiert sie ein bare
    // H\u00E4kchen zu \u26A0 (kein falsches "korrekt"), ein echtes \u2717 bleibt \u2717.
    const motionDependent = isMotionDependent(el);
    // §H10 R11-06 / Paint-Zeit-Achse: Paint-Zeit-Varianz ist ORTHOGONAL zum
    // Constraint-Verdikt UND zu motionDependent (Geometrie-Zeit ≠ Paint-Zeit).
    // Wie diese degradiert sie ein bare ✓ zu ⚠, ein echtes ✗ bleibt ✗.
    const paintTimeVariant = isPaintTimeVariant(el);
    // \u00A7F-AT-7-02: die sichtbare Farbe stammt aus dem stroke bzw. mehrere Farbquellen
    // malen sichtbar \u2014 ORTHOGONAL zum Constraint-Verdikt. Wie die anderen Notes
    // degradiert ein bare \u2713 zu \u26A0 (kein falsches \u201Ekorrekt"), ein echtes \u2717 bleibt \u2717.
    const colorFromStroke = isColorFromStroke(el);
    const multiplePaintSources = isMultiplePaintSources(el);
    let status = getStatus(el, failing, unchecked, isMeasuredCarrier(el));
    if (
      (paintDead ||
        paintIndeterminate ||
        paintOverflow ||
        stateDependent ||
        mediaDependent ||
        motionDependent ||
        paintTimeVariant ||
        colorFromStroke ||
        multiplePaintSources) &&
      status === '\u2713'
    )
      status = '\u26A0';
    // Vermerk OHNE eigenes Glyph \u2014 das Status-Glyph (\u26A0) am Zeilenende tr\u00E4gt das
    // Symbol. Der Text macht die Ursache(n) explizit. Beide Vermerke k\u00F6nnen
    // gleichzeitig anh\u00E4ngen (orthogonal). visual_bbox-Zahl, wenn messbar, sonst
    // 'not_measurable' (ehrlich: \u00DCberlauf da, Schranke unsicher). paintDead und
    // paintIndeterminate sind disjunkt (false \u2260 'indeterminate'); der unbestimmte
    // Vermerk behauptet NIE Unsichtbarkeit, nur Unbestimmtheit.
    const paintNote = paintDead
      ? ' unsichtbar (PAINT_NOT_VISIBLE)'
      : paintIndeterminate
        ? ' Sichtbarkeit unbestimmt (PAINT_PRESENCE_INDETERMINATE)'
        : '';
    const overflowNote = paintOverflow
      ? ` Tinten-\u00DCberlauf (has_paint_overflow, visual_bbox=${formatVisualBbox(el.visual_bbox)})`
      : '';
    // \u00A7D5 / R6-STATE: ehrlicher Vermerk, dass interaktive Alt-Zust\u00E4nde existieren
    // (orthogonal, h\u00E4ngt zus\u00E4tzlich an wie die anderen Notes).
    const stateNote = stateDependent
      ? ' zustands-abh\u00E4ngig (STATE_DEPENDENT)'
      : '';
    // \u00A7F-AT-6-09 / R6-MEDIA: ehrlicher Vermerk, dass ein anderer Viewport dieses
    // Element anders rendert (orthogonal, h\u00E4ngt zus\u00E4tzlich an wie die anderen Notes).
    const mediaNote = mediaDependent
      ? ' viewport-abh\u00E4ngig (MEDIA_DEPENDENT)'
      : '';
    // \u00A7HEAL-5 / Zeit-Achse: ehrlicher Vermerk, dass die Geometrie an anderem t
    // anders ist (orthogonal, h\u00E4ngt zus\u00E4tzlich an wie die anderen Notes).
    const motionNote = motionDependent
      ? ' zeit-variant (MOTION_DEPENDENT)'
      : '';
    // §H10 R11-06: ehrlicher Vermerk, dass Farbe/Sichtbarkeit an anderem t
    // anders ist (orthogonal, hängt zusätzlich an wie die anderen Notes).
    const paintTimeNote = paintTimeVariant
      ? ' paint-zeit-variant (PAINT_TIME_VARIANT)'
      : '';
    // \u00A7F-AT-7-02 (SK5): ehrlicher Vermerk, dass die sichtbare Farbe aus dem stroke
    // stammt (der fill tr\u00E4gt keine sichtbare Farbe bei) bzw. dass mehrere Quellen
    // sichtbar malen \u2014 orthogonal, h\u00E4ngt zus\u00E4tzlich an wie die anderen Notes.
    const colorNote = colorFromStroke
      ? ' Farbe aus Rand (COLOR_FROM_STROKE)'
      : multiplePaintSources
        ? ' mehrere Farbquellen (MULTIPLE_PAINT_SOURCES)'
        : '';
    const pos = el.span || `${el.cell}, ${el.direction}`;
    const text = el.textContent ? ` "${el.textContent}"` : '';
    // \u00A7F-AT-7-02 (SK5): bei COLOR_FROM_STROKE IST el.color bereits die stroke-Farbe
    // (grid.js-Projektion) \u2014 das redundante `[Rand: red]`-Suffix w\u00E4re eine doppelte
    // Nennung derselben Farbe und wird unterdr\u00FCckt. Bei MULTIPLE_PAINT_SOURCES ist
    // el.color der fill und der stroke eine ECHT separate sichtbare Farbe \u2192 das
    // Suffix bleibt (es tr\u00E4gt eine zus\u00E4tzliche Wahrheit, keine Redundanz).
    const strokeInfo =
      el.stroke && el.stroke !== 'transparent' && !colorFromStroke
        ? ` [Rand: ${el.stroke}]`
        : '';
    const opacityWarn = el.opacity < 0.3 ? ' (fast unsichtbar)' : '';

    // §E1 D-006/R2: Korrektur-Hinweis aus der GEGATETEN failing-Liste. Bei
    // not_measurable/approximate ist dx/dy/dw/dh entfernt → formatCorrection
    // liefert '' → kein Leak. getStatus laeuft ebenfalls auf der gegateten
    // Liste: das Status-Verdikt (✗) ist reliability-UNABHAENGIG, weil das Gate
    // die issue-Identitaet + WAS-detail erhaelt — nur die Pixel-Vorschreibung
    // faellt weg (Anti-Ueber-Gaten: not_measurable bleibt ✗, ohne Pixel-Hinweis).
    // §HEAL-7/B: nur das GEMESSENE Objekt (erstes seiner id) bekommt ein
    // failing-issue zugeordnet — Namensvettern nie (Objekt-Identität).
    // §H10 R11-28: Attribution id-only, byte-symmetrisch zu structured.js —
    // ein Verdikt heftet an das gemessene Subjekt, nie an detail-erwähnte
    // Dritte (die Referenz-Beteiligung bleibt via FAILING-Top-Zeile sichtbar).
    const issue = isMeasuredCarrier(el)
      ? failing.find((iss) => iss.id === el.id)
      : undefined;
    // G2 (D-006): Korrektur-Hinweis wird aus den STRUKTURIERTEN Feldern
    // (dx/dy/dw/dh) gebaut, NICHT mehr per String-Parse aus dem detail-Feld.
    const correctionText = formatCorrection(issue);
    const spotterHint = correctionText ? ` [${correctionText}]` : '';

    lines.push(
      `${prefix} ${el.tag}#${el.id}: ${pos}, ${el.color}${strokeInfo}${opacityWarn}${paintNote}${overflowNote}${stateNote}${mediaNote}${motionNote}${paintTimeNote}${colorNote}${text}${spotterHint} ${status}`,
    );
  }

  if (elements.length > maxShow)
    lines.push(`  (${elements.length - maxShow} weitere Elemente)`);

  return lines.join('\n');
}

/**
 * §HEAL-R6 / T1 Error-Pfad-Ehrlichkeit (F-AT-6-05): die LLM-zugewandte Prosa für
 * ein Error-Resultat, das einen Sanitize-Verlust trägt (canvas_validity=lossy).
 * Die bestehende `Fehler: …`-Zeile bleibt (Render schlug fehl), aber die laute
 * Verlust-Zeile hängt an — sonst verschwände der Verlust still im Error-Pfad.
 * Dieselbe Hinweis-Formulierung wie in formatReport (§H9: jetzt WIRKLICH eine
 * Wahrheits-Quelle — sanitizeLossLine — mit den echten Ursachen).
 *
 * @param {string} message - die resolved.message (Render-Fehler-Text).
 * @param {Array<{tag:string, reason:string, value?:string}>} [sanitizeLoss]
 * @returns {string}
 */
export function formatErrorWithLoss(message, sanitizeLoss) {
  return [`Fehler: ${message}`, sanitizeLossLine(sanitizeLoss)].join('\n');
}

export function formatArrangeReport(attributes, warnings) {
  const ids = Object.keys(attributes);
  const lines = [
    `ARRANGE: ${ids.length} Element${ids.length !== 1 ? 'e' : ''} platziert`,
  ];
  for (const id of ids) {
    const attrs = attributes[id];
    const parts = Object.entries(attrs).map(([k, v]) =>
      typeof v === 'number' ? `${k}=${Math.round(v)}` : `${k}="${v}"`,
    );
    lines.push(`  #${id}: ${parts.join(', ')}`);
  }
  if (warnings.length > 0) {
    lines.push('');
    lines.push(`WARNUNGEN: ${warnings.length}`);
    for (const w of warnings) lines.push(`  \u26A0 ${w}`);
  }
  return lines.join('\n');
}

/**
 * formatCorrection — baut den Korrektur-Hinweis aus den STRUKTURIERTEN
 * Feldern eines failing-issue (dx/dy/dw/dh), nicht aus dem detail-String.
 * G2 (D-006): Single Source of Truth ist das strukturierte Delta. Liefert
 * '' wenn keine Korrektur-Felder gesetzt sind (z.B. non-spatiale COLOR-fails).
 */
function formatCorrection(issue) {
  if (!issue) return '';
  const parts = [];
  if (typeof issue.dx === 'number') parts.push(`dx=${issue.dx}px`);
  if (typeof issue.dy === 'number') parts.push(`dy=${issue.dy}px`);
  if (typeof issue.dw === 'number') parts.push(`dw=${issue.dw}px`);
  if (typeof issue.dh === 'number') parts.push(`dh=${issue.dh}px`);
  return parts.join(', ');
}

// §HEAL-R6 / T1: ein Element ist „tinten-tot", wenn der Renderer paint_visible:false
// gesetzt hat ODER (redundant-robust) die PAINT_NOT_VISIBLE-Warning trägt. KEINE
// Mess-Logik — reines Durchreichen des bereits gemessenen Signals (Renderer →
// grid.js → hier). Beide Quellen geprüft, damit das Signal nicht an einer fehlenden
// Durchreichung verloren geht (fail-loud statt fail-silent).
function isPaintDead(el) {
  if (!el) return false;
  if (el.paint_visible === false) return true;
  return Array.isArray(el.warnings) && el.warnings.includes('PAINT_NOT_VISIBLE');
}

// §HEAL-R6 Variante 1: ein Element ist „tinten-unbestimmt", wenn der Renderer
// paint_visible:'indeterminate' gesetzt hat (ein räumlicher Operator — clip-path/
// mask/pattern/filter / nicht-endliche CTM — ist present, aber raster-frei NICHT
// als tot/lebendig entscheidbar). Analog isPaintDead reine Durchreichung des
// gemessenen Signals (Renderer → grid.js → hier), KEINE Mess-Logik. Beide Quellen
// (Feld + Warning) geprüft (fail-loud). STRIKT getrennt von isPaintDead: ein
// indeterminate-Element wird NIE als „unsichtbar/tot" markiert — nur als unbestimmt.
function isPaintIndeterminate(el) {
  if (!el) return false;
  if (el.paint_visible === 'indeterminate') return true;
  return (
    Array.isArray(el.warnings) &&
    el.warnings.includes('PAINT_PRESENCE_INDETERMINATE')
  );
}

// §HEAL-R6 / T2: ein Element hat „Tinten-Überlauf", wenn der Renderer
// has_paint_overflow:true gesetzt hat (Filter/stroke/Marker malen über die als
// reliable gemeldete geom-bbox hinaus). KEINE Mess-Logik — reines Durchreichen
// (Renderer → grid.js → hier). Symmetrisch zu isPaintDead.
function isPaintOverflow(el) {
  return !!el && el.has_paint_overflow === true;
}

// §D5 / R6-STATE: ein Element ist „zustands-abhängig", wenn der Renderer
// state_dependent:true gesetzt hat (interaktiver Pseudo-Selektor self/Vorfahr ODER
// SMIL-Event-Token zielt darauf) ODER (redundant-robust) die STATE_DEPENDENT-
// Warning trägt. KEINE Mess-Logik — reines Durchreichen des bereits gemessenen
// Signals (Renderer → grid.js → hier). Beide Quellen geprüft (fail-loud statt
// fail-silent). Symmetrisch zu isPaintDead/isPaintIndeterminate/isPaintOverflow.
function isStateDependent(el) {
  if (!el) return false;
  if (el.state_dependent === true) return true;
  return Array.isArray(el.warnings) && el.warnings.includes('STATE_DEPENDENT');
}

// §F-AT-6-09 / R6-MEDIA: ein Element ist „viewport-abhängig", wenn der Renderer
// media_dependent:true gesetzt hat (Selektor in einem Viewport-@media trifft es)
// ODER (redundant-robust) die MEDIA_DEPENDENT-Warning trägt. KEINE Mess-Logik —
// reines Durchreichen des bereits gemessenen Signals (Renderer → grid.js → hier).
// Beide Quellen geprüft (fail-loud). Symmetrisch zu isStateDependent.
function isMediaDependent(el) {
  if (!el) return false;
  if (el.media_dependent === true) return true;
  return Array.isArray(el.warnings) && el.warnings.includes('MEDIA_DEPENDENT');
}

// §HEAL-5 / Zeit-Achse: ein Element ist „zeit-variant", wenn der Renderer
// motion_dependent:true gesetzt hat (clock-rooted SMIL-GEOMETRIE zielt darauf)
// ODER (redundant-robust) die MOTION_DEPENDENT-Warning trägt. KEINE Mess-Logik —
// reines Durchreichen des bereits gemessenen Signals (Renderer → grid.js →
// hier). Beide Quellen geprüft (fail-loud). Symmetrisch zu isMediaDependent.
function isMotionDependent(el) {
  if (!el) return false;
  if (el.motion_dependent === true) return true;
  return Array.isArray(el.warnings) && el.warnings.includes('MOTION_DEPENDENT');
}

// §H10 R11-06 / Paint-Zeit-Achse: ein Element ist „paint-zeit-variant", wenn der
// Renderer paint_time_variant:true gesetzt hat (clock-rooted SMIL auf einem
// NICHT-Geometrie-Kanal: fill/opacity/…) ODER (redundant-robust) die
// PAINT_TIME_VARIANT-Warning trägt. KEINE Mess-Logik — reines Durchreichen
// (Renderer → grid.js → hier). Symmetrisch zu isMotionDependent.
function isPaintTimeVariant(el) {
  if (!el) return false;
  if (el.paint_time_variant === true) return true;
  return (
    Array.isArray(el.warnings) && el.warnings.includes('PAINT_TIME_VARIANT')
  );
}

// §F-AT-7-02 STILLE STROKE-FARB-LÜGE (Heilung, SK5): die sichtbare Farbe stammt aus
// dem stroke (fill trägt keine sichtbare Farbe bei). Reine Durchreichung des
// gemessenen Signals (Renderer → grid.js → hier), KEINE Mess-Logik. Beide Quellen
// (internes Feld + Warning) geprüft (fail-loud). Symmetrisch zu isStateDependent.
function isColorFromStroke(el) {
  if (!el) return false;
  if (el.visible_color_source === 'stroke') return true;
  return (
    Array.isArray(el.warnings) && el.warnings.includes('COLOR_FROM_STROKE')
  );
}

// §F-AT-7-02 (SK5): fill UND stroke malen beide sichtbar — „eine Farbe" ist dann ein
// Urteil, keine Messung. Reine Durchreichung (Renderer → grid.js → hier). Beide
// Quellen geprüft (fail-loud). Disjunkt zu isColorFromStroke. Symmetrisch zu oben.
function isMultiplePaintSources(el) {
  if (!el) return false;
  if (el.visible_color_source === 'multiple') return true;
  return (
    Array.isArray(el.warnings) && el.warnings.includes('MULTIPLE_PAINT_SOURCES')
  );
}

// visual_bbox ist entweder ein {x,y,w,h}-Objekt ODER das Literal 'not_measurable'
// (Überlauf existiert, sichere Schranke aber nicht ableitbar). Beides ehrlich in
// die Prosa schreiben — die Zahl NIE verschweigen, das Sentinel NIE als Zahl tarnen.
function formatVisualBbox(vb) {
  if (vb && typeof vb === 'object') {
    const r = (n) => Math.round(n * 10) / 10;
    return `{x:${r(vb.x)},y:${r(vb.y)},w:${r(vb.w)},h:${r(vb.h)}}`;
  }
  return vb === 'not_measurable' ? 'not_measurable' : '?';
}

// \u00A7HEAL-7/B: measuredCarrier (Objekt-Identit\u00E4t, erstes Element seiner id) \u2014
// das \u2717-Verdikt heftet NUR an das gemessene Objekt, nie an Namensvettern.
// Das \u26A0 (unchecked) bleibt id-basiert (verweigerte Messung gilt dem Namen).
// \u00A7H10 R11-28: id-only wie structured.js \u2014 keine detail-String-Attribution
// (mentionsElementId entfernt: jedes failing-issue tr\u00E4gt id unkonditional,
// der Disjunkt produzierte ausschlie\u00DFlich \u00DCber-Attribution an Erw\u00E4hnte).
function getStatus(el, failing, unchecked, measuredCarrier) {
  if (measuredCarrier && failing.some((i) => i.id === el.id)) return '\u2717';
  if (unchecked.some((u) => u.id === el.id)) return '\u26A0';
  return '\u2713';
}
