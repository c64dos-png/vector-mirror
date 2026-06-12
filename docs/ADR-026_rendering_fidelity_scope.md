# ADR-026: Rendering Fidelity Scope
<!-- BEACON:ROOT | TYPE:ADR | NAVIGATION:START_HERE→BAUPLAN→hier -->

```text
STATUS: accepted
DATUM:  2026-04-18
TAGS:   [ADR] [ARCH] [RENDERING] [KERNEL] [SCOPE]
SCOPE:  Welche Render-Treue das Tool garantiert, welche nicht, und wie
        Grenzen signalisiert werden.
```

## Kontext

Vector Mirror nutzt Chromium über Playwright als Ground-Truth-Renderer. Die Balisage-Studie (Birnbaum & Taylor 2021) hat empirisch belegt: Chrome, Firefox und Safari liefern unterschiedliche bbox-Werte für identisches SVG. Text-Rendering ist Host-abhängig (Font-Fallback).

Weitere Render-Sonderfälle mit bekannter Ungenauigkeit:
- **3D-Transforms** (matrix3d, perspective): getCTM liefert nur 2D-Anteil
- **SVG-Animationen** (SMIL, CSS): bewegen Elemente über die Zeit
- **Cascaded Opacity**: `getComputedStyle.opacity` gibt nicht kaskadierten Wert
- **Text-bbox**: enthält Glyph-Ascent, nicht typografische Mitte
- **Font-Rendering**: ohne fixierte Fonts variiert Text-Länge

Ohne explizite Scope-Grenze schleichen sich diese Ungenauigkeiten als Tool-Aussagen ein — unsichtbar für das LLM.

## Entscheidung

**Vector Mirror deklariert einen expliziten Rendering-Scope: was garantiert ist, was Chromium-normalisiert ist, was out-of-scope ist. Grenzen werden pro Element als `bbox_reliability` und `warnings` signalisiert.**

### 1. Garantierter Scope

2D-Geometrie von Kernklassen auf Chromium-Basis:
- **Kernklassen**: `rect`, `circle`, `text` (siehe ADR-024)
- **Koordinaten**: über `getCTM()` 4-Punkt-Projektion auf Viewport
- **Farbe**: via `getComputedStyle.fill` mit CIELAB-Normalisierung auf W3C-140-Palette
- **Opacity**: **kaskadiert über Vorfahren** (Fix aus v2.5) — nicht nur direkter Wert
- **Containment**: vollständige Bilanz mit Overflow pro Kante gegen ViewBox

### 2. Chromium-normalisiert, nicht cross-browser

Explizit **nicht garantiert**:
- Gleiche bbox-Werte in Firefox, Safari oder anderen Browsern
- Gleiche Text-Länge auf anderen Host-Systemen (verschiedene Fonts)
- Konsistenz über Chromium-Hauptversionen (Subpixel-Drift möglich)

Mitigation: Playwright-Version wird in `package.json` gelockt. Jede Playwright-Version bündelt genau eine Chromium-Version. Snapshot-Tests (Selftest-Tool aus P1-21) detektieren Drift beim Upgrade.

### 3. Out-of-Scope mit Warning

Elemente mit bekannter Mess-Limit werden **nicht verschwiegen**, sondern markiert:

| Kategorie | Marker | Bedeutung |
|---|---|---|
| 3D-Transform-Vorfahre | `warnings: ["3D_TRANSFORM_ANCESTOR"]`, `bbox_reliability: "not_measurable"` | getCTM-Projektion verliert Z-Komponente |
| Aktive Animation | `warnings: ["ANIMATED_SNAPSHOT_FRAME_0"]`, `bbox_reliability: "approximate"` | Zustand bei `domcontentloaded` (Frame 0) |
| Text mit `dominant-baseline="middle|central"` | `warnings: ["TEXT_DOMINANT_BASELINE_SHIFT"]`, `bbox_reliability: "approximate"` | bbox enthält Glyph-Ascent, typografische Mitte divergiert |
| `<g>` als Gruppen-Container | `status: "container"`, keine bbox-Aussage | Gruppe selbst wird nicht vermessen, Kinder schon |
| Maskiert/geclippt | `status: "masked"` / `"clipped_invisible"` | Element existiert, ist aber nicht visuell sichtbar |

### 4. Text-bbox-Semantik

- `text.bbox` = Glyph-Hülle (Chromium-getBBox-Rückgabe)
- Für typografische Zentrierung: neuer Constraint `TEXT-CENTERED-IN` nutzt `text-anchor` + `dominant-baseline` direkt
- `CENTERED-IN` auf text-Elementen liefert `bbox_reliability: "approximate"` + Warning

### 5. Animationen

- Snapshot immer bei `domcontentloaded` (Frame 0)
- Detection via `el.querySelector('animate, animateTransform')` + `getComputedStyle.animationName !== 'none'`
- Keine Zeit-Parameter-Unterstützung in v2.5 (v3.0 über `setCurrentTime`)

### 6. Reliability-Trichter

Jedes Element trägt ein `bbox_reliability`-Feld (siehe ADR-032):
- `"reliable"` — Default für rect/circle ohne 3D-Vorfahren, ohne Animation
- `"approximate"` — Text-Elemente, Float-Drift möglich, Animationen
- `"not_measurable"` — 3D-Transform, degenerate Geometrie

Bei mehreren Unsicherheits-Quellen gewinnt die niedrigste Stufe (Pessimismus-Prinzip).

## Garantierter Scope

Das Tool garantiert für jeden nicht als limited markierten Fall:

1. bbox-Werte in Chromium (Version aus `package-lock.json`) sind reproduzierbar
2. Kaskadierte Opacity ist korrekt multipliziert
3. Containment-Bilanz ist mathematisch konsistent
4. Farb-Mapping auf W3C-140 ist deterministisch

Das Tool garantiert **nicht**:

1. Cross-Browser-Konsistenz (Firefox, Safari, etc.)
2. Korrekte Messung bei 3D-transformierten Elementen
3. Korrekte Messung bei animierten Elementen (nur Frame 0)
4. Typografische Mitte bei Text (nur Glyph-Hülle, ausser via TEXT-CENTERED-IN)
5. Reproducibility über Chromium-Hauptversions-Sprünge hinweg (Snapshot-Tests warnen)

## Konsequenzen

**Positiv**:
- Ehrliche Grenzen statt stille Fehler
- LLM erfährt was es nicht erwarten darf
- VM-RF-001, RF-004, RF-005, RF-006, RF-009 strukturell adressiert
- Snapshot-Test-Infrastruktur fängt Drift früh ab

**Negativ akzeptiert**:
- Output wird reicher (warnings-Array pro Element)
- LLM muss reliability-Stufe lesen und interpretieren
- Text-Constraints werden komplexer (zwei Varianten: geometrisch vs. typografisch)

**Umsetzung**: siehe FIX_PLAN P1-15, P1-17, P1-18, P1-21.

## Nicht im Scope

- Cross-Browser-Konsistenz (v3.0 via OpenType.js + dual-path Sensor Fusion)
- Animationssteuerung (v3.0)
- 3D-Transform-Projektion (v3.0+ wenn überhaupt)
- Custom-Font-Subsets (v3.0)

## Verwandte ADRs

- ADR-024 Kernel-Vertrag v1 (ergänzt durch Scope-Präzisierung)
- ADR-032 Qualitative Confidence (reliability-Stufen)
- ADR-030 Prinzip der Eigenständigkeit (Chromium als Input, nicht alleinige Autorität)
