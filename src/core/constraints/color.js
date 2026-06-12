/**
 * color.js - COLOR Constraint
 * Migrated from mirror.js:104-107
 * Vector Mirror v2.0
 * Uses ctx.value (target color name)
 */
import { registerConstraint } from './registry.js';
import { parseColor } from '../../lib/palette.js';

registerConstraint('COLOR', {
  // COLOR braucht keine Referenz (non-spatial, Ziel-Farbe steckt in ctx.value).
  // Ohne diesen Marker wuerde die pipeline-Wache (fail-closed-Default) COLOR
  // faelschlich als referenz-pflichtig behandeln.
  requiresReference: false,
  // Uniform dispatch signature (registry.js): check(subj, ref, ctx).
  check(subj, _ref, { value }) {
    // COLOR ist non-spatial (D-007): kein Pixel-Delta. Der non_spatial-Marker
    // nimmt fail-Verdicts von der REGEL-3-Delta-Pflicht aus (_schema.js).
    // Der spaetere COLOR-attribute_fix ist C-04/L-003-Arbeit, NICHT hier.
    if (value === undefined || value === null) {
      return {
        pass: false,
        detail: `Kein Farbwert angegeben fuer #${subj.id}.`,
        non_spatial: true,
      };
    }
    // §HEAL3b: eine nicht messbare Farbe (use-Instanz → 'indeterminate', §HEAL3b
    // im Renderer) kann nicht GEGEN ein Ziel geprüft werden. Ein pass:false meldete
    // eine FALSCHE Verletzung und triggerte eine SCHÄDLICHE Korrektur auf eine
    // womöglich schon korrekte Farbe (Blind-Trust-Gesetz). Unmessbar → UNCHECKED.
    if (subj.color === 'indeterminate') {
      return {
        pass: null,
        reasonCode: 'MEASUREMENT_AMBIGUOUS',
        reasonCategory: 'MODEL',
        detail: `Farbe von #${subj.id} ist nicht messbar (use-Instanz) — COLOR ${value} nicht prüfbar.`,
      };
    }
    // §H9 K-08a: subj.color ist IMMER der quantisierte Name (grid.js →
    // parseColor/CIELAB). Der Soll-Token MUSS durch DENSELBEN Quantisierer,
    // sonst vergleicht der Check zwei Repräsentationen derselben Farbe
    // (#ff0000 vs red = False Negative). Unbekannte Token fallen in
    // parseColor unverändert durch → ehrlicher FAIL bleibt.
    //
    // §H9 P3 MESS-GRANULARITÄT (ausgesprochen, bewusst): `COLOR <hex>`
    // bedeutet nearest-named-color im Mess-Farbraum (140 W3C-Namen, CIELAB —
    // parseColor/rgbToColorName). Zwei Hexes, die in DIESELBE Palette-Zelle
    // quantisieren (z.B. #ff0000 und #ff0001 → beide 'red'), gelten als
    // GLEICH — das ist die Granularität der Messung, kein Bug. Hexes mit
    // VERSCHIEDENEM quantisierten Namen (#ff0000 'red' vs #ff6347 'tomato')
    // bleiben verschieden → FAIL (Pin: tests/h9_red/test_h9_k08a.mjs).
    // Feinere Unterscheidung (Hex-exakter Kanal) wäre eine Design-Runde,
    // keine stille Verfeinerung hier.
    const pass = subj.color === parseColor(value);
    if (pass) return { pass, detail: null };
    return {
      pass,
      detail: `Farbe ist ${subj.color}, soll ${value} sein.`,
      non_spatial: true,
    };
  },
  // No arrange — color cannot be spatially computed
});
