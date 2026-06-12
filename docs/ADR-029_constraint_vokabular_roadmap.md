# ADR-029: Constraint-Vokabular-Roadmap
<!-- BEACON:ROOT | TYPE:ADR | NAVIGATION:START_HERE→BAUPLAN→hier -->

```text
STATUS: accepted
DATUM:  2026-04-18
TAGS:   [ADR] [CONSTRAINT] [REGISTRY] [VOCABULARY]
SCOPE:  Welche Constraint-Typen das Tool unterstützt, in welcher Version,
        mit welchem Wachstumspfad.
```

## Kontext

Phase 2 hat 11 Constraints eingeführt (CENTERED-IN, NO-OVERLAP, INSIDE, ALIGNED-LEFT, ALIGNED-TOP, LEFT-OF, ABOVE, DISTANCE-FROM, SAME-SIZE, COLOR, FILL). RB-10 hat durch Analyse von iOS Auto Layout, Figma, CSS und Vega-Lite ein ausgereiftes Vokabular identifiziert, das weit über positional+relational hinausgeht: Resize-Constraints (hug/fill/min/max), Alignment-Varianten (centerX/centerY/baseline), Proportions-Constraints (aspect-ratio), Abstand-zu-Rand (margin-from-border).

Ohne Roadmap droht Wildwuchs: jeder Bedarf wird durch einen neuen Constraint-Typ adressiert, ohne Systematik.

## Entscheidung

**Das Constraint-Vokabular wächst entlang einer expliziten Tier-Roadmap. v2.5 erweitert um fünf neue Constraints (Tier A). Spätere Tiers haben klare Aktivierungs-Trigger.**

### 1. v2.5 Core-Vokabular (11 bestehend + 5 Tier-A neu + 1 Text-Sonderfall = 17)

**Bestehend (11 aus Phase 2)**:
CENTERED-IN, NO-OVERLAP, INSIDE, ALIGNED-LEFT, ALIGNED-TOP, LEFT-OF, ABOVE, DISTANCE-FROM, SAME-SIZE, COLOR, FILL.

**Neu in v2.5 (Tier A, 5 Stück)**:
- `ALIGNED-CENTER-X #a #b` — vertikale Fluchtung durch Zentren
- `ALIGNED-CENTER-Y #a #b` — horizontale Fluchtung durch Zentren
- `ALIGNED-BASELINE #a #b` — Text-Baseline-Ausrichtung (text-spezifisch, siehe ADR-026)
- `ASPECT-RATIO #a N:M` — Seitenverhältnis (RB-02)
- `MIN-DISTANCE-FROM-BORDER #a N` — Mindestabstand zum Canvas-Rand (RB-02)

**Neu in v2.5 (Tier B, empfohlen wenn Zeit, 3 Stück)**:
- `MIN-WIDTH #a N`, `MAX-WIDTH #a N`
- `MIN-HEIGHT #a N`, `MAX-HEIGHT #a N`
- `HUG-CONTENTS #group` — Gruppen-Bbox = minimale Umhüllung der Kinder

### 2. v2.5 Text-Sonderkategorie

Text-Elemente verdienen eigene Constraints wegen Glyph-bbox-Problematik (ADR-026):

- `TEXT-CENTERED-IN #a #b` — nutzt `text-anchor` + `dominant-baseline` statt bbox-Mitte

Existierende Geometrie-Constraints (CENTERED-IN, ALIGNED-*) funktionieren weiter auf text, liefern aber `bbox_reliability: "approximate"` + Warning.

### 3. Nicht in v2.5 (v3.0 Tier C)

Mit klaren Aktivierungs-Triggern:

| Constraint | Trigger für v3.0-Aufnahme |
|---|---|
| `ROTATION #a deg` | Wenn Rotation-Checks im User-Feedback auftauchen |
| `Z-ORDER #a [above\|below] #b` | Wenn DOM-Order-Semantik relevant wird |
| `EQUAL-SPACING #a #b #c ...` | Wenn Multi-Element-Distribution gefragt ist |
| `GRID-CELL #a row N col M` | Wenn Grid-Layouts aktiv analysiert werden |
| `FIT-TO-BOX #a #b` | Wenn Scaling-to-Fit gebraucht wird (Achtung: erzeugt scale-transforms, non-scaling-stroke-Problem) |
| `SAME-STYLE #a #b` | Wenn Stil-Konsistenz-Checks nötig |

### 4. Syntax-Regeln (bleibend)

Alle Constraints folgen der etablierten Grammatik:
```
#subject TYPE [#reference] [value]
```

- `#subject` — Pflicht
- `TYPE` — Pflicht, Upper-Case mit Bindestrich
- `#reference` — Pflicht für referenz-basierte Typen (siehe Constraint-Metadata aus ADR-025)
- `value` — Pflicht für parametrisierte Typen (COLOR, DISTANCE-FROM, ASPECT-RATIO, MIN-DISTANCE-FROM-BORDER, MIN/MAX-WIDTH/HEIGHT)

### 5. Anchor-Syntax als v3.0-Option

Eine alternative expressivere Grammatik wird für v3.0 evaluiert:
```
#a.centerX == #b.centerX
#a.width >= 120
#a.baseline == #b.centerY + 10
```

Entscheidung über Einführung nach v2.5-Stabilisierung. Wenn eingeführt, läuft parallel zur bestehenden Syntax — keine Breaking Change.

### 6. Linsen-Konzept (Schicht 3)

In v2.5 wird das Linsen-Konzept als **Stub** eingeführt:
- Parameter `lens: "geometry"` default in `analyze`
- Weitere Linsen (`accessibility`, `typography`, `composition`, `semantic`) sind **registriert aber leer** und liefern beim Aufruf einen klaren Fehler: "Linse 'accessibility' ist für v3.0 geplant".

Das reserviert Schema-Zukunft ohne v2.5-Aufwand.

### 7. Introspection (`vector_mirror_suggest`)

Ein Tool das bestehende SVG-Strukturen analysiert und plausible Constraints vorschlägt, basierend auf deterministischem Rule-Mining (RB-10 Pattern 4.6). Siehe FIX_PLAN Phase 2 Kandidat.

**Explizit nicht**: LLM-gestützte Vorschläge (ADR-031).

## Garantierter Scope

- v2.5 unterstützt mindestens die 11 bestehenden + 5 Tier-A-neuen + 1 Text-Spezialist (TEXT-CENTERED-IN) = 17 Constraints
- Jeder neue Constraint hat Metadaten (`requiresReference`, `acceptsValue`) registriert (ADR-025 Fix)
- Jeder Constraint liefert strukturierte Ergebnisse konform zu `arbitrate`-Schema (ADR-031)
- `TEXT-CENTERED-IN` existiert als erste Text-spezifische Variante

## Konsequenzen

**Positiv**:
- VM-ME-005 Vokabular-Lücken teilweise geschlossen
- Klare Roadmap gegen Wildwuchs
- Linsen-Stub reserviert Schema-Zukunft
- Introspection-Weg offen ohne LLM-Delegation

**Negativ akzeptiert**:
- Constraint-Count steigt von 11 auf 16, Testaufwand wächst linear
- Linsen-Stub ist "leeres Versprechen" für v3.0 — muss konsequent gehalten werden

**Umsetzung**: siehe FIX_PLAN (Tier A im Phase 1 verteilt auf Gruppe C/D, Tier B optional).

## Nicht im Scope

- Kiwi-Solver für Multi-Constraint-Arrange (v3.0)
- Anchor-basierte Syntax (v3.0 Evaluierung)
- Vega-Lite-Grammar (v4.0+ Vision)
- ML-basierte Constraint-Inference (nicht geplant, ADR-031)

## Verwandte ADRs

- ADR-020 Constraint Registry (Plug-In-Pattern)
- ADR-022 Context-Objekt für Registry API
- ADR-025 Session-Garantien (Constraint-Metadata)
- ADR-026 Rendering Fidelity Scope (Text-Sonderfall)
- ADR-031 No LLM-Generated Spotter Content (Introspection bleibt deterministisch)
