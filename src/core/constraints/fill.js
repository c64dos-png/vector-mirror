/**
 * fill.js - FILL Constraint (arrange-only)
 * Element fills the entire canvas (x:0, y:0, width:W, height:H)
 * Vector Mirror v2.0 Phase 3a
 */
import { registerConstraint } from './registry.js';

registerConstraint('FILL', {
  // FILL braucht keine Referenz (Element fuellt die Leinwand). Ohne diesen
  // Marker wuerde die pipeline-Wache (fail-closed-Default) FILL faelschlich
  // als referenz-pflichtig behandeln.
  requiresReference: false,
  // Uniform dispatch signature (registry.js): check(subj, ref, ctx).
  check(_subj, _ref, _ctx) {
    // arrange-only constraint — check always returns null
    return { pass: null, detail: 'FILL ist ein arrange-only Constraint' };
  },
  // Uniform dispatch signature (registry.js): arrange(subj, ref, ctx).
  arrange(_subj, _ref, { canvas }) {
    return { x: 0, y: 0, width: canvas.width, height: canvas.height };
  },
});
