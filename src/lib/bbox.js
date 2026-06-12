/**
 * bbox.js - Bounding-Box Mathematics
 * Extracted from mirror.js:160-162
 * Vector Mirror v2.0
 */

/**
 * Returns true if two bounding boxes overlap.
 */
export function bboxOverlap(a, b) {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}
