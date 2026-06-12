/**
 * geom.js — AABB Geometry Mathematics for Vector Mirror v2.5
 *
 * Source of truth for axis-aligned bounding-box mathematics.
 * All inputs are boxes of shape `{x, y, w, h}` (top-left + extent).
 *
 * Pure math: Node-only, no Playwright / DOM dependency.
 *
 * References:
 *   - RB-02 Pattern 4.2 — Pomona / dyn4j AABB Signed-Gap formulation
 *   - FIX_PLAN_2026-04-18 §1.2 P1-01
 *   - ADR-024 Kernel-Vertrag (bbox is the inviolable geometric authority)
 *
 * Notes:
 *   - SVG y-axis grows downward → "north" overflow means a sticks out *above* b.
 *   - Touching edges (signedDist = 0) count as separated, not overlapping.
 */

/**
 * Per-axis signed gaps between two AABBs.
 * Negative on an axis ⇒ the boxes overlap on that axis.
 * Used internally; exposed indirectly via signedGapComponents.
 *
 * @param {{x:number,y:number,w:number,h:number}} a
 * @param {{x:number,y:number,w:number,h:number}} b
 * @returns {{dx:number, dy:number}}
 */
function axisGaps(a, b) {
  const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h));
  return { dx, dy };
}

/**
 * Signed Euclidean gap between two AABBs (Pomona / dyn4j formulation).
 *
 *   > 0  separated, value = shortest empty-space distance between rectangles
 *   = 0  touching (edge or corner aligned, no overlap)
 *   < 0  overlapping, value = penetration depth along the dominant axis
 *
 * @param {{x:number,y:number,w:number,h:number}} a
 * @param {{x:number,y:number,w:number,h:number}} b
 * @returns {number}
 */
export function signedGapBoxToBox(a, b) {
  const { dx, dy } = axisGaps(a, b);
  if (dx < 0 && dy < 0) return Math.max(dx, dy);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
}

/**
 * Signed gap with per-axis components, for vector-based corrections
 * (Spotter "dx=-14px, dy=+3px" output).
 *
 * Components dx / dy are negative when the boxes overlap on that axis,
 * zero when edges align, positive when there is empty space.
 *
 * `signedDist` follows {@link signedGapBoxToBox}.
 *
 * @returns {{dx:number, dy:number, signedDist:number}}
 */
export function signedGapComponents(a, b) {
  const { dx, dy } = axisGaps(a, b);
  const signedDist =
    dx < 0 && dy < 0
      ? Math.max(dx, dy)
      : Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return { dx, dy, signedDist };
}

/**
 * Containment ratio: how much of subject `a` lies within reference `b`.
 *   0   ⇒ a is fully outside b (no intersection)
 *   1   ⇒ a is fully inside b
 *   0..1 partial — subject straddles a boundary
 *
 * Subjects with zero area collapse to 0 (they have no area to contain).
 *
 * @param {{x:number,y:number,w:number,h:number}} a   subject (typically element bbox)
 * @param {{x:number,y:number,w:number,h:number}} b   reference (typically canvas bbox)
 * @returns {number}
 */
export function containmentRatio(a, b) {
  const ix = Math.max(a.x, b.x);
  const iy = Math.max(a.y, b.y);
  const ix2 = Math.min(a.x + a.w, b.x + b.w);
  const iy2 = Math.min(a.y + a.h, b.y + b.h);
  const intersection = Math.max(0, ix2 - ix) * Math.max(0, iy2 - iy);
  const area = a.w * a.h;
  return area === 0 ? 0 : intersection / area;
}

/**
 * Overflow per cardinal edge — by how many pixels subject `a` exceeds
 * container `b` on each side. Each component is non-negative.
 *
 * Compass mapping (SVG y-axis grows downward):
 *   north — a's top edge is above b's top edge
 *   south — a's bottom edge is below b's bottom edge
 *   east  — a's right edge is right of b's right edge
 *   west  — a's left edge is left of b's left edge
 *
 * @returns {{north:number, east:number, south:number, west:number}}
 */
export function overflowPerEdge(a, b) {
  return {
    north: Math.max(0, b.y - a.y),
    east: Math.max(0, a.x + a.w - (b.x + b.w)),
    south: Math.max(0, a.y + a.h - (b.y + b.h)),
    west: Math.max(0, b.x - a.x),
  };
}

/**
 * Minimum Translation Vector — the smallest delta to apply to `a` so that
 * `a` and `b` no longer overlap. Returns `{dx:0, dy:0, abs:0}` if the boxes
 * are already separated (or merely touching).
 *
 * Resolution rules when overlapping:
 *   - Push along the axis with the smaller penetration depth.
 *   - On equal penetration, prefer the x-axis (deterministic tie-break).
 *   - Sign points away from b: a moves away from b's center.
 *   - When centers coincide, prefer +x (deterministic for fully congruent boxes).
 *
 * @returns {{dx:number, dy:number, abs:number}}
 */
export function mtv(a, b) {
  const { dx, dy } = axisGaps(a, b);
  if (dx >= 0 || dy >= 0) return { dx: 0, dy: 0, abs: 0 };

  const penX = -dx;
  const penY = -dy;

  if (penX <= penY) {
    const aCx = a.x + a.w / 2;
    const bCx = b.x + b.w / 2;
    const sign = aCx < bCx ? -1 : 1;
    return { dx: sign * penX, dy: 0, abs: penX };
  }
  const aCy = a.y + a.h / 2;
  const bCy = b.y + b.h / 2;
  const sign = aCy < bCy ? -1 : 1;
  return { dx: 0, dy: sign * penY, abs: penY };
}
