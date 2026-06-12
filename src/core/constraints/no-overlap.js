/**
 * no-overlap.js - NO-OVERLAP Constraint
 * Migrated from mirror.js:42-52
 * Vector Mirror v2.0
 */

import { bboxOverlap } from '../../lib/bbox.js';
import { registerConstraint } from './registry.js';

registerConstraint('NO-OVERLAP', {
  // Uniform dispatch signature (registry.js): check(subj, ref, ctx).
  check(subj, ref, _ctx) {
    const overlaps = bboxOverlap(subj.bbox, ref.bbox);
    if (!overlaps) return { pass: true, detail: null };
    const dxL = ref.bbox.x + ref.bbox.w - subj.bbox.x;
    const dxR = ref.bbox.x - (subj.bbox.x + subj.bbox.w);
    const dyT = ref.bbox.y + ref.bbox.h - subj.bbox.y;
    const dyB = ref.bbox.y - (subj.bbox.y + subj.bbox.h);
    const moves = [
      { v: dxL, type: 'dx', abs: Math.abs(dxL) },
      { v: dxR, type: 'dx', abs: Math.abs(dxR) },
      { v: dyT, type: 'dy', abs: Math.abs(dyT) },
      { v: dyB, type: 'dy', abs: Math.abs(dyB) },
    ];
    const best = moves.reduce((a, b) => (a.abs < b.abs ? a : b));
    const result = {
      pass: false,
      detail: `Überlappt #${ref.id}. Kürzester Fluchtweg: ${best.type}=${Math.round(best.v)}px`,
    };
    result[best.type] = Math.round(best.v);
    return result;
  },
  // Uniform dispatch signature (registry.js): arrange(subj, ref, ctx).
  arrange(subj, ref, _ctx) {
    if (!bboxOverlap(subj.bbox, ref.bbox))
      return { x: subj.bbox.x, y: subj.bbox.y };
    const dxL = ref.bbox.x + ref.bbox.w - subj.bbox.x;
    const dxR = ref.bbox.x - (subj.bbox.x + subj.bbox.w);
    const dyT = ref.bbox.y + ref.bbox.h - subj.bbox.y;
    const dyB = ref.bbox.y - (subj.bbox.y + subj.bbox.h);
    const moves = [
      { dx: dxL, dy: 0, abs: Math.abs(dxL) },
      { dx: dxR, dy: 0, abs: Math.abs(dxR) },
      { dx: 0, dy: dyT, abs: Math.abs(dyT) },
      { dx: 0, dy: dyB, abs: Math.abs(dyB) },
    ];
    const best = moves.reduce((a, b) => (a.abs < b.abs ? a : b));
    return { x: subj.bbox.x + best.dx, y: subj.bbox.y + best.dy };
  },
});
