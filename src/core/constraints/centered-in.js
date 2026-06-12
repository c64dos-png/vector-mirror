/**
 * centered-in.js - CENTERED-IN Constraint
 * Migrated from mirror.js:36-41
 * Vector Mirror v2.0
 */

import { getTolX, getTolY } from '../tolerance.js';
import { registerConstraint } from './registry.js';

registerConstraint('CENTERED-IN', {
  check(subj, ref, { grid }) {
    const dx = subj.bbox.x + subj.bbox.w / 2 - (ref.bbox.x + ref.bbox.w / 2);
    const dy = subj.bbox.y + subj.bbox.h / 2 - (ref.bbox.y + ref.bbox.h / 2);
    const pass =
      Math.abs(dx) <= getTolX(ref.bbox.w, grid) &&
      Math.abs(dy) <= getTolY(ref.bbox.h, grid);
    if (pass) return { pass, detail: null };
    return {
      pass,
      detail: `Verfehlt Zentrum. Korrektur: dx=${Math.round(-dx)}px, dy=${Math.round(-dy)}px`,
      dx: Math.round(-dx),
      dy: Math.round(-dy),
    };
  },
  // Uniform dispatch signature (registry.js): arrange(subj, ref, ctx).
  arrange(_subj, ref, _ctx) {
    return { cx: ref.bbox.x + ref.bbox.w / 2, cy: ref.bbox.y + ref.bbox.h / 2 };
  },
});
