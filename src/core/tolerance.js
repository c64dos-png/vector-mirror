/**
 * tolerance.js - 5% Tolerance Rule
 * Extracted from mirror.js:32-33
 * Vector Mirror v2.0
 *
 * Tolerance formula: tolerance = min(cellW * 0.5, max(2, dimension * 0.05))
 * See BAUPLAN S.13 (Eichkoerper EK-3: 5%-Toleranz-Regel)
 */

/**
 * Returns tolerance for X-axis based on dimension and grid.
 */
export function getTolX(dimension, grid) {
  return Math.min(grid.cellW * 0.5, Math.max(2, dimension * 0.05));
}

/**
 * Returns tolerance for Y-axis based on dimension and grid.
 */
export function getTolY(dimension, grid) {
  return Math.min(grid.cellH * 0.5, Math.max(2, dimension * 0.05));
}
