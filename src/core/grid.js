/**
 * grid.js - Grid Mapping & Offset Correction
 * Migrated from grid.js (v1.6), parseColor moved to lib/palette.js
 * Vector Mirror v2.0
 *
 * Core module: NO imports from adapters/ or interface/
 */
import { parseColor } from '../lib/palette.js';

export function mapToGridMap(resolved, lastGridMap = null) {
  const { canvas, elements } = resolved;
  const grid = createGrid(canvas);

  const mappedElements = elements.map((el) => {
    const cx = el.bbox.x + el.bbox.w / 2;
    const cy = el.bbox.y + el.bbox.h / 2;

    const col = clamp(
      Math.floor((cx - canvas.vbX) / grid.cellW),
      0,
      grid.cellsX - 1,
    );
    const row = clamp(
      Math.floor((cy - canvas.vbY) / grid.cellH),
      0,
      grid.cellsY - 1,
    );

    let cell = String.fromCharCode(65 + col) + (row + 1);

    // Hysteresis (10% Overlap Rule)
    if (lastGridMap) {
      const lastEl = lastGridMap.elements.find((e) => e.id === el.id);
      if (lastEl && lastEl.cell !== cell) {
        const overlap = cellOverlapRatio(
          el.bbox,
          col,
          row,
          grid,
          canvas.vbX,
          canvas.vbY,
        );
        if (overlap < 0.1) cell = lastEl.cell;
      }
    }

    const xInCell = (cx - canvas.vbX - col * grid.cellW) / grid.cellW;
    const yInCell = (cy - canvas.vbY - row * grid.cellH) / grid.cellH;
    const direction = getDirection(xInCell, yInCell);
    const span = computeSpan(el.bbox, grid, canvas.vbX, canvas.vbY);

    return {
      id: el.id,
      tag: el.tag,
      cell,
      direction,
      span,
      // §F-AT-7-02 STILLE STROKE-FARB-LÜGE (Heilung, Opt-A-Kern). Die EINE `color`
      // war fill-only — ein nur-stroke-sichtbares Element meldete `transparent`
      // (Lese-Lüge). Wenn der Renderer visible_color_source='stroke' gemessen hat
      // (fill trägt keine sichtbare Farbe bei, stroke malt sichtbar), wird die EINE
      // sichtbare Farbe aus el.stroke projiziert — kein Layer-Crossing (grid.js
      // importiert nur palette.js), reine Projektion eines bereits gemessenen
      // Signals. Bei 'multiple' (beide sichtbar) bleibt color=fill (Status quo); die
      // MULTIPLE_PAINT_SOURCES-Warning trägt dort die Wahrheit (Visions-Gate: keine
      // willkürliche Einzel-Farbe küren). SK4: der echte parsed fill wird INTERN in
      // fill_color separat bewahrt — die Palette (structured.js) liest fill_color,
      // NICHT color, sonst entstünde eine neue Lüge (stroke-only → fill:rot).
      color:
        el.visible_color_source === 'stroke'
          ? parseColor(el.stroke)
          : parseColor(el.fill),
      fill_color: parseColor(el.fill),
      stroke: parseColor(el.stroke),
      opacity: el.opacity,
      bbox: el.bbox,
      cx: Math.round(cx),
      cy: Math.round(cy),
      textContent: el.textContent,
      // §1.2b L-002a: bbox_reliability + warnings vom Renderer-Element durchreichen
      // (REGEL-3 Spotter-Anti-Luege auf MCP-Caller-Ebene). Reine Daten-Durchreichung,
      // kein Layer-Crossing (H-16 REGEL-4 Hexagonal: core/ importiert weiter nichts
      // aus adapters/ oder interface/).
      bbox_reliability: el.bbox_reliability,
      // §1.5 Block G: parent_id/parent_tag vom Renderer-Element durchreichen
      // (tspan/textPath-Kontext, R-C). EXAKT analog zum warnings-Muster oben:
      // conditional-spread, nur wenn vorhanden (Top-Level-Elemente tragen sie
      // nicht). Reine Daten-Durchreichung, kein Layer-Crossing.
      ...(el.parent_id != null ? { parent_id: el.parent_id } : {}),
      ...(el.parent_tag != null ? { parent_tag: el.parent_tag } : {}),
      // §1.5 Block H / Patch P1+P2: Autor-transform + tspan native_dx durchreichen
      // (gleiches conditional-spread-Muster). transform → buildTransformFix.current
      // (Autor-scale/rotate-Erhalt); native_dx → buildTspanShiftFix-Relativbasis.
      ...(el.transform != null ? { transform: el.transform } : {}),
      ...(el.native_dx != null ? { native_dx: el.native_dx } : {}),
      ...(el.warnings ? { warnings: el.warnings } : {}),
      // §E4 (F-AT-004, DoD-3): Paint-Extent-Ehrlichkeit vom Renderer-Element
      // durchreichen — EXAKT dasselbe conditional-spread-Muster wie bbox_reliability/
      // parent_id/transform/warnings oben. REINE Daten-Durchreichung: die geom-bbox-
      // basierte cell/span/cx/cy/direction-Abbildung bleibt UNVERÄNDERT (VISION P3:
      // der Konsument/das Gehirn entscheidet, was es mit dem Flag tut). Kein
      // Layer-Crossing (REGEL-4: grid.js importiert weiter nichts aus adapters/).
      ...(el.has_paint_overflow != null
        ? { has_paint_overflow: el.has_paint_overflow }
        : {}),
      ...(el.visual_bbox != null ? { visual_bbox: el.visual_bbox } : {}),
      // §HEAL-R6 / T1 (F-AT-6-01, DoD-2): Paint-Presence-Felder durchreichen —
      // EXAKT dasselbe conditional-spread-Muster (REINE Daten-Durchreichung, kein
      // Layer-Crossing; core/ importiert weiter nichts aus adapters/interface).
      // fill/stroke_paint_factor sind immer vorhanden (Diagnostik); paint_visible
      // nur bei painted===false (Negativ-Kontrolle: sichtbare Elemente tragen es nicht).
      ...(el.fill_paint_factor != null
        ? { fill_paint_factor: el.fill_paint_factor }
        : {}),
      ...(el.stroke_paint_factor != null
        ? { stroke_paint_factor: el.stroke_paint_factor }
        : {}),
      ...(el.paint_visible != null ? { paint_visible: el.paint_visible } : {}),
      // §D5 / R6-STATE (state_dependent): reine Daten-Durchreichung (REGEL-4, kein
      // Layer-Crossing). grid baut das Element-Objekt NEU — ohne diese Zeile ist das
      // Feld downstream undefined. Die Warning fließt schon via warnings@81.
      ...(el.state_dependent != null
        ? { state_dependent: el.state_dependent }
        : {}),
      // §F-AT-6-09 / R6-MEDIA (media_dependent): reine Daten-Durchreichung (REGEL-4,
      // kein Layer-Crossing). grid baut das Element-Objekt NEU — ohne diese Zeile ist
      // das Feld downstream undefined. Die Warning fließt schon via warnings@81.
      ...(el.media_dependent != null
        ? { media_dependent: el.media_dependent }
        : {}),
      // §HEAL-5 / Zeit-Achse (motion_dependent): reine Daten-Durchreichung
      // (REGEL-4, kein Layer-Crossing) — exakt nach media_dependent-Vorlage.
      // grid baut das Element-Objekt NEU — ohne diese Zeile ist das Feld
      // downstream undefined (und die Verdikt-Wache in pipeline.js bliebe
      // blind). Die Warning fließt schon via warnings@oben.
      ...(el.motion_dependent != null
        ? { motion_dependent: el.motion_dependent }
        : {}),
      // §H10 R11-06 / Paint-Zeit-Achse (paint_time_variant): reine Daten-
      // Durchreichung (REGEL-4, kein Layer-Crossing) — exakt nach
      // motion_dependent-Vorlage.
      ...(el.paint_time_variant != null
        ? { paint_time_variant: el.paint_time_variant }
        : {}),
      // §F-AT-7-02 (SK3): internes Quellen-Feld der sichtbaren Farbe durchreichen —
      // reine Daten-Durchreichung (REGEL-4, kein Layer-Crossing). Die Prosa nutzt
      // es für Note/Suffix-Unterdrückung; die Warning (COLOR_FROM_STROKE /
      // MULTIPLE_PAINT_SOURCES) fließt schon via warnings@oben. KEIN Schema-Feld.
      ...(el.visible_color_source != null
        ? { visible_color_source: el.visible_color_source }
        : {}),
    };
  });

  // §H10 R11-01: Existenz-Register (css-unsichtbar geskippte Elemente) vom
  // Renderer durchreichen — reine Daten-Durchreichung (REGEL-4, kein
  // Layer-Crossing), optional-by-default (leer/fehlend ⇒ Feld fehlt).
  return {
    canvas,
    grid,
    elements: mappedElements,
    ...(Array.isArray(resolved.hidden) && resolved.hidden.length > 0
      ? { hidden: resolved.hidden }
      : {}),
  };
}

function createGrid(canvas) {
  const cellsX = clamp(Math.round(canvas.width / 50), 4, 16);
  const cellsY = clamp(Math.round(canvas.height / 50), 4, 16);
  return {
    cellsX,
    cellsY,
    cellW: canvas.width / cellsX,
    cellH: canvas.height / cellsY,
  };
}

function cellOverlapRatio(bbox, col, row, grid, vbX, vbY) {
  const cellX = vbX + col * grid.cellW;
  const cellY = vbY + row * grid.cellH;
  const overlapX = Math.max(
    0,
    Math.min(bbox.x + bbox.w, cellX + grid.cellW) - Math.max(bbox.x, cellX),
  );
  const overlapY = Math.max(
    0,
    Math.min(bbox.y + bbox.h, cellY + grid.cellH) - Math.max(bbox.y, cellY),
  );
  const area = overlapX * overlapY;
  const bboxArea = bbox.w * bbox.h;
  return bboxArea > 0 ? area / bboxArea : 0;
}

function getDirection(x, y) {
  const dx = x < 0.25 ? 'LINKS' : x > 0.75 ? 'RECHTS' : null;
  const dy = y < 0.25 ? 'OBEN' : y > 0.75 ? 'UNTEN' : null;
  if (!dx && !dy) return 'MITTE';
  if (dx && dy)
    return `ECKE-${dy === 'OBEN' ? 'O' : 'U'}${dx === 'LINKS' ? 'L' : 'R'}`;
  return dx ? `${dx}ER RAND` : `${dy}ER RAND`;
}

// §H10 R11-04 (O1): die bbox ist das HALBOFFENE Intervall [x, x+w). Der End-
// Index ist end-exklusiv (ceil(end/cellW) - 1) statt der früheren "-1px"-
// Pixel-Heuristik, die w>=1 voraussetzte und für Sub-Pixel-Elemente auf/nahe
// Grid-Linien invertierte Ranges erzeugte ("C3-B2", Ende vor Anfang — Boden-
// Wahrheit probe_R11-04). Das Math.max(sCol, …) ist Teil der exakten
// Mathematik (degeneriertes Intervall w=0 → Zelle des Punktes), kein Guard:
// START<=END ist damit Theorem, nicht Hoffnung. Exakt-auf-Grenze-Verhalten
// bleibt erhalten (x=0, w=25, cellW=25 → nur Zelle A); <1px-Grenzkreuzer
// (x=24.9, w=0.3) melden neu ehrlich beide Zellen.
function computeSpan(bbox, grid, vbX, vbY) {
  const sCol = clamp(
    Math.floor((bbox.x - vbX) / grid.cellW),
    0,
    grid.cellsX - 1,
  );
  const sRow = clamp(
    Math.floor((bbox.y - vbY) / grid.cellH),
    0,
    grid.cellsY - 1,
  );
  const eCol = clamp(
    Math.max(sCol, Math.ceil((bbox.x + bbox.w - vbX) / grid.cellW) - 1),
    0,
    grid.cellsX - 1,
  );
  const eRow = clamp(
    Math.max(sRow, Math.ceil((bbox.y + bbox.h - vbY) / grid.cellH) - 1),
    0,
    grid.cellsY - 1,
  );
  if (sCol === eCol && sRow === eRow) return null;
  return `${String.fromCharCode(65 + sCol)}${sRow + 1}-${String.fromCharCode(65 + eCol)}${eRow + 1}`;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
