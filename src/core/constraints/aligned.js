/**
 * aligned.js - ALIGNED-LEFT + ALIGNED-TOP Constraints
 * Migrated from mirror.js:63-71
 * Vector Mirror v2.0
 */
import { registerConstraint } from './registry.js';

registerConstraint('ALIGNED-LEFT', {
  // Uniform dispatch signature (registry.js): check(subj, ref, ctx).
  check(subj, ref, _ctx) {
    const dx = subj.bbox.x - ref.bbox.x;
    const pass = Math.abs(dx) <= 2; // Hard 2px spirit level
    if (pass) return { pass, detail: null };
    return {
      pass,
      detail: `Nicht bündig. Korrektur: dx=${Math.round(-dx)}px`,
      dx: Math.round(-dx),
    };
  },
  // Uniform dispatch signature (registry.js): arrange(subj, ref, ctx).
  arrange(_subj, ref, _ctx) {
    return { x: ref.bbox.x };
  },
});

registerConstraint('ALIGNED-TOP', {
  // Uniform dispatch signature (registry.js): check(subj, ref, ctx).
  check(subj, ref, _ctx) {
    const dy = subj.bbox.y - ref.bbox.y;
    const pass = Math.abs(dy) <= 2;
    if (pass) return { pass, detail: null };
    return {
      pass,
      detail: `Nicht bündig. Korrektur: dy=${Math.round(-dy)}px`,
      dy: Math.round(-dy),
    };
  },
  // Uniform dispatch signature (registry.js): arrange(subj, ref, ctx).
  arrange(_subj, ref, _ctx) {
    return { y: ref.bbox.y };
  },
});
