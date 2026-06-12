/**
 * inside.js - INSIDE Constraint
 * Migrated from mirror.js:53-62
 * Vector Mirror v2.0
 */
import { registerConstraint } from './registry.js';

registerConstraint('INSIDE', {
  // Uniform dispatch signature (registry.js): check(subj, ref, ctx).
  check(subj, ref, _ctx) {
    const inside =
      subj.bbox.x >= ref.bbox.x &&
      subj.bbox.y >= ref.bbox.y &&
      subj.bbox.x + subj.bbox.w <= ref.bbox.x + ref.bbox.w &&
      subj.bbox.y + subj.bbox.h <= ref.bbox.y + ref.bbox.h;
    if (inside) return { pass: true, detail: null };
    const dx =
      subj.bbox.x < ref.bbox.x
        ? ref.bbox.x - subj.bbox.x
        : subj.bbox.x + subj.bbox.w > ref.bbox.x + ref.bbox.w
          ? ref.bbox.x + ref.bbox.w - (subj.bbox.x + subj.bbox.w)
          : 0;
    const dy =
      subj.bbox.y < ref.bbox.y
        ? ref.bbox.y - subj.bbox.y
        : subj.bbox.y + subj.bbox.h > ref.bbox.y + ref.bbox.h
          ? ref.bbox.y + ref.bbox.h - (subj.bbox.y + subj.bbox.h)
          : 0;
    const cParts = [];
    if (dx !== 0) cParts.push(`dx=${Math.round(dx)}px`);
    if (dy !== 0) cParts.push(`dy=${Math.round(dy)}px`);
    const result = {
      pass: false,
      detail: `Ragt aus #${ref.id} heraus. Korrektur: ${cParts.join(', ')}`,
    };
    if (dx !== 0) result.dx = Math.round(dx);
    if (dy !== 0) result.dy = Math.round(dy);
    return result;
  },
  // Uniform dispatch signature (registry.js): arrange(subj, ref, ctx).
  arrange(subj, ref, _ctx) {
    const x = Math.max(
      ref.bbox.x,
      Math.min(subj.bbox.x, ref.bbox.x + ref.bbox.w - subj.bbox.w),
    );
    const y = Math.max(
      ref.bbox.y,
      Math.min(subj.bbox.y, ref.bbox.y + ref.bbox.h - subj.bbox.h),
    );
    return { x, y };
  },
});
