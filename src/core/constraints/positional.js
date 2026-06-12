/**
 * positional.js - LEFT-OF + ABOVE Constraints
 * Migrated from mirror.js:80-93
 * Vector Mirror v2.0
 */
import { registerConstraint } from './registry.js';

registerConstraint('LEFT-OF', {
  // Uniform dispatch signature (registry.js): check(subj, ref, ctx).
  check(subj, ref, _ctx) {
    const expectedMaxX = ref.bbox.x;
    const actualMaxX = subj.bbox.x + subj.bbox.w;
    const pass = actualMaxX <= expectedMaxX;
    const dx = actualMaxX - expectedMaxX;
    if (pass) return { pass, detail: null };
    return {
      pass,
      detail: `Nicht links davon. Korrektur: dx=${Math.round(-dx)}px`,
      dx: Math.round(-dx),
    };
  },
  // Uniform dispatch signature (registry.js): arrange(subj, ref, ctx).
  arrange(subj, ref, _ctx) {
    return { x: ref.bbox.x - subj.bbox.w };
  },
});

registerConstraint('ABOVE', {
  // Uniform dispatch signature (registry.js): check(subj, ref, ctx).
  check(subj, ref, _ctx) {
    const expectedMaxY = ref.bbox.y;
    const actualMaxY = subj.bbox.y + subj.bbox.h;
    const pass = actualMaxY <= expectedMaxY;
    const dy = actualMaxY - expectedMaxY;
    if (pass) return { pass, detail: null };
    return {
      pass,
      detail: `Nicht oberhalb. Korrektur: dy=${Math.round(-dy)}px`,
      dy: Math.round(-dy),
    };
  },
  // Uniform dispatch signature (registry.js): arrange(subj, ref, ctx).
  arrange(subj, ref, _ctx) {
    return { y: ref.bbox.y - subj.bbox.h };
  },
});
