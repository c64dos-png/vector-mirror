/**
 * palette.js - W3C CSS Named Colors & CIELAB Delta-E Logic
 * Migrated from color-names.js (v1.6) + parseColor from grid.js
 * Vector Mirror v2.0
 */

const PALETTE = [
  { name: 'aliceblue', r: 240, g: 248, b: 255 },
  { name: 'antiquewhite', r: 250, g: 235, b: 215 },
  { name: 'aqua', r: 0, g: 255, b: 255 },
  { name: 'aquamarine', r: 127, g: 255, b: 212 },
  { name: 'azure', r: 240, g: 255, b: 255 },
  { name: 'beige', r: 245, g: 245, b: 220 },
  { name: 'bisque', r: 255, g: 228, b: 196 },
  { name: 'black', r: 0, g: 0, b: 0 },
  { name: 'blanchedalmond', r: 255, g: 235, b: 205 },
  { name: 'blue', r: 0, g: 0, b: 255 },
  { name: 'blueviolet', r: 138, g: 43, b: 226 },
  { name: 'brown', r: 165, g: 42, b: 42 },
  { name: 'burlywood', r: 222, g: 184, b: 135 },
  { name: 'cadetblue', r: 95, g: 158, b: 160 },
  { name: 'chartreuse', r: 127, g: 255, b: 0 },
  { name: 'chocolate', r: 210, g: 105, b: 30 },
  { name: 'coral', r: 255, g: 127, b: 80 },
  { name: 'cornflowerblue', r: 100, g: 149, b: 237 },
  { name: 'cornsilk', r: 255, g: 248, b: 220 },
  { name: 'crimson', r: 220, g: 20, b: 60 },
  { name: 'cyan', r: 0, g: 255, b: 255 },
  { name: 'darkblue', r: 0, g: 0, b: 139 },
  { name: 'darkcyan', r: 0, g: 139, b: 139 },
  { name: 'darkgoldenrod', r: 184, g: 134, b: 11 },
  { name: 'darkgray', r: 169, g: 169, b: 169 },
  { name: 'darkgreen', r: 0, g: 100, b: 0 },
  { name: 'darkkhaki', r: 189, g: 183, b: 107 },
  { name: 'darkmagenta', r: 139, g: 0, b: 139 },
  { name: 'darkolivegreen', r: 85, g: 107, b: 47 },
  { name: 'darkorange', r: 255, g: 140, b: 0 },
  { name: 'darkorchid', r: 153, g: 50, b: 204 },
  { name: 'darkred', r: 139, g: 0, b: 0 },
  { name: 'darksalmon', r: 233, g: 150, b: 122 },
  { name: 'darkseagreen', r: 143, g: 188, b: 143 },
  { name: 'darkslateblue', r: 72, g: 61, b: 139 },
  { name: 'darkslategray', r: 47, g: 79, b: 79 },
  { name: 'darkturquoise', r: 0, g: 206, b: 209 },
  { name: 'darkviolet', r: 148, g: 0, b: 211 },
  { name: 'deeppink', r: 255, g: 20, b: 147 },
  { name: 'deepskyblue', r: 0, g: 191, b: 255 },
  { name: 'dimgray', r: 105, g: 105, b: 105 },
  { name: 'dodgerblue', r: 30, g: 144, b: 255 },
  { name: 'firebrick', r: 178, g: 34, b: 34 },
  { name: 'floralwhite', r: 255, g: 250, b: 240 },
  { name: 'forestgreen', r: 34, g: 139, b: 34 },
  { name: 'fuchsia', r: 255, g: 0, b: 255 },
  { name: 'gainsboro', r: 220, g: 220, b: 220 },
  { name: 'ghostwhite', r: 248, g: 248, b: 255 },
  { name: 'gold', r: 255, g: 215, b: 0 },
  { name: 'goldenrod', r: 218, g: 165, b: 32 },
  { name: 'gray', r: 128, g: 128, b: 128 },
  { name: 'green', r: 0, g: 128, b: 0 },
  { name: 'greenyellow', r: 173, g: 255, b: 47 },
  { name: 'honeydew', r: 240, g: 255, b: 240 },
  { name: 'hotpink', r: 255, g: 105, b: 180 },
  { name: 'indianred', r: 205, g: 92, b: 92 },
  { name: 'indigo', r: 75, g: 0, b: 130 },
  { name: 'ivory', r: 255, g: 255, b: 240 },
  { name: 'khaki', r: 240, g: 230, b: 140 },
  { name: 'lavender', r: 230, g: 230, b: 250 },
  { name: 'lavenderblush', r: 255, g: 240, b: 245 },
  { name: 'lawngreen', r: 124, g: 252, b: 0 },
  { name: 'lemonchiffon', r: 255, g: 250, b: 205 },
  { name: 'lightblue', r: 173, g: 216, b: 230 },
  { name: 'lightcoral', r: 240, g: 128, b: 128 },
  { name: 'lightcyan', r: 224, g: 255, b: 255 },
  { name: 'lightgoldenrodyellow', r: 250, g: 250, b: 210 },
  { name: 'lightgray', r: 211, g: 211, b: 211 },
  { name: 'lightgreen', r: 144, g: 238, b: 144 },
  { name: 'lightpink', r: 255, g: 182, b: 193 },
  { name: 'lightsalmon', r: 255, g: 160, b: 122 },
  { name: 'lightseagreen', r: 32, g: 178, b: 170 },
  { name: 'lightskyblue', r: 135, g: 206, b: 250 },
  { name: 'lightslategray', r: 119, g: 136, b: 153 },
  { name: 'lightsteelblue', r: 176, g: 196, b: 222 },
  { name: 'lightyellow', r: 255, g: 255, b: 224 },
  { name: 'lime', r: 0, g: 255, b: 0 },
  { name: 'limegreen', r: 50, g: 205, b: 50 },
  { name: 'linen', r: 250, g: 240, b: 230 },
  { name: 'magenta', r: 255, g: 0, b: 255 },
  { name: 'maroon', r: 128, g: 0, b: 0 },
  { name: 'mediumaquamarine', r: 102, g: 205, b: 170 },
  { name: 'mediumblue', r: 0, g: 0, b: 205 },
  { name: 'mediumorchid', r: 186, g: 85, b: 211 },
  { name: 'mediumpurple', r: 147, g: 112, b: 219 },
  { name: 'mediumseagreen', r: 60, g: 179, b: 113 },
  { name: 'mediumslateblue', r: 123, g: 104, b: 238 },
  { name: 'mediumspringgreen', r: 0, g: 250, b: 154 },
  { name: 'mediumturquoise', r: 72, g: 209, b: 204 },
  { name: 'mediumvioletred', r: 199, g: 21, b: 133 },
  { name: 'midnightblue', r: 25, g: 25, b: 112 },
  { name: 'mintcream', r: 245, g: 255, b: 250 },
  { name: 'mistyrose', r: 255, g: 228, b: 225 },
  { name: 'moccasin', r: 255, g: 228, b: 181 },
  { name: 'navajowhite', r: 255, g: 222, b: 173 },
  { name: 'navy', r: 0, g: 0, b: 128 },
  { name: 'oldlace', r: 253, g: 245, b: 230 },
  { name: 'olive', r: 128, g: 128, b: 0 },
  { name: 'olivedrab', r: 107, g: 142, b: 35 },
  { name: 'orange', r: 255, g: 165, b: 0 },
  { name: 'orangered', r: 255, g: 69, b: 0 },
  { name: 'orchid', r: 218, g: 112, b: 214 },
  { name: 'palegoldenrod', r: 238, g: 232, b: 170 },
  { name: 'palegreen', r: 152, g: 251, b: 152 },
  { name: 'paleturquoise', r: 175, g: 238, b: 238 },
  { name: 'palevioletred', r: 219, g: 112, b: 147 },
  { name: 'papayawhip', r: 255, g: 239, b: 213 },
  { name: 'peachpuff', r: 255, g: 218, b: 185 },
  { name: 'peru', r: 205, g: 133, b: 63 },
  { name: 'pink', r: 255, g: 192, b: 203 },
  { name: 'plum', r: 221, g: 160, b: 221 },
  { name: 'powderblue', r: 176, g: 224, b: 230 },
  { name: 'purple', r: 128, g: 0, b: 128 },
  { name: 'rebeccapurple', r: 102, g: 51, b: 153 },
  { name: 'red', r: 255, g: 0, b: 0 },
  { name: 'rosybrown', r: 188, g: 143, b: 143 },
  { name: 'royalblue', r: 65, g: 105, b: 225 },
  { name: 'saddlebrown', r: 139, g: 69, b: 19 },
  { name: 'salmon', r: 250, g: 128, b: 114 },
  { name: 'sandybrown', r: 244, g: 164, b: 96 },
  { name: 'seagreen', r: 46, g: 139, b: 87 },
  { name: 'seashell', r: 255, g: 245, b: 238 },
  { name: 'sienna', r: 160, g: 82, b: 45 },
  { name: 'silver', r: 192, g: 192, b: 192 },
  { name: 'skyblue', r: 135, g: 206, b: 235 },
  { name: 'slateblue', r: 106, g: 90, b: 205 },
  { name: 'slategray', r: 112, g: 128, b: 144 },
  { name: 'snow', r: 255, g: 250, b: 250 },
  { name: 'springgreen', r: 0, g: 255, b: 127 },
  { name: 'steelblue', r: 70, g: 130, b: 180 },
  { name: 'tan', r: 210, g: 180, b: 140 },
  { name: 'teal', r: 0, g: 128, b: 128 },
  { name: 'thistle', r: 216, g: 191, b: 216 },
  { name: 'tomato', r: 255, g: 99, b: 71 },
  { name: 'turquoise', r: 64, g: 224, b: 208 },
  { name: 'violet', r: 238, g: 130, b: 238 },
  { name: 'wheat', r: 245, g: 222, b: 179 },
  { name: 'white', r: 255, g: 255, b: 255 },
  { name: 'whitesmoke', r: 245, g: 245, b: 245 },
  { name: 'yellow', r: 255, g: 255, b: 0 },
  { name: 'yellowgreen', r: 154, g: 205, b: 50 },
];

/**
 * sRGB (0-255) -> CIELAB (D65)
 */
function srgbToLab(r, g, b) {
  let lr = r / 255,
    lg = g / 255,
    lb = b / 255;
  lr = lr > 0.04045 ? ((lr + 0.055) / 1.055) ** 2.4 : lr / 12.92;
  lg = lg > 0.04045 ? ((lg + 0.055) / 1.055) ** 2.4 : lg / 12.92;
  lb = lb > 0.04045 ? ((lb + 0.055) / 1.055) ** 2.4 : lb / 12.92;

  const x = (lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375) / 0.95047;
  const y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175;
  const z = (lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041) / 1.08883;

  const f = (t) => (t > 0.008856 ? t ** (1 / 3) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

const PALETTE_LAB = PALETTE.map((c) => ({
  ...c,
  lab: srgbToLab(c.r, c.g, c.b),
}));

/**
 * Returns the closest W3C color name for given RGB values.
 */
export function rgbToColorName(r, g, b) {
  const [L1, a1, b1] = srgbToLab(r, g, b);
  let minDe = Infinity,
    closest = 'black';

  for (const c of PALETTE_LAB) {
    const [L2, a2, b2] = c.lab;
    const de = Math.sqrt((L1 - L2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
    if (de < minDe) {
      minDe = de;
      closest = c.name;
    }
  }
  return closest;
}

/**
 * Parses CSS color string to W3C named color.
 * Migrated from grid.js parseColor().
 *
 * §H9 P3 MESS-GRANULARITÄT: parseColor IST der Mess-Farbraum des Systems —
 * jede numerische Farbe (hex/rgb) wird auf den NÄCHSTEN der 140 W3C-Namen
 * quantisiert (CIELAB-Distanz, rgbToColorName). Konsequenz für Vergleiche
 * (z.B. COLOR-Constraint): Hexes derselben Palette-Zelle sind GLEICH
 * (#ff0000 ≡ #ff0001 ≡ 'red'), Hexes verschiedener Zellen verschieden
 * (#ff0000 'red' ≢ #ff6347 'tomato'). Bewusste Mess-Granularität — eine
 * hex-exakte Unterscheidung wäre ein eigener Kanal (Design-Runde), keine
 * stille Änderung dieses Quantisierers.
 */
export function parseColor(css) {
  if (!css || css === 'none' || css === 'rgba(0, 0, 0, 0)')
    return 'transparent';
  if (css === 'indeterminate') return 'indeterminate'; // §HEAL3b: ehrlicher Nicht-Mess-Token, erstklassig
  if (css.startsWith('url(')) return 'gradient';
  // §H9 K-08a: Hex-Formen (#rgb/#rrggbb) sind verlustfrei nach rgb auflösbar
  // und werden in DENSELBEN Namensraum quantisiert wie die Mess-Seite
  // (rgbToColorName/CIELAB) — kein zweites Farbsystem, keine Toleranz-Schwelle.
  // Andere Token fallen wie bisher unverändert durch (Fallback unten).
  const hex = css.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h =
      hex[1].length === 3
        ? hex[1].replace(/./g, (c) => c + c)
        : hex[1];
    return rgbToColorName(
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    );
  }
  const match = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match)
    return rgbToColorName(
      parseInt(match[1], 10),
      parseInt(match[2], 10),
      parseInt(match[3], 10),
    );
  return css;
}
