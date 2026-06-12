/**
 * same-size.js - SAME-SIZE Constraint
 * Migrated from mirror.js:73-79
 * Vector Mirror v2.0
 */

import { getTolX, getTolY } from '../tolerance.js';
import { registerConstraint } from './registry.js';

registerConstraint('SAME-SIZE', {
  check(subj, ref, { grid }) {
    if (ref.bbox.w === 0 || ref.bbox.h === 0)
      return { pass: null, detail: 'Referenz hat Grösse 0' };
    const dw = subj.bbox.w - ref.bbox.w;
    const dh = subj.bbox.h - ref.bbox.h;
    const pass =
      Math.abs(dw) <= getTolX(ref.bbox.w, grid) &&
      Math.abs(dh) <= getTolY(ref.bbox.h, grid);
    if (pass) return { pass, detail: null };
    // G2 (D-006): detail beschreibt NUR das WAS/WIEVIEL-daneben. Die
    // strukturierte Korrektur lebt ausschliesslich in dw/dh — prose.js/
    // structured.js bauen den Hinweis aus diesen Feldern, nicht mehr aus
    // dem detail-String (kein String-Leak, gate-bar in S8).
    return {
      pass,
      detail: `Grösse weicht ab (Δw=${Math.round(dw)}px, Δh=${Math.round(dh)}px)`,
      dw: Math.round(-dw),
      dh: Math.round(-dh),
    };
  },
  // Uniform dispatch signature (registry.js): arrange(subj, ref, ctx).
  arrange(_subj, ref, _ctx) {
    return { width: ref.bbox.w, height: ref.bbox.h };
  },
});
