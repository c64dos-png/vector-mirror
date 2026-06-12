# VECTOR-MIRROR_SPEC_v1.6_2026-04-12
<!-- VERSION: 1.6 | STATUS: BUILD-SPEC | DATE: 2026-04-12 -->
<!-- FIXES C-01 (getCTM), C-02 (ViewBox), H-01 (Div0), H-02 (X/Y Tol), M-02 (Overlap) -->
<!-- ADDS: Spotter-Korrektur (Deltas), 5%-Toleranz-Regel, W3C-Farbraum, Entity-PreCheck -->

## MODUL 1: RESOLVER (resolver.js)
### Fokus: Präzision & Sicherheit

```javascript
import { chromium } from 'playwright';
import DOMPurify from 'isomorphic-dompurify';

export async function resolve(pageInstance, svgString) {
  // 1. Security & Size Check
  if (!svgString || svgString.includes('<!ENTITY') || svgString.includes('<!DOCTYPE')) {
    return { error: 'SECURITY_VIOLATION', message: 'XML Entities/DOCTYPE nicht erlaubt' };
  }
  if (new TextEncoder().encode(svgString).length > 102400) {
    return { error: 'SVG_TOO_LARGE', message: 'SVG > 100KB' };
  }

  // 2. Sanitization
  const clean = DOMPurify.sanitize(svgString, { USE_PROFILES: { svg: true, svgFilters: true } });
  const html = \`<!DOCTYPE html><html><body style="margin:0;padding:0">\${clean}</body></html>\`;

  try {
    await pageInstance.setContent(html, { waitUntil: 'domcontentloaded', timeout: 5000 });
  } catch (e) { return { error: 'LOAD_FAILED', message: 'Browser-Load fehlgeschlagen' }; }

  return await pageInstance.evaluate(() => {
    const svg = document.querySelector('svg');
    if (!svg) return { error: 'NO_SVG_FOUND', message: 'Kein SVG gefunden' };

    const vb = svg.viewBox?.baseVal;
    const rect = svg.getBoundingClientRect();
    const canvas = {
      width: (vb && vb.width > 0) ? vb.width : Math.round(rect.width),
      height: (vb && vb.height > 0) ? vb.height : Math.round(rect.height),
      vbX: (vb && vb.width > 0) ? vb.x : 0,
      vbY: (vb && vb.height > 0) ? vb.y : 0
    };

    const elements = [];
    const all = svg.querySelectorAll('*');
    if (all.length > 500) return { error: 'TOO_MANY_ELEMENTS', message: 'Max 500 Elemente' };

    for (const el of all) {
      if (['defs','style','script','g','filter'].includes(el.tagName.toLowerCase())) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || parseFloat(style.opacity) < 0.1) continue;

      try {
        const bbox = el.getBBox();
        const ctm = el.getCTM();
        if (!ctm) continue;

        // C-01 Fix: 4-Punkt Projektion für echte Global-BBox
        const pt = svg.createSVGPoint();
        const corners = [
          {x: bbox.x, y: bbox.y}, {x: bbox.x+bbox.width, y: bbox.y},
          {x: bbox.x, y: bbox.y+bbox.height}, {x: bbox.x+bbox.width, y: bbox.y+bbox.height}
        ].map(p => {
          pt.x = p.x; pt.y = p.y;
          return pt.matrixTransform(ctm);
        });

        const xmin = Math.min(...corners.map(p => p.x));
        const ymin = Math.min(...corners.map(p => p.y));
        const xmax = Math.max(...corners.map(p => p.x));
        const ymax = Math.max(...corners.map(p => p.y));

        // H-02 Fix: ID via DOM-Pfad für Stabilität
        const getPath = (e) => {
          if (e.id) return e.id;
          let p = [], c = e;
          while (c && c.tagName !== 'svg') {
            let i = 1, s = c.previousElementSibling;
            while (s) { if (s.tagName === c.tagName) i++; s = s.previousElementSibling; }
            p.unshift(c.tagName.toLowerCase() + i);
            c = c.parentElement;
          }
          return '_' + p.join('_');
        };

        elements.push({
          id: el.id || getPath(el),
          tag: el.tagName.toLowerCase(),
          bbox: { x: xmin, y: ymin, w: xmax-xmin, h: ymax-ymin },
          fill: style.fill, // Browser-normiert auf rgb/rgba
          stroke: style.stroke,
          opacity: parseFloat(style.opacity)
        });
      } catch(e) { continue; }
    }
    return { canvas, elements };
  });
}
```

## MODUL 2: COLOR-NAMES (color-names.js)
### Fokus: W3C Kalibrierung

```javascript
// W3C CSS Named Colors (Auszug Kern-Palette für LLMs)
const PALETTE = [
  { name: 'white', r: 255, g: 255, b: 255 }, { name: 'black', r: 0, g: 0, b: 0 },
  { name: 'red', r: 255, g: 0, b: 0 }, { name: 'green', r: 0, g: 128, b: 0 },
  { name: 'blue', r: 0, g: 0, b: 255 }, { name: 'yellow', r: 255, g: 255, b: 0 },
  { name: 'orange', r: 255, g: 165, b: 0 }, { name: 'purple', r: 128, g: 0, b: 128 },
  { name: 'gray', r: 128, g: 128, b: 128 }, { name: 'silver', r: 192, g: 192, b: 192 },
  { name: 'gold', r: 255, g: 215, b: 0 }, { name: 'hotpink', r: 255, g: 105, b: 180 }
  // ... (wird auf 140 W3C Farben erweitert)
];

// CIELAB Mathe bleibt (OPUS-Kern), aber gegen W3C Palette
export function rgbToColorName(r, g, b) {
  const [L1, a1, b1] = srgbToLab(r, g, b);
  let minDe = Infinity, closest = 'unknown';
  PALETTE.forEach(c => {
    const [L2, a2, b2] = srgbToLab(c.r, c.g, c.b);
    const de = Math.sqrt((L1-L2)**2 + (a1-a2)**2 + (b1-b2)**2);
    if (de < minDe) { minDe = de; closest = c.name; }
  });
  return closest;
}
```

## MODUL 3: MIRROR (mirror.js)
### Fokus: Spotter-Korrektur & 5%-Regel

```javascript
export function checkConstraints(constraints, gridMap) {
  return constraints.map(c => {
    const subj = gridMap.elements.find(e => e.id === c.subject);
    const ref = c.reference ? gridMap.elements.find(e => e.id === c.reference) : null;
    if (!subj || (c.reference && !ref)) return { pass: null, detail: 'ID nicht gefunden' };

    // --- 5% TOLERANZ REGEL ---
    const getTol = (val, dim) => Math.min(gridMap.grid.cellW * 0.5, Math.max(2, dim * 0.05));
    const tolX = getTol(subj.bbox.x, subj.bbox.w);
    const tolY = getTol(subj.bbox.y, subj.bbox.h);

    switch (c.type) {
      case 'CENTERED-IN': {
        const dx = (subj.bbox.x + subj.bbox.w/2) - (ref.bbox.x + ref.bbox.w/2);
        const dy = (subj.bbox.y + subj.bbox.h/2) - (ref.bbox.y + ref.bbox.h/2);
        const pass = Math.abs(dx) <= tolX && Math.abs(dy) <= tolY;
        // SPOTTER-KORREKTUR: dx/dy Werte direkt liefern
        return { pass, detail: pass ? null : 
          \`Verfehlt Zentrum. Korrektur: dx=\${Math.round(-dx)}px, dy=\${Math.round(-dy)}px\` };
      }
      case 'ALIGNED-LEFT': {
        const dx = subj.bbox.x - ref.bbox.x;
        const pass = Math.abs(dx) <= 2; // Harte Wasserwaage: 2px
        return { pass, detail: pass ? null : \`Nicht bündig. Korrektur: dx=\${Math.round(-dx)}px\` };
      }
      case 'SAME-SIZE': {
        if (ref.bbox.w === 0 || ref.bbox.h === 0) return { pass: null, detail: 'Referenz hat Grösse 0' };
        const dw = ref.bbox.w - subj.bbox.w;
        const dh = ref.bbox.h - subj.bbox.h;
        const pass = Math.abs(dw) <= tolX && Math.abs(dh) <= tolY;
        return { pass, detail: pass ? null : \`Grösse weicht ab. Korrektur: dw=\${Math.round(dw)}px, dh=\${Math.round(dh)}px\` };
      }
      // ... weitere Typen folgen Spotter-Schema
    }
  });
}
```

## MODUL 4: EMITTER (emitter.js)
### Fokus: Kompakter Report

```javascript
export function formatReport(gridMap, arbitrated) {
  const lines = [\`STATUS: \${arbitrated.total === 0 ? '✓ Korrekt' : '✗ Korrektur nötig'}\`];
  
  // Nur Top-3 Spotter-Durchsagen
  arbitrated.reported.forEach(issue => {
    lines.push(\`  \${issue.type === 'CONSTRAINT_FAIL' ? '✗' : '△'} \${issue.detail}\`);
  });

  lines.push(\`\\nSZENE: \${gridMap.canvas.width}x\${gridMap.canvas.height} (vb: \${gridMap.canvas.vbX} \${gridMap.canvas.vbY})\`);
  
  // Element-Baum mit Spotter-Hinweis
  gridMap.elements.slice(0, 7).forEach(el => {
    const issue = arbitrated.reported.find(i => i.id === el.id || i.detail.includes(el.id));
    const status = issue ? (issue.type === 'CONSTRAINT_FAIL' ? '✗' : '⚠') : '✓';
    lines.push(\`├─ \${el.tag}#\${el.id}: \${el.cell}, \${el.color} \${status}\`);
  });

  return lines.join('\\n');
}
```
