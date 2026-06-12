/**
 * diff.js - Diff Computation between GridMaps
 * Migrated from mirror.js:113-147 + findClosest (164-172)
 * Vector Mirror v2.0
 *
 * Core module: NO imports from adapters/ or interface/
 */

/**
 * Computes changes between two GridMaps.
 * Phase 1: Exact ID matching. Phase 2: Proximity matching.
 */
export function computeDiff(oldMap, newMap) {
  const changes = [];
  const matchedOldIds = new Set();
  const matchedNewIds = new Set();

  // Phase 1: Exact Match (IDs)
  for (const newEl of newMap.elements) {
    const oldEl = oldMap.elements.find((e) => e.id === newEl.id);
    if (oldEl) {
      matchedOldIds.add(oldEl.id);
      matchedNewIds.add(newEl.id);
      // Sniper-Identität: eine Form-Mutation (circle→ellipse) bei gleicher
      // Zelle/Farbe ist eine echte Szenen-Änderung — ohne diesen Vergleich
      // bliebe sie still (leerer Diff = Mess-Lüge). Exakt im Muster von
      // VERSCHOBEN/FARBÄNDERUNG (oldEl = matched Vorgänger).
      if (oldEl.tag !== newEl.tag)
        changes.push({
          type: 'FORMÄNDERUNG',
          id: newEl.id,
          from: oldEl.tag,
          to: newEl.tag,
        });
      if (oldEl.cell !== newEl.cell)
        changes.push({
          type: 'VERSCHOBEN',
          id: newEl.id,
          from: oldEl.cell,
          to: newEl.cell,
        });
      if (oldEl.color !== newEl.color)
        changes.push({
          type: 'FARBÄNDERUNG',
          id: newEl.id,
          from: oldEl.color,
          to: newEl.color,
        });
    }
  }

  // Phase 2: Proximity Matching for unmatched
  const unmatchedOld = oldMap.elements.filter((e) => !matchedOldIds.has(e.id));
  const unmatchedNew = newMap.elements.filter((e) => !matchedNewIds.has(e.id));

  for (const newEl of unmatchedNew) {
    const candidate = findClosest(newEl, unmatchedOld, oldMap.grid);
    if (candidate) {
      matchedOldIds.add(candidate.id);
      unmatchedOld.splice(unmatchedOld.indexOf(candidate), 1);
      // Symmetrisch zu Phase 1: Form-Mutation ist eine echte Änderung, nicht
      // still. (Heute matcht findClosest nur tag-gleich, der Zweig ist also
      // eine Sicherung gegen künftiges tag-agnostisches Matching — kein toter
      // Pfad an der API-Grenze, sondern dieselbe Wahrheit in beiden Phasen.)
      if (candidate.tag !== newEl.tag)
        changes.push({
          type: 'FORMÄNDERUNG',
          id: newEl.id,
          from: candidate.tag,
          to: newEl.tag,
        });
      if (newEl.cell !== candidate.cell)
        changes.push({
          type: 'VERSCHOBEN',
          id: newEl.id,
          from: candidate.cell,
          to: newEl.cell,
        });
      if (newEl.color !== candidate.color)
        changes.push({
          type: 'FARBÄNDERUNG',
          id: newEl.id,
          from: candidate.color,
          to: newEl.color,
        });
    } else {
      changes.push({
        type: 'NEU',
        id: newEl.id,
        cell: newEl.cell,
        color: newEl.color,
      });
    }
  }

  unmatchedOld.forEach((oldEl) => {
    changes.push({ type: 'ENTFERNT', id: oldEl.id, cell: oldEl.cell });
  });
  return changes;
}

/**
 * Finds the closest element by tag + distance within 2 cell threshold.
 * Private to diff module (DDD Shared Kernel, ADR C-1).
 */
function findClosest(target, candidates, grid) {
  let best = null,
    minD = Math.max(grid.cellW, grid.cellH) * 2;
  candidates.forEach((c) => {
    if (c.tag !== target.tag) return;
    const d = Math.sqrt((target.cx - c.cx) ** 2 + (target.cy - c.cy) ** 2);
    if (d < minD) {
      minD = d;
      best = c;
    }
  });
  return best;
}
